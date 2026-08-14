// backend/planner/value-parser.js

/**
 * ==========================================================
 *
 * backend/planner/value-parser.js
 *
 * Ultra Intelligent Deterministic Value Parser
 * for Jarvis Browser Planner
 *
 * ==========================================================
 *
 * PIPELINE
 *
 * User Input
 *      │
 *      ▼
 * Normalizer
 *      │
 *      ▼
 * IntentParser
 *      │
 *      ▼
 * ActionParser
 *      │
 *      ▼
 * EntityParser
 *      │
 *      ▼
 * TargetParser
 *      │
 *      ▼
 * ValueParser
 *      │
 *      ▼
 * ScoringEngine
 *      │
 *      ▼
 * Planner / LLM
 *      │
 *      ▼
 * Resolver
 *
 * ==========================================================
 *
 * RESPONSIBILITIES
 * ==========================================================
 *
 * ✔ Parse booleans
 * ✔ Parse numbers
 * ✔ Parse negative numbers
 * ✔ Parse decimals
 * ✔ Parse percentages
 * ✔ Parse ranges
 * ✔ Parse arrays
 * ✔ Parse JSON
 * ✔ Parse quoted strings
 * ✔ Parse URLs
 * ✔ Parse emails
 * ✔ Parse file paths
 * ✔ Parse durations
 * ✔ Parse keyboard keys
 * ✔ Preserve normal text
 * ✔ Batch parsing
 * ✔ Metadata support
 * ✔ Custom parser support
 * ✔ Deterministic parsing
 * ✔ Safe parsing
 * ✔ Optional caching
 *
 * IMPORTANT
 * ==========================================================
 *
 * ❌ NEVER performs fuzzy matching
 * ❌ NEVER performs spelling correction
 * ❌ NEVER guesses user intent
 * ❌ NEVER resolves DOM elements
 * ❌ NEVER calls an LLM
 *
 * Value parsing only.
 *
 * Fuzzy matching belongs ONLY to ScoringEngine.
 *
 * ==========================================================
 */

//==========================================================
// DEFAULT OPTIONS
//==========================================================

const DEFAULT_OPTIONS = {
  debug: false,

  enableCache: true,

  maxCacheSize: 1000,

  enableUrls: true,

  enableEmails: true,

  enableFilePaths: true,

  enableDurations: true,

  enableKeys: true,

  enableArrays: true,

  enableJson: true,

  enablePercentages: true,

  enableRanges: true,

  enableQuoted: true,

  enableCustomParsers: true,
};

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

  ["active", true],
  ["inactive", false],

  ["checked", true],
  ["unchecked", false],
]);

//==========================================================
// PRECOMPILED REGEX
//==========================================================

// Number
const NUMBER_REGEX = /^[-+]?\d+(?:\.\d+)?$/;

// Percentage
const PERCENTAGE_REGEX = /^([-+]?\d+(?:\.\d+)?)\s*%$/;

// Range
//
// Supports:
//
// 10-20
// 10 - 20
// -10 - 20
// -10--5
//
const RANGE_REGEX = /^([-+]?\d+(?:\.\d+)?)\s*-\s*([-+]?\d+(?:\.\d+)?)$/;

// Quoted string
const QUOTED_REGEX = /^(['"`])([\s\S]*)\1$/;

// URL
const URL_REGEX = /^(?:https?:\/\/|www\.)[^\s<>"']+$/i;

// Email
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// Windows path
const WINDOWS_PATH_REGEX = /^[a-zA-Z]:\\[^<>:"|?*\r\n]+$/;

// Unix path
const UNIX_PATH_REGEX = /^\/(?:[^\/\s]+\/)*[^\/\s]+$/;

// Duration
const DURATION_REGEX =
  /^([-+]?\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)$/i;

// Keyboard key
const KEY_REGEX =
  /^(ctrl|control|shift|alt|meta|cmd|command|enter|tab|escape|esc|space|delete|backspace|home|end|arrowup|arrowdown|arrowleft|arrowright)$/i;

//==========================================================
// NUMBER PARSER
//==========================================================

function tryNumber(value) {
  if (value === "" || value === null || value === undefined) {
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

  const text = value.trim();

  const match = text.match(PERCENTAGE_REGEX);

  if (!match) {
    return null;
  }

  const number = Number(match[1]);

  if (!Number.isFinite(number)) {
    return null;
  }

  return {
    type: "percentage",

    value: number,

    raw: text,
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
    const parsed = JSON.parse(text);

    return parsed;
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

    valid: min <= max,
  };
}

//==========================================================
// ARRAY PARSER
//==========================================================

function tryArray(value) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!text.includes(",")) {
    return null;
  }

  const values = text
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
// URL PARSER
//==========================================================

function tryUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!URL_REGEX.test(text)) {
    return null;
  }

  return {
    type: "url",

    value: text,
  };
}

//==========================================================
// EMAIL PARSER
//==========================================================

function tryEmail(value) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!EMAIL_REGEX.test(text)) {
    return null;
  }

  return {
    type: "email",

    value: text,
  };
}

//==========================================================
// FILE PATH PARSER
//==========================================================

function tryFilePath(value) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (WINDOWS_PATH_REGEX.test(text) || UNIX_PATH_REGEX.test(text)) {
    return {
      type: "filePath",

      value: text,
    };
  }

  return null;
}

//==========================================================
// DURATION UNIT NORMALIZER
//==========================================================

function normalizeDurationUnit(unit = "ms") {
  const value = String(unit).toLowerCase().trim();

  if (value === "ms" || value === "millisecond" || value === "milliseconds") {
    return "ms";
  }

  if (
    value === "s" ||
    value === "sec" ||
    value === "secs" ||
    value === "second" ||
    value === "seconds"
  ) {
    return "s";
  }

  if (
    value === "m" ||
    value === "min" ||
    value === "mins" ||
    value === "minute" ||
    value === "minutes"
  ) {
    return "m";
  }

  if (
    value === "h" ||
    value === "hr" ||
    value === "hrs" ||
    value === "hour" ||
    value === "hours"
  ) {
    return "h";
  }

  return "ms";
}

//==========================================================
// DURATION CONVERTER
//==========================================================

function toMilliseconds(value, unit) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  switch (unit) {
    case "s":
      return number * 1000;

    case "m":
      return number * 60000;

    case "h":
      return number * 3600000;

    case "ms":
    default:
      return number;
  }
}

//==========================================================
// DURATION PARSER
//==========================================================

function tryDuration(value) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  const match = text.match(DURATION_REGEX);

  if (!match) {
    return null;
  }

  const duration = Number(match[1]);

  const unit = normalizeDurationUnit(match[2]);

  if (!Number.isFinite(duration)) {
    return null;
  }

  return {
    type: "duration",

    value: duration,

    duration,

    unit,

    milliseconds: toMilliseconds(duration, unit),

    raw: text,
  };
}

//==========================================================
// KEY PARSER
//==========================================================

function mapKey(key) {
  const map = {
    ctrl: "Control",

    control: "Control",

    shift: "Shift",

    alt: "Alt",

    meta: "Meta",

    cmd: "Meta",

    command: "Meta",

    enter: "Enter",

    tab: "Tab",

    escape: "Escape",

    esc: "Escape",

    space: "Space",

    delete: "Delete",

    backspace: "Backspace",

    home: "Home",

    end: "End",

    arrowup: "ArrowUp",

    arrowdown: "ArrowDown",

    arrowleft: "ArrowLeft",

    arrowright: "ArrowRight",
  };

  return map[String(key).toLowerCase()] || key;
}

//==========================================================
// KEY PARSER
//==========================================================

function tryKey(value) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!KEY_REGEX.test(text)) {
    return null;
  }

  return {
    type: "key",

    value: mapKey(text),

    raw: text,
  };
}

//==========================================================
// SHORTCUT PARSER
//==========================================================

function tryShortcut(value) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!text.includes("+")) {
    return null;
  }

  const parts = text
    .split("+")
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  const keys = parts.map((key) => mapKey(key));

  return {
    type: "shortcut",

    value: keys,

    keys,

    raw: text,
  };
}

//==========================================================
// MAIN VALUE PARSER
//==========================================================

export function parseValue(input, options = {}) {
  //--------------------------------------------------------
  // Null / undefined
  //--------------------------------------------------------

  if (input === null || input === undefined) {
    return null;
  }

  //--------------------------------------------------------
  // Already structured values
  //--------------------------------------------------------

  if (typeof input === "number" || typeof input === "boolean") {
    return input;
  }

  //--------------------------------------------------------
  // Existing arrays
  //--------------------------------------------------------

  if (Array.isArray(input)) {
    return input;
  }

  //--------------------------------------------------------
  // Existing objects
  //--------------------------------------------------------

  if (typeof input === "object") {
    return input;
  }

  //--------------------------------------------------------
  // Normalize
  //--------------------------------------------------------

  const raw = String(input).normalize("NFKC").trim();

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

  if (options.enableJson !== false) {
    const json = tryJSON(raw);

    if (json !== null) {
      return json;
    }
  }

  //--------------------------------------------------------
  // Quoted string
  //--------------------------------------------------------

  if (options.enableQuoted !== false) {
    const quoted = tryQuoted(raw);

    if (quoted !== null) {
      return quoted;
    }
  }

  //--------------------------------------------------------
  // Shortcut
  //--------------------------------------------------------

  if (options.enableKeys !== false) {
    const shortcut = tryShortcut(raw);

    if (shortcut) {
      return shortcut;
    }
  }

  //--------------------------------------------------------
  // Key
  //--------------------------------------------------------

  if (options.enableKeys !== false) {
    const key = tryKey(raw);

    if (key) {
      return key;
    }
  }

  //--------------------------------------------------------
  // URL
  //--------------------------------------------------------

  if (options.enableUrls !== false) {
    const url = tryUrl(raw);

    if (url) {
      return url;
    }
  }

  //--------------------------------------------------------
  // Email
  //--------------------------------------------------------

  if (options.enableEmails !== false) {
    const email = tryEmail(raw);

    if (email) {
      return email;
    }
  }

  //--------------------------------------------------------
  // File path
  //--------------------------------------------------------

  if (options.enableFilePaths !== false) {
    const filePath = tryFilePath(raw);

    if (filePath) {
      return filePath;
    }
  }

  //--------------------------------------------------------
  // Duration
  //--------------------------------------------------------

  if (options.enableDurations !== false) {
    const duration = tryDuration(raw);

    if (duration) {
      return duration;
    }
  }

  //--------------------------------------------------------
  // Percentage
  //--------------------------------------------------------

  if (options.enablePercentages !== false) {
    const percentage = tryPercentage(raw);

    if (percentage) {
      return percentage;
    }
  }

  //--------------------------------------------------------
  // Range
  //--------------------------------------------------------

  if (options.enableRanges !== false) {
    const range = tryRange(raw);

    if (range) {
      return range;
    }
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

  if (options.enableArrays !== false) {
    const array = tryArray(raw);

    if (array) {
      return array;
    }
  }

  //--------------------------------------------------------
  // Custom parsers
  //--------------------------------------------------------

  if (
    options.enableCustomParsers !== false &&
    Array.isArray(options.customParsers)
  ) {
    for (const parser of options.customParsers) {
      if (typeof parser !== "function") {
        continue;
      }

      try {
        const result = parser(raw);

        if (result !== undefined && result !== null) {
          return result;
        }
      } catch {
        // Ignore custom parser failures
      }
    }
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

  if (value === undefined) {
    return "undefined";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (typeof value === "object") {
    if (value.type === "range") {
      return "range";
    }

    if (value.type === "percentage") {
      return "percentage";
    }

    if (value.type === "duration") {
      return "duration";
    }

    if (value.type === "url") {
      return "url";
    }

    if (value.type === "email") {
      return "email";
    }

    if (value.type === "filePath") {
      return "filePath";
    }

    if (value.type === "key") {
      return "key";
    }

    if (value.type === "shortcut") {
      return "shortcut";
    }

    return "object";
  }

  return typeof value;
}

//==========================================================
// VALUE SOURCE DETECTION
//==========================================================

export function getValueSource(value) {
  const type = getValueType(value);

  switch (type) {
    case "boolean":
      return "boolean";

    case "number":
      return "number";

    case "percentage":
      return "percentage";

    case "range":
      return "range";

    case "duration":
      return "duration";

    case "url":
      return "url";

    case "email":
      return "email";

    case "filePath":
      return "file";

    case "key":
      return "keyboard";

    case "shortcut":
      return "keyboard";

    case "array":
      return "array";

    case "object":
      return "json";

    case "string":
      return "text";

    default:
      return "unknown";
  }
}

//==========================================================
// PARSE WITH METADATA
//==========================================================

export function parseValueWithMeta(input, options = {}) {
  const parsed = parseValue(input, options);

  return {
    raw: input,

    normalized:
      typeof input === "string" ? input.normalize("NFKC").trim() : input,

    type: getValueType(parsed),

    source: getValueSource(parsed),

    value: parsed,

    valid: parsed !== null && parsed !== undefined,

    isStructured: typeof parsed === "object" && parsed !== null,

    confidence: parsed === null ? 0 : 1,
  };
}

//==========================================================
// ACTION VALUE PARSER
//
// Used by ActionParser / Planner.
//
// Example:
//
// type "John" into username
//
// value:
// John
//
// select India from country
//
// value:
// India
//==========================================================

export function parseActionValue(input, options = {}) {
  const meta = parseValueWithMeta(input, options);

  return {
    value: meta.value,

    type: meta.type,

    source: meta.source,

    raw: meta.raw,

    normalized: meta.normalized,

    valid: meta.valid,

    confidence: meta.confidence,
  };
}

//==========================================================
// BATCH PARSER
//==========================================================

export function parseValues(inputs, options = {}) {
  if (!Array.isArray(inputs)) {
    return [];
  }

  const output = new Array(inputs.length);

  for (let i = 0; i < inputs.length; i++) {
    output[i] = parseValue(inputs[i], options);
  }

  return output;
}

//==========================================================
// BATCH PARSER WITH METADATA
//==========================================================

export function parseValuesWithMeta(inputs, options = {}) {
  if (!Array.isArray(inputs)) {
    return [];
  }

  const output = new Array(inputs.length);

  for (let i = 0; i < inputs.length; i++) {
    output[i] = parseValueWithMeta(inputs[i], options);
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
// DURATION VALIDATION
//==========================================================

export function isDuration(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.type === "duration" &&
    Number.isFinite(value.duration) &&
    Number.isFinite(value.milliseconds),
  );
}

//==========================================================
// URL VALIDATION
//==========================================================

export function isUrlValue(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.type === "url" &&
    typeof value.value === "string",
  );
}

//==========================================================
// EMAIL VALIDATION
//==========================================================

export function isEmailValue(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.type === "email" &&
    typeof value.value === "string",
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

//==========================================================
// ARRAY CHECK
//==========================================================

export function isArrayValue(value) {
  return Array.isArray(value);
}

//==========================================================
// OBJECT CHECK
//==========================================================

export function isObjectValue(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

//==========================================================
// CACHE KEY
//==========================================================

function createCacheKey(input, options = {}) {
  return JSON.stringify({
    input,

    enableUrls: options.enableUrls,

    enableEmails: options.enableEmails,

    enableFilePaths: options.enableFilePaths,

    enableDurations: options.enableDurations,

    enableKeys: options.enableKeys,

    enableArrays: options.enableArrays,

    enableJson: options.enableJson,

    enablePercentages: options.enablePercentages,

    enableRanges: options.enableRanges,

    enableQuoted: options.enableQuoted,
  });
}

//==========================================================
// VALUE PARSER CLASS
//
// Provides an object-oriented API while preserving
// the functional exports above.
//==========================================================

export class ValueParser {
  constructor(options = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    this.cache = new Map();

    this.debug = this.options.debug;
  }

  //========================================================
  // LOG
  //========================================================

  log(...args) {
    if (this.debug) {
      console.log("[ValueParser]", ...args);
    }
  }

  //========================================================
  // PARSE
  //========================================================

  parse(input) {
    //------------------------------------------------------
    // Cache disabled
    //------------------------------------------------------

    if (!this.options.enableCache) {
      return parseValue(input, this.options);
    }

    //------------------------------------------------------
    // Cache key
    //------------------------------------------------------

    const key = createCacheKey(input, this.options);

    //------------------------------------------------------
    // Cache hit
    //------------------------------------------------------

    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    //------------------------------------------------------
    // Parse
    //------------------------------------------------------

    const result = parseValue(input, this.options);

    //------------------------------------------------------
    // Store
    //------------------------------------------------------

    this._setCache(key, result);

    this.log("Parsed value:", {
      input,
      result,
    });

    return result;
  }

  //========================================================
  // PARSE WITH META
  //========================================================

  parseWithMeta(input) {
    const result = parseValueWithMeta(input, this.options);

    return result;
  }

  //========================================================
  // PARSE ACTION VALUE
  //========================================================

  parseActionValue(input) {
    return parseActionValue(input, this.options);
  }

  //========================================================
  // PARSE BATCH
  //========================================================

  parseMany(inputs) {
    return parseValues(inputs, this.options);
  }

  //========================================================
  // PARSE BATCH WITH META
  //========================================================

  parseManyWithMeta(inputs) {
    return parseValuesWithMeta(inputs, this.options);
  }

  //========================================================
  // CACHE SET
  //========================================================

  _setCache(key, value) {
    if (this.cache.size >= this.options.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;

      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, value);
  }

  //========================================================
  // CLEAR CACHE
  //========================================================

  clearCache() {
    this.cache.clear();
  }

  //========================================================
  // CACHE SIZE
  //========================================================

  getCacheSize() {
    return this.cache.size;
  }

  //========================================================
  // STATS
  //========================================================

  stats() {
    return {
      cacheSize: this.cache.size,

      maxCacheSize: this.options.maxCacheSize,

      cacheEnabled: this.options.enableCache,

      urls: this.options.enableUrls,

      emails: this.options.enableEmails,

      filePaths: this.options.enableFilePaths,

      durations: this.options.enableDurations,

      keys: this.options.enableKeys,

      arrays: this.options.enableArrays,

      json: this.options.enableJson,

      percentages: this.options.enablePercentages,

      ranges: this.options.enableRanges,

      quoted: this.options.enableQuoted,

      fuzzyMatching: false,

      spellingCorrection: false,

      intentGuessing: false,

      domResolution: false,

      llm: false,
    };
  }
}

//==========================================================
// DEFAULT EXPORT
//==========================================================
//
// The named exports above remain available:
//
// import {
//   parseValue,
//   parseValueWithMeta,
//   parseActionValue,
// } from "./value-parser.js";
//
// The class is also available:
//
// import ValueParser from "./value-parser.js";
//
//==========================================================

export default ValueParser;
