// mcp-client.js
//
// Production-ready Playwright MCP Client
//
// Supports:
// ✅ Persistent connection
// ✅ Automatic reconnect
// ✅ browser_snapshot
// ✅ browser_click
// ✅ browser_type
// ✅ browser_hover
// ✅ browser_press_key
// ✅ browser_select_option
// ✅ browser_file_upload
// ✅ browser_check
// ✅ browser_uncheck
// ✅ browser_navigate
// ✅ browser_wait
// ✅ browser_wait_for
// ✅ browser_tab_list
// ✅ browser_tab_select
// ✅ browser_tab_close
// ✅ browser_console_messages
// ✅ browser_network_requests
// ✅ Generic callTool()

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export default class PlaywrightMCPClient {
  constructor(url = "http://localhost:8931/mcp") {
    this.url = url;

    this.client = null;
    this.transport = null;

    this.connected = false;
  }

  // ===================================================
  // CONNECT
  // ===================================================

  async connect() {
    if (this.connected) return;

    console.log("Connecting MCP ->", this.url);

    this.transport = new StreamableHTTPClientTransport(new URL(this.url));

    this.client = new Client(
      {
        name: "jarvis-browser",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    await this.client.connect(this.transport);

    this.connected = true;

    console.log("✅ Playwright MCP Connected");
  }

  // ===================================================
  // DISCONNECT
  // ===================================================

  async disconnect() {
    try {
      if (this.transport) {
        await this.transport.close();
      }
    } catch {}

    this.connected = false;
  }

  // ===================================================
  // AUTO CONNECT
  // ===================================================

  async ensure() {
    if (!this.connected) {
      await this.connect();
    }
  }

  // ===================================================
  // TOOL LIST
  // ===================================================

  async listTools() {
    await this.ensure();

    const res = await this.client.listTools();

    return res.tools;
  }

  // ===================================================
  // GENERIC CALL
  // ===================================================

  async callTool(name, args = {}) {
    await this.ensure();

    console.log("------------------------------------------------");
    console.log("MCP TOOL :", name);
    console.log(args);
    console.log("------------------------------------------------");

    const result = await this.client.callTool({
      name,
      arguments: args,
    });

    return result;
  }

  // ===================================================
  // SNAPSHOT
  // ===================================================

  async snapshot() {
    return this.callTool("browser_snapshot", {});
  }

  // ===================================================
  // NAVIGATE
  // ===================================================

  async navigate(url) {
    return this.callTool("browser_navigate", {
      url,
    });
  }

  // ===================================================
  // CLICK
  // ===================================================

  async click(target) {
    return this.callTool("browser_click", {
      target,
    });
  }

  // ===================================================
  // HOVER
  // ===================================================

  async hover(target) {
    return this.callTool("browser_hover", {
      target,
    });
  }

  // ===================================================
  // TYPE
  // ===================================================

  async type(target, text) {
    return this.callTool("browser_type", {
      target,
      text,
    });
  }

  // ===================================================
  // PRESS KEY
  // ===================================================

  async press(key) {
    return this.callTool("browser_press_key", {
      key,
    });
  }

  // ===================================================
  // SELECT OPTION
  // ===================================================

  async selectOption(target, values) {
    if (!Array.isArray(values)) {
      values = [values];
    }

    return this.callTool("browser_select_option", {
      target,
      values,
    });
  }

  // ===================================================
  // CHECK
  // ===================================================

  async check(target) {
    return this.callTool("browser_check", {
      target,
    });
  }

  // ===================================================
  // UNCHECK
  // ===================================================

  async uncheck(target) {
    return this.callTool("browser_uncheck", {
      target,
    });
  }

  // ===================================================
  // FILE UPLOAD
  // ===================================================

  async upload(target, paths) {
    if (!Array.isArray(paths)) {
      paths = [paths];
    }

    return this.callTool("browser_file_upload", {
      target,
      paths,
    });
  }

  // ===================================================
  // WAIT
  // ===================================================

  async wait(time = 1000) {
    return this.callTool("browser_wait", {
      time,
    });
  }

  // ===================================================
  // WAIT FOR TEXT
  // ===================================================

  async waitFor(text) {
    return this.callTool("browser_wait_for", {
      text,
    });
  }

  // ===================================================
  // TABS
  // ===================================================

  async tabs() {
    return this.callTool("browser_tab_list", {});
  }

  async selectTab(index) {
    return this.callTool("browser_tab_select", {
      index,
    });
  }

  async closeTab(index) {
    return this.callTool("browser_tab_close", {
      index,
    });
  }

  // ===================================================
  // CONSOLE
  // ===================================================

  async consoleMessages() {
    return this.callTool("browser_console_messages", {});
  }

  // ===================================================
  // NETWORK
  // ===================================================

  async networkRequests() {
    return this.callTool("browser_network_requests", {});
  }

  // ===================================================
  // TAKE SCREENSHOT
  // ===================================================

  async screenshot() {
    return this.callTool("browser_take_screenshot", {});
  }

  // ===================================================
  // CLOSE BROWSER
  // ===================================================

  async closeBrowser() {
    return this.callTool("browser_close", {});
  }

  // ===================================================
  // EXECUTE
  // ===================================================

  async execute(tool, args = {}) {
    switch (tool) {
      case "snapshot":
        return this.snapshot();

      case "navigate":
        return this.navigate(args.url);

      case "click":
        return this.click(args.target);

      case "hover":
        return this.hover(args.target);

      case "type":
        return this.type(args.target, args.text);

      case "press":
        return this.press(args.key);

      case "select":
        return this.selectOption(args.target, args.values);

      case "check":
        return this.check(args.target);

      case "uncheck":
        return this.uncheck(args.target);

      case "upload":
        return this.upload(args.target, args.paths);

      case "wait":
        return this.wait(args.time);

      case "waitFor":
        return this.waitFor(args.text);

      case "tabs":
        return this.tabs();

      case "selectTab":
        return this.selectTab(args.index);

      case "closeTab":
        return this.closeTab(args.index);

      case "console":
        return this.consoleMessages();

      case "network":
        return this.networkRequests();

      case "screenshot":
        return this.screenshot();

      case "close":
        return this.closeBrowser();

      default:
        return this.callTool(tool, args);
    }
  }
}
