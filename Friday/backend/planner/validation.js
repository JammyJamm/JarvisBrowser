// planner/validation.js

/**
 * Ultra-fast validation layer for Planner inputs
 * Goal: zero-heavy computation, early rejection, predictable shapes
 */

export class ValidationError extends Error {
  constructor(message, code = "VALIDATION_ERROR") {
    super(message);
    this.name = "ValidationError";
    this.code = code;
  }
}

/**
 * Core schema checks for planner intent objects
 */
export function validateIntent(intent) {
  if (!intent) {
    throw new ValidationError("Intent is required");
  }

  if (typeof intent !== "object") {
    throw new ValidationError("Intent must be an object");
  }

  if (typeof intent.type !== "string" || intent.type.length === 0) {
    throw new ValidationError("Intent.type must be a non-empty string");
  }

  // lightweight normalization
  intent.type = intent.type.toLowerCase().trim();

  return true;
}

/**
 * Validate action structure inside planner
 */
export function validateAction(action) {
  if (!action || typeof action !== "object") {
    throw new ValidationError("Action must be an object");
  }

  if (typeof action.name !== "string" || action.name.length === 0) {
    throw new ValidationError("Action.name is required");
  }

  action.name = action.name.toLowerCase().trim();

  // optional payload check
  if (action.payload && typeof action.payload !== "object") {
    throw new ValidationError("Action.payload must be an object if provided");
  }

  return true;
}

/**
 * Validate full planner request
 */
export function validatePlanRequest(req) {
  if (!req || typeof req !== "object") {
    throw new ValidationError("Request must be an object");
  }

  validateIntent(req.intent);

  if (req.actions) {
    if (!Array.isArray(req.actions)) {
      throw new ValidationError("actions must be an array");
    }

    for (let i = 0; i < req.actions.length; i++) {
      validateAction(req.actions[i]);
    }
  }

  return true;
}

/**
 * Fast type guards (no allocations, minimal overhead)
 */
export const isString = (v) => typeof v === "string";
export const isNumber = (v) => typeof v === "number" && !isNaN(v);
export const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const isArray = Array.isArray;

/**
 * Lightweight schema validator (key-based)
 */
export function requireKeys(obj, keys = []) {
  if (!isObject(obj)) {
    throw new ValidationError("Object required for key validation");
  }

  for (let i = 0; i < keys.length; i++) {
    if (!(keys[i] in obj)) {
      throw new ValidationError(`Missing required key: ${keys[i]}`);
    }
  }

  return true;
}

/**
 * Sanitize input strings (cheap safety layer)
 */
export function sanitizeString(str) {
  if (!isString(str)) return "";

  return str
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "") // basic injection safety
    .trim();
}
