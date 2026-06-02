const { app, BrowserWindow } = require("electron");

// IMPORTANT
app.commandLine.appendSwitch("remote-debugging-port", "9222");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    webPreferences: {
      preload: __dirname + "/preload.js",
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile("renderer/index.html");

  win.maximize();

  win.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
