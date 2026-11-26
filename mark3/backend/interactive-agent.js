//==========================================================
//
// backend/interactive-agent.js
//
// Intelligent Browser Automation Agent (svgJarvis)
//
// Principle: PLAN -> OBSERVE -> ACT -> VERIFY -> UPDATE -> REPLAN
//
// Core Rules:
// 1. Dynamic browser-driven planning (never fixed static blueprints).
// 2. Every step has an explicit planner status:
//    PENDING | IN_PROGRESS | COMPLETED | WAITING_FOR_USER | FAILED | SKIPPED
// 3. Mandatory post-action browser verification from live DOM/URL state.
// 4. Intelligent user clarification on ambiguity, variants, address,
//    login/OTP/CAPTCHA, out-of-stock, or unexpected browser states.
// 5. Strict payment safety: selecting a payment method NEVER authorizes
//    payment; explicit user authorization is required before Place Order/Pay.
// 6. Never report an unfinished task as COMPLETED.
//
//==========================================================

import crypto from "crypto";
import {
  KNOWN_SITE_URLS,
  stripSiteNoise,
  fuzzyMatchSiteKey,
  resolveSiteUrl as resolveCanonicalSiteUrl,
  isRecoverableErrorUrl,
} from "./utils/site-resolver.js";

export const PLANNER_STATUS = Object.freeze({
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  WAITING_FOR_USER: "WAITING_FOR_USER",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
});

const SESSION_TTL_MS = 30 * 60 * 1000;

export default class InteractiveAgent {
  constructor({ browserController, executionEngine, model, endpoint, debug = false } = {}) {
    this.browser = browserController;
    this.executor = executionEngine;
    this.model = model || process.env.AI_MODEL || "qwen3:8b";
    this.endpoint = endpoint || process.env.OLLAMA_ENDPOINT || "http://localhost:11434/api/generate";
    this.debug = Boolean(debug);
    this.sessions = new Map();
  }

  log(...args) {
    if (this.debug) {
      console.log("[InteractiveAgent]", ...args);
    }
  }

  pruneSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.updatedAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }

  //========================================================
  // GENERIC GOAL PARSER
  //========================================================

  parseGoal(command) {
    const raw = String(command || "").trim();
    const unwrapped = raw
      .replace(/^(?:hey\s+|ok\s+|okay\s+|hi\s+)?(?:jarvis|friday)[,:\s]+/i, "")
      .replace(/^(?:can|could|would|will)\s+(?:you|we)\s+(?:please\s+|kindly\s+|help\s+me\s+(?:to\s+)?)?/i, "")
      .replace(/^(?:please|kindly|i\s+(?:want|need|would\s+like)\s+(?:you\s+)?to|i['’]d\s+like\s+to|i['’]?m\s+trying\s+to|help\s+me\s+(?:to\s+)?)\s*/i, "")
      .replace(/[?!.]+$/g, "")
      .trim();

    let working = unwrapped;
    let site = "";

    // Handle compound phrasing like "open flipkart and buy iphone 18" or "go to amazon then order shoes"
    const compoundSiteMatch = working.match(
      /^(?:open|visit|go(?:\s+to)?|navigate(?:\s+to)?|browse)\s+([a-z0-9.-]+(?:\.[a-z]{2,})?(?:\s+(?:website|webite|site|app|store))?)\s+(?:and(?:\s+then)?|then)\s+(.+)$/i,
    );
    if (compoundSiteMatch) {
      site = stripSiteNoise(compoundSiteMatch[1]).toLowerCase();
      working = compoundSiteMatch[2].trim();
    }

    const actionMatch = working.match(
      /^(buy|purchase|order|shop|book|reserve|checkout|pay|subscribe|apply|compare|add\s+to\s+cart|find|search(?:\s+for)?)\b/i,
    );
    const action = actionMatch ? actionMatch[1].toLowerCase() : "interact";

    let item = working;
    if (!site) {
      const knownSiteNames = Object.keys(KNOWN_SITE_URLS).join("|");
      const midSiteMatch = working.match(
        new RegExp(`\\b(?:in|on|from|at)\\s+(${knownSiteNames}|[a-z0-9.-]+\\.[a-z]{2,})(?:\\s+(?:website|webite|web\\s*site|site|portal|app|store))?\\b`, "i"),
      );
      if (midSiteMatch) {
        site = stripSiteNoise(midSiteMatch[1]).toLowerCase();
        item = `${working.slice(0, midSiteMatch.index)} ${working.slice(midSiteMatch.index + midSiteMatch[0].length)}`.trim();
      } else {
        const trailingSiteMatch = working.match(
          /\b(?:in|on|from|at)\s+([a-z0-9.-]+(?:\.[a-z]{2,})?)(?:\s+(?:website|webite|web\s*site|site|portal|app|store))?\s*$/i,
        );
        if (trailingSiteMatch) {
          site = stripSiteNoise(trailingSiteMatch[1]).toLowerCase();
          item = working.slice(0, trailingSiteMatch.index).trim();
        } else {
          const urlMatch = working.match(/https?:\/\/[^\s]+/i);
          if (urlMatch) {
            site = urlMatch[0];
            item = working.replace(urlMatch[0], "").trim();
          }
        }
      }
    }

    item = stripSiteNoise(
      item
        .replace(/^(?:buy|purchase|order|shop(?:\s+for)?|book|reserve|checkout|pay(?:\s+for)?|find|search(?:\s+for)?|add\s+to\s+cart)\s+/i, "")
        .replace(/^(?:a|an|the)\s+/i, ""),
    )
      .replace(/\s+/g, " ")
      .trim();

    const canonicalKey = fuzzyMatchSiteKey(site);
    const targetUrl = this.resolveSiteUrl(site);

    // Detect any attributes already specified in the user command
    const lowerItem = item.toLowerCase();
    const storageMatch = lowerItem.match(/\b(\d+\s*(?:gb|tb))\b/i);
    const colorMatch = lowerItem.match(
      /\b(black|white|blue|red|green|silver|gold|pink|purple|yellow|orange|grey|gray|titanium|starlight|midnight|ultramarine|teal)\b/i,
    );
    const sizeMatch = lowerItem.match(/\b(xs|xxl|xl|small|medium|large)\b/i);

    return {
      raw,
      unwrapped,
      action,
      item,
      site: canonicalKey || site,
      rawSite: site,
      targetUrl,
      isPurchaseFlow: /^(?:buy|purchase|order|shop|checkout|pay|add\s+to\s+cart|book|reserve)$/i.test(action),
      specifiedAttributes: {
        storage: storageMatch ? storageMatch[1].replace(/(\d+)\s*(gb|tb)/i, "$1 $2").toUpperCase() : null,
        color: colorMatch ? colorMatch[1] : null,
        size: sizeMatch ? sizeMatch[1] : null,
      },
    };
  }

  resolveSiteUrl(site) {
    return resolveCanonicalSiteUrl(site);
  }

  isUrlOnTargetSite(currentUrl, targetSite) {
    if (!targetSite) return true;
    if (isRecoverableErrorUrl(currentUrl)) return false;
    try {
      const curHost = new URL(currentUrl).hostname.toLowerCase().replace(/^www\./, "");
      const targetUrl = this.resolveSiteUrl(targetSite);
      const tgtHost = new URL(targetUrl).hostname.toLowerCase().replace(/^www\./, "");
      const curBase = curHost.split(".")[0];
      const tgtBase = tgtHost.split(".")[0];
      return curHost === tgtHost || curBase === tgtBase;
    } catch {
      return false;
    }
  }

  //========================================================
  // GENERIC PAGE OBSERVER
  //========================================================

  async observePage(page, parsedGoal) {
    if (!page || page.isClosed()) {
      throw new Error("Active browser page is closed.");
    }

    const url = page.url();
    let title = "";
    try {
      title = await page.title();
    } catch {}

    const queryTokens = String(parsedGoal?.item || "")
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    const domSignals = await page.evaluate((tokens) => {
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          style.opacity !== "0"
        );
      };

      const clean = (str) => String(str || "").replace(/\s+/g, " ").trim();

      // 1. Search inputs
      const searchInputs = Array.from(
        document.querySelectorAll("input[type='search'], input[name='q'], input[placeholder*='search' i], input[aria-label*='search' i], input[type='text']"),
      )
        .filter(isVisible)
        .slice(0, 8)
        .map((el) => ({
          id: el.id || "",
          name: el.getAttribute("name") || "",
          placeholder: el.getAttribute("placeholder") || "",
          ariaLabel: el.getAttribute("aria-label") || "",
          value: el.value || "",
          isSearchLikely:
            el.type === "search" ||
            /search|query|find|product|brand/i.test(
              `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute("aria-label") || ""}`,
            ),
        }));

      // 2. Product / Item candidates matching goal query
      const productCandidates = [];
      const seenProductTitles = new Set();
      const linkAndCardNodes = Array.from(
        document.querySelectorAll("a[href], [data-id], [data-asin], [role='link'], [class*='product' i], [class*='item' i]"),
      );

      const fuzzyTokenMatch = (token, text) => {
        if (text.includes(token)) return true;
        if (token.length < 4) return false;
        const prefix = token.slice(0, 3);
        const words = text.split(/[^a-z0-9]+/);
        return words.some((w) => {
          if (w.length < 4) return false;
          if (Math.abs(w.length - token.length) > 2) return false;
          if (!w.startsWith(prefix) && w.slice(-3) !== token.slice(-3)) return false;
          let mismatches = 0;
          const minLen = Math.min(w.length, token.length);
          for (let i = 0; i < minLen; i++) {
            if (w[i] !== token[i]) mismatches++;
          }
          return mismatches + Math.abs(w.length - token.length) <= 2;
        });
      };

      for (const el of linkAndCardNodes) {
        if (productCandidates.length >= 12) break;
        if (!isVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.height < 10 || rect.width < 20) continue;

        const rawText = clean(
          el.innerText || el.getAttribute("title") || el.getAttribute("aria-label") || "",
        );
        if (!rawText || rawText.length < 4 || rawText.length > 450) continue;

        const lower = rawText.toLowerCase();
        // Skip header/nav/filter noise
        if (/^(login|sign in|cart|become a seller|more|home|electronics|appliances|filters?|sort by|clear all)$/i.test(lower)) {
          continue;
        }
        if (el.closest("header, nav, footer") && !/(?:₹|rs\.?|\$|€|£)/i.test(rawText)) {
          continue;
        }

        const exactMatches = tokens.filter((t) => lower.includes(t));
        const fuzzyMatches = exactMatches.length
          ? exactMatches
          : tokens.filter((t) => fuzzyTokenMatch(t, lower));
        if (tokens.length > 0 && fuzzyMatches.length === 0) continue;

        const priceMatch = rawText.match(/(?:₹|rs\.?|\$|€|£)\s*[\d,]+(?:\.\d{1,2})?/i);
        const titleLine = clean(rawText.split(/\n/)[0] || rawText).slice(0, 140);
        if (!titleLine || seenProductTitles.has(titleLine.toLowerCase())) continue;
        seenProductTitles.add(titleLine.toLowerCase());

        const exactBoost = exactMatches.length / Math.max(1, tokens.length);
        const fuzzyBoost = (fuzzyMatches.length / Math.max(1, tokens.length)) * 0.7;
        productCandidates.push({
          title: titleLine,
          fullText: rawText.slice(0, 220),
          price: priceMatch ? priceMatch[0] : "",
          href: el.getAttribute("href") || "",
          score: Math.max(exactBoost, fuzzyBoost),
        });
      }

      productCandidates.sort((a, b) => b.score - a.score);

      // 3. Variant / Model / Storage / Color / Size groups
      const variantGroups = [];
      const seenGroupKinds = new Set();
      const groupKeywords = [
        { kind: "model", regex: /\b(model|variant|edition|version|trim|series)\b/i },
        { kind: "storage", regex: /\b(storage|rom|capacity|internal\s*memory)\b/i },
        { kind: "ram", regex: /\b(ram|memory)\b/i },
        { kind: "color", regex: /\b(color|colour|finish|shade)\b/i },
        { kind: "size", regex: /\b(size|fit|dimension)\b/i },
      ];

      // Check <select> elements for variant/model/color/size
      for (const sel of Array.from(document.querySelectorAll("select")).filter(isVisible)) {
        const meta = clean(`${sel.name} ${sel.id} ${sel.getAttribute("aria-label") || ""}`);
        const matchedKind = groupKeywords.find((g) => g.regex.test(meta));
        if (!matchedKind || seenGroupKinds.has(matchedKind.kind)) continue;
        const opts = Array.from(sel.options || [])
          .map((o) => clean(o.textContent))
          .filter((t) => t && !/^(select|choose|--)/i.test(t));
        if (opts.length >= 2) {
          seenGroupKinds.add(matchedKind.kind);
          variantGroups.push({
            kind: matchedKind.kind,
            label: meta || matchedKind.kind,
            inputType: "select",
            fieldSelector: sel.id ? `#${sel.id}` : sel.name ? `select[name="${sel.name}"]` : "select",
            selectedOption: sel.selectedOptions?.[0] ? clean(sel.selectedOptions[0].textContent) : null,
            options: opts.slice(0, 10),
          });
        }
      }

      // Check label/heading + nearby option chips/links/buttons/radios
      const headingNodes = Array.from(
        document.querySelectorAll("span, div, label, p, h2, h3, h4, dt, th"),
      ).filter(isVisible);

      for (const node of headingNodes) {
        if (variantGroups.length >= 5) break;
        const text = clean(node.textContent);
        if (!text || text.length > 35) continue;

        const matchedKind = groupKeywords.find((g) => g.regex.test(text));
        if (!matchedKind || seenGroupKinds.has(matchedKind.kind)) continue;

        let container = node.closest("div, section, li, tr") || node.parentElement;
        let optionEls = [];
        for (let depth = 0; depth < 3 && container; depth++) {
          const foundOpts = Array.from(
            container.querySelectorAll("a, button, li, [role='radio'], [role='option'], label, input[type='radio']"),
          ).filter((el) => el !== node && isVisible(el));
          if (foundOpts.length >= 2) {
            optionEls = foundOpts;
            break;
          }
          const parent = container.parentElement;
          if (!parent || parent === document.body || clean(parent.textContent).length > 800) break;
          container = parent;
        }
        if (optionEls.length < 2) continue;

        const opts = [];
        let selectedOption = null;
        for (const optEl of optionEls) {
          const optText = clean(
            optEl.innerText ||
              optEl.getAttribute("aria-label") ||
              optEl.getAttribute("title") ||
              optEl.getAttribute("data-value") ||
              optEl.querySelector("img[alt]")?.getAttribute("alt") ||
              optEl.value ||
              "",
          );
          if (!optText || optText.length > 45 || optText.toLowerCase() === text.toLowerCase()) continue;
          if (!opts.includes(optText)) opts.push(optText);

          const cls = String(optEl.className || "").toLowerCase();
          const isSelected =
            optEl.checked === true ||
            optEl.getAttribute("aria-checked") === "true" ||
            optEl.getAttribute("aria-selected") === "true" ||
            /\b(selected|active|current|checked)\b/.test(cls);
          if (isSelected && !selectedOption) {
            selectedOption = optText;
          }
        }

        if (opts.length >= 2) {
          seenGroupKinds.add(matchedKind.kind);
          variantGroups.push({
            kind: matchedKind.kind,
            label: text,
            inputType: "chips",
            selectedOption,
            options: opts.slice(0, 10),
          });
        }
      }

      // 4. Primary Action / Purchase / Checkout buttons
      const actionButtons = Array.from(
        document.querySelectorAll("button, a[role='button'], input[type='submit'], input[type='button'], a[href]"),
      )
        .filter(isVisible)
        .map((el) => clean(el.innerText || el.value || el.getAttribute("aria-label") || ""))
        .filter((t) =>
          /^(add to cart|buy now|go to cart|proceed to checkout|checkout|continue|deliver here|save and deliver|place order|pay now|proceed to pay|confirm order|pay\b.*|submit order)/i.test(
            t,
          ),
        )
        .slice(0, 12);

      // 5. Address signals
      const bodyText = clean(document.body?.innerText || "").slice(0, 4500);
      const lowerBody = bodyText.toLowerCase();
      const addressDetected =
        /\b(delivery address|shipping address|select a delivery address|deliver to this address|deliver here|save and deliver)\b/i.test(
          lowerBody,
        ) || actionButtons.some((b) => /^(deliver here|save and deliver)$/i.test(b));

      const addressOptions = [];
      if (addressDetected) {
        const addrBlocks = Array.from(
          document.querySelectorAll("label, [role='radio'], [class*='address' i]"),
        ).filter(isVisible);
        for (const blk of addrBlocks) {
          const t = clean(blk.innerText);
          if (t && t.length >= 15 && t.length <= 220 && !addressOptions.includes(t)) {
            addressOptions.push(t);
          }
          if (addressOptions.length >= 5) break;
        }
      }

      // 6. Payment signals
      const paymentDetected =
        /\b(payment options|select a payment method|choose payment|upi|credit\s*\/\s*debit|net banking|cash on delivery|place order|pay now|proceed to pay)\b/i.test(
          lowerBody,
        ) || actionButtons.some((b) => /^(place order|pay now|proceed to pay|confirm order|pay\b)/i.test(b));

      const paymentOptions = [];
      let selectedPaymentOption = null;
      if (paymentDetected) {
        const payCandidates = Array.from(
          document.querySelectorAll("label, [role='radio'], button, [class*='payment' i]"),
        ).filter(isVisible);
        for (const el of payCandidates) {
          const t = clean(el.innerText || el.getAttribute("aria-label") || "");
          if (
            t &&
            t.length <= 80 &&
            /\b(upi|card|credit|debit|net\s*banking|cash on delivery|cod|emi|wallet|gpay|phonepe|paytm)\b/i.test(t) &&
            !paymentOptions.includes(t)
          ) {
            paymentOptions.push(t);
            const radio = el.querySelector("input[type='radio'], input[type='checkbox']");
            const isChecked =
              el.checked === true ||
              radio?.checked === true ||
              el.getAttribute("aria-checked") === "true" ||
              /\b(selected|active|checked)\b/i.test(String(el.className || ""));
            if (isChecked && !selectedPaymentOption) {
              selectedPaymentOption = t;
            }
          }
          if (paymentOptions.length >= 8) break;
        }
      }

      // 7. Auth / Login / OTP / Captcha wall
      const hasPasswordField = Boolean(document.querySelector("input[type='password']:not([hidden])"));
      const captchaMatch = lowerBody.match(/\b(verify you are human|captcha|i am not a robot|security check)\b/i);
      const otpMatch = lowerBody.match(/\b(enter otp|one[- ]time password|request otp|verify otp)\b/i);
      const loginMatch = lowerBody.match(/\b(enter email\/mobile number|enter mobile number|sign in to continue|login to continue)\b/i);
      const authDetected =
        hasPasswordField ||
        Boolean(captchaMatch) ||
        Boolean(otpMatch) ||
        (Boolean(loginMatch) && !searchInputs.some((s) => s.isSearchLikely));
      const authKind = captchaMatch ? "captcha" : otpMatch ? "otp" : "login";

      // 8. Product availability / out-of-stock signals
      const hasBuyOrCart = actionButtons.some((b) => /^(buy now|add to cart)$/i.test(b));
      const unavailableMatch = lowerBody.match(
        /\b(currently unavailable|out of stock|sold out|notify me when available|item is unavailable)\b/i,
      );
      const unavailableDetected = Boolean(unavailableMatch) && !hasBuyOrCart;

      // 9. Unexpected error signals
      const errorMatch = lowerBody.match(
        /\b(404 not found|page not found|something went wrong|service unavailable|temporarily unavailable|500 internal server error)\b/i,
      );
      const errorDetected = Boolean(errorMatch);

      // 10. Order confirmation signals
      const confirmMatch = bodyText.match(
        /\b(order confirmed|order placed|thank you for your order|booking confirmed|payment successful|your order has been placed)\b/i,
      );
      const orderIdMatch = bodyText.match(/\border\s*(?:id|number|no\.?|#)\s*[:#-]*\s*([A-Z0-9-]{4,})\b/i);
      const orderConfirmed = Boolean(confirmMatch);

      return {
        bodyText,
        searchInputs,
        productCandidates,
        variantGroups,
        actionButtons,
        addressSignals: {
          detected: addressDetected,
          options: addressOptions,
        },
        paymentSignals: {
          detected: paymentDetected,
          options: paymentOptions,
          selectedOption: selectedPaymentOption,
        },
        authSignals: {
          detected: authDetected,
          kind: authKind,
        },
        availabilitySignals: {
          detected: unavailableDetected,
          reason: unavailableMatch ? unavailableMatch[0] : "",
        },
        errorSignals: {
          detected: errorDetected,
          reason: errorMatch ? errorMatch[0] : "",
        },
        orderConfirmationSignals: {
          detected: orderConfirmed,
          message: confirmMatch ? confirmMatch[0] : "",
          orderId: orderIdMatch ? orderIdMatch[1] : null,
        },
      };
    }, queryTokens);

    return {
      url,
      title,
      ...domSignals,
    };
  }

  //========================================================
  // CONFUSION & PERMISSION GATE EVALUATOR
  //========================================================

  evaluatePermissionAndConfusion(session, obs) {
    const selections = session.userSelections || {};
    const spec = session.parsedGoal?.specifiedAttributes || {};

    // 0. If order confirmation is already verified in browser after authorization, do not gate
    if (obs.orderConfirmationSignals?.detected && selections.paymentApproved) {
      return null;
    }

    // 0b. Unexpected browser error page / site error banner
    if ((isRecoverableErrorUrl(obs.url) && obs.url.startsWith("chrome-error://")) || obs.errorSignals?.detected) {
      return {
        promptId: crypto.randomUUID(),
        category: "unexpected_browser_state",
        title: "Unexpected Browser State Detected",
        question: `The page "${obs.title || obs.url}" shows an unexpected state (${obs.errorSignals?.reason || obs.url}). How would you like me to proceed?`,
        reason: "Browser verification detected an error state instead of the expected workflow page.",
        requiresPermission: true,
        allowCustomInput: true,
        options: [
          { id: "retry_nav", label: "Reload / Retry", value: "__retry__" },
          { id: "manual", label: "I'll inspect it in browser", value: "__manual_takeover__" },
          { id: "cancel", label: "Cancel Task", value: "__cancel__" },
        ],
      };
    }

    // 1. Auth / Login / OTP / Captcha wall
    if (obs.authSignals?.detected && !selections.authAcknowledged) {
      const authKind = obs.authSignals.kind || "login";
      const kindLabel =
        authKind === "captcha"
          ? "CAPTCHA / Human Verification"
          : authKind === "otp"
            ? "OTP Verification"
            : "Login";
      return {
        promptId: crypto.randomUUID(),
        category: "login_required",
        authKind,
        title: `${kindLabel} Required`,
        question: `This page requires ${kindLabel} before continuing (${obs.url}). Please complete it in the browser tab and confirm when ready.`,
        reason: `Detected a ${kindLabel} gate in the live browser state.`,
        requiresPermission: true,
        allowCustomInput: true,
        options: [
          { id: "auth_done", label: `I've completed ${kindLabel} — Continue`, value: "__auth_done__" },
          { id: "cancel", label: "Cancel Task", value: "__cancel__" },
        ],
      };
    }

    // 1b. Product unavailable / Out of stock
    if (obs.availabilitySignals?.detected && !selections.availabilityHandled) {
      return {
        promptId: crypto.randomUUID(),
        category: "product_unavailable",
        title: "Product Currently Unavailable",
        question: `The current item appears unavailable ("${obs.availabilitySignals.reason || "out of stock"}"). Would you like to take over or cancel?`,
        reason: "Observed out-of-stock / unavailable state in the browser.",
        requiresPermission: true,
        allowCustomInput: true,
        options: [
          { id: "manual", label: "I'll choose another item in browser", value: "__manual_takeover__" },
          { id: "cancel", label: "Cancel Task", value: "__cancel__" },
        ],
      };
    }

    // 2. Payment Method Selection vs Explicit Payment Authorization (Section 4)
    // Never assume selecting a payment method authorizes payment.
    if (obs.paymentSignals?.detected && !selections.paymentApproved) {
      const hasOptions = (obs.paymentSignals.options || []).length > 0;

      // Stage 2A: Ask which payment method to use if not yet chosen
      if (!selections.selectedPayment && hasOptions) {
        const payOpts = (obs.paymentSignals.options || []).slice(0, 6).map((opt, idx) => ({
          id: `pay_${idx + 1}`,
          label: opt,
          value: opt,
          kind: "payment",
        }));

        payOpts.push({
          id: "pay_manual",
          label: "I'll complete payment manually in browser",
          value: "__manual_takeover__",
        });
        payOpts.push({
          id: "pay_cancel",
          label: "Cancel Purchase",
          value: "__cancel__",
        });

        return {
          promptId: crypto.randomUUID(),
          category: "payment_permission",
          phase: "payment_method_selection",
          title: "Payment Method Selection",
          question: "Reached the payment/checkout stage. Which payment method should I select, or would you like to complete payment yourself?",
          reason: "Multiple payment options are available; selecting a method does NOT authorize payment yet.",
          requiresPermission: true,
          allowCustomInput: true,
          options: payOpts,
        };
      }

      // Stage 2B: If a payment method was chosen, let the agent click & verify it first before asking final authorization
      if (selections.selectedPayment && !selections.applied_payment) {
        return null;
      }

      // Stage 2C: Explicit final authorization before Place Order / Pay
      const activeMethod = selections.selectedPayment || obs.paymentSignals.selectedOption || "current payment method";
      return {
        promptId: crypto.randomUUID(),
        category: "payment_authorization",
        phase: "payment_authorization",
        title: "Explicit Payment Authorization Required",
        question: `Payment method "${activeMethod}" is ready on "${obs.title || obs.url}". Do you explicitly authorize placing the order / making payment now?`,
        reason: "Financial transactions and order placement always require explicit user authorization.",
        requiresPermission: true,
        allowCustomInput: true,
        options: [
          {
            id: "pay_authorize",
            label: `Authorize & Place Order (${activeMethod})`,
            value: "__authorize_payment__",
            kind: "payment_authorization",
          },
          ...(hasOptions
            ? [
                {
                  id: "pay_change",
                  label: "Change Payment Method",
                  value: "__change_payment__",
                },
              ]
            : []),
          {
            id: "pay_manual",
            label: "I'll complete payment manually in browser",
            value: "__manual_takeover__",
          },
          {
            id: "pay_cancel",
            label: "Cancel Purchase",
            value: "__cancel__",
          },
        ],
      };
    }

    // 3. Delivery Address Confirmation (ALWAYS ask if address options appear)
    if (obs.addressSignals?.detected && !selections.addressConfirmed) {
      const addrOpts = (obs.addressSignals.options || []).slice(0, 5).map((opt, idx) => ({
        id: `addr_${idx + 1}`,
        label: opt.length > 90 ? `${opt.slice(0, 87)}...` : opt,
        value: opt,
        kind: "address",
      }));

      if (!addrOpts.length) {
        addrOpts.push({
          id: "addr_confirm",
          label: "Approve current address & Deliver Here",
          value: "__address_ok__",
          kind: "address",
        });
      }
      addrOpts.push({
        id: "addr_cancel",
        label: "Cancel",
        value: "__cancel__",
      });

      return {
        promptId: crypto.randomUUID(),
        category: "address_confirmation",
        title: "Confirm Delivery Address",
        question: "Please confirm which delivery address to use before proceeding to checkout.",
        reason: "Address selection/confirmation requires your permission.",
        requiresPermission: true,
        allowCustomInput: true,
        options: addrOpts,
      };
    }

    // 4. Variant / Model / Storage / Color / Size Confusion
    for (const group of obs.variantGroups || []) {
      const kind = group.kind;
      const alreadyChosen = selections[`variant_${kind}`] || (kind === "storage" && spec.storage) || (kind === "color" && spec.color) || (kind === "size" && spec.size);
      if (alreadyChosen) continue;

      if (group.options && group.options.length >= 2) {
        return {
          promptId: crypto.randomUUID(),
          category: `${kind}_selection`,
          variantKind: kind,
          inputType: group.inputType,
          fieldSelector: group.fieldSelector,
          title: `Select ${kind.charAt(0).toUpperCase() + kind.slice(1)}`,
          question: `Multiple ${kind} options are available (${group.label}). Which one should I select?`,
          reason: `Your command didn't specify a unique ${kind}, so I paused to confirm before buying.`,
          requiresPermission: true,
          allowCustomInput: true,
          options: group.options.map((opt, idx) => ({
            id: `${kind}_${idx + 1}`,
            label: opt,
            value: opt,
            kind: `variant_${kind}`,
            inputType: group.inputType,
            fieldSelector: group.fieldSelector,
          })),
        };
      }
    }

    // 5. Product Disambiguation on search results
    if (
      !selections.selectedProduct &&
      !obs.actionButtons?.some((b) => /^(buy now|add to cart)$/i.test(b)) &&
      (obs.productCandidates || []).length >= 2
    ) {
      const topCandidates = obs.productCandidates.slice(0, 6);
      const topScore = topCandidates[0]?.score || 0;
      const similarTopCount = topCandidates.filter((c) => Math.abs(c.score - topScore) < 0.15).length;

      if (similarTopCount >= 2 || session.parsedGoal?.isPurchaseFlow) {
        return {
          promptId: crypto.randomUUID(),
          category: "product_selection",
          title: "Choose Product / Model",
          question: `I found multiple matching results for "${session.parsedGoal?.item || session.goal}". Which exact model should I open?`,
          reason: "Multiple models/listings matched your request; asking permission before selecting one.",
          requiresPermission: true,
          allowCustomInput: true,
          options: topCandidates.map((c, idx) => ({
            id: `prod_${idx + 1}`,
            label: c.price ? `${c.title} (${c.price})` : c.title,
            value: c.title,
            href: c.href,
            kind: "product",
          })),
        };
      }
    }

    return null;
  }

  //========================================================
  // LLM + DETERMINISTIC NEXT-STEP DECISION
  //========================================================

  async decideNextStepWithLLM(session, obs) {
    const prompt = `You are svgJarvis, an intelligent browser automation agent following PLAN -> OBSERVE -> ACT -> VERIFY -> UPDATE -> REPLAN.
The live browser state below is the source of truth. Never invent elements or assume an action succeeded without browser verification.
Never guess ambiguous models, variants, addresses, payment methods, or unexpected login/OTP/CAPTCHA states.
NEVER authorize or trigger payment / Place Order / Pay Now unless USER SELECTIONS explicitly has paymentApproved: true.

USER GOAL: ${session.goal}
PARSED GOAL: ${JSON.stringify(session.parsedGoal)}
RELEVANT RECENT CONVERSATION: ${JSON.stringify(session.conversationHistory || [])}
USER SELECTIONS SO FAR: ${JSON.stringify(session.userSelections)}
RECENT STEPS: ${JSON.stringify(session.stepHistory.slice(-5).map((s) => ({ tool: s.tool, args: s.args, status: s.status, success: s.success, evidence: s.evidence })))}

CURRENT BROWSER STATE:
URL: ${obs.url}
TITLE: ${obs.title}
SEARCH INPUTS: ${JSON.stringify(obs.searchInputs.slice(0, 3))}
ACTION BUTTONS: ${JSON.stringify(obs.actionButtons)}
VARIANT GROUPS: ${JSON.stringify(obs.variantGroups)}
PRODUCT CANDIDATES: ${JSON.stringify(obs.productCandidates.slice(0, 6))}
ORDER CONFIRMATION: ${JSON.stringify(obs.orderConfirmationSignals)}
PAGE TEXT EXCERPT: ${obs.bodyText.slice(0, 1500)}

Return ONLY JSON in one of these formats:
1) Execute one browser step based strictly on observed browser state:
{"decision":"act","what":"...","why":"...","step":{"tool":"navigate|click|type|select|press|scroll|wait","args":{...}}}
2) Ask user when confused or needing permission (model/variant/address/payment/login):
{"decision":"ask_user","category":"model_selection|color_selection|address_confirmation|payment_permission|payment_authorization|ambiguity","title":"...","question":"...","reason":"...","options":[{"label":"...","value":"..."}]}
3) Goal completed ONLY when verified in current browser state:
{"decision":"done","summary":"..."}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: "json",
          think: false,
          options: { temperature: 0, num_predict: 400 },
        }),
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const json = await res.json();
      const raw = String(json?.response || "").trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start === -1 || end <= start) return null;
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      clearTimeout(timer);
      return null;
    }
  }

  decideDeterministicNextStep(session, obs) {
    const { parsedGoal, userSelections, stepHistory } = session;

    // 0. If order confirmation is visible and payment was explicitly authorized, verify & complete!
    if (obs.orderConfirmationSignals?.detected && userSelections.paymentApproved) {
      const orderIdText = obs.orderConfirmationSignals.orderId
        ? ` (Order ID: ${obs.orderConfirmationSignals.orderId})`
        : "";
      return {
        decision: "done",
        verified: true,
        orderId: obs.orderConfirmationSignals.orderId || null,
        summary: `Order confirmed and verified in browser${orderIdText}.`,
      };
    }

    if (!parsedGoal.isPurchaseFlow) {
      return null;
    }

    // 1. Navigate to target website if not already on it (or if on error page)
    if (parsedGoal.targetUrl && (!this.isUrlOnTargetSite(obs.url, parsedGoal.site) || isRecoverableErrorUrl(obs.url))) {
      const alreadyNavigatedHealthy =
        !isRecoverableErrorUrl(obs.url) &&
        stepHistory.some((s) => s.tool === "navigate" && s.success);
      if (!alreadyNavigatedHealthy) {
        return {
          decision: "act",
          what: `Navigate to ${parsedGoal.targetUrl}`,
          why: "Target site is not currently loaded in the active browser tab.",
          step: { tool: "navigate", args: { url: parsedGoal.targetUrl } },
        };
      }
    }

    // 2. If item hasn't been searched on this site yet, find search box & type item
    const alreadySearched = stepHistory.some(
      (s) => s.tool === "type" && s.success && s.args?.value === parsedGoal.item,
    );
    if (parsedGoal.item && !alreadySearched && !obs.actionButtons?.some((b) => /^(buy now|add to cart)$/i.test(b))) {
      const searchBox = obs.searchInputs?.find((s) => s.isSearchLikely) || obs.searchInputs?.[0];
      if (searchBox) {
        const field = searchBox.id
          ? `#${searchBox.id}`
          : searchBox.name
            ? `input[name="${searchBox.name}"]`
            : searchBox.placeholder || "search";
        return {
          decision: "act",
          what: `Search for "${parsedGoal.item}"`,
          why: "Observed an active search input on the page and the item has not been searched yet.",
          step: {
            tool: "type",
            args: { field, value: parsedGoal.item, pressEnter: true },
          },
        };
      }
    }

    // 3. Apply user-selected address or payment option on the page before clicking continue/pay
    if (userSelections.selectedAddress && !userSelections.applied_address) {
      return {
        decision: "act",
        what: `Select delivery address "${userSelections.selectedAddress}"`,
        why: "Applying the delivery address confirmed by the user.",
        markApplied: "applied_address",
        step: { tool: "click", args: { target: userSelections.selectedAddress } },
      };
    }

    if (userSelections.selectedPayment && !userSelections.applied_payment) {
      return {
        decision: "act",
        what: `Select payment method "${userSelections.selectedPayment}"`,
        why: "Applying the user's preferred payment method before requesting final payment authorization.",
        markApplied: "applied_payment",
        step: { tool: "click", args: { target: userSelections.selectedPayment } },
      };
    }

    // 4. Apply any user-selected variant ONLY when that variant group is visible on the current page
    for (const [k, v] of Object.entries(userSelections)) {
      if (!k.startsWith("variant_") || !v) continue;
      const appliedKey = `applied_${k}`;
      if (userSelections[appliedKey]) continue;

      const kind = k.slice("variant_".length);
      const group = (obs.variantGroups || []).find((g) => g.kind === kind);
      const onProductPage = Boolean(group) || obs.actionButtons?.some((b) => /^(buy now|add to cart)$/i.test(b));
      if (!onProductPage) continue;

      const normalizeOpt = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
      if (group?.selectedOption && normalizeOpt(group.selectedOption) === normalizeOpt(v)) {
        userSelections[appliedKey] = true;
        continue;
      }

      const matchedOpt = (group?.options || []).find((opt) => normalizeOpt(opt) === normalizeOpt(v)) || v;

      if (group?.inputType === "select" && group.fieldSelector) {
        return {
          decision: "act",
          what: `Select ${kind} "${matchedOpt}"`,
          why: `Observed ${kind} dropdown on the product page.`,
          markApplied: appliedKey,
          step: { tool: "select", args: { field: group.fieldSelector, value: matchedOpt } },
        };
      }
      return {
        decision: "act",
        what: `Select ${kind} "${matchedOpt}"`,
        why: `Observed ${kind} options on the product page.`,
        markApplied: appliedKey,
        step: { tool: "click", args: { target: matchedOpt } },
      };
    }

    // 5. Click selected product if not yet opened
    if (userSelections.selectedProduct && !userSelections.openedSelectedProduct) {
      return {
        decision: "act",
        what: `Open selected product "${userSelections.selectedProduct}"`,
        why: "Opening the product chosen by the user from observed search results.",
        markApplied: "openedSelectedProduct",
        step: { tool: "click", args: { target: userSelections.selectedProduct } },
      };
    }

    // 6. If single product candidate found on search results, click it
    if (obs.productCandidates?.length === 1 && !obs.actionButtons?.some((b) => /^(buy now|add to cart)$/i.test(b))) {
      return {
        decision: "act",
        what: `Open "${obs.productCandidates[0].title}"`,
        why: "Observed a single matching product result.",
        markApplied: "openedSelectedProduct",
        step: { tool: "click", args: { target: obs.productCandidates[0].title } },
      };
    }

    // 7. On product / checkout page: click Buy Now / Add to Cart / Continue,
    //    and ONLY click Place Order / Pay after explicit paymentApproved authorization!
    if (parsedGoal.isPurchaseFlow && obs.actionButtons?.length) {
      const preferredOrder = [
        /^buy now$/i,
        /^add to cart$/i,
        /^go to cart$/i,
        /^proceed to checkout$/i,
        /^checkout$/i,
        /^deliver here$/i,
        /^save and deliver$/i,
        /^continue$/i,
        ...(userSelections.paymentApproved
          ? [/^place order$/i, /^pay now$/i, /^proceed to pay$/i, /^confirm order$/i, /^pay\b/i, /^submit order$/i]
          : []),
      ];
      for (const regex of preferredOrder) {
        const btn = obs.actionButtons.find((b) => regex.test(b));
        if (btn) {
          if (/^(place order|pay|proceed to pay|confirm order|submit order)/i.test(btn) && !userSelections.paymentApproved) {
            break;
          }
          const alreadyClickedSame = stepHistory
            .slice(-2)
            .some((s) => s.success && s.tool === "click" && s.args?.target === btn);
          if (!alreadyClickedSame) {
            return {
              decision: "act",
              what: `Click "${btn}"`,
              why: `Observed "${btn}" action button in the current browser state.`,
              step: { tool: "click", args: { target: btn } },
            };
          }
        }
      }
    }

    return null;
  }

  //========================================================
  // DYNAMIC BROWSER-DRIVEN PLANNING & VERIFICATION
  //========================================================

  deriveDynamicPlannedSteps(session, obs) {
    if (!obs) return [];
    if (!session.parsedGoal?.isPurchaseFlow) return [];
    const steps = [];
    const { parsedGoal, userSelections, stepHistory } = session;

    if (parsedGoal?.targetUrl && (!this.isUrlOnTargetSite(obs.url, parsedGoal.site) || isRecoverableErrorUrl(obs.url))) {
      steps.push({
        status: PLANNER_STATUS.PENDING,
        tool: "navigate",
        comment: `// Navigate to ${parsedGoal.targetUrl} and verify page load`,
        args: { url: parsedGoal.targetUrl },
      });
      return steps;
    }

    const alreadySearched = stepHistory.some(
      (s) => s.tool === "type" && s.success && s.args?.value === parsedGoal?.item,
    );
    if (
      parsedGoal?.item &&
      !alreadySearched &&
      obs.searchInputs?.length &&
      !obs.actionButtons?.some((b) => /^(buy now|add to cart)$/i.test(b))
    ) {
      steps.push({
        status: PLANNER_STATUS.PENDING,
        tool: "type",
        comment: `// Search for "${parsedGoal.item}" in observed search box & verify results`,
        args: { field: "search", value: parsedGoal.item },
      });
    }

    if (
      !userSelections.selectedProduct &&
      !obs.actionButtons?.some((b) => /^(buy now|add to cart)$/i.test(b)) &&
      (obs.productCandidates || []).length >= 1
    ) {
      steps.push({
        status: (obs.productCandidates || []).length >= 2 ? PLANNER_STATUS.WAITING_FOR_USER : PLANNER_STATUS.PENDING,
        tool: "click",
        comment:
          obs.productCandidates.length >= 2
            ? `// Inspect ${obs.productCandidates.length} matching results & clarify product choice`
            : `// Open matching product "${obs.productCandidates[0].title}"`,
        args: { target: parsedGoal?.item || "product" },
      });
    }

    for (const group of obs.variantGroups || []) {
      const chosen = userSelections[`variant_${group.kind}`];
      const applied = userSelections[`applied_variant_${group.kind}`];
      if (!applied) {
        steps.push({
          status: chosen ? PLANNER_STATUS.PENDING : PLANNER_STATUS.WAITING_FOR_USER,
          tool: group.inputType === "select" ? "select" : "click",
          comment: chosen
            ? `// Select ${group.kind} "${chosen}" & verify selection`
            : `// Inspect ${group.kind} options (${group.options.slice(0, 3).join(", ")}) & clarify`,
          args: { target: chosen || group.kind },
        });
      }
    }

    if (obs.addressSignals?.detected && !userSelections.addressConfirmed) {
      steps.push({
        status: PLANNER_STATUS.WAITING_FOR_USER,
        tool: "click",
        comment: "// Inspect delivery address options & confirm with user",
        args: { target: "Delivery Address" },
      });
    }

    if (obs.paymentSignals?.detected && !userSelections.paymentApproved) {
      steps.push({
        status:
          userSelections.selectedPayment && !userSelections.applied_payment
            ? PLANNER_STATUS.PENDING
            : PLANNER_STATUS.WAITING_FOR_USER,
        tool: "click",
        comment: !userSelections.selectedPayment
          ? "// Inspect payment options & ask preferred method"
          : !userSelections.applied_payment
            ? `// Select payment method "${userSelections.selectedPayment}" & verify`
            : "// Request explicit authorization before Place Order / Pay",
        args: { target: userSelections.selectedPayment || "Payment Method" },
      });
    }

    if (
      obs.paymentSignals?.detected &&
      userSelections.paymentApproved &&
      !obs.orderConfirmationSignals?.detected
    ) {
      const payBtn = obs.actionButtons?.find((b) =>
        /^(place order|pay now|proceed to pay|confirm order|pay\b|submit order)/i.test(b),
      );
      if (payBtn) {
        steps.push({
          status: PLANNER_STATUS.PENDING,
          tool: "click",
          comment: `// Execute authorized "${payBtn}" & verify order confirmation`,
          args: { target: payBtn },
        });
      }
    }

    return steps;
  }

  async verifyExecutedStepInBrowser(page, session, step, outcome, preObs) {
    if (!outcome?.success) {
      return {
        verified: false,
        evidence: outcome?.error || `Execution of ${step.tool} failed.`,
        postObs: preObs,
      };
    }

    let postObs = preObs;
    try {
      postObs = await this.observePage(page, session.parsedGoal);
    } catch (err) {
      return {
        verified: false,
        evidence: `Unable to inspect browser state after ${step.tool}: ${err.message}`,
        postObs: preObs,
      };
    }

    if (step.tool === "navigate") {
      const ok =
        Boolean(postObs.url) &&
        !isRecoverableErrorUrl(postObs.url) &&
        (!session.parsedGoal?.targetUrl || this.isUrlOnTargetSite(postObs.url, session.parsedGoal.site));
      return {
        verified: ok,
        evidence: ok
          ? `Loaded ${postObs.url} (title: "${postObs.title || "untitled"}")`
          : `Unexpected navigation URL: ${postObs.url}`,
        postObs,
      };
    }

    if (step.tool === "type") {
      const urlChanged = postObs.url !== preObs?.url;
      const hasResults = (postObs.productCandidates || []).length > 0;
      const inputMatched = (postObs.searchInputs || []).some(
        (s) => String(s.value || "").toLowerCase() === String(step.args?.value || "").toLowerCase(),
      );
      const verified = urlChanged || hasResults || inputMatched || Boolean(outcome.verification?.verified);
      return {
        verified,
        evidence: urlChanged
          ? `Search navigated to ${postObs.url} (${postObs.productCandidates?.length || 0} candidate(s) visible)`
          : hasResults
            ? `Search results appeared (${postObs.productCandidates.length} candidate(s))`
            : inputMatched
              ? `Search input confirmed value "${step.args?.value}"`
              : outcome.verification?.message || "Typed text verified",
        postObs,
      };
    }

    if (step.tool === "select") {
      const val = String(step.args?.value || "").toLowerCase().replace(/\s+/g, "");
      const matchedGroup = (postObs.variantGroups || []).find(
        (g) => g.selectedOption && g.selectedOption.toLowerCase().replace(/\s+/g, "") === val,
      );
      const verified = Boolean(matchedGroup) || Boolean(outcome.verification?.verified);
      return {
        verified,
        evidence: matchedGroup
          ? `Verified dropdown selection "${matchedGroup.selectedOption}"`
          : outcome.verification?.message || `Selected "${step.args?.value}"`,
        postObs,
      };
    }

    if (step.tool === "click") {
      const urlChanged = postObs.url !== preObs?.url;
      const targetLower = String(step.args?.target || "").toLowerCase().replace(/\s+/g, "");
      const variantSelected = (postObs.variantGroups || []).some(
        (g) => g.selectedOption && g.selectedOption.toLowerCase().replace(/\s+/g, "") === targetLower,
      );
      const paymentSelected =
        postObs.paymentSignals?.selectedOption &&
        postObs.paymentSignals.selectedOption.toLowerCase().replace(/\s+/g, "").includes(targetLower);
      const orderConfirmed = Boolean(postObs.orderConfirmationSignals?.detected);

      const evidence = orderConfirmed
        ? `Order confirmation detected${postObs.orderConfirmationSignals.orderId ? ` (Order ID: ${postObs.orderConfirmationSignals.orderId})` : ""}`
        : variantSelected
          ? `Verified variant selection "${step.args?.target}" in DOM`
          : paymentSelected
            ? `Verified payment method "${postObs.paymentSignals.selectedOption}" selected`
            : urlChanged
              ? `Clicked "${step.args?.target}" and page transitioned to ${postObs.url}`
              : outcome.verification?.message || `Clicked "${step.args?.target}" on ${postObs.url}`;

      return {
        verified: Boolean(outcome.verification?.verified ?? true),
        evidence,
        postObs,
      };
    }

    return {
      verified: Boolean(outcome.verification?.verified ?? true),
      evidence: outcome.verification?.message || `Verified ${step.tool} on ${postObs.url}`,
      postObs,
    };
  }

  async checkBrowserHealthAndDirection(page, session, step, phase = "before", outcome = null) {
    const currentUrl = page && !page.isClosed() ? page.url() : "";
    let readyState = "unknown";
    if (page && !page.isClosed()) {
      readyState = await page.evaluate(() => document.readyState).catch(() => "unknown");
    }

    const onErrorPage = isRecoverableErrorUrl(currentUrl) && currentUrl.startsWith("chrome-error://");
    const onTargetSite = session.parsedGoal?.targetUrl
      ? this.isUrlOnTargetSite(currentUrl, session.parsedGoal.site)
      : true;

    let directionAligned = !onErrorPage && !page?.isClosed?.();
    let directionNote = "";

    if (onErrorPage) {
      directionAligned = false;
      directionNote = `Browser is on error page (${currentUrl}); self-healing required`;
    } else if (step?.tool === "navigate") {
      if (phase === "after") {
        directionAligned = Boolean(outcome?.success) && !onErrorPage;
        directionNote = directionAligned
          ? `Browser loaded ${currentUrl} (${readyState}) — on track`
          : `Navigation did not reach target page (${currentUrl})`;
      } else {
        directionNote = `Preparing to navigate browser to ${step.args?.url || "target"}`;
      }
    } else if (session.parsedGoal?.targetUrl && !onTargetSite) {
      directionAligned = false;
      directionNote = `Browser (${currentUrl}) drifted from target site (${session.parsedGoal.targetUrl})`;
    } else {
      directionNote = `Browser verified at ${currentUrl || "active tab"} (${readyState}) — direction aligned`;
    }

    return {
      phase,
      url: currentUrl,
      readyState,
      onErrorPage,
      onTargetSite,
      directionAligned,
      directionNote,
    };
  }

  generateStepComment(step, outcome, preCheck, postCheck) {
    const healedTag = outcome?.healing?.recovered
      ? ` [Auto-Healed via ${(outcome.healing.strategies || []).join(", ") || "recovery"}]`
      : "";

    if (!outcome?.success) {
      return `// Step failed (${step.tool}): ${outcome?.error || "could not verify"}`;
    }

    if (step.tool === "navigate") {
      const finalUrl = outcome?.result?.url || step.args?.url || postCheck?.url || "";
      return `// Open ${finalUrl} & verify browser ready${healedTag}`;
    }
    if (step.tool === "type") {
      return `// Search "${step.args?.value || ""}" in ${step.args?.field || "input"} & check results${healedTag}`;
    }
    if (step.tool === "select") {
      return `// Select "${step.args?.value || ""}" in ${step.args?.field || "dropdown"}${healedTag}`;
    }
    if (step.tool === "click") {
      return `// Click "${step.args?.target || ""}" & verify page progression${healedTag}`;
    }
    return `// Execute ${step.tool}${healedTag}`;
  }

  getRemainingBlueprintSteps(session) {
    if (Array.isArray(session.dynamicPlannedSteps) && session.dynamicPlannedSteps.length) {
      return session.dynamicPlannedSteps;
    }
    return this.deriveDynamicPlannedSteps(session, session.lastObservation);
  }

  buildCompletionReport(session) {
    const completedSteps = session.stepHistory
      .filter((s) => s.status === PLANNER_STATUS.COMPLETED || (s.status !== PLANNER_STATUS.FAILED && s.success))
      .map((s) => ({
        step: s.step,
        status: s.status || PLANNER_STATUS.COMPLETED,
        tool: s.tool,
        what: s.what || s.comment || s.tool,
        evidence: s.evidence || s.verification?.message || "",
      }));

    const remainingSteps =
      session.status === "completed" || session.status === "cancelled"
        ? []
        : this.getRemainingBlueprintSteps(session);

    const isCompleted = session.status === "completed" && Boolean(session.goalVerified);
    let reasonForWaiting = null;
    let exactActionRequired = null;

    if (session.pendingPrompt) {
      reasonForWaiting = session.pendingPrompt.reason || session.pendingPrompt.question || "Waiting for user input.";
      exactActionRequired = session.pendingPrompt.question || "Please choose an option or provide guidance.";
    } else if (session.status === "waiting_for_user") {
      reasonForWaiting = session.waitingReason || "Workflow paused before final payment or sensitive action.";
      exactActionRequired =
        session.exactActionRequired || "Complete the remaining step manually in the browser tab.";
    }

    return {
      overallStatus: isCompleted
        ? PLANNER_STATUS.COMPLETED
        : session.status === "failed"
          ? PLANNER_STATUS.FAILED
          : session.status === "cancelled"
            ? "CANCELLED"
            : PLANNER_STATUS.WAITING_FOR_USER,
      goalCompleted: isCompleted,
      completedSteps,
      remainingSteps,
      reasonForWaiting,
      exactActionRequired,
    };
  }

  //========================================================
  // SESSION MANAGEMENT: START & RESUME
  //========================================================

  async startSession(command, context = {}) {
    this.pruneSessions();
    const parsedGoal = this.parseGoal(command);
    const session = {
      sessionId: crypto.randomUUID(),
      goal: String(command || "").trim(),
      parsedGoal,
      blueprint: [],
      dynamicPlannedSteps: [],
      lastObservation: null,
      status: "running",
      goalVerified: false,
      waitingReason: "",
      exactActionRequired: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stepHistory: [],
      userSelections: {
        ...(parsedGoal.specifiedAttributes.storage ? { variant_storage: parsedGoal.specifiedAttributes.storage } : {}),
        ...(parsedGoal.specifiedAttributes.color ? { variant_color: parsedGoal.specifiedAttributes.color } : {}),
        ...(parsedGoal.specifiedAttributes.size ? { variant_size: parsedGoal.specifiedAttributes.size } : {}),
      },
      pendingPrompt: null,
      activePage: context.page || null,
      conversationHistory: Array.isArray(context.conversationHistory)
        ? context.conversationHistory.slice(-16).map((turn) => ({
            role: turn.role,
            content: String(turn.content || "").slice(0, 1200),
          }))
        : [],
      summary: "",
    };

    this.sessions.set(session.sessionId, session);
    return await this.runLoop(session);
  }

  async respondToSession(sessionId, response = {}) {
    this.pruneSessions();
    const session = this.sessions.get(String(sessionId || "").trim());
    if (!session) {
      throw new Error("Interactive agent session not found or expired.");
    }

    if (response.cancelled || response.choice === "__cancel__") {
      session.status = "cancelled";
      session.goalVerified = false;
      session.pendingPrompt = null;
      session.updatedAt = Date.now();
      return this.formatSessionResponse(session, "Task cancelled by user.");
    }

    const prompt = session.pendingPrompt || {};
    const answer = String(response.customInput || response.choice || "").trim();

    if (answer === "__manual_takeover__") {
      session.status = "waiting_for_user";
      session.goalVerified = false;
      session.waitingReason = prompt.reason || "User chose to complete the remaining checkout/payment manually in the browser.";
      session.exactActionRequired = "Complete the final checkout/payment action directly in the open browser tab.";
      session.pendingPrompt = null;
      session.updatedAt = Date.now();
      return this.formatSessionResponse(
        session,
        "Paused before final transaction so you can complete it manually in the browser.",
      );
    }

    if (answer === "__change_payment__") {
      delete session.userSelections.selectedPayment;
      delete session.userSelections.applied_payment;
      delete session.userSelections.paymentApproved;
      session.pendingPrompt = null;
      session.status = "running";
      session.updatedAt = Date.now();
      return await this.runLoop(session);
    }

    // Record user's decision into session state
    if (prompt.category === "login_required") {
      session.userSelections.authAcknowledged = true;
    } else if (prompt.category === "address_confirmation") {
      session.userSelections.addressConfirmed = answer || "__address_ok__";
      if (answer && answer !== "__address_ok__") {
        session.userSelections.selectedAddress = answer;
      }
    } else if (prompt.category === "payment_authorization") {
      if (answer === "__authorize_payment__" || answer.toLowerCase() === "yes" || answer.toLowerCase() === "approve") {
        session.userSelections.paymentApproved = true;
      } else if (answer) {
        session.userSelections.selectedPayment = answer;
        session.userSelections.applied_payment = false;
      }
    } else if (prompt.category === "payment_permission") {
      // Selecting a payment method NEVER authorizes payment by itself (Section 4).
      if (answer === "__authorize_payment__") {
        session.userSelections.paymentApproved = true;
      } else if (answer) {
        session.userSelections.selectedPayment = answer;
        session.userSelections.applied_payment = false;
      }
    } else if (prompt.category === "product_selection") {
      session.userSelections.selectedProduct = answer;
    } else if (prompt.variantKind) {
      session.userSelections[`variant_${prompt.variantKind}`] = answer;
    } else if (answer && answer !== "__retry__") {
      session.userSelections[`answer_${session.stepHistory.length}`] = answer;
    }

    session.pendingPrompt = null;
    session.status = "running";
    session.updatedAt = Date.now();

    return await this.runLoop(session);
  }

  cancelSession(sessionId) {
    const session = this.sessions.get(String(sessionId || "").trim());
    if (!session) return { success: true, cancelled: false };
    session.status = "cancelled";
    session.goalVerified = false;
    session.pendingPrompt = null;
    this.sessions.delete(session.sessionId);
    return { success: true, cancelled: true };
  }

  async runLoop(session, maxIterations = 12) {
    let page = session.activePage || (await this.browser.getPage());

    for (let iter = 0; iter < maxIterations; iter++) {
      session.updatedAt = Date.now();

      // Always dismiss non-destructive blocking modals (like login-nag ✕) before observing
      if (typeof this.executor.dismissBlockingOverlays === "function") {
        await this.executor.dismissBlockingOverlays(page);
      }

      const obs = await this.observePage(page, session.parsedGoal);
      session.lastObservation = obs;
      session.dynamicPlannedSteps = this.deriveDynamicPlannedSteps(session, obs);

      // 1. Check mandatory confusion / permission / unexpected-state gates
      const gatePrompt = this.evaluatePermissionAndConfusion(session, obs);
      if (gatePrompt) {
        session.status = "needs_input";
        session.goalVerified = false;
        session.pendingPrompt = gatePrompt;
        return this.formatSessionResponse(session);
      }

      // 2. Decide next action (deterministic fast-progression first for clear steps, then LLM)
      let decision = this.decideDeterministicNextStep(session, obs);
      if (!decision) {
        decision = await this.decideNextStepWithLLM(session, obs);
      }

      if (!decision) {
        session.status = "needs_input";
        session.goalVerified = false;
        session.pendingPrompt = {
          promptId: crypto.randomUUID(),
          category: "ambiguity",
          title: "Need Your Guidance",
          question: `I'm on "${obs.title || obs.url}" and need your instruction on what to select or click next for "${session.goal}".`,
          reason: "Could not unambiguously determine the next action on this page.",
          requiresPermission: true,
          allowCustomInput: true,
          options: [
            ...(obs.actionButtons || []).slice(0, 4).map((b, idx) => ({
              id: `btn_${idx + 1}`,
              label: `Click "${b}"`,
              value: b,
            })),
            { id: "done", label: "I'll take it from here", value: "__manual_takeover__" },
            { id: "cancel", label: "Cancel", value: "__cancel__" },
          ],
        };
        return this.formatSessionResponse(session);
      }

      if (decision.decision === "ask_user") {
        session.status = "needs_input";
        session.goalVerified = false;
        session.pendingPrompt = {
          promptId: crypto.randomUUID(),
          category: decision.category || "ambiguity",
          title: decision.title || "Clarification / Permission Needed",
          question: decision.question || "How should I proceed?",
          reason: decision.reason || "Model requested user confirmation before proceeding.",
          requiresPermission: true,
          allowCustomInput: true,
          options: Array.isArray(decision.options) && decision.options.length
            ? decision.options
            : [{ id: "cancel", label: "Cancel", value: "__cancel__" }],
        };
        return this.formatSessionResponse(session);
      }

      if (decision.decision === "done") {
        // Never mark a purchase flow COMPLETED unless order confirmation is verified in browser!
        if (session.parsedGoal?.isPurchaseFlow && !obs.orderConfirmationSignals?.detected) {
          session.status = "needs_input";
          session.goalVerified = false;
          session.pendingPrompt = {
            promptId: crypto.randomUUID(),
            category: "verification_required",
            title: "Order Completion Not Verified",
            question: `I cannot verify an order confirmation on "${obs.title || obs.url}". Would you like to continue in browser or cancel?`,
            reason: "svgJarvis never marks a purchase task COMPLETED without browser-based verification.",
            requiresPermission: true,
            allowCustomInput: true,
            options: [
              { id: "manual", label: "I'll check/finish in browser", value: "__manual_takeover__" },
              { id: "cancel", label: "Cancel", value: "__cancel__" },
            ],
          };
          return this.formatSessionResponse(session);
        }

        session.status = "completed";
        session.goalVerified = true;
        session.dynamicPlannedSteps = [];
        session.summary = decision.summary || "Task completed and verified in browser.";
        return this.formatSessionResponse(session, session.summary);
      }

      // 3. Guard LLM step if it attempts payment/order without explicit paymentApproved authorization
      const step = decision.step;
      if (!step || !step.tool) {
        session.status = "failed";
        session.goalVerified = false;
        return this.formatSessionResponse(session, "Agent produced an empty step.");
      }

      if (
        step.tool === "click" &&
        /^(place order|pay|pay now|proceed to pay|confirm order|submit order)/i.test(String(step.args?.target || "")) &&
        !session.userSelections.paymentApproved
      ) {
        session.status = "needs_input";
        session.goalVerified = false;
        session.pendingPrompt = {
          promptId: crypto.randomUUID(),
          category: "payment_authorization",
          title: "Explicit Payment Authorization Required",
          question: `Ready to click "${step.args.target}". Do you explicitly authorize placing the order / making payment?`,
          reason: "Order placement and payment require explicit user authorization.",
          requiresPermission: true,
          allowCustomInput: true,
          options: [
            { id: "approve_pay", label: `Authorize & Click "${step.args.target}"`, value: "__authorize_payment__" },
            { id: "manual", label: "I'll finish payment myself", value: "__manual_takeover__" },
            { id: "cancel", label: "Cancel", value: "__cancel__" },
          ],
        };
        return this.formatSessionResponse(session);
      }

      // 4. Create live IN_PROGRESS step entry before acting (never left in IN_PROGRESS)
      const stepRecord = {
        index: session.stepHistory.length,
        step: session.stepHistory.length + 1,
        status: PLANNER_STATUS.IN_PROGRESS,
        tool: step.tool,
        args: step.args,
        what: decision.what || `${step.tool} ${JSON.stringify(step.args || {})}`,
        why: decision.why || "Derived from live browser state.",
        evidence: "",
        nextAction: "Inspecting browser state after execution...",
        comment: "",
        browserCheck: null,
        success: false,
        result: null,
        healing: null,
        verification: null,
        duration: 0,
      };
      session.stepHistory.push(stepRecord);

      // 5. Pre-step browser & direction check (recover if tab drifted or landed on chrome-error://)
      const preCheck = await this.checkBrowserHealthAndDirection(page, session, step, "before");
      if (preCheck.onErrorPage && step.tool !== "navigate" && session.parsedGoal?.targetUrl) {
        this.log("Pre-step browser check detected error page; redirecting back to", session.parsedGoal.targetUrl);
        await this.executor.execute({ tool: "navigate", args: { url: session.parsedGoal.targetUrl } }, page);
      }

      // 6. Execute step via Self-Healing ExecutionEngine & track newly opened tabs
      const pagesBefore = page.context ? page.context().pages() : [];
      const started = performance.now();
      let outcome = await this.executor.execute(step, page);

      // Agent-level self-healing fallback if step still failed
      if (!outcome.success && step.tool === "type" && session.parsedGoal?.targetUrl) {
        await this.executor.dismissBlockingOverlays?.(page);
        await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
        const retryOutcome = await this.executor.execute(step, page);
        if (retryOutcome.success) {
          outcome = {
            ...retryOutcome,
            healing: {
              recovered: true,
              attempts: (outcome.healing?.attempts || 1) + (retryOutcome.healing?.attempts || 1),
              strategies: [...(outcome.healing?.strategies || []), "agent_overlay_reset_retry"],
            },
          };
        }
      }

      const duration = performance.now() - started;
      const effectiveArgs = outcome.args || step.args;

      // Check if click opened a new tab (e.g. Flipkart product details open in a new tab)
      await new Promise((r) => setTimeout(r, 350));
      const pagesAfter = page.context ? page.context().pages() : [];
      if (outcome.success && pagesAfter.length > pagesBefore.length) {
        const newestPage = pagesAfter.find((p) => !pagesBefore.includes(p) && !p.isClosed());
        if (newestPage && (!this.browser.isAutomationPage || this.browser.isAutomationPage(newestPage))) {
          await newestPage.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
          page = newestPage;
          session.activePage = newestPage;
          if (this.browser) {
            this.browser.page = newestPage;
            this.browser.lastURL = newestPage.url();
          }
          this.log("Switched to newly opened tab:", newestPage.url());
        }
      } else {
        await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
      }

      // 7. Mandatory browser-based post-action verification & status update
      const postCheck = await this.checkBrowserHealthAndDirection(page, session, { ...step, args: effectiveArgs }, "after", outcome);
      const browserVerification = await this.verifyExecutedStepInBrowser(page, session, { ...step, args: effectiveArgs }, outcome, obs);
      const stepSucceeded = Boolean(outcome.success && browserVerification.verified);
      const comment = this.generateStepComment({ ...step, args: effectiveArgs }, { ...outcome, success: stepSucceeded }, preCheck, postCheck);

      session.lastObservation = browserVerification.postObs || obs;
      session.dynamicPlannedSteps = this.deriveDynamicPlannedSteps(session, session.lastObservation);

      stepRecord.args = effectiveArgs;
      if (outcome.healing?.recovered) {
        stepRecord.originalArgs = step.args;
      }
      stepRecord.status = stepSucceeded ? PLANNER_STATUS.COMPLETED : PLANNER_STATUS.FAILED;
      stepRecord.success = stepSucceeded;
      stepRecord.comment = comment;
      stepRecord.browserCheck = postCheck;
      stepRecord.evidence = browserVerification.evidence;
      stepRecord.nextAction =
        session.dynamicPlannedSteps[0]?.comment?.replace(/^\/\/\s*/, "") ||
        "Re-inspecting browser state for next action";
      stepRecord.result = outcome.result || outcome;
      stepRecord.healing = outcome.healing;
      stepRecord.verification = {
        ...(outcome.verification || {}),
        verified: stepSucceeded,
        message: browserVerification.evidence || outcome.verification?.message || "",
      };
      stepRecord.duration = duration;

      if (decision.markApplied && stepSucceeded) {
        session.userSelections[decision.markApplied] = true;
      }

      // If order confirmation is already visible after an authorized click, complete immediately!
      if (
        stepSucceeded &&
        session.userSelections.paymentApproved &&
        browserVerification.postObs?.orderConfirmationSignals?.detected
      ) {
        const orderId = browserVerification.postObs.orderConfirmationSignals.orderId;
        session.status = "completed";
        session.goalVerified = true;
        session.dynamicPlannedSteps = [];
        session.summary = `Order confirmed and verified in browser${orderId ? ` (Order ID: ${orderId})` : ""}.`;
        return this.formatSessionResponse(session, session.summary);
      }

      if (!stepSucceeded) {
        session.status = "needs_input";
        session.goalVerified = false;
        session.pendingPrompt = {
          promptId: crypto.randomUUID(),
          category: "step_recovery",
          title: "Step Needs Assistance",
          question: `I tried "${step.tool}" (${JSON.stringify(effectiveArgs)}) but browser verification could not confirm completion (${outcome.error || browserVerification.evidence}). How would you like to proceed?`,
          reason: "Browser verification or self-healing could not complete this step automatically.",
          requiresPermission: true,
          allowCustomInput: true,
          options: [
            { id: "retry", label: "Retry Step", value: "__retry__" },
            { id: "manual", label: "I'll handle this in browser", value: "__manual_takeover__" },
            { id: "cancel", label: "Cancel Task", value: "__cancel__" },
          ],
        };
        return this.formatSessionResponse(session);
      }
    }

    // Never report an unfinished task as completed when iteration limit is reached
    session.status = "needs_input";
    session.goalVerified = false;
    session.pendingPrompt = {
      promptId: crypto.randomUUID(),
      category: "iteration_limit",
      title: "Paused — Verification Needed",
      question: `Executed ${session.stepHistory.length} steps and reached the step safety limit without verifying final goal completion. Would you like me to continue or take over in the browser?`,
      reason: "Reached iteration limit before goal completion could be verified in the browser.",
      requiresPermission: true,
      allowCustomInput: true,
      options: [
        { id: "continue", label: "Continue Executing", value: "__retry__" },
        { id: "manual", label: "I'll finish in browser", value: "__manual_takeover__" },
        { id: "cancel", label: "Cancel Task", value: "__cancel__" },
      ],
    };
    return this.formatSessionResponse(session, "Paused before final completion verification.");
  }

  formatSessionResponse(session, summary = "") {
    const executedSteps = session.stepHistory.map((s) => ({
      step: s.step,
      status: s.status || (s.success ? PLANNER_STATUS.COMPLETED : PLANNER_STATUS.FAILED),
      tool: s.tool,
      args: s.args,
      what: s.what,
      why: s.why,
      evidence: s.evidence,
      nextAction: s.nextAction,
      comment: s.comment,
      browserCheck: s.browserCheck,
      success: s.success,
      verification: s.verification,
    }));
    const upcomingSteps =
      session.status === "completed" || session.status === "cancelled"
        ? []
        : this.getRemainingBlueprintSteps(session);
    const completionReport = this.buildCompletionReport(session);

    return {
      success: session.status !== "failed",
      mode: "action",
      interactive: true,
      agent: "svgJarvis",
      status: session.status,
      plannerStatus: completionReport.overallStatus,
      goalVerified: Boolean(session.goalVerified),
      sessionId: session.sessionId,
      command: session.goal,
      parsedGoal: session.parsedGoal,
      summary: summary || session.summary || "",
      pendingPrompt: session.pendingPrompt,
      completionReport,
      steps: session.stepHistory,
      plan: {
        mode: "action",
        source: "interactive-agent",
        goal: session.goal,
        blueprint: session.blueprint || [],
        steps: executedSteps,
        plannedSteps: upcomingSteps,
      },
    };
  }
}
