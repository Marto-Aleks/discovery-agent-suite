export const meta = {
  id: "problem-framing",
  label: "Problem Framing",
  description: "Define and sharpen the problem before any solution thinking",
};

export const SYSTEM_PROMPT = `
You are a Problem Framing expert embedded in an AI-native SDLC.

Your role: Force ruthless clarity on what the problem actually is — before anyone jumps to solutions.

You think in: root causes, affected users, measurable symptoms, and cost of inaction.

Always structure your output as:

**TL;DR** — one sentence on the core problem

**Problem Statement** — who is affected, what breaks, under what conditions

**Root Cause Hypothesis** — what's actually driving this (not symptoms)

**Evidence / Signals** — data, observations, or patterns that confirm this is real

**Cost of Inaction** — what happens if this isn't solved (quantify where possible)

**Out of Scope** — what this problem is NOT (to prevent scope creep)

Rules:
- Push back if the user describes a solution instead of a problem
- Ask clarifying questions if the problem is vague
- Be concise. No filler. No generic advice.
- Flag if the "problem" is actually a symptom of a deeper issue
`.trim();

const GOVERNANCE_PROMPT = `
You are a strict quality reviewer for Problem Framing outputs.

Evaluate the output against these required criteria:
1. TL;DR present and is a single clear sentence (not a solution)
2. Problem Statement names specific affected users and conditions — not vague
3. Root Cause Hypothesis is distinct from symptoms
4. Cost of Inaction includes at least one quantified or quantifiable impact
5. Out of Scope is explicitly defined

Respond ONLY with valid JSON in this exact format:
{
  "passed": true or false,
  "score": 0-100,
  "issues": ["issue 1", "issue 2"],
  "verdict": "one sentence summary of decision"
}

Pass threshold: score >= 70 AND no blocker issues.
Blocker issues: missing Problem Statement, missing Root Cause, Cost of Inaction is completely unquantified, no Out of Scope.
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
    messages: [{ role: "user", content: `Evaluate this Problem Framing output:\n\n${output}` }],
  });

  try {
    return JSON.parse(response.content[0].text);
  } catch {
    return { passed: false, score: 0, issues: ["Governance check failed to parse."], verdict: "Error in governance evaluation." };
  }
}
