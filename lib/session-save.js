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

  for (const entry of session.history) {
    lines.push(`---\n## ${entry.agent}`);
    lines.push(`**Governance: ${entry.passed ? "PASSED" : "OVERRIDE"} — Score ${entry.score}/100**\n`);
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

  fs.writeFileSync(filepath, lines.join("\n"));
  return filepath;
}
