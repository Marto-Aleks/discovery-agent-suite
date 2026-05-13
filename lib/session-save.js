import fs from "fs";
import path from "path";

const SESSIONS_DIR = new URL("../sessions/", import.meta.url).pathname;

/**
 * Loads stage outputs from the most recent saved session file.
 * Returns an object keyed by agent label (e.g. "Story Creation").
 */
export function loadLastSession() {
  if (!fs.existsSync(SESSIONS_DIR)) return {};

  const files = fs.readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse();

  if (!files.length) return {};

  const content = fs.readFileSync(path.join(SESSIONS_DIR, files[0]), "utf8");
  const stages = {};

  // Each stage section starts with "\n---\n## AgentName"
  const sections = content.split(/\n---\n## /);
  const knownMeta = ["Pipeline Summary", "Final Pipeline Governance", "Token Usage", "Evidence"];

  for (const section of sections.slice(1)) {
    const newline = section.indexOf("\n");
    const agentName = section.slice(0, newline).trim();
    if (!agentName || knownMeta.includes(agentName)) continue;

    const body = section.slice(newline + 1);
    const lines = body.split("\n");

    // Governance metadata lines start with ** and come before the first blank line
    // that is followed by non-metadata content. Find where actual output starts.
    const metaPrefixes = ["**Governance:", "**Verdict:", "**Evidence grounding:", "**Cross-stage alignment:", "**Issues:"];
    let outputStart = 0;
    let pastMeta = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!pastMeta) {
        if (metaPrefixes.some((p) => line.startsWith(p)) || line === "") continue;
        outputStart = i;
        pastMeta = true;
      }
    }

    const output = lines.slice(outputStart).join("\n").trim();
    if (output) stages[agentName] = output;
  }

  return stages;
}

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

  const usageRows = session.history.map((entry) => {
    const r = entry.runUsage || {};
    const g = entry.governance?.usage || {};
    return {
      agent: entry.agent,
      runIn: r.input_tokens || 0,
      runOut: r.output_tokens || 0,
      cacheRead: r.cache_read_input_tokens || 0,
      cacheWrite: r.cache_creation_input_tokens || 0,
      govIn: g.input_tokens || 0,
      govOut: g.output_tokens || 0,
    };
  });

  if (usageRows.length) {
    const totals = usageRows.reduce(
      (acc, r) => ({
        runIn: acc.runIn + r.runIn,
        runOut: acc.runOut + r.runOut,
        cacheRead: acc.cacheRead + r.cacheRead,
        cacheWrite: acc.cacheWrite + r.cacheWrite,
        govIn: acc.govIn + r.govIn,
        govOut: acc.govOut + r.govOut,
      }),
      { runIn: 0, runOut: 0, cacheRead: 0, cacheWrite: 0, govIn: 0, govOut: 0 }
    );
    const totalIn = totals.runIn + totals.govIn;
    const cacheEfficiency = totalIn > 0 ? Math.round((totals.cacheRead / totalIn) * 100) : 0;

    lines.push("");
    lines.push("---");
    lines.push("## Token Usage");
    lines.push("");
    lines.push("| Stage | Run In | Run Out | Cache Read | Cache Write | Gov In | Gov Out |");
    lines.push("|-------|-------:|--------:|-----------:|------------:|-------:|--------:|");
    for (const r of usageRows) {
      lines.push(`| ${r.agent} | ${r.runIn.toLocaleString()} | ${r.runOut.toLocaleString()} | ${r.cacheRead.toLocaleString()} | ${r.cacheWrite.toLocaleString()} | ${r.govIn.toLocaleString()} | ${r.govOut.toLocaleString()} |`);
    }
    lines.push(`| **Total** | **${totals.runIn.toLocaleString()}** | **${totals.runOut.toLocaleString()}** | **${totals.cacheRead.toLocaleString()}** | **${totals.cacheWrite.toLocaleString()}** | **${totals.govIn.toLocaleString()}** | **${totals.govOut.toLocaleString()}** |`);
    lines.push("");
    lines.push(`Cache efficiency: ${cacheEfficiency}% of input tokens served from cache`);
  }

  fs.writeFileSync(filepath, lines.join("\n"));
  return filepath;
}
