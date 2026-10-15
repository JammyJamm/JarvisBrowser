let currentWebview = null;

function renderBrowser() {
  const container = document.getElementById("browser");
  container.innerHTML = "";

  const tab = tabs.find((t) => t.id === activeTab);

  const webview = document.createElement("webview");
  webview.src = tab.url;
  webview.style.width = "100%";
  webview.style.height = "100%";

  currentWebview = webview;

  // ✅ Debugging
  webview.addEventListener("dom-ready", () => {
    webview.openDevTools();
  });

  // ✅ MAIN LOGIC: After page loads → extract body
  webview.addEventListener("did-finish-load", async () => {
    try {
      console.log("Page Loaded:", tab.url);

      const data = await webview.executeJavaScript(`
        ({
          title: document.title,
          body: document.body.innerText.slice(0, 2000),
          links: [...document.querySelectorAll("a")].map(a => a.innerText).slice(0,20),
          buttons: [...document.querySelectorAll("button")].map(b => b.innerText).slice(0,20),
          svgCount: document.querySelectorAll("svg").length,
          iframeCount: document.querySelectorAll("iframe").length
        })
      `);

      console.log("PAGE DATA:", data);

      // ✅ Show in UI (optional)
      const logs = document.getElementById("logs");
      //   if (logs) {
      //     logs.innerText = "Title: " + data.title + "\n\n" + data.body;
      //   }

      // 👉 Ready for AI (next step)
      // sendToAI(data);
    } catch (err) {
      console.error("Error extracting page:", err);
    }
  });

  container.appendChild(webview);
}

function normalizeNavigationTarget(rawValue) {
  const value = String(rawValue || "").trim();

  if (!value) {
    return "about:blank";
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (/^(?:about:|\/|#|app:|file:)/i.test(value)) {
    return value;
  }

  if (/^www\./i.test(value)) {
    return `https://${value}`;
  }

  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(value)) {
    return `https://${value}`;
  }

  return "about:blank";
}

function navigate() {
  const url = normalizeNavigationTarget(document.getElementById("url").value);

  const tab = tabs.find((t) => t.id === activeTab);
  tab.url = url;

  renderBrowser();
}

window.navigate = navigate;
