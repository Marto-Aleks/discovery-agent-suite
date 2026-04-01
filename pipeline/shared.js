export function buildGovernanceFeedback(result) {
  const issues = result.issues?.length
    ? result.issues.map((issue) => `- ${issue}`).join("\n")
    : "- No specific issues provided.";
  const assumptions = result.assumptions?.length
    ? result.assumptions.map((item) => `- ${item}`).join("\n")
    : "- None explicitly listed.";
  const contradictions = result.contradictions?.length
    ? result.contradictions.map((item) => `- ${item}`).join("\n")
    : "- None explicitly listed.";

  return [
    "Governance feedback for revision:",
    `Verdict: ${result.verdict || "No verdict provided."}`,
    `Score: ${result.score ?? 0}/100`,
    `Evidence grounding: ${result.evidenceGrounding || "unknown"}`,
    `Cross-stage alignment: ${result.alignment || "unknown"}`,
    "Issues to address:",
    issues,
    "Assumptions to handle explicitly:",
    assumptions,
    "Potential contradictions to resolve:",
    contradictions,
    "Revise the previous output to address these issues, keep the required structure, use any provided project, product, user, marketing, support, delivery, or operational data, and clearly note missing evidence where needed.",
  ].join("\n");
}

export function createSession() {
  return {
    history: [],
    topic: "",
    evidence: [],
    finalGovernance: null,
    get summary() {
      return this.history
        .map((entry) => `[${entry.agent}]\n${entry.condensed || entry.output.slice(0, 600)}`)
        .join("\n\n---\n\n");
    },
  };
}

export async function condenseOutput(client, agentLabel, output) {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: Number.parseInt(process.env.CONDENSE_MAX_TOKENS || "", 10) || 256,
    system:
      "You are a precise summariser. Extract only the key decisions, outputs, and facts from the agent output below. Use bullet points. Be ruthlessly concise, grounded, and under 200 words.",
    messages: [{ role: "user", content: `Agent: ${agentLabel}\n\n${output}` }],
  });

  return response.content[0].text;
}

export function formatAnthropicError(error) {
  const details = [];

  if (error?.message) details.push(error.message);
  if (error?.status) details.push(`status=${error.status}`);
  if (error?.error?.type) details.push(`type=${error.error.type}`);
  if (error?.error?.message && error.error.message !== error.message) {
    details.push(`api=${error.error.message}`);
  }
  if (error?.cause?.code) details.push(`cause=${error.cause.code}`);
  if (error?.cause?.message) details.push(`cause_message=${error.cause.message}`);

  return details.length ? details.join(" | ") : "Unknown error";
}

export function shouldDisableCondense() {
  return process.env.DISABLE_CONDENSE === "1";
}
