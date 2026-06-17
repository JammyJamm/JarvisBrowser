// resolver.js

export default class Resolver {
  constructor(mcp) {
    this.mcp = mcp;
  }

  // ---------------------------------------
  // CLICK BY VISIBLE TEXT
  // ---------------------------------------

  async click(label) {
    return await this.mcp.clickByText(label);
  }

  // ---------------------------------------
  // TYPE
  // field should be a Playwright selector
  // ---------------------------------------

  async type(field, value) {
    return await this.mcp.type(field, value);
  }

  // ---------------------------------------
  // SELECT OPTION
  // ---------------------------------------

  async select(field, value) {
    const page = await this.mcp.getPage();

    return await page.locator(field).selectOption(value);
  }

  // ---------------------------------------
  // HOVER
  // ---------------------------------------

  async hover(text) {
    const page = await this.mcp.getPage();

    return await page
      .getByText(text, {
        exact: false,
      })
      .first()
      .hover();
  }

  // ---------------------------------------
  // CHECK
  // ---------------------------------------

  async check(selector) {
    const page = await this.mcp.getPage();

    return await page.locator(selector).check();
  }

  // ---------------------------------------
  // UNCHECK
  // ---------------------------------------

  async uncheck(selector) {
    const page = await this.mcp.getPage();

    return await page.locator(selector).uncheck();
  }

  // ---------------------------------------
  // FILE UPLOAD
  // ---------------------------------------

  async upload(selector, path) {
    const page = await this.mcp.getPage();

    return await page.locator(selector).setInputFiles(path);
  }

  // ---------------------------------------
  // PRESS KEY
  // ---------------------------------------

  async press(key) {
    return await this.mcp.press(key);
  }

  // ---------------------------------------
  // WAIT
  // ---------------------------------------

  async wait(time = 1000) {
    return new Promise((resolve) => {
      setTimeout(resolve, time);
    });
  }

  // ---------------------------------------
  // NAVIGATE
  // ---------------------------------------

  async navigate(url) {
    return await this.mcp.navigate(url);
  }

  // ---------------------------------------
  // SNAPSHOT
  // ---------------------------------------

  async snapshot() {
    return await this.mcp.snapshot();
  }

  // ---------------------------------------
  // HTML
  // ---------------------------------------

  async html() {
    return await this.mcp.html();
  }

  // ---------------------------------------
  // READ TEXT
  // ---------------------------------------

  async read(text) {
    const page = await this.mcp.getPage();

    const locator = page
      .getByText(text, {
        exact: false,
      })
      .first();

    const value = await locator.textContent();

    return {
      success: true,
      text: value,
    };
  }

  // ---------------------------------------
  // RETRY CLICK
  // ---------------------------------------

  async clickRetry(label, retries = 3) {
    let lastError;

    for (let i = 0; i < retries; i++) {
      try {
        return await this.click(label);
      } catch (err) {
        lastError = err;

        await this.wait(500);
      }
    }

    throw lastError;
  }

  // ---------------------------------------
  // RETRY TYPE
  // ---------------------------------------

  async typeRetry(field, value, retries = 3) {
    let lastError;

    for (let i = 0; i < retries; i++) {
      try {
        return await this.type(field, value);
      } catch (err) {
        lastError = err;

        await this.wait(500);
      }
    }

    throw lastError;
  }

  // ---------------------------------------
  // GENERIC EXECUTE
  // ---------------------------------------

  async execute(tool, args = {}) {
    switch (tool) {
      case "click":
        return await this.click(args.text);

      case "type":
        return await this.type(args.field, args.value);

      case "select":
        return await this.select(args.field, args.value);

      case "hover":
        return await this.hover(args.text);

      case "check":
        return await this.check(args.field);

      case "uncheck":
        return await this.uncheck(args.field);

      case "upload":
        return await this.upload(args.field, args.path);

      case "navigate":
        return await this.navigate(args.url);

      case "press":
        return await this.press(args.key);

      case "wait":
        return await this.wait(args.time);

      case "read":
        return await this.read(args.text || args.title);

      case "snapshot":
        return await this.snapshot();

      case "html":
        return await this.html();

      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }
}
