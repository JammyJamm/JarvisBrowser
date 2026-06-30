// planner/tokenizer.js
// Ultra-fast intent tokenizer for planner pipeline

class Tokenizer {
  constructor() {
    this.cache = new Map();
    this.punctuationRegex = /[^\w\s]/g;
    this.multiSpaceRegex = /\s+/g;
  }

  normalize(input) {
    return input
      .toLowerCase()
      .replace(this.punctuationRegex, " ")
      .replace(this.multiSpaceRegex, " ")
      .trim();
  }

  tokenize(input) {
    if (!input || typeof input !== "string") return [];

    // cache key (fast path)
    const cached = this.cache.get(input);
    if (cached) return cached;

    const normalized = this.normalize(input);

    if (!normalized) return [];

    const tokens = normalized.split(" ");

    // enrich tokens with lightweight metadata (optional planner boost)
    const enriched = tokens.filter(Boolean).map((t, i) => ({
      t,
      i,
      len: t.length,
      type: this.classifyToken(t),
    }));

    this.cache.set(input, enriched);

    // prevent memory bloat
    if (this.cache.size > 5000) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    return enriched;
  }

  classifyToken(token) {
    if (!token) return "unknown";

    if (/^\d+$/.test(token)) return "number";
    if (/^(true|false)$/i.test(token)) return "boolean";
    if (token.length <= 2) return "short";
    if (token.length > 12) return "long";
    if (/[a-z]/.test(token) && /\d/.test(token)) return "alphanumeric";

    return "word";
  }

  extractKeywords(tokens) {
    if (!Array.isArray(tokens)) return [];

    return tokens
      .filter((t) => t.type === "word" || t.type === "long")
      .map((t) => t.t);
  }

  clearCache() {
    this.cache.clear();
  }
}

export const tokenizer = new Tokenizer();
export default tokenizer;
