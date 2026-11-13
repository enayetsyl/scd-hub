/**
 * BL-1 — shared/bookDiff (docs/prd-book-lifecycle.md §12.4, §19 bookLcDiff): line (Myers) then word
 * diff; Bangla and English; identical text → no hunks.
 */
import { diffLines, diffWords, myersDiff, tokenizeWords } from "@scd/shared";

it("identical text → no hunks", () => {
  expect(diffLines("এক\nদুই\n", "এক\nদুই\n")).toEqual([]);
});

it("Bangla line + word diff, word boundaries at whitespace and the dari", () => {
  const h = diffLines("টুনটুনি নদীর ধারে বসে।\nপরের লাইন", "টুনটুনি নদীর পাড়ে বসে।\nপরের লাইন");
  expect(h).toHaveLength(1);
  expect(h[0]).toMatchObject({ aStart: 0, aLines: 1, bStart: 0, bLines: 1 });
  expect(h[0].words).toEqual([
    { op: "eq", text: "টুনটুনি নদীর " },
    { op: "del", text: "ধারে" },
    { op: "ins", text: "পাড়ে" },
    { op: "eq", text: " বসে।" },
  ]);
  expect(tokenizeWords("এক। দুই,তিন")).toEqual(["এক", "।", " ", "দুই", ",", "তিন"]);
});

it("English insertions and deletions of whole lines", () => {
  const h = diffLines("a\nb\nc", "a\nc\nd");
  expect(h.map((x) => [x.removed, x.added])).toEqual([[["b"], []], [[], ["d"]]]);
  expect(diffWords("the river is calm", "the river was calm").filter((s) => s.op !== "eq").map((s) => s.text)).toEqual(["is", "was"]);
});

it("the edit script reproduces both sides (random cases)", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let t = 0; t < 200; t++) {
    const mk = () => Array.from({ length: Math.floor(rnd() * 15) }, () => "কখগ"[Math.floor(rnd() * 3)]);
    const a = mk();
    const b = mk();
    const ops = myersDiff(a, b);
    expect(ops.filter((o) => o.op !== "ins").map((o) => a[o.a!]).join("")).toBe(a.join(""));
    expect(ops.filter((o) => o.op !== "del").map((o) => b[o.b!]).join("")).toBe(b.join(""));
  }
});
