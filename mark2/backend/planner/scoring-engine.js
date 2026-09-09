/**
 * ==========================================================
 * backend/planner/scoring-engine.js
 *
 * Ultra Intelligent Scoring Engine
 *
 * Version 4.0
 *
 * Architecture
 * ----------------------------------------------------------
 *
 * User Command
 *      │
 *      ▼
 * Intent Parser
 *      │
 *      │  action = click
 *      │  target = punch in
 *      ▼
 * Scoring Engine
 *      │
 *      ├── Normalization
 *      ├── Synonym Expansion
 *      ├── Token Matching
 *      ├── Fuzzy Matching
 *      ├── Typo Detection
 *      ├── Semantic Matching
 *      ├── Accessibility
 *      ├── Visibility
 *      ├── Actionability
 *      ├── Learning
 *      └── Candidate Ranking
 *      │
 *      ├── High Confidence
 *      │       └── Auto Execute
 *      │
 *      └── Low / Ambiguous
 *              └── Planner
 *
 * Responsibilities
 * ----------------
 * ✔ Normalize text
 * ✔ Remove command noise
 * ✔ Expand synonyms
 * ✔ Build searchable DOM index
 * ✔ Multi-field scoring
 * ✔ Exact matching
 * ✔ Prefix matching
 * ✔ Token matching
 * ✔ Token-level fuzzy matching
 * ✔ Jaro-Winkler
 * ✔ Levenshtein
 * ✔ Dice coefficient
 * ✔ Cosine similarity
 * ✔ Semantic scoring
 * ✔ Accessibility scoring
 * ✔ Visibility scoring
 * ✔ Actionability scoring
 * ✔ Candidate ranking
 * ✔ Confidence calculation
 * ✔ Ambiguity detection
 * ✔ Learning engine
 * ✔ Planner decision logic
 * ✔ LRU score cache
 *
 * IMPORTANT
 * ----------------------------------------------------------
 * Planner NEVER performs fuzzy matching.
 *
 * All fuzzy matching and candidate ranking happens here.
 *
 * Example
 * ----------------------------------------------------------
 *
 * Input:
 *   "Click Punch In"
 *
 * DOM:
 *   <button>Punch In</button>
 *
 * Result:
 *   confidence ≈ 100
 *   plannerRequired = false
 *   autoExecute = true
 *
 * Input:
 *   "Click Punh In"
 *
 * DOM:
 *   <button>Punch In</button>
 *
 * Result:
 *   high fuzzy confidence
 *   plannerRequired = false
 *   autoExecute = true
 *
 * Input:
 *   "Click Punch Inn"
 *
 * DOM:
 *   <button>Punch In</button>
 *
 * Result:
 *   high fuzzy confidence
 *
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
  // Advanced Weights
  //--------------------------------------------------

  actionabilityWeight: 8,

  fieldWeight: 10,

  //--------------------------------------------------
  // Thresholds
  //--------------------------------------------------

  plannerThreshold: 80,

  autoExecuteThreshold: 95,

  minimumConfidence: 60,

  //--------------------------------------------------
  // Ambiguity
  //--------------------------------------------------

  ambiguityMargin: 5,

  strongMatchMargin: 12,

  //--------------------------------------------------
  // Features
  //--------------------------------------------------

  enableLearning: true,

  enableCache: true,

  enableSemantic: true,

  enableAccessibility: true,

  enableActionability: true,

  enableTokenFuzzy: true,

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
  "buttons",

  "link",
  "links",

  "tab",
  "tabs",

  "menu",
  "menus",

  "option",
  "options",

  "item",
  "items",

  "element",
  "elements",

  "control",
  "controls",

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

  "select",
  "choose",
  "pick",

  "type",
  "enter",
  "input",

  "fill",
]);

//==========================================================
// COMMAND WORDS
//==========================================================

const COMMAND_WORDS = new Set([
  "click",
  "press",
  "tap",
  "select",
  "choose",
  "pick",
  "type",
  "enter",
  "fill",
  "write",
  "input",
  "check",
  "uncheck",
  "tick",
  "untick",
  "open",
  "close",
  "submit",
  "save",
  "delete",
  "remove",
]);

//==========================================================
// SYNONYMS
//==========================================================

const SYNONYMS = new Map([
  //--------------------------------------------------
  // Authentication
  //--------------------------------------------------

  ["signin", "login"],
  ["sign in", "login"],
  ["log in", "login"],

  ["signup", "register"],
  ["sign up", "register"],

  ["logout", "sign out"],
  ["log out", "sign out"],

  //--------------------------------------------------
  // Actions
  //--------------------------------------------------

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

  //--------------------------------------------------
  // Attendance
  //--------------------------------------------------

  ["clock in", "punch in"],
  ["clock out", "punch out"],

  //--------------------------------------------------
  // Common UI
  //--------------------------------------------------

  ["hamburger", "menu"],
  ["settings", "setting"],
  ["preferences", "setting"],
]);

//==========================================================
// ACTION ALIASES
//==========================================================

const ACTION_ALIASES = new Map([
  ["click", "click"],
  ["press", "click"],
  ["tap", "click"],

  ["select", "select"],
  ["choose", "select"],
  ["pick", "select"],

  ["type", "type"],
  ["enter", "type"],
  ["fill", "type"],
  ["write", "type"],
  ["input", "type"],

  ["check", "check"],
  ["tick", "check"],

  ["uncheck", "uncheck"],
  ["untick", "uncheck"],

  ["open", "open"],
  ["close", "close"],

  ["submit", "submit"],
  ["save", "save"],

  ["delete", "delete"],
  ["remove", "delete"],
]);

//==========================================================
// LRU CACHE
//==========================================================

class LRUCache {
  constructor(limit = 5000) {
    this.limit = Math.max(1, Number(limit) || 5000);

    this.map = new Map();
  }

  has(key) {
    return this.map.has(key);
  }

  get(key) {
    if (!this.map.has(key)) {
      return null;
    }

    const value = this.map.get(key);

    //--------------------------------------------------
    // Refresh LRU position
    //--------------------------------------------------

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

      exactMatches: 0,

      fuzzyMatches: 0,

      ambiguousMatches: 0,

      autoExecutions: 0,
    };
  }

  //========================================================
  // LOGGING
  //========================================================

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

  //========================================================
  // NORMALIZATION
  //========================================================

  normalize(text = "") {
    if (text === null || text === undefined) {
      return "";
    }

    let value = String(text)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[_-]+/g, " ")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    //--------------------------------------------------
    // Expand multi-word synonyms first
    //--------------------------------------------------

    const synonymEntries = [...SYNONYMS.entries()].sort(
      (a, b) => b[0].length - a[0].length,
    );

    for (const [from, to] of synonymEntries) {
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      value = value.replace(new RegExp(`\\b${escaped}\\b`, "gi"), to);
    }

    //--------------------------------------------------
    // Final whitespace cleanup
    //--------------------------------------------------

    return value.replace(/\s+/g, " ").trim();
  }

  //========================================================
  // EXTRACT ACTION
  //========================================================

  extractAction(text = "") {
    const normalized = this.normalize(text);

    if (!normalized) {
      return {
        action: "",
        target: "",
      };
    }

    const tokens = normalized.split(" ");

    const actionIndex = tokens.findIndex((token) => ACTION_ALIASES.has(token));

    if (actionIndex === -1) {
      return {
        action: "",
        target: normalized,
      };
    }

    const rawAction = tokens[actionIndex];

    const action = ACTION_ALIASES.get(rawAction) || rawAction;

    const targetTokens = tokens.filter((_, index) => index !== actionIndex);

    return {
      action,

      target: targetTokens.join(" ").trim(),
    };
  }

  //========================================================
  // REMOVE COMMAND WORDS
  //========================================================

  removeCommandWords(text = "") {
    return this.normalize(text)
      .split(" ")
      .filter(Boolean)
      .filter((token) => !COMMAND_WORDS.has(token))
      .join(" ")
      .trim();
  }

  //========================================================
  // TOKENIZATION
  //========================================================

  tokenize(text = "") {
    return this.normalize(text)
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean)
      .filter((token) => !STOP_WORDS.has(token));
  }

  //========================================================
  // UNIQUE TOKENS
  //========================================================

  uniqueTokens(text = "") {
    return [...new Set(this.tokenize(text))];
  }

  //========================================================
  // LIGHTWEIGHT STEMMING
  //========================================================

  stem(word = "") {
    word = this.normalize(word);

    if (!word) {
      return "";
    }

    //--------------------------------------------------
    // Keep short words untouched
    //--------------------------------------------------

    if (word.length <= 3) {
      return word;
    }

    //--------------------------------------------------
    // Conservative stemming
    //--------------------------------------------------

    if (word.endsWith("ing") && word.length > 5) {
      return word.slice(0, -3);
    }

    if (word.endsWith("ed") && word.length > 4) {
      return word.slice(0, -2);
    }

    if (word.endsWith("es") && word.length > 4) {
      return word.slice(0, -2);
    }

    if (word.endsWith("s") && word.length > 3) {
      return word.slice(0, -1);
    }

    return word;
  }

  //========================================================
  // STEM TOKENS
  //========================================================

  stemTokens(text = "") {
    return this.tokenize(text)
      .map((token) => this.stem(token))
      .filter(Boolean);
  }

  //========================================================
  // TEXT CLEANER
  //========================================================

  clean(text = "") {
    return this.normalize(text);
  }

  //========================================================
  // CANONICAL TEXT
  //========================================================

  canonical(text = "") {
    return this.stemTokens(text).join(" ");
  }

  //========================================================
  // CACHE KEY
  //========================================================

  createCacheKey(query, candidate) {
    return [this.canonical(query), this.canonical(candidate)].join("::");
  }

  //========================================================
  // CACHE GET
  //========================================================

  getCachedScore(query, candidate) {
    if (!this.options.enableCache) {
      return null;
    }

    const key = this.createCacheKey(query, candidate);

    const value = this.cache.get(key);

    if (value !== null) {
      this.metrics.cacheHits++;

      return value;
    }

    this.metrics.cacheMisses++;

    return null;
  }

  //========================================================
  // CACHE SET
  //========================================================

  setCachedScore(query, candidate, value) {
    if (!this.options.enableCache) {
      return;
    }

    const key = this.createCacheKey(query, candidate);

    this.cache.set(key, value);
  }

  //========================================================
  // CLEAR CACHE
  //========================================================

  clearCache() {
    this.cache.clear();
  }

  //========================================================
  // LEARNING
  //========================================================

  remember(query, candidate) {
    if (!this.options.enableLearning || !candidate) {
      return;
    }

    const canonicalQuery = this.canonical(query);

    if (!canonicalQuery) {
      return;
    }

    this.previousSuccess.set(canonicalQuery, candidate);

    this.metrics.learnedMatches = this.previousSuccess.size;
  }

  //========================================================
  // LEARN
  //========================================================

  learn(query, candidate) {
    this.remember(query, candidate);
  }

  //========================================================
  // RECALL
  //========================================================

  recall(query) {
    return this.previousSuccess.get(this.canonical(query)) || null;
  }

  //========================================================
  // FORGET
  //========================================================

  forget(query) {
    this.previousSuccess.delete(this.canonical(query));
  }

  //========================================================
  // CLEAR LEARNING
  //========================================================

  clearLearning() {
    this.previousSuccess.clear();

    this.metrics.learnedMatches = 0;
  }

  //========================================================
  // BUILD DOM INDEX
  //========================================================

  buildIndex(elements = []) {
    this.domIndex = [];

    for (const element of elements) {
      if (!element) {
        continue;
      }

      this.domIndex.push(this.createCandidate(element));
    }

    this.metrics.indexedElements = this.domIndex.length;

    //--------------------------------------------------
    // DOM changed → cached ranking may be stale
    //--------------------------------------------------

    this.clearCache();

    this.log(`Indexed ${this.domIndex.length} elements.`);

    return this.domIndex;
  }

  //========================================================
  // CANDIDATE KEY
  //========================================================

  getCandidateKey(candidate) {
    if (!candidate) {
      return "";
    }

    return (
      candidate.id ||
      candidate.testid ||
      candidate.text ||
      candidate.aria ||
      [candidate.tag, candidate.role, candidate.x, candidate.y].join(":")
    );
  }

  //========================================================
  // UPDATE DOM INDEX
  //========================================================

  updateIndex(elements = []) {
    const lookup = new Map();

    //--------------------------------------------------
    // Existing candidates
    //--------------------------------------------------

    for (const candidate of this.domIndex) {
      const key = this.getCandidateKey(candidate);

      if (key) {
        lookup.set(key, candidate);
      }
    }

    //--------------------------------------------------
    // New candidates
    //--------------------------------------------------

    for (const element of elements) {
      if (!element) {
        continue;
      }

      const candidate = this.createCandidate(element);

      const key = this.getCandidateKey(candidate);

      if (key) {
        lookup.set(key, candidate);
      }
    }

    this.domIndex = [...lookup.values()];

    this.metrics.indexedElements = this.domIndex.length;

    this.clearCache();

    return this.domIndex;
  }

  //========================================================
  // CLEAR INDEX
  //========================================================

  clearIndex() {
    this.domIndex = [];

    this.metrics.indexedElements = 0;

    this.clearCache();
  }

  //========================================================
  // DOM ACCESS
  //========================================================

  getIndex() {
    return this.domIndex;
  }

  getIndexedElements() {
    return this.domIndex;
  }

  elementCount() {
    return this.domIndex.length;
  }

  //========================================================
  // CREATE SEARCHABLE CANDIDATE
  //========================================================

  createCandidate(node = {}) {
    const tag = (node.tagName || node.tag || "").toLowerCase();

    return {
      //--------------------------------------------------
      // Original element
      //--------------------------------------------------

      element: node,

      //--------------------------------------------------
      // Identity
      //--------------------------------------------------

      id: String(node.id || ""),

      role: this.normalize(node.role || ""),

      tag,

      //--------------------------------------------------
      // Searchable text
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

  //========================================================
  // SEARCHABLE FIELDS
  //========================================================

  getSearchableFields(candidate) {
    if (!candidate) {
      return [];
    }

    const fields = [
      ["text", candidate.text],
      ["aria", candidate.aria],
      ["placeholder", candidate.placeholder],
      ["title", candidate.title],
      ["alt", candidate.alt],
      ["testid", candidate.testid],
      ["name", candidate.name],
      ["value", candidate.value],
      ["id", candidate.id],
      ["role", candidate.role],
      ["tag", candidate.tag],
    ];

    return fields.filter(([, value]) => Boolean(value));
  }

  //========================================================
  // INDEX SUMMARY
  //========================================================

  getIndexSummary() {
    return {
      total: this.domIndex.length,

      visible: this.domIndex.filter((item) => item.visible).length,

      enabled: this.domIndex.filter((item) => item.enabled).length,

      actionable: this.domIndex.filter((item) =>
        this.isActionableCandidate(item),
      ).length,

      learned: this.previousSuccess.size,

      cache: this.cache.size(),
    };
  }

  //========================================================
  // EXACT MATCH
  //========================================================

  exactScore(query, candidate) {
    query = this.normalize(query);

    candidate = this.normalize(candidate);

    if (!query || !candidate) {
      return 0;
    }

    if (query === candidate) {
      return 100;
    }

    //--------------------------------------------------
    // Canonical equality
    //--------------------------------------------------

    if (this.canonical(query) === this.canonical(candidate)) {
      return 100;
    }

    return 0;
  }

  //========================================================
  // CONTAINS SCORE
  //========================================================

  containsScore(query, candidate) {
    query = this.normalize(query);

    candidate = this.normalize(candidate);

    if (!query || !candidate) {
      return 0;
    }

    if (candidate === query) {
      return 100;
    }

    if (candidate.includes(query)) {
      return 92;
    }

    return 0;
  }

  //========================================================
  // PREFIX SCORE
  //========================================================

  prefixScore(query, candidate) {
    query = this.normalize(query);

    candidate = this.normalize(candidate);

    if (!query || !candidate) {
      return 0;
    }

    if (candidate.startsWith(query)) {
      return 95;
    }

    if (query.startsWith(candidate)) {
      return 90;
    }

    return 0;
  }

  //========================================================
  // TOKEN OVERLAP SCORE
  //========================================================

  tokenScore(query, candidate) {
    const q = this.uniqueTokens(query);

    const c = this.uniqueTokens(candidate);

    if (!q.length || !c.length) {
      return 0;
    }

    let matches = 0;

    for (const token of q) {
      if (c.includes(token)) {
        matches++;
      }
    }

    return (matches / q.length) * 100;
  }

  //========================================================
  // TOKEN FUZZY SCORE
  //
  // This is important for:
  //
  // "Punh In"
  //      ↓
  // "Punch In"
  //
  // Planner does NOT do this.
  // ScoringEngine does.
  //========================================================

  tokenFuzzyScore(query, candidate) {
    if (!this.options.enableTokenFuzzy) {
      return 0;
    }

    const queryTokens = this.uniqueTokens(query);

    const candidateTokens = this.uniqueTokens(candidate);

    if (!queryTokens.length || !candidateTokens.length) {
      return 0;
    }

    let total = 0;

    for (const queryToken of queryTokens) {
      let best = 0;

      for (const candidateToken of candidateTokens) {
        const jaro = this.jaroWinklerScore(queryToken, candidateToken);

        const levenshtein = this.levenshteinScore(queryToken, candidateToken);

        const dice = this.diceScore(queryToken, candidateToken);

        best = Math.max(best, jaro, levenshtein, dice);
      }

      total += best;
    }

    return total / queryTokens.length;
  }

  //========================================================
  // JARO-WINKLER
  //========================================================

  jaroWinklerScore(a, b) {
    a = this.normalize(a);

    b = this.normalize(b);

    if (!a || !b) {
      return 0;
    }

    if (a === b) {
      return 100;
    }

    const len1 = a.length;

    const len2 = b.length;

    if (!len1 || !len2) {
      return 0;
    }

    //--------------------------------------------------
    // Prevent negative match distance
    //--------------------------------------------------

    const matchDistance = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);

    const aMatch = new Array(len1).fill(false);

    const bMatch = new Array(len2).fill(false);

    let matches = 0;

    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchDistance);

      const end = Math.min(i + matchDistance + 1, len2);

      for (let j = start; j < end; j++) {
        if (bMatch[j]) {
          continue;
        }

        if (a[i] !== b[j]) {
          continue;
        }

        aMatch[i] = true;

        bMatch[j] = true;

        matches++;

        break;
      }
    }

    if (!matches) {
      return 0;
    }

    let transpositions = 0;

    let k = 0;

    for (let i = 0; i < len1; i++) {
      if (!aMatch[i]) {
        continue;
      }

      while (k < len2 && !bMatch[k]) {
        k++;
      }

      if (k < len2 && a[i] !== b[k]) {
        transpositions++;
      }

      k++;
    }

    transpositions /= 2;

    let score =
      (matches / len1 + matches / len2 + (matches - transpositions) / matches) /
      3;

    //--------------------------------------------------
    // Prefix boost
    //--------------------------------------------------

    let prefix = 0;

    for (let i = 0; i < Math.min(4, len1, len2); i++) {
      if (a[i] === b[i]) {
        prefix++;
      } else {
        break;
      }
    }

    score += prefix * 0.1 * (1 - score);

    return Math.min(100, score * 100);
  }

  //========================================================
  // LEVENSHTEIN
  //========================================================

  levenshteinScore(a, b) {
    a = this.normalize(a);

    b = this.normalize(b);

    if (!a || !b) {
      return 0;
    }

    if (a === b) {
      return 100;
    }

    const rows = b.length + 1;

    const cols = a.length + 1;

    const matrix = Array.from(
      {
        length: rows,
      },
      () => new Array(cols).fill(0),
    );

    for (let i = 0; i < rows; i++) {
      matrix[i][0] = i;
    }

    for (let j = 0; j < cols; j++) {
      matrix[0][j] = j;
    }

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

    return Math.max(0, (1 - distance / longest) * 100);
  }

  //========================================================
  // DICE COEFFICIENT
  //========================================================

  diceScore(a, b) {
    a = this.normalize(a);

    b = this.normalize(b);

    if (!a || !b) {
      return 0;
    }

    if (a === b) {
      return 100;
    }

    if (a.length < 2 || b.length < 2) {
      return 0;
    }

    const map = new Map();

    for (let i = 0; i < a.length - 1; i++) {
      const gram = a.substring(i, i + 2);

      map.set(gram, (map.get(gram) || 0) + 1);
    }

    let matches = 0;

    for (let i = 0; i < b.length - 1; i++) {
      const gram = b.substring(i, i + 2);

      const count = map.get(gram);

      if (!count) {
        continue;
      }

      map.set(gram, count - 1);

      matches++;
    }

    return ((2 * matches) / (a.length - 1 + (b.length - 1))) * 100;
  }

  //========================================================
  // COSINE SIMILARITY
  //========================================================

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

    if (!magA || !magB) {
      return 0;
    }

    return (dot / (Math.sqrt(magA) * Math.sqrt(magB))) * 100;
  }

  //========================================================
  // SEMANTIC SCORE
  //========================================================

  semanticScore(query, candidate) {
    if (!this.options.enableSemantic) {
      return 0;
    }

    const originalQuery = this.normalize(query);

    const originalCandidate = this.normalize(candidate);

    if (!originalQuery || !originalCandidate) {
      return 0;
    }

    const canonicalQuery = this.canonical(originalQuery);

    const canonicalCandidate = this.canonical(originalCandidate);

    if (canonicalQuery === canonicalCandidate) {
      return 100;
    }

    const cosine = this.cosineScore(canonicalQuery, canonicalCandidate);

    const token = this.tokenScore(canonicalQuery, canonicalCandidate);

    const tokenFuzzy = this.tokenFuzzyScore(canonicalQuery, canonicalCandidate);

    return Math.min(100, cosine * 0.45 + token * 0.25 + tokenFuzzy * 0.3);
  }

  //========================================================
  // ACCESSIBILITY SCORE
  //========================================================

  accessibilityScore(candidate) {
    if (!this.options.enableAccessibility) {
      return 0;
    }

    let score = 0;

    if (candidate.role) {
      score += 20;
    }

    if (candidate.aria) {
      score += 25;
    }

    if (candidate.name) {
      score += 20;
    }

    if (candidate.title) {
      score += 10;
    }

    if (candidate.placeholder) {
      score += 10;
    }

    if (candidate.testid) {
      score += 15;
    }

    return Math.min(100, score);
  }

  //========================================================
  // VISIBILITY SCORE
  //========================================================

  visibilityScore(candidate) {
    let score = 0;

    if (candidate.visible) {
      score += 70;
    }

    if (candidate.enabled) {
      score += 30;
    }

    return score;
  }

  //========================================================
  // ACTIONABLE CANDIDATE
  //========================================================

  isActionableCandidate(candidate, action = "click") {
    if (!candidate) {
      return false;
    }

    const tag = candidate.tag;

    const role = candidate.role;

    if (action === "type") {
      return (
        candidate.editable ||
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        role === "textbox" ||
        role === "combobox"
      );
    }

    if (action === "check" || action === "uncheck") {
      return tag === "input" || role === "checkbox" || role === "switch";
    }

    if (action === "select") {
      return (
        tag === "select" ||
        role === "option" ||
        role === "combobox" ||
        tag === "button"
      );
    }

    if (
      action === "click" ||
      action === "open" ||
      action === "close" ||
      action === "submit" ||
      action === "save" ||
      action === "delete"
    ) {
      return (
        tag === "button" ||
        tag === "a" ||
        tag === "input" ||
        role === "button" ||
        role === "link" ||
        role === "tab" ||
        role === "menuitem"
      );
    }

    return true;
  }

  //========================================================
  // ACTIONABILITY SCORE
  //========================================================

  actionabilityScore(candidate, action = "click") {
    if (!this.options.enableActionability) {
      return 0;
    }

    if (!this.isActionableCandidate(candidate, action)) {
      return 0;
    }

    let score = 60;

    const tag = candidate.tag;

    const role = candidate.role;

    if (action === "click") {
      if (tag === "button") {
        score += 30;
      }

      if (role === "button" || role === "link") {
        score += 20;
      }

      if (tag === "a") {
        score += 20;
      }
    }

    if (action === "type") {
      if (tag === "input" || tag === "textarea") {
        score += 30;
      }

      if (candidate.editable) {
        score += 10;
      }
    }

    if (action === "select") {
      if (tag === "select" || role === "combobox") {
        score += 30;
      }
    }

    return Math.min(100, score);
  }

  //========================================================
  // FIELD PRIORITY
  //========================================================

  getFieldPriority(fieldName) {
    const priorities = {
      text: 100,

      aria: 98,

      name: 95,

      title: 90,

      placeholder: 88,

      testid: 85,

      value: 80,

      alt: 75,

      id: 70,

      role: 60,

      tag: 40,
    };

    return priorities[fieldName] || 0;
  }

  //========================================================
  // SCORE SINGLE CANDIDATE
  //========================================================

  scoreCandidate(query, candidate, context = {}) {
    query = this.normalize(query);

    const text = this.normalize(candidate?.text || "");

    if (!query || !text) {
      return {
        score: 0,

        details: null,
      };
    }

    //--------------------------------------------------
    // Cache
    //--------------------------------------------------

    const cacheCandidate = [text, context.action || ""].join("::");

    const cached = this.getCachedScore(query, cacheCandidate);

    if (cached !== null) {
      return cached;
    }

    //--------------------------------------------------
    // Individual scores
    //--------------------------------------------------

    const exact = this.exactScore(query, text);

    const contains = this.containsScore(query, text);

    const prefix = this.prefixScore(query, text);

    const token = this.tokenScore(query, text);

    const tokenFuzzy = this.tokenFuzzyScore(query, text);

    const jaro = this.jaroWinklerScore(query, text);

    const levenshtein = this.levenshteinScore(query, text);

    const dice = this.diceScore(query, text);

    const cosine = this.cosineScore(query, text);

    const semantic = this.semanticScore(query, text);

    const accessibility = this.accessibilityScore(candidate);

    const visibility = this.visibilityScore(candidate);

    const actionability = this.actionabilityScore(
      candidate,
      context.action || "click",
    );

    //--------------------------------------------------
    // Best fuzzy score
    //--------------------------------------------------

    const fuzzy = Math.max(prefix, tokenFuzzy, jaro, levenshtein, dice);

    //--------------------------------------------------
    // Exact match override
    //
    // This guarantees:
    //
    // "Punch In"
    //      ↓
    // "Punch In"
    //      ↓
    // 100%
    //--------------------------------------------------

    if (exact === 100) {
      const exactResult = {
        score: 100,

        details: {
          exact,

          contains,

          prefix,

          token,

          tokenFuzzy,

          jaro,

          levenshtein,

          dice,

          cosine,

          semantic,

          accessibility,

          visibility,

          actionability,

          exactOverride: true,
        },
      };

      this.setCachedScore(query, cacheCandidate, exactResult);

      return exactResult;
    }

    //--------------------------------------------------
    // Weighted score
    //--------------------------------------------------

    const baseWeight =
      this.options.exactWeight +
      this.options.tokenWeight +
      this.options.fuzzyWeight +
      this.options.semanticWeight +
      this.options.accessibilityWeight +
      this.options.visibilityWeight;

    const weightedScore =
      (exact * this.options.exactWeight +
        token * this.options.tokenWeight +
        fuzzy * this.options.fuzzyWeight +
        semantic * this.options.semanticWeight +
        accessibility * this.options.accessibilityWeight +
        visibility * this.options.visibilityWeight) /
      baseWeight;

    //--------------------------------------------------
    // Actionability adjustment
    //--------------------------------------------------

    const actionWeight = this.options.enableActionability
      ? this.options.actionabilityWeight
      : 0;

    const totalWeight = baseWeight + actionWeight;

    let score =
      (weightedScore * baseWeight + actionability * actionWeight) / totalWeight;

    //--------------------------------------------------
    // Contains boost
    //
    // Helps:
    //
    // "Punch In"
    // "Punch In Now"
    //--------------------------------------------------

    if (contains >= 92 && exact < 100) {
      score = Math.max(score, contains);
    }

    //--------------------------------------------------
    // Token fuzzy boost
    //
    // Helps typo:
    //
    // "Punh In"
    // "Punch In"
    //--------------------------------------------------

    if (tokenFuzzy >= 85 && token >= 40) {
      score = Math.max(score, tokenFuzzy);
    }

    //--------------------------------------------------
    // Strong fuzzy correction
    //--------------------------------------------------

    if (fuzzy >= 90 && tokenFuzzy >= 85) {
      score = Math.max(score, 90);
    }

    const result = {
      score: Math.min(100, Number(score.toFixed(4))),

      details: {
        exact,

        contains,

        prefix,

        token,

        tokenFuzzy,

        jaro,

        levenshtein,

        dice,

        cosine,

        semantic,

        accessibility,

        visibility,

        actionability,

        exactOverride: false,
      },
    };

    this.setCachedScore(query, cacheCandidate, result);

    return result;
  }

  //========================================================
  // SCORE SEARCHABLE FIELD
  //========================================================

  scoreField(query, candidate, field, context = {}) {
    const value = candidate?.[field];

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
      context,
    );
  }

  //========================================================
  // RANK CANDIDATES
  //========================================================

  rankCandidates(query, candidates = this.domIndex, context = {}) {
    const ranked = [];

    //--------------------------------------------------
    // Learned result
    //--------------------------------------------------

    const learned = this.recall(query);

    //--------------------------------------------------
    // Extract action
    //--------------------------------------------------

    const extracted = this.extractAction(query);

    const action = context.action || extracted.action || "click";

    const target =
      context.target || extracted.target || this.removeCommandWords(query);

    //--------------------------------------------------
    // Score each candidate
    //--------------------------------------------------

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      let bestScore = 0;

      let bestField = "";

      let bestBreakdown = null;

      //--------------------------------------------------
      // Learned boost
      //--------------------------------------------------

      const learnedMatches =
        learned &&
        (learned === candidate ||
          (learned.id && candidate.id && learned.id === candidate.id));

      if (learnedMatches) {
        bestScore = 100;

        bestField = "learned";

        bestBreakdown = {
          learned: 100,
        };
      }

      //--------------------------------------------------
      // Score every searchable field
      //--------------------------------------------------

      const fields = this.getSearchableFields(candidate);

      for (const [fieldName, fieldValue] of fields) {
        const result = this.scoreCandidate(
          target,
          {
            ...candidate,

            text: fieldValue,
          },
          {
            ...context,

            action,
          },
        );

        //--------------------------------------------------
        // Small field priority tie-break
        //--------------------------------------------------

        const fieldPriority = this.getFieldPriority(fieldName);

        const adjustedScore = result.score + fieldPriority / 10000;

        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;

          bestField = fieldName;

          bestBreakdown = result.details;
        }
      }

      //--------------------------------------------------
      // Candidate actionability
      //--------------------------------------------------

      const candidateActionability = this.actionabilityScore(candidate, action);

      //--------------------------------------------------
      // Do not allow non-actionable
      // elements to beat strong actionable
      // candidates for action commands.
      //--------------------------------------------------

      if (
        action === "click" &&
        !this.isActionableCandidate(candidate, action)
      ) {
        bestScore *= 0.82;
      }

      //--------------------------------------------------
      // Store result
      //--------------------------------------------------

      ranked.push({
        ...candidate,

        score: Number(Math.min(100, bestScore).toFixed(2)),

        matchedField: bestField,

        breakdown: bestBreakdown,

        action,

        actionability: candidateActionability,
      });
    }

    //--------------------------------------------------
    // Sort
    //--------------------------------------------------

    ranked.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      //------------------------------------------------
      // Prefer visible
      //------------------------------------------------

      if (a.visible !== b.visible) {
        return Number(b.visible) - Number(a.visible);
      }

      //------------------------------------------------
      // Prefer enabled
      //------------------------------------------------

      if (a.enabled !== b.enabled) {
        return Number(b.enabled) - Number(a.enabled);
      }

      //------------------------------------------------
      // Prefer actionable
      //------------------------------------------------

      if (a.actionability !== b.actionability) {
        return b.actionability - a.actionability;
      }

      //------------------------------------------------
      // Tag priority
      //------------------------------------------------

      const priority = {
        button: 10,

        a: 9,

        input: 8,

        textarea: 8,

        select: 7,

        option: 6,

        div: 1,
      };

      return (priority[b.tag] || 0) - (priority[a.tag] || 0);
    });

    return ranked;
  }

  //========================================================
  // SEARCH
  //========================================================

  search(query, candidates = this.domIndex, context = {}) {
    query = this.normalize(query);

    if (!query || !Array.isArray(candidates) || !candidates.length) {
      return [];
    }

    this.metrics.searches++;

    const ranked = this.rankCandidates(query, candidates, context);

    return ranked.filter(
      (item) => item.score >= this.options.minimumConfidence,
    );
  }

  //========================================================
  // FIND BEST CANDIDATE
  //========================================================

  findBestCandidate(query, candidates = this.domIndex, context = {}) {
    const ranked = this.rankCandidates(query, candidates, context);

    if (!ranked.length) {
      return {
        found: false,

        candidate: null,

        confidence: 0,

        ambiguous: false,

        plannerRequired: true,

        autoExecute: false,

        margin: 0,

        ranked: [],
      };
    }

    const best = ranked[0];

    const second = ranked[1] || null;

    const confidence = best.score;

    const margin = second ? best.score - second.score : 100;

    //--------------------------------------------------
    // Ambiguous only when both candidates are
    // actually strong enough to be realistic.
    //
    // This avoids:
    //
    // Punch In = 100
    // Login    = 98
    //
    // incorrectly becoming ambiguous in unrelated
    // fields.
    //--------------------------------------------------

    const ambiguous =
      !!second &&
      best.score >= this.options.plannerThreshold &&
      second.score >= this.options.plannerThreshold &&
      margin < this.options.ambiguityMargin;

    const plannerRequired =
      confidence < this.options.plannerThreshold || ambiguous;

    const autoExecute =
      confidence >= this.options.autoExecuteThreshold && !ambiguous;

    if (ambiguous) {
      this.metrics.ambiguousMatches++;
    }

    if (autoExecute) {
      this.metrics.autoExecutions++;
    }

    if (confidence >= this.options.autoExecuteThreshold) {
      this.metrics.exactMatches++;
    } else if (confidence >= this.options.plannerThreshold) {
      this.metrics.fuzzyMatches++;
    }

    return {
      found: confidence >= this.options.plannerThreshold,

      candidate: best,

      confidence,

      ambiguous,

      plannerRequired,

      autoExecute,

      margin,

      ranked,
    };
  }

  //========================================================
  // SHOULD USE PLANNER
  //========================================================

  shouldUsePlanner(result) {
    if (!result) {
      return true;
    }

    if (!result.found) {
      return true;
    }

    if (result.ambiguous) {
      return true;
    }

    if (result.confidence < this.options.plannerThreshold) {
      return true;
    }

    return false;
  }

  //========================================================
  // PLANNER REQUEST
  //========================================================

  requestPlanner() {
    this.metrics.plannerRequests++;
  }

  //========================================================
  // RESOLVE
  //
  // IMPORTANT FIX:
  //
  // Old code:
  //
  // const decision = this.findBestCandidate(...)
  //
  // if (decision.best)
  //
  // But findBestCandidate returns:
  //
  // candidate
  //
  // Therefore decision.best was always undefined.
  //
  // This version uses decision.candidate.
  //========================================================

  resolve(query, candidates = this.domIndex, context = {}) {
    query = this.normalize(query);

    if (!query || !Array.isArray(candidates) || !candidates.length) {
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

    //--------------------------------------------------
    // Find best directly.
    //
    // Do NOT call search() first because that would:
    //
    // 1. Filter candidates
    // 2. Rank once
    // 3. Rank again
    // 4. Increment search metrics twice
    //--------------------------------------------------

    const decision = this.findBestCandidate(query, candidates, context);

    const best = decision.candidate;

    //--------------------------------------------------
    // Learn only strong successful candidate
    //--------------------------------------------------

    if (best && decision.autoExecute && this.options.enableLearning) {
      this.learn(query, best);
    }

    //--------------------------------------------------
    // Planner fallback
    //--------------------------------------------------

    if (decision.plannerRequired) {
      this.metrics.plannerRequests++;
    }

    return {
      success: !!best && decision.found,

      confidence: decision.confidence,

      plannerRequired: decision.plannerRequired,

      autoExecute: decision.autoExecute,

      ambiguous: decision.ambiguous,

      margin: decision.margin,

      best,

      candidates: decision.ranked.slice(0, 10),
    };
  }

  //========================================================
  // EXECUTION SUCCESS
  //========================================================

  recordSuccess(query, candidate) {
    if (!candidate) {
      return;
    }

    this.learn(query, candidate);
  }

  //========================================================
  // EXECUTION FAILURE
  //========================================================

  recordFailure(query) {
    this.forget(query);
  }

  //========================================================
  // REMOVE LEARNED ENTRY
  //========================================================

  removeLearned(query) {
    this.forget(query);
  }

  //========================================================
  // RESET ENGINE
  //========================================================

  reset() {
    this.clearIndex();

    this.clearCache();

    this.clearLearning();

    this.resetMetrics();
  }

  //========================================================
  // RESET METRICS
  //========================================================

  resetMetrics() {
    this.metrics = {
      indexedElements: 0,

      searches: 0,

      cacheHits: 0,

      cacheMisses: 0,

      learnedMatches: 0,

      plannerRequests: 0,

      exactMatches: 0,

      fuzzyMatches: 0,

      ambiguousMatches: 0,

      autoExecutions: 0,
    };
  }

  //========================================================
  // METRICS
  //========================================================

  getMetrics() {
    const totalCacheRequests =
      this.metrics.cacheHits + this.metrics.cacheMisses;

    return {
      ...this.metrics,

      cacheSize: this.cache.size(),

      learnedEntries: this.previousSuccess.size,

      indexedElements: this.domIndex.length,

      cacheHitRate: totalCacheRequests
        ? (this.metrics.cacheHits / totalCacheRequests) * 100
        : 0,
    };
  }

  //========================================================
  // STATS
  //========================================================

  stats() {
    return {
      indexedElements: this.domIndex.length,

      learnedMatches: this.previousSuccess.size,

      cacheEntries: this.cache.size(),

      thresholds: {
        planner: this.options.plannerThreshold,

        autoExecute: this.options.autoExecuteThreshold,

        minimumConfidence: this.options.minimumConfidence,

        ambiguityMargin: this.options.ambiguityMargin,
      },

      metrics: this.getMetrics(),
    };
  }

  //========================================================
  // EXPORT LEARNING
  //========================================================

  exportLearning() {
    return {
      learned: [...this.previousSuccess.entries()],

      metrics: this.getMetrics(),
    };
  }

  //========================================================
  // IMPORT LEARNING
  //========================================================

  importLearning(data = {}) {
    this.clearLearning();

    if (Array.isArray(data.learned)) {
      for (const [query, candidate] of data.learned) {
        if (query && candidate) {
          this.previousSuccess.set(query, candidate);
        }
      }
    }

    this.metrics.learnedMatches = this.previousSuccess.size;
  }

  //========================================================
  // DEBUG SUMMARY
  //========================================================

  debugSummary() {
    return {
      options: this.options,

      indexSummary: this.getIndexSummary(),

      metrics: this.getMetrics(),

      learnedQueries: [...this.previousSuccess.keys()],
    };
  }
}
