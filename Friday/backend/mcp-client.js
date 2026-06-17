import { chromium } from "playwright";

class PlaywrightClient {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.connected = false;
  }

  // ==========================================
  // CONNECT TO ELECTRON
  // ==========================================

  async connect() {
    if (this.page) return;

    this.browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

    for (const context of this.browser.contexts()) {
      for (const page of context.pages()) {
        console.log("PAGE FOUND:", page.url());
      }
    }

    const context = this.browser.contexts()[0];
    const pages = context.pages();

    // const context = this.browser.contexts()[0];

    for (const p of context.pages()) {
      const url = p.url();

      console.log("FOUND:", url);

      if (!url.includes("renderer/index.html") && !url.startsWith("file://")) {
        this.page = p;
        break;
      }
    }

    if (!this.page) {
      throw new Error("Could not find browser page");
    }

    console.log("ATTACHED TO:", this.page.url());
  }

  // ==========================================
  // PAGE
  // ==========================================
  async getRealBrowserPage() {
    await this.connect();

    for (const context of this.browser.contexts()) {
      for (const page of context.pages()) {
        const url = page.url();

        if (!url.startsWith("file://") && !url.includes("renderer")) {
          return page;
        }
      }
    }

    throw new Error("No browser page found");
  }
  async getPage() {
    await this.connect();
    return this.page;
  }

  // ==========================================
  // DEBUG
  // ==========================================

  async html() {
    const page = await this.getPage();

    return await page.content();
  }

  async snapshot() {
    const page = await this.getPage();

    return {
      html: await page.content(),
      text: await page.evaluate(() => document.body?.innerText || ""),
      title: await page.title(),
      url: page.url(),
    };
  }

  // ==========================================
  // CLICK
  // ==========================================

  async clickByText(text) {
    const page = await this.getPage();

    console.log("=================================");
    console.log("Current URL:", page.url());

    const links = await page.locator("a").allTextContents();
    console.log("LINKS:", links);

    const buttons = await page.locator("button").allTextContents();
    console.log("BUTTONS:", buttons);

    console.log("Searching for:", text);
    console.log("=================================");

    return await page.getByText(text, { exact: false }).first().click();
  }

  async click(label) {
    console.log("CLICK REQUEST:", label);

    const page = await this.mcp.getPage();

    console.log("Page URL:", page.url());

    return await this.mcp.clickByText(label);
  }

  // ==========================================
  // TYPE
  // ==========================================

  async type(selector, value) {
    const page = await this.getPage();

    const locator = page.locator(selector).first();

    await locator.waitFor({
      timeout: 5000,
    });

    await locator.fill(value);

    return {
      success: true,
      action: "type",
      selector,
      value,
    };
  }

  async typeByLabel(label, value) {
    const page = await this.getPage();

    const locator = page
      .getByLabel(label, {
        exact: false,
      })
      .first();

    await locator.fill(value);

    return {
      success: true,
      action: "type",
      label,
      value,
    };
  }

  // ==========================================
  // HOVER
  // ==========================================

  async hoverByText(text) {
    const page = await this.getPage();

    await page
      .getByText(text, {
        exact: false,
      })
      .first()
      .hover();

    return {
      success: true,
      action: "hover",
      text,
    };
  }

  // ==========================================
  // SELECT
  // ==========================================

  async selectOption(selector, value) {
    const page = await this.getPage();

    await page.locator(selector).first().selectOption(value);

    return {
      success: true,
      action: "select",
      selector,
      value,
    };
  }

  // ==========================================
  // KEYBOARD
  // ==========================================

  async press(key) {
    const page = await this.getPage();

    await page.keyboard.press(key);

    return {
      success: true,
      action: "press",
      key,
    };
  }

  // ==========================================
  // WAIT
  // ==========================================

  async wait(ms = 1000) {
    await new Promise((resolve) => setTimeout(resolve, ms));

    return {
      success: true,
      action: "wait",
      ms,
    };
  }

  // ==========================================
  // NAVIGATION
  // ==========================================

  async navigate(url) {
    const page = await this.getPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
    });

    return {
      success: true,
      action: "navigate",
      url,
    };
  }

  async reload() {
    const page = await this.getPage();

    await page.reload({
      waitUntil: "domcontentloaded",
    });

    return {
      success: true,
      action: "reload",
    };
  }

  async back() {
    const page = await this.getPage();

    await page.goBack();

    return {
      success: true,
      action: "back",
    };
  }
  async debugPages() {
    await this.connect();

    const pages = this.context.pages();

    console.log("\n========== PLAYWRIGHT PAGES ==========");

    for (const p of pages) {
      console.log(p.url());
    }

    for (const page of this.context.pages()) {
      console.log({
        url: page.url(),
        title: await page.title().catch(() => ""),
      });
    }
    this.page = pages.find((p) => p.url().startsWith("http")) || pages[0];

    console.log("=====================================\n");
  }
  async forward() {
    const page = await this.getPage();

    await page.goForward();

    return {
      success: true,
      action: "forward",
    };
  }

  // ==========================================
  // TOOLS (compatibility with old server.js)
  // ==========================================

  async listTools() {
    return [
      { name: "click" },
      { name: "type" },
      { name: "hover" },
      { name: "select" },
      { name: "press" },
      { name: "wait" },
      { name: "navigate" },
      { name: "snapshot" },
      { name: "html" },
    ];
  }
}

export default PlaywrightClient;
