// backend/planner/value-parser.js

/**
 * ==========================================================
 *
 * backend/planner/value-parser.js
 *
 * Ultra-fast Value Parser for Jarvis Browser Planner
 *
 * Responsibilities
 * ----------------------------------------------------------
 * ✔ Parse booleans
 * ✔ Parse numbers
 * ✔ Parse negative numbers
 * ✔ Parse decimals
 * ✔ Parse percentages
 * ✔ Parse ranges
 * ✔ Parse arrays
 * ✔ Parse JSON
 * ✔ Parse quoted strings
 * ✔ Preserve normal text
 * ✔ Batch parsing
 * ✔ Metadata support
 *
 * IMPORTANT
 * ----------------------------------------------------------
 * This parser does NOT:
 * ❌ Perform fuzzy matching
 * ❌ Correct spelling
 * ❌ Guess user intent
 * ❌ Resolve DOM elements
 *
 * Value parsing only.
 *
 * ==========================================================
 */

//==========================================================
// BOOLEAN MAP
//==========================================================

const BOOLEAN_MAP = new Map([
  ["true", true],
  ["false", false],

  ["yes", true],
  ["no", false],

  ["on", true],
  ["off", false],

  ["enabled", true],
  ["disabled", false],

  ["enable", true],
  ["disable", false],
]);

//==========================================================
// PRECOMPILED REGEX
//==========================================================

const NUMBER_REGEX = /^-?\d+(?:\.\d+)?$/;

const PERCENTAGE_REGEX = /^(-?\d+(?:\.\d+)?)\s*%$/;

const RANGE_REGEX = /^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/;

const QUOTED_REGEX = /^(['"`])([\s\S]*)\1$/;

//==========================================================
// NUMBER PARSER
//==========================================================

function tryNumber(value) {
  if (value === "" || value == null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value).trim();

  if (!NUMBER_REGEX.test(text)) {
    return null;
  }

  const number = Number(text);

  return Number.isFinite(number) ? number : null;
}

//==========================================================
// PERCENTAGE PARSER
//==========================================================

function tryPercentage(value) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(PERCENTAGE_REGEX);

  if (!match) {
    return null;
  }

  return {
    type: "percentage",
    value: Number(match[1]),
    raw: value.trim(),
  };
}

//==========================================================
// JSON PARSER
//==========================================================

function tryJSON(value) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!text) {
    return null;
  }

  const first = text[0];

  if (first !== "{" && first !== "[") {
    return null;
  }

  const last = text[text.length - 1];

  if ((first === "{" && last !== "}") || (first === "[" && last !== "]")) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

//==========================================================
// RANGE PARSER
//==========================================================

function tryRange(value) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  const match = text.match(RANGE_REGEX);

  if (!match) {
    return null;
  }

  const min = Number(match[1]);
  const max = Number(match[2]);

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  return {
    type: "range",
    min,
    max,
  };
}

//==========================================================
// ARRAY PARSER
//==========================================================

function tryArray(value) {
  if (typeof value !== "string") {
    return null;
  }

  if (!value.includes(",")) {
    return null;
  }

  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!values.length) {
    return null;
  }

  return values;
}

//==========================================================
// QUOTED STRING PARSER
//==========================================================

function tryQuoted(value) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  const match = text.match(QUOTED_REGEX);

  if (!match) {
    return null;
  }

  return match[2];
}

//==========================================================
// MAIN VALUE PARSER
//==========================================================

export function parseValue(input) {
  //--------------------------------------------------------
  // Null / undefined
  //--------------------------------------------------------

  if (input == null) {
    return null;
  }

  //--------------------------------------------------------
  // Already structured values
  //--------------------------------------------------------

  if (typeof input === "number" || typeof input === "boolean") {
    return input;
  }

  //--------------------------------------------------------
  // Normalize
  //--------------------------------------------------------

  const raw = String(input).trim();

  if (!raw) {
    return null;
  }

  //--------------------------------------------------------
  // Boolean
  //--------------------------------------------------------

  const lower = raw.toLowerCase();

  if (BOOLEAN_MAP.has(lower)) {
    return BOOLEAN_MAP.get(lower);
  }

  //--------------------------------------------------------
  // JSON
  //--------------------------------------------------------

  const json = tryJSON(raw);

  if (json !== null) {
    return json;
  }

  //--------------------------------------------------------
  // Percentage
  //--------------------------------------------------------

  const percentage = tryPercentage(raw);

  if (percentage) {
    return percentage;
  }

  //--------------------------------------------------------
  // Range
  //--------------------------------------------------------

  const range = tryRange(raw);

  if (range) {
    return range;
  }

  //--------------------------------------------------------
  // Number
  //--------------------------------------------------------

  const number = tryNumber(raw);

  if (number !== null) {
    return number;
  }

  //--------------------------------------------------------
  // Array
  //--------------------------------------------------------

  const array = tryArray(raw);

  if (array) {
    return array;
  }

  //--------------------------------------------------------
  // Quoted string
  //--------------------------------------------------------

  const quoted = tryQuoted(raw);

  if (quoted !== null) {
    return quoted;
  }

  //--------------------------------------------------------
  // Default text
  //--------------------------------------------------------

  return raw;
}

//==========================================================
// VALUE TYPE DETECTION
//==========================================================

export function getValueType(value) {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (typeof value === "object" && value.type === "range") {
    return "range";
  }

  if (typeof value === "object" && value.type === "percentage") {
    return "percentage";
  }

  if (typeof value === "object") {
    return "object";
  }

  return typeof value;
}

//==========================================================
// PARSE WITH METADATA
//==========================================================

export function parseValueWithMeta(input) {
  const parsed = parseValue(input);

  return {
    raw: input,

    normalized: typeof input === "string" ? input.trim() : input,

    type: getValueType(parsed),

    value: parsed,

    valid: parsed !== null,
  };
}

//==========================================================
// BATCH PARSER
//==========================================================

export function parseValues(inputs) {
  if (!Array.isArray(inputs)) {
    return [];
  }

  const output = new Array(inputs.length);

  for (let i = 0; i < inputs.length; i++) {
    output[i] = parseValue(inputs[i]);
  }

  return output;
}

//==========================================================
// BATCH PARSER WITH METADATA
//==========================================================

export function parseValuesWithMeta(inputs) {
  if (!Array.isArray(inputs)) {
    return [];
  }

  const output = new Array(inputs.length);

  for (let i = 0; i < inputs.length; i++) {
    output[i] = parseValueWithMeta(inputs[i]);
  }

  return output;
}

//==========================================================
// RANGE VALIDATION
//==========================================================

export function isRange(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.type === "range" &&
    Number.isFinite(value.min) &&
    Number.isFinite(value.max),
  );
}

//==========================================================
// PERCENTAGE VALIDATION
//==========================================================

export function isPercentage(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.type === "percentage" &&
    Number.isFinite(value.value),
  );
}

//==========================================================
// BOOLEAN CHECK
//==========================================================

export function isBooleanValue(value) {
  return typeof value === "boolean";
}

//==========================================================
// NUMBER CHECK
//==========================================================

export function isNumberValue(value) {
  return typeof value === "number" && Number.isFinite(value);
}

//==========================================================
// STRING CHECK
//==========================================================

export function isTextValue(value) {
  return typeof value === "string";
}
