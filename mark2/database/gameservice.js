// database/gameservice.js
// Agent Task & Session Persistence Service with 4-Values & Time-Keyed Storage Support

export function formatTimeKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12 || 12;
  const formattedHours = String(hours).padStart(2, "0");
  return `${formattedHours}:${minutes}${ampm}`;
}

export function getTodayDateId(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Split concatenated numbers above 19 (e.g. 155 -> [15, 5], 31 -> [3, 1], 185 -> [18, 5])
 */
export function splitNumberIfAbove19(n) {
  if (typeof n !== "number" || isNaN(n)) return [];
  if (n <= 19) return [n];

  const s = String(n);
  if (s.length === 2) {
    return [parseInt(s[0], 10), parseInt(s[1], 10)];
  }

  if (s.length === 3) {
    const firstTwo = parseInt(s.slice(0, 2), 10);
    if (firstTwo <= 19) {
      return [firstTwo, parseInt(s.slice(2), 10)];
    }
    return [parseInt(s[0], 10), parseInt(s.slice(1), 10)];
  }

  return [n];
}

/**
 * Clean a 4-value set ensuring values are within valid ranges
 * [0] <= 19, [1],[2],[3] > 0 and <= 19
 */
export function cleanFourValues(chunk = []) {
  if (!Array.isArray(chunk)) return [0, 1, 1, 1];

  let raw = [];
  for (const item of chunk) {
    if (typeof item === "number" && item > 19) {
      raw.push(...splitNumberIfAbove19(item));
    } else {
      raw.push(item);
    }
  }

  // Ensure 4 items
  while (raw.length < 4) raw.push(1);
  let [v0, v1, v2, v3] = raw.slice(0, 4);

  if (v0 > 19) {
    const split = splitNumberIfAbove19(v0);
    v0 = split[0] || 0;
  }

  // Ensure positions 1, 2, 3 are not 0 and <= 19
  if (!v1 || v1 === 0 || v1 > 19) v1 = raw[4] || (v0 > 0 && v0 <= 19 ? v0 : 1);
  if (!v2 || v2 === 0 || v2 > 19) v2 = raw[5] || 1;
  if (!v3 || v3 === 0 || v3 > 19) v3 = raw[6] || 1;

  return [v0, v1, v2, v3];
}

/**
 * Format string or array of numbers to time-keyed JSON items
 */
export function formatTimeToValuesJSON(rawInput, baseDate = new Date()) {
  const nums = [];
  if (typeof rawInput === "string") {
    const tokens = rawInput.trim().split(/\s+/).filter(Boolean);
    for (const t of tokens) {
      const n = parseInt(t, 10);
      if (!isNaN(n)) {
        if (n > 19) {
          nums.push(...splitNumberIfAbove19(n));
        } else {
          nums.push(n);
        }
      }
    }
  } else if (Array.isArray(rawInput)) {
    for (const item of rawInput) {
      if (typeof item === "number") {
        if (item > 19) nums.push(...splitNumberIfAbove19(item));
        else nums.push(item);
      }
    }
  }

  const results = [];
  const startTime = baseDate instanceof Date ? baseDate.getTime() : new Date(baseDate).getTime();

  for (let i = 0; i < nums.length; i += 4) {
    const chunk = nums.slice(i, i + 4);
    if (chunk.length < 4) {
      while (chunk.length < 4) chunk.push(1);
    }
    const cleaned = cleanFourValues(chunk);
    const date = new Date(startTime + results.length * 60000);
    const timeKey = formatTimeKey(date);
    results.push({ [timeKey]: cleaned });
  }

  return results;
}

/**
 * Format raw numbers to 4-Values JSON with chunks of up to 90 items
 */
export function formatToFourValuesJSON(rawInput) {
  const nums = [];
  let text = "";
  if (typeof rawInput === "string") {
    text = rawInput;
  } else if (rawInput && typeof rawInput === "object") {
    if (typeof rawInput.text === "string") text = rawInput.text;
    else if (typeof rawInput.raw === "string") text = rawInput.raw;
    else if (typeof rawInput.content === "string") text = rawInput.content;
    else if (Array.isArray(rawInput)) {
      nums.push(...rawInput.filter((n) => typeof n === "number"));
    }
  }

  if (text) {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    for (const t of tokens) {
      const n = parseInt(t, 10);
      if (!isNaN(n)) nums.push(n);
    }
  }

  const sets = [];
  for (let i = 0; i < nums.length; i += 4) {
    const chunk = nums.slice(i, i + 4);
    if (chunk.length === 4) {
      sets.push({ values: chunk });
    }
  }

  if (sets.length === 0) return [];

  // Group into chunks of 90 items keyed by index ("0", "1", ...)
  const chunks = [];
  const chunkSize = 90;
  for (let i = 0; i < sets.length; i += chunkSize) {
    const chunkIndex = String(Math.floor(i / chunkSize));
    chunks.push({
      [chunkIndex]: sets.slice(i, i + chunkSize),
    });
  }

  return chunks;
}

// In-memory fallback cache for test runs when Firestore is offline
const inMemoryRounds = new Map();

export const saveRound = async (dateStr, items = [], options = {}) => {
  const chunkSize = 90;
  const chunks = {};
  const totalCount = items.length;

  for (let i = 0; i < items.length; i += chunkSize) {
    const idx = String(Math.floor(i / chunkSize));
    chunks[idx] = items.slice(i, i + chunkSize);
  }

  const chunksCount = Object.keys(chunks).length;
  const activeIndex = String(Math.max(0, chunksCount - 1));

  try {
    const { default: db, doc, setDoc } = await import("./firebaseConfig.js");
    const roundDoc = doc(db, "Bio_sic", dateStr);
    await setDoc(roundDoc, {
      updatedAt: new Date().toISOString(),
      totalCount,
      ...chunks,
    }, { merge: true });

    inMemoryRounds.set(dateStr, { totalCount, chunks });
    return { success: true, totalCount, chunksCount, activeIndex };
  } catch (err) {
    // Graceful offline fallback
    inMemoryRounds.set(dateStr, { totalCount, chunks });
    return { success: true, totalCount, chunksCount, activeIndex, offline: true };
  }
};

export const getRoundsFromDB = async (dateStr) => {
  try {
    const { default: db, doc, getDoc } = await import("./firebaseConfig.js");
    const roundDoc = doc(db, "Bio_sic", dateStr);
    const snap = await getDoc(roundDoc);
    if (snap.exists()) {
      const data = snap.data();
      const indexes = {};
      let total = 0;
      for (const k of Object.keys(data)) {
        if (/^\d+$/.test(k) && Array.isArray(data[k])) {
          indexes[k] = data[k];
          total += data[k].length;
        }
      }
      return { success: true, totalCount: total || data.totalCount || 0, indexes };
    }
  } catch (err) {}

  if (inMemoryRounds.has(dateStr)) {
    const cached = inMemoryRounds.get(dateStr);
    return { success: true, totalCount: cached.totalCount, indexes: cached.chunks };
  }

  return { success: false, items: [], totalCount: 0 };
};
