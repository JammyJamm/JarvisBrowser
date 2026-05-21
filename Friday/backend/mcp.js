module.exports.execute = async ({ page }, tool, args = {}) => {
  // ==========================
  // WAIT PAGE READY
  // ==========================
  async function waitReady() {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});

    await page
      .waitForFunction(() => {
        return document.readyState === "complete";
      })
      .catch(() => {});

    await page.waitForTimeout(2500);
  }

  // ==========================
  // FIND ANY CLICKABLE ELEMENT
  // ==========================
  async function findClickable(text) {
    await waitReady();

    let exact = String(text).trim();

    if (/^login$/i.test(exact)) exact = "Log in";
    if (/^signin$/i.test(exact)) exact = "Sign in";
    if (/^signup$/i.test(exact)) exact = "Sign up";

    const locators = [
      page.locator(`button:has-text("${exact}")`).first(),
      page.locator(`label:has-text("${exact}")`).first(),

      page.locator(`li:has(label:has-text("${exact}"))`).first(),

      page.locator(`[role="tab"]:has-text("${exact}")`).first(),

      page.locator(`.ui-tabs__tab:has-text("${exact}")`).first(),

      page.locator(`.ui-tab:has-text("${exact}")`).first(),

      page.getByText(exact, { exact: true }).first(),
    ];

    for (const loc of locators) {
      if (await loc.count()) {
        await loc.waitFor({
          state: "visible",
          timeout: 8000,
        });

        await loc.scrollIntoViewIfNeeded().catch(() => {});

        return loc;
      }
    }

    throw new Error(`Element not found: ${exact}`);
  }

  // ==========================
  // FIND INPUT FIELD
  // ==========================
  async function findInput(field) {
    await waitReady();

    const q = String(field).trim().toLowerCase();

    const selectors = [
      `input[name="${q}"]:not([type="radio"]):not([type="checkbox"])`,
      `input[id="${q}"]:not([type="radio"]):not([type="checkbox"])`,
      `input[autocomplete="${q}"]:not([type="radio"]):not([type="checkbox"])`,

      `textarea[name="${q}"]`,
      `textarea[id="${q}"]`,

      `input[placeholder*="${q}" i]:not([type="radio"]):not([type="checkbox"])`,
      `textarea[placeholder*="${q}" i]`,

      `input[aria-label*="${q}" i]:not([type="radio"]):not([type="checkbox"])`,
      `textarea[aria-label*="${q}" i]`,

      `label:has-text("${q}") input:not([type="radio"]):not([type="checkbox"])`,
      `label:has-text("${q}") textarea`,
    ];

    for (const sel of selectors) {
      const loc = page.locator(sel).first();

      if (await loc.count()) {
        await loc.waitFor({
          state: "visible",
          timeout: 8000,
        });

        await loc.scrollIntoViewIfNeeded().catch(() => {});
        return loc;
      }
    }

    // smart aliases
    if (q === "email") {
      return await findInput("username");
    }

    if (q === "password") {
      const loc = page.locator(`input[type="password"]`).first();

      if (await loc.count()) return loc;
    }

    throw new Error(`Input not found: ${field}`);
  }
  // ==========================
  // NAVIGATE
  // ==========================
  if (tool === "navigate") {
    await page.goto(args.url, {
      waitUntil: "networkidle",
    });

    return {};
  }

  // ==========================
  // CLICK
  // ==========================
  if (tool === "click") {
    const el = await findClickable(args.text);

    await el
      .click({
        timeout: 10000,
      })
      .catch(async () => {
        await el.dispatchEvent("click");
      });

    await waitReady();

    return {};
  }

  // ==========================
  // TYPE
  // ==========================
  if (tool === "type") {
    const input = await findInput(args.field);

    await input.fill("");
    await input.type(args.value, {
      delay: 35,
    });

    return {};
  }

  // ==========================
  // BACK
  // ==========================
  if (tool === "goback") {
    await page.goBack().catch(() => {});
    await waitReady();
    return {};
  }

  // ==========================
  // FORWARD
  // ==========================
  if (tool === "goforward") {
    await page.goForward().catch(() => {});
    await waitReady();
    return {};
  }

  // ==========================
  // REFRESH
  // ==========================
  if (tool === "refresh") {
    await page.reload();
    await waitReady();
    return {};
  }

  throw new Error(`Unknown tool: ${tool}`);
};
