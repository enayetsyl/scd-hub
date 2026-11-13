/**
 * BL-2 — verbal errata (docs/prd-book-lifecycle.md §9.4, §19 bookLcErrata; D-#1598).
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { setupLc, teardownLc, resetBooks, item, childVersion, releasedBook, seedSchool, type LcFx, type School } from "./bookLcFixtures";
import { ackErratum, announceErratum, updateErratum } from "../modules/book-lifecycle/services/errataService";
import { myBooks } from "../modules/book-lifecycle/services/teacherService";
import { BookErratum } from "../modules/book-lifecycle/models/BookRelease";
import { Notification } from "../modules/notifications/models/Notification";
import { ForbiddenError } from "../middleware/authz";

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

it("verbal_errata → erratum draft → announce (finalize) → readers notified → ack → carried when applied", async () => {
  const { book } = await releasedBook(P());
  const f = await item(fx.auth.officeManage, book._id.toString(), "verbal_errata", { quote: "3টি নৌকা", chapterKey: "ch-003" });
  const e = await BookErratum.findOne({ feedbackId: f._id });
  expect(e?.code).toBe("E-1");
  expect(e?.status).toBe("draft");
  expect(e?.releaseId.equals(book.currentReleaseId!)).toBe(true);
  await updateErratum(fx.auth.officeManage, e!._id.toString(), { correctText: "তিনটি নৌকা", page: "৯" });
  await expect(announceErratum(fx.auth.officeManage, e!._id.toString())).rejects.toBeInstanceOf(ForbiddenError);
  await announceErratum(P(), e!._id.toString());
  const recipients = (await Notification.find({ kind: "BOOK_ERRATUM" }).lean()).map((n) => n.recipientUserId?.toString()).sort();
  expect(recipients).toEqual([school.routineTeacher.userId, school.classTeacher.userId].sort());
  await expect(ackErratum(school.otherTeacher, e!._id.toString())).rejects.toThrow(/শ্রেণি\/বিষয়ের নয়/);
  await ackErratum(school.routineTeacher, e!._id.toString());
  await ackErratum(school.routineTeacher, e!._id.toString());
  expect((await BookErratum.findById(e!._id))?.acks).toHaveLength(1);
  expect((await myBooks(school.classTeacher))[0].errata.map((x) => x.code)).toEqual(["E-1"]);
  const child = await childVersion(P(), book._id.toString(), "3টি নৌকা", "তিনটি নৌকা", [f.code]);
  expect((await BookErratum.findById(e!._id))?.carriedIntoVersionId?.equals(child._id)).toBe(true);
});

it("a draft erratum cannot be acknowledged and needs the correct text before it is announced", async () => {
  const { book } = await releasedBook(P());
  const f = await item(P(), book._id.toString(), "verbal_errata");
  const e = await BookErratum.findOne({ feedbackId: f._id });
  await expect(ackErratum(school.routineTeacher, e!._id.toString())).rejects.toThrow(/ঘোষণা হয়নি/);
  await expect(announceErratum(P(), e!._id.toString())).rejects.toThrow(/ঠিক লেখা/);
});
