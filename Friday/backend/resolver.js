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

  async typeSmart(field, value) {
    const page = await this.mcp.getPage();

    field = String(field).trim().toLowerCase();

    //--------------------------------------------------
    // FIELD ALIASES
    //--------------------------------------------------

    const aliases = {
      email: [
        "email",
        "e-mail",
        "mail",
        "email or id",
        "e-mail or id",
        "username",
        "user name",
        "user",
        "login",
        "login id",
        "id",
      ],

      password: ["password", "pass", "pwd"],

      phone: ["phone", "mobile", "telephone", "number"],

      otp: ["otp", "verification code", "code", "pin"],

      search: ["search", "find", "lookup"],
    };

    const keywords = aliases[field] || [field];

    //--------------------------------------------------
    // HELPERS
    //--------------------------------------------------

    const containsKeyword = (text = "") => {
      text = String(text).toLowerCase();

      return keywords.some((k) => text.includes(k));
    };

    const normalize = (text = "") =>
      String(text).replace(/\s+/g, " ").trim().toLowerCase();

    //--------------------------------------------------
    // SAFE INNER TEXT
    //--------------------------------------------------

    const safeText = async (locator) => {
      try {
        return normalize(await locator.innerText());
      } catch {
        return "";
      }
    };

    //--------------------------------------------------
    // SCORE ATTRIBUTES
    //--------------------------------------------------

    const scoreAttributes = (attrs) => {
      let score = 0;

      if (containsKeyword(attrs.placeholder)) score += 300;

      if (containsKeyword(attrs.aria)) score += 300;

      if (containsKeyword(attrs.name)) score += 250;

      if (containsKeyword(attrs.id)) score += 250;

      if (containsKeyword(attrs.autocomplete)) score += 250;

      //--------------------------------------------------
      // EMAIL BONUS
      //--------------------------------------------------

      if (field === "email") {
        if (attrs.type === "email") score += 250;

        if (attrs.name === "username") score += 600;

        if (attrs.id === "username") score += 550;

        if (attrs.autocomplete === "username") score += 700;

        if (attrs.placeholder.includes("email")) score += 700;

        if (attrs.placeholder.includes("id")) score += 500;
      }

      //--------------------------------------------------
      // PASSWORD BONUS
      //--------------------------------------------------

      if (field === "password") {
        if (attrs.type === "password") score += 900;

        if (attrs.autocomplete.includes("current-password")) score += 700;

        if (attrs.autocomplete.includes("new-password")) score += 700;
      }

      return score;
    };

    //--------------------------------------------------
    // SCORE LABEL
    //--------------------------------------------------

    const scoreLabel = (text, distance = 0) => {
      if (!containsKeyword(text)) return 0;

      return Math.max(800 - distance * 40, 100);
    };

    //--------------------------------------------------
    // GET INPUTS
    //--------------------------------------------------

    const inputs = page.locator(
      `
    input:not([type=hidden]),
    textarea,
    [contenteditable='true']
    `,
    );

    const total = await inputs.count();

    if (!total) throw new Error("No editable inputs found.");

    let bestInput = null;
    let bestScore = -999999;
    //--------------------------------------------------
    // EVALUATE EVERY INPUT
    //--------------------------------------------------

    for (let i = 0; i < total; i++) {
      const input = inputs.nth(i);

      try {
        if (!(await input.isVisible())) continue;

        let score = 0;

        //--------------------------------------------------
        // ATTRIBUTES
        //--------------------------------------------------

        const attrs = {
          placeholder: normalize(
            (await input.getAttribute("placeholder")) || "",
          ),

          aria: normalize((await input.getAttribute("aria-label")) || ""),

          name: normalize((await input.getAttribute("name")) || ""),

          id: normalize((await input.getAttribute("id")) || ""),

          autocomplete: normalize(
            (await input.getAttribute("autocomplete")) || "",
          ),

          type: normalize((await input.getAttribute("type")) || ""),
        };

        score += scoreAttributes(attrs);

        //--------------------------------------------------
        // LABEL[for=id]
        //--------------------------------------------------

        try {
          if (attrs.id) {
            const lbl = page.locator(`label[for="${attrs.id}"]`).first();

            if (await lbl.count()) {
              const txt = await safeText(lbl);

              score += scoreLabel(txt);
            }
          }
        } catch {}

        //--------------------------------------------------
        // aria-labelledby
        //--------------------------------------------------

        try {
          const labelledBy = await input.getAttribute("aria-labelledby");

          if (labelledBy) {
            const ids = labelledBy.split(/\s+/).filter(Boolean);

            for (const id of ids) {
              const node = page.locator(`#${id}`);

              if (await node.count()) {
                score += scoreLabel(await safeText(node));
              }
            }
          }
        } catch {}

        //--------------------------------------------------
        // WALK PARENTS
        //--------------------------------------------------

        let current = input;

        for (let level = 0; level < 10; level++) {
          current = current.locator("xpath=..");

          //------------------------------------------------
          // Parent text
          //------------------------------------------------

          try {
            score += scoreLabel(await safeText(current), level);
          } catch {}

          //------------------------------------------------
          // Labels inside current parent
          //------------------------------------------------

          try {
            const labels = current.locator(
              `
            label,
            span,
            p,
            div,
            strong,
            small,
            legend,
            h1,
            h2,
            h3,
            h4,
            h5,
            h6
            `,
            );

            const cnt = await labels.count();

            for (let j = 0; j < cnt; j++) {
              const txt = await safeText(labels.nth(j));

              score += scoreLabel(txt, level);
            }
          } catch {}

          //------------------------------------------------
          // PREVIOUS siblings
          //------------------------------------------------

          try {
            const prev = current.locator("xpath=preceding-sibling::*");

            const cnt = await prev.count();

            for (let j = 0; j < cnt; j++) {
              score += scoreLabel(await safeText(prev.nth(j)), level + 1);
            }
          } catch {}

          //------------------------------------------------
          // NEXT siblings
          //------------------------------------------------

          try {
            const next = current.locator("xpath=following-sibling::*");

            const cnt = await next.count();

            for (let j = 0; j < cnt; j++) {
              score += scoreLabel(await safeText(next.nth(j)), level + 1);
            }
          } catch {}

          //------------------------------------------------
          // ALL CHILDREN OF PARENT
          // (critical for Vuetify / Material / Ant)
          //------------------------------------------------

          try {
            const neighbours = current.locator("xpath=../*");

            const cnt = await neighbours.count();

            for (let j = 0; j < cnt; j++) {
              const node = neighbours.nth(j);

              const txt = await safeText(node);

              if (!containsKeyword(txt)) continue;

              const hasInput = await node
                .locator("input,textarea,[contenteditable]")
                .count();

              if (hasInput) score += 350;
              else score += 800;
            }
          } catch {}
        }

        //--------------------------------------------------
        // Continue with scoring...
        //--------------------------------------------------

        // =====================================================
        // TYPE SMART (UNCHANGED BUT SAFE)
        // =====================================================
        //--------------------------------------------------
        // INPUT TYPE BONUS
        //--------------------------------------------------

        if (await input.isEnabled()) score += 100;

        if (await input.isEditable()) score += 100;

        try {
          await input.boundingBox();
          score += 50;
        } catch {}

        //--------------------------------------------------
        // PENALTY
        //--------------------------------------------------

        if (attrs.type === "hidden") score -= 5000;

        if (attrs.type === "submit") score -= 5000;

        if (attrs.type === "button") score -= 5000;

        if (attrs.type === "checkbox") score -= 5000;

        if (attrs.type === "radio") score -= 5000;

        //--------------------------------------------------
        // DEBUG
        //--------------------------------------------------

        console.log({
          field,
          score,
          id: attrs.id,
          name: attrs.name,
          placeholder: attrs.placeholder,
          autocomplete: attrs.autocomplete,
          type: attrs.type,
        });

        //--------------------------------------------------
        // BEST MATCH
        //--------------------------------------------------

        if (score > bestScore) {
          bestScore = score;
          bestInput = input;
        }
      } catch (err) {
        console.log("Candidate skipped:", err.message);
      }
    }

    //--------------------------------------------------
    // NOTHING FOUND
    //--------------------------------------------------

    if (!bestInput) throw new Error(`Unable to locate "${field}" input`);

    console.log(`TYPE SMART -> ${field} (score=${bestScore})`);

    //--------------------------------------------------
    // FOCUS
    //--------------------------------------------------

    await bestInput.scrollIntoViewIfNeeded().catch(() => {});

    try {
      await bestInput.click({
        timeout: 3000,
      });
    } catch {}

    //--------------------------------------------------
    // CLEAR
    //--------------------------------------------------

    try {
      await bestInput.fill("");
    } catch {
      try {
        await bestInput.press("Control+A");
        await bestInput.press("Backspace");
      } catch {}
    }

    //--------------------------------------------------
    // TYPE
    //--------------------------------------------------

    try {
      await bestInput.fill(value);
    } catch {
      try {
        await bestInput.type(value, {
          delay: 15,
        });
      } catch {
        await page.evaluate(
          ({ element, value }) => {
            element.focus();
            element.value = value;
            element.dispatchEvent(
              new Event("input", {
                bubbles: true,
              }),
            );
            element.dispatchEvent(
              new Event("change", {
                bubbles: true,
              }),
            );
          },
          {
            element: await bestInput.elementHandle(),
            value,
          },
        );
      }
    }

    //--------------------------------------------------
    // VERIFY
    //--------------------------------------------------

    try {
      const finalValue = await bestInput.inputValue();

      if (finalValue.trim() !== String(value).trim()) {
        throw new Error("Verification failed");
      }
    } catch {
      console.log("Fill verification skipped.");
    }

    console.log(`TYPE SUCCESS -> ${field}`);

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
