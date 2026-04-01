import { createAgent } from "./factory.js";

const { meta, SYSTEM_PROMPT, GOVERNANCE_PROMPT, run, govern } = createAgent({
  id: "prioritisation",
  label: "Prioritisation",
  description: "Stack-rank work by value, risk, and delivery feasibility",
  maxTokens: 1500,
});

export { meta, SYSTEM_PROMPT, GOVERNANCE_PROMPT, run, govern };
