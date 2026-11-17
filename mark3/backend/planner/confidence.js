// confidence.js
//
// Lightweight confidence scoring engine for planner decisions
// Used to determine:
// - Whether parsed intent is reliable
// - Whether to execute action directly
// - Whether to fallback to LLM (Ollama/Qwen/etc.)
//
// Score range: 0.0 (low confidence) → 1.0 (high confidence)

class ConfidenceEngine {
  constructor(options = {}) {
    this.thresholds = {
      high: options.high || 0.75,
      medium: options.medium || 0.5,
      low: options.low || 0.3,
    };

    this.weights = {
      keywordMatch: 0.35,
      structureMatch: 0.25,
      regexPrecision: 0.2,
      contextConsistency: 0.2,
    };
  }

  /**
   * Main scoring function
   * @param {Object} input
   * @param {string} input.text - user input
   * @param {Object} input.parsed - planner result
   * @param {Array<string>} input.intentPatterns - known patterns
   */
  score({ text, parsed = {}, intentPatterns = [] }) {
    let score = 0;

    score += this._keywordScore(text, parsed) * this.weights.keywordMatch;
    score += this._structureScore(parsed) * this.weights.structureMatch;
    score +=
      this._regexScore(text, intentPatterns) * this.weights.regexPrecision;
    score += this._contextScore(text, parsed) * this.weights.contextConsistency;

    return this._normalize(score);
  }

  /**
   * Decide action based on confidence
   */
  decide(confidence) {
    if (confidence >= this.thresholds.high) return "EXECUTE_DIRECT";
    if (confidence >= this.thresholds.medium) return "EXECUTE_WITH_VALIDATION";
    if (confidence >= this.thresholds.low) return "FALLBACK_LIGHT";
    return "FALLBACK_LLM";
  }

  // -----------------------------
  // Internal scoring components
  // -----------------------------

  _keywordScore(text, parsed) {
    if (!parsed.intent) return 0;

    const words = text.toLowerCase().split(/\s+/);
    const intent = parsed.intent.toLowerCase();

    const matchCount = words.filter((w) => intent.includes(w)).length;

    return Math.min(matchCount / Math.max(words.length, 1), 1);
  }

  _structureScore(parsed) {
    let score = 0;

    if (parsed.intent) score += 0.4;
    if (parsed.action) score += 0.3;
    if (parsed.target) score += 0.3;

    return score;
  }

  _regexScore(text, patterns) {
    if (!patterns.length) return 0.5; // neutral confidence

    let best = 0;

    for (const p of patterns) {
      try {
        const regex = new RegExp(p, "i");
        if (regex.test(text)) {
          best = Math.max(best, 1);
        }
      } catch {
        continue;
      }
    }

    return best;
  }

  _contextScore(text, parsed) {
    let score = 0.5;

    if (parsed.action && parsed.intent) score += 0.2;
    if (text.length > 20) score += 0.1;
    if (text.length > 80) score += 0.1;
    if (/[!?]/.test(text)) score += 0.1;

    return Math.min(score, 1);
  }

  _normalize(value) {
    return Math.max(0, Math.min(1, value));
  }
}

module.exports = ConfidenceEngine;
