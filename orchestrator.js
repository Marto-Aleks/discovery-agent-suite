import readline from "readline";

import { PIPELINE, MAX_ATTEMPTS } from "./pipeline/config.js";
import { runPipeline } from "./pipeline/runner.js";
import { createAnthropicClient } from "./lib/anthropic-client.js";
import { saveSession } from "./lib/session-save.js";

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

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("\n  Error: ANTHROPIC_API_KEY environment variable is not set.\n");
    process.exit(1);
  }

  const client = createAnthropicClient(apiKey);

  div();
  log("DISCOVERY AGENT SUITE");
  log("Linear pipeline with governance gates.");
  log("Each stage must pass quality review before progressing.");
  log(`Max ${MAX_ATTEMPTS} attempts per stage. Override available if gate cannot be passed.`);
  div();

  const topicInput = (await ask("  Session topic (used for filename, e.g. 'payment-flow-redesign'): ")).trim();
  await ask("  Press Enter to begin...");

  const result = await runPipeline(client, PIPELINE, {
    getTopic: async () => topicInput,
    getAgentInput: async ({ prompt, agent, attempt }) => {
      printProgress(PIPELINE.findIndex((entry) => entry.id === agent.id));
      log(`Agent: ${agent.label}`);
      log(agent.description);
      if (attempt === 1) {
        log(`Attempt ${attempt}/${MAX_ATTEMPTS} — Provide your input below.`);
      } else {
        log(`Attempt ${attempt}/${MAX_ATTEMPTS} — Add optional context, or press Enter to retry using governance feedback only.`);
      }
      console.log();
      return ask("  > ");
    },
    getOverrideChoice: async ({ agent }) => {
      div();
      log(`Maximum attempts (${MAX_ATTEMPTS}) reached for: ${agent.label}`);
      log("The output did not pass the quality gate.");
      console.log();
      log("Options:");
      log("  [o] Override — accept the output and continue anyway");
      log("  [q] Quit — stop the session");
      console.log();
      return ask("  Your choice: ");
    },
    onAgentOutput: ({ output }) => {
      div();
      console.log(output);
    },
    onGovernance: ({ result }) => {
      printGovernanceResult(result);
    },
    onLog: ({ text }) => {
      log(text);
    },
  });

  div();
  log(result.aborted ? "Pipeline stopped before completion." : "Pipeline complete.");
  div();
  log("Summary of session:");
  result.session.history.forEach((h) => log(`${h.passed ? "✓" : "⚠"} ${h.agent} — ${h.score}/100`));

  const savedPath = saveSession(result.session);
  if (savedPath) {
    div();
    log(`Session saved to: ${savedPath}`);
  }
  div();

  rl.close();
}

main();
