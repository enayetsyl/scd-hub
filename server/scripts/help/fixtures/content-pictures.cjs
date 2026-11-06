#!/usr/bin/env node
/**
 * Example pictures for the content help fixture (LOCAL capture runs only).
 *
 *   PLAYWRIGHT_CORE=<playwright-core folder> node scripts/help/fixtures/content-pictures.cjs <outDir>
 *
 * Draws, with headless Chrome, simple picture cards (an emoji and its Bangla word) for the
 * worksheet picture bank, and four pages of an example Nursery book ("উদাহরণ বর্ণমালা").
 * Nothing here comes from a real book or a real person. Writes <outDir>/manifest.json:
 *   { pictures: [{ letter, word, wordEn, image, thumb }], pages: [file…], pdf: file }
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const out = path.resolve(process.argv[2] || "help-content-pictures");

/** Letter, word, emoji, English word. */
const PICTURES = [
  ["অ", "অজগর", "🐍", "python"],
  ["আ", "আম", "🥭", "mango"],
  ["ই", "ইঁদুর", "🐭", "mouse"],
  ["ঈ", "ঈগল", "🦅", "eagle"],
  ["উ", "উট", "🐫", "camel"],
  ["ক", "কলা", "🍌", "banana"],
  ["খ", "খরগোশ", "🐰", "rabbit"],
  ["গ", "গরু", "🐄", "cow"],
  ["ঘ", "ঘড়ি", "⏰", "clock"],
  ["চ", "চশমা", "👓", "glasses"],
  ["ছ", "ছাতা", "☂️", "umbrella"],
  ["জ", "জাহাজ", "🚢", "ship"],
];

const card = (emoji, word) => `<!doctype html><meta charset="utf-8"><body style="margin:0;width:600px;height:600px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff;font-family:'Noto Sans Bengali','Nirmala UI',sans-serif">
<div style="font-size:330px;line-height:1">${emoji}</div><div style="font-size:64px;margin-top:20px;color:#333">${word}</div></body>`;

const bookPage = (n, rows) => `<!doctype html><meta charset="utf-8"><body style="margin:0;width:800px;height:1086px;background:#fffdf5;font-family:'Noto Sans Bengali','Nirmala UI',sans-serif;box-sizing:border-box;padding:48px">
<div style="text-align:center;color:#a33;font-size:30px;font-weight:700">উদাহরণ বর্ণমালা</div>
${rows.map(([l, w, e]) => `<div style="display:flex;align-items:center;gap:36px;margin-top:40px;border:3px dashed #e3c78a;border-radius:24px;padding:16px 32px">
<div style="font-size:150px;line-height:1;color:#1a6b45;width:170px;text-align:center">${l}</div><div style="font-size:120px;line-height:1">${e}</div><div style="font-size:58px;color:#333">${w}</div></div>`).join("")}
<div style="position:absolute;top:1030px;left:0;width:800px;text-align:center;font-size:26px;color:#777">${n}</div></body>`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
  const pictures = [];
  for (const [letter, word, emoji, wordEn] of PICTURES) {
    await page.setViewportSize({ width: 600, height: 600 });
    await page.setContent(card(emoji, word));
    const image = path.join(out, `pic-${wordEn}.jpg`);
    await page.screenshot({ path: image, type: "jpeg", quality: 85 });
    await page.setViewportSize({ width: 240, height: 240 });
    await page.setContent(card(emoji, word).replace('<body style="', '<body style="zoom:0.4;'));
    const thumb = path.join(out, `pic-${wordEn}-thumb.jpg`);
    await page.screenshot({ path: thumb, type: "jpeg", quality: 75 });
    pictures.push({ letter, word, wordEn, image, thumb });
  }
  const pages = [];
  const chunks = [PICTURES.slice(0, 3), PICTURES.slice(3, 6), PICTURES.slice(6, 9), PICTURES.slice(9, 12)];
  await page.setViewportSize({ width: 800, height: 1086 });
  for (const [i, rows] of chunks.entries()) {
    await page.setContent(bookPage(i + 1, rows));
    const f = path.join(out, `book-p${i + 1}.jpg`);
    await page.screenshot({ path: f, type: "jpeg", quality: 82 });
    pages.push(f);
  }
  await page.setContent(chunks.map((rows, i) => bookPage(i + 1, rows).replace("<body", '<div style="page-break-after:always;position:relative"').replace("</body>", "</div>")).join(""));
  const pdf = path.join(out, "udaharan-bornomala.pdf");
  await page.pdf({ path: pdf, width: "800px", height: "1086px", printBackground: true });
  await browser.close();
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ pictures, pages, pdf }, null, 1));
  console.log(`pictures: ${pictures.length}, book pages: ${pages.length} → ${out}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
