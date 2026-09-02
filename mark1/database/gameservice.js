// database/gameservice.js
import db from "./firebaseConfig.js";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  deleteField,
} from "firebase/firestore";

/**
 * Format Date into 12-hour time string with lowercase am/pm:
 * e.g. "04:20pm", "09:05am", "11:45pm"
 */
export function formatTimeKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const formattedHours = String(hours).padStart(2, "0");
  return `${formattedHours}:${minutes}${ampm}`;
}

/**
 * Helper to split a number if it is above 19:
 * 1. Checks if number > 19.
 * 2. If above 19, splits the big number into two values such that:
 *    - 0th value (first part) <= 19
 *    - 1st value (second part) is not 0 and <= 19 (1 <= val <= 19)
 * 3. Returns array of resulting split numbers.
 */
export function splitNumberIfAbove19(n) {
  if (typeof n !== "number" || isNaN(n)) return [];
  if (n <= 19 && n >= 0) return [n];

  const s = String(Math.floor(Math.abs(n)));

  let bestSplit = null;

  for (let i = 1; i < s.length; i++) {
    const sA = s.slice(0, i);
    const sB = s.slice(i);
    const vA = parseInt(sA, 10);
    const vB = parseInt(sB, 10);

    if (vA <= 19 && vA > 0 && vB <= 19 && vB > 0) {
      if (sA.length === 2 || !bestSplit) {
        bestSplit = [vA, vB];
      }
    }
  }

  if (bestSplit) {
    return bestSplit;
  }

  if (s.length === 2) {
    const vA = parseInt(s[0], 10);
    let vB = parseInt(s[1], 10);
    if (vB === 0) vB = 1;
    return [Math.min(vA, 19), vB];
  }

  const vA = Math.min(
    parseInt(s.slice(0, 2), 10) <= 19
      ? parseInt(s.slice(0, 2), 10)
      : parseInt(s.slice(0, 1), 10),
    19,
  );
  const remStr = s.slice(s.indexOf(String(vA)) + String(vA).length);
  let vB = remStr ? parseInt(remStr.slice(0, 2), 10) : 1;
  if (vB > 19) vB = parseInt(remStr.slice(0, 1), 10) || 1;
  if (vB === 0) vB = 1;

  return [vA, vB];
}

/**
 * Validate and clean a single 4-value array [v0, v1, v2, v3]:
 * - v0 must NOT be above 19 (v0 <= 19)
 * - v1, v2, v3 must NOT be 0 and must NOT be above 19 (1 <= v <= 19)
 */
export function cleanFourValues(chunk) {
  let [v0, v1, v2, v3] = Array.isArray(chunk) ? chunk : [0, 5, 5, 5];

  // 1. Check v0 <= 19; if above 19, split it
  if (typeof v0 === "number" && v0 > 19) {
    const [splitA, splitB] = splitNumberIfAbove19(v0);
    v0 = splitA;
    if (splitB !== undefined && (v1 === undefined || v1 === 0)) {
      v1 = splitB;
    }
  }

  // 2. Ensure v0 is <= 19
  v0 = typeof v0 === "number" && !isNaN(v0) ? Math.min(Math.max(0, v0), 19) : 0;

  // 3. Ensure v1, v2, v3 are not 0 and <= 19 (1..19)
  const sanitizePos = (val, fallback = 5) => {
    if (typeof val === "number" && !isNaN(val) && val > 0) {
      if (val > 19) {
        const parts = splitNumberIfAbove19(val);
        return parts[0] || Math.min(val, 19);
      }
      return Math.min(val, 19);
    }
    return fallback;
  };

  v1 = sanitizePos(v1, v0 > 0 && v0 <= 19 ? Math.min(v0, 5) : 5);
  v2 = sanitizePos(v2, 5);
  v3 = sanitizePos(v3, 5);

  return [v0, v1, v2, v3];
}

/**
 * Format raw numbers or string into array of time-keyed 4-values objects:
 * [
 *   { "04:20pm": [15, 5, 5, 5] },
 *   { "04:21pm": [11, 1, 5, 5] },
 *   { "04:22pm": [3, 1, 1, 1] }
 * ]
 */
export function formatTimeToValuesJSON(rawInput, baseDate = new Date()) {
  if (!rawInput) {
    return [];
  }

  // 1. If it's already in the target format: [{ "04:20pm": [15, 5, 5, 5] }, ...]
  if (Array.isArray(rawInput) && rawInput.length && typeof rawInput[0] === "object") {
    const firstObj = rawInput[0];
    const firstKey = Object.keys(firstObj)[0];
    if (firstKey && /^\d{2}:\d{2}(?:am|pm)$/i.test(firstKey) && Array.isArray(firstObj[firstKey])) {
      return rawInput.map((item) => {
        const key = Object.keys(item)[0];
        const cleaned = cleanFourValues(item[key]);
        return { [key]: cleaned };
      });
    }
  }

  let numbers = [];

  // 2. Parse numbers from input
  if (typeof rawInput === "string") {
    const matches = rawInput.match(/\d+/g);
    if (matches) {
      numbers = matches.map(Number);
    }
  } else if (Array.isArray(rawInput)) {
    if (rawInput.every((n) => typeof n === "number")) {
      numbers = rawInput;
    } else {
      // Array of objects or legacy 4-values structure
      for (const item of rawInput) {
        if (item?.values && Array.isArray(item.values)) {
          numbers.push(...item.values);
        } else if (typeof item === "object") {
          const keys = Object.keys(item);
          for (const k of keys) {
            if (Array.isArray(item[k])) {
              for (const inner of item[k]) {
                if (inner?.values && Array.isArray(inner.values)) {
                  numbers.push(...inner.values);
                } else if (Array.isArray(inner)) {
                  numbers.push(...inner);
                } else if (typeof inner === "number") {
                  numbers.push(inner);
                }
              }
            }
          }
        }
      }
    }
  } else if (typeof rawInput === "object") {
    if (rawInput.text && typeof rawInput.text === "string") {
      return formatTimeToValuesJSON(rawInput.text, baseDate);
    }
    if (rawInput.frames) {
      for (const frame of rawInput.frames) {
        if (frame.containers) {
          for (const c of frame.containers) {
            if (c.text) {
              const res = formatTimeToValuesJSON(c.text, baseDate);
              if (res.length) return res;
            }
          }
        }
      }
    }
  }

  // Pre-process all raw numbers by splitting any number > 19
  const processedNumbers = [];
  for (const n of numbers) {
    if (typeof n === "number" && !isNaN(n)) {
      if (n > 19) {
        processedNumbers.push(...splitNumberIfAbove19(n));
      } else {
        processedNumbers.push(n);
      }
    }
  }

  // 3. Chunk numbers into 4 values each with timestamps ending at baseDate
  const items = [];
  const baseTime = (baseDate instanceof Date ? baseDate : new Date()).getTime();

  // Compute total chunks so timestamps end at baseTime (now)
  const totalChunks = Math.max(1, Math.ceil(processedNumbers.length / 4));

  for (let i = 0; i < processedNumbers.length; i += 4) {
    const chunk = processedNumbers.slice(i, i + 4);
    if (chunk.length > 0) {
      const cleaned = cleanFourValues(chunk);
      const chunkIndex = i / 4;
      const minutesOffset = totalChunks - 1 - chunkIndex;
      const setDate = new Date(baseTime - minutesOffset * 60000);
      const timeKey = formatTimeKey(setDate);
      items.push({ [timeKey]: cleaned });
    }
  }

  // Return newest-first: latest (baseTime) at index 0
  return items.reverse();
}

// Backwards compatibility alias
export function formatToFourValuesJSON(rawInput, roundKey = 0) {
  const items = formatTimeToValuesJSON(rawInput);
  return [{ [roundKey]: items }];
}

/**
 * Get Today's Date String (YYYY-MM-DD)
 */
export function getTodayDateId() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Save Round data to Firestore under collection "Bio_sic"
 * - Document ID: dateStr (e.g. "2026-08-26")
 * - 90 items per index (index "0" has max 90, index "1" has max 90, etc.)
 * - Format: [{ "04:20pm": [15, 5, 5, 5] }, ...]
 * - NOTE: Does NOT save "fourValues" field.
 */
export const saveRound = async (dateStr, rawInput, options = {}) => {
  try {
    const dateId = dateStr || getTodayDateId();
    if (!rawInput) {
      throw new Error("Invalid payload to save.");
    }

    // Normalize incoming payload into the 4-values time-keyed array
    const newItems = formatTimeToValuesJSON(rawInput);
    if (!newItems || !newItems.length) {
      throw new Error("No 4-value time items extracted from input.");
    }

    const docRef = doc(db, "Bio_sic", dateId);

    // Fetch existing document to preserve previous items
    let existingAllItems = [];
    let existingDocData = {};
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        existingDocData = snap.data() || {};
        let idx = 0;
        while (Array.isArray(existingDocData[String(idx)])) {
          existingAllItems.push(...existingDocData[String(idx)]);
          idx++;
        }
      }
    } catch (readErr) {
      console.warn("[Firebase] Could not fetch existing doc, creating new:", readErr.message);
    }

    // Merge logic:
    // - Preserve existing items order
    // - For each new item: if timeKey exists in existing items, replace the existing value with the new one (update)
    //   otherwise append the new item to the end (preserve historical order + add new)
    // Build merged items with newest-first order:
    // 1. Start with newItems (they are newest-first) to ensure latest values appear first
    // 2. Append existing items that are not present in newItems (preserve historical items)
    const mergedItems = [];
    const seenKeys = new Set();

    // add new items first (overwrite any existing)
    for (const item of newItems) {
      const key = Object.keys(item)[0];
      mergedItems.push(item);
      seenKeys.add(key);
    }

    // append older existing items that are not in newItems
    for (const item of existingAllItems) {
      const key = Object.keys(item)[0];
      if (!seenKeys.has(key)) {
        mergedItems.push(item);
        seenKeys.add(key);
      }
    }

    // Normalize and sort merged items by time key (newest-first)
    function parseTimeKeyToMs(key) {
      if (!key || typeof key !== 'string') return 0;
      const m = key.match(/^(\d{2}):(\d{2})(am|pm)$/i);
      if (!m) return 0;
      let hh = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      const ap = m[3].toLowerCase();
      if (ap === 'pm' && hh !== 12) hh += 12;
      if (ap === 'am' && hh === 12) hh = 0;
      const d = new Date();
      d.setHours(hh, mm, 0, 0);
      return d.getTime();
    }

    // If mergedItems contain valid time keys, sort descending (newest-first)
    try {
      mergedItems.sort((a, b) => {
        const aKey = Object.keys(a)[0];
        const bKey = Object.keys(b)[0];
        return parseTimeKeyToMs(bKey) - parseTimeKeyToMs(aKey);
      });
    } catch (e) {
      // ignore sort errors
    }

    // Partition merged items into chunks of 90
    const CHUNK_SIZE = 90;
    const chunksCount = Math.max(1, Math.ceil(mergedItems.length / CHUNK_SIZE));

    // Build update object that only writes changed chunks
    const updates = {
      updatedAt: serverTimestamp(),
      totalCount: mergedItems.length,
    };

    // existingDocData is already populated above
    for (let c = 0; c < chunksCount; c++) {
      const chunkItems = mergedItems.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
      const existingChunk = (existingDocData && Array.isArray(existingDocData[String(c)]) ? existingDocData[String(c)] : []);
      if (JSON.stringify(existingChunk) !== JSON.stringify(chunkItems)) {
        updates[String(c)] = chunkItems;
      }
    }

    // If existing doc had more chunks than new chunks, clear the extra fields
    if (existingDocData) {
      let idx = 0;
      while (Array.isArray(existingDocData[String(idx)])) idx++;
      const existingChunksCount = idx;
      for (let c = chunksCount; c < existingChunksCount; c++) {
        // delete extra chunk fields
        updates[String(c)] = deleteField();
      }
    }

    // Perform a merge update so only specified fields are modified
    await setDoc(docRef, updates, { merge: true });

    const changedChunkCount = Object.keys(updates).filter((k) => k !== 'updatedAt' && k !== 'totalCount').length;

    console.log(
      `[Firebase] Updated Bio_sic/${dateId}: total ${mergedItems.length} items, updated ${changedChunkCount} chunk(s)`
    );

    return {
      success: true,
      collection: "Bio_sic",
      dateId,
      totalCount: mergedItems.length,
      chunksCount,
      activeIndex: String(chunksCount - 1),
      currentChunkCount: mergedItems.slice(0, CHUNK_SIZE).length,
      latestItems: newItems,
    };
  } catch (err) {
    console.error("[Firebase Error] saveRound failed:", err);
    return {
      success: false,
      error: err.message,
    };
  }
};

/**
 * Fetch all rounds from Firestore "Bio_sic" collection for a date
 */
export const getRoundsFromDB = async (dateStr) => {
  try {
    const dateId = dateStr || getTodayDateId();
    const docRef = doc(db, "Bio_sic", dateId);
    const snap = await getDoc(docRef);

    if (!snap.exists()) {
      return {
        success: true,
        collection: "Bio_sic",
        dateId,
        totalCount: 0,
        indexes: {},
        flatItems: [],
      };
    }

    const docData = snap.data() || {};
    const indexes = {};
    const flatItems = [];

    let idx = 0;
    while (Array.isArray(docData[String(idx)])) {
      const chunk = docData[String(idx)];
      indexes[String(idx)] = chunk;
      for (const item of chunk) {
        const timeKey = Object.keys(item)[0] || "";
        const values = item[timeKey] || [];
        flatItems.push({
          time: timeKey,
          values,
          index: String(idx),
        });
      }
      idx++;
    }

    return {
      success: true,
      collection: "Bio_sic",
      dateId,
      totalCount: flatItems.length,
      indexes,
      flatItems,
    };
  } catch (err) {
    console.error("[Firebase Error] getRoundsFromDB failed:", err);
    return {
      success: false,
      error: err.message,
    };
  }
};

export default {
  saveRound,
  getRoundsFromDB,
  formatTimeKey,
  formatTimeToValuesJSON,
  formatToFourValuesJSON,
  getTodayDateId,
};
