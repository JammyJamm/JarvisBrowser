// cache.js
// High-performance LRU + TTL cache for Jarvis Browser / Planner system

import fs from "fs";
import path from "path";

/**
 * =========================
 * LRU + TTL CACHE CLASS
 * =========================
 */
class Cache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 200; // max items in memory
    this.defaultTTL = options.defaultTTL || 60 * 1000; // 1 min default
    this.persistPath = options.persistPath || null;

    this.store = new Map(); // key -> { value, expiry }
    this.order = new Map(); // LRU tracking

    // Load persisted cache if available
    if (this.persistPath) {
      this._loadFromDisk();
    }
  }

  /**
   * Get value from cache
   */
  get(key) {
    const item = this.store.get(key);

    if (!item) return null;

    // Check expiry
    if (item.expiry && Date.now() > item.expiry) {
      this.delete(key);
      return null;
    }

    // Update LRU order (move to latest)
    this.order.delete(key);
    this.order.set(key, true);

    return item.value;
  }

  /**
   * Set value in cache
   */
  set(key, value, ttl = this.defaultTTL) {
    // Evict oldest if over capacity
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldestKey = this.order.keys().next().value;
      this.delete(oldestKey);
    }

    const expiry = ttl ? Date.now() + ttl : null;

    this.store.set(key, { value, expiry });

    // Update LRU order
    this.order.delete(key);
    this.order.set(key, true);

    // Persist if enabled
    if (this.persistPath) {
      this._saveToDisk();
    }
  }

  /**
   * Delete a key
   */
  delete(key) {
    this.store.delete(key);
    this.order.delete(key);
  }

  /**
   * Clear cache
   */
  clear() {
    this.store.clear();
    this.order.clear();
  }

  /**
   * Check if key exists and not expired
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Get cache size
   */
  size() {
    return this.store.size;
  }

  /**
   * =========================
   * DISK PERSISTENCE
   * =========================
   */

  _saveToDisk() {
    try {
      const data = JSON.stringify([...this.store.entries()]);
      fs.writeFileSync(this.persistPath, data, "utf-8");
    } catch (err) {
      console.error("[Cache] Save error:", err.message);
    }
  }

  _loadFromDisk() {
    try {
      if (!fs.existsSync(this.persistPath)) return;

      const raw = fs.readFileSync(this.persistPath, "utf-8");
      const entries = JSON.parse(raw);

      for (const [key, value] of entries) {
        this.store.set(key, value);
        this.order.set(key, true);
      }
    } catch (err) {
      console.error("[Cache] Load error:", err.message);
    }
  }
}

/**
 * =========================
 * SINGLETON EXPORT (OPTIONAL)
 * =========================
 */
const cache = new Cache({
  maxSize: 300,
  defaultTTL: 120 * 1000, // 2 minutes
  persistPath: path.join(process.cwd(), "cache-store.json"),
});

export default cache;
export { Cache };
