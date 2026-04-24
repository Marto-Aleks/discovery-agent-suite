import { getRuntimeConfig } from "./config.js";
import { buildGovernanceFeedback, condenseOutput, createSession, formatAnthropicError, shouldDisableCondense } from "./shared.js";
import { formatEvidenceForPrompt } from "../evidence/routing.js";
import { runFinalPipelineGovernance } from "./governance.js";

export async function runPipeline(client, pipeline, hooks = {}) {
  const runtime = getRuntimeConfig();
  const activePipeline = runtime.stageFilter.length
    ? pipeline.filter((agent) => runtime.stageFilter.includes(agent.id))
    : pipeline;
  const session = createSession();

  hooks.onPipelineInit?.({
    stages: pipeline.map((agent) => ({
      id: agent.id,
      label: agent.label,
      description: agent.description,
    })),
  });

  hooks.onLog?.({ level: "info", text: "Pipeline started. Waiting for session topic..." });

  const topic = await hooks.getTopic();
  session.topic = topic || "session";
  hooks.onLog?.({ level: "info", text: `Topic set: ${session.topic}` });
  session.evidence = hooks.getAllEvidence ? hooks.getAllEvidence() : [];

  if (activePipeline.length === 0) {
    hooks.onLog?.({ level: "error", text: "No pipeline stages matched PIPELINE_STAGES." });
    return { aborted: true, session };
  }

  for (let index = 0; index < activePipeline.length; index++) {
    const agent = activePipeline[index];
    const stageEvidence = hooks.getEvidenceForAgent ? hooks.getEvidenceForAgent(agent, session) : [];
    const evidencePrompt = formatEvidenceForPrompt(stageEvidence);
    hooks.onAgentStart?.({ index, id: agent.id, agent });
    hooks.onAgentEvidence?.({ index, agent, evidence: stageEvidence });

    const conversationHistory = [];
    let attempt = 0;
    let lastOutput = null;
    let lastGovernance = null;
    let advanced = false;

    while (attempt < runtime.maxAttempts) {
      attempt++;

      const prompt =
        attempt === 1
          ? `Your input for ${agent.label}:`
          : `Attempt ${attempt}/${runtime.maxAttempts} — Add optional context, or submit blank to retry using governance feedback only:`;

      if (attempt === 1 && session.history.length > 0) {
        hooks.onLog?.({ level: "muted", text: "Context from previous agents will be included automatically." });
      }

      const userInput = await hooks.getAgentInput({ agent, attempt, prompt, session });
      const trimmedInput = userInput.trim();

      // Only the first agent requires non-empty input on the first attempt.
      // Subsequent agents auto-run using condensed session context.
      if (!trimmedInput && attempt === 1 && index === 0) {
        hooks.onLog?.({ level: "warn", text: "Problem statement cannot be empty." });
        attempt--;
        continue;
      }

      if (trimmedInput) {
        // On retries the last message is governance feedback (role: user).
        // Merge extra input into it to avoid consecutive user messages.
        const last = conversationHistory[conversationHistory.length - 1];
        if (last?.role === "user") {
          last.content = `${last.content}\n\nAdditional context from user: ${trimmedInput}`;
        } else {
          conversationHistory.push({ role: "user", content: trimmedInput });
        }
      } else if (conversationHistory.length === 0) {
        // No input and no history — inject a proceed instruction so the API gets at least one message.
        conversationHistory.push({ role: "user", content: "Proceed with your analysis based on the session context provided." });
        hooks.onLog?.({ level: "muted", text: `Auto-running ${agent.label} from session context.` });
      } else {
        hooks.onLog?.({ level: "muted", text: "No extra input provided. Reusing prior context plus governance feedback." });
      }

      hooks.onLog?.({ level: "info", text: "Thinking..." });
      hooks.onAgentThinking?.({ index, agent });

      let output;
      let runUsage = null;
      try {
        const runResult = await agent.run(
          client,
          conversationHistory,
          { summary: session.summary, evidence: evidencePrompt },
          (chunk) => hooks.onAgentChunk?.({ index, agent, chunk })
        );
        output = runResult.text;
        runUsage = runResult.usage;
      } catch (error) {
        hooks.onLog?.({ level: "error", text: `Agent error: ${formatAnthropicError(error)}` });
        if (trimmedInput) conversationHistory.pop();
        attempt--;
        continue;
      }

      lastOutput = output;
      conversationHistory.push({ role: "assistant", content: output });

      hooks.onAgentOutput?.({ index, agent, output, runUsage });
      hooks.onLog?.({ level: "info", text: "Running governance check..." });

      let governance;
      try {
        governance = await agent.govern(client, output, {
          sessionSummary: session.summary,
          evidence: stageEvidence,
          previousHistory: session.history,
        });
      } catch (error) {
        hooks.onLog?.({ level: "error", text: `Governance error: ${formatAnthropicError(error)}` });
        governance = {
          passed: false,
          score: 0,
          issues: ["Governance check errored."],
          verdict: "Could not evaluate.",
          evidenceGrounding: "unknown",
          alignment: "unknown",
          assumptions: [],
          contradictions: [],
          usage: null,
        };
      }
      lastGovernance = governance;

      hooks.onGovernance?.({ index, agent, result: governance });

      if (governance.passed) {
        let condensed = output.slice(0, 600);
        if (shouldDisableCondense() || runtime.disableCondense) {
          hooks.onLog?.({ level: "muted", text: "Skipping condensation in test mode." });
        } else {
          hooks.onLog?.({ level: "muted", text: "Condensing output for downstream context..." });
          try {
            condensed = await condenseOutput(client, agent.label, output);
          } catch (err) {
            hooks.onLog?.({ level: "warn", text: `Condensation failed, using truncated output: ${err.message}` });
          }
        }
        session.history.push({
          agent: agent.label,
          output,
          condensed,
          score: governance.score,
          passed: true,
          governance,
          runUsage,
        });
        hooks.onAgentCondensed?.({ index, agent, condensed });
        hooks.onAgentComplete?.({ index, agent, score: governance.score, passed: true, govUsage: governance.usage });
        hooks.onLog?.({ level: "success", text: `${agent.label} complete. Moving to next stage.` });
        advanced = true;
        break;
      }

      if (attempt < runtime.maxAttempts) {
        conversationHistory.push({ role: "user", content: buildGovernanceFeedback(governance) });
        hooks.onLog?.({ level: "warn", text: `${runtime.maxAttempts - attempt} attempt(s) remaining.` });
      }
    }

    if (!advanced) {
      hooks.onOverrideRequest?.({ index, agent });
      const choice = runtime.autoOverride ? "override" : await hooks.getOverrideChoice({ agent, session });

      if (choice.trim().toLowerCase() === "override") {
        const rawOutput = lastOutput ?? "(no output)";
        let condensed = rawOutput.slice(0, 600);
        if (lastOutput && !shouldDisableCondense() && !runtime.disableCondense) {
          try {
            condensed = await condenseOutput(client, agent.label, lastOutput);
          } catch (err) {
            hooks.onLog?.({ level: "warn", text: `Condensation failed, using truncated output: ${err.message}` });
          }
        }
        session.history.push({
          agent: agent.label,
          output: rawOutput,
          condensed,
          score: 0,
          passed: false,
          governance: lastGovernance,
          runUsage,
        });
        hooks.onAgentCondensed?.({ index, agent, condensed });
        hooks.onAgentComplete?.({ index, agent, score: 0, passed: false, override: true, govUsage: null });
        hooks.onLog?.({ level: "warn", text: `Override accepted for ${agent.label}. Continuing.` });
      } else {
        hooks.onLog?.({ level: "error", text: "Session ended by user." });
        return { aborted: true, session };
      }
    }
  }

  hooks.onLog?.({ level: "success", text: "━━━ Pipeline complete ━━━" });
  session.history.forEach((entry) => {
    hooks.onLog?.({
      level: entry.passed ? "success" : "warn",
      text: `${entry.passed ? "✓" : "⚠"} ${entry.agent} — ${entry.score}/100`,
    });
  });

  try {
    hooks.onLog?.({ level: "info", text: "Running final pipeline governance review..." });
    session.finalGovernance = await runFinalPipelineGovernance(client, session);
    hooks.onPipelineGovernance?.({ result: session.finalGovernance });
    hooks.onLog?.({
      level: session.finalGovernance.passed ? "success" : "warn",
      text: session.finalGovernance.passed
        ? `✓ Final governance PASSED — Score: ${session.finalGovernance.score}/100`
        : `✗ Final governance flagged issues — Score: ${session.finalGovernance.score}/100`,
    });
  } catch (error) {
    hooks.onLog?.({ level: "error", text: `Final governance error: ${formatAnthropicError(error)}` });
    session.finalGovernance = null;
  }

  return { aborted: false, session };
}
