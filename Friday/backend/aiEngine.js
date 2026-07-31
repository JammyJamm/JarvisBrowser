//==========================================================
//
// backend/aiEngine.js
//
// AI Engine
//
// Responsibilities
// ----------------
// 1. Send user chat to Ollama
// 2. Stream Ollama response
// 3. Return final text response
// 4. Support live response streaming to UI
//
// IMPORTANT
// ----------
// This module is used ONLY for Chat AI.
//
// Browser action planning is handled separately by:
//
// CommandRouter
//      ↓
// Planner
//      ↓
// ToolMap
//      ↓
// Resolver
//      ↓
// Playwright MCP
//
//==========================================================

//==========================================================
// CONFIGURATION
//==========================================================

const OLLAMA_ENDPOINT =
  process.env.OLLAMA_ENDPOINT || "http://localhost:11434/api/generate";

const AI_MODEL = process.env.AI_MODEL || "qwen3:8b";

//==========================================================
// CHAT
//==========================================================
//
// Example:
//
// const result = await aiEngine.chat("hi");
//
// Returns:
//
// {
//   success: true,
//   reply: "Hello! How can I help you?",
//   model: "qwen3:8b"
// }
//
//==========================================================

async function chat(command, context = {}) {
  const input = String(command || "").trim();

  //--------------------------------------------------------
  // VALIDATE INPUT
  //--------------------------------------------------------

  if (!input) {
    return {
      success: false,

      reply: "Please enter a message.",
    };
  }

  //--------------------------------------------------------
  // DEBUG
  //--------------------------------------------------------

  if (context.debug) {
    console.log("[AI Engine] Chat request:", input);

    console.log("[AI Engine] Model:", AI_MODEL);

    console.log("[AI Engine] Endpoint:", OLLAMA_ENDPOINT);
  }

  //--------------------------------------------------------
  // CHAT PROMPT
  //--------------------------------------------------------

  const prompt = `
You are a helpful AI assistant inside an AI-powered browser automation application.

The user is having a normal conversation with you.

User:
${input}

Rules:
1. Answer the user's message naturally and directly.
2. Be helpful, concise, and clear.
3. Do NOT return browser automation steps.
4. Do NOT return click commands.
5. Do NOT return type commands.
6. Do NOT return scroll commands.
7. Do NOT return navigate commands.
8. Do NOT return Playwright commands.
9. Do NOT create an execution plan.
10. Do NOT return JSON unless the user explicitly asks for JSON.
11. If the user says "hi", "hello", or similar greetings, respond naturally.
12. If the user asks a general question, answer the question normally.

Answer:
`;

  //--------------------------------------------------------
  // OLLAMA REQUEST
  //--------------------------------------------------------

  try {
    const response = await fetch(OLLAMA_ENDPOINT, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        model: AI_MODEL,

        prompt,

        stream: true,
      }),
    });

    //------------------------------------------------------
    // HTTP ERROR
    //------------------------------------------------------

    if (!response.ok) {
      let errorText = "";

      try {
        errorText = await response.text();
      } catch {}

      throw new Error(
        `Ollama returned HTTP ${response.status}${
          errorText ? `: ${errorText}` : ""
        }`,
      );
    }

    //------------------------------------------------------
    // STREAM VALIDATION
    //------------------------------------------------------

    if (
      !response.body ||
      typeof response.body[Symbol.asyncIterator] !== "function"
    ) {
      throw new Error("Ollama response stream is unavailable.");
    }

    //------------------------------------------------------
    // STREAM RESPONSE
    //------------------------------------------------------

    let finalText = "";

    let buffer = "";

    let streamFinished = false;

    //------------------------------------------------------
    // READ STREAM
    //------------------------------------------------------

    for await (const chunk of response.body) {
      if (streamFinished) {
        break;
      }

      //----------------------------------------------------
      // Convert chunk to text
      //----------------------------------------------------

      buffer += Buffer.from(chunk).toString("utf8");

      //----------------------------------------------------
      // Ollama returns NDJSON
      //
      // Example:
      //
      // {"response":"Hello"}
      // {"response":" there"}
      // {"done":true}
      //
      //----------------------------------------------------

      const lines = buffer.split("\n");

      //----------------------------------------------------
      // Keep incomplete line
      //----------------------------------------------------

      buffer = lines.pop() || "";

      //----------------------------------------------------
      // Process complete lines
      //----------------------------------------------------

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) {
          continue;
        }

        let json;

        try {
          json = JSON.parse(trimmed);
        } catch (parseError) {
          if (context.debug) {
            console.warn(
              "[AI Engine] Invalid Ollama chunk:",
              parseError.message,
            );
          }

          continue;
        }

        //------------------------------------------------
        // AI TEXT
        //------------------------------------------------

        if (typeof json.response === "string") {
          finalText += json.response;

          //------------------------------------------------
          // LIVE UI STREAM
          //------------------------------------------------

          if (typeof context.onStream === "function") {
            try {
              await context.onStream(json.response);
            } catch (streamError) {
              if (context.debug) {
                console.warn(
                  "[AI Engine] UI stream callback failed:",
                  streamError.message,
                );
              }
            }
          }
        }

        //------------------------------------------------
        // STREAM COMPLETE
        //------------------------------------------------

        if (json.done === true) {
          streamFinished = true;

          break;
        }
      }
    }

    //------------------------------------------------------
    // PROCESS REMAINING BUFFER
    //------------------------------------------------------

    if (!streamFinished && buffer.trim()) {
      try {
        const json = JSON.parse(buffer.trim());

        if (typeof json.response === "string") {
          finalText += json.response;

          if (typeof context.onStream === "function") {
            try {
              await context.onStream(json.response);
            } catch {}
          }
        }
      } catch (parseError) {
        if (context.debug) {
          console.warn(
            "[AI Engine] Failed to parse final Ollama chunk:",
            parseError.message,
          );
        }
      }
    }

    //------------------------------------------------------
    // FINAL REPLY
    //------------------------------------------------------

    const reply = finalText.trim();

    //------------------------------------------------------
    // EMPTY RESPONSE
    //------------------------------------------------------

    if (!reply) {
      return {
        success: true,

        reply: "I don't have a response for that.",

        model: AI_MODEL,
      };
    }

    //------------------------------------------------------
    // SUCCESS
    //------------------------------------------------------

    if (context.debug) {
      console.log("[AI Engine] Chat response:", reply);
    }

    return {
      success: true,

      reply,

      model: AI_MODEL,
    };
  } catch (err) {
    //------------------------------------------------------
    // ERROR
    //------------------------------------------------------

    console.error("[AI Engine] Error:", err);

    throw new Error(`Ollama Chat failed: ${err?.message || String(err)}`);
  }
}

//==========================================================
// DEFAULT EXPORT
//==========================================================
//
// IMPORTANT
// ----------
// CommandRouter expects:
//
// aiEngine.chat()
//
// Therefore we export an object containing chat().
//
//==========================================================

const aiEngine = {
  chat,
};

export default aiEngine;

//==========================================================
// NAMED EXPORT
//==========================================================
//
// Optional direct import:
//
// import { chat } from "./aiEngine.js";
//
//==========================================================

export { chat };
