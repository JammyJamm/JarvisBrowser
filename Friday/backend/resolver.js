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
  // SELF HEALING
  // ---------------------------------------
  async clickSmart(text) {
    const page = await this.mcp.getPage();

    const strategies = [
      () => page.getByText(text, { exact: false }).first().click(),

      () => page.locator(`text=${text}`).first().click(),

      () => page.locator("button").filter({ hasText: text }).first().click(),

      () => page.locator("a").filter({ hasText: text }).first().click(),

      () =>
        page
          .getByRole("button", {
            name: new RegExp(text, "i"),
          })
          .click(),

      () =>
        page
          .getByRole("link", {
            name: new RegExp(text, "i"),
          })
          .click(),
    ];

    for (const strategy of strategies) {
      try {
        await strategy();

        console.log("CLICK SUCCESS");
        return true;
      } catch {}
    }

    throw new Error(`Cannot click ${text}`);
  }
  async typeSmart(field, value) {
    const page = await this.mcp.getPage();

    const candidates = [
      `input[name*="${field}" i]`,
      `input[id*="${field}" i]`,
      `textarea[name*="${field}" i]`,
      `textarea[id*="${field}" i]`,
    ];
    const strategies = [
      () =>
        page
          .getByPlaceholder(/search/i)
          .first()
          .fill(value),

      () => page.getByRole("textbox").first().fill(value),

      () => page.locator('input[type="text"]').first().fill(value),

      () => page.locator('input[title*="Search"]').first().fill(value),
    ];
    for (const selector of candidates) {
      try {
        const el = page.locator(selector).first();

        if (await el.count()) {
          await el.fill(value);

          console.log("TYPE SUCCESS", selector);

          return true;
        }
      } catch {}
    }

    throw new Error(`Cannot find field ${field}`);
  }
  async selfHeal(step) {
    const page = await this.mcp.getPage();

    const html = await page.content();

    console.log("========== SELF HEAL ==========");
    console.log(step);
    console.log("===============================");
    if (
      step.tool === "type" &&
      step.args.field.toLowerCase().includes("search")
    ) {
      return await this.searchSmart(step.args.value);
    }
    if (step.tool === "type") {
      const inputs = await page.locator("input").evaluateAll((els) =>
        els.map((e) => ({
          id: e.id,
          name: e.name,
          placeholder: e.placeholder,
        })),
      );

      console.log(inputs);

      const field = step.args.field.toLowerCase();

      const match = inputs.find(
        (i) =>
          i.id?.toLowerCase().includes(field) ||
          i.name?.toLowerCase().includes(field) ||
          i.placeholder?.toLowerCase().includes(field),
      );

      if (match) {
        const selector = match.id ? `#${match.id}` : `[name="${match.name}"]`;

        await page.locator(selector).fill(step.args.value);

        return {
          healed: true,
          selector,
        };
      }
    }

    throw new Error("Self healing failed");
  }
  async searchSmart(query) {
    const page = await this.mcp.getPage();

    console.log("SEARCH SMART:", query);

    // ==========================
    // Find Search Input
    // ==========================

    const inputSelectors = [
      'input[type="search"]',
      'input[name*="search" i]',
      'input[id*="search" i]',
      'input[placeholder*="search" i]',
      'input[aria-label*="search" i]',
      'input[type="text"]',
    ];

    let input = null;

    for (const selector of inputSelectors) {
      try {
        const el = page.locator(selector).first();

        if (await el.count()) {
          input = el;
          break;
        }
      } catch {}
    }

    if (!input) {
      throw new Error("Search box not found");
    }

    await input.click();
    await input.fill(query);

    console.log("Typed:", query);

    // ==========================
    // Try Enter First
    // ==========================

    try {
      await input.press("Enter");

      await page.waitForLoadState("networkidle", {
        timeout: 5000,
      });

      console.log("Search via Enter");

      return true;
    } catch {}

    // ==========================
    // Search Buttons
    // ==========================

    const searchButtons = [
      'button[type="submit"]',
      'button[aria-label*="search" i]',
      '[data-testid*="search" i]',
      ".search-button",
      ".search-btn",
      "button",
    ];

    for (const selector of searchButtons) {
      try {
        const buttons = page.locator(selector);

        const count = await buttons.count();

        for (let i = 0; i < count; i++) {
          const btn = buttons.nth(i);

          const txt = ((await btn.textContent()) || "").toLowerCase();

          if (
            txt.includes("search") ||
            txt.includes("find") ||
            txt.includes("go")
          ) {
            await btn.click();

            console.log("Search button clicked");

            return true;
          }
        }
      } catch {}
    }

    // ==========================
    // SVG Search Icon
    // ==========================

    try {
      const icons = [
        "svg",
        '[aria-label*="search" i]',
        ".search-icon",
        ".icon-search",
      ];

      for (const selector of icons) {
        const icon = page.locator(selector).first();

        if (await icon.count()) {
          await icon.click();

          console.log("Search icon clicked");

          return true;
        }
      }
    } catch {}

    throw new Error("Search trigger not found");
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
