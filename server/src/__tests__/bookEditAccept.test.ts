/**
 * BL-3 — per-chapter accept (docs/prd-book-lifecycle.md §12.3 VR-15, §19 bookEditAccept).
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { setupLc, teardownLc, resetBooks, importSample, item, childVersion, type LcFx } from "./bookLcFixtures";
import { applyChapterEdit, openEditDraft } from "../modules/book-lifecycle/services/draftService";
import { acceptDraft, decideDraftChapter } from "../modules/book-lifecycle/services/versionService";
import { storedMaster } from "../modules/book-lifecycle/services/store";
import { BookFeedback } from "../modules/book-lifecycle/models/BookFeedback";
import type { IBookEditDraft } from "../modules/book-lifecycle/models/BookEditDraft";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());
const P = () => fx.auth.principal;
const op = (d: IBookEditDraft, chapter: string, before: string, after: string, refs: string[]) =>
  applyChapterEdit(P(), d._id.toString(), { schema: "book-chapter-edit/v1", draft: d._id.toString(), chapter, baseSha: d.chapters.find((c) => c.key === chapter)!.baseSha, ops: [{ op: "replace", before, after, refs }] });

it("per-chapter accept/reject; the version gets the bump, the change list, cited items applied, server regions rewritten", async () => {
  const { book } = await importSample(P());
  const id = book._id.toString();
  const f1 = await item(P(), id, "direct_fix", { chapterKey: "ch-001" });
  const f2 = await item(P(), id, "direct_fix", { chapterKey: "ch-002" });
  const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f1.code, f2.code] });
  await op(d, "ch-001", "1টি নৌকা", "একটি নৌকা", [f1.code]);
  await op(d, "ch-002", "2টি নৌকা", "দুটি নৌকা", [f2.code]);
  await decideDraftChapter(P(), d._id.toString(), "ch-001", true);
  await decideDraftChapter(P(), d._id.toString(), "ch-002", false);
  const v = await acceptDraft(P(), d._id.toString(), { summaryBn: "সংখ্যা কথায়", bump: "major" });
  expect([v.major, v.minor]).toEqual([8, 0]);
  expect(v.changes.map((c) => c.refs[0])).toEqual([f1.code]);
  expect(v.changes[0].afterExcerpt).toBe("একটি নৌকা");
  const master = await storedMaster(v);
  expect(master).toContain("একটি নৌকা");
  expect(master).toContain("2টি নৌকা");
  expect(master).toContain("সংস্করণ ৮\n<!-- bl:server end -->");
  expect((await BookFeedback.findById(f1._id))?.status).toBe("applied");
  expect((await BookFeedback.findById(f2._id))?.status).toBe("accepted");
});

it("a stale draft (a new version appeared) cannot be accepted", async () => {
  const { book } = await importSample(P());
  const id = book._id.toString();
  const f = await item(P(), id, "direct_fix");
  const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
  await op(d, "ch-001", "1টি নৌকা", "একটি নৌকা", [f.code]);
  await decideDraftChapter(P(), d._id.toString(), "ch-001", true);
  await childVersion(P(), id, "3টি নৌকা", "তিনটি নৌকা", [f.code]);
  await expect(acceptDraft(P(), d._id.toString(), { summaryBn: "x" })).rejects.toThrow(/VR-1/);
});
