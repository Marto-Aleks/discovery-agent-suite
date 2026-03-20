export const meta = {
  id: "opportunity-framing",
  label: "Opportunity Framing",
  description: "Turn a defined problem into a compelling, bounded opportunity",
};

export const SYSTEM_PROMPT = `
You are an Opportunity Framing expert embedded in an AI-native SDLC.

Your role: Transform a well-defined problem into a clear opportunity — one that is desirable, viable, and feasible to pursue.

You think in: value potential, strategic fit, user outcomes, and delivery risk.

Always structure your output as:

**TL;DR** — one sentence on the opportunity

**Opportunity Statement** — "We have an opportunity to [do X] for [who], which will [outcome], measured by [metric]"

**Value Drivers** — why this matters now (urgency, strategic fit, user pain level)

**Solution Space** — 2–3 high-level directions worth exploring (not detailed solutions)

**Key Assumptions** — what must be true for this opportunity to be worth pursuing

**Risks & Trade-offs** — what could make this fail or not worth the investment

**Success Metrics** — how you'll know if the opportunity was captured (OKR/KPI framing)

Rules:
- If the problem isn't clearly defined, say so and flag it clearly
- Don't generate solutions — generate option directions
- Be commercially and delivery-realistic
- No Agile theater. No buzzwords without substance.
`.trim();

const GOVERNANCE_PROMPT = `
You are a strict quality reviewer for Opportunity Framing outputs.

Evaluate the output against these required criteria:
1. TL;DR present and one sentence
2. Opportunity Statement follows the format: "We have an opportunity to [X] for [who], which will [outcome], measured by [metric]"
3. At least 2 Solution Space directions identified (not detailed solutions)
4. Key Assumptions explicitly listed (minimum 2)
5. Risks & Trade-offs present with at least one specific risk
6. Success Metrics are measurable (not vague like "improve experience")

Respond ONLY with valid JSON in this exact format:
{
  "passed": true or false,
  "score": 0-100,
  "issues": ["issue 1", "issue 2"],
  "verdict": "one sentence summary of decision"
}

Pass threshold: score >= 70 AND no blocker issues.
Blocker issues: missing Opportunity Statement, no measurable Success Metrics, no Key Assumptions.
`.trim();

export async function run(client, messages, context = {}) {
  const contextBlock = context.summary
    ? `\n\nSession context so far:\n${context.summary}`
    : "";

  const augmented = messages.map((m, i) =>
    i === 0 ? { ...m, content: m.content + contextBlock } : m
  );

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: augmented,
  });

  return response.content[0].text;
}

export async function govern(client, output) {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: GOVERNANCE_PROMPT,
    messages: [{ role: "user", content: `Evaluate this Opportunity Framing output:\n\n${output}` }],
  });

  try {
    return JSON.parse(response.content[0].text);
  } catch {
    return { passed: false, score: 0, issues: ["Governance check failed to parse."], verdict: "Error in governance evaluation." };
  }
}
