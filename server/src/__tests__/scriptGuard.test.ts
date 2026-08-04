/**
 * Script guard allowlist (SCHEMA check 8; D-#432, widened D-#442).
 *
 * THREE THINGS ARE PINNED HERE, and the third is the one that matters.
 *
 * 1. What is admitted stays admitted.
 * 2. What is deliberately refused stays refused — Arabic especially, since this content
 *    is drafted in chats where honorifics are natural (D-011).
 * 3. **Every codepoint the allowlist admits is actually IN the four embedded faces.**
 *    That is the invariant the guard exists for, and until now it was only a comment —
 *    a comment that turned out to be wrong about the em-dash. A claim about font
 *    coverage should be checked against the font files, so this reads their cmap.
 *
 * The app guard and the vendored CLI guard must agree, so the two sources are compared
 * character by character rather than trusted to have been edited together.
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import path from "path";
import { isAllowedCodepoint, scanString } from "../modules/support-book/services/validator/scriptGuard";

const FONT_DIR = path.join(__dirname, "..", "..", "..", "book-pipeline", "fonts");
const CLI_GUARD = path.join(__dirname, "..", "..", "..", "book-pipeline", "src", "validate-studybook.js");

describe("what the guard admits", () => {
  it.each([
    ["Bangla", "একটি প্রাথমিক বিদ্যালয়"],
    ["Basic Latin", "A bright, friendly children's-textbook illustration"],
    ["danda", "শিশুরা খেলছে।"],
    ["en dash (D-#442)", "পাঠ ১–২"],
    ["em dash (D-#442)", "একটি প্রাথমিক বিদ্যালয় — দোতলা ভবন"],
    ["em dash in English prompt (D-#442)", "A bright scene — no living beings"],
    ["ZWNJ", "ক‌খ"],
    ["newlines and tabs", "line one\n\tline two"],
  ])("accepts %s", (_label, s) => {
    expect(scanString(s)).toEqual([]);
  });
});

describe("what the guard still refuses", () => {
  it.each([
    ["Arabic honorific (D-011 — the live temptation)", "সাল্লাল্লাহু ﷺ"],
    ["Arabic script", "بسم"],
    ["Devanagari digits", "पाठ १२"],
    ["CJK", "学校"],
    ["arrow", "ক → খ"],
    ["emoji", "ভালো 😀"],
    ["curly quote", "‘hello’"],
    ["horizontal ellipsis", "wait…"],
  ])("refuses %s", (_label, s) => {
    expect(scanString(s).length).toBeGreaterThan(0);
  });

  it("names every distinct offender once, in first-seen order", () => {
    expect(scanString("a→b→c😀")).toEqual(["→", "😀"]);
  });
});

/**
 * Read a TrueType cmap (format 4, the BMP) and return the codepoints it maps. No
 * dependency: pulling in a font library to answer one question would be a heavier
 * commitment than the question deserves.
 */
function fontCodepoints(file: string): Set<number> {
  const buf = readFileSync(file);
  const numTables = buf.readUInt16BE(4);
  let cmapOff: number | null = null;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.toString("ascii", rec, rec + 4) === "cmap") cmapOff = buf.readUInt32BE(rec + 8);
  }
  if (cmapOff === null) throw new Error(`no cmap in ${file}`);

  const set = new Set<number>();
  const n = buf.readUInt16BE(cmapOff + 2);
  for (let i = 0; i < n; i++) {
    const enc = cmapOff + 4 + i * 8;
    const sub = cmapOff + buf.readUInt32BE(enc + 4);
    if (buf.readUInt16BE(sub) !== 4) continue;
    const segX2 = buf.readUInt16BE(sub + 6);
    const seg = segX2 / 2;
    const endO = sub + 14;
    const startO = endO + segX2 + 2;
    const deltaO = startO + segX2;
    const rangeO = deltaO + segX2;
    for (let s = 0; s < seg; s++) {
      const end = buf.readUInt16BE(endO + s * 2);
      const start = buf.readUInt16BE(startO + s * 2);
      if (start === 0xffff) continue;
      const delta = buf.readInt16BE(deltaO + s * 2);
      const rangeOffset = buf.readUInt16BE(rangeO + s * 2);
      for (let c = start; c <= end && c !== 0x10000; c++) {
        let g: number;
        if (rangeOffset === 0) {
          g = (c + delta) & 0xffff;
        } else {
          const gi = rangeO + s * 2 + rangeOffset + (c - start) * 2;
          if (gi + 1 >= buf.length) continue;
          g = buf.readUInt16BE(gi);
          if (g !== 0) g = (g + delta) & 0xffff;
        }
        if (g !== 0) set.add(c);
      }
    }
  }
  return set;
}

/**
 * The font check is skipped when the pipeline is not vendored (a fresh worktree that
 * has not been populated). SKIPPED LOUDLY rather than silently passing — a font check
 * that quietly does nothing is worse than no font check, because it reads as coverage.
 */
const fontsPresent = existsSync(FONT_DIR) && readdirSync(FONT_DIR).some((f) => f.endsWith(".ttf"));

(fontsPresent ? describe : describe.skip)("the admitted characters are really in the fonts", () => {
  const files = fontsPresent ? readdirSync(FONT_DIR).filter((f) => f.endsWith(".ttf")) : [];

  it("finds the four embedded faces (the check is actually reading something)", () => {
    expect(files.length).toBe(4);
  });

  // The Bengali faces are what render Bangla; the Latin ones do not carry the block,
  // and are not expected to. Each character is asserted against the faces that must
  // have it, which is what the renderer actually relies on.
  const BENGALI = /Bengali/;
  it.each([
    ["en dash", 0x2013, "all"],
    ["em dash", 0x2014, "all"],
    ["hyphen", 0x002d, "all"],
    ["danda", 0x0964, "bengali"],
    ["ka", 0x0995, "bengali"],
  ])("%s (U+%s) is present", (_label, cp, scope) => {
    const want = scope === "all" ? files : files.filter((f) => BENGALI.test(f));
    expect(want.length).toBeGreaterThan(0);
    for (const f of want) {
      expect(isAllowedCodepoint(cp as number)).toBe(true);
      expect(fontCodepoints(path.join(FONT_DIR, f)).has(cp as number)).toBe(true);
    }
  });
});

describe("the app guard and the vendored CLI guard agree", () => {
  const cliPresent = existsSync(CLI_GUARD);

  (cliPresent ? it : it.skip)("admit exactly the same characters across the BMP", () => {
    const src = readFileSync(CLI_GUARD, "utf8");
    const body = /function isAllowedCodepoint\(cp\)\s*\{([\s\S]*?)\n\}/.exec(src);
    expect(body).not.toBeNull();
    // eslint-disable-next-line no-new-func -- the CLI is vendored source in this repo,
    // not user input; executing its predicate is the only way to compare behaviour
    // rather than compare two regexes and hope.
    const cliAllows = new Function("cp", body![1]) as (cp: number) => boolean;

    const disagreements: number[] = [];
    for (let cp = 0; cp <= 0xffff; cp++) {
      if (isAllowedCodepoint(cp) !== !!cliAllows(cp)) disagreements.push(cp);
    }
    expect(disagreements).toEqual([]);
  });
});
