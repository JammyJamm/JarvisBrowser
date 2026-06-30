// action-parser.js
// Ultra-fast Intent & Action Parser for Jarvis Browser
//
// Features:
// ✅ Regex-first instant parsing (no LLM needed for common intents)
// ✅ Structured action output
// ✅ Multi-intent detection
// ✅ Fallback natural-language parsing
// ✅ Safe normalization
// ✅ Extensible intent registry

class ActionParser {
  constructor(options = {}) {
    this.debug = options.debug || false;

    // Core intent rules (FAST PATH)
    this.intentRules = [
      // Navigation
      {
        name: "navigate",
        patterns: [/^go to (.+)$/i, /^open (.+)$/i, /^visit (.+)$/i],
        build: (m) => ({ url: this.normalizeUrl(m[1]) }),
      },

      // Search
      {
        name: "search",
        patterns: [/^search for (.+)$/i, /^google (.+)$/i, /^find (.+)$/i],
        build: (m) => ({ query: m[1] }),
      },

      // Click element
      {
        name: "click",
        patterns: [/^click (.+)$/i, /^press (.+)$/i],
        build: (m) => ({ target: m[1] }),
      },

      // Type input
      {
        name: "type",
        patterns: [/^type (.+?) in (.+)$/i, /^enter (.+?) into (.+)$/i],
        build: (m) => ({ text: m[1], target: m[2] }),
      },

      // Scroll
      {
        name: "scroll",
        patterns: [/^scroll (up|down|top|bottom)(?: (\d+))?$/i],
        build: (m) => ({
          direction: m[1],
          amount: m[2] ? parseInt(m[2]) : 1,
        }),
      },

      // Wait
      {
        name: "wait",
        patterns: [/^wait (\d+)(s|ms)?$/i],
        build: (m) => ({
          duration: parseInt(m[1]),
          unit: m[2] || "s",
        }),
      },

      // Screenshot
      {
        name: "screenshot",
        patterns: [/^take screenshot$/i, /^capture screen$/i],
        build: () => ({}),
      },

      // Refresh
      {
        name: "refresh",
        patterns: [/^refresh$/i, /^reload page$/i],
        build: () => ({}),
      },
    ];
  }

  /**
   * Main entry
   */
  parse(input) {
    if (!input || typeof input !== "string") {
      return this._unknown(input);
    }

    const cleaned = this._clean(input);

    // FAST PATH: regex rules
    for (const rule of this.intentRules) {
      for (const pattern of rule.patterns) {
        const match = cleaned.match(pattern);
        if (match) {
          const action = {
            type: rule.name,
            payload: rule.build(match),
            raw: input,
            confidence: 0.95,
          };

          if (this.debug) {
            console.log("[ActionParser FAST]", action);
          }

          return action;
        }
      }
    }

    // MULTI-ACTION DETECTION
    if (cleaned.includes(" then ")) {
      return this._parseSequence(cleaned);
    }

    // FALLBACK
    return this._fallbackParse(cleaned, input);
  }

  /**
   * Parse chained actions
   */
  _parseSequence(text) {
    const parts = text.split(" then ").map((p) => p.trim());

    return {
      type: "sequence",
      actions: parts.map((p) => this.parse(p)),
      raw: text,
      confidence: 0.8,
    };
  }

  /**
   * Fallback parser (light NLP heuristic)
   */
  _fallbackParse(cleaned, raw) {
    // Heuristic detection
    let action = {
      type: "unknown",
      payload: {},
      raw,
      confidence: 0.4,
    };

    if (/http|www\.|\./i.test(cleaned)) {
      action.type = "navigate";
      action.payload.url = this.normalizeUrl(cleaned);
      action.confidence = 0.6;
    } else if (/search|look for|find/i.test(cleaned)) {
      action.type = "search";
      action.payload.query = cleaned;
      action.confidence = 0.5;
    } else if (/click|press/i.test(cleaned)) {
      action.type = "click";
      action.payload.target = cleaned.replace(/click|press/i, "").trim();
      action.confidence = 0.5;
    }

    if (this.debug) {
      console.log("[ActionParser FALLBACK]", action);
    }

    return action;
  }

  /**
   * Normalize input
   */
  _clean(text) {
    return text.trim().replace(/\s+/g, " ").replace(/[.,;]/g, "").toLowerCase();
  }

  /**
   * URL normalizer
   */
  normalizeUrl(url) {
    if (!url) return "";

    url = url.trim();

    if (!/^https?:\/\//i.test(url)) {
      if (url.includes(".")) {
        return "https://" + url;
      }
      return "https://www.google.com/search?q=" + encodeURIComponent(url);
    }

    return url;
  }

  /**
   * Unknown handler
   */
  _unknown(input) {
    return {
      type: "unknown",
      payload: {},
      raw: input,
      confidence: 0,
    };
  }

  /**
   * Extend rules dynamically
   */
  addRule(rule) {
    this.intentRules.push(rule);
  }

  /**
   * Debug helper
   */
  printRules() {
    console.log(this.intentRules);
  }
}

module.exports = ActionParser;
