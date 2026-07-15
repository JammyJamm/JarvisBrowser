/**
 * ============================================================
 * backend/planner/fuzzy-match.js
 *
 * Ultra Lightweight Similarity Utilities
 *
 * IMPORTANT
 * ------------------------------------------------------------
 * This file DOES NOT rank DOM elements.
 * This file DOES NOT choose candidates.
 * This file DOES NOT perform planner logic.
 *
 * All ranking belongs to ScoringEngine.
 *
 * Responsibilities
 * ------------------------------------------------------------
 * ✔ Text normalization
 * ✔ Tokenization
 * ✔ Synonym expansion
 * ✔ Stop-word removal
 * ✔ String utilities
 * ✔ N-gram helpers
 * ✔ Acronym generation
 *
 * Used by:
 *  - ScoringEngine
 *  - IntentParser
 *  - SelfHealing
 * ============================================================
 */

const DEFAULT_OPTIONS = {
  removeStopWords: true,

  applySynonyms: true,

  lowerCase: true,
};

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "into",
  "in",
  "on",
  "for",
  "and",
  "or",
  "with",
  "from",
  "by",
  "button",
  "link",
  "item",
  "menu",
  "option",
  "please",
  "kindly",
]);

const SYNONYMS = new Map([
  ["signin", "login"],
  ["sign in", "login"],
  ["log in", "login"],

  ["logout", "sign out"],

  ["submit", "save"],

  ["confirm", "ok"],

  ["okay", "ok"],

  ["press", "click"],

  ["tap", "click"],

  ["choose", "select"],

  ["pick", "select"],

  ["lookup", "find"],

  ["search", "find"],

  ["erase", "delete"],

  ["remove", "delete"],

  ["create", "new"],

  ["clock in", "punch in"],

  ["punch in", "clock in"],
]);

//==============================================================
// NORMALIZATION
//==============================================================

function normalize(text = "", options = DEFAULT_OPTIONS) {
  if (!text) return "";

  let value = String(text);

  //----------------------------------------------------------
  // Unicode normalization
  //----------------------------------------------------------

  value = value.normalize("NFKD");

  //----------------------------------------------------------
  // Lowercase
  //----------------------------------------------------------

  if (options.lowerCase) {
    value = value.toLowerCase();
  }

  //----------------------------------------------------------
  // Remove punctuation
  //----------------------------------------------------------

  value = value

    .replace(/[^\w\s]/g, " ")

    .replace(/[_]/g, " ")

    .replace(/\s+/g, " ")

    .trim();

  //----------------------------------------------------------
  // Synonyms
  //----------------------------------------------------------

  if (options.applySynonyms) {
    for (const [a, b] of SYNONYMS) {
      value = value.replaceAll(a, b);
    }
  }

  return value;
}

//==============================================================
// TOKENIZATION
//==============================================================

function tokenize(text, options = DEFAULT_OPTIONS) {
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

function uniqueTokens(text) {
  return [...new Set(tokenize(text))];
}

//==============================================================
// SORTED TOKENS
//==============================================================

function sortedTokens(text) {
  return tokenize(text).sort();
}

//==============================================================
// TOKEN STRING
//==============================================================

function tokenString(text) {
  return sortedTokens(text).join(" ");
}

//==============================================================
// WORD FREQUENCY
//==============================================================

function frequencyMap(text) {
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
// ACRONYM
//==============================================================

function acronym(text) {
  return tokenize(text)
    .map((x) => x[0])

    .join("");
}

//==============================================================
// PREFIX CHECK
//==============================================================

function prefixMatch(a, b) {
  a = normalize(a);

  b = normalize(b);

  return a.startsWith(b) || b.startsWith(a);
}

//==============================================================
// SUFFIX CHECK
//==============================================================

function suffixMatch(a, b) {
  a = normalize(a);

  b = normalize(b);

  return a.endsWith(b) || b.endsWith(a);
}

//==============================================================
// WORD OVERLAP
//==============================================================

function wordOverlap(a, b) {
  const words1 = new Set(tokenize(a));

  const words2 = new Set(tokenize(b));

  let overlap = 0;

  for (const word of words1) {
    if (words2.has(word)) overlap++;
  }

  return {
    overlap,

    total: Math.max(
      words1.size,

      words2.size,
    ),
  };
}
//==============================================================
// COMMON PREFIX LENGTH
//==============================================================

function commonPrefixLength(a, b) {
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

function commonSuffixLength(a, b) {
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
// NGRAMS
//==============================================================

function ngrams(text, size = 2) {
  text = normalize(text);

  const grams = [];

  if (text.length < size) return grams;

  for (let i = 0; i <= text.length - size; i++) {
    grams.push(text.substring(i, i + size));
  }

  return grams;
}

//==============================================================
// LEVENSHTEIN
//==============================================================

function levenshtein(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (a === b) return 0;

  if (!a.length) return b.length;

  if (!b.length) return a.length;

  const matrix = Array.from(
    { length: b.length + 1 },

    () => new Array(a.length + 1),
  );

  for (let i = 0; i <= b.length; i++) matrix[i][0] = i;

  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,

        matrix[i][j - 1] + 1,

        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[b.length][a.length];
}

//==============================================================
// LEVENSHTEIN SIMILARITY (0-100)
//==============================================================

function levenshteinSimilarity(a, b) {
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
//==============================================================

/**
 * Jaro-Winkler Similarity
 * Returns similarity score between 0-100
 */
function jaroWinkler(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (!a || !b) return 0;

  if (a === b) return 100;

  const len1 = a.length;
  const len2 = b.length;

  const matchDistance = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);

  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;

  //-----------------------------------------------------
  // Find matching characters
  //-----------------------------------------------------

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

  //-----------------------------------------------------
  // Count transpositions
  //-----------------------------------------------------

  let transpositions = 0;
  let k = 0;

  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;

    while (!s2Matches[k]) k++;

    if (a[i] !== b[k]) transpositions++;

    k++;
  }

  transpositions /= 2;

  //-----------------------------------------------------
  // Jaro similarity
  //-----------------------------------------------------

  let jaro =
    (matches / len1 + matches / len2 + (matches - transpositions) / matches) /
    3;

  //-----------------------------------------------------
  // Winkler prefix bonus
  //-----------------------------------------------------

  let prefix = 0;

  const maxPrefix = Math.min(4, len1, len2);

  while (prefix < maxPrefix && a[prefix] === b[prefix]) {
    prefix++;
  }

  const jaroWinklerScore = jaro + prefix * 0.1 * (1 - jaro);

  return Math.round(Math.min(1, jaroWinklerScore) * 100);
}

//---------------------------------------------------------
// DICE COEFFICIENT
//---------------------------------------------------------

function diceCoefficient(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (a === b) return 1;

  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map();

  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.substring(i, i + 2);

    bigrams.set(gram, (bigrams.get(gram) || 0) + 1);
  }

  let matches = 0;

  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.substring(i, i + 2);

    const count = bigrams.get(gram);

    if (count) {
      bigrams.set(gram, count - 1);

      matches++;
    }
  }

  return (2 * matches) / (a.length - 1 + (b.length - 1));
}

//---------------------------------------------------------
// COSINE TOKEN SIMILARITY
//---------------------------------------------------------

function cosineSimilarity(a, b) {
  const t1 = tokenize(a);
  const t2 = tokenize(b);

  if (!t1.length || !t2.length) return 0;

  const vocab = [...new Set([...t1, ...t2])];

  let dot = 0;
  let mag1 = 0;
  let mag2 = 0;

  for (const word of vocab) {
    const x = t1.filter((v) => v === word).length;

    const y = t2.filter((v) => v === word).length;

    dot += x * y;
    mag1 += x * x;
    mag2 += y * y;
  }

  if (!mag1 || !mag2) return 0;

  return dot / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

//---------------------------------------------------------
// PREFIX BONUS
//---------------------------------------------------------

function prefixBonus(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (!a || !b) return 0;

  if (a.startsWith(b)) return 1;

  if (b.startsWith(a)) return 1;

  return 0;
}

//---------------------------------------------------------
// SUFFIX BONUS
//---------------------------------------------------------

function suffixBonus(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (a.endsWith(b)) return 0.5;

  if (b.endsWith(a)) return 0.5;

  return 0;
}

//---------------------------------------------------------
// TOKEN COVERAGE
//---------------------------------------------------------

function tokenCoverage(query, candidate) {
  const q = tokenize(query);

  const c = tokenize(candidate);

  if (!q.length) return 0;

  let matched = 0;

  for (const token of q) {
    if (c.includes(token)) matched++;
  }

  return matched / q.length;
} //---------------------------------------------------------
// EXPORTS
//---------------------------------------------------------

module.exports = {
  normalize,

  tokenize,

  levenshteinDistance,

  levenshteinSimilarity,

  jaroWinkler,

  diceCoefficient,

  cosineSimilarity,

  tokenCoverage,

  prefixBonus,

  suffixBonus,

  computeScore,

  rankCandidates,

  findBestMatch,
};

//---------------------------------------------------------
// ES MODULE SUPPORT
//---------------------------------------------------------

module.exports.default = module.exports;
