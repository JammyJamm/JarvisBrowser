import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import { getRoundValues, getTodayDateId, saveRound } from "./gameservice.js";

const app = express();
app.use(cors({ origin: "http://localhost:3006" }));
app.use(express.json());

/* ---------------- MEMORY ---------------- */
let roundHistory = [];
let lastHistorySvgRounds = [];
let zeroValueLatched = false;
let zeroWatcherTimer;

function sameRound(left, right) {
  try {
    return (
      JSON.stringify(getRoundValues(left)) ===
      JSON.stringify(getRoundValues(right))
    );
  } catch {
    return false;
  }
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

  const values = rounds.flatMap((round) => (Array.isArray(round) ? round : []));
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
/* Get the live Evolution game iframe. */
async function getGameFrame() {
  if (!page || page.isClosed()) return null;

  for (let attempt = 0; attempt < 8; attempt++) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;

      try {
        const historyData = frame.locator(
          "svg[data-role='recent-results'], .da8JNm .Q-Uv7b",
        );
        if (await historyData.count()) {
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

async function getGameFrameWithHistory() {
  if (!page || page.isClosed()) return null;

  for (let attempt = 0; attempt < 8; attempt++) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;

      try {
        const historyData = frame.locator(
          "svg[data-role='recent-results'], .da8JNm .Q-Uv7b",
        );
        if (await historyData.count()) return frame;
      } catch {
        // The iframe can be replaced while the game is loading.
      }
    }

    await page.waitForTimeout(500);
  }

  return null;
}

async function closeRoundHistoryPopup() {
  if (!page || page.isClosed()) return false;

  for (const frame of page.frames()) {
    try {
      const closeButton = frame.getByRole("button", {
        name: "CLOSE",
        exact: true,
      });

      if ((await closeButton.count()) === 0) continue;
      const button = closeButton.first();
      if (!(await button.isVisible({ timeout: 500 }))) continue;

      await button.scrollIntoViewIfNeeded({ timeout: 1000 });
      try {
        await button.click({ timeout: 2000 });
      } catch {
        // Popup animations can keep the button unstable; force the user-facing
        // button click, then use the DOM event only as a final fallback.
        try {
          await button.click({ timeout: 1000, force: true });
        } catch {
          await button.evaluate((element) => element.click());
        }
      }
      console.log("🖱️ Closed round-history popup");
      return true;
    } catch (error) {
      console.warn(
        `⚠️ Unable to close round-history popup in frame: ${error.message}`,
      );
    }
  }

  return false;
}

async function clickRoundHistoryPlayButton() {
  if (!page || page.isClosed()) return false;

  for (const frame of page.frames()) {
    try {
      const playButton = frame
        .locator("button[data-role='play-button']")
        .first();
      if ((await playButton.count()) === 0) continue;
      if (!(await playButton.isVisible({ timeout: 500 }))) continue;

      await playButton.scrollIntoViewIfNeeded({ timeout: 1000 });
      try {
        await playButton.click({ timeout: 2000 });
      } catch {
        try {
          await playButton.click({ timeout: 1000, force: true });
        } catch {
          await playButton.evaluate((element) => element.click());
        }
      }
      console.log("🖱️ Clicked round-history play button");
      return true;
    } catch (error) {
      console.warn(
        `⚠️ Unable to click round-history play button in frame: ${error.message}`,
      );
    }
  }

  return false;
}

async function watchForZeroValue() {
  if (!page || page.isClosed()) return;

  try {
    const frame = await getGameFrameWithHistory();
    if (frame) {
      const hasZeroValue = await frame.evaluate(() => {
        const parseValue = (text) => {
          const match = (text || "")
            .replace(",", ".")
            .match(/-?\d+(?:\.\d+)?\s*([KMB])?/i);
          if (!match) return null;
          const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[
            (match[1] || "").toUpperCase()
          ];
          return Number.parseFloat(match[0]) * (multiplier || 1);
        };

        return Array.from(document.querySelectorAll(".Q-Uv7b")).some(
          (node) => parseValue(node.textContent) === 0,
        );
      });

      if (hasZeroValue && !zeroValueLatched) {
        zeroValueLatched = true;
        console.log(
          "🎯 Zero value detected; capturing complete round history in 3 seconds",
        );
        setTimeout(async () => {
          try {
            const response = await fetch(
              `http://127.0.0.1:${PORT}/round-history?capture=zero`,
            );
            console.log(
              `🎯 Zero-value capture response: HTTP ${response.status}`,
            );
          } catch (error) {
            console.warn(
              "⚠️ Delayed zero-value capture failed:",
              error.message,
            );
          }
        }, 9000);
      } else if (!hasZeroValue) {
        zeroValueLatched = false;
      }
    }
  } catch (error) {
    console.warn("⚠️ Zero-value watcher failed:", error.message);
  } finally {
    zeroWatcherTimer = setTimeout(() => {
      void watchForZeroValue();
    }, 500);
  }
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
        zeroValueLatched = false;
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
        void watchForZeroValue();
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

    const frame = await getGameFrameWithHistory();
    if (!frame) {
      console.warn("⚠️ /round-history: game history data not ready");
      return res.status(503).json({
        success: false,
        error: "Game history data is not ready. Open the game and try again.",
      });
    }

    const svgData = await frame.evaluate(() => {
      const parseDisplayedValue = (text) => {
        const normalizedText = text.replace(",", ".");
        const match = normalizedText.match(
          /(-?\d+(?:\.\d+)?)\s*([KMB])?\s*\+?/i,
        );
        if (!match) return null;

        const value = Number.parseFloat(match[1]);
        const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[
          (match[2] || "").toUpperCase()
        ];
        const expandedValue = value * (multiplier || 1);
        return Number.isFinite(expandedValue) ? expandedValue : null;
      };

      const svg = document.querySelector("svg[data-role='recent-results']");
      const rounds = [];
      const roundHasK = [];
      const zeroValueDetails = [];

      if (svg) {
        const groups = Array.from(svg.querySelectorAll("g")).filter(
          (group) => !group.querySelector("g"),
        );

        for (const group of groups) {
          const values = [];
          let hasK = false;
          const childSvgs = Array.from(group.querySelectorAll("svg")).filter(
            (candidate) => !candidate.querySelector("svg"),
          );
          const valueNodes = childSvgs.length > 0 ? childSvgs : [group];

          for (const valueNode of valueNodes) {
            const text = Array.from(valueNode.querySelectorAll("text"))
              .map((node) => node.textContent || "")
              .join(" ");
            if (/\d\s*k(?:\+)?\b/i.test(text)) hasK = true;
            const value = parseDisplayedValue(text);
            if (value !== null) values.push(value);
          }

          if (values.length >= 4) {
            rounds.push(values.slice(0, 4));
            roundHasK.push(hasK);
          }
        }
      }

      const shouldAddDomRounds = rounds.length === 0;
      {
        const parseValues = (nodes) =>
          Array.from(nodes)
            .map((node) => {
              return parseDisplayedValue(node.textContent || "");
            })
            .filter((value) => Number.isFinite(value));

        const historyParents = Array.from(
          document.querySelectorAll(".da8JNm, .BmAAie"),
        );
        for (const parent of historyParents) {
          const valueNodes = parent.querySelectorAll(".Q-Uv7b");
          const hasK = Array.from(valueNodes).some((node) =>
            /\d\s*k(?:\+)?\b/i.test(node.textContent || ""),
          );
          const values = parseValues(
            valueNodes.length > 0 ? valueNodes : [parent],
          );
          if (shouldAddDomRounds && values.length >= 4) {
            rounds.push(values.slice(0, 4));
            roundHasK.push(hasK);
          }

          if (values.some((value) => value === 0)) {
            zeroValueDetails.push({
              containerText: parent.textContent?.trim() || "",
              containerHtml: parent.outerHTML,
              values,
              nodes: Array.from(valueNodes).map((node) => ({
                text: node.textContent?.trim() || "",
                value: parseDisplayedValue(node.textContent || ""),
                html: node.outerHTML,
              })),
            });
          }
        }

        if (shouldAddDomRounds && rounds.length === 0) {
          const valueNodes = document.querySelectorAll(".Q-Uv7b");
          const values = parseValues(valueNodes);
          if (values.length >= 4) {
            rounds.push(values.slice(0, 4));
            roundHasK.push(
              Array.from(valueNodes).some((node) =>
                /\d\s*k(?:\+)?\b/i.test(node.textContent || ""),
              ),
            );
          }
          if (values.some((value) => value === 0)) {
            zeroValueDetails.push({
              containerText: document.body.textContent?.trim() || "",
              containerHtml: document.body.innerHTML,
              values,
              nodes: Array.from(valueNodes).map((node) => ({
                text: node.textContent?.trim() || "",
                value: parseDisplayedValue(node.textContent || ""),
                html: node.outerHTML,
              })),
            });
          }
        }
      }

      return {
        time: new Date().toLocaleTimeString("en-US"),
        rounds,
        roundHasK,
        zeroValueDetails,
      };
    });
    console.log(
      `📥 /round-history scraped ${svgData.rounds?.length || 0} round(s)`,
    );
    svgData.rounds?.forEach((round, index) => {
      console.log(
        `🔤 Round ${index + 1} contains "k": ${svgData.roundHasK?.[index] === true}`,
        round,
      );
    });

    const historyRounds =
      svgData && Array.isArray(svgData.rounds) ? svgData.rounds : [];
    if (historyRounds.length === 0) {
      return res.json({
        success: true,
        dateId: getTodayDateId(),
        history: roundHistory,
        parsedSvgRounds: [],
        zeroValueDetails: svgData.zeroValueDetails || [],
        duplicate: true,
        saved: false,
        saveResult: null,
      });
    }

    const isInitialHistoryLoad = lastHistorySvgRounds.length === 0;
    const newRounds = getNewRounds(historyRounds, lastHistorySvgRounds);
    const isDuplicate = !isInitialHistoryLoad && newRounds.length === 0;

    const dateId = getTodayDateId();
    const captureAllRounds = req.query.capture === "zero";
    const roundsToSave = captureAllRounds
      ? historyRounds
      : newRounds.length > 0
        ? [newRounds[0]]
        : [];
    let saveResult = null;
    if (roundsToSave.length > 0) {
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
    lastHistorySvgRounds = historyRounds;
    console.log(
      "📚 /round-history new SVG rounds:",
      JSON.stringify(newRounds),
      captureAllRounds ? "capturing all rounds:" : "saving rounds:",
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
      zeroValueDetails: svgData.zeroValueDetails || [],
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
