/**
 * Parses individual stories out of Story Creation agent output and enriches
 * them with estimation and prioritisation data from downstream stages.
 *
 * Handles two formats produced by the pipeline:
 *   Format 1: **Story Title** — Title  (session 1 style)
 *   Format 2: ## ST-N — Title          (session 2 style)
 */

// ── Story extraction ──────────────────────────────────────────────────────────

export function parseStories(output) {
  const stories = [];

  const parts = output.split(/(?=\*\*Story Title|^##\s+ST-\d+\b)/m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const titleMatch =
      trimmed.match(/\*\*Story Title:?\*\*\s*[—:–\-]?\s*(.+?)(?:\n|$)/) ||
      trimmed.match(/^##\s+(ST-\d+)\s*[—:–\-]\s*(.+?)(?:\n|$)/m);
    if (!titleMatch) continue;

    const storyId = titleMatch[2] ? titleMatch[1].trim() : "";
    const rawTitle = titleMatch[2] || titleMatch[1];
    const title = rawTitle.replace(/\*\*/g, "").trim();
    if (!title) continue;

    // Skip structurally blocked placeholder stories
    const isBlocked =
      trimmed.includes("⛔ **BLOCKED**") &&
      trimmed.includes("All criteria to be written after");
    if (isBlocked) continue;

    stories.push({ storyId, title, body: trimmed });
  }

  return stories;
}

// ── Estimation parsing ────────────────────────────────────────────────────────

export function parseEstimation(output) {
  if (!output) return [];
  const items = [];

  const sections = output.split(/^---$/m);
  for (const section of sections) {
    // Match both "**Item** — Name" and "**Item** — Name\n**Item ID** — ST-N" styles
    const nameMatch = section.match(/\*\*Item\*\*\s*[—:]\s*(.+?)(?:\n|$)/);
    const sizeMatch = section.match(/\*\*Size\*\*\s*[—:|]\s*(.+?)(?:\n|$)/);
    const confMatch = section.match(/\*\*Confidence\*\*\s*[—:|]\s*(.+?)(?:\n|$)/);
    const spikeMatch = section.match(/\*\*Spike Recommended\?\*\*\s*[—:|]\s*(.+?)(?:\n|$)/);

    if (!nameMatch || !sizeMatch) continue;

    items.push({
      name: nameMatch[1].replace(/\*\*/g, "").trim(),
      size: sizeMatch[1].replace(/\*\*/g, "").trim(),
      confidence: confMatch ? confMatch[1].replace(/\*\*/g, "").trim() : "",
      spike: spikeMatch ? spikeMatch[1].replace(/\*\*/g, "").trim() : "",
    });
  }

  return items;
}

// ── Prioritisation parsing ────────────────────────────────────────────────────

export function parsePrioritisation(output) {
  if (!output) return [];
  const items = [];

  // Match table rows: | rank | ... item name ... | ... rationale |
  // Both session formats put rank in the first column
  for (const line of output.split("\n")) {
    const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cols.length < 4) continue;
    const rank = parseInt(cols[0]);
    if (!Number.isFinite(rank) || rank < 1) continue;

    // Item name is in col index 1 or 2 depending on whether an Item ID column exists.
    const hasItemId = /^[A-Z]+-\d+$/i.test(cols[1] || "");
    const name = (hasItemId ? cols[2] : cols[1])
      ?.replace(/\*\*/g, "")
      .replace(/\(.*?\)/g, "")
      .trim();
    if (!name) continue;

    const rationale = cols[cols.length - 1].replace(/\*\*/g, "").trim();

    items.push({ rank, name, rationale });
  }

  return items;
}

// ── Title matching ────────────────────────────────────────────────────────────

function keyWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

function similarity(a, b) {
  const wa = keyWords(a);
  const wb = keyWords(b);
  if (!wa.length || !wb.length) return 0;
  const common = wa.filter((w) => wb.includes(w)).length;
  return common / Math.max(wa.length, wb.length);
}

function findBestMatch(title, items) {
  let best = null;
  let bestScore = 0.2; // minimum threshold
  for (const item of items) {
    const score = similarity(title, item.name);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

// ── Jira priority mapping ─────────────────────────────────────────────────────

export function rankToJiraPriority(rank) {
  if (rank === 1) return "Highest";
  if (rank === 2) return "High";
  if (rank === 3) return "Medium";
  if (rank === 4) return "Low";
  return "Lowest";
}

// ── Enrichment ────────────────────────────────────────────────────────────────

/**
 * Combines story, estimation, and prioritisation data into Jira-ready objects.
 */
export function buildJiraPayloads(storyOutput, estimationOutput, prioritisationOutput) {
  const stories = parseStories(storyOutput);
  const estimates = parseEstimation(estimationOutput);
  const priorities = parsePrioritisation(prioritisationOutput);

  return stories.map((story) => {
    const est = findBestMatch(story.title, estimates);
    const pri = findBestMatch(story.title, priorities);

    const descParts = [cleanBody(story.body)];

    if (est) {
      descParts.push("---\nESTIMATION");
      descParts.push(`Size: ${est.size}`);
      if (est.confidence) descParts.push(`Confidence: ${est.confidence}`);
      if (est.spike) descParts.push(`Spike: ${est.spike}`);
    }

    if (pri) {
      descParts.push("---\nPRIORITISATION");
      descParts.push(`Priority rank: #${pri.rank}`);
      if (pri.rationale) descParts.push(`Rationale: ${pri.rationale}`);
    }

    return {
      title: story.storyId ? `${story.storyId} - ${story.title}` : story.title,
      description: descParts.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
      jiraPriority: pri ? rankToJiraPriority(pri.rank) : null,
    };
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function cleanBody(body) {
  return body
    .replace(/\*\*Story Title:?\*\*\s*[—:–\-]?\s*.+\n?/, "")
    .replace(/^##\s+ST-\d+\s*[—\-]\s*.+\n?/m, "")
    .replace(/^\*\*Story ID:\*\*\s*.+\n?/m, "")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/- \[ \] /g, "- ")
    .replace(/- \[x\] /gi, "- [x] ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
