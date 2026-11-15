// Static scan for phone-overflow risks in the Expo app.
// usage: node skills/_tools/scan_phone_overflow.cjs app/src node_modules/typescript [--json] [--strict]
// Prints file:line + snippet per finding; --json prints JSON instead; exit 1 only with --strict and findings.
// Flags: a View/Pressable whose inline style has flexDirection "row" WITHOUT flexWrap "wrap", holding a
// text element (Text/Body/Muted/Label/Title…) with DYNAMIC content ({…}) whose style gives no
// flex / flexShrink / flexGrow / flexBasis / maxWidth / numberOfLines. Such text keeps its full one-line width
// and pushes past the screen edge on a phone.
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const [root, tsDir] = args;
const asJson = process.argv.includes("--json");
const strict = process.argv.includes("--strict");
const ts = require(path.resolve(tsDir));
const TEXTY = new Set(["Text", "Body", "Muted", "Label", "Title", "Small", "Strong", "SectionTitle", "H2", "H3"]);
const SAFE = /\b(flex|flexShrink|flexGrow|flexBasis|maxWidth|width)\b/;
const out = [];

function styleText(attrs, sf) {
  for (const a of attrs.properties) {
    if (ts.isJsxAttribute(a) && a.name.getText(sf) === "style" && a.initializer) return a.initializer.getText(sf);
  }
  return "";
}
function hasAttr(attrs, sf, name) {
  return attrs.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === name);
}
function tagOf(n, sf) {
  const o = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
  return o ? { name: o.tagName.getText(sf), attrs: o.attributes } : null;
}
function walk(file) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (ts.isJsxElement(node)) {
      const t = tagOf(node, sf);
      const st = styleText(t.attrs, sf);
      const isRow = /flexDirection:\s*["']row["']/.test(st) || /styles\.\w*[rR]ow\b/.test(st);
      const wraps = /flexWrap:\s*["']wrap["']/.test(st);
      if (isRow && !wraps && /flexDirection/.test(st)) {
        const kids = node.children.filter((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
        if (kids.length >= 2) {
          for (const c of kids) {
            const ct = tagOf(c, sf);
            if (!ct || !TEXTY.has(ct.name)) continue;
            const cst = styleText(ct.attrs, sf);
            if (SAFE.test(cst) || hasAttr(ct.attrs, sf, "numberOfLines")) continue;
            const dynamic = ts.isJsxElement(c) && c.children.some((g) => ts.isJsxExpression(g));
            if (!dynamic) continue;
            const { line } = sf.getLineAndCharacterOfPosition(c.getStart(sf));
            out.push({ file: path.relative(root, file).replace(/\\/g, "/"), line: line + 1, tag: ct.name, text: c.getText(sf).replace(/\s+/g, " ").slice(0, 110) });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
function rec(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") rec(p); }
    else if (/\.tsx$/.test(e.name)) walk(p);
  }
}
rec(root);
if (asJson) console.log(JSON.stringify({ total: out.length, findings: out }, null, 1));
else {
  for (const f of out) console.log(`${f.file}:${f.line}  ${f.text}`);
  console.log(`
${out.length} finding(s) in ${new Set(out.map((f) => f.file)).size} file(s)`);
}
if (strict && out.length) process.exit(1);
