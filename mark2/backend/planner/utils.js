// planner/utils.js
// Ultra-fast utility layer for planner / intent system

// -----------------------------
// Text Utilities
// -----------------------------

export function normalizeText(str = "") {
  return String(str)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim();
}

export function tokenize(str = "") {
  return normalizeText(str).split(" ").filter(Boolean);
}

export function jaccardSimilarity(a = "", b = "") {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));

  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;

  let intersection = 0;
  for (const v of A) if (B.has(v)) intersection++;

  const union = new Set([...A, ...B]).size;
  return intersection / union;
}

// -----------------------------
// Async Utilities
// -----------------------------

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function debounce(fn, delay = 200) {
  let timer = null;

  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

export function throttle(fn, limit = 200) {
  let inThrottle = false;
  let lastArgs = null;

  return function (...args) {
    lastArgs = args;

    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;

      setTimeout(() => {
        inThrottle = false;
        if (lastArgs) fn.apply(this, lastArgs);
        lastArgs = null;
      }, limit);
    }
  };
}

// -----------------------------
// Object Utilities
// -----------------------------

export function deepClone(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  return JSON.parse(JSON.stringify(obj));
}

export function safeJSONParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// -----------------------------
// ID / String Utilities
// -----------------------------

export function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function isURL(str = "") {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

export function extractNumbers(str = "") {
  return (String(str).match(/-?\d+(\.\d+)?/g) || []).map(Number);
}

// -----------------------------
// Priority Queue (Min-Heap)
// -----------------------------

export class PriorityQueue {
  constructor() {
    this.heap = [];
  }

  push(item, priority = 0) {
    this.heap.push({ item, priority });
    this._bubbleUp(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) return null;
    if (this.heap.length === 1) return this.heap.pop().item;

    const top = this.heap[0].item;
    this.heap[0] = this.heap.pop();
    this._sinkDown(0);

    return top;
  }

  size() {
    return this.heap.length;
  }

  _bubbleUp(index) {
    const element = this.heap[index];

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.heap[parentIndex];

      if (element.priority >= parent.priority) break;

      this.heap[parentIndex] = element;
      this.heap[index] = parent;
      index = parentIndex;
    }
  }

  _sinkDown(index) {
    const length = this.heap.length;
    const element = this.heap[index];

    while (true) {
      let left = 2 * index + 1;
      let right = 2 * index + 2;
      let swap = null;

      if (left < length) {
        if (this.heap[left].priority < element.priority) {
          swap = left;
        }
      }

      if (right < length) {
        if (
          (swap === null && this.heap[right].priority < element.priority) ||
          (swap !== null &&
            this.heap[right].priority < this.heap[left].priority)
        ) {
          swap = right;
        }
      }

      if (swap === null) break;

      this.heap[index] = this.heap[swap];
      this.heap[swap] = element;
      index = swap;
    }
  }
}

// -----------------------------
// Lightweight Logger
// -----------------------------

export const logger = {
  info: (...args) => console.log("[INFO]", ...args),
  warn: (...args) => console.warn("[WARN]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
  debug: (...args) => {
    if (process?.env?.DEBUG) console.log("[DEBUG]", ...args);
  },
};
