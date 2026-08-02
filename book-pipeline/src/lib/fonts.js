'use strict';
/**
 * fonts.js — four-face base64 font loader (standalone, D-020).
 *
 * The single correctness anchor for Bengali text: exactly four TTFs, each
 * base64-inlined into an @font-face rule so যুক্তবর্ণ/কারচিহ্ন render
 * identically on any machine. A missing TTF THROWS — never fall back to an
 * OS font (that is how tofu / Nirmala UI substitution sneaks into a PDF).
 */

const fs = require('fs');
const path = require('path');

const FONTS_DIR = path.join(__dirname, '..', '..', 'fonts');

// family/weight must match what compose.js references in its CSS.
const FACES = [
  { file: 'NotoSerifBengali-Regular.ttf', family: 'NotoSerifBengali', weight: 400 },
  { file: 'NotoSerifBengali-Bold.ttf',    family: 'NotoSerifBengali', weight: 700 },
  { file: 'NotoSerif-Regular.ttf',        family: 'NotoSerif',        weight: 400 },
  { file: 'NotoSerif-Bold.ttf',           family: 'NotoSerif',        weight: 700 },
];

/**
 * Returns a CSS string of four @font-face rules with base64-inlined TTF data.
 * Throws if any of the four files is missing or empty.
 */
function getFontCss(fontsDir = FONTS_DIR) {
  const rules = [];
  for (const face of FACES) {
    const p = path.join(fontsDir, face.file);
    if (!fs.existsSync(p)) {
      throw new Error(`fonts: required TTF missing: ${p} — refusing to build (no OS fallback allowed)`);
    }
    const buf = fs.readFileSync(p);
    if (!buf.length) {
      throw new Error(`fonts: required TTF is empty: ${p}`);
    }
    rules.push(
      `@font-face { font-family: "${face.family}"; font-weight: ${face.weight}; font-style: normal; ` +
      `src: url(data:font/ttf;base64,${buf.toString('base64')}) format('truetype'); }`
    );
  }
  return rules.join('\n');
}

module.exports = { getFontCss, FACES, FONTS_DIR };
