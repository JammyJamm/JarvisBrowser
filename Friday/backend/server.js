const express = require("express");
const cors = require("cors");
const runAI = require("./aiEngine");

const app = express();

app.use(cors());
app.use(express.json());

app.post("/ai", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  await runAI(req.body.command, req.body.page, (chunk) => {
    res.write(`data: ${chunk}\n\n`);
  });

  res.write(`data: [DONE]\n\n`);
  res.end();
});

app.listen(3001, () => {
  console.log("🚀 Backend running on http://localhost:3001");
});
