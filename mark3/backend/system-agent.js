//==========================================================
//
// backend/system-agent.js
//
// Local System, Project Folder & CLI Installation Agent
//
// Responsibilities
// ----------------
// 1. Inspect project folder & local system paths
// 2. Read / list / write files cleanly
// 3. Install & run CLI tools (cli-anything-hub, cli-hub, pip, npm, git)
// 4. Clone & inspect GitHub repositories into <projectRoot>/external
// 5. Gate all mutating / install / shell operations behind explicit
//    user confirmation (pendingActions store -> /system/approve)
//
//==========================================================

import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..");

const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_OUTPUT_CHARS = 24000;
const MAX_READ_BYTES = 65536;
const DEFAULT_CMD_TIMEOUT_MS = 180000;

export default class SystemAgent {
  constructor(options = {}) {
    this.projectRoot = path.resolve(options.projectRoot || DEFAULT_PROJECT_ROOT);
    this.externalDir = path.join(this.projectRoot, "external");
    this.model = options.model || process.env.AI_MODEL || "qwen3:8b";
    this.endpoint =
      options.endpoint ||
      process.env.OLLAMA_ENDPOINT ||
      "http://localhost:11434/api/generate";
    this.debug = Boolean(options.debug);
    this.pendingActions = new Map();
  }

  log(...args) {
    if (this.debug) {
      console.log("[SystemAgent]", ...args);
    }
  }

  //========================================================
  // PATH RESOLUTION
  //========================================================

  resolvePath(targetPath = ".") {
    const raw = String(targetPath || ".").trim();
    if (!raw || raw === "." || raw === "project" || raw === "project folder") {
      return this.projectRoot;
    }

    if (raw.startsWith("~/") || raw === "~") {
      return path.resolve(os.homedir(), raw.slice(2));
    }

    if (path.isAbsolute(raw)) {
      return path.normalize(raw);
    }

    return path.resolve(this.projectRoot, raw);
  }

  //========================================================
  // SHELL EXECUTION
  //========================================================

  runCommand(command, options = {}) {
    const cmd = String(command || "").trim();
    if (!cmd) {
      return Promise.resolve({
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "Empty command.",
        cwd: this.projectRoot,
        durationMs: 0,
      });
    }

    const cwd = this.resolvePath(options.cwd || this.projectRoot);
    const timeoutMs = Number(options.timeoutMs || DEFAULT_CMD_TIMEOUT_MS);
    const started = performance.now();

    return new Promise((resolve) => {
      const isWin = process.platform === "win32";
      const shellExe = isWin ? "powershell.exe" : "/bin/sh";
      const shellArgs = isWin
        ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd]
        : ["-c", cmd];

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const proc = spawn(shellExe, shellArgs, {
        cwd,
        env: { ...process.env },
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill("SIGTERM");
        } catch {}
      }, timeoutMs);

      proc.stdout?.on("data", (chunk) => {
        if (stdout.length < MAX_OUTPUT_CHARS) {
          stdout += chunk.toString();
        }
      });

      proc.stderr?.on("data", (chunk) => {
        if (stderr.length < MAX_OUTPUT_CHARS) {
          stderr += chunk.toString();
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          exitCode: 1,
          stdout: stdout.slice(0, MAX_OUTPUT_CHARS),
          stderr: err.message,
          cwd,
          durationMs: Math.round(performance.now() - started),
        });
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          stderr += `\n[Timed out after ${Math.round(timeoutMs / 1000)}s]`;
        }
        resolve({
          success: !timedOut && code === 0,
          exitCode: code ?? (timedOut ? 124 : 1),
          stdout: stdout.slice(0, MAX_OUTPUT_CHARS).trimEnd(),
          stderr: stderr.slice(0, MAX_OUTPUT_CHARS).trimEnd(),
          cwd,
          durationMs: Math.round(performance.now() - started),
        });
      });
    });
  }

  //========================================================
  // READ-ONLY SYSTEM & FILE TOOLS
  //========================================================

  async getSystemInfo() {
    const probes = await Promise.all([
      this.runCommand("node --version", { timeoutMs: 5000 }),
      this.runCommand("python --version", { timeoutMs: 5000 }),
      this.runCommand("pip --version", { timeoutMs: 5000 }),
      this.runCommand("git --version", { timeoutMs: 5000 }),
      this.runCommand("cli-hub --version", { timeoutMs: 5000 }),
    ]);

    const formatProbe = (res) =>
      res.success ? (res.stdout || res.stderr || "installed").split(/\r?\n/)[0] : "not installed";

    let projectEntries = [];
    try {
      const entries = await fs.readdir(this.projectRoot, { withFileTypes: true });
      projectEntries = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
      }));
    } catch {}

    let externalRepos = [];
    try {
      const extEntries = await fs.readdir(this.externalDir, { withFileTypes: true });
      externalRepos = extEntries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {}

    return {
      success: true,
      action: "system_info",
      platform: process.platform,
      arch: process.arch,
      homedir: os.homedir(),
      projectRoot: this.projectRoot,
      externalDir: this.externalDir,
      tools: {
        node: formatProbe(probes[0]),
        python: formatProbe(probes[1]),
        pip: formatProbe(probes[2]),
        git: formatProbe(probes[3]),
        cliHub: formatProbe(probes[4]),
      },
      projectEntries,
      externalRepos,
    };
  }

  async listDir(targetPath = ".") {
    const resolved = this.resolvePath(targetPath);
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${resolved}`);
    }

    const dirents = await fs.readdir(resolved, { withFileTypes: true });
    const entries = await Promise.all(
      dirents
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 200)
        .map(async (entry) => {
          const fullPath = path.join(resolved, entry.name);
          let size = null;
          if (!entry.isDirectory()) {
            try {
              const s = await fs.stat(fullPath);
              size = s.size;
            } catch {}
          }
          return {
            name: entry.name,
            type: entry.isDirectory() ? "dir" : "file",
            size,
            path: fullPath,
          };
        }),
    );

    return {
      success: true,
      action: "list_dir",
      path: resolved,
      count: entries.length,
      totalInDir: dirents.length,
      entries,
    };
  }

  async readFile(targetPath) {
    const resolved = this.resolvePath(targetPath);
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      return await this.listDir(resolved);
    }

    const handle = await fs.open(resolved, "r");
    try {
      const readLen = Math.min(stat.size, MAX_READ_BYTES);
      const buffer = Buffer.alloc(readLen);
      await handle.read(buffer, 0, readLen, 0);
      return {
        success: true,
        action: "read_file",
        path: resolved,
        size: stat.size,
        truncated: stat.size > MAX_READ_BYTES,
        content: buffer.toString("utf8"),
      };
    } finally {
      await handle.close();
    }
  }

  async writeFile(targetPath, content) {
    const resolved = this.resolvePath(targetPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, String(content ?? ""), "utf8");
    return {
      success: true,
      action: "write_file",
      path: resolved,
      bytes: Buffer.byteLength(String(content ?? ""), "utf8"),
    };
  }

  //========================================================
  // GITHUB & PACKAGE INSTALL HELPERS
  //========================================================

  parseGitHubUrl(text) {
    const match = String(text || "").match(
      /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:[/?#][^\s]*)?/i,
    );
    if (!match) return null;
    const owner = match[1];
    const repo = match[2].replace(/\.git$/i, "");
    return {
      owner,
      repo,
      slug: `${owner}/${repo}`,
      url: `https://github.com/${owner}/${repo}.git`,
      webUrl: `https://github.com/${owner}/${repo}`,
    };
  }

  buildGitHubInstallCommand(gh) {
    const targetDir = path.join(this.externalDir, gh.repo);
    const quotedExternal = `"${this.externalDir}"`;
    const quotedTarget = `"${targetDir}"`;

    if (gh.slug.toLowerCase() === "hkuds/cli-anything") {
      if (process.platform === "win32") {
        return [
          `if (!(Test-Path ${quotedExternal})) { New-Item -ItemType Directory -Path ${quotedExternal} -Force | Out-Null }`,
          `if (Test-Path "${path.join(targetDir, ".git")}") { git -C ${quotedTarget} pull } else { git clone "${gh.url}" ${quotedTarget} }`,
          `pip install cli-anything-hub`,
          `cli-hub --version`,
        ].join("; ");
      }
      return `mkdir -p ${quotedExternal} && (test -d "${path.join(targetDir, ".git")}" && git -C ${quotedTarget} pull || git clone "${gh.url}" ${quotedTarget}) && pip install cli-anything-hub && cli-hub --version`;
    }

    if (process.platform === "win32") {
      return [
        `if (!(Test-Path ${quotedExternal})) { New-Item -ItemType Directory -Path ${quotedExternal} -Force | Out-Null }`,
        `if (Test-Path "${path.join(targetDir, ".git")}") { git -C ${quotedTarget} pull } else { git clone "${gh.url}" ${quotedTarget} }`,
        `if (Test-Path "${path.join(targetDir, "package.json")}") { npm --prefix ${quotedTarget} install }`,
        `if (Test-Path "${path.join(targetDir, "requirements.txt")}") { pip install -r "${path.join(targetDir, "requirements.txt")}" }`,
        `if ((Test-Path "${path.join(targetDir, "pyproject.toml")}") -or (Test-Path "${path.join(targetDir, "setup.py")}")) { pip install -e ${quotedTarget} }`,
      ].join("; ");
    }

    return [
      `mkdir -p ${quotedExternal}`,
      `(test -d "${path.join(targetDir, ".git")}" && git -C ${quotedTarget} pull || git clone "${gh.url}" ${quotedTarget})`,
      `(test -f "${path.join(targetDir, "package.json")}" && npm --prefix ${quotedTarget} install || true)`,
      `(test -f "${path.join(targetDir, "requirements.txt")}" && pip install -r "${path.join(targetDir, "requirements.txt")}" || true)`,
      `((test -f "${path.join(targetDir, "pyproject.toml")}" || test -f "${path.join(targetDir, "setup.py")}") && pip install -e ${quotedTarget} || true)`,
    ].join(" && ");
  }

  //========================================================
  // GENERIC SOFTWARE AUTO-INSTALL & SELF-HEALING HELPERS
  //========================================================

  unwrapInstallRequest(input) {
    return String(input || "")
      .trim()
      .replace(/^(?:hey\s+|ok\s+|hi\s+)?(?:jarvis|friday)[,:\s]+/i, "")
      .replace(/^(?:can|could|would|will)\s+you\s+(?:please\s+|kindly\s+)?/i, "")
      .replace(/^(?:please|kindly)\s+/i, "")
      .replace(/[?!.]+$/g, "")
      .trim();
  }

  async checkInstalled(target) {
    const clean = String(target || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .split(/\s+/)[0];
    if (!clean || !/^[a-zA-Z0-9._@-]+$/.test(clean)) {
      return { installed: false };
    }

    const cmd = process.platform === "win32"
      ? `Get-Command "${clean}" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source`
      : `command -v "${clean}"`;

    const res = await this.runCommand(cmd, { timeoutMs: 5000 });
    if (res.success && res.stdout.trim()) {
      return { installed: true, location: res.stdout.trim().split(/\r?\n/)[0] };
    }
    return { installed: false };
  }

  buildInstallerOptions(target, raw = "") {
    const cleanTarget = String(target || "").trim().replace(/^["']|["']$/g, "");
    const options = [];
    const isWin = process.platform === "win32";

    if (/^(?:npm|node)\s+/i.test(cleanTarget)) {
      const pkg = cleanTarget.replace(/^(?:npm|node)\s+/i, "").trim();
      options.push({ id: "npm_local", label: `npm install ${pkg}`, commandText: `npm install ${pkg}` });
      options.push({ id: "npm_global", label: `npm install -g ${pkg}`, commandText: `npm install -g ${pkg}` });
      return options;
    }

    if (/^cli\s+/i.test(cleanTarget) || /\bcli\b/i.test(raw)) {
      const cliName = cleanTarget.replace(/^cli\s+/i, "").trim();
      options.push({ id: "cli_hub", label: `cli-hub install ${cliName}`, commandText: `cli-hub install ${cliName}` });
    }

    if (isWin) {
      options.push({
        id: "winget",
        label: `winget (Windows App): ${cleanTarget}`,
        commandText: `winget install "${cleanTarget}" --accept-package-agreements --accept-source-agreements`,
      });
      options.push({
        id: "choco",
        label: `choco: ${cleanTarget}`,
        commandText: `choco install ${cleanTarget} -y`,
      });
    } else if (process.platform === "darwin") {
      options.push({ id: "brew", label: `brew install ${cleanTarget}`, commandText: `brew install ${cleanTarget}` });
    } else {
      options.push({ id: "apt", label: `apt install ${cleanTarget}`, commandText: `sudo apt-get install -y ${cleanTarget}` });
    }

    options.push({ id: "pip", label: `pip (Python): ${cleanTarget}`, commandText: `pip install ${cleanTarget}` });
    options.push({ id: "npm", label: `npm (Node.js): ${cleanTarget}`, commandText: `npm install ${cleanTarget}` });

    return options;
  }

  diagnoseAndHealCommand(cmd, runResult) {
    const combined = `${runResult.stdout || ""}\n${runResult.stderr || ""}`.toLowerCase();
    const trimmedCmd = String(cmd || "").trim();

    // 1. pip missing on PATH -> python -m pip (or py -3 -m pip on Windows)
    if (/^pip3?\s+/i.test(trimmedCmd) && (combined.includes("is not recognized") || combined.includes("not found") || combined.includes("no such file"))) {
      const healed = trimmedCmd.replace(/^pip3?\s+/i, process.platform === "win32" ? "python -m pip " : "python3 -m pip ");
      return { strategy: "python_module_pip", healedCommand: healed, reason: "pip binary not on PATH; retrying via python -m pip" };
    }

    // 2. python missing on Windows -> py -3
    if (process.platform === "win32" && /^python\s+/i.test(trimmedCmd) && (combined.includes("is not recognized") || combined.includes("not found"))) {
      const healed = trimmedCmd.replace(/^python\s+/i, "py -3 ");
      return { strategy: "windows_py_launcher", healedCommand: healed, reason: "python not on PATH; retrying via Windows py -3 launcher" };
    }

    // 3. pip permission / externally-managed-environment -> --user
    if (
      /^(?:pip3?|python(?:3)?\s+-m\s+pip|py\s+-3\s+-m\s+pip)\s+install\b/i.test(trimmedCmd) &&
      !trimmedCmd.includes("--user") &&
      (combined.includes("externally-managed-environment") || combined.includes("permission denied") || combined.includes("access is denied"))
    ) {
      return {
        strategy: "pip_user_install",
        healedCommand: `${trimmedCmd} --user`,
        reason: "Retried pip install with --user due to environment/permission restriction",
      };
    }

    // 4. winget interactive agreement prompt
    if (/^winget\s+install\b/i.test(trimmedCmd) && !trimmedCmd.includes("--accept-package-agreements")) {
      return {
        strategy: "winget_accept_agreements",
        healedCommand: `${trimmedCmd} --accept-package-agreements --accept-source-agreements`,
        reason: "Added non-interactive winget agreement flags",
      };
    }

    // 5. npm peer dependency conflict
    if (/^npm\s+(?:install|i)\b/i.test(trimmedCmd) && combined.includes("eresolve") && !trimmedCmd.includes("--legacy-peer-deps")) {
      return {
        strategy: "npm_legacy_peer_deps",
        healedCommand: `${trimmedCmd} --legacy-peer-deps`,
        reason: "Retried npm install with --legacy-peer-deps after peer resolution conflict",
      };
    }

    // 6. git clone destination already exists -> git pull
    const cloneMatch = trimmedCmd.match(/^git\s+clone\s+\S+\s+("[^"]+"|\S+)/i);
    if (cloneMatch && combined.includes("already exists")) {
      const dir = cloneMatch[1];
      return {
        strategy: "git_pull_existing",
        healedCommand: `git -C ${dir} pull`,
        reason: "Repository folder already exists; switched to git pull",
      };
    }

    return null;
  }

  async runCommandWithSelfHealing(command, options = {}) {
    let currentCmd = String(command || "").trim();
    const maxHeals = Number(options.maxHeals ?? 2);
    const healingHistory = [];
    let result = await this.runCommand(currentCmd, options);

    for (let attempt = 0; attempt < maxHeals && !result.success; attempt++) {
      const fix = this.diagnoseAndHealCommand(currentCmd, result);
      if (!fix || fix.healedCommand === currentCmd) {
        break;
      }
      this.log(`Self-healing system command (${fix.strategy}): ${fix.healedCommand}`);
      healingHistory.push({
        attempt: attempt + 1,
        strategy: fix.strategy,
        reason: fix.reason,
        previousCommand: currentCmd,
        healedCommand: fix.healedCommand,
      });
      currentCmd = fix.healedCommand;
      result = await this.runCommand(currentCmd, options);
    }

    return {
      ...result,
      command: currentCmd,
      healed: healingHistory.length > 0 && result.success,
      healingHistory,
    };
  }

  //========================================================
  // CODE HEALING & COMMENT-DRIVEN CODE UPDATES
  //========================================================

  isCodeHealInstruction(input) {
    const text = String(input || "").trim();
    return (
      /^(?:code\s*heal|heal\s*code|update\s+(?:our\s+|the\s+)?code|fix\s+(?:our\s+|the\s+)?code|apply\s+comment|code\s+comment)\b/i.test(
        text,
      ) ||
      (/\b(?:update|edit|modify|change|refactor|patch|heal|fix)\b/i.test(text) &&
        /\b(?:code|source\s*code|file|files|planner|agent|ui|renderer|server|backend|script|function|bug|error|styles?|css|html|js)\b/i.test(
          text,
        ))
    );
  }

  isProjectFile(targetPath) {
    const relative = path.relative(this.projectRoot, path.resolve(targetPath));
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  }

  async findRelevantCodeFiles(instruction) {
    const text = String(instruction || "");
    const found = new Set();

    // 1. Explicit file path mentions in the comment
    const explicitMatches = text.match(/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:js|ts|css|html|json)/g) || [];
    for (const rel of explicitMatches) {
      const full = this.resolvePath(rel);
      if (this.isProjectFile(full)) {
        try {
          const stat = await fs.stat(full);
          const realPath = await fs.realpath(full);
          if (stat.isFile() && this.isProjectFile(realPath)) {
            found.add(path.relative(this.projectRoot, full).replace(/\\/g, "/"));
          }
        } catch {}
      }
    }

    // 2. Keyword-to-module mapping for common mark3 project components
    const keywordMap = [
      { regex: /\b(ui|render|card|step|frontend|chat|dashboard)\b/i, files: ["main/renderer/ai.js", "main/renderer/styles.css"] },
      { regex: /\b(interactive|checkout|payment|variant|svgjarvis|agent)\b/i, files: ["backend/interactive-agent.js"] },
      { regex: /\b(planner|plan|replan)\b/i, files: ["backend/planner.js", "backend/interactive-agent.js"] },
      { regex: /\b(router|route|classify)\b/i, files: ["backend/command-router.js"] },
      { regex: /\b(server|stream|endpoint|api)\b/i, files: ["backend/server.js"] },
      { regex: /\b(executor|self[-\s]?heal|healing)\b/i, files: ["backend/executor.js", "backend/system-agent.js"] },
      { regex: /\b(system|code\s*heal)\b/i, files: ["backend/system-agent.js"] },
      { regex: /\b(ai\s*engine|chat\s*ai|ollama)\b/i, files: ["backend/aiEngine.js"] },
    ];

    for (const entry of keywordMap) {
      if (entry.regex.test(text)) {
        for (const rel of entry.files) {
          try {
            const full = this.resolvePath(rel);
            const stat = await fs.stat(full);
            if (stat.isFile()) found.add(rel);
          } catch {}
        }
      }
    }

    // 3. Fallback: scan top-level backend/*.js and main/renderer/*.js
    if (found.size === 0) {
      for (const dir of ["backend", "main/renderer", "."]) {
        try {
          const entries = await fs.readdir(this.resolvePath(dir), { withFileTypes: true });
          for (const e of entries) {
            if (e.isFile() && /\.(js|css|html)$/i.test(e.name)) {
              const rel = dir === "." ? e.name : `${dir}/${e.name}`;
              found.add(rel);
              if (found.size >= 4) break;
            }
          }
        } catch {}
        if (found.size >= 4) break;
      }
    }

    return [...found].slice(0, 4);
  }

  async callCodeHealLLM(prompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: "json",
          think: false,
          options: { temperature: 0, num_predict: 1800 },
        }),
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`LLM returned HTTP ${res.status}`);
      }
      const json = await res.json();
      const raw = String(json?.response || "").trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start === -1 || end <= start) {
        throw new Error("LLM did not return a JSON patch object.");
      }
      return JSON.parse(raw.slice(start, end + 1));
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  async verifyModifiedFiles(relFiles) {
    const errors = [];
    for (const rel of relFiles) {
      if (!/\.m?js$/i.test(rel)) continue;
      const checkRes = await this.runCommand(`node --check "${rel}"`, {
        cwd: this.projectRoot,
        timeoutMs: 10000,
      });
      if (!checkRes.success) {
        errors.push({
          file: rel,
          error: checkRes.stderr || checkRes.stdout || "Syntax check failed",
        });
      }
    }
    return errors;
  }

  async executeCodeHeal(comment, targetFiles = []) {
    const instruction = String(comment || "").trim();
    if (!instruction) {
      throw new Error("A code update / healing comment is required.");
    }

    const candidates =
      Array.isArray(targetFiles) && targetFiles.length
        ? targetFiles
        : await this.findRelevantCodeFiles(instruction);

    if (!candidates.length) {
      throw new Error("No target source files were found in the project.");
    }

    const fileContents = {};
    const allowedFiles = new Map();
    for (const rel of candidates) {
      const resolved = this.resolvePath(rel);
      if (!this.isProjectFile(resolved)) {
        throw new Error(`Refusing to read outside project root: ${rel}`);
      }
      const realPath = await fs.realpath(resolved);
      if (!this.isProjectFile(realPath)) {
        throw new Error(`Refusing to read outside project root: ${rel}`);
      }
      allowedFiles.set(String(rel).replace(/\\/g, "/"), realPath);
      const content = await fs.readFile(realPath, "utf8");
      fileContents[rel] = content.slice(0, 24000);
    }

    const filesSection = Object.entries(fileContents)
      .map(([rel, content]) => `=== FILE: ${rel} ===\n${content}`)
      .join("\n\n");

    const patchPrompt = `You are the svgJarvis Code Healing & Update Agent.
Apply the user's comment/request safely with minimal exact replacements.

USER COMMENT / REQUEST:
${instruction}

PROJECT FILES:
${filesSection}

Return ONLY valid JSON:
{
  "summary": "Brief description of the code update",
  "edits": [
    {
      "file": "relative/path.js",
      "target": "exact substring currently in the file",
      "replacement": "new substring to replace target with"
    }
  ]
}`;

    let patch = await this.callCodeHealLLM(patchPrompt);
    const backups = new Map();
    const healingHistory = [];

    const applyEdits = async (edits) => {
      if (!Array.isArray(edits) || !edits.length) {
        throw new Error("Code-healing model returned no edits.");
      }
      const touched = new Set();
      for (const edit of edits) {
        const rel = String(edit?.file || "").trim().replace(/\\/g, "/");
        const resolved = allowedFiles.get(rel);
        if (!resolved) {
          throw new Error(`Refusing to edit a file outside the reviewed plan: ${rel}`);
        }
        const current = await fs.readFile(resolved, "utf8");
        if (!backups.has(resolved)) {
          backups.set(resolved, current);
        }
        const target = String(edit.target ?? "");
        const replacement = String(edit.replacement ?? "");
        if (!target || !current.includes(target)) {
          throw new Error(`Target snippet not found in ${rel}`);
        }
        const updated = current.replace(target, replacement);
        await fs.writeFile(resolved, updated, "utf8");
        touched.add(rel);
      }
      return [...touched];
    };

    const rollbackAll = async () => {
      for (const [resolved, original] of backups.entries()) {
        await fs.writeFile(resolved, original, "utf8").catch(() => {});
      }
    };

    let modifiedFiles = [];
    try {
      modifiedFiles = await applyEdits(patch.edits);
      let syntaxErrors = await this.verifyModifiedFiles(modifiedFiles);

      // Self-heal broken syntax automatically up to 2 attempts
      for (let attempt = 0; attempt < 2 && syntaxErrors.length > 0; attempt++) {
        const brokenList = [];
        for (const errItem of syntaxErrors) {
          const brokenText = await fs.readFile(this.resolvePath(errItem.file), "utf8");
          brokenList.push(`FILE: ${errItem.file}\nERROR: ${errItem.error}\nCONTENT:\n${brokenText.slice(0, 24000)}`);
        }

        const healPrompt = `You are the svgJarvis Code Healing Agent.
The previous patch caused syntax errors. Fix ONLY the syntax/code errors while preserving the user's requested change.

USER COMMENT: ${instruction}

BROKEN FILES & ERRORS:
${brokenList.join("\n\n")}

Return ONLY valid JSON:
{
  "summary": "Brief description of the healed fix",
  "edits": [
    {
      "file": "relative/path.js",
      "target": "exact broken substring in file",
      "replacement": "valid fixed substring"
    }
  ]
}`;

        const healPatch = await this.callCodeHealLLM(healPrompt);
        healingHistory.push({
          attempt: attempt + 1,
          strategy: "llm_syntax_self_heal",
          reason: syntaxErrors.map((e) => `${e.file}: ${e.error}`).join("; "),
        });
        const newlyTouched = await applyEdits(healPatch.edits);
        modifiedFiles = [...new Set([...modifiedFiles, ...newlyTouched])];
        syntaxErrors = await this.verifyModifiedFiles(modifiedFiles);
      }

      if (syntaxErrors.length > 0) {
        await rollbackAll();
        return {
          success: false,
          action: "code_heal",
          rolledBack: true,
          modifiedFiles,
          healed: false,
          healingHistory,
          stdout: "",
          stderr: `Rolled back changes because verification failed:\n${syntaxErrors.map((e) => `${e.file}: ${e.error}`).join("\n")}`,
        };
      }

      return {
        success: true,
        action: "code_heal",
        exitCode: 0,
        summary: patch.summary || "Code updated and verified.",
        modifiedFiles,
        healed: healingHistory.length > 0,
        healingHistory,
        stdout: `Updated & syntax-verified (${modifiedFiles.join(", ")})${healingHistory.length ? ` [Self-healed in ${healingHistory.length} attempt(s)]` : ""}`,
        stderr: "",
      };
    } catch (err) {
      await rollbackAll();
      return {
        success: false,
        action: "code_heal",
        exitCode: 1,
        rolledBack: true,
        modifiedFiles,
        healed: false,
        healingHistory,
        stdout: "",
        stderr: err.message,
      };
    }
  }

  //========================================================
  // PLANNER FOR SYSTEM / PROJECT / INSTALL COMMANDS
  //========================================================

  async plan(input) {
    const raw = this.unwrapInstallRequest(input);
    const originalRaw = String(input || "").trim();
    const lower = raw.toLowerCase();

    if (!raw) {
      throw new Error("Empty system command.");
    }

    // 0. Comment-driven code update / code healing
    if (this.isCodeHealInstruction(originalRaw) || this.isCodeHealInstruction(raw)) {
      const targetFiles = await this.findRelevantCodeFiles(originalRaw);
      return {
        mode: "system",
        tool: "code_heal",
        requiresConfirmation: true,
        summary: `Code Healing / Update in ${targetFiles.join(", ") || "project files"}`,
        cwd: this.projectRoot,
        commandText: originalRaw,
        args: {
          comment: originalRaw,
          targetFiles,
        },
      };
    }

    // 1. GitHub URL install / clone
    const gh = this.parseGitHubUrl(originalRaw) || this.parseGitHubUrl(raw);
    if (gh) {
      const targetDir = path.join(this.externalDir, gh.repo);
      const commandText = this.buildGitHubInstallCommand(gh);
      const isCliAnything = gh.slug.toLowerCase() === "hkuds/cli-anything";
      return {
        mode: "system",
        tool: "install_github",
        requiresConfirmation: true,
        summary: isCliAnything
          ? `Clone HKUDS/CLI-Anything into ${targetDir} and install cli-anything-hub via pip`
          : `Clone ${gh.slug} into ${targetDir} and install detected dependencies`,
        cwd: this.projectRoot,
        commandText,
        args: { repo: gh.slug, targetDir, url: gh.url },
      };
    }

    // 2. Direct cli-hub commands (must run before generic cli-hub install phrasing)
    const cliHubMatch = raw.match(/^cli-hub\s+(.+)$/i);
    if (cliHubMatch) {
      const subArgs = cliHubMatch[1].trim();
      const firstWord = subArgs.split(/\s+/)[0]?.toLowerCase() || "";
      const isReadOnly = ["list", "search", "info", "--help", "-h", "--version"].includes(firstWord);
      return {
        mode: "system",
        tool: "cli_hub",
        requiresConfirmation: !isReadOnly,
        summary: isReadOnly ? `Query CLI-Hub: cli-hub ${subArgs}` : `Run CLI-Hub: cli-hub ${subArgs}`,
        cwd: this.projectRoot,
        commandText: `cli-hub ${subArgs}`,
        args: { subcommand: firstWord, rawArgs: subArgs },
      };
    }

    // 3. CLI-Anything / CLI-Hub install
    if (
      /\b(install|setup|add)\b.*\b(cli-anything(?:-hub)?|cli-hub)\b/i.test(raw) ||
      /\b(cli-anything(?:-hub)?|cli-hub)\b.*\b(install|setup|add)\b/i.test(raw)
    ) {
      return {
        mode: "system",
        tool: "install_cli_hub",
        requiresConfirmation: true,
        summary: "Install cli-anything-hub (CLI-Anything package manager) via pip",
        cwd: this.projectRoot,
        commandText: "pip install cli-anything-hub",
        args: { package: "cli-anything-hub" },
      };
    }

    // 4. Direct package manager commands (pip, npm, npx, winget, choco)
    if (/^(pip3?|npm|npx|winget|choco)\s+(install|i|add|uninstall|update|upgrade|test|run)\b/i.test(raw)) {
      return {
        mode: "system",
        tool: "install_package",
        requiresConfirmation: true,
        summary: `Run package manager command: ${raw}`,
        cwd: this.projectRoot,
        commandText: raw,
        args: { command: raw },
      };
    }

    // 4b. Project test suite / health / auto-heal command
    if (/^(?:run\s+(?:all\s+)?tests?|test\s+suite|check\s+project\s+(?:errors|health))$/i.test(lower)) {
      return {
        mode: "system",
        tool: "run_command",
        requiresConfirmation: true,
        summary: `Run project test suite in ${this.projectRoot}`,
        cwd: this.projectRoot,
        commandText: "node tests/run-all-tests.js",
        args: { command: "node tests/run-all-tests.js" },
      };
    }

    // 5. Generic "install / auto install / setup <something>"
    const genericInstall = raw.match(/^(?:auto[-\s]?)?(?:install|setup)\s+(.+)$/i);
    if (genericInstall) {
      const target = genericInstall[1].trim();
      const installedCheck = await this.checkInstalled(target).catch(() => ({ installed: false }));
      const options = this.buildInstallerOptions(target, raw);
      const defaultOpt = options[0] || { commandText: `pip install ${target}` };
      let commandText = defaultOpt.commandText;

      if (/^(?:npm\s+|node\s+)/i.test(target)) {
        const pkg = target.replace(/^(?:npm|node)\s+/i, "").trim();
        commandText = `npm install ${pkg}`;
      } else if (/^cli\s+/i.test(target) || /\bcli\b/i.test(raw)) {
        const cliName = target.replace(/^cli\s+/i, "").trim();
        commandText = `cli-hub install ${cliName}`;
      } else if (process.platform !== "win32" && !/\b(?:app|software|desktop|vlc|chrome|ffmpeg|git|docker|python|vscode)\b/i.test(raw)) {
        commandText = `pip install ${target}`;
      }

      const alreadyNote = installedCheck.installed
        ? ` (already detected at ${installedCheck.location})`
        : "";

      return {
        mode: "system",
        tool: "install_package",
        requiresConfirmation: true,
        summary: `Install "${target}"${alreadyNote} — choose installer or edit command before approving`,
        cwd: this.projectRoot,
        commandText,
        options,
        alreadyInstalled: installedCheck.installed ? installedCheck : null,
        args: { target },
      };
    }

    // 6. System info / environment check
    if (
      /^(?:check|show|get)?\s*(?:system\s*info|environment|env|cli\s*status|python\s*version|node\s*version)$/i.test(
        lower,
      )
    ) {
      return {
        mode: "system",
        tool: "system_info",
        requiresConfirmation: false,
        summary: "Inspect local system environment, project folder, and installed CLI tools",
        cwd: this.projectRoot,
        args: {},
      };
    }

    // 7. Directory listing (project folder or explicit system path)
    const dirMatch =
      raw.match(/^(?:list|show|open|browse|ls|dir)\s+(?:files\s+in\s+|folder\s+|directory\s+|dir\s+)?(.+)$/i) ||
      (/^(?:list\s+(?:project\s+)?files|show\s+project\s+(?:folder|files)|ls|dir)$/i.test(lower)
        ? [raw, "."]
        : null);

    if (dirMatch) {
      const target = (dirMatch[1] || ".").replace(/^(?:the\s+)?project\s*(?:folder|files|directory)?$/i, ".").trim() || ".";
      return {
        mode: "system",
        tool: "list_dir",
        requiresConfirmation: false,
        summary: `List directory: ${this.resolvePath(target)}`,
        cwd: this.projectRoot,
        args: { path: target },
      };
    }

    // 8. File reading
    const readMatch = raw.match(/^(?:read\s+file|open\s+file|show\s+file|cat|view\s+file)\s+(.+)$/i);
    if (readMatch) {
      const filePath = readMatch[1].trim().replace(/^["']|["']$/g, "");
      return {
        mode: "system",
        tool: "read_file",
        requiresConfirmation: false,
        summary: `Read file: ${this.resolvePath(filePath)}`,
        cwd: this.projectRoot,
        args: { path: filePath },
      };
    }

    // 9. Explicit shell / CLI commands
    const explicitCmdMatch = raw.match(
      /^(?:run\s+(?:command|cmd|shell|powershell)?|exec|execute|powershell|terminal)\s+(.+)$/i,
    );
    if (explicitCmdMatch) {
      const cmdText = explicitCmdMatch[1].trim();
      return {
        mode: "system",
        tool: "run_command",
        requiresConfirmation: true,
        summary: `Execute command in ${this.projectRoot}`,
        cwd: this.projectRoot,
        commandText: cmdText,
        args: { command: cmdText },
      };
    }

    if (/^(git|python|python3|node|npm|npx|pip|pip3|cli-anything-[a-z0-9_-]+)\b/i.test(raw)) {
      return {
        mode: "system",
        tool: "run_command",
        requiresConfirmation: true,
        summary: `Execute CLI command in ${this.projectRoot}`,
        cwd: this.projectRoot,
        commandText: raw,
        args: { command: raw },
      };
    }

    // 10. Fallback: ask user to confirm running or treat as custom command
    return {
      mode: "system",
      tool: "run_command",
      requiresConfirmation: true,
      summary: `Review and run command in ${this.projectRoot}`,
      cwd: this.projectRoot,
      commandText: raw,
      args: { command: raw },
    };
  }

  //========================================================
  // EXECUTION & CONFIRMATION STORE
  //========================================================

  async executePlan(plan) {
    if (!plan || typeof plan !== "object") {
      throw new Error("Invalid system plan.");
    }

    switch (plan.tool) {
      case "system_info":
        return await this.getSystemInfo();

      case "list_dir":
        return await this.listDir(plan.args?.path || ".");

      case "read_file":
        return await this.readFile(plan.args?.path);

      case "write_file":
        return await this.writeFile(plan.args?.path, plan.args?.content);

      case "code_heal":
        return await this.executeCodeHeal(
          plan.args?.comment || plan.commandText,
          plan.args?.targetFiles || [],
        );

      case "cli_hub":
      case "install_cli_hub":
      case "install_github":
      case "install_package":
      case "run_command": {
        const cmd = plan.commandText || plan.args?.command || "";
        const res = await this.runCommandWithSelfHealing(cmd, { cwd: plan.cwd || this.projectRoot });
        return {
          ...res,
          action: plan.tool,
        };
      }

      default:
        throw new Error(`Unsupported system tool: ${plan.tool}`);
    }
  }

  pruneExpiredPending() {
    const now = Date.now();
    for (const [id, entry] of this.pendingActions.entries()) {
      if (now - entry.createdAt > PENDING_TTL_MS) {
        this.pendingActions.delete(id);
      }
    }
  }

  createPendingAction(plan, originalCommand = "") {
    this.pruneExpiredPending();
    const actionId = crypto.randomUUID();
    const entry = {
      actionId,
      createdAt: Date.now(),
      originalCommand,
      plan,
    };
    this.pendingActions.set(actionId, entry);

    return {
      actionId,
      tool: plan.tool,
      summary: plan.summary,
      cwd: plan.cwd || this.projectRoot,
      commandText: plan.commandText || "",
      options: Array.isArray(plan.options) ? plan.options : undefined,
      alreadyInstalled: plan.alreadyInstalled || null,
      args: plan.args || {},
      expiresInMs: PENDING_TTL_MS,
    };
  }

  async approveAction(actionId, editedCommand = null) {
    this.pruneExpiredPending();
    const id = String(actionId || "").trim();
    const entry = this.pendingActions.get(id);
    if (!entry) {
      throw new Error("Pending system action not found or expired.");
    }

    this.pendingActions.delete(id);

    const planToRun = { ...entry.plan };
    if (typeof editedCommand === "string" && editedCommand.trim()) {
      planToRun.commandText = editedCommand.trim();
    }

    const result = await this.executePlan(planToRun);
    return {
      success: result.success !== false,
      actionId: id,
      plan: planToRun,
      result,
    };
  }

  rejectAction(actionId) {
    const id = String(actionId || "").trim();
    const existed = this.pendingActions.delete(id);
    return {
      success: true,
      actionId: id,
      cancelled: existed,
    };
  }
}
