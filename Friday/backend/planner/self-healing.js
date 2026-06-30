/**
 * self-healing.js
 *
 * Auto-healing execution layer for Planner / Agent systems
 *
 * Features:
 * - Automatic retry with exponential backoff
 * - Failure classification
 * - Strategy-based recovery (retry / fallback / patch / abort)
 * - Pluggable hooks for planner integration
 * - Safe infinite-loop prevention
 */

class SelfHealingEngine {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelay = options.baseDelay ?? 300;
    this.maxDelay = options.maxDelay ?? 5000;

    this.fallbackHandler = options.fallbackHandler || null;
    this.logger = options.logger || console;

    this.retryableErrors = [
      "TIMEOUT",
      "NETWORK_ERROR",
      "RATE_LIMIT",
      "ECONNRESET",
      "ETIMEDOUT",
    ];
  }

  /**
   * Main execution wrapper
   * @param {Function} fn async function to execute
   * @param {Object} context optional metadata
   */
  async execute(fn, context = {}) {
    let attempt = 0;
    let lastError = null;

    while (attempt <= this.maxRetries) {
      try {
        this.logger.log(`[SelfHealing] Attempt ${attempt + 1}`);

        const result = await fn(attempt);

        // validate result if validator provided
        if (context.validate && !context.validate(result)) {
          throw new Error("VALIDATION_FAILED");
        }

        return result;
      } catch (err) {
        lastError = err;
        attempt++;

        const decision = this.classifyError(err);

        this.logger.warn(
          `[SelfHealing] Error classified as: ${decision.type} | attempt ${attempt}`,
        );

        if (decision.action === "abort") {
          break;
        }

        if (attempt > this.maxRetries) {
          break;
        }

        const delay = this.calculateDelay(attempt, decision);
        await this.sleep(delay);

        // optional patch hook
        if (context.patch && decision.action === "patch") {
          try {
            context = (await context.patch(err, context)) || context;
          } catch (patchErr) {
            this.logger.error("[SelfHealing] Patch failed:", patchErr);
          }
        }

        // fallback handler hook
        if (decision.action === "fallback" && this.fallbackHandler) {
          try {
            return await this.fallbackHandler(err, context);
          } catch (fallbackErr) {
            this.logger.error("[SelfHealing] Fallback failed:", fallbackErr);
          }
        }
      }
    }

    throw lastError;
  }

  /**
   * Error classification engine
   */
  classifyError(err) {
    const msg = (err.message || "").toUpperCase();

    if (msg.includes("TIMEOUT")) {
      return { type: "TIMEOUT", action: "retry" };
    }

    if (msg.includes("RATE") || msg.includes("LIMIT")) {
      return { type: "RATE_LIMIT", action: "retry" };
    }

    if (msg.includes("NETWORK") || msg.includes("ECONNRESET")) {
      return { type: "NETWORK_ERROR", action: "retry" };
    }

    if (msg.includes("VALIDATION_FAILED")) {
      return { type: "VALIDATION_FAILED", action: "patch" };
    }

    if (msg.includes("FATAL") || msg.includes("UNRECOVERABLE")) {
      return { type: "FATAL", action: "abort" };
    }

    return { type: "UNKNOWN", action: "retry" };
  }

  /**
   * Adaptive backoff strategy
   */
  calculateDelay(attempt, decision) {
    let delay = this.baseDelay * Math.pow(2, attempt - 1);

    if (decision.type === "RATE_LIMIT") {
      delay *= 2.5;
    }

    return Math.min(delay, this.maxDelay);
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = SelfHealingEngine;
