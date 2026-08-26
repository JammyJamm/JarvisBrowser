const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  resizeBrowser: () => ipcRenderer.invoke("resize-browser"),
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
});
