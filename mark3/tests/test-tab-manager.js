//==========================================================
//
// tests/test-tab-manager.js
//
// Unit tests for TabManager (Chrome-like Tab Controller)
//
//==========================================================

const assert = require("assert");

// Mock Electron WebContentsView & Window
class MockWebContents {
  constructor() {
    this._url = "about:blank";
    this._title = "New Tab";
    this._destroyed = false;
    this._history = [];
    this._historyIndex = -1;
  }
  async loadURL(url) {
    this._url = url;
    this._history.push(url);
    this._historyIndex++;
    return true;
  }
  getURL() { return this._url; }
  getTitle() { return this._title; }
  isDestroyed() { return this._destroyed; }
  canGoBack() { return this._historyIndex > 0; }
  canGoForward() { return this._historyIndex < this._history.length - 1; }
  goBack() { if (this.canGoBack()) this._historyIndex--; }
  goForward() { if (this.canGoForward()) this._historyIndex++; }
  reload() {}
  stop() {}
  close() { this._destroyed = true; }
  on() {}
}

class MockWebContentsView {
  constructor() {
    this.webContents = new MockWebContents();
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
  }
  setBounds(bounds) { this.bounds = bounds; }
}

const mockElectron = {
  WebContentsView: MockWebContentsView,
};

// Mock require cache for electron
require.cache[require.resolve("electron")] = {
  exports: mockElectron,
};

const TabManager = require("../main/tab-manager.js");

function runTabManagerTests() {
  console.log("--- Starting TabManager Unit Tests ---");

  const mockWin = {
    isDestroyed: () => false,
    contentView: {
      addChildView: () => {},
      removeChildView: () => {},
    },
    webContents: {
      send: () => {},
    },
  };

  const manager = new TabManager(mockWin, { defaultUrl: "https://example.com" });

  // Test 1: Create Initial Tab
  console.log("Test 1: Create Tab");
  const tab1 = manager.createTab("https://example.com", true);
  assert.strictEqual(tab1.url, "https://example.com");
  assert.strictEqual(tab1.isActive, true);
  assert.strictEqual(manager.getAllTabs().length, 1);
  console.log("  PASSED");

  // Test 2: Create Second Tab & Switch
  console.log("Test 2: Create Second Tab & Switch");
  const tab2 = manager.createTab("https://github.com", true);
  assert.strictEqual(tab2.url, "https://github.com");
  assert.strictEqual(manager.activeTabId, tab2.id);
  assert.strictEqual(manager.getAllTabs().length, 2);
  console.log("  PASSED");

  // Test 3: Switch back to Tab 1
  console.log("Test 3: Switch Tab");
  const switched = manager.switchTab(tab1.id);
  assert.strictEqual(switched.id, tab1.id);
  assert.strictEqual(switched.isActive, true);
  assert.strictEqual(manager.getActiveTab().id, tab1.id);
  console.log("  PASSED");

  // Test 4: Close Tab 1, active tab falls back to Tab 2
  console.log("Test 4: Close Tab with Fallback");
  manager.closeTab(tab1.id);
  assert.strictEqual(manager.getAllTabs().length, 1);
  assert.strictEqual(manager.activeTabId, tab2.id);
  console.log("  PASSED");

  // Test 5: Bounds update
  console.log("Test 5: Bounds Management");
  manager.setBounds({ x: 0, y: 40, width: 1400, height: 800 });
  assert.strictEqual(manager.bounds.width, 1400);
  console.log("  PASSED");

  console.log("=== All TabManager Unit Tests Passed Successfully ===");
}

try {
  runTabManagerTests();
} catch (err) {
  console.error("TabManager test failed:", err);
  process.exit(1);
}
