//==========================================================
//
// backend/planner/grammar.js
//
// Ultra-Fast Intent Grammar Engine for Jarvis Browser
//
// Purpose
// -------
// Deterministic rule-based command recognition.
//
// Pipeline
//
// User Command
//      │
//      ▼
// Tokenizer
//      │
//      ▼
// Grammar Engine
//      │
//      ▼
// Intent Parser
//      │
//      ▼
// Scoring Engine
//      │
//      ▼
// Planner / LLM Fallback
//
// IMPORTANT
// ---------
// ✔ No LLM calls
// ✔ No fuzzy matching
// ✔ No DOM interaction
// ✔ No browser execution
// ✔ Fast deterministic parsing
// ✔ Structured action output
//
//==========================================================

class GrammarEngine {
  constructor(options = {}) {
    //------------------------------------------------------
    // Configuration
    //------------------------------------------------------

    this.debug = options.debug ?? false;

    this.maxInputLength = options.maxInputLength ?? 2000;

    //------------------------------------------------------
    // Intent Patterns
    //------------------------------------------------------

    this.patterns = [
      //----------------------------------------------------
      // NAVIGATION
      //----------------------------------------------------

      {
        type: "NAVIGATE",
        regex:
          /^(?:go\s+to|open|visit|navigate\s+to|browse\s+to)\s+(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/i,

        priority: 100,
      },

      //----------------------------------------------------
      // SEARCH
      //----------------------------------------------------

      {
        type: "SEARCH",
        regex:
          /^(?:search\s+(?:for|on|the\s+web\s+for)?|google|find|look\s+up)\s+(.+)/i,

        priority: 95,
      },

      //----------------------------------------------------
      // CLICK
      //----------------------------------------------------

      {
        type: "CLICK",
        regex: /^(?:click|press|tap|select)\s+(?:on\s+)?(?:the\s+)?(.+)/i,

        priority: 95,
      },

      //----------------------------------------------------
      // DOUBLE CLICK
      //----------------------------------------------------

      {
        type: "DOUBLE_CLICK",
        regex: /^(?:double\s+click|double-click)\s+(?:on\s+)?(?:the\s+)?(.+)/i,

        priority: 95,
      },

      //----------------------------------------------------
      // RIGHT CLICK
      //----------------------------------------------------

      {
        type: "RIGHT_CLICK",
        regex:
          /^(?:right\s+click|right-click|context\s+click)\s+(?:on\s+)?(?:the\s+)?(.+)/i,

        priority: 95,
      },

      //----------------------------------------------------
      // TYPE
      //
      // Examples:
      // type "hello" in email
      // enter "hello" into username
      // write hello in search box
      //----------------------------------------------------

      {
        type: "TYPE",
        regex:
          /^(?:type|enter|write|fill)\s+(?:"([^"]+)"|'([^']+)'|(.+?))\s+(?:in|into|inside|on)\s+(?:the\s+)?(.+)/i,

        priority: 100,
      },

      //----------------------------------------------------
      // TYPE WITHOUT TARGET
      //
      // Example:
      // type "hello world"
      //----------------------------------------------------

      {
        type: "TYPE",
        regex: /^(?:type|enter|write)\s+(?:"([^"]+)"|'([^']+)'|(.+))$/i,

        priority: 90,
      },

      //----------------------------------------------------
      // SELECT OPTION
      //----------------------------------------------------

      {
        type: "SELECT",
        regex:
          /^(?:select|choose|pick)\s+(?:"([^"]+)"|'([^']+)'|(.+?))\s+(?:from|in)\s+(?:the\s+)?(.+)/i,

        priority: 95,
      },

      //----------------------------------------------------
      // CHECK
      //----------------------------------------------------

      {
        type: "CHECK",
        regex: /^(?:check|tick|enable)\s+(?:the\s+)?(.+)/i,

        priority: 90,
      },

      //----------------------------------------------------
      // UNCHECK
      //----------------------------------------------------

      {
        type: "UNCHECK",
        regex: /^(?:uncheck|untick|disable)\s+(?:the\s+)?(.+)/i,

        priority: 90,
      },

      //----------------------------------------------------
      // SCROLL
      //----------------------------------------------------

      {
        type: "SCROLL",
        regex:
          /^(?:scroll)\s+(?:(up|down|top|bottom)(?:\s+(?:by|to)\s+(\d+))?)?/i,

        priority: 90,
      },

      //----------------------------------------------------
      // WAIT
      //
      // Examples:
      // wait
      // wait 2
      // wait 2000 ms
      // wait 3 seconds
      //----------------------------------------------------

      {
        type: "WAIT",
        regex:
          /^(?:wait|pause)(?:\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?)?)?$/i,

        priority: 90,
      },

      //----------------------------------------------------
      // RELOAD
      //----------------------------------------------------

      {
        type: "RELOAD",
        regex: /^(?:reload|refresh)(?:\s+(?:the\s+)?page)?$/i,

        priority: 90,
      },

      //----------------------------------------------------
      // BACK
      //----------------------------------------------------

      {
        type: "BACK",
        regex: /^(?:go\s+back|back|previous\s+page|navigate\s+back)$/i,

        priority: 90,
      },

      //----------------------------------------------------
      // FORWARD
      //----------------------------------------------------

      {
        type: "FORWARD",
        regex: /^(?:go\s+forward|forward|next\s+page|navigate\s+forward)$/i,

        priority: 90,
      },

      //----------------------------------------------------
      // NEW TAB
      //----------------------------------------------------

      {
        type: "NEW_TAB",
        regex:
          /^(?:open|create|new)\s+(?:a\s+)?(?:new\s+)?tab(?:\s+(?:with|for|at)\s+(.+))?$/i,

        priority: 85,
      },

      //----------------------------------------------------
      // CLOSE TAB
      //----------------------------------------------------

      {
        type: "CLOSE_TAB",
        regex: /^(?:close|exit)\s+(?:the\s+)?(?:current\s+)?tab$/i,

        priority: 85,
      },

      //----------------------------------------------------
      // SWITCH TAB
      //----------------------------------------------------

      {
        type: "SWITCH_TAB",
        regex:
          /^(?:switch|change|go)\s+(?:to\s+)?(?:tab)\s*(?:(\d+)|(?:number\s+)?(\d+))?$/i,

        priority: 85,
      },

      //----------------------------------------------------
      // SCREENSHOT
      //----------------------------------------------------

      {
        type: "SCREENSHOT",
        regex:
          /^(?:take|capture|get)\s+(?:a\s+)?screenshot(?:\s+(?:of|for)\s+(.+))?$/i,

        priority: 80,
      },

      //----------------------------------------------------
      // READ PAGE
      //----------------------------------------------------

      {
        type: "READ",
        regex:
          /^(?:read|show|tell\s+me|what\s+is)\s+(?:the\s+)?(?:page|screen|content|text|headings?)$/i,

        priority: 80,
      },

      //----------------------------------------------------
      // EXTRACT
      //----------------------------------------------------

      {
        type: "EXTRACT",
        regex:
          /^(?:extract|get|find|read)\s+(?:all\s+)?(?:the\s+)?(.+?)\s+(?:from|on)\s+(?:the\s+)?page$/i,

        priority: 75,
      },
    ];

    //------------------------------------------------------
    // Sort by Priority
    //------------------------------------------------------

    this.patterns.sort((a, b) => {
      return (b.priority || 0) - (a.priority || 0);
    });
  }

  //========================================================
  // PUBLIC PARSE
  //========================================================

  parse(input) {
    //------------------------------------------------------
    // Validate
    //------------------------------------------------------

    if (typeof input !== "string") {
      return this._fallback(input);
    }

    //------------------------------------------------------
    // Normalize
    //------------------------------------------------------

    const original = input;

    const text = this._normalizeInput(input);

    if (!text) {
      return this._fallback(original);
    }

    //------------------------------------------------------
    // Protect against oversized input
    //------------------------------------------------------

    if (text.length > this.maxInputLength) {
      return this._fallback(original, "input_too_long");
    }

    //------------------------------------------------------
    // Match patterns
    //------------------------------------------------------

    for (const pattern of this.patterns) {
      let match = null;

      try {
        match = text.match(pattern.regex);
      } catch (err) {
        this._log("Pattern error:", err.message);
        continue;
      }

      if (!match) {
        continue;
      }

      const result = this._buildAction(pattern.type, match, original, text);

      if (result) {
        return result;
      }
    }

    //------------------------------------------------------
    // Unknown
    //------------------------------------------------------

    return this._fallback(original);
  }

  //========================================================
  // ACTION BUILDER
  //========================================================

  _buildAction(type, match, original, normalized) {
    const base = {
      action: type,

      input: original,

      normalized,

      confidence: 1,

      matched: true,
    };

    switch (type) {
      //----------------------------------------------------
      // NAVIGATE
      //----------------------------------------------------

      case "NAVIGATE": {
        const url = this._cleanValue(match[1]);

        return {
          ...base,

          action: "NAVIGATE",

          url: this._normalizeUrl(url),
        };
      }

      //----------------------------------------------------
      // SEARCH
      //----------------------------------------------------

      case "SEARCH": {
        const query = this._cleanValue(match[1]);

        if (!query) {
          return this._fallback(original);
        }

        return {
          ...base,

          action: "SEARCH",

          query,
        };
      }

      //----------------------------------------------------
      // CLICK
      //----------------------------------------------------

      case "CLICK": {
        const target = this._cleanTarget(match[1]);

        return {
          ...base,

          action: "CLICK",

          target,

          targetType: this._inferTargetType(target),
        };
      }

      //----------------------------------------------------
      // DOUBLE CLICK
      //----------------------------------------------------

      case "DOUBLE_CLICK": {
        const target = this._cleanTarget(match[1]);

        return {
          ...base,

          action: "DOUBLE_CLICK",

          target,

          targetType: this._inferTargetType(target),
        };
      }

      //----------------------------------------------------
      // RIGHT CLICK
      //----------------------------------------------------

      case "RIGHT_CLICK": {
        const target = this._cleanTarget(match[1]);

        return {
          ...base,

          action: "RIGHT_CLICK",

          target,

          targetType: this._inferTargetType(target),
        };
      }

      //----------------------------------------------------
      // TYPE
      //----------------------------------------------------

      case "TYPE": {
        const text =
          this._cleanValue(match[1]) ||
          this._cleanValue(match[2]) ||
          this._cleanValue(match[3]);

        const target = this._cleanTarget(match[4]);

        return {
          ...base,

          action: "TYPE",

          text,

          target: target || null,

          targetType: target ? this._inferTargetType(target) : null,
        };
      }

      //----------------------------------------------------
      // SELECT
      //----------------------------------------------------

      case "SELECT": {
        const value =
          this._cleanValue(match[1]) ||
          this._cleanValue(match[2]) ||
          this._cleanValue(match[3]);

        const target = this._cleanTarget(match[4]);

        return {
          ...base,

          action: "SELECT",

          value,

          target: target || null,

          targetType: target ? this._inferTargetType(target) : null,
        };
      }

      //----------------------------------------------------
      // CHECK
      //----------------------------------------------------

      case "CHECK": {
        const target = this._cleanTarget(match[1]);

        return {
          ...base,

          action: "CHECK",

          target,

          targetType: this._inferTargetType(target),
        };
      }

      //----------------------------------------------------
      // UNCHECK
      //----------------------------------------------------

      case "UNCHECK": {
        const target = this._cleanTarget(match[1]);

        return {
          ...base,

          action: "UNCHECK",

          target,

          targetType: this._inferTargetType(target),
        };
      }

      //----------------------------------------------------
      // SCROLL
      //----------------------------------------------------

      case "SCROLL": {
        const direction = (match[1] || "down").toLowerCase();

        const amount = match[2] ? Number(match[2]) : null;

        return {
          ...base,

          action: "SCROLL",

          direction,

          amount,
        };
      }

      //----------------------------------------------------
      // WAIT
      //----------------------------------------------------

      case "WAIT": {
        const value = match[1] ? Number(match[1]) : 1000;

        const unit = (match[2] || "ms").toLowerCase();

        const duration =
          unit.startsWith("s") && !unit.startsWith("ms")
            ? Math.round(value * 1000)
            : Math.round(value);

        return {
          ...base,

          action: "WAIT",

          duration,

          unit: "ms",
        };
      }

      //----------------------------------------------------
      // RELOAD
      //----------------------------------------------------

      case "RELOAD":
        return {
          ...base,

          action: "RELOAD",
        };

      //----------------------------------------------------
      // BACK
      //----------------------------------------------------

      case "BACK":
        return {
          ...base,

          action: "BACK",
        };

      //----------------------------------------------------
      // FORWARD
      //----------------------------------------------------

      case "FORWARD":
        return {
          ...base,

          action: "FORWARD",
        };

      //----------------------------------------------------
      // NEW TAB
      //----------------------------------------------------

      case "NEW_TAB":
        return {
          ...base,

          action: "NEW_TAB",

          url: this._cleanValue(match[1]) || null,
        };

      //----------------------------------------------------
      // CLOSE TAB
      //----------------------------------------------------

      case "CLOSE_TAB":
        return {
          ...base,

          action: "CLOSE_TAB",
        };

      //----------------------------------------------------
      // SWITCH TAB
      //----------------------------------------------------

      case "SWITCH_TAB": {
        const indexValue = match[1] || match[2];

        return {
          ...base,

          action: "SWITCH_TAB",

          index: indexValue ? Math.max(0, Number(indexValue) - 1) : null,
        };
      }

      //----------------------------------------------------
      // SCREENSHOT
      //----------------------------------------------------

      case "SCREENSHOT":
        return {
          ...base,

          action: "SCREENSHOT",

          target: this._cleanValue(match[1]) || null,
        };

      //----------------------------------------------------
      // READ
      //----------------------------------------------------

      case "READ":
        return {
          ...base,

          action: "READ",

          target: "page",
        };

      //----------------------------------------------------
      // EXTRACT
      //----------------------------------------------------

      case "EXTRACT":
        return {
          ...base,

          action: "EXTRACT",

          target: this._cleanValue(match[1]),
        };

      //----------------------------------------------------
      // UNKNOWN
      //----------------------------------------------------

      default:
        return this._fallback(original);
    }
  }

  //========================================================
  // INPUT NORMALIZATION
  //========================================================

  _normalizeInput(input) {
    return String(input)
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  //========================================================
  // TARGET CLEANING
  //========================================================

  _cleanTarget(value) {
    if (!value) return null;

    let target = String(value).trim();

    target = target.replace(/^["']/, "").replace(/["']$/, "").trim();

    target = target.replace(/^(?:the|a|an)\s+/i, "").trim();

    return target || null;
  }

  //========================================================
  // VALUE CLEANING
  //========================================================

  _cleanValue(value) {
    if (value === undefined || value === null) {
      return null;
    }

    const result = String(value)
      .trim()
      .replace(/^["']/, "")
      .replace(/["']$/, "")
      .trim();

    return result || null;
  }

  //========================================================
  // URL NORMALIZATION
  //========================================================

  _normalizeUrl(url) {
    if (!url) return null;

    let value = url.trim();

    if (!value.startsWith("http://") && !value.startsWith("https://")) {
      if (value.startsWith("www.")) {
        value = `https://${value}`;
      } else {
        value = `https://${value}`;
      }
    }

    return value;
  }

  //========================================================
  // TARGET TYPE
  //========================================================

  _inferTargetType(target) {
    if (!target) {
      return "unknown";
    }

    const value = target.trim();

    if (
      value.startsWith("#") ||
      value.startsWith(".") ||
      value.includes("[") ||
      value.includes(">")
    ) {
      return "selector";
    }

    if (/^https?:\/\//i.test(value) || /^www\./i.test(value)) {
      return "url";
    }

    return "text";
  }

  //========================================================
  // FALLBACK
  //========================================================

  _fallback(input, reason = "no_match") {
    return {
      action: "UNKNOWN",

      input,

      normalized: typeof input === "string" ? this._normalizeInput(input) : "",

      confidence: 0,

      matched: false,

      reason,
    };
  }

  //========================================================
  // CUSTOM PATTERNS
  //========================================================

  addPattern(type, regex, priority = 50) {
    if (!type) {
      throw new Error("Pattern type is required.");
    }

    if (!(regex instanceof RegExp)) {
      throw new Error("Pattern regex must be a RegExp.");
    }

    this.patterns.push({
      type: String(type).toUpperCase(),

      regex,

      priority,
    });

    this.patterns.sort((a, b) => {
      return (b.priority || 0) - (a.priority || 0);
    });

    return true;
  }

  removePattern(type) {
    const normalizedType = String(type).toUpperCase();

    const before = this.patterns.length;

    this.patterns = this.patterns.filter(
      (pattern) => pattern.type !== normalizedType,
    );

    return before !== this.patterns.length;
  }

  clearCustomPatterns() {
    this.patterns = this.patterns.filter((pattern) => pattern.priority >= 75);
  }

  //========================================================
  // DEBUG
  //========================================================

  _log(...args) {
    if (this.debug) {
      console.log("[GrammarEngine]", ...args);
    }
  }

  //========================================================
  // PUBLIC UTILITIES
  //========================================================

  getSupportedActions() {
    return [...new Set(this.patterns.map((pattern) => pattern.type))];
  }

  getPatterns() {
    return this.patterns.map((pattern) => ({
      type: pattern.type,

      regex: pattern.regex.toString(),

      priority: pattern.priority,
    }));
  }

  test(input) {
    const result = this.parse(input);

    this._log("Input:", input, "Result:", result);

    return result;
  }
}

//==========================================================
// SINGLETON
//==========================================================

const grammar = new GrammarEngine();

//==========================================================
// ES MODULE EXPORT
//==========================================================

export { GrammarEngine };

export { grammar };

export default grammar;
