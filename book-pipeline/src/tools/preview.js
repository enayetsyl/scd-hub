#!/usr/bin/env node
'use strict';
/**
 * preview.js — live layout preview + micro-editor for book.json (D-020).
 *
 * Browser shows the composed book with overflow highlighted. Click a row to
 * open the inspector: change arrangement, image widths, page, overlay anchor,
 * or enter bubble-placement mode (click/drag labels into the artwork's drawn
 * speech bubbles). Every save is written back to book.json's layout[] /
 * layout_presets / bubble_pos ONLY — lesson text is never touched (the script
 * guard stays upstream), and the real gate remains validate + build-book.
 *
 * Edits create timestamped backups in .layout-backups/ next to book.json;
 * the toolbar Undo restores the most recent one.
 *
 * Usage:
 *   node src/tools/preview.js <path/to/book.json> --images <dir> [--port 4400]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const LIB_DIR = path.join(__dirname, '..', 'lib');
const CLIENT_JS = path.join(__dirname, 'preview-client.js');

/**
 * Require a sibling tool fresh from disk. The client is re-read on every
 * request, so editing a tool while the server runs left the two out of step —
 * the editor offered 24 strips while the cached module still enforced 9.
 */
function freshRequire(mod) {
  const id = require.resolve(mod);
  delete require.cache[id];
  return require(id);
}
const MAX_BACKUPS = 30;

function parseArgs(argv) {
  const args = { book: null, images: null, port: 4400 };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--images') args.images = rest[++i];
    else if (rest[i] === '--port') args.port = Number(rest[++i]);
    else if (!args.book) args.book = rest[i];
  }
  if (!args.book || !args.images) {
    console.error('usage: node src/tools/preview.js <book.json> --images <dir> [--port 4400]');
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv);
const bookPath = path.resolve(args.book);
const imagesDir = path.resolve(args.images);
const backupDir = path.join(path.dirname(bookPath), '.layout-backups');
// strip chain: images-upscaled (strip-free masters) → imagesDir (compliant)
const upscaledDir = path.join(path.dirname(imagesDir), 'images-upscaled');
const placementsPath = path.join(path.dirname(bookPath), 'placements.json');

/* ---------- book io ---------- */
function loadBook() { return JSON.parse(fs.readFileSync(bookPath, 'utf8')); }

// every edit (layout OR strips) snapshots BOTH book.json and placements.json
// under one timestamp, so toolbar Undo rolls back either kind of change
function backupAll() {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(bookPath, path.join(backupDir, `book-${stamp}.json`));
  const pl = fs.existsSync(placementsPath) ? fs.readFileSync(placementsPath, 'utf8') : '{}';
  fs.writeFileSync(path.join(backupDir, `placements-${stamp}.json`), pl, 'utf8');
  const old = fs.readdirSync(backupDir).filter(f => f.startsWith('book-')).sort();
  while (old.length > MAX_BACKUPS) {
    const b = old.shift();
    fs.unlinkSync(path.join(backupDir, b));
    const p = path.join(backupDir, b.replace(/^book-/, 'placements-'));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function saveBook(book) {
  backupAll();
  fs.writeFileSync(bookPath, JSON.stringify(book, null, 2) + '\n', 'utf8');
  // keep layout.json current so a content drop never loses layout work
  try {
    const { extract, overlayPathFor } = require('./layout-store');
    fs.writeFileSync(overlayPathFor(bookPath), JSON.stringify(extract(book), null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error(`warning: could not update layout store: ${err.message}`);
  }
}

/** Restore book.json + placements.json from the latest backup pair.
 *  Returns the restored placements (object) or null if nothing to undo. */
function undoAll() {
  if (!fs.existsSync(backupDir)) return null;
  const backups = fs.readdirSync(backupDir).filter(f => f.startsWith('book-')).sort();
  if (!backups.length) return null;
  const latest = backups.pop();
  fs.copyFileSync(path.join(backupDir, latest), bookPath);
  fs.unlinkSync(path.join(backupDir, latest));
  const plBak = path.join(backupDir, latest.replace(/^book-/, 'placements-'));
  let placements = null;
  if (fs.existsSync(plBak)) {
    fs.copyFileSync(plBak, placementsPath);
    fs.unlinkSync(plBak);
    placements = JSON.parse(fs.readFileSync(placementsPath, 'utf8'));
  }
  return { placements };
}

/* ---------- edit operations (layout[], layout_presets, bubble_pos only) ---------- */
const PRESET_FIELDS = {
  'text-only':        ['width_frac'],
  'image-only':       ['image_frac'],
  'image-above-text': ['image_frac'],
  'side-by-side':     ['image_frac', 'text_frac', 'gutter_mm', 'valign', 'img_cols', 'image_side'],
  'image-text-image': ['left_frac', 'text_frac', 'right_frac', 'gutter_mm', 'valign', 'split'],
  'text-in-image':    ['anchor', 'max_width_frac', 'pad_mm', 'image_frac', 'bubble_style', 'split', 'gutter_mm'],
};

function findRow(book, lessonNo, rowNo) {
  const lesson = book.lessons.find(l => l.lesson_no === Number(lessonNo));
  if (!lesson) throw new Error(`no lesson ${lessonNo}`);
  const row = (lesson.layout || []).find(r => r.row === Number(rowNo));
  if (!row) throw new Error(`lesson ${lessonNo} has no layout row ${rowNo}`);
  return { lesson, row };
}

function applyRowEdit(body) {
  const book = loadBook();
  const { lesson, row } = findRow(book, body.lesson, body.row);

  if (body.arrangement) row.arrangement = String(body.arrangement);
  if ('page' in body) {
    const p = Number(body.page) || 1;
    if (p <= 1) delete row.page; else row.page = p;
  }

  const fields = PRESET_FIELDS[row.arrangement];
  if (!fields) {
    delete row.preset; // text-only / image-only take no preset
  } else if (body.preset && typeof body.preset === 'object') {
    // write a NAMED preset (validator check 14 requires names, not inline objects)
    const name = (row.preset && String(row.preset).startsWith('custom-'))
      ? row.preset : `custom-l${lesson.lesson_no}-r${row.row}`;
    const p = { type: row.arrangement };
    for (const f of fields) if (f in body.preset) p[f] = body.preset[f];
    // keep frac sums exactly 1.0 (validator check 14 for side-by-side)
    if (row.arrangement === 'side-by-side') {
      p.image_frac = +(Number(p.image_frac) || 0.5).toFixed(3);
      p.text_frac = +(1 - p.image_frac).toFixed(3);
    }
    if (row.arrangement === 'image-text-image') {
      p.left_frac = +(Number(p.left_frac) || 0.3).toFixed(3);
      p.right_frac = +(Number(p.right_frac) || 0.3).toFixed(3);
      p.text_frac = +(1 - p.left_frac - p.right_frac).toFixed(3);
      if (!p.split) delete p.split;
    }
    book.layout_presets = book.layout_presets || {};
    book.layout_presets[name] = p;
    row.preset = name;
  } else if (row.preset && book.layout_presets && book.layout_presets[row.preset]) {
    // arrangement changed but preset kept: keep type in sync when it's a custom
    // preset; shared presets with a now-mismatched type must be re-chosen
    const p = book.layout_presets[row.preset];
    if (p.type !== row.arrangement) {
      if (String(row.preset).startsWith('custom-')) p.type = row.arrangement;
      else delete row.preset;
    }
  }
  saveBook(book);
}

function applyBubbleEdit(body) {
  const book = loadBook();
  const lesson = book.lessons.find(l => l.lesson_no === Number(body.lesson));
  if (!lesson) throw new Error(`no lesson ${body.lesson}`);
  const block = (lesson.blocks || []).find(b => b.id === body.blockId);
  if (!block) throw new Error(`no block ${body.blockId}`);
  if (block.layout_hint !== 'speech-bubbles') throw new Error(`${body.blockId} is not a speech-bubbles block`);
  block.bubble_pos = (body.positions || []).map(p =>
    (p && typeof p.x === 'number' && typeof p.y === 'number')
      ? { x: +p.x.toFixed(4), y: +p.y.toFixed(4) } : null);
  saveBook(book);
}

function rowInfo(lessonNo, rowNo) {
  const book = loadBook();
  const { lesson, row } = findRow(book, lessonNo, rowNo);
  const presets = book.layout_presets || {};
  const slotById = new Map((lesson.image_slots || []).map(s => [s.id, s]));
  const images = new Set(slotById.keys());
  const textBlocks = (row.refs || []).filter(id => !images.has(id)).map(id => {
    const b = (lesson.blocks || []).find(x => x.id === id) || {};
    return {
      id,
      hint: b.layout_hint || '',
      lines: String(b.text_bn || '').split('\n').filter(Boolean),
      bubble_pos: b.bubble_pos || null,
    };
  });
  return {
    lesson: lesson.lesson_no, row: row.row,
    arrangement: row.arrangement, page: row.page || 1,
    presetName: row.preset || null,
    preset: (row.preset && presets[row.preset]) || {},
    imageRefs: (row.refs || []).filter(id => images.has(id))
      .map(id => ({ id, filename: slotById.get(id).filename || null })),
    textBlocks,
    arrangements: ['text-only', 'image-only', 'image-above-text', 'side-by-side', 'text-in-image', 'image-text-image'],
  };
}

/* ---------- composing ---------- */
function freshLib() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(LIB_DIR)) delete require.cache[key];
  }
  return {
    compose: require(path.join(LIB_DIR, 'compose.js')),
    fonts: require(path.join(LIB_DIR, 'fonts.js')),
  };
}

function latestMtime() {
  let t = fs.statSync(bookPath).mtimeMs;
  for (const f of fs.readdirSync(LIB_DIR)) {
    t = Math.max(t, fs.statSync(path.join(LIB_DIR, f)).mtimeMs);
  }
  return Math.round(t);
}

/* ---------- http ---------- */
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/mtime') return json(res, 200, { mtime: latestMtime() });

    if (url.pathname === '/editor.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return res.end(fs.readFileSync(CLIENT_JS, 'utf8'));
    }
    if (url.pathname === '/api/rowinfo') {
      return json(res, 200, rowInfo(url.searchParams.get('lesson'), url.searchParams.get('row')));
    }
    if (req.method === 'POST' && url.pathname === '/api/row') {
      applyRowEdit(await readBody(req));
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/bubbles') {
      applyBubbleEdit(await readBody(req));
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/undo') {
      const restored = undoAll();
      if (!restored) return json(res, 200, { ok: false });
      // resync images with the restored placements so an undone strip
      // actually disappears from images-compliant
      if (restored.placements !== null && fs.existsSync(upscaledDir)) {
        const { applyAll } = freshRequire('./apply-strips');
        await applyAll(upscaledDir, imagesDir, restored.placements, null);
      }
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/strips') {
      const placements = fs.existsSync(placementsPath) ? JSON.parse(fs.readFileSync(placementsPath, 'utf8')) : {};
      if (req.method === 'POST') {
        const body = await readBody(req);
        backupAll();
        placements[body.file] = (body.strips || []).filter(s => s && typeof s.x === 'number');
        if (!placements[body.file].length) delete placements[body.file];
        fs.writeFileSync(placementsPath, JSON.stringify(placements, null, 2) + '\n', 'utf8');
        return json(res, 200, { ok: true });
      }
      return json(res, 200, { strips: placements[url.searchParams.get('file')] || [] });
    }
    if (req.method === 'POST' && url.pathname === '/api/strips/apply') {
      const body = await readBody(req);
      const { applyAll, loadPlacements } = freshRequire('./apply-strips');
      if (!fs.existsSync(upscaledDir)) {
        return json(res, 400, { error: `strip-free masters missing: ${upscaledDir} — run the upscale step with --out ${upscaledDir} first` });
      }
      const report = await applyAll(upscaledDir, imagesDir, loadPlacements(placementsPath), body.file || null);
      return json(res, 200, { ok: true, report });
    }
    if (req.method === 'POST' && url.pathname === '/api/validate') {
      const validator = path.join(__dirname, '..', 'validate-studybook.js');
      const vArgs = [validator, bookPath, '--images', imagesDir];
      let r = spawnSync(process.execPath, vArgs, { encoding: 'utf8', timeout: 120000 });
      if (r.error) r = spawnSync('node', vArgs, { encoding: 'utf8', timeout: 120000, shell: true });
      const out = (r.stdout || '');
      const marker = out.indexOf('<<<REPORT_JSON>>>');
      if (marker === -1) return json(res, 200, { result: 'error', error: (r.stderr || out).slice(0, 2000) });
      const report = JSON.parse(out.slice(marker + '<<<REPORT_JSON>>>'.length));
      // strips completeness vs contains_living_being flags (grey, not red:
      // a redraw-path book legitimately ships living-being art without strips)
      try {
        const placements = fs.existsSync(placementsPath) ? JSON.parse(fs.readFileSync(placementsPath, 'utf8')) : {};
        const book = loadBook();
        for (const lesson of book.lessons) {
          for (const slot of (lesson.image_slots || [])) {
            if (!slot.filename) continue;
            const n = (placements[slot.filename] || []).length;
            if (slot.contains_living_being === true && n === 0) {
              report.grey.push({ check: 'strips', msg: `পাঠ${lesson.lesson_no}/${slot.id}: living-being image has no strip (ok only if redraw-path per its compliance_note)` });
            }
            if (slot.contains_living_being === false && n > 0) {
              report.grey.push({ check: 'strips', msg: `পাঠ${lesson.lesson_no}/${slot.id}: object-only image has ${n} strip(s) — should have none` });
            }
          }
        }
      } catch (_) { /* strips check is advisory; never break validation */ }
      return json(res, 200, report);
    }
    if (url.pathname.startsWith('/images/')) {
      const file = path.join(imagesDir, path.basename(url.pathname));
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store', // strips edit images in place — never cache
      });
      return res.end(fs.readFileSync(file));
    }
    if (url.pathname === '/') {
      const profileId = url.searchParams.get('profile') || 'print-colour';
      const { compose, fonts } = freshLib();
      let html = compose.composeBook(loadBook(), profileId, {
        imagesRel: '/images',
        fontCss: fonts.getFontCss(),
      });
      html = html.replace('</body>', '<script src="/editor.js"></script></body>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    res.writeHead(404); res.end('not found');
  } catch (err) {
    if (url.pathname.startsWith('/api/')) return json(res, 400, { error: err.message });
    // e.g. book.json saved mid-edit and momentarily invalid — show error, keep polling
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<pre style="color:#c00;font:14px monospace;padding:2em">preview error:\n${
      String(err.message).replace(/</g, '&lt;')}\n\nfix and save — this page reloads automatically.</pre>` +
      '<script src="/editor.js"></script>');
  }
});

server.listen(args.port, () => {
  console.log(`studybook preview/editor: http://localhost:${args.port}/`);
  console.log(`  book:    ${bookPath}`);
  console.log(`  images:  ${imagesDir}`);
  console.log(`  backups: ${backupDir}`);
  console.log('Click a row to edit its layout; changes save to book.json (Undo in the toolbar).');
});
