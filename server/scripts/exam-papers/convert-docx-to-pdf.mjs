#!/usr/bin/env node
/**
 * Convert the .docx originals in a reference-paper manifest to PDF (D-#1030) — docx → HTML
 * (mammoth) → PDF (headless Chrome). Chrome shapes Bangla correctly; Word 2013's PDF export
 * scrambles Bangla vowel signs and drops glyphs (seen 2026-11-06), so it is not used.
 *
 *   node server/scripts/exam-papers/convert-docx-to-pdf.mjs --manifest <manifest.json> [--force]
 *     [--modules <dir with node_modules/{mammoth,playwright-core}>] [--chrome <chrome.exe>]
 *
 * mammoth and playwright-core are NOT repo dependencies: install them in a scratch folder
 * (`npm i mammoth playwright-core`) and pass it as --modules. Only entries with
 * needsConversion = true are converted; an existing PDF is kept unless --force.
 * The original .docx is still what readers download — the PDF only feeds the page images.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const manifestPath = arg("manifest");
if (!manifestPath) {
  console.error("--manifest <manifest.json> is required");
  process.exit(2);
}
const force = argv.includes("--force");
const modules = path.resolve(arg("modules", "C:/w/pw"));
const chrome = arg("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const req = createRequire(path.join(modules, "noop.js"));
const mammoth = req("mammoth");
const { chromium } = req("playwright-core");

const CSS = `
  @page { size: A4; margin: 14mm 14mm; }
  body { font-family: "Nirmala UI", "Vrinda", "Arial Unicode MS", sans-serif; font-size: 12.5pt; line-height: 1.55; color: #000; }
  p { margin: 0 0 6px; }
  h1, h2, h3 { text-align: center; margin: 4px 0; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0; }
  td, th { border: 1px solid #555; padding: 3px 6px; vertical-align: top; }
  img { max-width: 100%; }
`;

const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
fs.mkdirSync(m.pdfCache, { recursive: true });
const todo = m.entries.filter((e) => e.needsConversion && (force || !fs.existsSync(e.pdf)));
console.log(`${todo.length} to convert`);
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
let ok = 0;
let failed = 0;
for (const e of todo) {
  try {
    const { value } = await mammoth.convertToHtml(
      { path: e.source },
      { convertImage: mammoth.images.imgElement((img) => img.read("base64").then((b) => ({ src: `data:${img.contentType};base64,${b}` }))) },
    );
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${value}</body></html>`, {
      waitUntil: "load",
    });
    await page.pdf({ path: e.pdf, format: "A4", printBackground: true });
    ok++;
  } catch (err) {
    failed++;
    console.log(`FAIL ${e.source}: ${err.message}`);
  }
}
await browser.close();
console.log(`converted ${ok}, failed ${failed}`);
if (failed) process.exitCode = 1;
