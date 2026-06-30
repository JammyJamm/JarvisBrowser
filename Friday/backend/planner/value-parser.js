// planner/value-parser.js

/**
 * Ultra-fast Value Parser for Planner System
 * - Converts raw string inputs into structured values
 * - Handles numbers, booleans, JSON, arrays, ranges, and text
 * - Designed for low overhead + fast intent pipeline usage
 */

const BOOLEAN_MAP = new Map([
  ["true", true],
  ["false", false],
  ["yes", true],
  ["no", false],
  ["on", true],
  ["off", false],
]);

/**
 * Try parse number safely
 */
function tryNumber(value) {
  if (value === "" || value == null) return null;
  if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

/**
 * Try parse JSON safely
 */
function tryJSON(value) {
  if (!value) return null;
  const first = value[0];
  if (first !== "{" && first !== "[") return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Detect range like "10-20"
 */
function tryRange(value) {
  if (typeof value !== "string") return null;

  const match = value.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
  if (!match) return null;

  return {
    type: "range",
    min: Number(match[1]),
    max: Number(match[2]),
  };
}

/**
 * Detect array like "a,b,c"
 */
function tryArray(value) {
  if (typeof value !== "string") return null;
  if (!value.includes(",")) return null;

  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Main parser
 */
export function parseValue(input) {
  if (input == null) return null;

  // Normalize
  const raw = String(input).trim();
  if (!raw) return null;

  // Boolean
  const lower = raw.toLowerCase();
  if (BOOLEAN_MAP.has(lower)) {
    return BOOLEAN_MAP.get(lower);
  }

  // Number
  const num = tryNumber(raw);
  if (num !== null) return num;

  // Range
  const range = tryRange(raw);
  if (range) return range;

  // Array
  const arr = tryArray(raw);
  if (arr) return arr;

  // JSON
  const json = tryJSON(raw);
  if (json) return json;

  // Default string
  return raw;
}

/**
 * Parse with metadata (useful for planner debugging)
 */
export function parseValueWithMeta(input) {
  const parsed = parseValue(input);

  return {
    raw: input,
    type: Array.isArray(parsed)
      ? "array"
      : parsed && typeof parsed === "object" && parsed.type === "range"
        ? "range"
        : typeof parsed,
    value: parsed,
  };
}

/**
 * Batch parser for planner pipelines
 */
export function parseValues(inputs) {
  if (!Array.isArray(inputs)) return [];

  const out = new Array(inputs.length);
  for (let i = 0; i < inputs.length; i++) {
    out[i] = parseValue(inputs[i]);
  }
  return out;
}
