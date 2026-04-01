import { createAnthropicClient } from "../lib/anthropic-client.js";

const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

const generationModel = process.env.HEALTHCHECK_RUN_MODEL || "claude-sonnet-4-20250514";
const governanceModel = process.env.HEALTHCHECK_GOV_MODEL || "claude-sonnet-4-20250514";

const client = createAnthropicClient(apiKey);

async function checkModel(label, model) {
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with OK" }],
    });
    console.log(`${label}: OK (${model}) -> ${response.content[0].text.trim()}`);
    return true;
  } catch (error) {
    const status = error?.status ? ` status=${error.status}` : "";
    const type = error?.error?.type ? ` type=${error.error.type}` : "";
    const message = error?.error?.message || error?.message || "Unknown error";
    console.error(`${label}: FAIL (${model}) -> ${message}${status}${type}`);
    return false;
  }
}

const runOk = await checkModel("generation", generationModel);
const govOk = await checkModel("governance", governanceModel);

process.exit(runOk && govOk ? 0 : 1);
