//==========================================================
//
// backend/agent/model-router.js
//
// Ultra Intelligent Provider-Aware Model Router
//
// Architecture
// ----------------------------------------------------------
// User Goal + Observation
//            │
//            ▼
//       Model Router
//            │
//     ┌──────┴──────────────────────────┐
//     ▼                                 ▼
//  Fast LLM (Ollama)              Reasoning LLM (Ollama)
//     │                                 │
//     │   (Local failure)               │   (Local failure)
//     ▼                                 ▼
//  Alternate Local Model          Alternate Local Reasoning Model
//     │                                 │
//     │   (All local failed)            │   (Local failure)
//     ▼                                 ▼
//  OpenAI Fallback (Configured)    Fast Local Model
//     │                                 │
//     │                                 ▼
//     │                           OpenAI Fallback (Configured)
//     │                                 │
//     └───────────────┬─────────────────┘
//                     ▼
//        Heuristic Planner (Zero-Failure)
//
// Features
// --------
// ✔ Provider-aware model routing (Ollama local, OpenAI explicit fallback only)
// ✔ Dynamic Ollama /api/tags discovery with TTL caching (30s)
// ✔ Model capability validation (reasoning, vision, fast)
// ✔ Fail-fast on missing models & HTTP 404 (never waits 35s)
// ✔ Tiered configurable timeouts (fast: 5-10s, reasoning: 15-25s, vision: 15-30s)
// ✔ Full fallback hierarchy (Reasoning -> Alternate -> Fast -> OpenAI -> Heuristic)
// ✔ Structured error information { provider, model, tier, errorType, retryable, latencyMs }
//
//==========================================================

export class ModelRouterError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ModelRouterError";
    this.provider = details.provider || "unknown";
    this.model = details.model || "unknown";
    this.tier = details.tier || "unknown";
    this.errorType = details.errorType || "provider_error";
    this.retryable = details.retryable ?? false;
    this.latencyMs = Number(details.latencyMs || 0);
    this.failures = details.failures || [];
  }

  toStructured() {
    return {
      provider: this.provider,
      model: this.model,
      tier: this.tier,
      errorType: this.errorType,
      retryable: this.retryable,
      latencyMs: this.latencyMs,
    };
  }
}

export function categorizeError(err, resStatus = null, resText = "") {
  if (
    resStatus === 404 ||
    (resText && (resText.includes("not found") || resText.includes("does not exist") || resText.includes("model_not_found")))
  ) {
    return "model_not_found";
  }
  if (
    err?.name === "AbortError" ||
    (err?.message && (err.message.toLowerCase().includes("timeout") || err.message.toLowerCase().includes("timed out") || err.message.includes("aborted")))
  ) {
    return "timeout";
  }
  if (
    err?.code === "ECONNREFUSED" ||
    (err?.message && (err.message.includes("ECONNREFUSED") || err.message.includes("connect ECONNREFUSED")))
  ) {
    return "connection_refused";
  }
  if (
    err?.message &&
    (err.message.includes("Ollama unavailable") || err.message.includes("fetch failed") || err.message.includes("ENOTFOUND"))
  ) {
    return "ollama_unavailable";
  }
  if (resStatus === 400 || (err?.message && err.message.includes("invalid model"))) {
    return "invalid_model";
  }
  if (err?.name === "SyntaxError" || (err?.message && err.message.includes("Unexpected token"))) {
    return "malformed_response";
  }
  return "provider_error";
}

export default class ModelRouter {
  constructor(options = {}) {
    // 1. Endpoints & URLs (Ollama)
    const rawOllama =
      options.ollamaBaseUrl ||
      options.ollamaEndpoint ||
      process.env.OLLAMA_BASE_URL ||
      process.env.OLLAMA_ENDPOINT ||
      process.env.OLLAMA_HOST ||
      "http://localhost:11434";
    this.ollamaBaseUrl = rawOllama
      .replace(/\/api\/(generate|tags|chat)\/?$/, "")
      .replace(/\/+$/, "");
    this.ollamaGenerateUrl = `${this.ollamaBaseUrl}/api/generate`;
    this.ollamaTagsUrl = `${this.ollamaBaseUrl}/api/tags`;

    // 2. Endpoints & URLs (OpenAI)
    const rawOpenAI =
      options.openaiBaseUrl ||
      options.openaiEndpoint ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com/v1";
    this.openaiBaseUrl = rawOpenAI.replace(/\/+$/, "");
    this.openaiChatUrl = this.openaiBaseUrl.endsWith("/chat/completions")
      ? this.openaiBaseUrl
      : `${this.openaiBaseUrl}/chat/completions`;
    this.openaiApiKey =
      options.openaiApiKey !== undefined
        ? options.openaiApiKey
        : (process.env.OPENAI_API_KEY || "");

    // 3. Fallback Configuration
    this.openaiFallback =
      options.openaiFallback ??
      (Boolean(this.openaiApiKey) && process.env.ENABLE_OPENAI_FALLBACK !== "false");
    this.openaiFallbackModel =
      options.openaiFallbackModel ||
      process.env.OPENAI_FALLBACK_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-4o-mini";
    this.openaiVisionModel =
      options.openaiVisionModel ||
      process.env.OPENAI_VISION_MODEL ||
      "gpt-4o";

    // 4. Model Assignments per Tier
    const defaultFast =
      options.fastModel ||
      options.models?.fast ||
      process.env.FAST_MODEL ||
      process.env.AI_MODEL ||
      "qwen3:8b";
    const defaultReasoning =
      options.reasoningModel ||
      options.models?.reasoning ||
      process.env.REASONING_MODEL ||
      process.env.AI_MODEL ||
      "qwen3:8b";
    const defaultVision =
      options.visionModel ||
      options.models?.vision ||
      process.env.VISION_MODEL ||
      "gpt-4o";

    this.models = {
      fast: defaultFast,
      reasoning: defaultReasoning,
      vision: defaultVision,
      ...options.models,
    };

    // 5. Configurable Timeouts (Goals 10 & 12)
    // fast: 5-10s (default: 8000ms)
    // reasoning: 15-25s (default: 20000ms)
    // vision: 15-30s (default: 25000ms)
    this.timeouts = {
      fast: Number(options.fastTimeout || process.env.FAST_TIMEOUT_MS || 8000),
      reasoning: Number(options.reasoningTimeout || process.env.REASONING_TIMEOUT_MS || 20000),
      vision: Number(options.visionTimeout || process.env.VISION_TIMEOUT_MS || 25000),
      tags: Number(options.tagsTimeout || process.env.TAGS_TIMEOUT_MS || 2000),
    };

    // Backwards compatibility options object
    this.options = {
      defaultProvider: options.defaultProvider || "ollama",
      ollamaEndpoint: this.ollamaGenerateUrl,
      openaiEndpoint: this.openaiChatUrl,
      openaiApiKey: this.openaiApiKey,
      models: this.models,
      modelTimeout: this.timeouts.reasoning,
      debug: options.debug ?? false,
      ...options,
    };

    // Discovery Cache State (Goal 7)
    this.cacheTtlMs = options.cacheTtlMs ?? 30000;
    this._availableModels = null;
    this._availableModelsInfo = [];
    this._modelsFetchedAt = 0;
    this._ollamaStatus = "unknown"; // "online" | "offline"
    this._lastOllamaError = null;

    // Statistics
    this.stats = {
      totalRequests: 0,
      fastHits: 0,
      reasoningHits: 0,
      visionHits: 0,
      fallbacks: 0,
      totalLatencyMs: 0,
      lastLatencyMs: 0,
    };
  }

  log(...args) {
    if (this.options.debug) {
      console.log("[ModelRouter]", ...args);
    }
  }

  warn(...args) {
    console.warn("[ModelRouter]", ...args);
  }

  error(...args) {
    console.error("[ModelRouter]", ...args);
  }

  // Structured failure logging format (Goal 14)
  logStructuredFailure(failure) {
    console.warn(
`[ModelRouter]
tier=${failure.tier || "unknown"}
provider=${failure.provider || "unknown"}
model=${failure.model || "unknown"}
status=unavailable
error=${failure.errorType || "unknown"}
latency=${Math.max(1, Math.round(failure.latencyMs || 0))}ms`
    );
  }

  //==========================================================
  // DYNAMIC OLLAMA MODEL DISCOVERY & RESOLUTION (Goals 3 & 7)
  //==========================================================
  async getAvailableOllamaModels(forceRefresh = false) {
    const now = Date.now();
    if (
      !forceRefresh &&
      this._availableModels &&
      now - this._modelsFetchedAt < this.cacheTtlMs
    ) {
      return this._availableModels;
    }

    // Fail fast if recently determined to be offline (<5s ago)
    if (
      !forceRefresh &&
      this._ollamaStatus === "offline" &&
      now - this._modelsFetchedAt < 5000
    ) {
      return [];
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeouts.tags);

    try {
      const res = await fetch(this.ollamaTagsUrl, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.models)) {
          this._availableModelsInfo = data.models;
          this._availableModels = data.models
            .map((m) => m.name || m.model)
            .filter(Boolean);
          this._modelsFetchedAt = Date.now();
          this._ollamaStatus = "online";
          this.log("Discovered Ollama models:", this._availableModels);
          return this._availableModels;
        }
      }
      this._ollamaStatus = "offline";
    } catch (err) {
      clearTimeout(timer);
      this._ollamaStatus = "offline";
      this._modelsFetchedAt = Date.now();
      this.log("Could not query Ollama tags:", err.message);
    }

    return this._availableModels || [];
  }

  //==========================================================
  // MODEL CAPABILITY DETECTION & VALIDATION (Goal 6)
  //==========================================================
  isVisionModel(modelName) {
    if (!modelName) return false;
    const name = String(modelName).toLowerCase();
    return (
      name.includes("vision") ||
      name.includes("llava") ||
      name.includes("minicpm-v") ||
      name.includes("bakllava") ||
      name.includes("moondream") ||
      name.includes("qwen-vl") ||
      name.includes("qwen2-vl")
    );
  }

  isReasoningModel(modelName) {
    if (!modelName) return false;
    const name = String(modelName).toLowerCase();
    return (
      name.includes("r1") ||
      name.includes("qwq") ||
      name.includes("reasoning") ||
      name.includes("deepseek") ||
      name.includes("qwen") ||
      name.includes("llama3") ||
      name.includes("mistral") ||
      name.includes("gemma")
    );
  }

  isOpenAIModel(modelName) {
    if (!modelName) return false;
    const lower = String(modelName).toLowerCase();
    return (
      lower.startsWith("gpt-") ||
      lower.startsWith("o1") ||
      lower.startsWith("o3") ||
      lower.startsWith("chatgpt-") ||
      lower.startsWith("text-embedding") ||
      lower.startsWith("dall-e")
    );
  }

  validateModelCapability(modelName, requiredCapability) {
    if (!modelName) return false;
    if (requiredCapability === "vision") {
      return this.isVisionModel(modelName);
    }
    if (requiredCapability === "reasoning") {
      return this.isReasoningModel(modelName);
    }
    return true;
  }

  async resolveOllamaModel(requestedModel, capability = "any") {
    const available = await this.getAvailableOllamaModels();
    if (!available || available.length === 0) {
      return requestedModel || null;
    }

    // 1. Exact match
    if (requestedModel && available.includes(requestedModel)) {
      return requestedModel;
    }

    // 2. Tag / family match (e.g. "qwen3:8b" -> "qwen3:latest" or "qwen3")
    if (requestedModel) {
      const family = requestedModel.split(":")[0];
      const match = available.find(
        (m) => m === family || m.startsWith(`${family}:`),
      );
      if (match) {
        this.log(`Model "${requestedModel}" resolved to family match "${match}"`);
        return match;
      }
    }

    // 3. Capability match from installed models (Do not hardcode missing models!)
    if (capability === "vision") {
      const visionModel = available.find((m) => this.isVisionModel(m));
      if (visionModel) return visionModel;
    }

    if (capability === "reasoning") {
      const reasoningModel = available.find((m) => this.isReasoningModel(m));
      if (reasoningModel) return reasoningModel;
    }

    if (capability === "fast") {
      const fastModel = available.find((m) => {
        const lower = m.toLowerCase();
        return lower.includes("3b") || lower.includes("1.5b") || lower.includes("8b");
      });
      if (fastModel) return fastModel;
    }

    // 4. Fallback to any installed model
    return available[0] || requestedModel;
  }

  async validateOllamaCandidate(modelName, tier = "fast") {
    const available = await this.getAvailableOllamaModels();
    if (this._ollamaStatus === "offline" && (!available || available.length === 0)) {
      return { valid: false, errorType: "ollama_unavailable" };
    }
    if (!available || available.length === 0) {
      return { valid: false, errorType: "ollama_unavailable" };
    }
    if (!modelName || typeof modelName !== "string" || !modelName.trim()) {
      return { valid: false, errorType: "invalid_model" };
    }
    if (!available.includes(modelName)) {
      return { valid: false, errorType: "model_not_found" };
    }
    if (tier === "vision" && !this.isVisionModel(modelName)) {
      return { valid: false, errorType: "invalid_model" };
    }
    return { valid: true };
  }

  //==========================================================
  // SELECT TIER BASED ON TASK & CONTEXT
  //==========================================================
  selectTier(taskType, context = {}) {
    // 1. Visual tasks explicitly require Vision model
    if (
      taskType === "vision" ||
      taskType === "visual_grounding" ||
      context.hasImage ||
      context.requiresVision ||
      (context.observation?.somScreenshot && context.useVisualSoM)
    ) {
      const hasLocalVision = this._availableModels?.some((m) => this.isVisionModel(m));
      if (
        this.openaiApiKey ||
        hasLocalVision ||
        this.isVisionModel(this.models.vision)
      ) {
        return "vision";
      }
      this.warn(
        "Vision requested but no Vision API key/model configured. Falling back to Reasoning/Fast tier.",
      );
      this.stats.fallbacks++;
    }

    // 2. Complex multi-step reasoning, self-healing reflection, or deep goal breakdown
    if (
      taskType === "reasoning" ||
      taskType === "repair" ||
      taskType === "plan_complex" ||
      context.isAmbiguous ||
      context.previousFailureCount > 0
    ) {
      return "reasoning";
    }

    // 3. Default to fast low-latency model for classification, intent parsing, direct actions
    return "fast";
  }

  //==========================================================
  // BUILD CANDIDATE HIERARCHY (Goal 11)
  //
  // Reasoning Hierarchy:
  //   reasoning model
  //       ↓ failure
  //   alternate local reasoning model
  //       ↓ failure
  //   fast local model
  //       ↓ failure
  //   configured OpenAI fallback
  //==========================================================
  async buildCandidateHierarchy(tier, requestedModel, options = {}) {
    const candidates = [];
    const available = await this.getAvailableOllamaModels();

    if (tier === "reasoning") {
      // 1. Primary Reasoning Model (Ollama)
      const primary = requestedModel || this.models.reasoning;
      candidates.push({ provider: "ollama", model: primary, tier: "reasoning" });

      // 2. Alternate Local Reasoning Model (Ollama)
      if (available && available.length > 0) {
        const alternateReasoning = available.find(
          (m) => m !== primary && this.isReasoningModel(m),
        );
        if (alternateReasoning) {
          candidates.push({
            provider: "ollama",
            model: alternateReasoning,
            tier: "reasoning",
          });
        }
      }

      // 3. Fast Local Model (Ollama)
      const fastModel = this.models.fast;
      if (
        fastModel &&
        !candidates.some((c) => c.provider === "ollama" && c.model === fastModel)
      ) {
        candidates.push({ provider: "ollama", model: fastModel, tier: "fast" });
      }

      // 4. Configured OpenAI Fallback (Never send Ollama model names to OpenAI!)
      if (this.openaiApiKey && this.openaiFallback) {
        candidates.push({
          provider: "openai",
          model: this.openaiFallbackModel,
          tier: "reasoning",
        });
      }
    } else if (tier === "vision") {
      // 1. Local Vision Model in Ollama (if installed)
      const localVision = available?.find((m) => this.isVisionModel(m));
      if (localVision) {
        candidates.push({ provider: "ollama", model: localVision, tier: "vision" });
      }

      // 2. Configured OpenAI Vision Model (if configured)
      if (this.openaiApiKey) {
        candidates.push({
          provider: "openai",
          model: this.openaiVisionModel,
          tier: "vision",
        });
      }

      // 3. Fast local text fallback
      candidates.push({
        provider: "ollama",
        model: this.models.fast,
        tier: "fast",
      });
    } else {
      // Fast tier
      // 1. Primary Fast Model (Ollama)
      const primary = requestedModel || this.models.fast;
      candidates.push({ provider: "ollama", model: primary, tier: "fast" });

      // 2. Alternate Local Model (Ollama)
      if (available && available.length > 0) {
        const alternateFast = available.find((m) => m !== primary);
        if (alternateFast) {
          candidates.push({
            provider: "ollama",
            model: alternateFast,
            tier: "fast",
          });
        }
      }

      // 3. Configured OpenAI Fallback
      if (this.openaiApiKey && this.openaiFallback) {
        candidates.push({
          provider: "openai",
          model: this.openaiFallbackModel,
          tier: "fast",
        });
      }
    }

    return candidates;
  }

  //==========================================================
  // DISPATCH COMPLETION WITH FAST FAIL & HIERARCHY FALLBACK
  //==========================================================
  async complete(prompt, options = {}) {
    const started = performance.now();
    this.stats.totalRequests++;

    const tier =
      options.tier || this.selectTier(options.taskType || "fast", options);
    const requestedModel =
      options.model || this.models[tier] || this.models.fast;

    this.log(
      `Routing task [${options.taskType || "unknown"}] to Tier [${tier}] using Model [${requestedModel}]`,
    );

    const candidates = await this.buildCandidateHierarchy(
      tier,
      requestedModel,
      options,
    );
    let lastError = null;
    const failures = [];

    for (const candidate of candidates) {
      const candidateStart = performance.now();
      try {
        let result = null;

        if (candidate.provider === "ollama") {
          // Pre-execution validation: Fail Fast on missing model or offline Ollama (Goals 6 & 9)
          const validation = await this.validateOllamaCandidate(
            candidate.model,
            tier,
          );
          if (!validation.valid) {
            const latencyMs = performance.now() - candidateStart;
            const failure = {
              provider: "ollama",
              model: candidate.model,
              tier,
              errorType: validation.errorType,
              retryable: false,
              latencyMs,
            };
            this.logStructuredFailure(failure);
            failures.push(failure);
            this.stats.fallbacks++;
            continue; // Immediately try next valid model! (Goal 15)
          }

          // Execute with Ollama using appropriate tier caller
          if (
            tier === "vision" &&
            (options.imageBase64 ||
              options.imageUrl ||
              options.observation?.somScreenshot)
          ) {
            this.stats.visionHits++;
            result = await this.callVisionModel(prompt, candidate.model, options);
          } else if (tier === "reasoning") {
            this.stats.reasoningHits++;
            result = await this.callReasoningModel(
              prompt,
              candidate.model,
              options,
            );
          } else {
            this.stats.fastHits++;
            result = await this.callFastModel(prompt, candidate.model, options);
          }
        } else if (candidate.provider === "openai") {
          // OpenAI Fallback Execution (Goal 4 & 5)
          const openaiModel = candidate.model || this.openaiFallbackModel;
          const messages = [
            {
              role: "system",
              content:
                tier === "reasoning"
                  ? "You are an expert autonomous browser reasoning agent. Think through complex DOM interactions step by step."
                  : "You are an autonomous browser planning agent.",
            },
            { role: "user", content: prompt },
          ];
          result = await this.callOpenAICompatibleChat(
            messages,
            openaiModel,
            options,
          );
        }

        if (result && (result.text || result.response)) {
          const totalLatency = performance.now() - started;
          this.stats.lastLatencyMs = totalLatency;
          this.stats.totalLatencyMs += totalLatency;

          return {
            ...result,
            text: result.text || result.response || "",
            tier,
            model: result.model || candidate.model,
            provider: candidate.provider,
            latencyMs: totalLatency,
            fallbackCount: failures.length,
          };
        }
      } catch (err) {
        const latencyMs = performance.now() - candidateStart;
        const errorType = err.errorType || categorizeError(err);
        const failure = {
          provider: candidate.provider,
          model: candidate.model,
          tier,
          errorType,
          retryable: false,
          latencyMs,
        };
        this.logStructuredFailure(failure);
        failures.push(failure);
        lastError = err;
        this.stats.fallbacks++;
        // Immediately try next model in hierarchy!
      }
    }

    // All model candidates failed
    const totalLatency = performance.now() - started;
    const finalFailure = failures[failures.length - 1] || {
      provider: "ollama",
      model: requestedModel,
      tier,
      errorType: "all_candidates_failed",
      retryable: false,
      latencyMs: totalLatency,
    };

    const routerError = new ModelRouterError(
      `All models in fallback hierarchy failed for tier [${tier}]. Last error: ${lastError?.message || finalFailure.errorType}`,
      { ...finalFailure, latencyMs: totalLatency, failures },
    );
    throw routerError;
  }

  //==========================================================
  // CALL FAST MODEL (OLLAMA / LIGHTWEIGHT)
  //==========================================================
  async callFastModel(prompt, model, options = {}) {
    const started = performance.now();
    const endpoint = this.ollamaGenerateUrl;
    const targetModel = model || this.models.fast;
    const timeoutMs = options.timeout || this.timeouts.fast;

    // Pre-execution validation: fail fast if model is missing or Ollama is offline (Goals 6 & 9)
    const validation = await this.validateOllamaCandidate(targetModel, "fast");
    if (!validation.valid) {
      const latencyMs = performance.now() - started;
      throw new ModelRouterError(
        `Ollama fast model "${targetModel}" is not available (${validation.errorType})`,
        {
          provider: "ollama",
          model: targetModel,
          tier: "fast",
          errorType: validation.errorType,
          retryable: false,
          latencyMs,
        },
      );
    }

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: targetModel,
          prompt: String(prompt),
          stream: false,
          think: false, // Disables lengthy chain-of-thought token generation for rapid response
          keep_alive: "15m",
          options: {
            temperature: options.temperature ?? 0,
            num_predict: options.maxTokens ?? 1024,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const errorType = categorizeError(null, res.status, errText);
        const latencyMs = performance.now() - started;
        throw new ModelRouterError(
          `Ollama fast model (${targetModel}) returned HTTP ${res.status}: ${errText}`,
          {
            provider: "ollama",
            model: targetModel,
            tier: "fast",
            errorType,
            retryable: false,
            latencyMs,
          },
        );
      }

      const data = await res.json().catch(() => null);
      if (!data || typeof data !== "object") {
        throw new ModelRouterError(
          `Ollama fast model (${targetModel}) returned malformed JSON response`,
          {
            provider: "ollama",
            model: targetModel,
            tier: "fast",
            errorType: "malformed_response",
            retryable: false,
            latencyMs: performance.now() - started,
          },
        );
      }

      const outputText = data.response || data.text || data.thinking || "";
      return {
        success: true,
        text: outputText,
        model: targetModel,
        raw: data,
      };
    } catch (err) {
      if (err instanceof ModelRouterError) throw err;
      const latencyMs = performance.now() - started;
      const errorType = categorizeError(err);
      throw new ModelRouterError(err.message, {
        provider: "ollama",
        model: targetModel,
        tier: "fast",
        errorType,
        retryable: false,
        latencyMs,
      });
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  //==========================================================
  // CALL REASONING MODEL (OLLAMA LOCAL REASONING MODEL) (Goal 4)
  //==========================================================
  async callReasoningModel(prompt, model, options = {}) {
    const started = performance.now();
    const endpoint = this.ollamaGenerateUrl;
    const targetModel = model || this.models.reasoning;
    const timeoutMs = options.timeout || this.timeouts.reasoning;

    // Pre-execution validation: fail fast if model is missing or Ollama is offline (Goals 6 & 9)
    const validation = await this.validateOllamaCandidate(targetModel, "reasoning");
    if (!validation.valid) {
      const latencyMs = performance.now() - started;
      throw new ModelRouterError(
        `Ollama reasoning model "${targetModel}" is not available (${validation.errorType})`,
        {
          provider: "ollama",
          model: targetModel,
          tier: "reasoning",
          errorType: validation.errorType,
          retryable: false,
          latencyMs,
        },
      );
    }

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const enhancedPrompt = `[REASONING TASK]\nCarefully analyze the following goal and page state. Think step by step.\n${prompt}`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: targetModel,
          prompt: enhancedPrompt,
          stream: false,
          keep_alive: "15m",
          options: {
            temperature: options.temperature ?? 0,
            num_predict: options.maxTokens ?? 2048,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const errorType = categorizeError(null, res.status, errText);
        const latencyMs = performance.now() - started;
        throw new ModelRouterError(
          `Ollama reasoning model (${targetModel}) returned HTTP ${res.status}: ${errText}`,
          {
            provider: "ollama",
            model: targetModel,
            tier: "reasoning",
            errorType,
            retryable: false,
            latencyMs,
          },
        );
      }

      const data = await res.json().catch(() => null);
      if (!data || typeof data !== "object") {
        throw new ModelRouterError(
          `Ollama reasoning model (${targetModel}) returned malformed JSON response`,
          {
            provider: "ollama",
            model: targetModel,
            tier: "reasoning",
            errorType: "malformed_response",
            retryable: false,
            latencyMs: performance.now() - started,
          },
        );
      }

      const outputText = data.response || data.text || data.thinking || "";
      return {
        success: true,
        text: outputText,
        model: targetModel,
        raw: data,
      };
    } catch (err) {
      if (err instanceof ModelRouterError) throw err;
      const latencyMs = performance.now() - started;
      const errorType = categorizeError(err);
      throw new ModelRouterError(err.message, {
        provider: "ollama",
        model: targetModel,
        tier: "reasoning",
        errorType,
        retryable: false,
        latencyMs,
      });
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  //==========================================================
  // CALL VISION MODEL (MULTIMODAL)
  //==========================================================
  async callVisionModel(prompt, model, options = {}) {
    const started = performance.now();
    const image =
      options.imageBase64 ||
      options.imageUrl ||
      options.observation?.somScreenshot ||
      options.observation?.screenshot;

    if (!image) {
      throw new ModelRouterError("No image data provided for Vision model.", {
        provider: "ollama",
        model: model || this.models.vision,
        tier: "vision",
        errorType: "invalid_model",
        retryable: false,
        latencyMs: 1,
      });
    }

    const imageUrl = image.startsWith("data:")
      ? image
      : `data:image/png;base64,${image}`;

    // 1. If OpenAI API key is configured and model is OpenAI model
    if (this.openaiApiKey && (this.isOpenAIModel(model) || !this.isVisionModel(model))) {
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
                detail: options.imageDetail || "high",
              },
            },
          ],
        },
      ];
      return await this.callOpenAICompatibleChat(
        messages,
        this.openaiVisionModel,
        options,
      );
    }

    // 2. Local Ollama Vision Model
    const targetModel = model || "llava";
    const timeoutMs = options.timeout || this.timeouts.vision;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const base64Clean = image.replace(/^data:image\/[a-z]+;base64,/, "");
      const res = await fetch(this.ollamaGenerateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: targetModel,
          prompt,
          images: [base64Clean],
          stream: false,
          options: { temperature: 0 },
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const errorType = categorizeError(null, res.status, errText);
        throw new ModelRouterError(
          `Ollama vision model returned HTTP ${res.status}: ${errText}`,
          {
            provider: "ollama",
            model: targetModel,
            tier: "vision",
            errorType,
            retryable: false,
            latencyMs: performance.now() - started,
          },
        );
      }

      const data = await res.json().catch(() => null);
      if (!data) {
        throw new ModelRouterError("Malformed vision model response", {
          provider: "ollama",
          model: targetModel,
          tier: "vision",
          errorType: "malformed_response",
          retryable: false,
          latencyMs: performance.now() - started,
        });
      }

      return {
        success: true,
        text: data.response || "",
        model: targetModel,
        raw: data,
      };
    } catch (err) {
      if (err instanceof ModelRouterError) throw err;
      const latencyMs = performance.now() - started;
      const errorType = categorizeError(err);
      throw new ModelRouterError(err.message, {
        provider: "ollama",
        model: targetModel,
        tier: "vision",
        errorType,
        retryable: false,
        latencyMs,
      });
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  //==========================================================
  // OPENAI COMPATIBLE CHAT HELPER (Goal 5: NEVER send Ollama model)
  //==========================================================
  async callOpenAICompatibleChat(messages, model, options = {}) {
    const started = performance.now();
    if (!this.openaiApiKey) {
      throw new ModelRouterError("Missing OpenAI API key.", {
        provider: "openai",
        model: model || this.openaiFallbackModel,
        tier: options.tier || "reasoning",
        errorType: "auth_error",
        retryable: false,
        latencyMs: 1,
      });
    }

    // Never send an Ollama model name to OpenAI! (Goal 5)
    let actualModel = model || this.openaiFallbackModel;
    if (!this.isOpenAIModel(actualModel)) {
      this.warn(
        `Model "${actualModel}" is not an OpenAI model. Re-routing to OpenAI fallback model "${this.openaiFallbackModel}".`,
      );
      actualModel = this.openaiFallbackModel;
    }

    const timeoutMs = options.timeout || this.timeouts.reasoning;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(this.openaiChatUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.openaiApiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: actualModel,
          messages,
          temperature: options.temperature ?? 0,
          max_tokens: options.maxTokens ?? 1024,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const errorType = categorizeError(null, res.status, errText);
        throw new ModelRouterError(
          `OpenAI compatible API returned HTTP ${res.status}: ${errText}`,
          {
            provider: "openai",
            model: actualModel,
            tier: options.tier || "reasoning",
            errorType,
            retryable: false,
            latencyMs: performance.now() - started,
          },
        );
      }

      const data = await res.json().catch(() => null);
      if (!data || typeof data !== "object") {
        throw new ModelRouterError("OpenAI returned malformed JSON response", {
          provider: "openai",
          model: actualModel,
          tier: options.tier || "reasoning",
          errorType: "malformed_response",
          retryable: false,
          latencyMs: performance.now() - started,
        });
      }

      const text = data.choices?.[0]?.message?.content || "";
      return {
        success: true,
        text,
        model: actualModel,
        provider: "openai",
        raw: data,
      };
    } catch (err) {
      if (err instanceof ModelRouterError) throw err;
      const latencyMs = performance.now() - started;
      const errorType = categorizeError(err);
      throw new ModelRouterError(err.message, {
        provider: "openai",
        model: actualModel,
        tier: options.tier || "reasoning",
        errorType,
        retryable: false,
        latencyMs,
      });
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  //==========================================================
  // ANALYZE AGENT OBSERVATION (DECIDE NEXT ACTION)
  //==========================================================
  async planAction(observation, userGoal, options = {}) {
    const prompt = `
You are Jarvis Agent, an intelligent autonomous browser agent.
USER GOAL: "${userGoal}"
CURRENT PAGE: ${observation.url} ("${observation.title}")

INTERACTIVE ELEMENTS DETECTED (Index, Tag, Text, Center Coordinates):
${observation.compactElements}

Choose the single best next action to advance toward the goal.
Respond ONLY with a valid JSON object matching this schema:
{
  "action": "click" | "type" | "navigate" | "scroll" | "wait" | "finish",
  "index": <number from marked elements list, or null>,
  "target": "<element description or text>",
  "value": "<text to type, or null>",
  "reason": "<short explanation>"
}
`;

    const tier =
      options.useVisualSoM && observation.somScreenshot ? "vision" : "fast";
    const result = await this.complete(prompt, {
      tier,
      taskType: "action_decision",
      imageBase64: observation.somScreenshot,
      temperature: 0,
    });

    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          success: true,
          action: parsed,
          tier: result.tier,
          model: result.model,
          latencyMs: result.latencyMs,
        };
      }
    } catch (e) {}

    return {
      success: false,
      rawText: result.text,
      tier: result.tier,
      model: result.model,
      latencyMs: result.latencyMs,
    };
  }
}
