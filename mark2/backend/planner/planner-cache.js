// planner-cache.js
//
// High-performance cache layer for Jarvis Planner
// -------------------------------------------------
// Features:
// ✅ In-memory LRU cache
// ✅ TTL (time-based expiration)
// ✅ Optional disk persistence
// ✅ Fast O(1) get/set using Map
// ✅ Safe JSON serialization
// ✅ Cache tagging & invalidation
//
// Designed for ultra-fast intent parsing & planner optimization
//

import fs from "fs";
import path from "path";

/**
 * Node-safe sleep utility (optional debugging)
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  maxSize: 500, // max items in memory
  defaultTTL: 1000 * 60 * 10, // 10 minutes
  persist: false, // disk persistence disabled by default
  persistPath: "./planner-cache.json",
};

/**
 * Cache entry structure:
 * {
 *   value: any,
 *   expiresAt: number,
 *   tags: Set<string>
 * }
 */

export class PlannerCache {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Main storage (Map keeps insertion order → LRU-friendly)
    this.cache = new Map();

    // Reverse index for tags
    this.tagIndex = new Map();

    // Stats
    this.hits = 0;
    this.misses = 0;

    // Load from disk if enabled
    if (this.config.persist) {
      this._loadFromDisk();
    }
  }

  /**
   * Build cache key safely
   */
  _key(key) {
    if (typeof key === "string") return key;
    return JSON.stringify(key);
  }

  /**
   * Check expiration
   */
  _isExpired(entry) {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  /**
   * Touch key to refresh LRU order
   */
  _touch(key) {
    const entry = this.cache.get(key);
    if (!entry) return;

    this.cache.delete(key);
    this.cache.set(key, entry);
  }

  /**
   * Evict least recently used item
   */
  _evictIfNeeded() {
    while (this.cache.size > this.config.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this._delete(oldestKey);
    }
  }

  /**
   * Internal delete (also cleans tag index)
   */
  _delete(key) {
    const entry = this.cache.get(key);
    if (!entry) return;

    // remove tags
    if (entry.tags) {
      for (const tag of entry.tags) {
        const set = this.tagIndex.get(tag);
        if (set) {
          set.delete(key);
          if (set.size === 0) this.tagIndex.delete(tag);
        }
      }
    }

    this.cache.delete(key);
  }

  /**
   * Set cache value
   */
  set(key, value, options = {}) {
    const k = this._key(key);

    const ttl = options.ttl ?? this.config.defaultTTL;
    const tags = new Set(options.tags || []);

    const entry = {
      value,
      expiresAt: ttl ? Date.now() + ttl : null,
      tags,
    };

    // Remove old entry if exists
    if (this.cache.has(k)) {
      this._delete(k);
    }

    this.cache.set(k, entry);

    // update tag index
    for (const tag of tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag).add(k);
    }

    this._evictIfNeeded();
    this._persistAsync();

    return true;
  }

  /**
   * Get cache value
   */
  get(key) {
    const k = this._key(key);
    const entry = this.cache.get(k);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (this._isExpired(entry)) {
      this._delete(k);
      this.misses++;
      return null;
    }

    this.hits++;
    this._touch(k);
    return entry.value;
  }

  /**
   * Check existence
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Delete key
   */
  delete(key) {
    const k = this._key(key);
    return this._delete(k);
  }

  /**
   * Clear all cache
   */
  clear() {
    this.cache.clear();
    this.tagIndex.clear();
  }

  /**
   * Invalidate by tag
   */
  invalidateTag(tag) {
    const set = this.tagIndex.get(tag);
    if (!set) return;

    for (const key of set) {
      this._delete(key);
    }

    this.tagIndex.delete(tag);
  }

  /**
   * Get cache stats
   */
  stats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  /**
   * Persist cache to disk (sync)
   */
  _saveToDisk() {
    if (!this.config.persist) return;

    try {
      const data = {
        cache: Array.from(this.cache.entries()),
        tags: Array.from(this.tagIndex.entries()),
        timestamp: Date.now(),
      };

      fs.writeFileSync(this.config.persistPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("[PlannerCache] Save failed:", err.message);
    }
  }

  /**
   * Async persistence (non-blocking)
   */
  _persistAsync() {
    if (!this.config.persist) return;

    setImmediate(() => this._saveToDisk());
  }

  /**
   * Load cache from disk
   */
  _loadFromDisk() {
    try {
      if (!fs.existsSync(this.config.persistPath)) return;

      const raw = fs.readFileSync(this.config.persistPath, "utf-8");
      const data = JSON.parse(raw);

      if (!data.cache) return;

      this.cache = new Map(data.cache);
      this.tagIndex = new Map(
        data.tags?.map(([k, v]) => [k, new Set(v)]) || [],
      );

      // Clean expired entries on load
      for (const [key, entry] of this.cache) {
        if (this._isExpired(entry)) {
          this._delete(key);
        }
      }
    } catch (err) {
      console.error("[PlannerCache] Load failed:", err.message);
    }
  }
}

/**
 * Singleton helper (optional)
 */
export const plannerCache = new PlannerCache({
  maxSize: 1000,
  defaultTTL: 1000 * 60 * 5, // 5 min
  persist: false,
});
