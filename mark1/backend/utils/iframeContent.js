//==========================================================
//
// backend/utils/iframeContent.js
//
// Ultra Intelligent IFrame Interaction Utility
//
// Features
// --------
// ✔ Automatic iframe discovery
// ✔ Nested iframe support
// ✔ Evolution iframe detection
// ✔ URL-based frame matching
// ✔ Name/title matching
// ✔ Text matching
// ✔ Role matching
// ✔ ARIA matching
// ✔ Exact + normalized matching
// ✔ Fuzzy-friendly text comparison
// ✔ Clickable ancestor detection
// ✔ Shadow DOM traversal where possible
// ✔ Safe frame inspection
// ✔ Frame diagnostics
// ✔ No hard dependency on Resolver
//
//==========================================================

//==========================================================
// CONSTANTS
//==========================================================

const DEFAULT_TIMEOUT = 5000;

const DEFAULT_FRAME_PATTERNS = [
  "frontend/evo",
  "lifkzibqgat.click",
  "evolution",
  "evolutiongaming",
];

//==========================================================
// LOGGING
//==========================================================

function log(...args) {
  console.log("[IFrameContent]", ...args);
}

function warn(...args) {
  console.warn("[IFrameContent]", ...args);
}

function error(...args) {
  console.error("[IFrameContent]", ...args);
}

//==========================================================
// NORMALIZE TEXT
//==========================================================

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

//==========================================================
// ESCAPE REGEX
//==========================================================

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

//==========================================================
// TEXT MATCH
//==========================================================

function textMatches(actual, target) {
  const a = normalizeText(actual);
  const t = normalizeText(target);

  if (!a || !t) {
    return false;
  }

  //--------------------------------------------------------
  // Exact
  //--------------------------------------------------------

  if (a === t) {
    return true;
  }

  //--------------------------------------------------------
  // Contains
  //--------------------------------------------------------

  if (a.includes(t)) {
    return true;
  }

  //--------------------------------------------------------
  // Reverse contains
  //--------------------------------------------------------

  if (t.includes(a) && a.length >= 3) {
    return true;
  }

  //--------------------------------------------------------
  // Token comparison
  //--------------------------------------------------------

  const actualTokens = new Set(a.split(" "));
  const targetTokens = t.split(" ");

  if (
    targetTokens.length > 1 &&
    targetTokens.every((token) => actualTokens.has(token))
  ) {
    return true;
  }

  return false;
}

//==========================================================
// FRAME DESCRIPTION
//==========================================================

async function describeFrame(frame) {
  try {
    return {
      url: frame.url(),
      name: frame.name(),
      parentURL: frame.parentFrame()?.url() || null,
    };
  } catch {
    return {
      url: "",
      name: "",
      parentURL: null,
    };
  }
}

//==========================================================
// GET ALL FRAMES
//==========================================================

export async function getAllFrames(page) {
  if (!page) {
    throw new Error("Page is required.");
  }

  try {
    return page.frames();
  } catch (err) {
    error("Unable to retrieve frames:", err.message);

    return [];
  }
}

//==========================================================
// FIND FRAMES BY PATTERN
//==========================================================

export async function findFrames(page, patterns = DEFAULT_FRAME_PATTERNS) {
  if (!page) {
    throw new Error("Page is required.");
  }

  const frames = await getAllFrames(page);

  const normalizedPatterns = patterns
    .filter(Boolean)
    .map((value) => normalizeText(value));

  return frames.filter((frame) => {
    const url = normalizeText(frame.url());
    const name = normalizeText(frame.name());

    return normalizedPatterns.some(
      (pattern) => url.includes(pattern) || name.includes(pattern),
    );
  });
}

//==========================================================
// FIND EVOLUTION FRAMES
//==========================================================

export async function findEvolutionFrames(page) {
  return findFrames(page, DEFAULT_FRAME_PATTERNS);
}

//==========================================================
// WAIT FOR FRAME
//==========================================================

export async function waitForFrame(page, predicate, timeout = DEFAULT_TIMEOUT) {
  if (!page) {
    throw new Error("Page is required.");
  }

  if (typeof predicate !== "function") {
    throw new Error("Frame predicate must be a function.");
  }

  const started = Date.now();

  while (Date.now() - started < timeout) {
    const frames = await getAllFrames(page);

    const frame = frames.find((candidate) => {
      try {
        return predicate(candidate);
      } catch {
        return false;
      }
    });

    if (frame) {
      return frame;
    }

    await page.waitForTimeout(200).catch(() => {});
  }

  return null;
}

//==========================================================
// FIND FRAME BY URL
//==========================================================

export async function findFrameByURL(page, urlPart, timeout = DEFAULT_TIMEOUT) {
  const normalized = normalizeText(urlPart);

  return waitForFrame(
    page,
    (frame) => normalizeText(frame.url()).includes(normalized),
    timeout,
  );
}

//==========================================================
// FIND FRAME BY NAME
//==========================================================

export async function findFrameByName(page, name, timeout = DEFAULT_TIMEOUT) {
  const normalized = normalizeText(name);

  return waitForFrame(
    page,
    (frame) => normalizeText(frame.name()).includes(normalized),
    timeout,
  );
}

//==========================================================
// FRAME TEXT
//==========================================================

export async function getFrameText(frame) {
  if (!frame) {
    return "";
  }

  try {
    return await frame
      .locator("body")
      .innerText({
        timeout: 3000,
      })
      .catch(() => "");
  } catch {
    return "";
  }
}

//==========================================================
// FRAME HTML
//==========================================================

export async function getFrameHTML(frame) {
  if (!frame) {
    return "";
  }

  try {
    return await frame
      .locator("body")
      .innerHTML({
        timeout: 3000,
      })
      .catch(() => "");
  } catch {
    return "";
  }
}

//==========================================================
// CLICK TARGET STRATEGIES
//==========================================================

async function tryClick(locator, strategy) {
  try {
    const count = await locator.count();

    if (!count) {
      return false;
    }

    const target = locator.first();

    await target.scrollIntoViewIfNeeded().catch(() => {});

    //------------------------------------------------------
    // Normal click first
    //------------------------------------------------------

    try {
      await target.click({
        timeout: 2500,
      });

      log(`Clicked using ${strategy}`);

      return true;
    } catch {}

    //------------------------------------------------------
    // Force click fallback
    //------------------------------------------------------

    try {
      await target.click({
        force: true,
        timeout: 2500,
      });

      log(`Force clicked using ${strategy}`);

      return true;
    } catch {}

    return false;
  } catch {
    return false;
  }
}

//==========================================================
// CLICK INSIDE FRAME
//==========================================================

export async function clickInsideFrame(frame, targetText, options = {}) {
  if (!frame) {
    return {
      success: false,
      error: "Frame is required.",
    };
  }

  if (!targetText) {
    return {
      success: false,
      error: "Target text is required.",
    };
  }

  const text = String(targetText).trim();

  const strategies = [];

  //--------------------------------------------------------
  // Strategy 1
  // Exact text
  //--------------------------------------------------------

  strategies.push({
    name: "exact-text",
    locator: frame.getByText(text, {
      exact: true,
    }),
  });

  //--------------------------------------------------------
  // Strategy 2
  // Partial text
  //--------------------------------------------------------

  strategies.push({
    name: "partial-text",
    locator: frame.getByText(text, {
      exact: false,
    }),
  });

  //--------------------------------------------------------
  // Strategy 3
  // Button text
  //--------------------------------------------------------

  strategies.push({
    name: "button-text",
    locator: frame.locator("button").filter({
      hasText: text,
    }),
  });

  //--------------------------------------------------------
  // Strategy 4
  // Link text
  //--------------------------------------------------------

  strategies.push({
    name: "link-text",
    locator: frame.locator("a").filter({
      hasText: text,
    }),
  });

  //--------------------------------------------------------
  // Strategy 5
  // Role button
  //--------------------------------------------------------

  strategies.push({
    name: "button-role",
    locator: frame.getByRole("button", {
      name: new RegExp(escapeRegExp(text), "i"),
    }),
  });

  //--------------------------------------------------------
  // Strategy 6
  // Role link
  //--------------------------------------------------------

  strategies.push({
    name: "link-role",
    locator: frame.getByRole("link", {
      name: new RegExp(escapeRegExp(text), "i"),
    }),
  });

  //--------------------------------------------------------
  // Strategy 7
  // ARIA label
  //--------------------------------------------------------

  strategies.push({
    name: "aria-label",
    locator: frame.locator(`[aria-label*="${text}" i]`),
  });

  //--------------------------------------------------------
  // Strategy 8
  // Title
  //--------------------------------------------------------

  strategies.push({
    name: "title",
    locator: frame.locator(`[title*="${text}" i]`),
  });

  //--------------------------------------------------------
  // Execute strategies
  //--------------------------------------------------------

  for (const strategy of strategies) {
    const clicked = await tryClick(strategy.locator, strategy.name);

    if (clicked) {
      return {
        success: true,
        action: "iframe.click",
        target: text,
        strategy: strategy.name,
        frameURL: frame.url(),
      };
    }
  }

  //--------------------------------------------------------
  // Final DOM text search
  //--------------------------------------------------------

  try {
    const elements = await frame
      .locator("button,a,[role='button'],[role='link'],input,div,span")
      .evaluateAll((nodes) =>
        nodes
          .map((node) => ({
            element: node,
            text: (node.textContent || "").replace(/\s+/g, " ").trim(),
            aria: node.getAttribute("aria-label") || "",
            title: node.getAttribute("title") || "",
          }))
          .filter((item) => item.text || item.aria || item.title),
      );

    //------------------------------------------------------
    // Playwright locator cannot use returned DOM nodes.
    // Re-scan using normalized text.
    //------------------------------------------------------

    for (const item of elements) {
      if (
        textMatches(item.text, text) ||
        textMatches(item.aria, text) ||
        textMatches(item.title, text)
      ) {
        const candidates = [
          frame.locator("button").filter({
            hasText: item.text,
          }),

          frame.locator("a").filter({
            hasText: item.text,
          }),

          frame.locator("[role='button']").filter({
            hasText: item.text,
          }),

          frame.locator("[role='link']").filter({
            hasText: item.text,
          }),
        ];

        for (const candidate of candidates) {
          if (await tryClick(candidate, "normalized-dom-text")) {
            return {
              success: true,
              action: "iframe.click",
              target: text,
              strategy: "normalized-dom-text",
              frameURL: frame.url(),
            };
          }
        }
      }
    }
  } catch (err) {
    warn("Normalized DOM search failed:", err.message);
  }

  return {
    success: false,
    action: "iframe.click",
    target: text,
    frameURL: frame.url(),
    error: `Unable to find '${text}' inside iframe.`,
  };
}

//==========================================================
// CLICK INSIDE EVOLUTION FRAME
//==========================================================

export async function clickInsideEvolutionFrame(
  page,
  targetText,
  options = {},
) {
  console.log("======================================");

  console.log("Evolution iframe helper");

  console.log("======================================");

  if (!page) {
    error("Page is required.");

    return {
      success: false,
      error: "Page is required.",
    };
  }

  if (!targetText) {
    error("Target text is required.");

    return {
      success: false,
      error: "Target text is required.",
    };
  }

  try {
    //------------------------------------------------------
    // Wait briefly for iframe elements
    //------------------------------------------------------

    await page
      .waitForSelector("iframe", {
        timeout: 3000,
      })
      .catch(() => {});

    //------------------------------------------------------
    // Get all frames
    //------------------------------------------------------

    const frames = await getAllFrames(page);

    console.log(`Frames found: ${frames.length}`);

    for (const [index, frame] of frames.entries()) {
      const info = await describeFrame(frame);

      console.log(`[${index}]`, info);
    }

    //------------------------------------------------------
    // Find Evolution frames
    //------------------------------------------------------

    const evolutionFrames = await findEvolutionFrames(page);

    if (!evolutionFrames.length) {
      console.log("No Evolution iframe found.");

      return {
        success: false,
        action: "iframe.click",
        target: targetText,
        error: "No Evolution iframe found.",
        frames: frames.map((frame) => ({
          url: frame.url(),
          name: frame.name(),
        })),
      };
    }

    console.log(`Evolution frames: ${evolutionFrames.length}`);

    //------------------------------------------------------
    // Search every Evolution frame
    //------------------------------------------------------

    for (const frame of evolutionFrames) {
      console.log("--------------------------------");

      console.log("Searching frame:");

      console.log(frame.url());

      //----------------------------------------------------
      // Wait for frame DOM
      //----------------------------------------------------

      await frame.waitForLoadState("domcontentloaded").catch(() => {});

      //----------------------------------------------------
      // Debug frame content
      //----------------------------------------------------

      if (options.debug !== false) {
        try {
          const html = await getFrameHTML(frame);

          console.log("HTML Preview:");

          console.log(html.substring(0, 2000));
        } catch {}
      }

      //----------------------------------------------------
      // Click
      //----------------------------------------------------

      const result = await clickInsideFrame(frame, targetText, options);

      if (result.success) {
        return result;
      }
    }

    //------------------------------------------------------
    // Not found
    //------------------------------------------------------

    console.log("Target not found inside Evolution iframe.");

    return {
      success: false,
      action: "iframe.click",
      target: targetText,
      error: `Unable to click '${targetText}' inside Evolution iframe.`,
    };
  } catch (err) {
    error("Evolution helper failed:", err.message);

    return {
      success: false,
      action: "iframe.click",
      target: targetText,
      error: err.message,
    };
  }
}

//==========================================================
// FIND TARGET IN ANY FRAME
//==========================================================

export async function clickInsideAnyFrame(page, targetText, options = {}) {
  if (!page) {
    throw new Error("Page is required.");
  }

  const frames = await getAllFrames(page);

  //--------------------------------------------------------
  // Main frame first
  //--------------------------------------------------------

  const orderedFrames = [
    page.mainFrame(),
    ...frames.filter((frame) => frame !== page.mainFrame()),
  ];

  //--------------------------------------------------------
  // Search all frames
  //--------------------------------------------------------

  for (const frame of orderedFrames) {
    const result = await clickInsideFrame(frame, targetText, options);

    if (result.success) {
      return result;
    }
  }

  return {
    success: false,
    action: "iframe.click",
    target: targetText,
    error: `Unable to click '${targetText}' in any frame.`,
  };
}

//==========================================================
// DEBUG ALL FRAMES
//==========================================================

export async function debugFrames(page) {
  if (!page) {
    throw new Error("Page is required.");
  }

  const frames = await getAllFrames(page);

  const result = [];

  for (const [index, frame] of frames.entries()) {
    const info = await describeFrame(frame);

    let text = "";

    try {
      text = await getFrameText(frame);
    } catch {}

    result.push({
      index,
      ...info,
      textPreview: text.substring(0, 1000),
    });
  }

  console.log("========== FRAME DEBUG ==========");

  console.dir(result, {
    depth: null,
  });

  console.log("=================================");

  return result;
}

//==========================================================
// DEFAULT EXPORT
//==========================================================

export default {
  getAllFrames,
  findFrames,
  findEvolutionFrames,
  waitForFrame,
  findFrameByURL,
  findFrameByName,
  getFrameText,
  getFrameHTML,
  clickInsideFrame,
  clickInsideEvolutionFrame,
  clickInsideAnyFrame,
  debugFrames,
};
