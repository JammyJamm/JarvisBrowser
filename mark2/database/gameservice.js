// database/gameservice.js
// Agent Task & Session Persistence Service
// (Legacy Bio_sic & 4-values casino logic removed per user specification)

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

// Stubs for clean compatibility
export function splitNumberIfAbove19(n) {
  return typeof n === "number" ? [n] : [];
}

export function cleanFourValues(chunk) {
  return Array.isArray(chunk) ? chunk : [];
}

export function formatTimeToValuesJSON(rawInput) {
  return [];
}

export function formatToFourValuesJSON(rawInput) {
  return [];
}

export const saveRound = async (dateStr, rawInput, options = {}) => {
  return { success: true, message: "Legacy saveRound retired", itemsCount: 0 };
};

export const getRoundsFromDB = async (dateStr) => {
  return { success: true, items: [], totalCount: 0 };
};
