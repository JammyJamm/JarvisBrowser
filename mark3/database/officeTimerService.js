// database/officeTimerService.js
import db from "./firebaseConfig.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";

export const CONFIG_COLLECTION = "office_timer_config";
export const CONFIG_DOC_ID = "settings";
export const ATTENDANCE_COLLECTION = "office_attendance";

export const TARGET_MINUTES_OPTIONS = [510, 420]; // 8h 30m (510) or 7h 00m (420)
export const DEFAULT_TARGET_MINUTES = 510;
export const DEFAULT_OFFICE_NETWORKS = ["CS-B5F-AP"];

/**
 * Format Date as YYYY-MM-DD in local time.
 */
export function getLocalDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Normalize targetMinutes to one of the supported targets (510 or 420),
 * defaulting to 510 (8h 30m).
 */
export function normalizeTargetMinutes(value) {
  const num = Number(value);
  if (num === 420) return 420;
  return 510;
}

/**
 * Compute attendance status from elapsedSeconds and targetMinutes.
 */
export function computeAttendanceStatus(elapsedSeconds, targetMinutes = DEFAULT_TARGET_MINUTES) {
  const targetSecs = normalizeTargetMinutes(targetMinutes) * 60;
  const elapsed = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
  if (elapsed >= targetSecs) return "completed";
  if (elapsed > 0) return "in_progress";
  return "not_started";
}

/**
 * Format duration in seconds to human-readable "Xh Ym".
 */
export function formatHoursMinutes(totalSeconds) {
  const secs = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const totalMinutes = Math.floor(secs / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

/**
 * Normalize list of office network names (SSIDs / profiles).
 */
export function normalizeNetworkList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const trimmed = String(item || "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * Load office timer configuration from Firestore.
 */
export async function getOfficeTimerConfig() {
  try {
    const ref = doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return {
        success: true,
        exists: false,
        config: {
          officeNetworks: [...DEFAULT_OFFICE_NETWORKS],
          defaultTargetMinutes: DEFAULT_TARGET_MINUTES,
          autoStartOnOfficeNetwork: true,
        },
      };
    }

    const data = snap.data() || {};
    const hasExplicitNetworks = Array.isArray(data.officeNetworks);
    const officeNetworks = normalizeNetworkList(data.officeNetworks);
    return {
      success: true,
      exists: true,
      config: {
        officeNetworks: hasExplicitNetworks ? officeNetworks : [...DEFAULT_OFFICE_NETWORKS],
        defaultTargetMinutes: normalizeTargetMinutes(data.defaultTargetMinutes),
        autoStartOnOfficeNetwork: data.autoStartOnOfficeNetwork !== false,
      },
    };
  } catch (err) {
    console.error("[Firebase Error] getOfficeTimerConfig failed:", err);
    return {
      success: false,
      error: err.message,
      config: {
        officeNetworks: [...DEFAULT_OFFICE_NETWORKS],
        defaultTargetMinutes: DEFAULT_TARGET_MINUTES,
        autoStartOnOfficeNetwork: true,
      },
    };
  }
}

/**
 * Save office timer configuration to Firestore.
 */
export async function saveOfficeTimerConfig(config = {}) {
  try {
    const hasExplicitNetworks = Array.isArray(config.officeNetworks);
    const officeNetworks = normalizeNetworkList(config.officeNetworks);
    const payload = {
      officeNetworks: hasExplicitNetworks ? officeNetworks : [...DEFAULT_OFFICE_NETWORKS],
      defaultTargetMinutes: normalizeTargetMinutes(config.defaultTargetMinutes),
      autoStartOnOfficeNetwork: config.autoStartOnOfficeNetwork !== false,
      updatedAt: serverTimestamp(),
    };

    const ref = doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID);
    await setDoc(ref, payload, { merge: true });

    return {
      success: true,
      config: {
        officeNetworks: payload.officeNetworks,
        defaultTargetMinutes: payload.defaultTargetMinutes,
        autoStartOnOfficeNetwork: payload.autoStartOnOfficeNetwork,
      },
    };
  } catch (err) {
    console.error("[Firebase Error] saveOfficeTimerConfig failed:", err);
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Normalize an attendance record before saving or returning.
 */
export function normalizeAttendanceRecord(dateStr, raw = {}) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))
    ? String(dateStr)
    : getLocalDateKey();
  const targetMinutes = normalizeTargetMinutes(raw.targetMinutes);
  const elapsedSeconds = Math.max(0, Math.floor(Number(raw.elapsedSeconds) || 0));
  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions
        .filter((s) => s && typeof s.start === "string")
        .map((s) => ({
          network: String(s.network || ""),
          start: s.start,
          end: typeof s.end === "string" ? s.end : null,
          durationSeconds: Math.max(0, Math.floor(Number(s.durationSeconds) || 0)),
          active: s.active === true,
        }))
    : [];

  return {
    date,
    targetMinutes,
    elapsedSeconds,
    status: computeAttendanceStatus(elapsedSeconds, targetMinutes),
    networkName: String(raw.networkName || ""),
    firstCheckIn: typeof raw.firstCheckIn === "string" ? raw.firstCheckIn : "",
    lastCheckOut: typeof raw.lastCheckOut === "string" ? raw.lastCheckOut : "",
    sessions,
  };
}

/**
 * Save a single day's office attendance record to Firestore.
 */
export async function saveOfficeAttendance(dateStr, rawData = {}) {
  try {
    const normalized = normalizeAttendanceRecord(dateStr, rawData);
    const ref = doc(db, ATTENDANCE_COLLECTION, normalized.date);
    await setDoc(
      ref,
      {
        ...normalized,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return {
      success: true,
      record: normalized,
    };
  } catch (err) {
    console.error("[Firebase Error] saveOfficeAttendance failed:", err);
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Fetch a single day's office attendance record from Firestore.
 */
export async function getOfficeAttendance(dateStr) {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))
      ? String(dateStr)
      : getLocalDateKey();
    const ref = doc(db, ATTENDANCE_COLLECTION, date);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return { success: true, exists: false, record: null };
    }
    return {
      success: true,
      exists: true,
      record: normalizeAttendanceRecord(date, snap.data()),
    };
  } catch (err) {
    console.error("[Firebase Error] getOfficeAttendance failed:", err);
    return {
      success: false,
      error: err.message,
      record: null,
    };
  }
}

/**
 * Fetch office attendance records within an inclusive YYYY-MM-DD range.
 */
export async function getOfficeAttendanceRange(startDateStr, endDateStr) {
  try {
    const colRef = collection(db, ATTENDANCE_COLLECTION);
    const q =
      startDateStr && endDateStr
        ? query(
            colRef,
            where("date", ">=", String(startDateStr)),
            where("date", "<=", String(endDateStr)),
          )
        : colRef;

    const snap = await getDocs(q);
    const records = {};
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const dateKey = data.date || docSnap.id;
      records[dateKey] = normalizeAttendanceRecord(dateKey, data);
    });

    return {
      success: true,
      records,
    };
  } catch (err) {
    console.error("[Firebase Error] getOfficeAttendanceRange failed:", err);
    return {
      success: false,
      error: err.message,
      records: {},
    };
  }
}

export default {
  getOfficeTimerConfig,
  saveOfficeTimerConfig,
  saveOfficeAttendance,
  getOfficeAttendance,
  getOfficeAttendanceRange,
  getLocalDateKey,
  normalizeTargetMinutes,
  computeAttendanceStatus,
  formatHoursMinutes,
  normalizeNetworkList,
  normalizeAttendanceRecord,
};
