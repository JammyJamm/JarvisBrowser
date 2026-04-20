const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("jarvis", {});
