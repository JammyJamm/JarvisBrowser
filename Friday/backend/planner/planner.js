//==========================================================
//
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
//      │
//      ├── Multi-Step Parsing
//      │
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
// Fuzzy matching belongs to ScoringEngine.
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
// ✔ Prevent skipped steps
// ✔ Preserve step ordering
// ✔ Support chat and action modes
//
//==========================================================

import IntentParser from "./intent-parser.js";
import ScoringEngine from "./scoring-engine.js";

export default class Planner {
  constructor(options = {}) {
    //--------------------------------------------------
    // Configuration
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

      maxSteps: options.maxSteps || 20,

      maxContextLength: options.maxContextLength || 8000,

      debug: options.debug || false,

      enableScoring: options.enableScoring !== false,

      enableLearning: options.enableLearning !== false,

      ...options,
    };

    //--------------------------------------------------
    // Intent Parser
    //--------------------------------------------------

    this.intentParser =
      options.intentParser ||
      new IntentParser({
        debug: this.options.debug,
      });

    //--------------------------------------------------
    // Scoring Engine
    //--------------------------------------------------

    this.scoringEngine =
      options.scoringEngine ||
      new ScoringEngine({
        plannerThreshold: this.options.plannerThreshold,

        autoExecuteThreshold: this.options.autoExecuteThreshold,
      });

    //--------------------------------------------------
    // Runtime State
    //--------------------------------------------------

    this.lastPlan = null;

    this.lastInput = "";

    this.lastError = null;

    this.history = [];

    //--------------------------------------------------
    // Statistics
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
    // Validate Input
    //--------------------------------------------------

    if (!this.lastInput) {
      throw new Error("Planner requires a command.");
    }

    //--------------------------------------------------
    // Normalize Context
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
    // Normalize Parsed Result
    //--------------------------------------------------

    parsed = this.normalizeParsedIntent(parsed, this.lastInput);

    //--------------------------------------------------
    // CHAT DETECTION
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

      if (fastPlan.accept) {
        this.stats.fastPathCalls++;

        this.stats.actionCalls++;

        if (fastPlan.steps.length > 1) {
          this.stats.multiStepCalls++;
        }

        this.log("Fast path accepted:", fastPlan.reason);

        return this.finalizePlan(fastPlan.plan, started);
      }
    }

    //--------------------------------------------------
    // LLM FALLBACK
    //--------------------------------------------------

    if (this.options.useLLM) {
      try {
        this.stats.llmCalls++;

        const llmPlan = await this.planWithLLM(
          this.lastInput,
          normalizedContext,
          parsed,
        );

        if (llmPlan) {
          this.stats.actionCalls++;

          if (llmPlan.steps?.length > 1) {
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
    // FINAL FALLBACK
    //--------------------------------------------------

    if (parsed.steps?.length) {
      this.stats.actionCalls++;

      return this.finalizePlan(
        this.createFallbackPlan(parsed, this.lastInput),

        started,
      );
    }

    //--------------------------------------------------
    // Nothing Resolved
    //--------------------------------------------------

    this.stats.failedPlans++;

    throw new Error(`Unable to understand command: "${this.lastInput}"`);
  }

  //======================================================
  // INTENT PARSER
  //======================================================

  async parseIntent(input, context) {
    //--------------------------------------------------
    // IntentParser should remain fast.
    //
    // No LLM.
    // No fuzzy matching.
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

        plan: null,
      };
    }

    //--------------------------------------------------
    // Limit Steps
    //--------------------------------------------------

    const limitedSteps = steps.slice(0, this.options.maxSteps);

    //--------------------------------------------------
    // Validate Every Step
    //--------------------------------------------------

    const validatedSteps = [];

    let requiresLLM = false;

    for (let index = 0; index < limitedSteps.length; index++) {
      const step = limitedSteps[index];

      const validation = await this.validateStep(step, context);

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
      // Low confidence
      //--------------------------------------------------

      if (
        validation.confidence !== null &&
        validation.confidence < this.options.plannerThreshold
      ) {
        requiresLLM = true;
      }

      validatedSteps.push({
        ...step,

        confidence: validation.confidence,

        validation: validation.reason,
      });
    }

    //--------------------------------------------------
    // If explicit multi-step command exists,
    // preserve ALL steps.
    //
    // Never silently skip a step.
    //--------------------------------------------------

    if (validatedSteps.length > 1) {
      this.log(
        "Multi-step plan detected:",

        validatedSteps.length,
      );

      this.stats.multiStepCalls++;
    }

    //--------------------------------------------------
    // High confidence direct path
    //--------------------------------------------------

    if (!requiresLLM) {
      return {
        accept: true,

        reason: "All steps resolved with sufficient confidence.",

        steps: validatedSteps,

        plan: {
          success: true,

          mode: "action",

          source: "intent-parser",

          confidence: this.calculatePlanConfidence(validatedSteps),

          steps: validatedSteps,
        },
      };
    }

    //--------------------------------------------------
    // Low confidence
    //--------------------------------------------------

    return {
      accept: false,

      reason: "One or more steps require LLM clarification.",

      steps: validatedSteps,

      plan: null,
    };
  }

  //======================================================
  // STEP VALIDATION
  //======================================================

  async validateStep(step, context) {
    //--------------------------------------------------
    // Basic validation
    //--------------------------------------------------

    if (!step || typeof step !== "object") {
      return {
        valid: false,

        confidence: 0,

        reason: "Invalid step.",
      };
    }

    const action = this.normalizeAction(step.action || step.tool);

    //--------------------------------------------------
    // Chat
    //--------------------------------------------------

    if (action === "chat") {
      return {
        valid: true,

        confidence: 100,

        reason: "Chat action.",
      };
    }

    //--------------------------------------------------
    // Navigation
    //--------------------------------------------------

    if (action === "navigate") {
      if (step.url || step.value || step.target) {
        return {
          valid: true,

          confidence: 100,

          reason: "Navigation target available.",
        };
      }

      return {
        valid: false,

        confidence: 0,

        reason: "Navigation URL missing.",
      };
    }

    //--------------------------------------------------
    // Wait
    //--------------------------------------------------

    if (action === "wait") {
      return {
        valid: true,

        confidence: 100,

        reason: "Wait action.",
      };
    }

    //--------------------------------------------------
    // Keyboard
    //--------------------------------------------------

    if (action === "press") {
      if (step.key || step.value || step.target) {
        return {
          valid: true,

          confidence: 100,

          reason: "Keyboard key available.",
        };
      }
    }

    //--------------------------------------------------
    // Actions requiring target
    //--------------------------------------------------

    const query = step.target || step.label || step.text || step.selector;

    if (!query) {
      return {
        valid: false,

        confidence: 0,

        reason: "Action target missing.",
      };
    }

    //--------------------------------------------------
    // Scoring Engine
    //
    // IMPORTANT:
    // Planner does NOT perform fuzzy matching.
    // ScoringEngine owns candidate ranking.
    //--------------------------------------------------

    if (!this.options.enableScoring) {
      return {
        valid: true,

        confidence: 70,

        reason: "Scoring disabled.",
      };
    }

    //--------------------------------------------------
    // Use provided ranked candidates
    //--------------------------------------------------

    let ranked = context.ranked;

    if (!Array.isArray(ranked) || !ranked.length) {
      try {
        if (
          this.scoringEngine &&
          typeof this.scoringEngine.rankCandidates === "function"
        ) {
          ranked = this.scoringEngine.rankCandidates(query);
        }
      } catch (err) {
        this.log("Scoring failed:", err.message);
      }
    }

    //--------------------------------------------------
    // No candidates
    //--------------------------------------------------

    if (!ranked?.length) {
      return {
        valid: true,

        confidence: null,

        reason: "No DOM candidates available; LLM may be required.",
      };
    }

    //--------------------------------------------------
    // Best Candidate
    //--------------------------------------------------

    const best = ranked[0];

    const confidence = Number(best?.score ?? best?.confidence ?? 0);

    //--------------------------------------------------
    // Ambiguous Candidates
    //--------------------------------------------------

    const second = ranked[1];

    const secondScore = Number(second?.score ?? second?.confidence ?? 0);

    const ambiguous = second && Math.abs(confidence - secondScore) < 5;

    if (ambiguous) {
      return {
        valid: true,

        confidence,

        reason: "Top candidates are ambiguous.",
      };
    }

    //--------------------------------------------------
    // Successful candidate
    //--------------------------------------------------

    return {
      valid: true,

      confidence,

      candidate: best,

      ranked,

      reason:
        confidence >= this.options.plannerThreshold
          ? "Candidate confidence is sufficient."
          : "Candidate confidence is below planner threshold.",
    };
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
    // Parse LLM response
    //--------------------------------------------------

    let plan = this.parseLLMResponse(response);

    //--------------------------------------------------
    // Repair JSON
    //--------------------------------------------------

    if (!plan) {
      const repaired = this.repairJSON(response);

      if (repaired) {
        this.stats.repairedPlans++;

        plan = repaired;
      }
    }

    //--------------------------------------------------
    // Validate
    //--------------------------------------------------

    if (!plan) {
      throw new Error("LLM returned invalid plan.");
    }

    //--------------------------------------------------
    // Normalize
    //--------------------------------------------------

    plan = this.normalizeLLMPlan(plan);

    //--------------------------------------------------
    // Validate normalized plan
    //--------------------------------------------------

    if (!plan.steps.length) {
      throw new Error("LLM plan contains no executable steps.");
    }

    return plan;
  }

  //======================================================
  // OLLAMA
  //======================================================

  async callOllama(prompt) {
    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),

      this.options.timeout,
    );

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
  // OPENAI-COMPATIBLE
  //======================================================

  async callOpenAICompatible(prompt) {
    if (!this.options.apiKey) {
      throw new Error("API key missing.");
    }

    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),

      this.options.timeout,
    );

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

Rules:

1. Return JSON only.
2. Preserve the user's requested step order.
3. Never skip a requested step.
4. Never invent unrelated actions.
5. Use only supported browser actions.
6. Do not perform fuzzy matching.
7. Do not guess selectors when a natural-language target is sufficient.
8. Keep target text close to the user's original wording.
9. For multiple actions, return every action as a separate ordered step.
10. Use "chat" mode only for conversational requests.

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
        }))
      : [];

    return `User command:
${input}

Fast parsed intent:
${JSON.stringify(parsed || {}, null, 2)}

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
    // Chat
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
    // Steps
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

        steps: [],
      };
    }

    //--------------------------------------------------
    // Already structured
    //--------------------------------------------------

    if (typeof parsed === "object") {
      const mode = parsed.mode || (parsed.steps?.length ? "action" : "unknown");

      return {
        ...parsed,

        mode,

        steps: this.normalizeSteps(parsed.steps || []),
      };
    }

    return {
      mode: "unknown",

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

      upload: "upload",

      chat: "chat",
    };

    return aliases[normalized] || normalized;
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

      confidence: 50,

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

        query: "",
      };
    }

    return {
      ...context,

      pageText: String(context.pageText || context.text || "").slice(
        0,
        this.options.maxContextLength,
      ),

      ranked: Array.isArray(context.ranked) ? context.ranked : [],
    };
  }

  //======================================================
  // FINALIZE PLAN
  //======================================================

  finalizePlan(plan, started) {
    const finalPlan = {
      success: plan?.success !== false,

      mode: plan?.mode || "action",

      source: plan?.source || "planner",

      confidence: Number(
        plan?.confidence ?? this.calculatePlanConfidence(plan?.steps || []),
      ),

      steps: this.normalizeSteps(plan?.steps || []),

      ...(plan?.reply !== undefined
        ? {
            reply: plan.reply,
          }
        : {}),

      metadata: {
        planningTime: Date.now() - started,

        timestamp: Date.now(),

        stepCount: plan?.steps?.length || 0,
      },
    };

    //--------------------------------------------------
    // Preserve chat response
    //--------------------------------------------------

    if (finalPlan.mode === "chat") {
      finalPlan.steps = [];
    }

    //--------------------------------------------------
    // Store history
    //--------------------------------------------------

    this.lastPlan = finalPlan;

    this.history.push({
      input: this.lastInput,

      plan: finalPlan,

      timestamp: Date.now(),
    });

    //--------------------------------------------------
    // Keep history bounded
    //--------------------------------------------------

    if (this.history.length > 100) {
      this.history.shift();
    }

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
  }
}
