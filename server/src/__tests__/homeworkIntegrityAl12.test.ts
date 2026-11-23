/**
 * AL-12 - outside-help flag extensions (docs/prd-academic-loop-2027.md section 3.4, journey H, AC-H1..H6, R16/R18/R32,
 * D-#1676). In-memory Mongo, real services; only the routine lookup (the subject teacher) is stubbed.
 *
 *   AC-H1  the gap is the policy key `integrityGapPoints` (85/60 opens, 75/60 not, 15 opens the second)
 *   AC-H6  one CT item and 90 % / 50 % opens a case (the rule is unchanged, R18)
 *   AC-H2  a NEW case notifies the class teacher + each Principal once; a recompute of the same case sends nothing;
 *          nobody else (no guardian, no subject teacher, no other শাখা)
 *   AC-H3  a class teacher sees / records / notes only own শাখা; the subject teacher only own subject there; a teacher of
 *          another শাখা is refused (reads like "not found"); view_all sees every case
 *   AC-H4  GUARDIAN_DID -> staff tag + the guardian's gentle note until the term ends; UNCLEAR -> staff tag only;
 *          CHILD_DID -> no tag; closing changes no mark
 *   AC-H5  the recurring badge follows `integrityRecurringCases`
 *   the settings save moves only the two keys (the release switch stays), validates, audits
 *   runs REGARDLESS of the release switch (it is OFF throughout this file)
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mockSubjectTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({
  resolveSubjectTeacher: (...a: unknown[]) => mockSubjectTeacher(...a),
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { User } from "../modules/foundation/models/User";
import { MasteryEvidence } from "../modules/mastery/models/MasteryEvidence";
import { MasteryPolicy } from "../modules/mastery/models/MasteryPolicy";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { graphql } from "graphql";
import { builder } from "../schema";
import "../modules/homework-integrity/resolvers/homeworkHelpNote";
import { Notification } from "../modules/notifications/models/Notification";
import { Audit } from "../modules/platform/models/Audit";
import { termEndOf } from "../lib/academicTerm";
import { IntegrityCase } from "../modules/homework-integrity/models/IntegrityCase";
import {
  addCaseNote,
  backfillInvestigators,
  caseDetail,
  integrityPolicy,
  listCases,
  recomputeForStudentsLos,
  recordOutcome,
  saveIntegrityPolicy,
  type IntegrityActor,
} from "../modules/homework-integrity/services/IntegrityService";
import {
  GUARDIAN_HELP_NOTE_BN,
  guardianNotesFor,
  tagsForSection,
  tagsForStudent,
} from "../modules/homework-integrity/services/IntegrityTagService";

jest.setTimeout(240_000);

let mongo: MongoMemoryServer;
let year: Types.ObjectId;
let secA: Types.ObjectId;
let secB: Types.ObjectId;
const kidsA: Types.ObjectId[] = [];
let kidB: Types.ObjectId;
const classTeacherA = new Types.ObjectId();
const classTeacherB = new Types.ObjectId();
const subjectTeacherA = new Types.ObjectId();
const principals: Types.ObjectId[] = [];
let lo = 0;
const nextLo = () => `LO-AL12-${++lo}`;
const actorOf = (id: Types.ObjectId | string, all = false, role = "TEACHER"): IntegrityActor => ({ userId: String(id), role, all });
const OFFICE = actorOf(new Types.ObjectId(), true, "OFFICE");
const PRINCIPAL = { userId: String(new Types.ObjectId()), role: "PRINCIPAL" };

let seq = 0;
async function ev(s: Types.ObjectId, section: Types.ObjectId, loCode: string, source: string, earned: number, available: number, day: string, subject = "MATH"): Promise<void> {
  await MasteryEvidence.create({
    studentId: s, sectionId: section, academicYearId: year, classToken: "C3", subject, loCode, source, paperId: new Types.ObjectId(),
    itemNo: ++seq, earned, available, at: new Date(`${day}T06:00:00Z`), week: "2027-W01",
  });
}
/** HW% = hw/100, CT% = ct/100 on a fresh objective; returns the objective. */
async function pair(s: Types.ObjectId, section: Types.ObjectId, hw: number, ct: number, subject = "MATH"): Promise<string> {
  const l = nextLo();
  await ev(s, section, l, "HW", hw, 100, "2027-03-01", subject);
  await ev(s, section, l, "CT", ct, 100, "2027-03-10", subject);
  return l;
}
const recompute = (s: Types.ObjectId, l: string) => recomputeForStudentsLos([{ studentId: String(s), loCode: l }], year);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [y] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"), current: true }]);
  year = y._id;
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year }]);
  const [a, b] = await Section.create([
    { classId: cls._id, code: "A", nameBn: "ক", classTeacherId: classTeacherA },
    { classId: cls._id, code: "B", nameBn: "খ", classTeacherId: classTeacherB },
  ]);
  secA = a._id;
  secB = b._id;
  for (let i = 1; i <= 4; i++) {
    const [st] = await Student.create([{ schoolId: `AL12-A${i}`, name: `Child A${i}`, rollNumber: String(i), classId: cls._id, sectionId: secA, active: true }]);
    kidsA.push(st._id);
  }
  const [sb] = await Student.create([{ schoolId: "AL12-B1", name: "Child B1", rollNumber: "1", classId: cls._id, sectionId: secB, active: true }]);
  kidB = sb._id;
  for (const [i, phone] of ["01700000121", "01700000122"].entries()) {
    const [p] = await User.create([{ role: "PRINCIPAL", name: `Head ${i}`, phone, passwordHash: "x", active: true }]);
    principals.push(p._id);
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  mockSubjectTeacher.mockReset();
  mockSubjectTeacher.mockImplementation(async (sectionId: unknown, subject: unknown) => (String(sectionId) === String(secA) && subject === "MATH" ? String(subjectTeacherA) : null));
});

describe("AC-H1 / AC-H6: the gap is a policy key; the rule is unchanged", () => {
  it("defaults to 20 / 2; 85 vs 60 opens a case, 75 vs 60 does not; a gap of 15 opens the second", async () => {
    expect(await integrityPolicy()).toEqual({ gapPoints: 20, recurringCases: 2 });
    const a = await pair(kidsA[0]!, secA, 85, 60);
    const b = await pair(kidsA[0]!, secA, 75, 60);
    expect((await recompute(kidsA[0]!, a)).opened).toBe(1);
    expect((await recompute(kidsA[0]!, b)).opened).toBe(0);
    expect(await IntegrityCase.countDocuments({ studentId: kidsA[0], loCode: b })).toBe(0);

    await saveIntegrityPolicy({ gapPoints: 15, recurringCases: 2 }, PRINCIPAL);
    expect((await recompute(kidsA[0]!, b)).opened).toBe(1);
    await saveIntegrityPolicy({ gapPoints: 20, recurringCases: 2 }, PRINCIPAL);
  });

  it("AC-H6: ONE class-test item with HW 90 % / CT 50 % is a case (no minimum-questions filter)", async () => {
    const l = nextLo();
    await ev(kidsA[1]!, secA, l, "HW", 90, 100, "2027-03-01");
    await ev(kidsA[1]!, secA, l, "CT", 1, 2, "2027-03-10"); // one item, 50 %
    expect((await recompute(kidsA[1]!, l)).opened).toBe(1);
  });

  it("the settings save moves ONLY the two keys, validates, and audits", async () => {
    await MasteryPolicy.updateOne({ scopeKey: "SCHOOL" }, { $set: { "values.academicLoop2027On": false, "values.minutesPerMark": 1.5 } }, { upsert: true });
    await expect(saveIntegrityPolicy({ gapPoints: 0, recurringCases: 2 }, PRINCIPAL)).rejects.toThrow();
    await expect(saveIntegrityPolicy({ gapPoints: 101, recurringCases: 2 }, PRINCIPAL)).rejects.toThrow();
    await expect(saveIntegrityPolicy({ gapPoints: 20, recurringCases: 1 }, PRINCIPAL)).rejects.toThrow();
    await expect(saveIntegrityPolicy({ gapPoints: 20, recurringCases: 2.5 }, PRINCIPAL)).rejects.toThrow();
    expect(await saveIntegrityPolicy({ gapPoints: 25, recurringCases: 3 }, PRINCIPAL)).toEqual({ gapPoints: 25, recurringCases: 3 });
    const row = await MasteryPolicy.findOne({ scopeKey: "SCHOOL" }).lean();
    expect(row?.values).toMatchObject({ academicLoop2027On: false, minutesPerMark: 1.5, integrityGapPoints: 25, integrityRecurringCases: 3 });
    let audits = 0;
    for (let i = 0; i < 20 && audits === 0; i++) {
      audits = await Audit.countDocuments({ eventKind: "HOMEWORK_INTEGRITY_SETTINGS" });
      if (audits === 0) await new Promise((r) => setTimeout(r, 50)); // the audit write is fire-and-forget
    }
    expect(audits).toBeGreaterThanOrEqual(1);
    await saveIntegrityPolicy({ gapPoints: 20, recurringCases: 2 }, PRINCIPAL);
  });
});

describe("AC-H2: a new case notifies the class teacher + each Principal once", () => {
  it("one INTEGRITY_CASE per recipient; a recompute and a numbers update send nothing more; nobody else is told", async () => {
    const before = await Notification.countDocuments({ kind: "INTEGRITY_CASE" });
    const l = await pair(kidsA[2]!, secA, 100, 20);
    expect((await recompute(kidsA[2]!, l)).opened).toBe(1);
    const c = (await IntegrityCase.findOne({ studentId: kidsA[2], loCode: l }))!;
    expect((c.investigatorIds ?? []).map(String).sort()).toEqual([String(classTeacherA), String(subjectTeacherA)].sort());

    const rows = await Notification.find({ kind: "INTEGRITY_CASE", "refs.studentId": String(kidsA[2]) }).lean();
    expect(rows).toHaveLength(3); // the class teacher + 2 Principals
    expect(rows.map((r) => String(r.recipientUserId)).sort()).toEqual([String(classTeacherA), ...principals.map(String)].sort());
    expect(rows.every((r) => !r.recipientGuardianId)).toBe(true);
    expect(rows.some((r) => String(r.recipientUserId) === String(subjectTeacherA))).toBe(false);
    expect(rows.some((r) => String(r.recipientUserId) === String(classTeacherB))).toBe(false);
    expect(rows[0]!.refs?.sectionId).toBe(String(secA));
    expect(rows.every((r) => r.bodyBn.includes("Child A3"))).toBe(true);
    expect(rows.every((r) => !/\d/.test(r.bodyBn.replace(/Child A3/, "")))).toBe(true); // no marks in the notice

    await recompute(kidsA[2]!, l);
    await ev(kidsA[2]!, secA, l, "CT", 10, 100, "2027-03-20"); // the numbers move: an UPDATE, not a new case
    const r = await recompute(kidsA[2]!, l);
    expect(r.updated).toBe(1);
    expect(await Notification.countDocuments({ kind: "INTEGRITY_CASE" })).toBe(before + 3);
  });

  it("a case whose subject has no teacher in the routine still opens (class teacher only as investigator)", async () => {
    const l = await pair(kidsA[3]!, secA, 100, 0, "ENG");
    expect((await recompute(kidsA[3]!, l)).opened).toBe(1);
    const c = (await IntegrityCase.findOne({ studentId: kidsA[3], loCode: l }))!;
    expect((c.investigatorIds ?? []).map(String)).toEqual([String(classTeacherA)]);
  });
});

describe("AC-H3: reach is row-scoped", () => {
  let caseA = "";
  let caseB = "";
  beforeAll(async () => {
    const la = await pair(kidsA[0]!, secA, 100, 0);
    await recompute(kidsA[0]!, la);
    caseA = String((await IntegrityCase.findOne({ studentId: kidsA[0], loCode: la }))!._id);
    const lb = await pair(kidB, secB, 100, 0);
    await recompute(kidB, lb);
    caseB = String((await IntegrityCase.findOne({ studentId: kidB, loCode: lb }))!._id);
  });

  it("the class teacher lists and reads own শাখা's cases only", async () => {
    const mine = await listCases({ status: "OPEN" }, actorOf(classTeacherA));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.sectionId === String(secA))).toBe(true);
    expect(mine.some((r) => r.id === caseA)).toBe(true);
    expect((await caseDetail(caseA, actorOf(classTeacherA))).investigatorNames.length).toBeGreaterThan(0);
    await expect(caseDetail(caseB, actorOf(classTeacherA))).rejects.toThrow(/পাওয়া যায়নি/);
  });

  it("the subject teacher reaches the case of own subject in that শাখা (and only there)", async () => {
    const st = actorOf(subjectTeacherA);
    expect((await listCases({ status: "OPEN" }, st)).some((r) => r.id === caseA)).toBe(true);
    expect((await caseDetail(caseA, st)).id).toBe(caseA);
    await expect(caseDetail(caseB, st)).rejects.toThrow();
    // a case of another subject in the same শাখা, with no investigator named: the live routine lookup is the row rule
    const eng = (await IntegrityCase.findOne({ subject: "ENG", sectionId: secA }))!;
    await expect(caseDetail(String(eng._id), st)).rejects.toThrow();
  });

  it("a teacher of another শাখা is refused on read, note and record; view_all sees every case", async () => {
    const other = actorOf(classTeacherB);
    expect((await listCases({}, other)).every((r) => r.sectionId === String(secB))).toBe(true);
    await expect(caseDetail(caseA, other)).rejects.toThrow();
    await expect(addCaseNote(caseA, "hello", other)).rejects.toThrow();
    await expect(recordOutcome(caseA, "CHILD_DID", null, other)).rejects.toThrow();
    expect((await IntegrityCase.findById(caseA))!.status).toBe("OPEN");
    const all = await listCases({ status: "OPEN" }, OFFICE);
    expect(all.some((r) => r.id === caseA) && all.some((r) => r.id === caseB)).toBe(true);
  });

  it("any investigator adds notes (open or closed); empty is refused; the author sees `mine`", async () => {
    await expect(addCaseNote(caseA, "   ", actorOf(classTeacherA))).rejects.toThrow();
    const d1 = await addCaseNote(caseA, "অভিভাবকের সাথে কথা হবে", actorOf(classTeacherA));
    const d2 = await addCaseNote(caseA, "বিষয় শিক্ষকের মতামত", actorOf(subjectTeacherA));
    expect(d2.notes.map((n) => n.text)).toEqual(["অভিভাবকের সাথে কথা হবে", "বিষয় শিক্ষকের মতামত"]);
    expect(d1.notes[0]!.mine).toBe(true);
    expect(d2.notes[0]!.mine).toBe(false);
    expect(d2.notes[1]!.byName).toBe("-"); // not a User row in this fixture: the name falls back, the note is kept
    const stored = (await IntegrityCase.findById(caseA))!;
    expect(stored.notes).toHaveLength(2);
    expect(stored.status).toBe("OPEN");
  });

  it("the class teacher and the subject teacher record the outcome of their own case; the Office records any", async () => {
    const r = await recordOutcome(caseA, "CHILD_DID", "শিশু নিজে করেছে", actorOf(classTeacherA));
    expect(r.status).toBe("CLOSED");
    const rb = await recordOutcome(caseB, "UNCLEAR", null, OFFICE);
    expect(rb.status).toBe("CLOSED");
  });
});

describe("AC-H4 / AC-H5: the term tag after the outcome", () => {
  async function closedCase(kid: Types.ObjectId, outcome: string, subject = "MATH"): Promise<string> {
    const l = await pair(kid, secA, 100, 10, subject);
    await recompute(kid, l);
    const c = (await IntegrityCase.findOne({ studentId: kid, loCode: l, status: "OPEN" }))!;
    const evBefore = await MasteryEvidence.find({ studentId: kid, loCode: l }).lean();
    await recordOutcome(String(c._id), outcome, null, OFFICE);
    expect(await MasteryEvidence.find({ studentId: kid, loCode: l }).lean()).toEqual(evBefore); // closing changes no mark
    return l;
  }

  it("the term ends at the year's midpoint (term 1) or its end (term 2)", async () => {
    const t1 = await termEndOf(year, new Date("2027-03-01"));
    const t2 = await termEndOf(year, new Date("2027-09-01"));
    expect(t1!.toISOString()).toBe(new Date((new Date("2027-01-01").getTime() + new Date("2027-12-31").getTime()) / 2).toISOString());
    expect(t2!.toISOString()).toBe(new Date("2027-12-31").toISOString());
    expect(await termEndOf(new Types.ObjectId(), new Date())).toBeNull();
  });

  it("GUARDIAN_DID: staff tag + the guardian note until the term ends; then nothing", async () => {
    const [st] = await Student.create([{ schoolId: `AL12-T${++seq}`, name: "Tagged One", classId: (await Section.findById(secA))!.classId, sectionId: secA, active: true }]);
    const l = await closedCase(st._id, "GUARDIAN_DID");
    const c = (await IntegrityCase.findOne({ studentId: st._id, loCode: l }))!;
    expect(c.tagActive).toBe(true);
    expect(c.tagUntil!.getTime()).toBeGreaterThan(Date.now());
    const tags = await tagsForStudent(String(st._id));
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ subject: "MATH", loCode: l, outcome: "GUARDIAN_DID", recurring: false });
    expect(await guardianNotesFor(String(st._id))).toEqual([{ subject: "MATH", noteBn: GUARDIAN_HELP_NOTE_BN }]);
    expect((await tagsForSection(String(secA), "MATH")).some((t) => t.studentId === String(st._id))).toBe(true);
    expect((await tagsForSection(String(secA), "ENG")).some((t) => t.studentId === String(st._id))).toBe(false);
    // the tag is a read of the case: after the term ends nothing shows, and the case itself is untouched
    const later = new Date("2028-01-01");
    expect(await tagsForStudent(String(st._id), later)).toEqual([]);
    expect(await guardianNotesFor(String(st._id), later)).toEqual([]);
    expect((await listCases({ status: "CLOSED" }, OFFICE)).find((r) => r.loCode === l)!.tagActive).toBe(true);
  });

  it("UNCLEAR: the staff tag only, no guardian note (R36)", async () => {
    const [st] = await Student.create([{ schoolId: `AL12-T${++seq}`, name: "Tagged Two", classId: (await Section.findById(secA))!.classId, sectionId: secA, active: true }]);
    await closedCase(st._id, "UNCLEAR");
    expect((await tagsForStudent(String(st._id))).map((t) => t.outcome)).toEqual(["UNCLEAR"]);
    expect(await guardianNotesFor(String(st._id))).toEqual([]);
  });

  it("CHILD_DID: no tag, no note", async () => {
    const [st] = await Student.create([{ schoolId: `AL12-T${++seq}`, name: "Tagged Three", classId: (await Section.findById(secA))!.classId, sectionId: secA, active: true }]);
    const l = await closedCase(st._id, "CHILD_DID");
    expect(await tagsForStudent(String(st._id))).toEqual([]);
    expect(await guardianNotesFor(String(st._id))).toEqual([]);
    const c = (await IntegrityCase.findOne({ studentId: st._id, loCode: l }))!;
    expect(c.tagActive).toBe(false);
    expect(c.tagUntil).toBeUndefined();
  });

  it("AC-H5: two cases in one term -> the recurring badge, following `integrityRecurringCases`", async () => {
    const [st] = await Student.create([{ schoolId: `AL12-T${++seq}`, name: "Tagged Four", classId: (await Section.findById(secA))!.classId, sectionId: secA, active: true }]);
    await closedCase(st._id, "GUARDIAN_DID");
    const l2 = await closedCase(st._id, "GUARDIAN_DID", "ENG");
    const tags = await tagsForStudent(String(st._id));
    expect(tags).toHaveLength(2);
    expect(tags.every((t) => t.recurring)).toBe(true);
    // a subject teacher's narrowing happens in the profile resolver; the service returns every subject
    expect(tags.map((t) => t.subject).sort()).toEqual(["ENG", "MATH"]);
    await saveIntegrityPolicy({ gapPoints: 20, recurringCases: 3 }, PRINCIPAL);
    expect((await tagsForStudent(String(st._id))).every((t) => !t.recurring)).toBe(true);
    await saveIntegrityPolicy({ gapPoints: 20, recurringCases: 2 }, PRINCIPAL);
    void l2;
  });

  it("a guardian-facing note carries no case, number or objective (the shape is a subject code and a sentence)", async () => {
    const [st] = await Student.create([{ schoolId: `AL12-T${++seq}`, name: "Tagged Five", classId: (await Section.findById(secA))!.classId, sectionId: secA, active: true }]);
    await closedCase(st._id, "GUARDIAN_DID");
    const notes = await guardianNotesFor(String(st._id));
    expect(Object.keys(notes[0]!).sort()).toEqual(["noteBn", "subject"]);
  });
});

describe("runs regardless of the release switch", () => {
  it("the switch is OFF in this file and every flow above ran", async () => {
    const row = await MasteryPolicy.findOne({ scopeKey: "SCHOOL" }).lean();
    expect(row?.values?.academicLoop2027On).not.toBe(true);
    expect(await IntegrityCase.countDocuments({})).toBeGreaterThan(5);
  });
});

describe("tag term = the term in which the outcome is RECORDED (current year at that moment)", () => {
  it("a 2026 case closed in January 2027 is tagged to the end of the 2027 first term", async () => {
    const [y26] = await AcademicYear.create([{ label: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), current: false }]);
    const [st] = await Student.create([{ schoolId: `AL12-Y${++seq}`, name: "Old Year", classId: (await Section.findById(secA))!.classId, sectionId: secA, active: true }]);
    const c = await IntegrityCase.create({
      studentId: st._id, sectionId: secA, academicYearId: y26._id, classToken: "C3", subject: "MATH", loCode: nextLo(),
      hwPct: 100, ctPct: 10, gap: 90, status: "OPEN", investigatorIds: [classTeacherA],
    });
    const jan = new Date("2027-01-15T06:00:00Z");
    await recordOutcome(String(c._id), "GUARDIAN_DID", null, OFFICE, jan);
    const stored = (await IntegrityCase.findById(c._id))!;
    const term1End = new Date((new Date("2027-01-01").getTime() + new Date("2027-12-31").getTime()) / 2);
    expect(stored.closedAt!.toISOString()).toBe(jan.toISOString());
    expect(stored.tagUntil!.toISOString()).toBe(term1End.toISOString());
    // the tag shows until then, and not after
    expect((await tagsForStudent(String(st._id), new Date("2027-03-01"))).map((t) => t.caseId)).toEqual([String(c._id)]);
    expect(await tagsForStudent(String(st._id), new Date("2027-08-01"))).toEqual([]);
  });
});

describe("listing admits the same people as mayAccessCase (a newly assigned subject teacher)", () => {
  it("the routine's current subject teacher of the section x subject sees the case in the LIST; another subject's teacher does not", async () => {
    const l = await pair(kidsA[1]!, secA, 100, 0);
    await recompute(kidsA[1]!, l);
    const c = (await IntegrityCase.findOne({ studentId: kidsA[1], loCode: l }))!;
    const newTeacher = new Types.ObjectId();
    expect((c.investigatorIds ?? []).map(String)).not.toContain(String(newTeacher));
    const classId = (await Section.findById(secA))!.classId;
    // the routine now names the new teacher for MATH in this section
    await RoutineSlot.create([
      {
        groupType: "section", groupId: secA, classId, dayOfWeek: "SUN", periodNumber: 3, subject: "MATH", track: "general",
        teacherId: newTeacher, effectiveFrom: new Date("2020-01-01"), createdBy: new Types.ObjectId(),
      },
    ]);
    mockSubjectTeacher.mockImplementation(async (sectionId: unknown, subject: unknown) => (String(sectionId) === String(secA) && subject === "MATH" ? String(newTeacher) : null));
    expect((await listCases({ status: "OPEN" }, actorOf(newTeacher))).some((r) => r.id === String(c._id))).toBe(true);
    expect((await caseDetail(String(c._id), actorOf(newTeacher))).id).toBe(String(c._id));
    // a teacher with a period in the section but for ANOTHER subject is a candidate and is then filtered out by the row rule
    const other = new Types.ObjectId();
    await RoutineSlot.create([
      {
        groupType: "section", groupId: secA, classId, dayOfWeek: "MON", periodNumber: 3, subject: "ENG", track: "general",
        teacherId: other, effectiveFrom: new Date("2020-01-01"), createdBy: new Types.ObjectId(),
      },
    ]);
    expect((await listCases({}, actorOf(other))).filter((r) => r.subject === "MATH")).toEqual([]);
    await expect(caseDetail(String(c._id), actorOf(other))).rejects.toThrow();
  });
});

describe("backfillInvestigators: oldest first, a batch, and nobody is re-checked every night", () => {
  it("stamps the unresolvable case once, names the resolvable one, and leaves the stamped one alone next time", async () => {
    const classId = (await Section.findById(secA))!.classId;
    const [secC] = await Section.create([{ classId, code: "C", nameBn: "গ" }]); // no class teacher
    const [stC] = await Student.create([{ schoolId: `AL12-C${++seq}`, name: "No Teacher", classId, sectionId: secC!._id, active: true }]);
    const base = { academicYearId: year, classToken: "C3", hwPct: 100, ctPct: 0, gap: 100, status: "OPEN" as const };
    const first = await IntegrityCase.create({ ...base, studentId: stC!._id, sectionId: secC!._id, subject: "SCI", loCode: nextLo() }); // nobody to name
    const second = await IntegrityCase.create({ ...base, studentId: kidsA[0], sectionId: secA, subject: "MATH", loCode: nextLo() }); // class teacher + subject teacher
    mockSubjectTeacher.mockImplementation(async (sectionId: unknown, subject: unknown) => (String(sectionId) === String(secA) && subject === "MATH" ? String(subjectTeacherA) : null));

    await backfillInvestigators(1); // the batch is one: the OLDEST goes first
    const f1 = (await IntegrityCase.findById(first._id))!;
    expect(f1.investigatorsCheckedAt).toBeTruthy();
    expect(f1.investigatorIds ?? []).toHaveLength(0);
    expect((await IntegrityCase.findById(second._id))!.investigatorIds ?? []).toHaveLength(0);

    await backfillInvestigators();
    expect((await IntegrityCase.findById(second._id))!.investigatorIds!.map(String).sort()).toEqual([String(classTeacherA), String(subjectTeacherA)].sort());
    const f2 = (await IntegrityCase.findById(first._id))!;
    expect(f2.investigatorsCheckedAt!.toISOString()).toBe(f1.investigatorsCheckedAt!.toISOString()); // not looked at again
    expect(await IntegrityCase.countDocuments({ _id: first._id, investigatorsCheckedAt: { $exists: false } })).toBe(0);
  });
});

describe("childHomeworkHelpNotes: only the own linked guardian of the child", () => {
  builder.mutationField("_al12Noop", (t) => t.boolean({ resolve: () => true })); // a schema needs a mutation field
  const schema = builder.toSchema();
  const Q = (id: string) => `query { childHomeworkHelpNotes(studentId: "${id}") { subject noteBn } }`;
  const run = (id: string, auth: { role: string; userId: string } | null) => graphql({ schema, source: Q(id), contextValue: { auth } as never });

  it("a linked guardian gets the note; an unlinked guardian and a staff login are refused", async () => {
    const [st] = await Student.create([{ schoolId: `AL12-G${++seq}`, name: "Noted", classId: (await Section.findById(secA))!.classId, sectionId: secA, active: true }]);
    const l = await pair(st!._id, secA, 100, 5);
    await recompute(st!._id, l);
    await recordOutcome(String((await IntegrityCase.findOne({ studentId: st!._id, loCode: l }))!._id), "GUARDIAN_DID", null, OFFICE);
    const [mine, theirs] = await Guardian.create([
      { identifierKind: "phone", identifier: "01800000001", name: "Mine", loginEnabled: true, passwordHash: "x", active: true },
      { identifierKind: "phone", identifier: "01800000002", name: "Theirs", loginEnabled: true, passwordHash: "x", active: true },
    ]);
    await GuardianLink.create([{ guardianId: mine!._id, studentId: st!._id, relation: "mother" }]);

    const ok = await run(String(st!._id), { role: "GUARDIAN", userId: String(mine!._id) });
    expect(ok.errors).toBeUndefined();
    expect(ok.data).toEqual({ childHomeworkHelpNotes: [{ subject: "MATH", noteBn: GUARDIAN_HELP_NOTE_BN }] });
    expect((await run(String(st!._id), { role: "GUARDIAN", userId: String(theirs!._id) })).errors?.length).toBeGreaterThan(0);
    expect((await run(String(st!._id), { role: "TEACHER", userId: String(classTeacherA) })).errors?.length).toBeGreaterThan(0);
    expect((await run(String(st!._id), { role: "PRINCIPAL", userId: String(new Types.ObjectId()) })).errors?.length).toBeGreaterThan(0);
    expect((await run(String(st!._id), null)).errors?.length).toBeGreaterThan(0);
  });
});
