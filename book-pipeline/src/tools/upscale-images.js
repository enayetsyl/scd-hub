#!/usr/bin/env node
'use strict';
/**
 * upscale-images.js — bring source PNGs up to the geometry DPI floor
 * (standalone, D-020; shells out to the machine-installed Upscayl CLI,
 * shares no code with any other pipeline).
 *
 * Chain per image: Upscayl 4x AI upscale → sharp lanczos3 downscale to the
 * short-side floor (2197px from geometry.js) → <out>/. Downscale-only after
 * the AI pass: if 4x still lands under the floor, this FAILS rather than
 * naively stretching pixels — the DPI floor is a quality gate, not a pixel
 * count to game.
 *
 * Usage:
 *   node src/tools/upscale-images.js --in <dir> --out <dir> [--model digital-art-4x]
 * Env overrides: UPSCAYL_BIN, UPSCAYL_MODELS
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const geometry = require('../lib/geometry');

const UPSCAYL_BIN = process.env.UPSCAYL_BIN ||
  'C:\\Program Files\\Upscayl\\resources\\bin\\upscayl-bin.exe';
const UPSCAYL_MODELS = process.env.UPSCAYL_MODELS ||
  'C:\\Program Files\\Upscayl\\resources\\models';
const FLOOR = geometry.IMAGE.short_side_floor_px;

function parseArgs(argv) {
  const args = { in: null, out: null, model: 'digital-art-4x', scale: 4 };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--in') args.in = rest[++i];
    else if (rest[i] === '--out') args.out = rest[++i];
    else if (rest[i] === '--model') args.model = rest[++i];
    else throw new Error(`unexpected argument: ${rest[i]}`);
  }
  if (!args.in || !args.out) {
    console.error('usage: node src/tools/upscale-images.js --in <dir> --out <dir> [--model <name>]');
    process.exit(2);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const inDir = path.resolve(args.in);
  const outDir = path.resolve(args.out);
  if (!fs.existsSync(UPSCAYL_BIN)) throw new Error(`Upscayl binary not found: ${UPSCAYL_BIN}`);
  if (!fs.existsSync(inDir)) throw new Error(`input dir not found: ${inDir}`);

  const files = fs.readdirSync(inDir).filter(f => f.toLowerCase().endsWith('.png'));
  if (!files.length) throw new Error(`no PNGs in ${inDir}`);

  // Stage 1: Upscayl the whole folder in one pass (folder mode).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-upscayl-'));
  console.log(`Upscayl ${args.model} x${args.scale}: ${files.length} image(s) → ${tmpDir}`);
  const res = spawnSync(UPSCAYL_BIN, [
    '-i', inDir, '-o', tmpDir,
    '-s', String(args.scale),
    '-m', UPSCAYL_MODELS,
    '-n', args.model,
    '-f', 'png',
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (res.error) throw new Error(`failed to run Upscayl: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`Upscayl exited ${res.status}`);

  // Stage 2: downscale to the floor (never upscale here) + strip metadata.
  fs.mkdirSync(outDir, { recursive: true });
  const failures = [];
  for (const f of files) {
    const up = path.join(tmpDir, f);
    if (!fs.existsSync(up)) { failures.push(`${f}: Upscayl produced no output`); continue; }
    const img = sharp(up);
    const { width, height } = await img.metadata();
    const short = Math.min(width, height);
    if (short < FLOOR) {
      failures.push(`${f}: ${width}x${height} still under floor ${FLOOR}px after x${args.scale} — needs a larger source`);
      continue;
    }
    const scale = FLOOR / short;
    const w = Math.round(width * scale), h = Math.round(height * scale);
    await img.resize(w, h, { kernel: 'lanczos3' }).png().toFile(path.join(outDir, f));
    console.log(`${f}: ${width}x${height} → ${w}x${h} (floor ${FLOOR})`);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (failures.length) {
    console.error(`\nFAILED:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`\nOK — ${files.length} image(s) at the ${FLOOR}px floor in ${outDir}`);
}

main().catch(err => { console.error(`upscale-images: ${err.message}`); process.exit(1); });
