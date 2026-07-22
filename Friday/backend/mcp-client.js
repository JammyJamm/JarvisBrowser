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
// BrowserController
//      │
// PlaywrightClient
//      │
// Resolver / Planner / ToolMap
//
// Features
// --------
// ✔ Shared BrowserController architecture
// ✔ Automatic CDP reconnect
// ✔ BrowserView detection
// ✔ Active page detection
// ✔ Multi-tab support
// ✔ Frame utilities
// ✔ Snapshot utilities
// ✔ DOM inspection
// ✔ Interactive element extraction
// ✔ Download manager
// ✔ Dialog manager
// ✔ Popup tracking
// ✔ Safe execution
// ✔ Retry execution
// ✔ Statistics
// ✔ Structured results
//
//==========================================================

import browserController from "./browser-controller.js";

export default class PlaywrightMCPClient {
  constructor(options = {}) {
    //------------------------------------------------------
    // CONFIGURATION
    //------------------------------------------------------

    this.options = {
      browserViewOnly: true,

      autoReconnect: true,

      reconnectInterval: 1000,

      maxReconnectAttempts: 10,

      waitUntil: "domcontentloaded",

      navigationTimeout: 60000,

      snapshotTimeout: 15000,

      debug: false,

      ...options,
    };

    //------------------------------------------------------
    // SHARED BROWSER CONTROLLER
    //
    // IMPORTANT:
    //
    // Do NOT create another chromium.connectOverCDP()
    // connection here.
    //
    // BrowserController owns the Playwright connection.
    //------------------------------------------------------

    this.browserController = browserController;

    //------------------------------------------------------
    // PLAYWRIGHT HANDLES
    //
    // These are synchronized from BrowserController.
    //------------------------------------------------------

    this.browser = null;

    this.context = null;

    this.page = null;

    //------------------------------------------------------
    // RUNTIME STATE
    //------------------------------------------------------

    this.connected = false;

    this.connecting = false;

    this.connectionPromise = null;

    this.lastURL = "";

    this.lastSnapshot = null;

    this.lastDOMSnapshot = null;

    //------------------------------------------------------
    // DOWNLOADS
    //------------------------------------------------------

    this.lastDownload = null;

    //------------------------------------------------------
    // DIALOGS
    //------------------------------------------------------

    this.lastDialog = null;

    //------------------------------------------------------
    // POPUPS
    //------------------------------------------------------

    this.lastPopup = null;

    //------------------------------------------------------
    // EVENT STATE
    //------------------------------------------------------

    this.eventsAttached = false;

    //------------------------------------------------------
    // PAGE EVENT REGISTRY
    //
    // Prevents duplicate listeners when active page changes.
    //------------------------------------------------------

    this.eventPages = new WeakSet();

    //------------------------------------------------------
    // STATISTICS
    //------------------------------------------------------

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

      popups: 0,

      evaluations: 0,

      frameOperations: 0,

      retries: 0,

      errors: 0,
    };
  }

  //========================================================
  // LOGGING
  //========================================================

  log(...args) {
    if (this.options.debug) {
      console.log("[PlaywrightMCPClient]", ...args);
    }
  }

  warn(...args) {
    console.warn("[PlaywrightMCPClient]", ...args);
  }

  error(...args) {
    console.error("[PlaywrightMCPClient]", ...args);
  }

  //========================================================
  // INTERNAL STATE SYNC
  //========================================================

  syncControllerState() {
    this.browser = this.browserController.browser;

    this.context = this.browserController.context;

    this.page = this.browserController.page;

    this.connected = this.browserController.connected;

    if (this.page && !this.page.isClosed()) {
      this.lastURL = this.page.url();
    }
  }

  //========================================================
  // CONNECTION
  //========================================================

  async connect(force = false) {
    //------------------------------------------------------
    // Existing connection
    //------------------------------------------------------

    if (!force && this.connected && this.page && !this.page.isClosed()) {
      return this.page;
    }

    //------------------------------------------------------
    // Prevent duplicate connections
    //------------------------------------------------------

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

  //========================================================
  // INTERNAL CONNECT
  //========================================================

  async connectInternal(force = false) {
    try {
      this.log("Connecting through BrowserController...");

      //----------------------------------------------------
      // Apply options to shared controller
      //----------------------------------------------------

      if (this.options.autoReconnect !== undefined) {
        this.browserController.options.autoReconnect =
          this.options.autoReconnect;
      }

      if (this.options.waitUntil) {
        this.browserController.options.waitUntil = this.options.waitUntil;
      }

      if (this.options.navigationTimeout) {
        this.browserController.options.navigationTimeout =
          this.options.navigationTimeout;
      }

      //----------------------------------------------------
      // Connect
      //----------------------------------------------------

      await this.browserController.connect(force);

      //----------------------------------------------------
      // Sync state
      //----------------------------------------------------

      this.syncControllerState();

      //----------------------------------------------------
      // Discover active page
      //----------------------------------------------------

      await this.refreshActivePage();

      //----------------------------------------------------
      // Attach events
      //----------------------------------------------------

      this.attachEvents();

      this.connected = true;

      this.stats.connects++;

      this.log("Connected successfully:", this.lastURL);

      return this.page;
    } catch (err) {
      this.connected = false;

      this.stats.errors++;

      this.error("Connection failed:", err.message);

      throw err;
    }
  }

  //========================================================
  // DISCONNECT
  //========================================================

  async disconnect() {
    this.connected = false;

    this.eventsAttached = false;

    this.page = null;

    this.context = null;

    this.browser = null;

    try {
      await this.browserController.disconnect();
    } catch (err) {
      this.warn("Browser disconnect warning:", err.message);
    }
  }

  //========================================================
  // HEALTH CHECK
  //========================================================

  async ensureConnected() {
    this.stats.healthChecks++;

    try {
      //----------------------------------------------------
      // Make sure controller is healthy
      //----------------------------------------------------

      await this.browserController.ensureConnected();

      //----------------------------------------------------
      // Synchronize handles
      //----------------------------------------------------

      this.syncControllerState();

      //----------------------------------------------------
      // Validate page
      //----------------------------------------------------

      if (!this.page || this.page.isClosed()) {
        throw new Error("Active page unavailable.");
      }

      //----------------------------------------------------
      // Lightweight health check
      //----------------------------------------------------

      await this.page
        .title({
          timeout: 5000,
        })
        .catch(() => {
          throw new Error("Active page is unreachable.");
        });

      this.connected = true;

      return this.page;
    } catch (err) {
      this.connected = false;

      if (!this.options.autoReconnect) {
        throw new Error(`Browser disconnected: ${err.message}`);
      }

      this.stats.reconnects++;

      this.log("Attempting browser reconnect...");

      //----------------------------------------------------
      // Reconnect
      //----------------------------------------------------

      const page = await this.connect(true);

      return page;
    }
  }

  //========================================================
  // ACTIVE PAGE DISCOVERY
  //========================================================

  async refreshActivePage() {
    await this.ensureControllerConnection();

    const pages = this.context.pages();

    if (!pages.length) {
      throw new Error("No browser pages available.");
    }

    //------------------------------------------------------
    // Remove closed pages
    //------------------------------------------------------

    const activePages = pages.filter((page) => !page.isClosed());

    if (!activePages.length) {
      throw new Error("All browser pages are closed.");
    }

    //------------------------------------------------------
    // Prefer real BrowserView page
    //------------------------------------------------------

    let candidate = null;

    if (this.options.browserViewOnly) {
      candidate = activePages.find((page) => this.isRealBrowserPage(page));
    }

    //------------------------------------------------------
    // Fallback
    //------------------------------------------------------

    if (!candidate) {
      candidate = activePages[0];
    }

    //------------------------------------------------------
    // Track page switch
    //------------------------------------------------------

    if (this.page && this.page !== candidate) {
      this.stats.pageSwitches++;
    }

    this.page = candidate;

    this.lastURL = candidate.url();

    this.syncControllerState();

    this.attachEvents();

    this.log("Active page:", this.lastURL);

    return this.page;
  }

  //========================================================
  // CONTROLLER CONNECTION
  //========================================================

  async ensureControllerConnection() {
    if (!this.browserController.browser || !this.browserController.context) {
      await this.browserController.connect();
    }

    this.syncControllerState();

    if (!this.context) {
      throw new Error("Browser context unavailable.");
    }
  }

  //========================================================
  // PAGE CLASSIFICATION
  //========================================================

  isRealBrowserPage(page) {
    if (!page || page.isClosed()) {
      return false;
    }

    const url = page.url();

    if (!url) {
      return false;
    }

    //------------------------------------------------------
    // Real web pages
    //------------------------------------------------------

    if (url.startsWith("http://") || url.startsWith("https://")) {
      //----------------------------------------------------
      // Ignore known Electron internal pages
      //----------------------------------------------------

      if (url.includes("localhost") && url.includes("renderer")) {
        return false;
      }

      return true;
    }

    //------------------------------------------------------
    // Ignore local Electron pages
    //------------------------------------------------------

    if (
      url.startsWith("file://") ||
      url.startsWith("devtools://") ||
      url.startsWith("chrome://")
    ) {
      return false;
    }

    return false;
  }

  //========================================================
  // PAGE GETTERS
  //========================================================

  async getPage() {
    await this.ensureConnected();

    await this.refreshActivePage();

    return this.page;
  }

  async getRealBrowserPage() {
    await this.ensureConnected();

    const pages = this.context.pages();

    const page = pages.find((candidate) => this.isRealBrowserPage(candidate));

    if (!page) {
      throw new Error("No real browser page found.");
    }

    if (this.page !== page) {
      this.page = page;

      this.stats.pageSwitches++;

      this.attachEvents();
    }

    this.lastURL = page.url();

    return page;
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

  //========================================================
  // TAB MANAGEMENT
  //========================================================

  async newTab(url = "about:blank") {
    await this.ensureConnected();

    const page = await this.context.newPage();

    if (url && url !== "about:blank") {
      await page.goto(url, {
        waitUntil: this.options.waitUntil,

        timeout: this.options.navigationTimeout,
      });
    }

    this.page = page;

    this.lastURL = page.url();

    this.stats.pageSwitches++;

    this.attachEvents();

    return page;
  }

  async switchToPage(index = 0) {
    await this.ensureConnected();

    const pages = this.context.pages();

    const validPages = pages.filter((page) => !page.isClosed());

    if (index < 0 || index >= validPages.length) {
      throw new Error(`Invalid page index ${index}.`);
    }

    this.page = validPages[index];

    this.lastURL = this.page.url();

    this.stats.pageSwitches++;

    this.attachEvents();

    return this.page;
  }

  async switchToLastPage() {
    await this.ensureConnected();

    const pages = this.context.pages().filter((page) => !page.isClosed());

    if (!pages.length) {
      throw new Error("No pages available.");
    }

    return this.switchToPage(pages.length - 1);
  }

  async closeCurrentPage() {
    const page = await this.getPage();

    await page.close().catch(() => {});

    await this.refreshActivePage();

    return {
      success: true,

      action: "closePage",

      url: this.lastURL,
    };
  }

  //========================================================
  // PAGE STATE
  //========================================================

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

  async reload(options = {}) {
    const page = await this.getPage();

    await page.reload({
      waitUntil: this.options.waitUntil,

      timeout: this.options.navigationTimeout,

      ...options,
    });

    this.stats.navigations++;

    this.lastURL = page.url();

    return {
      success: true,

      action: "reload",

      url: this.lastURL,
    };
  }

  async goto(url, options = {}) {
    if (!url) {
      throw new Error("Navigation URL is required.");
    }

    const page = await this.getPage();

    const targetURL = String(url).trim();

    await page.goto(targetURL, {
      waitUntil: this.options.waitUntil,

      timeout: this.options.navigationTimeout,

      ...options,
    });

    this.stats.navigations++;

    this.lastURL = page.url();

    return {
      success: true,

      action: "navigate",

      url: this.lastURL,
    };
  }

  //========================================================
  // HTML
  //========================================================

  async html() {
    const page = await this.getPage();

    this.stats.htmlRequests++;

    return await page.content();
  }

  //========================================================
  // TEXT
  //========================================================

  async text() {
    const page = await this.getPage();

    return await page.evaluate(() => document.body?.innerText || "");
  }

  //========================================================
  // TITLE
  //========================================================

  async title() {
    const page = await this.getPage();

    return await page.title();
  }

  //========================================================
  // URL
  //========================================================

  async url() {
    const page = await this.getPage();

    this.lastURL = page.url();

    return this.lastURL;
  }

  //========================================================
  // SNAPSHOT
  //========================================================

  async snapshot() {
    const page = await this.getPage();

    const snapshot = {
      html: "",

      text: "",

      title: "",

      url: "",

      timestamp: Date.now(),
    };

    //------------------------------------------------------
    // HTML
    //------------------------------------------------------

    try {
      snapshot.html = await page.content();
    } catch (err) {
      this.warn("Snapshot HTML failed:", err.message);
    }

    //------------------------------------------------------
    // Text
    //------------------------------------------------------

    try {
      snapshot.text = await page.evaluate(() => document.body?.innerText || "");
    } catch (err) {
      this.warn("Snapshot text failed:", err.message);
    }

    //------------------------------------------------------
    // Title
    //------------------------------------------------------

    try {
      snapshot.title = await page.title();
    } catch {}

    //------------------------------------------------------
    // URL
    //------------------------------------------------------

    snapshot.url = page.url();

    //------------------------------------------------------
    // Save
    //------------------------------------------------------

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

  //========================================================
  // DOM SNAPSHOT
  //
  // Lightweight structured DOM representation.
  //
  // Useful for:
  //
  // Intent Parser
  // Scoring Engine
  // Resolver
  // Self Healing
  //
  //========================================================

  async getDOMSnapshot() {
    const page = await this.getPage();

    const snapshot = await page.evaluate(() => {
      const normalize = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim();

      const elements = [];

      const nodes = document.querySelectorAll(
        "button, a, input, textarea, select, [role], [contenteditable='true']",
      );

      nodes.forEach((element, index) => {
        const rect = element.getBoundingClientRect();

        const style = window.getComputedStyle(element);

        const text = normalize(element.innerText || element.textContent || "");

        const aria = normalize(element.getAttribute("aria-label"));

        const placeholder = normalize(element.getAttribute("placeholder"));

        const title = normalize(element.getAttribute("title"));

        const value = normalize(element.value);

        const tag = element.tagName.toLowerCase();

        const role = normalize(element.getAttribute("role"));

        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none";

        const disabled =
          element.disabled === true ||
          element.getAttribute("aria-disabled") === "true";

        elements.push({
          index,

          tag,

          role,

          text,

          ariaLabel: aria,

          placeholder,

          title,

          value,

          type: element.getAttribute("type") || "",

          name: element.getAttribute("name") || "",

          id: element.id || "",

          className:
            typeof element.className === "string" ? element.className : "",

          href: element.getAttribute("href") || "",

          visible,

          disabled,

          editable:
            element.isContentEditable || tag === "input" || tag === "textarea",

          x: rect.x,

          y: rect.y,

          width: rect.width,

          height: rect.height,
        });
      });

      return {
        url: window.location.href,

        title: document.title,

        readyState: document.readyState,

        elements,
      };
    });

    this.lastDOMSnapshot = snapshot;

    return snapshot;
  }

  //========================================================
  // INTERACTIVE ELEMENTS
  //========================================================

  async getInteractiveElements() {
    const snapshot = await this.getDOMSnapshot();

    return snapshot.elements.filter(
      (element) => element.visible && !element.disabled,
    );
  }

  //========================================================
  // DOM UTILITIES
  //========================================================

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

  //========================================================
  // PAGE INSPECTION
  //========================================================

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

  //========================================================
  // FRAME HELPERS
  //========================================================

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

      if (found) {
        return found;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error("Frame not found.");
  }

  async evaluateInFrame(frame, fn, arg = null) {
    if (!frame) {
      throw new Error("Frame is required.");
    }

    this.stats.frameOperations++;

    return await frame.evaluate(fn, arg);
  }

  async locatorInFrame(frame, selector) {
    if (!frame) {
      throw new Error("Frame is required.");
    }

    return frame.locator(selector);
  }

  async clickInFrame(frame, selector, options = {}) {
    if (!frame) {
      throw new Error("Frame is required.");
    }

    await frame.locator(selector).first().click(options);

    this.stats.clicks++;

    this.stats.frameOperations++;

    return {
      success: true,

      action: "frame.click",

      selector,
    };
  }

  async typeInFrame(frame, selector, value, options = {}) {
    if (!frame) {
      throw new Error("Frame is required.");
    }

    const locator = frame.locator(selector).first();

    await locator.fill("");

    await locator.fill(String(value), options);

    this.stats.types++;

    this.stats.frameOperations++;

    return {
      success: true,

      action: "frame.type",

      selector,

      value,
    };
  }

  //========================================================
  // DOWNLOAD MANAGER
  //========================================================

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

      await new Promise((resolve) => setTimeout(resolve, 200));
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

  //========================================================
  // DIALOG MANAGER
  //========================================================

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

      await new Promise((resolve) => setTimeout(resolve, 200));
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

  //========================================================
  // WAIT HELPERS
  //========================================================

  async wait(milliseconds = 1000) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));

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

  //========================================================
  // EVENT MANAGER
  //========================================================

  attachEvents() {
    if (!this.page) {
      return;
    }

    //------------------------------------------------------
    // Do not attach twice to same page
    //------------------------------------------------------

    if (this.eventPages.has(this.page)) {
      this.eventsAttached = true;

      return;
    }

    this.eventPages.add(this.page);

    this.eventsAttached = true;

    const page = this.page;

    //------------------------------------------------------
    // Download
    //------------------------------------------------------

    page.on("download", (download) => {
      this.lastDownload = download;

      this.stats.downloads++;

      this.log("Download:", download.suggestedFilename());
    });

    //------------------------------------------------------
    // Dialog
    //
    // IMPORTANT:
    // Do NOT automatically accept dialogs.
    // Resolver/tool layer can explicitly
    // accept or dismiss them.
    //------------------------------------------------------

    page.on("dialog", (dialog) => {
      this.lastDialog = dialog;

      this.stats.dialogs++;

      this.log("Dialog:", dialog.type(), dialog.message());
    });

    //------------------------------------------------------
    // Navigation
    //------------------------------------------------------

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        this.lastURL = frame.url();

        this.stats.navigations++;

        this.log("Navigated:", this.lastURL);
      }
    });

    //------------------------------------------------------
    // Popup
    //------------------------------------------------------

    page.on("popup", (popup) => {
      this.lastPopup = popup;

      this.stats.popups++;

      this.log("Popup:", popup.url());

      popup.on("close", () => {
        if (this.lastPopup === popup) {
          this.lastPopup = null;
        }
      });
    });

    //------------------------------------------------------
    // Crash
    //------------------------------------------------------

    page.on("crash", () => {
      this.connected = false;

      this.warn("Page crashed.");
    });

    //------------------------------------------------------
    // Close
    //------------------------------------------------------

    page.on("close", () => {
      if (this.page === page) {
        this.connected = false;
      }

      this.warn("Page closed.");
    });
  }

  //========================================================
  // POPUP MANAGER
  //========================================================

  getLastPopup() {
    return this.lastPopup;
  }

  clearPopup() {
    this.lastPopup = null;
  }

  async switchToPopup() {
    if (!this.lastPopup || this.lastPopup.isClosed()) {
      throw new Error("No active popup.");
    }

    this.page = this.lastPopup;

    this.lastURL = this.page.url();

    this.stats.pageSwitches++;

    this.attachEvents();

    return this.page;
  }

  //========================================================
  // SAFE EXECUTION
  //========================================================

  async safeExecute(executor, fallback = null) {
    try {
      return await executor();
    } catch (err) {
      this.stats.errors++;

      this.error(err);

      if (fallback) {
        try {
          return await fallback(err);
        } catch (fallbackError) {
          this.stats.errors++;

          this.error(fallbackError);
        }
      }

      return {
        success: false,

        error: err.message,

        stack: this.options.debug ? err.stack : undefined,
      };
    }
  }

  //========================================================
  // RETRY
  //========================================================

  async retry(executor, retries = 3, delay = 500) {
    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await executor(attempt);
      } catch (err) {
        lastError = err;

        this.stats.retries++;

        this.warn(`Retry ${attempt}/${retries}:`, err.message);

        if (attempt < retries) {
          await this.wait(delay * attempt);
        }
      }
    }

    throw lastError;
  }

  //========================================================
  // DEBUG PAGES
  //========================================================

  async debugPages() {
    const pages = await this.getPages();

    console.log("\n========== PLAYWRIGHT PAGES ==========");

    for (const page of pages) {
      console.log({
        url: page.url(),

        title: await page.title().catch(() => ""),

        closed: page.isClosed(),

        realBrowserPage: this.isRealBrowserPage(page),
      });
    }

    console.log("======================================\n");

    return pages;
  }

  //========================================================
  // DEBUG FRAMES
  //========================================================

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

    return frames;
  }

  //========================================================
  // DEBUG SNAPSHOT
  //========================================================

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

  //========================================================
  // TOOL API
  //========================================================

  async listTools() {
    return [
      {
        name: "navigate",
        description: "Navigate to a URL",
      },

      {
        name: "click",
        description: "Click an element",
      },

      {
        name: "doubleClick",
        description: "Double click an element",
      },

      {
        name: "rightClick",
        description: "Right click an element",
      },

      {
        name: "type",
        description: "Fill an input",
      },

      {
        name: "hover",
        description: "Hover over an element",
      },

      {
        name: "selectOption",
        description: "Select an option",
      },

      {
        name: "press",
        description: "Press keyboard key",
      },

      {
        name: "shortcut",
        description: "Press keyboard shortcut",
      },

      {
        name: "snapshot",
        description: "Capture page snapshot",
      },

      {
        name: "html",
        description: "Get page HTML",
      },

      {
        name: "reload",
        description: "Reload current page",
      },

      {
        name: "wait",
        description: "Wait for specified time",
      },

      {
        name: "evaluate",
        description: "Execute JavaScript in page",
      },

      {
        name: "inspectPage",
        description: "Inspect current page",
      },

      {
        name: "getDOMSnapshot",
        description: "Get structured interactive DOM",
      },

      {
        name: "getInteractiveElements",
        description: "Get visible interactive elements",
      },

      {
        name: "newTab",
        description: "Open new browser tab",
      },

      {
        name: "switchToPage",
        description: "Switch browser tab",
      },

      {
        name: "closeCurrentPage",
        description: "Close active browser tab",
      },

      {
        name: "getFrames",
        description: "List all page frames",
      },

      {
        name: "waitForURL",
        description: "Wait for URL change",
      },
    ];
  }

  //========================================================
  // STATISTICS
  //========================================================

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

      hasPopup: !!this.lastPopup,

      hasSnapshot: !!this.lastSnapshot,

      hasDOMSnapshot: !!this.lastDOMSnapshot,

      pages: this.context ? this.context.pages().length : 0,
    };
  }

  //========================================================
  // DISPOSE
  //========================================================

  async dispose() {
    await this.disconnect();
  }
}
