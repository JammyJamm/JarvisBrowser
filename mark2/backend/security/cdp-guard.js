// backend/security/cdp-guard.js
// CDP Security Guard & Authentication Coordinator
// Ensures Chromium Remote Debugging is strictly bound to localhost with active capability token validation.

import crypto from "crypto";

export class CDPGuard {
  constructor(options = {}) {
    this.options = {
      expectedHost: "127.0.0.1",
      expectedPort: 9222,
      ...options,
    };

    // Ephemeral runtime capability token for local agent components
    this.capabilityToken = crypto.randomBytes(24).toString("hex");
  }

  getCapabilityToken() {
    return this.capabilityToken;
  }

  /**
   * Validate CDP URL strictly points to 127.0.0.1 / localhost
   */
  validateCDPUrl(cdpUrl) {
    try {
      const parsed = new URL(cdpUrl);
      const host = parsed.hostname;
      if (host !== "127.0.0.1" && host !== "localhost") {
        return {
          valid: false,
          reason: `CDP URL hostname "${host}" violates security policy. Must be strictly 127.0.0.1 or localhost.`,
        };
      }
      return { valid: true };
    } catch (e) {
      return { valid: false, reason: `Malformed CDP URL: ${e.message}` };
    }
  }

  /**
   * Validate authorization header
   */
  verifyCapabilityToken(token) {
    if (!token) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(this.capabilityToken));
  }
}

export const cdpGuard = new CDPGuard();
export default cdpGuard;
