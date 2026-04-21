const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/ai", async (req, res) => {
  const { command, page } = req.body;

  // 🧠 STRONG PROMPT (VERY IMPORTANT)
  const prompt = `
You are a browser AI.

User command: "${command}"

Available buttons:
${page.buttons.map((b, i) => `${i}: ${b.text}`).join("\n")}

Return ONLY JSON.
No explanation.

Format:
{
  "action": "click",
  "index": number
}
`;

  const ollamaRes = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen3",
      prompt,
      stream: true,
    }),
  });

  // ✅ SSE HEADERS
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const reader = ollamaRes.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const json = JSON.parse(line);

        if (json.response) {
          // ✅ SEND SSE FORMAT
          res.write(`data: ${JSON.stringify({ response: json.response })}\n\n`);
        }
      } catch {}
    }
  }

  res.write(`data: [DONE]\n\n`);
  res.end();
});

app.listen(3001, () => {
  console.log("🚀 AI Server running on http://localhost:3001");
});
