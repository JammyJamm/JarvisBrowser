import db from "./firebaseConfig.js";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

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
        value && typeof value === "object" ? Object.values(value)[0] : value;
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
  const values = [];
  const addValue = (item, firstObjectValue = false) => {
    if (Array.isArray(item)) {
      item.forEach((value) => addValue(value, true));
      return;
    }

    if (item && typeof item === "object") {
      const objectValues = Object.values(item);
      (firstObjectValue ? objectValues.slice(0, 1) : objectValues).forEach(
        (value) => addValue(value, true),
      );
      return;
    }

    if (
      (typeof item !== "number" && typeof item !== "string") ||
      (typeof item === "string" && item.trim() === "")
    ) {
      return;
    }

    const number = Number(item);
    if (Number.isFinite(number)) values.push(number);
  };

  addValue(round);
  return values;
}

function timeKeyOrder(timeKey) {
  const match = /^(\d{2}):(\d{2}):(\d{2})(am|pm)$/.exec(timeKey);
  if (!match) return -1;

  const [, hourText, minuteText, secondText, suffix] = match;
  const hour = Number(hourText) % 12 + (suffix === "pm" ? 12 : 0);
  return hour * 3600 + Number(minuteText) * 60 + Number(secondText);
}

function latestRoundKey(data) {
  const keys = Object.keys(data)
    .filter((key) => key !== "updatedAt" && Array.isArray(data[key]))
    .sort((left, right) => timeKeyOrder(left) - timeKeyOrder(right));
  return keys[keys.length - 1];
}

/**
 * Replace the active round when its first three values match; empty arrays
 * mark round completion so the next result starts under a new time key.
 */
export const saveRound = async (dateStr, rounds, options = {}) => {
  if (!dateStr) throw new Error("A Firestore date document ID is required.");
  if (!Array.isArray(rounds)) {
    throw new Error("SVG rounds must be supplied as an array.");
  }

  const docRef = doc(db, "Bacart", dateStr);
  const existingSnapshot = await getDoc(docRef);
  const existingData = existingSnapshot.exists() ? existingSnapshot.data() : {};
  const roundsToSave = rounds.length === 0 ? [[]] : rounds;
  const numericRounds = roundsToSave.map((round) => ({
    isCompletionMarker: Array.isArray(round) && round.length === 0,
    values: getRoundValues(round),
  }));
  const validRounds = numericRounds.filter(
    ({ isCompletionMarker, values }) =>
      isCompletionMarker || values.length > 0,
  );

  if (validRounds.length === 0) {
    console.log("[Firebase] No numeric round values to save.");
    return {
      success: true,
      dateId: dateStr,
      savedCount: 0,
      skipped: true,
      timeKeys: [],
    };
  }

  const workingData = { ...existingData };
  const updates = {};
  const timeKeys = [];
  const baseDate =
    options.baseDate instanceof Date ? new Date(options.baseDate) : new Date();
  let savedCount = 0;

  for (const { isCompletionMarker, values } of validRounds) {
    const previousKey = latestRoundKey(workingData);
    const previousValues = previousKey
      ? getRoundValues(workingData[previousKey])
      : [];

    if (isCompletionMarker) {
      if (previousKey && previousValues.length === 0) continue;

      let markerKey = formatTimeKey(baseDate);
      while (Object.prototype.hasOwnProperty.call(workingData, markerKey)) {
        baseDate.setSeconds(baseDate.getSeconds() + 1);
        markerKey = formatTimeKey(baseDate);
      }
      updates[markerKey] = [];
      workingData[markerKey] = [];
      timeKeys.push(markerKey);
      savedCount += 1;
      continue;
    }

    if (
      previousKey &&
      previousValues.length >= 3 &&
      values.length >= 3 &&
      previousValues
        .slice(0, 3)
        .every((value, index) => value === values[index])
    ) {
      updates[previousKey] = values;
      workingData[previousKey] = values;
      timeKeys.push(previousKey);
      savedCount += 1;
      continue;
    }

    let timeKey = formatTimeKey(baseDate);
    while (Object.prototype.hasOwnProperty.call(workingData, timeKey)) {
      baseDate.setSeconds(baseDate.getSeconds() + 1);
      timeKey = formatTimeKey(baseDate);
    }
    updates[timeKey] = values;
    workingData[timeKey] = values;
    timeKeys.push(timeKey);
    savedCount += 1;
  }

  if (savedCount === 0) {
    return {
      success: true,
      dateId: dateStr,
      savedCount: 0,
      skipped: true,
      timeKeys: [],
    };
  }

  updates.updatedAt = serverTimestamp();
  await setDoc(docRef, updates, { merge: true });
  console.log(
    `[Firebase] Saved ${savedCount} round update(s):`,
    JSON.stringify(updates),
  );

  return {
    success: true,
    dateId: dateStr,
    savedCount,
    timeKeys,
  };
};

export const getRounds = async (dateStr) => {
  if (!dateStr) throw new Error("A Firestore date document ID is required.");

  const snapshot = await getDoc(doc(db, "Bacart", dateStr));
  return snapshot.exists() ? snapshot.data() : {};
};

export default { getTodayDateId, saveRound, getRounds };
