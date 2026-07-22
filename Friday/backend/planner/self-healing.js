// backend/planner/self-healing.js
//
// ============================================================
// Jarvis Browser - Self Healing Engine
// backend/planner/self-healing.js
//
// Purpose
// ------------------------------------------------------------
// Automatically recover failed browser/planner actions.
//
// Architecture
// ------------------------------------------------------------
//
// User Command
//      │
//      ▼
// Intent Parser
//      │
//      ▼
// Scoring Engine
//      │
//      ▼
// Planner
//      │
//      ▼
// Resolver
//      │
//      ▼
// Executor
//      │
//      ├── SUCCESS ───────────────► Complete
//      │
//      └── FAILURE
//            │
//            ▼
//       SelfHealing
//            │
//            ├── Classify Error
//            ├── Inspect Failure
//            ├── Generate Recovery
//            ├── Retry
//            ├── Change Strategy
//            └── Report Result
//
// Responsibilities
// ------------------------------------------------------------
// ✔ Detect failed actions
// ✔ Classify common browser failures
// ✔ Retry failed actions
// ✔ Change execution strategy
// ✔ Handle stale elements
// ✔ Handle timeout failures
// ✔ Handle selector failures
// ✔ Handle iframe failures
// ✔ Handle visibility failures
// ✔ Handle navigation failures
// ✔ Handle click failures
// ✔ Handle type/input failures
// ✔ Generate recovery strategies
// ✔ Maintain healing history
// ✔ Prevent infinite retry loops
// ✔ Provide diagnostics
//
// IMPORTANT
// ------------------------------------------------------------
// This file NEVER:
//
// ❌ Performs DOM ranking
// ❌ Performs fuzzy matching
// ❌ Replaces ScoringEngine
// ❌ Replaces Planner
// ❌ Directly controls browser unless explicitly injected
//
// SelfHealing is a recovery/orchestration layer.
//
// ============================================================

// ============================================================
// DEFAULT OPTIONS
// ============================================================

const DEFAULT_OPTIONS = {
  maxRetries: 3,

  retryDelay: 250,

  backoffMultiplier: 1.5,

  maxRetryDelay: 3000,

  enableAlternativeStrategies: true,

  enableErrorClassification: true,

  enableHistory: true,

  maxHistory: 500,

  stopOnNavigationFailure: false,

  debug: false,

  logger: console,
};

// ============================================================
// ERROR TYPES
// ============================================================

export const ERROR_TYPES = Object.freeze({
  UNKNOWN: "UNKNOWN",

  TIMEOUT: "TIMEOUT",

  SELECTOR_NOT_FOUND: "SELECTOR_NOT_FOUND",

  ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",

  ELEMENT_NOT_VISIBLE: "ELEMENT_NOT_VISIBLE",

  ELEMENT_NOT_INTERACTABLE: "ELEMENT_NOT_INTERACTABLE",

  CLICK_FAILED: "CLICK_FAILED",

  TYPE_FAILED: "TYPE_FAILED",

  NAVIGATION_FAILED: "NAVIGATION_FAILED",

  FRAME_NOT_FOUND: "FRAME_NOT_FOUND",

  IFRAME_ERROR: "IFRAME_ERROR",

  STALE_ELEMENT: "STALE_ELEMENT",

  DETACHED_ELEMENT: "DETACHED_ELEMENT",

  PAGE_CLOSED: "PAGE_CLOSED",

  CONTEXT_CLOSED: "CONTEXT_CLOSED",

  BROWSER_ERROR: "BROWSER_ERROR",

  NETWORK_ERROR: "NETWORK_ERROR",

  PERMISSION_ERROR: "PERMISSION_ERROR",

  VALIDATION_ERROR: "VALIDATION_ERROR",
});

// ============================================================
// RECOVERY STRATEGIES
// ============================================================

export const RECOVERY_STRATEGIES = Object.freeze({
  RETRY: "retry",

  WAIT: "wait",

  RELOCATE: "relocate",

  REFRESH: "refresh",

  RELOAD: "reload",

  RESELECT: "reselect",

  SCROLL_INTO_VIEW: "scroll_into_view",

  FORCE_CLICK: "force_click",

  JAVASCRIPT_CLICK: "javascript_click",

  FRAME_SEARCH: "frame_search",

  FRAME_RETRY: "frame_retry",

  ALTERNATIVE_SELECTOR: "alternative_selector",

  ALTERNATIVE_TEXT: "alternative_text",

  REBUILD_PLAN: "rebuild_plan",

  ABORT: "abort",
});

// ============================================================
// SELF HEALING ENGINE
// ============================================================

class SelfHealing {
  constructor(options = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    this.logger = this.options.logger || console;

    this.history = [];

    this.activeAttempts = new Map();

    this.stats = {
      totalFailures: 0,

      totalRetries: 0,

      totalRecovered: 0,

      totalAborted: 0,

      byErrorType: {},

      byStrategy: {},
    };
  }

  // ==========================================================
  // MAIN EXECUTION WRAPPER
  // ==========================================================

  async execute(action, executor, context = {}) {
    if (typeof executor !== "function") {
      throw new Error("[SelfHealing] executor must be a function");
    }

    const actionId = context.actionId || this._generateActionId();

    const maxRetries = Number.isInteger(context.maxRetries)
      ? context.maxRetries
      : this.options.maxRetries;

    let attempt = 0;

    let lastError = null;

    const triedStrategies = new Set();

    while (attempt <= maxRetries) {
      try {
        this._debug(`Executing action ${actionId}, attempt ${attempt + 1}`);

        const result = await executor({
          action,

          context,

          attempt,

          actionId,

          strategy: context.strategy || "default",
        });

        this.stats.totalRetries += attempt;

        if (attempt > 0) {
          this.stats.totalRecovered++;

          this._recordRecovery({
            actionId,

            action,

            attempts: attempt + 1,

            result,
          });
        }

        return {
          success: true,

          recovered: attempt > 0,

          attempts: attempt + 1,

          actionId,

          result,
        };
      } catch (error) {
        lastError = error;

        this.stats.totalFailures++;

        const errorInfo = this.classifyError(error);

        this._recordError({
          actionId,

          action,

          attempt: attempt + 1,

          error: errorInfo,
        });

        this._debug(`[SelfHealing] Failure: ${errorInfo.type}`);

        if (this._shouldAbort(errorInfo, attempt, maxRetries)) {
          this.stats.totalAborted++;

          return this._failureResult(actionId, action, attempt + 1, errorInfo);
        }

        const recovery = this.getRecoveryStrategy(
          errorInfo,
          action,
          context,
          triedStrategies,
        );

        if (!recovery) {
          this.stats.totalAborted++;

          return this._failureResult(actionId, action, attempt + 1, errorInfo);
        }

        triedStrategies.add(recovery.strategy);

        await this._applyRecovery(recovery, context);

        attempt++;
      }
    }

    return {
      success: false,

      recovered: false,

      attempts: attempt,

      actionId,

      error: lastError
        ? this.classifyError(lastError)
        : {
            type: ERROR_TYPES.UNKNOWN,
            message: "Unknown failure",
          },
    };
  }

  // ==========================================================
  // ERROR CLASSIFICATION
  // ==========================================================

  classifyError(error) {
    const message = String(error?.message || error || "").toLowerCase();

    let type = ERROR_TYPES.UNKNOWN;

    if (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("waiting for")
    ) {
      type = ERROR_TYPES.TIMEOUT;
    } else if (
      message.includes("selector") &&
      (message.includes("not found") || message.includes("failed"))
    ) {
      type = ERROR_TYPES.SELECTOR_NOT_FOUND;
    } else if (
      message.includes("element not found") ||
      message.includes("no element")
    ) {
      type = ERROR_TYPES.ELEMENT_NOT_FOUND;
    } else if (
      message.includes("not visible") ||
      message.includes("visibility")
    ) {
      type = ERROR_TYPES.ELEMENT_NOT_VISIBLE;
    } else if (
      message.includes("not interactable") ||
      message.includes("interactable")
    ) {
      type = ERROR_TYPES.ELEMENT_NOT_INTERACTABLE;
    } else if (
      message.includes("click") &&
      (message.includes("failed") ||
        message.includes("intercepted") ||
        message.includes("not clickable"))
    ) {
      type = ERROR_TYPES.CLICK_FAILED;
    } else if (
      message.includes("fill") ||
      message.includes("type") ||
      message.includes("input")
    ) {
      type = ERROR_TYPES.TYPE_FAILED;
    } else if (message.includes("frame") || message.includes("iframe")) {
      type = ERROR_TYPES.FRAME_NOT_FOUND;
    } else if (message.includes("detached") || message.includes("stale")) {
      type = ERROR_TYPES.STALE_ELEMENT;
    } else if (message.includes("navigation") || message.includes("goto")) {
      type = ERROR_TYPES.NAVIGATION_FAILED;
    } else if (message.includes("page has been closed")) {
      type = ERROR_TYPES.PAGE_CLOSED;
    } else if (message.includes("context has been closed")) {
      type = ERROR_TYPES.CONTEXT_CLOSED;
    } else if (message.includes("network") || message.includes("connection")) {
      type = ERROR_TYPES.NETWORK_ERROR;
    }

    this.stats.byErrorType[type] = (this.stats.byErrorType[type] || 0) + 1;

    return {
      type,

      message: error?.message || String(error),

      originalError: error,

      retryable: this.isRetryable(type),
    };
  }

  // ==========================================================
  // RETRY CHECK
  // ==========================================================

  isRetryable(type) {
    const retryable = new Set([
      ERROR_TYPES.TIMEOUT,

      ERROR_TYPES.SELECTOR_NOT_FOUND,

      ERROR_TYPES.ELEMENT_NOT_FOUND,

      ERROR_TYPES.ELEMENT_NOT_VISIBLE,

      ERROR_TYPES.ELEMENT_NOT_INTERACTABLE,

      ERROR_TYPES.CLICK_FAILED,

      ERROR_TYPES.TYPE_FAILED,

      ERROR_TYPES.FRAME_NOT_FOUND,

      ERROR_TYPES.IFRAME_ERROR,

      ERROR_TYPES.STALE_ELEMENT,

      ERROR_TYPES.DETACHED_ELEMENT,

      ERROR_TYPES.NETWORK_ERROR,
    ]);

    return retryable.has(type);
  }

  // ==========================================================
  // RECOVERY STRATEGY SELECTION
  // ==========================================================

  getRecoveryStrategy(
    errorInfo,
    action = {},
    context = {},
    triedStrategies = new Set(),
  ) {
    const candidates = this._buildRecoveryStrategies(
      errorInfo,
      action,
      context,
    );

    for (const strategy of candidates) {
      if (triedStrategies.has(strategy.strategy)) {
        continue;
      }

      if (!this.options.enableAlternativeStrategies && strategy.alternative) {
        continue;
      }

      this.stats.byStrategy[strategy.strategy] =
        (this.stats.byStrategy[strategy.strategy] || 0) + 1;

      return strategy;
    }

    return null;
  }

  // ==========================================================
  // BUILD RECOVERY STRATEGIES
  // ==========================================================

  _buildRecoveryStrategies(errorInfo, action, context) {
    const type = errorInfo.type;

    switch (type) {
      case ERROR_TYPES.TIMEOUT:
        return [
          {
            strategy: RECOVERY_STRATEGIES.WAIT,

            delay: this.options.retryDelay,
          },

          {
            strategy: RECOVERY_STRATEGIES.RETRY,
          },
        ];

      case ERROR_TYPES.SELECTOR_NOT_FOUND:

      case ERROR_TYPES.ELEMENT_NOT_FOUND:
        return [
          {
            strategy: RECOVERY_STRATEGIES.RESELECT,

            alternative: true,
          },

          {
            strategy: RECOVERY_STRATEGIES.ALTERNATIVE_SELECTOR,

            alternative: true,
          },

          {
            strategy: RECOVERY_STRATEGIES.ALTERNATIVE_TEXT,

            alternative: true,
          },

          {
            strategy: RECOVERY_STRATEGIES.RETRY,
          },
        ];

      case ERROR_TYPES.ELEMENT_NOT_VISIBLE:
        return [
          {
            strategy: RECOVERY_STRATEGIES.SCROLL_INTO_VIEW,

            alternative: true,
          },

          {
            strategy: RECOVERY_STRATEGIES.WAIT,
          },

          {
            strategy: RECOVERY_STRATEGIES.RETRY,
          },
        ];

      case ERROR_TYPES.ELEMENT_NOT_INTERACTABLE:

      case ERROR_TYPES.CLICK_FAILED:
        return [
          {
            strategy: RECOVERY_STRATEGIES.SCROLL_INTO_VIEW,

            alternative: true,
          },

          {
            strategy: RECOVERY_STRATEGIES.RESELECT,

            alternative: true,
          },

          {
            strategy: RECOVERY_STRATEGIES.FORCE_CLICK,

            alternative: true,
          },

          {
            strategy: RECOVERY_STRATEGIES.JAVASCRIPT_CLICK,

            alternative: true,
          },
        ];

      case ERROR_TYPES.TYPE_FAILED:
        return [
          {
            strategy: RECOVERY_STRATEGIES.RESELECT,

            alternative: true,
          },

          {
            strategy: RECOVERY_STRATEGIES.ALTERNATIVE_SELECTOR,

            alternative: true,
          },

          {
            strategy: RECOVERY_STRATEGIES.RETRY,
          },
        ];

      case ERROR_TYPES.FRAME_NOT_FOUND:

      case ERROR_TYPES.IFRAME_ERROR:
        return [
          {
            strategy: RECOVERY_STRATEGIES.FRAME_SEARCH,

            alternative: true,
          },

          {
            strategy: RECOVERY_STRATEGIES.FRAME_RETRY,

            alternative: true,
          },

          {
            strategy: RECOVERY_STRATEGIES.RETRY,
          },
        ];

      case ERROR_TYPES.STALE_ELEMENT:

      case ERROR_TYPES.DETACHED_ELEMENT:
        return [
          {
            strategy: RECOVERY_STRATEGIES.RESELECT,

            alternative: true,
          },

          {
            strategy: RECOVERY_STRATEGIES.RETRY,
          },
        ];

      case ERROR_TYPES.NAVIGATION_FAILED:
        if (this.options.stopOnNavigationFailure) {
          return [];
        }

        return [
          {
            strategy: RECOVERY_STRATEGIES.RETRY,
          },

          {
            strategy: RECOVERY_STRATEGIES.RELOAD,

            alternative: true,
          },
        ];

      case ERROR_TYPES.NETWORK_ERROR:
        return [
          {
            strategy: RECOVERY_STRATEGIES.WAIT,
          },

          {
            strategy: RECOVERY_STRATEGIES.RETRY,
          },
        ];

      default:
        return [
          {
            strategy: RECOVERY_STRATEGIES.RETRY,
          },
        ];
    }
  }

  // ==========================================================
  // APPLY RECOVERY
  // ==========================================================

  async _applyRecovery(recovery, context = {}) {
    const delay = recovery.delay || this._calculateDelay(context.attempt || 0);

    this._debug(`[SelfHealing] Recovery: ${recovery.strategy}`);

    switch (recovery.strategy) {
      case RECOVERY_STRATEGIES.WAIT:
        await this._sleep(delay);

        break;

      case RECOVERY_STRATEGIES.RETRY:
        await this._sleep(delay);

        break;

      case RECOVERY_STRATEGIES.RESELECT:
        if (typeof context.reselect === "function") {
          await context.reselect();
        }

        break;

      case RECOVERY_STRATEGIES.ALTERNATIVE_SELECTOR:
        if (typeof context.alternativeSelector === "function") {
          await context.alternativeSelector();
        }

        break;

      case RECOVERY_STRATEGIES.ALTERNATIVE_TEXT:
        if (typeof context.alternativeText === "function") {
          await context.alternativeText();
        }

        break;

      case RECOVERY_STRATEGIES.SCROLL_INTO_VIEW:
        if (typeof context.scrollIntoView === "function") {
          await context.scrollIntoView();
        }

        break;

      case RECOVERY_STRATEGIES.FORCE_CLICK:
        if (typeof context.forceClick === "function") {
          await context.forceClick();
        }

        break;

      case RECOVERY_STRATEGIES.JAVASCRIPT_CLICK:
        if (typeof context.javascriptClick === "function") {
          await context.javascriptClick();
        }

        break;

      case RECOVERY_STRATEGIES.FRAME_SEARCH:
        if (typeof context.findFrame === "function") {
          await context.findFrame();
        }

        break;

      case RECOVERY_STRATEGIES.FRAME_RETRY:
        if (typeof context.retryFrame === "function") {
          await context.retryFrame();
        }

        break;

      case RECOVERY_STRATEGIES.RELOAD:
        if (typeof context.reload === "function") {
          await context.reload();
        }

        break;

      case RECOVERY_STRATEGIES.REBUILD_PLAN:
        if (typeof context.rebuildPlan === "function") {
          await context.rebuildPlan();
        }

        break;

      case RECOVERY_STRATEGIES.ABORT:

      default:
        break;
    }
  }

  // ==========================================================
  // FAILURE DECISION
  // ==========================================================

  _shouldAbort(errorInfo, attempt, maxRetries) {
    if (!errorInfo.retryable) {
      return true;
    }

    if (attempt >= maxRetries + 1) {
      return true;
    }

    if (
      errorInfo.type === ERROR_TYPES.PAGE_CLOSED ||
      errorInfo.type === ERROR_TYPES.CONTEXT_CLOSED
    ) {
      return true;
    }

    return false;
  }

  // ==========================================================
  // FAILURE RESULT
  // ==========================================================

  _failureResult(actionId, action, attempts, error) {
    return {
      success: false,

      recovered: false,

      actionId,

      attempts,

      action,

      error,

      healing: {
        attempted: true,

        recovered: false,
      },
    };
  }

  // ==========================================================
  // DELAY CALCULATION
  // ==========================================================

  _calculateDelay(attempt) {
    const delay =
      this.options.retryDelay *
      Math.pow(this.options.backoffMultiplier, attempt);

    return Math.min(delay, this.options.maxRetryDelay);
  }

  // ==========================================================
  // HISTORY
  // ==========================================================

  _recordError(data) {
    if (!this.options.enableHistory) {
      return;
    }

    this.history.push({
      type: "failure",

      timestamp: Date.now(),

      ...data,
    });

    this._trimHistory();
  }

  _recordRecovery(data) {
    if (!this.options.enableHistory) {
      return;
    }

    this.history.push({
      type: "recovery",

      timestamp: Date.now(),

      ...data,
    });

    this._trimHistory();
  }

  _trimHistory() {
    if (this.history.length > this.options.maxHistory) {
      this.history.splice(
        0,

        this.history.length - this.options.maxHistory,
      );
    }
  }

  // ==========================================================
  // PUBLIC DIAGNOSTICS
  // ==========================================================

  getHistory() {
    return [...this.history];
  }

  getStats() {
    return {
      ...this.stats,

      historySize: this.history.length,
    };
  }

  clearHistory() {
    this.history = [];
  }

  resetStats() {
    this.stats = {
      totalFailures: 0,

      totalRetries: 0,

      totalRecovered: 0,

      totalAborted: 0,

      byErrorType: {},

      byStrategy: {},
    };
  }

  // ==========================================================
  // UTILITY
  // ==========================================================

  _generateActionId() {
    return (
      "heal_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 9)
    );
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _debug(...args) {
    if (this.options.debug && this.logger) {
      this.logger.debug(...args);
    }
  }
}

// ============================================================
// DEFAULT SINGLETON
// ============================================================

const selfHealing = new SelfHealing({
  maxRetries: 3,

  retryDelay: 250,

  backoffMultiplier: 1.5,

  maxRetryDelay: 3000,

  enableAlternativeStrategies: true,

  enableHistory: true,

  debug: false,
});

// ============================================================
// EXPORTS
// ============================================================

export { SelfHealing };

export default selfHealing;
