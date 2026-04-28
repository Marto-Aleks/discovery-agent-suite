import fs from "fs";
import path from "path";

const shellEnvKeys = new Set(Object.keys(process.env));

function parseEnvValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";

  const quote = value[0];
  if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1);
  }

  return value;
}

function loadEnvFile(filepath) {
  if (!fs.existsSync(filepath)) return;

  const content = fs.readFileSync(filepath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    if (!key || shellEnvKeys.has(key)) continue;

    const value = parseEnvValue(trimmed.slice(separator + 1));
    process.env[key] = value;
  }
}

const rootDir = process.cwd();

// Load shared defaults first, then let .env.local override them.
loadEnvFile(path.join(rootDir, ".env"));
loadEnvFile(path.join(rootDir, ".env.local"));
