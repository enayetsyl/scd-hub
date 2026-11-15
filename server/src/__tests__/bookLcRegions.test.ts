/**
 * BL-1 — protected and server regions (docs/prd-book-lifecycle.md §6.3, §19 bookLcRegions).
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { setupLc, teardownLc, resetBooks, importSample, item, roundSent, approveOnPaper, samplePdf, type LcFx } from "./bookLcFixtures";
import { uploadNewVersionDraft, setDraftChanges, decideDraftChapter, acceptDraft, confirmProtectedChange, markFinal, uploadVersionFile } from "../modules/book-lifecycle/services/versionService";
import { storedMaster, servedMaster, loadVersion } from "../modules/book-lifecycle/services/store";
import { Audit } from "../modules/platform/models/Audit";
import { ForbiddenError } from "../middleware/authz";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());
const P = () => fx.auth.principal;

it("server regions are rewritten from the version rows at creation, and read as final once final", async () => {
  const { book, version } = await importSample(P());
  const master = await storedMaster(version);
  expect(master).toContain('<!-- bl:server start name="version-line" -->\nসংস্করণ ৭.৪\n<!-- bl:server end -->');
  expect(master).toMatch(/version-log" -->\n- সংস্করণ ৭\.৪ — ২০[০-৯]{2}-/);
  const r = await roundSent(P(), book._id.toString());
  await approveOnPaper(P(), r._id.toString());
  for (const e of ["TEACHER", "STUDENT"] as const) await uploadVersionFile(P(), version._id.toString(), { role: "edition", edition: e, name: `${e}.pdf`, data: await samplePdf(1, []), mime: "application/pdf" });
  const final = await markFinal(P(), version._id.toString());
  expect(await servedMaster(final)).toContain("সংস্করণ ৭.৪ — চূড়ান্ত");
  // The stored text and its hash never change (D-#1617): editions stay fresh.
  expect(await storedMaster(final)).toBe(master);
  expect((await loadVersion(final._id)).masterHash).toBe(version.masterHash);
});

it("a protected-region change is refused to manage, allowed to finalize with the confirmation, audited", async () => {
  const { book, version } = await importSample(P());
  const master = await storedMaster(version);
  const draft = await uploadNewVersionDraft(fx.auth.officeManage, book._id.toString(), { masterMd: Buffer.from(master.replace("টুনটুনি, ঝুমঝুমি", "টুনটুনি, ঝুমঝুমি, মিঠু")) });
  expect(draft.protectedChange?.changed).toBe(true);
  const f = await item(P(), book._id.toString(), "needs_reviewer", { chapterKey: "ch-001" });
  await setDraftChanges(fx.auth.officeManage, draft._id.toString(), [{ chapterKey: "front", reason: "নাম যোগ", refs: [f.code] }]);
  await decideDraftChapter(fx.auth.officeManage, draft._id.toString(), "front", true);
  await expect(acceptDraft(fx.auth.officeManage, draft._id.toString(), { summaryBn: "নাম" })).rejects.toThrow(/সুরক্ষিত/);
  await expect(confirmProtectedChange(fx.auth.officeManage, draft._id.toString())).rejects.toBeInstanceOf(ForbiddenError);
  await confirmProtectedChange(P(), draft._id.toString());
  const v2 = await acceptDraft(fx.auth.officeManage, draft._id.toString(), { summaryBn: "নাম" });
  expect(await storedMaster(v2)).toContain("মিঠু");
  expect(await Audit.countDocuments({ eventKind: "BOOK_LC_PROTECTED_CHANGED" })).toBe(1);
});

it("regions dropped by a docx round-trip come back from the parent; unmatched text is refused, named", async () => {
  const { book, version } = await importSample(P());
  const master = await storedMaster(version);
  const stripped = master.replace(/<!-- bl:protect start[^>]*-->\n?/, "").replace(/<!-- bl:protect end -->\n?/, "");
  const draft = await uploadNewVersionDraft(P(), book._id.toString(), { masterMd: Buffer.from(stripped) });
  expect(draft.protectedChange?.changed).toBe(false);
  expect(draft.chapters.find((c) => c.key === "front")?.status).toBe("unchanged");
  const lost = stripped.replace("অনুমোদিত নাম: টুনটুনি, ঝুমঝুমি", "অন্য লেখা");
  await expect(uploadNewVersionDraft(P(), book._id.toString(), { masterMd: Buffer.from(lost) })).rejects.toThrow(/protect/);
});

it("edits inside a server region in an upload are ignored (the server owns them)", async () => {
  const { book, version } = await importSample(P());
  const master = await storedMaster(version);
  const draft = await uploadNewVersionDraft(P(), book._id.toString(), { masterMd: Buffer.from(master.replace("সংস্করণ ৭.৪\n<!-- bl:server end", "সংস্করণ ৯৯\n<!-- bl:server end")) });
  expect(draft.chapters.find((c) => c.key === "front")?.status).toBe("unchanged");
});
