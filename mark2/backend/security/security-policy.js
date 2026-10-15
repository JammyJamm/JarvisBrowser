// backend/security/security-policy.js
// Enterprise Security Policy Engine for Jarvis Browser
// Implements capability boundaries, tool argument validation, and tiered approval gates.

export const POLICY_DECISION = Object.freeze({
  ALLOW: "ALLOW",     // Safe to execute automatically
  CONFIRM: "CONFIRM", // Requires explicit user approval before execution
  BLOCK: "BLOCK",     // Prohibited; violates security boundaries
});

export const CAPABILITY_TIERS = Object.freeze({
  READ_ONLY: "READ_ONLY",
  INTERACTION: "INTERACTION",
  SENSITIVE: "SENSITIVE",
  PRIVILEGED: "PRIVILEGED",
});

export const BLOCKED_PROTOCOLS = Object.freeze([
  "file:",
  "javascript:",
  "vbscript:",
  "data:",
  "shell:",
  "powershell:",
  "cmd:",
  "chrome:",
  "devtools:",
]);

export class SecurityPolicy {
  constructor(options = {}) {
    this.options = {
      debug: options.debug ?? false,
      strictMode: options.strictMode ?? true,
      allowedOrigins: options.allowedOrigins || ["127.0.0.1", "localhost"],
      requireConfirmationForPurchases: true,
      requireConfirmationForLogins: true,
      ...options,
    };

    // User approvals granted for current task session
    this.sessionAuthorizations = new Set();
  }

  log(...args) {
    if (this.options.debug) {
      console.log("[SecurityPolicy]", ...args);
    }
  }

  warn(...args) {
    console.warn("[SecurityPolicy]", ...args);
  }

  /**
   * Main gatekeeper: Evaluate proposed tool and arguments against security boundaries.
   * @param {string} tool - Tool name
   * @param {object} args - Tool arguments
   * @param {object} context - Execution context (e.g., domain, userGoal, confidence)
   * @returns {{ decision: string, reason: string, riskLevel: string, confirmationDetails?: object }}
   */
  evaluate(tool, args = {}, context = {}) {
    const cleanTool = String(tool || "").trim().toLowerCase();

    // 1. HARD BLOCKS: OS execution, shell commands, raw code eval, dangerous protocols
    if (this.isProhibitedAction(cleanTool, args)) {
      this.warn(`Blocked prohibited tool request: ${cleanTool}`);
      return {
        decision: POLICY_DECISION.BLOCK,
        reason: `Execution of ${cleanTool} violates browser agent security boundaries.`,
        riskLevel: "CRITICAL",
      };
    }

    // 2. Protocol Validation for navigations and URLs
    if (args && (args.url || args.targetUrl)) {
      const targetUrl = String(args.url || args.targetUrl).trim();
      const protocolCheck = this.validateUrlProtocol(targetUrl);
      if (!protocolCheck.allowed) {
        return {
          decision: POLICY_DECISION.BLOCK,
          reason: protocolCheck.reason,
          riskLevel: "HIGH",
        };
      }
    }

    // 3. HUMAN-IN-THE-LOOP (CONFIRM): Transactions, Logins, Credential Fills, Destructive Operations
    if (this.requiresHumanConfirmation(cleanTool, args, context)) {
      const authorizationKey = `${cleanTool}:${context.domain || ""}`;
      if (this.sessionAuthorizations.has(authorizationKey)) {
        this.log(`Authorization pre-granted for ${authorizationKey}`);
        return {
          decision: POLICY_DECISION.ALLOW,
          reason: "User pre-authorized action for this domain in active session.",
          riskLevel: "MODERATE",
        };
      }

      return {
        decision: POLICY_DECISION.CONFIRM,
        reason: this.getConfirmationReason(cleanTool, args),
        riskLevel: this.getRiskLevel(cleanTool),
        confirmationDetails: {
          tool: cleanTool,
          targetDomain: context.domain || "",
          actionDescription: this.describeAction(cleanTool, args),
          dataPayload: this.sanitizePayloadForDisplay(args),
        },
      };
    }

    // 4. LOW-CONFIDENCE MITIGATION (Rule 4: Never execute low-confidence silently)
    if (typeof context.confidence === "number" && context.confidence < 60) {
      return {
        decision: POLICY_DECISION.CONFIRM,
        reason: `Target resolution confidence (${context.confidence}%) is below minimum safe threshold (60%).`,
        riskLevel: "MEDIUM",
        confirmationDetails: {
          tool: cleanTool,
          confidence: context.confidence,
          target: args.target || args.selector || args.text,
        },
      };
    }

    // 5. AUTOMATIC EXECUTION (ALLOW)
    return {
      decision: POLICY_DECISION.ALLOW,
      reason: "Action satisfies standard non-destructive navigation/observation policy.",
      riskLevel: "LOW",
    };
  }

  /**
   * Check if action is strictly prohibited
   */
  isProhibitedAction(tool, args = {}) {
    const prohibitedTools = [
      "shell",
      "exec",
      "spawn",
      "run_command",
      "eval",
      "system",
      "filesystem_write",
      "write_file",
      "delete_file",
      "raw_cdp",
      "browser_execute_raw",
    ];

    if (prohibitedTools.includes(tool)) return true;

    // Reject scripts attempting node integration or electron require
    if (args.script && typeof args.script === "string") {
      if (/(?:process\.mainModule|child_process|require\(|fs\.|electron\.)/i.test(args.script)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate navigation protocols
   */
  validateUrlProtocol(rawUrl) {
    if (!rawUrl) return { allowed: true };
    const lower = rawUrl.trim().toLowerCase();

    for (const proto of BLOCKED_PROTOCOLS) {
      if (lower.startsWith(proto)) {
        return {
          allowed: false,
          reason: `Navigation to protocol "${proto}" is strictly prohibited for security.`,
        };
      }
    }

    if (!lower.startsWith("http://") && !lower.startsWith("https://") && lower !== "about:blank") {
      return {
        allowed: false,
        reason: `Only standard HTTP/HTTPS web schemes are permitted (received: "${rawUrl}").`,
      };
    }

    return { allowed: true };
  }

  /**
   * Identify actions requiring user authorization
   */
  requiresHumanConfirmation(tool, args = {}, context = {}) {
    const sensitiveTools = [
      "login",
      "login_handler",
      "provide_credentials",
      "credential_fill",
      "click_buy",
      "buy",
      "checkout",
      "payment",
      "transfer",
      "delete_account",
      "submit_payment",
      "user_confirmation",
    ];

    if (sensitiveTools.includes(tool)) return true;

    // Purchasing / Checkout keywords
    const textTarget = String(args.text || args.target || args.query || "").toLowerCase();
    if (/\b(?:place order|buy now|pay now|complete purchase|confirm order|checkout|submit order)\b/i.test(textTarget)) {
      return true;
    }

    // Password input typing
    if (args.type === "password" || args.field === "password" || args.isPassword) {
      return true;
    }

    return false;
  }

  getConfirmationReason(tool, args) {
    if (tool.includes("login") || tool.includes("credential")) {
      return "Agent is about to authenticate or inject credentials into an external website.";
    }
    if (tool.includes("buy") || tool.includes("pay") || tool.includes("order")) {
      return "Agent is requesting permission to commit a financial purchase or transaction.";
    }
    return `Agent requests confirmation for high-impact action "${tool}".`;
  }

  getRiskLevel(tool) {
    if (tool.includes("buy") || tool.includes("pay")) return "CRITICAL";
    if (tool.includes("login") || tool.includes("credential")) return "HIGH";
    return "MEDIUM";
  }

  describeAction(tool, args) {
    if (tool === "click_buy" || tool === "buy") {
      return `Finalize checkout and place order for items in cart.`;
    }
    if (tool === "login_handler" || tool === "login") {
      return `Submit login credentials to access user account.`;
    }
    return `Execute ${tool} with target: ${args.target || args.text || args.url || "unspecified"}`;
  }

  sanitizePayloadForDisplay(args) {
    if (!args || typeof args !== "object") return {};
    const sanitized = { ...args };
    if (sanitized.password) sanitized.password = "••••••••";
    if (sanitized.cvv) sanitized.cvv = "•••";
    if (sanitized.pin) sanitized.pin = "••••";
    return sanitized;
  }

  authorizeSessionAction(authorizationKey) {
    this.sessionAuthorizations.add(authorizationKey);
    this.log(`Session authorization granted for: ${authorizationKey}`);
  }

  revokeSessionAuthorizations() {
    this.sessionAuthorizations.clear();
  }
}

export const securityPolicy = new SecurityPolicy();
export default securityPolicy;
