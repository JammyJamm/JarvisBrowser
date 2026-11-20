//==========================================================
//
// main/renderer/browser.js
//
// Browser Navigation Controller
//
// Handles Address Bar, Back/Forward/Reload,
// and Backend active-page synchronization.
//
//==========================================================

(() => {
  const BACKEND_URL = window.aiState?.backendUrl || "http://localhost:9000";

  function getBrowserAPI() {
    return window.browserAPI || null;
  }

  function formatURL(raw) {
    let url = String(raw || "").trim();
    if (!url) return "https://google.com";

    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://")) {
      return url;
    }

    // If it looks like a domain name without spaces
    if (url.includes(".") && !url.includes(" ") && !url.startsWith("?")) {
      return "https://" + url;
    }

    // Otherwise treat as a Google search query
    return "https://www.google.com/search?q=" + encodeURIComponent(url);
  }

  async function navigate(targetUrl) {
    const api = getBrowserAPI();
    const input = document.getElementById("url");
    const raw = targetUrl || (input ? input.value : "");
    const formatted = formatURL(raw);

    if (input) {
      input.value = formatted;
    }

    if (api && typeof api.navigate === "function") {
      try {
        await api.navigate(formatted);
      } catch (err) {
        console.error("Navigation error:", err);
      }
    }

    // Synchronize active URL to backend for Playwright
    notifyBackendActiveTab(formatted);
  }

  async function goBack() {
    const api = getBrowserAPI();
    if (api && typeof api.back === "function") {
      await api.back();
    }
  }

  async function goForward() {
    const api = getBrowserAPI();
    if (api && typeof api.forward === "function") {
      await api.forward();
    }
  }

  async function reloadPage() {
    const api = getBrowserAPI();
    if (api && typeof api.reload === "function") {
      await api.reload();
    }
  }

  async function notifyBackendActiveTab(url, title = "", tabId = "") {
    try {
      await fetch(`${BACKEND_URL}/active-tab`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, title, tabId }),
      });
    } catch (e) {
      // Backend may be starting or offline
    }
  }

  // Setup Event Listeners
  function setupNavigationUI() {
    const urlInput = document.getElementById("url");
    const navBtn = document.getElementById("navigateButton");
    const backBtn = document.getElementById("backButton");
    const forwardBtn = document.getElementById("forwardButton");
    const reloadBtn = document.getElementById("reloadButton");

    if (urlInput) {
      urlInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          navigate();
        }
      });
      urlInput.addEventListener("focus", () => urlInput.select());
    }

    if (navBtn) {
      navBtn.addEventListener("click", () => navigate());
    }

    if (backBtn) {
      backBtn.onclick = goBack;
    }

    if (forwardBtn) {
      forwardBtn.onclick = goForward;
    }

    if (reloadBtn) {
      reloadBtn.onclick = reloadPage;
    }

    // Listen to URL changes from main
    const api = getBrowserAPI();
    if (api && typeof api.onURLChanged === "function") {
      api.onURLChanged((url, details) => {
        if (urlInput && document.activeElement !== urlInput) {
          urlInput.value = url;
        }
        notifyBackendActiveTab(url, details?.title || "", details?.tabId || "");
      });
    }
  }

  // Expose globally for HTML onclick and AI agent
  window.navigate = navigate;
  window.goBack = goBack;
  window.goForward = goForward;
  window.reloadPage = reloadPage;
  window.formatURL = formatURL;
  window.notifyBackendActiveTab = notifyBackendActiveTab;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupNavigationUI);
  } else {
    setupNavigationUI();
  }
})();
