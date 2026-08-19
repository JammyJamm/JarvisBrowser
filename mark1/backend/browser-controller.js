//==========================================================
//
// backend/browser-controller.js
//
// Ultra Intelligent Browser Controller
//
// FIXED VERSION
//
// Main fixes
// ----------
// ✔ Never select devtools:// pages
// ✔ Prefer real web pages
// ✔ Stable CDP connection
// ✔ Do not reconnect just because one page closed
// ✔ Fast health checks
// ✔ Reduced reconnect delay
// ✔ SPA-friendly waiting
// ✔ Prevent duplicate connections
// ✔ Automatic active-page recovery
//
//==========================================================

import { chromium } from "playwright";

class BrowserController {
  constructor(options = {}) {
    this.options = {
      cdpURL: "http://127.0.0.1:9222",

      // Faster recovery
      reconnectInterval: 500,
      maxReconnectAttempts: 5,

      autoReconnect: true,

      // IMPORTANT:
      // Do NOT use networkidle as the default.
      waitUntil: "domcontentloaded",

      navigationTimeout: 30000,

      // Short health check
      healthCheckTimeout: 3000,

      // DOM/application rendering grace period
      pageReadyTimeout: 5000,

      debug: false,

      ...options,
    };

    //--------------------------------------------------
    // PLAYWRIGHT
    //--------------------------------------------------

    this.browser = null;
    this.context = null;
    this.page = null;

    //--------------------------------------------------
    // CONNECTION STATE
    //--------------------------------------------------

    this.connected = false;
    this.connecting = false;
    this.connectionPromise = null;

    this.lastConnected = 0;
    this.lastURL = "";

    //--------------------------------------------------
    // EVENTS
    //--------------------------------------------------

    this.attachedPages = new WeakSet();
    this.contextEventsAttached = false;

    //--------------------------------------------------
    // STATISTICS
    //--------------------------------------------------

    this.stats = {
      reconnects: 0,
      pageSwitches: 0,
      navigations: 0,
      downloads: 0,
      dialogs: 0,
      crashes: 0,
      pageCloses: 0,
      popups: 0,
      healthChecks: 0,
      screenshots: 0,
      tabsCreated: 0,
      tabsClosed: 0,
      evaluations: 0,
      retries: 0,
    };
  }

  //==========================================================
  // LOGGING
  //==========================================================

  log(...args) {
    if (this.options.debug) {
      console.log("[BrowserController]", ...args);
    }
  }

  warn(...args) {
    console.warn("[BrowserController]", ...args);
  }

  error(...args) {
    console.error("[BrowserController]", ...args);
  }

  //==========================================================
  // PAGE FILTER
  //
  // VERY IMPORTANT
  //
  // Electron DevTools creates pages such as:
  //
  // devtools://devtools/bundled/...
  //
  // Those pages must NEVER become the automation target.
  //==========================================================

  isAutomationPage(page) {
    if (!page || page.isClosed()) {
      return false;
    }

    const url = String(page.url() || "")
      .trim()
      .toLowerCase();

    if (!url) {
      return false;
    }

    const blockedProtocols = [
      "devtools:",
      "chrome:",
      "chrome-extension:",
      "edge:",
      "about:",
      "view-source:",
    ];

    if (blockedProtocols.some((protocol) => url.startsWith(protocol))) {
      return false;
    }

    return true;
  }

  //==========================================================
  // GET VALID PAGES
  //==========================================================

  getAutomationPages() {
    if (!this.context) {
      return [];
    }

    return this.context.pages().filter((page) => this.isAutomationPage(page));
  }

  //==========================================================
  // CONNECTION
  //==========================================================

  async connect(force = false) {
    //--------------------------------------------------------
    // Existing healthy connection
    //--------------------------------------------------------

    if (
      !force &&
      this.connected &&
      this.browser &&
      this.context &&
      this.page &&
      !this.page.isClosed() &&
      this.isAutomationPage(this.page)
    ) {
      return this.page;
    }

    //--------------------------------------------------------
    // Prevent duplicate connection attempts
    //--------------------------------------------------------

    if (this.connecting && this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connecting = true;

    this.connectionPromise = this.connectInternal(force);

    try {
      return await this.connectionPromise;
    } finally {
      this.connecting = false;
      this.connectionPromise = null;
    }
  }

  //==========================================================
  // CONNECT INTERNAL
  //==========================================================

  async connectInternal(force = false) {
    if (force) {
      await this.disconnect();
    }

    this.log("Connecting to Electron CDP:", this.options.cdpURL);

    //--------------------------------------------------------
    // CONNECT
    //--------------------------------------------------------

    this.browser = await chromium.connectOverCDP(this.options.cdpURL);

    //--------------------------------------------------------
    // BROWSER DISCONNECT
    //
    // This means Electron/Chromium itself disappeared.
    //--------------------------------------------------------

    this.browser.on("disconnected", () => {
      this.connected = false;

      this.browser = null;
      this.context = null;
      this.page = null;

      this.warn("Electron CDP connection disconnected.");
    });

    //--------------------------------------------------------
    // CONTEXT
    //--------------------------------------------------------

    const contexts = this.browser.contexts();

    if (!contexts.length) {
      throw new Error("No browser contexts available.");
    }

    this.context = contexts[0];

    //--------------------------------------------------------
    // FIND REAL WEB PAGE
    //--------------------------------------------------------

    await this.refreshActivePage();

    //--------------------------------------------------------
    // ATTACH EVENTS
    //--------------------------------------------------------

    this.attachEventsToAllPages();
    this.attachContextEvents();

    //--------------------------------------------------------
    // CONNECTED
    //--------------------------------------------------------

    this.connected = true;
    this.lastConnected = Date.now();

    this.log("Connected successfully.");

    this.log("Automation page:", this.lastURL);

    return this.page;
  }

  //==========================================================
  // DISCONNECT
  //
  // IMPORTANT:
  // Never call browser.close() because this is an Electron
  // browser connected through CDP.
  //==========================================================

  async disconnect() {
    this.connected = false;

    this.page = null;
    this.context = null;
    this.browser = null;

    this.connectionPromise = null;

    this.attachedPages = new WeakSet();
    this.contextEventsAttached = false;

    this.lastURL = "";
  }

  //==========================================================
  // HEALTH CHECK
  //==========================================================

  async ensureConnected() {
    this.stats.healthChecks++;

    //--------------------------------------------------------
    // FAST PATH
    //--------------------------------------------------------

    if (
      this.connected &&
      this.browser &&
      this.context &&
      this.page &&
      !this.page.isClosed() &&
      this.isAutomationPage(this.page)
    ) {
      try {
        await this.page.evaluate(() => document.readyState);

        return this.page;
      } catch (error) {
        this.warn("Current automation page is unavailable:", error.message);

        this.page = null;
      }
    }

    //--------------------------------------------------------
    // FIND ANOTHER LIVE PAGE BEFORE RECONNECTING
    //--------------------------------------------------------

    if (this.browser && this.context) {
      const pages = this.getAutomationPages();

      if (pages.length) {
        this.page = pages[pages.length - 1];

        this.lastURL = this.page.url();

        this.connected = true;

        this.attachPageEvents(this.page);

        this.log("Recovered existing automation page:", this.lastURL);

        return this.page;
      }
    }

    //--------------------------------------------------------
    // DISABLE RECONNECT
    //--------------------------------------------------------

    if (!this.options.autoReconnect) {
      throw new Error("Browser is disconnected.");
    }

    //--------------------------------------------------------
    // RECONNECT
    //--------------------------------------------------------

    this.stats.reconnects++;

    let lastError = null;

    for (
      let attempt = 1;
      attempt <= this.options.maxReconnectAttempts;
      attempt++
    ) {
      try {
        this.log(`Reconnect ${attempt}/${this.options.maxReconnectAttempts}`);

        const page = await this.connect(true);

        return page;
      } catch (error) {
        lastError = error;

        this.warn(`Reconnect ${attempt} failed:`, error.message);

        if (attempt < this.options.maxReconnectAttempts) {
          await this.sleep(this.options.reconnectInterval);
        }
      }
    }

    throw new Error(
      `Unable to reconnect to Electron CDP after ` +
        `${this.options.maxReconnectAttempts} attempts. ` +
        `${lastError?.message || ""}`,
    );
  }

  //==========================================================
  // ACTIVE PAGE
  //==========================================================

  async refreshActivePage() {
    if (!this.context) {
      throw new Error("Browser context not available.");
    }

    //--------------------------------------------------------
    // ONLY REAL WEB PAGES
    //--------------------------------------------------------

    const pages = this.getAutomationPages();

    //--------------------------------------------------------
    // DEBUG
    //--------------------------------------------------------

    if (this.options.debug) {
      const allPages = this.context.pages();

      console.log("[BrowserController] All CDP pages:");

      for (const page of allPages) {
        console.log(
          "  -",
          page.url(),
          this.isAutomationPage(page) ? "[AUTOMATION]" : "[IGNORED]",
        );
      }
    }

    if (!pages.length) {
      throw new Error(
        "No automation page found. Electron has no active web page.",
      );
    }

    //--------------------------------------------------------
    // KEEP CURRENT PAGE
    //--------------------------------------------------------

    if (this.page && !this.page.isClosed() && pages.includes(this.page)) {
      this.lastURL = this.page.url();

      return this.page;
    }

    //--------------------------------------------------------
    // PREFER CURRENT NON-DEVTOOLS PAGE
    //--------------------------------------------------------

    const previousURL = this.lastURL;

    let active = null;

    if (previousURL) {
      active = pages.find((page) => page.url() === previousURL);
    }

    //--------------------------------------------------------
    // OTHERWISE USE LAST REAL PAGE
    //--------------------------------------------------------

    if (!active) {
      active = pages[pages.length - 1];
    }

    //--------------------------------------------------------
    // SWITCH
    //--------------------------------------------------------

    if (this.page && this.page !== active) {
      this.stats.pageSwitches++;
    }

    this.page = active;

    this.lastURL = this.page.url();

    this.attachPageEvents(this.page);

    this.log("Active automation page:", this.lastURL);

    return this.page;
  }

  //==========================================================
  // GETTERS
  //==========================================================

  async getBrowser() {
    await this.ensureConnected();

    return this.browser;
  }

  async getContext() {
    await this.ensureConnected();

    return this.context;
  }

  async getPage() {
    await this.ensureConnected();

    await this.refreshActivePage();

    return this.page;
  }

  async getPages() {
    await this.ensureConnected();

    return this.getAutomationPages();
  }

  async getFrames() {
    const page = await this.getPage();

    return page.frames();
  }

  //==========================================================
  // PAGE READY
  //
  // IMPORTANT:
  // Do not wait for networkidle.
  //
  // Modern sites can keep analytics/websocket requests open
  // forever.
  //==========================================================

  async waitForReady(timeout = 5000) {
    const page = await this.getPage();

    await page
      .waitForLoadState("domcontentloaded", {
        timeout,
      })
      .catch(() => {});

    //--------------------------------------------------------
    // Small rendering check
    //--------------------------------------------------------

    const started = Date.now();

    while (Date.now() - started < timeout) {
      try {
        const readyState = await page.evaluate(() => document.readyState);

        if (readyState === "interactive" || readyState === "complete") {
          return page;
        }
      } catch {
        break;
      }

      await this.sleep(100);
    }

    return page;
  }

  //==========================================================
  // NAVIGATION
  //==========================================================

  async goto(url, options = {}) {
    if (!url) {
      throw new Error("URL is required.");
    }

    const page = await this.getPage();

    const targetURL = String(url).trim();

    const previousURL = page.url();

    this.log("Navigating:", targetURL);

    await page.goto(targetURL, {
      waitUntil: options.waitUntil || this.options.waitUntil,

      timeout: options.timeout || this.options.navigationTimeout,

      ...options,
    });

    await this.waitForReady(this.options.pageReadyTimeout);

    const currentURL = page.url();

    if (previousURL !== currentURL) {
      this.stats.navigations++;
    }

    this.lastURL = currentURL;

    this.invalidateIfNeeded();

    return page;
  }

  //==========================================================
  // WAIT NAVIGATION
  //==========================================================

  async waitForNavigation(timeout = 10000) {
    const page = await this.getPage();

    await page
      .waitForLoadState(this.options.waitUntil, {
        timeout,
      })
      .catch(() => {});

    this.lastURL = page.url();

    return page;
  }

  //==========================================================
  // RELOAD
  //==========================================================

  async reload(options = {}) {
    const page = await this.getPage();

    await page.reload({
      waitUntil: options.waitUntil || this.options.waitUntil,

      timeout: options.timeout || this.options.navigationTimeout,

      ...options,
    });

    await this.waitForReady(this.options.pageReadyTimeout);

    this.lastURL = page.url();

    return page;
  }

  //==========================================================
  // HTML
  //==========================================================

  async html() {
    const page = await this.getPage();

    return page.content();
  }

  //==========================================================
  // TEXT
  //==========================================================

  async text() {
    const page = await this.getPage();

    return page.evaluate(() => document.body?.innerText || "");
  }

  //==========================================================
  // URL
  //==========================================================

  async url() {
    const page = await this.getPage();

    this.lastURL = page.url();

    return this.lastURL;
  }

  //==========================================================
  // TITLE
  //==========================================================

  async title() {
    const page = await this.getPage();

    return page.title();
  }

  //==========================================================
  // SCREENSHOT
  //==========================================================

  async screenshot(options = {}) {
    const page = await this.getPage();

    const result = await page.screenshot({
      fullPage: true,
      ...options,
    });

    this.stats.screenshots++;

    return result;
  }

  //==========================================================
  // NEW TAB
  //==========================================================

  async newTab(url = "about:blank") {
    await this.ensureConnected();

    const page = await this.context.newPage();

    this.stats.tabsCreated++;

    this.attachPageEvents(page);

    if (url && url !== "about:blank") {
      await page.goto(url, {
        waitUntil: this.options.waitUntil,

        timeout: this.options.navigationTimeout,
      });
    }

    this.page = page;

    this.lastURL = page.url();

    this.stats.pageSwitches++;

    return page;
  }

  //==========================================================
  // SWITCH PAGE
  //==========================================================

  async switchToPage(index = 0) {
    await this.ensureConnected();

    const pages = this.getAutomationPages();

    if (index < 0 || index >= pages.length) {
      throw new Error(
        `Invalid page index ${index}. ` + `Available pages: ${pages.length}`,
      );
    }

    const previous = this.page;

    this.page = pages[index];

    this.attachPageEvents(this.page);

    this.lastURL = this.page.url();

    if (previous !== this.page) {
      this.stats.pageSwitches++;
    }

    return this.page;
  }

  //==========================================================
  // LAST PAGE
  //==========================================================

  async switchToLastPage() {
    const pages = await this.getPages();

    if (!pages.length) {
      throw new Error("No automation pages available.");
    }

    return this.switchToPage(pages.length - 1);
  }

  //==========================================================
  // CLOSE CURRENT PAGE
  //==========================================================

  async closeCurrentPage() {
    const page = await this.getPage();

    await page.close().catch(() => {});

    this.stats.tabsClosed++;

    this.page = null;

    const pages = this.getAutomationPages();

    if (pages.length) {
      this.page = pages[pages.length - 1];

      this.lastURL = this.page.url();
    }

    return this.page;
  }

  //==========================================================
  // FRAMES
  //==========================================================

  async getMainFrame() {
    const page = await this.getPage();

    return page.mainFrame();
  }

  async getFrameByName(name) {
    const frames = await this.getFrames();

    return frames.find((frame) => frame.name() === name) || null;
  }

  async getFrameByURL(urlPart) {
    const frames = await this.getFrames();

    return frames.find((frame) => frame.url().includes(urlPart)) || null;
  }

  async waitForFrame(predicate, timeout = 10000) {
    const started = Date.now();

    while (Date.now() - started < timeout) {
      const frames = await this.getFrames();

      const found = frames.find(predicate);

      if (found) {
        return found;
      }

      await this.sleep(200);
    }

    throw new Error("Frame not found.");
  }

  //==========================================================
  // EVALUATION
  //==========================================================

  async evaluate(fn, arg = null) {
    const page = await this.getPage();

    this.stats.evaluations++;

    return page.evaluate(fn, arg);
  }

  async evaluateHandle(fn, arg = null) {
    const page = await this.getPage();

    this.stats.evaluations++;

    return page.evaluateHandle(fn, arg);
  }

  //==========================================================
  // BRING TO FRONT
  //==========================================================

  async bringToFront() {
    const page = await this.getPage();

    await page.bringToFront().catch(() => {});

    return page;
  }

  async focus() {
    return this.bringToFront();
  }

  //==========================================================
  // CONTEXT EVENTS
  //==========================================================

  attachContextEvents() {
    if (!this.context || this.contextEventsAttached) {
      return;
    }

    this.contextEventsAttached = true;

    this.context.on("page", (page) => {
      if (!this.isAutomationPage(page)) {
        this.log("Ignoring non-automation page:", page.url());

        return;
      }

      this.stats.popups++;

      this.log("New automation page:", page.url());

      this.attachPageEvents(page);

      this.page = page;

      this.lastURL = page.url();
    });
  }

  //==========================================================
  // ALL PAGE EVENTS
  //==========================================================

  attachEventsToAllPages() {
    if (!this.context) {
      return;
    }

    for (const page of this.context.pages()) {
      if (this.isAutomationPage(page)) {
        this.attachPageEvents(page);
      }
    }
  }

  //==========================================================
  // PAGE EVENTS
  //==========================================================

  attachPageEvents(page) {
    if (!page || page.isClosed() || this.attachedPages.has(page)) {
      return;
    }

    this.attachedPages.add(page);

    //--------------------------------------------------------
    // DOWNLOAD
    //--------------------------------------------------------

    page.on("download", (download) => {
      this.lastDownload = download;

      this.stats.downloads++;

      this.log("Download:", download.suggestedFilename());
    });

    //--------------------------------------------------------
    // DIALOG
    //--------------------------------------------------------

    page.on("dialog", async (dialog) => {
      this.lastDialog = dialog;

      this.stats.dialogs++;

      this.warn("Dialog:", dialog.type(), dialog.message());
    });

    //--------------------------------------------------------
    // NAVIGATION
    //--------------------------------------------------------

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        this.lastURL = frame.url();

        this.log("Navigated:", this.lastURL);
      }
    });

    //--------------------------------------------------------
    // CRASH
    //--------------------------------------------------------

    page.on("crash", () => {
      this.stats.crashes++;

      if (page === this.page) {
        this.page = null;
      }

      this.warn("Automation page crashed.");
    });

    //--------------------------------------------------------
    // CLOSE
    //
    // IMPORTANT:
    //
    // Page close != Electron close
    //
    //--------------------------------------------------------

    page.on("close", () => {
      this.stats.pageCloses++;

      if (page === this.page) {
        this.page = null;
      }

      const livePages = this.getAutomationPages();

      if (livePages.length) {
        this.page = livePages[livePages.length - 1];

        this.lastURL = this.page.url();

        this.attachPageEvents(this.page);

        this.warn(
          "Automation page closed; switched to another live page:",
          this.lastURL,
        );

        return;
      }

      //--------------------------------------------------
      // IMPORTANT:
      //
      // Do NOT immediately call connect(true).
      //
      // Electron may still be alive while the BrowserView
      // is being recreated.
      //--------------------------------------------------

      this.warn(
        "Automation page closed. No live web page currently available.",
      );
    });
  }

  //==========================================================
  // WAIT FOR SELECTOR
  //==========================================================

  async waitForSelector(selector, options = {}) {
    const page = await this.getPage();

    return page.waitForSelector(selector, {
      timeout: 5000,
      ...options,
    });
  }

  //==========================================================
  // WAIT FOR FUNCTION
  //==========================================================

  async waitForFunction(fn, arg = null, options = {}) {
    const page = await this.getPage();

    return page.waitForFunction(fn, arg, options);
  }

  //==========================================================
  // WAIT URL
  //==========================================================

  async waitForURL(matcher, options = {}) {
    const page = await this.getPage();

    await page.waitForURL(matcher, {
      timeout: 10000,
      ...options,
    });

    this.lastURL = page.url();

    return this.lastURL;
  }

  //==========================================================
  // WAIT LOAD STATE
  //==========================================================

  async waitForLoadState(state = "domcontentloaded") {
    const page = await this.getPage();

    await page
      .waitForLoadState(state, {
        timeout: 10000,
      })
      .catch(() => {});

    return true;
  }

  //==========================================================
  // SAFE
  //==========================================================

  async safe(action, fallback = null) {
    if (typeof action !== "function") {
      throw new TypeError("safe() requires a function.");
    }

    try {
      return await action();
    } catch (error) {
      this.error("Safe execution failed:", error.message);

      return fallback;
    }
  }

  //==========================================================
  // INVALIDATE
  //==========================================================

  invalidateIfNeeded() {
    // Hook for resolver/MCP cache invalidation.
    //
    // BrowserController intentionally does not own the
    // Resolver DOM cache.
  }

  //==========================================================
  // SLEEP
  //==========================================================

  async sleep(milliseconds = 100) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  //==========================================================
  // DEBUG
  //==========================================================

  //==========================================================
  // DEBUG
  //==========================================================

  async inspect() {
    const pages = this.context ? this.context.pages() : [];

    return {
      connected: this.connected,

      cdpURL: this.options.cdpURL,

      activePage: this.page ? this.page.url() : null,

      pages: pages.map((page) => ({
        url: page.url(),
        automationPage: this.isAutomationPage(page),
        closed: page.isClosed(),
      })),

      stats: {
        ...this.stats,
      },
    };
  }
}

//==========================================================
// SHARED BROWSER CONTROLLER INSTANCE
//==========================================================
//
// DO NOT export the class here.
//
// mcp-client.js expects:
//
// browserController.connect()
// browserController.ensureConnected()
// browserController.browser
// browserController.context
// browserController.page
//
//==========================================================

const browserController = new BrowserController();

export default browserController;
