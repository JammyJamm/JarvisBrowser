// resolver.js

export default class Resolver {
  constructor(mcp) {
    this.mcp = mcp;
  }

  // =====================================================
  // SMART DOM FETCHER (NEW)
  // =====================================================

  async getDOMPool(page) {
    const [buttons, links, tabs, roles] = await Promise.all([
      page
        .locator("button")
        .evaluateAll((els) =>
          els.map((e) => e.textContent?.trim()).filter(Boolean),
        ),
      page
        .locator("a")
        .evaluateAll((els) =>
          els.map((e) => e.textContent?.trim()).filter(Boolean),
        ),
      page
        .locator('[role="tab"]')
        .evaluateAll((els) =>
          els.map((e) => e.textContent?.trim()).filter(Boolean),
        ),
      page
        .locator('[role="button"]')
        .evaluateAll((els) =>
          els.map((e) => e.textContent?.trim()).filter(Boolean),
        ),
    ]);

    return {
      buttons,
      links,
      tabs,
      roles,
      all: [...buttons, ...links, ...tabs, ...roles],
    };
  }

  // =====================================================
  // SMART CLICK (TAB-AWARE FIX)
  // =====================================================

  async clickSmart(text) {
    const page = await this.mcp.getPage();

    if (!text) throw new Error("clickSmart requires text");

    text = text.trim();

    await page.waitForLoadState("domcontentloaded");

    const locators = [
      page.getByRole("tab", { name: new RegExp(text, "i") }),

      page.getByRole("button", { name: new RegExp(text, "i") }),

      page.getByRole("link", { name: new RegExp(text, "i") }),

      page.getByText(text, { exact: false }),

      page.locator(`text=${text}`),
    ];

    for (const locator of locators) {
      try {
        if (!(await locator.count())) continue;

        const target = locator.first();

        await target.scrollIntoViewIfNeeded().catch(() => {});

        await target.waitFor({
          state: "visible",
        });

        // climb until clickable parent

        const clickable = target.locator(`
xpath=
ancestor-or-self::*[
self::button
or self::a
or @role='button'
or @role='tab'
or @onclick
or contains(@class,'tab')
or contains(@class,'button')
][1]
`);

        if (await clickable.count()) {
          await clickable.first().click();

          console.log("Clicked parent");

          return true;
        }

        await target.click();

        return true;
      } catch {}
    }

    // DOM fallback

    const all = page.locator("*");

    const total = await all.count();

    for (let i = 0; i < total; i++) {
      const el = all.nth(i);

      try {
        const txt = (await el.textContent())?.trim();

        if (!txt) continue;

        if (!txt.toLowerCase().includes(text.toLowerCase())) continue;

        const parent = el.locator(`
xpath=
ancestor-or-self::*[
self::button
or self::a
or @role='button'
or @role='tab'
or @onclick
][1]
`);

        if (await parent.count()) {
          await parent.click();

          return true;
        }
      } catch {}
    }

    throw new Error(`Unable to click '${text}'`);
  }

  // =====================================================
  // TYPE SMART (UNCHANGED BUT SAFE)
  // =====================================================

  async type(field, value) {
    const page = await this.mcp.getPage();
    return await page.locator(field).fill(value);
  }

  async select(field, value) {
    const page = await this.mcp.getPage();
    return await page.locator(field).selectOption(value);
  }

  async hover(text) {
    const page = await this.mcp.getPage();
    return await page.getByText(text, { exact: false }).first().hover();
  }

  async check(selector) {
    const page = await this.mcp.getPage();
    return await page.locator(selector).check();
  }

  async uncheck(selector) {
    const page = await this.mcp.getPage();
    return await page.locator(selector).uncheck();
  }

  async upload(selector, path) {
    const page = await this.mcp.getPage();
    return await page.locator(selector).setInputFiles(path);
  }

  async press(key) {
    return await this.mcp.press(key);
  }

  async wait(time = 1000) {
    return new Promise((r) => setTimeout(r, time));
  }

  async navigate(url) {
    return await this.mcp.navigate(url);
  }

  async snapshot() {
    return await this.mcp.snapshot();
  }

  async html() {
    return await this.mcp.html();
  }

  async read(text) {
    const page = await this.mcp.getPage();

    const value = await page
      .getByText(text, { exact: false })
      .first()
      .textContent();

    return {
      success: true,
      text: value,
    };
  }

  // =====================================================
  // SELF HEAL (FIXED - NO LOOPING SAME STRATEGY)
  // =====================================================

  async selfHeal(step) {
    const page = await this.mcp.getPage();

    console.log("========== SELF HEAL ==========");
    console.log(step);
    console.log("===============================");

    try {
      // TYPE FIX
      if (step.tool === "type") {
        const inputs = await page
          .locator("input, textarea")
          .evaluateAll((els) =>
            els.map((e) => ({
              id: e.id,
              name: e.name,
              placeholder: e.placeholder,
            })),
          );

        const field = step.args.field.toLowerCase();

        const match = inputs.find(
          (i) =>
            i.id?.toLowerCase().includes(field) ||
            i.name?.toLowerCase().includes(field) ||
            i.placeholder?.toLowerCase().includes(field),
        );

        if (match) {
          const selector =
            (match.id && `#${match.id}`) ||
            (match.name && `[name="${match.name}"]`);

          await page.locator(selector).fill(step.args.value);

          return {
            healed: true,
            selector,
          };
        }
      }

      // CLICK FIX (NEW TAB-AWARE HEAL)
      if (step.tool === "click") {
        const text = step.args.text || step.args.selector;

        if (text) {
          await this.clickSmart(text);

          return {
            healed: true,
            method: "clickSmart",
          };
        }
      }

      throw new Error("Self healing failed");
    } catch (err) {
      throw new Error("Self healing failed: " + err.message);
    }
  }

  // =====================================================
  // SEARCH SMART (UNCHANGED)
  // =====================================================

  async searchSmart(query) {
    const page = await this.mcp.getPage();

    const input = page
      .locator(
        'input[type="search"], input[name*="search" i], input[placeholder*="search" i], input[type="text"]',
      )
      .first();

    if (!(await input.count())) {
      throw new Error("Search box not found");
    }

    await input.fill(query);
    await input.press("Enter");

    return true;
  }

  // =====================================================
  // EXECUTOR
  // =====================================================

  async execute(tool, args = {}) {
    switch (tool) {
      case "click":
        return await this.clickSmart(
          args.text || args.label || args.selector || "",
        );

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
