// backend/planner/planner.js
//
// Ultra Intelligent Planner
//
// Architecture
//
// User Command
//      │
//      ▼
// Command Classification
//      │
//      ▼
// IntentParser
//      │
//      ├── Fast Intent Detection
//      ├── Multi-Step Parsing
//      └── Action Extraction
//      │
//      ▼
// ScoringEngine
//      │
//      ├── Exact Matching
//      ├── Token Matching
//      ├── Fuzzy Matching
//      ├── Semantic Matching
//      └── Candidate Ranking
//      │
//      ▼
// Planner
//      │
//      ├── High Confidence → Direct Execution
//      │
//      └── Low Confidence / Ambiguous
//              │
//              ▼
//          LLM Fallback
//              │
//              ▼
//          Structured Plan
//              │
//              ▼
//          ToolMap
//              │
//              ▼
//          Resolver
//              │
//              ▼
//          Playwright
//
// IMPORTANT
// ----------------------------------------------------------
// Planner NEVER performs fuzzy matching.
// Fuzzy matching belongs exclusively to ScoringEngine.
//
// Planner responsibilities:
// ✔ Parse user intent
// ✔ Coordinate IntentParser
// ✔ Coordinate ScoringEngine
// ✔ Generate multi-step plans
// ✔ Use LLM only when required
// ✔ Repair invalid LLM JSON
// ✔ Normalize plans
// ✔ Validate plans
// ✔ Preserve step ordering
// ✔ Prevent skipped steps
// ✔ Support chat and action modes
// ✔ Resolve each step independently
// ✔ Never silently drop failed steps
//
//==========================================================

import IntentParser from "./intent-parser.js";
import ScoringEngine from "./scoring-engine.js";

export default class Planner {
  constructor(options = {}) {
    //--------------------------------------------------
    // CONFIGURATION
    //--------------------------------------------------

    this.options = {
      model: options.model || "qwen3:8b",

      endpoint: options.endpoint || "http://localhost:11434/api/generate",

      apiKey: options.apiKey || process.env.OPENAI_API_KEY || "",

      provider: options.provider || "ollama",

      useLLM: options.useLLM !== false,

      timeout: options.timeout || 30000,

      plannerThreshold: options.plannerThreshold ?? 80,

      autoExecuteThreshold: options.autoExecuteThreshold ?? 95,

      minimumConfidence: options.minimumConfidence ?? 60,

      maxSteps: options.maxSteps || 20,

      maxContextLength: options.maxContextLength || 8000,

      historyLimit: options.historyLimit || 100,

      debug: options.debug || false,

      enableScoring: options.enableScoring !== false,

      enableLearning: options.enableLearning !== false,

      enableLLMFallback: options.enableLLMFallback !== false,

      ...options,
    };

    //--------------------------------------------------
    // INTENT PARSER
    //--------------------------------------------------

    this.intentParser =
      options.intentParser ||
      new IntentParser({
        debug: this.options.debug,

        enableLLMFallback: false,
      });

    //--------------------------------------------------
    // SCORING ENGINE
    //--------------------------------------------------

    this.scoringEngine =
      options.scoringEngine ||
      new ScoringEngine({
        plannerThreshold: this.options.plannerThreshold,

        autoExecuteThreshold: this.options.autoExecuteThreshold,

        minimumConfidence: this.options.minimumConfidence,

        enableLearning: this.options.enableLearning,

        debug: this.options.debug,
      });

    //--------------------------------------------------
    // RUNTIME STATE
    //--------------------------------------------------

    this.lastPlan = null;

    this.lastInput = "";

    this.lastError = null;

    this.history = [];

    //--------------------------------------------------
    // STATISTICS
    //--------------------------------------------------

    this.stats = {
      totalCalls: 0,

      fastPathCalls: 0,

      llmCalls: 0,

      llmFailures: 0,

      repairedPlans: 0,

      chatCalls: 0,

      actionCalls: 0,

      multiStepCalls: 0,

      successfulPlans: 0,

      failedPlans: 0,

      skippedSteps: 0,

      scoringRequests: 0,

      ambiguousSteps: 0,
    };
  }

  //======================================================
  // LOGGER
  //======================================================

  log(...args) {
    if (this.options.debug) {
      console.log("[Planner]", ...args);
    }
  }

  warn(...args) {
    console.warn("[Planner]", ...args);
  }

  error(...args) {
    console.error("[Planner]", ...args);
  }

  //======================================================
  // MAIN PLAN METHOD
  //======================================================

  async plan(input, context = {}) {
    const started = Date.now();

    this.stats.totalCalls++;

    this.lastInput = String(input || "").trim();

    this.lastError = null;

    //--------------------------------------------------
    // VALIDATE INPUT
    //--------------------------------------------------

    if (!this.lastInput) {
      this.stats.failedPlans++;

      throw new Error("Planner requires a command.");
    }

    //--------------------------------------------------
    // NORMALIZE CONTEXT
    //--------------------------------------------------

    const normalizedContext = this.normalizeContext(context);

    this.log("Planning command:", this.lastInput);

    //--------------------------------------------------
    // FAST INTENT PARSER
    //--------------------------------------------------

    let parsed = null;

    try {
      parsed = await this.parseIntent(this.lastInput, normalizedContext);
    } catch (err) {
      this.warn("Intent parser failed:", err.message);
    }

    //--------------------------------------------------
    // NORMALIZE PARSED INTENT
    //--------------------------------------------------

    parsed = this.normalizeParsedIntent(parsed, this.lastInput);

    this.log("Parsed intent:", JSON.stringify(parsed, null, 2));

    //--------------------------------------------------
    // CHAT MODE
    //--------------------------------------------------

    if (parsed.mode === "chat") {
      this.stats.chatCalls++;

      const chatPlan = this.createChatPlan(parsed, this.lastInput);

      return this.finalizePlan(chatPlan, started);
    }

    //--------------------------------------------------
    // FAST ACTION PATH
    //--------------------------------------------------

    if (parsed.steps?.length) {
      const fastPlan = await this.evaluateFastPlan(parsed, normalizedContext);

      //--------------------------------------------------
      // ACCEPT FAST PLAN
      //--------------------------------------------------

      if (fastPlan.accept) {
        this.stats.fastPathCalls++;

        this.stats.actionCalls++;

        if (fastPlan.steps.length > 1) {
          this.stats.multiStepCalls++;
        }

        this.log("Fast path accepted:", fastPlan.reason);

        return this.finalizePlan(fastPlan.plan, started);
      }

      //--------------------------------------------------
      // Keep validated information
      // available for LLM context
      //--------------------------------------------------

      normalizedContext.ranked = fastPlan.ranked || normalizedContext.ranked;

      normalizedContext.stepResults = fastPlan.stepResults || [];
    }

    //--------------------------------------------------
    // LLM FALLBACK
    //--------------------------------------------------

    if (this.options.useLLM && this.options.enableLLMFallback) {
      try {
        this.stats.llmCalls++;

        const llmPlan = await this.planWithLLM(
          this.lastInput,
          normalizedContext,
          parsed,
        );

        if (llmPlan && llmPlan.steps?.length) {
          this.stats.actionCalls++;

          if (llmPlan.steps.length > 1) {
            this.stats.multiStepCalls++;
          }

          return this.finalizePlan(llmPlan, started);
        }
      } catch (err) {
        this.stats.llmFailures++;

        this.lastError = err;

        this.warn("LLM planning failed:", err.message);
      }
    }

    //--------------------------------------------------
    // FINAL FAST FALLBACK
    //
    // Important:
    // Never silently skip steps.
    //--------------------------------------------------

    if (parsed.steps?.length) {
      this.stats.actionCalls++;

      return this.finalizePlan(
        this.createFallbackPlan(parsed, this.lastInput),
        started,
      );
    }

    //--------------------------------------------------
    // NOTHING RESOLVED
    //--------------------------------------------------

    this.stats.failedPlans++;

    throw new Error(`Unable to understand command: "${this.lastInput}"`);
  }

  //======================================================
  // INTENT PARSER
  //======================================================

  async parseIntent(input, context = {}) {
    //--------------------------------------------------
    // IntentParser is intentionally fast.
    //
    // No fuzzy matching.
    // No LLM.
    //--------------------------------------------------

    if (typeof this.intentParser.parse === "function") {
      return await this.intentParser.parse(input, context);
    }

    throw new Error("IntentParser.parse() is not available.");
  }

  //======================================================
  // FAST PLAN EVALUATION
  //======================================================

  async evaluateFastPlan(parsed, context) {
    const steps = this.normalizeSteps(parsed.steps);

    if (!steps.length) {
      return {
        accept: false,

        reason: "No executable steps found.",

        steps: [],

        ranked: context.ranked || [],

        stepResults: [],

        plan: null,
      };
    }

    //--------------------------------------------------
    // LIMIT STEPS
    //--------------------------------------------------

    const limitedSteps = steps.slice(0, this.options.maxSteps);

    //--------------------------------------------------
    // Detect truncation
    //--------------------------------------------------

    if (steps.length > this.options.maxSteps) {
      this.warn(
        `Command contains ${steps.length} steps. ` +
          `Maximum allowed is ${this.options.maxSteps}.`,
      );
    }

    //--------------------------------------------------
    // VALIDATE EVERY STEP
    //
    // Each step is resolved independently.
    // This prevents step 1's result from
    // accidentally being reused for step 2.
    //--------------------------------------------------

    const validatedSteps = [];

    const stepResults = [];

    let requiresLLM = false;

    let highestRanked = context.ranked || [];

    for (let index = 0; index < limitedSteps.length; index++) {
      const step = limitedSteps[index];

      const validation = await this.validateStep(step, context);

      //--------------------------------------------------
      // Store step result
      //--------------------------------------------------

      stepResults.push({
        step: index + 1,

        action: step.action,

        target: step.target,

        confidence: validation.confidence,

        valid: validation.valid,

        ambiguous: validation.ambiguous || false,

        reason: validation.reason,

        candidate: validation.candidate || null,
      });

      //--------------------------------------------------
      // Track highest-ranked candidate set
      //--------------------------------------------------

      if (Array.isArray(validation.ranked) && validation.ranked.length) {
        highestRanked = validation.ranked;
      }

      //--------------------------------------------------
      // Invalid step
      //--------------------------------------------------

      if (!validation.valid) {
        requiresLLM = true;

        this.log(
          `Step ${index + 1} requires planner fallback:`,
          validation.reason,
        );
      }

      //--------------------------------------------------
      // Ambiguous step
      //--------------------------------------------------

      if (validation.ambiguous) {
        requiresLLM = true;

        this.stats.ambiguousSteps++;
      }

      //--------------------------------------------------
      // Low confidence
      //--------------------------------------------------

      if (
        validation.confidence !== null &&
        validation.confidence < this.options.plannerThreshold
      ) {
        requiresLLM = true;
      }

      //--------------------------------------------------
      // Preserve original step
      // and attach resolution metadata
      //--------------------------------------------------

      validatedSteps.push({
        ...step,

        confidence: validation.confidence,

        candidate: validation.candidate || undefined,

        matchedField: validation.matchedField || undefined,

        validation: validation.reason,

        ambiguous: validation.ambiguous || false,
      });
    }

    //--------------------------------------------------
    // MULTI-STEP PROTECTION
    //--------------------------------------------------

    if (validatedSteps.length > 1) {
      this.log("Multi-step plan detected:", validatedSteps.length);
    }

    //--------------------------------------------------
    // NEVER ACCEPT A PARTIAL PLAN
    //--------------------------------------------------

    const invalidCount = stepResults.filter((item) => !item.valid).length;

    if (invalidCount > 0) {
      requiresLLM = true;
    }

    //--------------------------------------------------
    // HIGH CONFIDENCE DIRECT PATH
    //--------------------------------------------------

    if (!requiresLLM) {
      const confidence = this.calculatePlanConfidence(validatedSteps);

      return {
        accept: true,

        reason: "All steps resolved with sufficient confidence.",

        steps: validatedSteps,

        ranked: highestRanked,

        stepResults,

        plan: {
          success: true,

          mode: "action",

          source: "intent-parser+scoring-engine",

          confidence,

          steps: validatedSteps,
        },
      };
    }

    //--------------------------------------------------
    // LOW CONFIDENCE / AMBIGUOUS
    //--------------------------------------------------

    return {
      accept: false,

      reason: "One or more steps require LLM clarification.",

      steps: validatedSteps,

      ranked: highestRanked,

      stepResults,

      plan: null,
    };
  }

  //======================================================
  // STEP VALIDATION
  //======================================================

  async validateStep(step, context = {}) {
    //--------------------------------------------------
    // BASIC VALIDATION
    //--------------------------------------------------

    if (!step || typeof step !== "object") {
      return {
        valid: false,

        confidence: 0,

        reason: "Invalid step.",

        ambiguous: false,
      };
    }

    const action = this.normalizeAction(step.action || step.tool);

    //--------------------------------------------------
    // UNKNOWN ACTION
    //--------------------------------------------------

    if (!this.isSupportedAction(action)) {
      return {
        valid: false,

        confidence: 0,

        reason: `Unsupported action: ${action}`,

        ambiguous: false,
      };
    }

    //--------------------------------------------------
    // CHAT
    //--------------------------------------------------

    if (action === "chat") {
      return {
        valid: true,

        confidence: 100,

        reason: "Chat action.",

        ambiguous: false,
      };
    }

    //--------------------------------------------------
    // NAVIGATION
    //--------------------------------------------------

    if (action === "navigate") {
      const url = step.url || step.value || step.target;

      if (url) {
        return {
          valid: true,

          confidence: 100,

          reason: "Navigation target available.",

          ambiguous: false,
        };
      }

      return {
        valid: false,

        confidence: 0,

        reason: "Navigation URL missing.",

        ambiguous: false,
      };
    }

    //--------------------------------------------------
    // BACK / FORWARD / RELOAD
    //--------------------------------------------------

    if (["back", "forward", "reload"].includes(action)) {
      return {
        valid: true,

        confidence: 100,

        reason: `${action} action requires no target.`,

        ambiguous: false,
      };
    }

    //--------------------------------------------------
    // WAIT
    //--------------------------------------------------

    if (action === "wait") {
      const ms = Number(step.ms || step.value || step.duration || 0);

      return {
        valid: Number.isFinite(ms) && ms >= 0,

        confidence: Number.isFinite(ms) && ms >= 0 ? 100 : 0,

        reason:
          Number.isFinite(ms) && ms >= 0
            ? "Wait duration available."
            : "Wait duration invalid.",

        ambiguous: false,
      };
    }

    //--------------------------------------------------
    // KEYBOARD
    //--------------------------------------------------

    if (action === "press") {
      const key = step.key || step.value || step.target;

      if (key) {
        return {
          valid: true,

          confidence: 100,

          reason: "Keyboard key available.",

          ambiguous: false,
        };
      }

      return {
        valid: false,

        confidence: 0,

        reason: "Keyboard key missing.",

        ambiguous: false,
      };
    }

    //--------------------------------------------------
    // SCROLL
    //--------------------------------------------------

    if (action === "scroll") {
      return {
        valid: true,

        confidence: 100,

        reason: "Scroll action available.",

        ambiguous: false,
      };
    }

    //--------------------------------------------------
    // UPLOAD
    //--------------------------------------------------

    if (action === "upload") {
      if (step.file || step.path || step.value || step.target) {
        return {
          valid: true,

          confidence: 100,

          reason: "Upload information available.",

          ambiguous: false,
        };
      }

      return {
        valid: false,

        confidence: 0,

        reason: "Upload file information missing.",

        ambiguous: false,
      };
    }

    //--------------------------------------------------
    // ACTIONS REQUIRING TARGET
    //--------------------------------------------------

    const query = step.target || step.label || step.text || step.selector;

    if (!query) {
      return {
        valid: false,

        confidence: 0,

        reason: "Action target missing.",

        ambiguous: false,
      };
    }

    //--------------------------------------------------
    // SCORING DISABLED
    //--------------------------------------------------

    if (!this.options.enableScoring) {
      return {
        valid: true,

        confidence: 70,

        reason: "Scoring disabled.",

        ambiguous: false,
      };
    }

    //--------------------------------------------------
    // GET STEP-SPECIFIC CANDIDATES
    //
    // Priority:
    //
    // 1. step.candidates
    // 2. context.domCandidates
    // 3. context.candidates
    // 4. context.ranked
    // 5. ScoringEngine index
    //--------------------------------------------------

    const candidates = this.getCandidatesForStep(step, context);

    //--------------------------------------------------
    // SCORE REQUEST
    //--------------------------------------------------

    this.stats.scoringRequests++;

    let ranked = [];

    try {
      if (Array.isArray(candidates) && candidates.length) {
        ranked = this.scoringEngine.rankCandidates(query, candidates);
      } else {
        ranked = this.scoringEngine.rankCandidates(query);
      }
    } catch (err) {
      this.log("Scoring failed:", err.message);

      return {
        valid: true,

        confidence: null,

        reason: "Scoring engine unavailable; LLM may be required.",

        ambiguous: false,

        ranked: [],
      };
    }

    //--------------------------------------------------
    // NO CANDIDATES
    //--------------------------------------------------

    if (!ranked?.length) {
      return {
        valid: true,

        confidence: null,

        reason: "No DOM candidates available; LLM may be required.",

        ambiguous: false,

        ranked: [],
      };
    }

    //--------------------------------------------------
    // BEST CANDIDATE
    //--------------------------------------------------

    const best = ranked[0];

    const confidence = Number(best?.score ?? best?.confidence ?? 0);

    //--------------------------------------------------
    // SECOND CANDIDATE
    //--------------------------------------------------

    const second = ranked[1] || null;

    const secondScore = Number(second?.score ?? second?.confidence ?? 0);

    //--------------------------------------------------
    // AMBIGUITY
    //--------------------------------------------------

    const ambiguityGap = confidence - secondScore;

    const ambiguous =
      !!second &&
      confidence >= this.options.plannerThreshold &&
      ambiguityGap < 5;

    //--------------------------------------------------
    // LOW CONFIDENCE
    //--------------------------------------------------

    if (confidence < this.options.plannerThreshold) {
      return {
        valid: true,

        confidence,

        candidate: best,

        ranked,

        ambiguous: false,

        matchedField: best?.matchedField || "",

        reason: `Best candidate confidence ${confidence.toFixed(
          2,
        )}% is below planner threshold ${this.options.plannerThreshold}%.`,
      };
    }

    //--------------------------------------------------
    // AMBIGUOUS
    //--------------------------------------------------

    if (ambiguous) {
      return {
        valid: true,

        confidence,

        candidate: best,

        ranked,

        ambiguous: true,

        matchedField: best?.matchedField || "",

        reason: `Top candidates are ambiguous. Score gap: ${ambiguityGap.toFixed(
          2,
        )}.`,
      };
    }

    //--------------------------------------------------
    // HIGH CONFIDENCE
    //--------------------------------------------------

    return {
      valid: true,

      confidence,

      candidate: best,

      ranked,

      ambiguous: false,

      matchedField: best?.matchedField || "",

      reason:
        confidence >= this.options.autoExecuteThreshold
          ? `High-confidence candidate resolved at ${confidence.toFixed(2)}%.`
          : `Candidate confidence ${confidence.toFixed(2)}% is sufficient.`,
    };
  }

  //======================================================
  // GET CANDIDATES FOR STEP
  //======================================================

  getCandidatesForStep(step, context = {}) {
    //--------------------------------------------------
    // Step-specific candidates
    //--------------------------------------------------

    if (Array.isArray(step.candidates)) {
      return step.candidates;
    }

    //--------------------------------------------------
    // DOM candidates
    //--------------------------------------------------

    if (Array.isArray(context.domCandidates)) {
      return context.domCandidates;
    }

    //--------------------------------------------------
    // Generic candidates
    //--------------------------------------------------

    if (Array.isArray(context.candidates)) {
      return context.candidates;
    }

    //--------------------------------------------------
    // Already ranked candidates
    //--------------------------------------------------

    if (Array.isArray(context.ranked)) {
      return context.ranked;
    }

    //--------------------------------------------------
    // ScoringEngine internal index
    //--------------------------------------------------

    if (
      this.scoringEngine &&
      typeof this.scoringEngine.getIndexedElements === "function"
    ) {
      return this.scoringEngine.getIndexedElements();
    }

    return [];
  }

  //======================================================
  // LLM PLANNER
  //======================================================

  async planWithLLM(input, context, parsed) {
    const prompt = this.buildPrompt(input, context, parsed);

    this.log("Calling LLM...");

    let response;

    if (this.options.provider === "ollama") {
      response = await this.callOllama(prompt);
    } else {
      response = await this.callOpenAICompatible(prompt);
    }

    //--------------------------------------------------
    // PARSE LLM RESPONSE
    //--------------------------------------------------

    let plan = this.parseLLMResponse(response);

    //--------------------------------------------------
    // REPAIR JSON
    //--------------------------------------------------

    if (!plan) {
      const repaired = this.repairJSON(response);

      if (repaired) {
        this.stats.repairedPlans++;

        plan = repaired;
      }
    }

    //--------------------------------------------------
    // VALIDATE
    //--------------------------------------------------

    if (!plan) {
      throw new Error("LLM returned invalid plan.");
    }

    //--------------------------------------------------
    // NORMALIZE
    //--------------------------------------------------

    plan = this.normalizeLLMPlan(plan);

    //--------------------------------------------------
    // VALIDATE NORMALIZED PLAN
    //--------------------------------------------------

    if (plan.mode === "action" && !plan.steps.length) {
      throw new Error("LLM plan contains no executable steps.");
    }

    //--------------------------------------------------
    // IMPORTANT
    //
    // LLM is allowed to interpret intent,
    // but not to perform fuzzy matching.
    //
    // Re-score all generated targets through
    // ScoringEngine before final execution.
    //--------------------------------------------------

    if (plan.mode === "action") {
      const validated = await this.evaluateFastPlan(
        {
          steps: plan.steps,
        },
        context,
      );

      //--------------------------------------------------
      // If LLM generated a valid complete plan,
      // keep the LLM ordering and targets.
      //--------------------------------------------------

      if (validated.steps.length === plan.steps.length) {
        plan.steps = validated.steps;

        plan.confidence = this.calculatePlanConfidence(plan.steps);
      }
    }

    return plan;
  }

  //======================================================
  // OLLAMA
  //======================================================

  async callOllama(prompt) {
    const controller = new AbortController();

    const timeout = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(this.options.endpoint, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          model: this.options.model,

          prompt,

          stream: false,

          format: "json",
        }),

        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama HTTP ${response.status}`);
      }

      const data = await response.json();

      return data.response || data.output || data.text || "";
    } finally {
      clearTimeout(timeout);
    }
  }

  //======================================================
  // OPENAI COMPATIBLE
  //======================================================

  async callOpenAICompatible(prompt) {
    if (!this.options.apiKey) {
      throw new Error("API key missing.");
    }

    const controller = new AbortController();

    const timeout = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(this.options.endpoint, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${this.options.apiKey}`,
        },

        body: JSON.stringify({
          model: this.options.model,

          messages: [
            {
              role: "system",

              content: this.systemPrompt(),
            },

            {
              role: "user",

              content: prompt,
            },
          ],

          temperature: 0,
        }),

        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`LLM HTTP ${response.status}`);
      }

      const data = await response.json();

      return data?.choices?.[0]?.message?.content || "";
    } finally {
      clearTimeout(timeout);
    }
  }

  //======================================================
  // SYSTEM PROMPT
  //======================================================

  systemPrompt() {
    return `You are the planning engine for an AI browser automation system.

Your job is to convert a user's command into a strict JSON execution plan.

IMPORTANT ARCHITECTURE RULES:

1. Return JSON only.
2. Preserve the exact order of requested actions.
3. Never skip a requested step.
4. Never silently remove a step.
5. Never invent unrelated actions.
6. Use only supported browser actions.
7. Do NOT perform fuzzy matching.
8. Do NOT calculate similarity scores.
9. Do NOT invent CSS selectors unless explicitly required.
10. Keep natural-language target text close to the user's wording.
11. ScoringEngine performs target matching after planning.
12. Every requested action must become a separate ordered step.
13. Use "chat" mode only for conversational requests.
14. If the user gives multiple actions, return all actions.
15. Never merge separate user actions into one step.

Supported actions:

click
type
select
hover
press
wait
navigate
back
forward
reload
scroll
checkbox
upload

Example:

{
  "mode": "action",
  "steps": [
    {
      "action": "click",
      "target": "Login"
    }
  ]
}

Multi-step example:

{
  "mode": "action",
  "steps": [
    {
      "action": "click",
      "target": "Login"
    },
    {
      "action": "type",
      "target": "Email",
      "value": "user@example.com"
    },
    {
      "action": "click",
      "target": "Submit"
    }
  ]
}`;
  }

  //======================================================
  // BUILD PROMPT
  //======================================================

  buildPrompt(input, context, parsed) {
    const pageText = String(context.pageText || context.text || "").slice(
      0,
      this.options.maxContextLength,
    );

    const ranked = Array.isArray(context.ranked)
      ? context.ranked.slice(0, 10).map((candidate) => ({
          text: candidate.text,

          role: candidate.role,

          tag: candidate.tag,

          score: candidate.score,

          matchedField: candidate.matchedField,
        }))
      : [];

    const stepResults = Array.isArray(context.stepResults)
      ? context.stepResults
      : [];

    return `User command:
${input}

Fast parsed intent:
${JSON.stringify(parsed || {}, null, 2)}

Previous ScoringEngine results:
${JSON.stringify(stepResults, null, 2)}

Top scored DOM candidates:
${JSON.stringify(ranked, null, 2)}

Current page text:
${pageText}

Return a valid JSON execution plan only.`;
  }

  //======================================================
  // PARSE LLM RESPONSE
  //======================================================

  parseLLMResponse(response) {
    if (!response) {
      return null;
    }

    if (typeof response === "object") {
      return response;
    }

    let text = String(response).trim();

    //--------------------------------------------------
    // Remove markdown fences
    //--------------------------------------------------

    text = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    //--------------------------------------------------
    // Direct JSON
    //--------------------------------------------------

    try {
      return JSON.parse(text);
    } catch {}

    //--------------------------------------------------
    // Extract JSON object
    //--------------------------------------------------

    const start = text.indexOf("{");

    const end = text.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {}
    }

    return null;
  }

  //======================================================
  // JSON REPAIR
  //======================================================

  repairJSON(response) {
    if (!response) {
      return null;
    }

    let text = String(response).trim();

    //--------------------------------------------------
    // Remove markdown
    //--------------------------------------------------

    text = text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    //--------------------------------------------------
    // Find object
    //--------------------------------------------------

    const start = text.indexOf("{");

    const end = text.lastIndexOf("}");

    if (start < 0 || end < start) {
      return null;
    }

    text = text.slice(start, end + 1);

    //--------------------------------------------------
    // Common repairs
    //--------------------------------------------------

    text = text.replace(/,\s*([}\]])/g, "$1").replace(/'/g, '"');

    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  //======================================================
  // NORMALIZE LLM PLAN
  //======================================================

  normalizeLLMPlan(plan) {
    const mode = plan.mode === "chat" ? "chat" : "action";

    //--------------------------------------------------
    // CHAT
    //--------------------------------------------------

    if (mode === "chat") {
      return {
        success: true,

        mode: "chat",

        source: "llm",

        reply: String(plan.reply || ""),

        steps: [],
      };
    }

    //--------------------------------------------------
    // STEPS
    //--------------------------------------------------

    const rawSteps = Array.isArray(plan.steps) ? plan.steps : [];

    const steps = this.normalizeSteps(rawSteps);

    return {
      success: true,

      mode: "action",

      source: "llm",

      confidence: Number(plan.confidence ?? 70),

      steps,
    };
  }

  //======================================================
  // NORMALIZE PARSED INTENT
  //======================================================

  normalizeParsedIntent(parsed, input) {
    if (!parsed) {
      return {
        mode: "unknown",

        raw: input,

        steps: [],
      };
    }

    //--------------------------------------------------
    // Structured result
    //--------------------------------------------------

    if (typeof parsed === "object") {
      const steps = this.normalizeSteps(parsed.steps || []);

      let mode = parsed.mode;

      if (!mode) {
        mode = steps.length ? "action" : "unknown";
      }

      return {
        ...parsed,

        mode,

        raw: parsed.raw || input,

        steps,
      };
    }

    return {
      mode: "unknown",

      raw: input,

      steps: [],
    };
  }

  //======================================================
  // NORMALIZE STEPS
  //======================================================

  normalizeSteps(steps) {
    if (!Array.isArray(steps)) {
      return [];
    }

    return steps
      .map((step, index) => {
        if (!step || typeof step !== "object") {
          return null;
        }

        const action = this.normalizeAction(step.action || step.tool);

        return {
          ...step,

          id: step.id || `step-${index + 1}`,

          order: index + 1,

          action,

          tool: this.actionToTool(action),

          target: step.target ?? step.label ?? step.text ?? "",

          value: step.value ?? step.input ?? undefined,
        };
      })
      .filter(Boolean)
      .slice(0, this.options.maxSteps);
  }

  //======================================================
  // ACTION NORMALIZER
  //======================================================

  normalizeAction(action) {
    if (!action) {
      return "";
    }

    const normalized = String(action)
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");

    const aliases = {
      click: "click",

      press: "press",

      keypress: "press",

      type: "type",

      fill: "type",

      input: "type",

      select: "select",

      selectoption: "select",

      hover: "hover",

      mouseover: "hover",

      wait: "wait",

      delay: "wait",

      navigate: "navigate",

      goto: "navigate",

      open: "navigate",

      back: "back",

      forward: "forward",

      reload: "reload",

      refresh: "reload",

      scroll: "scroll",

      checkbox: "checkbox",

      check: "checkbox",

      uncheck: "checkbox",

      upload: "upload",

      chat: "chat",
    };

    return aliases[normalized] || normalized;
  }

  //======================================================
  // SUPPORTED ACTION CHECK
  //======================================================

  isSupportedAction(action) {
    return [
      "click",
      "type",
      "select",
      "hover",
      "press",
      "wait",
      "navigate",
      "back",
      "forward",
      "reload",
      "scroll",
      "checkbox",
      "upload",
      "chat",
    ].includes(action);
  }

  //======================================================
  // ACTION → TOOL
  //======================================================

  actionToTool(action) {
    const map = {
      click: "click",

      type: "type",

      select: "select",

      hover: "hover",

      press: "press",

      wait: "wait",

      navigate: "navigate",

      back: "back",

      forward: "forward",

      reload: "reload",

      scroll: "scroll",

      checkbox: "checkbox",

      upload: "upload",

      chat: "chat",
    };

    return map[action] || action;
  }

  //======================================================
  // CHAT PLAN
  //======================================================

  createChatPlan(parsed, input) {
    return {
      success: true,

      mode: "chat",

      source: "intent-parser",

      reply: parsed.reply || `I understood your request: ${input}`,

      steps: [],
    };
  }

  //======================================================
  // FALLBACK PLAN
  //======================================================

  createFallbackPlan(parsed, input) {
    const steps = this.normalizeSteps(parsed.steps || []);

    return {
      success: true,

      mode: steps.length ? "action" : "chat",

      source: "fallback",

      confidence: steps.length ? this.calculatePlanConfidence(steps) : 50,

      reply: steps.length ? undefined : `I understood: ${input}`,

      steps,
    };
  }

  //======================================================
  // PLAN CONFIDENCE
  //======================================================

  calculatePlanConfidence(steps) {
    if (!steps?.length) {
      return 0;
    }

    const scores = steps.map((step) => Number(step.confidence ?? 100));

    const total = scores.reduce((sum, score) => sum + score, 0);

    return Number((total / scores.length).toFixed(2));
  }

  //======================================================
  // CONTEXT NORMALIZER
  //======================================================

  normalizeContext(context) {
    if (!context || typeof context !== "object") {
      return {
        pageText: "",

        ranked: [],

        candidates: [],

        domCandidates: [],

        query: "",

        stepResults: [],
      };
    }

    return {
      ...context,

      pageText: String(context.pageText || context.text || "").slice(
        0,
        this.options.maxContextLength,
      ),

      ranked: Array.isArray(context.ranked) ? context.ranked : [],

      candidates: Array.isArray(context.candidates) ? context.candidates : [],

      domCandidates: Array.isArray(context.domCandidates)
        ? context.domCandidates
        : [],

      stepResults: Array.isArray(context.stepResults)
        ? context.stepResults
        : [],
    };
  }

  //======================================================
  // FINALIZE PLAN
  //======================================================

  finalizePlan(plan, started) {
    const normalizedSteps = this.normalizeSteps(plan?.steps || []);

    //--------------------------------------------------
    // Final step-count validation
    //--------------------------------------------------

    const requestedStepCount = normalizedSteps.length;

    const finalPlan = {
      success: plan?.success !== false,

      mode: plan?.mode || "action",

      source: plan?.source || "planner",

      confidence: Number(
        plan?.confidence ?? this.calculatePlanConfidence(normalizedSteps),
      ),

      steps: normalizedSteps,

      ...(plan?.reply !== undefined
        ? {
            reply: plan.reply,
          }
        : {}),

      metadata: {
        planningTime: Date.now() - started,

        timestamp: Date.now(),

        stepCount: requestedStepCount,

        maxSteps: this.options.maxSteps,
      },
    };

    //--------------------------------------------------
    // CHAT
    //--------------------------------------------------

    if (finalPlan.mode === "chat") {
      finalPlan.steps = [];
    }

    //--------------------------------------------------
    // STORE HISTORY
    //--------------------------------------------------

    this.lastPlan = finalPlan;

    this.history.push({
      input: this.lastInput,

      plan: finalPlan,

      timestamp: Date.now(),
    });

    //--------------------------------------------------
    // BOUNDED HISTORY
    //--------------------------------------------------

    if (this.history.length > this.options.historyLimit) {
      this.history.shift();
    }

    //--------------------------------------------------
    // STATISTICS
    //--------------------------------------------------

    this.stats.successfulPlans++;

    this.log("Final plan:", JSON.stringify(finalPlan, null, 2));

    return finalPlan;
  }

  //======================================================
  // HISTORY
  //======================================================

  getLastPlan() {
    return this.lastPlan;
  }

  getHistory() {
    return [...this.history];
  }

  clearHistory() {
    this.history = [];

    this.lastPlan = null;
  }

  //======================================================
  // STATISTICS
  //======================================================

  getStatistics() {
    return {
      ...this.stats,

      lastInput: this.lastInput,

      historySize: this.history.length,

      lastPlanMode: this.lastPlan?.mode || null,

      lastPlanSource: this.lastPlan?.source || null,

      lastPlanConfidence: this.lastPlan?.confidence ?? null,

      scoringMetrics:
        this.scoringEngine &&
        typeof this.scoringEngine.getMetrics === "function"
          ? this.scoringEngine.getMetrics()
          : null,
    };
  }

  //======================================================
  // RESET
  //======================================================

  reset() {
    this.lastPlan = null;

    this.lastInput = "";

    this.lastError = null;

    this.history = [];

    this.stats = {
      totalCalls: 0,

      fastPathCalls: 0,

      llmCalls: 0,

      llmFailures: 0,

      repairedPlans: 0,

      chatCalls: 0,

      actionCalls: 0,

      multiStepCalls: 0,

      successfulPlans: 0,

      failedPlans: 0,

      skippedSteps: 0,

      scoringRequests: 0,

      ambiguousSteps: 0,
    };
  }
}
