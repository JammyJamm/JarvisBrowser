const { app, BrowserWindow, Menu } = require("electron");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    autoHideMenuBar: true,
    webPreferences: {
      preload: __dirname + "/preload.js",
      webviewTag: true,
      contextIsolation: true,
    },
  });

  // remove top menu
  Menu.setApplicationMenu(null);

  win.loadFile("renderer/index.html");

  win.maximize();

  win.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
