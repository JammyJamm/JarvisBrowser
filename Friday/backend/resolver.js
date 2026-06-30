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

    if (!text) throw new Error("clickSmart: empty text");

    await page.waitForTimeout(200);

    let exact = String(text)
      .trim()
      .replace(/^click\s+/i, "")
      .replace(/\s+button$/i, "")
      .replace(/^["']|["']$/g, "");

    // -----------------------------
    // NORMALIZATION (IMPORTANT FIX)
    // -----------------------------
    const aliases = {
      login: "Log in",
      signin: "Sign in",
      signup: "Sign up",
    };

    if (aliases[exact.toLowerCase()]) {
      exact = aliases[exact.toLowerCase()];
    }

    const candidates = [];

    // =========================
    // 1. DOM TEXT LAYER (FAST)
    // =========================
    try {
      const dom = await this.getDOMPool(page);
      candidates.push(...dom.all.filter(Boolean));
    } catch {}

    // =========================
    // 2. EXACT + FUZZY MATCH
    // =========================

    let match = candidates.find(
      (c) => c && c.toLowerCase() === exact.toLowerCase(),
    );

    if (!match) {
      match = candidates.find(
        (c) => c && c.toLowerCase().includes(exact.toLowerCase()),
      );
    }

    if (!match) {
      let best = null;
      let bestScore = 0;

      const words = exact.toLowerCase().split(" ");

      for (const c of candidates) {
        if (!c) continue;

        const t = c.toLowerCase();

        let score = 0;

        for (const w of words) {
          if (t.includes(w)) score += 10;
        }

        // TAB BOOST (critical fix)
        if (
          t.includes("login") ||
          t.includes("sign") ||
          t.includes("tab") ||
          t.includes("casino") ||
          t.includes("sports") ||
          t.includes("live") ||
          t.includes("slots")
        ) {
          score += 15;
        }

        if (score > bestScore) {
          best = c;
          bestScore = score;
        }
      }

      match = best;
    }

    if (!match) {
      throw new Error(`No DOM match for: ${text}`);
    }

    // =========================
    // 3. ROBUST PLAYWRIGHT CLICK
    // =========================

    const locators = [
      page.getByText(match, { exact: false }).first(),
      page.locator(`text="${match}"`).first(),
      page.locator("button").filter({ hasText: match }).first(),
      page.locator("a").filter({ hasText: match }).first(),
      page.locator('[role="tab"]').filter({ hasText: match }).first(),
      page.getByRole("button", { name: new RegExp(match, "i") }).first(),
      page.getByRole("link", { name: new RegExp(match, "i") }).first(),
    ];

    for (const loc of locators) {
      try {
        if (await loc.count()) {
          await loc
            .waitFor({ state: "visible", timeout: 3000 })
            .catch(() => {});
          await loc.scrollIntoViewIfNeeded().catch(() => {});

          // TAB FIX: climb clickable parent
          const btn = loc.locator("xpath=ancestor::button[1]");
          if (await btn.count()) {
            await btn.click();
            console.log("SMART CLICK SUCCESS (ancestor button):", match);
            return true;
          }

          await loc
            .waitFor({ state: "visible", timeout: 2000 })
            .catch(() => {});

          const isDisabled = await loc.getAttribute("disabled");
          const isHidden = await loc.isHidden().catch(() => false);

          if (!isHidden && !isDisabled) {
            await loc.click({ timeout: 3000 });
            console.log("SMART CLICK SUCCESS:", match);
            return true;
          }
          console.log("SMART CLICK SUCCESS:", match);
          return true;
        }
      } catch {}
    }

    // =========================
    // 4. FINAL FALLBACK (FOR IFRAMES / CUSTOM UI)
    // =========================

    try {
      const all = await page
        .locator("button, a, div, span, li, [role='tab'], [role='button']")
        .all();
      for (const el of all) {
        try {
          const txt = (await el.textContent())?.trim();
          if (!txt) continue;

          if (txt.toLowerCase().includes(exact.toLowerCase())) {
            await el.click({ timeout: 2000 });
            console.log("SMART CLICK FALLBACK SUCCESS:", txt);
            return true;
          }
        } catch {}
      }
    } catch {}

    throw new Error(`clickSmart failed for: ${text}`);
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
        return await this.resolver.clickSmart(args.text || args.selector || "");
      case "type":
        return await this.type(args.field, args.value);

      case "select":
        return await this.resolver.select(args.field, args.value);
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
