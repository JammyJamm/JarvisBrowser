import db from "./firebaseConfig.js";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

export async function clickPlayButton(frame) {
  if (!frame) return false;

  const playButtons = frame.locator(
    'button[data-role="play-button"], [data-role="play-button"]',
  );
  const buttonCount = await playButtons.count();

  for (let index = 0; index < buttonCount; index += 1) {
    const button = playButtons.nth(index);
    if (await button.isVisible()) {
      await button.click({ force: true });
      console.log("▶️ Play button clicked");
      return true;
    }
  }

  return false;
}

function formatTimeKey(date) {
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const suffix = hours >= 12 ? "pm" : "am";
  hours = hours % 12 || 12;
  return `${String(hours).padStart(2, "0")}:${minutes}:${seconds}${suffix}`;
}

export function getTodayDateId(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeRound(round) {
  if (Array.isArray(round)) {
    return round.map((value, index) => {
      const normalizedValue =
        value && typeof value === "object"
          ? Object.values(value)[0]
          : value;
      return { [index]: normalizedValue };
    });
  }

  if (round && typeof round === "object") {
    const values = Object.values(round);
    if (values.length === 1 && Array.isArray(values[0])) {
      return values[0].map((value, index) => ({ [index]: value }));
    }

    return Object.entries(round).map(([index, value]) => ({
      [index]: value,
    }));
  }

  throw new Error("Each SVG round must be an array or object.");
}

export function getRoundValues(round) {
  if (!Array.isArray(round)) {
    return normalizeRound(round).map((item) => Number(Object.values(item)[0]));
  }

  return round
    .map((item) => {
      if (item && typeof item === "object") {
        const [value] = Object.values(item);
        return Number(value);
      }
      return Number(item);
    })
    .filter((value) => Number.isFinite(value));
}

function roundKey(round) {
  return JSON.stringify(
    getRoundValues(round).map((value) =>
      Number.isInteger(value) ? value : Number(value.toFixed(6)),
    ),
  );
}

/**
 * Save each parsed SVG round under its own time key.
 * The final round is saved at baseDate; earlier rounds use earlier minutes.
 */
export const saveRound = async (dateStr, rounds, options = {}) => {
  if (!dateStr) throw new Error("A Firestore date document ID is required.");
  if (!Array.isArray(rounds) || rounds.length === 0) {
    throw new Error("No SVG rounds supplied.");
  }

  const docRef = doc(db, "Bio_sic", dateStr);
  const existingSnapshot = await getDoc(docRef);
  const existingData = existingSnapshot.exists() ? existingSnapshot.data() : {};
  const previousRounds = new Set(
    Object.values(existingData)
      .filter((value) => Array.isArray(value))
      .map((value) => {
        try {
          return normalizeRound(value);
        } catch {
          return null;
        }
      })
      .filter((value) => value && getRoundValues(value).length === 4)
      .map(roundKey),
  );
  const uniqueRounds = [];

  for (const round of rounds) {
    const normalizedRound = normalizeRound(round);
    const values = getRoundValues(normalizedRound);
    if (values.length !== 4) {
      console.warn(
        `[Firebase] Skipping invalid SVG round: ${JSON.stringify(values)}`,
      );
      continue;
    }

    const key = roundKey(normalizedRound);
    const duplicate = previousRounds.has(key);
    console.log(
      `[Firebase] Round ${JSON.stringify(getRoundValues(normalizedRound))} duplicate: ${duplicate}`,
    );

    if (!duplicate) {
      uniqueRounds.push(normalizedRound);
      previousRounds.add(key);
    }
  }

  if (uniqueRounds.length === 0) {
    console.log("[Firebase] Duplicate SVG rounds skipped.");
    return {
      success: true,
      dateId: dateStr,
      savedCount: 0,
      skipped: true,
      timeKeys: [],
    };
  }

  const baseDate =
    options.baseDate instanceof Date ? options.baseDate : new Date();
  const updates = {
    updatedAt: serverTimestamp(),
  };

  const existingTimeKeys = new Set(
    Object.keys(existingData).filter((key) => key !== "updatedAt"),
  );
  uniqueRounds.forEach((round, index) => {
    const roundTime = new Date(
      baseDate.getTime() - (uniqueRounds.length - 1 - index) * 1000,
    );
    let timeKey = formatTimeKey(roundTime);
    while (existingTimeKeys.has(timeKey) || updates[timeKey]) {
      roundTime.setSeconds(roundTime.getSeconds() + 1);
      timeKey = formatTimeKey(roundTime);
    }
    updates[timeKey] = round;
  });

  await setDoc(docRef, updates, { merge: true });
  console.log(
    `[Firebase] Saved ${uniqueRounds.length} SVG round(s):`,
    JSON.stringify(updates, (_, value) =>
      value?.constructor?.name === "FieldValue" ? undefined : value,
    ),
  );

  return {
    success: true,
    dateId: dateStr,
    savedCount: uniqueRounds.length,
    timeKeys: Object.keys(updates).filter((key) => key !== "updatedAt"),
  };
};

export const getRounds = async (dateStr) => {
  if (!dateStr) throw new Error("A Firestore date document ID is required.");

  const snapshot = await getDoc(doc(db, "Bio_sic", dateStr));
  return snapshot.exists() ? snapshot.data() : {};
};

export default { getTodayDateId, saveRound, getRounds, clickPlayButton };
