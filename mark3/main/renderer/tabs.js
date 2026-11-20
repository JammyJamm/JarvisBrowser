//==========================================================
//
// main/renderer/tabs.js
//
// Chrome-like Tab Bar Controller
//
// Handles tab strip rendering, active tab indication,
// loading animations, close buttons, and tab lifecycle events.
//
//==========================================================

(() => {
  let currentTabs = [];
  let currentActiveTabId = null;

  function getBrowserAPI() {
    return window.browserAPI || null;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderTabs(tabs, activeTabId) {
    currentTabs = tabs || [];
    currentActiveTabId = activeTabId;

    const container = document.getElementById("tabs");
    if (!container) return;

    container.innerHTML = "";

    currentTabs.forEach((tab) => {
      const tabEl = document.createElement("div");
      tabEl.className = "browser-tab " + (tab.id === currentActiveTabId ? "active" : "");
      tabEl.dataset.tabId = tab.id;
      tabEl.setAttribute("role", "tab");
      tabEl.setAttribute("aria-selected", tab.id === currentActiveTabId ? "true" : "false");
      tabEl.title = tab.title || tab.url || "New Tab";

      // Tab Icon / Spinner
      const iconWrap = document.createElement("span");
      iconWrap.className = "tab-icon";
      if (tab.isLoading) {
        iconWrap.innerHTML = `<span class="tab-spinner"></span>`;
      } else {
        iconWrap.innerHTML = `<svg class="feather-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
      }
      tabEl.appendChild(iconWrap);

      // Title
      const titleEl = document.createElement("span");
      titleEl.className = "tab-title";
      titleEl.textContent = tab.title || "New Tab";
      tabEl.appendChild(titleEl);

      // Close Button
      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close-btn";
      closeBtn.type = "button";
      closeBtn.title = "Close tab";
      closeBtn.setAttribute("aria-label", "Close tab");
      closeBtn.innerHTML = `&times;`;

      closeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const api = getBrowserAPI();
        if (api && typeof api.closeTab === "function") {
          await api.closeTab(tab.id);
        }
      });

      tabEl.appendChild(closeBtn);

      // Tab Click -> Switch
      tabEl.addEventListener("click", async () => {
        if (tab.id !== currentActiveTabId) {
          const api = getBrowserAPI();
          if (api && typeof api.switchTab === "function") {
            await api.switchTab(tab.id);
          }
        }
      });

      // Middle Click -> Close
      tabEl.addEventListener("auxclick", async (e) => {
        if (e.button === 1) {
          e.preventDefault();
          const api = getBrowserAPI();
          if (api && typeof api.closeTab === "function") {
            await api.closeTab(tab.id);
          }
        }
      });

      container.appendChild(tabEl);
    });

    // Update active tab URL input and nav buttons
    const activeTab = currentTabs.find((t) => t.id === currentActiveTabId);
    if (activeTab) {
      const urlInput = document.getElementById("url");
      if (urlInput && document.activeElement !== urlInput) {
        urlInput.value = activeTab.url || "";
      }

      updateNavButtons(activeTab);

      if (typeof window.notifyBackendActiveTab === "function" && activeTab.url) {
        window.notifyBackendActiveTab(activeTab.url, activeTab.title, activeTab.id);
      }
    }
  }

  function updateNavButtons(activeTab) {
    const backBtn = document.getElementById("backButton");
    const forwardBtn = document.getElementById("forwardButton");
    const reloadBtn = document.getElementById("reloadButton");

    if (backBtn) {
      backBtn.disabled = !activeTab.canGoBack;
      backBtn.style.opacity = activeTab.canGoBack ? "1" : "0.5";
    }

    if (forwardBtn) {
      forwardBtn.disabled = !activeTab.canGoForward;
      forwardBtn.style.opacity = activeTab.canGoForward ? "1" : "0.5";
    }

    if (reloadBtn) {
      const icon = reloadBtn.querySelector("span");
      if (icon) {
        if (activeTab.isLoading) {
          reloadBtn.title = "Stop";
          reloadBtn.classList.add("loading");
        } else {
          reloadBtn.title = "Reload";
          reloadBtn.classList.remove("loading");
        }
      }
    }
  }

  // Hook new tab button
  const newTabBtn = document.getElementById("newTabButton");
  if (newTabBtn) {
    newTabBtn.addEventListener("click", async () => {
      const api = getBrowserAPI();
      if (api && typeof api.createTab === "function") {
        await api.createTab("https://example.com");
      }
    });
  }

  // Listen to IPC events from main process
  function setupTabListeners() {
    const api = getBrowserAPI();
    if (!api) return;

    if (typeof api.onTabsUpdated === "function") {
      api.onTabsUpdated(({ tabs, activeTabId }) => {
        renderTabs(tabs, activeTabId);
      });
    }

    if (typeof api.onTabLoadingState === "function") {
      api.onTabLoadingState(({ tabId, isLoading }) => {
        const tab = currentTabs.find((t) => t.id === tabId);
        if (tab) {
          tab.isLoading = isLoading;
          renderTabs(currentTabs, currentActiveTabId);
        }
      });
    }

    // Initial load of tabs
    if (typeof api.getTabs === "function") {
      api.getTabs().then((tabs) => {
        if (Array.isArray(tabs) && tabs.length) {
          const active = tabs.find((t) => t.isActive);
          renderTabs(tabs, active ? active.id : tabs[0].id);
        }
      });
    }
  }

  // Keyboard shortcuts
  window.addEventListener("keydown", async (e) => {
    const api = getBrowserAPI();
    if (!api) return;

    // Ctrl + T / Cmd + T: New Tab
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") {
      e.preventDefault();
      if (typeof api.createTab === "function") {
        await api.createTab("https://example.com");
      }
    }

    // Ctrl + W / Cmd + W: Close Tab
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
      e.preventDefault();
      if (currentActiveTabId && typeof api.closeTab === "function") {
        await api.closeTab(currentActiveTabId);
      }
    }

    // Ctrl + R / F5: Reload
    if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") || e.key === "F5") {
      e.preventDefault();
      if (typeof api.reload === "function") {
        await api.reload();
      }
    }
  });

  // Export functions
  window.tabsController = {
    renderTabs,
    getTabs: () => currentTabs,
    getActiveTabId: () => currentActiveTabId,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupTabListeners);
  } else {
    setupTabListeners();
  }
})();
