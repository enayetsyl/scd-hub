/**
 * BL-2 — print releases (docs/prd-book-lifecycle.md §11.2, §9.4.5, §19 bookLcRelease; D-#1598/#1599).
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { setupLc, teardownLc, resetBooks, importSample, item, childVersion, releasedBook, seedSchool, samplePdf, type LcFx } from "./bookLcFixtures";
import { createRelease, addReleaseFile, recordRelease, setReleaseStatus, parsePagePlan } from "../modules/book-lifecycle/services/releaseService";
import { announceErratum, updateErratum } from "../modules/book-lifecycle/services/errataService";
import { approveDirectFix, markFinal, uploadVersionFile } from "../modules/book-lifecycle/services/versionService";
import { loadVersion, loadBook } from "../modules/book-lifecycle/services/store";
import { BookErratum, BookPrintRelease } from "../modules/book-lifecycle/models/BookRelease";
import { assertBookLcFileReadAccess } from "../modules/book-lifecycle/routes/bookLcFiles";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { ForbiddenError } from "../middleware/authz";
import type { AppContext } from "../context";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());
const P = () => fx.auth.principal;

it("a release only from a final version; the Student IDML zip + preview PDF are required to record it", async () => {
  const { version } = await importSample(P());
  await expect(createRelease(P(), version._id.toString(), { labelBn: "ছাপা" })).rejects.toThrow(/চূড়ান্ত/);
  const { version: fin } = await importSample(P(), { code: "C3-ENG", state: "final" });
  const r = await createRelease(fx.auth.officeRelease, fin._id.toString(), { labelBn: "২০২৭ প্রথম ছাপা" });
  await expect(recordRelease(fx.auth.officeRelease, r._id.toString())).rejects.toThrow(/IDML/);
  await addReleaseFile(fx.auth.officeRelease, r._id.toString(), { edition: "STUDENT", kind: "idml_zip", name: "s.zip", data: Buffer.from("PK zip"), mime: "application/zip" });
  await expect(addReleaseFile(fx.auth.officeRelease, r._id.toString(), { edition: "STUDENT", kind: "preview_pdf", name: "s.zip", data: Buffer.from("PK zip"), mime: "application/zip" })).rejects.toThrow(/ধরন/);
  await addReleaseFile(fx.auth.officeRelease, r._id.toString(), { edition: "STUDENT", kind: "preview_pdf", name: "s.pdf", data: await samplePdf(1, []), mime: "application/pdf" });
  const rec = await recordRelease(fx.auth.officeRelease, r._id.toString());
  expect(rec.recordedAt).toBeInstanceOf(Date);
  expect((await loadVersion(fin._id)).status).toBe("print_released");
  expect((await loadBook(fin.bookId)).currentReleaseId?.equals(r._id)).toBe(true);
  await expect(createRelease(fx.auth.officeManage, fin._id.toString(), { labelBn: "x" })).rejects.toBeInstanceOf(ForbiddenError);
});

it("statuses in order with dates; a newer printed release supersedes the older one", async () => {
  const { release, version } = await releasedBook(P());
  await expect(setReleaseStatus(P(), release._id.toString(), { status: "printed" })).rejects.toThrow(/ক্রম/);
  await setReleaseStatus(P(), release._id.toString(), { status: "sent_to_press", at: new Date("2026-12-01T00:00:00Z"), pressNameBn: "কাল্পনিক ছাপাখানা" });
  const printed = await setReleaseStatus(P(), release._id.toString(), { status: "printed", at: new Date("2026-12-10T00:00:00Z"), copies: 120 });
  expect(printed.sentToPressAt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  expect(printed.printedAt?.toISOString()).toBe("2026-12-10T00:00:00.000Z");
  expect(printed.copies).toBe(120);
  // a reprint of the same final version (no errata announced) — the second printed supersedes the first
  const r2 = await createRelease(P(), version._id.toString(), { labelBn: "দ্বিতীয় ছাপা" });
  await addReleaseFile(P(), r2._id.toString(), { edition: "STUDENT", kind: "idml_zip", name: "s.zip", data: Buffer.from("PK"), mime: "application/zip" });
  await addReleaseFile(P(), r2._id.toString(), { edition: "STUDENT", kind: "preview_pdf", name: "s.pdf", data: await samplePdf(1, []), mime: "application/pdf" });
  await recordRelease(P(), r2._id.toString());
  await setReleaseStatus(P(), r2._id.toString(), { status: "sent_to_press" });
  await setReleaseStatus(P(), r2._id.toString(), { status: "printed" });
  expect((await BookPrintRelease.findById(release._id))?.status).toBe("superseded");
});

it("a new release is refused while an announced erratum is not carried into the version", async () => {
  await seedSchool();
  const { book, version } = await releasedBook(P());
  const f = await item(P(), book._id.toString(), "verbal_errata", { quote: "2টি নৌকা" });
  const e = await BookErratum.findOne({ feedbackId: f._id });
  expect(e?.status).toBe("draft");
  await updateErratum(P(), e!._id.toString(), { correctText: "দুটি নৌকা", page: "৭" });
  await announceErratum(P(), e!._id.toString());
  // the same version again → refused (the erratum is not in it)
  await expect(createRelease(P(), version._id.toString(), { labelBn: "আবার" })).rejects.toThrow(/E-1/);
  // a child that applies the item carries it → allowed
  const child = await childVersion(P(), book._id.toString(), "2টি নৌকা", "দুটি নৌকা", [f.code]);
  expect((await BookErratum.findById(e!._id))?.carriedIntoVersionId?.equals(child._id)).toBe(true);
  await approveDirectFix(P(), child._id.toString());
  for (const ed of ["TEACHER", "STUDENT"] as const) await uploadVersionFile(P(), child._id.toString(), { role: "edition", edition: ed, name: `${ed}.pdf`, data: await samplePdf(1, []), mime: "application/pdf" });
  await markFinal(P(), child._id.toString());
  await expect(createRelease(P(), child._id.toString(), { labelBn: "নতুন ছাপা" })).resolves.toBeDefined();
});

it("print files are readable by view and release holders only", async () => {
  const { release } = await releasedBook(P());
  const file = await StoredFile.findById(release.files[0].storedFileId);
  const ctx = (a: unknown) => ({ auth: a }) as AppContext;
  await expect(assertBookLcFileReadAccess(ctx(fx.auth.officeRelease), file!)).resolves.toBeUndefined();
  await expect(assertBookLcFileReadAccess(ctx(P()), file!)).resolves.toBeUndefined();
  for (const who of [fx.auth.office, fx.auth.teacher, fx.auth.guardian]) await expect(assertBookLcFileReadAccess(ctx(who), file!)).rejects.toBeInstanceOf(ForbiddenError);
});

it("pageplan.json maps pages to chapters (tolerant shape)", () => {
  const ch = [{ key: "ch-001", title: "নদী" }, { key: "ch-002", title: "পাখি" }];
  expect(parsePagePlan([{ page: 3, chapterKey: "ch-001" }, { page: 9, heading: "পাখি" }, { page: "x" }], ch)).toEqual([{ page: 3, chapterKey: "ch-001" }, { page: 9, chapterKey: "ch-002" }]);
  expect(parsePagePlan({ pages: [{ page: 1, title: "নদী" }] }, ch)).toEqual([{ page: 1, chapterKey: "ch-001" }]);
});
