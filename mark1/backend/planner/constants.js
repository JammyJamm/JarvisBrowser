// constants.js
// Global configuration constants for Jarvis Browser / Planner System

module.exports = {
  // =====================================================
  // APP INFO
  // =====================================================
  APP_NAME: "Jarvis Browser",
  VERSION: "2.0.0",

  // =====================================================
  // PERFORMANCE SETTINGS
  // =====================================================
  MAX_CONCURRENT_TASKS: 5,
  TASK_TIMEOUT_MS: 30000,
  SHORT_TASK_TIMEOUT_MS: 8000,

  DEBOUNCE_TIME_MS: 250,
  THROTTLE_TIME_MS: 100,

  // =====================================================
  // INTENT PARSER SETTINGS
  // =====================================================
  INTENT_CONFIDENCE_THRESHOLD: 0.65,

  INTENT_TYPES: {
    NAVIGATE: "navigate",
    SEARCH: "search",
    CLICK: "click",
    TYPE: "type",
    SCROLL: "scroll",
    WAIT: "wait",
    EXTRACT: "extract",
    CHAT: "chat",
    COMMAND: "command",
    ERROR: "error",
    UNKNOWN: "unknown",
  },

  ACTION_PRIORITY: {
    CRITICAL: 1,
    HIGH: 2,
    NORMAL: 3,
    LOW: 4,
  },

  // =====================================================
  // BROWSER CONTROL SETTINGS
  // =====================================================
  BROWSER: {
    HEADLESS: false,
    DEFAULT_TIMEOUT: 15000,
    NAVIGATION_TIMEOUT: 30000,
    RETRY_COUNT: 3,
    RETRY_DELAY_MS: 1200,

    VIEWPORT: {
      WIDTH: 1366,
      HEIGHT: 768,
    },

    USER_AGENT:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },

  // =====================================================
  // PLAYWRIGHT SETTINGS
  // =====================================================
  PLAYWRIGHT: {
    LAUNCH_ARGS: [
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  },

  // =====================================================
  // AI / MODEL SETTINGS
  // =====================================================
  MODELS: {
    PRIMARY: "qwen3:8b",
    FALLBACK: "llama3:8b",
    FAST_PARSER: "regex-engine",
    SMART_PLANNER: "qwen3:8b",
  },

  MODEL_TEMPERATURE: {
    PLANNER: 0.2,
    CHAT: 0.7,
    CREATIVE: 0.9,
  },

  MAX_TOKENS: {
    PLANNER: 512,
    CHAT: 1024,
    LONG_RESPONSE: 2048,
  },

  // =====================================================
  // LOGGING
  // =====================================================
  LOG_LEVELS: {
    DEBUG: "debug",
    INFO: "info",
    WARN: "warn",
    ERROR: "error",
  },

  ENABLE_LOGGING: true,
  ENABLE_FILE_LOGGING: true,

  LOG_FILES: {
    MAIN: "logs/app.log",
    ERROR: "logs/error.log",
    BROWSER: "logs/browser.log",
    PLANNER: "logs/planner.log",
  },

  // =====================================================
  // SAFETY & LIMITS
  // =====================================================
  SAFETY: {
    MAX_REDIRECTS: 5,
    MAX_STEPS_PER_PLAN: 20,
    MAX_DOM_DEPTH: 50,
    BLOCKED_DOMAINS: ["malware.com", "phishing.test"],
  },

  // =====================================================
  // DOM / SELECTOR STRATEGY
  // =====================================================
  SELECTORS: {
    BUTTON: "button",
    INPUT: "input, textarea",
    LINK: "a",
    CLICKABLE: "[onclick], button, a, [role='button']",

    PRIORITY_SELECTORS: ["[data-testid]", "[id]", "[class]"],
  },

  // =====================================================
  // EVENT TYPES
  // =====================================================
  EVENTS: {
    PAGE_LOADED: "page_loaded",
    NAVIGATION_START: "navigation_start",
    ACTION_EXECUTED: "action_executed",
    ACTION_FAILED: "action_failed",
    INTENT_PARSED: "intent_parsed",
  },

  // =====================================================
  // CACHE SETTINGS
  // =====================================================
  CACHE: {
    ENABLED: true,
    TTL_MS: 60000,
    MAX_SIZE: 100,
  },

  // =====================================================
  // DEBUG FLAGS
  // =====================================================
  DEBUG: {
    ENABLED: true,
    VERBOSE_PLANNER: true,
    VERBOSE_BROWSER: false,
    MOCK_MODE: false,
  },
};
