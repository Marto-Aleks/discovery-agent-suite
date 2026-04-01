import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Loads shared + agent-specific project context from the context/ directory.
 * Returns an empty string if no files exist.
 *
 * Context should contain project and organisation facts, not reusable skills.
 */
export function loadContext(agentId) {
  const read = (file) => {
    try {
      return sanitiseContext(readFileSync(path.join(__dirname, file), "utf8"));
    } catch {
      return null;
    }
  };

  const shared = read("shared.md");
  const specific = read(`${agentId}.md`);

  const parts = [];
  if (shared) parts.push(`## Organisation Context (all agents)\n\n${shared}`);
  if (specific) parts.push(`## ${agentId} Context\n\n${specific}`);

  return parts.length ? `\n\n---\n\n${parts.join("\n\n---\n\n")}` : "";
}

function sanitiseContext(content) {
  const cleaned = content
    .split("\n")
    .filter((line) => !line.trim().startsWith("<!--"))
    .filter((line) => !line.includes("[e.g."))
    .filter((line) => !line.match(/^\s*-\s*\[[^\]]+\]\s*$/))
    .filter((line) => !line.match(/^\s*\*\*[^*]+:\*\*\s*\[[^\]]+\]\s*$/))
    .join("\n")
    .trim();

  return cleaned || null;
}
