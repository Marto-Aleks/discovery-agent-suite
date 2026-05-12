import { createAgent } from "./factory.js";

const { meta, run, govern } = createAgent({
  id: "estimation",
  label: "Estimation",
  description: "Size work with confidence ranges, not false precision",
  maxTokens: 1500,
});

export { meta, run, govern };
