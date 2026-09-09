// backend/auth/credential-manager.js
// Dual-Storage Secure Credential Manager (AES-256-GCM Local + Firebase Firestore)

import fs from "fs";
import path from "path";
import crypto from "crypto";

const LOCAL_ENC_FILE = path.join(process.cwd(), "backend", "auth", "credentials.json.enc");
const LOCAL_LEGACY_FILE = path.join(process.cwd(), "backend", "auth", "credentials.json");

const SECRET = process.env.JARVIS_CREDENTIAL_SECRET || "Jarvis-Browser-Agent-Master-Key-2026";
const SALT = Buffer.from("jarvis-agent-salt-secure-99", "utf8");
const KEY = crypto.scryptSync(SECRET, SALT, 32);

// Cache Firestore connection
let firestoreDb = null;
let firestoreOps = null;

async function getFirestore() {
  if (firestoreDb && firestoreOps) {
    return { db: firestoreDb, ...firestoreOps };
  }
  try {
    const { default: db, doc, getDoc, setDoc, deleteDoc, getDocs, collection } =
      await import("../../database/firebaseConfig.js");
    firestoreDb = db;
    firestoreOps = { doc, getDoc, setDoc, deleteDoc, getDocs, collection };
    return { db, doc, getDoc, setDoc, deleteDoc, getDocs, collection };
  } catch (err) {
    console.warn("[CredentialManager] Firebase Firestore unavailable, defaulting to local storage:", err.message);
    return null;
  }
}

export class CredentialManager {
  constructor(options = {}) {
    this.options = {
      defaultStorage: options.defaultStorage || "both", // 'local' | 'firebase' | 'both'
      debug: options.debug ?? true,
      ...options,
    };
    this.ensureLocalFile();
  }

  log(...args) {
    if (this.options.debug) {
      console.log("[CredentialManager]", ...args);
    }
  }

  warn(...args) {
    console.warn("[CredentialManager]", ...args);
  }

  // ==========================================================
  // AES-256-GCM ENCRYPTION & DECRYPTION
  // ==========================================================

  encrypt(text) {
    if (!text) return "";
    try {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
      let encrypted = cipher.update(String(text), "utf8", "hex");
      encrypted += cipher.final("hex");
      const authTag = cipher.getAuthTag().toString("hex");
      return `${iv.toString("hex")}:${authTag}:${encrypted}`;
    } catch (err) {
      this.warn("Encryption failed, fallback:", err.message);
      return text;
    }
  }

  decrypt(payload) {
    if (!payload) return "";
    try {
      const parts = String(payload).split(":");
      if (parts.length === 3) {
        const [ivHex, tagHex, encrypted] = parts;
        const iv = Buffer.from(ivHex, "hex");
        const tag = Buffer.from(tagHex, "hex");
        const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
      }
      // Legacy fallback attempt
      try {
        const legacyDecipher = crypto.createDecipher("aes-256-cbc", SECRET);
        let dec = legacyDecipher.update(payload, "hex", "utf8");
        dec += legacyDecipher.final("utf8");
        return dec;
      } catch {
        return payload;
      }
    } catch (err) {
      this.warn("Decryption error:", err.message);
      return payload;
    }
  }

  // ==========================================================
  // DOMAIN & SITE NORMALIZATION
  // ==========================================================

  normalizeSite(siteOrUrl) {
    if (!siteOrUrl) return "";
    let clean = String(siteOrUrl).trim().toLowerCase();

    // If full URL, extract hostname
    if (/^https?:\/\//i.test(clean)) {
      try {
        const parsed = new URL(clean);
        clean = parsed.hostname;
      } catch {}
    }

    // Strip www. and port
    clean = clean.replace(/^www\./, "").replace(/:\d+$/, "");

    // Normalize known aliases
    if (clean.includes("flipkart")) return "flipkart.com";
    if (clean.includes("zinghr")) return "zinghr.com";
    if (clean.includes("udemy")) return "udemy.com";
    if (clean.includes("amazon")) return "amazon.com";
    if (clean.includes("google")) return "google.com";

    return clean;
  }

  // ==========================================================
  // LOCAL STORAGE (ENCRYPTED FILE)
  // ==========================================================

  ensureLocalFile() {
    try {
      if (!fs.existsSync(LOCAL_ENC_FILE)) {
        // If legacy unencrypted or semi-encrypted file exists, migrate
        if (fs.existsSync(LOCAL_LEGACY_FILE)) {
          const raw = fs.readFileSync(LOCAL_LEGACY_FILE, "utf8");
          try {
            const data = JSON.parse(raw);
            fs.writeFileSync(LOCAL_ENC_FILE, JSON.stringify(data, null, 2), "utf8");
          } catch {
            fs.writeFileSync(LOCAL_ENC_FILE, "{}", "utf8");
          }
        } else {
          fs.writeFileSync(LOCAL_ENC_FILE, "{}", "utf8");
        }
      }
    } catch (e) {
      this.warn("ensureLocalFile error:", e.message);
    }
  }

  loadAllLocal() {
    try {
      this.ensureLocalFile();
      if (!fs.existsSync(LOCAL_ENC_FILE)) return {};
      const content = fs.readFileSync(LOCAL_ENC_FILE, "utf8").trim();
      if (!content) return {};
      return JSON.parse(content);
    } catch (err) {
      this.warn("loadAllLocal error:", err.message);
      return {};
    }
  }

  saveAllLocal(data) {
    try {
      this.ensureLocalFile();
      fs.writeFileSync(LOCAL_ENC_FILE, JSON.stringify(data, null, 2), "utf8");
    } catch (err) {
      this.warn("saveAllLocal error:", err.message);
    }
  }

  // Backward compatibility methods
  loadAll() {
    return this.loadAllLocal();
  }

  saveAll(data) {
    return this.saveAllLocal(data);
  }

  // ==========================================================
  // UNIFIED CRUD (LOCAL + FIREBASE FIRESTORE)
  // ==========================================================

  /**
   * Save credential to Local file, Firebase Firestore, or both.
   */
  async save(site, username, password, options = {}) {
    const storageMode = options.storage || this.options.defaultStorage; // 'local' | 'firebase' | 'both'
    const normalized = this.normalizeSite(site);
    const encryptedPassword = this.encrypt(password);
    const now = new Date().toISOString();

    const record = {
      site: normalized,
      originalSite: site,
      username: String(username || "").trim(),
      password: encryptedPassword,
      extraFields: options.extraFields || {}, // e.g. companyCode for ZingHR
      storage: storageMode,
      updatedAt: now,
    };

    let localOk = false;
    let firebaseOk = false;

    // 1. Save to Local
    if (storageMode === "local" || storageMode === "both") {
      try {
        const localData = this.loadAllLocal();
        localData[normalized] = record;
        this.saveAllLocal(localData);
        localOk = true;
        this.log(`Saved credentials for "${normalized}" to Local Storage`);
      } catch (err) {
        this.warn(`Failed to save "${normalized}" locally:`, err.message);
      }
    }

    // 2. Save to Firebase Firestore
    if (storageMode === "firebase" || storageMode === "both") {
      try {
        const fb = await getFirestore();
        if (fb) {
          const docRef = fb.doc(fb.db, "credentials", normalized);
          await fb.setDoc(docRef, record, { merge: true });
          firebaseOk = true;
          this.log(`Saved credentials for "${normalized}" to Firebase Firestore`);
        }
      } catch (err) {
        this.warn(`Failed to save "${normalized}" to Firebase:`, err.message);
      }
    }

    return {
      success: localOk || firebaseOk,
      site: normalized,
      storage: storageMode,
      local: localOk,
      firebase: firebaseOk,
    };
  }

  /**
   * Synchronous save (Local only) for backward compatibility
   */
  saveSync(site, username, password, extraFields = {}) {
    const normalized = this.normalizeSite(site);
    const data = this.loadAllLocal();
    data[normalized] = {
      site: normalized,
      originalSite: site,
      username,
      password: this.encrypt(password),
      extraFields,
      storage: "local",
      updatedAt: new Date().toISOString(),
    };
    this.saveAllLocal(data);
  }

  /**
   * Get credential by site/URL. Checks Local and/or Firebase.
   */
  async get(site, options = {}) {
    const normalized = this.normalizeSite(site);
    const preferredStorage = options.storage || "auto"; // 'auto' | 'local' | 'firebase'

    let record = null;
    let foundIn = null;

    // 1. Check Local if preferred or auto
    if (preferredStorage === "local" || preferredStorage === "auto") {
      const localData = this.loadAllLocal();
      if (localData[normalized]) {
        record = localData[normalized];
        foundIn = "local";
      } else {
        // Domain suffix matching (e.g. "mycorp.zinghr.com" matches "zinghr.com")
        for (const [key, val] of Object.entries(localData)) {
          if (normalized.endsWith(key) || key.endsWith(normalized) || normalized.includes(key) || key.includes(normalized)) {
            record = val;
            foundIn = "local";
            break;
          }
        }
      }
    }

    // 2. Check Firebase if not found in local or if firebase was preferred
    if (!record || preferredStorage === "firebase") {
      try {
        const fb = await getFirestore();
        if (fb) {
          const docRef = fb.doc(fb.db, "credentials", normalized);
          const snap = await fb.getDoc(docRef);
          if (snap.exists()) {
            record = snap.data();
            foundIn = "firebase";
          }
        }
      } catch (err) {
        this.warn("Firebase get failed:", err.message);
      }
    }

    if (!record) return null;

    return {
      site: normalized,
      originalSite: record.originalSite || site,
      username: record.username,
      password: this.decrypt(record.password),
      extraFields: record.extraFields || {},
      source: foundIn,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Synchronous get (Local only) for backward compatibility
   */
  getSync(site) {
    const normalized = this.normalizeSite(site);
    const data = this.loadAllLocal();
    let record = data[normalized];
    if (!record) {
      for (const [key, val] of Object.entries(data)) {
        if (normalized.includes(key) || key.includes(normalized)) {
          record = val;
          break;
        }
      }
    }
    if (!record) return null;
    return {
      site: normalized,
      username: record.username,
      password: this.decrypt(record.password),
      extraFields: record.extraFields || {},
    };
  }

  /**
   * List all stored credentials with masked passwords.
   */
  async list(options = {}) {
    const result = new Map();

    // 1. Gather Local
    const localData = this.loadAllLocal();
    for (const [site, item] of Object.entries(localData)) {
      result.set(site, {
        site,
        username: item.username,
        passwordMasked: "••••••••",
        extraFields: item.extraFields || {},
        storage: "local",
        updatedAt: item.updatedAt,
      });
    }

    // 2. Gather Firebase
    try {
      const fb = await getFirestore();
      if (fb) {
        const querySnapshot = await fb.getDocs(fb.collection(fb.db, "credentials"));
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const site = data.site || docSnap.id;
          if (result.has(site)) {
            const existing = result.get(site);
            existing.storage = "both";
          } else {
            result.set(site, {
              site,
              username: data.username,
              passwordMasked: "••••••••",
              extraFields: data.extraFields || {},
              storage: "firebase",
              updatedAt: data.updatedAt,
            });
          }
        });
      }
    } catch (err) {
      this.warn("List Firebase credentials error:", err.message);
    }

    return Array.from(result.values());
  }

  /**
   * Remove a credential from Local, Firebase, or both.
   */
  async remove(site, options = {}) {
    const normalized = this.normalizeSite(site);
    const storage = options.storage || "both";

    if (storage === "local" || storage === "both") {
      const localData = this.loadAllLocal();
      delete localData[normalized];
      this.saveAllLocal(localData);
      this.log(`Removed "${normalized}" from Local Storage`);
    }

    if (storage === "firebase" || storage === "both") {
      try {
        const fb = await getFirestore();
        if (fb) {
          const docRef = fb.doc(fb.db, "credentials", normalized);
          await fb.deleteDoc(docRef);
          this.log(`Removed "${normalized}" from Firebase Firestore`);
        }
      } catch (err) {
        this.warn("Firebase remove error:", err.message);
      }
    }

    return { success: true, site: normalized };
  }

  /**
   * Sync credentials bidirectionally between Local and Firebase.
   */
  async sync() {
    this.log("Synchronizing credentials between Local Storage and Firebase Firestore...");
    const localData = this.loadAllLocal();
    let syncedFromFirebase = 0;
    let syncedToFirebase = 0;

    try {
      const fb = await getFirestore();
      if (!fb) return { success: false, reason: "Firebase unavailable" };

      // 1. Pull from Firebase -> Local
      const snapshot = await fb.getDocs(fb.collection(fb.db, "credentials"));
      snapshot.forEach((docSnap) => {
        const fbItem = docSnap.data();
        const site = fbItem.site || docSnap.id;
        if (!localData[site] || new Date(fbItem.updatedAt || 0) > new Date(localData[site].updatedAt || 0)) {
          localData[site] = fbItem;
          syncedFromFirebase++;
        }
      });
      this.saveAllLocal(localData);

      // 2. Push from Local -> Firebase
      for (const [site, item] of Object.entries(localData)) {
        const docRef = fb.doc(fb.db, "credentials", site);
        await fb.setDoc(docRef, item, { merge: true });
        syncedToFirebase++;
      }

      this.log(`Sync complete: ${syncedFromFirebase} pulled from Firebase, ${syncedToFirebase} pushed to Firebase`);
      return { success: true, syncedFromFirebase, syncedToFirebase };
    } catch (err) {
      this.warn("Sync failed:", err.message);
      return { success: false, error: err.message };
    }
  }
}

export const credentialManager = new CredentialManager();
export default CredentialManager;
