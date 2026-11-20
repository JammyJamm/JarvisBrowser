//==========================================================
//
// main/main.js
//
// Electron Main Process for Chrome-like Agentic Browser
//
// Features:
// ✔ Multi-tab architecture with WebContentsView
// ✔ Independent browser navigation and tab lifecycle
// ✔ Chrome DevTools Protocol enabled for Playwright
// ✔ Page-only sandboxed interaction APIs
// ✔ Window controls & bounds synchronization
//
//==========================================================

const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const TabManager = require("./tab-manager.js");

let win;
let tabManager;

// Enable Chrome DevTools Protocol
app.commandLine.appendSwitch("remote-debugging-port", "9222");

/* ---------------------------------------------------- */
/* Resize Browser Views                                 */
/* ---------------------------------------------------- */

async function updateBounds() {
  if (!win || win.isDestroyed() || !tabManager) return;

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

    tabManager.setBounds(bounds);
  } catch (err) {
    console.error("updateBounds error:", err);
  }
}

/* ---------------------------------------------------- */
/* Get Current HTML from active tab                     */
/* ---------------------------------------------------- */

async function getCurrentHTML() {
  const contents = tabManager?.getActiveWebContents();
  if (!contents) return "";

  try {
    return await contents.executeJavaScript("document.documentElement.outerHTML");
  } catch (e) {
    console.error("getCurrentHTML error:", e);
    return "";
  }
}

/* ---------------------------------------------------- */
/* Window Creation                                      */
/* ---------------------------------------------------- */

async function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    show: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);

  const sendWindowState = () => {
    if (!win.isDestroyed()) {
      win.webContents.send("window-maximized", win.isMaximized());
    }
  };
  win.on("maximize", sendWindowState);
  win.on("unmaximize", sendWindowState);

  // Initialize Tab Manager
  tabManager = new TabManager(win, {
    defaultUrl: "https://example.com",
  });

  // Create initial tab
  tabManager.createTab("https://example.com", true);

  // Load browser UI shell
  await win.loadFile(path.join(__dirname, "renderer", "index.html"));

  win.maximize();

  win.webContents.on("did-finish-load", () => {
    setTimeout(updateBounds, 300);
    tabManager.notifyTabsUpdated();
  });

  win.on("resize", updateBounds);

  console.log("Jarvis Browser Electron Ready");
}

/* ---------------------------------------------------- */
/* Tab Management IPC                                   */
/* ---------------------------------------------------- */

ipcMain.handle("tab-create", async (_, url) => {
  if (!tabManager) return null;
  const tab = tabManager.createTab(url, true);
  await updateBounds();
  return tab;
});

ipcMain.handle("tab-close", async (_, tabId) => {
  if (!tabManager) return false;
  const success = tabManager.closeTab(tabId);
  await updateBounds();
  return success;
});

ipcMain.handle("tab-switch", async (_, tabId) => {
  if (!tabManager) return null;
  const tab = tabManager.switchTab(tabId);
  await updateBounds();
  return tab;
});

ipcMain.handle("tab-list", async () => {
  if (!tabManager) return [];
  return tabManager.getAllTabs();
});

ipcMain.handle("tab-active", async () => {
  if (!tabManager) return null;
  return tabManager.getActiveTab();
});

ipcMain.handle("tab-stop", async () => {
  if (!tabManager) return false;
  return tabManager.stopActive();
});

/* ---------------------------------------------------- */
/* Navigation IPC                                       */
/* ---------------------------------------------------- */

ipcMain.handle("navigate", async (_, url) => {
  if (!tabManager) return false;
  return await tabManager.navigateActive(url);
});

ipcMain.handle("back", async () => {
  if (!tabManager) return false;
  return tabManager.backActive();
});

ipcMain.handle("forward", async () => {
  if (!tabManager) return false;
  return tabManager.forwardActive();
});

ipcMain.handle("reload", async () => {
  if (!tabManager) return false;
  return tabManager.reloadActive();
});

ipcMain.handle("resize-browser", async () => {
  await updateBounds();
  return true;
});

/* ---------------------------------------------------- */
/* Window Controls IPC                                  */
/* ---------------------------------------------------- */

ipcMain.handle("window-minimize", (event) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
  win.minimize();
  return true;
});

ipcMain.handle("window-toggle-maximize", (event) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
  return win.isMaximized();
});

ipcMain.handle("window-close", (event) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
  win.close();
  return true;
});

ipcMain.handle("window-is-maximized", (event) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
  return win.isMaximized();
});

/* ---------------------------------------------------- */
/* Active Page Content & Inspection IPC                 */
/* ---------------------------------------------------- */

ipcMain.handle("browser-html", async () => {
  return await getCurrentHTML();
});

ipcMain.handle("browser-url", async () => {
  const tab = tabManager?.getActiveTab();
  return tab ? tab.url : "";
});

ipcMain.handle("browser-execute", async (_, script) => {
  const contents = tabManager?.getActiveWebContents();
  if (!contents) return null;
  return await contents.executeJavaScript(script);
});

ipcMain.handle("browser-svg", async (_, options = {}) => {
  const contents = tabManager?.getActiveWebContents();
  if (!contents) return [];
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
          } catch (e) {}
        });

        return allResults;
      })();
    `;
    return await contents.executeJavaScript(script);
  } catch (err) {
    console.error("browser-svg error:", err);
    return [];
  }
});

ipcMain.handle("browser-container-data", async (_, selectorOrClass) => {
  const contents = tabManager?.getActiveWebContents();
  if (!contents) return [];
  try {
    const script = `
      (() => {
        const query = ${JSON.stringify(String(selectorOrClass || "").trim())};
        if (!query) return [];

        function extractSVGNode(sEl, sIdx) {
          const sRect = sEl.getBoundingClientRect();
          const paths = Array.from(sEl.querySelectorAll("path")).map((p, pIdx) => ({
            index: pIdx,
            d: p.getAttribute("d") || "",
            fill: p.getAttribute("fill") || p.style?.fill || undefined,
            stroke: p.getAttribute("stroke") || p.style?.stroke || undefined,
            id: p.id || undefined,
            className: p.getAttribute("class") || undefined,
          }));

          const texts = Array.from(sEl.querySelectorAll("text, tspan, title, desc")).map((t) => ({
            tagName: t.tagName.toLowerCase(),
            text: (t.textContent || "").trim(),
          })).filter((t) => t.text);

          return {
            index: sIdx,
            id: sEl.id || undefined,
            className: sEl.getAttribute("class") || undefined,
            width: Math.round(sRect.width) || undefined,
            height: Math.round(sRect.height) || undefined,
            text: texts.map((t) => t.text).join(" ") || (sEl.textContent || "").trim() || undefined,
            pathCount: paths.length,
            paths,
          };
        }

        function extractContainerFromDoc(doc, frameInfo = {}) {
          if (!doc) return [];
          const found = [];
          try {
            const direct = doc.querySelectorAll(query);
            if (direct.length) found.push(...direct);
          } catch {}

          const cleanQuery = query.replace(/^[.#]/, "");
          if (cleanQuery) {
            try {
              const byClass = doc.querySelectorAll(\`.\${cleanQuery}, [class~="\${cleanQuery}"], [class*="\${cleanQuery}"]\`);
              for (const el of byClass) {
                if (!found.includes(el)) found.push(el);
              }
            } catch {}
          }

          return found.map((el, i) => {
            const rect = el.getBoundingClientRect();
            const svgs = Array.from(el.querySelectorAll("svg")).map(extractSVGNode);
            const buttons = Array.from(el.querySelectorAll("button, [role='button']")).map((b) => ({
              text: (b.innerText || b.textContent || "").trim(),
              id: b.id || undefined,
              className: b.getAttribute("class") || undefined,
            }));

            return {
              index: i,
              tagName: el.tagName.toLowerCase(),
              id: el.id || undefined,
              className: el.getAttribute("class") || undefined,
              text: (el.innerText || el.textContent || "").trim(),
              svgCount: svgs.length,
              svgs,
              buttons: buttons.length ? buttons : undefined,
              boundingBox: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
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
    return await contents.executeJavaScript(script);
  } catch (err) {
    console.error("browser-container-data error:", err);
    return [];
  }
});

ipcMain.handle("browser-dismiss-popup", async () => {
  const contents = tabManager?.getActiveWebContents();
  if (!contents) return { dismissed: false, count: 0 };
  try {
    const script = `
      (() => {
        let count = 0;
        function scanDoc(doc) {
          if (!doc) return 0;
          let c = 0;
          const buttons = Array.from(
            doc.querySelectorAll('button, [role="button"], .btn, input[type="button"]')
          );
          for (const btn of buttons) {
            try {
              const style = window.getComputedStyle(btn);
              if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
              const rawText = (btn.innerText || btn.textContent || btn.value || "").trim().toLowerCase();
              if (/^(?:ok|okay|continue|resume|got it|close|dismiss|i'm here)$/i.test(rawText)) {
                btn.click();
                c++;
                if (c >= 2) break;
              }
            } catch (e) {}
          }
          return c;
        }
        return scanDoc(document);
      })();
    `;
    const count = await contents.executeJavaScript(script);
    return { dismissed: count > 0, count };
  } catch (err) {
    return { dismissed: false, count: 0, error: err.message };
  }
});

/* ---------------------------------------------------- */
/* App Lifecycle                                        */
/* ---------------------------------------------------- */

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
