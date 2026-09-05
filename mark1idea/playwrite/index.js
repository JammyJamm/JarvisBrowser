import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import { clickPlayButton, getTodayDateId, saveRound } from "./gameservice.js";

const app = express();
app.use(cors({ origin: "http://localhost:3006" }));
app.use(express.json());

/* ---------------- MEMORY ---------------- */
let roundHistory = [];
let recentResults = [];
let svgRoundHistory = [];
let lastParsedSvgRounds = [];
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
let inactivityWatchdog;

/* ✅ Get the live Evolution game iframe */
async function getGameFrame() {
  if (!page || page.isClosed()) return null;

  for (let attempt = 0; attempt < 40; attempt++) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;

      try {
        const gameSvg = frame.locator(
          ".dGBOyn svg[data-role='recent-results']",
        );
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

  for (let attempt = 0; attempt < 40; attempt++) {
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

async function clickPlayButtonIfIdle() {
  const frame = await getGameFrame();
  if (!frame) return false;
  return clickPlayButton(frame);
}

function startInactivityWatchdog() {
  if (inactivityWatchdog) clearInterval(inactivityWatchdog);

  const intervalMs = Number(process.env.PLAY_BUTTON_INTERVAL_MS) || 30000;
  inactivityWatchdog = setInterval(async () => {
    try {
      await clickPlayButtonIfIdle();
    } catch (error) {
      console.error("❌ Inactivity watchdog error:", error.message);
    }
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
        lastParsedSvgRounds = [];
        lastHistorySvgRounds = [];
        console.log("🔁 Page refreshed; SVG round tracking reset");
      }
    });

  /* Bridge iframe → Node */
  await page.exposeFunction("__pushRound", ({ date, time, value }) => {
    let day = roundHistory.find((d) => d[date]);
    if (!day) {
      day = { [date]: [] };
      roundHistory.unshift(day);
    }

    day[date].push({ [time]: value });

    if (day[date].length > 200) day[date].shift();
  });

    const loginUrl = "https://1xlite-12947.pro/en/user/login";
    let lastError;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(loginUrl, {
          timeout: 60000,
          waitUntil: "domcontentloaded",
        });
        startInactivityWatchdog();
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

/* ---------------- START OBSERVER ---------------- */
app.post("/click-button", async (req, res) => {
  try {
    const frame = await getGameFrame();
    if (!frame) {
      return res.json({ success: false, error: "Iframe not ready" });
    }

    const playButtonSelector =
      'button[data-role="play-button"], [data-role="play-button"]';
    let playButtonClicked = false;

    for (const candidateFrame of [frame, page.mainFrame()]) {
      const buttons = candidateFrame.locator(playButtonSelector);
      const buttonCount = await buttons.count();
      for (let index = 0; index < buttonCount; index++) {
        const button = buttons.nth(index);
        const label = (await button.innerText().catch(() => "")).trim();
        if (
          await button.isVisible() &&
          (/^(PLAY|START|CONTINUE)$/i.test(label) || !label)
        ) {
          await button.click({ force: true });
          playButtonClicked = true;
          break;
        }
      }
      if (playButtonClicked) break;
    }

    console.log(
      playButtonClicked
        ? "▶️ Play button clicked before SVG scrape"
        : "⚠️ Play button not available; scraping current SVG",
    );
    await frame.waitForTimeout(playButtonClicked ? 1000 : 100);

    const svgData = await frame.evaluate(() => {
      const container = document.querySelector(".dGBOyn");
      const svg = container?.querySelector("svg[data-role='recent-results']");
      if (!container || !svg) {
        return {
          time: new Date().toLocaleTimeString("en-US"),
          rawSvg: null,
          rounds: [],
        };
      }

      const rounds = [];
      const groups = svg.querySelectorAll("g._0IWvcd");

      for (const group of groups) {
        const values = [];
        const childSvgs = Array.from(group.querySelectorAll("svg")).filter(
          (candidate) => !candidate.querySelector("svg"),
        );

        for (const childSvg of childSvgs) {
          const source = Array.from(childSvg.querySelectorAll("text"))
            .map((text) => text.textContent || "")
            .join(" ")
            .replace(",", ".");
          const match = source.match(/-?\d+(?:\.\d+)?/);
          if (match) {
            const value = Number.parseFloat(match[0]);
            if (Number.isFinite(value)) values.push(value);
          }
        }

        if (values.length >= 4) {
          rounds.push(values.slice(0, 4));
        }
      }

      return {
        time: new Date().toLocaleTimeString("en-US"),
        rawSvg: container.outerHTML.slice(0, 2000),
        rounds,
      };
    });
    const safeSvgData = svgData && typeof svgData === "object" ? svgData : {};
    const parsedRounds = Array.isArray(safeSvgData.rounds)
      ? safeSvgData.rounds
      : [];
    recentResults = parsedRounds.at(-1) || [];
    console.log("📄 SVG data preview:", safeSvgData.rawSvg || "SVG not found");
    console.log(
      `📊 Parsed SVG rounds (${parsedRounds.length}):`,
      JSON.stringify(parsedRounds),
    );

    const isInitialSvgLoad = lastParsedSvgRounds.length === 0;
    let newSvgRounds = [];
    if (isInitialSvgLoad) {
      newSvgRounds = parsedRounds;
    } else {
      newSvgRounds = getNewRounds(parsedRounds, lastParsedSvgRounds);
    }
    lastParsedSvgRounds = parsedRounds;

    const newResults = newSvgRounds.map((round, index) => ({
      [`${safeSvgData.time || new Date().toLocaleTimeString("en-US")}-${index}`]: round.map((value, valueIndex) => ({
        [valueIndex]: value,
      })),
    }));
    console.log("📊 New SVG round JSON:", JSON.stringify(newResults));

    if (newResults.length > 0) {
      svgRoundHistory.push(...newResults);
      if (svgRoundHistory.length > 200) {
        svgRoundHistory.splice(0, svgRoundHistory.length - 200);
      }
    }

    let saved = false;
    const saveResults = [];
    const dateId = getTodayDateId();

    if (isInitialSvgLoad && parsedRounds.length > 0) {
      const initialSave = await saveRound(dateId, parsedRounds, {
        baseDate: new Date(Date.now() - 60000),
      });
      saveResults.push(initialSave);
      saved = initialSave.success;
    }

    if (!isInitialSvgLoad && newSvgRounds.length > 0) {
      const newSave = await saveRound(dateId, newSvgRounds, {
        baseDate: new Date(),
      });
      saveResults.push(newSave);
      saved = newSave.success;
    }

    const started = await frame.evaluate(async () => {
      function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
      }

      /* 🔎 WAIT FOR PAYOUT CONTAINER */
      let container = null;
      for (let i = 0; i < 60; i++) {
        container =
          document.querySelector(".payouts-block") ||
          document.querySelector('[class*="payouts"]') ||
          document.querySelector('[class*="payout"]');

        if (container) break;
        await sleep(500);
      }

      if (!container) return false;

      if (window.__observerStarted) return true;
      window.__observerStarted = true;

      let lastValue = null;

      function extractValue(el) {
        const txt = el?.textContent?.replace("x", "").trim();
        const num = parseFloat(txt);
        return isNaN(num) ? null : num;
      }

      function pushIfNew(val) {
        if (val === null || val === lastValue) return;
        lastValue = val;

        const now = new Date();
        window.__pushRound({
          date: now.toLocaleDateString("en-GB"),
          time: now.toLocaleTimeString("en-US"),
          value: val,
        });
      }

      /* 🟢 CAPTURE LAST EXISTING PAYOUT */
      const existing = container.querySelectorAll('[class*="payout"]');
      if (existing.length) {
        pushIfNew(extractValue(existing[existing.length - 1]));
      }

      /* 👀 OBSERVE DOM CHANGES */
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === "childList") {
            for (const node of m.addedNodes) {
              const v = extractValue(node);
              if (v !== null) {
                pushIfNew(v);
                return;
              }
            }
          }

          if (m.type === "characterData") {
            const v = extractValue(m.target.parentElement);
            if (v !== null) {
              pushIfNew(v);
              return;
            }
          }
        }
      });

      observer.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      console.log("✅ Aviator observer started");
      return true;
    });

    res.json({
      success: true,
      parsedSvgRounds: svgData.rounds,
      newSvgRounds: newResults,
      saved,
      saveResults,
      observerStarted: started,
    });
  } catch (err) {
    console.error("❌ click-button error:", err);
    res.json({ success: false, error: err.message });
  }
});

/* ---------------- BET CLICK ---------------- */

app.post("/bet-click", async (req, res) => {
  try {
    const frame = await getGameFrame();

    if (!frame) {
      return res.json({ success: false, error: "Iframe not found" });
    }

    const buttons = frame.locator("button.btn-success");

    // wait until at least one button exists
    await buttons.first().waitFor({ state: "visible", timeout: 15000 });

    // 👉 click FIRST button
    await buttons.first().click({ force: true });

    // small delay (important for game UI)
    await frame.waitForTimeout(300);

    // 👉 click LAST button
    await buttons.last().click({ force: true });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ bet-click error:", err);
    res.json({ success: false, error: err.message });
  }
});

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

    await clickPlayButton(gameFrame);
    await page.waitForTimeout(500);

    const frame = await getGameFrameWithSvg();
    if (!frame) {
      console.warn("⚠️ /round-history: recent-results SVG not ready");
      return res.status(503).json({
        success: false,
        error: "Game history SVG is not ready. Open the game and try again.",
      });
    }

    const svgData = await frame.evaluate(() => {
      const container = document.querySelector(".dGBOyn");
      const svg = container?.querySelector("svg[data-role='recent-results']");
      const rounds = [];

      if (svg) {
        for (const group of svg.querySelectorAll("g._0IWvcd")) {
          const values = [];
          const childSvgs = Array.from(group.querySelectorAll("svg")).filter(
            (candidate) => !candidate.querySelector("svg"),
          );

          for (const childSvg of childSvgs) {
            const text = Array.from(childSvg.querySelectorAll("text"))
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
});

process.on("unhandledRejection", console.error);
