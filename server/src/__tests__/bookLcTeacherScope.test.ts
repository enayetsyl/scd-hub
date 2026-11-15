/**
 * BL-2 — teacher scope (docs/prd-book-lifecycle.md §7.3, §19 bookLcTeacherScope; owner Q5, D-#1597).
 * Readers = that class and subject's routine teachers + the class teacher. They get only the released
 * Teacher edition, the errata and their own reports — never master, drafts or rounds.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { setupLc, teardownLc, resetBooks, releasedBook, seedSchool, type LcFx, type School } from "./bookLcFixtures";
import { bookTeachersNow } from "../modules/book-lifecycle/services/teacherScope";
import { fileTeacherReport, myBooks, myReports, teacherMayRead, uploadReportPhoto } from "../modules/book-lifecycle/services/teacherService";
import { assertBookLcFileReadAccess } from "../modules/book-lifecycle/routes/bookLcFiles";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { ForbiddenError } from "../middleware/authz";
import type { AppContext } from "../context";

let fx: LcFx;
let school: School;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => {
  await resetBooks();
  school = await seedSchool();
});
const P = () => fx.auth.principal;
const ctx = (a: unknown) => ({ auth: a }) as AppContext;

it("routine teacher of class+subject and the class teacher are readers; others are not", async () => {
  const { book } = await releasedBook(P());
  const readers = await bookTeachersNow(book);
  expect(readers.has(school.routineTeacher.userId)).toBe(true);
  expect(readers.has(school.classTeacher.userId)).toBe(true);
  expect(readers.has(school.otherTeacher.userId)).toBe(false);
  expect(readers.has(fx.auth.office.userId)).toBe(false);
  expect(readers.has(fx.auth.guardian.userId)).toBe(false);
});

it("readers see only the released Teacher edition and errata (never master / packet files)", async () => {
  const { book, version } = await releasedBook(P());
  const rows = await myBooks(school.routineTeacher);
  expect(rows.map((r) => r.book.code)).toEqual([book.code]);
  expect(await myBooks(school.otherTeacher)).toEqual([]);
  const teacherFile = await StoredFile.findById(version.files.find((f) => f.role === "edition" && f.edition === "TEACHER")!.storedFileId);
  const studentFile = await StoredFile.findById(version.files.find((f) => f.role === "edition" && f.edition === "STUDENT")!.storedFileId);
  const masterFile = await StoredFile.findById(version.files.find((f) => f.role === "master_md")!.storedFileId);
  expect(await teacherMayRead(school.routineTeacher, teacherFile!)).toBe(true);
  await expect(assertBookLcFileReadAccess(ctx(school.classTeacher), teacherFile!)).resolves.toBeUndefined();
  for (const f of [studentFile!, masterFile!]) await expect(assertBookLcFileReadAccess(ctx(school.routineTeacher), f)).rejects.toBeInstanceOf(ForbiddenError);
  await expect(assertBookLcFileReadAccess(ctx(school.otherTeacher), teacherFile!)).rejects.toBeInstanceOf(ForbiddenError);
  await expect(assertBookLcFileReadAccess(ctx(fx.auth.guardian), teacherFile!)).rejects.toBeInstanceOf(ForbiddenError);
});

it("the report form needs `report` + scope; reporters see only their own reports", async () => {
  const { book } = await releasedBook(P());
  const id = book._id.toString();
  await expect(fileTeacherReport(school.otherTeacher, id, { category: "spelling", textBn: "ভুল", page: "৭" })).rejects.toThrow(/শ্রেণি\/বিষয়ের নয়/);
  await expect(fileTeacherReport(fx.auth.teacher, id, { category: "spelling", textBn: "ভুল" })).rejects.toBeInstanceOf(ForbiddenError);
  const photo = await uploadReportPhoto(school.routineTeacher, id, { name: "page.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mime: "image/png" });
  const f = await fileTeacherReport(school.routineTeacher, id, { category: "spelling", textBn: "বানান ভুল", page: "৭", quote: "নৌকা", photoFileIds: [photo] });
  expect(f.source).toBe("teacher");
  expect(f.reporterId?.toString()).toBe(school.routineTeacher.userId);
  expect(f.releaseId).toBeDefined();
  await fileTeacherReport(school.classTeacher, id, { category: "fact", textBn: "তথ্য ভুল" });
  expect((await myReports(school.routineTeacher)).map((x) => x.code)).toEqual([f.code]);
  const pf = await StoredFile.findById(photo);
  await expect(assertBookLcFileReadAccess(ctx(school.routineTeacher), pf!)).resolves.toBeUndefined();
  await expect(assertBookLcFileReadAccess(ctx(school.classTeacher), pf!)).rejects.toBeInstanceOf(ForbiddenError);
});
