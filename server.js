import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, readdirSync } from "fs";

import { PIPELINE } from "./pipeline/config.js";
import { runPipeline as executePipeline } from "./pipeline/runner.js";
import { createAnthropicClient } from "./lib/anthropic-client.js";
import { saveSession } from "./lib/session-save.js";
import { createEvidenceStore } from "./evidence/store.js";
import { selectEvidenceForAgent, EVIDENCE_TYPE_LABELS } from "./evidence/routing.js";
import { triageEvidence } from "./evidence/triage.js";
import { parseUploadedEvidence } from "./evidence/parse.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
const evidenceStore = createEvidenceStore();

// ── SSE clients ───────────────────────────────────────────────────────────────
let clients = [];

function emit(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach((res) => res.write(payload));
}

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  clients.push(res);
  req.on("close", () => {
    clients = clients.filter((c) => c !== res);
  });
});

// ── Input queue ───────────────────────────────────────────────────────────────
let inputQueue = [];

function waitForInput(prompt, type = "text") {
  emit("input-request", { prompt, type });
  return new Promise((resolve) => inputQueue.push(resolve));
}

app.post("/input", (req, res) => {
  const { value } = req.body;
  const resolver = inputQueue.shift();
  if (resolver) resolver(value);
  res.json({ ok: true });
});

// ── Pipeline state ─────────────────────────────────────────────────────────────
let pipelineRunning = false;
let runLog = [];

app.post("/reset", (_req, res) => {
  pipelineRunning = false;
  inputQueue = [];
  res.json({ ok: true });
});

app.post("/start", (_req, res) => {
  if (pipelineRunning) return res.status(409).json({ error: "Pipeline already running" });
  pipelineRunning = true;
  runLog = [];
  res.json({ ok: true });
  startPipeline();
});

// ── Pipeline logic ─────────────────────────────────────────────────────────────
async function startPipeline() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    emit("log", { level: "error", text: "ANTHROPIC_API_KEY is not set. Stop the server and set it." });
    pipelineRunning = false;
    return;
  }

  const client = createAnthropicClient(apiKey);

  try {
    const result = await executePipeline(client, PIPELINE, {
      getTopic: () => waitForInput("Session topic (e.g. 'payment-flow-redesign'):", "topic"),
      getAgentInput: ({ prompt }) => waitForInput(prompt, "agent"),
      getOverrideChoice: ({ agent }) =>
        waitForInput(
          `Max attempts reached for ${agent.label}. Type "override" to continue anyway or "quit" to stop:`,
          "override"
        ),
      onPipelineInit: ({ stages }) => emit("pipeline-init", { stages }),
      onAgentStart: ({ index, agent }) => {
        emit("agent-start", { index, id: agent.id });
        emit("log", { level: "info", text: `▶ Starting: ${agent.label}` });
        emit("log", { level: "muted", text: agent.description });
      },
      onAgentThinking: ({ index }) => emit("agent-thinking", { index }),
      onAgentEvidence: ({ index, evidence }) => emit("agent-evidence", { index, evidence }),
      onAgentChunk: ({ index, chunk }) => emit("agent-chunk", { index, chunk }),
      onAgentOutput: ({ index, output, runUsage }) => emit("agent-output", { index, output, runUsage }),
      onAgentCondensed: ({ index, condensed }) => emit("agent-condensed", { index, condensed }),
      onGovernance: ({ index, result }) => {
        emit("governance", { index, ...result });
        emit("log", {
          level: result.passed ? "success" : "warn",
          text: result.passed
            ? `✓ Governance PASSED — Score: ${result.score}/100`
            : `✗ Governance FAILED — Score: ${result.score}/100`,
        });
        if (result.verdict) emit("log", { level: "muted", text: `Verdict: ${result.verdict}` });
        if (result.issues?.length) {
          result.issues.forEach((issue) => emit("log", { level: "warn", text: `• ${issue}` }));
        }
        if (result.contradictions?.length) {
          result.contradictions.forEach((item) => emit("log", { level: "warn", text: `↯ ${item}` }));
        }
      },
      onAgentComplete: ({ index, score, passed, override, govUsage }) =>
        emit("agent-complete", { index, score, passed, govUsage, ...(override ? { override } : {}) }),
      onOverrideRequest: ({ index, agent }) => emit("override-request", { index, label: agent.label }),
      onPipelineGovernance: ({ result }) => emit("pipeline-governance", result),
      onLog: ({ level, text }) => {
        runLog.push(`[${new Date().toISOString()}] [${level.toUpperCase().padEnd(7)}] ${text}`);
        emit("log", { level, text });
      },
      getAllEvidence: () => evidenceStore.list(),
      getEvidenceForAgent: (agent, session) => selectEvidenceForAgent(agent.id, evidenceStore.list(), session),
    });

    const savedPath = saveSession(result.session);
    if (savedPath) {
      emit("log", { level: "success", text: `Session saved to: ${savedPath}` });
      const logPath = savedPath.replace(/\.md$/, ".run.log");
      writeFileSync(logPath, runLog.join("\n") + "\n");
      emit("log", { level: "muted", text: `Run log saved to: ${logPath}` });
    }

    emit("pipeline-complete", {
      aborted: result.aborted,
      summary: result.session.history.map(({ agent, score, passed }) => ({ agent, score, passed })),
      savedPath,
      finalGovernance: result.session.finalGovernance,
    });
  } catch (err) {
    emit("log", { level: "error", text: `Pipeline error: ${err.message}` });
    emit("pipeline-complete", { aborted: true, summary: [] });
  } finally {
    pipelineRunning = false;
  }
}

// ── Context API ───────────────────────────────────────────────────────────────
const CONTEXT_DIR = path.join(__dirname, "context");

app.get("/evidence-meta", (_req, res) => {
  res.json({
    types: EVIDENCE_TYPE_LABELS,
    stages: PIPELINE.map(({ id, label }) => ({ id, label })),
  });
});

app.get("/evidence", (_req, res) => {
  res.json(evidenceStore.list());
});

app.post("/evidence/parse", async (req, res) => {
  try {
    const parsed = await parseUploadedEvidence(req.body || {});
    if (!parsed.text) {
      return res.status(400).json({ error: "Could not extract usable text from this file." });
    }
    res.json(parsed);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/evidence/triage", (req, res) => {
  const { title = "", content = "" } = req.body || {};
  if (!String(content || title).trim()) {
    return res.status(400).json({ error: "Evidence content or title is required for triage." });
  }

  res.json(triageEvidence({ title, content }));
});

app.post("/evidence", (req, res) => {
  try {
    const item = evidenceStore.add(req.body || {});
    res.status(201).json(item);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/evidence/:id", (req, res) => {
  const removed = evidenceStore.remove(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: "Evidence not found" });
  }
  res.json({ ok: true });
});

app.get("/context", (req, res) => {
  try {
    const files = readdirSync(CONTEXT_DIR).filter((f) => f.endsWith(".md"));
    const result = {};
    for (const file of files) {
      result[file] = readFileSync(path.join(CONTEXT_DIR, file), "utf8");
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/context/:file", (req, res) => {
  const { file } = req.params;
  if (!file.endsWith(".md") || file.includes("..") || file.includes("/")) {
    return res.status(400).json({ error: "Invalid file name" });
  }
  const { content } = req.body;
  if (typeof content !== "string") return res.status(400).json({ error: "content must be a string" });
  try {
    writeFileSync(path.join(CONTEXT_DIR, file), content, "utf8");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Dashboard running at http://localhost:${PORT}\n`);
});
