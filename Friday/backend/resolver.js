// resolver.js
import { clickInsideEvolutionFrame } from "./utils/iframeContent.js";
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
    const lower = text.toLowerCase();
    await clickInsideEvolutionFrame(page, text);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});

    //--------------------------------------------------
    // Search main page + ALL iframes
    //--------------------------------------------------

    const contexts = [page, ...page.frames()];

    console.log(`Searching ${contexts.length} frame(s)...`);

    //--------------------------------------------------
    // Submit keywords
    //--------------------------------------------------

    const submitWords = [
      "submit",
      "login",
      "log in",
      "signin",
      "sign in",
      "continue",
      "next",
      "register",
      "save",
    ];

    //--------------------------------------------------
    // Search every frame
    //--------------------------------------------------

    for (const ctx of contexts) {
      try {
        console.log("Searching:", ctx.url());

        //------------------------------------------------
        // FAST PATH : submit buttons
        //------------------------------------------------

        if (submitWords.includes(lower)) {
          const submits = ctx.locator(`
          button[type=submit],
          input[type=submit]
        `);

          const count = await submits.count();

          for (let i = 0; i < count; i++) {
            const btn = submits.nth(i);

            try {
              if (!(await btn.isVisible())) continue;
              if (!(await btn.isEnabled())) continue;

              const label = (
                (await btn.innerText().catch(() => "")) ||
                (await btn.getAttribute("value").catch(() => "")) ||
                ""
              )
                .trim()
                .toLowerCase();

              if (!label || label.includes(lower)) {
                await btn.scrollIntoViewIfNeeded().catch(() => {});
                await btn.click();

                console.log("Clicked submit button");

                return true;
              }
            } catch {}
          }
        }

        //------------------------------------------------
        // Playwright locators
        //------------------------------------------------

        const locators = [
          ctx.getByRole("button", {
            name: new RegExp(text, "i"),
          }),

          ctx.getByRole("tab", {
            name: new RegExp(text, "i"),
          }),

          ctx.getByRole("link", {
            name: new RegExp(text, "i"),
          }),

          ctx.getByText(text, {
            exact: false,
          }),

          ctx.locator(`text=${text}`),
        ];

        for (const locator of locators) {
          try {
            if (!(await locator.count())) continue;

            const target = locator.first();

            await target.waitFor({
              state: "visible",
              timeout: 1000,
            });

            await target.scrollIntoViewIfNeeded().catch(() => {});

            //------------------------------------------------
            // Click enclosing BUTTON first
            //------------------------------------------------

            const button = target.locator("xpath=ancestor-or-self::button[1]");

            if (await button.count()) {
              await button.first().click();

              console.log("Clicked button");

              return true;
            }

            //------------------------------------------------
            // Click enclosing LINK
            //------------------------------------------------

            const link = target.locator("xpath=ancestor-or-self::a[1]");

            if (await link.count()) {
              await link.first().click();

              console.log("Clicked link");

              return true;
            }

            //------------------------------------------------
            // Direct click
            //------------------------------------------------

            try {
              await target.click();

              console.log("Clicked target");

              return true;
            } catch {}

            //------------------------------------------------
            // Generic clickable parent
            //------------------------------------------------

            const clickable = target.locator(`
            xpath=
            ancestor-or-self::*[
              @role='button'
              or @role='tab'
              or @onclick
              or contains(@class,'button')
              or contains(@class,'btn')
              or contains(@class,'tab')
            ][1]
          `);

            if (await clickable.count()) {
              await clickable.first().click();

              console.log("Clicked clickable parent");

              return true;
            }
          } catch {}
        }

        //------------------------------------------------
        // DOM fallback
        //------------------------------------------------

        const all = ctx.locator("*");

        const total = await all.count();

        for (let i = 0; i < total; i++) {
          const el = all.nth(i);

          try {
            if (!(await el.isVisible())) continue;

            const txt = ((await el.textContent()) || "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();

            if (!txt.includes(lower)) continue;

            const button = el.locator("xpath=ancestor-or-self::button[1]");

            if (await button.count()) {
              await button.first().click();

              console.log("Clicked fallback button");

              return true;
            }

            const link = el.locator("xpath=ancestor-or-self::a[1]");

            if (await link.count()) {
              await link.first().click();

              console.log("Clicked fallback link");

              return true;
            }

            await el.click().catch(() => {});

            console.log("Clicked fallback element");

            return true;
          } catch {}
        }
      } catch (err) {
        console.log("Frame skipped:", err.message);
      }
    }

    throw new Error(`Unable to click '${text}'`);
  }

  async typeSmart(field, value) {
    const page = await this.mcp.getPage();

    // Normalize field names
    field = String(field).trim().toLowerCase();

    const fieldMap = {
      email: "username",
      "e-mail": "username",
      mail: "username",
      login: "username",
      userid: "username",
      "user id": "username",
      id: "username",
      username: "username",

      password: "password",
      pass: "password",
      pwd: "password",

      phone: "phone",
      mobile: "phone",

      otp: "otp",
      code: "otp",
    };

    const target = fieldMap[field] || field;

    const aliases = {
      username: [
        "username",
        "user",
        "email",
        "e-mail",
        "email or id",
        "login",
        "login id",
        "id",
      ],
      password: ["password", "pass", "pwd", "current-password", "new-password"],
      phone: ["phone", "mobile", "telephone"],
      otp: ["otp", "verification", "code"],
    };

    const words = aliases[target] || [target];

    const inputs = page.locator(`
    input:not(
      [type=hidden],
      [type=radio],
      [type=checkbox],
      [type=submit],
      [type=button]
    ),
    textarea,
    [contenteditable]
  `);

    let best = null;
    let bestScore = -1;

    const count = await inputs.count();

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);

      if (!(await input.isVisible())) continue;

      let score = 0;

      const attrs = [
        await input.getAttribute("id"),
        await input.getAttribute("name"),
        await input.getAttribute("placeholder"),
        await input.getAttribute("autocomplete"),
        await input.getAttribute("aria-label"),
        await input.getAttribute("type"),
      ]
        .join(" ")
        .toLowerCase();

      // Attribute matching
      for (const w of words) if (attrs.includes(w)) score += 500;

      // Semantic bonuses
      if (target === "username") {
        if (attrs.includes('autocomplete="username"')) score += 5000;
        if (attrs.includes("username")) score += 3000;
        if (attrs.includes("email")) score += 2500;
        if (attrs.includes("login")) score += 2000;
      }

      if (target === "password") {
        if (attrs.includes("password")) score += 5000;
        if (attrs.includes("current-password")) score += 4000;
        if (attrs.includes("type password")) score += 3000;
      }

      // Parent text
      let parent = input;

      for (let l = 0; l < 6; l++) {
        parent = parent.locator("xpath=..");

        try {
          const txt = (await parent.innerText()).toLowerCase();

          for (const w of words) if (txt.includes(w)) score += 800 - l * 100;
        } catch {}
      }

      if (score > bestScore) {
        bestScore = score;
        best = input;
      }
    }

    if (!best) throw new Error(`Unable to locate ${field}`);

    console.log(`TYPE SMART -> ${field} => ${target} (${bestScore})`);

    await best.scrollIntoViewIfNeeded().catch(() => {});
    await best.click().catch(() => {});
    await best.fill("").catch(() => {});
    await best.fill(value);

    return true;
  }
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
