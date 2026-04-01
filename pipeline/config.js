import * as problemFraming from "../agents/problem-framing.js";
import * as opportunityFraming from "../agents/opportunity-framing.js";
import * as storyCreation from "../agents/story-creation.js";
import * as prioritisation from "../agents/prioritisation.js";
import * as estimation from "../agents/estimation.js";

export const MAX_ATTEMPTS = 3;

export const PIPELINE = [
  { ...problemFraming.meta,     run: problemFraming.run,     govern: problemFraming.govern },
  { ...opportunityFraming.meta, run: opportunityFraming.run, govern: opportunityFraming.govern },
  { ...storyCreation.meta,      run: storyCreation.run,      govern: storyCreation.govern },
  { ...estimation.meta,         run: estimation.run,         govern: estimation.govern },
  { ...prioritisation.meta,     run: prioritisation.run,     govern: prioritisation.govern },
];

export function getRuntimeConfig() {
  const maxAttempts = Number.parseInt(process.env.MAX_ATTEMPTS || "", 10);
  const stageFilter = (process.env.PIPELINE_STAGES || "")
    .split(",")
    .map((stage) => stage.trim())
    .filter(Boolean);

  return {
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : MAX_ATTEMPTS,
    disableCondense: process.env.DISABLE_CONDENSE === "1",
    autoOverride: process.env.AUTO_OVERRIDE === "1",
    stageFilter,
  };
}
