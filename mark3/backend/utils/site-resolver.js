//==========================================================
//
// backend/utils/site-resolver.js
//
// Generic Site URL Resolver & Navigation Self-Healing
//
// Responsibilities
// ----------------
// 1. Resolve canonical URLs for common sites & typos
//    (e.g. "flipart", "flipcart", "amazon webite" -> real URL)
// 2. Strip trailing UI noise words ("website", "webite", "site", "app")
// 3. Heal failed navigation URLs (ERR_CERT_COMMON_NAME_INVALID,
//    ERR_NAME_NOT_RESOLVED, etc.) via fuzzy domain match or search fallback
//
//==========================================================

export const KNOWN_SITE_URLS = Object.freeze({
  flipkart: "https://www.flipkart.com",
  amazon: "https://www.amazon.in",
  myntra: "https://www.myntra.com",
  ajio: "https://www.ajio.com",
  meesho: "https://www.meesho.com",
  nykaa: "https://www.nykaa.com",
  croma: "https://www.croma.com",
  reliancedigital: "https://www.reliancedigital.in",
  tatacliq: "https://www.tatacliq.com",
  jiomart: "https://www.jiomart.com",
  bigbasket: "https://www.bigbasket.com",
  blinkit: "https://blinkit.com",
  zepto: "https://www.zeptonow.com",
  zomato: "https://www.zomato.com",
  swiggy: "https://www.swiggy.com",
  makemytrip: "https://www.makemytrip.com",
  goibibo: "https://www.goibibo.com",
  irctc: "https://www.irctc.co.in",
  snapdeal: "https://www.snapdeal.com",
  ebay: "https://www.ebay.com",
  walmart: "https://www.walmart.com",
  apple: "https://www.apple.com",
  samsung: "https://www.samsung.com",
  github: "https://github.com",
  google: "https://www.google.com",
  youtube: "https://www.youtube.com",
  wikipedia: "https://www.wikipedia.org",
});

const SITE_ALIASES = Object.freeze({
  flipcart: "flipkart",
  flipart: "flipkart",
  flipkrt: "flipkart",
  flpkart: "flipkart",
  fk: "flipkart",
  amazn: "amazon",
  amzon: "amazon",
  amozon: "amazon",
  amzn: "amazon",
  gogle: "google",
  googl: "google",
  youtub: "youtube",
  yt: "youtube",
  myntraa: "myntra",
  mintra: "myntra",
  makmytrip: "makemytrip",
  mmt: "makemytrip",
});

const SITE_NOISE_REGEX = /\b(?:website|webite|web\s*site|site|portal|webpage|web\s*page|app|store)\b/gi;

export function stripSiteNoise(text) {
  return String(text || "")
    .replace(SITE_NOISE_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a, b) {
  const s = String(a || "");
  const t = String(b || "");
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  const dp = Array.from({ length: s.length + 1 }, () => new Array(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i++) dp[i][0] = i;
  for (let j = 0; j <= t.length; j++) dp[0][j] = j;

  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[s.length][t.length];
}

export function fuzzyMatchSiteKey(rawName) {
  const clean = stripSiteNoise(rawName)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.(com|in|org|net|co\.in|io|ai).*$/, "")
    .replace(/[^a-z0-9]/g, "");

  if (!clean) return null;
  if (KNOWN_SITE_URLS[clean]) return clean;
  if (SITE_ALIASES[clean]) return SITE_ALIASES[clean];

  let bestKey = null;
  let bestDist = Infinity;
  const maxAllowed = clean.length >= 6 ? 2 : clean.length >= 4 ? 1 : 0;

  if (maxAllowed > 0) {
    for (const key of Object.keys(KNOWN_SITE_URLS)) {
      if (Math.abs(key.length - clean.length) > maxAllowed) continue;
      const dist = levenshtein(clean, key);
      if (dist <= maxAllowed && dist < bestDist) {
        bestDist = dist;
        bestKey = key;
      }
    }
  }

  return bestKey;
}

export function resolveSiteUrl(site) {
  if (!site) return "";
  const cleaned = stripSiteNoise(site);
  const s = cleaned.toLowerCase();
  if (!s) return "";

  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const base = u.hostname.toLowerCase().replace(/^www\./, "").split(".")[0];
      const matched = fuzzyMatchSiteKey(base);
      if (matched && base !== matched) {
        return KNOWN_SITE_URLS[matched];
      }
      return u.toString();
    } catch {
      return s;
    }
  }

  const matchedKey = fuzzyMatchSiteKey(s);
  if (matchedKey) {
    return KNOWN_SITE_URLS[matchedKey];
  }

  if (s.includes(".") && !s.includes(" ")) {
    return `https://${s}`;
  }

  const slug = s.replace(/\s+/g, "");
  return `https://www.${slug}.com`;
}

export function healFailedNavigationUrl(failedUrl, attempt = 0) {
  const raw = String(failedUrl || "").trim();
  if (!raw) return null;

  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const base = host.split(".")[0];

    // Attempt 0: fuzzy match misspelled domain against canonical known sites
    const matched = fuzzyMatchSiteKey(base);
    if (matched) {
      const canonical = KNOWN_SITE_URLS[matched];
      if (canonical && !raw.toLowerCase().startsWith(canonical.toLowerCase())) {
        return {
          url: canonical,
          strategy: "fuzzy_domain_correction",
          reason: `Corrected misspelled domain "${host}" -> "${new URL(canonical).hostname}"`,
        };
      }
    }

    // Attempt 1: try alternate common TLD (.com <-> .in)
    if (attempt === 0 && host.endsWith(".com")) {
      const alt = `https://www.${base}.in${parsed.pathname === "/" ? "" : parsed.pathname}`;
      return {
        url: alt,
        strategy: "alternate_tld_in",
        reason: `Retried "${host}" with .in domain`,
      };
    }

    // Final fallback: search engine lookup instead of staying stuck on chrome-error://
    return {
      url: `https://www.google.com/search?q=${encodeURIComponent(base || host)}`,
      strategy: "search_fallback",
      reason: `Domain "${host}" unreachable; fell back to search lookup`,
    };
  } catch {
    return {
      url: `https://www.google.com/search?q=${encodeURIComponent(raw)}`,
      strategy: "search_fallback",
      reason: `Invalid URL "${raw}"; fell back to search lookup`,
    };
  }
}

export function isRecoverableErrorUrl(url) {
  const u = String(url || "").trim().toLowerCase();
  return !u || u === "about:blank" || u.startsWith("chrome-error://");
}
