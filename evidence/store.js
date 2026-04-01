function createId() {
  return `ev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function splitIntoChunks(content) {
  const normalized = String(content || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\s*\n/).map((chunk) => chunk.trim()).filter(Boolean);
  const chunks = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= 900) {
      chunks.push(paragraph);
      continue;
    }

    for (let i = 0; i < paragraph.length; i += 900) {
      chunks.push(paragraph.slice(i, i + 900).trim());
    }
  }

  return chunks;
}

export function createEvidenceStore() {
  let evidence = [];

  return {
    list() {
      return evidence.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    add({ title, type, content, sourceName = "", stageIds = ["all"], triage = null }) {
      const normalizedTitle = String(title || "").trim() || "Untitled evidence";
      const normalizedType = String(type || "general").trim() || "general";
      const normalizedContent = String(content || "").trim();
      const normalizedStageIds = Array.isArray(stageIds) && stageIds.length ? stageIds : ["all"];

      if (!normalizedContent) {
        throw new Error("Evidence content cannot be empty.");
      }

      const item = {
        id: createId(),
        title: normalizedTitle,
        type: normalizedType,
        sourceName: String(sourceName || "").trim(),
        content: normalizedContent,
        stageIds: normalizedStageIds,
        triage,
        chunks: splitIntoChunks(normalizedContent),
        createdAt: new Date().toISOString(),
      };

      evidence = [item, ...evidence];
      return item;
    },

    remove(id) {
      const before = evidence.length;
      evidence = evidence.filter((item) => item.id !== id);
      return evidence.length !== before;
    },

    clear() {
      evidence = [];
    },
  };
}
