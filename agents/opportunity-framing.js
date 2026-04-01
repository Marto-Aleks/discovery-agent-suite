import { createAgent } from "./factory.js";

const { meta, SYSTEM_PROMPT, GOVERNANCE_PROMPT, run, govern } = createAgent({
  id: "opportunity-framing",
  label: "Opportunity Framing",
  description: "Turn a defined problem into a compelling, bounded opportunity",
});

export { meta, SYSTEM_PROMPT, GOVERNANCE_PROMPT, run, govern };
