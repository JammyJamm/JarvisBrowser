//==========================================================
//
// backend/agent/observation-builder.js
//
// Observation Builder & Context Formatter
//
// Features
// --------
// ✔ Formats observations for Fast, Reasoning, and Vision models
// ✔ Compresses large DOM trees into high-signal element lists
// ✔ Formats Set-of-Marks prompts with numeric index grounding
// ✔ Provides sanitized debug summaries for UI logs
//
//==========================================================

export default class ObservationBuilder {
  /**
   * Build compact text summary for Fast LLMs (Ollama qwen3:8b)
   * Avoids blowing up context windows while preserving high precision.
   */
  static buildPromptForFastLLM(observation, userGoal) {
    const elements = observation.elements || [];
    const visibleElements = elements.filter((e) => e.isInViewport).slice(0, 35);

    const elementsFormatted = visibleElements
      .map((e) => {
        const text = e.text || e.placeholder || e.ariaLabel || e.value || "";
        const desc = text ? ` "${text}"` : "";
        return `[#${e.index}] <${e.role || e.tagName}>${desc} at (${e.center.x},${e.center.y})`;
      })
      .join("\n");

    return `
PAGE: ${observation.url} ("${observation.title}")
VIEWPORT: ${observation.viewport?.width}x${observation.viewport?.height}

VISIBLE INTERACTIVE ELEMENTS:
${elementsFormatted || "(No visible interactive elements detected)"}

USER GOAL: "${userGoal}"

Determine the next single action to take. Return valid JSON only:
{
  "tool": "click" | "type" | "navigate" | "scroll" | "wait" | "finish",
  "args": {
    "text": "<target text or description>",
    "index": <element # number or null>,
    "value": "<text to enter if typing, or null>",
    "url": "<url if navigating, or null>"
  },
  "rationale": "<brief reason>"
}
`.trim();
  }

  /**
   * Build Multimodal Set-of-Marks prompt for Vision models (GPT-4o, Claude Sonnet, Gemini Flash)
   */
  static buildPromptForVision(observation, userGoal) {
    const markedCount = observation.markedElements?.length || observation.visibleCount || 0;

    return `
You are analyzing a browser viewport screenshot with Set-of-Marks (SoM) bounding boxes.
Each interactive element has a red bounding box and a red numeric badge [#ID] in the top-left corner.

USER GOAL: "${userGoal}"
PAGE URL: ${observation.url}
PAGE TITLE: "${observation.title}"
TOTAL MARKED ELEMENTS: ${markedCount}

INSTRUCTIONS:
1. Examine the image and identify the exact numbered element badge that best advances the user's goal.
2. If typing into a field, specify the element index and the text to type.
3. If clicking a button, link, tab, or menu item, specify the exact element index.
4. If the goal is already satisfied, specify tool: "finish".

Respond ONLY with a JSON object:
{
  "tool": "click" | "type" | "navigate" | "scroll" | "wait" | "finish",
  "args": {
    "index": <number on the red badge>,
    "text": "<label or visual text of element>",
    "value": "<value to type, or null>",
    "url": "<url if navigating, or null>"
  },
  "visualReason": "<what you visually see at that marker>"
}
`.trim();
  }

  /**
   * Format observation metadata for UI logs & telemetry
   */
  static summarize(observation) {
    return {
      url: observation.url,
      title: observation.title,
      totalElements: observation.elementCount || 0,
      visibleElements: observation.visibleCount || 0,
      hasScreenshot: Boolean(observation.screenshot),
      hasSoM: Boolean(observation.somScreenshot),
      somMarkedCount: observation.markedElements?.length || 0,
      timings: observation.timings || {},
    };
  }
}
