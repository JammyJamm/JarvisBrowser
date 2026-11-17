// backend/planner/validation.js
//
// Ultra-fast validation layer for Jarvis Planner
// --------------------------------------------------
// Responsibilities:
// - Validate normalized intents
// - Validate action-map results
// - Validate planner requests
// - Validate execution plans
// - Validate scoring-engine decisions
// - Provide lightweight type guards
// - Sanitize untrusted strings
//
// Architecture:
//
// User Input
//     │
//     ▼
// Intent Parser
//     │
//     ▼
// Validation
//     │
//     ├── Invalid → Reject / Repair
//     │
//     ▼
// Scoring Engine
//     │
//     ├── High Confidence → Execute
//     │
//     └── Low Confidence → Planner
//                              │
//                              ▼
//                         Validation
//                              │
//                              ▼
//                         Self-Healing
//
// NOTE:
// Validation NEVER performs fuzzy matching.
// Validation NEVER performs DOM resolution.
// Validation NEVER calls the LLM.
// It only checks structure, types, and safety.
//

// ==========================================================
// CONSTANTS
// ==========================================================

export const VALIDATION_CODES = Object.freeze({
  VALIDATION_ERROR: "VALIDATION_ERROR",

  REQUIRED: "REQUIRED",

  INVALID_TYPE: "INVALID_TYPE",

  INVALID_VALUE: "INVALID_VALUE",

  INVALID_INTENT: "INVALID_INTENT",

  INVALID_ACTION: "INVALID_ACTION",

  INVALID_PLAN: "INVALID_PLAN",

  INVALID_REQUEST: "INVALID_REQUEST",

  INVALID_CANDIDATE: "INVALID_CANDIDATE",

  UNSAFE_INPUT: "UNSAFE_INPUT",
});

// ==========================================================
// VALIDATION ERROR
// ==========================================================

export class ValidationError extends Error {
  constructor(message, code = VALIDATION_CODES.VALIDATION_ERROR, details = {}) {
    super(message);

    this.name = "ValidationError";

    this.code = code;

    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationError);
    }
  }
}

// ==========================================================
// TYPE GUARDS
// ==========================================================

export const isString = (value) => typeof value === "string";

export const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

export const isNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

export const isBoolean = (value) => typeof value === "boolean";

export const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const isArray = Array.isArray;

export const isFunction = (value) => typeof value === "function";

// ==========================================================
// STRING SANITIZATION
// ==========================================================

/**
 * Lightweight string sanitizer.
 *
 * Does NOT attempt to sanitize HTML or JavaScript.
 * It only normalizes whitespace and removes angle brackets.
 */
export function sanitizeString(value) {
  if (!isString(value)) return "";

  return value.replace(/\s+/g, " ").replace(/[<>]/g, "").trim();
}

/**
 * Normalize a string without mutating original input.
 */
export function normalizeString(value) {
  return sanitizeString(value).toLowerCase();
}

/**
 * Limit string size to prevent accidental huge planner inputs.
 */
export function limitString(value, maxLength = 10000) {
  if (!isString(value)) return "";

  return value.slice(0, maxLength);
}

// ==========================================================
// REQUIRED KEY VALIDATION
// ==========================================================

export function requireKeys(obj, keys = []) {
  if (!isObject(obj)) {
    throw new ValidationError(
      "Object required for key validation",
      VALIDATION_CODES.INVALID_TYPE,
    );
  }

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    if (!(key in obj)) {
      throw new ValidationError(
        `Missing required key: ${key}`,
        VALIDATION_CODES.REQUIRED,
        {
          key,
        },
      );
    }
  }

  return true;
}

// ==========================================================
// OPTIONAL ENUM VALIDATION
// ==========================================================

export function validateEnum(value, allowed = [], fieldName = "value") {
  if (!allowed.includes(value)) {
    throw new ValidationError(
      `${fieldName} must be one of: ${allowed.join(", ")}`,
      VALIDATION_CODES.INVALID_VALUE,
      {
        field: fieldName,
        value,
        allowed,
      },
    );
  }

  return true;
}

// ==========================================================
// INTENT TYPES
// ==========================================================
//
// These are broad normalized intent categories.
// The list can be extended without changing validation logic.
//

export const INTENT_TYPES = Object.freeze([
  "navigate",
  "search",
  "click",
  "type",
  "select",
  "scroll",
  "wait",
  "extract",
  "back",
  "forward",
  "reload",
  "open_tab",
  "close_tab",
  "screenshot",
  "execute_js",
  "file_create",
  "file_delete",
  "file_read",
  "file_open",
  "file_write",
  "file_edit",
  "execute",
  "build",
  "debug",
  "info_query",
  "ai_summary",
  "ai_rewrite",
  "plan",
  "schedule",
  "reminder",
  "task_add",
  "unknown",
]);

// ==========================================================
// ACTION TYPES
// ==========================================================
//
// Compatible with action-map.js normalized action types.
//

export const ACTION_TYPES = Object.freeze([
  "navigate",
  "click",
  "type",
  "scroll",
  "wait",
  "extract",
  "back",
  "forward",
  "reload",
  "open_tab",
  "close_tab",
  "screenshot",
  "execute_js",
]);

// ==========================================================
// VALIDATE INTENT
// ==========================================================

/**
 * Validate normalized planner intent.
 *
 * Supports:
 *
 * {
 *   type: "click",
 *   target: "Login"
 * }
 *
 * or:
 *
 * {
 *   type: "navigate",
 *   target: "https://google.com"
 * }
 *
 * The object is never mutated.
 */
export function validateIntent(intent, options = {}) {
  const { requireTarget = false, allowedTypes = null } = options;

  if (!intent) {
    throw new ValidationError("Intent is required", VALIDATION_CODES.REQUIRED);
  }

  if (!isObject(intent)) {
    throw new ValidationError(
      "Intent must be an object",
      VALIDATION_CODES.INVALID_TYPE,
    );
  }

  if (!isNonEmptyString(intent.type)) {
    throw new ValidationError(
      "Intent.type must be a non-empty string",
      VALIDATION_CODES.INVALID_INTENT,
    );
  }

  const type = normalizeString(intent.type);

  if (allowedTypes) {
    validateEnum(type, allowedTypes, "Intent.type");
  }

  if (
    options.validateKnownType !== false &&
    !allowedTypes &&
    !INTENT_TYPES.includes(type)
  ) {
    throw new ValidationError(
      `Unknown intent type: ${type}`,
      VALIDATION_CODES.INVALID_INTENT,
      {
        type,
      },
    );
  }

  if (requireTarget) {
    const hasTarget =
      isNonEmptyString(intent.target) ||
      isNonEmptyString(intent.selector) ||
      isNonEmptyString(intent.text) ||
      isNonEmptyString(intent.value);

    if (!hasTarget) {
      throw new ValidationError(
        "Intent target is required",
        VALIDATION_CODES.REQUIRED,
      );
    }
  }

  if (
    intent.confidence !== undefined &&
    (!isNumber(intent.confidence) ||
      intent.confidence < 0 ||
      intent.confidence > 100)
  ) {
    throw new ValidationError(
      "Intent.confidence must be a number between 0 and 100",
      VALIDATION_CODES.INVALID_VALUE,
    );
  }

  return true;
}

// ==========================================================
// VALIDATE ACTION
// ==========================================================

/**
 * Validate normalized action output.
 *
 * Example:
 *
 * {
 *   type: "click",
 *   selector: "Login"
 * }
 */
export function validateAction(action, options = {}) {
  if (!action || !isObject(action)) {
    throw new ValidationError(
      "Action must be an object",
      VALIDATION_CODES.INVALID_ACTION,
    );
  }

  const actionType = action.type || action.action || action.name;

  if (!isNonEmptyString(actionType)) {
    throw new ValidationError(
      "Action.type is required",
      VALIDATION_CODES.INVALID_ACTION,
    );
  }

  const normalizedType = normalizeString(actionType);

  if (
    options.validateKnownType !== false &&
    !ACTION_TYPES.includes(normalizedType)
  ) {
    throw new ValidationError(
      `Unknown action type: ${normalizedType}`,
      VALIDATION_CODES.INVALID_ACTION,
      {
        type: normalizedType,
      },
    );
  }

  if (action.payload !== undefined && !isObject(action.payload)) {
    throw new ValidationError(
      "Action.payload must be an object",
      VALIDATION_CODES.INVALID_TYPE,
    );
  }

  if (
    action.confidence !== undefined &&
    (!isNumber(action.confidence) ||
      action.confidence < 0 ||
      action.confidence > 100)
  ) {
    throw new ValidationError(
      "Action.confidence must be between 0 and 100",
      VALIDATION_CODES.INVALID_VALUE,
    );
  }

  return true;
}

// ==========================================================
// VALIDATE ACTION MAP RESULT
// ==========================================================

/**
 * Validate result returned from action-map.js.
 *
 * mapAction() can return:
 *
 * {
 *   type: "click",
 *   selector: "Login"
 * }
 */
export function validateActionResult(action) {
  if (!action) {
    return false;
  }

  try {
    validateAction(action);
    return true;
  } catch {
    return false;
  }
}

// ==========================================================
// VALIDATE PLANNER STEP
// ==========================================================

export function validateStep(step, index = 0) {
  if (isString(step)) {
    if (!isNonEmptyString(step)) {
      throw new ValidationError(
        `Step ${index} cannot be empty`,
        VALIDATION_CODES.INVALID_PLAN,
      );
    }

    return true;
  }

  if (!isObject(step)) {
    throw new ValidationError(
      `Step ${index} must be an object or string`,
      VALIDATION_CODES.INVALID_PLAN,
    );
  }

  const hasAction =
    isNonEmptyString(step.action) ||
    isNonEmptyString(step.type) ||
    isNonEmptyString(step.name);

  if (!hasAction) {
    throw new ValidationError(
      `Step ${index} must contain an action`,
      VALIDATION_CODES.INVALID_PLAN,
    );
  }

  return true;
}

// ==========================================================
// VALIDATE PLAN
// ==========================================================

/**
 * Validate complete planner output.
 *
 * Supported:
 *
 * {
 *   intent: "login",
 *   steps: [...]
 * }
 *
 * or:
 *
 * {
 *   intent: "login",
 *   actions: [...]
 * }
 */
export function validatePlan(plan) {
  if (!plan || !isObject(plan)) {
    throw new ValidationError(
      "Plan must be an object",
      VALIDATION_CODES.INVALID_PLAN,
    );
  }

  if (plan.intent !== undefined && !isString(plan.intent)) {
    throw new ValidationError(
      "Plan.intent must be a string",
      VALIDATION_CODES.INVALID_TYPE,
    );
  }

  const steps = plan.steps || plan.actions || plan.plan;

  if (steps === undefined) {
    throw new ValidationError(
      "Plan must contain steps or actions",
      VALIDATION_CODES.INVALID_PLAN,
    );
  }

  if (!isArray(steps)) {
    throw new ValidationError(
      "Plan.steps must be an array",
      VALIDATION_CODES.INVALID_TYPE,
    );
  }

  for (let i = 0; i < steps.length; i++) {
    validateStep(steps[i], i);
  }

  return true;
}

// ==========================================================
// VALIDATE PLAN REQUEST
// ==========================================================

export function validatePlanRequest(req) {
  if (!req || !isObject(req)) {
    throw new ValidationError(
      "Request must be an object",
      VALIDATION_CODES.INVALID_REQUEST,
    );
  }

  if (req.intent !== undefined) {
    validateIntent(req.intent, {
      validateKnownType: false,
    });
  }

  if (req.action !== undefined) {
    validateAction(req.action, {
      validateKnownType: false,
    });
  }

  if (req.actions !== undefined) {
    if (!isArray(req.actions)) {
      throw new ValidationError(
        "actions must be an array",
        VALIDATION_CODES.INVALID_TYPE,
      );
    }

    for (let i = 0; i < req.actions.length; i++) {
      validateAction(req.actions[i], {
        validateKnownType: false,
      });
    }
  }

  if (req.plan !== undefined) {
    validatePlan(req.plan);
  }

  return true;
}

// ==========================================================
// VALIDATE SCORING CANDIDATE
// ==========================================================

/**
 * Validate a DOM candidate generated by ScoringEngine.
 */
export function validateCandidate(candidate) {
  if (!candidate || !isObject(candidate)) {
    throw new ValidationError(
      "Candidate must be an object",
      VALIDATION_CODES.INVALID_CANDIDATE,
    );
  }

  if (
    candidate.score !== undefined &&
    (!isNumber(candidate.score) || candidate.score < 0 || candidate.score > 100)
  ) {
    throw new ValidationError(
      "Candidate.score must be between 0 and 100",
      VALIDATION_CODES.INVALID_VALUE,
    );
  }

  if (candidate.visible !== undefined && !isBoolean(candidate.visible)) {
    throw new ValidationError(
      "Candidate.visible must be boolean",
      VALIDATION_CODES.INVALID_TYPE,
    );
  }

  if (candidate.enabled !== undefined && !isBoolean(candidate.enabled)) {
    throw new ValidationError(
      "Candidate.enabled must be boolean",
      VALIDATION_CODES.INVALID_TYPE,
    );
  }

  return true;
}

// ==========================================================
// VALIDATE SCORING DECISION
// ==========================================================

/**
 * Validate ScoringEngine.findBestCandidate() result.
 */
export function validateScoringDecision(result) {
  if (!result || !isObject(result)) {
    throw new ValidationError(
      "Scoring decision must be an object",
      VALIDATION_CODES.INVALID_TYPE,
    );
  }

  if (
    result.confidence !== undefined &&
    (!isNumber(result.confidence) ||
      result.confidence < 0 ||
      result.confidence > 100)
  ) {
    throw new ValidationError(
      "Scoring confidence must be between 0 and 100",
      VALIDATION_CODES.INVALID_VALUE,
    );
  }

  if (result.ambiguous !== undefined && !isBoolean(result.ambiguous)) {
    throw new ValidationError(
      "Scoring ambiguous must be boolean",
      VALIDATION_CODES.INVALID_TYPE,
    );
  }

  if (
    result.plannerRequired !== undefined &&
    !isBoolean(result.plannerRequired)
  ) {
    throw new ValidationError(
      "plannerRequired must be boolean",
      VALIDATION_CODES.INVALID_TYPE,
    );
  }

  if (result.autoExecute !== undefined && !isBoolean(result.autoExecute)) {
    throw new ValidationError(
      "autoExecute must be boolean",
      VALIDATION_CODES.INVALID_TYPE,
    );
  }

  if (result.candidate) {
    validateCandidate(result.candidate);
  }

  return true;
}

// ==========================================================
// SAFE VALIDATION WRAPPER
// ==========================================================

/**
 * Non-throwing validation helper.
 *
 * Useful for planner pipelines where validation failure
 * should be converted into a controlled result.
 */
export function isValid(value, validator, ...args) {
  try {
    validator(value, ...args);
    return true;
  } catch {
    return false;
  }
}

// ==========================================================
// SAFE VALIDATION RESULT
// ==========================================================

export function validateSafe(value, validator, ...args) {
  try {
    validator(value, ...args);

    return {
      valid: true,
      error: null,
      code: null,
    };
  } catch (error) {
    return {
      valid: false,
      error: error?.message || "Validation failed",
      code: error?.code || VALIDATION_CODES.VALIDATION_ERROR,
    };
  }
}

// ==========================================================
// ASSERT STRING
// ==========================================================

export function assertString(value, fieldName = "value") {
  if (!isString(value)) {
    throw new ValidationError(
      `${fieldName} must be a string`,
      VALIDATION_CODES.INVALID_TYPE,
    );
  }

  return true;
}

// ==========================================================
// ASSERT NON-EMPTY STRING
// ==========================================================

export function assertNonEmptyString(value, fieldName = "value") {
  if (!isNonEmptyString(value)) {
    throw new ValidationError(
      `${fieldName} must be a non-empty string`,
      VALIDATION_CODES.REQUIRED,
    );
  }

  return true;
}

// ==========================================================
// ASSERT NUMBER RANGE
// ==========================================================

export function assertNumberRange(
  value,
  min = 0,
  max = 100,
  fieldName = "value",
) {
  if (!isNumber(value) || value < min || value > max) {
    throw new ValidationError(
      `${fieldName} must be between ${min} and ${max}`,
      VALIDATION_CODES.INVALID_VALUE,
    );
  }

  return true;
}

// ==========================================================
// DEFAULT EXPORT
// ==========================================================

export default {
  ValidationError,

  VALIDATION_CODES,

  INTENT_TYPES,

  ACTION_TYPES,

  isString,

  isNonEmptyString,

  isNumber,

  isBoolean,

  isObject,

  isArray,

  isFunction,

  sanitizeString,

  normalizeString,

  limitString,

  requireKeys,

  validateEnum,

  validateIntent,

  validateAction,

  validateActionResult,

  validateStep,

  validatePlan,

  validatePlanRequest,

  validateCandidate,

  validateScoringDecision,

  isValid,

  validateSafe,

  assertString,

  assertNonEmptyString,

  assertNumberRange,
};
