// planner.js
//
// Production-ready planner for Jarvis Browser
//
// Features:
// ✅ Fast regex planner (no LLM call)
// ✅ Qwen/Ollama fallback
// ✅ Multi-step parsing
// ✅ JSON repair
// ✅ Automatic chat/action detection
//
// Usage:
//
// const planner = new Planner({
//     model: "qwen3:8b"
// });
//
// const result = await planner.plan(
//     "Type John in Name and click Submit",
//     pageText
// );
//
// result =>
//
// {
//    mode:"action",
//    steps:[
//       {
//          tool:"type",
//          args:{
//             field:"Name",
//             value:"John"
//          }
//       },
//       {
//          tool:"click",
//          args:{
//             text:"Submit"
//          }
//       }
//    ]
// }

export default class Planner {
  constructor(options = {}) {
    this.model = options.model || "qwen3:8b";
    this.ollama = options.endpoint || "http://localhost:11434/api/generate";
  }

  // ====================================================
  // PUBLIC
  // ====================================================

  async plan(command, pageText = "") {
    const fast = this.regexPlan(command);

    if (fast) {
      return {
        mode: "action",
        steps: fast,
      };
    }

    return await this.llmPlan(command, pageText);
  }

  // ====================================================
  // REGEX PLANNER
  // ====================================================

  regexPlan(command) {
    if (!command) return null;

    const steps = [];

    const pieces = command
      .split(/(?:\band\b|,|then)/i)
      .map((x) => x.trim())
      .filter(Boolean);

    for (const p of pieces) {
      const lower = p.toLowerCase();

      // ----------------------------------
      // CLICK
      // ----------------------------------

      let m = p.match(/^click\s+(.+)$/i);

      if (m) {
        steps.push({
          tool: "click",
          args: {
            text: m[1].trim(),
          },
        });

        continue;
      }

      // ----------------------------------
      // TYPE
      //
      // type John in Name
      // type John into Name
      // type John as Name
      // ----------------------------------

      m = p.match(/^type\s+(.+?)\s+(?:in|into|as)\s+(.+)$/i);

      if (m) {
        steps.push({
          tool: "type",
          args: {
            value: m[1].trim(),
            field: m[2].trim(),
          },
        });

        continue;
      }

      // ----------------------------------
      // SELECT
      // ----------------------------------

      m = p.match(/^select\s+(.+?)\s+(?:in|from)\s+(.+)$/i);

      if (m) {
        steps.push({
          tool: "select",
          args: {
            value: m[1].trim(),
            field: m[2].trim(),
          },
        });

        continue;
      }

      // ----------------------------------
      // CHECK
      // ----------------------------------

      m = p.match(/^check\s+(.+)$/i);

      if (m) {
        steps.push({
          tool: "check",
          args: {
            field: m[1].trim(),
          },
        });

        continue;
      }

      // ----------------------------------
      // UNCHECK
      // ----------------------------------

      m = p.match(/^uncheck\s+(.+)$/i);

      if (m) {
        steps.push({
          tool: "uncheck",
          args: {
            field: m[1].trim(),
          },
        });

        continue;
      }

      // ----------------------------------
      // HOVER
      // ----------------------------------

      m = p.match(/^hover\s+(.+)$/i);

      if (m) {
        steps.push({
          tool: "hover",
          args: {
            text: m[1].trim(),
          },
        });

        continue;
      }

      // ----------------------------------
      // PRESS
      // ----------------------------------

      m = p.match(/^press\s+(.+)$/i);

      if (m) {
        steps.push({
          tool: "press",
          args: {
            key: m[1].trim(),
          },
        });

        continue;
      }

      // ----------------------------------
      // WAIT
      // ----------------------------------

      m = p.match(/^wait\s+([0-9]+)(ms|s)?$/i);

      if (m) {
        let time = Number(m[1]);

        if (m[2] === "s") {
          time *= 1000;
        }

        steps.push({
          tool: "wait",
          args: {
            time,
          },
        });

        continue;
      }

      // ----------------------------------
      // NAVIGATE
      // ----------------------------------

      m = p.match(/^go\s+to\s+(.+)$/i);

      if (m) {
        steps.push({
          tool: "navigate",
          args: {
            url: m[1].trim(),
          },
        });

        continue;
      }

      // ----------------------------------
      // READ
      // ----------------------------------

      m = p.match(/^read\s+(.+)$/i);

      if (m) {
        steps.push({
          tool: "read",
          args: {
            text: m[1].trim(),
          },
        });

        continue;
      }
    }

    if (!steps.length) {
      return null;
    }

    return steps;
  }

  // ====================================================
  // OLLAMA / QWEN
  // ====================================================

  async llmPlan(command, pageText) {
    const prompt = `
Return ONLY valid JSON.

If chatting:

{
 "mode":"chat",
 "reply":"..."
}

If browser action:

{
 "mode":"action",
 "steps":[
   {
      "tool":"click",
      "args":{
          "text":"..."
      }
   }
 ]
}

Supported tools:

click
type
select
check
uncheck
hover
press
wait
navigate
read

Examples:

Click Learn more

{
 "mode":"action",
 "steps":[
   {
      "tool":"click",
      "args":{
          "text":"Learn more"
      }
   }
 ]
}

Type John into Name

{
 "mode":"action",
 "steps":[
   {
      "tool":"type",
      "args":{
          "field":"Name",
          "value":"John"
      }
   }
 ]
}

Page:

${pageText}

User:

${command}
`;

    const r = await fetch(this.ollama, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: 0,
        },
      }),
    });

    const json = await r.json();

    const parsed = this.safeParse(json.response);

    if (parsed) {
      return parsed;
    }

    return {
      mode: "chat",
      reply: json.response || "Unable to understand request.",
    };
  }

  // ====================================================
  // SAFE JSON
  // ====================================================

  safeParse(text) {
    if (!text) return null;

    text = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const match = text.match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
