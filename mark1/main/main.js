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
/* NEW: Return SVGs from BrowserView and IFrames        */
/* ---------------------------------------------------- */

ipcMain.handle("browser-svg", async (_, options = {}) => {
  if (!browserView) return [];
  try {
    const script = `
      (() => {
        function extractSVGsFromDoc(doc, frameInfo = {}) {
          if (!doc) return [];
          const svgs = Array.from(doc.querySelectorAll("svg"));
          return svgs.map((el, i) => {
            const rect = el.getBoundingClientRect();
            const paths = Array.from(el.querySelectorAll("path")).map(p => ({
              d: p.getAttribute("d") || "",
              fill: p.getAttribute("fill") || undefined,
              stroke: p.getAttribute("stroke") || undefined,
              id: p.id || undefined,
              className: p.getAttribute("class") || undefined,
            }));
            const texts = Array.from(el.querySelectorAll("text, tspan")).map(t => (t.textContent || "").trim()).filter(Boolean);
            return {
              index: i,
              id: el.id || undefined,
              className: el.getAttribute("class") || undefined,
              viewBox: el.getAttribute("viewBox") || undefined,
              width: el.getAttribute("width") || Math.round(rect.width) || undefined,
              height: el.getAttribute("height") || Math.round(rect.height) || undefined,
              boundingBox: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
              text: texts.join(" ") || (el.textContent || "").trim() || undefined,
              pathCount: paths.length,
              paths,
              outerHTML: el.outerHTML,
              ...frameInfo
            };
          });
        }

        const allResults = [];
        allResults.push(...extractSVGsFromDoc(document, { isIframe: false, frameUrl: window.location.href }));

        const iframes = Array.from(document.querySelectorAll("iframe"));
        iframes.forEach((iframe, idx) => {
          try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc) {
              const iframeSVGs = extractSVGsFromDoc(iframeDoc, {
                isIframe: true,
                iframeIndex: idx,
                frameUrl: iframe.src || iframe.contentWindow?.location?.href || "",
                frameName: iframe.name || iframe.id || "",
              });
              allResults.push(...iframeSVGs);
            }
          } catch (e) {
            // Handled via backend CDP for cross-origin iframes
          }
        });

        return allResults;
      })();
    `;
    return await browserView.webContents.executeJavaScript(script);
  } catch (err) {
    console.error("browser-svg error:", err);
    return [];
  }
});

/* ---------------------------------------------------- */
/* NEW: Return Container / Parent Class Data            */
/* ---------------------------------------------------- */

ipcMain.handle("browser-container-data", async (_, selectorOrClass) => {
  if (!browserView) return [];
  try {
    const script = `
      (() => {
        const query = ${JSON.stringify(String(selectorOrClass || "").trim())};
        if (!query) return [];

        function extractContainerFromDoc(doc, frameInfo = {}) {
          if (!doc) return [];
          const found = [];
          try {
            const direct = doc.querySelectorAll(query);
            if (direct.length) found.push(...direct);
          } catch {}

          if (!query.startsWith(".") && !query.startsWith("#") && !query.startsWith("[")) {
            try {
              const byClass = doc.querySelectorAll(\`.\${query}, [class~="\${query}"], [class*="\${query}"]\`);
              for (const el of byClass) {
                if (!found.includes(el)) found.push(el);
              }
            } catch {}
          }

          return found.map((el, i) => {
            const rect = el.getBoundingClientRect();
            const svgs = Array.from(el.querySelectorAll("svg")).map((sEl, sIdx) => ({
              index: sIdx,
              id: sEl.id || undefined,
              className: sEl.getAttribute("class") || undefined,
              viewBox: sEl.getAttribute("viewBox") || undefined,
              outerHTML: sEl.outerHTML,
            }));

            return {
              index: i,
              tagName: el.tagName.toLowerCase(),
              id: el.id || undefined,
              className: el.getAttribute("class") || undefined,
              text: (el.innerText || el.textContent || "").trim(),
              svgCount: svgs.length,
              svgs,
              innerHTML: el.innerHTML,
              outerHTML: el.outerHTML,
              ...frameInfo
            };
          });
        }

        const allResults = [];
        allResults.push(...extractContainerFromDoc(document, { isIframe: false, frameUrl: window.location.href }));

        const iframes = Array.from(document.querySelectorAll("iframe"));
        iframes.forEach((iframe, idx) => {
          try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc) {
              const iframeContainers = extractContainerFromDoc(iframeDoc, {
                isIframe: true,
                iframeIndex: idx,
                frameUrl: iframe.src || iframe.contentWindow?.location?.href || "",
                frameName: iframe.name || iframe.id || "",
              });
              allResults.push(...iframeContainers);
            }
          } catch (e) {}
        });

        return allResults;
      })();
    `;
    return await browserView.webContents.executeJavaScript(script);
  } catch (err) {
    console.error("browser-container-data error:", err);
    return [];
  }
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
