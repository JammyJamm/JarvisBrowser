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
    // Event Flags
    //--------------------------------------------------

    this.eventsAttached = false;

    //--------------------------------------------------
    // Statistics
    //--------------------------------------------------

    this.stats = {
      reconnects: 0,

      pageSwitches: 0,

      navigations: 0,

      downloads: 0,

      dialogs: 0,

      crashes: 0,

      healthChecks: 0,

      screenshots: 0,
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
    // Already connected
    //--------------------------------------------------

    if (!force && this.connected && this.page && !this.page.isClosed()) {
      return this.page;
    }

    //--------------------------------------------------
    // Prevent duplicate connects
    //--------------------------------------------------

    if (this.connecting && this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connecting = true;

    this.connectionPromise = this.connectInternal(force);

    try {
      const page = await this.connectionPromise;

      return page;
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
      await this.disconnect().catch(() => {});
    }

    this.log("Connecting to Electron CDP...");

    this.browser = await chromium.connectOverCDP(this.options.cdpURL);

    const contexts = this.browser.contexts();

    if (!contexts.length) {
      throw new Error("No browser contexts available.");
    }

    this.context = contexts[0];

    await this.refreshActivePage();

    this.attachEvents();

    this.connected = true;

    this.lastConnected = Date.now();

    this.log("Connected successfully.");

    return this.page;
  }
  //==================================================
  // DISCONNECT
  //==================================================

  async disconnect() {
    this.connected = false;

    this.eventsAttached = false;

    this.page = null;

    this.context = null;

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
    }

    this.browser = null;
  }

  //==================================================
  // HEALTH CHECK
  //==================================================

  async ensureConnected() {
    this.stats.healthChecks++;

    try {
      if (
        !this.browser ||
        !this.context ||
        !this.page ||
        this.page.isClosed()
      ) {
        throw new Error("Browser disconnected");
      }

      await this.page.title().catch(() => {
        throw new Error("Page unreachable");
      });

      return true;
    } catch {
      this.connected = false;

      if (!this.options.autoReconnect) return false;

      this.stats.reconnects++;

      await this.connect(true);

      return true;
    }
  }

  //==================================================
  // ACTIVE PAGE
  //==================================================

  async refreshActivePage() {
    if (!this.context) return null;

    const pages = this.context.pages();

    if (!pages.length) throw new Error("No pages found.");

    //--------------------------------------------------
    // Prefer visible page
    //--------------------------------------------------

    let active = pages.find((page) => !page.isClosed());

    if (!active) active = pages[0];

    if (this.page && this.page !== active) {
      this.stats.pageSwitches++;
    }

    this.page = active;

    this.lastURL = this.page.url();

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

    return this.page;
  }

  async getPages() {
    await this.ensureConnected();

    return this.context.pages();
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
      .waitForLoadState(this.options.waitUntil, { timeout })
      .catch(() => {});

    this.stats.navigations++;

    this.lastURL = page.url();

    return page;
  }

  async reload() {
    const page = await this.getPage();

    await page.reload({
      waitUntil: this.options.waitUntil,
    });

    this.stats.navigations++;

    this.lastURL = page.url();

    return page;
  }

  async goto(url, options = {}) {
    const page = await this.getPage();

    await page.goto(url, {
      waitUntil: this.options.waitUntil,

      ...options,
    });

    this.stats.navigations++;

    this.lastURL = page.url();

    return page;
  }
  //==================================================
  // HTML / URL
  //==================================================

  async html() {
    const page = await this.getPage();

    return await page.content();
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
  // SCREENSHOTS
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

  attachEvents() {
    if (this.eventsAttached || !this.page) {
      return;
    }

    this.eventsAttached = true;

    //--------------------------------------------------
    // Download
    //--------------------------------------------------

    this.page.on("download", (download) => {
      this.lastDownload = download;

      this.stats.downloads++;

      this.log("Download started:", download.suggestedFilename());
    });

    //--------------------------------------------------
    // Dialog
    //--------------------------------------------------

    this.page.on("dialog", async (dialog) => {
      this.lastDialog = dialog;

      this.stats.dialogs++;

      this.log("Dialog:", dialog.type(), dialog.message());

      try {
        await dialog.accept();
      } catch {}
    });

    //--------------------------------------------------
    // Navigation
    //--------------------------------------------------

    this.page.on("framenavigated", (frame) => {
      if (frame === this.page.mainFrame()) {
        this.lastURL = frame.url();

        this.stats.navigations++;

        this.log("Navigated:", this.lastURL);
      }
    });

    //--------------------------------------------------
    // Crash
    //--------------------------------------------------

    this.page.on("crash", () => {
      this.stats.crashes++;

      this.connected = false;

      this.warn("Page crashed.");
    });

    //--------------------------------------------------
    // Close
    //--------------------------------------------------

    this.page.on("close", () => {
      this.connected = false;

      this.warn("Page closed.");
    });

    //--------------------------------------------------
    // Popup
    //--------------------------------------------------

    this.page.on("popup", (popup) => {
      this.log("Popup detected:", popup.url());
    });
  }

  //==================================================
  // WAIT HELPERS
  //==================================================

  async wait(milliseconds) {
    const page = await this.getPage();

    await page.waitForTimeout(milliseconds);
  }

  async waitForSelector(selector, options = {}) {
    const page = await this.getPage();

    return await page.waitForSelector(selector, options);
  }

  async waitForFunction(fn, arg, options = {}) {
    const page = await this.getPage();

    return await page.waitForFunction(fn, arg, options);
  }

  //==================================================
  // PART 4
  // Browser utilities
  // Frame helpers
  // Tab manager
  // Safe execution
  // Statistics
  //==================================================
  //==================================================
  // TAB MANAGEMENT
  //==================================================

  async newTab(url = "about:blank") {
    await this.ensureConnected();

    const page = await this.context.newPage();

    if (url && url !== "about:blank") {
      await page.goto(url, {
        waitUntil: this.options.waitUntil,
      });
    }

    this.page = page;

    this.lastURL = page.url();

    this.eventsAttached = false;

    this.attachEvents();

    this.stats.pageSwitches++;

    return page;
  }

  async switchToPage(index = 0) {
    await this.ensureConnected();

    const pages = this.context.pages();

    if (index < 0 || index >= pages.length) {
      throw new Error(`Invalid page index ${index}`);
    }

    this.page = pages[index];

    this.eventsAttached = false;

    this.attachEvents();

    this.lastURL = this.page.url();

    this.stats.pageSwitches++;

    return this.page;
  }

  async switchToLastPage() {
    await this.ensureConnected();

    const pages = this.context.pages();

    return this.switchToPage(pages.length - 1);
  }

  async closeCurrentPage() {
    const page = await this.getPage();

    await page.close().catch(() => {});

    await this.refreshActivePage();
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

      const frame = frames.find(predicate);

      if (frame) return frame;

      await this.wait(200);
    }

    throw new Error("Frame not found.");
  }

  //==================================================
  // BROWSER UTILITIES
  //==================================================

  async evaluate(fn, arg) {
    const page = await this.getPage();

    return await page.evaluate(fn, arg);
  }

  async evaluateHandle(fn, arg) {
    const page = await this.getPage();

    return await page.evaluateHandle(fn, arg);
  }

  async bringToFront() {
    const page = await this.getPage();

    await page.bringToFront();
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

  async cookies() {
    await this.ensureConnected();

    return await this.context.cookies();
  }

  async clearCookies() {
    await this.ensureConnected();

    await this.context.clearCookies();
  }

  //==================================================
  // SAFE EXECUTION
  //==================================================

  async safe(action) {
    try {
      return await action();
    } catch (err) {
      this.error(err);

      return null;
    }
  }

  async retry(action, retries = 3) {
    let lastError;

    for (let i = 0; i < retries; i++) {
      try {
        return await action();
      } catch (err) {
        lastError = err;

        await this.wait(500);
      }
    }

    throw lastError;
  }

  //==================================================
  // STATISTICS
  //==================================================

  resetStatistics() {
    this.stats = {
      reconnects: 0,

      pageSwitches: 0,

      navigations: 0,

      downloads: 0,

      dialogs: 0,

      crashes: 0,

      healthChecks: 0,

      screenshots: 0,
    };
  }

  getStatistics() {
    return {
      ...this.stats,

      connected: this.connected,

      browser: !!this.browser,

      context: !!this.context,

      page: !!this.page,

      currentURL: this.lastURL,

      pages: this.context ? this.context.pages().length : 0,

      lastConnected: this.lastConnected,
    };
  }

  printStatistics() {
    console.table(this.getStatistics());
  }
}

export default new BrowserController();
