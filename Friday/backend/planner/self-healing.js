/**
 * backend/planner/self-healing.js
 *
 * Ultra Self Healing Engine
 *
 * Responsibilities
 * ----------------
 * ✔ Retry failed actions
 * ✔ DOM recovery
 * ✔ Accessibility recovery
 * ✔ iframe recovery
 * ✔ ShadowDOM recovery
 * ✔ Overlay recovery
 * ✔ ScoringEngine integration
 * ✔ Planner fallback
 * ✔ Adaptive retries
 * ✔ Candidate learning
 * ✔ Recovery statistics
 */

export default class SelfHealingEngine {
  constructor(options = {}) {
    //--------------------------------------------------
    // Configuration
    //--------------------------------------------------

    this.options = {
      maxRetries: 4,

      retryDelay: 300,

      adaptiveDelay: true,

      enableLearning: true,

      enablePlanner: true,

      enableDOMRecovery: true,

      enableFrameRecovery: true,

      enableShadowRecovery: true,

      enableOverlayRecovery: true,

      enableNavigationRecovery: true,

      enableAccessibilityRecovery: true,

      debug: false,

      logger: console,

      ...options,
    };

    //--------------------------------------------------
    // Dependencies
    //--------------------------------------------------

    this.browser = options.browser || null;

    this.scoringEngine = options.scoringEngine || null;

    this.planner = options.planner || null;

    //--------------------------------------------------
    // Runtime
    //--------------------------------------------------

    this.history = [];

    this.recoveryCache = new Map();

    this.lastRecovery = null;

    this.runningRecovery = false;

    //--------------------------------------------------
    // Statistics
    //--------------------------------------------------

    this.metrics = {
      executions: 0,

      successfulExecutions: 0,

      failedExecutions: 0,

      retries: 0,

      timeoutRecoveries: 0,

      detachedRecoveries: 0,

      iframeRecoveries: 0,

      shadowRecoveries: 0,

      overlayRecoveries: 0,

      navigationRecoveries: 0,

      accessibilityRecoveries: 0,

      genericRecoveries: 0,

      plannerRecoveries: 0,

      learnedRecoveries: 0,

      domRebuilds: 0,

      cacheHits: 0,

      cacheMisses: 0,
    };

    //--------------------------------------------------
    // Error Classifier
    //--------------------------------------------------

    this.errorMap = {
      timeout: ["timeout", "timed out", "waiting failed", "exceeded timeout"],

      detached: [
        "detached",

        "not attached",

        "stale element",

        "execution context was destroyed",
      ],

      invisible: ["not visible", "hidden", "zero size"],

      disabled: ["disabled", "readonly"],

      intercepted: [
        "another element",

        "intercepts pointer",

        "would receive the click",

        "element is obscured",
      ],

      iframe: ["iframe", "frame", "content frame"],

      shadow: ["shadow", "shadowroot", "shadow root"],

      navigation: [
        "navigation",

        "execution context",

        "page closed",

        "target closed",
      ],

      accessibility: ["aria", "accessible", "role"],
    };
  }

  //==================================================
  // LOGGING
  //==================================================

  log(...args) {
    if (this.options.debug) {
      this.options.logger.log(
        "[SelfHealing]",

        ...args,
      );
    }
  }

  warn(...args) {
    this.options.logger.warn(
      "[SelfHealing]",

      ...args,
    );
  }

  error(...args) {
    this.options.logger.error(
      "[SelfHealing]",

      ...args,
    );
  }

  //==================================================
  // HELPERS
  //==================================================

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  adaptiveRetryDelay(attempt) {
    if (!this.options.adaptiveDelay) {
      return this.options.retryDelay;
    }

    return Math.min(
      this.options.retryDelay * attempt,

      3000,
    );
  }

  recordHistory(entry) {
    this.history.push({
      timestamp: Date.now(),

      ...entry,
    });

    if (this.history.length > 1000) {
      this.history.shift();
    }
  }

  clearHistory() {
    this.history.length = 0;
  }

  //==================================================
  // PART 2
  // Execute
  // Recovery Router
  // Error Classification
  //==================================================
  //==================================================
  // EXECUTE
  //==================================================

  async execute(executor, context = {}) {
    this.metrics.executions++;

    let lastError = null;

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        const result = await executor(context);

        this.metrics.successfulExecutions++;

        this.recordHistory({
          success: true,

          attempt,

          action: context.action,

          target: context.query || context.target,
        });

        return result;
      } catch (err) {
        lastError = err;

        this.metrics.retries++;

        this.warn(
          `Attempt ${attempt}/${this.options.maxRetries} failed:`,

          err.message,
        );

        //--------------------------------------------------
        // Try recovery
        //--------------------------------------------------

        const recovered = await this.recover(
          err,

          context,

          attempt,
        );

        if (!recovered) {
          break;
        }

        //--------------------------------------------------
        // Adaptive delay
        //--------------------------------------------------

        await this.sleep(this.adaptiveRetryDelay(attempt));
      }
    }

    //--------------------------------------------------
    // Failed
    //--------------------------------------------------

    this.metrics.failedExecutions++;

    this.recordHistory({
      success: false,

      action: context.action,

      target: context.query || context.target,

      error: lastError?.message,
    });

    throw lastError;
  }

  //==================================================
  // RECOVERY ROUTER
  //==================================================

  async recover(
    error,

    context,

    attempt,
  ) {
    this.runningRecovery = true;

    try {
      const type = this.classify(error);

      this.lastRecovery = {
        type,

        timestamp: Date.now(),

        attempt,
      };

      this.log(
        "Recovery:",

        type,
      );

      switch (type) {
        case "timeout":
          this.metrics.timeoutRecoveries++;

          return await this.timeoutRecovery(
            context,

            attempt,
          );

        case "detached":
          this.metrics.detachedRecoveries++;

          return await this.detachedRecovery(context);

        case "iframe":
          this.metrics.iframeRecoveries++;

          return await this.iframeRecovery(context);

        case "shadow":
          this.metrics.shadowRecoveries++;

          return await this.shadowRecovery(context);

        case "intercepted":
          this.metrics.overlayRecoveries++;

          return await this.overlayRecovery(context);

        case "navigation":
          this.metrics.navigationRecoveries++;

          return await this.navigationRecovery(context);

        case "accessibility":
          this.metrics.accessibilityRecoveries++;

          return await this.accessibilityRecovery(context);

        default:
          this.metrics.genericRecoveries++;

          return await this.genericRecovery(context);
      }
    } finally {
      this.runningRecovery = false;
    }
  }

  //==================================================
  // ERROR CLASSIFIER
  //==================================================

  classify(error) {
    const message = String(error?.message || error).toLowerCase();

    for (const [type, keywords] of Object.entries(this.errorMap)) {
      if (keywords.some((keyword) => message.includes(keyword.toLowerCase()))) {
        return type;
      }
    }

    return "generic";
  }

  //==================================================
  // CACHE HELPERS
  //==================================================

  getRecoveryCache(key) {
    if (!this.recoveryCache.has(key)) {
      this.metrics.cacheMisses++;

      return null;
    }

    this.metrics.cacheHits++;

    return this.recoveryCache.get(key);
  }

  setRecoveryCache(
    key,

    value,
  ) {
    this.recoveryCache.set(key, {
      timestamp: Date.now(),

      value,
    });
  }

  clearRecoveryCache() {
    this.recoveryCache.clear();
  }

  //==================================================
  // PART 3
  // Timeout Recovery
  // Detached Recovery
  // iframe Recovery
  // Shadow DOM Recovery
  // Overlay Recovery
  // Navigation Recovery
  // Accessibility Recovery
  //==================================================
  //==================================================
  // TIMEOUT RECOVERY
  //==================================================

  async timeoutRecovery(context, attempt) {
    this.log("Timeout recovery...", attempt);

    //--------------------------------------------------
    // Wait for page idle
    //--------------------------------------------------

    if (this.browser?.waitForPageIdle) {
      try {
        await this.browser.waitForPageIdle();
      } catch {}
    }

    //--------------------------------------------------
    // Wait for load state
    //--------------------------------------------------

    if (this.browser?.waitForLoadState) {
      try {
        await this.browser.waitForLoadState("networkidle");
      } catch {}
    }

    //--------------------------------------------------
    // Refresh DOM
    //--------------------------------------------------

    if (this.options.enableDOMRecovery) {
      await this.refreshDOM(context);
    }

    return true;
  }

  //==================================================
  // DETACHED ELEMENT RECOVERY
  //==================================================

  async detachedRecovery(context) {
    this.log("Detached element recovery...");

    if (!this.options.enableDOMRecovery) {
      return false;
    }

    await this.refreshDOM(context);

    return await this.recoverCandidate(context);
  }

  //==================================================
  // IFRAME RECOVERY
  //==================================================

  async iframeRecovery(context) {
    this.log("Iframe recovery...");

    if (!this.options.enableFrameRecovery) {
      return false;
    }

    try {
      if (this.browser?.refreshFrames) {
        await this.browser.refreshFrames();
      }

      if (this.browser?.getFrames) {
        await this.browser.getFrames();
      }

      await this.refreshDOM(context);

      return await this.recoverCandidate(context);
    } catch (err) {
      this.warn("Iframe recovery failed:", err.message);

      return false;
    }
  }

  //==================================================
  // SHADOW DOM RECOVERY
  //==================================================

  async shadowRecovery(context) {
    this.log("Shadow DOM recovery...");

    if (!this.options.enableShadowRecovery) {
      return false;
    }

    try {
      if (this.browser?.scanShadowDOM) {
        const elements = await this.browser.scanShadowDOM();

        if (elements?.length && this.scoringEngine?.updateIndex) {
          this.scoringEngine.updateIndex(elements);
        }
      }

      return await this.recoverCandidate(context);
    } catch (err) {
      this.warn(
        "Shadow recovery failed:",

        err.message,
      );

      return false;
    }
  }

  //==================================================
  // OVERLAY RECOVERY
  //==================================================

  async overlayRecovery(context) {
    this.log("Overlay recovery...");

    if (!this.options.enableOverlayRecovery) {
      return false;
    }

    try {
      if (this.browser?.dismissOverlays) {
        await this.browser.dismissOverlays();
      }

      await this.sleep(250);

      return true;
    } catch (err) {
      this.warn(
        "Overlay recovery failed:",

        err.message,
      );

      return false;
    }
  }

  //==================================================
  // NAVIGATION RECOVERY
  //==================================================

  async navigationRecovery(context) {
    this.log("Navigation recovery...");

    if (!this.options.enableNavigationRecovery) {
      return false;
    }

    try {
      if (this.browser?.waitForNavigation) {
        await this.browser.waitForNavigation();
      }

      if (this.browser?.waitForLoadState) {
        await this.browser.waitForLoadState("networkidle");
      }

      await this.refreshDOM(context);

      return await this.recoverCandidate(context);
    } catch (err) {
      this.warn(
        "Navigation recovery failed:",

        err.message,
      );

      return false;
    }
  }

  //==================================================
  // ACCESSIBILITY RECOVERY
  //==================================================

  async accessibilityRecovery(context) {
    this.log("Accessibility recovery...");

    if (!this.options.enableAccessibilityRecovery) {
      return false;
    }

    try {
      await this.refreshDOM(context);

      return await this.recoverCandidate(
        context,

        {
          includeARIA: true,

          includeRoles: true,
        },
      );
    } catch (err) {
      this.warn(
        "Accessibility recovery failed:",

        err.message,
      );

      return false;
    }
  }
}
