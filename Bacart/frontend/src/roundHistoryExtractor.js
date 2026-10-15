/**
 * ============================================================================
 * Round History SVG Extractor for Evolution Blackjack Iframe
 * ============================================================================
 * Target Iframe:
 *   <iframe src="https://5ixuqg75.nijsdyfigq.link/frontend/evo/r3/#category=blackjack"></iframe>
 *
 * Requirements Met:
 *   1. Locates the iframe and attempts to access its document safely.
 *   2. Checks whether the element with class `i-1wnr` exists inside the
 *      round-history section. If the section has a different selector, inspects
 *      the DOM and uses the correct selector dynamically.
 *   3. Finds all SVG elements within the relevant round-history element.
 *   4. Converts each SVG into JSON-compatible data (tag names, attributes,
 *      text content, and nested elements recursively).
 *   5. Logs whether the target element exists.
 *   6. Outputs extracted SVG data using console.log(JSON.stringify(data, null, 2)).
 *   7. Safely retries if the element does not exist yet via MutationObserver,
 *      iframe load listener, and controlled interval polling.
 *   8. Gracefully handles cross-origin access errors without attempting to
 *      bypass browser security restrictions (Same-Origin Policy).
 *   9. Complete, production-grade code with full error handling and comments.
 * ============================================================================
 */

(function () {
  "use strict";

  // Target iframe URL identifiers
  const TARGET_IFRAME_SRC =
    "https://5ixuqg75.nijsdyfigq.link/frontend/evo/r3/#category=blackjack";
  const TARGET_SRC_KEYWORDS = [
    "5ixuqg75.nijsdyfigq.link",
    "/frontend/evo/r3/#category=blackjack",
    "/frontend/evo/",
    "category=blackjack",
  ];

  // Primary selector requested by user
  const PRIMARY_SELECTOR = ".i-1wnr";

  // Comprehensive fallback selectors for Evolution Gaming round-history sections
  const FALLBACK_ROUND_HISTORY_SELECTORS = [
    // Class-based variations of the target class
    ".i-1wnr",
    "[class*='i-1wnr']",

    // Target class within common history parent wrappers
    "[data-role='recent-results'] .i-1wnr",
    "[data-role='round-history'] .i-1wnr",
    "[class*='history'] .i-1wnr",

    // Evolution Gaming standard data-role attributes
    "svg[data-role='recent-results']",
    "[data-role='recent-results']",
    "[data-role='round-history']",
    "[data-role='game-history']",
    "[data-role='history']",
    "[data-role='results']",

    // CSS class patterns frequently used in Evolution UI components
    "[class*='round-history']",
    "[class*='roundHistory']",
    "[class*='recent-results']",
    "[class*='recentResults']",
    "[class*='game-history']",
    "[class*='history-wrapper']",
    "[class*='historyList']",
    "[class*='history']",

    // Accessible ARIA labels
    "[aria-label*='round history' i]",
    "[aria-label*='recent results' i]",
    "[aria-label*='history' i]",
  ];

  // Configuration for retry mechanism
  const CONFIG = {
    pollingIntervalMs: 1500, // Interval between retry checks
    maxRetries: 40,          // Maximum number of polling retries (60 seconds total)
    debug: true,             // Detailed logging
  };

  let retryCount = 0;
  let retryTimer = null;
  let mutationObserver = null;
  let isExtractorFinished = false;

  /**
   * Safe logger with timestamp and prefix
   */
  function log(message, ...args) {
    console.log(`[RoundHistoryExtractor ${new Date().toLocaleTimeString()}] ℹ️ ${message}`, ...args);
  }

  function warn(message, ...args) {
    console.warn(`[RoundHistoryExtractor ${new Date().toLocaleTimeString()}] ⚠️ ${message}`, ...args);
  }

  function error(message, ...args) {
    console.error(`[RoundHistoryExtractor ${new Date().toLocaleTimeString()}] ❌ ${message}`, ...args);
  }

  /**
   * Requirement 1: Locate the target iframe element.
   * Matches by exact URL, keyword substrings, or fallback to any matching iframe.
   */
  function findIframeElement() {
    // 1. Check for exact src match
    const exactMatch = document.querySelector(`iframe[src="${TARGET_IFRAME_SRC}"]`);
    if (exactMatch) return exactMatch;

    // 2. Search through all iframes for partial matches
    const allIframes = Array.from(document.querySelectorAll("iframe"));
    for (const iframe of allIframes) {
      const src = iframe.getAttribute("src") || iframe.src || "";
      if (TARGET_SRC_KEYWORDS.some((kw) => src.includes(kw))) {
        return iframe;
      }
    }

    // 3. Fallback: if only one iframe exists on page, return it
    if (allIframes.length === 1) {
      return allIframes[0];
    }

    return null;
  }

  /**
   * Requirements 1 & 8: Safely attempt to access the iframe document.
   * Gracefully catches and reports cross-origin SecurityErrors without attempting
   * to bypass browser security policies.
   */
  function getIframeDocumentSafely(iframe) {
    if (!iframe) {
      return { doc: null, error: "Iframe element not found in DOM", isCrossOrigin: false };
    }

    try {
      // Direct access attempt
      const iframeDoc =
        iframe.contentDocument ||
        (iframe.contentWindow && iframe.contentWindow.document);

      if (!iframeDoc) {
        return {
          doc: null,
          error: "Iframe contentDocument is null (iframe may still be loading)",
          isCrossOrigin: false,
        };
      }

      // Test access to document properties to verify no cross-origin restriction
      const test = iframeDoc.documentElement;
      if (!test) {
        return {
          doc: null,
          error: "Iframe documentElement is not accessible",
          isCrossOrigin: false,
        };
      }

      return { doc: iframeDoc, error: null, isCrossOrigin: false };
    } catch (err) {
      // Detect Cross-Origin Security Restrictions (Same-Origin Policy)
      const isSecurityError =
        err.name === "SecurityError" ||
        err.code === 18 ||
        String(err.message || "").toLowerCase().includes("cross-origin") ||
        String(err.message || "").toLowerCase().includes("blocked a frame");

      return {
        doc: null,
        error: err.message || String(err),
        isCrossOrigin: isSecurityError,
      };
    }
  }

  /**
   * Requirement 4: Convert an SVG DOM node and all its nested elements into
   * clean, JSON-compatible serializable data.
   */
  function serializeSvgNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    // Extract all node attributes into a clean key-value object
    const attributes = {};
    if (node.attributes && node.attributes.length > 0) {
      for (let i = 0; i < node.attributes.length; i++) {
        const attr = node.attributes[i];
        attributes[attr.name] = attr.value;
      }
    }

    // Extract direct text content (e.g. from <text> or <tspan> elements)
    let directText = "";
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent || "").trim();
        if (text) {
          directText = directText ? `${directText} ${text}` : text;
        }
      }
    }

    // Recursively process nested child elements
    const children = [];
    if (node.children && node.children.length > 0) {
      for (let i = 0; i < node.children.length; i++) {
        const childJson = serializeSvgNode(node.children[i]);
        if (childJson) {
          children.push(childJson);
        }
      }
    }

    // Construct JSON object
    const result = {
      tagName: node.tagName.toLowerCase(),
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    };

    if (directText) {
      result.textContent = directText;
    } else if (children.length === 0 && (node.textContent || "").trim()) {
      result.textContent = node.textContent.trim();
    }

    if (children.length > 0) {
      result.children = children;
    }

    return result;
  }

  /**
   * Requirement 2: Inspect DOM inside iframe document to locate .i-1wnr
   * or resolve alternative round-history container selectors.
   */
  function inspectAndResolveRoundHistoryElement(doc) {
    if (!doc) return null;

    // 1. Check for primary requested class (.i-1wnr)
    try {
      const primaryEl = doc.querySelector(PRIMARY_SELECTOR);
      if (primaryEl) {
        return {
          element: primaryEl,
          selectorUsed: PRIMARY_SELECTOR,
          isPrimaryClass: true,
        };
      }
    } catch {}

    // 2. Iterate through candidate fallback selectors
    for (const selector of FALLBACK_ROUND_HISTORY_SELECTORS) {
      try {
        const element = doc.querySelector(selector);
        if (element) {
          // Verify that this element is or contains SVG elements
          const hasSvg =
            element.tagName.toLowerCase() === "svg" ||
            element.querySelector("svg") !== null;

          if (hasSvg) {
            return {
              element,
              selectorUsed: selector,
              isPrimaryClass: selector.includes("i-1wnr"),
            };
          }
        }
      } catch {}
    }

    // 3. Dynamic inspection: find any element that has both 'history' or 'results'
    // in its class/id/data-role and contains one or more <svg> elements
    try {
      const dynamicCandidates = doc.querySelectorAll(
        "[class*='history'], [class*='results'], [id*='history'], [id*='results'], [data-role*='results'], [data-role*='history']"
      );

      for (const candidate of dynamicCandidates) {
        const svgs = candidate.querySelectorAll("svg");
        if (svgs.length > 0) {
          const generatedSelector = candidate.className
            ? `.${candidate.className.trim().split(/\s+/).join(".")}`
            : candidate.id
            ? `#${candidate.id}`
            : candidate.tagName.toLowerCase();

          return {
            element: candidate,
            selectorUsed: generatedSelector,
            isPrimaryClass: false,
          };
        }
      }
    } catch {}

    return null;
  }

  /**
   * Requirement 3: Find all SVG elements within the relevant round-history element.
   */
  function extractSvgsFromElement(targetElement) {
    if (!targetElement) return [];

    const svgs = [];

    // Case A: The target element itself is an <svg>
    if (targetElement.tagName && targetElement.tagName.toLowerCase() === "svg") {
      svgs.push(targetElement);
    }

    // Case B: Query all <svg> child elements within the container
    const childSvgs = targetElement.querySelectorAll("svg");
    childSvgs.forEach((svg) => {
      if (!svgs.includes(svg)) {
        svgs.push(svg);
      }
    });

    // Case C: If .i-1wnr is an inner cell or label, inspect closest container
    if (svgs.length === 0 && targetElement.closest) {
      const parentContainer = targetElement.closest(
        "[data-role*='results'], [data-role*='history'], [class*='history'], [class*='results'], section, div"
      );
      if (parentContainer) {
        const parentSvgs = parentContainer.querySelectorAll("svg");
        parentSvgs.forEach((svg) => {
          if (!svgs.includes(svg)) {
            svgs.push(svg);
          }
        });
      }
    }

    return svgs;
  }

  /**
   * Main extraction routine.
   * Returns true if extraction succeeded, false if safe retry is needed.
   */
  function attemptExtraction() {
    if (isExtractorFinished) return true;

    // Detect if this script is executed directly INSIDE the target iframe
    const isInsideTargetIframe =
      window !== window.top ||
      TARGET_SRC_KEYWORDS.some((kw) => window.location.href.includes(kw));

    let targetDoc = null;
    let targetIframe = null;

    if (isInsideTargetIframe) {
      // Script is running directly in the iframe context
      targetDoc = document;
      log("Running directly inside target iframe context.");
    } else {
      // Script is running in the parent/host page
      targetIframe = findIframeElement();

      if (!targetIframe) {
        warn(
          `Target iframe not found in DOM yet. Retrying... (${retryCount}/${CONFIG.maxRetries})`
        );
        return false;
      }

      // Safely access document
      const docAccess = getIframeDocumentSafely(targetIframe);

      // Requirement 8: Handle Cross-Origin restriction gracefully
      if (docAccess.isCrossOrigin) {
        warn(
          "========================================================================\n" +
            "🔒 CROSS-ORIGIN ACCESS RESTRICTION DETECTED (Same-Origin Policy):\n" +
            `Host Origin:   ${window.location.origin}\n` +
            `Iframe Target: ${targetIframe.src || TARGET_IFRAME_SRC}\n\n` +
            "Browser security restrictions (Same-Origin Policy) prevent accessing\n" +
            "the DOM of a cross-origin iframe from the parent window's JavaScript context.\n" +
            "Per browser security standards, this code does NOT attempt to bypass security.\n\n" +
            "To extract data from this iframe, use one of the standard valid approaches:\n" +
            "  1. DevTools Console: Open Developer Tools > Console, switch the execution\n" +
            "     context dropdown from 'top' to the iframe ('5ixuqg75.nijsdyfigq.link'),\n" +
            "     and paste this script directly there.\n" +
            "  2. Direct URL: Navigate directly to:\n" +
            `     ${TARGET_IFRAME_SRC}\n` +
            "     and run this script on that page.\n" +
            "  3. Playwright / Puppeteer: Run via browser automation script which possesses\n" +
            "     CDP frame-level access privileges.\n" +
            "========================================================================"
        );
        stopRetries();
        return true; // Stop retrying as cross-origin cannot be bypassed via DOM polling
      }

      if (!docAccess.doc) {
        warn(
          `Unable to access iframe document yet: ${docAccess.error}. Retrying... (${retryCount}/${CONFIG.maxRetries})`
        );
        return false;
      }

      targetDoc = docAccess.doc;
    }

    // Requirement 2: Check whether .i-1wnr or fallback round-history selector exists
    const resolution = inspectAndResolveRoundHistoryElement(targetDoc);

    // Requirement 5: Log whether the target element exists
    const targetExists = resolution !== null;
    log(
      `Target element exists: ${targetExists}` +
        (targetExists
          ? ` (found via selector: "${resolution.selectorUsed}", isPrimaryClass: ${resolution.isPrimaryClass})`
          : ` (primary selector "${PRIMARY_SELECTOR}" and fallbacks not found)`)
    );

    // Requirement 7: If it does not exist, log clear message and continue retry cycle
    if (!targetExists) {
      log(
        `Round-history element has not appeared yet. Waiting for dynamic render... (${retryCount}/${CONFIG.maxRetries})`
      );
      setupDynamicObserver(targetDoc);
      return false;
    }

    // Requirement 3: Find all SVG elements within the relevant round-history element
    const svgs = extractSvgsFromElement(resolution.element);
    log(`Found ${svgs.length} SVG element(s) within round-history section.`);

    if (svgs.length === 0) {
      log(
        "Target container found, but SVGs have not rendered inside yet. Waiting for render..."
      );
      setupDynamicObserver(targetDoc);
      return false;
    }

    // Requirement 4: Convert each SVG into JSON-compatible data
    const extractedData = svgs.map((svg, index) => {
      const serialized = serializeSvgNode(svg);
      return {
        index,
        timestamp: new Date().toISOString(),
        selectorUsed: resolution.selectorUsed,
        svg: serialized,
      };
    });

    // Requirement 6: Output extracted SVG data using console.log(JSON.stringify(data, null, 2))
    log("Successfully extracted round-history SVG data! Outputting JSON result:");
    console.log(JSON.stringify(extractedData, null, 2));

    // Success - clean up observer and timers
    isExtractorFinished = true;
    stopRetries();
    return true;
  }

  /**
   * Requirement 7: Setup MutationObserver to watch for dynamic DOM additions
   */
  function setupDynamicObserver(doc) {
    if (mutationObserver || !doc || !doc.body) return;

    try {
      mutationObserver = new MutationObserver(() => {
        if (!isExtractorFinished) {
          const success = attemptExtraction();
          if (success) {
            stopRetries();
          }
        }
      });

      mutationObserver.observe(doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "id", "data-role"],
      });

      log("Attached MutationObserver to iframe document for dynamic element detection.");
    } catch (obsErr) {
      warn("Could not attach MutationObserver:", obsErr.message);
    }
  }

  /**
   * Stop polling and disconnect observers
   */
  function stopRetries() {
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
  }

  /**
   * Requirement 7: Safe retry mechanism with iframe load listener and polling timer
   */
  function startExtractor() {
    log("Initializing Round History Extractor...");

    // Immediate attempt
    const success = attemptExtraction();
    if (success) return;

    // Attach iframe 'load' event listener if iframe element exists
    const iframe = findIframeElement();
    if (iframe && typeof iframe.addEventListener === "function") {
      iframe.addEventListener(
        "load",
        () => {
          log("Iframe 'load' event fired. Retrying extraction...");
          attemptExtraction();
        },
        { once: true }
      );
    }

    // Polling timer fallback
    retryTimer = setInterval(() => {
      retryCount++;
      if (retryCount > CONFIG.maxRetries) {
        warn(
          `Reached maximum retry limit (${CONFIG.maxRetries}). Stopping extractor polling.`
        );
        stopRetries();
        return;
      }

      const done = attemptExtraction();
      if (done) {
        stopRetries();
      }
    }, CONFIG.pollingIntervalMs);
  }

  // Auto-run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startExtractor);
  } else {
    startExtractor();
  }

  // Export for programmatic invocation if in module/window context
  if (typeof window !== "undefined") {
    window.__extractRoundHistory = attemptExtraction;
  }
})();
