import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

function extOf(filename) {
  return path.extname(String(filename || "")).toLowerCase();
}

function stripXml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function withTempFile(filename, buffer, fn) {
  const safeName = path.basename(filename || "upload.bin").replace(/[^a-zA-Z0-9._-]/g, "_");
  const filepath = path.join(os.tmpdir(), `evidence_${Date.now()}_${safeName}`);
  await fs.writeFile(filepath, buffer);
  try {
    return await fn(filepath);
  } finally {
    await fs.unlink(filepath).catch(() => {});
  }
}

async function parseDocx(filepath) {
  try {
    const { stdout } = await execFileAsync("/usr/bin/textutil", ["-convert", "txt", "-stdout", filepath], { maxBuffer: 20 * 1024 * 1024 });
    const text = String(stdout || "").trim();
    if (text) return text;
  } catch {}

  const { stdout } = await execFileAsync("/usr/bin/unzip", ["-p", filepath, "word/document.xml"], { maxBuffer: 20 * 1024 * 1024 });
  return stripXml(stdout);
}

function parseSheetXml(xml, sharedStrings) {
  const rows = [];
  const rowMatches = String(xml || "").match(/<row[\s\S]*?<\/row>/g) || [];

  for (const rowXml of rowMatches) {
    const cells = [];
    const cellMatches = rowXml.match(/<c[\s\S]*?<\/c>/g) || [];
    for (const cellXml of cellMatches) {
      const isShared = /t="s"/.test(cellXml);
      const raw = (cellXml.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || (cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || "";
      const value = isShared ? (sharedStrings[Number(raw)] || "") : stripXml(raw);
      cells.push(value);
    }
    if (cells.some(Boolean)) rows.push(cells.join(" | "));
  }

  return rows.join("\n");
}

async function parseXlsx(filepath) {
  const { stdout: sharedXml } = await execFileAsync("/usr/bin/unzip", ["-p", filepath, "xl/sharedStrings.xml"], { maxBuffer: 20 * 1024 * 1024 }).catch(() => ({ stdout: "" }));
  const sharedStrings = [];
  const siMatches = String(sharedXml || "").match(/<si[\s\S]*?<\/si>/g) || [];
  for (const si of siMatches) {
    sharedStrings.push(stripXml(si));
  }

  const { stdout: workbookXml } = await execFileAsync("/usr/bin/unzip", ["-p", filepath, "xl/workbook.xml"], { maxBuffer: 20 * 1024 * 1024 });
  const sheetNames = [];
  const sheetMatches = String(workbookXml || "").match(/<sheet[^>]*name="([^"]+)"/g) || [];
  for (const match of sheetMatches) {
    const name = (match.match(/name="([^"]+)"/) || [])[1];
    if (name) sheetNames.push(name);
  }

  const { stdout: listing } = await execFileAsync("/usr/bin/unzip", ["-Z1", filepath], { maxBuffer: 20 * 1024 * 1024 });
  const sheetFiles = String(listing || "").split("\n").filter((line) => line.startsWith("xl/worksheets/sheet"));
  const parts = [];

  for (let i = 0; i < sheetFiles.length; i++) {
    const sheetFile = sheetFiles[i];
    const { stdout: sheetXml } = await execFileAsync("/usr/bin/unzip", ["-p", filepath, sheetFile], { maxBuffer: 20 * 1024 * 1024 });
    const sheetText = parseSheetXml(sheetXml, sharedStrings);
    if (sheetText) {
      parts.push(`Sheet: ${sheetNames[i] || `Sheet ${i + 1}`}\n${sheetText}`);
    }
  }

  return parts.join("\n\n---\n\n").trim();
}

async function parsePdf(filepath) {
  try {
    const { stdout } = await execFileAsync("/usr/bin/mdls", ["-raw", "-name", "kMDItemTextContent", filepath], { maxBuffer: 20 * 1024 * 1024 });
    const text = String(stdout || "").trim();
    if (text && text !== "(null)") return text;
  } catch {}

  const { stdout } = await execFileAsync("/usr/bin/strings", ["-n", "6", filepath], { maxBuffer: 20 * 1024 * 1024 });
  return String(stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export async function parseUploadedEvidence({ filename, base64 }) {
  if (!filename || !base64) {
    throw new Error("filename and base64 are required.");
  }

  const ext = extOf(filename);
  const buffer = Buffer.from(String(base64), "base64");

  if ([".txt", ".md", ".csv", ".json"].includes(ext)) {
    return { text: buffer.toString("utf8").trim(), detectedType: ext.slice(1) };
  }

  if (ext === ".docx") {
    const text = await withTempFile(filename, buffer, parseDocx);
    return { text, detectedType: "docx" };
  }

  if (ext === ".xlsx") {
    const text = await withTempFile(filename, buffer, parseXlsx);
    return { text, detectedType: "xlsx" };
  }

  if (ext === ".pdf") {
    const text = await withTempFile(filename, buffer, parsePdf);
    return { text, detectedType: "pdf" };
  }

  throw new Error(`Unsupported file type: ${ext || "unknown"}. Supported: .txt, .md, .csv, .json, .docx, .xlsx, .pdf`);
}
