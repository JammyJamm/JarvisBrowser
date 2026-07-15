/**
 * ============================================================
 * backend/planner/planner.js
 *
 * Ultra Intelligent Planner
 *
 * Responsibilities
 * ------------------------------------------------------------
 * ✔ Uses IntentParser (NO fuzzy logic)
 * ✔ Uses ScoringEngine (all ranking happens here)
 * ✔ Uses SelfHealingEngine
 * ✔ Uses LLM ONLY when ScoringEngine requests it
 * ✔ Multi-step planning
 * ✔ Zero-LLM fast execution
 * ✔ Planner NEVER performs spelling correction
 *
 * Pipeline
 * ------------------------------------------------------------
 *
 * User Input
 *      │
 *      ▼
 * IntentParser
 *      │
 *      ▼
 * ScoringEngine
 *      │
 *      ├── confidence >=95
 *      │        Execute
 *      │
 *      ├── confidence 80-94
 *      │        Execute + remember
 *      │
 *      └── confidence <80
 *               ▼
 *              LLM
 *               ▼
 *          Re-score
 *               ▼
 *            Execute
 *
 * ============================================================
 */

import IntentParser from "./intent-parser.js";
import ScoringEngine from "./scoring-engine.js";
import SelfHealingEngine from "./self-healing.js";

const DEFAULT_OPTIONS = {
  model: "qwen3:8b",

  useLLM: true,

  debug: false,

  plannerThreshold: 80,

  autoExecuteThreshold: 95,

  ollamaEndpoint: "http://localhost:11434/api/generate",
};

export default class Planner {
  constructor(options = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,

      ...options,
    };

    //------------------------------------------------------
    // Core Components
    //------------------------------------------------------

    this.parser =
      options.parser ||
      new IntentParser({
        debug: this.options.debug,
      });

    this.scoring =
      options.scoring ||
      new ScoringEngine({
        plannerThreshold: this.options.plannerThreshold,

        autoExecuteThreshold: this.options.autoExecuteThreshold,
      });

    this.healing =
      options.healing ||
      new SelfHealingEngine({
        browser: options.browser,
        planner: this,
        scoringEngine: this.scoring,
      });

    //------------------------------------------------------
    // Runtime
    //------------------------------------------------------

    this.browser = options.browser || null;

    this.model = this.options.model;

    this.useLLM = this.options.useLLM;

    this.cache = new Map();

    this.history = [];

    this.stats = {
      total: 0,

      parserResolved: 0,

      scoringResolved: 0,

      llmResolved: 0,

      failures: 0,
    };
  }

  //==========================================================
  // PUBLIC API
  //==========================================================

  /**
   * Main planner entry
   */
  async plan(input, context = {}) {
    if (!input || typeof input !== "string") {
      return this.emptyPlan();
    }

    this.stats.total++;

    const cacheKey = input.trim().toLowerCase();

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    //------------------------------------------------------
    // 1. Parse intent
    //------------------------------------------------------

    const parsed = this.parser.parse(input);

    if (!parsed.steps.length) {
      return this.emptyPlan();
    }

    this.stats.parserResolved++;

    //------------------------------------------------------
    // 2. Resolve every step
    //------------------------------------------------------

    const resolvedSteps = [];

    for (const step of parsed.steps) {
      const resolved = await this.resolveStep(step, context);

      resolvedSteps.push(resolved);
    }

    const plan = {
      source: "planner",

      mode: parsed.mode,

      confidence: parsed.confidence,

      steps: resolvedSteps,
    };

    this.cache.set(cacheKey, plan);

    if (this.cache.size > 500) {
      const first = this.cache.keys().next().value;

      this.cache.delete(first);
    }

    return plan;
  }

  /**
   * Planner used by SelfHealingEngine
   */
  async replan(input, context = {}) {
    return this.plan(input, context);
  }
  //==========================================================
  // STEP RESOLUTION
  //==========================================================

  /**
   * Resolve a parsed step into an executable step.
   *
   * IMPORTANT:
   * Planner never performs fuzzy matching.
   * All element matching is delegated to ScoringEngine.
   */
  async resolveStep(step, context = {}) {
    //------------------------------------------------------
    // Chat messages
    //------------------------------------------------------

    if (step.action === "chat") {
      return step;
    }

    //------------------------------------------------------
    // Navigation
    //------------------------------------------------------

    if (step.action === "navigate") {
      return {
        ...step,

        executable: true,

        confidence: 100,
      };
    }

    //------------------------------------------------------
    // Search
    //------------------------------------------------------

    if (step.action === "search") {
      return {
        ...step,

        executable: true,

        confidence: 100,
      };
    }

    //------------------------------------------------------
    // Wait
    //------------------------------------------------------

    if (step.action === "wait") {
      return {
        ...step,

        executable: true,

        confidence: 100,
      };
    }

    //------------------------------------------------------
    // Actions requiring DOM lookup
    //------------------------------------------------------

    if (
      [
        "click",

        "type",

        "hover",

        "check",

        "uncheck",

        "upload",

        "download",
      ].includes(step.action)
    ) {
      return await this.resolveElementStep(
        step,

        context,
      );
    }

    //------------------------------------------------------

    return {
      ...step,

      executable: false,

      confidence: 0,
    };
  }

  //==========================================================
  // DOM RESOLUTION
  //==========================================================

  async resolveElementStep(step, context = {}) {
    //------------------------------------------------------
    // Refresh DOM Index
    //------------------------------------------------------

    const elements = await this.collectDOM(context);

    this.scoring.buildIndex(elements);

    //------------------------------------------------------
    // Ask Scoring Engine
    //------------------------------------------------------

    const result = this.scoring.resolve(
      step.target || step.text || step.value || "",
    );

    //------------------------------------------------------
    // Perfect Match
    //------------------------------------------------------

    if (
      result.success &&
      result.confidence >= this.options.autoExecuteThreshold
    ) {
      this.stats.scoringResolved++;

      return {
        ...step,

        executable: true,

        plannerUsed: false,

        confidence: result.confidence,

        score: result.confidence,

        candidate: result.best,

        element: result.best.element,
      };
    }

    //------------------------------------------------------
    // Good Match
    //------------------------------------------------------

    if (result.success && result.confidence >= this.options.plannerThreshold) {
      this.stats.scoringResolved++;

      return {
        ...step,

        executable: true,

        plannerUsed: false,

        confidence: result.confidence,

        score: result.confidence,

        candidate: result.best,

        element: result.best.element,
      };
    }

    //------------------------------------------------------
    // Planner Required
    //------------------------------------------------------

    return await this.resolveUsingLLM(
      step,

      result,

      context,
    );
  }

  //==========================================================
  // DOM COLLECTION
  //==========================================================

  async collectDOM(context = {}) {
    //------------------------------------------------------
    // Context supplied DOM
    //------------------------------------------------------

    if (Array.isArray(context.elements)) {
      return context.elements;
    }

    //------------------------------------------------------
    // Browser helper
    //------------------------------------------------------

    if (this.browser?.collectElements) {
      return await this.browser.collectElements();
    }

    //------------------------------------------------------
    // MCP helper
    //------------------------------------------------------

    if (this.browser?.getAllElements) {
      return await this.browser.getAllElements();
    }

    //------------------------------------------------------
    // Self-healing helper
    //------------------------------------------------------

    if (this.healing?.collectDOM) {
      return await this.healing.collectDOM();
    }

    return [];
  }

  //==========================================================
  // LLM RESOLUTION
  //==========================================================

  async resolveUsingLLM(step, scoreResult, context = {}) {
    //------------------------------------------------------
    // LLM disabled
    //------------------------------------------------------

    if (!this.useLLM) {
      this.stats.failures++;

      return {
        ...step,

        executable: false,

        plannerUsed: false,

        confidence: scoreResult?.confidence || 0,

        candidates: scoreResult?.candidates || [],

        reason: "Planner disabled",
      };
    }

    //------------------------------------------------------
    // Build prompt
    //------------------------------------------------------

    const prompt = this.buildPrompt(step, scoreResult, context);

    //------------------------------------------------------
    // Call LLM
    //------------------------------------------------------

    const response = await this.callLLM(prompt);

    if (!response) {
      this.stats.failures++;

      return {
        ...step,

        executable: false,

        plannerUsed: true,

        confidence: scoreResult?.confidence || 0,

        reason: "LLM unavailable",
      };
    }

    //------------------------------------------------------
    // Parse LLM response
    //------------------------------------------------------

    const repaired = this.safeJSON(response);

    if (!repaired?.target) {
      this.stats.failures++;

      return {
        ...step,

        executable: false,

        plannerUsed: true,

        confidence: scoreResult?.confidence || 0,

        reason: "Invalid LLM response",
      };
    }

    //------------------------------------------------------
    // Re-score with corrected target
    //------------------------------------------------------

    const rescored = this.scoring.resolve(repaired.target);

    if (!rescored.success) {
      this.stats.failures++;

      return {
        ...step,

        executable: false,

        plannerUsed: true,

        confidence: rescored.confidence,

        correctedTarget: repaired.target,

        candidates: rescored.candidates || [],
      };
    }

    //------------------------------------------------------
    // Success
    //------------------------------------------------------

    this.stats.llmResolved++;

    return {
      ...step,

      executable: true,

      plannerUsed: true,

      confidence: rescored.confidence,

      correctedTarget: repaired.target,

      candidate: rescored.best,

      element: rescored.best.element,

      llm: repaired,
    };
  }

  //==========================================================
  // PROMPT BUILDER
  //==========================================================

  buildPrompt(step, scoreResult = {}, context = {}) {
    const candidates = (scoreResult.candidates || [])
      .slice(0, 10)
      .map((x) => x.text)
      .filter(Boolean);

    return `
You are a browser planning assistant.

DO NOT perform browser actions.

ONLY determine the correct target.

Action:
${step.action}

Original Target:
${step.target || step.text || ""}

Top Candidates:
${JSON.stringify(candidates, null, 2)}

Return ONLY valid JSON.

Example:

{
    "target":"Punch In"
}
`;
  }

  //==========================================================
  // LLM CALL
  //==========================================================

  async callLLM(prompt) {
    try {
      const response = await fetch(this.options.ollamaEndpoint, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          model: this.model,

          prompt,

          stream: false,
        }),
      });

      if (!response.ok) return null;

      const json = await response.json();

      return json.response;
    } catch (err) {
      if (this.options.debug) {
        console.error("[Planner]", err.message);
      }

      return null;
    }
  }

  //==========================================================
  // JSON UTILITIES
  //==========================================================

  safeJSON(text) {
    if (!text) return null;

    //------------------------------------------------------
    // Direct parse
    //------------------------------------------------------

    try {
      return JSON.parse(text);
    } catch {}

    //------------------------------------------------------
    // Remove markdown
    //------------------------------------------------------

    try {
      let cleaned = text
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      return JSON.parse(cleaned);
    } catch {}

    //------------------------------------------------------
    // Extract JSON object
    //------------------------------------------------------

    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");

      if (start >= 0 && end > start) {
        return JSON.parse(text.substring(start, end + 1));
      }
    } catch {}

    return null;
  }

  //==========================================================
  // LEARNING
  //==========================================================

  remember(step) {
    if (!step?.candidate) return;

    try {
      this.scoring.remember(
        step.correctedTarget || step.target || step.text || "",

        step.candidate,
      );
    } catch {}

    this.history.push({
      timestamp: Date.now(),

      action: step.action,

      target: step.correctedTarget || step.target || step.text || "",

      confidence: step.confidence,

      plannerUsed: step.plannerUsed,
    });

    if (this.history.length > 1000) {
      this.history.shift();
    }
  }

  //==========================================================
  // CACHE
  //==========================================================

  clearCache() {
    this.cache.clear();
  }

  clearHistory() {
    this.history = [];
  }

  //==========================================================
  // STATISTICS
  //==========================================================

  getStats() {
    return {
      ...this.stats,

      cacheSize: this.cache.size,

      history: this.history.length,

      parser: this.parser?.constructor?.name,

      scorer: this.scoring?.constructor?.name,

      healing: this.healing?.constructor?.name,
    };
  }

  //==========================================================
  // EMPTY PLAN
  //==========================================================

  emptyPlan() {
    return {
      source: "planner",

      mode: "empty",

      confidence: 0,

      steps: [],
    };
  }

  //==========================================================
  // DESTROY
  //==========================================================

  destroy() {
    this.clearCache();

    this.clearHistory();
  }
}
