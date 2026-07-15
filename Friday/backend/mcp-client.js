//==========================================================
//
// backend/mcp-client.js
//
// Ultra Intelligent Playwright MCP Client
//
// Architecture
//
// Electron
//      │
// Chromium CDP
//      │
// PlaywrightClient
//      │
// Resolver / Planner / BrowserController
//
// Features
// --------
// ✔ Automatic CDP reconnect
// ✔ BrowserView detection
// ✔ Health monitoring
// ✔ Multi-tab support
// ✔ Frame utilities
// ✔ Snapshot utilities
// ✔ Download manager
// ✔ Dialog manager
// ✔ Statistics
// ✔ Safe execution
//
//==========================================================

import { chromium } from "playwright";

export default class PlaywrightClient {
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

      browserViewOnly: true,

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

    this.lastURL = "";

    this.lastSnapshot = null;

    //--------------------------------------------------
    // Downloads / Dialogs
    //--------------------------------------------------

    this.lastDownload = null;

    this.lastDialog = null;

    //--------------------------------------------------
    // Event State
    //--------------------------------------------------

    this.eventsAttached = false;

    //--------------------------------------------------
    // Statistics
    //--------------------------------------------------

    this.stats = {
      connects: 0,

      reconnects: 0,

      healthChecks: 0,

      pageSwitches: 0,

      navigations: 0,

      clicks: 0,

      types: 0,

      snapshots: 0,

      htmlRequests: 0,

      downloads: 0,

      dialogs: 0,
    };
  }

  //==================================================
  // LOGGING
  //==================================================

  log(...args) {
    if (this.options.debug) {
      console.log("[PlaywrightClient]", ...args);
    }
  }

  warn(...args) {
    console.warn("[PlaywrightClient]", ...args);
  }

  error(...args) {
    console.error("[PlaywrightClient]", ...args);
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

    this.stats.connects++;

    this.log("Connected:", this.page.url());

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
      if (!this.page || this.page.isClosed()) {
        throw new Error("Page unavailable");
      }

      await this.page.title();

      return this.page;
    } catch {
      this.connected = false;

      if (!this.options.autoReconnect) {
        throw new Error("Browser disconnected.");
      }

      this.stats.reconnects++;

      return await this.connect(true);
    }
  }

  //==================================================
  // PART 2
  // Browser Discovery
  // Active Page Detection
  // BrowserView Selection
  // Page Getters
  //==================================================

  //==================================================
  // ACTIVE PAGE DISCOVERY
  //==================================================

  async refreshActivePage() {
    if (!this.context) {
      throw new Error("Browser context not available.");
    }

    const pages = this.context.pages();

    if (!pages.length) {
      throw new Error("No pages found.");
    }

    //--------------------------------------------------
    // Prefer BrowserView HTTP pages
    //--------------------------------------------------

    let candidate = null;

    for (const page of pages) {
      if (page.isClosed()) continue;

      const url = page.url();

      if (
        this.options.browserViewOnly &&
        (url.startsWith("file://") ||
          url.includes("renderer") ||
          url.includes("localhost"))
      ) {
        continue;
      }

      candidate = page;
      break;
    }

    //--------------------------------------------------
    // Fallback
    //--------------------------------------------------

    if (!candidate) {
      candidate = pages.find((page) => !page.isClosed()) || pages[0];
    }

    //--------------------------------------------------
    // Page switched
    //--------------------------------------------------

    if (this.page && this.page !== candidate) {
      this.stats.pageSwitches++;
    }

    this.page = candidate;

    this.lastURL = this.page.url();

    this.log("Active page:", this.lastURL);

    return this.page;
  }

  //==================================================
  // PAGE DISCOVERY
  //==================================================

  async getRealBrowserPage() {
    await this.ensureConnected();

    const pages = this.context.pages();

    for (const page of pages) {
      const url = page.url();

      if (
        url.startsWith("http") &&
        !url.includes("localhost") &&
        !url.includes("renderer") &&
        !url.startsWith("file://")
      ) {
        this.page = page;

        this.lastURL = url;

        return page;
      }
    }

    throw new Error("No browser page found.");
  }

  async getPage() {
    await this.ensureConnected();

    await this.refreshActivePage();

    return this.page;
  }

  async getBrowser() {
    await this.ensureConnected();

    return this.browser;
  }

  async getContext() {
    await this.ensureConnected();

    return this.context;
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
      .waitForLoadState(this.options.waitUntil, {
        timeout,
      })
      .catch(() => {});

    this.stats.navigations++;

    this.lastURL = page.url();

    return page;
  }

  async reload(options = {}) {
    const page = await this.getPage();

    await page.reload({
      waitUntil: this.options.waitUntil,

      ...options,
    });

    this.stats.navigations++;

    this.lastURL = page.url();

    return page;
  }

  async goto(url, options = {}) {
    const page = await this.getPage();

    await page.goto(url, {
      waitUntil: this.options.waitUntil,

      timeout: 60000,

      ...options,
    });

    this.stats.navigations++;

    this.lastURL = page.url();

    return {
      success: true,

      action: "navigate",

      url,
    };
  }

  //==================================================
  // PART 3
  // HTML
  // Snapshot
  // DOM Utilities
  // Page Inspection
  //==================================================

  //==================================================
  // HTML
  //==================================================

  async html() {
    const page = await this.getPage();

    this.stats.htmlRequests++;

    return await page.content();
  }

  async text() {
    const page = await this.getPage();

    return await page.evaluate(() => document.body?.innerText || "");
  }

  async title() {
    const page = await this.getPage();

    return await page.title();
  }

  async url() {
    const page = await this.getPage();

    this.lastURL = page.url();

    return this.lastURL;
  }

  //==================================================
  // SNAPSHOT
  //==================================================

  async snapshot() {
    const page = await this.getPage();

    const snapshot = {
      html: await page.content(),

      text: await page.evaluate(() => document.body?.innerText || ""),

      title: await page.title(),

      url: page.url(),

      timestamp: Date.now(),
    };

    this.lastSnapshot = snapshot;

    this.stats.snapshots++;

    return snapshot;
  }

  getLastSnapshot() {
    return this.lastSnapshot;
  }

  clearSnapshot() {
    this.lastSnapshot = null;
  }

  //==================================================
  // DOM UTILITIES
  //==================================================

  async evaluate(fn, arg = null) {
    const page = await this.getPage();

    return await page.evaluate(fn, arg);
  }

  async evaluateHandle(fn, arg = null) {
    const page = await this.getPage();

    return await page.evaluateHandle(fn, arg);
  }

  async locator(selector) {
    const page = await this.getPage();

    return page.locator(selector);
  }

  async query(selector) {
    const page = await this.getPage();

    return await page.$(selector);
  }

  async queryAll(selector) {
    const page = await this.getPage();

    return await page.$$(selector);
  }

  async elementExists(selector) {
    const page = await this.getPage();

    return (await page.locator(selector).count()) > 0;
  }

  async elementCount(selector) {
    const page = await this.getPage();

    return await page.locator(selector).count();
  }

  //==================================================
  // PAGE INSPECTION
  //==================================================

  async inspectPage() {
    const page = await this.getPage();

    return {
      url: page.url(),

      title: await page.title(),

      frames: page.frames().length,

      viewport: page.viewportSize(),

      isClosed: page.isClosed(),

      readyState: await page.evaluate(() => document.readyState),
    };
  }

  async getCookies() {
    const context = await this.getContext();

    return await context.cookies();
  }

  async getStorageState() {
    const context = await this.getContext();

    return await context.storageState();
  }

  async getViewport() {
    const page = await this.getPage();

    return page.viewportSize();
  }

  //==================================================
  // PART 4
  // Click
  // Type
  // Hover
  // Select
  // Keyboard
  // Mouse
  //==================================================

  //==================================================
  // CLICK
  //==================================================

  async click(selector, options = {}) {
    const page = await this.getPage();

    await page.locator(selector).first().click(options);

    this.stats.clicks++;

    return {
      success: true,

      action: "click",

      selector,
    };
  }

  async clickByText(text, options = {}) {
    const page = await this.getPage();

    this.log("Click by text:", text);

    await page
      .getByText(text, {
        exact: false,
      })
      .first()
      .click(options);

    this.stats.clicks++;

    return {
      success: true,

      action: "click",

      text,
    };
  }

  async clickByRole(role, name, options = {}) {
    const page = await this.getPage();

    await page
      .getByRole(role, {
        name,

        exact: false,
      })
      .click(options);

    this.stats.clicks++;

    return {
      success: true,

      action: "click",

      role,

      name,
    };
  }

  async doubleClick(selector, options = {}) {
    const page = await this.getPage();

    await page.locator(selector).first().dblclick(options);

    this.stats.clicks++;

    return {
      success: true,

      action: "doubleClick",

      selector,
    };
  }

  async rightClick(selector, options = {}) {
    const page = await this.getPage();

    await page
      .locator(selector)
      .first()
      .click({
        button: "right",

        ...options,
      });

    this.stats.clicks++;

    return {
      success: true,

      action: "rightClick",

      selector,
    };
  }

  //==================================================
  // TYPE
  //==================================================

  async type(selector, value, options = {}) {
    const page = await this.getPage();

    const locator = page.locator(selector).first();

    await locator.waitFor({
      state: "visible",

      timeout: 10000,
    });

    await locator.fill("");

    await locator.fill(String(value), options);

    this.stats.types++;

    return {
      success: true,

      action: "type",

      selector,

      value,
    };
  }

  async typeByLabel(label, value, options = {}) {
    const page = await this.getPage();

    const locator = page
      .getByLabel(label, {
        exact: false,
      })
      .first();

    await locator.fill("");

    await locator.fill(String(value), options);

    this.stats.types++;

    return {
      success: true,

      action: "type",

      label,

      value,
    };
  }

  async clear(selector) {
    const page = await this.getPage();

    await page.locator(selector).first().fill("");

    return {
      success: true,

      action: "clear",

      selector,
    };
  }

  async appendText(selector, value) {
    const page = await this.getPage();

    const locator = page.locator(selector).first();

    await locator.focus();

    await page.keyboard.type(String(value));

    this.stats.types++;

    return {
      success: true,

      action: "append",

      selector,

      value,
    };
  }

  //==================================================
  // HOVER
  //==================================================

  async hover(selector, options = {}) {
    const page = await this.getPage();

    await page.locator(selector).first().hover(options);

    return {
      success: true,

      action: "hover",

      selector,
    };
  }

  async hoverByText(text, options = {}) {
    const page = await this.getPage();

    await page
      .getByText(text, {
        exact: false,
      })
      .first()
      .hover(options);

    return {
      success: true,

      action: "hover",

      text,
    };
  }

  //==================================================
  // SELECT
  //==================================================

  async selectOption(selector, value) {
    const page = await this.getPage();

    await page.locator(selector).first().selectOption(value);

    return {
      success: true,

      action: "select",

      selector,

      value,
    };
  }

  //==================================================
  // KEYBOARD
  //==================================================

  async press(key) {
    const page = await this.getPage();

    await page.keyboard.press(key);

    return {
      success: true,

      action: "press",

      key,
    };
  }

  async typeKeys(text) {
    const page = await this.getPage();

    await page.keyboard.type(String(text));

    return {
      success: true,

      action: "keyboard.type",

      text,
    };
  }

  async shortcut(...keys) {
    const page = await this.getPage();

    const combo = keys.join("+");

    await page.keyboard.press(combo);

    return {
      success: true,

      action: "shortcut",

      keys,
    };
  }

  //==================================================
  // MOUSE
  //==================================================

  async mouseMove(x, y) {
    const page = await this.getPage();

    await page.mouse.move(x, y);

    return {
      success: true,

      action: "mouse.move",

      x,

      y,
    };
  }

  async mouseClick(x, y, options = {}) {
    const page = await this.getPage();

    await page.mouse.click(x, y, options);

    this.stats.clicks++;

    return {
      success: true,

      action: "mouse.click",

      x,

      y,
    };
  }

  async mouseWheel(deltaX = 0, deltaY = 800) {
    const page = await this.getPage();

    await page.mouse.wheel(deltaX, deltaY);

    return {
      success: true,

      action: "mouse.wheel",

      deltaX,

      deltaY,
    };
  }

  //==================================================
  // PART 5
  // Frame Helpers
  // Downloads
  // Dialogs
  // Wait Helpers
  //==================================================

  //==================================================
  // FRAME HELPERS
  //==================================================

  async getMainFrame() {
    const page = await this.getPage();

    return page.mainFrame();
  }

  async getFrames() {
    const page = await this.getPage();

    return page.frames();
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

      if (found) return found;

      await this.wait(250);
    }

    throw new Error("Frame not found.");
  }

  async evaluateInFrame(frame, fn, arg = null) {
    if (!frame) throw new Error("Frame is required.");

    return await frame.evaluate(fn, arg);
  }

  async locatorInFrame(frame, selector) {
    if (!frame) throw new Error("Frame is required.");

    return frame.locator(selector);
  }

  async clickInFrame(frame, selector, options = {}) {
    if (!frame) throw new Error("Frame is required.");

    await frame.locator(selector).first().click(options);

    this.stats.clicks++;

    return {
      success: true,

      action: "frame.click",

      selector,
    };
  }

  async typeInFrame(frame, selector, value) {
    if (!frame) throw new Error("Frame is required.");

    const locator = frame.locator(selector).first();

    await locator.fill("");

    await locator.fill(String(value));

    this.stats.types++;

    return {
      success: true,

      action: "frame.type",

      selector,

      value,
    };
  }

  //==================================================
  // DOWNLOAD MANAGER
  //==================================================

  getLastDownload() {
    return this.lastDownload;
  }

  clearDownload() {
    this.lastDownload = null;
  }

  async waitForDownload(timeout = 30000) {
    const started = Date.now();

    while (Date.now() - started < timeout) {
      if (this.lastDownload) {
        return this.lastDownload;
      }

      await this.wait(200);
    }

    throw new Error("Download timeout.");
  }

  async saveLastDownload(path) {
    if (!this.lastDownload) {
      throw new Error("No download available.");
    }

    await this.lastDownload.saveAs(path);

    return {
      success: true,

      action: "download.save",

      path,
    };
  }

  //==================================================
  // DIALOG MANAGER
  //==================================================

  getLastDialog() {
    return this.lastDialog;
  }

  clearDialog() {
    this.lastDialog = null;
  }

  async waitForDialog(timeout = 10000) {
    const started = Date.now();

    while (Date.now() - started < timeout) {
      if (this.lastDialog) {
        return this.lastDialog;
      }

      await this.wait(200);
    }

    throw new Error("Dialog timeout.");
  }

  async acceptDialog(promptText = undefined) {
    if (!this.lastDialog) {
      throw new Error("No active dialog.");
    }

    await this.lastDialog.accept(promptText);

    this.lastDialog = null;

    return {
      success: true,

      action: "dialog.accept",
    };
  }

  async dismissDialog() {
    if (!this.lastDialog) {
      throw new Error("No active dialog.");
    }

    await this.lastDialog.dismiss();

    this.lastDialog = null;

    return {
      success: true,

      action: "dialog.dismiss",
    };
  }

  //==================================================
  // WAIT HELPERS
  //==================================================

  async wait(milliseconds = 1000) {
    const page = await this.getPage();

    await page.waitForTimeout(milliseconds);

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
  // PART 6
  // Event Manager
  // Safe Execution
  // Debug Helpers
  // Statistics
  // Export Helpers
  //==================================================

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

      this.log("Download:", download.suggestedFilename());
    });

    //--------------------------------------------------
    // Dialog
    //--------------------------------------------------

    this.page.on("dialog", async (dialog) => {
      this.lastDialog = dialog;

      this.stats.dialogs++;

      this.log(dialog.type(), dialog.message());

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
      }
    });

    //--------------------------------------------------
    // Popup
    //--------------------------------------------------

    this.page.on("popup", (popup) => {
      this.log("Popup:", popup.url());
    });

    //--------------------------------------------------
    // Crash
    //--------------------------------------------------

    this.page.on("crash", () => {
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
  }

  //==================================================
  // SAFE EXECUTION
  //==================================================

  async safeExecute(executor, fallback = null) {
    try {
      return await executor();
    } catch (err) {
      this.error(err);

      if (fallback) {
        try {
          return await fallback(err);
        } catch (fallbackErr) {
          this.error(fallbackErr);
        }
      }

      return {
        success: false,

        error: err.message,

        stack: this.options.debug ? err.stack : undefined,
      };
    }
  }

  async retry(executor, retries = 3, delay = 500) {
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await executor(attempt);
      } catch (err) {
        lastError = err;

        this.warn(`Retry ${attempt}/${retries}:`, err.message);

        if (attempt < retries) {
          await this.wait(delay * attempt);
        }
      }
    }

    throw lastError;
  }

  //==================================================
  // DEBUG HELPERS
  //==================================================

  async debugPages() {
    const pages = await this.getPages();

    console.log("\n========== PLAYWRIGHT PAGES ==========");

    for (const page of pages) {
      console.log({
        url: page.url(),

        title: await page.title().catch(() => ""),

        closed: page.isClosed(),
      });
    }

    console.log("======================================\n");
  }

  async debugFrames() {
    const frames = await this.getFrames();

    console.log("\n========== FRAMES ==========");

    frames.forEach((frame, index) => {
      console.log({
        index,

        name: frame.name(),

        url: frame.url(),
      });
    });

    console.log("============================\n");
  }

  async debugSnapshot() {
    const snapshot = await this.snapshot();

    console.log({
      url: snapshot.url,

      title: snapshot.title,

      textLength: snapshot.text.length,

      htmlLength: snapshot.html.length,
    });

    return snapshot;
  }

  //==================================================
  // TOOL API
  //==================================================

  async listTools() {
    return [
      { name: "navigate" },

      { name: "click" },

      { name: "doubleClick" },

      { name: "rightClick" },

      { name: "type" },

      { name: "hover" },

      { name: "selectOption" },

      { name: "press" },

      { name: "shortcut" },

      { name: "snapshot" },

      { name: "html" },

      { name: "reload" },

      { name: "wait" },

      { name: "evaluate" },

      { name: "inspectPage" },
    ];
  }

  //==================================================
  // STATISTICS
  //==================================================

  resetStatistics() {
    Object.keys(this.stats).forEach((key) => {
      this.stats[key] = 0;
    });
  }

  getStatistics() {
    return {
      ...this.stats,

      connected: this.connected,

      currentURL: this.lastURL,

      hasDownload: !!this.lastDownload,

      hasDialog: !!this.lastDialog,

      hasSnapshot: !!this.lastSnapshot,

      pages: this.context ? this.context.pages().length : 0,
    };
  }

  //==================================================
  // EXPORT HELPERS
  //==================================================

  async dispose() {
    await this.disconnect();
  }
}
