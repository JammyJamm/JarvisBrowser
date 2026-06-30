// dom-strategy.js
//
// Smart DOM Strategy Engine
// --------------------------------------------------
// Features:
// ✅ Robust element selection strategy
// ✅ Multiple fallback locators
// ✅ Smart click/type heuristics
// ✅ Visibility + interactability checks
// ✅ Shadow DOM + iframe awareness hooks (optional extension)
// --------------------------------------------------

export default class DOMStrategy {
  constructor(page) {
    this.page = page;

    this.selectors = {
      clickable: [
        "button",
        "a",
        "[role='button']",
        "[onclick]",
        "input[type='submit']",
        "input[type='button']",
      ],
      input: ["input", "textarea", "[contenteditable='true']"],
    };
  }

  // =====================================================
  // MAIN RESOLVER
  // =====================================================
  async resolveElement(target) {
    if (!target) return null;

    const strategies = [
      () => this.byExactText(target),
      () => this.byPartialText(target),
      () => this.byAttributeMatch(target),
      () => this.byQuerySelector(target),
    ];

    for (const strategy of strategies) {
      try {
        const el = await strategy();
        if (el) return el;
      } catch (err) {
        continue;
      }
    }

    return null;
  }

  // =====================================================
  // TEXT STRATEGIES
  // =====================================================
  async byExactText(text) {
    const handle = await this.page.evaluateHandle((text) => {
      const elements = Array.from(document.querySelectorAll("*"));
      return elements.find(
        (el) => el.innerText?.trim() === text && el.offsetParent !== null,
      );
    }, text);

    return this._isValidHandle(handle) ? handle : null;
  }

  async byPartialText(text) {
    const handle = await this.page.evaluateHandle((text) => {
      const elements = Array.from(document.querySelectorAll("*"));
      return elements.find(
        (el) =>
          el.innerText?.toLowerCase().includes(text.toLowerCase()) &&
          el.offsetParent !== null,
      );
    }, text);

    return this._isValidHandle(handle) ? handle : null;
  }

  // =====================================================
  // ATTRIBUTE MATCHING
  // =====================================================
  async byAttributeMatch(keyword) {
    const handle = await this.page.evaluateHandle((keyword) => {
      const elements = Array.from(document.querySelectorAll("*"));

      return elements.find((el) => {
        const attrs = [
          el.getAttribute("id"),
          el.getAttribute("name"),
          el.getAttribute("class"),
          el.getAttribute("aria-label"),
          el.getAttribute("placeholder"),
        ]
          .filter(Boolean)
          .join(" ");

        return attrs.toLowerCase().includes(keyword.toLowerCase());
      });
    }, keyword);

    return this._isValidHandle(handle) ? handle : null;
  }

  // =====================================================
  // CSS SELECTOR FALLBACK
  // =====================================================
  async byQuerySelector(selector) {
    try {
      const handle = await this.page.$(selector);
      return handle || null;
    } catch {
      return null;
    }
  }

  // =====================================================
  // CLICK STRATEGY
  // =====================================================
  async smartClick(target) {
    const el = await this.resolveElement(target);
    if (!el) return false;

    try {
      await el.evaluate((node) =>
        node.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
      await el.click({ delay: 30 });
      return true;
    } catch {
      // fallback: force click via JS
      try {
        await el.evaluate((node) => node.click());
        return true;
      } catch {
        return false;
      }
    }
  }

  // =====================================================
  // TYPE STRATEGY
  // =====================================================
  async smartType(target, text) {
    const el = await this.resolveInput(target);
    if (!el) return false;

    try {
      await el.click();
      await this.page.keyboard.type(text, { delay: 20 });
      return true;
    } catch {
      try {
        await el.evaluate((node, value) => {
          node.value = value;
          node.dispatchEvent(new Event("input", { bubbles: true }));
        }, text);
        return true;
      } catch {
        return false;
      }
    }
  }

  // =====================================================
  // INPUT RESOLVER
  // =====================================================
  async resolveInput(target) {
    const strategies = [
      () => this.page.$(`input[name*="${target}"]`),
      () => this.page.$(`input[placeholder*="${target}"]`),
      () => this.page.$(`textarea[name*="${target}"]`),
      () => this.resolveElement(target),
    ];

    for (const s of strategies) {
      try {
        const el = await s();
        if (el) return el;
      } catch {
        continue;
      }
    }

    return null;
  }

  // =====================================================
  // VISIBILITY CHECK
  // =====================================================
  async isVisible(handle) {
    if (!handle) return false;

    try {
      return await handle.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return (
          style &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          el.offsetWidth > 0 &&
          el.offsetHeight > 0
        );
      });
    } catch {
      return false;
    }
  }

  // =====================================================
  // VALIDATION
  // =====================================================
  _isValidHandle(handle) {
    return handle && typeof handle.asElement === "function";
  }

  // =====================================================
  // ADVANCED ACTION: AUTO DETECT & ACT
  // =====================================================
  async autoAct(intent) {
    const { action, target, value } = intent;

    switch (action) {
      case "click":
        return await this.smartClick(target);

      case "type":
        return await this.smartType(target, value);

      case "open":
        await this.page.goto(target);
        return true;

      default:
        return false;
    }
  }
}
