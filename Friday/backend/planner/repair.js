/**
 * planner/repair.js
 *
 * Ultra-robust repair layer for Planner outputs
 * - Fixes broken JSON
 * - Repairs incomplete intents
 * - Normalizes action plans
 * - Recovers from partial LLM outputs
 */

class PlannerRepair {
  constructor(options = {}) {
    this.strict = options.strict ?? false;
    this.logger = options.logger ?? console;
  }

  // =====================================================
  // PUBLIC ENTRY
  // =====================================================

  repair(raw) {
    if (!raw) return this._emptyPlan();

    // Step 1: Normalize input
    let data = this._normalizeInput(raw);

    // Step 2: Try JSON parse if string
    if (typeof data === "string") {
      data = this._safeJsonParse(data);
    }

    // Step 3: If still invalid, attempt heuristic recovery
    if (!this._isValidPlan(data)) {
      data = this._heuristicRepair(raw);
    }

    // Step 4: Final normalization
    data = this._normalizePlan(data);

    return data;
  }

  // =====================================================
  // INPUT NORMALIZATION
  // =====================================================

  _normalizeInput(raw) {
    if (typeof raw === "object") return raw;
    if (typeof raw !== "string") return String(raw);

    return raw
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
  }

  // =====================================================
  // SAFE JSON PARSER
  // =====================================================

  _safeJsonParse(str) {
    try {
      return JSON.parse(str);
    } catch (e) {
      this.logger.warn("[PlannerRepair] JSON parse failed, attempting fix...");

      const fixed = this._fixBrokenJson(str);

      try {
        return JSON.parse(fixed);
      } catch (err) {
        this.logger.error("[PlannerRepair] Repair failed completely.");
        return null;
      }
    }
  }

  // =====================================================
  // JSON FIX ENGINE
  // =====================================================

  _fixBrokenJson(str) {
    let fixed = str;

    // Remove trailing commas
    fixed = fixed.replace(/,\s*}/g, "}");
    fixed = fixed.replace(/,\s*]/g, "]");

    // Fix single quotes -> double quotes
    fixed = fixed.replace(/'/g, '"');

    // Add missing quotes around keys
    fixed = fixed.replace(/(\w+)\s*:/g, '"$1":');

    // Remove invalid control characters
    fixed = fixed.replace(/[\u0000-\u001F]+/g, "");

    // Try to close unclosed braces
    const openBraces = (fixed.match(/{/g) || []).length;
    const closeBraces = (fixed.match(/}/g) || []).length;

    if (openBraces > closeBraces) {
      fixed += "}".repeat(openBraces - closeBraces);
    }

    return fixed;
  }

  // =====================================================
  // VALIDATION
  // =====================================================

  _isValidPlan(obj) {
    if (!obj || typeof obj !== "object") return false;

    // Accept multiple planner formats
    return (
      Array.isArray(obj.steps) ||
      Array.isArray(obj.actions) ||
      typeof obj.intent === "string" ||
      typeof obj.task === "string"
    );
  }

  // =====================================================
  // HEURISTIC RECOVERY
  // =====================================================

  _heuristicRepair(raw) {
    this.logger.warn("[PlannerRepair] Using heuristic recovery...");

    const text = typeof raw === "string" ? raw : JSON.stringify(raw);

    // Extract intent
    const intentMatch =
      text.match(/intent\s*[:=]\s*"?(.+?)"?($|\n)/i) ||
      text.match(/task\s*[:=]\s*"?(.+?)"?($|\n)/i);

    const intent = intentMatch ? intentMatch[1].trim() : "unknown_task";

    // Extract actions using simple bullet/number detection
    const actions = [];

    const lines = text.split("\n");
    for (const line of lines) {
      const cleaned = line.trim();

      if (/^[-*•]\s+/.test(cleaned)) {
        actions.push(cleaned.replace(/^[-*•]\s+/, ""));
      }

      if (/^\d+\.\s+/.test(cleaned)) {
        actions.push(cleaned.replace(/^\d+\.\s+/, ""));
      }
    }

    return {
      intent,
      steps: actions.length ? actions : [text.slice(0, 120)],
      source: "heuristic_repair",
    };
  }

  // =====================================================
  // NORMALIZATION
  // =====================================================

  _normalizePlan(plan) {
    if (!plan || typeof plan !== "object") return this._emptyPlan();

    const normalized = {
      intent: plan.intent || plan.task || "unknown",
      steps: [],
      metadata: plan.metadata || {},
    };

    const steps = plan.steps || plan.actions || plan.plan || [];

    if (Array.isArray(steps)) {
      normalized.steps = steps.map((s) =>
        typeof s === "string" ? { action: s } : s,
      );
    } else if (typeof steps === "string") {
      normalized.steps = [{ action: steps }];
    }

    // Ensure at least one step
    if (normalized.steps.length === 0) {
      normalized.steps.push({ action: "no-op" });
    }

    return normalized;
  }

  // =====================================================
  // EMPTY PLAN FALLBACK
  // =====================================================

  _emptyPlan() {
    return {
      intent: "empty",
      steps: [{ action: "no-op" }],
      metadata: {
        repaired: true,
      },
    };
  }
}

module.exports = PlannerRepair;
