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
  navigate: (url) => ipcRenderer.invoke("navigate", url),
  back: () => ipcRenderer.invoke("back"),
  forward: () => ipcRenderer.invoke("forward"),
  reload: () => ipcRenderer.invoke("reload"),
  getSVG: (options) => ipcRenderer.invoke("browser-svg", options),
  getContainerData: (selectorOrClass) =>
    ipcRenderer.invoke("browser-container-data", selectorOrClass),
  getHTML: () => ipcRenderer.invoke("browser-html"),
  getURL: () => ipcRenderer.invoke("browser-url"),
  dismissPopup: () => ipcRenderer.invoke("browser-dismiss-popup"),
  onURLChanged: (callback) => {
    if (typeof callback !== "function") {
      throw new TypeError("onURLChanged expects a callback");
    }

    const listener = (_, url) => callback(url);
    ipcRenderer.on("url-changed", listener);
    return () => ipcRenderer.removeListener("url-changed", listener);
  },
});
