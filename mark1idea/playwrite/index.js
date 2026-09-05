import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import { getTodayDateId, saveRound } from "./gameservice.js";

const app = express();
app.use(cors({ origin: "http://localhost:3006" }));
app.use(express.json());

/* ---------------- MEMORY ---------------- */
let roundHistory = [];
let lastHistorySvgRounds = [];

function sameRound(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getNewRounds(rounds, previousRounds) {
  if (!Array.isArray(rounds) || rounds.length === 0) return [];
  if (!Array.isArray(previousRounds) || previousRounds.length === 0) {
    return rounds;
  }

  // Ignore a transient partial SVG, then return only rounds after the
  // largest overlap between the previous and current snapshots.
  if (
    rounds.length <= previousRounds.length &&
    rounds.every((round, index) => sameRound(round, previousRounds[index]))
  ) {
    return [];
  }

  const maxOverlap = Math.min(rounds.length, previousRounds.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const previousSuffix = previousRounds.slice(-overlap);
    const currentPrefix = rounds.slice(0, overlap);
    if (
      previousSuffix.every((round, index) =>
        sameRound(round, currentPrefix[index]),
      )
    ) {
      return rounds.slice(overlap);
    }
  }

  return rounds;
}

function appendSvgRoundsToHistory(date, rounds, baseDate = new Date()) {
  if (!date || !Array.isArray(rounds) || rounds.length === 0) return;

  let day = roundHistory.find((entry) => entry[date]);
  if (!day) {
    day = { [date]: [] };
    roundHistory.unshift(day);
  }

  const values = rounds.flatMap((round) =>
    Array.isArray(round) ? round : [],
  );
  values.forEach((value, index) => {
    const timestamp = new Date(
      baseDate.getTime() - (values.length - index - 1) * 1000,
    );
    day[date].push({
      [timestamp.toLocaleTimeString("en-US")]: value,
    });
  });

  if (day[date].length > 200) {
    day[date].splice(0, day[date].length - 200);
  }
}

/* ---------------- PLAYWRIGHT ---------------- */
let browser;
let page;
let scrapeInProgress = false;
let scrapeTimer;
/* Get the live Evolution game iframe. */
async function getGameFrame() {
  if (!page || page.isClosed()) return null;

  for (let attempt = 0; attempt < 8; attempt++) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;

      try {
        const gameSvg = frame.locator("svg[data-role='recent-results']");
        if (await gameSvg.count()) {
          return frame;
        }

        if (frame.url().includes("/frontend/evo/")) return frame;
      } catch {
        // The iframe can be replaced while the page is refreshing.
      }
    }

    await page.waitForTimeout(500);
  }

  return null;
}

async function getGameFrameWithSvg() {
  if (!page || page.isClosed()) return null;

  for (let attempt = 0; attempt < 8; attempt++) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;

      try {
        const svg = frame.locator("svg[data-role='recent-results']");
        if (await svg.count()) return frame;
      } catch {
        // The iframe can be replaced while the game is loading.
      }
    }

    await page.waitForTimeout(500);
  }

  return null;
}

async function requestRoundHistory() {
  if (scrapeInProgress) {
    console.warn("⚠️ Previous /round-history request is still running");
    return;
  }

  scrapeInProgress = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    console.log("📡 Calling /round-history");
    const response = await fetch(`http://127.0.0.1:${PORT}/round-history`, {
      signal: controller.signal,
    });
    console.log(`📡 /round-history response: HTTP ${response.status}`);
    if (!response.ok) {
      console.warn(`⚠️ Automatic scrape returned HTTP ${response.status}`);
    }
  } catch (error) {
    console.error("❌ Automatic scrape request failed:", error.message);
  } finally {
    clearTimeout(timeout);
    scrapeInProgress = false;
  }
}

function startAutomaticScraping() {
  if (scrapeTimer) return;
  const intervalMs = Number(process.env.SCRAPE_INTERVAL_MS) || 5000;
  console.log(`🔄 Automatic SVG scraping enabled every ${intervalMs}ms`);
  setTimeout(requestRoundHistory, 1000);
  scrapeTimer = setInterval(() => {
    console.log("⏱️ Scrape interval tick");
    void requestRoundHistory();
  }, intervalMs);
}

/* ---------------- LAUNCH BROWSER ---------------- */
(async () => {
  try {
    browser = await chromium.launch({ headless: false });
    page = await browser.newPage();
    page.setDefaultTimeout(0);
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        roundHistory = [];
        lastHistorySvgRounds = [];
        console.log("🔁 Page refreshed; SVG round tracking reset");
      }
    });

    const loginUrl = "https://1xlite-12947.pro/en/user/login";
    let lastError;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(loginUrl, {
          timeout: 60000,
          waitUntil: "domcontentloaded",
        });
        console.log("🌐 Login manually → open Aviator game");
        return;
      } catch (error) {
        lastError = error;
        console.error(
          `⚠️ Login page navigation failed (attempt ${attempt}/3): ${error.message}`,
        );
        if (attempt < 3) await page.waitForTimeout(3000);
      }
    }

    throw lastError;
  } catch (error) {
    console.error("❌ Browser startup failed:", error);
  }
})();

/* ---------------- HISTORY ---------------- */
app.get("/round-history", async (req, res) => {
  try {
    console.log("📥 /round-history requested");
    const gameFrame = await getGameFrame();
    if (!gameFrame) {
      console.warn("⚠️ /round-history: game iframe not ready");
      return res.status(503).json({
        success: false,
        error: "Game iframe is not ready. Open the game and try again.",
      });
    }

    const frame = await getGameFrameWithSvg();
    if (!frame) {
      console.warn("⚠️ /round-history: recent-results SVG not ready");
      return res.status(503).json({
        success: false,
        error: "Game history SVG is not ready. Open the game and try again.",
      });
    }

    const svgData = await frame.evaluate(() => {
      const svg = document.querySelector("svg[data-role='recent-results']");
      const rounds = [];

      if (svg) {
        const groups = Array.from(svg.querySelectorAll("g")).filter(
          (group) => !group.querySelector("g"),
        );

        for (const group of groups) {
          const values = [];
          const childSvgs = Array.from(group.querySelectorAll("svg")).filter(
            (candidate) => !candidate.querySelector("svg"),
          );
          const valueNodes = childSvgs.length > 0 ? childSvgs : [group];

          for (const valueNode of valueNodes) {
            const text = Array.from(valueNode.querySelectorAll("text"))
              .map((node) => node.textContent || "")
              .join(" ")
              .replace(",", ".");
            const match = text.match(/-?\d+(?:\.\d+)?/);
            if (match) values.push(Number.parseFloat(match[0]));
          }

          if (values.length >= 4) rounds.push(values.slice(0, 4));
        }
      }

      return {
        time: new Date().toLocaleTimeString("en-US"),
        rounds,
      };
    });
    console.log(
      `📥 /round-history scraped ${svgData.rounds?.length || 0} round(s)`,
    );

    const historyRounds =
      svgData && Array.isArray(svgData.rounds) ? svgData.rounds : [];
    if (historyRounds.length === 0) {
      return res.json({
        success: true,
        dateId: getTodayDateId(),
        history: roundHistory,
        parsedSvgRounds: [],
        duplicate: true,
        saved: false,
        saveResult: null,
      });
    }

    const isInitialHistoryLoad = lastHistorySvgRounds.length === 0;
    const newRounds = getNewRounds(historyRounds, lastHistorySvgRounds);
    const isDuplicate = !isInitialHistoryLoad && newRounds.length === 0;
    lastHistorySvgRounds = historyRounds;

    const dateId = getTodayDateId();
    let saveResult = null;
    const roundsToSave = newRounds.slice(0, 2);
    if (newRounds.length > 0) {
      appendSvgRoundsToHistory(
        new Date().toLocaleDateString("en-GB"),
        roundsToSave,
      );
      saveResult = await saveRound(dateId, roundsToSave, {
        baseDate: new Date(Date.now() - 60000),
      });
      console.log(
        "💾 /round-history Firestore save:",
        JSON.stringify(saveResult),
      );
    }
    console.log(
      "📚 /round-history new SVG rounds:",
      JSON.stringify(newRounds),
      "saving rounds:",
      JSON.stringify(roundsToSave),
    );

    res.json({
      success: true,
      dateId,
      history: roundHistory,
      parsedSvgRounds: roundsToSave,
      scrapedSvgRounds: newRounds,
      duplicate: isDuplicate,
      saved: saveResult?.success === true,
      saveResult,
    });
  } catch (err) {
    console.error("❌ round-history error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ---------------- SERVER ---------------- */
const PORT = process.env.PORT || 9000;
app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
  startAutomaticScraping();
});

process.on("unhandledRejection", console.error);
