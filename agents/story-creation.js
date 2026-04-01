import { createAgent } from "./factory.js";

const { meta, SYSTEM_PROMPT, GOVERNANCE_PROMPT, run, govern } = createAgent({
  id: "story-creation",
  label: "Story Creation",
  description: "Generate well-structured, delivery-ready user stories",
  maxTokens: 2048,
});

export { meta, SYSTEM_PROMPT, GOVERNANCE_PROMPT, run, govern };
