// backend/planner/target-parser.js

/**
 * ==========================================================
 *
 * backend/planner/target-parser.js
 *
 * Ultra-fast Target & Intent Classification Engine
 * for Jarvis Browser AI
 *
 * ==========================================================
 *
 * PIPELINE
 *
 * User Input
 *      │
 *      ▼
 * Normalizer
 *      │
 *      ▼
 * IntentParser
 *      │
 *      ▼
 * ActionParser
 *      │
 *      ▼
 * TargetParser
 *      │
 *      ├── NAVIGATE
 *      ├── SEARCH
 *      ├── ACTION
 *      ├── FILE
 *      ├── PLAN
 *      ├── BROWSER_CONTROL
 *      ├── HEAL
 *      ├── URL
 *      ├── QUERY
 *      ├── SHORT_COMMAND
 *      ├── GENERAL
 *      └── UNKNOWN
 *      │
 *      ▼
 * EntityParser
 *      │
 *      ▼
 * ScoringEngine
 *      │
 *      ├── Exact Matching
 *      ├── Token Matching
 *      ├── Fuzzy Matching
 *      ├── Semantic Matching
 *      └── Candidate Ranking
 *      │
 *      ▼
 * Planner / LLM
 *      │
 *      ▼
 * Resolver
 *
 * ==========================================================
 *
 * RESPONSIBILITIES
 * ==========================================================
 *
 * ✔ Classify target / intent categories
 * ✔ Extract target text
 * ✔ Detect URLs
 * ✔ Detect browser controls
 * ✔ Detect files
 * ✔ Detect planner commands
 * ✔ Detect self-healing commands
 * ✔ Detect explicit UI actions
 * ✔ Lightweight tokenization
 * ✔ Cache repeated requests
 * ✔ Return confidence metadata
 * ✔ Preserve raw input
 * ✔ Generate stable classification keys
 *
 * IMPORTANT
 * ==========================================================
 *
 * ❌ NO fuzzy matching
 * ❌ NO spelling correction
 * ❌ NO DOM lookup
 * ❌ NO selector resolution
 * ❌ NO target guessing
 * ❌ NO LLM calls
 *
 * Fuzzy matching and spelling correction belong ONLY
 * to ScoringEngine.
 *
 * TargetParser only determines:
 *
 *     "What kind of target/request is this?"
 *
 * It does NOT determine:
 *
 *     "Which DOM element is the user referring to?"
 *
 * That responsibility belongs to:
 *
 *     ScoringEngine → Resolver
 *
 * ==========================================================
 */

//==========================================================
// DEFAULT OPTIONS
//==========================================================

const DEFAULT_OPTIONS = {
  maxCacheSize: 500,

  confidenceThreshold: 0.75,

  debug: false,

  enableHeuristics: true,

  enableActionDetection: true,

  enableBrowserDetection: true,

  enableFileDetection: true,

  enablePlannerDetection: true,

  enableHealingDetection: true,

  freezeResults: false,
};

//==========================================================
// TARGET TYPES
//==========================================================

const TARGET_TYPES = Object.freeze({
  NAVIGATE: "NAVIGATE",

  SEARCH: "SEARCH",

  ACTION: "ACTION",

  FILE: "FILE",

  PLAN: "PLAN",

  BROWSER_CONTROL: "BROWSER_CONTROL",

  HEAL: "HEAL",

  URL: "URL",

  QUERY: "QUERY",

  SHORT_COMMAND: "SHORT_COMMAND",

  GENERAL: "GENERAL",

  UNKNOWN: "UNKNOWN",
});

//==========================================================
// ACTION KEYWORDS
//
// These are explicit action indicators.
//
// IMPORTANT:
// This list does NOT resolve the target.
//
// Example:
//
// "click Punh In"
//
// TargetParser:
//   type = ACTION
//   target = "Punh In"
//
// ScoringEngine:
//   resolves "Punh In" → "Punch In"
//==========================================================

const ACTION_KEYWORDS = [
  "click",
  "tap",
  "hit",
  "press",
  "choose",
  "select",
  "type",
  "enter",
  "fill",
  "write",
  "input",
  "insert",
  "check",
  "tick",
  "enable",
  "uncheck",
  "untick",
  "disable",
  "hover",
  "move",
  "scroll",
  "swipe",
  "upload",
  "attach",
  "browse",
  "download",
  "save",
  "wait",
  "pause",
  "sleep",
  "delay",
  "reload",
  "refresh",
  "screenshot",
  "capture",
];

//==========================================================
// TARGET PARSER
//==========================================================

class TargetParser {
  constructor(options = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    //------------------------------------------------------
    // Cache
    //------------------------------------------------------

    this.cache = new Map();

    //------------------------------------------------------
    // Rules
    //------------------------------------------------------

    this.rules = this._createDefaultRules();

    //------------------------------------------------------
    // URL REGEX
    //------------------------------------------------------

    this.urlRegex = /^(?:https?:\/\/|www\.)[^\s]+$/i;

    //------------------------------------------------------
    // Domain-only URL
    //------------------------------------------------------

    this.domainRegex = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?$/i;

    //------------------------------------------------------
    // Slash command
    //------------------------------------------------------

    this.commandRegex = /^\/[a-zA-Z0-9_-]+(?:\s+.*)?$/;

    //------------------------------------------------------
    // Query
    //------------------------------------------------------

    this.queryRegex = /[?]$/;

    //------------------------------------------------------
    // File path
    //------------------------------------------------------

    this.filePathRegex = /^(?:[a-zA-Z]:[\\/]|\/|~\/)[^\s]+$/;

    //------------------------------------------------------
    // Browser control keywords
    //------------------------------------------------------

    this.browserControlRegex =
      /\b(?:browser|tab|tabs|window|windows|back|forward|refresh|reload|close|new\s+tab|new\s+window)\b/i;

    //------------------------------------------------------
    // Build rule map
    //------------------------------------------------------

    this.ruleMap = new Map();

    for (const rule of this.rules) {
      this.ruleMap.set(rule.type, rule);
    }
  }

  //========================================================
  // DEFAULT RULES
  //========================================================

  _createDefaultRules() {
    return [
      //----------------------------------------------------
      // NAVIGATION
      //----------------------------------------------------

      {
        type: TARGET_TYPES.NAVIGATE,

        test: /^(?:go\s+to|goto|navigate\s+to|open|visit|launch)\s+/i,

        confidence: 0.95,

        source: "navigation_rule",
      },

      //----------------------------------------------------
      // SEARCH
      //----------------------------------------------------

      {
        type: TARGET_TYPES.SEARCH,

        test: /^(?:search\s+for|search|find|look\s+up|lookup|google)\s+/i,

        confidence: 0.95,

        source: "search_rule",
      },

      //----------------------------------------------------
      // ACTION
      //
      // Explicit UI/browser operation.
      //----------------------------------------------------

      {
        type: TARGET_TYPES.ACTION,

        test: /^(?:click|tap|hit|press|choose|select|type|enter|fill|write|input|insert|check|tick|enable|uncheck|untick|disable|hover|move|scroll|swipe|upload|attach|browse|download|save|wait|pause|sleep|delay|screenshot|capture)\b/i,

        confidence: 0.96,

        source: "action_rule",
      },

      //----------------------------------------------------
      // FILE
      //----------------------------------------------------

      {
        type: TARGET_TYPES.FILE,

        test: /^(?:read|open|delete|remove|create|copy|move|rename|write|save)\s+(?:the\s+)?(?:file|folder|directory)\b/i,

        confidence: 0.95,

        source: "file_rule",
      },

      //----------------------------------------------------
      // PLANNER
      //----------------------------------------------------

      {
        type: TARGET_TYPES.PLAN,

        test: /^(?:plan|schedule|create\s+(?:a\s+)?task|add\s+(?:a\s+)?task|remind\s+me|set\s+(?:a\s+)?reminder)\b/i,

        confidence: 0.95,

        source: "planner_rule",
      },

      //----------------------------------------------------
      // SELF HEALING / DEBUGGING
      //----------------------------------------------------

      {
        type: TARGET_TYPES.HEAL,

        test: /\b(?:fix|repair|recover|retry|self[-\s]?heal|heal|debug|resolve\s+error|fix\s+error|try\s+again)\b/i,

        confidence: 0.92,

        source: "healing_rule",
      },

      //----------------------------------------------------
      // BROWSER CONTROL
      //----------------------------------------------------

      {
        type: TARGET_TYPES.BROWSER_CONTROL,

        test: /^(?:go\s+)?(?:back|forward|reload|refresh|close|open\s+new\s+tab|new\s+tab|new\s+window)\b/i,

        confidence: 0.96,

        source: "browser_control_rule",
      },
    ];
  }

  //========================================================
  // PUBLIC PARSE
  //========================================================

  parse(input = "") {
    //------------------------------------------------------
    // Invalid input
    //------------------------------------------------------

    if (input === null || input === undefined || typeof input !== "string") {
      return this._result(TARGET_TYPES.UNKNOWN, input);
    }

    //------------------------------------------------------
    // Normalize
    //------------------------------------------------------

    const normalized = this._normalize(input);

    if (!normalized) {
      return this._result(TARGET_TYPES.UNKNOWN, "");
    }

    //------------------------------------------------------
    // Cache
    //------------------------------------------------------

    const cached = this.cache.get(normalized);

    if (cached) {
      //----------------------------------------------------
      // Refresh LRU position
      //----------------------------------------------------

      this.cache.delete(normalized);

      this.cache.set(normalized, cached);

      return cached;
    }

    //------------------------------------------------------
    // Analyze
    //------------------------------------------------------

    const result = this._analyze(normalized);

    //------------------------------------------------------
    // Cache
    //------------------------------------------------------

    this._cache(normalized, result);

    //------------------------------------------------------
    // Debug
    //------------------------------------------------------

    this._log("Parsed target:", result);

    return result;
  }

  //========================================================
  // NORMALIZATION
  //========================================================

  _normalize(input) {
    return String(input).normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  //========================================================
  // CORE ANALYSIS
  //========================================================

  _analyze(text) {
    const lower = text.toLowerCase();

    //------------------------------------------------------
    // Base result
    //------------------------------------------------------

    const detected = {
      type: TARGET_TYPES.UNKNOWN,

      targetType: TARGET_TYPES.UNKNOWN,

      action: null,

      confidence: 0,

      raw: text,

      normalized: text,

      target: "",

      intent: "",

      tokens: this._tokenize(text),

      source: "unknown",

      metadata: {},
    };

    //------------------------------------------------------
    // 1. DIRECT URL
    //------------------------------------------------------

    if (this._isUrl(text)) {
      return this._finalize(detected, {
        type: TARGET_TYPES.URL,

        targetType: TARGET_TYPES.URL,

        confidence: 1,

        target: text,

        intent: text,

        source: "url",

        action: "navigate",

        metadata: {
          direct: true,
        },
      });
    }

    //------------------------------------------------------
    // 2. DOMAIN-ONLY URL
    //------------------------------------------------------

    if (this._isDomain(text)) {
      return this._finalize(detected, {
        type: TARGET_TYPES.URL,

        targetType: TARGET_TYPES.URL,

        confidence: 0.98,

        target: text,

        intent: text,

        source: "domain",

        action: "navigate",

        metadata: {
          direct: true,

          normalizedUrl: this._normalizeUrl(text),
        },
      });
    }

    //------------------------------------------------------
    // 3. SLASH COMMAND
    //------------------------------------------------------

    if (this._isCommand(text)) {
      const command = this._extractCommand(text);

      return this._finalize(detected, {
        type: TARGET_TYPES.ACTION,

        targetType: TARGET_TYPES.ACTION,

        confidence: 0.95,

        target: text,

        intent: command,

        source: "command",

        action: command,
      });
    }

    //------------------------------------------------------
    // 4. FILE PATH
    //------------------------------------------------------

    if (this.options.enableFileDetection && this._isFilePath(text)) {
      return this._finalize(detected, {
        type: TARGET_TYPES.FILE,

        targetType: TARGET_TYPES.FILE,

        confidence: 0.98,

        target: text,

        intent: text,

        source: "file_path",

        action: "file",
      });
    }

    //------------------------------------------------------
    // 5. RULE MATCHING
    //------------------------------------------------------

    for (const rule of this.rules) {
      if (!rule) {
        continue;
      }

      if (
        rule.type === TARGET_TYPES.ACTION &&
        !this.options.enableActionDetection
      ) {
        continue;
      }

      if (
        rule.type === TARGET_TYPES.BROWSER_CONTROL &&
        !this.options.enableBrowserDetection
      ) {
        continue;
      }

      if (
        rule.type === TARGET_TYPES.FILE &&
        !this.options.enableFileDetection
      ) {
        continue;
      }

      if (
        rule.type === TARGET_TYPES.PLAN &&
        !this.options.enablePlannerDetection
      ) {
        continue;
      }

      if (
        rule.type === TARGET_TYPES.HEAL &&
        !this.options.enableHealingDetection
      ) {
        continue;
      }

      //----------------------------------------------------
      // Reset regex state
      //----------------------------------------------------

      if (rule.test instanceof RegExp) {
        rule.test.lastIndex = 0;
      }

      if (rule.test instanceof RegExp && rule.test.test(text)) {
        const target = this._extractTarget(text, rule.type);

        const action = this._inferAction(text, rule.type);

        return this._finalize(detected, {
          type: rule.type,

          targetType: rule.type,

          confidence: rule.confidence ?? 0.85,

          target,

          intent: this._extractIntent(text, rule.type),

          source: rule.source || "rule",

          action,

          metadata: {
            rule: rule.type,
          },
        });
      }
    }

    //------------------------------------------------------
    // 6. BROWSER CONTROL FALLBACK
    //------------------------------------------------------

    if (
      this.options.enableBrowserDetection &&
      this.browserControlRegex.test(text)
    ) {
      return this._finalize(detected, {
        type: TARGET_TYPES.BROWSER_CONTROL,

        targetType: TARGET_TYPES.BROWSER_CONTROL,

        confidence: 0.85,

        target: text,

        intent: text,

        source: "browser_heuristic",

        action: this._inferBrowserAction(lower),
      });
    }

    //------------------------------------------------------
    // 7. HEURISTIC FALLBACK
    //------------------------------------------------------

    if (this.options.enableHeuristics) {
      const heuristic = this._heuristicType(lower);

      if (heuristic) {
        return this._finalize(detected, {
          type: heuristic.type,

          targetType: heuristic.type,

          confidence: heuristic.confidence,

          target: text,

          intent: text,

          source: "heuristic",

          action: heuristic.action || null,

          metadata: heuristic.metadata || {},
        });
      }
    }

    //------------------------------------------------------
    // 8. GENERAL FALLBACK
    //------------------------------------------------------

    return this._finalize(detected, {
      type: TARGET_TYPES.GENERAL,

      targetType: TARGET_TYPES.GENERAL,

      confidence: 0.3,

      target: text,

      intent: text,

      source: "fallback",

      action: null,
    });
  }

  //========================================================
  // FINALIZE RESULT
  //========================================================

  _finalize(base, data) {
    const result = {
      ...base,

      ...data,
    };

    result.key = this._createKey(result.type, result.intent);

    //------------------------------------------------------
    // Confidence normalization
    //------------------------------------------------------

    result.confidence = this._normalizeConfidence(result.confidence);

    //------------------------------------------------------
    // High confidence flag
    //------------------------------------------------------

    result.highConfidence =
      result.confidence >= this.options.confidenceThreshold;

    //------------------------------------------------------
    // Target fallback
    //------------------------------------------------------

    if (!result.target) {
      result.target = result.normalized;
    }

    //------------------------------------------------------
    // Intent fallback
    //------------------------------------------------------

    if (!result.intent) {
      result.intent = result.target || result.normalized;
    }

    //------------------------------------------------------
    // Optional freezing
    //------------------------------------------------------

    if (this.options.freezeResults) {
      return Object.freeze(result);
    }

    return result;
  }

  //========================================================
  // TARGET EXTRACTION
  //========================================================

  _extractTarget(text, type) {
    if (!text) {
      return "";
    }

    let target = text;

    switch (type) {
      //----------------------------------------------------
      // NAVIGATION
      //----------------------------------------------------

      case TARGET_TYPES.NAVIGATE:
        target = text.replace(
          /^(?:go\s+to|goto|navigate\s+to|open|visit|launch)\s+/i,
          "",
        );
        break;

      //----------------------------------------------------
      // SEARCH
      //----------------------------------------------------

      case TARGET_TYPES.SEARCH:
        target = text.replace(
          /^(?:search\s+for|search|find|look\s+up|lookup|google)\s+/i,
          "",
        );
        break;

      //----------------------------------------------------
      // ACTION
      //
      // Keep this deterministic.
      //
      // Do NOT fuzzy-match:
      //
      // click Punh In
      //
      // target remains:
      //
      // Punh In
      //
      // ScoringEngine handles correction.
      //----------------------------------------------------

      case TARGET_TYPES.ACTION:
        target = text.replace(
          /^(?:right\s+click|double\s+click|click|tap|hit|press|choose|select|type|enter|fill|write|input|insert|check|tick|enable|uncheck|untick|disable|hover|move|scroll|swipe|upload|attach|browse|download|save|wait|pause|sleep|delay|screenshot|capture)\s*/i,
          "",
        );
        break;

      //----------------------------------------------------
      // FILE
      //----------------------------------------------------

      case TARGET_TYPES.FILE:
        target = text.replace(
          /^(?:read|open|delete|remove|create|copy|move|rename|write|save)\s+(?:the\s+)?(?:file|folder|directory)\s*/i,
          "",
        );
        break;

      //----------------------------------------------------
      // PLAN
      //----------------------------------------------------

      case TARGET_TYPES.PLAN:
        target = text.replace(
          /^(?:plan|schedule|create\s+(?:a\s+)?task|add\s+(?:a\s+)?task|remind\s+me|set\s+(?:a\s+)?reminder)\s*/i,
          "",
        );
        break;

      //----------------------------------------------------
      // BROWSER CONTROL
      //----------------------------------------------------

      case TARGET_TYPES.BROWSER_CONTROL:
        target = text.replace(
          /^(?:go\s+)?(?:back|forward|reload|refresh|close)\s*/i,
          "",
        );
        break;

      //----------------------------------------------------
      // HEAL
      //----------------------------------------------------

      case TARGET_TYPES.HEAL:
        target = text.replace(
          /^(?:fix|repair|recover|retry|heal|debug)\s*/i,
          "",
        );
        break;

      default:
        target = text;
    }

    return this._cleanTarget(target);
  }

  //========================================================
  // INTENT EXTRACTION
  //========================================================

  _extractIntent(text, type) {
    const target = this._extractTarget(text, type);

    return target || text;
  }

  //========================================================
  // ACTION INFERENCE
  //========================================================

  _inferAction(text, type) {
    const lower = text.toLowerCase();

    switch (type) {
      case TARGET_TYPES.NAVIGATE:
        return "navigate";

      case TARGET_TYPES.SEARCH:
        return "search";

      case TARGET_TYPES.FILE:
        return "file";

      case TARGET_TYPES.PLAN:
        return "plan";

      case TARGET_TYPES.HEAL:
        return "heal";

      case TARGET_TYPES.BROWSER_CONTROL:
        return this._inferBrowserAction(lower);

      case TARGET_TYPES.ACTION:
        return this._extractActionKeyword(lower) || "action";

      default:
        return null;
    }
  }

  //========================================================
  // ACTION KEYWORD EXTRACTION
  //========================================================

  _extractActionKeyword(text) {
    if (!text) {
      return "";
    }

    const match = text.match(
      /^(?:right\s+click|double\s+click|click|tap|hit|press|choose|select|type|enter|fill|write|input|insert|check|tick|enable|uncheck|untick|disable|hover|move|scroll|swipe|upload|attach|browse|download|save|wait|pause|sleep|delay|screenshot|capture)\b/i,
    );

    return match ? match[0].toLowerCase().trim() : "";
  }

  //========================================================
  // BROWSER ACTION INFERENCE
  //========================================================

  _inferBrowserAction(text) {
    if (!text) {
      return "browser_control";
    }

    if (/\bback\b/.test(text)) {
      return "back";
    }

    if (/\bforward\b/.test(text)) {
      return "forward";
    }

    if (/\brefresh\b|\breload\b/.test(text)) {
      return "reload";
    }

    if (/\bclose\b/.test(text)) {
      return "close";
    }

    if (/\bnew\s+tab\b/.test(text)) {
      return "new_tab";
    }

    if (/\bnew\s+window\b/.test(text)) {
      return "new_window";
    }

    return "browser_control";
  }

  //========================================================
  // CLEAN TARGET
  //========================================================

  _cleanTarget(target) {
    if (!target) {
      return "";
    }

    return String(target)
      .replace(/^[,:;.\-]+/, "")
      .replace(/[,:;.\-]+$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  //========================================================
  // TOKENIZATION
  //========================================================

  _tokenize(text) {
    if (!text) {
      return [];
    }

    return text
      .toLowerCase()
      .replace(/[^a-zA-Z0-9_\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  }

  //========================================================
  // URL DETECTION
  //========================================================

  _isUrl(text) {
    if (!text) {
      return false;
    }

    return this.urlRegex.test(text.trim());
  }

  //========================================================
  // DOMAIN DETECTION
  //========================================================

  _isDomain(text) {
    if (!text) {
      return false;
    }

    return this.domainRegex.test(text.trim());
  }

  //========================================================
  // URL NORMALIZATION
  //========================================================

  _normalizeUrl(text) {
    if (!text) {
      return "";
    }

    if (/^https?:\/\//i.test(text)) {
      return text;
    }

    if (/^www\./i.test(text)) {
      return `https://${text}`;
    }

    if (this._isDomain(text)) {
      return `https://${text}`;
    }

    return text;
  }

  //========================================================
  // COMMAND DETECTION
  //========================================================

  _isCommand(text) {
    if (!text) {
      return false;
    }

    return this.commandRegex.test(text.trim());
  }

  //========================================================
  // COMMAND EXTRACTION
  //========================================================

  _extractCommand(text) {
    const match = text.match(/^\/[a-zA-Z0-9_-]+/);

    return match ? match[0] : "";
  }

  //========================================================
  // FILE PATH DETECTION
  //========================================================

  _isFilePath(text) {
    if (!text) {
      return false;
    }

    return this.filePathRegex.test(text.trim());
  }

  //========================================================
  // HEURISTIC CLASSIFICATION
  //========================================================

  _heuristicType(text) {
    //------------------------------------------------------
    // Query
    //------------------------------------------------------

    if (this.queryRegex.test(text)) {
      return {
        type: TARGET_TYPES.QUERY,

        confidence: 0.7,

        action: "query",
      };
    }

    //------------------------------------------------------
    // URL inside sentence
    //------------------------------------------------------

    if (/\bhttps?:\/\//i.test(text) || /\bwww\./i.test(text)) {
      return {
        type: TARGET_TYPES.URL,

        confidence: 0.8,

        action: "navigate",

        metadata: {
          embeddedUrl: true,
        },
      };
    }

    //------------------------------------------------------
    // Explicit short command
    //------------------------------------------------------

    if (text.length < 10 && text.split(/\s+/).length <= 3) {
      return {
        type: TARGET_TYPES.SHORT_COMMAND,

        confidence: 0.45,

        action: null,
      };
    }

    //------------------------------------------------------
    // Action keyword
    //------------------------------------------------------

    if (
      this.options.enableActionDetection &&
      ACTION_KEYWORDS.some((keyword) =>
        new RegExp(`^${keyword}\\b`, "i").test(text),
      )
    ) {
      return {
        type: TARGET_TYPES.ACTION,

        confidence: 0.8,

        action: this._extractActionKeyword(text),
      };
    }

    //------------------------------------------------------
    // No heuristic
    //------------------------------------------------------

    return null;
  }

  //========================================================
  // CACHE
  //========================================================

  _cache(key, value) {
    //------------------------------------------------------
    // Remove existing key
    //------------------------------------------------------

    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    //------------------------------------------------------
    // Remove oldest item
    //------------------------------------------------------

    while (this.cache.size >= this.options.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;

      if (firstKey === undefined) {
        break;
      }

      this.cache.delete(firstKey);
    }

    //------------------------------------------------------
    // Store
    //------------------------------------------------------

    this.cache.set(key, value);
  }

  //========================================================
  // CLEAR CACHE
  //========================================================

  clearCache() {
    this.cache.clear();

    return true;
  }

  //========================================================
  // CACHE SIZE
  //========================================================

  getCacheSize() {
    return this.cache.size;
  }

  //========================================================
  // KEY GENERATOR
  //========================================================

  _createKey(type, intent) {
    return `${type}:${String(intent || "").toLowerCase()}`;
  }

  //========================================================
  // RESULT FACTORY
  //========================================================

  _result(type, raw) {
    const normalized = typeof raw === "string" ? this._normalize(raw) : "";

    const result = {
      type,

      targetType: type,

      action: null,

      confidence: 0,

      highConfidence: false,

      raw,

      normalized,

      target: normalized,

      tokens: normalized ? this._tokenize(normalized) : [],

      intent: normalized,

      source: "invalid",

      metadata: {},

      key: this._createKey(type, normalized),
    };

    return result;
  }

  //========================================================
  // CONFIDENCE NORMALIZATION
  //========================================================

  _normalizeConfidence(value) {
    const number = Number(value);

    if (Number.isNaN(number)) {
      return 0;
    }

    return Math.max(0, Math.min(1, number));
  }

  //========================================================
  // EXPLAIN
  //========================================================

  explain(input) {
    const result = this.parse(input);

    return {
      input,

      classification: result.type,

      targetType: result.targetType,

      action: result.action,

      confidence: result.confidence,

      highConfidence: result.highConfidence,

      target: result.target,

      intent: result.intent,

      tokens: result.tokens,

      source: result.source,

      metadata: result.metadata,

      key: result.key,
    };
  }

  //========================================================
  // IS TARGET TYPE
  //========================================================

  isType(input, type) {
    const result = this.parse(input);

    return result.type === type;
  }

  //========================================================
  // GET TARGET TYPES
  //========================================================

  getTargetTypes() {
    return {
      ...TARGET_TYPES,
    };
  }

  //========================================================
  // ADD RULE
  //========================================================

  addRule(rule) {
    if (!rule || typeof rule !== "object") {
      throw new TypeError("TargetParser.addRule requires a rule object.");
    }

    if (!rule.type || !(rule.test instanceof RegExp)) {
      throw new TypeError("TargetParser rule requires type and RegExp test.");
    }

    this.rules.push(rule);

    this.ruleMap.set(rule.type, rule);

    this.clearCache();

    return true;
  }

  //========================================================
  // REMOVE RULE
  //========================================================

  removeRule(type) {
    const before = this.rules.length;

    this.rules = this.rules.filter((rule) => rule.type !== type);

    this.ruleMap.delete(type);

    this.clearCache();

    return before !== this.rules.length;
  }

  //========================================================
  // CLEAR RULES
  //========================================================

  clearRules() {
    this.rules = [];

    this.ruleMap.clear();

    this.clearCache();

    return true;
  }

  //========================================================
  // STATS
  //========================================================

  stats() {
    return {
      cacheSize: this.cache.size,

      maxCacheSize: this.options.maxCacheSize,

      ruleCount: this.rules.length,

      heuristics: this.options.enableHeuristics,

      actionDetection: this.options.enableActionDetection,

      browserDetection: this.options.enableBrowserDetection,

      fileDetection: this.options.enableFileDetection,

      plannerDetection: this.options.enablePlannerDetection,

      healingDetection: this.options.enableHealingDetection,

      confidenceThreshold: this.options.confidenceThreshold,

      fuzzyMatching: false,

      spellingCorrection: false,

      domLookup: false,

      selectorResolution: false,

      llm: false,

      supportedTypes: Object.values(TARGET_TYPES),
    };
  }

  //========================================================
  // SERIALIZATION
  //========================================================

  toJSON() {
    return {
      options: {
        ...this.options,
      },

      rules: this.rules.map((rule) => ({
        type: rule.type,

        confidence: rule.confidence,

        source: rule.source,
      })),

      stats: this.stats(),
    };
  }

  //========================================================
  // DEBUG LOGGER
  //========================================================

  _log(...args) {
    if (!this.options.debug) {
      return;
    }

    console.log("[TargetParser]", ...args);
  }
}

//==========================================================
// EXPORT
//==========================================================

export default TargetParser;
