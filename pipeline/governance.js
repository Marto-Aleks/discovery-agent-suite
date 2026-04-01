function extractJson(text) {
  const full = String(text || "").trim();
  const match = full.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : full);
}

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

export function parseGovernanceResponse(text, usage = null) {
  return normalizeGovernanceResult(extractJson(text), usage);
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

export async function runFinalPipelineGovernance(client, session) {
  if (!session?.history?.length) return null;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: Number.parseInt(process.env.FINAL_GOVERNANCE_MAX_TOKENS || "", 10) || 1200,
    system: `
You are the final governance reviewer for an AI-driven product discovery pipeline.

Your role: evaluate the integrity of the whole session, not just one stage.

Review the session for:
1. Evidence grounding - are claims supported when evidence exists?
2. Cross-stage alignment - does each stage stay faithful to the previous one?
3. Contradictions - do later stages conflict with earlier assumptions or scope?
4. Decision usefulness - could a product team act on this output responsibly?
5. Residual uncertainty - what still blocks confident delivery or prioritisation?

Respond ONLY with valid JSON in this format:
{
  "passed": true or false,
  "score": 0-100,
  "issues": ["issue 1", "issue 2"],
  "verdict": "one sentence summary",
  "evidenceGrounding": "strong|partial|weak",
  "alignment": "strong|partial|weak",
  "assumptions": ["assumption 1"],
  "contradictions": ["contradiction 1"]
}

Pass threshold: score >= 70 and no critical contradictions.
`,
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
      { role: "assistant", content: "{" },
    ],
  });

  return parseGovernanceResponse("{" + response.content[0].text, response.usage);
}
