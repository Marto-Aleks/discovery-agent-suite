import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";

import { meta as m1, run as r1, govern as g1 } from "./agents/problem-framing.js";
import { meta as m2, run as r2, govern as g2 } from "./agents/opportunity-framing.js";
import { meta as m3, run as r3, govern as g3 } from "./agents/story-creation.js";
import { meta as m4, run as r4, govern as g4 } from "./agents/prioritisation.js";
import { meta as m5, run as r5, govern as g5 } from "./agents/estimation.js";

const PIPELINE = [
  { ...m1, run: r1, govern: g1 },
  { ...m2, run: r2, govern: g2 },
  { ...m3, run: r3, govern: g3 },
  { ...m4, run: r4, govern: g4 },
  { ...m5, run: r5, govern: g5 },
];

const MAX_ATTEMPTS = 3;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

app.post("/start", (req, res) => {
  if (pipelineRunning) return res.status(409).json({ error: "Pipeline already running" });
  pipelineRunning = true;
  res.json({ ok: true });
  runPipeline();
});

// ── Pipeline logic ─────────────────────────────────────────────────────────────
async function runPipeline() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    emit("log", { level: "error", text: "ANTHROPIC_API_KEY is not set. Stop the server and set it." });
    pipelineRunning = false;
    return;
  }

  const client = new Anthropic({ apiKey });

  const session = {
    history: [],
    topic: "",
    get summary() {
      return this.history
        .map((h) => `[${h.agent}]\n${h.output.slice(0, 600)}`)
        .join("\n\n---\n\n");
    },
  };

  // Emit initial pipeline state
  emit("pipeline-init", {
    stages: PIPELINE.map((a) => ({ id: a.id, label: a.label, description: a.description })),
  });

  emit("log", { level: "info", text: "Pipeline started. Waiting for session topic..." });

  const topic = await waitForInput("Session topic (e.g. 'payment-flow-redesign'):", "topic");
  session.topic = topic || "session";
  emit("log", { level: "info", text: `Topic set: ${session.topic}` });

  for (let i = 0; i < PIPELINE.length; i++) {
    const agent = PIPELINE[i];

    emit("agent-start", { index: i, id: agent.id });
    emit("log", { level: "info", text: `▶ Starting: ${agent.label}` });
    emit("log", { level: "muted", text: agent.description });

    const conversationHistory = [];
    let attempt = 0;
    let lastOutput = null;
    let advanced = false;

    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      const promptText =
        attempt === 1
          ? `Your input for ${agent.label}:`
          : `Attempt ${attempt}/${MAX_ATTEMPTS} — Add more context to address the issues:`;

      if (attempt === 1 && session.history.length > 0) {
        emit("log", { level: "muted", text: "Context from previous agents will be included automatically." });
      }

      const userInput = await waitForInput(promptText, "agent");

      if (!userInput.trim()) {
        emit("log", { level: "warn", text: "Input cannot be empty. Please try again." });
        attempt--;
        continue;
      }

      conversationHistory.push({ role: "user", content: userInput });
      emit("log", { level: "info", text: "Thinking..." });
      emit("agent-thinking", { index: i });

      let output;
      try {
        output = await agent.run(client, conversationHistory, { summary: session.summary });
      } catch (err) {
        emit("log", { level: "error", text: `Agent error: ${err.message}` });
        conversationHistory.pop();
        attempt--;
        continue;
      }

      lastOutput = output;
      conversationHistory.push({ role: "assistant", content: output });

      emit("agent-output", { index: i, output });
      emit("log", { level: "info", text: "Running governance check..." });

      let govResult;
      try {
        govResult = await agent.govern(client, output);
      } catch (err) {
        emit("log", { level: "error", text: `Governance error: ${err.message}` });
        govResult = { passed: false, score: 0, issues: ["Governance check errored."], verdict: "Could not evaluate." };
      }

      emit("governance", { index: i, ...govResult });
      emit("log", {
        level: govResult.passed ? "success" : "warn",
        text: govResult.passed
          ? `✓ Governance PASSED — Score: ${govResult.score}/100`
          : `✗ Governance FAILED — Score: ${govResult.score}/100`,
      });

      if (govResult.verdict) emit("log", { level: "muted", text: `Verdict: ${govResult.verdict}` });
      if (govResult.issues?.length) {
        govResult.issues.forEach((issue) => emit("log", { level: "warn", text: `• ${issue}` }));
      }

      if (govResult.passed) {
        session.history.push({ agent: agent.label, output, score: govResult.score, passed: true });
        emit("agent-complete", { index: i, score: govResult.score, passed: true });
        emit("log", { level: "success", text: `${agent.label} complete. Moving to next stage.` });
        advanced = true;
        break;
      }

      if (attempt < MAX_ATTEMPTS) {
        emit("log", { level: "warn", text: `${MAX_ATTEMPTS - attempt} attempt(s) remaining.` });
      }
    }

    if (!advanced) {
      emit("override-request", { index: i, label: agent.label });
      const choice = await waitForInput(
        `Max attempts reached for ${agent.label}. Type "override" to continue anyway or "quit" to stop:`,
        "override"
      );

      if (choice.trim().toLowerCase() === "override") {
        session.history.push({ agent: agent.label, output: lastOutput ?? "(no output)", score: 0, passed: false });
        emit("agent-complete", { index: i, score: 0, passed: false, override: true });
        emit("log", { level: "warn", text: `Override accepted for ${agent.label}. Continuing.` });
      } else {
        emit("log", { level: "error", text: "Session ended by user." });
        emit("pipeline-complete", { aborted: true });
        pipelineRunning = false;
        return;
      }
    }
  }

  // Summary
  emit("log", { level: "success", text: "━━━ Pipeline complete ━━━" });
  session.history.forEach((h) => {
    emit("log", {
      level: h.passed ? "success" : "warn",
      text: `${h.passed ? "✓" : "⚠"} ${h.agent} — ${h.score}/100`,
    });
  });

  emit("pipeline-complete", { aborted: false, summary: session.history });
  pipelineRunning = false;
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Dashboard running at http://localhost:${PORT}\n`);
});
