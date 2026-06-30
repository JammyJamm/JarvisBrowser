/**
 * planner/selector-ranking.js
 *
 * Ultra-fast intent selector + ranking engine
 * Designed for Jarvis Browser Planner system
 *
 * Features:
 * - O(1)-style scoring (no heavy dependencies)
 * - Regex + keyword hybrid ranking
 * - Context-aware boosting
 * - Action prioritization system
 * - Safe fallback ranking
 * - Extensible scoring plugins
 */

class SelectorRanking {
  constructor(options = {}) {
    this.debug = options.debug || false;

    // Base weights for ranking signals
    this.weights = {
      keywordMatch: 2.0,
      regexMatch: 3.5,
      actionPriority: 2.5,
      contextBoost: 1.8,
      lengthPenalty: 0.5,
      confidenceBoost: 3.0,
    };

    // Priority mapping for action types
    this.actionPriorityMap = {
      navigate: 10,
      click: 9,
      type: 8,
      scroll: 6,
      wait: 4,
      extract: 7,
      search: 9,
      open_tab: 8,
      close_tab: 5,
      screenshot: 3,
      idle: 1,
    };

    // Fast intent patterns
    this.intentPatterns = [
      { type: "navigate", regex: /go to|open|visit|launch/i },
      { type: "click", regex: /click|press|select/i },
      { type: "type", regex: /type|enter|input|write/i },
      { type: "search", regex: /search|find|look for/i },
      { type: "scroll", regex: /scroll|move down|move up/i },
      { type: "extract", regex: /get|extract|read|scrape/i },
      { type: "screenshot", regex: /screenshot|capture|image/i },
    ];
  }

  /**
   * Main ranking function
   * @param {Array} candidates - possible actions/steps
   * @param {Object} context - user input + state
   */
  rank(candidates = [], context = {}) {
    if (!Array.isArray(candidates)) return [];

    const input = (context.input || "").toLowerCase();
    const ctx = context || {};

    const scored = candidates.map((candidate) => {
      const score = this.scoreCandidate(candidate, input, ctx);
      return {
        ...candidate,
        _score: score,
      };
    });

    return scored.sort((a, b) => b._score - a._score);
  }

  /**
   * Score a single candidate
   */
  scoreCandidate(candidate, input, context) {
    let score = 0;

    const action = candidate.action || candidate.type || "";
    const label = (candidate.label || "").toLowerCase();
    const description = (candidate.description || "").toLowerCase();

    // 1. Action priority boost
    const priority = this.actionPriorityMap[action] || 1;
    score += priority * this.weights.actionPriority;

    // 2. Keyword matching
    const keywords = this.extractKeywords(input);
    for (const k of keywords) {
      if (label.includes(k) || description.includes(k)) {
        score += this.weights.keywordMatch;
      }
    }

    // 3. Regex intent matching
    for (const pattern of this.intentPatterns) {
      if (pattern.regex.test(input) && pattern.type === action) {
        score += this.weights.regexMatch;
      }
    }

    // 4. Context boost (history or UI state)
    if (context.lastAction && context.lastAction === action) {
      score += this.weights.contextBoost;
    }

    // 5. Confidence boost (if provided by upstream planner)
    if (typeof candidate.confidence === "number") {
      score += candidate.confidence * this.weights.confidenceBoost;
    }

    // 6. Penalty for overly long labels (noise reduction)
    if (label.length > 60) {
      score -= this.weights.lengthPenalty;
    }

    // 7. Exact match bonus
    if (label === input) {
      score += 5;
    }

    return score;
  }

  /**
   * Extract lightweight keywords from input
   */
  extractKeywords(input) {
    if (!input) return [];

    return input
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 8);
  }

  /**
   * Merge ranking with fallback safety
   */
  safeRank(candidates, context) {
    try {
      const result = this.rank(candidates, context);
      if (!result.length) return candidates;
      return result;
    } catch (err) {
      if (this.debug) {
        console.error("[SelectorRanking] fallback triggered:", err);
      }
      return candidates;
    }
  }

  /**
   * Add or update intent patterns dynamically
   */
  addIntentPattern(type, regex) {
    this.intentPatterns.push({ type, regex });
  }

  /**
   * Update weights dynamically
   */
  updateWeights(newWeights = {}) {
    this.weights = { ...this.weights, ...newWeights };
  }

  /**
   * Debug helper
   */
  explainRanking(candidates, context = {}) {
    const ranked = this.rank(candidates, context);

    return ranked.map((c) => ({
      action: c.action,
      score: c._score,
      label: c.label,
    }));
  }
}

module.exports = SelectorRanking;
