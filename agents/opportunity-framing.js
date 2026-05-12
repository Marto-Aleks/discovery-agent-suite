import { createAgent } from "./factory.js";

const { meta, run, govern } = createAgent({
  id: "opportunity-framing",
  label: "Opportunity Framing",
  description: "Turn a defined problem into a compelling, bounded opportunity",
});

export { meta, run, govern };
