// backend/planner/tokenizer.js
//
// Ultra-fast intent tokenizer for Jarvis Browser Planner
//
// Responsibilities
// ----------------
// ✔ Fast input normalization
// ✔ Token extraction
// ✔ Token classification
// ✔ Keyword extraction
// ✔ Phrase detection
// ✔ Stop-word filtering
// ✔ Lightweight token metadata
// ✔ LRU-style cache protection
// ✔ Compatible with ScoringEngine
//
// IMPORTANT
// ---------
// Tokenizer does NOT perform fuzzy matching.
// Tokenizer does NOT perform DOM matching.
// Tokenizer does NOT make planner decisions.
//
// Pipeline
// --------
// User Input
//    ↓
// Tokenizer
//    ↓
// Normalizer
//    ↓
// Intent Parser
//    ↓
// Scoring Engine
//

const DEFAULT_OPTIONS = Object.freeze({
  cacheSize: 5000,
  maxTokens: 100,
  minKeywordLength: 2,
  preserveNumbers: true,
  removeStopWords: false,
});

//==========================================================
// STOP WORDS
//==========================================================

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",

  "please",
  "kindly",

  "to",
  "on",
  "at",
  "in",
  "into",
  "of",
  "for",
  "from",
  "with",

  "this",
  "that",
  "these",
  "those",

  "is",
  "are",
  "was",
  "were",

  "me",
  "my",
  "your",
  "our",
]);

//==========================================================
// TOKENIZER
//==========================================================

class Tokenizer {
  constructor(options = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    //------------------------------------------------------
    // Cache
    //------------------------------------------------------

    this.cache = new Map();

    //------------------------------------------------------
    // Regex
    //------------------------------------------------------

    this.punctuationRegex = /[^\w\s:/.-]/g;

    this.multiSpaceRegex = /\s+/g;

    this.numberRegex = /^\d+(\.\d+)?$/;

    this.booleanRegex = /^(true|false)$/i;

    this.alphanumericRegex = /^(?=.*[a-z])(?=.*\d)[a-z\d_-]+$/i;
  }

  //========================================================
  // NORMALIZE
  //========================================================

  normalize(input = "") {
    if (input === null || input === undefined) {
      return "";
    }

    if (typeof input !== "string") {
      input = String(input);
    }

    return input
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(this.punctuationRegex, " ")
      .replace(this.multiSpaceRegex, " ")
      .trim();
  }

  //========================================================
  // TOKENIZE
  //========================================================

  tokenize(input) {
    if (!input || typeof input !== "string") {
      return [];
    }

    //------------------------------------------------------
    // Fast cache lookup
    //------------------------------------------------------

    const cached = this.cache.get(input);

    if (cached) {
      return cached;
    }

    //------------------------------------------------------
    // Normalize
    //------------------------------------------------------

    const normalized = this.normalize(input);

    if (!normalized) {
      return [];
    }

    //------------------------------------------------------
    // Split tokens
    //------------------------------------------------------

    const rawTokens = normalized
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, this.options.maxTokens);

    //------------------------------------------------------
    // Enrich tokens
    //------------------------------------------------------

    const enriched = rawTokens.map((token, index) => ({
      t: token,

      i: index,

      len: token.length,

      type: this.classifyToken(token),

      normalized: token,

      isKeyword: this.isKeyword(token),

      isStopWord: STOP_WORDS.has(token),
    }));

    //------------------------------------------------------
    // Cache
    //------------------------------------------------------

    this.cache.set(input, enriched);

    this._trimCache();

    return enriched;
  }

  //========================================================
  // CLASSIFY TOKEN
  //========================================================

  classifyToken(token) {
    if (!token) {
      return "unknown";
    }

    //------------------------------------------------------
    // Number
    //------------------------------------------------------

    if (this.numberRegex.test(token)) {
      return "number";
    }

    //------------------------------------------------------
    // Boolean
    //------------------------------------------------------

    if (this.booleanRegex.test(token)) {
      return "boolean";
    }

    //------------------------------------------------------
    // URL / Domain
    //------------------------------------------------------

    if (
      token.includes("://") ||
      token.startsWith("www.") ||
      /\.(com|org|net|io|in|ai)$/i.test(token)
    ) {
      return "url";
    }

    //------------------------------------------------------
    // Alphanumeric
    //------------------------------------------------------

    if (this.alphanumericRegex.test(token)) {
      return "alphanumeric";
    }

    //------------------------------------------------------
    // Short token
    //------------------------------------------------------

    if (token.length <= 2) {
      return "short";
    }

    //------------------------------------------------------
    // Long token
    //------------------------------------------------------

    if (token.length > 12) {
      return "long";
    }

    //------------------------------------------------------
    // Default
    //------------------------------------------------------

    return "word";
  }

  //========================================================
  // KEYWORD CHECK
  //========================================================

  isKeyword(token) {
    if (!token) {
      return false;
    }

    if (STOP_WORDS.has(token)) {
      return false;
    }

    if (
      token.length < this.options.minKeywordLength &&
      !this.numberRegex.test(token)
    ) {
      return false;
    }

    return true;
  }

  //========================================================
  // EXTRACT KEYWORDS
  //========================================================

  extractKeywords(tokens) {
    if (!Array.isArray(tokens)) {
      return [];
    }

    return tokens
      .filter((token) => token && token.isKeyword)
      .map((token) => token.t);
  }

  //========================================================
  // EXTRACT UNIQUE KEYWORDS
  //========================================================

  extractUniqueKeywords(tokens) {
    return [...new Set(this.extractKeywords(tokens))];
  }

  //========================================================
  // EXTRACT TOKEN VALUES
  //========================================================

  getTokenValues(tokens) {
    if (!Array.isArray(tokens)) {
      return [];
    }

    return tokens
      .filter(Boolean)
      .map((token) => token.t)
      .filter(Boolean);
  }

  //========================================================
  // BUILD PHRASES
  //========================================================
  //
  // Example:
  //
  // "click punch in button"
  //
  // Generates:
  //
  // click punch
  // punch in
  // in button
  //
  // This helps downstream intent parsing without fuzzy logic.
  //

  buildPhrases(tokens, size = 2) {
    if (!Array.isArray(tokens) || size < 2) {
      return [];
    }

    const values = this.getTokenValues(tokens);

    const phrases = [];

    for (let i = 0; i <= values.length - size; i++) {
      phrases.push(values.slice(i, i + size).join(" "));
    }

    return phrases;
  }

  //========================================================
  // BUILD ALL PHRASES
  //========================================================

  buildAllPhrases(tokens, maxSize = 3) {
    if (!Array.isArray(tokens)) {
      return [];
    }

    const phrases = [];

    for (let size = 2; size <= maxSize; size++) {
      phrases.push(...this.buildPhrases(tokens, size));
    }

    return [...new Set(phrases)];
  }

  //========================================================
  // ANALYZE INPUT
  //========================================================

  analyze(input) {
    const normalized = this.normalize(input);

    const tokens = this.tokenize(input);

    return {
      original: input,

      normalized,

      tokens,

      values: this.getTokenValues(tokens),

      keywords: this.extractKeywords(tokens),

      uniqueKeywords: this.extractUniqueKeywords(tokens),

      phrases: this.buildAllPhrases(tokens),

      tokenCount: tokens.length,
    };
  }

  //========================================================
  // CACHE MANAGEMENT
  //========================================================

  _trimCache() {
    while (this.cache.size > this.options.cacheSize) {
      const firstKey = this.cache.keys().next().value;

      this.cache.delete(firstKey);
    }
  }

  //========================================================
  // CACHE ACCESS
  //========================================================

  hasCached(input) {
    return this.cache.has(input);
  }

  //========================================================
  // CACHE CLEAR
  //========================================================

  clearCache() {
    this.cache.clear();
  }

  //========================================================
  // CACHE SIZE
  //========================================================

  cacheSize() {
    return this.cache.size;
  }

  //========================================================
  // STATS
  //========================================================

  stats() {
    return {
      cacheSize: this.cache.size,
      maxCacheSize: this.options.cacheSize,
    };
  }
}

//==========================================================
// SINGLETON
//==========================================================

export const tokenizer = new Tokenizer();

//==========================================================
// DEFAULT EXPORT
//==========================================================

export default tokenizer;
