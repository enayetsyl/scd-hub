#!/usr/bin/env node
'use strict';
/**
 * layout-store.js — keep layout work safe from content replacements (D-020).
 *
 * book.json mixes CONTENT (text, blocks, image slots — owned by the content
 * pipeline, replaced wholesale from time to time) with LAYOUT (layout[],
 * layout_presets, trace specs, bubble positions…) built here. Dropping in a
 * fresh book.json therefore wipes every layout decision.
 *
 * This tool stores layout separately in layout.json (next to book.json) and
 * re-attaches it afterwards:
 *
 *   node src/tools/layout-store.js save  <book.json>   # after layout work
 *   node src/tools/layout-store.js apply <book.json>   # after a content drop
 *
 * `apply` also performs the two repairs a fresh content drop always needs:
 *   1. fill image_slots[].filename from the slot id when the file exists
 *   2. sanitize stray characters in METADATA fields (notes/scene_description/
 *      compliance_note/prompt/source_note) — never lesson text, which stays
 *      the content owner's to fix
 */

const fs = require('fs');
const path = require('path');

const LESSON_KEYS = ['layout', 'spread', 'gap_mm'];
const BLOCK_KEYS = ['bubble_pos', 'kar_solo', 'hi_words', 'hi_letters'];
const SLOT_KEYS = ['trace'];

function overlayPathFor(bookPath) {
  return path.join(path.dirname(bookPath), 'layout.json');
}

/** Cheap signature of a block's text, used to detect re-authored content. */
function textSig(text) {
  const s = String(text == null ? '' : text);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${s.length}:${h.toString(36)}`;
}

/* ---------- save ---------- */
function extract(book) {
  const out = { layout_presets: book.layout_presets || {}, lessons: {} };
  for (const l of book.lessons || []) {
    const entry = {};
    for (const k of LESSON_KEYS) if (l[k] !== undefined) entry[k] = l[k];
    const blocks = {};
    for (const b of l.blocks || []) {
      const e = {};
      for (const k of BLOCK_KEYS) if (b[k] !== undefined) e[k] = b[k];
      // layout_hint is presentation and we sometimes override it, so it is
      // worth restoring — but ONLY onto the same text. Content drops reuse
      // block ids for re-authored content, and a stale hint would silently
      // mis-render it, so pin the hint to a signature of the text.
      if (b.layout_hint !== undefined) {
        e.layout_hint = b.layout_hint;
        e.text_sig = textSig(b.text_bn);
      }
      if (Object.keys(e).length) blocks[b.id] = e;
    }
    const slots = {};
    for (const s of l.image_slots || []) {
      const e = {};
      for (const k of SLOT_KEYS) if (s[k] !== undefined) e[k] = s[k];
      if (Object.keys(e).length) slots[s.id] = e;
    }
    if (Object.keys(blocks).length) entry.blocks = blocks;
    if (Object.keys(slots).length) entry.image_slots = slots;
    if (Object.keys(entry).length) out.lessons[l.lesson_no] = entry;
  }
  return out;
}

/* ---------- apply helpers ---------- */
function fillFilenames(book, bookPath) {
  const imgDir = path.join(path.dirname(bookPath), 'images-compliant');
  if (!fs.existsSync(imgDir)) return { filled: 0, missing: [] };
  const byId = {};
  for (const f of fs.readdirSync(imgDir)) {
    const m = f.match(/^(L\d{3}-img-\d{2})/);
    if (m) byId[m[1]] = f;
  }
  let filled = 0; const missing = [];
  for (const l of book.lessons || []) {
    for (const s of l.image_slots || []) {
      if (s.filename) continue;
      if (s.action === 'vector_asset' || s.image_class === 'tracing_asset') continue;
      if (byId[s.id]) { s.filename = byId[s.id]; filled++; }
      else missing.push(`${l.lesson_no}/${s.id}`);
    }
  }
  return { filled, missing };
}

// stray characters that keep reappearing in drafting metadata
const SANITIZE = [
  [/[–—‑]/g, '-'],   // en/em dash, non-breaking hyphen
  [/…/g, '...'],               // ellipsis
  [/★\s?/g, ''],               // black star
  [/ṇ/g, 'n'],                 // ṇ
  [/ग/g, 'গ'],            // Devanagari ग -> Bengali গ
];
function sanitizeMeta(book) {
  let n = 0;
  const fix = (o, k) => {
    if (!o || typeof o[k] !== 'string') return;
    let v = o[k];
    for (const [re, rep] of SANITIZE) v = v.replace(re, rep);
    if (v !== o[k]) { o[k] = v; n++; }
  };
  for (const l of book.lessons || []) {
    fix(l, 'notes');
    for (const b of l.blocks || []) fix(b, 'source_note');
    for (const s of l.image_slots || []) {
      fix(s, 'scene_description'); fix(s, 'compliance_note'); fix(s, 'prompt');
    }
  }
  return n;
}

function applyOverlay(book, overlay) {
  book.layout_presets = overlay.layout_presets || {};
  let laid = 0, skipped = [], reauthored = [];
  for (const l of book.lessons || []) {
    const entry = overlay.lessons[l.lesson_no];
    if (!entry) continue;
    for (const b of l.blocks || []) {
      const e = (entry.blocks || {})[b.id];
      if (!e) continue;
      const { layout_hint, text_sig, ...rest } = e;
      Object.assign(b, rest);
      // only re-apply a saved hint if this block still holds the same text
      if (layout_hint !== undefined && text_sig === textSig(b.text_bn)) {
        b.layout_hint = layout_hint;
      } else if (layout_hint !== undefined) {
        reauthored.push(`${l.lesson_no}/${b.id}`);
      }
    }
    for (const s of l.image_slots || []) {
      const e = (entry.image_slots || {})[s.id];
      if (e) Object.assign(s, e);
    }
    if (entry.spread) l.spread = true;
    if (Array.isArray(entry.layout) && entry.layout.length) {
      // only adopt a layout whose refs all still exist AND that still places
      // every block/image — otherwise the content changed shape and the lesson
      // needs a fresh layout rather than a broken one
      const ids = new Set([...(l.blocks || []).map(b => b.id), ...(l.image_slots || []).map(s => s.id)]);
      const resolves = entry.layout.every(r => (r.refs || []).every(id => ids.has(id)));
      const placed = new Set(entry.layout.flatMap(r => r.refs || []));
      const complete = [...ids].every(id => placed.has(id));
      if (resolves && complete) { l.layout = entry.layout; laid++; }
      else skipped.push(l.lesson_no);
    }
  }
  return { laid, skipped, reauthored };
}

/* ---------- CLI ---------- */
function main() {
  const [cmd, bookArg] = process.argv.slice(2);
  if (!['save', 'apply'].includes(cmd) || !bookArg) {
    console.error('usage: node src/tools/layout-store.js <save|apply> <book.json>');
    process.exit(2);
  }
  const bookPath = path.resolve(bookArg);
  const overlayPath = overlayPathFor(bookPath);
  const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));

  if (cmd === 'save') {
    const overlay = extract(book);
    fs.writeFileSync(overlayPath, JSON.stringify(overlay, null, 2) + '\n', 'utf8');
    console.log(`saved layout for ${Object.keys(overlay.lessons).length} lesson(s) ` +
      `and ${Object.keys(overlay.layout_presets).length} preset(s) → ${overlayPath}`);
    return;
  }

  if (!fs.existsSync(overlayPath)) {
    console.error(`no layout store found at ${overlayPath} — run "save" first`);
    process.exit(1);
  }
  const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
  const names = fillFilenames(book, bookPath);
  const cleaned = sanitizeMeta(book);
  const res = applyOverlay(book, overlay);
  fs.writeFileSync(bookPath, JSON.stringify(book, null, 2) + '\n', 'utf8');

  console.log(`filenames filled: ${names.filled}`);
  if (names.missing.length) console.log(`  no image file for: ${names.missing.join(', ')}`);
  console.log(`metadata fields sanitized: ${cleaned}`);
  console.log(`layouts restored: ${res.laid}`);
  if (res.reauthored.length) {
    console.log(`  block(s) re-authored since save — kept the new hint: ${res.reauthored.join(', ')}`);
  }
  if (res.skipped.length) {
    console.log(`  lesson(s) whose content changed shape — need a fresh layout: ${res.skipped.join(', ')}`);
  }
}

module.exports = { extract, applyOverlay, fillFilenames, sanitizeMeta, overlayPathFor };
if (require.main === module) main();
