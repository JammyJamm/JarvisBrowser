//==========================================================
//
// backend/browser-controller.js
//
// Ultra Intelligent Browser Controller
//
// Architecture
//
// Electron
//      │
// Chromium CDP
//      │
// BrowserController
//      │
// Resolver / MCP / Planner
//
// Features
// --------
// ✔ Auto reconnect
// ✔ Browser health monitoring
// ✔ Context manager
// ✔ Active page detection
// ✔ Event manager
// ✔ Download manager
// ✔ Dialog manager
// ✔ Multi-tab support
// ✔ Auto page recovery
// ✔ Performance statistics
// ✔ Safe execution
// ✔ Retry execution
// ✔ Frame helpers
// ✔ DOM evaluation
// ✔ Cookie management
//
//==========================================================

import { chromium } from "playwright";

class BrowserController {
  constructor(options = {}) {
    //--------------------------------------------------
    // Configuration
    //--------------------------------------------------

    this.options = {
      cdpURL: "http://127.0.0.1:9222",

      reconnectInterval: 1000,

      maxReconnectAttempts: 10,

      autoReconnect: true,

      waitUntil: "domcontentloaded",

      navigationTimeout: 60000,

      healthCheckTimeout: 5000,

      debug: false,

      ...options,
    };

    //--------------------------------------------------
    // Playwright Handles
    //--------------------------------------------------

    this.browser = null;

    this.context = null;

    this.page = null;

    //--------------------------------------------------
    // Runtime State
    //--------------------------------------------------

    this.connected = false;

    this.connecting = false;

    this.connectionPromise = null;

    this.lastConnected = 0;

    this.lastURL = "";

    //--------------------------------------------------
    // Downloads / Dialogs
    //--------------------------------------------------

    this.lastDownload = null;

    this.lastDialog = null;

    //--------------------------------------------------
    // Event State
    //--------------------------------------------------

    this.attachedPages = new WeakSet();

    //--------------------------------------------------
    // Statistics
    //--------------------------------------------------

    this.stats = this.createStatistics();
  }

  //==================================================
  // STATISTICS FACTORY
  //==================================================

  createStatistics() {
    return {
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

  //==================================================
  // LOGGING
  //==================================================

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

  //==================================================
  // CONNECTION
  //==================================================

  async connect(force = false) {
    //--------------------------------------------------
    // Existing healthy connection
    //--------------------------------------------------

    if (
      !force &&
      this.connected &&
      this.browser &&
      this.context &&
      this.page &&
      !this.page.isClosed()
    ) {
      return this.page;
    }

    //--------------------------------------------------
    // Prevent duplicate connections
    //--------------------------------------------------

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

  //==================================================
  // INTERNAL CONNECT
  //==================================================

  async connectInternal(force = false) {
    if (force) {
      await this.disconnect();
    }

    this.log("Connecting to Electron CDP:", this.options.cdpURL);

    //--------------------------------------------------
    // Connect
    //--------------------------------------------------

    this.browser = await chromium.connectOverCDP(this.options.cdpURL);

    //--------------------------------------------------
    // Context discovery
    //--------------------------------------------------

    const contexts = this.browser.contexts();

    if (!contexts.length) {
      throw new Error("No browser contexts available.");
    }

    this.context = contexts[0];

    //--------------------------------------------------
    // Find active page
    //--------------------------------------------------

    await this.refreshActivePage();

    //--------------------------------------------------
    // Attach existing page events
    //--------------------------------------------------

    this.attachEventsToAllPages();

    //--------------------------------------------------
    // Context events
    //--------------------------------------------------

    this.attachContextEvents();

    //--------------------------------------------------
    // Connection state
    //--------------------------------------------------

    this.connected = true;

    this.lastConnected = Date.now();

    this.log("Connected successfully.");

    this.log("Active URL:", this.lastURL);

    return this.page;
  }

  //==================================================
  // DISCONNECT
  //==================================================

  async disconnect() {
    this.connected = false;

    this.page = null;

    this.context = null;

    //--------------------------------------------------
    // IMPORTANT
    //
    // Do NOT call browser.close() on a CDP-attached
    // Electron browser when you only want to detach.
    //
    // Playwright's CDP connection will be released
    // when the controller drops the reference.
    //--------------------------------------------------

    this.browser = null;

    this.attachedPages = new WeakSet();

    this.lastURL = "";
  }

  //==================================================
  // HEALTH CHECK
  //==================================================

  async ensureConnected() {
    this.stats.healthChecks++;

    //--------------------------------------------------
    // Fast path
    //--------------------------------------------------

    if (
      this.connected &&
      this.browser &&
      this.context &&
      this.page &&
      !this.page.isClosed()
    ) {
      try {
        await this.page.title({
          timeout: this.options.healthCheckTimeout,
        });

        return this.page;
      } catch {
        this.warn("Current page is unreachable.");
      }
    }

    //--------------------------------------------------
    // No auto reconnect
    //--------------------------------------------------

    if (!this.options.autoReconnect) {
      throw new Error("Browser is disconnected.");
    }

    //--------------------------------------------------
    // Reconnect
    //--------------------------------------------------

    this.stats.reconnects++;

    let lastError = null;

    for (
      let attempt = 1;
      attempt <= this.options.maxReconnectAttempts;
      attempt++
    ) {
      try {
        this.log(
          `Reconnect attempt ${attempt}/${this.options.maxReconnectAttempts}`,
        );

        const page = await this.connect(true);

        return page;
      } catch (err) {
        lastError = err;

        this.warn(`Reconnect attempt ${attempt} failed:`, err.message);

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

  //==================================================
  // ACTIVE PAGE
  //==================================================

  async refreshActivePage() {
    if (!this.context) {
      throw new Error("Browser context not available.");
    }

    const pages = this.context.pages().filter((page) => !page.isClosed());

    if (!pages.length) {
      throw new Error("No pages found.");
    }

    //--------------------------------------------------
    // Keep current page if still alive
    //
    // This is safer than always choosing pages[0].
    //--------------------------------------------------

    if (this.page && !this.page.isClosed() && pages.includes(this.page)) {
      this.lastURL = this.page.url();

      return this.page;
    }

    //--------------------------------------------------
    // Select last available page
    //
    // In Electron CDP environments this is generally
    // the newest BrowserView/page.
    //--------------------------------------------------

    const active = pages[pages.length - 1];

    if (this.page && this.page !== active) {
      this.stats.pageSwitches++;
    }

    this.page = active;

    this.lastURL = this.page.url();

    this.log("Active page:", this.lastURL);

    return this.page;
  }

  //==================================================
  // GETTERS
  //==================================================

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

    return this.context.pages().filter((page) => !page.isClosed());
  }

  async getFrames() {
    const page = await this.getPage();

    return page.frames();
  }

  //==================================================
  // PAGE STATE
  //==================================================

  async waitForReady() {
    const page = await this.getPage();

    await page.waitForLoadState("domcontentloaded").catch(() => {});

    await page.waitForLoadState("networkidle").catch(() => {});

    return page;
  }

  async waitForNavigation(timeout = 30000) {
    const page = await this.getPage();

    await page
      .waitForLoadState(this.options.waitUntil, {
        timeout,
      })
      .catch(() => {});

    this.lastURL = page.url();

    return page;
  }

  async reload(options = {}) {
    const page = await this.getPage();

    await page.reload({
      waitUntil: this.options.waitUntil,

      timeout: this.options.navigationTimeout,

      ...options,
    });

    this.lastURL = page.url();

    return page;
  }

  async goto(url, options = {}) {
    if (!url) {
      throw new Error("URL is required.");
    }

    const page = await this.getPage();

    const previousURL = page.url();

    await page.goto(
      String(url),

      {
        waitUntil: this.options.waitUntil,

        timeout: this.options.navigationTimeout,

        ...options,
      },
    );

    const currentURL = page.url();

    if (previousURL !== currentURL) {
      this.stats.navigations++;
    }

    this.lastURL = currentURL;

    return page;
  }

  //==================================================
  // HTML / URL
  //==================================================

  async html() {
    const page = await this.getPage();

    return await page.content();
  }

  async text() {
    const page = await this.getPage();

    return await page.evaluate(() => document.body?.innerText || "");
  }

  async url() {
    const page = await this.getPage();

    this.lastURL = page.url();

    return this.lastURL;
  }

  async title() {
    const page = await this.getPage();

    return await page.title();
  }

  //==================================================
  // SCREENSHOT
  //==================================================

  async screenshot(options = {}) {
    const page = await this.getPage();

    const result = await page.screenshot({
      fullPage: true,

      ...options,
    });

    this.stats.screenshots++;

    return result;
  }

  //==================================================
  // TAB MANAGEMENT
  //==================================================

  async newTab(url = "about:blank") {
    await this.ensureConnected();

    const page = await this.context.newPage();

    this.stats.tabsCreated++;

    this.attachPageEvents(page);

    if (url && url !== "about:blank") {
      await page.goto(
        url,

        {
          waitUntil: this.options.waitUntil,

          timeout: this.options.navigationTimeout,
        },
      );
    }

    this.page = page;

    this.lastURL = page.url();

    this.stats.pageSwitches++;

    return page;
  }

  async switchToPage(index = 0) {
    await this.ensureConnected();

    const pages = this.context.pages().filter((page) => !page.isClosed());

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

  async switchToLastPage() {
    const pages = await this.getPages();

    if (!pages.length) {
      throw new Error("No pages available.");
    }

    return this.switchToPage(pages.length - 1);
  }

  async closeCurrentPage() {
    const page = await this.getPage();

    await page.close().catch(() => {});

    this.stats.tabsClosed++;

    this.page = null;

    await this.refreshActivePage();

    return this.page;
  }

  //==================================================
  // FRAME HELPERS
  //==================================================

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

      await this.sleep(250);
    }

    throw new Error("Frame not found.");
  }

  async evaluateInFrame(frame, fn, arg = null) {
    if (!frame) {
      throw new Error("Frame is required.");
    }

    return await frame.evaluate(fn, arg);
  }

  //==================================================
  // BROWSER UTILITIES
  //==================================================

  async evaluate(fn, arg = null) {
    const page = await this.getPage();

    this.stats.evaluations++;

    return await page.evaluate(fn, arg);
  }

  async evaluateHandle(fn, arg = null) {
    const page = await this.getPage();

    this.stats.evaluations++;

    return await page.evaluateHandle(fn, arg);
  }

  async bringToFront() {
    const page = await this.getPage();

    await page.bringToFront();

    return page;
  }

  async focus() {
    return this.bringToFront();
  }

  async setViewportSize(width, height) {
    const page = await this.getPage();

    await page.setViewportSize({
      width,

      height,
    });
  }

  //==================================================
  // COOKIES
  //==================================================

  async cookies() {
    await this.ensureConnected();

    return await this.context.cookies();
  }

  async clearCookies() {
    await this.ensureConnected();

    await this.context.clearCookies();
  }

  //==================================================
  // DOWNLOADS
  //==================================================

  getLastDownload() {
    return this.lastDownload;
  }

  clearDownload() {
    this.lastDownload = null;
  }

  //==================================================
  // DIALOGS
  //==================================================

  getLastDialog() {
    return this.lastDialog;
  }

  clearDialog() {
    this.lastDialog = null;
  }

  //==================================================
  // EVENT MANAGER
  //==================================================

  attachContextEvents() {
    if (!this.context) {
      return;
    }

    this.context.on("page", (page) => {
      this.stats.popups++;

      this.log("New page detected:", page.url());

      this.attachPageEvents(page);

      //--------------------------------------------------
      // Automatically switch to new page
      //--------------------------------------------------

      this.page = page;

      this.lastURL = page.url();
    });
  }

  attachEventsToAllPages() {
    if (!this.context) {
      return;
    }

    for (const page of this.context.pages()) {
      this.attachPageEvents(page);
    }
  }

  attachPageEvents(page) {
    if (!page || page.isClosed() || this.attachedPages.has(page)) {
      return;
    }

    this.attachedPages.add(page);

    //--------------------------------------------------
    // Download
    //--------------------------------------------------

    page.on("download", (download) => {
      this.lastDownload = download;

      this.stats.downloads++;

      this.log("Download started:", download.suggestedFilename());
    });

    //--------------------------------------------------
    // Dialog
    //--------------------------------------------------

    page.on("dialog", async (dialog) => {
      this.lastDialog = dialog;

      this.stats.dialogs++;

      this.log("Dialog:", dialog.type(), dialog.message());

      //--------------------------------------------------
      // Do NOT automatically accept here.
      //
      // Resolver / Planner can decide whether to
      // accept or dismiss.
      //--------------------------------------------------
    });

    //--------------------------------------------------
    // Navigation
    //--------------------------------------------------

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        this.lastURL = frame.url();

        this.log("Navigated:", this.lastURL);
      }
    });

    //--------------------------------------------------
    // Crash
    //--------------------------------------------------

    page.on("crash", () => {
      this.stats.crashes++;

      if (page === this.page) {
        this.connected = false;
      }

      this.warn("Page crashed.");
    });

    //--------------------------------------------------
    // Close
    //--------------------------------------------------

    page.on("close", () => {
      this.stats.pageCloses++;

      if (page === this.page) {
        this.page = null;

        this.connected = false;
      }

      this.warn("Page closed.");
    });
  }

  //==================================================
  // WAIT HELPERS
  //==================================================

  async wait(milliseconds = 1000) {
    await this.sleep(milliseconds);

    return {
      success: true,

      action: "wait",

      milliseconds,
    };
  }

  async waitForSelector(selector, options = {}) {
    const page = await this.getPage();

    return await page.waitForSelector(selector, options);
  }

  async waitForFunction(fn, arg = null, options = {}) {
    const page = await this.getPage();

    return await page.waitForFunction(fn, arg, options);
  }

  async waitForURL(matcher, options = {}) {
    const page = await this.getPage();

    await page.waitForURL(matcher, options);

    this.lastURL = page.url();

    return this.lastURL;
  }

  async waitForLoadState(state = "networkidle") {
    const page = await this.getPage();

    await page.waitForLoadState(state);

    return true;
  }

  //==================================================
  // SAFE EXECUTION
  //==================================================

  async safe(action, fallback = null) {
    if (typeof action !== "function") {
      throw new TypeError("safe() requires a function.");
    }

    try {
      return await action();
    } catch (err) {
      this.error("Safe execution failed:", err.message);

      return fallback;
    }
  }

  //==================================================
  // RETRY
  //==================================================

  async retry(action, retries = 3, delay = 500) {
    if (typeof action !== "function") {
      throw new TypeError("retry() requires a function.");
    }

    const attempts = Math.max(1, Number(retries) || 1);

    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await action();
      } catch (err) {
        lastError = err;

        this.stats.retries++;

        this.warn(
          `Retry ${attempt}/${attempts}:`,

          err.message,
        );

        if (attempt < attempts) {
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  //==================================================
  // INTERNAL SLEEP
  //==================================================

  async sleep(milliseconds) {
    return new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, milliseconds || 0)),
    );
  }

  //==================================================
  // STATISTICS
  //==================================================

  resetStatistics() {
    this.stats = this.createStatistics();
  }

  getStatistics() {
    return {
      ...this.stats,

      connected: this.connected,

      browser: !!this.browser,

      context: !!this.context,

      page: !!this.page && !this.page.isClosed(),

      currentURL: this.lastURL,

      pages: this.context
        ? this.context.pages().filter((page) => !page.isClosed()).length
        : 0,

      lastConnected: this.lastConnected,
    };
  }

  printStatistics() {
    console.table(this.getStatistics());
  }
}

//==========================================================
// SINGLETON EXPORT
//==========================================================
//
// IMPORTANT:
//
// Keep this as a singleton because resolver.js,
// tool-map.js and server.js can share the same
// BrowserController instance.
//
//==========================================================

export default new BrowserController();
