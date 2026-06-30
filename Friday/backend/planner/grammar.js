// grammar.js
// Ultra-fast Intent Grammar Engine for Jarvis Browser
// Supports rule-based + structured action parsing

class GrammarEngine {
  constructor(options = {}) {
    this.debug = options.debug || false;

    // Core intent patterns
    this.patterns = [
      {
        type: "NAVIGATE",
        regex:
          /^(go to|open|visit)\s+(https?:\/\/[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
      },
      {
        type: "SEARCH",
        regex: /^(search for|find|look up)\s+(.+)/i,
      },
      {
        type: "CLICK",
        regex: /^(click|press)\s+(.+)/i,
      },
      {
        type: "TYPE",
        regex: /^(type|enter|write)\s+"(.+)"\s+in\s+(.+)/i,
      },
      {
        type: "SCROLL",
        regex: /^(scroll\s+(up|down|top|bottom)?)/i,
      },
      {
        type: "WAIT",
        regex: /^(wait|pause)\s+(\d+)?/i,
      },
      {
        type: "RELOAD",
        regex: /^(reload|refresh)/i,
      },
      {
        type: "BACK",
        regex: /^(go back|back)/i,
      },
    ];
  }

  parse(input) {
    if (!input || typeof input !== "string") {
      return this._fallback(input);
    }

    const text = input.trim();

    for (const pattern of this.patterns) {
      const match = text.match(pattern.regex);

      if (match) {
        return this._buildAction(pattern.type, match);
      }
    }

    return this._fallback(text);
  }

  _buildAction(type, match) {
    switch (type) {
      case "NAVIGATE":
        return {
          action: "NAVIGATE",
          url: match[2] || match[1],
        };

      case "SEARCH":
        return {
          action: "SEARCH",
          query: match[2],
        };

      case "CLICK":
        return {
          action: "CLICK",
          target: match[2],
        };

      case "TYPE":
        return {
          action: "TYPE",
          text: match[2],
          target: match[3],
        };

      case "SCROLL":
        return {
          action: "SCROLL",
          direction: match[2] || "down",
        };

      case "WAIT":
        return {
          action: "WAIT",
          duration: parseInt(match[2] || "1000", 10),
        };

      case "RELOAD":
        return {
          action: "RELOAD",
        };

      case "BACK":
        return {
          action: "BACK",
        };

      default:
        return this._fallback(match[0]);
    }
  }

  _fallback(input) {
    return {
      action: "UNKNOWN",
      input,
    };
  }

  addPattern(type, regex) {
    this.patterns.push({ type, regex });
  }
}

module.exports = GrammarEngine;
