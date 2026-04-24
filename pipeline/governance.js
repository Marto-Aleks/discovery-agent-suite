function normalizeList(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((item) => String(item)) : [];
}

export function normalizeGovernanceResult(parsed, usage = null) {
  const numericScore = Number(parsed?.score);
  return {
    passed: Boolean(parsed?.passed),
    score: Number.isFinite(numericScore) ? numericScore : 0,
    issues: normalizeList(parsed?.issues),
    verdict: parsed?.verdict ? String(parsed.verdict) : "No verdict provided.",
    evidenceGrounding: parsed?.evidenceGrounding ? String(parsed.evidenceGrounding) : "unknown",
    alignment: parsed?.alignment ? String(parsed.alignment) : "unknown",
    assumptions: normalizeList(parsed?.assumptions),
    contradictions: normalizeList(parsed?.contradictions),
    usage,
  };
}

export function buildGovernanceContext({ label, output, sessionSummary = "", evidence = [], previousHistory = [] }) {
  const evidenceBlock = evidence.length
    ? evidence.map((item, index) => [
        `Evidence ${index + 1}`,
        `Title: ${item.title}`,
        `Type: ${item.type}`,
        `Scope: ${(item.stageIds || ["all"]).join(", ")}`,
        "Content:",
        item.content,
      ].join("\n")).join("\n\n---\n\n")
    : "No evidence was provided for this stage.";

  const previousStages = previousHistory.length
    ? previousHistory.map((entry, index) => [
        `Stage ${index + 1}: ${entry.agent}`,
        `Passed: ${entry.passed ? "yes" : "no"}`,
        `Score: ${entry.score}/100`,
        entry.condensed || entry.output.slice(0, 600),
      ].join("\n")).join("\n\n---\n\n")
    : "No previous stage output exists.";

  return [
    `Evaluate this ${label} output:`,
    "",
    output,
    "",
    "Relevant evidence for this stage:",
    evidenceBlock,
    "",
    "Previous stage summaries:",
    previousStages,
    "",
    "Full session summary so far:",
    sessionSummary || "No prior summary available.",
  ].join("\n");
}

const FINAL_GOVERNANCE_SYSTEM = `You are the final governance reviewer for an AI-driven product discovery pipeline.

Your role: evaluate the integrity of the whole session, not just one stage.

Review the session for:
1. Evidence grounding - are claims supported when evidence exists?
2. Cross-stage alignment - does each stage stay faithful to the previous one?
3. Contradictions - do later stages conflict with earlier assumptions or scope?
4. Decision usefulness - could a product team act on this output responsibly?
5. Residual uncertainty - what still blocks confident delivery or prioritisation?

Pass threshold: score >= 70 and no critical contradictions.`;

const FINAL_GOVERNANCE_TOOL = {
  name: "submit_final_governance",
  description: "Submit the final cross-stage governance evaluation for the full pipeline session.",
  input_schema: {
    type: "object",
    properties: {
      passed: { type: "boolean" },
      score: { type: "number" },
      issues: { type: "array", items: { type: "string" } },
      verdict: { type: "string" },
      evidenceGrounding: { type: "string" },
      alignment: { type: "string" },
      assumptions: { type: "array", items: { type: "string" } },
      contradictions: { type: "array", items: { type: "string" } },
    },
    required: ["passed", "score", "issues", "verdict", "evidenceGrounding", "alignment", "assumptions", "contradictions"],
  },
};

export async function runFinalPipelineGovernance(client, session) {
  if (!session?.history?.length) return null;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: Number.parseInt(process.env.FINAL_GOVERNANCE_MAX_TOKENS || "", 10) || 1200,
    system: [{ type: "text", text: FINAL_GOVERNANCE_SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [FINAL_GOVERNANCE_TOOL],
    tool_choice: { type: "tool", name: "submit_final_governance" },
    messages: [
      {
        role: "user",
        content: [
          `Session topic: ${session.topic || "Untitled"}`,
          "",
          "Evidence library:",
          session.evidence?.length
            ? session.evidence.map((item, index) => `${index + 1}. ${item.title} (${item.type})`).join("\n")
            : "No evidence ingested.",
          "",
          "Stage outputs:",
          session.history.map((entry) => [
            `[${entry.agent}]`,
            `Passed: ${entry.passed ? "yes" : "override"}`,
            `Score: ${entry.score}/100`,
            entry.condensed || entry.output.slice(0, 1000),
          ].join("\n")).join("\n\n---\n\n"),
        ].join("\n"),
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  return normalizeGovernanceResult(toolUse?.input ?? {}, response.usage);
}
