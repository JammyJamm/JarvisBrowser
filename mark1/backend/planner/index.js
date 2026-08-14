/**
 * planner/index.js
 *
 * Ultra-Fast Intent Planner - Main Entry
 * --------------------------------------
 * This file exposes the Planner class and integrates:
 * - Fast intent parsing (regex engine)
 * - Optional LLM fallback hook
 * - Action routing
 * - Multi-step planning support
 */

import PlannerCore from "./planner.js";
import IntentParser from "./parser.js";
import ActionExecutor from "./executor.js";

/**
 * Main Planner Class
 */
export default class Planner {
  constructor(options = {}) {
    this.options = {
      model: options.model || null,
      enableFallback: options.enableFallback ?? true,
      debug: options.debug ?? false,
      maxSteps: options.maxSteps || 5,
      ...options,
    };

    // Core modules
    this.core = new PlannerCore(this.options);
    this.parser = new IntentParser(this.options);
    this.executor = new ActionExecutor(this.options);

    this.lastPlan = null;
    this.lastResult = null;
  }

  /**
   * Main entry: convert user input → structured plan
   */
  async plan(input, context = {}) {
    if (!input || typeof input !== "string") {
      throw new Error("Planner: invalid input");
    }

    if (this.options.debug) {
      console.log("[Planner] Input:", input);
    }

    // STEP 1: Fast parsing (regex / rule-based)
    let plan = this.parser.parse(input, context);

    // STEP 2: Fallback if needed
    if (!plan && this.options.enableFallback && this.core.fallback) {
      plan = await this.core.fallback(input, context);
    }

    // STEP 3: Normalize plan
    plan = this.core.normalize(plan, input);

    // STEP 4: Store
    this.lastPlan = plan;

    return plan;
  }

  /**
   * Execute a generated plan
   */
  async execute(plan = null, context = {}) {
    const finalPlan = plan || this.lastPlan;

    if (!finalPlan) {
      throw new Error("Planner: No plan available to execute");
    }

    if (this.options.debug) {
      console.log("[Planner] Executing plan:", finalPlan);
    }

    const result = await this.executor.run(finalPlan, context);

    this.lastResult = result;

    return result;
  }

  /**
   * Shortcut: plan + execute in one call
   */
  async run(input, context = {}) {
    const plan = await this.plan(input, context);
    return await this.execute(plan, context);
  }

  /**
   * Reset internal state
   */
  reset() {
    this.lastPlan = null;
    this.lastResult = null;
  }

  /**
   * Get last plan
   */
  getLastPlan() {
    return this.lastPlan;
  }

  /**
   * Get last execution result
   */
  getLastResult() {
    return this.lastResult;
  }

  /**
   * Update runtime options
   */
  updateOptions(newOptions = {}) {
    this.options = {
      ...this.options,
      ...newOptions,
    };

    this.core.updateOptions?.(this.options);
    this.parser.updateOptions?.(this.options);
    this.executor.updateOptions?.(this.options);
  }
}
