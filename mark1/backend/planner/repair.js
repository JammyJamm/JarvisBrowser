/**
 * ============================================================
 * backend/planner/repair.js
 *
 * Ultra-Robust Planner Repair & Recovery Layer
 *
 * Architecture
 * ------------------------------------------------------------
 *
 * Raw Planner / LLM Output
 *          │
 *          ▼
 * Input Normalization
 *          │
 *          ▼
 * JSON Extraction
 *          │
 *          ▼
 * Safe JSON Parse
 *          │
 *          ▼
 * Broken JSON Repair
 *          │
 *          ▼
 * Heuristic Recovery
 *          │
 *          ▼
 * Plan Normalization
 *          │
 *          ▼
 * Validation
 *          │
 *          ▼
 * Repaired Planner Plan
 *
 * IMPORTANT
 * ------------------------------------------------------------
 * This file NEVER:
 *
 * ❌ performs fuzzy matching
 * ❌ selects DOM elements
 * ❌ resolves selectors
 * ❌ executes browser actions
 * ❌ calls Resolver
 * ❌ makes planning decisions
 *
 * Responsibilities
 * ------------------------------------------------------------
 * ✔ Recover malformed planner output
 * ✔ Parse JSON safely
 * ✔ Extract JSON from noisy LLM responses
 * ✔ Repair incomplete JSON
 * ✔ Recover partial plans
 * ✔ Normalize planner output formats
 * ✔ Normalize step structures
 * ✔ Validate plans
 * ✔ Preserve planner metadata
 *
 * Used by
 * ------------------------------------------------------------
 * ✔ Planner
 * ✔ ScoringEngine fallback pipeline
 * ✔ SelfHealing
 * ✔ MultiStep planner
 *
 * ============================================================
 */

//==============================================================
// DEFAULT OPTIONS
//==============================================================

const DEFAULT_OPTIONS = Object.freeze({
  strict: false,

  maxSteps: 100,

  maxIntentLength: 500,

  maxStepTextLength: 1000,

  allowNoOp: true,

  autoRepair: true,
});

//==============================================================
// PLAN REPAIR CLASS
//==============================================================

class PlannerRepair {
  constructor(options = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    this.strict = this.options.strict;

    this.logger = this.options.logger || console;
  }

  //============================================================
  // PUBLIC ENTRY
  //============================================================

  repair(raw) {
    const startedAt = Date.now();

    if (raw === null || raw === undefined || raw === "") {
      return this._attachRepairMetadata(
        this._emptyPlan(),
        startedAt,
        "empty_input",
      );
    }

    //----------------------------------------------------------
    // STEP 1
    // Normalize input
    //----------------------------------------------------------

    let data = this._normalizeInput(raw);

    //----------------------------------------------------------
    // STEP 2
    // Parse object directly
    //----------------------------------------------------------

    if (this._isObject(data)) {
      if (this._isValidPlan(data)) {
        return this._finalizePlan(data, startedAt, "valid_object");
      }

      data = this._normalizePlan(data);
    }

    //----------------------------------------------------------
    // STEP 3
    // Parse string
    //----------------------------------------------------------

    if (typeof data === "string") {
      data = this._parseString(data);
    }

    //----------------------------------------------------------
    // STEP 4
    // Validate parsed result
    //----------------------------------------------------------

    if (this._isValidPlan(data)) {
      return this._finalizePlan(data, startedAt, "json_recovered");
    }

    //----------------------------------------------------------
    // STEP 5
    // Heuristic recovery
    //----------------------------------------------------------

    if (this.options.autoRepair) {
      data = this._heuristicRepair(raw);
    }

    //----------------------------------------------------------
    // STEP 6
    // Final normalization
    //----------------------------------------------------------

    const normalized = this._normalizePlan(data);

    //----------------------------------------------------------
    // STEP 7
    // Final validation
    //----------------------------------------------------------

    if (!this._isValidPlan(normalized)) {
      if (this.strict) {
        throw new Error("[PlannerRepair] Unable to produce valid planner plan");
      }

      return this._attachRepairMetadata(
        this._emptyPlan(),
        startedAt,
        "final_fallback",
      );
    }

    return this._finalizePlan(normalized, startedAt, "heuristic_repair");
  }

  //============================================================
  // PUBLIC VALIDATION
  //============================================================

  isValidPlan(plan) {
    return this._isValidPlan(plan);
  }

  //============================================================
  // INPUT NORMALIZATION
  //============================================================

  _normalizeInput(raw) {
    //----------------------------------------------------------
    // Already an object
    //----------------------------------------------------------

    if (this._isObject(raw)) {
      return raw;
    }

    //----------------------------------------------------------
    // Arrays can represent plans
    //----------------------------------------------------------

    if (Array.isArray(raw)) {
      return {
        steps: raw,
      };
    }

    //----------------------------------------------------------
    // Convert primitive values to string
    //----------------------------------------------------------

    if (typeof raw !== "string") {
      return String(raw);
    }

    let text = raw.trim();

    //----------------------------------------------------------
    // Remove BOM
    //----------------------------------------------------------

    text = text.replace(/^\uFEFF/, "");

    //----------------------------------------------------------
    // Remove Markdown fences
    //----------------------------------------------------------

    text = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    return text;
  }

  //============================================================
  // STRING PARSER
  //============================================================

  _parseString(text) {
    if (!text || typeof text !== "string") {
      return null;
    }

    //----------------------------------------------------------
    // Direct JSON parse
    //----------------------------------------------------------

    const direct = this._safeJsonParse(text);

    if (direct !== null) {
      return direct;
    }

    //----------------------------------------------------------
    // Extract JSON object
    //----------------------------------------------------------

    const extractedObject = this._extractJsonBlock(text, "{", "}");

    if (extractedObject) {
      const parsed = this._safeJsonParse(extractedObject);

      if (parsed !== null) {
        return parsed;
      }

      //--------------------------------------------------------
      // Try repairing extracted JSON
      //--------------------------------------------------------

      const repaired = this._fixBrokenJson(extractedObject);

      const repairedParsed = this._safeJsonParse(repaired);

      if (repairedParsed !== null) {
        return repairedParsed;
      }
    }

    //----------------------------------------------------------
    // Extract JSON array
    //----------------------------------------------------------

    const extractedArray = this._extractJsonBlock(text, "[", "]");

    if (extractedArray) {
      const parsed = this._safeJsonParse(extractedArray);

      if (parsed !== null) {
        return {
          steps: parsed,
        };
      }
    }

    //----------------------------------------------------------
    // Attempt repaired full text
    //----------------------------------------------------------

    const fixed = this._fixBrokenJson(text);

    const repaired = this._safeJsonParse(fixed);

    if (repaired !== null) {
      return repaired;
    }

    return null;
  }

  //============================================================
  // SAFE JSON PARSER
  //============================================================

  _safeJsonParse(value) {
    if (typeof value !== "string") {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  //============================================================
  // JSON BLOCK EXTRACTION
  //============================================================

  _extractJsonBlock(text, openChar, closeChar) {
    if (!text) return null;

    const start = text.indexOf(openChar);

    if (start === -1) {
      return null;
    }

    let depth = 0;

    let inString = false;

    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const char = text[i];

      //--------------------------------------------------------
      // String handling
      //--------------------------------------------------------

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === '"') {
          inString = false;
        }

        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      //--------------------------------------------------------
      // Bracket tracking
      //--------------------------------------------------------

      if (char === openChar) {
        depth++;
      }

      if (char === closeChar) {
        depth--;

        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }

    //----------------------------------------------------------
    // Incomplete JSON
    //----------------------------------------------------------

    return text.slice(start);
  }

  //============================================================
  // BROKEN JSON REPAIR
  //============================================================

  _fixBrokenJson(str) {
    if (!str || typeof str !== "string") {
      return "";
    }

    let fixed = str.trim();

    //----------------------------------------------------------
    // Remove Markdown fences
    //----------------------------------------------------------

    fixed = fixed
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    //----------------------------------------------------------
    // Remove control characters
    //----------------------------------------------------------

    fixed = fixed.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

    //----------------------------------------------------------
    // Remove trailing commas
    //----------------------------------------------------------

    fixed = fixed.replace(/,\s*([}\]])/g, "$1");

    //----------------------------------------------------------
    // Convert simple single-quoted JSON
    //----------------------------------------------------------

    fixed = fixed.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, content) => {
      return `"${content.replace(/"/g, '\\"').replace(/\\'/g, "'")}"`;
    });

    //----------------------------------------------------------
    // Quote unquoted object keys
    //----------------------------------------------------------

    fixed = fixed.replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":');

    //----------------------------------------------------------
    // Normalize common Python-like values
    //----------------------------------------------------------

    fixed = fixed
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null");

    //----------------------------------------------------------
    // Remove accidental duplicate commas
    //----------------------------------------------------------

    fixed = fixed.replace(/,\s*,+/g, ",");

    //----------------------------------------------------------
    // Balance brackets
    //----------------------------------------------------------

    fixed = this._balanceJsonBrackets(fixed);

    return fixed;
  }

  //============================================================
  // BALANCE JSON BRACKETS
  //============================================================

  _balanceJsonBrackets(text) {
    const stack = [];

    let inString = false;

    let escaped = false;

    for (const char of text) {
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === '"') {
          inString = false;
        }

        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{" || char === "[") {
        stack.push(char);
      }

      if (char === "}" || char === "]") {
        const expected = char === "}" ? "{" : "[";

        const index = stack.lastIndexOf(expected);

        if (index !== -1) {
          stack.splice(index, 1);
        }
      }
    }

    //----------------------------------------------------------
    // Close missing brackets in reverse order
    //----------------------------------------------------------

    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i] === "{") {
        text += "}";
      } else {
        text += "]";
      }
    }

    return text;
  }

  //============================================================
  // VALIDATION
  //============================================================

  _isValidPlan(obj) {
    if (!obj || typeof obj !== "object") {
      return false;
    }

    if (Array.isArray(obj)) {
      return obj.length > 0;
    }

    return (
      Array.isArray(obj.steps) ||
      Array.isArray(obj.actions) ||
      Array.isArray(obj.plan) ||
      typeof obj.intent === "string" ||
      typeof obj.task === "string"
    );
  }

  //============================================================
  // HEURISTIC RECOVERY
  //============================================================

  _heuristicRepair(raw) {
    this._warn("[PlannerRepair] Using heuristic recovery");

    const text = typeof raw === "string" ? raw : this._safeStringify(raw);

    //----------------------------------------------------------
    // Extract intent
    //----------------------------------------------------------

    const intent = this._extractIntent(text);

    //----------------------------------------------------------
    // Extract actions
    //----------------------------------------------------------

    const actions = this._extractActions(text);

    //----------------------------------------------------------
    // If no structured actions found
    //----------------------------------------------------------

    if (!actions.length) {
      const fallbackText = this._cleanText(text);

      if (fallbackText) {
        actions.push(fallbackText.slice(0, this.options.maxStepTextLength));
      }
    }

    return {
      intent,
      steps: actions,
      metadata: {
        source: "heuristic_repair",
      },
    };
  }

  //============================================================
  // INTENT EXTRACTION
  //============================================================

  _extractIntent(text) {
    if (!text) {
      return "unknown_task";
    }

    const patterns = [
      /"intent"\s*:\s*"([^"]+)"/i,

      /intent\s*[:=]\s*["']?([^\n"',}]+)/i,

      /"task"\s*:\s*"([^"]+)"/i,

      /task\s*[:=]\s*["']?([^\n"',}]+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);

      if (match?.[1]) {
        return this._cleanText(match[1]).slice(0, this.options.maxIntentLength);
      }
    }

    //----------------------------------------------------------
    // First meaningful line fallback
    //----------------------------------------------------------

    const firstLine = text
      .split("\n")
      .map((line) => line.trim())
      .find(
        (line) =>
          line &&
          !line.startsWith("{") &&
          !line.startsWith("[") &&
          !line.startsWith("```"),
      );

    return firstLine?.slice(0, this.options.maxIntentLength) || "unknown_task";
  }

  //============================================================
  // ACTION EXTRACTION
  //============================================================

  _extractActions(text) {
    if (!text) return [];

    const actions = [];

    const lines = text.split("\n");

    for (const line of lines) {
      let cleaned = line.trim();

      if (!cleaned) continue;

      //--------------------------------------------------------
      // Remove bullets
      //--------------------------------------------------------

      cleaned = cleaned.replace(/^[-*•]\s+/, "");

      //--------------------------------------------------------
      // Remove numbered prefixes
      //--------------------------------------------------------

      cleaned = cleaned.replace(/^\d+[.)]\s+/, "");

      //--------------------------------------------------------
      // Remove common step labels
      //--------------------------------------------------------

      cleaned = cleaned.replace(/^(step\s*\d+\s*[:.-]\s*)/i, "");

      //--------------------------------------------------------
      // Skip obvious metadata
      //--------------------------------------------------------

      if (/^(intent|task|metadata|source)\s*[:=]/i.test(cleaned)) {
        continue;
      }

      //--------------------------------------------------------
      // Skip Markdown fences
      //--------------------------------------------------------

      if (cleaned.startsWith("```")) {
        continue;
      }

      //--------------------------------------------------------
      // Add meaningful action
      //--------------------------------------------------------

      if (cleaned.length > 0) {
        actions.push(cleaned.slice(0, this.options.maxStepTextLength));
      }
    }

    return actions.slice(0, this.options.maxSteps);
  }

  //============================================================
  // PLAN NORMALIZATION
  //============================================================

  _normalizePlan(plan) {
    //----------------------------------------------------------
    // Array = steps
    //----------------------------------------------------------

    if (Array.isArray(plan)) {
      plan = {
        steps: plan,
      };
    }

    //----------------------------------------------------------
    // Invalid plan
    //----------------------------------------------------------

    if (!plan || typeof plan !== "object") {
      return this._emptyPlan();
    }

    //----------------------------------------------------------
    // Resolve intent
    //----------------------------------------------------------

    const intent = this._normalizeIntent(
      plan.intent ?? plan.task ?? plan.goal ?? "unknown",
    );

    //----------------------------------------------------------
    // Resolve steps
    //----------------------------------------------------------

    const rawSteps = plan.steps ?? plan.actions ?? plan.plan ?? [];

    const steps = this._normalizeSteps(rawSteps);

    //----------------------------------------------------------
    // Metadata
    //----------------------------------------------------------

    const metadata = {
      ...(plan.metadata && typeof plan.metadata === "object"
        ? plan.metadata
        : {}),
    };

    //----------------------------------------------------------
    // Preserve useful planner fields
    //----------------------------------------------------------

    if (plan.source !== undefined) {
      metadata.source = plan.source;
    }

    if (plan.confidence !== undefined) {
      metadata.confidence = plan.confidence;
    }

    if (plan.model !== undefined) {
      metadata.model = plan.model;
    }

    if (plan.reasoning !== undefined) {
      metadata.reasoning = plan.reasoning;
    }

    return {
      intent,

      steps,

      metadata,
    };
  }

  //============================================================
  // STEP NORMALIZATION
  //============================================================

  _normalizeSteps(steps) {
    let list = steps;

    //----------------------------------------------------------
    // String step
    //----------------------------------------------------------

    if (typeof list === "string") {
      list = [list];
    }

    //----------------------------------------------------------
    // Invalid step collection
    //----------------------------------------------------------

    if (!Array.isArray(list)) {
      return this.options.allowNoOp ? [this._createStep("no-op", 0)] : [];
    }

    //----------------------------------------------------------
    // Normalize each step
    //----------------------------------------------------------

    const normalized = [];

    for (
      let index = 0;
      index < Math.min(list.length, this.options.maxSteps);
      index++
    ) {
      const step = this.repairStep(list[index], index);

      if (step) {
        normalized.push(step);
      }
    }

    //----------------------------------------------------------
    // Ensure minimum step
    //----------------------------------------------------------

    if (normalized.length === 0 && this.options.allowNoOp) {
      normalized.push(this._createStep("no-op", 0));
    }

    return normalized;
  }

  //============================================================
  // SINGLE STEP REPAIR
  //============================================================

  repairStep(step, index = 0) {
    //----------------------------------------------------------
    // String action
    //----------------------------------------------------------

    if (typeof step === "string") {
      const action = this._cleanText(step);

      if (!action) {
        return null;
      }

      return this._createStep(action, index);
    }

    //----------------------------------------------------------
    // Invalid step
    //----------------------------------------------------------

    if (!step || typeof step !== "object") {
      return null;
    }

    //----------------------------------------------------------
    // Normalize common action fields
    //----------------------------------------------------------

    const normalized = {
      ...step,
    };

    //----------------------------------------------------------
    // Resolve action
    //----------------------------------------------------------

    normalized.action =
      step.action ?? step.type ?? step.command ?? step.operation ?? "no-op";

    //----------------------------------------------------------
    // Normalize action name
    //----------------------------------------------------------

    if (typeof normalized.action === "string") {
      normalized.action = normalized.action.trim();
    }

    //----------------------------------------------------------
    // Resolve target aliases
    //----------------------------------------------------------

    if (normalized.target === undefined && step.element !== undefined) {
      normalized.target = step.element;
    }

    if (normalized.selector === undefined && step.locator !== undefined) {
      normalized.selector = step.locator;
    }

    //----------------------------------------------------------
    // Resolve value aliases
    //----------------------------------------------------------

    if (normalized.value === undefined && step.text !== undefined) {
      normalized.value = step.text;
    }

    //----------------------------------------------------------
    // Add stable step ID
    //----------------------------------------------------------

    normalized.id = step.id || `step_${index + 1}`;

    //----------------------------------------------------------
    // Add order
    //----------------------------------------------------------

    normalized.order = typeof step.order === "number" ? step.order : index + 1;

    return normalized;
  }

  //============================================================
  // STEP CREATOR
  //============================================================

  _createStep(action, index) {
    return {
      id: `step_${index + 1}`,

      order: index + 1,

      action,
    };
  }

  //============================================================
  // FINALIZE PLAN
  //============================================================

  _finalizePlan(plan, startedAt, source) {
    const normalized = this._normalizePlan(plan);

    return this._attachRepairMetadata(normalized, startedAt, source);
  }

  //============================================================
  // REPAIR METADATA
  //============================================================

  _attachRepairMetadata(plan, startedAt, source) {
    const result = {
      ...plan,

      metadata: {
        ...(plan.metadata || {}),

        repaired: source !== "valid_object",

        repairSource: source,

        repairTimeMs: Date.now() - startedAt,
      },
    };

    return result;
  }

  //============================================================
  // EMPTY PLAN
  //============================================================

  _emptyPlan() {
    return {
      intent: "empty",

      steps: this.options.allowNoOp
        ? [
            {
              id: "step_1",

              order: 1,

              action: "no-op",
            },
          ]
        : [],

      metadata: {
        repaired: true,

        repairSource: "empty_input",
      },
    };
  }

  //============================================================
  // HELPERS
  //============================================================

  _normalizeIntent(intent) {
    if (intent === null || intent === undefined) {
      return "unknown";
    }

    return (
      String(intent).trim().slice(0, this.options.maxIntentLength) || "unknown"
    );
  }

  _cleanText(text) {
    if (text === null || text === undefined) {
      return "";
    }

    return String(text)
      .replace(/^["']|["']$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  _safeStringify(value) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  _isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  _warn(message) {
    try {
      this.logger?.warn?.(message);
    } catch {
      // Ignore logger failures
    }
  }

  _error(message) {
    try {
      this.logger?.error?.(message);
    } catch {
      // Ignore logger failures
    }
  }
}

//==============================================================
// SINGLETON
//==============================================================

const plannerRepair = new PlannerRepair();

//==============================================================
// DEFAULT EXPORT
//==============================================================

export default plannerRepair;

//==============================================================
// NAMED EXPORTS
//==============================================================

export { PlannerRepair, DEFAULT_OPTIONS };
