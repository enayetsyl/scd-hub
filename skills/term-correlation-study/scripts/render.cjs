/**
 * STEP 4 — runs LOCALLY. Fills the page templates from out/figures.json.
 *
 *   node scripts/render.cjs      ->  out/page-en.html, out/page-bn.html
 *
 * The templates hold the LANGUAGE (prose, labels, captions); figures.json holds
 * the NUMBERS. Nothing in templates/ carries a real figure, which is why they
 * are safe to keep in a public repo — the filled pages land in out/, which is
 * gitignored.
 *
 * Token syntax inside a template:
 *   {{counts.students}}        scalar, inserted as-is
 *   {{tertiles.hwDone.2.res:0}} scalar, toFixed(0)
 *   {{@students}}              JSON.stringify of that node (for chart data)
 *   {{%headline.below85.lo}}   scalar x100, i.e. a 0-1 rate printed as a percent
 *
 * In page-bn.html every scalar is converted to Bengali digits automatically;
 * JSON blobs are not, because the page's own bn() converts them at draw time.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.CORR_OUT || path.join(ROOT, 'out');
const fig = JSON.parse(fs.readFileSync(path.join(OUT, 'figures.json'), 'utf8'));

const BN = '০১২৩৪৫৬৭৮৯';
const toBn = (s) => String(s).replace(/[0-9]/g, (d) => BN[+d]);

function get(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function fill(tpl, bengali) {
  const missing = [];
  const out = tpl.replace(/\{\{([@%]?)([a-zA-Z0-9_.]+)(?::(\d+))?\}\}/g, (m, mode, key, dp) => {
    const v = get(fig, key);
    if (v === undefined) { missing.push(key); return m; }
    if (mode === '@') return JSON.stringify(v);
    if (v === null) return '-';
    let n = mode === '%' ? v * 100 : v;
    let s = dp != null ? Number(n).toFixed(+dp)
      : (typeof n === 'number' && !Number.isInteger(n) ? String(+n.toFixed(2)) : String(n));
    if (typeof n === 'number' && Math.abs(n) >= 10000) s = Number(s).toLocaleString('en-US');
    return bengali ? toBn(s) : s;
  });
  return { out, missing };
}

fs.mkdirSync(OUT, { recursive: true });
let failed = false;
for (const [tplName, outName, bengali] of [
  ['page-en.html', 'page-en.html', false],
  ['page-bn.html', 'page-bn.html', true],
]) {
  const tpl = fs.readFileSync(path.join(ROOT, 'templates', tplName), 'utf8');
  const { out, missing } = fill(tpl, bengali);
  if (missing.length) {
    failed = true;
    console.error('MISSING in ' + tplName + ':', [...new Set(missing)].join(', '));
  }
  const left = out.match(/\{\{[^}]+\}\}/g);
  if (left) { failed = true; console.error('UNFILLED tokens in ' + tplName + ':', [...new Set(left)].join(', ')); }
  fs.writeFileSync(path.join(OUT, outName), out);
  console.log('wrote', path.join(OUT, outName), '(' + out.length + ' bytes)');
}
if (failed) { console.error('\nrender finished WITH ERRORS — do not publish these pages'); process.exit(1); }
console.log('\nBoth pages rendered. Now READ out/report.txt and check the prose still matches:');
console.log('  - the verdict block, every figcaption, and the class-table paragraph state DIRECTIONS');
console.log('    ("attendance does not predict", "only below 85%"). A token swap cannot fix a sentence');
console.log('    whose direction has changed. Re-read them against the new numbers and edit the');
console.log('    TEMPLATE (not out/) if any conclusion flipped.');
