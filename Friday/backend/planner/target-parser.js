// backend/planner/target-parser.js

/**
 * ==========================================================
 *
 * backend/planner/target-parser.js
 *
 * Ultra-fast Target & Intent Classification Engine
 *
 * Responsibilities
 * ----------------------------------------------------------
 * ✔ Classify target / intent categories
 * ✔ Extract target text
 * ✔ Detect URLs
 * ✔ Detect browser controls
 * ✔ Detect files
 * ✔ Detect planner commands
 * ✔ Detect self-healing commands
 * ✔ Lightweight tokenization
 * ✔ Cache repeated requests
 * ✔ Return confidence metadata
 *
 * IMPORTANT
 * ----------------------------------------------------------
 * ❌ No fuzzy matching
 * ❌ No spelling correction
 * ❌ No DOM lookup
 * ❌ No selector resolution
 * ❌ No target guessing
 *
 * Fuzzy matching belongs ONLY to ScoringEngine.
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
};

//==========================================================
// TARGET TYPES
//==========================================================

const TARGET_TYPES = {
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
};

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

    this.rules = [
      //----------------------------------------------------
      // Navigation / browser navigation
      //----------------------------------------------------

      {
        type: TARGET_TYPES.NAVIGATE,

        test: /^(go\s+to|goto|navigate\s+to|open|visit|launch)\s+/i,

        confidence: 0.95,
      },

      //----------------------------------------------------
      // Search
      //----------------------------------------------------

      {
        type: TARGET_TYPES.SEARCH,

        test: /^(search\s+for|search|find|look\s+up|lookup|google)\s+/i,

        confidence: 0.95,
      },

      //----------------------------------------------------
      // Action execution
      //----------------------------------------------------

      {
        type: TARGET_TYPES.ACTION,

        test: /^(run|execute|start|perform)\s+/i,

        confidence: 0.9,
      },

      //----------------------------------------------------
      // File / system operations
      //----------------------------------------------------

      {
        type: TARGET_TYPES.FILE,

        test: /^(read|open|delete|remove|create|copy|move|rename)\s+(the\s+)?file\b/i,

        confidence: 0.95,
      },

      //----------------------------------------------------
      // Planner commands
      //----------------------------------------------------

      {
        type: TARGET_TYPES.PLAN,

        test: /^(plan|schedule|create\s+(a\s+)?task|add\s+(a\s+)?task)\s+/i,

        confidence: 0.95,
      },

      //----------------------------------------------------
      // Browser controls
      //----------------------------------------------------

      {
        type: TARGET_TYPES.BROWSER_CONTROL,

        test: /\b(browser|tab|tabs|window|windows|back|forward|refresh|reload)\b/i,

        confidence: 0.85,
      },

      //----------------------------------------------------
      // Self healing / debugging
      //----------------------------------------------------

      {
        type: TARGET_TYPES.HEAL,

        test: /\b(fix|repair|recover|retry|self[-\s]?heal|heal|debug)\b/i,

        confidence: 0.9,
      },
    ];

    //------------------------------------------------------
    // URL regex
    //------------------------------------------------------

    this.urlRegex = /^(https?:\/\/|www\.)[^\s]+$/i;

    //------------------------------------------------------
    // Command regex
    //------------------------------------------------------

    this.commandRegex = /^\/[a-zA-Z0-9_-]+/;

    //------------------------------------------------------
    // Query regex
    //------------------------------------------------------

    this.queryRegex = /\?$/;

    //------------------------------------------------------
    // Initialize rule map
    //------------------------------------------------------

    this.ruleMap = new Map();

    for (const rule of this.rules) {
      this.ruleMap.set(rule.type, rule);
    }
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
    // Cache hit
    //------------------------------------------------------

    const cached = this.cache.get(normalized);

    if (cached) {
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

      confidence: 0,

      raw: text,

      normalized: text,

      target: "",

      intent: "",

      tokens: this._tokenize(text),

      source: "unknown",
    };

    //------------------------------------------------------
    // Direct URL
    //------------------------------------------------------

    if (this._isUrl(text)) {
      detected.type = TARGET_TYPES.URL;

      detected.confidence = 1;

      detected.target = text;

      detected.intent = text;

      detected.source = "url";

      detected.key = this._createKey(detected.type, detected.intent);

      return detected;
    }

    //------------------------------------------------------
    // Slash command
    //------------------------------------------------------

    if (this._isCommand(text)) {
      detected.type = TARGET_TYPES.ACTION;

      detected.confidence = 0.95;

      detected.target = text;

      detected.intent = this._extractCommand(text);

      detected.source = "command";

      detected.key = this._createKey(detected.type, detected.intent);

      return detected;
    }

    //------------------------------------------------------
    // Rule matching
    //------------------------------------------------------

    for (const rule of this.rules) {
      if (rule.test.test(text)) {
        detected.type = rule.type;

        detected.confidence = rule.confidence ?? 0.85;

        detected.target = this._extractTarget(text, rule.type);

        detected.intent = this._extractIntent(text, rule.type);

        detected.source = "rule";

        detected.key = this._createKey(detected.type, detected.intent);

        return detected;
      }
    }

    //------------------------------------------------------
    // Heuristic fallback
    //------------------------------------------------------

    if (this.options.enableHeuristics) {
      const heuristic = this._heuristicType(lower);

      if (heuristic) {
        detected.type = heuristic.type;

        detected.confidence = heuristic.confidence;

        detected.target = text;

        detected.intent = text;

        detected.source = "heuristic";

        detected.key = this._createKey(detected.type, detected.intent);

        return detected;
      }
    }

    //------------------------------------------------------
    // General fallback
    //------------------------------------------------------

    detected.type = TARGET_TYPES.GENERAL;

    detected.confidence = 0.3;

    detected.target = text;

    detected.intent = text;

    detected.source = "fallback";

    detected.key = this._createKey(detected.type, detected.intent);

    return detected;
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
      case TARGET_TYPES.NAVIGATE:
        target = text.replace(
          /^(go\s+to|goto|navigate\s+to|open|visit|launch)\s+/i,
          "",
        );
        break;

      case TARGET_TYPES.SEARCH:
        target = text.replace(
          /^(search\s+for|search|find|look\s+up|lookup|google)\s+/i,
          "",
        );
        break;

      case TARGET_TYPES.ACTION:
        target = text.replace(/^(run|execute|start|perform)\s+/i, "");
        break;

      case TARGET_TYPES.FILE:
        target = text.replace(
          /^(read|open|delete|remove|create|copy|move|rename)\s+(the\s+)?file\s*/i,
          "",
        );
        break;

      case TARGET_TYPES.PLAN:
        target = text.replace(
          /^(plan|schedule|create\s+(a\s+)?task|add\s+(a\s+)?task)\s*/i,
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
  // CLEAN TARGET
  //========================================================

  _cleanTarget(target) {
    if (!target) {
      return "";
    }

    return target
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
    const match = text.match(this.commandRegex);

    return match ? match[0] : "";
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
      };
    }

    //------------------------------------------------------
    // URL inside sentence
    //------------------------------------------------------

    if (
      text.includes("http://") ||
      text.includes("https://") ||
      text.includes("www.")
    ) {
      return {
        type: TARGET_TYPES.URL,
        confidence: 0.8,
      };
    }

    //------------------------------------------------------
    // Short command
    //------------------------------------------------------

    if (text.length < 10 && text.split(/\s+/).length <= 3) {
      return {
        type: TARGET_TYPES.SHORT_COMMAND,
        confidence: 0.45,
      };
    }

    //------------------------------------------------------
    // No confident heuristic
    //------------------------------------------------------

    return null;
  }

  //========================================================
  // CACHE
  //========================================================

  _cache(key, value) {
    //------------------------------------------------------
    // Remove oldest item
    //------------------------------------------------------

    if (this.cache.size >= this.options.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;

      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
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
    return `${type}:${intent}`;
  }

  //========================================================
  // RESULT FACTORY
  //========================================================

  _result(type, raw) {
    const normalized = typeof raw === "string" ? this._normalize(raw) : "";

    return {
      type,

      confidence: 0,

      raw,

      normalized,

      target: normalized,

      tokens: normalized ? this._tokenize(normalized) : [],

      intent: normalized,

      source: "invalid",

      key: this._createKey(type, normalized),
    };
  }

  //========================================================
  // EXPLAIN
  //========================================================

  explain(input) {
    const result = this.parse(input);

    return {
      input,

      classification: result.type,

      confidence: result.confidence,

      target: result.target,

      intent: result.intent,

      tokens: result.tokens,

      source: result.source,

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
  // STATS
  //========================================================

  stats() {
    return {
      cacheSize: this.cache.size,

      maxCacheSize: this.options.maxCacheSize,

      ruleCount: this.rules.length,

      heuristics: this.options.enableHeuristics,

      confidenceThreshold: this.options.confidenceThreshold,

      supportedTypes: Object.values(TARGET_TYPES),
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
