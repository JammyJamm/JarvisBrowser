// Ultra-fast deterministic browser command parser.
// Supports single commands AND numbered/multi-line action commands.
// LLM is never called when every step is deterministic.

const clean = (s) => String(s || "")
  .trim()
  .replace(/^\s*(?:the|a|an)\s+/i, "")
  .replace(/^['"]|['"]$/g, "")
  .trim();

function parseSingle(raw) {
  const command = clean(raw);
  const text = command.toLowerCase();
  if (!command) return null;

  let m;

  if ((m = command.match(/^(?:click|press|tap)\s+(.+?)(?:\s+button)?$/i))) {
    return { tool: "click", args: { text: clean(m[1]) } };
  }

  if ((m = command.match(/^(?:type|enter|fill|write)\s+(.+?)\s+(?:in|into|on)\s+(.+)$/i))) {
    return {
      tool: "type",
      args: { field: clean(m[2]), value: clean(m[1]) },
    };
  }

  if ((m = command.match(/^(?:go\s+to|goto|navigate\s+to|open)\s+(.+)$/i))) {
    return { tool: "navigate", args: { url: clean(m[1]) } };
  }

  if (/^(?:go\s+)?back$/i.test(text)) {
    return { tool: "back", args: {} };
  }

  if (/^(?:go\s+)?forward$/i.test(text)) {
    return { tool: "forward", args: {} };
  }

  if (/^(?:refresh|reload)(?:\s+page)?$/i.test(text)) {
    return { tool: "reload", args: {} };
  }

  return null;
}

function splitSteps(command) {
  const normalized = String(command || "")
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!normalized) return [];

  // Handles:
  // 1. Navigate to ...
  // 2. Click ...
  //
  // and also:
  // Navigate to ...
  // Click ...
  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\s*(?:\d+|[a-zA-Z])\s*[.)-]\s*/, "").trim())
    .filter(Boolean);

  return lines;
}

export function fastPath(command) {
  const raw = clean(command);
  if (!raw) return null;

  const lines = splitSteps(raw);

  // Single command.
  if (lines.length === 1) {
    const step = parseSingle(lines[0]);
    return step
      ? { source: "fast-path", mode: "action", steps: [step] }
      : null;
  }

  // Multi-step command: every line MUST be deterministic.
  const steps = [];

  for (const line of lines) {
    const step = parseSingle(line);
    if (!step) return null;
    steps.push(step);
  }

  return {
    source: "fast-path",
    mode: "action",
    steps,
  };
}

export function isBrowserActionText(command) {
  const lines = splitSteps(command);
  if (!lines.length) return false;

  return lines.every((line) => {
    const text = line.toLowerCase();
    return /^(click|press|tap|type|enter|fill|write|go\s+to|goto|navigate\s+to|open|back|go\s+back|forward|go\s+forward|refresh|reload)\b/i.test(text);
  });
}
