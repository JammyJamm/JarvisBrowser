const { app, BrowserWindow, WebContentsView, ipcMain } = require("electron");

const path = require("path");

let win;
let browserView;

app.commandLine.appendSwitch("remote-debugging-port", "9222");

async function updateBounds() {
  const bounds = await win.webContents.executeJavaScript(`
    (() => {
      const el = document.getElementById('browser');

      const r = el.getBoundingClientRect();

      console.log('BROWSER DIV', r.width, r.height);

      return {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height)
      };
    })()
  `);

  console.log("VIEW BOUNDS:", bounds);

  browserView.setBounds(bounds);
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  browserView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
    },
  });

  win.contentView.addChildView(browserView);

  browserView.webContents.loadURL("https://example.com");

  await win.loadFile(path.join(__dirname, "renderer", "index.html"));

  win.maximize();

  win.webContents.openDevTools();

  browserView.webContents.on("did-navigate", (_, url) => {
    win.webContents.send("url-changed", url);
  });

  browserView.webContents.on("did-navigate-in-page", (_, url) => {
    win.webContents.send("url-changed", url);
  });
  win.webContents.on("did-finish-load", () => {
    setTimeout(updateBounds, 500);
  });
  win.on("resize", () => {
    updateBounds();
  });
  ipcMain.handle("resize-browser", updateBounds);
  console.log("Electron Ready");
}

ipcMain.handle("navigate", async (_, url) => {
  await browserView.webContents.loadURL(url);
  return true;
});

ipcMain.handle("back", async () => {
  if (browserView?.webContents.canGoBack()) {
    browserView.webContents.goBack();
  }
  return true;
});

ipcMain.handle("forward", async () => {
  if (browserView?.webContents.canGoForward()) {
    browserView.webContents.goForward();
  }
  return true;
});

ipcMain.handle("reload", async () => {
  browserView?.webContents.reload();
  return true;
});

ipcMain.handle("resize-browser", async () => {
  console.log("resize-browser called");
  await updateBounds();
  return true;
});

async function updateBounds() {
  const bounds = await win.webContents.executeJavaScript(`
    (() => {
      const el = document.getElementById('browser');

      const r = el.getBoundingClientRect();

      console.log('BROWSER DIV', r.width, r.height);

      return {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height)
      };
    })()
  `);

  console.log("VIEW BOUNDS:", bounds);

  browserView.setBounds(bounds);
}
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
