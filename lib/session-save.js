import fs from "fs";
import path from "path";

const SESSIONS_DIR = new URL("../sessions/", import.meta.url).pathname;

export function saveSession(session) {
  if (!session?.history?.length) return null;

  fs.mkdirSync(SESSIONS_DIR, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const slug = session.topic
    ? session.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)
    : "session";
  const filename = `${date}_${slug}.md`;
  const filepath = path.join(SESSIONS_DIR, filename);

  const lines = [
    `# Session Output — ${session.topic || "Untitled"}`,
    `**Date:** ${date}`,
    `**Pipeline:** ${session.history.map((entry) => entry.agent).join(" → ")}`,
    "",
  ];

  if (session.evidence?.length) {
    lines.push("## Evidence");
    for (const item of session.evidence) {
      lines.push(`- **${item.title}** (${item.type})`);
    }
    lines.push("");
  }

  for (const entry of session.history) {
    lines.push(`---\n## ${entry.agent}`);
    lines.push(`**Governance: ${entry.passed ? "PASSED" : "OVERRIDE"} — Score ${entry.score}/100**\n`);
    if (entry.governance?.verdict) lines.push(`**Verdict:** ${entry.governance.verdict}`);
    if (entry.governance?.evidenceGrounding) lines.push(`**Evidence grounding:** ${entry.governance.evidenceGrounding}`);
    if (entry.governance?.alignment) lines.push(`**Cross-stage alignment:** ${entry.governance.alignment}`);
    if (entry.governance?.issues?.length) lines.push(`**Issues:** ${entry.governance.issues.join("; ")}`);
    lines.push("");
    lines.push(entry.output);
    lines.push("");
  }

  lines.push("---");
  lines.push("## Pipeline Summary");
  lines.push("| Stage | Score | Status |");
  lines.push("|-------|-------|--------|");
  for (const entry of session.history) {
    lines.push(`| ${entry.agent} | ${entry.score}/100 | ${entry.passed ? "✓ Passed" : "⚠ Override"} |`);
  }

  if (session.finalGovernance) {
    lines.push("");
    lines.push("---");
    lines.push("## Final Pipeline Governance");
    lines.push(`**Score:** ${session.finalGovernance.score}/100`);
    lines.push(`**Verdict:** ${session.finalGovernance.verdict}`);
    lines.push(`**Evidence grounding:** ${session.finalGovernance.evidenceGrounding}`);
    lines.push(`**Cross-stage alignment:** ${session.finalGovernance.alignment}`);
    if (session.finalGovernance.issues?.length) lines.push(`**Issues:** ${session.finalGovernance.issues.join("; ")}`);
    if (session.finalGovernance.assumptions?.length) lines.push(`**Assumptions:** ${session.finalGovernance.assumptions.join("; ")}`);
    if (session.finalGovernance.contradictions?.length) lines.push(`**Contradictions:** ${session.finalGovernance.contradictions.join("; ")}`);
  }

  fs.writeFileSync(filepath, lines.join("\n"));
  return filepath;
}
