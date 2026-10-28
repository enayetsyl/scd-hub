/**
 * D-#873–#877 — Quran oral exam (docs/prd-quran-exam.md), real services on in-memory Mongo.
 *
 *   load       sittings created once (re-run skips), overlaps refused
 *   paper      ITEMS must sum to full marks; frozen once a mark exists
 *   move       keeps the time when the new examiner is free, else their next free slot;
 *              nobody else's time changes; an added examiner shows on the day empty
 *   remove     the examiner's sittings go fewest-first; the last examiner cannot go
 *   marks      examiner only on their own published sitting; office (edit_all) on any;
 *              ITEMS flat marks reshaped + range-checked; Hifz counted across sittings
 *   absence    ABSENT, then make-up → SCHEDULED at the new time
 *   guardian   nothing before publish; SCHEDULE notice once; a move after publish →
 *              CHANGED with the old time; acknowledge clears it; examiner never exposed
 *   lock       refused while sittings are open; after lock every save is refused
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AppContext } from "../context";
import { Exam } from "../modules/exams/models/Exam";
import { User } from "../modules/foundation/models/User";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { QuranExamPlan } from "../modules/quran-exam/models/QuranExamPlan";
import { QuranExamPaper } from "../modules/quran-exam/models/QuranExamPaper";
import { QuranExamSitting } from "../modules/quran-exam/models/QuranExamSitting";
import { QuranExamGuardianSeen } from "../modules/quran-exam/models/QuranExamGuardianSeen";
import { QuranExamReminder } from "../modules/quran-exam/models/QuranExamReminder";
import {
  acknowledgeQuranExamNotice,
  addQuranExamExaminer,
  loadQuranExamSittings,
  lockQuranExamMarks,
  moveQuranExamSitting,
  myQuranExamSchedule,
  myQuranExamSittings,
  publishQuranExam,
  quranExamDay,
  quranExamResults,
  quranExamSittingDetail,
  removeQuranExamExaminer,
  saveQuranExamPaper,
  saveQuranExamResult,
  scheduleQuranExamMakeUp,
  quranExamMonitor,
  remindQuranExamExaminers,
  myQuranExamReminder,
  acknowledgeQuranExamReminder,
  setQuranExamGuardianNote,
} from "../modules/quran-exam/services/QuranExamService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let seq = 0;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all(
    [Exam, User, Class, Section, Student, Guardian, GuardianLink, QuranExamPlan, QuranExamPaper, QuranExamSitting, QuranExamGuardianSeen, QuranExamReminder].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

const ctxOf = (userId: string, role: string, extra: Record<string, unknown> = {}): AppContext =>
  ({ auth: { userId, role, ...extra } } as unknown as AppContext);

async function user(name: string, role = "TEACHER"): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({ name, role, active: true, phone: `8801700000${seq}`, passwordHash: "x", grantedPermissions: [], revokedPermissions: [], additionalTemplates: [] });
  return r.insertedId.toString();
}

async function student(name: string): Promise<string> {
  seq += 1;
  const c = await Class.collection.insertOne({ level: 4, nameBn: "চতুর্থ শ্রেণি", academicYearId: new Types.ObjectId(), active: true });
  const s = await Section.collection.insertOne({ classId: c.insertedId, code: `S${seq}`, nameBn: "বালক", active: true });
  const r = await Student.collection.insertOne({ schoolId: `S-${seq}`, name, classId: c.insertedId, sectionId: s.insertedId, active: true });
  return r.insertedId.toString();
}

async function guardianOf(studentId: string): Promise<string> {
  seq += 1;
  const r = await Guardian.collection.insertOne({ identifierKind: "phone", identifier: `0190000${seq}`, name: `G${seq}`, phone: `8801900000${seq}`, loginEnabled: true, active: true });
  await GuardianLink.collection.insertOne({ guardianId: r.insertedId, studentId: new Types.ObjectId(studentId), relation: "mother", active: true });
  return r.insertedId.toString();
}

const GROUP = new Types.ObjectId().toString();
const HIFZ_GROUP = new Types.ObjectId().toString();
const DAY = "2026-11-23";

async function setup() {
  const exam = await Exam.collection.insertOne({ academicYearId: new Types.ObjectId(), term: "ANNUAL", name: "Annual 2026", createdBy: new Types.ObjectId() });
  const examId = exam.insertedId.toString();
  const officeId = await user("Office", "OFFICE");
  const office = ctxOf(officeId, "OFFICE");
  const kuddus = await user("Kuddus");
  const momin = await user("Momin");
  const tabshir = await user("Tabshir");
  const a = await student("Ahsan Saeed");
  const b = await student("Abdullah Minhaz");
  const c = await student("Manha");
  const h = await student("Ibrahim Hossain");
  const sit = (studentId: string, examinerId: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
    studentId, groupId: GROUP, level: "Ammapara", dateKey: DAY, start, end, examinerId, portionLabel: "আম্মাপারা", ...extra,
  });
  await loadQuranExamSittings(officeId, examId, [
    sit(b, kuddus, "07:00", "07:30"),
    sit(a, kuddus, "08:30", "09:00"),
    sit(c, momin, "07:00", "07:30"),
    sit(h, kuddus, "07:00", "09:00", { groupId: HIFZ_GROUP, level: "Hifz 3", dateKey: "2026-11-15", paras: [1, 2], portionLabel: "২ পারা" }),
    sit(h, momin, "07:00", "08:00", { groupId: HIFZ_GROUP, level: "Hifz 3", dateKey: "2026-11-16", paras: [3], portionLabel: "১ পারা" }),
  ]);
  await saveQuranExamPaper(office, examId, {
    level: "Ammapara", scheme: "ITEMS", fullMarks: 90, durationMin: 30,
    sections: [
      { title: "হিফজ", items: [5, 5, 5, 5].map((m, i) => ({ label: `সুরা ${i}`, marks: m })) },
      { title: "রিডিং", items: [15, 15, 15, 15].map((m, i) => ({ label: `রিডিং ${i}`, marks: m })) },
      { title: "দোয়া", items: [2, 2, 2, 2, 2].map((m, i) => ({ label: `দোয়া ${i}`, marks: m })) },
    ],
  });
  await saveQuranExamPaper(office, examId, { level: "Hifz 3", scheme: "HIFZ_DEDUCTION", fullMarks: 30, durationMin: 120, paras: [1, 2, 3, 4, 5], tanbihPerMark: 4, fathCost: 2 });
  const sittingOf = async (studentId: string, dateKey = DAY) =>
    String((await QuranExamSitting.findOne({ studentId: new Types.ObjectId(studentId), dateKey }).lean())!._id);
  const examiner = (id: string) => ctxOf(id, "TEACHER");
  return { examId, officeId, office, kuddus, momin, tabshir, a, b, c, h, sittingOf, examiner };
}

const FULL_OK = [5, 5, 4, 5, 14, 13, 15, 12, 2, 2, 1, 2, 2]; // 82

describe("Quran exam: load + papers", () => {
  it("re-running the load skips existing sittings; an overlap is refused", async () => {
    const t = await setup();
    const again = await loadQuranExamSittings(t.officeId, t.examId, [
      { studentId: t.a, groupId: GROUP, level: "Ammapara", dateKey: DAY, start: "08:30", end: "09:00", examinerId: t.kuddus, portionLabel: "x" },
    ]);
    expect(again).toEqual({ created: 0, skipped: 1 });
    const x = await student("Extra");
    await expect(
      loadQuranExamSittings(t.officeId, t.examId, [
        { studentId: x, groupId: GROUP, level: "Ammapara", dateKey: DAY, start: "07:15", end: "07:45", examinerId: t.kuddus, portionLabel: "x" },
      ]),
    ).rejects.toThrow(/সময় মিলে যাচ্ছে/);
  });

  it("an ITEMS paper must sum to its full marks, and freezes after the first mark", async () => {
    const t = await setup();
    await expect(
      saveQuranExamPaper(t.office, t.examId, { level: "Qaida", scheme: "ITEMS", fullMarks: 100, durationMin: 30, sections: [{ title: "হিফজ", items: [{ label: "x", marks: 20 }] }] }),
    ).rejects.toThrow(/যোগফল 20/);
    await saveQuranExamResult(t.office, await t.sittingOf(t.b), { present: true, itemMarksFlat: FULL_OK });
    await expect(
      saveQuranExamPaper(t.office, t.examId, { level: "Ammapara", scheme: "ITEMS", fullMarks: 5, durationMin: 30, sections: [{ title: "হিফজ", items: [{ label: "x", marks: 5 }] }] }),
    ).rejects.toThrow(/বদলানো যাবে না/);
  });
});

describe("Quran exam: examiners (D-#875)", () => {
  it("a move keeps the time when the new examiner is free; nobody else moves", async () => {
    const t = await setup();
    await addQuranExamExaminer(t.office, t.examId, DAY, t.tabshir);
    let day = await quranExamDay(t.examId, DAY);
    expect(day.examiners.map((e) => [e.name, e.sittings.length])).toEqual([["Kuddus", 2], ["Momin", 1], ["Tabshir", 0]]);
    const moved = await moveQuranExamSitting(t.office, await t.sittingOf(t.a), t.tabshir);
    expect(moved).toMatchObject({ examinerName: "Tabshir", start: "08:30", end: "09:00" });
    day = await quranExamDay(t.examId, DAY);
    expect(day.examiners.find((e) => e.name === "Kuddus")!.sittings.map((s) => s.start)).toEqual(["07:00"]);
  });

  it("onto a busy examiner the student takes their next free slot", async () => {
    const t = await setup();
    const moved = await moveQuranExamSitting(t.office, await t.sittingOf(t.c), t.kuddus);
    expect(moved).toMatchObject({ start: "09:00", end: "09:30" });
  });

  it("removing an examiner shares their students out fewest-first; the last cannot go", async () => {
    const t = await setup();
    await addQuranExamExaminer(t.office, t.examId, DAY, t.tabshir);
    expect(await removeQuranExamExaminer(t.office, t.examId, DAY, t.kuddus)).toBe(2);
    const day = await quranExamDay(t.examId, DAY);
    // Kuddus's 2 go fewest-first: the first to Tabshir (0), the second to Momin (tie, listed first).
    expect(day.examiners.map((e) => [e.name, e.sittings.length])).toEqual([["Momin", 2], ["Tabshir", 1]]);
    await removeQuranExamExaminer(t.office, t.examId, DAY, t.tabshir);
    await expect(removeQuranExamExaminer(t.office, t.examId, DAY, t.momin)).rejects.toThrow(/শেষ পরীক্ষক/);
  });
});

describe("Quran exam: marks + absence (D-#874/#876)", () => {
  const EXAMINE = { grantedPermissions: ["quran_exam:examine"] };

  it("an examiner sees and marks only their own sittings, and only once published", async () => {
    const t = await setup();
    const k = ctxOf(t.kuddus, "TEACHER", EXAMINE);
    const m = ctxOf(t.momin, "TEACHER", EXAMINE);
    expect(await myQuranExamSittings(k, null)).toEqual([]);
    await expect(quranExamSittingDetail(k, await t.sittingOf(t.a))).rejects.toThrow(/আপনার নয়/);
    await publishQuranExam(t.office, t.examId, true);
    expect((await myQuranExamSittings(k, DAY)).map((s) => s.studentName)).toEqual(["Abdullah Minhaz", "Ahsan Saeed"]);
    await expect(saveQuranExamResult(m, await t.sittingOf(t.a), { present: true, itemMarksFlat: FULL_OK })).rejects.toThrow(/আপনার নয়/);
    const d = await saveQuranExamResult(k, await t.sittingOf(t.a), { present: true, itemMarksFlat: FULL_OK, comment: "ভালো" });
    expect(d.sitting).toMatchObject({ status: "DONE", total: 82, comment: "ভালো" });
    expect(d.sitting.itemMarks).toEqual([[5, 5, 4, 5], [14, 13, 15, 12], [2, 2, 1, 2, 2]]);
    await expect(saveQuranExamResult(k, await t.sittingOf(t.b), { present: true, itemMarksFlat: [6, ...FULL_OK.slice(1)] })).rejects.toThrow(/০ থেকে 5/);
    await expect(saveQuranExamResult(k, await t.sittingOf(t.b), { present: true, itemMarksFlat: [1, 2] })).rejects.toThrow(/মেলেনি/);
  });

  it("Hifz marks are computed over every sitting: 30 − floor(T/4) − 2F", async () => {
    const t = await setup();
    await saveQuranExamResult(t.office, await t.sittingOf(t.h, "2026-11-15"), {
      present: true, hifzCounts: [{ para: 1, tanbih: 3, fath: 1 }, { para: 2, tanbih: 2, fath: 0 }],
    });
    let r = (await quranExamResults(t.examId)).find((x) => x.studentId === t.h)!;
    expect(r).toMatchObject({ done: 1, sittings: 2, mark: null });
    const d = await saveQuranExamResult(t.office, await t.sittingOf(t.h, "2026-11-16"), { present: true, hifzCounts: [{ para: 3, tanbih: 4, fath: 1 }] });
    expect(d.hifzSoFar).toMatchObject({ tanbih: 9, fath: 2, tanbihCut: 2, fathCut: 4, mark: 24 });
    expect(d.otherSittings.map((s) => s.portionLabel)).toEqual(["২ পারা"]);
    r = (await quranExamResults(t.examId)).find((x) => x.studentId === t.h)!;
    expect(r).toMatchObject({ mark: 24, fullMarks: 30, tanbih: 9, fath: 2 });
  });

  it("absent → make-up at a new time → scheduled again", async () => {
    const t = await setup();
    const id = await t.sittingOf(t.a);
    const d = await saveQuranExamResult(t.office, id, { present: false, absenceReason: "SICK" });
    expect(d.sitting).toMatchObject({ status: "ABSENT", absenceReason: "SICK" });
    const m = await scheduleQuranExamMakeUp(t.office, id, "2026-11-25", "07:00", t.momin);
    expect(m).toMatchObject({ status: "SCHEDULED", dateKey: "2026-11-25", start: "07:00", end: "07:30", examinerName: "Momin", madeUp: true });
  });

  it("lock is refused while sittings are open; after lock nothing saves", async () => {
    const t = await setup();
    await expect(lockQuranExamMarks(t.office, t.examId, true)).rejects.toThrow(/বাকি/);
    for (const s of [t.a, t.b, t.c]) await saveQuranExamResult(t.office, await t.sittingOf(s), { present: true, itemMarksFlat: FULL_OK });
    for (const dk of ["2026-11-15", "2026-11-16"]) await saveQuranExamResult(t.office, await t.sittingOf(t.h, dk), { present: false });
    const o = await lockQuranExamMarks(t.office, t.examId, true);
    expect(o.marksLockedAt).not.toBeNull();
    await expect(saveQuranExamResult(t.office, await t.sittingOf(t.a), { present: false })).rejects.toThrow(/লক/);
    await expect(moveQuranExamSitting(t.office, await t.sittingOf(t.a), t.momin)).rejects.toThrow(/লক/);
  });
});

describe("Quran exam: guardians (D-#877)", () => {
  it("nothing before publish; the schedule notice once; a move after publish shows old → new", async () => {
    const t = await setup();
    const g = await guardianOf(t.a);
    expect(await myQuranExamSchedule(g)).toEqual([]);
    await publishQuranExam(t.office, t.examId, true);
    let [child] = await myQuranExamSchedule(g);
    expect(child).toMatchObject({ studentName: "Ahsan Saeed", notice: "SCHEDULE", version: 0 });
    expect(child!.sittings[0]).toMatchObject({ dateKey: DAY, start: "08:30", portionLabel: "আম্মাপারা", changed: false });
    expect(JSON.stringify(child)).not.toMatch(/Kuddus|examiner/i);
    await acknowledgeQuranExamNotice(g, t.examId, t.a, child!.version);
    expect((await myQuranExamSchedule(g))[0]!.notice).toBe("NONE");

    await addQuranExamExaminer(t.office, t.examId, DAY, t.tabshir);
    await moveQuranExamSitting(t.office, await t.sittingOf(t.c), t.tabshir); // Momin → Tabshir, time kept: no change for anyone
    await moveQuranExamSitting(t.office, await t.sittingOf(t.a), t.momin); // 08:30 kept (Momin free then)
    expect((await myQuranExamSchedule(g))[0]!.notice).toBe("NONE");
    await moveQuranExamSitting(t.office, await t.sittingOf(t.a), t.tabshir); // Tabshir busy 07:00 only → 08:30 kept
    await moveQuranExamSitting(t.office, await t.sittingOf(t.b), t.tabshir); // b: 07:00 clashes → after 08:30–09:00 → 09:00
    const gb = await guardianOf(t.b);
    [child] = await myQuranExamSchedule(gb);
    expect(child).toMatchObject({ notice: "SCHEDULE" }); // never acknowledged → still the schedule pop-up
    await acknowledgeQuranExamNotice(gb, t.examId, t.b, 0);
    [child] = await myQuranExamSchedule(gb);
    expect(child).toMatchObject({ notice: "CHANGED", version: 1 });
    expect(child!.sittings[0]).toMatchObject({ start: "09:00", changed: true, fromStart: "07:00", fromEnd: "07:30" });
    await acknowledgeQuranExamNotice(gb, t.examId, t.b, 1);
    expect((await myQuranExamSchedule(gb))[0]!.notice).toBe("NONE");
  });

  it("a guardian cannot acknowledge another family's child", async () => {
    const t = await setup();
    const g = await guardianOf(t.a);
    await expect(acknowledgeQuranExamNotice(g, t.examId, t.b, 0)).rejects.toThrow(/অনুমতি নেই/);
  });
});

describe("Quran exam: monitor + reminders + guardian note (D-#878/#877)", () => {
  // Mon 23 Nov 08:05 Dhaka = 02:05Z.
  const AT = new Date("2026-11-23T02:05:00Z");

  it("overdue = past its end with no marks and not absent, grouped by examiner", async () => {
    const t = await setup();
    const m = await quranExamMonitor(t.examId, AT);
    expect(m).toMatchObject({ asOfDateKey: DAY, asOfTime: "08:05", total: 5, overdue: 4, upcoming: 1, done: 0, absent: 0 });
    expect(m.examiners.map((e) => [e.name, e.overdue])).toEqual([["Kuddus", 2], ["Momin", 2]]);
    await saveQuranExamResult(t.office, await t.sittingOf(t.c), { present: false });
    const m2 = await quranExamMonitor(t.examId, AT);
    expect(m2.absentSittings.map((s) => s.studentName)).toEqual(["Manha"]);
    expect(m2.examiners.map((e) => [e.name, e.overdue])).toEqual([["Kuddus", 2], ["Momin", 1]]);
  });

  it("a reminder reaches the examiner with the live count and clears itself once the marks are in", async () => {
    const t = await setup();
    expect(await remindQuranExamExaminers(t.office, t.examId, [t.kuddus], AT)).toBe(1);
    const k = ctxOf(t.kuddus, "TEACHER");
    const m = ctxOf(t.momin, "TEACHER");
    expect(await myQuranExamReminder(m, AT)).toBeNull();
    const r = await myQuranExamReminder(k, AT);
    expect(r).toMatchObject({ pending: 2 });
    await expect(acknowledgeQuranExamReminder(m, r!.id)).rejects.toThrow(/পাওয়া যায়নি/);
    await saveQuranExamResult(t.office, await t.sittingOf(t.b), { present: true, itemMarksFlat: FULL_OK });
    expect((await myQuranExamReminder(k, AT))!.pending).toBe(1);
    await saveQuranExamResult(t.office, await t.sittingOf(t.h, "2026-11-15"), { present: false });
    expect(await myQuranExamReminder(k, AT)).toBeNull();
    expect(await remindQuranExamExaminers(t.office, t.examId, null, AT)).toBe(1); // only Momin still owes
    const rm = await myQuranExamReminder(m, AT);
    expect(await acknowledgeQuranExamReminder(m, rm!.id)).toBe(true);
    expect(await myQuranExamReminder(m, AT)).toBeNull();
  });

  it("the guardian sees the Office note only when one was written", async () => {
    const t = await setup();
    const g = await guardianOf(t.a);
    await publishQuranExam(t.office, t.examId, true);
    expect((await myQuranExamSchedule(g))[0]!.guardianNote).toBeNull();
    await setQuranExamGuardianNote(t.office, t.examId, "  সকাল ৬:৫০-এর মধ্যে আসবে  ");
    expect((await myQuranExamSchedule(g))[0]!.guardianNote).toBe("সকাল ৬:৫০-এর মধ্যে আসবে");
    await setQuranExamGuardianNote(t.office, t.examId, "   ");
    expect((await myQuranExamSchedule(g))[0]!.guardianNote).toBeNull();
  });
});
