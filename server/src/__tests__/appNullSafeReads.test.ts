/**
 * D-#1657: null-safe reads of GraphQL data. Nine of ten triage fixes were `data?.x.y` with a null
 * `x` (the field is nullable, the screen blanked). Source scan of app/src: after `data?.<field>`
 * the next member access must be `?.` too. Catches the multiline forms
 * (`data?.x\n  .y`, `data?\n.x.y`) because it reads whole files.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

const APP = path.resolve(__dirname, "../../../app");
// `data?.<field>` followed (spaces/newlines allowed) by a plain `.member` (not `?.`).
const UNSAFE = /\bdata\?\s*\.\s*\w+\s*\.\s*\w/g;
/** file (relative to app/) -> reason. Keep tiny: a false positive should refine UNSAFE instead. */
const ALLOW: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

describe("app null-safe GraphQL reads (D-#1657)", () => {
  const files = [...walk(path.join(APP, "src")), path.join(APP, "App.tsx")];

  it("scans a realistic number of files", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("the pattern catches single-line and multiline unsafe reads and passes safe ones", () => {
    const hit = (s: string) => new RegExp(UNSAFE.source).test(s);
    expect(hit("q.data?.a.b")).toBe(true);
    expect(hit("q.data?.a\n   .map((x) => x)")).toBe(true);
    expect(hit("q.data?\n  .a.b")).toBe(true);
    expect(hit("q.data?.a?.b")).toBe(false);
    expect(hit("q.data?.a ?? []")).toBe(false);
    expect(hit("q.data?.a?.b.c")).toBe(false);
  });

  it("no `data?.field.prop` without `?.` after the field", () => {
    const bad: string[] = [];
    for (const f of files) {
      const rel = path.relative(APP, f).split(path.sep).join("/");
      if (ALLOW[rel]) continue;
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(UNSAFE)) {
        const line = src.slice(0, m.index).split("\n").length;
        bad.push(`${rel}:${line}  ${m[0].replace(/\s+/g, " ")}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
