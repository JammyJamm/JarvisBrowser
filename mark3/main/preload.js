const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  resizeBrowser: () => ipcRenderer.invoke("resize-browser"),
  minimizeWindow: () => ipcRenderer.invoke("window-minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window-toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window-close"),
  isWindowMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  onWindowMaximized: (callback) => {
    if (typeof callback !== "function") {
      throw new TypeError("onWindowMaximized expects a callback");
    }

    const listener = (_, isMaximized) => callback(isMaximized);
    ipcRenderer.on("window-maximized", listener);
    return () => ipcRenderer.removeListener("window-maximized", listener);
  },
});

contextBridge.exposeInMainWorld("browserAPI", {
  // Navigation
  navigate: (url) => ipcRenderer.invoke("navigate", url),
  back: () => ipcRenderer.invoke("back"),
  forward: () => ipcRenderer.invoke("forward"),
  reload: () => ipcRenderer.invoke("reload"),
  stop: () => ipcRenderer.invoke("tab-stop"),

  // Tab Management
  createTab: (url) => ipcRenderer.invoke("tab-create", url),
  closeTab: (tabId) => ipcRenderer.invoke("tab-close", tabId),
  switchTab: (tabId) => ipcRenderer.invoke("tab-switch", tabId),
  getTabs: () => ipcRenderer.invoke("tab-list"),
  getActiveTab: () => ipcRenderer.invoke("tab-active"),

  // Inspection & Scrapers
  getSVG: (options) => ipcRenderer.invoke("browser-svg", options),
  getContainerData: (selectorOrClass) =>
    ipcRenderer.invoke("browser-container-data", selectorOrClass),
  getHTML: () => ipcRenderer.invoke("browser-html"),
  getURL: () => ipcRenderer.invoke("browser-url"),
  executeScript: (script) => ipcRenderer.invoke("browser-execute", script),
  dismissPopup: () => ipcRenderer.invoke("browser-dismiss-popup"),

  // Real-time Event Listeners
  onURLChanged: (callback) => {
    if (typeof callback !== "function") {
      throw new TypeError("onURLChanged expects a callback");
    }

    const listener = (_, data) => {
      if (typeof data === "string") {
        callback(data, { url: data });
      } else if (data && typeof data === "object") {
        callback(data.url, data);
      }
    };
    ipcRenderer.on("url-changed", listener);
    return () => ipcRenderer.removeListener("url-changed", listener);
  },

  onTabsUpdated: (callback) => {
    if (typeof callback !== "function") {
      throw new TypeError("onTabsUpdated expects a callback");
    }

    const listener = (_, data) => callback(data);
    ipcRenderer.on("tabs-updated", listener);
    return () => ipcRenderer.removeListener("tabs-updated", listener);
  },

  onTabLoadingState: (callback) => {
    if (typeof callback !== "function") {
      throw new TypeError("onTabLoadingState expects a callback");
    }

    const listener = (_, data) => callback(data);
    ipcRenderer.on("tab-loading-state", listener);
    return () => ipcRenderer.removeListener("tab-loading-state", listener);
  },
});
