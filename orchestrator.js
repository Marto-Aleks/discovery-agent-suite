import readline from "readline";
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

import { meta as m1, run as r1, govern as g1 } from "./agents/problem-framing.js";
import { meta as m2, run as r2, govern as g2 } from "./agents/opportunity-framing.js";
import { meta as m3, run as r3, govern as g3 } from "./agents/story-creation.js";
import { meta as m4, run as r4, govern as g4 } from "./agents/prioritisation.js";
import { meta as m5, run as r5, govern as g5 } from "./agents/estimation.js";

// ── Linear pipeline ───────────────────────────────────────────────────────────
const PIPELINE = [
  { ...m1, run: r1, govern: g1 },
  { ...m2, run: r2, govern: g2 },
  { ...m3, run: r3, govern: g3 },
  { ...m4, run: r4, govern: g4 },
  { ...m5, run: r5, govern: g5 },
];

const MAX_ATTEMPTS = 3; // max retries per agent before offering override
const SESSIONS_DIR = new URL("./sessions/", import.meta.url).pathname;

// ── Session context ───────────────────────────────────────────────────────────
const session = {
  history: [], // [{ agent, output, score, passed }]
  topic: "",
  get summary() {
    return this.history
      .map((h) => `[${h.agent}]\n${h.output.slice(0, 600)}`)
      .join("\n\n---\n\n");
  },
};

function saveSession() {
  if (session.history.length === 0) return;
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const slug = session.topic
    ? session.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)
    : "session";
  const filename = `${date}_${slug}.md`;
  const filepath = path.join(SESSIONS_DIR, filename);

  const lines = [
    `# Session Output — ${session.topic || "Untitled"}`,
    `**Date:** ${date}`,
    `**Pipeline:** ${session.history.map((h) => h.agent).join(" → ")}`,
    "",
  ];

  for (const h of session.history) {
    lines.push(`---\n## ${h.agent}`);
    lines.push(`**Governance: ${h.passed ? "PASSED" : "OVERRIDE"} — Score ${h.score}/100**\n`);
    lines.push(h.output);
    lines.push("");
  }

  lines.push("---");
  lines.push("## Pipeline Summary");
  lines.push("| Stage | Score | Status |");
  lines.push("|-------|-------|--------|");
  for (const h of session.history) {
    lines.push(`| ${h.agent} | ${h.score}/100 | ${h.passed ? "✓ Passed" : "⚠ Override"} |`);
  }

  fs.writeFileSync(filepath, lines.join("\n"));
  return filepath;
}

// ── CLI helpers ───────────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

const div = () => console.log("\n" + "─".repeat(60) + "\n");
const log = (msg) => console.log(`  ${msg}`);

function printProgress(currentIndex) {
  div();
  const steps = PIPELINE.map((a, i) => {
    if (i < currentIndex) return `✓ ${a.label}`;
    if (i === currentIndex) return `▶ ${a.label}`;
    return `  ${a.label}`;
  });
  console.log("  PIPELINE: " + steps.join("  →  "));
  div();
}

function printGovernanceResult(result) {
  const icon = result.passed ? "✓ PASSED" : "✗ FAILED";
  log(`Governance: ${icon}  (score: ${result.score}/100)`);
  log(`Verdict: ${result.verdict}`);
  if (result.issues?.length) {
    log("Issues to fix:");
    result.issues.forEach((issue) => log(`  • ${issue}`));
  }
}

// ── Core agent step with governance loop ─────────────────────────────────────
async function runAgentStep(client, agent, stepIndex) {
  printProgress(stepIndex);
  log(`Agent: ${agent.label}`);
  log(agent.description);
  console.log();

  const conversationHistory = []; // multi-turn within this agent step
  let attempt = 0;
  let lastOutput = null;

  while (attempt < MAX_ATTEMPTS) {
    attempt++;

    if (attempt === 1) {
      log(`Attempt ${attempt}/${MAX_ATTEMPTS} — Provide your input below.`);
      if (session.history.length > 0) {
        log("[Context from previous agents will be included automatically]");
      }
    } else {
      log(`Attempt ${attempt}/${MAX_ATTEMPTS} — Add more context or clarify to address the issues above.`);
    }

    console.log();
    const userInput = (await ask("  > ")).trim();

    if (!userInput) {
      log("Input cannot be empty. Try again.");
      attempt--; // don't count empty input as an attempt
      continue;
    }

    // Build conversation: all previous turns + new user message
    conversationHistory.push({ role: "user", content: userInput });

    log("Thinking...");
    console.log();

    try {
      lastOutput = await agent.run(client, conversationHistory, { summary: session.summary });
    } catch (err) {
      log(`Agent error: ${err.message}`);
      log("Try again with a different input.");
      conversationHistory.pop(); // remove failed message
      attempt--;
      continue;
    }

    div();
    console.log(lastOutput);

    // Add assistant response to history for potential next turn
    conversationHistory.push({ role: "assistant", content: lastOutput });

    log("Running governance check...");
    console.log();

    let govResult;
    try {
      govResult = await agent.govern(client, lastOutput);
    } catch (err) {
      log(`Governance error: ${err.message}. Treating as failed.`);
      govResult = { passed: false, score: 0, issues: ["Governance check errored."], verdict: "Could not evaluate." };
    }

    printGovernanceResult(govResult);

    if (govResult.passed) {
      log("Quality gate passed. Moving to next stage.");
      session.history.push({ agent: agent.label, output: lastOutput, score: govResult.score, passed: true });
      await ask("\n  Press Enter to continue...");
      return true; // advance
    }

    if (attempt < MAX_ATTEMPTS) {
      console.log();
      log(`Quality gate not passed. ${MAX_ATTEMPTS - attempt} attempt(s) remaining.`);
      await ask("\n  Press Enter to try again...");
    }
  }

  // Max attempts reached — offer override
  div();
  log(`Maximum attempts (${MAX_ATTEMPTS}) reached for: ${agent.label}`);
  log("The output did not pass the quality gate.");
  console.log();
  log("Options:");
  log("  [o] Override — accept the output and continue anyway");
  log("  [q] Quit — stop the session");
  console.log();

  const choice = (await ask("  Your choice: ")).trim().toLowerCase();

  if (choice === "o") {
    log("Override accepted. Continuing with last output.");
    session.history.push({ agent: agent.label, output: lastOutput ?? "(no output)", score: 0, passed: false });
    await ask("\n  Press Enter to continue...");
    return true;
  }

  log("Session ended by user.");
  return false;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("\n  Error: ANTHROPIC_API_KEY environment variable is not set.\n");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  div();
  log("DISCOVERY AGENT SUITE");
  log("Linear pipeline with governance gates.");
  log("Each stage must pass quality review before progressing.");
  log(`Max ${MAX_ATTEMPTS} attempts per stage. Override available if gate cannot be passed.`);
  div();

  const topicInput = (await ask("  Session topic (used for filename, e.g. 'payment-flow-redesign'): ")).trim();
  session.topic = topicInput || "session";
  await ask("  Press Enter to begin...");

  for (let i = 0; i < PIPELINE.length; i++) {
    const advanced = await runAgentStep(client, PIPELINE[i], i);
    if (!advanced) {
      rl.close();
      process.exit(0);
    }
  }

  div();
  log("Pipeline complete. All stages passed governance.");
  div();
  log("Summary of session:");
  session.history.forEach((h) => log(`${h.passed ? "✓" : "⚠"} ${h.agent} — ${h.score}/100`));

  const savedPath = saveSession();
  if (savedPath) {
    div();
    log(`Session saved to: ${savedPath}`);
  }
  div();

  rl.close();
}

main();
