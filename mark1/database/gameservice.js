// database/gameservice.js
import db from "./firebaseConfig.js";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
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

  let numbers = [];

  // 1. If it's already in the target format: [{ "04:20pm": [15, 5, 5, 5] }, ...]
  if (Array.isArray(rawInput) && rawInput.length && typeof rawInput[0] === "object") {
    const firstObj = rawInput[0];
    const firstKey = Object.keys(firstObj)[0];
    if (firstKey && /^\d{2}:\d{2}(?:am|pm)$/i.test(firstKey) && Array.isArray(firstObj[firstKey])) {
      return rawInput;
    }
  }

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

  // 3. Chunk numbers into 4 values each with incrementing timestamps
  const items = [];
  const baseTime = (baseDate instanceof Date ? baseDate : new Date()).getTime();

  for (let i = 0; i < numbers.length; i += 4) {
    const chunk = numbers.slice(i, i + 4);
    if (chunk.length > 0) {
      // Pad chunk to 4 numbers if incomplete
      while (chunk.length < 4) {
        chunk.push(0);
      }
      const setDate = new Date(baseTime + (i / 4) * 60000);
      const timeKey = formatTimeKey(setDate);
      items.push({ [timeKey]: chunk });
    }
  }

  return items;
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

    const newItems = formatTimeToValuesJSON(rawInput);
    if (!newItems || !newItems.length) {
      throw new Error("No 4-value time items extracted from input.");
    }

    const docRef = doc(db, "Bio_sic", dateId);
    let existingAllItems = [];

    // Fetch existing document to merge items
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const docData = snap.data() || {};
        let idx = 0;
        while (Array.isArray(docData[String(idx)])) {
          existingAllItems.push(...docData[String(idx)]);
          idx++;
        }
      }
    } catch (readErr) {
      console.warn("[Firebase] Could not fetch existing doc, creating new:", readErr.message);
    }

    // Merge: Append new items without duplicating the exact last item
    const mergedItems = [...existingAllItems];
    for (const item of newItems) {
      const itemKey = Object.keys(item)[0];
      const itemVal = JSON.stringify(item[itemKey]);

      const isDuplicateLast =
        mergedItems.length > 0 &&
        Object.keys(mergedItems[mergedItems.length - 1])[0] === itemKey &&
        JSON.stringify(mergedItems[mergedItems.length - 1][itemKey]) === itemVal;

      if (!isDuplicateLast) {
        mergedItems.push(item);
      }
    }

    // Partition all items into chunks of 90
    const CHUNK_SIZE = 90;
    const indexedPayload = {
      updatedAt: serverTimestamp(),
      totalCount: mergedItems.length,
    };

    const chunksCount = Math.max(1, Math.ceil(mergedItems.length / CHUNK_SIZE));
    for (let c = 0; c < chunksCount; c++) {
      const chunkItems = mergedItems.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
      indexedPayload[String(c)] = chunkItems;
    }

    await setDoc(docRef, indexedPayload, { merge: true });
    console.log(
      `[Firebase] Saved to Bio_sic/${dateId}: total ${mergedItems.length} items across ${chunksCount} index(es) (90 per index)`
    );

    return {
      success: true,
      collection: "Bio_sic",
      dateId,
      totalCount: mergedItems.length,
      chunksCount,
      activeIndex: String(chunksCount - 1),
      currentChunkCount: indexedPayload[String(chunksCount - 1)]?.length || 0,
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
