//==========================================================
//
// main/tab-manager.js
//
// Tab Manager for Chrome-like Agentic Browser
//
// Manages multiple WebContentsView instances, active tab selection,
// tab lifecycles, and event forwarding.
//
//==========================================================

const { WebContentsView } = require("electron");

class TabManager {
  constructor(mainWindow, options = {}) {
    this.win = mainWindow;
    this.options = {
      defaultUrl: "https://example.com",
      ...options,
    };

    this.tabs = new Map();
    this.activeTabId = null;
    this.tabSequence = 0;
    this.bounds = { x: 0, y: 0, width: 1200, height: 800 };
  }

  setBounds(bounds) {
    if (!bounds) return;
    this.bounds = bounds;
    const activeTab = this.getActiveTabRecord();
    if (activeTab && activeTab.view && !activeTab.view.webContents.isDestroyed()) {
      try {
        activeTab.view.setBounds(bounds);
      } catch (err) {
        console.error("[TabManager] setBounds error:", err);
      }
    }
  }

  generateTabId() {
    this.tabSequence += 1;
    return `tab_${Date.now()}_${this.tabSequence}`;
  }

  createTab(url = null, makeActive = true) {
    const tabId = this.generateTabId();
    const targetUrl = url && String(url).trim() ? String(url).trim() : this.options.defaultUrl;

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const record = {
      id: tabId,
      view,
      url: targetUrl,
      title: "New Tab",
      isLoading: true,
      canGoBack: false,
      canGoForward: false,
      createdAt: Date.now(),
    };

    this.tabs.set(tabId, record);
    this.attachViewEvents(record);

    // Start loading
    view.webContents.loadURL(targetUrl).catch((err) => {
      console.warn(`[TabManager] Error loading ${targetUrl} in tab ${tabId}:`, err.message);
    });

    if (makeActive || !this.activeTabId) {
      this.switchTab(tabId);
    } else {
      this.notifyTabsUpdated();
    }

    return this.serializeTab(record);
  }

  attachViewEvents(record) {
    const { view, id } = record;
    const contents = view.webContents;

    contents.on("did-start-loading", () => {
      record.isLoading = true;
      this.notifyTabLoading(id, true);
      this.notifyTabsUpdated();
    });

    contents.on("did-stop-loading", () => {
      record.isLoading = false;
      try {
        record.canGoBack = contents.canGoBack();
        record.canGoForward = contents.canGoForward();
        record.url = contents.getURL() || record.url;
        const currentTitle = contents.getTitle();
        if (currentTitle) record.title = currentTitle;
      } catch (err) {}

      if (typeof contents.executeJavaScript === "function") {
        contents.executeJavaScript(`window.__JARVIS_TAB_ID__ = "${id}";`).catch(() => {});
      }

      this.notifyTabLoading(id, false);
      this.notifyTabsUpdated();

      if (id === this.activeTabId) {
        this.notifyUrlChanged(record.url, record.title, id);
      }
    });

    contents.on("page-title-updated", (_, title) => {
      record.title = title || "Untitled";
      this.notifyTabsUpdated();
    });

    contents.on("did-navigate", (_, url) => {
      record.url = url;
      try {
        record.canGoBack = contents.canGoBack();
        record.canGoForward = contents.canGoForward();
      } catch (err) {}
      if (typeof contents.executeJavaScript === "function") {
        contents.executeJavaScript(`window.__JARVIS_TAB_ID__ = "${id}";`).catch(() => {});
      }
      this.notifyTabsUpdated();
      if (id === this.activeTabId) {
        this.notifyUrlChanged(url, record.title, id);
      }
    });

    contents.on("did-navigate-in-page", (_, url) => {
      record.url = url;
      try {
        record.canGoBack = contents.canGoBack();
        record.canGoForward = contents.canGoForward();
      } catch (err) {}
      if (typeof contents.executeJavaScript === "function") {
        contents.executeJavaScript(`window.__JARVIS_TAB_ID__ = "${id}";`).catch(() => {});
      }
      this.notifyTabsUpdated();
      if (id === this.activeTabId) {
        this.notifyUrlChanged(url, record.title, id);
      }
    });

    contents.on("did-fail-load", (_, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return; // ABORTED by user
      record.isLoading = false;
      this.notifyTabLoading(id, false);
      this.notifyTabsUpdated();
    });
  }

  switchTab(tabId) {
    if (!this.tabs.has(tabId)) {
      console.warn(`[TabManager] Tab not found: ${tabId}`);
      return null;
    }

    const previousActive = this.getActiveTabRecord();
    if (previousActive && previousActive.id !== tabId) {
      try {
        if (this.win && !this.win.isDestroyed() && previousActive.view) {
          this.win.contentView.removeChildView(previousActive.view);
        }
      } catch (err) {
        console.error("[TabManager] removeChildView error:", err);
      }
    }

    this.activeTabId = tabId;
    const currentTab = this.tabs.get(tabId);

    try {
      if (this.win && !this.win.isDestroyed() && currentTab.view) {
        this.win.contentView.addChildView(currentTab.view);
        currentTab.view.setBounds(this.bounds);
      }
    } catch (err) {
      console.error("[TabManager] addChildView error:", err);
    }

    this.notifyTabsUpdated();
    if (typeof currentTab.view?.webContents?.executeJavaScript === "function") {
      currentTab.view.webContents.executeJavaScript(`window.__JARVIS_TAB_ID__ = "${tabId}";`).catch(() => {});
    }
    this.notifyUrlChanged(currentTab.url, currentTab.title, currentTab.id);

    return this.serializeTab(currentTab);
  }

  closeTab(tabId) {
    if (!this.tabs.has(tabId)) return false;

    const closingTab = this.tabs.get(tabId);
    const wasActive = this.activeTabId === tabId;

    // Remove from UI
    try {
      if (this.win && !this.win.isDestroyed() && closingTab.view) {
        this.win.contentView.removeChildView(closingTab.view);
      }
    } catch (err) {}

    // Destroy view WebContents
    try {
      if (closingTab.view && !closingTab.view.webContents.isDestroyed()) {
        closingTab.view.webContents.close();
      }
    } catch (err) {}

    this.tabs.delete(tabId);

    // If no tabs remain, create a default tab
    if (this.tabs.size === 0) {
      this.activeTabId = null;
      this.createTab(this.options.defaultUrl, true);
      return true;
    }

    // If closed tab was active, switch to the last tab
    if (wasActive) {
      const remainingTabIds = Array.from(this.tabs.keys());
      const nextTabId = remainingTabIds[remainingTabIds.length - 1];
      this.switchTab(nextTabId);
    } else {
      this.notifyTabsUpdated();
    }

    return true;
  }

  getActiveTabRecord() {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
  }

  getActiveTab() {
    const record = this.getActiveTabRecord();
    return record ? this.serializeTab(record) : null;
  }

  getActiveView() {
    const record = this.getActiveTabRecord();
    return record ? record.view : null;
  }

  getActiveWebContents() {
    const view = this.getActiveView();
    return view && !view.webContents.isDestroyed() ? view.webContents : null;
  }

  getAllTabs() {
    const list = [];
    for (const record of this.tabs.values()) {
      list.push(this.serializeTab(record));
    }
    return list;
  }

  serializeTab(record) {
    return {
      id: record.id,
      url: record.url,
      title: record.title,
      isLoading: record.isLoading,
      canGoBack: record.canGoBack,
      canGoForward: record.canGoForward,
      isActive: record.id === this.activeTabId,
    };
  }

  // Navigation helpers for active tab
  async navigateActive(url) {
    const contents = this.getActiveWebContents();
    if (!contents) throw new Error("No active web page available");
    let target = String(url || "").trim();
    if (!target) return false;
    if (!target.startsWith("http://") && !target.startsWith("https://") && !target.startsWith("file://")) {
      if (target.includes(".") && !target.includes(" ")) {
        target = "https://" + target;
      } else {
        target = "https://www.google.com/search?q=" + encodeURIComponent(target);
      }
    }
    await contents.loadURL(target);
    return true;
  }

  backActive() {
    const contents = this.getActiveWebContents();
    if (contents && contents.canGoBack()) {
      contents.goBack();
      return true;
    }
    return false;
  }

  forwardActive() {
    const contents = this.getActiveWebContents();
    if (contents && contents.canGoForward()) {
      contents.goForward();
      return true;
    }
    return false;
  }

  reloadActive() {
    const contents = this.getActiveWebContents();
    if (contents) {
      contents.reload();
      return true;
    }
    return false;
  }

  stopActive() {
    const contents = this.getActiveWebContents();
    if (contents) {
      contents.stop();
      return true;
    }
    return false;
  }

  // Notification helpers
  notifyTabsUpdated() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send("tabs-updated", {
      tabs: this.getAllTabs(),
      activeTabId: this.activeTabId,
    });
  }

  notifyTabLoading(tabId, isLoading) {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send("tab-loading-state", { tabId, isLoading });
  }

  notifyUrlChanged(url, title = "", tabId = null) {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send("url-changed", { url, title, tabId: tabId || this.activeTabId });
  }
}

module.exports = TabManager;
