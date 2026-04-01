const TYPE_KEYWORDS = {
  support: ["ticket", "support", "zendesk", "complaint", "customer issue", "bug report", "nps", "feedback"],
  analytics: ["funnel", "conversion", "ga4", "analytics", "retention", "drop-off", "ctr", "session"],
  research: ["interview", "research", "survey", "persona", "usability", "observation", "transcript"],
  strategy: ["okr", "strategy", "roadmap", "north star", "goal", "bet", "initiative"],
  delivery: ["story", "backlog", "release", "qa", "sprint", "acceptance criteria", "delivery"],
  technical: ["api", "architecture", "latency", "database", "service", "infra", "performance", "code"],
  dependency: ["dependency", "blocked", "integration", "vendor", "third-party", "handoff"],
  commercial: ["revenue", "sales", "pricing", "pipeline", "churn", "upsell", "commercial"],
  incident: ["incident", "outage", "postmortem", "severity", "degradation", "rollback"],
  design: ["design", "figma", "prototype", "ux", "ui"],
  legal: ["legal", "privacy", "gdpr", "compliance", "policy", "consent"],
  capacity: ["capacity", "headcount", "staffing", "velocity", "availability", "team size"],
};

const TYPE_TO_STAGES = {
  support: ["problem-framing", "opportunity-framing"],
  analytics: ["problem-framing", "opportunity-framing", "prioritisation"],
  research: ["problem-framing", "opportunity-framing", "story-creation"],
  strategy: ["opportunity-framing", "prioritisation"],
  delivery: ["story-creation", "estimation"],
  technical: ["estimation", "story-creation"],
  dependency: ["estimation", "prioritisation"],
  commercial: ["opportunity-framing", "prioritisation"],
  incident: ["problem-framing", "estimation"],
  design: ["story-creation"],
  legal: ["story-creation", "prioritisation"],
  capacity: ["estimation", "prioritisation"],
  general: ["all"],
};

function normalize(value) {
  return String(value || "").trim();
}

function scoreType(text, keywords) {
  return keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);
}

function sentencePreview(text, maxLen = 120) {
  const cleaned = normalize(text).replace(/\s+/g, " ");
  if (!cleaned) return "";
  const firstSentence = cleaned.split(/[.!?]\s/)[0];
  return firstSentence.length > maxLen ? `${firstSentence.slice(0, maxLen).trim()}…` : firstSentence;
}

function chooseTitle(title, text, detectedType) {
  const normalizedTitle = normalize(title);
  if (normalizedTitle) return normalizedTitle;

  const preview = sentencePreview(text, 72);
  if (preview) return preview;

  return `${detectedType[0].toUpperCase()}${detectedType.slice(1)} evidence`;
}

export function triageEvidence({ title = "", content = "" }) {
  const rawText = normalize(`${title}\n${content}`).toLowerCase();
  const scoredTypes = Object.entries(TYPE_KEYWORDS)
    .map(([type, keywords]) => ({ type, score: scoreType(rawText, keywords) }))
    .sort((a, b) => b.score - a.score);

  const best = scoredTypes[0] && scoredTypes[0].score > 0 ? scoredTypes[0] : { type: "general", score: 0 };
  const runnerUp = scoredTypes[1] && scoredTypes[1].score > 0 ? scoredTypes[1] : null;
  const confidence = best.score >= 3 ? "high" : best.score === 2 ? "medium" : best.score === 1 ? "low" : "low";
  const stageIds = TYPE_TO_STAGES[best.type] || ["all"];
  const summary = sentencePreview(content || title, 180) || "Needs human review for a stronger summary.";
  const reasons = [];

  if (best.score > 0) {
    reasons.push(`Detected ${best.type} signals in the title/content.`);
  } else {
    reasons.push("No strong signal found, defaulting to general evidence.");
  }

  if (runnerUp) {
    reasons.push(`Secondary signal: ${runnerUp.type}.`);
  }

  return {
    suggestedTitle: chooseTitle(title, content, best.type),
    suggestedType: best.type,
    suggestedStageIds: stageIds,
    confidence,
    summary,
    reasons,
  };
}
