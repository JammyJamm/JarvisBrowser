/**
 * entity-parser.js
 *
 * Ultra-fast Entity Parser for Jarvis Browser AI
 *
 * Features:
 * ✅ Regex + rule-based extraction (no LLM dependency)
 * ✅ Detects URLs, commands, file paths, dates, numbers
 * ✅ Extracts intents, actions, and named entities
 * ✅ Lightweight & production-safe
 */

class EntityParser {
  constructor(options = {}) {
    this.options = {
      enableUrls: true,
      enableDates: true,
      enableNumbers: true,
      enableCommands: true,
      customPatterns: [],
      ...options,
    };

    // Precompiled regex for speed
    this.patterns = {
      url: /https?:\/\/[^\s]+/gi,
      email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
      command: /\/[a-zA-Z0-9_-]+/g,
      filePath: /([a-zA-Z]:\\|\/)[^\s]+/g,
      number: /\b\d+(\.\d+)?\b/g,
      dateISO: /\b\d{4}-\d{2}-\d{2}\b/g,
      dateHuman: /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/g,
      quotedText: /(["'`])(?:(?=(\\?))\2.)*?\1/g,
    };
  }

  /**
   * Main parse function
   */
  parse(text = "") {
    if (!text || typeof text !== "string") {
      return this._emptyResult();
    }

    const result = {
      raw: text,
      urls: [],
      emails: [],
      commands: [],
      numbers: [],
      dates: [],
      filePaths: [],
      quoted: [],
      custom: [],
      intent: this._detectIntent(text),
    };

    // URLs
    if (this.options.enableUrls) {
      result.urls = this._match(this.patterns.url, text);
    }

    // Emails
    result.emails = this._match(this.patterns.email, text);

    // Commands (/open, /search etc.)
    if (this.options.enableCommands) {
      result.commands = this._match(this.patterns.command, text);
    }

    // Numbers
    if (this.options.enableNumbers) {
      result.numbers = this._match(this.patterns.number, text);
    }

    // Dates
    if (this.options.enableDates) {
      result.dates = [
        ...this._match(this.patterns.dateISO, text),
        ...this._match(this.patterns.dateHuman, text),
      ];
    }

    // File paths
    result.filePaths = this._match(this.patterns.filePath, text);

    // Quoted strings
    result.quoted = this._match(this.patterns.quotedText, text);

    // Custom patterns
    if (this.options.customPatterns.length > 0) {
      result.custom = this._parseCustom(text);
    }

    return result;
  }

  /**
   * Lightweight intent detection
   */
  _detectIntent(text) {
    const t = text.toLowerCase();

    if (t.startsWith("/")) return "command";
    if (t.includes("open") && t.includes("browser")) return "browser_open";
    if (t.includes("search")) return "search";
    if (t.includes("click")) return "ui_click";
    if (t.includes("scroll")) return "ui_scroll";
    if (t.includes("download")) return "download";
    if (t.includes("login") || t.includes("sign in")) return "auth";
    if (t.includes("error") || t.includes("fail")) return "error";

    return "general";
  }

  /**
   * Match helper
   */
  _match(regex, text) {
    return (text.match(regex) || []).map((v) => v.trim());
  }

  /**
   * Custom pattern support
   */
  _parseCustom(text) {
    const results = [];

    for (const pattern of this.options.customPatterns) {
      try {
        const regex = new RegExp(pattern.regex, pattern.flags || "gi");
        const matches = this._match(regex, text);

        if (matches.length) {
          results.push({
            name: pattern.name || "custom",
            matches,
          });
        }
      } catch (e) {
        // ignore bad regex
      }
    }

    return results;
  }

  /**
   * Empty fallback
   */
  _emptyResult() {
    return {
      raw: "",
      urls: [],
      emails: [],
      commands: [],
      numbers: [],
      dates: [],
      filePaths: [],
      quoted: [],
      custom: [],
      intent: "unknown",
    };
  }
}

module.exports = EntityParser;
