'use strict';
/**
 * font-audit.js — post-render embedded-font audit (standalone, D-020).
 *
 * Last line of defense against Chrome silently substituting an OS face
 * (Nirmala UI / Segoe) for a Bengali glyph. Shells out to `pdffonts`
 * (poppler, on PATH) and requires that EVERY font listed in the PDF is
 *   (a) embedded (emb = yes), and
 *   (b) one of the four Noto faces on the allowlist.
 * Any other face, or any non-embedded face, fails the build.
 */

const { spawnSync } = require('child_process');
const path = require('path');

// Subset-tagged PostScript names look like "ABCDEF+NotoSerifBengali-Bold".
// After stripping the subset tag, the base name must match one of these.
const ALLOWED_BASE = /^NotoSerif(Bengali)?(-(Regular|Bold))?$/;

function stripSubsetTag(name) {
  return name.replace(/^[A-Z]{6}\+/, '');
}

/**
 * Audit one PDF. Returns { ok, fonts: [{name, emb, ok, reason}], problems: [] }.
 * Throws only if pdffonts itself cannot be run.
 */
function auditPdfFonts(pdfPath) {
  const res = spawnSync('pdffonts', [pdfPath], { encoding: 'utf8' });
  if (res.error) {
    throw new Error(`font-audit: failed to run pdffonts (poppler must be on PATH): ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`font-audit: pdffonts exited ${res.status} for ${pdfPath}: ${res.stderr || res.stdout}`);
  }

  const lines = res.stdout.split(/\r?\n/);
  const headerIdx = lines.findIndex(l => /^name\s+type\s/.test(l));
  if (headerIdx === -1) {
    throw new Error(`font-audit: unexpected pdffonts output for ${pdfPath}:\n${res.stdout}`);
  }
  const header = lines[headerIdx];
  const typeCol = header.indexOf('type');
  const embCol = header.indexOf('emb');

  const fonts = [];
  const problems = [];
  for (const line of lines.slice(headerIdx + 2)) {
    if (!line.trim()) continue;
    const name = line.slice(0, typeCol).trim();
    const emb = line.slice(embCol, embCol + 3).trim();
    const base = stripSubsetTag(name);

    let ok = true, reason = '';
    if (emb !== 'yes') {
      ok = false; reason = `not embedded (emb=${emb || '?'}) — OS substitution`;
    } else if (name === '[none]' || !ALLOWED_BASE.test(base)) {
      ok = false; reason = `face "${name}" is not on the four-Noto allowlist`;
    }
    fonts.push({ name, emb, ok, reason });
    if (!ok) problems.push(`${name}: ${reason}`);
  }

  if (fonts.length === 0) {
    problems.push('no fonts listed in PDF — text layer missing or render failed');
  }

  return { ok: problems.length === 0, fonts, problems, pdf: path.basename(pdfPath) };
}

module.exports = { auditPdfFonts, ALLOWED_BASE };
