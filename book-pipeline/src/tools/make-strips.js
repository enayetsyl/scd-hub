#!/usr/bin/env node
'use strict';
/**
 * make-strips.js — generate reusable white partition-strip assets
 * (standalone, D-020: own sharp/JS port of the storybook's make_strips.py;
 * same visual recipe, no code shared).
 *
 * Four variants of a thin vertical warm-white band with irregular
 * torn-paper edges, softened, alpha-tapered top/bottom, and a faint
 * paper-grain texture, on transparent background. Generate once into
 * strips/; apply-strips.js composites them forever after.
 *
 * Usage: node src/tools/make-strips.js [--height 2500] [--out strips]
 */

const fs = require('fs');
const path = require('path');

const VARIANTS = [
  { name: 'strip-a', width_frac: 0.006, rough: 3, seed: 11 },
  { name: 'strip-b', width_frac: 0.009, rough: 4, seed: 42 },
  { name: 'strip-c', width_frac: 0.005, rough: 2, seed: 77 },
  { name: 'strip-d', width_frac: 0.011, rough: 5, seed: 123 },
];
const WHITE = [255, 253, 250];       // warm white
const GRAIN = [180, 172, 160];       // paper-grain tint
const TEXTURE_OPACITY = 14;          // 0-255 cap, very subtle
const EDGE_SOFTNESS = 0.6;           // gaussian sigma on the mask
const DEFAULT_STRIPS_DIR = path.join(__dirname, '..', '..', 'strips');

// deterministic PRNG (mulberry32) — reproducible assets per seed
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const uniform = (r, lo, hi) => lo + r() * (hi - lo);

// smooth per-row horizontal offsets for one torn edge
function tornEdgeOffsets(height, rough, seed, points = 60) {
  const r = rng(seed);
  const ctrl = Array.from({ length: points }, () => uniform(r, -rough, rough));
  const seg = height / (points - 1);
  const out = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const i = Math.min(Math.floor(y / seg), points - 2);
    let t = (y - i * seg) / seg;
    t = (1 - Math.cos(t * Math.PI)) / 2;
    out[y] = ctrl[i] * (1 - t) + ctrl[i + 1] * t + uniform(r, -0.8, 0.8);
  }
  return out;
}

async function makeStrip(sharp, height, widthFrac, rough, seed) {
  const width = Math.round(height * widthFrac);
  const pad = rough + 8;
  const W = width + pad * 2;

  // opaque mask with two independent torn edges
  let mask = Buffer.alloc(W * height, 0);
  const left = tornEdgeOffsets(height, rough, seed);
  const right = tornEdgeOffsets(height, rough, seed + 1000);
  for (let y = 0; y < height; y++) {
    const x0 = Math.max(0, Math.round(pad + left[y]));
    const x1 = Math.min(W - 1, Math.round(pad + width + right[y]));
    mask.fill(255, y * W + x0, y * W + x1 + 1);
  }
  {
    // force single-channel output — sharp otherwise promotes raw grey to RGB,
    // which would scramble the alpha lookup below
    const { data, info } = await sharp(mask, { raw: { width: W, height, channels: 1 } })
      .blur(EDGE_SOFTNESS).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 1) throw new Error(`mask blur returned ${info.channels} channels`);
    mask = data;
  }

  // taper top and bottom 3% so the strip fades in/out
  const taper = Math.round(height * 0.03);
  for (let y = 0; y < taper; y++) {
    const f = y / taper;
    for (let x = 0; x < W; x++) {
      mask[y * W + x] = Math.round(mask[y * W + x] * f);
      mask[(height - 1 - y) * W + x] = Math.round(mask[(height - 1 - y) * W + x] * f);
    }
  }

  // faint paper-grain speckle, blurred, capped, only inside the mask
  const r = rng(seed + 5);
  let tex = Buffer.alloc(W * height, 0);
  const n = Math.round((W * height) / 900);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * height);
    tex[y * W + x] = 40 + Math.floor(r() * 71);
  }
  {
    const { data, info } = await sharp(tex, { raw: { width: W, height, channels: 1 } })
      .blur(0.8).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 1) throw new Error(`texture blur returned ${info.channels} channels`);
    tex = data;
  }

  // compose final RGBA: warm white tinted by grain, alpha from mask
  const px = Buffer.alloc(W * height * 4);
  for (let i = 0; i < W * height; i++) {
    const a = mask[i];
    const g = (a ? Math.min(tex[i], TEXTURE_OPACITY) : 0) / 255;
    px[i * 4] = Math.round(WHITE[0] * (1 - g) + GRAIN[0] * g);
    px[i * 4 + 1] = Math.round(WHITE[1] * (1 - g) + GRAIN[1] * g);
    px[i * 4 + 2] = Math.round(WHITE[2] * (1 - g) + GRAIN[2] * g);
    px[i * 4 + 3] = a;
  }
  return sharp(px, { raw: { width: W, height, channels: 4 } }).png().toBuffer();
}

/** Generate all four variants into outDir (skips nothing; overwrites). */
async function generateStrips(outDir = DEFAULT_STRIPS_DIR, height = 2500) {
  const sharp = require('sharp');
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const v of VARIANTS) {
    const buf = await makeStrip(sharp, height, v.width_frac, v.rough, v.seed);
    const p = path.join(outDir, `${v.name}.png`);
    fs.writeFileSync(p, buf);
    written.push(p);
  }
  return written;
}

/** Ensure the four assets exist; generate them if any is missing. */
async function ensureStrips(dir = DEFAULT_STRIPS_DIR) {
  const missing = VARIANTS.some(v => !fs.existsSync(path.join(dir, `${v.name}.png`)));
  if (missing) await generateStrips(dir);
  return dir;
}

module.exports = { generateStrips, ensureStrips, VARIANTS, DEFAULT_STRIPS_DIR };

if (require.main === module) {
  const rest = process.argv.slice(2);
  const opt = { height: 2500, out: DEFAULT_STRIPS_DIR };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--height') opt.height = Number(rest[++i]);
    else if (rest[i] === '--out') opt.out = path.resolve(rest[++i]);
  }
  generateStrips(opt.out, opt.height)
    .then(files => files.forEach(f => console.log(`wrote ${f}`)))
    .catch(err => { console.error(`make-strips: ${err.message}`); process.exit(1); });
}
