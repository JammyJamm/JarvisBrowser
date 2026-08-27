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

        function extractSVGNode(sEl, sIdx) {
          const sRect = sEl.getBoundingClientRect();
          const paths = Array.from(sEl.querySelectorAll("path")).map((p, pIdx) => ({
            index: pIdx,
            d: p.getAttribute("d") || "",
            fill: p.getAttribute("fill") || p.style?.fill || undefined,
            stroke: p.getAttribute("stroke") || p.style?.stroke || undefined,
            strokeWidth: p.getAttribute("stroke-width") || p.style?.strokeWidth || undefined,
            id: p.id || undefined,
            className: p.getAttribute("class") || undefined,
            transform: p.getAttribute("transform") || undefined,
            ariaLabel: p.getAttribute("aria-label") || undefined,
          }));

          const shapes = Array.from(sEl.querySelectorAll("circle, rect, ellipse, polygon, polyline, line")).map((sh) => ({
            tagName: sh.tagName.toLowerCase(),
            id: sh.id || undefined,
            className: sh.getAttribute("class") || undefined,
            fill: sh.getAttribute("fill") || undefined,
            stroke: sh.getAttribute("stroke") || undefined,
            transform: sh.getAttribute("transform") || undefined,
            cx: sh.getAttribute("cx") || undefined,
            cy: sh.getAttribute("cy") || undefined,
            r: sh.getAttribute("r") || undefined,
            x: sh.getAttribute("x") || undefined,
            y: sh.getAttribute("y") || undefined,
            width: sh.getAttribute("width") || undefined,
            height: sh.getAttribute("height") || undefined,
            points: sh.getAttribute("points") || undefined,
          }));

          const texts = Array.from(sEl.querySelectorAll("text, tspan, title, desc")).map((t) => ({
            tagName: t.tagName.toLowerCase(),
            text: (t.textContent || "").trim(),
            x: t.getAttribute("x") || undefined,
            y: t.getAttribute("y") || undefined,
            fill: t.getAttribute("fill") || undefined,
            fontSize: t.getAttribute("font-size") || undefined,
            transform: t.getAttribute("transform") || undefined,
          })).filter((t) => t.text);

          const groups = [];
          const dynamicTransforms = [];
          const groupNodes = sEl.querySelectorAll("g");
          for (let g = 0; g < groupNodes.length; g++) {
            const gEl = groupNodes[g];
            const tr = gEl.getAttribute("transform") || gEl.style?.transform || "";
            if (tr) dynamicTransforms.push(tr);
            if (tr || gEl.id || gEl.getAttribute("class")) {
              groups.push({
                index: g,
                id: gEl.id || undefined,
                className: gEl.getAttribute("class") || undefined,
                transform: tr || undefined,
                ariaLabel: gEl.getAttribute("aria-label") || undefined,
              });
            }
          }

          const rootTransform = sEl.getAttribute("transform") || sEl.style?.transform || "";
          if (rootTransform) dynamicTransforms.push(rootTransform);

          const directText = (sEl.textContent || "").replace(/\\s+/g, " ").trim();
          const allTextJoined = [directText, ...texts.map((t) => t.text)].join(" ");
          const numbers = (allTextJoined.match(/-?\\d+(?:\\.\\d+)?(?:x|%|\\$|€|£)?/g) || [])
            .map((n) => n.trim())
            .filter((v, idx, arr) => arr.indexOf(v) === idx);

          let rotationAngle = undefined;
          for (const tr of dynamicTransforms) {
            const rotMatch = tr.match(/rotate\\(\\s*(-?\\d+(?:\\.\\d+)?)/i);
            if (rotMatch) {
              rotationAngle = parseFloat(rotMatch[1]);
              break;
            }
          }

          return {
            index: sIdx,
            id: sEl.id || undefined,
            className: sEl.getAttribute("class") || undefined,
            viewBox: sEl.getAttribute("viewBox") || undefined,
            width: sEl.getAttribute("width") || Math.round(sRect.width) || undefined,
            height: sEl.getAttribute("height") || Math.round(sRect.height) || undefined,
            transform: rootTransform || undefined,
            boundingBox: {
              x: Math.round(sRect.x),
              y: Math.round(sRect.y),
              width: Math.round(sRect.width),
              height: Math.round(sRect.height),
            },
            text: texts.map((t) => t.text).join(" ") || directText || undefined,
            texts: texts.length ? texts : undefined,
            pathCount: paths.length,
            paths,
            shapeCount: shapes.length,
            shapes,
            groupCount: groups.length ? groups.length : undefined,
            groups: groups.length ? groups : undefined,
            dynamicValues: {
              numbers,
              rotationAngle,
              transforms: dynamicTransforms.length ? dynamicTransforms : undefined,
              summary: directText || (texts.length ? texts.map((t) => t.text).join(", ") : undefined),
            },
            timestamp: new Date().toISOString(),
            outerHTML: sEl.outerHTML,
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
            try {
              const byId = doc.querySelectorAll(\`#\${cleanQuery}, [id*="\${cleanQuery}"]\`);
              for (const el of byId) {
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

            const inputs = Array.from(el.querySelectorAll("input, select, textarea")).map((inp) => ({
              tagName: inp.tagName.toLowerCase(),
              type: inp.type || undefined,
              name: inp.name || undefined,
              value: inp.value || undefined,
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
              inputs: inputs.length ? inputs : undefined,
              boundingBox: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
              timestamp: new Date().toISOString(),
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
/* NEW: Dismiss Inactivity Popups in BrowserView        */
/* ---------------------------------------------------- */

ipcMain.handle("browser-dismiss-popup", async () => {
  if (!browserView) return { dismissed: false, count: 0 };
  try {
    const script = `
      (() => {
        let count = 0;
        const keywords = ["ok", "start", "continue", "resume", "play", "yes", "confirm", "i'm here", "i am here", "keep playing"];
        
        function scanDoc(doc) {
          if (!doc) return 0;
          let c = 0;
          const buttons = Array.from(doc.querySelectorAll('button, [role="button"], .btn, input[type="button"], input[type="submit"]'));
          for (const btn of buttons) {
            const style = window.getComputedStyle(btn);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
            const txt = (btn.innerText || btn.textContent || btn.value || "").trim().toLowerCase();
            const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
            const cls = (btn.className || "").toLowerCase();
            const id = (btn.id || "").toLowerCase();
            if (keywords.some(k => txt === k || txt.startsWith(k + " ") || txt.includes(k)) || /inactivity|resume|dialog-ok|continue-btn/i.test(cls + " " + id + " " + ariaLabel)) {
              btn.click();
              c++;
            }
          }
          const iframes = Array.from(doc.querySelectorAll("iframe"));
          for (const iframe of iframes) {
            try {
              const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (iDoc) c += scanDoc(iDoc);
            } catch (e) {}
          }
          return c;
        }

        return scanDoc(document);
      })();
    `;
    const count = await browserView.webContents.executeJavaScript(script);
    return { dismissed: count > 0, count };
  } catch (err) {
    console.error("browser-dismiss-popup error:", err);
    return { dismissed: false, count: 0, error: err.message };
  }
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
