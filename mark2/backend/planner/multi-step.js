// planner/multi-step.js
//
// Multi-Step Planner Engine (Jarvis Browser)
// --------------------------------------------------
// Features:
// ✅ Multi-step intent decomposition
// ✅ Deterministic rule-based planning
// ✅ Action chaining (click, type, wait, navigate)
// ✅ JSON-safe output format
// ✅ Fallback reasoning support
// ✅ Lightweight (no LLM required in fast path)
// --------------------------------------------------

class MultiStepPlanner {
  constructor(options = {}) {
    this.maxSteps = options.maxSteps || 12;
    this.debug = options.debug || false;

    // Fast intent patterns
    this.intentPatterns = [
      { type: "navigate", regex: /go to|open|visit|launch/i },
      { type: "search", regex: /search for|look up|find/i },
      { type: "click", regex: /click|press|tap/i },
      { type: "type", regex: /type|enter|write/i },
      { type: "scroll", regex: /scroll/i },
      { type: "wait", regex: /wait|pause/i },
      { type: "extract", regex: /extract|get|scrape|read/i },
    ];
  }

  /**
   * Main entry: converts user query → execution steps
   */
  plan(input) {
    if (!input || typeof input !== "string") {
      return this._emptyPlan();
    }

    const cleaned = input.trim();

    // Step 1: Detect high-level intent
    const intents = this._detectIntents(cleaned);

    // Step 2: Break into structured steps
    const steps = this._buildSteps(cleaned, intents);

    // Step 3: Optimize / sanitize
    const optimized = this._optimizeSteps(steps);

    return {
      success: true,
      input: cleaned,
      intent: intents,
      steps: optimized,
      stepCount: optimized.length,
    };
  }

  /**
   * Detect intent types using regex rules
   */
  _detectIntents(text) {
    const detected = [];

    for (const pattern of this.intentPatterns) {
      if (pattern.regex.test(text)) {
        detected.push(pattern.type);
      }
    }

    // fallback intent
    if (detected.length === 0) {
      detected.push("navigate");
    }

    return [...new Set(detected)];
  }

  /**
   * Convert intent → executable steps
   */
  _buildSteps(text, intents) {
    const steps = [];

    // Normalize tokens
    const lower = text.toLowerCase();

    // NAVIGATION
    if (intents.includes("navigate")) {
      const urlMatch = this._extractUrl(text);

      steps.push({
        id: 1,
        action: "navigate",
        target: urlMatch || "google.com",
        description: urlMatch
          ? `Open ${urlMatch}`
          : "Open default search engine",
      });
    }

    // SEARCH
    if (intents.includes("search")) {
      const query = this._extractSearchQuery(text);

      steps.push({
        id: steps.length + 1,
        action: "search",
        query: query || text,
        description: `Search for "${query || text}"`,
      });
    }

    // CLICK
    if (intents.includes("click")) {
      steps.push({
        id: steps.length + 1,
        action: "click",
        selector: "auto",
        description: "Click detected UI element",
      });
    }

    // TYPE
    if (intents.includes("type")) {
      steps.push({
        id: steps.length + 1,
        action: "type",
        value: this._extractTypeContent(text),
        description: "Type extracted content",
      });
    }

    // SCROLL
    if (intents.includes("scroll")) {
      steps.push({
        id: steps.length + 1,
        action: "scroll",
        direction: "down",
        amount: 800,
        description: "Scroll page",
      });
    }

    // EXTRACT
    if (intents.includes("extract")) {
      steps.push({
        id: steps.length + 1,
        action: "extract",
        target: "page",
        format: "text",
        description: "Extract page content",
      });
    }

    // WAIT (only if explicitly requested)
    if (intents.includes("wait")) {
      steps.push({
        id: steps.length + 1,
        action: "wait",
        duration: this._extractWaitTime(text) || 2000,
        description: "Wait for specified duration",
      });
    }

    return steps;
  }

  /**
   * Optimize steps: remove duplicates, enforce limits
   */
  _optimizeSteps(steps) {
    let optimized = steps.slice(0, this.maxSteps);

    // Ensure sequential IDs
    optimized = optimized.map((s, i) => ({
      ...s,
      id: i + 1,
    }));

    return optimized;
  }

  /**
   * Extract URL if present
   */
  _extractUrl(text) {
    const match = text.match(/https?:\/\/[^\s]+/i);
    return match ? match[0] : null;
  }

  /**
   * Extract search query
   */
  _extractSearchQuery(text) {
    const patterns = [/search for (.+)/i, /look up (.+)/i, /find (.+)/i];

    for (const p of patterns) {
      const match = text.match(p);
      if (match) return match[1].trim();
    }

    return null;
  }

  /**
   * Extract typed content
   */
  _extractTypeContent(text) {
    const match = text.match(/type (.+)/i);
    return match ? match[1] : text;
  }

  /**
   * Extract wait duration
   */
  _extractWaitTime(text) {
    const match = text.match(/(\d+)\s*(ms|sec|s)/i);
    if (!match) return null;

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    if (unit === "ms") return value;
    if (unit === "s" || unit === "sec") return value * 1000;

    return value;
  }

  _emptyPlan() {
    return {
      success: false,
      error: "Invalid input",
      steps: [],
    };
  }
}

module.exports = MultiStepPlanner;
