const fetch = require("node-fetch");

module.exports = async function runAI(command, page, onStream) {
  try {
    const prompt = `
User: ${command}

Buttons:
${JSON.stringify(page?.buttons || [])}

Think step-by-step and respond in JSON:
{"thought":"...","action":"click|type|scroll","value":"..."}
`;

    const res = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen3:8b",
        prompt,
        stream: true, // IMPORTANT
      }),
    });

    let finalText = "";

    // STREAM READING
    for await (const chunk of res.body) {
      const lines = chunk.toString().split("\n");

      for (const line of lines) {
        if (!line.trim()) continue;

        const json = JSON.parse(line);

        if (json.response) {
          finalText += json.response;

          // 🔥 send live thinking
          if (onStream) onStream(json.response);
        }
      }
    }

    // CLEAN JSON
    const match = finalText.match(/\{[\s\S]*\}/);

    if (match) return JSON.parse(match[0]);

    return { action: "scroll" };
  } catch (err) {
    console.error(err);
    return { action: "scroll" };
  }
};
