// command-classifier.js
//
// Ultra-fast Intent & Command Classifier
// For Jarvis Browser / Planner system
//
// Features:
// ✅ Regex-based fast classification (no LLM required)
// ✅ Supports fallback NLP-style scoring
// ✅ Detects navigation, automation, search, system commands
// ✅ Structured output for planner integration
//
// Output format:
// {
//   type: "navigate" | "search" | "action" | "system" | "chat",
//   intent: string,
//   confidence: number,
//   raw: string,
//   entities: string[]
// }

class CommandClassifier {
  constructor(options = {}) {
    this.debug = options.debug || false;

    // Core patterns
    this.patterns = {
      navigate: [
        /^go to (.+)/i,
        /^open (.+)/i,
        /^visit (.+)/i,
        /^launch (.+)/i,
      ],

      search: [
        /^search for (.+)/i,
        /^find (.+)/i,
        /^look up (.+)/i,
        /^google (.+)/i,
      ],

      action: [
        /^click (.+)/i,
        /^type (.+)/i,
        /^scroll (.+)/i,
        /^fill (.+)/i,
        /^download (.+)/i,
        /^upload (.+)/i,
        /^submit (.+)/i,
      ],

      system: [
        /^restart/i,
        /^shutdown/i,
        /^clear cache/i,
        /^reload/i,
        /^stop/i,
      ],

      chat: [
        /^what is/i,
        /^who is/i,
        /^explain/i,
        /^tell me/i,
        /^how (do|to)/i,
      ],
    };

    // Entity extraction patterns
    this.entityPatterns = [
      /"([^"]+)"/g,
      /'([^']+)'/g,
      /\bhttps?:\/\/\S+/g,
      /\b[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    ];
  }

  classify(input) {
    if (!input || typeof input !== "string") {
      return this._empty("invalid_input");
    }

    const raw = input.trim();
    const lower = raw.toLowerCase();

    let bestMatch = {
      type: "chat",
      intent: "unknown",
      confidence: 0.2,
    };

    // 1. Regex classification
    for (const [type, patterns] of Object.entries(this.patterns)) {
      for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (match) {
          const confidence = this._scoreConfidence(type, raw, match);

          if (confidence > bestMatch.confidence) {
            bestMatch = {
              type,
              intent: match[1] ? match[1].trim() : raw,
              confidence,
            };
          }
        }
      }
    }

    // 2. Keyword fallback scoring (lightweight NLP simulation)
    const keywordScore = this._keywordScore(lower);
    if (keywordScore.confidence > bestMatch.confidence) {
      bestMatch = keywordScore;
    }

    // 3. Entity extraction
    const entities = this._extractEntities(raw);

    const result = {
      type: bestMatch.type,
      intent: bestMatch.intent,
      confidence: Number(bestMatch.confidence.toFixed(2)),
      raw,
      entities,
    };

    if (this.debug) {
      console.log("[Classifier]", result);
    }

    return result;
  }

  _keywordScore(text) {
    const scoreMap = {
      navigate: ["open", "go", "visit", "launch"],
      search: ["search", "find", "look", "google"],
      action: ["click", "type", "scroll", "download", "upload", "submit"],
      system: ["restart", "shutdown", "reload", "clear", "stop"],
      chat: ["what", "who", "how", "why", "explain", "tell"],
    };

    let best = { type: "chat", confidence: 0.2, intent: text };

    for (const [type, keywords] of Object.entries(scoreMap)) {
      let score = 0;

      for (const kw of keywords) {
        if (text.includes(kw)) score += 0.15;
      }

      if (score > best.confidence) {
        best = {
          type,
          intent: text,
          confidence: Math.min(score, 0.95),
        };
      }
    }

    return best;
  }

  _scoreConfidence(type, raw, match) {
    let base = 0.6;

    // boost confidence for clear commands
    if (match[1]) base += 0.2;

    // type-specific boosts
    if (type === "navigate") base += 0.1;
    if (type === "action") base += 0.15;
    if (type === "system") base += 0.2;

    // length penalty for ambiguity
    if (raw.length > 80) base -= 0.1;

    return Math.max(0.1, Math.min(base, 0.98));
  }

  _extractEntities(text) {
    const entities = new Set();

    for (const pattern of this.entityPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        entities.add(match[0]);
      }
    }

    return [...entities];
  }

  _empty(reason) {
    return {
      type: "chat",
      intent: reason,
      confidence: 0,
      raw: "",
      entities: [],
    };
  }
}

module.exports = CommandClassifier;
