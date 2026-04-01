export const EVIDENCE_TYPE_LABELS = [
  "support",
  "analytics",
  "research",
  "strategy",
  "delivery",
  "technical",
  "dependency",
  "commercial",
  "incident",
  "design",
  "legal",
  "capacity",
  "general",
];

export const EVIDENCE_ROUTING = {
  "problem-framing": ["support", "analytics", "incident", "research", "general"],
  "opportunity-framing": ["strategy", "analytics", "research", "commercial", "general"],
  "story-creation": ["research", "delivery", "design", "legal", "general"],
  estimation: ["technical", "delivery", "dependency", "capacity", "general"],
  prioritisation: ["commercial", "strategy", "dependency", "capacity", "analytics", "general"],
};

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function scoreEvidence(agentId, item, topic, summary) {
  let score = 0;
  const allowedTypes = EVIDENCE_ROUTING[agentId] || ["general"];
  const topicText = normalizeText(topic);
  const summaryText = normalizeText(summary);
  const haystack = normalizeText(`${item.title}\n${item.content}`);

  if (allowedTypes.includes(item.type)) score += 5;

  for (const token of topicText.split(/\W+/).filter((part) => part.length > 3)) {
    if (haystack.includes(token)) score += 2;
  }

  for (const token of summaryText.split(/\W+/).filter((part) => part.length > 4).slice(0, 20)) {
    if (haystack.includes(token)) score += 1;
  }

  if (item.stageIds?.includes(agentId)) score += 8;
  if (item.stageIds?.includes("all")) score += 4;

  return score;
}

export function selectEvidenceForAgent(agentId, evidenceItems = [], session = {}) {
  const allowedTypes = EVIDENCE_ROUTING[agentId] || ["general"];

  return evidenceItems
    .filter((item) => item.stageIds?.includes("all") || item.stageIds?.includes(agentId) || allowedTypes.includes(item.type))
    .map((item) => ({
      ...item,
      relevanceScore: scoreEvidence(agentId, item, session.topic, session.summary),
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);
}

export function formatEvidenceForPrompt(evidenceItems = []) {
  if (!evidenceItems.length) return "";

  const blocks = evidenceItems.map((item, index) => [
    `Evidence ${index + 1}`,
    `Title: ${item.title}`,
    `Type: ${item.type}`,
    `Scope: ${(item.stageIds || ["all"]).join(", ")}`,
    "Content:",
    item.content,
  ].join("\n"));

  return blocks.join("\n\n---\n\n");
}
