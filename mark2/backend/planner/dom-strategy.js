// backend/planner/dom-strategy.js
//
// Smart DOM Strategy Engine
// --------------------------------------------------
//
// Responsibilities
// --------------------------------------------------
// ✔ DOM element resolution
// ✔ Deterministic locator strategies
// ✔ Visibility validation
// ✔ Interactability validation
// ✔ Click strategy
// ✔ Type strategy
// ✔ Select strategy
// ✔ Checkbox / radio strategy
// ✔ Shadow DOM hooks
// ✔ Iframe hooks
// ✔ Playwright Locator support
//
// IMPORTANT
// --------------------------------------------------
// ❌ No fuzzy matching
// ❌ No scoring
// ❌ No candidate ranking
// ❌ No LLM calls
// ❌ No planner decisions
//
// Architecture
// --------------------------------------------------
//
// Intent Parser
//      │
//      ▼
// Scoring Engine
//      │
//      ▼
// Resolver
//      │
//      ▼
// DOMStrategy
//      │
//      ├── Exact Text
//      ├── Role
//      ├── Accessible Name
//      ├── Attributes
//      ├── CSS Selector
//      ├── Shadow DOM
//      └── Iframe
//      │
//      ▼
// Playwright
//
// ============================================================

export default class DOMStrategy {
  constructor(page, options = {}) {
    this.page = page;

    this.options = {
      timeout: 3000,

      actionTimeout: 5000,

      useRoleLocators: true,

      useTextLocators: true,

      useAttributeLocators: true,

      useCSSLocators: true,

      enableShadowDOM: true,

      enableIframeHooks: true,

      debug: false,

      ...options,
    };

    // --------------------------------------------------------
    // Deterministic DOM selectors
    // --------------------------------------------------------

    this.selectors = {
      clickable: [
        "button",
        "a",
        "[role='button']",
        "[role='link']",
        "[onclick]",
        "input[type='submit']",
        "input[type='button']",
        "input[type='reset']",
      ],

      input: [
        "input",
        "textarea",
        "[contenteditable='true']",
        "[contenteditable='']",
      ],

      checkbox: ["input[type='checkbox']", "[role='checkbox']"],

      radio: ["input[type='radio']", "[role='radio']"],

      select: ["select", "[role='combobox']"],
    };
  }

  // =========================================================
  // LOGGING
  // =========================================================

  _log(...args) {
    if (this.options.debug) {
      console.log("[DOMStrategy]", ...args);
    }
  }

  // =========================================================
  // MAIN ELEMENT RESOLVER
  // =========================================================

  async resolveElement(target, options = {}) {
    if (!target || !this.page) {
      return null;
    }

    const value = String(target).trim();

    if (!value) {
      return null;
    }

    const strategies = [];

    // -------------------------------------------------------
    // 1. Exact text
    // -------------------------------------------------------

    if (this.options.useTextLocators) {
      strategies.push(() => this.byExactText(value));
    }

    // -------------------------------------------------------
    // 2. Accessible role/name
    // -------------------------------------------------------

    if (this.options.useRoleLocators) {
      strategies.push(() => this.byRole(value));
    }

    // -------------------------------------------------------
    // 3. Accessible name / labels
    // -------------------------------------------------------

    if (this.options.useRoleLocators) {
      strategies.push(() => this.byAccessibleName(value));
    }

    // -------------------------------------------------------
    // 4. Attribute match
    // -------------------------------------------------------

    if (this.options.useAttributeLocators) {
      strategies.push(() => this.byAttributeMatch(value));
    }

    // -------------------------------------------------------
    // 5. CSS selector
    // -------------------------------------------------------

    if (this.options.useCSSLocators) {
      strategies.push(() => this.byQuerySelector(value));
    }

    // -------------------------------------------------------
    // Execute deterministic strategies
    // -------------------------------------------------------

    for (const strategy of strategies) {
      try {
        const locator = await strategy();

        if (!locator) {
          continue;
        }

        const valid = await this.isUsable(locator, options);

        if (valid) {
          return locator;
        }
      } catch (error) {
        this._log("Strategy failed:", error.message);
      }
    }

    return null;
  }

  // =========================================================
  // EXACT TEXT
  // =========================================================

  async byExactText(text) {
    if (!this.page || !text) {
      return null;
    }

    try {
      const locator = this.page.getByText(text, {
        exact: true,
      });

      const count = await locator.count();

      if (!count) {
        return null;
      }

      return await this._firstVisible(locator);
    } catch {
      return null;
    }
  }

  // =========================================================
  // PARTIAL TEXT
  // =========================================================
  //
  // IMPORTANT:
  // This is deterministic substring matching.
  // It is NOT fuzzy matching.
  //
  // Fuzzy matching belongs to ScoringEngine.
  //
  // =========================================================

  async byPartialText(text) {
    if (!this.page || !text) {
      return null;
    }

    try {
      const locator = this.page.getByText(text, {
        exact: false,
      });

      const count = await locator.count();

      if (!count) {
        return null;
      }

      return await this._firstVisible(locator);
    } catch {
      return null;
    }
  }

  // =========================================================
  // ROLE-BASED RESOLUTION
  // =========================================================

  async byRole(target) {
    if (!this.page || !target) {
      return null;
    }

    const value = String(target).trim();

    if (!value) {
      return null;
    }

    const roleCandidates = [
      "button",
      "link",
      "tab",
      "menuitem",
      "checkbox",
      "radio",
      "textbox",
      "combobox",
      "option",
    ];

    for (const role of roleCandidates) {
      try {
        const locator = this.page.getByRole(role, {
          name: value,
          exact: true,
        });

        if ((await locator.count()) > 0) {
          const visible = await this._firstVisible(locator);

          if (visible) {
            return visible;
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  // =========================================================
  // ACCESSIBLE NAME
  // =========================================================

  async byAccessibleName(target) {
    if (!this.page || !target) {
      return null;
    }

    const value = String(target).trim();

    try {
      const locator = this.page.locator(
        [
          `[aria-label="${this._escapeAttribute(value)}"]`,
          `[title="${this._escapeAttribute(value)}"]`,
          `[placeholder="${this._escapeAttribute(value)}"]`,
          `[name="${this._escapeAttribute(value)}"]`,
        ].join(","),
      );

      if ((await locator.count()) === 0) {
        return null;
      }

      return await this._firstVisible(locator);
    } catch {
      return null;
    }
  }

  // =========================================================
  // ATTRIBUTE MATCHING
  // =========================================================

  async byAttributeMatch(keyword) {
    if (!this.page || !keyword) {
      return null;
    }

    const value = String(keyword).trim();

    if (!value) {
      return null;
    }

    const escaped = this._escapeAttribute(value);

    const selectors = [
      `[aria-label*="${escaped}" i]`,
      `[title*="${escaped}" i]`,
      `[placeholder*="${escaped}" i]`,
      `[name*="${escaped}" i]`,
      `[id*="${escaped}" i]`,
      `[data-testid*="${escaped}" i]`,
    ];

    try {
      const locator = this.page.locator(selectors.join(","));

      if ((await locator.count()) === 0) {
        return null;
      }

      return await this._firstVisible(locator);
    } catch {
      return null;
    }
  }

  // =========================================================
  // CSS SELECTOR FALLBACK
  // =========================================================

  async byQuerySelector(selector) {
    if (!this.page || !selector) {
      return null;
    }

    try {
      const locator = this.page.locator(String(selector).trim());

      if ((await locator.count()) === 0) {
        return null;
      }

      return await this._firstVisible(locator);
    } catch {
      return null;
    }
  }

  // =========================================================
  // CLICK STRATEGY
  // =========================================================

  async smartClick(target, options = {}) {
    const locator = await this.resolveElement(target, {
      requireVisible: true,
      requireEnabled: true,
      ...options,
    });

    if (!locator) {
      this._log("Click target not found:", target);
      return false;
    }

    try {
      await locator.scrollIntoViewIfNeeded({
        timeout: this.options.actionTimeout,
      });

      await locator.click({
        timeout: this.options.actionTimeout,
        delay: options.delay || 30,
        force: options.force || false,
      });

      return true;
    } catch (error) {
      this._log("Normal click failed:", error.message);
    }

    // -------------------------------------------------------
    // Fallback 1: force click
    // -------------------------------------------------------

    try {
      await locator.click({
        timeout: this.options.actionTimeout,
        force: true,
      });

      return true;
    } catch (error) {
      this._log("Force click failed:", error.message);
    }

    // -------------------------------------------------------
    // Fallback 2: DOM click
    // -------------------------------------------------------

    try {
      await locator.evaluate((node) => {
        if (typeof node.click === "function") {
          node.click();
        }
      });

      return true;
    } catch (error) {
      this._log("DOM click failed:", error.message);
    }

    return false;
  }

  // =========================================================
  // TYPE STRATEGY
  // =========================================================

  async smartType(target, text, options = {}) {
    if (text === null || text === undefined) {
      return false;
    }

    const locator = await this.resolveInput(target, options);

    if (!locator) {
      this._log("Input target not found:", target);
      return false;
    }

    const value = String(text);

    // -------------------------------------------------------
    // Primary: fill
    // -------------------------------------------------------

    try {
      await locator.fill(value, {
        timeout: this.options.actionTimeout,
      });

      return true;
    } catch (error) {
      this._log("Fill failed:", error.message);
    }

    // -------------------------------------------------------
    // Fallback: click + keyboard
    // -------------------------------------------------------

    try {
      await locator.click({
        timeout: this.options.actionTimeout,
      });

      await this.page.keyboard.press("Control+A");

      await this.page.keyboard.type(value, {
        delay: options.delay || 20,
      });

      return true;
    } catch (error) {
      this._log("Keyboard typing failed:", error.message);
    }

    // -------------------------------------------------------
    // Fallback: DOM value update
    // -------------------------------------------------------

    try {
      await locator.evaluate((node, inputValue) => {
        const prototype =
          node instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;

        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

        if (descriptor && descriptor.set) {
          descriptor.set.call(node, inputValue);
        } else {
          node.value = inputValue;
        }

        node.dispatchEvent(
          new Event("input", {
            bubbles: true,
          }),
        );

        node.dispatchEvent(
          new Event("change", {
            bubbles: true,
          }),
        );
      }, value);

      return true;
    } catch (error) {
      this._log("DOM input fallback failed:", error.message);
    }

    return false;
  }

  // =========================================================
  // INPUT RESOLVER
  // =========================================================

  async resolveInput(target, options = {}) {
    if (!this.page) {
      return null;
    }

    const value = String(target || "").trim();

    if (!value) {
      return null;
    }

    const escaped = this._escapeAttribute(value);

    const strategies = [
      // Exact placeholder
      () =>
        this.page.locator(
          `input[placeholder="${escaped}"], textarea[placeholder="${escaped}"]`,
        ),

      // Partial placeholder
      () =>
        this.page.locator(
          `input[placeholder*="${escaped}" i], textarea[placeholder*="${escaped}" i]`,
        ),

      // Exact name
      () =>
        this.page.locator(
          `input[name="${escaped}"], textarea[name="${escaped}"]`,
        ),

      // Partial name
      () =>
        this.page.locator(
          `input[name*="${escaped}" i], textarea[name*="${escaped}" i]`,
        ),

      // Exact ID
      () =>
        this.page.locator(
          `input#${this._escapeCSS(value)}, textarea#${this._escapeCSS(value)}`,
        ),

      // Label
      () => this.page.getByLabel(value, { exact: true }),

      // Role
      () =>
        this.page.getByRole("textbox", {
          name: value,
          exact: true,
        }),

      // Generic resolver
      () => this.resolveElement(value, options),
    ];

    for (const strategy of strategies) {
      try {
        const locator = await strategy();

        if (!locator) {
          continue;
        }

        if ((await locator.count()) === 0) {
          continue;
        }

        const visible = await this._firstVisible(locator);

        if (visible) {
          return visible;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  // =========================================================
  // SELECT STRATEGY
  // =========================================================

  async smartSelect(target, value) {
    if (!target || value === undefined || value === null) {
      return false;
    }

    const locator = await this.resolveSelect(target);

    if (!locator) {
      return false;
    }

    try {
      await locator.selectOption(String(value), {
        timeout: this.options.actionTimeout,
      });

      return true;
    } catch {
      // Fallback by visible label
      try {
        await locator.selectOption({
          label: String(value),
        });

        return true;
      } catch {
        return false;
      }
    }
  }

  // =========================================================
  // SELECT RESOLVER
  // =========================================================

  async resolveSelect(target) {
    if (!this.page || !target) {
      return null;
    }

    const value = String(target).trim();

    try {
      const locator = this.page.locator(
        [
          `select[name="${this._escapeAttribute(value)}"]`,
          `select[id="${this._escapeAttribute(value)}"]`,
          `select[aria-label="${this._escapeAttribute(value)}"]`,
          `select[placeholder="${this._escapeAttribute(value)}"]`,
        ].join(","),
      );

      if ((await locator.count()) > 0) {
        return await this._firstVisible(locator);
      }
    } catch {
      // Continue fallback
    }

    return this.resolveElement(value);
  }

  // =========================================================
  // CHECKBOX / RADIO
  // =========================================================

  async smartCheck(target, checked = true) {
    const locator = await this.resolveElement(target, {
      requireVisible: true,
      requireEnabled: true,
    });

    if (!locator) {
      return false;
    }

    try {
      const tagName = await locator.evaluate((node) =>
        String(node.tagName || "").toLowerCase(),
      );

      const type = await locator.getAttribute("type");

      if (tagName === "input" && (type === "checkbox" || type === "radio")) {
        if (checked) {
          await locator.check({
            timeout: this.options.actionTimeout,
          });
        } else if (type === "checkbox") {
          await locator.uncheck({
            timeout: this.options.actionTimeout,
          });
        }

        return true;
      }

      // ARIA checkbox/radio
      await locator.click({
        timeout: this.options.actionTimeout,
      });

      return true;
    } catch {
      return false;
    }
  }

  // =========================================================
  // VISIBILITY CHECK
  // =========================================================

  async isVisible(locator) {
    if (!locator) {
      return false;
    }

    try {
      return await locator.isVisible();
    } catch {
      return false;
    }
  }

  // =========================================================
  // ENABLED CHECK
  // =========================================================

  async isEnabled(locator) {
    if (!locator) {
      return false;
    }

    try {
      return await locator.isEnabled();
    } catch {
      return false;
    }
  }

  // =========================================================
  // INTERACTABILITY CHECK
  // =========================================================

  async isInteractable(locator) {
    if (!locator) {
      return false;
    }

    try {
      const visible = await this.isVisible(locator);

      if (!visible) {
        return false;
      }

      const enabled = await this.isEnabled(locator);

      if (!enabled) {
        return false;
      }

      return await locator.evaluate((element) => {
        const style = window.getComputedStyle(element);

        if (!style) {
          return false;
        }

        if (style.display === "none") {
          return false;
        }

        if (style.visibility === "hidden") {
          return false;
        }

        if (style.pointerEvents === "none") {
          return false;
        }

        if (
          element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true"
        ) {
          return false;
        }

        const rect = element.getBoundingClientRect();

        return rect.width > 0 && rect.height > 0;
      });
    } catch {
      return false;
    }
  }

  // =========================================================
  // USABILITY VALIDATION
  // =========================================================

  async isUsable(locator, options = {}) {
    if (!locator) {
      return false;
    }

    const requireVisible = options.requireVisible !== false;

    const requireEnabled = options.requireEnabled !== false;

    if (requireVisible) {
      const visible = await this.isVisible(locator);

      if (!visible) {
        return false;
      }
    }

    if (requireEnabled) {
      const enabled = await this.isEnabled(locator);

      if (!enabled) {
        return false;
      }
    }

    return true;
  }

  // =========================================================
  // FIRST VISIBLE LOCATOR
  // =========================================================

  async _firstVisible(locator) {
    try {
      const count = await locator.count();

      for (let i = 0; i < count; i++) {
        const candidate = locator.nth(i);

        if (await this.isVisible(candidate)) {
          return candidate;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  // =========================================================
  // IFRAME HOOK
  // =========================================================

  async resolveFrame(frameUrlOrName) {
    if (!this.options.enableIframeHooks || !this.page) {
      return null;
    }

    const value = String(frameUrlOrName || "").trim();

    if (!value) {
      return null;
    }

    try {
      const frames = this.page.frames();

      for (const frame of frames) {
        if (frame === this.page.mainFrame()) {
          continue;
        }

        const url = frame.url();

        if (url === value || url.includes(value) || frame.name() === value) {
          return frame;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  // =========================================================
  // IFRAME ELEMENT RESOLUTION
  // =========================================================

  async resolveInsideFrame(frameUrlOrName, target) {
    if (!this.options.enableIframeHooks || !this.page) {
      return null;
    }

    const frame = await this.resolveFrame(frameUrlOrName);

    if (!frame || !target) {
      return null;
    }

    try {
      const locator = frame.getByText(String(target), {
        exact: true,
      });

      if ((await locator.count()) > 0) {
        return await this._firstVisible(locator);
      }
    } catch {
      // Continue
    }

    try {
      const locator = frame.getByRole("button", {
        name: String(target),
        exact: true,
      });

      if ((await locator.count()) > 0) {
        return await this._firstVisible(locator);
      }
    } catch {
      // Continue
    }

    try {
      const locator = frame.locator(
        [
          `[aria-label="${this._escapeAttribute(target)}"]`,
          `[name="${this._escapeAttribute(target)}"]`,
          `[id="${this._escapeAttribute(target)}"]`,
        ].join(","),
      );

      if ((await locator.count()) > 0) {
        return await this._firstVisible(locator);
      }
    } catch {
      // Ignore
    }

    return null;
  }

  // =========================================================
  // SHADOW DOM HOOK
  // =========================================================

  async resolveInsideShadow(hostSelector, target) {
    if (!this.options.enableShadowDOM || !this.page) {
      return null;
    }

    if (!hostSelector || !target) {
      return null;
    }

    try {
      const host = this.page.locator(hostSelector);

      if ((await host.count()) === 0) {
        return null;
      }

      const shadowLocator = host.locator(`text="${this._escapeText(target)}"`);

      if ((await shadowLocator.count()) > 0) {
        return await this._firstVisible(shadowLocator);
      }
    } catch {
      return null;
    }

    return null;
  }

  // =========================================================
  // AUTO ACTION
  // =========================================================

  async autoAct(intent = {}) {
    if (!intent || typeof intent !== "object") {
      return false;
    }

    const action = String(intent.action || "").toLowerCase();

    const target = intent.target || intent.selector || "";

    const value = intent.value;

    switch (action) {
      case "click":
      case "browser_click":
        return this.smartClick(target);

      case "type":
      case "fill":
      case "browser_type":
        return this.smartType(target, value);

      case "select":
      case "browser_select":
        return this.smartSelect(target, value);

      case "check":
      case "checkbox":
        return this.smartCheck(target, value !== false);

      case "open":
      case "navigate":
      case "navigate_to":
        if (!target) {
          return false;
        }

        try {
          await this.page.goto(String(target), {
            waitUntil: "domcontentloaded",
            timeout: this.options.actionTimeout,
          });

          return true;
        } catch {
          return false;
        }

      default:
        return false;
    }
  }

  // =========================================================
  // CSS ESCAPE
  // =========================================================

  _escapeCSS(value) {
    const text = String(value || "");

    if (typeof CSS !== "undefined" && CSS.escape) {
      return CSS.escape(text);
    }

    return text.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
  }

  // =========================================================
  // ATTRIBUTE ESCAPE
  // =========================================================

  _escapeAttribute(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
  }

  // =========================================================
  // TEXT ESCAPE
  // =========================================================

  _escapeText(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
  }
}
