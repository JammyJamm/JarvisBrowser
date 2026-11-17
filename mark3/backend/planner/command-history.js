// backend/planner/command-history.js
//
// Ultra-fast Command History Manager for Jarvis Browser
//
// Features:
// ✅ Stores executed commands
// ✅ Undo / Redo stack support
// ✅ Persistent JSON storage
// ✅ Safe auto-load
// ✅ Filtering & search
// ✅ Export / Import history
// ✅ Max history size
// ✅ Metadata support
// ✅ Execution status tracking
// ✅ Fast in-memory operations
// ✅ ES Module compatible
//
// Architecture
//
// Command
//    │
//    ▼
// CommandHistory
//    │
//    ├── History
//    ├── Undo Stack
//    ├── Redo Stack
//    └── Persistence
//
// IMPORTANT
// ----------------------------------------------------------
// This class stores command history only.
// It does NOT execute commands.
// It does NOT perform undo actions on the browser.
//
// Undo / Redo here means history-state management.
// Actual browser rollback must be handled by Executor / Resolver.
//

import fs from "fs";
import path from "path";

//==========================================================
// DEFAULT OPTIONS
//==========================================================

const DEFAULT_OPTIONS = {
  maxSize: 500,

  storagePath: null,

  autoLoad: true,

  autoPersist: true,

  debug: false,
};

//==========================================================
// COMMAND HISTORY
//==========================================================

class CommandHistory {
  constructor(options = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    //------------------------------------------------------
    // Configuration
    //------------------------------------------------------

    this.maxSize = Math.max(
      1,
      Number(this.options.maxSize) || DEFAULT_OPTIONS.maxSize,
    );

    this.storagePath = this.options.storagePath || null;

    this.debug = Boolean(this.options.debug);

    this.autoPersist = Boolean(this.options.autoPersist);

    //------------------------------------------------------
    // State
    //------------------------------------------------------

    this.history = [];

    this.undoStack = [];

    this.redoStack = [];

    this.loaded = false;

    //------------------------------------------------------
    // Statistics
    //------------------------------------------------------

    this.stats = {
      added: 0,

      removed: 0,

      undoCount: 0,

      redoCount: 0,

      searches: 0,

      imports: 0,

      exports: 0,

      persistenceErrors: 0,

      loadErrors: 0,
    };

    //------------------------------------------------------
    // Auto load
    //------------------------------------------------------

    if (this.options.autoLoad) {
      this.load();
    }
  }

  //========================================================
  // DEBUG LOGGER
  //========================================================

  log(...args) {
    if (!this.debug) {
      return;
    }

    console.log("[CommandHistory]", ...args);
  }

  //========================================================
  // ADD COMMAND
  //========================================================

  add(command, result = null, meta = {}) {
    const entry = this._createEntry(command, result, meta);

    //------------------------------------------------------
    // Add to history
    //------------------------------------------------------

    this.history.push(entry);

    //------------------------------------------------------
    // Maintain maximum size
    //------------------------------------------------------

    this._enforceMaxSize();

    //------------------------------------------------------
    // New command invalidates redo history
    //------------------------------------------------------

    this.redoStack = [];

    //------------------------------------------------------
    // Statistics
    //------------------------------------------------------

    this.stats.added++;

    this.log("Command added:", entry);

    //------------------------------------------------------
    // Persist
    //------------------------------------------------------

    this._persist();

    return entry;
  }

  //========================================================
  // CREATE ENTRY
  //========================================================

  _createEntry(command, result = null, meta = {}) {
    return {
      id: this._generateId(),

      command: command === null || command === undefined ? "" : String(command),

      result,

      meta: meta && typeof meta === "object" ? { ...meta } : {},

      timestamp: Date.now(),
    };
  }

  //========================================================
  // GET ALL
  //========================================================

  getAll() {
    return [...this.history];
  }

  //========================================================
  // GET LAST
  //========================================================

  getLast(n = 1) {
    const count = Math.max(0, Number(n) || 0);

    if (!count) {
      return [];
    }

    return this.history.slice(-count);
  }

  //========================================================
  // GET BY ID
  //========================================================

  getById(id) {
    if (!id) {
      return null;
    }

    return this.history.find((entry) => entry.id === id) || null;
  }

  //========================================================
  // REMOVE BY ID
  //========================================================

  remove(id) {
    if (!id) {
      return null;
    }

    const index = this.history.findIndex((entry) => entry.id === id);

    if (index === -1) {
      return null;
    }

    const [removed] = this.history.splice(index, 1);

    this.stats.removed++;

    this._persist();

    return removed;
  }

  //========================================================
  // CLEAR HISTORY
  //========================================================

  clear() {
    this.history = [];

    this.undoStack = [];

    this.redoStack = [];

    this._persist();

    this.log("History cleared");

    return true;
  }

  //========================================================
  // UNDO
  //
  // Moves latest history item:
  //
  // History
  //    │
  //    ▼
  // Undo Stack
  //
  // The item is removed from active history.
  //========================================================

  undo() {
    const last = this.history.pop();

    if (!last) {
      return null;
    }

    //------------------------------------------------------
    // Store in undo stack
    //------------------------------------------------------

    this.undoStack.push(last);

    //------------------------------------------------------
    // Do NOT add to redo stack here.
    //
    // Redo is generated from the undo stack.
    //------------------------------------------------------

    this.stats.undoCount++;

    this._persist();

    this.log("Undo:", last);

    return last;
  }

  //========================================================
  // REDO
  //
  // Moves latest undone item:
  //
  // Undo Stack
  //    │
  //    ▼
  // History
  //========================================================

  redo() {
    const item = this.undoStack.pop();

    if (!item) {
      return null;
    }

    //------------------------------------------------------
    // Restore history
    //------------------------------------------------------

    this.history.push(item);

    //------------------------------------------------------
    // Maintain history size
    //------------------------------------------------------

    this._enforceMaxSize();

    //------------------------------------------------------
    // Track redo operation
    //------------------------------------------------------

    this.redoStack.push(item);

    this.stats.redoCount++;

    this._persist();

    this.log("Redo:", item);

    return item;
  }

  //========================================================
  // SEARCH
  //========================================================

  find(query) {
    if (query === null || query === undefined || String(query).trim() === "") {
      return [];
    }

    const q = String(query).trim().toLowerCase();

    this.stats.searches++;

    return this.history.filter((entry) => {
      const command = String(entry.command || "").toLowerCase();

      const result = JSON.stringify(entry.result || "").toLowerCase();

      const meta = JSON.stringify(entry.meta || "").toLowerCase();

      return command.includes(q) || result.includes(q) || meta.includes(q);
    });
  }

  //========================================================
  // FILTER BY TIME
  //========================================================

  filterByTime(startTime = 0, endTime = Date.now()) {
    const start = Number(startTime) || 0;

    const end = Number(endTime) || Date.now();

    return this.history.filter(
      (entry) => entry.timestamp >= start && entry.timestamp <= end,
    );
  }

  //========================================================
  // FILTER BY META
  //========================================================

  filterByMeta(key, value) {
    if (!key) {
      return [];
    }

    return this.history.filter(
      (entry) => entry.meta && entry.meta[key] === value,
    );
  }

  //========================================================
  // EXPORT
  //========================================================

  export(options = {}) {
    const pretty = options.pretty !== false;

    this.stats.exports++;

    const payload = {
      version: 1,

      exportedAt: Date.now(),

      history: this.history,
    };

    return JSON.stringify(payload, null, pretty ? 2 : 0);
  }

  //========================================================
  // IMPORT
  //========================================================

  import(jsonData) {
    if (!jsonData) {
      return false;
    }

    try {
      const parsed =
        typeof jsonData === "string" ? JSON.parse(jsonData) : jsonData;

      //----------------------------------------------------
      // Support:
      //
      // 1. Old format:
      //    [...]
      //
      // 2. New format:
      //    { history: [...] }
      //----------------------------------------------------

      let data = [];

      if (Array.isArray(parsed)) {
        data = parsed;
      } else if (parsed && Array.isArray(parsed.history)) {
        data = parsed.history;
      } else {
        return false;
      }

      //----------------------------------------------------
      // Validate and normalize
      //----------------------------------------------------

      this.history = data
        .filter((entry) => entry !== null)
        .map((entry) => this._normalizeEntry(entry))
        .slice(-this.maxSize);

      //----------------------------------------------------
      // Reset transient stacks
      //----------------------------------------------------

      this.undoStack = [];

      this.redoStack = [];

      this.stats.imports++;

      //----------------------------------------------------
      // Persist
      //----------------------------------------------------

      this._persist();

      this.log("History imported:", this.history.length);

      return true;
    } catch (err) {
      console.error("[CommandHistory] Import failed:", err.message);

      return false;
    }
  }

  //========================================================
  // NORMALIZE IMPORTED ENTRY
  //========================================================

  _normalizeEntry(entry) {
    return {
      id: entry.id || this._generateId(),

      command:
        entry.command === null || entry.command === undefined
          ? ""
          : String(entry.command),

      result: entry.result !== undefined ? entry.result : null,

      meta: entry.meta && typeof entry.meta === "object" ? entry.meta : {},

      timestamp: Number(entry.timestamp) || Date.now(),
    };
  }

  //========================================================
  // LOAD FROM DISK
  //========================================================

  load() {
    //------------------------------------------------------
    // Already loaded
    //------------------------------------------------------

    if (this.loaded) {
      return this.getAll();
    }

    //------------------------------------------------------
    // No persistence configured
    //------------------------------------------------------

    if (!this.storagePath) {
      this.loaded = true;

      return this.getAll();
    }

    try {
      if (!fs.existsSync(this.storagePath)) {
        this.loaded = true;

        return this.getAll();
      }

      const data = fs.readFileSync(this.storagePath, "utf-8");

      if (!data.trim()) {
        this.loaded = true;

        return this.getAll();
      }

      const parsed = JSON.parse(data);

      //----------------------------------------------------
      // Support old and new persistence formats
      //----------------------------------------------------

      const entries = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.history)
          ? parsed.history
          : [];

      this.history = entries
        .filter(Boolean)
        .map((entry) => this._normalizeEntry(entry))
        .slice(-this.maxSize);

      this.loaded = true;

      this.log("History loaded:", this.history.length);

      return this.getAll();
    } catch (err) {
      this.stats.loadErrors++;

      console.error("[CommandHistory] Failed to load history:", err.message);

      this.loaded = true;

      return this.getAll();
    }
  }

  //========================================================
  // PERSIST
  //========================================================

  _persist() {
    if (!this.autoPersist || !this.storagePath) {
      return false;
    }

    try {
      //----------------------------------------------------
      // Ensure directory exists
      //----------------------------------------------------

      const directory = path.dirname(this.storagePath);

      if (directory && directory !== ".") {
        fs.mkdirSync(directory, {
          recursive: true,
        });
      }

      //----------------------------------------------------
      // Persist only history.
      //
      // Undo/redo stacks are transient runtime state.
      //----------------------------------------------------

      fs.writeFileSync(
        this.storagePath,
        JSON.stringify(this.history, null, 2),
        "utf-8",
      );

      return true;
    } catch (err) {
      this.stats.persistenceErrors++;

      console.error("[CommandHistory] Failed to persist history:", err.message);

      return false;
    }
  }

  //========================================================
  // ENFORCE MAX SIZE
  //========================================================

  _enforceMaxSize() {
    while (this.history.length > this.maxSize) {
      this.history.shift();

      this.stats.removed++;
    }
  }

  //========================================================
  // GENERATE UNIQUE ID
  //========================================================

  _generateId() {
    return (
      "cmd_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).substring(2, 10)
    );
  }

  //========================================================
  // SIZE
  //========================================================

  size() {
    return this.history.length;
  }

  //========================================================
  // LATEST
  //========================================================

  latest() {
    return this.history[this.history.length - 1] || null;
  }

  //========================================================
  // CAN UNDO
  //========================================================

  canUndo() {
    return this.history.length > 0;
  }

  //========================================================
  // CAN REDO
  //========================================================

  canRedo() {
    return this.undoStack.length > 0;
  }

  //========================================================
  // HISTORY STACK STATUS
  //========================================================

  getStackStatus() {
    return {
      history: this.history.length,

      undo: this.undoStack.length,

      redo: this.redoStack.length,

      canUndo: this.canUndo(),

      canRedo: this.canRedo(),
    };
  }

  //========================================================
  // STATISTICS
  //========================================================

  getStatistics() {
    return {
      ...this.stats,

      historySize: this.history.length,

      undoSize: this.undoStack.length,

      redoSize: this.redoStack.length,

      maxSize: this.maxSize,

      loaded: this.loaded,

      persistent: Boolean(this.storagePath),
    };
  }

  //========================================================
  // RESET STATISTICS
  //========================================================

  resetStatistics() {
    this.stats = {
      added: 0,

      removed: 0,

      undoCount: 0,

      redoCount: 0,

      searches: 0,

      imports: 0,

      exports: 0,

      persistenceErrors: 0,

      loadErrors: 0,
    };
  }
}

//==========================================================
// DEFAULT INSTANCE
//==========================================================
//
// Keep the class export as the primary export.
// This allows:
//
// import CommandHistory from "./command-history.js";
//
// For a shared singleton, instantiate explicitly in the
// planner layer with the desired persistence path.
//

export default CommandHistory;

export { CommandHistory };
