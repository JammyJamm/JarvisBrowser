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
let scrapeInProgress = false;
let scrapeTimer;
const TARGET_IFRAME_URL =
  "https://5ixuqg75.nijsdyfigq.link/frontend/evo/r3/#category=blackjack";
const TARGET_FRAME_KEYWORDS = [
  "5ixuqg75.nijsdyfigq.link",
  "category=blackjack",
  "/frontend/evo/r3/",
  "/frontend/evo/",
];

/* Get the live Evolution game iframe safely. */
async function getGameFrame() {
  if (!page || page.isClosed()) return null;

  for (let attempt = 0; attempt < 8; attempt++) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;

      try {
        const frameUrl = frame.url();
        if (TARGET_FRAME_KEYWORDS.some((kw) => frameUrl.includes(kw))) {
          return frame;
        }

        const targetEl = frame.locator(
          ".i-1wnr, [class*='i-1wnr'], svg[data-role='recent-results'], [data-role='round-history']",
        );
        if (await targetEl.count()) {
          return frame;
        }
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

  const historySelectors = [
    "svg.i-1wnr",
    ".i-1wnr",
    "[class*='i-1wnr']",
    "svg[data-role='recent-results']",
    "[data-role='round-history']",
    "[data-role='recent-results']",
    "svg[data-type='coordinates']",
  ];
  const fallbackHistorySelectors = ["[class*='history']"];

  for (let attempt = 0; attempt < 8; attempt++) {
    const frames = page.frames().filter((frame) => frame !== page.mainFrame());
    const orderedFrames = frames.sort((left, right) => {
      let leftIsTarget = false;
      let rightIsTarget = false;
      try {
        leftIsTarget = TARGET_FRAME_KEYWORDS.some((keyword) =>
          left.url().includes(keyword),
        );
        rightIsTarget = TARGET_FRAME_KEYWORDS.some((keyword) =>
          right.url().includes(keyword),
        );
      } catch {
        // Detached frames are checked and ignored below.
      }
      return Number(rightIsTarget) - Number(leftIsTarget);
    });

    for (const selectors of [historySelectors, fallbackHistorySelectors]) {
      for (const frame of orderedFrames) {
        for (const selector of selectors) {
          try {
            if ((await frame.locator(selector).count()) > 0) return frame;
          } catch {
            // The iframe can be replaced while the game is loading.
            break;
          }
        }
      }
    }

    await page.waitForTimeout(500);
  }

  console.warn(
    "⚠️ No frame exposed a round-history marker:",
    await Promise.all(
      page.frames()
        .filter((frame) => frame !== page.mainFrame())
        .map(async (frame) => {
          const selectorCounts = {};
          for (const selector of historySelectors) {
            try {
              selectorCounts[selector] = await frame.locator(selector).count();
            } catch {
              selectorCounts[selector] = "frame unavailable";
            }
          }
          return { url: frame.url(), selectorCounts };
        }),
    ),
  );
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

async function requestRoundHistory() {
  if (scrapeInProgress) {
    console.warn("⚠️ Previous /round-history request is still running");
    return;
  }

  scrapeInProgress = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    await closeRoundHistoryPopup();
    await clickRoundHistoryPlayButton();
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

    const loginUrl = "https://1-x-bet-india.com/en/user/login";
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
      // Helper to serialize an SVG node and its children into JSON-compatible structure
      function serializeSvg(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
        const attributes = {};
        if (node.attributes) {
          for (let i = 0; i < node.attributes.length; i++) {
            attributes[node.attributes[i].name] = node.attributes[i].value;
          }
        }
        let directText = "";
        for (let i = 0; i < node.childNodes.length; i++) {
          if (node.childNodes[i].nodeType === Node.TEXT_NODE) {
            const t = (node.childNodes[i].textContent || "").trim();
            if (t) directText = directText ? `${directText} ${t}` : t;
          }
        }
        const children = [];
        for (let i = 0; i < node.children.length; i++) {
          const childJson = serializeSvg(node.children[i]);
          if (childJson) children.push(childJson);
        }
        const res = {
          tagName: node.tagName.toLowerCase(),
          attributes: Object.keys(attributes).length ? attributes : undefined,
        };
        if (directText) res.textContent = directText;
        else if (children.length === 0 && (node.textContent || "").trim()) {
          res.textContent = node.textContent.trim();
        }
        if (children.length) res.children = children;
        return res;
      }

      // Check whether element with class i-1wnr exists, or inspect fallback selectors
      const PRIMARY_CLASS = ".i-1wnr";
      const FALLBACK_SELECTORS = [
        "svg.i-1wnr",
        ".i-1wnr",
        "[class*='i-1wnr']",
        "[data-role='recent-results'] .i-1wnr",
        "[data-role='round-history'] .i-1wnr",
        "svg[data-role='recent-results']",
        "[data-role='recent-results']",
        "[data-role='round-history']",
        "[data-role='game-history']",
        "[data-role*='history']",
        "[data-role*='results']",
        "[class*='round-history']",
        "[class*='recent-results']",
        "[class*='history']",
        "[data-type='coordinates']",
        "[aria-label*='history' i]",
      ];

      let targetElement = null;
      let resolvedSelector = null;

      for (const sel of FALLBACK_SELECTORS) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            targetElement = el;
            resolvedSelector = sel;
            break;
          }
        } catch {}
      }

      // Dynamic fallback inspection
      if (!targetElement) {
        const historyCandidates = document.querySelectorAll(
          "[class*='history'], [class*='results'], [data-role*='history'], [data-role*='results']",
        );
        for (const candidate of historyCandidates) {
          if (
            candidate.querySelector("svg") ||
            candidate.tagName.toLowerCase() === "svg"
          ) {
            targetElement = candidate;
            resolvedSelector = candidate.className
              ? `.${candidate.className.trim().split(/\s+/)[0]}`
              : candidate.tagName.toLowerCase();
            break;
          }
        }
      }

      // Requirement 5: Log whether the target element exists
      const targetExists = targetElement !== null;
      console.log(
        `[RoundHistory] Target element exists: ${targetExists} (selector: "${resolvedSelector || PRIMARY_CLASS}")`,
      );

      let extractedSvgsJson = [];
      let rounds = [];
      let coordinateHistory = {
        found: false,
        count: 0,
        results: [],
      };

      if (targetExists) {
        const history =
          document.querySelector("svg.i-1wnr") ||
          targetElement.querySelector("svg.i-1wnr") ||
          targetElement;
        const coordinateCells = [
          ...(history.matches('svg[data-type="coordinates"]') ? [history] : []),
          ...history.querySelectorAll('svg[data-type="coordinates"]'),
        ];
        const coordinateResults = Array.from(
          coordinateCells,
        )
          .map((cell) => {
            const item = cell.querySelector('svg[data-role="roadItem"][name]');
            if (!item) return null;

            const text = item.querySelector("text");
            const path = item.querySelector('[data-role="roadItemColor"] path');
            const markers = Array.from(item.querySelectorAll("circle")).map(
              (circle) => ({
                fill: circle.getAttribute("fill"),
                cx: circle.getAttribute("cx"),
                cy: circle.getAttribute("cy"),
                r: circle.getAttribute("r"),
              }),
            );

            return {
              x: Number(cell.getAttribute("data-x")),
              y: Number(cell.getAttribute("data-y")),
              result: item.getAttribute("name"),
              value: text?.textContent?.trim() ?? null,
              color: path?.getAttribute("fill") ?? null,
              markers,
            };
          })
          .filter(Boolean);
        coordinateHistory = {
          found:
            history.matches('svg[data-type="coordinates"]') ||
            coordinateCells.length > 0,
          count: coordinateResults.length,
          results: coordinateResults,
        };
        console.log(
          "[RoundHistory] Coordinate history:",
          JSON.stringify(coordinateHistory, null, 2),
        );

        // Requirement 3: Find all SVG elements within the relevant round-history element
        const svgs = [];
        if (targetElement.tagName.toLowerCase() === "svg") {
          svgs.push(targetElement);
        } else {
          svgs.push(...targetElement.querySelectorAll("svg"));
        }

        // Requirement 4: Convert each SVG into JSON-compatible data
        extractedSvgsJson = svgs.map((s, idx) => ({
          index: idx,
          selector: resolvedSelector,
          svg: serializeSvg(s),
        }));

        // Requirement 6: Output extracted SVG data using console.log(JSON.stringify(data, null, 2))
        console.log(JSON.stringify(extractedSvgsJson, null, 2));

        // Also extract numerical values for rounds compatibility
        for (const svgEl of svgs) {
          const groups = Array.from(svgEl.querySelectorAll("g")).filter(
            (g) => !g.querySelector("g"),
          );
          const nodes = groups.length > 0 ? groups : [svgEl];
          for (const node of nodes) {
            const values = [];
            const textNodes = Array.from(
              node.querySelectorAll("text, tspan"),
            ).map((n) => n.textContent || "");
            const joinedText = (
              textNodes.length ? textNodes.join(" ") : node.textContent || ""
            ).replace(",", ".");
            const matches = joinedText.match(/-?\d+(?:\.\d+)?/g);
            if (matches) {
              matches.forEach((m) => values.push(Number.parseFloat(m)));
            }
            if (values.length >= 4) {
              rounds.push(values.slice(0, 4));
            } else if (values.length > 0) {
              rounds.push(values);
            }
          }
        }
      } else {
        // Requirement 7: Log clear message when element does not exist
        console.warn(
          `[RoundHistory] Element with class "${PRIMARY_CLASS}" and fallback round-history selectors not found in frame.`,
        );
      }

      return {
        targetExists,
        resolvedSelector,
        frameUrl: location.href,
        extractedSvgsJson,
        coordinateHistory,
        time: new Date().toLocaleTimeString("en-US"),
        rounds,
      };
    });
    console.log(
      `📥 /round-history targetExists: ${svgData.targetExists}, SVGs: ${svgData.extractedSvgsJson?.length || 0}, rounds: ${svgData.rounds?.length || 0}`,
    );
    console.log(
      `📍 /round-history frame: ${svgData.frameUrl}, coordinate cells: ${svgData.coordinateHistory?.count || 0}`,
    );

    const historyRounds =
      svgData && Array.isArray(svgData.rounds) ? svgData.rounds : [];
    if (historyRounds.length === 0) {
      return res.json({
        success: true,
        dateId: getTodayDateId(),
        frameUrl: svgData.frameUrl,
        history: roundHistory,
        parsedSvgRounds: [],
        coordinateHistory: svgData.coordinateHistory,
        duplicate: true,
        saved: false,
        saveResult: null,
      });
    }

    const isInitialHistoryLoad = lastHistorySvgRounds.length === 0;
    const newRounds = getNewRounds(historyRounds, lastHistorySvgRounds);
    const isDuplicate = !isInitialHistoryLoad && newRounds.length === 0;

    const dateId = getTodayDateId();
    const roundsToSave = newRounds.length > 0 ? [newRounds[0]] : [];
    let saveResult = null;
    if (newRounds.length > 0) {
      appendSvgRoundsToHistory(
        new Date().toLocaleDateString("en-GB"),
        newRounds,
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
      "saving rounds:",
      JSON.stringify(roundsToSave),
    );

    res.json({
      success: true,
      dateId,
      frameUrl: svgData.frameUrl,
      history: roundHistory,
      parsedSvgRounds: roundsToSave,
      coordinateHistory: svgData.coordinateHistory,
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
