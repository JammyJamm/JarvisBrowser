// action-map.js
//
// Ultra-fast Intent → Action mapping layer
// Used by Planner (Jarvis Browser / Automation Engine)
//
// Features:
// - Regex + keyword hybrid matching
// - Extensible action registry
// - Structured action output format
// - Works with or without LLM planner fallback
//

/**
 * Action Types
 * These are normalized browser automation primitives
 */
export const ACTION_TYPES = {
  NAVIGATE: "navigate",
  CLICK: "click",
  TYPE: "type",
  SCROLL: "scroll",
  WAIT: "wait",
  EXTRACT: "extract",
  BACK: "back",
  FORWARD: "forward",
  RELOAD: "reload",
  OPEN_TAB: "open_tab",
  CLOSE_TAB: "close_tab",
  SCREENSHOT: "screenshot",
  EXECUTE_JS: "execute_js",
  GET_SVG: "get_svg",
  GET_IFRAME_SVG: "get_iframe_svg",
  GET_IFRAME_DATA: "get_iframe_data",
  WATCH_IFRAME_DATA: "watch_iframe_data",
  STOP_INTERVAL: "stop_interval",
};

/**
 * Action Map
 * Each entry defines:
 * - patterns: regex or keywords
 * - action: normalized action output
 */
export const ACTION_MAP = [
  // =========================
  // NAVIGATION
  // =========================
  {
    name: "open_url",
    patterns: [/^(https?:\/\/)/i],
    build: (input) => ({
      type: ACTION_TYPES.NAVIGATE,
      url: input.trim(),
    }),
  },
  {
    name: "search_google",
    patterns: [/search for (.+)/i, /google (.+)/i, /find (.+)/i],
    build: (input, match) => ({
      type: ACTION_TYPES.NAVIGATE,
      url: `https://www.google.com/search?q=${encodeURIComponent(match[1])}`,
    }),
  },

  // =========================
  // CLICK ACTIONS
  // =========================
  {
    name: "click_element",
    patterns: [/click (.+)/i],
    build: (input, match) => ({
      type: ACTION_TYPES.CLICK,
      selector: match[1],
    }),
  },

  // =========================
  // TYPING / INPUT
  // =========================
  {
    name: "type_text",
    patterns: [/type (.+) in (.+)/i],
    build: (input, match) => ({
      type: ACTION_TYPES.TYPE,
      text: match[1],
      selector: match[2],
    }),
  },

  {
    name: "fill_input",
    patterns: [/enter (.+)/i],
    build: (input, match) => ({
      type: ACTION_TYPES.TYPE,
      text: match[1],
      selector: "active",
    }),
  },

  // =========================
  // SCROLLING
  // =========================
  {
    name: "scroll_down",
    patterns: [/scroll down/i],
    build: () => ({
      type: ACTION_TYPES.SCROLL,
      direction: "down",
      amount: 800,
    }),
  },
  {
    name: "scroll_up",
    patterns: [/scroll up/i],
    build: () => ({
      type: ACTION_TYPES.SCROLL,
      direction: "up",
      amount: 800,
    }),
  },

  // =========================
  // NAV HISTORY
  // =========================
  {
    name: "go_back",
    patterns: [/go back|back/i],
    build: () => ({
      type: ACTION_TYPES.BACK,
    }),
  },
  {
    name: "go_forward",
    patterns: [/go forward|forward/i],
    build: () => ({
      type: ACTION_TYPES.FORWARD,
    }),
  },
  {
    name: "reload_page",
    patterns: [/reload|refresh page/i],
    build: () => ({
      type: ACTION_TYPES.RELOAD,
    }),
  },

  // =========================
  // TABS
  // =========================
  {
    name: "open_tab",
    patterns: [/open new tab/i],
    build: () => ({
      type: ACTION_TYPES.OPEN_TAB,
    }),
  },
  {
    name: "close_tab",
    patterns: [/close tab/i],
    build: () => ({
      type: ACTION_TYPES.CLOSE_TAB,
    }),
  },

  // =========================
  // DATA / EXTRACTION
  // =========================
  {
    name: "extract_text",
    patterns: [/extract text/i, /get text/i],
    build: () => ({
      type: ACTION_TYPES.EXTRACT,
      target: "body",
    }),
  },

  {
    name: "screenshot",
    patterns: [/take screenshot|capture screen/i],
    build: () => ({
      type: ACTION_TYPES.SCREENSHOT,
    }),
  },

  {
    name: "get_iframe_svg",
    patterns: [
      /get svg from iframe/i,
      /extract svg from iframe/i,
      /get iframe svg/i,
      /extract iframe svg/i,
      /svg data from iframe/i,
      /get (?:all )?svg(?:s|\s+data)?(?:\s+to\s+json)?\s+from\s+(?:parent )?(?:class|container|selector)?\s*['"]?([a-zA-Z0-9_.-]+)['"]?/i,
      /convert svg(?:\s+to\s+json)?\s+from\s+(?:parent )?(?:class|container|selector)?\s*['"]?([a-zA-Z0-9_.-]+)['"]?/i,
    ],
    build: (input, match) => ({
      type: ACTION_TYPES.GET_IFRAME_SVG,
      tool: "get_iframe_svg",
      args: {
        parentClass: match && match[1] ? match[1] : undefined,
        onlyIframes: true,
      },
    }),
  },

  {
    name: "get_iframe_data",
    patterns: [
      /get (?:all )?data from (?:parent )?(?:class|container|selector)?\s*['"]?([a-zA-Z0-9_.-]+)['"]?/i,
      /extract data from (?:parent )?(?:class|container|selector)?\s*['"]?([a-zA-Z0-9_.-]+)['"]?/i,
      /fetch data from (?:parent )?(?:class|container|selector)?\s*['"]?([a-zA-Z0-9_.-]+)['"]?/i,
      /get (?:parent )?class\s+([a-zA-Z0-9_.-]+)\s+data/i,
    ],
    build: (input, match) => ({
      type: ACTION_TYPES.GET_IFRAME_DATA,
      tool: "get_iframe_data",
      args: {
        target: match ? match[1] : input,
        onlyIframes: true,
      },
    }),
  },

  {
    name: "watch_iframe_data",
    patterns: [
      /watch (?:data|svg(?:s)?|container)?\s*(?:from|in)?\s*(?:parent )?(?:class|container|selector)?\s*['"]?([a-zA-Z0-9_.-]+)['"]?/i,
      /stream (?:data|svg(?:s)?|container)?\s*(?:from|in)?\s*(?:parent )?(?:class|container|selector)?\s*['"]?([a-zA-Z0-9_.-]+)['"]?/i,
      /start interval\s*(?:for\s*)?['"]?([a-zA-Z0-9_.-]+)?['"]?/i,
      /monitor (?:data|svg(?:s)?|container)?\s*(?:from|in)?\s*(?:parent )?(?:class|container|selector)?\s*['"]?([a-zA-Z0-9_.-]+)['"]?/i,
    ],
    build: (input, match) => ({
      type: ACTION_TYPES.WATCH_IFRAME_DATA,
      tool: "watch_iframe_data",
      args: {
        target: match && match[1] ? match[1] : ".tzQn0o",
        interval: 1500,
        onlyIframes: true,
      },
    }),
  },

  {
    name: "stop_interval",
    patterns: [
      /stop interval/i,
      /stop watch(?:ing)?/i,
      /stop stream(?:ing)?/i,
      /stop monitor(?:ing)?/i,
      /cancel interval/i,
    ],
    build: () => ({
      type: ACTION_TYPES.STOP_INTERVAL,
      tool: "stop_interval",
      args: {},
    }),
  },

  {
    name: "get_svg",
    patterns: [/get svg/i, /extract svg/i, /read svg/i, /svg data/i],
    build: () => ({
      type: ACTION_TYPES.GET_SVG,
      tool: "get_svg",
      args: {},
    }),
  },

  // =========================
  // JS EXECUTION
  // =========================
  {
    name: "run_js",
    patterns: [/run js (.+)/i],
    build: (input, match) => ({
      type: ACTION_TYPES.EXECUTE_JS,
      code: match[1],
    }),
  },
];

/**
 * Match input to action
 */
export function mapAction(input) {
  if (!input || typeof input !== "string") {
    return null;
  }

  for (const rule of ACTION_MAP) {
    for (const pattern of rule.patterns) {
      const match = input.match(pattern);
      if (match) {
        return rule.build(input, match);
      }
    }
  }

  return null;
}

/**
 * Batch intent processing (future multi-step planner support)
 */
export function mapActions(inputs = []) {
  return inputs.map(mapAction).filter(Boolean);
}

/**
 * Extend action map dynamically
 */
export function registerAction(rule) {
  ACTION_MAP.push(rule);
}

export default {
  ACTION_TYPES,
  ACTION_MAP,
  mapAction,
  mapActions,
  registerAction,
};
