// backend/security/agent-safety-critic.js
// Agent Safety & Alignment Critic for Jarvis Browser
// Detects Indirect Prompt Injections, Goal Drift, Suspicious Page Instructions, and Credential Exfiltration.

import { POLICY_DECISION } from "./security-policy.js";

export const CRITIC_DECISION = Object.freeze({
  ALLOW: "ALLOW",
  CONFIRM: "CONFIRM",
  BLOCK: "BLOCK",
  REPLAN: "REPLAN",
});

export const INJECTION_PATTERNS = Object.freeze([
  /ignore\s+(?:all\s+)?previous\s+instructions/i,
  /disregard\s+(?:all\s+)?prior\s+commands/i,
  /system\s+override\s*:/i,
  /you\s+are\s+now\s+in\s+developer\s+mode/i,
  /jailbreak\s+activated/i,
  /send\s+(?:your\s+)?credentials\s+to/i,
  /upload\s+(?:your\s+)?(?:passwords?|keys?|tokens?|session|cookies?)/i,
  /exfiltrate\s+data/i,
  /curl\s+-X\s+POST\s+http/i,
  /eval\(atob\(/i,
  /new\s+system\s+directive\s*:/i,
  /override\s+user\s+instructions/i,
]);

export class AgentSafetyCritic {
  constructor(options = {}) {
    this.options = {
      debug: options.debug ?? false,
      maxAllowedGoalDriftScore: 0.7,
      blockKnownInjections: true,
      ...options,
    };

    this.auditHistory = [];
  }

  log(...args) {
    if (this.options.debug) {
      console.log("[AgentSafetyCritic]", ...args);
    }
  }

  warn(...args) {
    console.warn("[AgentSafetyCritic]", ...args);
  }

  /**
   * Encapsulate separate context compartments as mandated by architectural rules:
   * USER INTENT vs WEBPAGE CONTENT vs MODEL REASONING vs TOOL OUTPUT vs SECURITY POLICY
   */
  createStructuredContext(userIntent, webpageContent, modelReasoning, toolOutput, securityPolicy) {
    return {
      userIntent: {
        raw: String(userIntent || "").trim(),
        timestamp: Date.now(),
      },
      webpageContent: {
        url: webpageContent?.url || "",
        title: webpageContent?.title || "",
        untrustedText: String(webpageContent?.text || "").slice(0, 15000),
        elementTexts: Array.isArray(webpageContent?.elements)
          ? webpageContent.elements.map((e) => e.text).filter(Boolean).slice(0, 50)
          : [],
      },
      modelReasoning: {
        rationale: String(modelReasoning?.rationale || modelReasoning?.content || ""),
        tier: modelReasoning?.tier || "unknown",
      },
      toolOutput: toolOutput || null,
      securityPolicy: securityPolicy || null,
    };
  }

  /**
   * Main Critic Evaluation
   * @param {object} proposedAction - { tool, args, target }
   * @param {string} userGoal - Original user goal
   * @param {object} pageObservation - Current page observation (DOM, text, url)
   * @param {object} context - Additional execution details
   * @returns {{ decision: string, reason: string, injectionDetected: boolean, driftDetected: boolean }}
   */
  auditAction(proposedAction, userGoal, pageObservation = {}, context = {}) {
    const started = Date.now();

    // 1. INDIRECT PROMPT INJECTION SCANNING IN UNTRUSTED WEBPAGE CONTENT
    const pageText = String(pageObservation?.text || pageObservation?.bodyText || "").toLowerCase();
    const actionText = JSON.stringify(proposedAction || {}).toLowerCase();

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(pageText) || pattern.test(actionText)) {
        this.warn(`Indirect Prompt Injection pattern detected: ${pattern}`);
        const audit = {
          decision: CRITIC_DECISION.BLOCK,
          reason: `Detected adversarial instruction override or prompt injection attempt in webpage content: "${pattern.source}". Untrusted page content cannot dictate agent directives.`,
          injectionDetected: true,
          driftDetected: false,
          durationMs: Date.now() - started,
        };
        this.auditHistory.push(audit);
        return audit;
      }
    }

    // 2. CREDENTIAL EXPOSURE DETECTION
    if (this.detectsCredentialExfiltration(proposedAction, pageObservation)) {
      this.warn("Credential exfiltration or unintended exposure attempt detected.");
      const audit = {
        decision: CRITIC_DECISION.BLOCK,
        reason: "Proposed action attempts to write or transmit sensitive credentials to an untrusted or non-whitelisted target.",
        injectionDetected: false,
        driftDetected: false,
        durationMs: Date.now() - started,
      };
      this.auditHistory.push(audit);
      return audit;
    }

    // 3. GOAL DRIFT & MALICIOUS REDIRECTION CHECK
    const driftCheck = this.checkGoalDrift(userGoal, pageObservation, proposedAction);
    if (driftCheck.driftDetected) {
      this.warn(`Goal drift detected: ${driftCheck.reason}`);
      const audit = {
        decision: driftCheck.severity === "high" ? CRITIC_DECISION.BLOCK : CRITIC_DECISION.REPLAN,
        reason: driftCheck.reason,
        injectionDetected: false,
        driftDetected: true,
        durationMs: Date.now() - started,
      };
      this.auditHistory.push(audit);
      return audit;
    }

    // 4. SUSPICIOUS DOWNLOADS / ARBITRARY PROTOCOL CHECK
    if (proposedAction?.tool === "download" || (proposedAction?.args?.url && /\.(?:exe|bat|cmd|vbs|ps1|msi|sh|apk)$/i.test(proposedAction.args.url))) {
      const audit = {
        decision: CRITIC_DECISION.CONFIRM,
        reason: "Agent proposes downloading an executable file. Explicit user approval is required.",
        injectionDetected: false,
        driftDetected: false,
        durationMs: Date.now() - started,
      };
      this.auditHistory.push(audit);
      return audit;
    }

    // 5. SAFETY PASSED
    const cleanAudit = {
      decision: CRITIC_DECISION.ALLOW,
      reason: "Proposed action is aligned with user intent and isolated from prompt injection vectors.",
      injectionDetected: false,
      driftDetected: false,
      durationMs: Date.now() - started,
    };
    this.auditHistory.push(cleanAudit);
    return cleanAudit;
  }

  /**
   * Detect potential exfiltration of passwords or secrets
   */
  detectsCredentialExfiltration(action, observation) {
    if (!action || !action.args) return false;
    const value = String(action.args.value || action.args.text || "");
    const url = String(observation?.url || action.args.url || "");

    // If an action tries to paste an API key or password into a search query or unexpected domain
    if (/(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9]{20,})/i.test(value)) {
      if (action.tool === "search" || action.tool === "navigate") {
        return true;
      }
    }

    return false;
  }

  /**
   * Check for misalignment between original user goal and proposed site interaction
   */
  checkGoalDrift(userGoal, observation, action) {
    if (!userGoal) return { driftDetected: false };
    const goalLower = String(userGoal).toLowerCase();
    const currentUrl = String(observation?.url || action?.args?.url || "").toLowerCase();

    // Redirections to phishing or scam TLDs / schemes
    const suspiciousSchemes = [".ru/", ".top/", ".xyz/", ".click/", "free-giveaway", "win-iphone", "claim-reward"];
    for (const sus of suspiciousSchemes) {
      if (currentUrl.includes(sus) && !goalLower.includes(sus)) {
        return {
          driftDetected: true,
          severity: "high",
          reason: `Current navigation destination (${currentUrl}) appears untrusted or unrelated to original user goal: "${userGoal}".`,
        };
      }
    }

    return { driftDetected: false };
  }
}

export const agentSafetyCritic = new AgentSafetyCritic();
export default agentSafetyCritic;
