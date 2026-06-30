// planner/target-parser.js

/**
 * Ultra-fast Intent & Target Parser
 * - No dependencies
 * - Regex-first classification
 * - Cached parsing for repeated inputs
 * - Designed for planner pipeline systems
 */

class TargetParser {
  constructor(options = {}) {
    this.cache = new Map();
    this.maxCacheSize = options.maxCacheSize || 500;

    this.rules = [
      // Navigation / browser control
      { type: "NAVIGATE", test: /^go\s+to\s+|^open\s+/i },

      // Search intent
      { type: "SEARCH", test: /^search\s+for\s+|^find\s+/i },

      // Action execution
      { type: "ACTION", test: /^run\s+|^execute\s+|^start\s+/i },

      // File/system operations
      { type: "FILE", test: /^read\s+file|^open\s+file|^delete\s+file/i },

      // Planner-specific commands
      { type: "PLAN", test: /^plan\s+|^schedule\s+|^create\s+task/i },

      // Browser control signals
      { type: "BROWSER_CONTROL", test: /browser\s+|tab\s+|window\s+/i },

      // Self-healing / debugging
      { type: "HEAL", test: /fix\s+|repair\s+|self[-\s]?heal/i },
    ];
  }

  /**
   * Main entry point
   */
  parse(input = "") {
    if (!input || typeof input !== "string") {
      return this._result("UNKNOWN", input);
    }

    const normalized = input.trim();

    // Cache hit
    if (this.cache.has(normalized)) {
      return this.cache.get(normalized);
    }

    const result = this._analyze(normalized);

    this._cache(result.key, result);

    return result;
  }

  /**
   * Core analysis engine
   */
  _analyze(text) {
    const lower = text.toLowerCase();

    let detected = {
      type: "UNKNOWN",
      confidence: 0,
      raw: text,
      tokens: this._tokenize(text),
    };

    for (const rule of this.rules) {
      if (rule.test.test(lower)) {
        detected.type = rule.type;
        detected.confidence = 0.85;
        break;
      }
    }

    // fallback heuristics
    if (detected.type === "UNKNOWN") {
      detected.type = this._heuristicType(lower);
      detected.confidence = 0.5;
    }

    detected.intent = this._extractIntent(text, detected.type);
    detected.key = `${detected.type}:${detected.intent}`;

    return detected;
  }

  /**
   * Lightweight tokenization
   */
  _tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/gi, " ")
      .split(/\s+/)
      .filter(Boolean);
  }

  /**
   * Heuristic fallback classification
   */
  _heuristicType(text) {
    if (text.includes("?")) return "QUERY";
    if (text.includes("http") || text.includes("www")) return "URL";
    if (text.length < 10) return "SHORT_COMMAND";
    return "GENERAL";
  }

  /**
   * Extract simplified intent phrase
   */
  _extractIntent(text, type) {
    switch (type) {
      case "NAVIGATE":
        return text.replace(/^go to\s+|^open\s+/i, "");

      case "SEARCH":
        return text.replace(/^search for\s+|^find\s+/i, "");

      case "ACTION":
        return text.replace(/^run\s+|^execute\s+|^start\s+/i, "");

      case "PLAN":
        return text.replace(/^plan\s+|^schedule\s+|^create task\s+/i, "");

      default:
        return text;
    }
  }

  /**
   * Cache management (LRU-lite)
   */
  _cache(key, value) {
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  /**
   * Result factory
   */
  _result(type, raw) {
    return {
      type,
      confidence: 0,
      raw,
      tokens: [],
      intent: raw,
      key: `${type}:${raw}`,
    };
  }

  /**
   * Debug helper
   */
  explain(input) {
    const result = this.parse(input);

    return {
      input,
      classification: result.type,
      confidence: result.confidence,
      intent: result.intent,
      tokens: result.tokens,
    };
  }
}

export default TargetParser;
