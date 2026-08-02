#!/usr/bin/env node
'use strict';
/**
 * build-book.js — render both study-book editions to PDF (standalone, D-020).
 *
 * For each profile in ALWAYS_RENDER:
 *   compose → Puppeteer → geometry assert → text-fit guard → page.pdf →
 *   post-render font audit.
 * Both profiles are attempted even if the first fails, so all problems
 * surface at once; exit is non-zero if ANY profile failed. A single-edition
 * success is not a pass.
 *
 * Usage:
 *   node src/build-book.js <path/to/book.json> --images <images-dir> --out <out-dir>
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const geometry = require('./lib/geometry');
const { ALWAYS_RENDER } = require('./lib/profiles');
const { composeBook } = require('./lib/compose');
const { getFontCss } = require('./lib/fonts');
const { auditPdfFonts } = require('./lib/font-audit');

/* ---------- CLI ---------- */
function parseArgs(argv) {
  const args = { book: null, images: null, out: 'out' };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--images') args.images = rest[++i];
    else if (a === '--out') args.out = rest[++i];
    else if (!args.book) args.book = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (!args.book || !args.images) {
    console.error('usage: node src/build-book.js <book.json> --images <images-dir> [--out <out-dir>]');
    process.exit(2);
  }
  return args;
}

/* ---------- per-profile render ---------- */
async function renderProfile(browser, book, profileId, ctx) {
  const { bookDir, imagesDir, outDir, fontCss } = ctx;

  // Write the composed HTML beside the images so relative src resolves,
  // and load it via file:// (setContent has no base URL for relative paths).
  const imagesRel = path.relative(bookDir, imagesDir).split(path.sep).join('/');
  const html = composeBook(book, profileId, { imagesRel, fontCss });
  const tmpHtml = path.join(bookDir, `.build-${book.book_id}-${profileId}.html`);
  fs.writeFileSync(tmpHtml, html, 'utf8');

  const outPath = path.join(outDir, `${book.book_id}-bn-${profileId}.pdf`);
  const page = await browser.newPage();
  try {
    // a full book is 100+ pages with 150+ print-res images — allow minutes,
    // not puppeteer's 30s default
    page.setDefaultTimeout(300000);
    await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'load', timeout: 300000 });

    // Fonts + images must be fully ready before any measurement or PDF.
    await page.evaluateHandle('document.fonts.ready');
    // Decode one at a time. Decoding 150+ print-resolution images in parallel
    // holds every bitmap live at once (~4GB) and kills the renderer mid-render.
    await page.evaluate(async () => {
      for (const img of [...document.images]) {
        try { await img.decode(); } catch { /* broken src is caught elsewhere */ }
      }
    });

    await page.emulateMediaType('print');

    // Geometry assert: refuse to render if the laid-out page is off-scale.
    const box = await page.evaluate(() => {
      const el = document.querySelector('.sb-page');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const mmPerPx = 25.4 / 96; // CSS px → mm at 96dpi
      return { w: r.width * mmPerPx, h: r.height * mmPerPx };
    });
    if (!box) throw new Error('geometry assert: no .sb-page found in composed HTML');
    const tol = geometry.ASSERT_TOLERANCE_MM;
    const { SHEET } = geometry;
    if (Math.abs(box.w - SHEET.width_mm) > tol || Math.abs(box.h - SHEET.height_mm) > tol) {
      throw new Error(
        `geometry assert: page measures ${box.w.toFixed(2)}×${box.h.toFixed(2)}mm, ` +
        `expected ${SHEET.width_mm}×${SHEET.height_mm}mm ±${tol}mm — refusing to render`
      );
    }

    // Text-fit guard: a silently clipped Bengali sentence is worse than a
    // failed build. Overflow is a JSON/layout fix — never auto-shrink text.
    const overflows = await page.evaluate(() => {
      const bad = [];
      for (const pg of document.querySelectorAll('.sb-page')) {
        // page box catches gross overflow; the lesson box catches content
        // bleeding into the bottom margin (padding hides it from the page box)
        const lesson = pg.querySelector('[data-lesson]');
        const pageOver = pg.scrollHeight - pg.clientHeight;
        const lessonOver = lesson ? lesson.scrollHeight - lesson.clientHeight : 0;
        if (Math.max(pageOver, lessonOver) > 2) {
          bad.push((lesson && lesson.getAttribute('data-lesson')) || '?');
        }
      }
      return bad;
    });
    if (overflows.length) {
      throw new Error(
        `fit guard: content overflows its page in lesson(s) ${overflows.join(', ')} — ` +
        `fix the JSON/layout (split rows across pages); do not shrink text`
      );
    }

    fs.mkdirSync(outDir, { recursive: true });
    await page.pdf({
      path: outPath,
      width: '210mm', height: '297mm',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }, // margins live in .sb-page padding
      preferCSSPageSize: true,
      timeout: 300000,
    });

    // A renderer that dies mid-write leaves a truncated PDF on disk that still
    // looks like a build artefact. Require the EOF marker before trusting it.
    const tailBuf = Buffer.alloc(1024);
    const fd = fs.openSync(outPath, 'r');
    const size = fs.fstatSync(fd).size;
    fs.readSync(fd, tailBuf, 0, Math.min(1024, size), Math.max(0, size - 1024));
    fs.closeSync(fd);
    if (!tailBuf.toString('latin1').includes('%%EOF')) {
      throw new Error(`${outPath} is truncated (no %%EOF) — the renderer died mid-write`);
    }

    // Post-render font audit: every embedded face on the four-Noto allowlist.
    const audit = auditPdfFonts(outPath);
    if (!audit.ok) {
      throw new Error(`font audit failed for ${outPath}:\n  ${audit.problems.join('\n  ')}`);
    }

    fs.unlinkSync(tmpHtml); // keep the temp HTML on failure for debugging
    return { profileId, outPath, fonts: audit.fonts.map(f => f.name) };
  } finally {
    await page.close();
  }
}

/* ---------- main ---------- */
async function main() {
  const args = parseArgs(process.argv);
  const bookPath = path.resolve(args.book);
  const imagesDir = path.resolve(args.images);
  const bookDir = path.dirname(bookPath);

  if (!fs.existsSync(imagesDir)) throw new Error(`images dir not found: ${imagesDir}`);
  const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));
  if (!book.book_id) throw new Error('book.json has no book_id');

  const outDir = path.join(path.resolve(args.out), book.book_id);
  const fontCss = getFontCss(); // throws on any missing TTF — no OS fallback

  const puppeteer = require('puppeteer');
  const failures = [];
  // One browser PER PROFILE. Sharing it meant a renderer crash in the first
  // edition left the second with a dead connection, failing both; a fresh
  // process also keeps peak memory to one book's worth of decoded images.
  for (const profileId of ALWAYS_RENDER) {
    const browser = await puppeteer.launch({
      args: ['--font-render-hinting=none', '--disable-lcd-text', '--no-sandbox',
        '--disable-dev-shm-usage'],
      protocolTimeout: 600000,
    });
    try {
      const res = await renderProfile(browser, book, profileId, { bookDir, imagesDir, outDir, fontCss });
      console.log(`[${profileId}] OK → ${res.outPath}`);
      console.log(`[${profileId}] embedded fonts: ${res.fonts.join(', ')}`);
    } catch (err) {
      failures.push({ profileId, message: err.message });
      console.error(`[${profileId}] FAIL: ${err.message}`);
    } finally {
      await browser.close().catch(() => {}); // a crashed browser cannot close cleanly
    }
  }

  if (failures.length) {
    console.error(`\nBUILD FAILED — ${failures.length} of ${ALWAYS_RENDER.length} profile(s) failed.`);
    process.exit(1);
  }
  console.log(`\nBUILD OK — both editions rendered and audited for ${book.book_id}.`);
}

main().catch(err => {
  console.error(`BUILD FAILED: ${err.message}`);
  process.exit(1);
});
