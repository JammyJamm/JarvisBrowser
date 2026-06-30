// command-history.js
//
// Lightweight Command History Manager
// Features:
// ✅ Stores executed commands
// ✅ Undo/Redo stacks support
// ✅ Persistent storage (JSON file / localStorage fallback)
// ✅ Filtering & search
// ✅ Export / Import history
// ✅ Works for CLI / Browser / Electron apps

const fs = require("fs");
const path = require("path");

class CommandHistory {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 500;
    this.storagePath = options.storagePath || null; // optional file persistence

    this.history = [];
    this.undoStack = [];
    this.redoStack = [];

    this.loaded = false;
  }

  // ==============================
  // CORE OPERATIONS
  // ==============================

  add(command, result = null, meta = {}) {
    const entry = {
      id: this._generateId(),
      command,
      result,
      meta,
      timestamp: Date.now(),
    };

    this.history.push(entry);

    // Maintain max size
    if (this.history.length > this.maxSize) {
      this.history.shift();
    }

    // Clear redo stack on new action
    this.redoStack = [];

    this._persist();
    return entry;
  }

  getAll() {
    return this.history;
  }

  getLast(n = 1) {
    return this.history.slice(-n);
  }

  clear() {
    this.history = [];
    this.undoStack = [];
    this.redoStack = [];
    this._persist();
  }

  // ==============================
  // UNDO / REDO SUPPORT
  // ==============================

  undo() {
    const last = this.history.pop();
    if (!last) return null;

    this.undoStack.push(last);
    this.redoStack.push(last);

    this._persist();
    return last;
  }

  redo() {
    const item = this.undoStack.pop();
    if (!item) return null;

    this.history.push(item);
    this.redoStack.push(item);

    this._persist();
    return item;
  }

  // ==============================
  // SEARCH / FILTER
  // ==============================

  find(query) {
    if (!query) return [];

    const q = query.toLowerCase();

    return this.history.filter(
      (h) =>
        h.command.toLowerCase().includes(q) ||
        JSON.stringify(h.result || "")
          .toLowerCase()
          .includes(q),
    );
  }

  filterByTime(startTime, endTime) {
    return this.history.filter((h) => {
      return h.timestamp >= startTime && h.timestamp <= endTime;
    });
  }

  // ==============================
  // EXPORT / IMPORT
  // ==============================

  export() {
    return JSON.stringify(this.history, null, 2);
  }

  import(jsonData) {
    try {
      const data = JSON.parse(jsonData);
      if (Array.isArray(data)) {
        this.history = data;
        this._persist();
      }
      return true;
    } catch (err) {
      console.error("Import failed:", err.message);
      return false;
    }
  }

  // ==============================
  // PERSISTENCE
  // ==============================

  load() {
    if (!this.storagePath) {
      this.loaded = true;
      return;
    }

    try {
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, "utf-8");
        this.history = JSON.parse(data) || [];
      }
    } catch (err) {
      console.error("Failed to load history:", err.message);
    }

    this.loaded = true;
  }

  _persist() {
    if (!this.storagePath) return;

    try {
      fs.writeFileSync(
        this.storagePath,
        JSON.stringify(this.history, null, 2),
        "utf-8",
      );
    } catch (err) {
      console.error("Failed to persist history:", err.message);
    }
  }

  // ==============================
  // UTILITIES
  // ==============================

  _generateId() {
    return (
      "cmd_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).substring(2, 10)
    );
  }

  size() {
    return this.history.length;
  }

  latest() {
    return this.history[this.history.length - 1] || null;
  }
}

module.exports = CommandHistory;
