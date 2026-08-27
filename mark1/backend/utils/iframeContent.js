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
// GET SVG DATA FROM FRAME
//==========================================================

export async function getFrameSVGs(frame, options = {}) {
  if (!frame) {
    return [];
  }

  try {
    const rawOptions = {
      selector: options.selector || "svg",
      parentClass: options.parentClass || options.containerClass || undefined,
      container:
        options.container ||
        options.parentSelector ||
        options.containerSelector ||
        undefined,
      limit: typeof options.limit === "number" ? options.limit : 100,
      includeHTML: options.includeHTML !== false,
      includePaths: options.includePaths !== false,
      includeShapes: options.includeShapes !== false,
      includeText: options.includeText !== false,
      includeBBox: options.includeBBox !== false,
      includeAttributes: options.includeAttributes !== false,
      onlyVisible: Boolean(options.onlyVisible),
      filter: options.filter ? String(options.filter).toLowerCase() : null,
    };

    const svgs = await frame.evaluate((opts) => {
      const selector = opts.selector || "svg";
      const containerQuery = opts.parentClass || opts.container || "";
      const limit = typeof opts.limit === "number" ? opts.limit : 100;
      const includeHTML = opts.includeHTML !== false;
      const includePaths = opts.includePaths !== false;
      const includeShapes = opts.includeShapes !== false;
      const includeText = opts.includeText !== false;
      const includeBBox = opts.includeBBox !== false;
      const includeAttributes = opts.includeAttributes !== false;
      const onlyVisible = Boolean(opts.onlyVisible);
      const filter = opts.filter ? String(opts.filter).toLowerCase() : null;

      function findRoots(query) {
        if (!query) return [document];
        const qStr = String(query).trim();
        const roots = [];
        try {
          const direct = document.querySelectorAll(qStr);
          if (direct.length) roots.push(...direct);
        } catch {}
        if (
          !qStr.startsWith(".") &&
          !qStr.startsWith("#") &&
          !qStr.startsWith("[")
        ) {
          try {
            const byClass = document.querySelectorAll(
              `.${qStr}, [class~="${qStr}"], [class*="${qStr}"]`,
            );
            for (const el of byClass) {
              if (!roots.includes(el)) roots.push(el);
            }
          } catch {}
        }
        return roots.length ? roots : [document];
      }

      const roots = findRoots(containerQuery);
      const elements = [];

      for (const root of roots) {
        let matched = [];
        try {
          matched = Array.from(root.querySelectorAll(selector));
        } catch {}

        // If selector was a class name or custom selector that isn't literal "svg"
        if (
          !matched.length &&
          selector !== "svg" &&
          !selector.startsWith(".") &&
          !selector.startsWith("#") &&
          !selector.startsWith("[")
        ) {
          try {
            const byClass = Array.from(
              root.querySelectorAll(
                `.${selector}, [class~="${selector}"], [class*="${selector}"]`,
              ),
            );
            matched.push(...byClass);
          } catch {}
        }

        // If root itself is not document, it might be the target container (e.g. .dGBOyn)
        if (root !== document && !matched.length) {
          if (root.tagName.toLowerCase() === "svg") {
            matched.push(root);
          } else {
            const innerSVGs = root.querySelectorAll("svg");
            for (const s of innerSVGs) {
              if (!matched.includes(s)) matched.push(s);
            }
          }
        }

        for (const el of matched) {
          if (el.tagName.toLowerCase() === "svg") {
            if (!elements.includes(el)) elements.push(el);
          } else if (el.tagName.toLowerCase() === "path") {
            const parentSvg = el.closest("svg");
            if (parentSvg && !elements.includes(parentSvg)) {
              elements.push(parentSvg);
            }
          } else {
            // Container matched (e.g. .dGBOyn) -> extract all SVGs inside it!
            const childSVGs = el.querySelectorAll("svg");
            for (const s of childSVGs) {
              if (!elements.includes(s)) elements.push(s);
            }
          }
        }
      }

      const results = [];

      for (let i = 0; i < elements.length && results.length < limit; i++) {
        const el = elements[i];
        const rect = el.getBoundingClientRect();
        let isVisible = false;
        try {
          const style = window.getComputedStyle(el);
          isVisible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0";
        } catch {
          isVisible = rect.width > 0 && rect.height > 0;
        }

        if (onlyVisible && !isVisible) {
          continue;
        }

        // Attributes
        const attributes = {};
        if (includeAttributes && el.attributes) {
          for (let a = 0; a < el.attributes.length; a++) {
            const attr = el.attributes[a];
            attributes[attr.name] = attr.value;
          }
        }

        // Text content
        const texts = [];
        let directText = "";
        if (includeText) {
          const textNodes = el.querySelectorAll("text, tspan, title, desc");
          for (let t = 0; t < textNodes.length; t++) {
            const node = textNodes[t];
            const str = (node.textContent || "").trim();
            if (str) {
              texts.push({
                tagName: node.tagName.toLowerCase(),
                text: str,
                x: node.getAttribute("x") || undefined,
                y: node.getAttribute("y") || undefined,
                fill: node.getAttribute("fill") || undefined,
                fontSize: node.getAttribute("font-size") || undefined,
              });
            }
          }
          directText = (el.textContent || "").replace(/\s+/g, " ").trim();
        }

        // Paths
        const paths = [];
        if (includePaths) {
          const pathNodes = el.querySelectorAll("path");
          for (let p = 0; p < pathNodes.length; p++) {
            const pathEl = pathNodes[p];
            const d = pathEl.getAttribute("d") || "";
            paths.push({
              index: p,
              d,
              fill: pathEl.getAttribute("fill") || pathEl.style?.fill || undefined,
              stroke: pathEl.getAttribute("stroke") || pathEl.style?.stroke || undefined,
              strokeWidth: pathEl.getAttribute("stroke-width") || pathEl.style?.strokeWidth || undefined,
              id: pathEl.id || undefined,
              className: pathEl.getAttribute("class") || undefined,
              transform: pathEl.getAttribute("transform") || undefined,
              ariaLabel: pathEl.getAttribute("aria-label") || undefined,
            });
          }
        }

        // Shapes
        const shapes = [];
        if (includeShapes) {
          const shapeNodes = el.querySelectorAll("circle, rect, ellipse, polygon, polyline, line");
          for (let s = 0; s < shapeNodes.length; s++) {
            const shapeEl = shapeNodes[s];
            const tag = shapeEl.tagName.toLowerCase();
            const shapeData = {
              tagName: tag,
              id: shapeEl.id || undefined,
              className: shapeEl.getAttribute("class") || undefined,
              fill: shapeEl.getAttribute("fill") || shapeEl.style?.fill || undefined,
              stroke: shapeEl.getAttribute("stroke") || shapeEl.style?.stroke || undefined,
              transform: shapeEl.getAttribute("transform") || undefined,
            };

            if (tag === "circle") {
              shapeData.cx = shapeEl.getAttribute("cx");
              shapeData.cy = shapeEl.getAttribute("cy");
              shapeData.r = shapeEl.getAttribute("r");
            } else if (tag === "rect") {
              shapeData.x = shapeEl.getAttribute("x");
              shapeData.y = shapeEl.getAttribute("y");
              shapeData.width = shapeEl.getAttribute("width");
              shapeData.height = shapeEl.getAttribute("height");
              shapeData.rx = shapeEl.getAttribute("rx") || undefined;
              shapeData.ry = shapeEl.getAttribute("ry") || undefined;
            } else if (tag === "ellipse") {
              shapeData.cx = shapeEl.getAttribute("cx");
              shapeData.cy = shapeEl.getAttribute("cy");
              shapeData.rx = shapeEl.getAttribute("rx");
              shapeData.ry = shapeEl.getAttribute("ry");
            } else if (tag === "polygon" || tag === "polyline") {
              shapeData.points = shapeEl.getAttribute("points");
            } else if (tag === "line") {
              shapeData.x1 = shapeEl.getAttribute("x1");
              shapeData.y1 = shapeEl.getAttribute("y1");
              shapeData.x2 = shapeEl.getAttribute("x2");
              shapeData.y2 = shapeEl.getAttribute("y2");
            }
            shapes.push(shapeData);
          }
        }

        // Groups & Transforms (crucial for rotating wheels / dynamic graphics)
        const groups = [];
        const dynamicTransforms = [];
        const groupNodes = el.querySelectorAll("g");
        for (let g = 0; g < groupNodes.length; g++) {
          const gEl = groupNodes[g];
          const tr = gEl.getAttribute("transform") || gEl.style?.transform || "";
          if (tr) dynamicTransforms.push(tr);
          if (tr || gEl.id || gEl.getAttribute("class") || gEl.getAttribute("aria-label")) {
            groups.push({
              index: g,
              id: gEl.id || undefined,
              className: gEl.getAttribute("class") || undefined,
              transform: tr || undefined,
              ariaLabel: gEl.getAttribute("aria-label") || undefined,
              childElementCount: gEl.childElementCount,
            });
          }
        }

        // SVG-level transform
        const rootTransform = el.getAttribute("transform") || el.style?.transform || "";
        if (rootTransform) dynamicTransforms.push(rootTransform);

        // Extract dynamic numbers (scores, multipliers, roulette numbers, timer values)
        const allTextJoined = [directText, ...texts.map((t) => t.text)].join(" ");
        const extractedNumbers = (allTextJoined.match(/-?\d+(?:\.\d+)?(?:x|%|\$|€|£)?/g) || [])
          .map((n) => n.trim())
          .filter((v, idx, arr) => arr.indexOf(v) === idx);

        // Parse rotation angle from transforms if available
        let rotationAngle = undefined;
        for (const tr of dynamicTransforms) {
          const rotMatch = tr.match(/rotate\(\s*(-?\d+(?:\.\d+)?)/i);
          if (rotMatch) {
            rotationAngle = parseFloat(rotMatch[1]);
            break;
          }
          const matrixMatch = tr.match(/matrix\(\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/i);
          if (matrixMatch) {
            const a = parseFloat(matrixMatch[1]);
            const b = parseFloat(matrixMatch[2]);
            rotationAngle = Math.round(Math.atan2(b, a) * (180 / Math.PI) * 100) / 100;
            break;
          }
        }

        // Filter check
        if (filter) {
          const matchTarget = [
            directText,
            el.id,
            el.getAttribute("class"),
            el.getAttribute("aria-label"),
            el.getAttribute("role"),
            ...texts.map((t) => t.text),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          if (!matchTarget.includes(filter)) {
            continue;
          }
        }

        const item = {
          index: i,
          id: el.id || undefined,
          className: el.getAttribute("class") || undefined,
          ariaLabel: el.getAttribute("aria-label") || undefined,
          role: el.getAttribute("role") || undefined,
          viewBox: el.getAttribute("viewBox") || undefined,
          width: el.getAttribute("width") || Math.round(rect.width) || undefined,
          height: el.getAttribute("height") || Math.round(rect.height) || undefined,
          transform: rootTransform || undefined,
          isVisible,
          childElementCount: el.childElementCount,
          timestamp: new Date().toISOString(),
        };

        if (includeBBox) {
          item.boundingBox = {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
          };
        }

        if (includeAttributes) {
          item.attributes = attributes;
        }

        if (includeText) {
          item.text = directText;
          if (texts.length) item.texts = texts;
        }

        if (includePaths) {
          item.pathCount = paths.length;
          item.paths = paths;
        }

        if (includeShapes) {
          item.shapeCount = shapes.length;
          item.shapes = shapes;
        }

        if (groups.length) {
          item.groupCount = groups.length;
          item.groups = groups;
        }

        // Dynamic SVG values summary
        item.dynamicValues = {
          numbers: extractedNumbers,
          rotationAngle,
          transforms: dynamicTransforms.length ? dynamicTransforms : undefined,
          summary: directText || (texts.length ? texts.map((t) => t.text).join(", ") : undefined),
        };

        if (includeHTML) {
          item.outerHTML = el.outerHTML;
        }

        results.push(item);
      }

      return results;
    }, rawOptions);

    return svgs || [];
  } catch (err) {
    warn("Failed to get SVGs from frame:", err.message);
    return [];
  }
}

//==========================================================
// GET ALL SVGS FROM ALL FRAMES
//==========================================================

export async function getAllSVGsFromFrames(page, options = {}) {
  if (!page) {
    throw new Error("Page is required.");
  }

  const frames = await getAllFrames(page);
  const mainFrame = page.mainFrame();
  const results = [];

  for (const [index, frame] of frames.entries()) {
    if (options.onlyIframes && frame === mainFrame) {
      continue;
    }

    const info = await describeFrame(frame);
    const svgs = await getFrameSVGs(frame, options);

    results.push({
      frameIndex: index,
      frameUrl: info.url,
      frameName: info.name,
      parentURL: info.parentURL,
      isMainFrame: frame === mainFrame,
      svgCount: svgs.length,
      svgs,
    });
  }

  return results;
}

//==========================================================
// GET SVG DATA SPECIFICALLY FROM IFRAME
//==========================================================

export async function getSVGDataFromIframe(page, options = {}) {
  if (!page) {
    throw new Error("Page is required.");
  }

  try {
    const allFrames = await getAllFrames(page);
    const mainFrame = page.mainFrame();

    let targetFrames = allFrames;

    // Filter by iframe-only (default true unless explicitly false)
    if (options.onlyIframes !== false && allFrames.length > 1) {
      targetFrames = allFrames.filter((f) => f !== mainFrame);
    }

    // Target frame by URL
    if (options.frameUrl) {
      const urlPattern = normalizeText(options.frameUrl);
      const matched = targetFrames.filter((f) =>
        normalizeText(f.url()).includes(urlPattern),
      );
      if (matched.length) targetFrames = matched;
    }

    // Target frame by Name
    if (options.frameName) {
      const namePattern = normalizeText(options.frameName);
      const matched = targetFrames.filter((f) =>
        normalizeText(f.name()).includes(namePattern),
      );
      if (matched.length) targetFrames = matched;
    }

    // Target frame by Pattern (url or name or evolution)
    if (options.framePattern) {
      const pattern = normalizeText(options.framePattern);
      const matched = targetFrames.filter((f) => {
        const u = normalizeText(f.url());
        const n = normalizeText(f.name());
        return u.includes(pattern) || n.includes(pattern);
      });
      if (matched.length) targetFrames = matched;
    }

    // Target frame by Index
    if (typeof options.frameIndex === "number" && options.frameIndex >= 0) {
      if (options.frameIndex < allFrames.length) {
        targetFrames = [allFrames[options.frameIndex]];
      }
    }

    const framesData = [];
    let totalSVGs = 0;

    for (const frame of targetFrames) {
      const frameDesc = await describeFrame(frame);
      const svgs = await getFrameSVGs(frame, options);
      totalSVGs += svgs.length;

      framesData.push({
        frameIndex: allFrames.indexOf(frame),
        frameUrl: frameDesc.url,
        frameName: frameDesc.name,
        parentURL: frameDesc.parentURL,
        isMainFrame: frame === mainFrame,
        svgCount: svgs.length,
        svgs,
      });
    }

    return {
      success: true,
      totalFrames: allFrames.length,
      matchedFrames: targetFrames.length,
      totalSVGs,
      frames: framesData,
    };
  } catch (err) {
    error("getSVGDataFromIframe failed:", err.message);
    return {
      success: false,
      error: err.message,
      totalFrames: 0,
      matchedFrames: 0,
      totalSVGs: 0,
      frames: [],
    };
  }
}

//==========================================================
// FIND FRAMES WITH SVGS
//==========================================================

export async function findFramesWithSVGs(page, options = {}) {
  const result = await getSVGDataFromIframe(page, options);
  if (!result || !result.frames) return [];
  return result.frames.filter((f) => f.svgCount > 0);
}

//==========================================================
// GET SPECIFIC SVG BY SELECTOR
//==========================================================

export async function getSVGBySelector(pageOrFrame, selector, options = {}) {
  if (!pageOrFrame) {
    throw new Error("Page or Frame is required.");
  }

  // If it's a page
  if (typeof pageOrFrame.frames === "function") {
    const frames = await getAllFrames(pageOrFrame);
    for (const frame of frames) {
      const svgs = await getFrameSVGs(frame, { ...options, selector });
      if (svgs.length > 0) {
        return {
          frameUrl: frame.url(),
          frameName: frame.name(),
          svg: svgs[0],
          allSVGs: svgs,
        };
      }
    }
    return null;
  }

  // If it's a frame directly
  const svgs = await getFrameSVGs(pageOrFrame, { ...options, selector });
  return svgs.length > 0 ? svgs[0] : null;
}

//==========================================================
// CLICK SVG ELEMENT INSIDE FRAME
//==========================================================

export async function clickSVGElement(frame, selectorOrFilter, options = {}) {
  if (!frame) {
    return { success: false, error: "Frame is required." };
  }

  try {
    const target = String(selectorOrFilter).trim();

    // Check if target is a CSS selector
    const bySelector = frame.locator(target);
    if ((await bySelector.count()) > 0) {
      await bySelector.first().scrollIntoViewIfNeeded().catch(() => {});
      await bySelector.first().click({ timeout: 3000, force: true });
      return {
        success: true,
        action: "iframe.clickSVG",
        target,
        strategy: "selector",
        frameURL: frame.url(),
      };
    }

    // Try finding by path aria-label / title / text
    const byAria = frame.locator(`svg [aria-label*="${target}" i], svg [title*="${target}" i]`);
    if ((await byAria.count()) > 0) {
      await byAria.first().click({ timeout: 3000, force: true });
      return {
        success: true,
        action: "iframe.clickSVG",
        target,
        strategy: "aria-title",
        frameURL: frame.url(),
      };
    }

    return {
      success: false,
      error: `SVG element '${target}' not found in frame.`,
      frameURL: frame.url(),
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      frameURL: frame.url(),
    };
  }
}

//==========================================================
// GET CONTAINER DATA FROM SINGLE FRAME
//==========================================================

export async function getFrameContainerData(
  frame,
  containerSelectorOrClass,
  options = {},
) {
  if (!frame) return null;

  try {
    const rawOptions = {
      target: String(
        containerSelectorOrClass ||
          options.target ||
          options.class ||
          options.parentClass ||
          options.selector ||
          options.container ||
          "",
      ).trim(),
      includeHTML: options.includeHTML !== false,
      includeSVGs: options.includeSVGs !== false,
      includeChildren: options.includeChildren !== false,
      includeBBox: options.includeBBox !== false,
      limit: typeof options.limit === "number" ? options.limit : 50,
    };

    return await frame.evaluate((opts) => {
      const target = opts.target;
      if (!target) return null;

      function findContainers(query) {
        const found = [];
        const qStr = String(query).trim();
        if (!qStr) return [];

        // 1. Direct selector
        try {
          const direct = document.querySelectorAll(qStr);
          if (direct.length) found.push(...direct);
        } catch {}

        // 2. Class name / ID variants
        const cleanName = qStr.replace(/^[.#]/, "");
        if (cleanName) {
          try {
            const byClass = document.querySelectorAll(
              `.${cleanName}, [class~="${cleanName}"], [class*="${cleanName}"]`,
            );
            for (const el of byClass) {
              if (!found.includes(el)) found.push(el);
            }
          } catch {}
          try {
            const byId = document.querySelectorAll(
              `#${cleanName}, [id*="${cleanName}"]`,
            );
            for (const el of byId) {
              if (!found.includes(el)) found.push(el);
            }
          } catch {}
        }

        // 3. Substring class match fallback
        if (!found.length && cleanName) {
          const all = document.querySelectorAll("*");
          const qLow = cleanName.toLowerCase();
          for (const el of all) {
            const cls = String(
              el.className?.baseVal || el.className || "",
            ).toLowerCase();
            if (cls.includes(qLow) && !found.includes(el)) {
              found.push(el);
            }
          }
        }

        return found;
      }

      const containers = findContainers(target);
      if (!containers.length) return [];

      const results = [];
      const maxCount = Math.min(containers.length, opts.limit || 50);

      for (let i = 0; i < maxCount; i++) {
        const el = containers[i];
        const rect = el.getBoundingClientRect();

        // Extract attributes
        const attributes = {};
        if (el.attributes) {
          for (let a = 0; a < el.attributes.length; a++) {
            const attr = el.attributes[a];
            attributes[attr.name] = attr.value;
          }
        }

        // Dataset
        const dataset = {};
        if (el.dataset) {
          for (const k in el.dataset) {
            dataset[k] = el.dataset[k];
          }
        }

        // Text blocks
        const text = (el.innerText || el.textContent || "").trim();
        const textBlocks = Array.from(el.childNodes)
          .map((n) => (n.textContent || "").trim())
          .filter(Boolean);

        // SVGs inside container - Converted directly to JSON
        const svgs = [];
        if (opts.includeSVGs !== false) {
          const svgEls = el.querySelectorAll("svg");
          for (let s = 0; s < svgEls.length; s++) {
            const sEl = svgEls[s];
            const sRect = sEl.getBoundingClientRect();

            // Paths
            const paths = Array.from(sEl.querySelectorAll("path")).map(
              (p, pIdx) => ({
                index: pIdx,
                d: p.getAttribute("d") || "",
                fill:
                  p.getAttribute("fill") || p.style?.fill || undefined,
                stroke:
                  p.getAttribute("stroke") || p.style?.stroke || undefined,
                strokeWidth:
                  p.getAttribute("stroke-width") || p.style?.strokeWidth || undefined,
                id: p.id || undefined,
                className: p.getAttribute("class") || undefined,
                transform: p.getAttribute("transform") || undefined,
                ariaLabel: p.getAttribute("aria-label") || undefined,
              }),
            );

            // Shapes
            const shapes = Array.from(
              sEl.querySelectorAll(
                "circle, rect, ellipse, polygon, polyline, line",
              ),
            ).map((sh) => ({
              tagName: sh.tagName.toLowerCase(),
              id: sh.id || undefined,
              className: sh.getAttribute("class") || undefined,
              fill: sh.getAttribute("fill") || undefined,
              stroke: sh.getAttribute("stroke") || undefined,
              transform: sh.getAttribute("transform") || undefined,
              cx: sh.getAttribute("cx") || undefined,
              cy: sh.getAttribute("cy") || undefined,
              r: sh.getAttribute("r") || undefined,
              x: sh.getAttribute("x") || undefined,
              y: sh.getAttribute("y") || undefined,
              width: sh.getAttribute("width") || undefined,
              height: sh.getAttribute("height") || undefined,
              points: sh.getAttribute("points") || undefined,
            }));

            // Texts & Values
            const svgTexts = Array.from(
              sEl.querySelectorAll("text, tspan, title, desc"),
            )
              .map((t) => ({
                tagName: t.tagName.toLowerCase(),
                text: (t.textContent || "").trim(),
                x: t.getAttribute("x") || undefined,
                y: t.getAttribute("y") || undefined,
                fill: t.getAttribute("fill") || undefined,
                fontSize: t.getAttribute("font-size") || undefined,
                transform: t.getAttribute("transform") || undefined,
              }))
              .filter((t) => t.text);

            // Groups & Transforms
            const groups = [];
            const dynamicTransforms = [];
            const groupNodes = sEl.querySelectorAll("g");
            for (let g = 0; g < groupNodes.length; g++) {
              const gEl = groupNodes[g];
              const tr = gEl.getAttribute("transform") || gEl.style?.transform || "";
              if (tr) dynamicTransforms.push(tr);
              if (tr || gEl.id || gEl.getAttribute("class") || gEl.getAttribute("aria-label")) {
                groups.push({
                  index: g,
                  id: gEl.id || undefined,
                  className: gEl.getAttribute("class") || undefined,
                  transform: tr || undefined,
                  ariaLabel: gEl.getAttribute("aria-label") || undefined,
                  childElementCount: gEl.childElementCount,
                });
              }
            }

            const rootTransform = sEl.getAttribute("transform") || sEl.style?.transform || "";
            if (rootTransform) dynamicTransforms.push(rootTransform);

            const directSvgText = (sEl.textContent || "").replace(/\s+/g, " ").trim();
            const allTextJoined = [directSvgText, ...svgTexts.map((t) => t.text)].join(" ");
            const extractedNumbers = (allTextJoined.match(/-?\d+(?:\.\d+)?(?:x|%|\$|€|£)?/g) || [])
              .map((n) => n.trim())
              .filter((v, idx, arr) => arr.indexOf(v) === idx);

            let rotationAngle = undefined;
            for (const tr of dynamicTransforms) {
              const rotMatch = tr.match(/rotate\(\s*(-?\d+(?:\.\d+)?)/i);
              if (rotMatch) {
                rotationAngle = parseFloat(rotMatch[1]);
                break;
              }
              const matrixMatch = tr.match(/matrix\(\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/i);
              if (matrixMatch) {
                const a = parseFloat(matrixMatch[1]);
                const b = parseFloat(matrixMatch[2]);
                rotationAngle = Math.round(Math.atan2(b, a) * (180 / Math.PI) * 100) / 100;
                break;
              }
            }

            // SVG converted to JSON object
            svgs.push({
              index: s,
              id: sEl.id || undefined,
              className: sEl.getAttribute("class") || undefined,
              viewBox: sEl.getAttribute("viewBox") || undefined,
              width:
                sEl.getAttribute("width") ||
                Math.round(sRect.width) ||
                undefined,
              height:
                sEl.getAttribute("height") ||
                Math.round(sRect.height) ||
                undefined,
              transform: rootTransform || undefined,
              boundingBox: {
                x: Math.round(sRect.x),
                y: Math.round(sRect.y),
                width: Math.round(sRect.width),
                height: Math.round(sRect.height),
              },
              text:
                svgTexts.map((t) => t.text).join(" ") ||
                directSvgText ||
                undefined,
              texts: svgTexts.length ? svgTexts : undefined,
              pathCount: paths.length,
              paths,
              shapeCount: shapes.length,
              shapes,
              groupCount: groups.length ? groups.length : undefined,
              groups: groups.length ? groups : undefined,
              dynamicValues: {
                numbers: extractedNumbers,
                rotationAngle,
                transforms: dynamicTransforms.length ? dynamicTransforms : undefined,
                summary: directSvgText || (svgTexts.length ? svgTexts.map((t) => t.text).join(", ") : undefined),
              },
              timestamp: new Date().toISOString(),
              outerHTML: sEl.outerHTML,
            });
          }
        }

        // Child interactive elements
        let buttons = [];
        let links = [];
        let inputs = [];
        if (opts.includeChildren !== false) {
          buttons = Array.from(
            el.querySelectorAll("button, [role='button']"),
          ).map((b) => ({
            text: (b.innerText || b.textContent || "").trim(),
            id: b.id || undefined,
            className: b.getAttribute("class") || undefined,
            ariaLabel: b.getAttribute("aria-label") || undefined,
            disabled:
              b.disabled || b.getAttribute("aria-disabled") === "true",
          }));

          links = Array.from(el.querySelectorAll("a, [role='link']")).map(
            (l) => ({
              text: (l.innerText || l.textContent || "").trim(),
              href: l.getAttribute("href") || undefined,
              id: l.id || undefined,
              className: l.getAttribute("class") || undefined,
            }),
          );

          inputs = Array.from(
            el.querySelectorAll("input, select, textarea"),
          ).map((inp) => ({
            tagName: inp.tagName.toLowerCase(),
            type: inp.type || undefined,
            name: inp.name || undefined,
            value: inp.value || undefined,
            placeholder: inp.placeholder || undefined,
            checked: inp.checked,
          }));
        }

        // 4-values JSON formatting
        const combinedText = [text, ...svgs.map((s) => s.text || "")].join(" ");
        const allRawNums = (combinedText.match(/\d+/g) || []).map(Number);
        const fourValuesList = [];
        for (let nIdx = 0; nIdx < allRawNums.length; nIdx += 4) {
          const chunk = allRawNums.slice(nIdx, nIdx + 4);
          if (chunk.length > 0) {
            fourValuesList.push({ values: chunk });
          }
        }
        const fourValues = [{ 0: fourValuesList }];

        const dataItem = {
          index: i,
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.getAttribute("class") || undefined,
          text,
          textBlocks: textBlocks.length > 1 ? textBlocks : undefined,
          fourValues,
          attributes,
          dataset: Object.keys(dataset).length ? dataset : undefined,
          svgCount: svgs.length,
          svgs: svgs.length ? svgs : undefined,
          buttons: buttons.length ? buttons : undefined,
          links: links.length ? links : undefined,
          inputs: inputs.length ? inputs : undefined,
          childElementCount: el.childElementCount,
          timestamp: new Date().toISOString(),
        };

        if (opts.includeBBox !== false) {
          dataItem.boundingBox = {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            left: Math.round(rect.left),
          };
        }

        if (opts.includeHTML !== false) {
          dataItem.innerHTML = el.innerHTML;
          dataItem.outerHTML = el.outerHTML;
        }

        results.push(dataItem);
      }

      return results;
    }, rawOptions);
  } catch (err) {
    warn("getFrameContainerData error:", err.message);
    return [];
  }
}

//==========================================================
// CONVERT SVG TO JSON HELPER
//==========================================================

export function convertSVGToJSON(svgDataOrItem, options = {}) {
  if (!svgDataOrItem) return null;

  if (Array.isArray(svgDataOrItem)) {
    return svgDataOrItem.map((item) => convertSVGToJSON(item, options));
  }

  const base = {
    id: svgDataOrItem.id || undefined,
    className: svgDataOrItem.className || undefined,
    viewBox: svgDataOrItem.viewBox || undefined,
    width: svgDataOrItem.width || undefined,
    height: svgDataOrItem.height || undefined,
    transform: svgDataOrItem.transform || undefined,
    text: svgDataOrItem.text || undefined,
    boundingBox: svgDataOrItem.boundingBox || undefined,
    pathCount: svgDataOrItem.pathCount || (svgDataOrItem.paths ? svgDataOrItem.paths.length : 0),
    paths: svgDataOrItem.paths || [],
    shapeCount: svgDataOrItem.shapeCount || (svgDataOrItem.shapes ? svgDataOrItem.shapes.length : 0),
    shapes: svgDataOrItem.shapes || [],
    groups: svgDataOrItem.groups || [],
    dynamicValues: svgDataOrItem.dynamicValues || {},
    timestamp: svgDataOrItem.timestamp || new Date().toISOString(),
  };

  if (options.includeHTML !== false && svgDataOrItem.outerHTML) {
    base.outerHTML = svgDataOrItem.outerHTML;
  }

  return base;
}

//==========================================================
// GET CONTAINER DATA ACROSS IFRAMES
//==========================================================

export async function getIframeContainerData(
  page,
  containerSelectorOrClass,
  options = {},
) {
  if (!page) {
    throw new Error("Page is required.");
  }

  const target = String(
    containerSelectorOrClass ||
      options.target ||
      options.class ||
      options.parentClass ||
      options.selector ||
      options.container ||
      "",
  ).trim();

  if (!target) {
    throw new Error("Container class or selector is required.");
  }

  const allFrames = await getAllFrames(page);
  const mainFrame = page.mainFrame();

  let targetFrames = allFrames;
  if (options.onlyIframes !== false && allFrames.length > 1) {
    targetFrames = allFrames.filter((f) => f !== mainFrame);
  }

  if (options.frameUrl) {
    const urlPattern = normalizeText(options.frameUrl);
    targetFrames = targetFrames.filter((f) =>
      normalizeText(f.url()).includes(urlPattern),
    );
  } else if (options.frameName) {
    const namePattern = normalizeText(options.frameName);
    targetFrames = targetFrames.filter((f) =>
      normalizeText(f.name()).includes(namePattern),
    );
  } else if (options.framePattern) {
    const pattern = normalizeText(options.framePattern);
    targetFrames = targetFrames.filter(
      (f) =>
        normalizeText(f.url()).includes(pattern) ||
        normalizeText(f.name()).includes(pattern),
    );
  }

  const framesData = [];
  let totalContainers = 0;
  let totalSVGs = 0;

  for (const frame of targetFrames) {
    const frameDesc = await describeFrame(frame);
    const containers = await getFrameContainerData(frame, target, options);

    if (containers && containers.length) {
      totalContainers += containers.length;
      const frameSvgCount = containers.reduce(
        (sum, c) => sum + (c.svgCount || 0),
        0,
      );
      totalSVGs += frameSvgCount;

      framesData.push({
        frameIndex: allFrames.indexOf(frame),
        frameUrl: frameDesc.url,
        frameName: frameDesc.name,
        parentURL: frameDesc.parentURL,
        isMainFrame: frame === mainFrame,
        containerCount: containers.length,
        svgCount: frameSvgCount,
        containers,
      });
    }
  }

  const primaryContainer = framesData[0]?.containers[0];
  const primaryFourValues = primaryContainer?.fourValues || [{ 0: [] }];
  const primaryText = primaryContainer?.text || "";

  return {
    success: true,
    target,
    text: primaryText,
    fourValues: primaryFourValues,
    timestamp: new Date().toISOString(),
    totalFrames: allFrames.length,
    matchedFrames: framesData.length,
    totalContainers,
    totalSVGs,
    frames: framesData,
  };
}

//==========================================================
// WATCH CONTAINER DATA ON INTERVAL
//==========================================================

export function watchIframeContainerData(
  page,
  containerSelectorOrClass,
  onUpdate,
  options = {},
) {
  let intervalMs = options.interval || 1500;
  let running = true;
  let timer = null;
  let lastData = null;

  async function poll() {
    if (!running) return;
    try {
      const data = await getIframeContainerData(page, containerSelectorOrClass, options);
      lastData = data;
      if (typeof onUpdate === "function") {
        onUpdate(data);
      }
    } catch (err) {
      warn("watch poll failed:", err.message);
    }
    if (running) {
      timer = setTimeout(poll, intervalMs);
    }
  }

  poll();

  return {
    stop: () => {
      running = false;
      if (timer) clearTimeout(timer);
    },
    updateInterval: (newMs) => {
      intervalMs = Math.max(200, Number(newMs) || 1500);
    },
    getLatest: () => lastData,
    isRunning: () => running,
  };
}

//==========================================================
//==========================================================
// DISMISS INACTIVITY POPUP (OK / START / CONTINUE / RESUME)
//==========================================================

export async function dismissInactivityPopup(page) {
  if (!page || page.isClosed?.()) return { dismissed: false, count: 0 };
  let dismissedCount = 0;
  const clickedButtons = [];

  try {
    const frames = await getAllFrames(page);

    for (const frame of frames) {
      try {
        const result = await frame.evaluate(() => {
          const clicked = [];

          // 1. Detect if an element is inside an active modal / dialog / overlay / popup container
          function isInsideModal(el) {
            let current = el;
            while (current && current !== document.body && current !== document.documentElement) {
              const role = current.getAttribute?.("role") || "";
              const cls = (current.className || "").toString().toLowerCase();
              const id = (current.id || "").toLowerCase();

              if (
                role === "dialog" ||
                role === "alertdialog" ||
                /modal|popup|dialog|overlay|sweet-alert|swal2|inactivity|idle|timeout|alert-box/i.test(cls + " " + id)
              ) {
                return current;
              }
              current = current.parentElement;
            }
            return null;
          }

          // 2. Check if a container has textual evidence of inactivity / session timeout / pause
          function hasInactivityContext(container) {
            if (!container) return false;
            const text = (container.innerText || container.textContent || "").toLowerCase();
            return /are you still there|are you still playing|inactivity|inactive|session timeout|session expired|idle timeout|game paused|paused due to|press ok to continue|click to resume|continue playing|keep playing|still watching|idle detected|stay connected/i.test(
              text,
            );
          }

          const allButtons = Array.from(
            document.querySelectorAll(
              'button, [role="button"], .btn, input[type="button"], input[type="submit"], a.button',
            ),
          );

          for (const btn of allButtons) {
            try {
              // Ignore hidden / non-interactable buttons
              const style = window.getComputedStyle(btn);
              if (
                style.display === "none" ||
                style.visibility === "hidden" ||
                style.opacity === "0" ||
                style.pointerEvents === "none"
              ) {
                continue;
              }
              const rect = btn.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue;

              const rawText = (btn.innerText || btn.textContent || btn.value || "").trim();
              const text = rawText.toLowerCase();
              const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
              const cls = (btn.className || "").toString().toLowerCase();
              const id = (btn.id || "").toLowerCase();
              const fullAttr = cls + " " + id + " " + ariaLabel;

              // CRITICAL: Blacklist generic lobby / game catalog action words (NEVER click game cards or catalog links)
              if (
                /play for free|free play|demo play|real play|login|sign in|signup|register|deposit|withdraw/i.test(
                  text + " " + ariaLabel,
                )
              ) {
                continue;
              }

              // Explicit Inactivity Button phrases (safe to click)
              const isExplicitInactivity =
                /^(?:i'm here|i am here|yes,?\s*i'm here|keep playing|continue playing|resume game|resume session|stay connected|stay logged in|i'm still here|still here|unpause)$/i.test(
                  text,
                ) ||
                /inactivity-btn|idle-resume|resume-inactivity|dialog-inactivity|inactivity_ok/i.test(
                  fullAttr,
                );

              // Modal-Scoped Inactivity Button:
              // Must be inside a modal/dialog/overlay AND the modal must contain inactivity context text
              const modalContainer = isInsideModal(btn);
              const isModalInactivity =
                modalContainer &&
                hasInactivityContext(modalContainer) &&
                /^(?:ok|okay|start|continue|resume|yes|confirm|stay|reconnect|got it)$/i.test(text);

              // Also check button classes/id that explicitly specify dialog confirmation
              const isDialogActionInModal =
                modalContainer &&
                /dialog-ok|dialog-start|dialog-continue|dialog-resume|modal-ok|modal-continue/i.test(
                  fullAttr,
                );

              // In-game play-button overlay (e.g. data-role="play-button", .A2zb9M, .VQJTA7, .iTKQgM, .E0dFqh)
              const isPlayButtonOverlay =
                btn.getAttribute?.("data-role") === "play-button" ||
                /A2zb9M|iTKQgM|VQJTA7|E0dFqh/i.test(cls) ||
                btn.closest?.('[data-role="play-button"]');

              if (isExplicitInactivity || isModalInactivity || isDialogActionInModal || isPlayButtonOverlay) {
                btn.click();
                clicked.push(rawText || ariaLabel || id || (isPlayButtonOverlay ? "play-button (overlay)" : "inactivity-btn"));
                if (clicked.length >= 3) break; // At most 3 buttons per frame
              }
            } catch {}
          }
          return clicked;
        });

        if (result && result.length) {
          dismissedCount += result.length;
          clickedButtons.push(...result.map((t) => ({ frameUrl: frame.url(), text: t })));
        }
      } catch {}
    }
  } catch (err) {
    warn("dismissInactivityPopup error:", err.message);
  }

  if (dismissedCount > 0) {
    log(
      `[Inactivity Guard] Dismissed ${dismissedCount} popup button(s):`,
      clickedButtons.map((b) => b.text).join(", "),
    );
  }

  return {
    dismissed: dismissedCount > 0,
    count: dismissedCount,
    buttons: clickedButtons,
  };
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
  getFrameSVGs,
  getAllSVGsFromFrames,
  getSVGDataFromIframe,
  getFrameContainerData,
  getIframeContainerData,
  findFramesWithSVGs,
  getSVGBySelector,
  clickSVGElement,
  clickInsideFrame,
  clickInsideEvolutionFrame,
  clickInsideAnyFrame,
  convertSVGToJSON,
  watchIframeContainerData,
  dismissInactivityPopup,
  debugFrames,
};
