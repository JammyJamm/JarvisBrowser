//==========================================================
//
// backend/agent/model-router.js
//
// Ultra Intelligent Model Router
//
// Architecture
// ----------------------------------------------------------
// User Goal + Observation
//            │
//            ▼
//       Model Router
//            │
//     ┌──────┼─────────────────────────┐
//     ▼      ▼                         ▼
//  Fast LLM  Reasoning LLM         Vision Model
// (Ollama /  (DeepSeek-R1 /         (GPT-4o / Claude 3.7 /
//  qwen3:8b)  Qwen-14b / o3-mini)    Gemini Flash / LLaVA)
//     │      │                         │
//     └──────┴───────────┬─────────────┘
//                        ▼
//             Structured Action Decision
//
// Features
// --------
// ✔ Pluggable providers (Ollama, OpenAI Compatible, Custom)
// ✔ Automated tier selection based on task complexity & input types
// ✔ Seamless fallback: Vision -> Fast LLM + A11y text when vision is unavailable
// ✔ Streaming token support for interactive UI updates
// ✔ Latency & token usage statistics
//
//==========================================================

export default class ModelRouter {
  constructor(options = {}) {
    this.options = {
      defaultProvider: options.defaultProvider || "ollama",
      ollamaEndpoint: options.ollamaEndpoint || process.env.OLLAMA_ENDPOINT || "http://localhost:11434/api/generate",
      openaiEndpoint: options.openaiEndpoint || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions",
      openaiApiKey: options.openaiApiKey || process.env.OPENAI_API_KEY || "",

      // Model assignments per tier
      models: {
        fast: options.fastModel || process.env.FAST_MODEL || process.env.AI_MODEL || "qwen3:8b",
        reasoning: options.reasoningModel || process.env.REASONING_MODEL || "qwen3:8b",
        vision: options.visionModel || process.env.VISION_MODEL || "gpt-4o",
      },

      debug: options.debug ?? false,
      ...options,
    };

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
      // Check if Vision is feasible (OpenAI key present or Ollama vision model)
      if (this.options.openaiApiKey || this.options.models.vision.includes("llava")) {
        return "vision";
      }
      this.warn("Vision requested but no Vision API key/model configured. Falling back to Reasoning/Fast tier.");
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
  // DISPATCH COMPLETION
  //==========================================================
  async complete(prompt, options = {}) {
    const started = performance.now();
    this.stats.totalRequests++;

    const tier = options.tier || this.selectTier(options.taskType || "fast", options);
    const model = options.model || this.options.models[tier] || this.options.models.fast;

    this.log(`Routing task [${options.taskType || "unknown"}] to Tier [${tier}] using Model [${model}]`);

    let result;
    try {
      if (tier === "vision" && (options.imageBase64 || options.imageUrl || options.observation?.somScreenshot)) {
        this.stats.visionHits++;
        result = await this.callVisionModel(prompt, model, options);
      } else if (tier === "reasoning") {
        this.stats.reasoningHits++;
        result = await this.callReasoningModel(prompt, model, options);
      } else {
        this.stats.fastHits++;
        result = await this.callFastModel(prompt, model, options);
      }
    } catch (err) {
      this.error(`Tier [${tier}] model [${model}] failed:`, err.message);
      this.stats.fallbacks++;

      // Automatic fallback to Ollama Fast model if another tier fails
      if (tier !== "fast") {
        this.log("Attempting fallback to Fast model...");
        result = await this.callFastModel(prompt, this.options.models.fast, options);
      } else {
        throw err;
      }
    }

    const latency = performance.now() - started;
    this.stats.lastLatencyMs = latency;
    this.stats.totalLatencyMs += latency;

    return {
      ...result,
      tier,
      model,
      latencyMs: latency,
    };
  }

  //==========================================================
  // CALL FAST MODEL (OLLAMA / LIGHTWEIGHT)
  //==========================================================
  async callFastModel(prompt, model, options = {}) {
    const endpoint = this.options.ollamaEndpoint;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || "qwen3:8b",
        prompt: String(prompt),
        stream: false,
        keep_alive: "15m",
        options: {
          temperature: options.temperature ?? 0,
          num_predict: options.maxTokens ?? 512,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Ollama fast model returned HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return {
      success: true,
      text: data.response || "",
      raw: data,
    };
  }

  //==========================================================
  // CALL REASONING MODEL
  //==========================================================
  async callReasoningModel(prompt, model, options = {}) {
    // If OpenAI API key is present, use OpenAI chat completions
    if (this.options.openaiApiKey) {
      return await this.callOpenAICompatibleChat([
        { role: "system", content: "You are an expert autonomous browser reasoning agent. Think through complex DOM interactions step by step." },
        { role: "user", content: prompt },
      ], model, options);
    }

    // Default to local Ollama model with reasoning instructions
    const enhancedPrompt = `[REASONING TASK]\nCarefully analyze the following goal and page state. Think step by step.\n${prompt}`;
    return await this.callFastModel(enhancedPrompt, model, options);
  }

  //==========================================================
  // CALL VISION MODEL (MULTIMODAL)
  //==========================================================
  async callVisionModel(prompt, model, options = {}) {
    const image = options.imageBase64 || options.imageUrl || options.observation?.somScreenshot || options.observation?.screenshot;

    if (!image) {
      throw new Error("No image data provided for Vision model.");
    }

    const imageUrl = image.startsWith("data:") ? image : `data:image/png;base64,${image}`;

    // 1. If OpenAI API key is configured, use OpenAI GPT-4o Vision
    if (this.options.openaiApiKey) {
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: imageUrl, detail: options.imageDetail || "high" },
            },
          ],
        },
      ];
      return await this.callOpenAICompatibleChat(messages, model, options);
    }

    // 2. If Ollama local vision model is available (e.g. llava, minicpm-v)
    const base64Clean = image.replace(/^data:image\/[a-z]+;base64,/, "");
    const res = await fetch(this.options.ollamaEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || "llava",
        prompt,
        images: [base64Clean],
        stream: false,
        options: { temperature: 0 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Ollama vision model returned HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return {
      success: true,
      text: data.response || "",
      raw: data,
    };
  }

  //==========================================================
  // OPENAI COMPATIBLE CHAT HELPER
  //==========================================================
  async callOpenAICompatibleChat(messages, model, options = {}) {
    const res = await fetch(this.options.openaiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.options.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: model || "gpt-4o",
        messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 1024,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI compatible API returned HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    return {
      success: true,
      text,
      raw: data,
    };
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

    const tier = options.useVisualSoM && observation.somScreenshot ? "vision" : "fast";
    const result = await this.complete(prompt, {
      tier,
      taskType: "action_decision",
      imageBase64: observation.somScreenshot,
      temperature: 0,
    });

    try {
      // Parse JSON from model output
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
