#!/usr/bin/env node
/**
 * Example pictures for the oral-exam picture question (D-#1282) — LOCAL help capture runs only.
 *
 *   PLAYWRIGHT_CORE=<playwright-core folder> node scripts/help/fixtures/viva-pictures.cjs <outDir>
 *
 * Draws, with headless Chrome, one simple emoji card per word of the 2026 Nursery আরবি picture
 * sets (server/assets/viva/nursery-arabic-2026.json), standing in for the book's pictures.
 * Nothing here comes from a real book. Writes <outDir>/manifest.json:
 *   { pictures: [{ sourceKey, page, word, wordEn, image, thumb }] }
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const out = path.resolve(process.argv[2] || "help-viva-pictures");

/** Book page, Arabic word, English word, emoji (the page numbers match the real bank keys). */
const PICTURES = [
  [7, "بَيْتٌ", "house", "🏠"], [10, "تِلْمِيذٌ", "student", "🧑‍🎓"], [11, "ثَمَرٌ", "fruit", "🍎"], [16, "جَمَلٌ", "camel", "🐫"],
  [17, "حِمَارٌ", "donkey", "🫏"], [18, "خَيْلٌ", "horse", "🐎"], [20, "دِيكٌ", "rooster", "🐓"], [21, "ذِئْبٌ", "wolf", "🐺"],
  [26, "رَجُلٌ", "man", "👨"], [27, "زَنْبَقٌ", "water lily", "🪷"], [30, "سَيْفٌ", "sword", "🗡️"], [31, "شَمْسٌ", "sun", "☀️"],
  [36, "صُورَةٌ", "picture", "🖼️"], [37, "ضِفْدَعٌ", "frog", "🐸"], [40, "طَيْرٌ", "bird", "🐦"], [41, "ظَرْفٌ", "envelope", "✉️"],
  [46, "عَيْنٌ", "eye", "👁️"], [51, "فِيلٌ", "elephant", "🐘"], [52, "قُفْلٌ", "lock", "🔒"], [57, "كَعْبَةٌ", "Kaaba", "🕋"],
  [58, "لَحْمٌ", "meat", "🥩"], [61, "مَوْزٌ", "banana", "🍌"], [62, "نَجْمٌ", "star", "⭐"], [67, "وِسَادَةٌ", "pillow", "🛏️"],
  [68, "هِرَّةٌ", "cat", "🐈"], [71, "أَرْنَبٌ", "rabbit", "🐇"], [72, "يَدٌ", "hand", "✋"],
];

const card = (emoji) => `<!doctype html><meta charset="utf-8"><body style="margin:0;width:600px;height:520px;display:flex;align-items:center;justify-content:center;background:#fff">
<div style="font-size:360px;line-height:1">${emoji}</div></body>`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 600, height: 520 } });
  const pictures = [];
  for (const [pg, word, wordEn, emoji] of PICTURES) {
    await page.setViewportSize({ width: 600, height: 520 });
    await page.setContent(card(emoji));
    const image = path.join(out, `ar-${pg}.jpg`);
    await page.screenshot({ path: image, type: "jpeg", quality: 85 });
    await page.setViewportSize({ width: 240, height: 208 });
    await page.setContent(card(emoji).replace('<body style="', '<body style="zoom:0.4;'));
    const thumb = path.join(out, `ar-${pg}-thumb.jpg`);
    await page.screenshot({ path: thumb, type: "jpeg", quality: 75 });
    pictures.push({ sourceKey: `ARABIC:${pg}:1`, page: pg, word, wordEn, image, thumb });
  }
  await browser.close();
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ pictures }, null, 1));
  console.log(`viva pictures: ${pictures.length} → ${out}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
