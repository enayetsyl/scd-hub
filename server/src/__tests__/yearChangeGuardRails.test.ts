/**
 * YC-0 step 1 — year-change guard rails (docs/prd-year-change.md §5 row "YC-0", D-#1451).
 *
 *   gate      setCurrentAcademicYear is `year_change:cut_over` (Principal only): Office is
 *             refused, Principal passes; "add a year" keeps classes_sections:settings but
 *             makeCurrent on it needs the cut-over right too.
 *   sort      academicYears comes back newest startDate first (not label order).
 *   archive   no current year → 0 disposable, and dispose is refused.
 *   quran     a 2026 sitting is scored against its OWN exam paper after a 2027 paper
 *             for the same level is published.
 *   import    import-students.ts refuses when a non-current year has classes (source read).
 *   stray     delete-stray-year: dry run counts, refuses when referenced / current, applies
 *             only when empty.
 *
 * Real services on in-memory Mongo.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { graphql, type ExecutionResult } from "graphql";
import * as fs from "fs";
import * as path from "path";
import { builder } from "../schema";
import "../modules/foundation/resolvers/classes";
import type { AppContext } from "../context";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Exam } from "../modules/exams/models/Exam";
import { User } from "../modules/foundation/models/User";
import { ScriptBundle } from "../modules/archive/models/ScriptBundle";
import { listDisposable, listDisposablePage, disposeBundle } from "../modules/archive/services/ArchiveService";
import { QuranExamPlan } from "../modules/quran-exam/models/QuranExamPlan";
import { QuranExamPaper } from "../modules/quran-exam/models/QuranExamPaper";
import { QuranExamSitting } from "../modules/quran-exam/models/QuranExamSitting";
import {
  loadQuranExamSittings,
  myQuranExamSittings,
  publishQuranExam,
  saveQuranExamPaper,
  saveQuranExamResult,
} from "../modules/quran-exam/services/QuranExamService";
import { deleteStrayYear, strayYearReport } from "../modules/foundation/services/StrayYearService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  // ScriptBundle (and other registered models) carry a partial-index spec the in-memory
  // mongod rejects; the suite only needs their collections, so skip auto-indexing.
  mongoose.set("autoIndex", false);
  await mongoose.connect(mongo.getUri());
  await Promise.all(
    [AcademicYear, Class, Exam, User, QuranExamPlan, QuranExamPaper, QuranExamSitting].map((m) =>
      (m as unknown as mongoose.Model<unknown>).init(),
    ),
  );
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all(
    [AcademicYear, Class, Exam, User, ScriptBundle, QuranExamPlan, QuranExamPaper, QuranExamSitting].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

const schema = builder.toSchema();
type Auth = { role: string; userId: string };
const as = (role: string): { auth: Auth } => ({ auth: { role, userId: new Types.ObjectId().toString() } });
const run = (source: string, ctx: { auth: Auth | null }): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: ctx }) as Promise<ExecutionResult>;
const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

const yearDoc = (label: string, current = false, startYear = Number(label)) => ({
  label,
  startDate: new Date(Date.UTC(startYear, 0, 1)),
  endDate: new Date(Date.UTC(startYear, 11, 31)),
  current,
});

describe("YC-0: setCurrentAcademicYear needs year_change:cut_over", () => {
  it("Office is refused and nothing flips; Principal flips the year", async () => {
    const y26 = await AcademicYear.create(yearDoc("2026", true));
    const y27 = await AcademicYear.create(yearDoc("2027"));
    const q = `mutation { setCurrentAcademicYear(academicYearId: "${y27._id}") { id current } }`;

    expect(denied(await run(q, as("OFFICE")))).toBe(true);
    expect(denied(await run(q, as("TEACHER")))).toBe(true);
    expect((await AcademicYear.findById(y26._id))!.current).toBe(true);
    expect((await AcademicYear.findById(y27._id))!.current).toBe(false);

    const ok = await run(q, as("PRINCIPAL"));
    expect(denied(ok)).toBe(false);
    expect((await AcademicYear.findById(y27._id))!.current).toBe(true);
    expect((await AcademicYear.findById(y26._id))!.current).toBe(false);
  });

  it("Office can still add a year, but not flip through makeCurrent", async () => {
    const y26 = await AcademicYear.create(yearDoc("2026", true));
    expect(denied(await run(`mutation { createAcademicYear(label: "2027") { id } }`, as("OFFICE")))).toBe(false);
    expect(await AcademicYear.countDocuments({ label: "2027" })).toBe(1);

    const flip = await run(`mutation { createAcademicYear(label: "2028", makeCurrent: true) { id } }`, as("OFFICE"));
    expect(denied(flip)).toBe(true);
    expect(await AcademicYear.countDocuments({ label: "2028" })).toBe(0);
    expect((await AcademicYear.findById(y26._id))!.current).toBe(true);

    expect(denied(await run(`mutation { createAcademicYear(label: "2028", makeCurrent: true) { id } }`, as("PRINCIPAL")))).toBe(false);
    expect((await AcademicYear.findOne({ label: "2028" }))!.current).toBe(true);
  });
});

describe("YC-0: academicYears is sorted by startDate, newest first", () => {
  it("startDate beats label order", async () => {
    await AcademicYear.create(yearDoc("Z-old", false, 2024));
    await AcademicYear.create(yearDoc("A-new", true, 2027));
    await AcademicYear.create(yearDoc("M-mid", false, 2026));
    const r = await run(`query { academicYears { label } }`, as("TEACHER"));
    expect(denied(r)).toBe(false);
    expect((r.data as { academicYears: { label: string }[] }).academicYears.map((y) => y.label)).toEqual(["A-new", "M-mid", "Z-old"]);
  });
});

describe("YC-0: archive retention with no current year", () => {
  const bundleOf = (academicYearId: Types.ObjectId) => ({
    source: { kind: "CLASS_TEST", refId: new Types.ObjectId() },
    sourceLabel: "CT",
    academicYearId,
    classLevel: 4,
    sectionId: new Types.ObjectId(),
    subject: "MATH",
    testNumber: 1,
    examDate: new Date("2024-03-01"),
    scriptCount: 10,
    boxId: new Types.ObjectId(),
    filedBy: new Types.ObjectId(),
    filedAt: new Date(),
    status: "FILED",
    checkouts: [],
    attachmentFileIds: [],
  });

  it("marks 0 disposable and refuses to dispose when no year is current", async () => {
    const old = await AcademicYear.create(yearDoc("2024"));
    const b = await ScriptBundle.collection.insertOne(bundleOf(old._id));
    expect(await listDisposable()).toEqual([]);
    expect((await listDisposablePage({})).total).toBe(0);
    await expect(
      disposeBundle({ bundleId: b.insertedId.toString(), reason: "old", actorId: new Types.ObjectId().toString() }),
    ).rejects.toThrow("চলতি শিক্ষাবর্ষ");
    expect((await ScriptBundle.findById(b.insertedId))!.status).toBe("FILED");
  });

  it("control: with a current year the old bundle is disposable", async () => {
    const old = await AcademicYear.create(yearDoc("2024"));
    await AcademicYear.create(yearDoc("2026", true));
    await AcademicYear.create(yearDoc("2025"));
    await ScriptBundle.collection.insertOne(bundleOf(old._id));
    expect(await listDisposable()).toHaveLength(1);
    expect((await listDisposablePage({})).total).toBe(1);
  });
});

describe("YC-0: Quran exam sitting is scored against its own exam paper", () => {
  it("a 2026 sitting keeps its ITEMS total after a 2027 paper for the same level is published", async () => {
    const mkUser = async (name: string, role: string, n: string) =>
      (await User.collection.insertOne({ name, role, active: true, phone: `88017000009${n}`, passwordHash: "x", grantedPermissions: [], revokedPermissions: [], additionalTemplates: [] })).insertedId.toString();
    const officeId = await mkUser("Office", "OFFICE", "01");
    const examinerId = await mkUser("Examiner", "TEACHER", "02");
    const office = { auth: { userId: officeId, role: "OFFICE" } } as unknown as AppContext;
    const examiner = { auth: { userId: examinerId, role: "TEACHER", grantedPermissions: ["quran_exam:examine"] } } as unknown as AppContext;

    const mkExam = async (name: string) =>
      (await Exam.collection.insertOne({ academicYearId: new Types.ObjectId(), term: "ANNUAL", name, createdBy: new Types.ObjectId() })).insertedId.toString();
    const exam26 = await mkExam("Annual 2026");
    const exam27 = await mkExam("Annual 2027");
    const child = new Types.ObjectId().toString(); // fake child "Test Child A1"
    const group = new Types.ObjectId().toString();

    await loadQuranExamSittings(officeId, exam26, [
      { studentId: child, groupId: group, level: "Ammapara", dateKey: "2026-11-23", start: "07:00", end: "07:30", examinerId, portionLabel: "আম্মাপারা" },
    ]);
    await saveQuranExamPaper(office, exam26, {
      level: "Ammapara", scheme: "ITEMS", fullMarks: 10, durationMin: 30,
      sections: [{ title: "হিফজ", items: [{ label: "a", marks: 5 }, { label: "b", marks: 5 }] }],
    });
    await publishQuranExam(office, exam26, true);
    const sittingId = String((await QuranExamSitting.findOne({ examId: new Types.ObjectId(exam26) }).lean())!._id);
    await saveQuranExamResult(office, sittingId, { present: true, itemMarksFlat: [4, 5] });

    // 2027: the same level name, but a different scheme, published afterwards.
    await loadQuranExamSittings(officeId, exam27, [
      { studentId: child, groupId: group, level: "Ammapara", dateKey: "2027-11-22", start: "07:00", end: "07:30", examinerId, portionLabel: "আম্মাপারা" },
    ]);
    await saveQuranExamPaper(office, exam27, { level: "Ammapara", scheme: "HIFZ_DEDUCTION", fullMarks: 30, durationMin: 60, paras: [1, 2], tanbihPerMark: 4, fathCost: 2 });
    await publishQuranExam(office, exam27, true);

    const mine = await myQuranExamSittings(examiner, null);
    expect(mine).toHaveLength(2);
    const s26 = mine.find((s) => s.dateKey === "2026-11-23")!;
    expect(s26.total).toBe(9);
  });
});

describe("YC-0: import-students.ts guard", () => {
  it("refuses (exit 1) when a non-current year has classes; script is read, not run", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../scripts/import-students.ts"), "utf-8");
    const at = src.indexOf("REFUSED:");
    expect(at).toBeGreaterThan(0);
    expect(src).toContain("academicYearId: { $ne: currentYear._id }");
    // the guard sits before the first write (the year upsert / class upsert)
    expect(at).toBeLessThan(src.indexOf("findOneAndUpdate"));
    expect(src.slice(at, at + 500)).toContain("process.exit(1)");
  });
});

describe("YC-0: delete-stray-year script", () => {
  it("dry run counts; refuses when referenced; deletes only when empty and --apply", async () => {
    const stray = await AcademicYear.create(yearDoc("2029"));
    await AcademicYear.create(yearDoc("2026", true));
    const cls = await Class.collection.insertOne({ level: 3, nameBn: "তৃতীয়", academicYearId: stray._id, active: true });

    const rep = await strayYearReport("2029");
    expect(rep!.counts.find((c) => c.model === "Class")!.count).toBe(1);
    expect(rep!.counts.length).toBeGreaterThan(20); // every year-keyed model is listed
    expect(rep!.total).toBe(1);

    expect((await deleteStrayYear("2029", false)).refused).toContain("still referenced");
    expect((await deleteStrayYear("2029", true)).refused).toContain("still referenced");
    expect(await AcademicYear.countDocuments({ label: "2029" })).toBe(1);

    await Class.collection.deleteOne({ _id: cls.insertedId });
    const dry = await deleteStrayYear("2029", false);
    expect(dry.refused).toBeNull();
    expect(await AcademicYear.countDocuments({ label: "2029" })).toBe(1); // dry run writes nothing
    const applied = await deleteStrayYear("2029", true);
    expect(applied.refused).toBeNull();
    expect(await AcademicYear.countDocuments({ label: "2029" })).toBe(0);
  });

  it("never deletes the current year, and a missing label is reported", async () => {
    await AcademicYear.create(yearDoc("2029", true));
    expect((await deleteStrayYear("2029", true)).refused).toContain("CURRENT");
    expect(await AcademicYear.countDocuments({ label: "2029" })).toBe(1);
    expect((await deleteStrayYear("2031", true)).refused).toContain("no academic year");
  });
});
