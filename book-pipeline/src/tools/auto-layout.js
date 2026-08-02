#!/usr/bin/env node
'use strict';
/**
 * auto-layout.js — measurement-driven first-pass layouts (standalone, D-020).
 *
 * For every lesson WITHOUT a layout[], generates one:
 *   - title block first, remaining text blocks in document order
 *   - consecutive file-backed images grouped into image-grid rows (≤3 per row)
 *   - vector/tracing slots as their own placeholder rows
 * then composes the whole book in headless Chrome, measures each row's REAL
 * height, and packs rows into pages (assigning layout "page" numbers) so the
 * fit guard passes. Verifies with the fit measurement and re-packs up to 5
 * rounds. Never touches lessons that already have a layout[], never shrinks
 * text, never edits lesson content.
 *
 * These are FIRST-PASS layouts — refine visually in the preview editor.
 *
 * Usage:
 *   node src/tools/auto-layout.js <book.json> --images <images-dir>
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const geometry = require('../lib/geometry');

const MM2PX = 96 / 25.4;
const ROW_GAP_MM = 6;          // .sb-lesson flex gap
const BUDGET_PX = geometry.CONTENT.height_mm * MM2PX; // 273mm content box

function parseArgs(argv) {
  const args = { book: null, images: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--images') args.images = rest[++i];
    else if (!args.book) args.book = rest[i];
  }
  if (!args.book || !args.images) {
    console.error('usage: node src/tools/auto-layout.js <book.json> --images <dir>');
    process.exit(2);
  }
  return args;
}

/* ---------- first-pass row generation ---------- */
function generateRows(lesson) {
  const rows = [];
  const blocks = lesson.blocks || [];
  const slots = lesson.image_slots || [];
  const title = blocks.find(b => b.layout_hint === 'title');
  if (title) rows.push({ arrangement: 'text-only', refs: [title.id] });
  for (const b of blocks) {
    if (title && b.id === title.id) continue;
    rows.push({ arrangement: 'text-only', refs: [b.id] });
  }
  // group consecutive file-backed images into grids of ≤3; vector slots solo
  let batch = [];
  const flush = () => {
    if (!batch.length) return;
    if (batch.length === 1) rows.push({ arrangement: 'image-only', refs: batch });
    else rows.push({
      arrangement: 'image-grid', refs: batch,
      preset: batch.length === 2 ? 'auto-grid-2' : 'auto-grid-3',
    });
    batch = [];
  };
  for (const s of slots) {
    const isVector = s.action === 'vector_asset' || s.image_class === 'tracing_asset';
    if (isVector) { flush(); rows.push({ arrangement: 'image-only', refs: [s.id] }); }
    else {
      batch.push(s.id);
      if (batch.length === 3) flush();
    }
  }
  flush();
  rows.forEach((r, i) => { r.row = i + 1; });
  return rows;
}

/* ---------- measurement ---------- */
async function measure(page, book, imagesDir, compose, fontCss) {
  const html = compose.composeBook(book, 'print-colour', {
    imagesRel: pathToFileURL(imagesDir).href, fontCss,
  });
  const tmp = path.join(require('os').tmpdir(), `sb-autolayout-${process.pid}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
  await page.evaluateHandle('document.fonts.ready');
  await page.evaluate(async () => {
    await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
  });
  await page.emulateMediaType('print');
  const data = await page.evaluate(() => {
    const lessons = {};
    for (const pg of document.querySelectorAll('.sb-page')) {
      const sec = pg.querySelector('[data-lesson]');
      if (!sec) continue;
      const no = sec.getAttribute('data-lesson');
      lessons[no] = lessons[no] || { rows: {}, overflow: [] };
      for (const row of pg.querySelectorAll('[data-sb-row]')) {
        lessons[no].rows[row.getAttribute('data-sb-row')] = row.offsetHeight;
      }
      lessons[no].overflow.push(pg.scrollHeight - pg.clientHeight);
    }
    return lessons;
  });
  fs.unlinkSync(tmp);
  return data;
}

/* ---------- packing ---------- */
function pack(layout, heights) {
  const gap = ROW_GAP_MM * MM2PX;
  let pageNo = 1, used = 0, changed = false;
  for (const r of [...layout].sort((a, b) => a.row - b.row)) {
    const h = heights[r.row] || 0;
    const need = used === 0 ? h : h + gap;
    if (used > 0 && used + need > BUDGET_PX) { pageNo++; used = h; }
    else used += need;
    const want = pageNo === 1 ? undefined : pageNo;
    if ((r.page || 1) !== pageNo) changed = true;
    if (want === undefined) delete r.page; else r.page = want;
  }
  return changed;
}

async function main() {
  const args = parseArgs(process.argv);
  const bookPath = path.resolve(args.book);
  const imagesDir = path.resolve(args.images);
  const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));
  const compose = require('../lib/compose');
  const { getFontCss } = require('../lib/fonts');
  const fontCss = getFontCss();

  book.layout_presets = book.layout_presets || {};
  if (!book.layout_presets['auto-grid-2']) book.layout_presets['auto-grid-2'] = { type: 'image-grid', cols: 2, gutter_mm: 6 };
  if (!book.layout_presets['auto-grid-3']) book.layout_presets['auto-grid-3'] = { type: 'image-grid', cols: 3, gutter_mm: 4 };

  const targets = book.lessons.filter(l => !(Array.isArray(l.layout) && l.layout.length));
  if (!targets.length) { console.log('all lessons already have layouts — nothing to do'); return; }
  console.log(`generating first-pass layouts for ${targets.length} lesson(s): ${targets.map(l => l.lesson_no).join(', ')}`);
  for (const l of targets) l.layout = generateRows(l);

  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    args: ['--font-render-hinting=none', '--disable-lcd-text', '--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    for (let round = 1; round <= 5; round++) {
      const data = await measure(page, book, imagesDir, compose, fontCss);
      let anyChange = false, anyOverflow = false;
      for (const l of targets) {
        const d = data[String(l.lesson_no)];
        if (!d) continue;
        if (pack(l.layout, d.rows)) anyChange = true;
        if (d.overflow.some(o => o > 2)) anyOverflow = true;
      }
      console.log(`round ${round}: repacked=${anyChange} overflow-remaining=${anyOverflow}`);
      if (!anyChange && !anyOverflow) break;
      if (!anyChange && anyOverflow) {
        // a single row taller than one page — nothing packing can do; report
        for (const l of targets) {
          const d = data[String(l.lesson_no)];
          if (d && d.overflow.some(o => o > 2)) {
            const worst = Object.entries(d.rows).sort((a, b) => b[1] - a[1])[0];
            console.log(`  lesson ${l.lesson_no}: row ${worst[0]} alone is ${(worst[1] / MM2PX).toFixed(0)}mm — needs a manual layout (grid/split) in the editor`);
          }
        }
        break;
      }
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(bookPath, JSON.stringify(book, null, 2) + '\n', 'utf8');
  const pages = book.lessons.reduce((n, l) => n + new Set((l.layout || [{}]).map(r => r.page || 1)).size, 0);
  console.log(`written. book now lays out ~${pages} pages across ${book.lessons.length} lessons.`);
}

main().catch(err => { console.error(`auto-layout: ${err.message}`); process.exit(1); });
