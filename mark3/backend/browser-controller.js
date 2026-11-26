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
import {
  getFrameSVGs,
  getAllSVGsFromFrames,
  getSVGDataFromIframe,
  getFrameContainerData,
  getIframeContainerData,
  findFramesWithSVGs,
  getSVGBySelector,
  clickSVGElement,
} from "./utils/iframeContent.js";

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
    this.preferredActiveURL = "";

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
  // AUTOMATION PAGE FILTER
  //
  // Protects against selecting DevTools, extensions, or the Electron
  // app's own UI shell (index.html).
  //==========================================================

  isAutomationPage(page) {
    if (!page || page.isClosed()) {
      return false;
    }

    const url = String(page.url() || "")
      .trim()
      .toLowerCase();

    // Never target DevTools, chrome extensions, or the Electron main renderer UI
    if (url.startsWith("devtools://") || url.startsWith("chrome-extension://")) {
      return false;
    }

    if (
      url.includes("/renderer/index.html") ||
      url.includes("\\renderer\\index.html") ||
      url.endsWith("renderer/index.html")
    ) {
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

        if (error.message.includes("ECONNREFUSED")) {
          this.log(`Electron CDP on port 9222 not ready yet (Attempt ${attempt}/${this.options.maxReconnectAttempts})...`);
        } else {
          this.warn(`Reconnect ${attempt} failed:`, error.message);
        }

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

  setActiveTabInfo(tabId, url = "", title = "") {
    if (tabId) {
      this.activeTabId = String(tabId).trim();
    }
    if (url && typeof url === "string") {
      this.preferredActiveURL = url.trim();
    }
    if (title && typeof title === "string") {
      this.preferredActiveTitle = title.trim();
    }
    this.log("Active tab info updated:", { tabId: this.activeTabId, url: this.preferredActiveURL });
  }

  setActiveTargetURL(url) {
    this.setActiveTabInfo(null, url);
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

    let active = null;

    // 1. Check if any page matches the Electron active tab ID
    if (this.activeTabId) {
      for (const p of pages) {
        try {
          const tabId = await p.evaluate(() => window.__JARVIS_TAB_ID__).catch(() => null);
          if (tabId && tabId === this.activeTabId) {
            active = p;
            break;
          }
        } catch (e) {}
      }
    }

    // 2. Check if preferred active URL matches any automation page
    if (!active && this.preferredActiveURL) {
      const target = this.preferredActiveURL.toLowerCase().replace(/\/$/, "");
      active = pages.find((p) => {
        const u = (p.url() || "").toLowerCase().replace(/\/$/, "");
        return u === target || u.startsWith(target) || target.startsWith(u);
      });
    }

    // 3. Keep current live page if no preferred target or already matching (prefer healthy http(s) over chrome-error://)
    const isHealthyWebPage = (p) => {
      const u = String(p?.url?.() || "").toLowerCase();
      return u.startsWith("http://") || u.startsWith("https://") || u.startsWith("file://");
    };

    if (!active && this.page && !this.page.isClosed() && pages.includes(this.page)) {
      if (isHealthyWebPage(this.page) || !pages.some(isHealthyWebPage)) {
        this.lastURL = this.page.url();
        return this.page;
      }
    }

    // 4. Otherwise try previous URL
    if (!active && this.lastURL) {
      active = pages.find((page) => page.url() === this.lastURL);
    }

    // 5. Otherwise prefer the last healthy automation page, or any automation page
    if (!active) {
      const healthyPages = pages.filter(isHealthyWebPage);
      active = healthyPages.length ? healthyPages[healthyPages.length - 1] : pages[pages.length - 1];
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

    const page = options.page || (await this.getPage());

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
  // SVG EXTRACTION
  //==========================================================

  async getFrameSVGs(frame, options = {}) {
    await this.ensureConnected();
    const targetFrame = frame || this.page?.mainFrame();
    if (!targetFrame) return [];
    return await getFrameSVGs(targetFrame, options);
  }

  async getIframeSVGs(options = {}) {
    await this.ensureConnected();
    if (!this.page) {
      throw new Error("No active browser page available.");
    }
    return await getSVGDataFromIframe(this.page, {
      onlyIframes: options.onlyIframes !== false,
      ...options,
    });
  }

  async getAllSVGs(options = {}) {
    await this.ensureConnected();
    if (!this.page) {
      throw new Error("No active browser page available.");
    }
    return await getAllSVGsFromFrames(this.page, options);
  }

  async getSVGData(options = {}) {
    return await this.getIframeSVGs(options);
  }

  async getSVGBySelector(selector, options = {}) {
    await this.ensureConnected();
    if (!this.page) {
      throw new Error("No active browser page available.");
    }
    return await getSVGBySelector(this.page, selector, options);
  }

  async clickSVG(selectorOrCriteria, options = {}) {
    await this.ensureConnected();
    if (!this.page) {
      throw new Error("No active browser page available.");
    }
    const frames = await this.getFrames();
    for (const frame of frames) {
      const res = await clickSVGElement(frame, selectorOrCriteria, options);
      if (res.success) return res;
    }
    return {
      success: false,
      error: `SVG element '${selectorOrCriteria}' not found in any frame.`,
    };
  }

  //==========================================================
  // CONTAINER DATA EXTRACTION
  //==========================================================

  async getFrameContainerData(frame, containerSelectorOrClass, options = {}) {
    await this.ensureConnected();
    const targetFrame = frame || this.page?.mainFrame();
    if (!targetFrame) return null;
    return await getFrameContainerData(
      targetFrame,
      containerSelectorOrClass,
      options,
    );
  }

  async getIframeContainerData(containerSelectorOrClass, options = {}) {
    await this.ensureConnected();
    if (!this.page) {
      throw new Error("No active browser page available.");
    }
    return await getIframeContainerData(
      this.page,
      containerSelectorOrClass,
      options,
    );
  }

  //==========================================================
  // PAGE-ONLY AGENT PRIMITIVES & VERIFICATION
  //==========================================================

  async getInteractiveElements(options = {}) {
    const page = options.page || (await this.getPage());
    if (!page || page.isClosed()) return [];

    try {
      return await page.evaluate(() => {
        const elements = [];
        const selector = "button, a[href], input, textarea, select, [role='button'], [role='tab'], [role='link'], [role='menuitem'], [onclick]";
        const nodes = Array.from(document.querySelectorAll(selector));

        nodes.forEach((el, index) => {
          if (elements.length >= 100) return;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);

          const isVisible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            style.opacity !== "0";

          if (!isVisible) return;

          const text = (el.innerText || el.textContent || "").trim().slice(0, 80);
          const ariaLabel = (el.getAttribute("aria-label") || "").trim();
          const placeholder = (el.getAttribute("placeholder") || "").trim();
          const role = (el.getAttribute("role") || el.tagName.toLowerCase()).trim();
          const type = (el.getAttribute("type") || "").trim();
          const name = (el.getAttribute("name") || "").trim();
          const id = (el.id || "").trim();
          const href = (el.getAttribute("href") || "").trim();

          elements.push({
            index,
            tagName: el.tagName.toLowerCase(),
            role,
            type: type || undefined,
            id: id || undefined,
            name: name || undefined,
            text: text || ariaLabel || placeholder || name || id || undefined,
            placeholder: placeholder || undefined,
            ariaLabel: ariaLabel || undefined,
            href: href && !href.startsWith("javascript:") ? href.slice(0, 100) : undefined,
            value: el.value ? String(el.value).slice(0, 50) : undefined,
            box: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          });
        });

        return elements;
      });
    } catch (err) {
      this.warn("getInteractiveElements error:", err.message);
      return [];
    }
  }

  async readContent(options = {}) {
    const page = options.page || (await this.getPage());
    if (!page || page.isClosed()) return "";

    try {
      return await page.evaluate(() => {
        const clone = document.body.cloneNode(true);
        const removeTags = ["script", "style", "noscript", "svg", "iframe"];
        removeTags.forEach((tag) => {
          clone.querySelectorAll(tag).forEach((n) => n.remove());
        });
        return (clone.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 15000);
      });
    } catch (err) {
      this.warn("readContent error:", err.message);
      return "";
    }
  }

  async clickSmart(target, options = {}) {
    const page = options.page || (await this.getPage());
    if (!page || page.isClosed()) throw new Error("Active page is not available");

    const query = String(target || "").trim();
    if (!query) throw new Error("Click target is required");

    const previousUrl = page.url();
    this.log(`Clicking target: "${query}"`);

    let clicked = false;
    let locatorUsed = "";

    const tryClickLocator = async (loc, name) => {
      try {
        if ((await loc.count()) > 0) {
          const first = loc.first();
          await first.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
          await first.evaluate((element) => {
            const link = element.closest("a, area");
            if (link?.hasAttribute("target")) {
              link.setAttribute("target", "_self");
            }

            const form = element.form || element.closest("form");
            if (form?.hasAttribute("target")) {
              form.setAttribute("target", "_self");
            }
          });
          try {
            await first.click({ timeout: 4000 });
          } catch (clickErr) {
            if (clickErr.message.includes("context was destroyed") || clickErr.message.includes("navigating")) {
              return { clicked: true, locatorUsed: `${name} (navigated)` };
            }
            throw clickErr;
          }
          return { clicked: true, locatorUsed: name };
        }
      } catch (e) {}
      return { clicked: false };
    };

    // 1. CSS / XPath selector
    if (/^[.#\[]/.test(query) || query.includes(">") || query.includes("=")) {
      const res = await tryClickLocator(page.locator(query), `selector: ${query}`);
      if (res.clicked) {
        clicked = true;
        locatorUsed = res.locatorUsed;
      }
    }

    // 2. Roles: button, link, tab, menuitem, checkbox, radio
    if (!clicked) {
      const roles = ["button", "link", "tab", "menuitem", "checkbox", "radio"];
      for (const r of roles) {
        const res = await tryClickLocator(page.getByRole(r, { name: query, exact: false }), `getByRole("${r}", "${query}")`);
        if (res.clicked) {
          clicked = true;
          locatorUsed = res.locatorUsed;
          break;
        }
      }
    }

    // 3. Text locator
    if (!clicked) {
      const res = await tryClickLocator(page.getByText(query, { exact: false }), `getByText("${query}")`);
      if (res.clicked) {
        clicked = true;
        locatorUsed = res.locatorUsed;
      }
    }

    // 4. Aria-label / title / placeholder
    if (!clicked) {
      const res = await tryClickLocator(page.getByLabel(query, { exact: false }), `getByLabel("${query}")`);
      if (res.clicked) {
        clicked = true;
        locatorUsed = res.locatorUsed;
      }
    }

    // 5. JavaScript element scan
    if (!clicked) {
      const jsClicked = await page.evaluate((text) => {
        const lower = text.toLowerCase();
        const candidates = Array.from(
          document.querySelectorAll("button, a, [role='button'], [role='tab'], input[type='submit'], input[type='button'], span, div, li")
        );
        for (const el of candidates) {
          const t = (el.innerText || el.textContent || "").trim().toLowerCase();
          const aria = (el.getAttribute("aria-label") || el.getAttribute("title") || "").toLowerCase();
          const val = (el.value || "").toLowerCase();
          if (
            t === lower ||
            aria === lower ||
            val === lower ||
            (lower.length > 2 && (t.includes(lower) || aria.includes(lower) || val.includes(lower)))
          ) {
            const link = el.closest("a, area");
            if (link?.hasAttribute("target")) {
              link.setAttribute("target", "_self");
            }
            const form = el.form || el.closest("form");
            if (form?.hasAttribute("target")) {
              form.setAttribute("target", "_self");
            }
            el.click();
            return true;
          }
        }
        return false;
      }, query);

      if (jsClicked) {
        clicked = true;
        locatorUsed = `JS evaluation match: "${query}"`;
      }
    }

    if (!clicked) {
      throw new Error(`Could not find clickable element matching "${query}" on active page.`);
    }

    await this.sleep(300);
    const currentUrl = page.url();
    const navigated = currentUrl !== previousUrl;

    return {
      success: true,
      action: "click",
      target: query,
      locator: locatorUsed,
      navigated,
      url: currentUrl,
      verification: {
        verified: true,
        message: navigated ? `Clicked "${query}" and navigated to ${currentUrl}` : `Clicked "${query}" successfully`,
      },
    };
  }

  async typeText(field, value, options = {}) {
    const page = options.page || (await this.getPage());
    if (!page || page.isClosed()) throw new Error("Active page is not available");

    const query = String(field || "").trim();
    const val = String(value ?? "");

    this.log(`Typing into "${query}": "${val}"`);

    let typed = false;
    let locatorUsed = "";
    let loc = null;

    // 1. Selector check
    if (/^[.#\[]/.test(query) || query.includes("=")) {
      try {
        const candidate = page.locator(query).first();
        if ((await candidate.count()) > 0) {
          loc = candidate;
          locatorUsed = `selector: ${query}`;
        }
      } catch (e) {}
    }

    // 2. Placeholder
    if (!loc) {
      try {
        const candidate = page.getByPlaceholder(query, { exact: false }).first();
        if ((await candidate.count()) > 0) {
          loc = candidate;
          locatorUsed = `getByPlaceholder("${query}")`;
        }
      } catch (e) {}
    }

    // 3. Label
    if (!loc) {
      try {
        const candidate = page.getByLabel(query, { exact: false }).first();
        if ((await candidate.count()) > 0) {
          loc = candidate;
          locatorUsed = `getByLabel("${query}")`;
        }
      } catch (e) {}
    }

    // 4. Name or id
    if (!loc) {
      try {
        const inputSelector = `input[name="${query}" i], textarea[name="${query}" i], input[id="${query}" i], textarea[id="${query}" i]`;
        const candidate = page.locator(inputSelector).first();
        if ((await candidate.count()) > 0) {
          loc = candidate;
          locatorUsed = `locator("${inputSelector}")`;
        }
      } catch (e) {}
    }

    // 5. Fallback for search/input
    if (!loc && /search|input|query|box/i.test(query)) {
      try {
        const candidate = page.locator("input[type='search'], input[type='text'], textarea").first();
        if ((await candidate.count()) > 0) {
          loc = candidate;
          locatorUsed = "generic visible input";
        }
      } catch (e) {}
    }

    if (loc) {
      try {
        await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        if (options.clear !== false) {
          await loc.fill("").catch(() => {});
        }
        await loc.fill(val, { timeout: 4000 });
        typed = true;
      } catch (fillErr) {
        try {
          await loc.click({ timeout: 2000 });
          await page.keyboard.press("Control+A").catch(() => {});
          await page.keyboard.press("Backspace").catch(() => {});
          await page.keyboard.type(val, { delay: 10 });
          typed = true;
        } catch (e) {}
      }
    }

    // 6. JS evaluate fallback
    if (!typed) {
      const jsFilled = await page.evaluate(
        ({ f, v }) => {
          const lower = f.toLowerCase();
          const inputs = Array.from(document.querySelectorAll("input, textarea"));
          for (const inp of inputs) {
            const name = (inp.getAttribute("name") || "").toLowerCase();
            const id = (inp.id || "").toLowerCase();
            const ph = (inp.getAttribute("placeholder") || "").toLowerCase();
            const aria = (inp.getAttribute("aria-label") || "").toLowerCase();
            if (name.includes(lower) || id.includes(lower) || ph.includes(lower) || aria.includes(lower)) {
              inp.value = v;
              inp.dispatchEvent(new Event("input", { bubbles: true }));
              inp.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
          }
          if (inputs.length > 0) {
            inputs[0].value = v;
            inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
            inputs[0].dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
          return false;
        },
        { f: query, v: val },
      );

      if (jsFilled) {
        typed = true;
        locatorUsed = `JS evaluation fill: "${query}"`;
      }
    }

    if (!typed) {
      throw new Error(`Could not find input field matching "${query}" on active page.`);
    }

    if (options.pressEnter) {
      await page.keyboard.press("Enter").catch(() => {});
      await this.sleep(300);
    }

    return {
      success: true,
      action: "type",
      field: query,
      value: val,
      locator: locatorUsed,
      verification: {
        verified: true,
        message: `Filled field "${query}" with "${val}"`,
      },
    };
  }

  async selectOption(field, value, options = {}) {
    const page = options.page || (await this.getPage());
    if (!page || page.isClosed()) throw new Error("Active page is not available");

    const query = String(field || "").trim();
    const val = String(value ?? "");

    let selected = false;
    try {
      const loc = page.locator(`select[name="${query}" i], select[id="${query}" i], select`).first();
      if ((await loc.count()) > 0) {
        await loc.selectOption({ label: val }).catch(async () => {
          await loc.selectOption({ value: val });
        });
        selected = true;
      }
    } catch (e) {}

    if (!selected) {
      throw new Error(`Could not find dropdown matching "${query}" to select "${val}".`);
    }

    return {
      success: true,
      action: "select",
      field: query,
      value: val,
      verification: {
        verified: true,
        message: `Selected "${val}" in dropdown "${query}"`,
      },
    };
  }

  async scrollPage(direction = "down", amount = 500, options = {}) {
    const page = options.page || (await this.getPage());
    if (!page || page.isClosed()) throw new Error("Active page is not available");

    const dir = String(direction).toLowerCase() === "up" ? -1 : 1;
    const px = (Number(amount) || 500) * dir;

    await page.evaluate((scrollAmount) => {
      window.scrollBy({ top: scrollAmount, behavior: "smooth" });
    }, px);

    await this.sleep(300);

    return {
      success: true,
      action: "scroll",
      direction,
      amount: Math.abs(px),
      verification: {
        verified: true,
        message: `Scrolled ${direction} by ${Math.abs(px)}px`,
      },
    };
  }

  async pressKey(key = "Enter", options = {}) {
    const page = options.page || (await this.getPage());
    if (!page || page.isClosed()) throw new Error("Active page is not available");

    await page.keyboard.press(key);
    await this.sleep(300);

    return {
      success: true,
      action: "press",
      key,
      verification: {
        verified: true,
        message: `Pressed key "${key}"`,
      },
    };
  }

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
