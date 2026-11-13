/**
 * BL-3 — whole-text coverage (docs/prd-book-lifecycle.md §12.3 VR-7, §19 bookEditCoverage).
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { setupLc, teardownLc, resetBooks, importSample, item, type LcFx } from "./bookLcFixtures";
import { openEditDraft, putChapter, ackUnexplained, draftChapterText } from "../modules/book-lifecycle/services/draftService";
import { acceptDraft, decideDraftChapter, loadDraft } from "../modules/book-lifecycle/services/versionService";
import { ForbiddenError } from "../middleware/authz";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());
const P = () => fx.auth.principal;

it("every hunk covered → no unexplained; an uncovered hunk blocks accept until a finalize holder ticks it (stamped)", async () => {
  const { book } = await importSample(P());
  const id = book._id.toString();
  const f = await item(P(), id, "direct_fix");
  const d = await openEditDraft(fx.auth.officeManage, id, { source: "mcp", feedback: [f.code] });
  const base = (await draftChapterText(d, "ch-002"))!;
  const covered = await putChapter(fx.auth.officeManage, d._id.toString(), "ch-002", base.replace("2টি নৌকা", "দুটি নৌকা"), [{ chapterKey: "ch-002", beforeExcerpt: "2টি নৌকা", afterExcerpt: "দুটি নৌকা", refs: [f.code] }]);
  expect(covered.unexplained).toBe(0);
  const next = base.replace("2টি নৌকা", "দুটি নৌকা").replace("calm today", "quiet today");
  const res = await putChapter(fx.auth.officeManage, d._id.toString(), "ch-002", next, [{ chapterKey: "ch-002", beforeExcerpt: "2টি নৌকা", afterExcerpt: "দুটি নৌকা", refs: [f.code] }]);
  expect(res.unexplained).toBe(1);
  const draft = await loadDraft(d._id);
  expect(draft.chapters.find((c) => c.key === "ch-002")?.unexplained[0].beforeText).toContain("calm today");
  await expect(decideDraftChapter(fx.auth.officeManage, d._id.toString(), "ch-002", true)).rejects.toThrow(/ব্যাখ্যাহীন/);
  await expect(ackUnexplained(fx.auth.officeManage, d._id.toString(), "ch-002", 0)).rejects.toBeInstanceOf(ForbiddenError);
  const acked = await ackUnexplained(P(), d._id.toString(), "ch-002", 0);
  const u = acked.chapters.find((c) => c.key === "ch-002")!.unexplained[0];
  expect(u.ack?.by?.toString()).toBe(P().userId);
  await decideDraftChapter(fx.auth.officeManage, d._id.toString(), "ch-002", true);
  const v = await acceptDraft(fx.auth.officeManage, d._id.toString(), { summaryBn: "দুটি" });
  expect(v.status).toBe("draft");
});

it("a change row that matches nothing leaves the hunk unexplained", async () => {
  const { book } = await importSample(P());
  const f = await item(P(), book._id.toString(), "direct_fix");
  const d = await openEditDraft(P(), book._id.toString(), { source: "mcp", feedback: [f.code] });
  const base = (await draftChapterText(d, "ch-001"))!;
  const r = await putChapter(P(), d._id.toString(), "ch-001", base.replace("1টি নৌকা", "একটি নৌকা"), [{ chapterKey: "ch-001", beforeExcerpt: "অন্য কথা", afterExcerpt: "অন্য", refs: [f.code] }]);
  expect(r.unexplained).toBe(1);
});
