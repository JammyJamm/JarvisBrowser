module.exports.execute = async ({ page }, tool, args = {}) => {
  // ==========================
  // WAIT PAGE READY
  // ==========================
  async function waitReady() {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});

    await page
      .waitForFunction(() => document.readyState === "complete")
      .catch(() => {});

    await page.waitForTimeout(2500);
  }

  // ==========================
  // FIND CLICKABLE
  // ==========================
  async function findClickable(text) {
    await waitReady();

    let exact = String(text)
      .trim()
      .replace(/^click\s+/i, "")
      .replace(/\s+button$/i, "")
      .replace(/^["']|["']$/g, "");

    if (/^login$/i.test(exact)) exact = "Log in";
    if (/^signin$/i.test(exact)) exact = "Sign in";
    if (/^signup$/i.test(exact)) exact = "Sign up";

    const locators = [
      page.getByText(exact, { exact: true }).first(),
      page.locator("button").filter({ hasText: exact }).first(),
      page.locator('[role="tab"]').filter({ hasText: exact }).first(),
      page.locator("span").filter({ hasText: exact }).first(),
      page.locator("div").filter({ hasText: exact }).first(),
      page.locator("li").filter({ hasText: exact }).first(),

      page.locator(`button:has(span:has-text("${exact}"))`).first(),

      page.locator(`[type="submit"]:has-text("${exact}")`).first(),

      page.locator(`[type="submit"]:has(span:has-text("${exact}"))`).first(),

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

        // climb to parent submit button
        const btn = loc.locator("xpath=ancestor::button[1]");
        if (await btn.count()) return btn;

        return loc;
      }
    }

    throw new Error(`Element not found: ${exact}`);
  }

  // ==========================
  // FIND INPUT
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

    if (q === "email") return await findInput("username");

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
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });

    await page.waitForTimeout(8000);

    await page
      .waitForLoadState("networkidle", {
        timeout: 5000,
      })
      .catch(() => {});

    return {};
  }

  // ==========================
  // CLICK
  // ==========================
  if (tool === "click") {
    const el = await findClickable(args.text);

    try {
      await el.click({
        force: true,
        timeout: 10000,
      });
    } catch {
      try {
        await el.evaluate((node) => node.click());
      } catch {
        try {
          await el.focus();
          await page.keyboard.press("Enter");
        } catch {
          await el.evaluate((node) => {
            const form = node.closest("form");

            if (form) {
              if (form.requestSubmit) {
                form.requestSubmit();
              } else {
                form.dispatchEvent(
                  new Event("submit", {
                    bubbles: true,
                    cancelable: true,
                  }),
                );
              }
            }
          });
        }
      }
    }

    // Vue submit fallback
    await page
      .evaluate(() => {
        const form = document.querySelector("form");

        if (form) {
          if (form.requestSubmit) {
            form.requestSubmit();
          } else {
            form.dispatchEvent(
              new Event("submit", {
                bubbles: true,
                cancelable: true,
              }),
            );
          }
        }
      })
      .catch(() => {});

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

  if (tool === "goforward") {
    await page.goForward().catch(() => {});
    await waitReady();
    return {};
  }

  if (tool === "refresh") {
    await page.reload();
    await waitReady();
    return {};
  }
  // ==========================
  // IFRAME CLICK
  // ==========================
  if (tool === "iframeClick") {
    await waitReady();

    const exact = String(args.text).trim();

    let clicked = false;

    for (const frame of page.frames()) {
      try {
        const locators = [
          frame.getByText(exact, { exact: true }).first(),
          frame.locator(`text="${exact}"`).first(),
          frame.locator(`span:has-text("${exact}")`).first(),
          frame.locator(`div:has-text("${exact}")`).first(),
          frame.locator(`li:has-text("${exact}")`).first(),
        ];

        for (const loc of locators) {
          if (await loc.count()) {
            await loc.waitFor({
              state: "visible",
              timeout: 15000,
            });

            await loc.scrollIntoViewIfNeeded().catch(() => {});

            await loc.click({
              force: true,
              timeout: 15000,
            });

            clicked = true;
            break;
          }
        }

        if (clicked) break;
      } catch {}
    }

    if (!clicked) {
      throw new Error(`Iframe element not found: ${exact}`);
    }

    await waitReady();

    return {};
  }
  throw new Error(`Unknown tool: ${tool}`);
};
