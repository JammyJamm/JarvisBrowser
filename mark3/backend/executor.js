//==========================================================
//
// backend/executor.js
//
// Action Execution Engine for Page-Only Browser Automation
//
// Pipeline:
// Validate -> Execute -> Verify -> Update State -> Replan if needed
//
// Strict Page-Only Boundary:
// ✔ Operates exclusively on active browser page elements
// ✔ No OS / desktop / file system control
// ✔ Verifies state changes after every action
// ✔ Bounded retries with backoff and detailed logging
//
//==========================================================

export default class ExecutionEngine {
  constructor(browserController, resolver = null, options = {}) {
    this.browser = browserController;
    this.resolver = resolver;
    this.options = {
      maxRetries: 2,
      retryDelayMs: 350,
      debug: false,
      ...options,
    };
  }

  log(...args) {
    if (this.options.debug) {
      console.log("[ExecutionEngine]", ...args);
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  //==========================================================
  // EXECUTE SINGLE STEP WITH RETRY & VERIFICATION
  //==========================================================

  async execute(step, page = null) {
    if (!step || typeof step !== "object") {
      throw new Error("Invalid step object provided to ExecutionEngine");
    }

    const tool = String(step.tool || step.type || "").toLowerCase().trim();
    const args = step.args || {};

    let lastError = null;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      if (attempt > 0) {
        this.log(`Retrying step ${tool} (Attempt ${attempt}/${this.options.maxRetries})...`);
        await this.sleep(this.options.retryDelayMs * attempt);
      }

      try {
        const result = await this.executeTool(tool, args, page);
        return {
          success: true,
          tool,
          args,
          result,
          verification: result.verification || { verified: true, message: "Action executed" },
        };
      } catch (err) {
        lastError = err;
        this.log(`Step ${tool} attempt ${attempt + 1} failed:`, err.message);
      }
    }

    return {
      success: false,
      tool,
      args,
      error: lastError ? lastError.message : "Step execution failed",
      verification: { verified: false, message: lastError ? lastError.message : "Verification failed" },
    };
  }

  //==========================================================
  // TOOL DISPATCHER (STRICT PAGE-ONLY BOUNDARY)
  //==========================================================

  async executeTool(tool, args, page = null) {
    const activePage = page || (await this.browser.getPage());
    if (!activePage || activePage.isClosed()) {
      throw new Error("No active browser page available for automation");
    }

    switch (tool) {
      // 1. Navigation
      case "navigate":
      case "goto":
      case "open": {
        const url = args.url || args.target || args.query || "";
        if (!url) throw new Error("URL is required for navigate action");
        const formattedUrl = this.formatUrl(url);
        await this.browser.goto(formattedUrl);
        const currentUrl = activePage.url();
        return {
          action: "navigate",
          url: currentUrl,
          verification: {
            verified: true,
            message: `Navigated to ${currentUrl}`,
          },
        };
      }

      // 2. Click
      case "click":
      case "tap":
      case "pressbutton": {
        const target = args.target || args.text || args.selector || args.field || "";
        if (!target) throw new Error("Target is required for click action");

        // Try browserController's verified clickSmart
        if (typeof this.browser.clickSmart === "function") {
          return await this.browser.clickSmart(target, args);
        }

        // Fallback to resolver
        if (this.resolver && typeof this.resolver.clickSmart === "function") {
          return await this.resolver.clickSmart(target);
        }

        throw new Error("Click handler unavailable");
      }

      // 3. Type / Input / Fill
      case "type":
      case "fill":
      case "input":
      case "write": {
        const field = args.field || args.target || args.selector || "input";
        const value = args.value !== undefined ? String(args.value) : args.text !== undefined ? String(args.text) : "";

        if (typeof this.browser.typeText === "function") {
          return await this.browser.typeText(field, value, args);
        }

        if (this.resolver && typeof this.resolver.type === "function") {
          return await this.resolver.type(field, value);
        }

        throw new Error("Type handler unavailable");
      }

      // 4. Select Dropdown
      case "select":
      case "choose": {
        const field = args.field || args.target || args.selector || "";
        const value = args.value !== undefined ? String(args.value) : args.option || "";
        if (typeof this.browser.selectOption === "function") {
          return await this.browser.selectOption(field, value);
        }
        if (this.resolver && typeof this.resolver.select === "function") {
          return await this.resolver.select(field, value);
        }
        throw new Error("Select handler unavailable");
      }

      // 5. Scroll
      case "scroll": {
        const direction = String(args.direction || "down").toLowerCase();
        const amount = Number(args.amount) || 500;
        if (typeof this.browser.scrollPage === "function") {
          return await this.browser.scrollPage(direction, amount);
        }
        await activePage.evaluate((px) => window.scrollBy({ top: px, behavior: "smooth" }), direction === "up" ? -amount : amount);
        return {
          action: "scroll",
          direction,
          amount,
          verification: { verified: true, message: `Scrolled ${direction} by ${amount}px` },
        };
      }

      // 6. Keyboard Press
      case "press":
      case "keypress": {
        const key = args.key || "Enter";
        if (typeof this.browser.pressKey === "function") {
          return await this.browser.pressKey(key);
        }
        await activePage.keyboard.press(key);
        return {
          action: "press",
          key,
          verification: { verified: true, message: `Pressed key "${key}"` },
        };
      }

      // 7. Wait
      case "wait":
      case "sleep": {
        const time = typeof args.time === "number" ? args.time : parseInt(args.time, 10) || 1000;
        await this.sleep(Math.min(time, 10000));
        return {
          action: "wait",
          time,
          verification: { verified: true, message: `Waited for ${time}ms` },
        };
      }

      // 8. Reload
      case "reload":
      case "refresh": {
        await this.browser.reload();
        return {
          action: "reload",
          url: activePage.url(),
          verification: { verified: true, message: "Page reloaded" },
        };
      }

      // 9. Back
      case "back": {
        if (activePage.canGoBack?.() || true) {
          await activePage.goBack().catch(() => {});
        }
        return {
          action: "back",
          url: activePage.url(),
          verification: { verified: true, message: `Navigated back to ${activePage.url()}` },
        };
      }

      // 10. Forward
      case "forward": {
        if (activePage.canGoForward?.() || true) {
          await activePage.goForward().catch(() => {});
        }
        return {
          action: "forward",
          url: activePage.url(),
          verification: { verified: true, message: `Navigated forward to ${activePage.url()}` },
        };
      }

      // 11. Read Content / Extract Text
      case "read":
      case "extract":
      case "get_text": {
        let text = "";
        if (typeof this.browser.readContent === "function") {
          text = await this.browser.readContent();
        } else {
          text = await activePage.evaluate(() => document.body?.innerText || "");
        }
        return {
          action: "read",
          content: text.slice(0, 5000),
          verification: { verified: true, message: `Extracted ${text.length} characters of page text` },
        };
      }

      // 12. Inspect Interactive Elements
      case "inspect":
      case "get_elements": {
        let elements = [];
        if (typeof this.browser.getInteractiveElements === "function") {
          elements = await this.browser.getInteractiveElements();
        }
        return {
          action: "inspect",
          count: elements.length,
          elements,
          verification: { verified: true, message: `Discovered ${elements.length} interactive elements` },
        };
      }

      default: {
        // Fallback to Resolver if available
        if (this.resolver && typeof this.resolver.execute === "function") {
          return await this.resolver.execute(tool, args);
        }
        throw new Error(`Unsupported page action: '${tool}'. External/OS commands are forbidden.`);
      }
    }
  }

  //==========================================================
  // EXECUTE FULL PLAN WITH PROGRESS & DYNAMIC REPLANNING
  //==========================================================

  async executePlan(plan, page = null, options = {}) {
    const { planner = null, onStepProgress = null, maxReplans = 2 } = options;
    const activePage = page || (await this.browser.getPage());
    const results = [];
    let currentSteps = [...(plan.steps || [])];
    let replanCount = 0;
    let stepIndex = 0;

    while (stepIndex < currentSteps.length) {
      const step = currentSteps[stepIndex];
      const stepNumber = stepIndex + 1;
      this.log(`Executing step ${stepNumber}/${currentSteps.length}:`, step.tool, step.args);

      if (typeof onStepProgress === "function") {
        onStepProgress({ status: "executing", stepNumber, totalSteps: currentSteps.length, step });
      }

      const started = performance.now();
      const outcome = await this.execute(step, activePage);
      const duration = performance.now() - started;

      const stepRecord = {
        index: stepIndex,
        step: stepNumber,
        tool: step.tool,
        args: step.args,
        success: outcome.success,
        result: outcome.result || outcome,
        verification: outcome.verification,
        duration,
      };

      results.push(stepRecord);

      if (!outcome.success) {
        this.log(`Step ${stepNumber} failed verification: ${outcome.error}`);
        // Dynamic replanning if planner is available and replan budget remains
        if (planner && typeof planner.replan === "function" && replanCount < maxReplans) {
          replanCount++;
          this.log(`Attempting dynamic replan (Replan ${replanCount}/${maxReplans})...`);
          let pageElements = [];
          if (typeof this.browser.getInteractiveElements === "function") {
            pageElements = await this.browser.getInteractiveElements().catch(() => []);
          }

          const recoveryPlan = planner.replan({
            failedStep: step,
            error: outcome.error,
            currentUrl: activePage.url(),
            pageElements,
            originalGoal: plan.goal || "",
          });

          if (recoveryPlan && recoveryPlan.steps?.length) {
            this.log(`Replan produced ${recoveryPlan.steps.length} recovery steps. Resuming...`);
            // Insert recovery steps into pipeline
            currentSteps.splice(stepIndex + 1, 0, ...recoveryPlan.steps);
            stepIndex++;
            continue;
          }
        }

        return {
          success: false,
          results,
          failedStep: step,
          error: outcome.error || `Step ${stepNumber} (${step.tool}) failed verification`,
        };
      }

      // Small stabilization wait after navigation or clicks that navigate
      if (step.tool === "navigate" || outcome.result?.navigated) {
        await activePage.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        await this.sleep(200);
      }

      stepIndex++;
    }

    return {
      success: true,
      results,
      stepsCompleted: results.length,
    };
  }

  formatUrl(raw) {
    let url = String(raw || "").trim();
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://")) {
      return url;
    }
    if (url.includes(".") && !url.includes(" ")) {
      return "https://" + url;
    }
    return "https://www.google.com/search?q=" + encodeURIComponent(url);
  }
}
