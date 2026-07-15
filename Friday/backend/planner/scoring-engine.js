/**
 * ==========================================================
 * backend/planner/scoring-engine.js
 *
 * Ultra Intelligent Scoring Engine
 *
 * Version 3.0
 *
 * Responsibilities
 * ----------------
 * ✔ Normalize text
 * ✔ Build searchable DOM index
 * ✔ Multi-algorithm scoring
 * ✔ Candidate ranking
 * ✔ Confidence calculation
 * ✔ Learning engine
 * ✔ Planner decision logic
 *
 * NOTE:
 * Planner NEVER performs fuzzy matching.
 * All scoring happens inside this engine.
 * ==========================================================
 */

const DEFAULT_OPTIONS = {
  //--------------------------------------------------
  // Cache
  //--------------------------------------------------

  cacheSize: 5000,

  //--------------------------------------------------
  // Score Weights
  //--------------------------------------------------

  exactWeight: 40,

  tokenWeight: 20,

  fuzzyWeight: 20,

  semanticWeight: 10,

  accessibilityWeight: 5,

  visibilityWeight: 5,

  //--------------------------------------------------
  // Thresholds
  //--------------------------------------------------

  plannerThreshold: 80,

  autoExecuteThreshold: 95,

  minimumConfidence: 60,

  //--------------------------------------------------
  // Features
  //--------------------------------------------------

  enableLearning: true,

  enableCache: true,

  enableSemantic: true,

  enableAccessibility: true,

  debug: false,
};

//==========================================================
// STOP WORDS
//==========================================================

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",

  "button",
  "link",
  "tab",
  "menu",
  "option",
  "item",

  "please",
  "kindly",

  "to",
  "on",
  "at",
  "into",
  "in",
  "of",
  "for",
  "from",

  "this",
  "that",
  "my",
  "your",
  "our",

  "click",
  "press",
  "tap",
]);

//==========================================================
// SYNONYMS
//==========================================================

const SYNONYMS = new Map([
  ["signin", "login"],
  ["sign in", "login"],
  ["log in", "login"],

  ["signup", "register"],
  ["sign up", "register"],

  ["logout", "sign out"],

  ["submit", "save"],
  ["confirm", "ok"],
  ["okay", "ok"],

  ["cancel", "close"],
  ["dismiss", "close"],

  ["next", "continue"],
  ["back", "previous"],

  ["remove", "delete"],
  ["erase", "delete"],

  ["choose", "select"],
  ["pick", "select"],

  ["press", "click"],
  ["tap", "click"],

  ["lookup", "search"],
  ["find", "search"],

  ["tick", "check"],
  ["untick", "uncheck"],

  ["clock in", "punch in"],
  ["punch in", "clock in"],

  ["clock out", "punch out"],
  ["punch out", "clock out"],
]);

//==========================================================
// LRU CACHE
//==========================================================

class LRUCache {
  constructor(limit = 5000) {
    this.limit = limit;

    this.map = new Map();
  }

  has(key) {
    return this.map.has(key);
  }

  get(key) {
    if (!this.map.has(key)) return null;

    const value = this.map.get(key);

    this.map.delete(key);

    this.map.set(key, value);

    return value;
  }

  set(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    this.map.set(key, value);

    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;

      this.map.delete(oldest);
    }
  }

  delete(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  size() {
    return this.map.size;
  }
}

//==========================================================
// SCORING ENGINE
//==========================================================

export default class ScoringEngine {
  constructor(options = {}) {
    //--------------------------------------------------
    // Configuration
    //--------------------------------------------------

    this.options = {
      ...DEFAULT_OPTIONS,

      ...options,
    };

    //--------------------------------------------------
    // DOM Index
    //--------------------------------------------------

    this.domIndex = [];

    //--------------------------------------------------
    // Learning
    //--------------------------------------------------

    this.previousSuccess = new Map();

    //--------------------------------------------------
    // Score Cache
    //--------------------------------------------------

    this.cache = new LRUCache(this.options.cacheSize);

    //--------------------------------------------------
    // Statistics
    //--------------------------------------------------

    this.metrics = {
      indexedElements: 0,

      searches: 0,

      cacheHits: 0,

      cacheMisses: 0,

      learnedMatches: 0,

      plannerRequests: 0,
    };
  }

  //==================================================
  // LOGGING
  //==================================================

  log(...args) {
    if (this.options.debug) {
      console.log("[ScoringEngine]", ...args);
    }
  }

  warn(...args) {
    console.warn("[ScoringEngine]", ...args);
  }

  error(...args) {
    console.error("[ScoringEngine]", ...args);
  }

  //==================================================
  // Part 1B
  // Normalization
  // Tokenization
  // Synonym Expansion
  // Text Utilities
  //==================================================
  //==================================================
  // NORMALIZATION
  //==================================================

  normalize(text = "") {
    if (text === null || text === undefined) return "";

    text = String(text)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    //--------------------------------------------------
    // Expand synonyms
    //--------------------------------------------------

    for (const [from, to] of SYNONYMS) {
      text = text.replaceAll(from, to);
    }

    return text;
  }

  //==================================================
  // TOKENIZATION
  //==================================================

  tokenize(text = "") {
    return this.normalize(text)

      .split(" ")

      .map((token) => token.trim())

      .filter(Boolean)

      .filter((token) => !STOP_WORDS.has(token));
  }

  //==================================================
  // UNIQUE TOKENS
  //==================================================

  uniqueTokens(text = "") {
    return [...new Set(this.tokenize(text))];
  }

  //==================================================
  // STEMMING (LIGHTWEIGHT)
  //==================================================

  stem(word = "") {
    word = this.normalize(word);

    return word

      .replace(/ing$/i, "")

      .replace(/ed$/i, "")

      .replace(/es$/i, "")

      .replace(/s$/i, "");
  }

  stemTokens(text = "") {
    return this.tokenize(text)

      .map((token) => this.stem(token))

      .filter(Boolean);
  }

  //==================================================
  // TEXT CLEANER
  //==================================================

  clean(text = "") {
    return this.normalize(text);
  }

  //==================================================
  // CANONICAL TEXT
  //==================================================

  canonical(text = "") {
    return this.stemTokens(text)

      .join(" ");
  }

  //==================================================
  // CACHE KEY
  //==================================================

  createCacheKey(query, candidate) {
    return this.canonical(query) + "::" + this.canonical(candidate);
  }

  //==================================================
  // CACHE HELPERS
  //==================================================

  getCachedScore(query, candidate) {
    if (!this.options.enableCache) return null;

    const key = this.createCacheKey(
      query,

      candidate,
    );

    const value = this.cache.get(key);

    if (value !== null) {
      this.metrics.cacheHits++;

      return value;
    }

    this.metrics.cacheMisses++;

    return null;
  }

  setCachedScore(query, candidate, value) {
    if (!this.options.enableCache) return;

    const key = this.createCacheKey(
      query,

      candidate,
    );

    this.cache.set(key, value);
  }

  clearCache() {
    this.cache.clear();
  }

  //==================================================
  // LEARNING
  //==================================================

  remember(query, candidate) {
    if (!this.options.enableLearning || !candidate) {
      return;
    }

    query = this.canonical(query);

    this.previousSuccess.set(
      query,

      candidate,
    );

    this.metrics.learnedMatches = this.previousSuccess.size;
  }

  learn(query, candidate) {
    this.remember(query, candidate);
  }

  recall(query) {
    return this.previousSuccess.get(this.canonical(query)) || null;
  }

  forget(query) {
    this.previousSuccess.delete(this.canonical(query));
  }

  clearLearning() {
    this.previousSuccess.clear();

    this.metrics.learnedMatches = 0;
  }

  //==================================================
  // Part 1C
  // DOM Index
  // Candidate Creation
  // Search Index
  //==================================================
  //==================================================
  // BUILD DOM INDEX
  //==================================================

  buildIndex(elements = []) {
    this.domIndex = [];

    for (const element of elements) {
      this.domIndex.push(this.createCandidate(element));
    }

    this.metrics.indexedElements = this.domIndex.length;

    this.log(`Indexed ${this.domIndex.length} elements.`);

    return this.domIndex;
  }

  //==================================================
  // UPDATE DOM INDEX
  //==================================================

  updateIndex(elements = []) {
    const lookup = new Map();

    //--------------------------------------------------
    // Existing
    //--------------------------------------------------

    for (const candidate of this.domIndex) {
      const key =
        candidate.id ||
        candidate.testid ||
        candidate.text ||
        `${candidate.tag}:${candidate.role}`;

      lookup.set(key, candidate);
    }

    //--------------------------------------------------
    // Merge new elements
    //--------------------------------------------------

    for (const element of elements) {
      const candidate = this.createCandidate(element);

      const key =
        candidate.id ||
        candidate.testid ||
        candidate.text ||
        `${candidate.tag}:${candidate.role}`;

      lookup.set(key, candidate);
    }

    this.domIndex = [...lookup.values()];

    this.metrics.indexedElements = this.domIndex.length;

    return this.domIndex;
  }

  //==================================================
  // CLEAR INDEX
  //==================================================

  clearIndex() {
    this.domIndex = [];

    this.metrics.indexedElements = 0;
  }

  //==================================================
  // DOM ACCESS
  //==================================================

  getIndex() {
    return this.domIndex;
  }

  getIndexedElements() {
    return this.domIndex;
  }

  elementCount() {
    return this.domIndex.length;
  }

  //==================================================
  // CREATE SEARCHABLE CANDIDATE
  //==================================================

  createCandidate(node = {}) {
    return {
      //--------------------------------------------------
      // Original
      //--------------------------------------------------

      element: node,

      //--------------------------------------------------
      // Identity
      //--------------------------------------------------

      id: node.id || "",

      role: this.normalize(node.role || ""),

      tag: (node.tagName || node.tag || "").toLowerCase(),

      //--------------------------------------------------
      // Searchable Text
      //--------------------------------------------------

      text: this.normalize(node.text || node.innerText || node.label || ""),

      aria: this.normalize(node.ariaLabel || node.aria || ""),

      placeholder: this.normalize(node.placeholder || ""),

      title: this.normalize(node.title || ""),

      alt: this.normalize(node.alt || ""),

      testid: this.normalize(node.testid || node.dataTestId || ""),

      name: this.normalize(node.name || ""),

      value: this.normalize(node.value || ""),

      //--------------------------------------------------
      // State
      //--------------------------------------------------

      visible: node.visible !== false,

      enabled: node.enabled !== false,

      checked: !!node.checked,

      selected: !!node.selected,

      editable: !!node.editable,

      //--------------------------------------------------
      // Geometry
      //--------------------------------------------------

      x: Number(node.x || 0),

      y: Number(node.y || 0),

      width: Number(node.width || 0),

      height: Number(node.height || 0),

      //--------------------------------------------------
      // Runtime
      //--------------------------------------------------

      score: 0,

      matchedField: "",

      breakdown: null,
    };
  }

  //==================================================
  // SEARCHABLE FIELDS
  //==================================================

  getSearchableFields(candidate) {
    return [
      candidate.text,

      candidate.aria,

      candidate.placeholder,

      candidate.title,

      candidate.alt,

      candidate.testid,

      candidate.name,

      candidate.value,

      candidate.id,

      candidate.role,

      candidate.tag,
    ].filter(Boolean);
  }

  //==================================================
  // INDEX SUMMARY
  //==================================================

  getIndexSummary() {
    return {
      total: this.domIndex.length,

      visible: this.domIndex.filter((item) => item.visible).length,

      enabled: this.domIndex.filter((item) => item.enabled).length,

      learned: this.previousSuccess.size,

      cache: this.cache.size(),
    };
  }

  //==================================================
  // PART 2
  // Exact Score
  // Prefix Score
  // Token Score
  // Jaro-Winkler
  // Levenshtein
  // Dice
  // Cosine
  //==================================================

  //==================================================
  // EXACT MATCH
  //==================================================

  exactScore(query, candidate) {
    query = this.normalize(query);
    candidate = this.normalize(candidate);

    if (!query || !candidate) return 0;

    if (query === candidate) return 100;

    return 0;
  }

  //==================================================
  // PREFIX SCORE
  //==================================================

  prefixScore(query, candidate) {
    query = this.normalize(query);
    candidate = this.normalize(candidate);

    if (!query || !candidate) return 0;

    if (candidate.startsWith(query)) return 95;

    if (query.startsWith(candidate)) return 90;

    return 0;
  }

  //==================================================
  // TOKEN OVERLAP SCORE
  //==================================================

  tokenScore(query, candidate) {
    const q = this.uniqueTokens(query);

    const c = this.uniqueTokens(candidate);

    if (!q.length || !c.length) return 0;

    let matches = 0;

    for (const token of q) {
      if (c.includes(token)) matches++;
    }

    return (matches / q.length) * 100;
  }

  //==================================================
  // JARO-WINKLER
  //==================================================

  jaroWinklerScore(a, b) {
    a = this.normalize(a);
    b = this.normalize(b);

    if (!a || !b) return 0;

    if (a === b) return 100;

    const len1 = a.length;
    const len2 = b.length;

    const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;

    const aMatch = new Array(len1).fill(false);

    const bMatch = new Array(len2).fill(false);

    let matches = 0;

    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchDistance);

      const end = Math.min(i + matchDistance + 1, len2);

      for (let j = start; j < end; j++) {
        if (bMatch[j]) continue;

        if (a[i] !== b[j]) continue;

        aMatch[i] = true;
        bMatch[j] = true;

        matches++;

        break;
      }
    }

    if (!matches) return 0;

    let transpositions = 0;
    let k = 0;

    for (let i = 0; i < len1; i++) {
      if (!aMatch[i]) continue;

      while (!bMatch[k]) k++;

      if (a[i] !== b[k]) transpositions++;

      k++;
    }

    transpositions /= 2;

    let score =
      (matches / len1 + matches / len2 + (matches - transpositions) / matches) /
      3;

    let prefix = 0;

    for (let i = 0; i < Math.min(4, len1, len2); i++) {
      if (a[i] === b[i]) prefix++;
      else break;
    }

    score += prefix * 0.1 * (1 - score);

    return Math.min(100, score * 100);
  }

  //==================================================
  // LEVENSHTEIN
  //==================================================

  levenshteinScore(a, b) {
    a = this.normalize(a);
    b = this.normalize(b);

    if (!a || !b) return 0;

    if (a === b) return 100;

    const rows = b.length + 1;
    const cols = a.length + 1;

    const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));

    for (let i = 0; i < rows; i++) matrix[i][0] = i;

    for (let j = 0; j < cols; j++) matrix[0][j] = j;

    for (let i = 1; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        if (b[i - 1] === a[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1,

            matrix[i][j - 1] + 1,

            matrix[i - 1][j - 1] + 1,
          );
        }
      }
    }

    const distance = matrix[rows - 1][cols - 1];

    const longest = Math.max(a.length, b.length);

    return Math.max(
      0,

      (1 - distance / longest) * 100,
    );
  }

  //==================================================
  // DICE COEFFICIENT
  //==================================================

  diceScore(a, b) {
    a = this.normalize(a);
    b = this.normalize(b);

    if (!a || !b) return 0;

    if (a === b) return 100;

    if (a.length < 2 || b.length < 2) {
      return 0;
    }

    const map = new Map();

    for (let i = 0; i < a.length - 1; i++) {
      const gram = a.substring(i, i + 2);

      map.set(
        gram,

        (map.get(gram) || 0) + 1,
      );
    }

    let matches = 0;

    for (let i = 0; i < b.length - 1; i++) {
      const gram = b.substring(i, i + 2);

      const count = map.get(gram);

      if (!count) continue;

      map.set(gram, count - 1);

      matches++;
    }

    return ((2 * matches) / (a.length - 1 + (b.length - 1))) * 100;
  }

  //==================================================
  // COSINE SIMILARITY
  //==================================================

  cosineScore(a, b) {
    const wordsA = this.stemTokens(a);

    const wordsB = this.stemTokens(b);

    if (!wordsA.length || !wordsB.length) {
      return 0;
    }

    const vocabulary = [...new Set([...wordsA, ...wordsB])];

    let dot = 0;
    let magA = 0;
    let magB = 0;

    for (const word of vocabulary) {
      const countA = wordsA.filter((x) => x === word).length;

      const countB = wordsB.filter((x) => x === word).length;

      dot += countA * countB;

      magA += countA * countA;

      magB += countB * countB;
    }

    if (!magA || !magB) return 0;

    return (dot / (Math.sqrt(magA) * Math.sqrt(magB))) * 100;
  }

  //==================================================
  // PART 3
  // Semantic Score
  // Accessibility Score
  // Visibility Score
  // Combined Weighted Score
  //==================================================
  //==================================================
  // SEMANTIC SCORE
  //==================================================

  semanticScore(query, candidate) {
    if (!this.options.enableSemantic) return 0;

    query = this.canonical(query);
    candidate = this.canonical(candidate);

    if (!query || !candidate) return 0;

    //--------------------------------------------------
    // Learned mapping gets maximum confidence
    //--------------------------------------------------

    const learned = this.recall(query);

    if (learned && learned.text === candidate) {
      return 100;
    }

    //--------------------------------------------------
    // Canonical equality
    //--------------------------------------------------

    if (query === candidate) return 100;

    //--------------------------------------------------
    // Average semantic similarity
    //--------------------------------------------------

    const cosine = this.cosineScore(query, candidate);

    const token = this.tokenScore(query, candidate);

    return cosine * 0.7 + token * 0.3;
  }

  //==================================================
  // ACCESSIBILITY SCORE
  //==================================================

  accessibilityScore(candidate) {
    if (!this.options.enableAccessibility) {
      return 0;
    }

    let score = 0;

    if (candidate.role) score += 25;

    if (candidate.aria) score += 25;

    if (candidate.name) score += 20;

    if (candidate.title) score += 10;

    if (candidate.placeholder) score += 10;

    if (candidate.testid) score += 10;

    return Math.min(100, score);
  }

  //==================================================
  // VISIBILITY SCORE
  //==================================================

  visibilityScore(candidate) {
    let score = 0;

    if (candidate.visible) score += 70;

    if (candidate.enabled) score += 30;

    return score;
  }

  //==================================================
  // SCORE SINGLE CANDIDATE
  //==================================================

  scoreCandidate(query, candidate) {
    query = this.normalize(query);

    const text = candidate.text || "";

    //--------------------------------------------------
    // Cache
    //--------------------------------------------------

    const cached = this.getCachedScore(query, text);

    if (cached) {
      return cached;
    }

    //--------------------------------------------------
    // Individual Scores
    //--------------------------------------------------

    const exact = this.exactScore(query, text);

    const prefix = this.prefixScore(query, text);

    const token = this.tokenScore(query, text);

    const jaro = this.jaroWinklerScore(query, text);

    const levenshtein = this.levenshteinScore(query, text);

    const dice = this.diceScore(query, text);

    const cosine = this.cosineScore(query, text);

    const semantic = this.semanticScore(query, text);

    const accessibility = this.accessibilityScore(candidate);

    const visibility = this.visibilityScore(candidate);

    //--------------------------------------------------
    // Best fuzzy algorithm
    //--------------------------------------------------

    const fuzzy = Math.max(
      prefix,

      jaro,

      levenshtein,

      dice,
    );

    //--------------------------------------------------
    // Weighted score
    //--------------------------------------------------

    const score =
      (exact * this.options.exactWeight +
        token * this.options.tokenWeight +
        fuzzy * this.options.fuzzyWeight +
        semantic * this.options.semanticWeight +
        accessibility * this.options.accessibilityWeight +
        visibility * this.options.visibilityWeight) /
      (this.options.exactWeight +
        this.options.tokenWeight +
        this.options.fuzzyWeight +
        this.options.semanticWeight +
        this.options.accessibilityWeight +
        this.options.visibilityWeight);

    const result = {
      score,

      details: {
        exact,

        prefix,

        token,

        jaro,

        levenshtein,

        dice,

        cosine,

        semantic,

        accessibility,

        visibility,
      },
    };

    this.setCachedScore(
      query,

      text,

      result,
    );

    return result;
  }

  //==================================================
  // SCORE SEARCHABLE FIELD
  //==================================================

  scoreField(query, candidate, field) {
    const value = candidate[field];

    if (!value) {
      return {
        score: 0,

        details: null,
      };
    }

    return this.scoreCandidate(
      query,

      {
        ...candidate,

        text: value,
      },
    );
  }

  //==================================================
  // PART 4
  // Candidate Ranking
  // Search
  // Planner Decision
  // Resolution
  //==================================================

  //==================================================
  // RANK CANDIDATES
  //==================================================

  rankCandidates(query, candidates = this.domIndex) {
    this.metrics.searches++;

    const ranked = [];

    //--------------------------------------------------
    // Learned result first
    //--------------------------------------------------

    const learned = this.recall(query);

    for (const candidate of candidates) {
      let bestScore = 0;

      let bestField = "";

      let bestBreakdown = null;

      //--------------------------------------------------
      // Learned boost
      //--------------------------------------------------

      if (learned && (learned === candidate || learned.id === candidate.id)) {
        bestScore = 100;

        bestField = "learned";

        bestBreakdown = {
          learned: 100,
        };
      }

      //--------------------------------------------------
      // Search every field
      //--------------------------------------------------

      const fields = this.getSearchableFields(candidate);

      for (const field of fields) {
        const result = this.scoreCandidate(
          query,

          {
            ...candidate,

            text: field,
          },
        );

        if (result.score > bestScore) {
          bestScore = result.score;

          bestField = field;

          bestBreakdown = result.details;
        }
      }

      ranked.push({
        ...candidate,

        score: Number(bestScore.toFixed(2)),

        matchedField: bestField,

        breakdown: bestBreakdown,
      });
    }

    //--------------------------------------------------
    // Highest score first
    //--------------------------------------------------

    ranked.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      //--------------------------------------------------
      // Prefer visible
      //--------------------------------------------------

      if (a.visible !== b.visible) {
        return Number(b.visible) - Number(a.visible);
      }

      //--------------------------------------------------
      // Prefer enabled
      //--------------------------------------------------

      if (a.enabled !== b.enabled) {
        return Number(b.enabled) - Number(a.enabled);
      }

      //--------------------------------------------------
      // Prefer buttons
      //--------------------------------------------------

      const priority = {
        button: 5,

        a: 4,

        input: 3,

        select: 2,

        div: 1,
      };

      return (priority[b.tag] || 0) - (priority[a.tag] || 0);
    });

    return ranked;
  }

  //==================================================
  // SEARCH
  //==================================================

  search(query, candidates = this.domIndex) {
    query = this.normalize(query);

    if (!query || !candidates.length) {
      return [];
    }

    const ranked = this.rankCandidates(
      query,

      candidates,
    );

    return ranked.filter(
      (item) => item.score >= this.options.minimumConfidence,
    );
  }

  //==================================================
  // FIND BEST CANDIDATE
  //==================================================

  findBestCandidate(query, candidates = this.domIndex) {
    const ranked = this.rankCandidates(
      query,

      candidates,
    );

    if (!ranked.length) {
      return {
        found: false,

        candidate: null,

        confidence: 0,

        ambiguous: false,

        plannerRequired: true,

        autoExecute: false,

        ranked: [],
      };
    }

    const best = ranked[0];

    const second = ranked[1] || null;

    const confidence = best.score;

    const ambiguous = second && Math.abs(best.score - second.score) < 5;

    return {
      found: confidence >= this.options.plannerThreshold,

      candidate: best,

      confidence,

      ambiguous,

      plannerRequired: confidence < this.options.plannerThreshold || ambiguous,

      autoExecute:
        confidence >= this.options.autoExecuteThreshold && !ambiguous,

      ranked,
    };
  }

  //==================================================
  // SHOULD USE PLANNER
  //==================================================

  shouldUsePlanner(result) {
    if (!result) return true;

    if (!result.found) return true;

    if (result.ambiguous) return true;

    if (result.confidence < this.options.plannerThreshold) {
      return true;
    }

    return false;
  }

  //==================================================
  // PLANNER REQUEST
  //==================================================

  requestPlanner() {
    this.metrics.plannerRequests++;
  }

  //==================================================
  // PART 4B
  // Resolve
  // Statistics
  // Metrics
  // Export Helpers
  //==================================================
  //==================================================
  // RESOLVE
  //==================================================

  resolve(query, candidates = this.domIndex) {
    this.metrics.searches++;

    const ranked = this.search(query, candidates);

    if (!ranked.length) {
      this.metrics.plannerRequests++;

      return {
        success: false,

        confidence: 0,

        plannerRequired: true,

        autoExecute: false,

        ambiguous: false,

        best: null,

        candidates: [],
      };
    }

    const decision = this.findBestCandidate(query, ranked);

    if (decision.best && decision.autoExecute && this.options.enableLearning) {
      this.learn(query, decision.best);
    }

    if (decision.plannerRequired) {
      this.metrics.plannerRequests++;
    }

    return {
      success: !!decision.best,

      confidence: decision.confidence,

      plannerRequired: decision.plannerRequired,

      autoExecute: decision.autoExecute,

      ambiguous: decision.ambiguous,

      best: decision.best,

      candidates: decision.ranked.slice(0, 10),
    };
  }

  //==================================================
  // EXECUTION SUCCESS
  //==================================================

  recordSuccess(query, candidate) {
    if (!candidate) return;

    this.learn(query, candidate);
  }

  //==================================================
  // EXECUTION FAILURE
  //==================================================

  recordFailure(query) {
    this.forget(query);
  }

  //==================================================
  // REMOVE LEARNED ENTRY
  //==================================================

  removeLearned(query) {
    this.forget(query);
  }

  //==================================================
  // RESET ENGINE
  //==================================================

  reset() {
    this.clearIndex();

    this.clearCache();

    this.clearLearning();

    this.resetMetrics();
  }

  //==================================================
  // RESET METRICS
  //==================================================

  resetMetrics() {
    this.metrics = {
      indexedElements: 0,

      searches: 0,

      cacheHits: 0,

      cacheMisses: 0,

      learnedMatches: 0,

      plannerRequests: 0,
    };
  }

  //==================================================
  // METRICS
  //==================================================

  getMetrics() {
    return {
      ...this.metrics,

      cacheSize: this.cache.size(),

      learnedEntries: this.previousSuccess.size,

      indexedElements: this.domIndex.length,

      cacheHitRate:
        this.metrics.cacheHits + this.metrics.cacheMisses
          ? (this.metrics.cacheHits /
              (this.metrics.cacheHits + this.metrics.cacheMisses)) *
            100
          : 0,
    };
  }

  //==================================================
  // STATS
  //==================================================

  stats() {
    return {
      indexedElements: this.domIndex.length,

      learnedMatches: this.previousSuccess.size,

      cacheEntries: this.cache.size(),

      thresholds: {
        planner: this.options.plannerThreshold,

        autoExecute: this.options.autoExecuteThreshold,

        minimumConfidence: this.options.minimumConfidence,
      },

      metrics: this.getMetrics(),
    };
  }

  //==================================================
  // EXPORT
  //==================================================

  exportLearning() {
    return {
      learned: [...this.previousSuccess.entries()],

      metrics: this.getMetrics(),
    };
  }

  //==================================================
  // IMPORT
  //==================================================

  importLearning(data = {}) {
    this.clearLearning();

    if (Array.isArray(data.learned)) {
      for (const [query, candidate] of data.learned) {
        this.previousSuccess.set(query, candidate);
      }
    }

    this.metrics.learnedMatches = this.previousSuccess.size;
  }

  //==================================================
  // DEBUG
  //==================================================

  debugSummary() {
    return {
      options: this.options,

      indexSummary: this.getIndexSummary(),

      metrics: this.getMetrics(),

      learnedQueries: [...this.previousSuccess.keys()],
    };
  }
}
