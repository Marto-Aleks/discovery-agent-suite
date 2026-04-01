import { createAgent } from "./factory.js";

const { meta, SYSTEM_PROMPT, GOVERNANCE_PROMPT, run, govern } = createAgent({
  id: "problem-framing",
  label: "Problem Framing",
  description: "Define and sharpen the problem before any solution thinking",
});

export { meta, SYSTEM_PROMPT, GOVERNANCE_PROMPT, run, govern };
