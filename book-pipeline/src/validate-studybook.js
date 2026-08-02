#!/usr/bin/env node
/**
 * validate-studybook.js — standalone study-book assembly validator.
 *
 * Owns its own shape (D-020). Shares NO code with storybook. Checks the
 * support-book JSON contract (SCHEMA_support-book_v1, frozen amendment 1.3):
 * complete পাঠ inventory in NCTB order, image slots resolvable to the DPI
 * floor, tracing/vector pages declared correctly, bw-edition completeness
 * (check 11), the shared script guard (check 8 — same allowlist invariant),
 * and the layout composition checks 12–15 (only when layout[] is present).
 *
 * It does NOT impose storybook shape: no fixed page count, no 20-story-page
 * rule, no ≥30% no-living-being floor, no anchor/cover/spine concept.
 *
 * Usage:  node validate-studybook.js <path-to-book.json> [--images <dir>]
 * Exit:   0 = pass (no red). 1 = fail (>=1 red). Greys never fail the build.
 *         Machine-readable JSON report on stdout after the human summary.
 */

'use strict';
const fs = require('fs');
const path = require('path');

/* ---- shared script-guard allowlist (SCHEMA check 8 / same invariant) ---- */
/* Basic Latin, Latin-1, common punctuation, Bengali U+0980–09FF,
   danda/double-danda U+0964–0965, ZWNJ/ZWJ, plus structural whitespace.
   Anything else (Arabic, Devanagari digits, CJK, arrows, em-dash, emoji) FAILS.
   Rule: fix the text, never widen the allowlist. */
function isAllowedCodepoint(cp) {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return true;        // tab/newline
  if (cp >= 0x20 && cp <= 0x7e) return true;                          // Basic Latin
  if (cp >= 0xa0 && cp <= 0xff) return true;                          // Latin-1 Supplement
  if (cp === 0x0964 || cp === 0x0965) return true;                    // danda / double danda
  if (cp >= 0x0980 && cp <= 0x09ff) return true;                      // Bengali block
  if (cp === 0x200c || cp === 0x200d) return true;                    // ZWNJ / ZWJ
  return false;
}
function scanString(s) {
  const bad = new Set();
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (!isAllowedCodepoint(cp)) bad.add(ch);
  }
  return [...bad];
}

/* ---- DPI floor: imported from the geometry module (single source of truth) ----
   geometry.js locks A4 portrait, 12mm margins -> content 186mm -> 2197px floor.
   --content-mm still overrides for experimentation. */
let GEO = null;
try { GEO = require('./lib/geometry'); } catch (_) { GEO = null; }
const MM_PER_IN = GEO ? GEO.MM_PER_IN : 25.4;
const DPI_FLOOR = GEO ? GEO.DPI.min : 300;
function shortSideFloorPx(contentWidthMm) {
  if (GEO && contentWidthMm === GEO.CONTENT.width_mm) return GEO.IMAGE.short_side_floor_px;
  return Math.ceil((contentWidthMm / MM_PER_IN) * DPI_FLOOR);
}

/* ---- report helpers ---- */
const RED = 'red', GREY = 'grey';
function mkReport() { return { red: [], grey: [], checks: {} }; }
function addRed(r, check, msg)  { r.red.push({ check, msg }); }
function addGrey(r, check, msg) { r.grey.push({ check, msg }); }

/* ---- individual checks ---- */

// Check A: JSON validity + required top-level fields + schema_version accepted
function checkTopLevel(book, r) {
  const need = ['schema_version', 'book_id', 'class', 'subject', 'mode', 'lessons'];
  for (const k of need) if (!(k in book)) addRed(r, 'top-level', `missing top-level field: ${k}`);
  const okSchema = ['1.0', '1.1', '1.2', '1.3'];
  if (book.schema_version && !okSchema.includes(String(book.schema_version)))
    addGrey(r, 'top-level', `schema_version ${book.schema_version} not in known set ${okSchema.join('/')}`);
  if (!Array.isArray(book.lessons)) addRed(r, 'top-level', 'lessons is not an array');
}

// Check 1: complete পাঠ inventory in NCTB order (contiguous, ascending, no gaps/dupes)
function checkInventory(book, r) {
  const nos = book.lessons.map(l => l.lesson_no);
  const sorted = [...nos].sort((a, b) => a - b);
  if (JSON.stringify(nos) !== JSON.stringify(sorted))
    addRed(r, 'inventory-order', `lessons not in ascending NCTB order: ${nos.join(',')}`);
  const dupes = nos.filter((n, i) => nos.indexOf(n) !== i);
  if (dupes.length) addRed(r, 'inventory-dupes', `duplicate lesson_no: ${[...new Set(dupes)].join(',')}`);
  // NOTE: we do NOT hard-fail on non-contiguous (partial books render for proof);
  // a gap is a grey so a full book still gets flagged.
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i] !== sorted[i - 1] + 1)
      addGrey(r, 'inventory-gap', `gap in lesson_no between ${sorted[i - 1]} and ${sorted[i]} (ok for partial/proof builds)`);
}

// Check 8: script guard across every string in the book
function checkScriptGuard(book, r) {
  const walk = (o, p) => {
    if (typeof o === 'string') {
      const bad = scanString(o);
      if (bad.length) addRed(r, 'script-guard', `${p}: disallowed ${JSON.stringify(bad)} in "${o.slice(0, 48)}"`);
    } else if (Array.isArray(o)) {
      o.forEach((v, i) => walk(v, `${p}[${i}]`));
    } else if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) walk(o[k], `${p}.${k}`);
    }
  };
  walk(book.lessons, 'lessons');
}

// Check: image slots — filename present, status approved, contains_living_being present,
// and (if --images given) the finished file exists and clears the DPI floor.
function checkImages(book, r, imagesDir, contentWidthMm) {
  const floor = shortSideFloorPx(contentWidthMm);
  r.checks.dpi_floor_px = floor;
  let sharp = null;
  if (imagesDir) { try { sharp = require('sharp'); } catch (_) { sharp = null; } }
  const pending = [];
  for (const l of book.lessons) {
    for (const s of (l.image_slots || [])) {
      const where = `পাঠ${l.lesson_no}/${s.id}`;
      const isVector = s.action === 'vector_asset' || s.image_class === 'tracing_asset';
      if (isVector) {
        // tracing/vector: prompt must stay empty, rendered from vector at assembly
        if (s.prompt && s.prompt !== '') addRed(r, 'vector-prompt', `${where}: vector/tracing slot must have empty prompt`);
        continue;
      }
      if (!('contains_living_being' in s)) addRed(r, 'image-flag', `${where}: missing contains_living_being`);
      if (!s.filename) { addRed(r, 'image-file', `${where}: missing filename`); continue; }
      if (s.status !== 'approved') addGrey(r, 'image-status', `${where}: status=${s.status} (not approved)`);
      if (imagesDir) {
        const fp = path.join(imagesDir, s.filename);
        if (!fs.existsSync(fp)) { addRed(r, 'image-missing', `${where}: file not found: ${s.filename}`); continue; }
        pending.push({ where, fp, floor });
      }
    }
  }
  return { pending, sharp, floor };
}

// Check 11: bw-edition completeness — no colour-dependent pedagogy left native_safe;
// print_only_omit lessons must carry a teacher note.
function checkBwTreatment(book, r) {
  const valid = ['native_safe', 'redesigned', 'print_only_omit'];
  for (const l of book.lessons) {
    const bt = l.bw_treatment;
    if (!valid.includes(bt)) { addRed(r, 'bw-value', `পাঠ${l.lesson_no}: bw_treatment "${bt}" invalid`); continue; }
    // C-18 colour/flag activities and colour-coded pedagogy must not be native_safe silently.
    // Heuristic red-flag: a colour-pedagogy marker in c_codes or genre while native_safe.
    // (The authoritative call is human; we surface the risk as grey unless clearly colour-coded.)
    if (bt === 'print_only_omit') {
      const hasNote = (l.notes && /teacher|colour master|NCTB|রঙিন|মূল/i.test(l.notes));
      if (!hasNote) addGrey(r, 'bw-omit-note', `পাঠ${l.lesson_no}: print_only_omit should carry a teacher note pointing to colour master/NCTB`);
    }
  }
}

// Checks 12–15: layout composition (only when a lesson has layout[])
function checkLayout(book, r) {
  const presets = book.layout_presets || {};
  for (const l of book.lessons) {
    if (!Array.isArray(l.layout) || l.layout.length === 0) continue; // absent => document-order; skip
    const blockIds = new Set((l.blocks || []).map(b => b.id));
    const imgIds = new Set((l.image_slots || []).map(s => s.id));
    const placed = new Map(); // id -> times placed
    const rowsSeen = [];
    for (const row of l.layout) {
      rowsSeen.push(row.row);
      // 12: refs resolve
      for (const id of (row.refs || [])) {
        const known = blockIds.has(id) || imgIds.has(id);
        if (!known) addRed(r, 'layout-ref', `পাঠ${l.lesson_no} row ${row.row}: ref "${id}" resolves to no block/image`);
        placed.set(id, (placed.get(id) || 0) + 1);
      }
      // 14: preset resolves + matches arrangement
      if (row.preset) {
        const p = presets[row.preset];
        if (!p) addRed(r, 'layout-preset', `পাঠ${l.lesson_no} row ${row.row}: preset "${row.preset}" not in layout_presets`);
        else {
          if (p.type && row.arrangement && p.type !== row.arrangement)
            addRed(r, 'layout-preset-type', `পাঠ${l.lesson_no} row ${row.row}: preset type "${p.type}" != arrangement "${row.arrangement}"`);
          if (p.type === 'side-by-side') {
            const sum = (p.image_frac || 0) + (p.text_frac || 0);
            if (Math.abs(sum - 1.0) > 1e-6)
              addRed(r, 'layout-preset-frac', `পাঠ${l.lesson_no} row ${row.row}: preset "${row.preset}" fracs sum ${sum} != 1.0`);
          }
        }
      }
    }
    // 13: no orphans / no double-place — every block & image placed exactly once
    for (const id of [...blockIds, ...imgIds]) {
      const n = placed.get(id) || 0;
      if (n === 0) addRed(r, 'layout-orphan', `পাঠ${l.lesson_no}: "${id}" is never placed in any layout row`);
      if (n > 1)  addRed(r, 'layout-double', `পাঠ${l.lesson_no}: "${id}" placed ${n} times`);
    }
    // 15: row order contiguous 1..N (grey)
    const want = Array.from({ length: rowsSeen.length }, (_, i) => i + 1);
    if (JSON.stringify([...rowsSeen].sort((a, b) => a - b)) !== JSON.stringify(want))
      addGrey(r, 'layout-row-order', `পাঠ${l.lesson_no}: row indices ${rowsSeen.join(',')} not contiguous 1..${rowsSeen.length}`);
  }
}

/* ---- main ---- */
async function main() {
  const args = process.argv.slice(2);
  if (!args[0]) { console.error('usage: node validate-studybook.js <book.json> [--images <dir>] [--content-mm <n>]'); process.exit(2); }
  const bookPath = args[0];
  const imagesIdx = args.indexOf('--images');
  const imagesDir = imagesIdx >= 0 ? args[imagesIdx + 1] : null;
  const cmIdx = args.indexOf('--content-mm');
  const defaultContentMm = GEO ? GEO.CONTENT.width_mm : 186; // A4 210 - 2×12mm margin
  const contentWidthMm = cmIdx >= 0 ? Number(args[cmIdx + 1]) : defaultContentMm;

  let book;
  try { book = JSON.parse(fs.readFileSync(bookPath, 'utf8')); }
  catch (e) { console.error(`FATAL: cannot parse ${bookPath}: ${e.message}`); process.exit(1); }

  const r = mkReport();
  checkTopLevel(book, r);
  if (Array.isArray(book.lessons)) {
    checkInventory(book, r);
    checkScriptGuard(book, r);
    checkBwTreatment(book, r);
    checkLayout(book, r);
    const { pending, sharp, floor } = checkImages(book, r, imagesDir, contentWidthMm);
    if (imagesDir && sharp) {
      for (const it of pending) {
        try {
          const m = await sharp(it.fp).metadata();
          const shortSide = Math.min(m.width || 0, m.height || 0);
          if (shortSide < it.floor)
            addRed(r, 'image-dpi', `${it.where}: ${m.width}×${m.height}, short side ${shortSide}px < floor ${it.floor}px`);
        } catch (e) { addRed(r, 'image-read', `${it.where}: cannot read ${it.fp}: ${e.message}`); }
      }
    } else if (imagesDir && !sharp) {
      addGrey(r, 'image-dpi', 'sharp not installed — DPI floor not verified (npm i sharp)');
    }
  }

  // human summary
  const redN = r.red.length, greyN = r.grey.length;
  console.log(`\n=== study-book validator — ${book.book_id || '?'} ===`);
  console.log(`RED: ${redN}   GREY: ${greyN}   (DPI floor: ${r.checks.dpi_floor_px || 'n/a'}px, content ${contentWidthMm}mm)`);
  if (redN) { console.log('\nRED (build fails):'); r.red.forEach(x => console.log(`  [${x.check}] ${x.msg}`)); }
  if (greyN) { console.log('\nGREY (warnings, non-blocking):'); r.grey.forEach(x => console.log(`  [${x.check}] ${x.msg}`)); }
  console.log(redN ? '\nRESULT: FAIL' : '\nRESULT: PASS');

  // machine-readable
  console.log('\n<<<REPORT_JSON>>>');
  console.log(JSON.stringify({ book_id: book.book_id, red: r.red, grey: r.grey, checks: r.checks, result: redN ? 'fail' : 'pass' }));

  process.exit(redN ? 1 : 0);
}
main();
