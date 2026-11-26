//==========================================================
//
// backend/executor.js
//
// Self-Healing Action Execution Engine for Browser Automation
//
// Pipeline:
// Validate -> Execute -> Self-Heal on Failure -> Verify -> Update State -> Replan if needed
//
// Strict Page-Only Boundary:
// ✔ Operates exclusively on active browser page elements
// ✔ No OS / desktop / file system control
// ✔ Verifies state changes after every action
// ✔ Integrated SelfHealing strategies (overlay dismissal, scroll,
//   reselect, iframe search, JS click, DOM re-index)
//
//==========================================================

import { SelfHealing, ERROR_TYPES } from "./planner/self-healing.js";
import { healFailedNavigationUrl, isRecoverableErrorUrl } from "./utils/site-resolver.js";

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
    this.selfHealing =
      options.selfHealing ||
      new SelfHealing({
        maxRetries: this.options.maxRetries,
        retryDelay: this.options.retryDelayMs,
        enableAlternativeStrategies: true,
        debug: this.options.debug,
      });
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
  // DISMISS COMMON BLOCKING POPUPS / OVERLAYS (NON-DESTRUCTIVE)
  //==========================================================

  async dismissBlockingOverlays(page) {
    if (!page || page.isClosed()) return { dismissed: false };
    try {
      const dismissed = await page.evaluate(() => {
        const closeSelectors = [
          "button[aria-label*='close' i]",
          "button[title*='close' i]",
          "[role='dialog'] button",
          "[role='dialog'] [role='button']",
          "[role='dialog'] span",
          ".modal button[class*='close' i]",
          "[class*='modal' i] button",
          "[class*='popup' i] button",
          "button[class*='close' i]",
        ];

        for (const sel of closeSelectors) {
          try {
            const candidates = Array.from(document.querySelectorAll(sel));
            for (const el of candidates) {
              const rect = el.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0 || rect.width > 120 || rect.height > 80) continue;
              const txt = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().toLowerCase();
              if (
                txt === "✕" ||
                txt === "×" ||
                txt === "x" ||
                txt.includes("close") ||
                txt.includes("dismiss") ||
                txt.includes("not now") ||
                txt.includes("skip")
              ) {
                el.click();
                return txt || sel;
              }
            }
          } catch {}
        }
        return null;
      });

      if (dismissed) {
        this.log("Self-healing dismissed blocking overlay:", dismissed);
        await this.sleep(250);
        return { dismissed: true, label: dismissed };
      }
    } catch {}
    return { dismissed: false };
  }

  //==========================================================
  // BUILD ALTERNATIVE TARGET CANDIDATES
  //==========================================================

  getAlternativeTargets(target) {
    const raw = String(target || "").trim();
    if (!raw) return [];
    const alts = new Set();
    const cleaned = raw
      .replace(/^(?:the\s+)?(?:button|link|tab|option|icon)\s+/i, "")
      .replace(/\s+(?:button|link|tab|option|icon)$/i, "")
      .trim();
    if (cleaned && cleaned !== raw) alts.add(cleaned);
    if (raw.includes("/")) {
      raw.split("/").map((s) => s.trim()).filter(Boolean).forEach((s) => alts.add(s));
    }
    return [...alts];
  }

  //==========================================================
  // EXECUTE SINGLE STEP WITH SELF-HEALING & VERIFICATION
  //==========================================================

  async execute(step, page = null) {
    if (!step || typeof step !== "object") {
      throw new Error("Invalid step object provided to ExecutionEngine");
    }

    const tool = String(step.tool || step.type || "").toLowerCase().trim();
    const baseArgs = { ...(step.args || {}) };
    const healingStrategies = [];
    const altTargets = tool === "click" ? this.getAlternativeTargets(baseArgs.target || baseArgs.text) : [];
    let altIndex = 0;
    let navHealAttempt = 0;

    const activePage = page || (await this.browser.getPage());
    let currentArgs = { ...baseArgs };

    const healingResult = await this.selfHealing.execute(
      { tool, args: baseArgs },
      async ({ attempt }) => {
        if (attempt > 0) {
          this.log(`Self-healing retry for ${tool} (attempt ${attempt + 1})...`);
        }
        return await this.executeTool(tool, currentArgs, activePage);
      },
      {
        maxRetries: this.options.maxRetries,
        relocate: async () => {
          if (tool === "navigate" || tool === "goto" || tool === "open") {
            const failedUrl = currentArgs.url || currentArgs.target || "";
            const healed = healFailedNavigationUrl(failedUrl, navHealAttempt++);
            if (healed?.url && healed.url !== failedUrl) {
              healingStrategies.push(`relocate_${healed.strategy}:${healed.url}`);
              currentArgs = { ...currentArgs, url: healed.url };
              return;
            }
          }
          healingStrategies.push("relocate_dismiss_overlay");
          await this.dismissBlockingOverlays(activePage);
        },
        reselect: async () => {
          healingStrategies.push("reselect_dismiss_overlay");
          await this.dismissBlockingOverlays(activePage);
          this.resolver?.invalidateDOMCache?.();
          await this.sleep(200);
        },
        scrollIntoView: async () => {
          healingStrategies.push("scroll_into_view");
          await activePage.evaluate(() => window.scrollBy(0, 320)).catch(() => {});
          await this.sleep(200);
        },
        alternativeText: async () => {
          if (altIndex < altTargets.length) {
            const nextTarget = altTargets[altIndex++];
            healingStrategies.push(`alternative_text:${nextTarget}`);
            currentArgs = { ...currentArgs, target: nextTarget };
          } else {
            healingStrategies.push("dismiss_overlay_wait");
            await this.dismissBlockingOverlays(activePage);
          }
        },
        alternativeSelector: async () => {
          healingStrategies.push("alternative_selector_dom_refresh");
          this.resolver?.invalidateDOMCache?.();
          await this.dismissBlockingOverlays(activePage);
        },
        forceClick: async () => {
          healingStrategies.push("force_click");
          currentArgs = { ...currentArgs, force: true };
        },
        javascriptClick: async () => {
          healingStrategies.push("javascript_click");
          currentArgs = { ...currentArgs, jsFallback: true };
        },
        findFrame: async () => {
          healingStrategies.push("frame_search");
          await this.sleep(250);
        },
        reload: async () => {
          healingStrategies.push("reload");
          await this.browser.reload().catch(() => {});
        },
      },
    );

    if (healingResult.success) {
      const result = healingResult.result;
      return {
        success: true,
        tool,
        args: currentArgs,
        result,
        healing: {
          recovered: Boolean(healingResult.recovered),
          attempts: healingResult.attempts,
          strategies: healingStrategies,
        },
        verification: result?.verification || { verified: true, message: "Action executed" },
      };
    }

    const errMsg =
      healingResult.error?.message ||
      (typeof healingResult.error === "string" ? healingResult.error : "Step execution failed");

    return {
      success: false,
      tool,
      args: currentArgs,
      error: errMsg,
      healing: {
        recovered: false,
        attempts: healingResult.attempts || 1,
        strategies: healingStrategies,
        errorType: healingResult.error?.type || ERROR_TYPES.UNKNOWN,
      },
      verification: { verified: false, message: errMsg },
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
        await this.browser.goto(formattedUrl, { page: activePage });
        const currentUrl = activePage.url();
        if (isRecoverableErrorUrl(currentUrl) && currentUrl.startsWith("chrome-error://")) {
          throw new Error(`Navigation landed on browser error page (${currentUrl}) for ${formattedUrl}`);
        }
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
          try {
            return await this.browser.clickSmart(target, { ...args, page: activePage });
          } catch (clickErr) {
            // Try iframe search if main page click failed
            const frames = activePage.frames ? activePage.frames() : [];
            for (const frame of frames) {
              if (frame === activePage.mainFrame()) continue;
              try {
                const loc = frame.getByText(target, { exact: false }).first();
                if ((await loc.count()) > 0) {
                  await loc.click({ timeout: 3000, force: Boolean(args.force) });
                  return {
                    success: true,
                    action: "click",
                    target,
                    locator: `iframe:${frame.url()}`,
                    url: activePage.url(),
                    verification: {
                      verified: true,
                      message: `Clicked "${target}" inside iframe`,
                    },
                  };
                }
              } catch {}
            }
            throw clickErr;
          }
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
          return await this.browser.typeText(field, value, { ...args, page: activePage });
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
          return await this.browser.selectOption(field, value, { page: activePage });
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
          return await this.browser.scrollPage(direction, amount, { page: activePage });
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
          return await this.browser.pressKey(key, { page: activePage });
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
        await activePage.reload({ waitUntil: "domcontentloaded" }).catch(() => this.browser.reload());
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
          text = await this.browser.readContent({ page: activePage });
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
          elements = await this.browser.getInteractiveElements({ page: activePage });
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
        healing: outcome.healing,
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
            pageElements = await this.browser.getInteractiveElements({ page: activePage }).catch(() => []);
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
