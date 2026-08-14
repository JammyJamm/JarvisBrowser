/**
 * backend/planner/selector-ranking.js
 *
 * Ultra-fast selector candidate ranking engine
 * Designed for Jarvis Browser Planner system
 *
 * Architecture
 * ------------------------------------------------------------
 *
 * Intent Parser
 *      │
 *      ▼
 * Scoring Engine
 *      │
 *      ├── exact / token / fuzzy / semantic scores
 *      │
 *      ▼
 * Selector Ranking
 *      │
 *      ├── action compatibility
 *      ├── candidate metadata
 *      ├── visibility
 *      ├── interactability
 *      ├── accessibility
 *      ├── context
 *      ├── confidence
 *      │
 *      ▼
 * Resolver
 *
 * IMPORTANT
 * ------------------------------------------------------------
 * This file NEVER:
 *
 * ❌ Executes browser actions
 * ❌ Clicks elements
 * ❌ Types into elements
 * ❌ Calls Playwright directly
 * ❌ Performs expensive fuzzy matching
 * ❌ Calls the LLM
 * ❌ Makes final planner decisions
 *
 * Responsibilities
 * ------------------------------------------------------------
 * ✔ Rank already-generated selector candidates
 * ✔ Combine upstream scoring signals
 * ✔ Apply action compatibility
 * ✔ Apply visibility/interactability boosts
 * ✔ Apply accessibility boosts
 * ✔ Apply context boosts
 * ✔ Penalize weak or unsafe candidates
 * ✔ Provide deterministic ranking
 * ✔ Explain ranking decisions
 * ✔ Support extensible ranking plugins
 */

import { normalize, tokenize, isExactMatch } from "./fuzzy-match.js";

//==============================================================
// DEFAULT CONFIGURATION
//==============================================================

const DEFAULT_OPTIONS = {
  debug: false,

  maxCandidates: 1000,

  maxKeywords: 12,

  minKeywordLength: 2,

  exactMatchBonus: 25,

  partialMatchBonus: 8,

  actionMatchBonus: 15,

  roleMatchBonus: 10,

  accessibilityBonus: 8,

  visibleBonus: 12,

  interactableBonus: 12,

  enabledBonus: 8,

  contextBonus: 8,

  confidenceWeight: 20,

  upstreamScoreWeight: 1,

  fuzzyScoreWeight: 1,

  semanticScoreWeight: 1,

  lengthPenalty: 0.1,

  hiddenPenalty: 25,

  disabledPenalty: 20,

  unsafePenalty: 50,
};

//==============================================================
// ACTION PRIORITY
//==============================================================

const ACTION_PRIORITY_MAP = Object.freeze({
  navigate: 10,

  click: 9,

  search: 9,

  type: 8,

  fill: 8,

  select: 8,

  extract: 7,

  scroll: 6,

  wait: 4,

  open_tab: 8,

  close_tab: 5,

  screenshot: 3,

  back: 7,

  forward: 7,

  reload: 6,

  execute_js: 2,

  idle: 1,
});

//==============================================================
// ACTION → EXPECTED DOM ROLES / TAGS
//==============================================================

const ACTION_TARGET_MAP = Object.freeze({
  click: {
    tags: ["button", "a", "input", "summary"],

    roles: ["button", "link", "menuitem", "tab", "option"],
  },

  type: {
    tags: ["input", "textarea", "select"],

    roles: ["textbox", "combobox", "searchbox"],
  },

  fill: {
    tags: ["input", "textarea"],

    roles: ["textbox", "searchbox", "combobox"],
  },

  select: {
    tags: ["select", "option"],

    roles: ["combobox", "option", "listbox"],
  },

  search: {
    tags: ["input", "button"],

    roles: ["searchbox", "textbox", "button"],
  },
});

//==============================================================
// INTENT PATTERNS
//==============================================================
//
// These are lightweight action hints only.
// They are NOT responsible for full intent parsing.
//

const DEFAULT_INTENT_PATTERNS = [
  {
    type: "navigate",

    regex: /\b(go to|open|visit|launch|navigate)\b/i,
  },

  {
    type: "click",

    regex: /\b(click|press|tap)\b/i,
  },

  {
    type: "type",

    regex: /\b(type|enter|input|write|fill)\b/i,
  },

  {
    type: "select",

    regex: /\b(select|choose|pick)\b/i,
  },

  {
    type: "search",

    regex: /\b(search|find|look for|lookup)\b/i,
  },

  {
    type: "scroll",

    regex: /\b(scroll|move down|move up)\b/i,
  },

  {
    type: "extract",

    regex: /\b(get|extract|read|scrape)\b/i,
  },

  {
    type: "screenshot",

    regex: /\b(screenshot|capture screen|capture image)\b/i,
  },
];

//==============================================================
// SELECTOR RANKING CLASS
//==============================================================

class SelectorRanking {
  constructor(options = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    this.debug = this.options.debug;

    this.weights = {
      actionPriority: 2.5,

      keywordMatch: 2.0,

      regexMatch: 3.5,

      contextBoost: 1.8,

      confidenceBoost: 3.0,

      exactMatch: 5,

      partialMatch: 1.5,

      visibility: 2,

      interactability: 2,

      accessibility: 1.5,

      upstreamScore: 1,

      fuzzyScore: 1,

      semanticScore: 1,
    };

    this.actionPriorityMap = {
      ...ACTION_PRIORITY_MAP,

      ...(options.actionPriorityMap || {}),
    };

    this.intentPatterns = [
      ...DEFAULT_INTENT_PATTERNS,

      ...(options.intentPatterns || []),
    ];

    this.plugins = [];

    this.stats = {
      ranked: 0,

      candidates: 0,

      errors: 0,
    };
  }

  //============================================================
  // MAIN RANKING FUNCTION
  //============================================================

  rank(candidates = [], context = {}) {
    if (!Array.isArray(candidates)) {
      return [];
    }

    if (!candidates.length) {
      return [];
    }

    const safeCandidates = candidates.slice(0, this.options.maxCandidates);

    const input = this._getInput(context);

    const scored = safeCandidates.map((candidate, index) => {
      try {
        const explanation = this._scoreWithExplanation(
          candidate,
          input,
          context,
        );

        return {
          ...candidate,

          _score: explanation.score,

          _ranking: explanation,

          _originalIndex: index,
        };
      } catch (error) {
        this.stats.errors++;

        if (this.debug) {
          console.error("[SelectorRanking] Candidate scoring failed:", error);
        }

        return {
          ...candidate,

          _score: 0,

          _ranking: {
            score: 0,

            error: error.message,
          },

          _originalIndex: index,
        };
      }
    });

    scored.sort((a, b) => {
      const scoreDifference = b._score - a._score;

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return (a._originalIndex || 0) - (b._originalIndex || 0);
    });

    this.stats.ranked++;

    this.stats.candidates += scored.length;

    return scored;
  }

  //============================================================
  // SCORE SINGLE CANDIDATE
  //============================================================

  scoreCandidate(candidate = {}, input = "", context = {}) {
    return this._scoreWithExplanation(candidate, input, context).score;
  }

  //============================================================
  // DETAILED SCORE
  //============================================================

  _scoreWithExplanation(candidate, input, context) {
    const normalizedInput = normalize(input);

    const action = this._getAction(candidate, context);

    const label = this._getLabel(candidate);

    const description = this._getDescription(candidate);

    const role = normalize(candidate.role || candidate.ariaRole || "");

    const tag = normalize(candidate.tag || candidate.tagName || "");

    const accessibleName = normalize(
      candidate.accessibleName || candidate.ariaLabel || candidate.name || "",
    );

    const explanation = {
      score: 0,

      actionPriority: 0,

      keywordMatch: 0,

      regexMatch: 0,

      exactMatch: 0,

      partialMatch: 0,

      actionMatch: 0,

      roleMatch: 0,

      accessibility: 0,

      visibility: 0,

      interactability: 0,

      context: 0,

      confidence: 0,

      upstream: 0,

      fuzzy: 0,

      semantic: 0,

      penalties: 0,
    };

    //----------------------------------------------------------
    // ACTION PRIORITY
    //----------------------------------------------------------

    const priority = this.actionPriorityMap[action] || 1;

    explanation.actionPriority = priority * this.weights.actionPriority;

    //----------------------------------------------------------
    // KEYWORD MATCH
    //----------------------------------------------------------

    explanation.keywordMatch =
      this._keywordScore(normalizedInput, label, description, accessibleName) *
      this.weights.keywordMatch;

    //----------------------------------------------------------
    // REGEX ACTION MATCH
    //----------------------------------------------------------

    explanation.regexMatch =
      this._regexScore(input, action) * this.weights.regexMatch;

    //----------------------------------------------------------
    // EXACT MATCH
    //----------------------------------------------------------

    if (
      normalizedInput &&
      (isExactMatch(normalizedInput, label) ||
        isExactMatch(normalizedInput, accessibleName))
    ) {
      explanation.exactMatch = this.weights.exactMatch;
    }

    //----------------------------------------------------------
    // PARTIAL MATCH
    //----------------------------------------------------------

    if (
      normalizedInput &&
      (label.includes(normalizedInput) ||
        accessibleName.includes(normalizedInput) ||
        normalizedInput.includes(label))
    ) {
      explanation.partialMatch = this.weights.partialMatch;
    }

    //----------------------------------------------------------
    // ACTION COMPATIBILITY
    //----------------------------------------------------------

    explanation.actionMatch =
      this._actionCompatibilityScore(action, candidate) *
      this.weights.actionMatch;

    //----------------------------------------------------------
    // ROLE COMPATIBILITY
    //----------------------------------------------------------

    explanation.roleMatch =
      this._roleCompatibilityScore(action, role, tag) * this.weights.roleMatch;

    //----------------------------------------------------------
    // ACCESSIBILITY
    //----------------------------------------------------------

    explanation.accessibility =
      this._accessibilityScore(candidate) * this.weights.accessibility;

    //----------------------------------------------------------
    // VISIBILITY
    //----------------------------------------------------------

    explanation.visibility =
      this._visibilityScore(candidate) * this.weights.visibility;

    //----------------------------------------------------------
    // INTERACTABILITY
    //----------------------------------------------------------

    explanation.interactability =
      this._interactabilityScore(candidate) * this.weights.interactability;

    //----------------------------------------------------------
    // CONTEXT
    //----------------------------------------------------------

    explanation.context =
      this._contextScore(candidate, action, context) *
      this.weights.contextBoost;

    //----------------------------------------------------------
    // CONFIDENCE
    //----------------------------------------------------------

    explanation.confidence =
      this._confidenceScore(candidate) * this.weights.confidenceBoost;

    //----------------------------------------------------------
    // UPSTREAM SCORING ENGINE
    //----------------------------------------------------------

    if (typeof candidate.score === "number") {
      explanation.upstream = candidate.score * this.options.upstreamScoreWeight;
    }

    if (typeof candidate.scoring === "object" && candidate.scoring) {
      if (typeof candidate.scoring.score === "number") {
        explanation.upstream +=
          candidate.scoring.score * this.options.upstreamScoreWeight;
      }

      if (typeof candidate.scoring.fuzzy === "number") {
        explanation.fuzzy =
          candidate.scoring.fuzzy * this.options.fuzzyScoreWeight;
      }

      if (typeof candidate.scoring.semantic === "number") {
        explanation.semantic =
          candidate.scoring.semantic * this.options.semanticScoreWeight;
      }
    }

    //----------------------------------------------------------
    // PENALTIES
    //----------------------------------------------------------

    explanation.penalties = this._penaltyScore(candidate);

    //----------------------------------------------------------
    // PLUGINS
    //----------------------------------------------------------

    const pluginScore = this._runPlugins(candidate, input, context);

    //----------------------------------------------------------
    // FINAL SCORE
    //----------------------------------------------------------

    explanation.score =
      explanation.actionPriority +
      explanation.keywordMatch +
      explanation.regexMatch +
      explanation.exactMatch +
      explanation.partialMatch +
      explanation.actionMatch +
      explanation.roleMatch +
      explanation.accessibility +
      explanation.visibility +
      explanation.interactability +
      explanation.context +
      explanation.confidence +
      explanation.upstream +
      explanation.fuzzy +
      explanation.semantic +
      pluginScore -
      explanation.penalties;

    //----------------------------------------------------------
    // Length penalty
    //----------------------------------------------------------

    const candidateLength = label.length + description.length;

    if (candidateLength > 100) {
      explanation.score -= (candidateLength - 100) * this.options.lengthPenalty;
    }

    //----------------------------------------------------------
    // Never return negative ranking
    //----------------------------------------------------------

    explanation.score = Math.max(0, explanation.score);

    return explanation;
  }

  //============================================================
  // KEYWORD SCORING
  //============================================================

  _keywordScore(input, label, description, accessibleName) {
    if (!input) {
      return 0;
    }

    const keywords = this.extractKeywords(input);

    if (!keywords.length) {
      return 0;
    }

    const searchableText = [label, description, accessibleName]
      .filter(Boolean)
      .join(" ");

    if (!searchableText) {
      return 0;
    }

    let matched = 0;

    for (const keyword of keywords) {
      if (searchableText.includes(keyword)) {
        matched++;
      }
    }

    return matched / keywords.length;
  }

  //============================================================
  // REGEX SCORE
  //============================================================

  _regexScore(input, action) {
    if (!input || !action) {
      return 0;
    }

    for (const pattern of this.intentPatterns) {
      if (pattern.type === action && pattern.regex.test(input)) {
        return 1;
      }
    }

    return 0;
  }

  //============================================================
  // ACTION COMPATIBILITY
  //============================================================

  _actionCompatibilityScore(action, candidate) {
    if (!action) {
      return 0;
    }

    const expected = ACTION_TARGET_MAP[action];

    if (!expected) {
      return 0.5;
    }

    const tag = normalize(candidate.tag || candidate.tagName || "");

    const role = normalize(candidate.role || candidate.ariaRole || "");

    if (expected.tags.includes(tag)) {
      return 1;
    }

    if (expected.roles.includes(role)) {
      return 1;
    }

    return 0;
  }

  //============================================================
  // ROLE COMPATIBILITY
  //============================================================

  _roleCompatibilityScore(action, role, tag) {
    const expected = ACTION_TARGET_MAP[action];

    if (!expected) {
      return 0;
    }

    if (role && expected.roles.includes(role)) {
      return 1;
    }

    if (tag && expected.tags.includes(tag)) {
      return 0.8;
    }

    return 0;
  }

  //============================================================
  // ACCESSIBILITY SCORE
  //============================================================

  _accessibilityScore(candidate) {
    let score = 0;

    if (candidate.accessibleName) {
      score += 0.5;
    }

    if (candidate.ariaLabel) {
      score += 0.3;
    }

    if (candidate.role || candidate.ariaRole) {
      score += 0.2;
    }

    return Math.min(score, 1);
  }

  //============================================================
  // VISIBILITY SCORE
  //============================================================

  _visibilityScore(candidate) {
    if (candidate.visible === false || candidate.hidden === true) {
      return -1;
    }

    if (candidate.visible === true) {
      return 1;
    }

    return 0.5;
  }

  //============================================================
  // INTERACTABILITY SCORE
  //============================================================

  _interactabilityScore(candidate) {
    if (candidate.interactable === false) {
      return -1;
    }

    if (candidate.interactable === true) {
      return 1;
    }

    if (candidate.clickable === true) {
      return 1;
    }

    return 0.5;
  }

  //============================================================
  // CONTEXT SCORE
  //============================================================

  _contextScore(candidate, action, context) {
    let score = 0;

    if (context.lastAction && context.lastAction === action) {
      score += 0.5;
    }

    if (
      context.expectedRole &&
      normalize(candidate.role || "") === normalize(context.expectedRole)
    ) {
      score += 0.25;
    }

    if (
      context.expectedTag &&
      normalize(candidate.tag || candidate.tagName || "") ===
        normalize(context.expectedTag)
    ) {
      score += 0.25;
    }

    return Math.min(score, 1);
  }

  //============================================================
  // CONFIDENCE SCORE
  //============================================================

  _confidenceScore(candidate) {
    if (typeof candidate.confidence === "number") {
      return Math.max(
        0,
        Math.min(
          1,
          candidate.confidence > 1
            ? candidate.confidence / 100
            : candidate.confidence,
        ),
      );
    }

    return 0;
  }

  //============================================================
  // PENALTIES
  //============================================================

  _penaltyScore(candidate) {
    let penalty = 0;

    if (candidate.visible === false || candidate.hidden === true) {
      penalty += this.options.hiddenPenalty;
    }

    if (candidate.disabled === true) {
      penalty += this.options.disabledPenalty;
    }

    if (candidate.unsafe === true) {
      penalty += this.options.unsafePenalty;
    }

    return penalty;
  }

  //============================================================
  // INPUT EXTRACTION
  //============================================================

  _getInput(context) {
    if (!context) {
      return "";
    }

    return String(context.input || context.text || context.query || "").trim();
  }

  //============================================================
  // ACTION EXTRACTION
  //============================================================

  _getAction(candidate, context) {
    return normalize(
      candidate.action || candidate.type || context.action || "",
    );
  }

  //============================================================
  // LABEL EXTRACTION
  //============================================================

  _getLabel(candidate) {
    return normalize(
      candidate.label ||
        candidate.text ||
        candidate.name ||
        candidate.accessibleName ||
        candidate.ariaLabel ||
        "",
    );
  }

  //============================================================
  // DESCRIPTION EXTRACTION
  //============================================================

  _getDescription(candidate) {
    return normalize(
      candidate.description || candidate.title || candidate.placeholder || "",
    );
  }

  //============================================================
  // KEYWORD EXTRACTION
  //============================================================

  extractKeywords(input) {
    if (!input) {
      return [];
    }

    return tokenize(input)
      .filter((word) => word.length >= this.options.minKeywordLength)
      .slice(0, this.options.maxKeywords);
  }

  //============================================================
  // SAFE RANK
  //============================================================

  safeRank(candidates = [], context = {}) {
    try {
      const result = this.rank(candidates, context);

      if (!result.length) {
        return candidates;
      }

      return result;
    } catch (error) {
      this.stats.errors++;

      if (this.debug) {
        console.error("[SelectorRanking] fallback triggered:", error);
      }

      return candidates;
    }
  }

  //============================================================
  // TOP CANDIDATE
  //============================================================

  best(candidates = [], context = {}) {
    const ranked = this.rank(candidates, context);

    return ranked[0] || null;
  }

  //============================================================
  // TOP N CANDIDATES
  //============================================================

  top(candidates = [], context = {}, limit = 5) {
    return this.rank(candidates, context).slice(0, Math.max(0, limit));
  }

  //============================================================
  // ADD INTENT PATTERN
  //============================================================

  addIntentPattern(type, regex) {
    if (!type || !(regex instanceof RegExp)) {
      return false;
    }

    this.intentPatterns.push({
      type,

      regex,
    });

    return true;
  }

  //============================================================
  // UPDATE WEIGHTS
  //============================================================

  updateWeights(newWeights = {}) {
    this.weights = {
      ...this.weights,

      ...newWeights,
    };

    return this.weights;
  }

  //============================================================
  // REGISTER RANKING PLUGIN
  //============================================================

  registerPlugin(plugin) {
    if (typeof plugin !== "function") {
      return false;
    }

    this.plugins.push(plugin);

    return true;
  }

  //============================================================
  // RUN PLUGINS
  //============================================================

  _runPlugins(candidate, input, context) {
    let score = 0;

    for (const plugin of this.plugins) {
      try {
        const value = plugin(candidate, input, context);

        if (typeof value === "number") {
          score += value;
        }
      } catch (error) {
        if (this.debug) {
          console.error("[SelectorRanking] Plugin failed:", error);
        }
      }
    }

    return score;
  }

  //============================================================
  // EXPLAIN RANKING
  //============================================================

  explainRanking(candidates = [], context = {}) {
    const ranked = this.rank(candidates, context);

    return ranked.map((candidate) => ({
      action: candidate.action || candidate.type || null,

      score: candidate._score,

      label: candidate.label || candidate.text || candidate.name || "",

      ranking: candidate._ranking || {},
    }));
  }

  //============================================================
  // REMOVE INTERNAL RANKING DATA
  //============================================================

  clean(candidates = []) {
    if (!Array.isArray(candidates)) {
      return [];
    }

    return candidates.map((candidate) => {
      const { _score, _ranking, _originalIndex, ...cleanCandidate } = candidate;

      return cleanCandidate;
    });
  }

  //============================================================
  // STATISTICS
  //============================================================

  getStatistics() {
    return {
      ...this.stats,

      intentPatterns: this.intentPatterns.length,

      plugins: this.plugins.length,
    };
  }

  //============================================================
  // RESET STATISTICS
  //============================================================

  resetStatistics() {
    this.stats = {
      ranked: 0,

      candidates: 0,

      errors: 0,
    };
  }
}

//==============================================================
// DEFAULT INSTANCE
//==============================================================

const selectorRanking = new SelectorRanking();

export default selectorRanking;

export {
  SelectorRanking,
  ACTION_PRIORITY_MAP,
  ACTION_TARGET_MAP,
  DEFAULT_INTENT_PATTERNS,
  DEFAULT_OPTIONS,
};
