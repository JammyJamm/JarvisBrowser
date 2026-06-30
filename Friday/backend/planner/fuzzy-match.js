/**
 * fuzzy-match.js
 *
 * Lightweight fuzzy matching utility for intent parsing
 * Optimized for browser planners / command routers
 *
 * Features:
 * - Fast Levenshtein distance (bounded)
 * - Token-based similarity scoring
 * - Prefix boost (important for commands)
 * - Case/space normalization
 * - Configurable thresholding
 */

/**
 * Normalize text for comparison
 */
function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[_\-]/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Compute bounded Levenshtein distance (faster than full DP in many cases)
 */
function levenshtein(a, b, maxDistance = 10) {
  a = normalize(a);
  b = normalize(b);

  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const matrix = Array.from({ length: b.length + 1 }, () => []);

  for (let i = 0; i <= b.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    let minRow = Infinity;

    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );

      minRow = Math.min(minRow, matrix[i][j]);
    }

    if (minRow > maxDistance) return maxDistance + 1;
  }

  return matrix[b.length][a.length];
}

/**
 * Token similarity score (0-1)
 */
function tokenScore(a, b) {
  const aTokens = normalize(a).split(" ");
  const bTokens = normalize(b).split(" ");

  let match = 0;

  for (const t of aTokens) {
    if (bTokens.includes(t)) match++;
  }

  return match / Math.max(aTokens.length, 1);
}

/**
 * Prefix bonus (important for commands like /search, /open)
 */
function prefixBonus(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (b.startsWith(a) || a.startsWith(b)) return 0.25;
  return 0;
}

/**
 * Main fuzzy score (0-1)
 */
function fuzzyScore(a, b) {
  const normA = normalize(a);
  const normB = normalize(b);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const maxLen = Math.max(normA.length, normB.length);
  const dist = levenshtein(normA, normB);

  const distanceScore = 1 - dist / maxLen;
  const token = tokenScore(normA, normB);
  const prefix = prefixBonus(normA, normB);

  // Weighted blend
  const score = distanceScore * 0.55 + token * 0.3 + prefix * 0.15;

  return Math.max(0, Math.min(1, score));
}

/**
 * Find best match from list
 */
function findBestMatch(input, candidates, threshold = 0.6) {
  let best = null;
  let bestScore = 0;

  for (const item of candidates) {
    const value = typeof item === "string" ? item : item.key || item.name;

    const score = fuzzyScore(input, value);

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return bestScore >= threshold
    ? { match: best, score: bestScore }
    : { match: null, score: bestScore };
}

/**
 * Export API
 */
module.exports = {
  normalize,
  levenshtein,
  tokenScore,
  fuzzyScore,
  findBestMatch,
};
