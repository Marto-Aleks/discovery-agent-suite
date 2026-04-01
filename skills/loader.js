import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readRequired(parts) {
  const filepath = path.join(__dirname, ...parts);
  return readFileSync(filepath, "utf8").trim();
}

export function loadSkill(skillId) {
  return {
    systemPrompt: readRequired([skillId, "system.md"]),
    governancePrompt: readRequired([skillId, "governance.md"]),
  };
}
