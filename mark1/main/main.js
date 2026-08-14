const { app, BrowserWindow, WebContentsView, ipcMain } = require("electron");
const path = require("path");

let win;
let browserView;
let htmlLoggerStarted = false;
// Enable Chrome DevTools Protocol
app.commandLine.appendSwitch("remote-debugging-port", "9222");

let htmlLogger = null;

/* ---------------------------------------------------- */
/* Resize BrowserView                                   */
/* ---------------------------------------------------- */

async function updateBounds() {
  if (!win || !browserView) return;

  try {
    const bounds = await win.webContents.executeJavaScript(`
      (() => {
        const el = document.getElementById("browser");

        if (!el) {
          return {
            x: 0,
            y: 0,
            width: 1200,
            height: 800
          };
        }

        const r = el.getBoundingClientRect();

        return {
          x: Math.round(r.left),
          y: Math.round(r.top),
          width: Math.round(r.width),
          height: Math.round(r.height)
        };
      })();
    `);

    browserView.setBounds(bounds);
  } catch (err) {
    console.error("updateBounds:", err);
  }
}
function startHtmlLogger() {
  if (htmlLoggerStarted) {
    return;
  }

  htmlLoggerStarted = true;

  // setInterval(async () => {
  //   try {
  //     const html = await browserView.webContents.executeJavaScript(
  //       "document.documentElement.outerHTML",
  //     );

  //     console.log("========== ELECTRON HTML ==========");
  //     console.log(html.substring(0, 2000));
  //     console.log("===================================");
  //   } catch (err) {
  //     console.error(err);
  //   }
  // }, 5000);
}
/* ---------------------------------------------------- */
/* Get Current HTML                                     */
/* ---------------------------------------------------- */

async function getCurrentHTML() {
  if (!browserView) return "";

  try {
    return await browserView.webContents.executeJavaScript(`
      document.documentElement.outerHTML
    `);
  } catch (e) {
    console.error(e);
    return "";
  }
}

/* ---------------------------------------------------- */
/* Window                                               */
/* ---------------------------------------------------- */

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

  await browserView.webContents.loadURL("https://example.com");

  await win.loadFile(path.join(__dirname, "renderer", "index.html"));

  startHtmlLogger();

  win.maximize();

  win.webContents.openDevTools();

  browserView.webContents.on("did-navigate", (_, url) => {
    win.webContents.send("url-changed", url);
  });

  browserView.webContents.on("did-navigate-in-page", (_, url) => {
    win.webContents.send("url-changed", url);
  });
  browserView.webContents.on("did-finish-load", () => {
    console.log("WEBVIEW URL:", browserView.webContents.getURL());
  });
  win.webContents.on("did-finish-load", () => {
    setTimeout(updateBounds, 300);
  });

  win.on("resize", updateBounds);

  console.log("Electron Ready");

  // -----------------------------
  // Single HTML logger
  // -----------------------------

  // htmlLogger = setInterval(async () => {
  //   try {
  //     const html = await getCurrentHTML();

  //     console.log("\n========== ELECTRON HTML ==========");
  //     console.log(html.substring(0, 5000));
  //     console.log("===================================\n");
  //   } catch (e) {
  //     console.error(e);
  //   }
  // }, 5000);
}

/* ---------------------------------------------------- */
/* Navigation                                           */
/* ---------------------------------------------------- */

ipcMain.handle("navigate", async (_, url) => {
  await browserView.webContents.loadURL(url);
  return true;
});

ipcMain.handle("back", async () => {
  if (browserView.webContents.canGoBack()) {
    browserView.webContents.goBack();
  }
  return true;
});

ipcMain.handle("forward", async () => {
  if (browserView.webContents.canGoForward()) {
    browserView.webContents.goForward();
  }
  return true;
});

ipcMain.handle("reload", async () => {
  browserView.webContents.reload();
  return true;
});

ipcMain.handle("resize-browser", async () => {
  await updateBounds();
  return true;
});

/* ---------------------------------------------------- */
/* NEW: Return live BrowserView HTML                    */
/* ---------------------------------------------------- */

ipcMain.handle("browser-html", async () => {
  return await getCurrentHTML();
});

/* ---------------------------------------------------- */
/* NEW: Return current URL                              */
/* ---------------------------------------------------- */

ipcMain.handle("browser-url", async () => {
  return browserView.webContents.getURL();
});

/* ---------------------------------------------------- */
/* NEW: Execute JS inside BrowserView                   */
/* ---------------------------------------------------- */

ipcMain.handle("browser-execute", async (_, script) => {
  return await browserView.webContents.executeJavaScript(script);
});

/* ---------------------------------------------------- */
/* App                                                  */
/* ---------------------------------------------------- */

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (htmlLogger) {
    clearInterval(htmlLogger);
  }

  app.quit();
});
