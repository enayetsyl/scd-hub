/**
 * BL-2 review fixes (docs/prd-book-lifecycle.md §9.4, §11.2; D-#1625/#1626): an older version cannot be
 * released after a newer one, every announced erratum blocks a release, errata go to holders of
 * teacher_view only, announce re-points to the current release, routine teachers of subjects with no
 * Subject row (ARABIC / QURAN) are readers, release files are server-typed and frozen after the press,
 * and the small items. Invented text only.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
const updateClassBook = jest.fn(async () => ({}));
jest.mock("../modules/class-books/services/ClassBookService", () => ({
  startClassBookUpload: async (i: { title: string }) => ({ book: { id: "classbook-fixture-1", ...i }, done: Promise.resolve() }),
  updateClassBook: (...a: never[]) => (updateClassBook as unknown as (...x: never[]) => unknown)(...a),
}));
import { Types } from "mongoose";
import { setupLc, teardownLc, resetBooks, importSample, item, childVersion, roundSent, approveOnPaper, releasedBook, seedSchool, samplePdf, type LcFx, type School } from "./bookLcFixtures";
import { ackErratum, announceErratum, updateErratum } from "../modules/book-lifecycle/services/errataService";
import { addReleaseFile, createRelease, publishToClassBooks, recordRelease, setClassBooksSwitch, setReleaseStatus, suggestChapterForPage } from "../modules/book-lifecycle/services/releaseService";
import { uploadVersionFile, markFinal } from "../modules/book-lifecycle/services/versionService";
import { bookTeachersNow, bookViewersNow } from "../modules/book-lifecycle/services/teacherScope";
import { fileTeacherReport, uploadReportPhoto } from "../modules/book-lifecycle/services/teacherService";
import { BookErratum, BookPrintRelease } from "../modules/book-lifecycle/models/BookRelease";
import { BookFeedback } from "../modules/book-lifecycle/models/BookFeedback";
import { SchoolBook } from "../modules/book-lifecycle/models/SchoolBook";
import { loadBook } from "../modules/book-lifecycle/services/store";
import { Notification } from "../modules/notifications/models/Notification";
import { User } from "../modules/foundation/models/User";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { BookEvent } from "../modules/support-book/models/BookEvent";

let fx: LcFx;
let school: School;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => {
  await resetBooks();
  await Notification.deleteMany({});
  school = await seedSchool();
});
const P = () => fx.auth.principal;
const ZIP = Buffer.from("PK\x03\x04 fixture");

/** A second final version of the same book, its release created (not yet recorded). */
async function secondFinalRelease(bookId: string) {
  const fix = await item(P(), bookId, "direct_fix");
  const v2 = await childVersion(P(), bookId, "1টি নৌকা", "একটি নৌকা", [fix.code]);
  const r = await roundSent(P(), bookId);
  await approveOnPaper(P(), r._id.toString());
  for (const e of ["TEACHER", "STUDENT"] as const) await uploadVersionFile(P(), v2._id.toString(), { role: "edition", edition: e, name: `${e}.pdf`, data: await samplePdf(1, []) });
  const v = await markFinal(P(), v2._id.toString());
  const rel = await createRelease(P(), v._id.toString(), { labelBn: "দ্বিতীয় ছাপা (কাল্পনিক)" });
  await addReleaseFile(P(), rel._id.toString(), { edition: "STUDENT", kind: "idml_zip", name: "s.zip", data: ZIP });
  await addReleaseFile(P(), rel._id.toString(), { edition: "STUDENT", kind: "preview_pdf", name: "s.pdf", data: await samplePdf(2, []) });
  return { v, rel };
}

describe("1 — releases", () => {
  it("a release from an older final version after a newer one is refused", async () => {
    const { book, version: v1 } = await releasedBook(P());
    const { rel } = await secondFinalRelease(book._id.toString());
    await recordRelease(P(), rel._id.toString());
    await expect(createRelease(P(), v1._id.toString(), { labelBn: "পুরোনো থেকে" })).rejects.toMatchObject({ code: "OLDER_VERSION" });
  });

  it("an announced erratum of ANY release blocks a new release until it is carried", async () => {
    const { book } = await releasedBook(P());
    const f = await item(P(), book._id.toString(), "direct_fix");
    // an announced erratum on an old release id (not the current one)
    await BookErratum.create({ bookId: book._id, releaseId: new Types.ObjectId(), feedbackId: f._id, code: "E-9", status: "announced", correctText: "x", createdBy: P().userId });
    const fx2 = await item(P(), book._id.toString(), "direct_fix");
    const v2 = await childVersion(P(), book._id.toString(), "1টি নৌকা", "একটি নৌকা", [fx2.code]);
    const r = await roundSent(P(), book._id.toString());
    await approveOnPaper(P(), r._id.toString());
    for (const e of ["TEACHER", "STUDENT"] as const) await uploadVersionFile(P(), v2._id.toString(), { role: "edition", edition: e, name: `${e}.pdf`, data: await samplePdf(1, []) });
    const v = await markFinal(P(), v2._id.toString());
    await expect(createRelease(P(), v._id.toString(), { labelBn: "দ্বিতীয়" })).rejects.toMatchObject({ code: "ERRATA_NOT_CARRIED" });
  });

  it("release files: type from bytes, frozen once sent to press; per-edition page plan", async () => {
    const { release } = await releasedBook(P());
    const id = release._id.toString();
    await expect(addReleaseFile(P(), id, { edition: "STUDENT", kind: "idml_zip", name: "x.zip", data: Buffer.from("<html>"), mime: "application/zip" })).rejects.toMatchObject({ code: "BAD_TYPE" });
    const plan = (rows: object[]) => Buffer.from(JSON.stringify(rows));
    await addReleaseFile(P(), id, { edition: "STUDENT", kind: "pageplan_json", name: "p.json", data: plan([{ page: 3, chapterKey: "ch-001" }, { page: 6, chapterKey: "ch-002" }]) });
    await addReleaseFile(P(), id, { edition: "TEACHER", kind: "pageplan_json", name: "p.json", data: plan([{ page: 5, chapterKey: "ch-001" }, { page: 9, chapterKey: "ch-002" }]) });
    const bookId = (await BookPrintRelease.findById(id))!.bookId;
    expect(await suggestChapterForPage(bookId, 7, "STUDENT")).toBe("ch-002");
    expect(await suggestChapterForPage(bookId, 7, "TEACHER")).toBe("ch-001");
    await setReleaseStatus(P(), id, { status: "sent_to_press" });
    await expect(addReleaseFile(P(), id, { edition: "STUDENT", kind: "idml_zip", name: "s.zip", data: ZIP })).rejects.toMatchObject({ code: "FROZEN" });
  });
});

describe("2 — recipients are holders of teacher_view", () => {
  it("a routine teacher WITHOUT teacher_view is not told and not counted", async () => {
    const { book } = await releasedBook(P());
    await User.updateOne({ _id: school.routineTeacher.userId }, { $set: { grantedPermissions: ["book_lifecycle:report"] } });
    expect((await bookTeachersNow(book)).has(school.routineTeacher.userId)).toBe(true);
    expect((await bookViewersNow(book)).has(school.routineTeacher.userId)).toBe(false);
    const f = await item(P(), book._id.toString(), "verbal_errata");
    const e = (await BookErratum.findOne({ feedbackId: f._id }))!;
    await updateErratum(P(), e._id.toString(), { correctText: "ঠিক" });
    await announceErratum(P(), e._id.toString());
    const to = (await Notification.find({ kind: "BOOK_ERRATUM" }).lean()).map((n) => n.recipientUserId?.toString());
    expect(to).toEqual([school.classTeacher.userId]);
    // the notice carries no wrong/correct text
    const n = await Notification.findOne({ kind: "BOOK_ERRATUM" }).lean();
    expect(n?.bodyBn).toContain("আমার বই");
    expect(n?.bodyBn).not.toContain("ঠিক");
  });
});

describe("4/5/16 — errata and the current release", () => {
  it("announcing re-points an erratum of an older release to the current one; ack on a non-current one is refused; ack is not doubled", async () => {
    const { book } = await releasedBook(P());
    const f = await item(P(), book._id.toString(), "verbal_errata");
    const e = (await BookErratum.findOne({ feedbackId: f._id }))!;
    await updateErratum(P(), e._id.toString(), { correctText: "ঠিক লেখা" });
    const { rel } = await secondFinalRelease(book._id.toString());
    // release 2 may not be recorded while E-1 is a draft? (drafts do not block) — record it.
    await recordRelease(P(), rel._id.toString());
    const out = await announceErratum(P(), e._id.toString());
    expect(out.releaseId.equals(rel._id)).toBe(true);
    await Promise.all([ackErratum(school.routineTeacher, e._id.toString()), ackErratum(school.routineTeacher, e._id.toString())]);
    expect((await BookErratum.findById(e._id))?.acks).toHaveLength(1);
    await BookErratum.updateOne({ _id: e._id }, { $set: { releaseId: new Types.ObjectId() } });
    await expect(ackErratum(school.classTeacher, e._id.toString())).rejects.toMatchObject({ code: "NOT_CURRENT" });
  });

  it("verbal_errata with no printed release is refused; when a release is recorded the accepted ones get drafts", async () => {
    const { book } = await importSample(P());
    await expect(item(P(), book._id.toString(), "verbal_errata")).rejects.toMatchObject({ code: "NO_RELEASE" });
    const { book: b2 } = await releasedBook(P(), { code: "C3-BN2" });
    // an accepted verbal item that predates the next release (no erratum yet)
    const f = await item(P(), b2._id.toString(), "verbal_errata");
    await BookErratum.deleteMany({ feedbackId: f._id });
    await BookFeedback.updateOne({ _id: f._id }, { $unset: { erratumId: 1 } });
    const { rel } = await secondFinalRelease(b2._id.toString());
    await recordRelease(P(), rel._id.toString());
    const e = await BookErratum.findOne({ feedbackId: f._id });
    expect(e?.releaseId.equals(rel._id)).toBe(true);
    expect(e?.status).toBe("draft");
  });
});

describe("7 — routine teachers of subjects with no Subject row", () => {
  it("ARABIC / QURAN readers come from the routine slots of the class (live ones only)", async () => {
    const c3 = (await Class.findOne({ level: 3 }))!;
    const sec = (await Section.findOne({ classId: c3._id }))!;
    const slot = (teacherId: string, extra: object = {}) =>
      RoutineSlot.create({ groupType: "section", groupId: sec._id, classId: c3._id, dayOfWeek: "SUN", periodNumber: 1, subject: "ARABIC", track: "arabic", isBreak: false, effectiveFrom: new Date("2026-01-01"), active: true, teacherId, createdBy: teacherId, ...extra });
    const ar = new Types.ObjectId(school.otherTeacher.userId);
    await slot(ar.toString());
    const book = { classLevel: 3, subject: "ARABIC" } as never;
    expect((await bookTeachersNow(book)).has(school.otherTeacher.userId)).toBe(true);
    expect((await bookTeachersNow(book)).has(school.routineTeacher.userId)).toBe(false);
    // an ended slot does not count
    await RoutineSlot.deleteMany({});
    await slot(school.routineTeacher.userId, { effectiveTo: new Date("2026-02-01") });
    expect((await bookTeachersNow(book)).has(school.routineTeacher.userId)).toBe(false);
  });
});

describe("9/11/16 — photos, events, class books", () => {
  it("a report photo only counts for the book it was uploaded for; its upload is an event", async () => {
    const { book } = await releasedBook(P());
    const { book: b2 } = await releasedBook(P(), { code: "C3-BN2" });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]);
    const photo = await uploadReportPhoto(school.routineTeacher, book._id.toString(), { name: "p.png", data: png });
    await expect(fileTeacherReport(school.routineTeacher, b2._id.toString(), { category: "spelling", textBn: "ভুল", photoFileIds: [photo] })).rejects.toMatchObject({ code: "BAD_PHOTO" });
    await fileTeacherReport(school.routineTeacher, book._id.toString(), { category: "spelling", textBn: "ভুল", photoFileIds: [photo] });
    expect(await BookEvent.countDocuments({ bookId: book._id.toString(), kind: "FILE_UPLOADED", summary: /report photo/ })).toBe(1);
  });

  it("class books: not twice, not a superseded release; switching OFF hides what was published", async () => {
    const { book, release } = await releasedBook(P());
    await setClassBooksSwitch(P(), book._id.toString(), true);
    await publishToClassBooks(P(), release._id.toString());
    await expect(publishToClassBooks(P(), release._id.toString())).rejects.toMatchObject({ code: "ALREADY_PUBLISHED" });
    await setClassBooksSwitch(P(), book._id.toString(), false);
    expect(updateClassBook).toHaveBeenCalledWith(P().userId, "classbook-fixture-1", { active: false });
    expect((await loadBook(book._id)).publishStudentToClassBooks).toBe(false);
    await SchoolBook.updateOne({ _id: book._id }, { $set: { publishStudentToClassBooks: true } });
    await BookPrintRelease.updateOne({ _id: release._id }, { $set: { classBookId: "", status: "superseded" } });
    await expect(publishToClassBooks(P(), release._id.toString())).rejects.toMatchObject({ code: "SUPERSEDED" });
  });
});
