//==========================================================
//
// backend/browser-controller.js
//
// Browser Controller
//
// IMPORTANT ARCHITECTURE
//
// Electron
//      │
//      ├── WebView  ← REAL USER BROWSER
//      │
//      └── CDP :9222
//              │
//              ▼
//       BrowserController
//              │
//              ▼
//        Playwright
//
// Navigation MUST happen through Electron WebView.
//
// Playwright/CDP is used for:
//   - DOM
//   - click
//   - type
//   - frames
//   - inspection
//   - automation
//
//==========================================================

import { chromium } from "playwright";

class BrowserController {
  constructor(options = {}) {
    //--------------------------------------------------
    // CONFIGURATION
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

      //------------------------------------------------
      // IMPORTANT
      //
      // Navigation is handled by Electron WebView.
      //------------------------------------------------

      useElectronNavigation: true,

      ...options,
    };

    //--------------------------------------------------
    // PLAYWRIGHT
    //--------------------------------------------------

    this.browser = null;

    this.context = null;

    this.page = null;

    //--------------------------------------------------
    // STATE
    //--------------------------------------------------

    this.connected = false;

    this.connecting = false;

    this.connectionPromise = null;

    this.lastConnected = 0;

    this.lastURL = "";

    //--------------------------------------------------
    // ELECTRON BRIDGE
    //--------------------------------------------------

    this.navigationHandler = null;

    this.navigationState = {
      pending: false,

      requestedURL: null,

      startedAt: 0,

      completedAt: 0,
    };

    //--------------------------------------------------
    // DOWNLOAD / DIALOG
    //--------------------------------------------------

    this.lastDownload = null;

    this.lastDialog = null;

    //--------------------------------------------------
    // EVENTS
    //--------------------------------------------------

    this.attachedPages = new WeakSet();

    this.contextEventsAttached = false;

    //--------------------------------------------------
    // STATS
    //--------------------------------------------------

    this.stats = this.createStatistics();
  }

  //==================================================
  // STATISTICS
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
  // LOG
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
  // ELECTRON NAVIGATION BRIDGE
  //==================================================
  //
  // Electron main process should register:
  //
  // browserController.setNavigationHandler(
  //   async (url) => {
  //      ...
  //   }
  // );
  //
  //==================================================

  setNavigationHandler(handler) {
    if (handler !== null && typeof handler !== "function") {
      throw new TypeError("Navigation handler must be a function or null.");
    }

    this.navigationHandler = handler;

    this.log(
      "Electron navigation handler:",
      handler ? "REGISTERED" : "CLEARED",
    );
  }

  hasNavigationHandler() {
    return typeof this.navigationHandler === "function";
  }

  //==================================================
  // CONNECTION
  //==================================================

  async connect(force = false) {
    //--------------------------------------------------
    // Already healthy
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
    // Prevent duplicate connect
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
    // CONNECT TO CDP
    //--------------------------------------------------

    this.browser = await chromium.connectOverCDP(this.options.cdpURL);

    //--------------------------------------------------
    // CONTEXT
    //--------------------------------------------------

    const contexts = this.browser.contexts();

    if (!contexts.length) {
      throw new Error("No browser contexts available.");
    }

    this.context = contexts[0];

    //--------------------------------------------------
    // PAGE
    //--------------------------------------------------

    await this.refreshActivePage();

    //--------------------------------------------------
    // EVENTS
    //--------------------------------------------------

    this.attachEventsToAllPages();

    this.attachContextEvents();

    //--------------------------------------------------
    // STATE
    //--------------------------------------------------

    this.connected = true;

    this.lastConnected = Date.now();

    this.log("Playwright attached successfully.");

    this.log("Current URL:", this.lastURL);

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
    // NEVER browser.close() here.
    //
    // CDP is attached to Electron.
    // Closing the Playwright browser object can
    // interfere with the Electron browser lifecycle.
    //--------------------------------------------------

    this.browser = null;

    this.attachedPages = new WeakSet();

    this.contextEventsAttached = false;

    this.lastURL = "";
  }

  //==================================================
  // ENSURE CONNECTION
  //==================================================

  async ensureConnected() {
    this.stats.healthChecks++;

    //--------------------------------------------------
    // FAST PATH
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
        this.warn("Current Playwright page is unreachable.");

        this.connected = false;
      }
    }

    //--------------------------------------------------
    // NO AUTO RECONNECT
    //--------------------------------------------------

    if (!this.options.autoReconnect) {
      throw new Error("Browser is disconnected.");
    }

    //--------------------------------------------------
    // RECONNECT
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
      throw new Error("No Playwright pages found.");
    }

    //--------------------------------------------------
    // KEEP CURRENT PAGE
    //--------------------------------------------------

    if (this.page && !this.page.isClosed() && pages.includes(this.page)) {
      this.lastURL = this.page.url();

      return this.page;
    }

    //--------------------------------------------------
    // SELECT LAST PAGE
    //--------------------------------------------------

    const active = pages[pages.length - 1];

    if (this.page && this.page !== active) {
      this.stats.pageSwitches++;
    }

    this.page = active;

    this.lastURL = this.page.url();

    this.log("Active Playwright page:", this.lastURL);

    return this.page;
  }

  //==================================================
  // GET PAGE
  //==================================================

  async getPage() {
    await this.ensureConnected();

    await this.refreshActivePage();

    return this.page;
  }

  //==================================================
  // GET BROWSER
  //==================================================

  async getBrowser() {
    await this.ensureConnected();

    return this.browser;
  }

  //==================================================
  // GET CONTEXT
  //==================================================

  async getContext() {
    await this.ensureConnected();

    return this.context;
  }

  //==================================================
  // GET PAGES
  //==================================================

  async getPages() {
    await this.ensureConnected();

    return this.context.pages().filter((page) => !page.isClosed());
  }

  //==================================================
  // NAVIGATION
  //==================================================
  //
  // THIS IS THE MOST IMPORTANT CHANGE.
  //
  // DO NOT:
  //
  // await page.goto(url)
  //
  // when Electron WebView is the real browser UI.
  //
  // Instead:
  //
  // BrowserController
  //       ↓
  // Electron navigation handler
  //       ↓
  // WebView
  //
  //==================================================

  async goto(url, options = {}) {
    if (!url) {
      throw new Error("URL is required.");
    }

    const targetURL = String(url);

    await this.getPage();

    const previousURL = this.lastURL;

    //--------------------------------------------------
    // ELECTRON WEBVIEW NAVIGATION
    //--------------------------------------------------

    if (this.options.useElectronNavigation && this.hasNavigationHandler()) {
      this.log("Navigating Electron WebView:", targetURL);

      this.navigationState = {
        pending: true,

        requestedURL: targetURL,

        startedAt: Date.now(),

        completedAt: 0,
      };

      try {
        await this.navigationHandler(targetURL, options);

        //------------------------------------------------
        // Wait for Playwright/CDP to observe navigation
        //------------------------------------------------

        const timeout = options.timeout ?? this.options.navigationTimeout;

        await this.waitForURLChange(targetURL, timeout);

        this.stats.navigations++;

        this.lastURL = this.page.url();

        this.navigationState.pending = false;

        this.navigationState.completedAt = Date.now();

        this.log("WebView navigation completed:", this.lastURL);

        return this.page;
      } catch (err) {
        this.navigationState.pending = false;

        this.warn("Electron WebView navigation failed:", err.message);

        throw err;
      }
    }

    //--------------------------------------------------
    // FALLBACK
    //--------------------------------------------------
    //
    // This should NOT be used when the WebView is
    // available.
    //
    //--------------------------------------------------

    this.warn("Electron navigation handler is not registered.");

    this.warn("Falling back to Playwright page.goto().");

    const page = await this.getPage();

    await page.goto(targetURL, {
      waitUntil: options.waitUntil ?? this.options.waitUntil,

      timeout: options.timeout ?? this.options.navigationTimeout,

      ...options,
    });

    this.lastURL = page.url();

    if (previousURL !== this.lastURL) {
      this.stats.navigations++;
    }

    return page;
  }

  //==================================================
  // WAIT FOR URL
  //==================================================

  async waitForURLChange(targetURL, timeout = 60000) {
    const started = Date.now();

    while (Date.now() - started < timeout) {
      if (this.page && !this.page.isClosed()) {
        const currentURL = this.page.url();

        this.lastURL = currentURL;

        //------------------------------------------------
        // Exact
        //------------------------------------------------

        if (currentURL === targetURL) {
          return currentURL;
        }

        //------------------------------------------------
        // URL may normalize
        //------------------------------------------------

        try {
          const requested = new URL(targetURL);

          const current = new URL(currentURL);

          if (
            requested.origin === current.origin &&
            requested.pathname === current.pathname &&
            requested.search === current.search
          ) {
            return currentURL;
          }
        } catch {
          // Ignore invalid URL parsing
        }
      }

      await this.sleep(100);
    }

    //--------------------------------------------------
    // IMPORTANT
    //
    // Some SPA navigation doesn't change URL.
    //
    //--------------------------------------------------

    if (this.page && !this.page.isClosed()) {
      const currentURL = this.page.url();

      if (currentURL !== "about:blank") {
        this.lastURL = currentURL;

        return currentURL;
      }
    }

    throw new Error(`Navigation timeout waiting for '${targetURL}'.`);
  }

  //==================================================
  // RELOAD
  //==================================================

  async reload(options = {}) {
    const page = await this.getPage();

    //--------------------------------------------------
    // Reload is also controlled by WebView.
    //
    // If Electron exposes a reload handler, use it.
    //--------------------------------------------------

    if (this.options.useElectronNavigation && this.navigationHandler) {
      const currentURL = page.url();

      await this.navigationHandler(currentURL, {
        ...options,

        reload: true,
      });

      await this.waitForURLChange(
        currentURL,
        options.timeout ?? this.options.navigationTimeout,
      );

      return page;
    }

    //--------------------------------------------------
    // FALLBACK
    //--------------------------------------------------

    await page.reload({
      waitUntil: options.waitUntil ?? this.options.waitUntil,

      timeout: options.timeout ?? this.options.navigationTimeout,

      ...options,
    });

    this.lastURL = page.url();

    return page;
  }

  //==================================================
  // URL
  //==================================================

  async url() {
    const page = await this.getPage();

    this.lastURL = page.url();

    return this.lastURL;
  }

  //==================================================
  // HTML
  //==================================================

  async html() {
    const page = await this.getPage();

    return page.content();
  }

  //==================================================
  // TEXT
  //==================================================

  async text() {
    const page = await this.getPage();

    return page.evaluate(() => document.body?.innerText || "");
  }

  //==================================================
  // TITLE
  //==================================================

  async title() {
    const page = await this.getPage();

    return page.title();
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
  // NEW TAB
  //==================================================

  async newTab(url = "about:blank") {
    await this.ensureConnected();

    //--------------------------------------------------
    // New tabs should eventually be created by
    // Electron's WebView/tab manager.
    //
    // For now this remains Playwright fallback.
    //--------------------------------------------------

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

  //==================================================
  // SWITCH PAGE
  //==================================================

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

  //==================================================
  // FRAMES
  //==================================================

  async getFrames() {
    const page = await this.getPage();

    return page.frames();
  }

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

    return frame.evaluate(fn, arg);
  }

  //==================================================
  // EVALUATE
  //==================================================

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

  //==================================================
  // BRING TO FRONT
  //==================================================

  async bringToFront() {
    const page = await this.getPage();

    await page.bringToFront();

    return page;
  }

  async focus() {
    return this.bringToFront();
  }

  //==================================================
  // COOKIES
  //==================================================

  async cookies() {
    await this.ensureConnected();

    return this.context.cookies();
  }

  async clearCookies() {
    await this.ensureConnected();

    await this.context.clearCookies();
  }

  //==================================================
  // DOWNLOAD
  //==================================================

  getLastDownload() {
    return this.lastDownload;
  }

  clearDownload() {
    this.lastDownload = null;
  }

  //==================================================
  // DIALOG
  //==================================================

  getLastDialog() {
    return this.lastDialog;
  }

  clearDialog() {
    this.lastDialog = null;
  }

  //==================================================
  // CONTEXT EVENTS
  //==================================================

  attachContextEvents() {
    if (!this.context || this.contextEventsAttached) {
      return;
    }

    this.contextEventsAttached = true;

    this.context.on("page", (page) => {
      this.stats.popups++;

      this.log("New Playwright page:", page.url());

      this.attachPageEvents(page);

      //------------------------------------------------
      // DO NOT blindly make every new page active.
      //
      // Only select it if the current page is dead.
      //------------------------------------------------

      if (!this.page || this.page.isClosed()) {
        this.page = page;

        this.lastURL = page.url();
      }
    });
  }

  //==================================================
  // PAGE EVENTS
  //==================================================

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
    // DOWNLOAD
    //--------------------------------------------------

    page.on("download", (download) => {
      this.lastDownload = download;

      this.stats.downloads++;

      this.log("Download:", download.suggestedFilename());
    });

    //--------------------------------------------------
    // DIALOG
    //--------------------------------------------------

    page.on("dialog", async (dialog) => {
      this.lastDialog = dialog;

      this.stats.dialogs++;

      this.log("Dialog:", dialog.type(), dialog.message());
    });

    //--------------------------------------------------
    // NAVIGATION OBSERVER
    //--------------------------------------------------

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        this.lastURL = frame.url();

        this.log("Playwright observed WebView navigation:", this.lastURL);

        //------------------------------------------------
        // Complete pending Electron navigation
        //------------------------------------------------

        if (this.navigationState.pending) {
          this.navigationState.completedAt = Date.now();
        }
      }
    });

    //--------------------------------------------------
    // CRASH
    //--------------------------------------------------

    page.on("crash", () => {
      this.stats.crashes++;

      if (page === this.page) {
        this.connected = false;

        this.page = null;
      }

      this.warn("Playwright page crashed.");
    });

    //--------------------------------------------------
    // CLOSE
    //--------------------------------------------------

    page.on("close", () => {
      this.stats.pageCloses++;

      this.warn("Playwright page closed.");

      if (page === this.page) {
        this.page = null;

        this.connected = false;
      }
    });
  }

  //==================================================
  // WAIT
  //==================================================

  async wait(milliseconds = 1000) {
    await this.sleep(milliseconds);

    return {
      success: true,

      action: "wait",

      milliseconds,
    };
  }

  //==================================================
  // WAIT SELECTOR
  //==================================================

  async waitForSelector(selector, options = {}) {
    const page = await this.getPage();

    return page.waitForSelector(selector, options);
  }

  //==================================================
  // WAIT FUNCTION
  //==================================================

  async waitForFunction(fn, arg = null, options = {}) {
    const page = await this.getPage();

    return page.waitForFunction(fn, arg, options);
  }

  //==================================================
  // WAIT URL
  //==================================================

  async waitForURL(matcher, options = {}) {
    const page = await this.getPage();

    await page.waitForURL(matcher, options);

    this.lastURL = page.url();

    return this.lastURL;
  }

  //==================================================
  // WAIT LOAD STATE
  //==================================================

  async waitForLoadState(state = "networkidle") {
    const page = await this.getPage();

    await page.waitForLoadState(state);

    return true;
  }

  //==================================================
  // SAFE
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

        this.warn(`Retry ${attempt}/${attempts}:`, err.message);

        if (attempt < attempts) {
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  //==================================================
  // SLEEP
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

      navigationPending: this.navigationState.pending,

      requestedURL: this.navigationState.requestedURL,
    };
  }

  printStatistics() {
    console.table(this.getStatistics());
  }
}

//==========================================================
// SINGLETON
//==========================================================

export default new BrowserController();
