/**
 * BL-3 — the edit-operation engine (docs/prd-book-lifecycle.md §12.2, §19 bookEditOps). Pure.
 */
import { applyOps, ChapterEditSchema, type EditOp } from "../modules/book-lifecycle/services/editOps";

const T = "টুনটুনি নদীর ধারে বসে ৫টি নৌকা গুনল। The river is calm. নদীর ধারে হাওয়া।";
const r = (before: string, after: string, refs = ["F-1"]): EditOp => ({ op: "replace", before, after, refs });

it("replace / insert_after / delete apply deterministically, in order", () => {
  const ops: EditOp[] = [r("৫টি", "পাঁচটি"), { op: "insert_after", anchor: "calm.", text: " Birds sing.", refs: ["I-1"] }, { op: "delete", before: " হাওয়া", refs: ["F-2"] }];
  const a = applyOps(T, ops);
  const b = applyOps(T, ops);
  expect(a.findings).toEqual([]);
  expect(a.text).toBe("টুনটুনি নদীর ধারে বসে পাঁচটি নৌকা গুনল। The river is calm. Birds sing. নদীর ধারে।");
  expect(b.text).toBe(a.text);
  expect(a.applied.map((x) => x.index)).toEqual([1, 2, 3]);
});

it("`before` must occur exactly once (0 and 2 refused)", () => {
  expect(applyOps(T, [r("নেই এমন", "x")]).findings[0]).toMatchObject({ code: "VR-4", op: 1 });
  expect(applyOps(T, [r("নদীর ধারে", "x")]).findings[0].messageBn).toMatch(/একাধিকবার/);
  expect(applyOps(T, [r("নদীর ধারে বসে", "x")]).findings).toEqual([]);
});

it("overlapping ops are refused; after == before refused; matching is on NFC", () => {
  const o = applyOps(T, [r("৫টি নৌকা", "পাঁচটি নৌকা"), r("পাঁচটি", "ছয়টি")]);
  expect(o.findings.map((f) => f.messageBn)).toEqual([expect.stringMatching(/একই জায়গায়/)]);
  expect(applyOps(T, [r("calm", "calm")]).findings[0].messageBn).toMatch(/পুরোনোর মতোই/);
  const decomposed = "কো".normalize("NFD");
  expect(applyOps("আমি কোথায়", [r(`${decomposed}থায়`, "কোথাও")]).text).toBe("আমি কোথাও");
});

it("at most 300 ops; the schema is strict (unknown fields, missing refs refused)", () => {
  const many = Array.from({ length: 301 }, () => r("x", "y"));
  expect(applyOps("x", many).findings[0].messageBn).toMatch(/৩০০/);
  const base = { schema: "book-chapter-edit/v1", draft: "d1", chapter: "ch-001", baseSha: "a".repeat(64), ops: [] };
  expect(ChapterEditSchema.safeParse(base).success).toBe(true);
  expect(ChapterEditSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  expect(ChapterEditSchema.safeParse({ ...base, ops: [{ op: "replace", before: "a", after: "b", refs: [] }] }).success).toBe(false);
  expect(ChapterEditSchema.safeParse({ ...base, ops: [{ op: "replace", before: "a", after: "b", refs: ["F-1"], why: "x" }] }).success).toBe(false);
});
