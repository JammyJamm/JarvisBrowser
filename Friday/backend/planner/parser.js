// planner/parser.js
//
// Ultra-fast Intent Parser for Jarvis Browser Planner
// ----------------------------------------------------
// Features:
// ⚡ Regex-first intent detection (no LLM needed for most cases)
// 🧠 Optional fallback hook for LLM planners
// 🔧 JSON repair + safe parsing
// 🔁 Multi-step action extraction
// 📦 Structured output for planner engine
//

class IntentParser {
  constructor(options = {}) {
    this.options = {
      enableLLMFallback: true,
      debug: false,
      ...options,
    };

    // -------------------------------
    // INTENT PATTERNS (FAST LAYER)
    // -------------------------------
    this.patterns = [
      { type: "navigate", regex: /^(go to|open|visit)\s+(https?:\/\/|www\.)/i },
      { type: "search", regex: /^(search|find|look for)\s+/i },
      { type: "click", regex: /click\s+(on\s+)?/i },
      { type: "type", regex: /type\s+["'].*["']\s+in/i },
      { type: "scroll", regex: /scroll\s+(down|up|to)/i },
      { type: "wait", regex: /wait\s+\d+/i },
      { type: "screenshot", regex: /take\s+(a\s+)?screenshot/i },
      { type: "extract", regex: /extract|scrape|get\s+data/i },
      { type: "login", regex: /login|sign in/i },
    ];

    // keyword shortcuts
    this.quickMap = {
      youtube: "navigate",
      google: "search",
      open: "navigate",
    };
  }

  // -------------------------------
  // MAIN ENTRY
  // -------------------------------
  parse(input) {
    if (!input || typeof input !== "string") {
      return this._empty("Invalid input");
    }

    input = input.trim();

    // 1. FAST KEYWORD CHECK
    const quick = this._quickMatch(input);
    if (quick) return quick;

    // 2. REGEX INTENT MATCH
    const intent = this._regexMatch(input);
    if (intent) return intent;

    // 3. FALLBACK STRUCTURING
    return this._fallbackParse(input);
  }

  // -------------------------------
  // QUICK MATCH LAYER
  // -------------------------------
  _quickMatch(input) {
    const lower = input.toLowerCase();

    for (const key in this.quickMap) {
      if (lower.includes(key)) {
        return {
          intent: this.quickMap[key],
          confidence: 0.6,
          raw: input,
          steps: [{ action: this.quickMap[key], value: input }],
        };
      }
    }

    return null;
  }

  // -------------------------------
  // REGEX MATCH LAYER
  // -------------------------------
  _regexMatch(input) {
    for (const p of this.patterns) {
      if (p.regex.test(input)) {
        return {
          intent: p.type,
          confidence: 0.85,
          raw: input,
          steps: this._buildSteps(p.type, input),
        };
      }
    }
    return null;
  }

  // -------------------------------
  // STEP BUILDER
  // -------------------------------
  _buildSteps(type, input) {
    const steps = [];

    switch (type) {
      case "navigate":
        steps.push({
          action: "navigate",
          url: this._extractURL(input),
        });
        break;

      case "search":
        steps.push({
          action: "search",
          query: input.replace(/search|find|look for/i, "").trim(),
        });
        break;

      case "click":
        steps.push({
          action: "click",
          target: input,
        });
        break;

      case "type":
        steps.push({
          action: "type",
          text: this._extractQuoted(input),
          target: "active_input",
        });
        break;

      case "scroll":
        steps.push({
          action: "scroll",
          direction: input.includes("up") ? "up" : "down",
        });
        break;

      case "wait":
        steps.push({
          action: "wait",
          ms: parseInt(input.match(/\d+/)?.[0] || "1000"),
        });
        break;

      default:
        steps.push({
          action: type,
          value: input,
        });
    }

    return steps;
  }

  // -------------------------------
  // FALLBACK PARSER (STRUCTURED GUESS)
  // -------------------------------
  _fallbackParse(input) {
    return {
      intent: "unknown",
      confidence: 0.3,
      raw: input,
      steps: [
        {
          action: "analyze",
          value: input,
        },
      ],
    };
  }

  // -------------------------------
  // HELPERS
  // -------------------------------
  _extractURL(text) {
    const match = text.match(/https?:\/\/[^\s]+|www\.[^\s]+/);
    return match ? match[0] : text;
  }

  _extractQuoted(text) {
    const match = text.match(/["'](.*?)["']/);
    return match ? match[1] : text;
  }

  _empty(msg) {
    return {
      intent: "error",
      confidence: 0,
      error: msg,
      steps: [],
    };
  }

  // -------------------------------
  // SAFE JSON PARSER (REPAIR MODE)
  // -------------------------------
  safeJSONParse(str) {
    try {
      return JSON.parse(str);
    } catch (e) {
      try {
        // basic repair: fix single quotes + trailing commas
        const fixed = str
          .replace(/'/g, '"')
          .replace(/,\s*}/g, "}")
          .replace(/,\s*]/g, "]");

        return JSON.parse(fixed);
      } catch (err) {
        return null;
      }
    }
  }

  // -------------------------------
  // DEBUG MODE
  // -------------------------------
  log(...args) {
    if (this.options.debug) {
      console.log("[IntentParser]", ...args);
    }
  }
}

module.exports = IntentParser;
