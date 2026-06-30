/**
 * intent-parser.js
 *
 * Ultra-fast Intent Parser for Jarvis Planner
 *
 * Features:
 * - Zero-dependency regex intent classification
 * - Chat vs Action separation
 * - Command extraction (/slash commands)
 * - URL detection
 * - Multi-intent support
 * - Fallback-safe unknown intent handling
 *
 * Designed for high-performance browser automation planners
 */

class IntentParser {
  constructor(options = {}) {
    this.options = {
      enableMultiIntent: true,
      debug: false,
      ...options,
    };

    // Precompiled regex patterns (performance optimized)
    this.patterns = {
      url: /(https?:\/\/[^\s]+)/i,
      command: /^\/(\w+)/,

      // Action intents
      click: /\b(click|press|tap|select)\b/i,
      type: /\b(type|enter|write|input|fill)\b/i,
      navigate: /\b(open|go to|visit|navigate)\b/i,
      scroll: /\b(scroll|swipe)\b/i,
      wait: /\b(wait|sleep|pause)\b/i,
      extract: /\b(extract|get|fetch|scrape|read)\b/i,

      // System intents
      reload: /\b(reload|refresh)\b/i,
      back: /\b(go back|back)\b/i,
      forward: /\b(go forward|forward)\b/i,

      // Chat detection
      chat: /\b(what|why|how|explain|tell me|help|can you)\b/i,
    };
  }

  /**
   * Main parse function
   */
  parse(input = "") {
    const raw = input.trim();

    if (!raw) {
      return this._result("unknown", raw);
    }

    const result = {
      raw,
      intents: [],
      entities: {},
      confidence: 0.5,
    };

    // 1. Command detection (/command)
    const cmdMatch = raw.match(this.patterns.command);
    if (cmdMatch) {
      result.intents.push({
        type: "command",
        action: cmdMatch[1],
        confidence: 0.95,
      });

      return this._finalize(result);
    }

    // 2. URL detection
    const urlMatch = raw.match(this.patterns.url);
    if (urlMatch) {
      result.intents.push({
        type: "navigate",
        action: "open_url",
        url: urlMatch[1],
        confidence: 0.9,
      });
    }

    // 3. Action classification
    this._detectPattern(raw, "click", "click_element", result);
    this._detectPattern(raw, "type", "type_input", result);
    this._detectPattern(raw, "navigate", "navigate", result);
    this._detectPattern(raw, "scroll", "scroll", result);
    this._detectPattern(raw, "wait", "wait", result);
    this._detectPattern(raw, "extract", "extract_data", result);

    // 4. Navigation helpers
    this._detectPattern(raw, "reload", "reload_page", result);
    this._detectPattern(raw, "back", "go_back", result);
    this._detectPattern(raw, "forward", "go_forward", result);

    // 5. Chat detection fallback
    const isChat = this.patterns.chat.test(raw);
    if (isChat && result.intents.length === 0) {
      result.intents.push({
        type: "chat",
        action: "respond",
        confidence: 0.7,
      });
    }

    // 6. Unknown fallback
    if (result.intents.length === 0) {
      result.intents.push({
        type: "unknown",
        action: "analyze",
        confidence: 0.4,
      });
    }

    return this._finalize(result);
  }

  /**
   * Pattern detector helper
   */
  _detectPattern(text, patternKey, action, result) {
    const pattern = this.patterns[patternKey];
    if (pattern.test(text)) {
      result.intents.push({
        type: patternKey,
        action,
        confidence: 0.75,
      });
    }
  }

  /**
   * Final scoring + normalization
   */
  _finalize(result) {
    // Compute average confidence
    if (result.intents.length > 0) {
      const avg =
        result.intents.reduce((a, b) => a + b.confidence, 0) /
        result.intents.length;

      result.confidence = Number(avg.toFixed(2));
    }

    // Sort intents by confidence
    result.intents.sort((a, b) => b.confidence - a.confidence);

    if (this.options.debug) {
      console.log("[IntentParser]", result);
    }

    return result;
  }

  /**
   * Simple result helper
   */
  _result(type, raw) {
    return {
      raw,
      intents: [
        {
          type,
          action: "none",
          confidence: 0,
        },
      ],
      confidence: 0,
    };
  }
}

module.exports = IntentParser;
