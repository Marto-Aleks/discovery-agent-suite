import { loadContext } from "../context/loader.js";
import { loadSkill } from "../skills/loader.js";

function getEnvInt(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createAgent({
  id,
  label,
  description,
  skillId = id,
  contextId = id,
  runModel = "claude-sonnet-4-6",
  governanceModel = "claude-haiku-4-5-20251001",
  maxTokens = 1024,
  governanceMaxTokens = 1024,
}) {
  const meta = { id, label, description };
  const { systemPrompt, governancePrompt } = loadSkill(skillId);
  const SYSTEM_PROMPT = `${systemPrompt}${loadContext(contextId)}`;
  const GOVERNANCE_PROMPT = governancePrompt;

  async function run(client, messages, context = {}, onChunk = null) {
    const contextBlock = context.summary
      ? `\n\nSession context so far:\n${context.summary}`
      : "";

    const augmented = messages.map((message, index) =>
      index === 0 ? { ...message, content: message.content + contextBlock } : message
    );

    // Reload context on each call so edits to context files take effect immediately
    const { systemPrompt: freshSystemPrompt } = loadSkill(skillId);
    const dynamicSystem = `${freshSystemPrompt}${loadContext(contextId)}`;

    const stream = client.messages.stream({
      model: runModel,
      max_tokens: getEnvInt("AGENT_MAX_TOKENS", maxTokens),
      system: dynamicSystem,
      messages: augmented,
    });

    if (onChunk) stream.on("text", onChunk);

    const message = await stream.finalMessage();
    return { text: message.content[0].text, usage: message.usage };
  }

  async function govern(client, output) {
    const response = await client.messages.create({
      model: governanceModel,
      max_tokens: getEnvInt("GOVERNANCE_MAX_TOKENS", governanceMaxTokens),
      system: loadSkill(skillId).governancePrompt,
      messages: [
        { role: "user", content: `Evaluate this ${label} output:\n\n${output}` },
        { role: "assistant", content: "{" },
      ],
    });

    try {
      const full = "{" + response.content[0].text;
      const match = full.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : full);
      return { ...parsed, usage: response.usage };
    } catch {
      return {
        passed: false,
        score: 0,
        issues: ["Governance check failed to parse."],
        verdict: "Error in governance evaluation.",
        usage: response.usage,
      };
    }
  }

  return { meta, id, label, description, skillId, contextId, SYSTEM_PROMPT, GOVERNANCE_PROMPT, run, govern };
}
