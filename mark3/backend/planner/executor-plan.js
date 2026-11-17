// executor-plan.js
//
// Jarvis Browser - Plan Executor Engine
//
// Features:
// ✅ Executes structured JSON plans
// ✅ Supports Playwright-style actions
// ✅ Retry + error recovery
// ✅ Step logging & debugging
// ✅ Safe async execution
// ✅ Extensible action system
//

class ExecutorPlan {
  constructor(options = {}) {
    this.page = options.page; // Playwright page instance
    this.context = options.context || null;

    this.maxRetries = options.maxRetries || 2;
    this.stepDelay = options.stepDelay || 100;

    this.logger = options.logger || console;

    this.actions = {
      navigate: this.navigate.bind(this),
      click: this.click.bind(this),
      type: this.type.bind(this),
      wait: this.wait.bind(this),
      extract: this.extract.bind(this),
      evaluate: this.evaluate.bind(this),
      scroll: this.scroll.bind(this),
      screenshot: this.screenshot.bind(this),
    };
  }

  // =====================================================
  // MAIN RUNNER
  // =====================================================
  async run(plan) {
    if (!plan || !Array.isArray(plan.steps)) {
      throw new Error("Invalid plan: missing steps array");
    }

    this.logger.log(`[Executor] Starting plan with ${plan.steps.length} steps`);

    const results = [];

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];

      const result = await this.executeStep(step, i);
      results.push(result);

      await this.sleep(this.stepDelay);
    }

    this.logger.log("[Executor] Plan execution completed");

    return results;
  }

  // =====================================================
  // STEP EXECUTION
  // =====================================================
  async executeStep(step, index) {
    const action = step.action;
    const params = step.params || {};

    this.logger.log(`[Step ${index}] Action: ${action}`);

    if (!this.actions[action]) {
      return {
        step: index,
        action,
        success: false,
        error: `Unknown action: ${action}`,
      };
    }

    let attempt = 0;

    while (attempt <= this.maxRetries) {
      try {
        const result = await this.actions[action](params);

        return {
          step: index,
          action,
          success: true,
          result,
        };
      } catch (err) {
        attempt++;

        this.logger.warn(
          `[Step ${index}] Attempt ${attempt} failed: ${err.message}`,
        );

        if (attempt > this.maxRetries) {
          return {
            step: index,
            action,
            success: false,
            error: err.message,
          };
        }

        await this.sleep(200 * attempt);
      }
    }
  }

  // =====================================================
  // ACTIONS
  // =====================================================

  async navigate({ url }) {
    if (!url) throw new Error("navigate: missing url");

    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
    });

    return { navigated: url };
  }

  async click({ selector, index = 0 }) {
    if (!selector) throw new Error("click: missing selector");

    const elements = await this.page.$$(selector);

    if (!elements.length) {
      throw new Error(`click: no elements found for ${selector}`);
    }

    await elements[index].click();

    return { clicked: selector, index };
  }

  async type({ selector, text, delay = 50 }) {
    if (!selector || text === undefined) {
      throw new Error("type: missing selector or text");
    }

    await this.page.fill(selector, "");
    await this.page.type(selector, text, { delay });

    return { typed: text, selector };
  }

  async wait({ time }) {
    await this.sleep(time || 1000);
    return { waited: time };
  }

  async extract({ selector, attribute = "textContent" }) {
    if (!selector) throw new Error("extract: missing selector");

    const value = await this.page.$eval(
      selector,
      (el, attr) => {
        return el[attr];
      },
      attribute,
    );

    return { selector, value };
  }

  async evaluate({ script }) {
    if (!script) throw new Error("evaluate: missing script");

    const result = await this.page.evaluate(script);

    return { result };
  }

  async scroll({ direction = "down", amount = 800 }) {
    await this.page.evaluate(
      ({ direction, amount }) => {
        if (direction === "down") {
          window.scrollBy(0, amount);
        } else {
          window.scrollBy(0, -amount);
        }
      },
      { direction, amount },
    );

    return { scrolled: direction, amount };
  }

  async screenshot({ path }) {
    if (!path) throw new Error("screenshot: missing path");

    await this.page.screenshot({ path });

    return { screenshot: path };
  }

  // =====================================================
  // UTILITIES
  // =====================================================
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = ExecutorPlan;
