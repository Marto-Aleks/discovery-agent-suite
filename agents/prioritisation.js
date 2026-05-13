import { createAgent } from "./factory.js";

const { meta, run, govern } = createAgent({
  id: "prioritisation",
  label: "Prioritisation",
  description: "Stack-rank work by value, risk, and delivery feasibility",
  maxTokens: 8192,
});

export { meta, run, govern };
