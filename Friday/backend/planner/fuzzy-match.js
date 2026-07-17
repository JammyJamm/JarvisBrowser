/**
 * ============================================================
 * backend/planner/fuzzy-match.js
 *
 * Ultra Similarity Utilities
 *
 * Architecture
 * ------------------------------------------------------------
 *
 * User Input
 *      │
 *      ▼
 * normalize()
 *      │
 *      ▼
 * tokenize()
 *      │
 *      ▼
 * Similarity Algorithms
 *      │
 *      ▼
 * ScoringEngine
 *
 * IMPORTANT
 * ------------------------------------------------------------
 * This file NEVER:
 *
 * ❌ ranks DOM elements
 * ❌ selects candidates
 * ❌ calls Planner
 * ❌ contains Resolver logic
 *
 * Responsibilities
 * ------------------------------------------------------------
 * ✔ Text normalization
 * ✔ Tokenization
 * ✔ Unicode cleanup
 * ✔ Stop-word removal
 * ✔ Synonym expansion
 * ✔ Number normalization
 * ✔ Acronym generation
 * ✔ N-Gram helpers
 * ✔ Similarity utilities
 * ✔ Cache
 *
 * Used by
 * ------------------------------------------------------------
 * ✔ ScoringEngine
 * ✔ IntentParser
 * ✔ SelfHealing
 *
 * ============================================================
 */

const DEFAULT_OPTIONS = {
  lowerCase: true,

  trim: true,

  removePunctuation: true,

  collapseWhitespace: true,

  removeStopWords: true,

  normalizeUnicode: true,

  normalizeNumbers: true,

  applySynonyms: true,

  cacheSize: 5000,
};

//==============================================================
// STOP WORDS
//==============================================================

export const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "into",
  "on",
  "in",
  "at",
  "for",
  "from",
  "by",
  "with",
  "and",
  "or",
  "is",
  "are",
  "be",
  "been",
  "being",
  "this",
  "that",
  "these",
  "those",

  "button",
  "link",
  "tab",
  "menu",
  "option",
  "item",
  "field",
  "textbox",
  "checkbox",
  "radio",

  "please",
  "kindly",
  "now",
  "then",
]);

//==============================================================
// SYNONYMS
//==============================================================

export const SYNONYMS = new Map([
  ["signin", "login"],
  ["sign in", "login"],
  ["log in", "login"],

  ["signout", "logout"],
  ["sign out", "logout"],

  ["tap", "click"],
  ["press", "click"],

  ["choose", "select"],
  ["pick", "select"],

  ["lookup", "find"],
  ["search", "find"],

  ["erase", "delete"],
  ["remove", "delete"],

  ["submit", "save"],
  ["confirm", "ok"],
  ["okay", "ok"],

  ["clock in", "punch in"],
  ["clockin", "punch in"],

  ["clock out", "punch out"],
  ["checkout", "sign out"],
]);

//==============================================================
// NORMALIZATION CACHE
//==============================================================

const normalizeCache = new Map();

function cacheGet(key) {
  return normalizeCache.get(key);
}

function cacheSet(key, value) {
  if (normalizeCache.size >= DEFAULT_OPTIONS.cacheSize) {
    const oldest = normalizeCache.keys().next().value;

    normalizeCache.delete(oldest);
  }

  normalizeCache.set(key, value);
}

//==============================================================
// NUMBER NORMALIZATION
//==============================================================

const NUMBER_WORDS = new Map([
  ["zero", "0"],
  ["one", "1"],
  ["two", "2"],
  ["three", "3"],
  ["four", "4"],
  ["five", "5"],
  ["six", "6"],
  ["seven", "7"],
  ["eight", "8"],
  ["nine", "9"],
  ["ten", "10"],
]);

function normalizeNumbers(text) {
  let value = text;

  for (const [word, num] of NUMBER_WORDS) {
    value = value.replaceAll(word, num);
  }

  return value;
}

//==============================================================
// NORMALIZATION
//==============================================================

export function normalize(
  text = "",

  options = DEFAULT_OPTIONS,
) {
  if (text === null || text === undefined) return "";

  const cacheKey = JSON.stringify([text, options]);

  const cached = cacheGet(cacheKey);

  if (cached) return cached;

  let value = String(text);

  //----------------------------------------------------------
  // Unicode
  //----------------------------------------------------------

  if (options.normalizeUnicode) {
    value = value.normalize("NFKD");
  }

  //----------------------------------------------------------
  // Lowercase
  //----------------------------------------------------------

  if (options.lowerCase) {
    value = value.toLowerCase();
  }

  //----------------------------------------------------------
  // Numbers
  //----------------------------------------------------------

  if (options.normalizeNumbers) {
    value = normalizeNumbers(value);
  }

  //----------------------------------------------------------
  // Synonyms
  //----------------------------------------------------------

  if (options.applySynonyms) {
    for (const [from, to] of SYNONYMS) {
      value = value.replaceAll(from, to);
    }
  }

  //----------------------------------------------------------
  // Remove punctuation
  //----------------------------------------------------------

  if (options.removePunctuation) {
    value = value

      .replace(/[^\p{L}\p{N}\s]/gu, " ")

      .replace(/_/g, " ");
  }

  //----------------------------------------------------------
  // Collapse whitespace
  //----------------------------------------------------------

  if (options.collapseWhitespace) {
    value = value.replace(/\s+/g, " ");
  }

  //----------------------------------------------------------
  // Trim
  //----------------------------------------------------------

  if (options.trim) {
    value = value.trim();
  }

  cacheSet(cacheKey, value);

  return value;
}

//==============================================================
// TOKENIZATION
//==============================================================

export function tokenize(
  text,

  options = DEFAULT_OPTIONS,
) {
  let tokens = normalize(text, options)
    .split(" ")

    .filter(Boolean);

  if (options.removeStopWords) {
    tokens = tokens.filter((token) => !STOP_WORDS.has(token));
  }

  return tokens;
}

//==============================================================
// UNIQUE TOKENS
//==============================================================

export function uniqueTokens(text) {
  return [...new Set(tokenize(text))];
}

//==============================================================
// SORTED TOKENS
//==============================================================

export function sortedTokens(text) {
  return tokenize(text).sort();
}

//==============================================================
// TOKEN STRING
//==============================================================

export function tokenString(text) {
  return sortedTokens(text).join(" ");
}

//==============================================================
// WORD FREQUENCY
//==============================================================

export function frequencyMap(text) {
  const map = new Map();

  for (const token of tokenize(text)) {
    map.set(
      token,

      (map.get(token) || 0) + 1,
    );
  }

  return map;
}

//==============================================================
// PART 2
//
// ✔ Acronyms
// ✔ Initialisms
// ✔ Prefix/Suffix helpers
// ✔ Token overlap
// ✔ Coverage
// ✔ Character overlap
// ✔ N-Grams
//
//==============================================================
//==============================================================
// ACRONYM
//==============================================================

export function acronym(text) {
  return tokenize(text)
    .map((token) => token[0] || "")

    .join("");
}

//==============================================================
// INITIALISM
//==============================================================

export function initialism(text) {
  return tokenize(text)
    .map((token) => token.charAt(0).toUpperCase())

    .join("");
}

//==============================================================
// PREFIX MATCH
//==============================================================

export function prefixMatch(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (!a || !b) return false;

  return a.startsWith(b) || b.startsWith(a);
}

//==============================================================
// SUFFIX MATCH
//==============================================================

export function suffixMatch(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (!a || !b) return false;

  return a.endsWith(b) || b.endsWith(a);
}

//==============================================================
// COMMON PREFIX LENGTH
//==============================================================

export function commonPrefixLength(a, b) {
  a = normalize(a);
  b = normalize(b);

  const max = Math.min(a.length, b.length);

  let count = 0;

  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) break;

    count++;
  }

  return count;
}

//==============================================================
// COMMON SUFFIX LENGTH
//==============================================================

export function commonSuffixLength(a, b) {
  a = normalize(a);
  b = normalize(b);

  let i = a.length - 1;
  let j = b.length - 1;

  let count = 0;

  while (i >= 0 && j >= 0) {
    if (a[i] !== b[j]) break;

    count++;

    i--;
    j--;
  }

  return count;
}

//==============================================================
// WORD OVERLAP
//==============================================================

export function wordOverlap(a, b) {
  const words1 = new Set(tokenize(a));

  const words2 = new Set(tokenize(b));

  let overlap = 0;

  for (const word of words1) {
    if (words2.has(word)) overlap++;
  }

  return {
    overlap,

    total: Math.max(words1.size, words2.size),

    ratio:
      Math.max(words1.size, words2.size) === 0
        ? 0
        : overlap / Math.max(words1.size, words2.size),
  };
}

//==============================================================
// TOKEN COVERAGE
//==============================================================

export function tokenCoverage(query, candidate) {
  const q = tokenize(query);

  const c = tokenize(candidate);

  if (!q.length) return 0;

  let matched = 0;

  for (const token of q) {
    if (c.includes(token)) matched++;
  }

  return matched / q.length;
}

//==============================================================
// CHARACTER OVERLAP
//==============================================================

export function characterOverlap(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (!a || !b) return 0;

  const chars1 = new Set(a);

  const chars2 = new Set(b);

  let common = 0;

  for (const ch of chars1) {
    if (chars2.has(ch)) common++;
  }

  const total = new Set([...chars1, ...chars2]).size;

  return total ? common / total : 0;
}

//==============================================================
// TOKEN INTERSECTION
//==============================================================

export function tokenIntersection(a, b) {
  const left = new Set(tokenize(a));

  const right = new Set(tokenize(b));

  return [...left].filter((token) => right.has(token));
}

//==============================================================
// TOKEN DIFFERENCE
//==============================================================

export function tokenDifference(a, b) {
  const left = new Set(tokenize(a));

  const right = new Set(tokenize(b));

  return [...left].filter((token) => !right.has(token));
}

//==============================================================
// NGRAMS
//==============================================================

export function ngrams(
  text,

  size = 2,
) {
  text = normalize(text);

  const grams = [];

  if (!text || text.length < size) {
    return grams;
  }

  for (let i = 0; i <= text.length - size; i++) {
    grams.push(
      text.substring(
        i,

        i + size,
      ),
    );
  }

  return grams;
}

//==============================================================
// WORD NGRAMS
//==============================================================

export function wordNgrams(
  text,

  size = 2,
) {
  const tokens = tokenize(text);

  const grams = [];

  if (tokens.length < size) {
    return grams;
  }

  for (let i = 0; i <= tokens.length - size; i++) {
    grams.push(
      tokens

        .slice(i, i + size)

        .join(" "),
    );
  }

  return grams;
}

//==============================================================
// BIGRAMS
//==============================================================

export function bigrams(text) {
  return ngrams(text, 2);
}

//==============================================================
// TRIGRAMS
//==============================================================

export function trigrams(text) {
  return ngrams(text, 3);
}

//==============================================================
// PART 3
//
// ✔ Levenshtein
// ✔ Jaro-Winkler
// ✔ Dice Coefficient
// ✔ Cosine Similarity
// ✔ Jaccard Similarity
// ✔ Sørensen-Dice Similarity
//
//==============================================================
//==============================================================
// LEVENSHTEIN DISTANCE
//==============================================================

export function levenshtein(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (a === b) return 0;

  if (!a.length) return b.length;

  if (!b.length) return a.length;

  const rows = b.length + 1;
  const cols = a.length + 1;

  const matrix = Array.from({ length: rows }, () => new Array(cols));

  for (let i = 0; i < rows; i++) matrix[i][0] = i;

  for (let j = 0; j < cols; j++) matrix[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,

        matrix[i][j - 1] + 1,

        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

//==============================================================
// LEVENSHTEIN SIMILARITY
// Returns 0-100
//==============================================================

export function levenshteinSimilarity(a, b) {
  const distance = levenshtein(a, b);

  const max = Math.max(
    normalize(a).length,

    normalize(b).length,
  );

  if (!max) return 100;

  return (1 - distance / max) * 100;
}

//==============================================================
// JARO-WINKLER
// Returns 0-100
//==============================================================

export function jaroWinkler(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (!a || !b) return 0;

  if (a === b) return 100;

  const len1 = a.length;
  const len2 = b.length;

  const matchDistance = Math.max(
    Math.floor(Math.max(len1, len2) / 2) - 1,

    0,
  );

  const s1Matches = new Array(len1).fill(false);

  const s2Matches = new Array(len2).fill(false);

  let matches = 0;

  //----------------------------------------------------------
  // Matching characters
  //----------------------------------------------------------

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);

    const end = Math.min(i + matchDistance + 1, len2);

    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;

      if (a[i] !== b[j]) continue;

      s1Matches[i] = true;
      s2Matches[j] = true;

      matches++;

      break;
    }
  }

  if (!matches) return 0;

  //----------------------------------------------------------
  // Transpositions
  //----------------------------------------------------------

  let transpositions = 0;
  let k = 0;

  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;

    while (!s2Matches[k]) k++;

    if (a[i] !== b[k]) transpositions++;

    k++;
  }

  transpositions /= 2;

  //----------------------------------------------------------
  // Jaro
  //----------------------------------------------------------

  const jaro =
    (matches / len1 + matches / len2 + (matches - transpositions) / matches) /
    3;

  //----------------------------------------------------------
  // Winkler Prefix Bonus
  //----------------------------------------------------------

  let prefix = 0;

  const maxPrefix = Math.min(4, len1, len2);

  while (prefix < maxPrefix && a[prefix] === b[prefix]) {
    prefix++;
  }

  const score = jaro + prefix * 0.1 * (1 - jaro);

  return Math.round(Math.min(1, score) * 100);
}

//==============================================================
// DICE COEFFICIENT
// Returns 0-1
//==============================================================

export function diceCoefficient(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (a === b) return 1;

  if (a.length < 2 || b.length < 2) {
    return 0;
  }

  const bigramMap = new Map();

  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.substring(i, i + 2);

    bigramMap.set(
      gram,

      (bigramMap.get(gram) || 0) + 1,
    );
  }

  let matches = 0;

  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.substring(i, i + 2);

    const count = bigramMap.get(gram);

    if (!count) continue;

    bigramMap.set(gram, count - 1);

    matches++;
  }

  return (2 * matches) / (a.length - 1 + (b.length - 1));
}

//==============================================================
// COSINE TOKEN SIMILARITY
// Returns 0-1
//==============================================================

export function cosineSimilarity(a, b) {
  const left = tokenize(a);

  const right = tokenize(b);

  if (!left.length || !right.length) {
    return 0;
  }

  const vocabulary = [...new Set([...left, ...right])];

  let dot = 0;
  let mag1 = 0;
  let mag2 = 0;

  for (const word of vocabulary) {
    const x = left.filter((v) => v === word).length;

    const y = right.filter((v) => v === word).length;

    dot += x * y;

    mag1 += x * x;

    mag2 += y * y;
  }

  if (!mag1 || !mag2) return 0;

  return dot / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

//==============================================================
// JACCARD SIMILARITY
// Returns 0-1
//==============================================================

export function jaccardSimilarity(a, b) {
  const left = new Set(tokenize(a));

  const right = new Set(tokenize(b));

  const intersection = [...left].filter((token) => right.has(token));

  const union = new Set([...left, ...right]);

  if (!union.size) return 0;

  return intersection.length / union.size;
}

//==============================================================
// SORENSEN-DICE SIMILARITY
// Returns 0-1
//==============================================================

export function sorensenDiceSimilarity(a, b) {
  const left = new Set(tokenize(a));

  const right = new Set(tokenize(b));

  if (!left.size || !right.size) {
    return 0;
  }

  const intersection = [...left].filter((token) => right.has(token)).length;

  return (2 * intersection) / (left.size + right.size);
}

//==============================================================
// PART 4
//
// ✔ Prefix Bonus
// ✔ Suffix Bonus
// ✔ Alias Expansion
// ✔ Cache Utilities
// ✔ Similarity Helpers
// ✔ Default Export
//
//==============================================================
//==============================================================
// PREFIX BONUS
//==============================================================

export function prefixBonus(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (!a || !b) return 0;

  if (a.startsWith(b)) return 1;

  if (b.startsWith(a)) return 1;

  const common = commonPrefixLength(a, b);

  return Math.min(common / 5, 1);
}

//==============================================================
// SUFFIX BONUS
//==============================================================

export function suffixBonus(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (!a || !b) return 0;

  if (a.endsWith(b)) return 0.5;

  if (b.endsWith(a)) return 0.5;

  const common = commonSuffixLength(a, b);

  return Math.min(common / 8, 0.5);
}

//==============================================================
// ALIAS EXPANSION
//==============================================================

export function expandAliases(text) {
  const normalized = normalize(text);

  const aliases = new Set([normalized]);

  for (const [from, to] of SYNONYMS) {
    if (normalized.includes(from)) {
      aliases.add(normalized.replaceAll(from, to));
    }

    if (normalized.includes(to)) {
      aliases.add(normalized.replaceAll(to, from));
    }
  }

  return [...aliases];
}

//==============================================================
// CACHE UTILITIES
//==============================================================

export function clearNormalizationCache() {
  normalizeCache.clear();
}

export function cacheSize() {
  return normalizeCache.size;
}

//==============================================================
// SIMPLE SIMILARITY
// Weighted helper for quick comparisons
// Returns 0-100
//==============================================================

export function similarity(a, b) {
  const jw = jaroWinkler(a, b);

  const lev = levenshteinSimilarity(a, b);

  const token = tokenCoverage(a, b) * 100;

  const jac = jaccardSimilarity(a, b) * 100;

  return Math.round(jw * 0.35 + lev * 0.3 + token * 0.2 + jac * 0.15);
}

//==============================================================
// IS EXACT MATCH
//==============================================================

export function isExactMatch(a, b) {
  return normalize(a) === normalize(b);
}

//==============================================================
// EXPORT DEFAULT
//==============================================================

export default {
  DEFAULT_OPTIONS,

  STOP_WORDS,

  SYNONYMS,

  normalize,

  tokenize,

  uniqueTokens,

  sortedTokens,

  tokenString,

  frequencyMap,

  acronym,

  initialism,

  prefixMatch,

  suffixMatch,

  commonPrefixLength,

  commonSuffixLength,

  wordOverlap,

  tokenCoverage,

  characterOverlap,

  tokenIntersection,

  tokenDifference,

  ngrams,

  wordNgrams,

  bigrams,

  trigrams,

  levenshtein,

  levenshteinSimilarity,

  jaroWinkler,

  diceCoefficient,

  cosineSimilarity,

  jaccardSimilarity,

  sorensenDiceSimilarity,

  prefixBonus,

  suffixBonus,

  expandAliases,

  clearNormalizationCache,

  cacheSize,

  similarity,

  isExactMatch,
};
