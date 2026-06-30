// planner/synonym-map.js

/**
 * Ultra-fast synonym map for intent normalization.
 * Goal: convert messy user input → clean canonical intents
 */

export const SYNONYM_MAP = Object.freeze({
  // ---------- NAVIGATION ----------
  open: "NAVIGATE",
  go: "NAVIGATE",
  "go to": "NAVIGATE",
  visit: "NAVIGATE",
  launch: "NAVIGATE",
  start: "NAVIGATE",

  // ---------- SEARCH ----------
  search: "SEARCH",
  find: "SEARCH",
  "look for": "SEARCH",
  get: "SEARCH",
  "show me": "SEARCH",
  lookup: "SEARCH",

  // ---------- CODE / DEV ----------
  run: "EXECUTE",
  execute: "EXECUTE",
  compile: "EXECUTE",
  build: "BUILD",
  debug: "DEBUG",
  fix: "DEBUG",

  // ---------- FILE OPS ----------
  "create file": "FILE_CREATE",
  "make file": "FILE_CREATE",
  "delete file": "FILE_DELETE",
  "remove file": "FILE_DELETE",
  "read file": "FILE_READ",
  "open file": "FILE_OPEN",
  "write file": "FILE_WRITE",
  "edit file": "FILE_EDIT",

  // ---------- BROWSER CONTROL ----------
  click: "BROWSER_CLICK",
  press: "BROWSER_CLICK",
  tap: "BROWSER_CLICK",
  select: "BROWSER_SELECT",
  scroll: "BROWSER_SCROLL",
  type: "BROWSER_TYPE",
  enter: "BROWSER_TYPE",

  // ---------- SYSTEM CONTROL ----------
  shutdown: "SYSTEM_SHUTDOWN",
  restart: "SYSTEM_RESTART",
  sleep: "SYSTEM_SLEEP",
  lock: "SYSTEM_LOCK",

  // ---------- INFO ----------
  "what is": "INFO_QUERY",
  "who is": "INFO_QUERY",
  "tell me about": "INFO_QUERY",
  explain: "INFO_QUERY",
  meaning: "INFO_QUERY",

  // ---------- AI ACTIONS ----------
  summarize: "AI_SUMMARY",
  summary: "AI_SUMMARY",
  shorten: "AI_SUMMARY",
  rewrite: "AI_REWRITE",
  paraphrase: "AI_REWRITE",

  // ---------- TASK / PLANNER ----------
  plan: "PLAN",
  schedule: "SCHEDULE",
  remind: "REMINDER",
  "set reminder": "REMINDER",
  "add task": "TASK_ADD",
  "create task": "TASK_ADD",
});

/**
 * Fast normalization function
 * - lowercases input
 * - trims spaces
 * - matches longest phrases first
 */
export function normalizeIntent(input = "") {
  const text = input.toLowerCase().trim();

  // Sort keys by length to prefer "look for" over "look"
  const keys = Object.keys(SYNONYM_MAP).sort((a, b) => b.length - a.length);

  for (const key of keys) {
    if (text.includes(key)) {
      return SYNONYM_MAP[key];
    }
  }

  return "UNKNOWN";
}

/**
 * Optional reverse map for debugging / UI display
 */
export const INTENT_LABELS = Object.freeze({
  NAVIGATE: "Navigation",
  SEARCH: "Search",
  EXECUTE: "Code Execution",
  BUILD: "Build Project",
  DEBUG: "Debugging",
  FILE_CREATE: "Create File",
  FILE_DELETE: "Delete File",
  FILE_READ: "Read File",
  FILE_WRITE: "Write File",
  FILE_EDIT: "Edit File",
  BROWSER_CLICK: "Browser Click",
  BROWSER_TYPE: "Browser Typing",
  SYSTEM_SHUTDOWN: "Shutdown System",
  SYSTEM_RESTART: "Restart System",
  INFO_QUERY: "Information Query",
  AI_SUMMARY: "Summarization",
  AI_REWRITE: "Rewrite",
  PLAN: "Planning",
  SCHEDULE: "Scheduling",
  REMINDER: "Reminder",
  TASK_ADD: "Task Creation",
  UNKNOWN: "Unknown Intent",
});
