const { app, BrowserWindow } = require("electron");

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: __dirname + "/preload.js",
      webviewTag: true,
      contextIsolation: true,
    },
  });

  win.loadFile("renderer/index.html");
  win.webContents.openDevTools();
}

app.whenReady().then(createWindow);
