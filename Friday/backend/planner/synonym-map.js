// backend/planner/synonym-map.js

/**
 * ============================================================
 * backend/planner/synonym-map.js
 *
 * Central Synonym & Intent Registry
 *
 * Architecture
 * ------------------------------------------------------------
 *
 * User Input
 *      │
 *      ▼
 * Intent Parser / Action Parser
 *      │
 *      ▼
 * SynonymMap
 *      │
 *      ▼
 * Canonical Intent
 *      │
 *      ▼
 * Scoring Engine
 *      │
 *      ▼
 * Resolver / Planner
 *
 * Responsibilities
 * ------------------------------------------------------------
 * ✔ Convert natural language → canonical intent
 * ✔ Normalize action synonyms
 * ✔ Normalize browser commands
 * ✔ Normalize planner commands
 * ✔ Normalize file operations
 * ✔ Normalize system operations
 * ✔ Normalize authentication actions
 * ✔ Normalize form actions
 * ✔ Provide reverse intent lookup
 * ✔ Fast longest-phrase matching
 * ✔ Avoid substring false positives
 *
 * IMPORTANT
 * ------------------------------------------------------------
 * ❌ No fuzzy matching here
 * ❌ No DOM matching here
 * ❌ No element ranking here
 * ❌ No action execution here
 * ❌ No LLM calls here
 *
 * Fuzzy matching belongs to:
 *      fuzzy-match.js
 *      scoring-engine.js
 *
 * ============================================================
 */

//==============================================================
// SYNONYM MAP
//==============================================================
//
// Format:
//
// "user phrase": "CANONICAL_INTENT"
//
// Longer phrases should automatically take priority.
//==============================================================

export const SYNONYM_MAP = Object.freeze({
  //============================================================
  // NAVIGATION
  //============================================================

  open: "NAVIGATE",

  "open page": "NAVIGATE",

  "open website": "NAVIGATE",

  "open site": "NAVIGATE",

  go: "NAVIGATE",

  "go to": "NAVIGATE",

  "go into": "NAVIGATE",

  visit: "NAVIGATE",

  browse: "NAVIGATE",

  navigate: "NAVIGATE",

  launch: "NAVIGATE",

  start: "NAVIGATE",

  load: "NAVIGATE",

  access: "NAVIGATE",

  //============================================================
  // SEARCH
  //============================================================

  "search for": "SEARCH",

  search: "SEARCH",

  find: "SEARCH",

  "look for": "SEARCH",

  "look up": "SEARCH",

  lookup: "SEARCH",

  google: "SEARCH",

  query: "SEARCH",

  "search web": "SEARCH",

  "search online": "SEARCH",

  "find online": "SEARCH",

  "show me": "SEARCH",

  get: "SEARCH",

  //============================================================
  // BROWSER CLICK
  //============================================================

  "click on": "BROWSER_CLICK",

  click: "BROWSER_CLICK",

  press: "BROWSER_CLICK",

  tap: "BROWSER_CLICK",

  hit: "BROWSER_CLICK",

  select: "BROWSER_CLICK",

  choose: "BROWSER_CLICK",

  pick: "BROWSER_CLICK",

  activate: "BROWSER_CLICK",

  //============================================================
  // BROWSER SELECT
  //============================================================

  "select option": "BROWSER_SELECT",

  "choose option": "BROWSER_SELECT",

  "pick option": "BROWSER_SELECT",

  select: "BROWSER_SELECT",

  choose: "BROWSER_SELECT",

  pick: "BROWSER_SELECT",

  //============================================================
  // BROWSER TYPE / INPUT
  //============================================================

  "type in": "BROWSER_TYPE",

  "type into": "BROWSER_TYPE",

  type: "BROWSER_TYPE",

  "enter into": "BROWSER_TYPE",

  "enter in": "BROWSER_TYPE",

  enter: "BROWSER_TYPE",

  input: "BROWSER_TYPE",

  "fill in": "BROWSER_TYPE",

  "fill out": "BROWSER_TYPE",

  fill: "BROWSER_TYPE",

  write: "BROWSER_TYPE",

  "write in": "BROWSER_TYPE",

  //============================================================
  // BROWSER SCROLL
  //============================================================

  "scroll down": "BROWSER_SCROLL",

  "scroll up": "BROWSER_SCROLL",

  "scroll to top": "BROWSER_SCROLL",

  "scroll to bottom": "BROWSER_SCROLL",

  scroll: "BROWSER_SCROLL",

  swipe: "BROWSER_SCROLL",

  //============================================================
  // BROWSER REFRESH
  //============================================================

  refresh: "BROWSER_REFRESH",

  reload: "BROWSER_REFRESH",

  "reload page": "BROWSER_REFRESH",

  "refresh page": "BROWSER_REFRESH",

  //============================================================
  // BROWSER WAIT
  //============================================================

  wait: "BROWSER_WAIT",

  pause: "BROWSER_WAIT",

  delay: "BROWSER_WAIT",

  "wait for": "BROWSER_WAIT",

  //============================================================
  // SCREENSHOT
  //============================================================

  screenshot: "BROWSER_SCREENSHOT",

  "take screenshot": "BROWSER_SCREENSHOT",

  "capture screenshot": "BROWSER_SCREENSHOT",

  "capture screen": "BROWSER_SCREENSHOT",

  "take screen": "BROWSER_SCREENSHOT",

  //============================================================
  // CHECKBOX
  //============================================================

  "check checkbox": "BROWSER_CHECKBOX",

  "tick checkbox": "BROWSER_CHECKBOX",

  "enable checkbox": "BROWSER_CHECKBOX",

  "select checkbox": "BROWSER_CHECKBOX",

  "uncheck checkbox": "BROWSER_CHECKBOX",

  "untick checkbox": "BROWSER_CHECKBOX",

  checkbox: "BROWSER_CHECKBOX",

  //============================================================
  // RADIO BUTTON
  //============================================================

  "select radio": "BROWSER_RADIO",

  "choose radio": "BROWSER_RADIO",

  "select radio button": "BROWSER_RADIO",

  radio: "BROWSER_RADIO",

  "radio button": "BROWSER_RADIO",

  //============================================================
  // FILE UPLOAD
  //============================================================

  upload: "BROWSER_UPLOAD",

  "upload file": "BROWSER_UPLOAD",

  "choose file": "BROWSER_UPLOAD",

  "select file": "BROWSER_UPLOAD",

  attach: "BROWSER_UPLOAD",

  "attach file": "BROWSER_UPLOAD",

  //============================================================
  // AUTHENTICATION
  //============================================================

  login: "AUTH_LOGIN",

  "log in": "AUTH_LOGIN",

  signin: "AUTH_LOGIN",

  "sign in": "AUTH_LOGIN",

  authenticate: "AUTH_LOGIN",

  "log into": "AUTH_LOGIN",

  "sign into": "AUTH_LOGIN",

  logout: "AUTH_LOGOUT",

  "log out": "AUTH_LOGOUT",

  signout: "AUTH_LOGOUT",

  "sign out": "AUTH_LOGOUT",

  //============================================================
  // PUNCH / ATTENDANCE
  //============================================================

  "punch in": "PUNCH_IN",

  punchin: "PUNCH_IN",

  "clock in": "PUNCH_IN",

  clockin: "PUNCH_IN",

  "check in": "PUNCH_IN",

  checkin: "PUNCH_IN",

  "punch out": "PUNCH_OUT",

  punchout: "PUNCH_OUT",

  "clock out": "PUNCH_OUT",

  clockout: "PUNCH_OUT",

  "check out": "PUNCH_OUT",

  checkout: "PUNCH_OUT",

  //============================================================
  // CODE / DEVELOPMENT
  //============================================================

  run: "EXECUTE",

  execute: "EXECUTE",

  "run command": "EXECUTE",

  "execute command": "EXECUTE",

  start: "EXECUTE",

  compile: "EXECUTE",

  build: "BUILD",

  "build project": "BUILD",

  debug: "DEBUG",

  fix: "DEBUG",

  repair: "DEBUG",

  troubleshoot: "DEBUG",

  "fix error": "DEBUG",

  "fix issue": "DEBUG",

  //============================================================
  // FILE OPERATIONS
  //============================================================

  "create file": "FILE_CREATE",

  "make file": "FILE_CREATE",

  "new file": "FILE_CREATE",

  "add file": "FILE_CREATE",

  "delete file": "FILE_DELETE",

  "remove file": "FILE_DELETE",

  "erase file": "FILE_DELETE",

  "read file": "FILE_READ",

  "view file": "FILE_READ",

  "show file": "FILE_READ",

  "open file": "FILE_OPEN",

  "write file": "FILE_WRITE",

  "write to file": "FILE_WRITE",

  "edit file": "FILE_EDIT",

  "modify file": "FILE_EDIT",

  "update file": "FILE_EDIT",

  "rename file": "FILE_RENAME",

  "move file": "FILE_MOVE",

  "copy file": "FILE_COPY",

  //============================================================
  // BROWSER TAB CONTROL
  //============================================================

  "new tab": "TAB_CREATE",

  "open new tab": "TAB_CREATE",

  "create tab": "TAB_CREATE",

  "close tab": "TAB_CLOSE",

  "exit tab": "TAB_CLOSE",

  "switch tab": "TAB_SWITCH",

  "change tab": "TAB_SWITCH",

  "next tab": "TAB_NEXT",

  "previous tab": "TAB_PREVIOUS",

  "last tab": "TAB_LAST",

  //============================================================
  // BROWSER WINDOW CONTROL
  //============================================================

  "new window": "WINDOW_CREATE",

  "open new window": "WINDOW_CREATE",

  "close window": "WINDOW_CLOSE",

  "switch window": "WINDOW_SWITCH",

  //============================================================
  // SYSTEM CONTROL
  //============================================================

  shutdown: "SYSTEM_SHUTDOWN",

  "shut down": "SYSTEM_SHUTDOWN",

  restart: "SYSTEM_RESTART",

  reboot: "SYSTEM_RESTART",

  sleep: "SYSTEM_SLEEP",

  lock: "SYSTEM_LOCK",

  "lock computer": "SYSTEM_LOCK",

  //============================================================
  // INFORMATION / QUERY
  //============================================================

  "what is": "INFO_QUERY",

  "what are": "INFO_QUERY",

  "who is": "INFO_QUERY",

  "who are": "INFO_QUERY",

  "tell me about": "INFO_QUERY",

  explain: "INFO_QUERY",

  explanation: "INFO_QUERY",

  meaning: "INFO_QUERY",

  define: "INFO_QUERY",

  definition: "INFO_QUERY",

  //============================================================
  // AI SUMMARY
  //============================================================

  summarize: "AI_SUMMARY",

  summarise: "AI_SUMMARY",

  summary: "AI_SUMMARY",

  shorten: "AI_SUMMARY",

  condense: "AI_SUMMARY",

  "give summary": "AI_SUMMARY",

  "summarize this": "AI_SUMMARY",

  //============================================================
  // AI REWRITE
  //============================================================

  rewrite: "AI_REWRITE",

  rephrase: "AI_REWRITE",

  paraphrase: "AI_REWRITE",

  improve: "AI_REWRITE",

  polish: "AI_REWRITE",

  correct: "AI_REWRITE",

  "make professional": "AI_REWRITE",

  //============================================================
  // PLANNING
  //============================================================

  plan: "PLAN",

  "make a plan": "PLAN",

  "create a plan": "PLAN",

  planning: "PLAN",

  //============================================================
  // SCHEDULING
  //============================================================

  schedule: "SCHEDULE",

  "schedule task": "SCHEDULE",

  "schedule event": "SCHEDULE",

  book: "SCHEDULE",

  //============================================================
  // REMINDERS
  //============================================================

  remind: "REMINDER",

  reminder: "REMINDER",

  "set reminder": "REMINDER",

  "create reminder": "REMINDER",

  "remind me": "REMINDER",

  //============================================================
  // TASK MANAGEMENT
  //============================================================

  "add task": "TASK_ADD",

  "create task": "TASK_ADD",

  "new task": "TASK_ADD",

  "make task": "TASK_ADD",

  "delete task": "TASK_DELETE",

  "remove task": "TASK_DELETE",

  "complete task": "TASK_COMPLETE",

  "finish task": "TASK_COMPLETE",

  "mark task complete": "TASK_COMPLETE",

  "update task": "TASK_UPDATE",

  "edit task": "TASK_UPDATE",
});

//==============================================================
// PRECOMPILED LONGEST-FIRST PHRASES
//==============================================================
//
// Sorting once during module initialization is much faster than
// sorting Object.keys() on every normalizeIntent() call.
//==============================================================

const SORTED_SYNONYM_ENTRIES = Object.freeze(
  Object.entries(SYNONYM_MAP).sort(([a], [b]) => b.length - a.length),
);

//==============================================================
// NORMALIZE INPUT
//==============================================================

export function normalizeInput(input = "") {
  if (input === null || input === undefined) {
    return "";
  }

  return String(input).toLowerCase().replace(/\s+/g, " ").trim();
}

//==============================================================
// WORD-BOUNDARY PHRASE MATCH
//==============================================================
//
// Prevents:
//
// "go" matching "google"
//
// while still allowing:
//
// "click login button"
// "go to google"
//
//==============================================================

function phraseMatches(text, phrase) {
  if (!text || !phrase) {
    return false;
  }

  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const regex = new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, "i");

  return regex.test(text);
}

//==============================================================
// FAST INTENT NORMALIZATION
//==============================================================
//
// Returns canonical intent.
//
// Example:
//
// normalizeIntent("Click the Punch In button")
// → BROWSER_CLICK
//
// normalizeIntent("Go to Google")
// → NAVIGATE
//
// normalizeIntent("Please sign in")
// → AUTH_LOGIN
//
//==============================================================

export function normalizeIntent(input = "") {
  const text = normalizeInput(input);

  if (!text) {
    return "UNKNOWN";
  }

  for (const [phrase, intent] of SORTED_SYNONYM_ENTRIES) {
    if (phraseMatches(text, phrase)) {
      return intent;
    }
  }

  return "UNKNOWN";
}

//==============================================================
// FIND MATCH DETAILS
//==============================================================
//
// Useful for planner debugging and scoring.
//
// Returns:
//
// {
//   intent: "BROWSER_CLICK",
//   matchedPhrase: "click",
//   input: "..."
// }
//
//==============================================================

export function matchIntent(input = "") {
  const text = normalizeInput(input);

  if (!text) {
    return {
      intent: "UNKNOWN",
      matchedPhrase: "",
      input: text,
    };
  }

  for (const [phrase, intent] of SORTED_SYNONYM_ENTRIES) {
    if (phraseMatches(text, phrase)) {
      return {
        intent,
        matchedPhrase: phrase,
        input: text,
      };
    }
  }

  return {
    intent: "UNKNOWN",
    matchedPhrase: "",
    input: text,
  };
}

//==============================================================
// GET ALL MATCHES
//==============================================================
//
// Unlike normalizeIntent(), this returns every matching
// canonical intent.
//
// Useful when input contains multiple actions.
//
// Example:
//
// "open Google and search for weather"
//
// → [
//     { intent: "NAVIGATE", phrase: "open" },
//     { intent: "SEARCH", phrase: "search for" }
//   ]
//
//==============================================================

export function findAllIntents(input = "") {
  const text = normalizeInput(input);

  if (!text) {
    return [];
  }

  const matches = [];

  for (const [phrase, intent] of SORTED_SYNONYM_ENTRIES) {
    if (phraseMatches(text, phrase)) {
      matches.push({
        intent,
        phrase,
      });
    }
  }

  return matches;
}

//==============================================================
// REVERSE MAP
//==============================================================
//
// Converts:
//
// BROWSER_CLICK
//
// into:
//
// [
//   "click",
//   "click on",
//   "press",
//   "tap"
// ]
//
//==============================================================

const REVERSE_MAP = (() => {
  const map = {};

  for (const [phrase, intent] of Object.entries(SYNONYM_MAP)) {
    if (!map[intent]) {
      map[intent] = [];
    }

    map[intent].push(phrase);
  }

  for (const intent of Object.keys(map)) {
    map[intent].sort((a, b) => b.length - a.length);
  }

  return Object.freeze(map);
})();

//==============================================================
// GET SYNONYMS FOR INTENT
//==============================================================

export function getSynonymsForIntent(intent = "") {
  if (!intent) {
    return [];
  }

  return REVERSE_MAP[String(intent).toUpperCase()] || [];
}

//==============================================================
// INTENT LABELS
//==============================================================

export const INTENT_LABELS = Object.freeze({
  // Navigation
  NAVIGATE: "Navigation",

  SEARCH: "Search",

  // Browser
  BROWSER_CLICK: "Browser Click",

  BROWSER_SELECT: "Browser Select",

  BROWSER_TYPE: "Browser Typing",

  BROWSER_SCROLL: "Browser Scroll",

  BROWSER_REFRESH: "Browser Refresh",

  BROWSER_WAIT: "Browser Wait",

  BROWSER_SCREENSHOT: "Browser Screenshot",

  BROWSER_CHECKBOX: "Checkbox",

  BROWSER_RADIO: "Radio Button",

  BROWSER_UPLOAD: "File Upload",

  // Authentication
  AUTH_LOGIN: "Login",

  AUTH_LOGOUT: "Logout",

  // Attendance
  PUNCH_IN: "Punch In",

  PUNCH_OUT: "Punch Out",

  // Development
  EXECUTE: "Code Execution",

  BUILD: "Build Project",

  DEBUG: "Debugging",

  // Files
  FILE_CREATE: "Create File",

  FILE_DELETE: "Delete File",

  FILE_READ: "Read File",

  FILE_OPEN: "Open File",

  FILE_WRITE: "Write File",

  FILE_EDIT: "Edit File",

  FILE_RENAME: "Rename File",

  FILE_MOVE: "Move File",

  FILE_COPY: "Copy File",

  // Tabs
  TAB_CREATE: "Create Tab",

  TAB_CLOSE: "Close Tab",

  TAB_SWITCH: "Switch Tab",

  TAB_NEXT: "Next Tab",

  TAB_PREVIOUS: "Previous Tab",

  TAB_LAST: "Last Tab",

  // Windows
  WINDOW_CREATE: "Create Window",

  WINDOW_CLOSE: "Close Window",

  WINDOW_SWITCH: "Switch Window",

  // System
  SYSTEM_SHUTDOWN: "Shutdown System",

  SYSTEM_RESTART: "Restart System",

  SYSTEM_SLEEP: "Sleep System",

  SYSTEM_LOCK: "Lock System",

  // Information
  INFO_QUERY: "Information Query",

  // AI
  AI_SUMMARY: "Summarization",

  AI_REWRITE: "Rewrite",

  // Planner
  PLAN: "Planning",

  SCHEDULE: "Scheduling",

  REMINDER: "Reminder",

  TASK_ADD: "Task Creation",

  TASK_DELETE: "Task Deletion",

  TASK_COMPLETE: "Task Completion",

  TASK_UPDATE: "Task Update",

  // Unknown
  UNKNOWN: "Unknown Intent",
});

//==============================================================
// GET INTENT LABEL
//==============================================================

export function getIntentLabel(intent = "UNKNOWN") {
  const normalized = String(intent || "UNKNOWN").toUpperCase();

  return INTENT_LABELS[normalized] || INTENT_LABELS.UNKNOWN;
}

//==============================================================
// CHECK INTENT
//==============================================================

export function isKnownIntent(intent = "") {
  if (!intent) {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(
    INTENT_LABELS,
    String(intent).toUpperCase(),
  );
}

//==============================================================
// GET ALL CANONICAL INTENTS
//==============================================================

export function getAllIntents() {
  return Object.keys(INTENT_LABELS);
}

//==============================================================
// GET ALL SYNONYMS
//==============================================================

export function getAllSynonyms() {
  return Object.keys(SYNONYM_MAP);
}

//==============================================================
// DEFAULT EXPORT
//==============================================================

export default {
  SYNONYM_MAP,

  INTENT_LABELS,

  normalizeInput,

  normalizeIntent,

  matchIntent,

  findAllIntents,

  getSynonymsForIntent,

  getIntentLabel,

  isKnownIntent,

  getAllIntents,

  getAllSynonyms,
};
