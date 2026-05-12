import { createAgent } from "./factory.js";

const { meta, run, govern } = createAgent({
  id: "problem-framing",
  label: "Problem Framing",
  description: "Define and sharpen the problem before any solution thinking",
});

export { meta, run, govern };
