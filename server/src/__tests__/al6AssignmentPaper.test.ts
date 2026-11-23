/**
 * AL-6 — the weekly assignment paper, the time budget and the in-school rule, server side
 * (docs/prd-academic-loop-2027.md §3.1, §3.6, §3.8, §4.4, §7; D-#1669, D-#1670, D-#1671).
 * ACs: AC-C4, AC-C5, AC-C9, AC-C12, AC-C15, AC-D4, AC-F1, AC-F2, AC-R1.
 *
 *   pure      the budget arithmetic: counted minutes, share → marks, the Friday-first day split (AC-C9's 3-subject week)
 *   OFF       the release switch off → every 2026 flow is unchanged: no budget on finalise, no tracker link / guard on
 *             the AS paper, the 360 constant even with the policy key edited, the old duplicate / refusal sentences, no
 *             CW sheet, no CT warning, the section trigger reads every state (AC-R1)
 *   budget    AC-C4 (BAN 150 + MATH 150 + SCI 90 → the third refused naming the overage), the day cap, AC-C9 split on
 *             the items, AC-C12 (a second assignment → the extra-homework sentence), AC-C15 (Nursery: no budget)
 *   tailored  the tailored AS paper links to the tracker item: guards, one write-back moment (AS rows idempotent), the
 *             marks / availableMarks write-back on the child's own items, CHECKED, the internal result, no resubmission
 *   delivery  a delivered item with a question set gets a Part-A-only AS paper (marks-only where no tree), the item
 *             locks at issue, minutes follow marks (R26), a second cell / ISO-week duplicate is refused, AC-C5 issue
 *   CW        the in-class work paper; its evidence is in-school: IMPROVING → MASTERED (AC-D4 through the services)
 *   trigger   AC-F2 through `evaluateSectionTriggers`; the recompute report; the CT-without-sheet warning (AC-F1)
 *
 * In-memory MongoDB, real services; only the routine lookup is stubbed.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mockTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({
  resolveSubjectTeacher: (...a: unknown[]) => mockTeacher(...a),
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { AssessmentSet } from "../modules/assessment/models/AssessmentSet";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { QuestionUse } from "../modules/assessment/models/QuestionUse";
import { AssignmentItem } from "../modules/trackers/models/AssignmentItem";
import { AssignmentSchedule } from "../modules/trackers/models/AssignmentSchedule";
import { AssignmentStudentRecord } from "../modules/trackers/models/AssignmentStudentRecord";
import { ClassTest } from "../modules/trackers/models/ClassTest";
import { MasteryAssignment } from "../modules/mastery/models/MasteryAssignment";
import { MasteryAssignmentSheet } from "../modules/mastery/models/MasteryAssignmentSheet";
import { MasteryAction } from "../modules/mastery/models/MasteryAction";
import { MasteryEnablement } from "../modules/mastery/models/MasteryEnablement";
import { MasteryEvidence } from "../modules/mastery/models/MasteryEvidence";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { importCatalogue, getPolicy, savePolicy, setEnablement, settleLoopRecompute } from "../modules/mastery/services/MasteryCatalogueService";
import { classTestSheetLink, confirmPaper, createPaper, saveResults } from "../modules/mastery/services/MasteryWorkService";
import { buildAssignment, assignmentFor, sendAssignment } from "../modules/mastery/services/MasteryAssignmentService";
import { computeSection, liveSectionRows } from "../modules/mastery/services/MasteryDiagnosisService";
import { evaluateSectionTriggers } from "../modules/mastery/services/MasteryActionService";
import { recomputeForSwitch } from "../modules/mastery/services/Loop2027Recompute";
import { PAPER_LOCKED_MESSAGE } from "../modules/mastery/services/HomeworkPaperService";
import { manualCheckRefusal } from "../modules/mastery/paperLink";
import { isoWeekKey } from "../modules/mastery/evidence";
import {
  DEFAULT_BUDGET_POLICY,
  SECOND_ASSIGNMENT_MESSAGE,
  budgetPolicyOf,
  countedMinutes,
  dayCapMinutes,
  hasAssignmentBudget,
  median,
  minutesOfMarks,
  placeSubject,
  splitDays,
  subjectShareMarks,
  weekBudgetMinutes,
  weekCapMinutes,
} from "../modules/mastery/assignmentBudget";
import {
  assignmentWeekLoad,
  confirmAssignmentWeek,
  deliverAssignmentItem,
  setAssignmentItemMinutes,
  transitionAssignmentRecord,
  updateAssignmentItem,
} from "../modules/trackers/services/AssignmentService";
import { resolveScheduleWeek } from "../modules/trackers/services/AssignmentScheduleService";
import { weekReminderBodyBn } from "../modules/trackers/services/AssignmentWeekReminderService";

jest.setTimeout(300_000);

let mongo: MongoMemoryServer;
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
let yearId = new Types.ObjectId();
let classId = new Types.ObjectId();
let sectionId = "";
let nurSectionId = "";
let nurYearClassId = new Types.ObjectId();
const sids: string[] = []; // 6 students of the C3 section
const gold = new Map<string, string>();

const A = "LO-C3-MATH-07-01";
const MQ = (n: number) => `QP-MATH-C3-U07-Q96${String(n).padStart(3, "0")}`;
const EQ = (n: number) => `QP-ENG-C3-U01-Q96${String(n).padStart(3, "0")}`;
const CATALOGUE = JSON.stringify({
  classToken: "C3", subject: "MATH", status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [{ code: A, labelBn: "ভাগের ধারণা", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] }],
  questionTypes: [{ code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 2 }],
});
const bn = (n: number) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

const setLoop = async (on: boolean, extra: Record<string, unknown> = {}) => {
  const r = await savePolicy(null, null, { academicLoop2027On: on, ...extra }, PRINCIPAL);
  await settleLoopRecompute(); // the OFF → ON save recomputes in the background — let it finish before the test reads
  return r;
};
let asSeq = 0;
let fixtureWeek = 100;

/** A tracker item (DRAFT, all present) for the C3 section; `due` is a "YYYY-MM-DD" local day. */
async function trackerItem(subject: string, due: string, over: Record<string, unknown> = {}) {
  asSeq += 1;
  const [y, m, d] = due.split("-").map(Number) as [number, number, number];
  fixtureWeek += 1;
  return AssignmentItem.create({
    asId: `AS-FIX-${subject}-${String(asSeq).padStart(4, "0")}`, academicYearId: yearId, scheduleEntryId: new Types.ObjectId(),
    weekNumber: fixtureWeek, cycleWeek: 1, classId, classLevel: 3, sectionId: new Types.ObjectId(sectionId), subject,
    teacherId: new Types.ObjectId(TEACHER_ID), deliveryDate: new Date(y, m - 1, d - 3), dueDate: new Date(y, m - 1, d), estMinutes: 20,
    status: "DRAFT", draftRoster: sids.map((studentId, i) => ({ studentId, present: i !== 5 })), deliveredBy: new Types.ObjectId(TEACHER_ID),
    deliveredAt: new Date(y, m - 1, d - 3), ...over,
  });
}

/**
 * A DRAFT tailored assignment with its approved sheets, written straight to the DB (the builder is M-4's own test): Part A
 * one teacher line of `a` marks (or a bank question when `bankA`), each child ONE own line of `b` marks (distinct text).
 */
async function draftAssignment(subject: string, due: string, a: number, b: number, opts: { bankA?: boolean; layoutMinutes?: number; sectionOverride?: string } = {}) {
  const sid = opts.sectionOverride ?? sectionId;
  const dueDate = new Date(`${due}T00:00:00.000Z`);
  const cls = opts.sectionOverride ? nurYearClassId : classId;
  const token = opts.sectionOverride ? "NUR" : "C3";
  const asg = await MasteryAssignment.create({
    sectionId: new Types.ObjectId(sid), classId: cls, academicYearId: yearId, classToken: token, subject, dueDate, week: isoWeekKey(dueDate),
    layout: { totalMarks: 15, minutes: opts.layoutMinutes ?? 30, partAOn: true, partAMarks: 5, partALoCodes: [], partBMarks: 10, mixWeak: 60, mixImproving: 25, mixRevision: 15, questionTypeCodes: [] },
    rememberLayout: false,
    partA: [
      opts.bankA
        ? { origin: "BANK", artifactId: new Types.ObjectId(gold.get(MQ(1))!), qid: MQ(1), loCode: A, chapterNumber: 7, questionTypeCode: "QT-SHORT", marks: a, band: "SECTION" }
        : { origin: "TEACHER", textBn: `অংশ ক ${subject}`, loCode: A, chapterNumber: 7, questionTypeCode: "QT-SHORT", marks: a, band: "SECTION" },
    ],
    status: "DRAFT", builtAt: new Date(), builtBy: new Types.ObjectId(TEACHER_ID),
  });
  const kids = opts.sectionOverride ? (await Student.find({ sectionId: sid }).select("_id").lean()).map((k) => String(k._id)) : sids;
  for (const [i, studentId] of kids.entries()) {
    await MasteryAssignmentSheet.create({
      assignmentId: asg._id, studentId: new Types.ObjectId(studentId), status: "APPROVED", edited: false,
      items: [{ origin: "TEACHER", textBn: `অংশ খ ${subject} ${i}`, loCode: A, chapterNumber: 7, questionTypeCode: "QT-SHORT", marks: b, band: "WEAK" }],
    });
  }
  return asg;
}
const send = (id: unknown) => sendAssignment(String(id), TEACHER);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  yearId = year._id;
  const [cls, nurCls] = await Class.create([
    { level: 3, nameBn: "তৃতীয়", academicYearId: year._id },
    { level: -1, nameBn: "নার্সারি", academicYearId: year._id },
  ]);
  classId = cls._id;
  nurYearClassId = nurCls._id;
  const [b, n] = await Section.create([
    { classId: cls._id, code: "B", nameBn: "বালক" },
    { classId: nurCls._id, code: "N", nameBn: "নার্সারি" },
  ]);
  sectionId = String(b._id);
  nurSectionId = String(n._id);
  for (let i = 1; i <= 6; i++) {
    const [s] = await Student.create([{ schoolId: `AL6-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: b._id, active: true }]);
    sids.push(String(s._id));
  }
  for (let i = 1; i <= 2; i++) await Student.create([{ schoolId: `AL6-N${i}`, name: `Nur ${i}`, rollNumber: String(i), classId: nurCls._id, sectionId: n._id, active: true }]);
  const r = await importCatalogue(CATALOGUE, true, PRINCIPAL);
  if (!r.ok) throw new Error(r.errors.join("; "));
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL);
  // BAN / SCI / NUR: the add-on switch rows only (the budget tests need the subjects enabled, not a catalogue).
  await MasteryEnablement.create([
    { academicYearId: year._id, classToken: "C3", subject: "BAN", enabled: true },
    { academicYearId: year._id, classToken: "C3", subject: "SCI", enabled: true },
    { academicYearId: year._id, classToken: "NUR", subject: "MATH", enabled: true },
  ]);
  const base = { docType: "question", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 }, curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold" };
  for (let n2 = 1; n2 <= 16; n2++) {
    const [a] = await ContentArtifact.create([{ ...base, subject: "MATH", envelopeJson: { tags: { topic_tag: A }, payload: { qid: MQ(n2), topic_tag: A, marks: 2, question_text: `${MQ(n2)} লেখা` } } }]);
    gold.set(MQ(n2), String(a._id));
  }
  for (let n2 = 1; n2 <= 6; n2++) {
    const [a] = await ContentArtifact.create([{ ...base, subject: "ENG", envelopeJson: { tags: {}, payload: { qid: EQ(n2), marks: 2, question_text: `${EQ(n2)} text` } } }]);
    gold.set(EQ(n2), String(a._id));
  }
  mockTeacher.mockResolvedValue(TEACHER_ID);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  mockTeacher.mockReset();
  mockTeacher.mockResolvedValue(TEACHER_ID);
});

// ---------------------------------------------------------------------------
describe("the budget arithmetic (pure)", () => {
  const P = DEFAULT_BUDGET_POLICY;
  it("defaults: 6 h a week (360 min), 3 h a day (180 min), 1.8 min a mark; the week holds min(cap, 2 × day)", () => {
    expect([weekCapMinutes(P), dayCapMinutes(P), P.minutesPerMark, weekBudgetMinutes(P)]).toEqual([360, 180, 1.8, 360]);
    expect(weekBudgetMinutes({ ...P, weeklyCapHours: 4 })).toBe(240);
    expect(weekBudgetMinutes({ ...P, perDayHours: 1.5 })).toBe(180);
  });
  it("a bad or missing policy value falls back to the default (the constant 360 is the fallback)", () => {
    expect(budgetPolicyOf({})).toEqual(P);
    expect(budgetPolicyOf({ weeklyAssignmentHoursCap: 0, perDayHours: "x", minutesPerMark: -1 })).toEqual(P);
    expect(weekCapMinutes(budgetPolicyOf({ weeklyAssignmentHoursCap: 4.5 }))).toBe(270);
  });
  it("counted minutes = (Part A + the MEDIAN child's Part B marks) × minutesPerMark", () => {
    expect(median([])).toBe(0);
    expect(median([30, 50, 40])).toBe(40);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(countedMinutes(22, [44, 44, 44, 60], P)).toBe(119); // (22 + 44) × 1.8 = 118.8
    expect(minutesOfMarks(10, P)).toBe(18);
  });
  it("AC-C9: a subject's share of 360 is 120 min = 66 marks (22 common + 44 per child at 5 : 10)", () => {
    expect(subjectShareMarks(360, 3, P)).toBe(66);
    expect(subjectShareMarks(360, 2, P)).toBe(100);
    expect(subjectShareMarks(360, 0, P)).toBe(0);
  });
  it("AC-C9: BAN, MATH, SCI of 120 → BAN Friday, MATH spans Friday 60 + Saturday 60, SCI Saturday: 180 / 180, week 360", () => {
    const r = splitDays([{ key: "BAN", minutes: 120 }, { key: "MATH", minutes: 120 }, { key: "SCI", minutes: 120 }], 180);
    expect(r.placed.get("BAN")).toEqual({ doOnDay: "FRI", minutesByDay: { FRI: 120, SAT: 0 }, overBy: 0 });
    expect(r.placed.get("MATH")).toEqual({ doOnDay: "BOTH", minutesByDay: { FRI: 60, SAT: 60 }, overBy: 0 });
    expect(r.placed.get("SCI")).toEqual({ doOnDay: "SAT", minutesByDay: { FRI: 0, SAT: 120 }, overBy: 0 });
    expect(r.loads).toEqual({ FRI: 180, SAT: 180 });
    expect(r.overBy).toBe(0);
  });
  it("two subjects of 180 take a day each; largest first; a tie keeps the given order; the unplaceable is overBy", () => {
    const two = splitDays([{ key: "A", minutes: 180 }, { key: "B", minutes: 180 }], 180);
    expect([two.placed.get("A")!.doOnDay, two.placed.get("B")!.doOnDay]).toEqual(["FRI", "SAT"]);
    const order = splitDays([{ key: "S", minutes: 60 }, { key: "L", minutes: 150 }, { key: "M", minutes: 150 }], 180);
    expect(order.placed.get("L")!.doOnDay).toBe("FRI");
    expect(order.placed.get("M")!.minutesByDay).toEqual({ FRI: 30, SAT: 120 });
    expect(order.placed.get("S")!.minutesByDay).toEqual({ FRI: 0, SAT: 60 });
    expect(placeSubject({ FRI: 180, SAT: 150 }, 90, 180)).toEqual({ doOnDay: "SAT", minutesByDay: { FRI: 0, SAT: 30 }, overBy: 60 });
    expect(placeSubject({ FRI: 0, SAT: 0 }, 0, 180).minutesByDay).toEqual({ FRI: 0, SAT: 0 });
  });
  it("the week reminder says to trim for the day cap too, not only the week cap", () => {
    const base = { nameBn: "তৃতীয়", deliveredOn: new Date(2027, 0, 7), draftSubjects: ["MATH"], missingSubjects: [], totalMinutes: 300, ceilingMinutes: 360 };
    expect(weekReminderBodyBn({ ...base, dayOver: true, dayCapMinutes: 90 })).toContain("কমিয়ে");
    expect(weekReminderBodyBn({ ...base, dayOver: true, dayCapMinutes: 90 })).toContain("দৈনিক সীমা");
    expect(weekReminderBodyBn({ ...base, totalMinutes: 400 })).toContain("কমিয়ে");
    expect(weekReminderBodyBn(base)).not.toContain("কমিয়ে");
  });
  it("AC-C15: Nursery and KG have no weekly assignment budget", () => {
    expect(hasAssignmentBudget("NUR")).toBe(false);
    expect(hasAssignmentBudget("KG")).toBe(false);
    expect(hasAssignmentBudget("C1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("switch OFF: every 2026 flow is unchanged (AC-R1)", () => {
  beforeAll(async () => {
    await setLoop(false);
  });

  it("finalise has no budget: three subjects of 150 + 150 + 90 all send; no tracker link, no counted minutes", async () => {
    const item = await trackerItem("MATH", "2027-02-14");
    for (const [subject, a, b] of [["BAN", 25, 50], ["MATH", 25, 50], ["SCI", 15, 30]] as const) {
      const asg = await draftAssignment(subject, "2027-02-14", a, b);
      if (subject === "MATH") await MasteryAssignment.updateOne({ _id: asg._id }, { $set: { asItemId: item._id } });
      const sent = await send(asg._id);
      expect(sent.status).toBe("SENT");
      const paper = await MasteryPaper.findById((await MasteryAssignment.findById(asg._id))!.paperId);
      expect(paper!.trackerLinked).toBeUndefined();
      const stored = await MasteryAssignment.findById(asg._id);
      expect(stored!.countedMinutes).toBeUndefined();
      expect(stored!.doOnDay).toBeUndefined();
    }
    const stored = await AssignmentItem.findById(item._id);
    expect(stored!.estMinutes).toBe(20); // untouched
    expect(stored!.doOnDay).toBeUndefined();
    // …and the explicit link of 2026 stays a plain 2026 link: the manual check is not refused
    expect(await manualCheckRefusal("ASSIGNMENT", item._id)).toBeNull();
  });

  it("a SENT week built again keeps the 2026 sentence, not the extra-homework one", async () => {
    const start = await assignmentFor(sectionId, "MATH", "2027-02-14", TEACHER);
    await expect(buildAssignment({ sectionId, subject: "MATH", dueDate: "2027-02-14", layout: start.startingLayout, rememberLayout: false }, TEACHER)).rejects.toThrow("পাঠানো অ্যাসাইনমেন্ট আর বদলানো যায় না।");
  });

  it("the weekly ceiling stays the 360 constant even when the policy key was edited (the key waits for the switch)", async () => {
    await setLoop(false, { weeklyAssignmentHoursCap: 2, perDayHours: 1 });
    const a = await trackerItem("BAN", "2027-02-21", { estMinutes: 200 });
    const b = await trackerItem("ENG", "2027-02-21", { estMinutes: 100 });
    void b;
    const load = await assignmentWeekLoad(String(yearId), sectionId, a.weekNumber);
    expect(load.ceiling).toBe(360);
    const wk = await trackerItem("SCI", "2027-02-28", { estMinutes: 200 });
    await trackerItem("MATH", "2027-02-28", { estMinutes: 100, weekNumber: wk.weekNumber });
    // 300 min: over the policy cap (120) but under the constant — confirm issues
    const res = await confirmAssignmentWeek({ academicYearId: String(yearId), sectionId, weekNumber: wk.weekNumber, actorId: TEACHER_ID }).catch((e: Error) => e);
    expect(res).not.toBeInstanceOf(Error);
    expect((res as { ceiling: number }).ceiling).toBe(360);
    await setLoop(false, { weeklyAssignmentHoursCap: 6, perDayHours: 3 });
  });

  it("no CW sheet, and no CT-without-sheet warning, with the switch off", async () => {
    await expect(
      createPaper({ sectionId, subject: "MATH", source: "CW", date: "2027-02-10", items: [{ origin: "TEACHER", textBn: "ক", loCode: A, questionTypeCode: "QT-SHORT" }] }, TEACHER),
    ).rejects.toThrow("এই সুবিধা এখনো চালু হয়নি।");
    const ct = await ClassTest.create({
      ctId: "CT-C3-MATH-9001", academicYearId: yearId, sectionId: new Types.ObjectId(sectionId), subject: "MATH", testNumber: 1,
      examDate: new Date("2027-02-20T00:00:00Z"), totalMarks: 8, passMark: 3, source: "UPLOADED_PAPER", status: "PRINTED",
      requestedBy: new Types.ObjectId(TEACHER_ID), teacherId: new Types.ObjectId(TEACHER_ID),
    });
    const link = await classTestSheetLink(String(ct._id));
    expect(link.enabled).toBe(true);
    expect(link.noSheetWarning).toBe(false);
  });

  it("a second delivery of a cell keeps the English duplicate error (no pointer to extra homework)", async () => {
    const { entryId, weekNumber } = await schedule("SCI", 4);
    await deliver(entryId, weekNumber, null);
    await expect(deliver(entryId, weekNumber, null)).rejects.toThrow(/already delivered/);
  });
});

// ---------------------------------------------------------------------------
// The delivery fixtures (AssignmentSchedule + an attachment), shared by the delivery tests
// ---------------------------------------------------------------------------
let scheduleDoc: InstanceType<typeof AssignmentSchedule> | null = null;
let attachmentId = "";
async function schedule(subject = "MATH", weekNumber = 1): Promise<{ entryId: string; weekNumber: number }> {
  if (!scheduleDoc) {
    const entries = (["MATH", "ENG", "SCI"] as const).flatMap((subj) =>
      [1, 2, 3, 4].map((cycleWeek) => ({ cycleWeek, classId, classLevel: 3, sectionId: new Types.ObjectId(sectionId), subject: subj, teacherId: new Types.ObjectId(TEACHER_ID) })),
    );
    scheduleDoc = await AssignmentSchedule.create({ academicYearId: yearId, termStartDate: new Date(2027, 0, 3), deliveryDayOfWeek: 4, dueDayOfWeek: 0, entries });
    const f = await StoredFile.create({ kind: "assignment_attachment", mime: "application/pdf", sizeBytes: 10, originalName: "sheet.pdf", driveFileId: "x", uploadedBy: new Types.ObjectId(TEACHER_ID) });
    attachmentId = String(f._id);
  }
  const resolved = await resolveScheduleWeek(scheduleDoc, weekNumber);
  const entry = scheduleDoc.entries.find((e) => e.subject === subject && e.cycleWeek === resolved.cycleWeek)!;
  return { entryId: String(entry._id), weekNumber };
}
const deliver = (entryId: string, weekNumber: number, setId: string | null) =>
  deliverAssignmentItem({
    academicYearId: String(yearId), weekNumber, entryId, sectionId,
    roster: sids.map((studentId, i) => ({ studentId, present: i !== 5 })), description: "অ্যাসাইনমেন্ট", attachmentIds: [attachmentId],
    ...(setId ? { setId } : {}), actorId: TEACHER_ID,
  });
const basketSet = async (_subject: string, qids: string[]) =>
  String((await AssessmentSet.create({
    setType: "AS", sectionId: new Types.ObjectId(sectionId), classId, status: "assembled", createdBy: new Types.ObjectId(TEACHER_ID),
    basketItems: qids.map((q) => ({ artifactId: new Types.ObjectId(gold.get(q)!), qid: q, marks: 2 })),
  }))._id);

// ---------------------------------------------------------------------------
describe("switch ON: the time budget (AC-C4, AC-C9, AC-C12, AC-C15)", () => {
  beforeAll(async () => {
    await setLoop(true, { minutesPerMark: 2 });
  });
  afterAll(async () => {
    await setLoop(true, { minutesPerMark: 1.8 });
  });

  it("AC-C4: BAN 150 + MATH 150 finalise; SCI 90 is refused (390 > 360) naming the 30-minute overage; trimmed to 60 it goes", async () => {
    const week = "2027-03-14";
    const ban = await draftAssignment("BAN", week, 25, 50);
    const math = await draftAssignment("MATH", week, 25, 50);
    const sci = await draftAssignment("SCI", week, 15, 30);
    await send(ban._id);
    await send(math._id);
    const refused = await send(sci._id).catch((e: Error) => e);
    expect(refused).toBeInstanceOf(Error);
    expect((refused as Error).message).toContain(bn(390));
    expect((refused as Error).message).toContain(bn(360));
    expect((refused as Error).message).toContain(`${bn(30)} মিনিট বেশি`);
    const stillDraft = await MasteryAssignment.findById(sci._id);
    expect(stillDraft!.status).toBe("DRAFT");
    expect(stillDraft!.paperId).toBeUndefined();
    // trim SCI's Part B to 20 marks: (10 + 20) × 2 = 60
    await MasteryAssignment.updateOne({ _id: sci._id }, { $set: { "partA.0.marks": 10 } });
    await MasteryAssignmentSheet.updateMany({ assignmentId: sci._id }, { $set: { "items.0.marks": 20 } });
    await send(sci._id);
    const [b, m, s] = await Promise.all([ban, math, sci].map((x) => MasteryAssignment.findById(x._id)));
    expect([b!.countedMinutes, m!.countedMinutes, s!.countedMinutes]).toEqual([150, 150, 60]);
    // the Friday-first split: BAN Friday 150, MATH spans (Friday 30 + Saturday 120), SCI Saturday 60 → 180 / 180
    expect([b!.doOnDay, m!.doOnDay, s!.doOnDay]).toEqual(["FRI", "BOTH", "SAT"]);
    expect(m!.minutesByDay).toMatchObject({ FRI: 30, SAT: 120 });
    expect(s!.minutesByDay).toMatchObject({ FRI: 0, SAT: 60 });
  });

  it("the day cap: one subject that fits neither Friday nor Saturday under perDayHours is refused naming the day overage", async () => {
    await setLoop(true, { minutesPerMark: 2, perDayHours: 1.5 }); // 90 min a day
    const asg = await draftAssignment("BAN", "2027-03-21", 50, 50); // (50 + 50) × 2 = 200 min > 2 × 90
    const refused = await send(asg._id).catch((e: Error) => e);
    expect((refused as Error).message).toContain("দৈনিক সীমা");
    expect((refused as Error).message).toContain(bn(20));
    await setLoop(true, { minutesPerMark: 2, perDayHours: 3 });
  });

  it("AC-C12: a second assignment for the SENT ISO week × শাখা × subject points to the extra homework", async () => {
    const start = await assignmentFor(sectionId, "MATH", "2027-03-14", TEACHER);
    const refused = await buildAssignment({ sectionId, subject: "MATH", dueDate: "2027-03-14", layout: start.startingLayout, rememberLayout: false }, TEACHER).catch((e: Error) => e);
    expect((refused as Error).message).toBe(SECOND_ASSIGNMENT_MESSAGE);
    expect((refused as Error).message).toContain("বাড়তি বাড়ির কাজ");
  });

  it("AC-C15: a Nursery assignment has no budget — a huge sheet sends, no counted minutes, no day split", async () => {
    const asg = await draftAssignment("MATH", "2027-03-14", 150, 150, { sectionOverride: nurSectionId });
    const sent = await send(asg._id);
    expect(sent.status).toBe("SENT");
    const stored = await MasteryAssignment.findById(asg._id);
    expect(stored!.countedMinutes).toBe(0);
    expect(stored!.doOnDay).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("switch ON: the tailored AS paper is a tracker paper (§3.1)", () => {
  const week = "2027-04-11";
  let item: InstanceType<typeof AssignmentItem>;
  let paperCode = "";
  let paperId = new Types.ObjectId();
  beforeAll(async () => {
    await setLoop(true, { minutesPerMark: 1.8 });
  });

  it("finalising links the paper to the week's tracker item (found by its due day), sets its minutes and day split", async () => {
    item = await trackerItem("MATH", week);
    const asg = await draftAssignment("MATH", week, 2, 4, { bankA: true });
    await send(asg._id);
    const stored = await MasteryAssignment.findById(asg._id);
    const paper = await MasteryPaper.findById(stored!.paperId);
    paperId = paper!._id as Types.ObjectId;
    paperCode = paper!.paperId;
    expect(paper!.trackerLinked).toBe(true);
    expect(paper!.extra).toBe(false);
    expect(String(paper!.links.asItemId)).toBe(String(item._id));
    expect(String(stored!.asItemId)).toBe(String(item._id));
    const it = await AssignmentItem.findById(item._id);
    expect(it!.estMinutes).toBe(minutesOfMarks(2 + 4, DEFAULT_BUDGET_POLICY)); // (2 + 4) × 1.8 → 11
    expect(it!.doOnDay).toBe("FRI");
    expect(it!.minutesByDay).toMatchObject({ FRI: 11, SAT: 0 });
    // the §3.1 guard 3 now applies: a hand-typed mark on a record of this item is refused
    expect(await manualCheckRefusal("ASSIGNMENT", item._id)).toContain("প্রশ্নভিত্তিক শিটে");
  });

  it("the AS ledger rows are written ONCE: finalise writes them, the issue lock finds them (no double count)", async () => {
    const before = await QuestionUse.find({ sourceId: paperId, kind: "AS", withdrawnAt: null }).lean();
    expect(before.map((r) => r.qid)).toEqual([MQ(1)]);
    const res = await confirmAssignmentWeek({ academicYearId: String(yearId), sectionId, weekNumber: item.weekNumber, actorId: TEACHER_ID });
    expect(res.itemsIssued).toBe(1); // AC-C5: within the cap the week issues
    const after = await QuestionUse.find({ sourceId: paperId, kind: "AS" }).lean();
    expect(after).toHaveLength(1);
    expect(after[0]!.givenOn).toBe(before[0]!.givenOn);
    expect((await MasteryPaper.findById(paperId))!.lockedAt).toBeTruthy(); // locked at issue (guard 4)
    // AC-C5: present → GIVEN, absent → ABSENT_REDELIVER
    const recs = await AssignmentStudentRecord.find({ asItemId: item._id }).lean();
    expect(recs.filter((r) => r.state === "GIVEN")).toHaveLength(5);
    expect(recs.filter((r) => r.state === "ABSENT_REDELIVER")).toHaveLength(1);
  });

  it("guard 1: confirm is refused while a record is GIVEN, naming the children", async () => {
    await expect(confirmPaper(paperCode, TEACHER)).rejects.toThrow(/আগে জমা নেওয়ার হিসাব শেষ করুন/);
  });

  it("write-back: totals on the child's OWN items, SUBMITTED → CHECKED, the internal result, no resubmission; a correction rewrites one child", async () => {
    const recs = await AssignmentStudentRecord.find({ asItemId: item._id, state: "GIVEN" });
    for (const r of recs) {
      await transitionAssignmentRecord(String(r._id), "DUE", TEACHER_ID);
      await transitionAssignmentRecord(String(r._id), "SUBMITTED", TEACHER_ID);
    }
    const before = await AssignmentStudentRecord.countDocuments({ asItemId: item._id });
    const paper = (await MasteryPaper.findById(paperId))!;
    // child 1's own line is the item whose text names index 0 (Part A is item 1)
    const ownNo = (idx: number) => paper.items.find((i) => i.textBn === `অংশ খ MATH ${idx}`)!.itemNo;
    await saveResults(paperCode, [
      { studentId: sids[0]!, items: [{ itemNo: ownNo(0), marks: 1 }] }, // own 4 → 1: earned 2 + 1 = 3 of 6 → 50 % PARTIAL
      { studentId: sids[1]!, items: [{ itemNo: ownNo(1), marks: 0 }, { itemNo: 1, marks: 0 }] }, // 0 of 6 → WRONG
    ], TEACHER);
    await confirmPaper(paperCode, TEACHER);
    const rec = (i: number) => AssignmentStudentRecord.findOne({ asItemId: item._id, studentId: sids[i], resubOf: null }).lean();
    const [r0, r1, r2, r5] = await Promise.all([rec(0), rec(1), rec(2), rec(5)]);
    expect([r0!.marks, r0!.availableMarks, r0!.state, r0!.result]).toEqual([3, 6, "CHECKED", "PARTIAL"]);
    expect([r1!.marks, r1!.availableMarks, r1!.state, r1!.result]).toEqual([0, 6, "CHECKED", "WRONG"]);
    expect([r2!.marks, r2!.availableMarks, r2!.state, r2!.result]).toEqual([6, 6, "CHECKED", "CORRECT"]);
    expect(r5!.state).toBe("ABSENT_REDELIVER"); // the absent child: no total, no evidence
    expect(r5!.marks).toBeUndefined();
    expect(await MasteryEvidence.countDocuments({ paperId, studentId: sids[5] })).toBe(0);
    expect(await AssignmentStudentRecord.countDocuments({ asItemId: item._id })).toBe(before); // a derived WRONG spawns nothing
    // AS evidence is written (the GH-3 / diagnosis input): source AS, at home
    expect(await MasteryEvidence.countDocuments({ paperId, source: "AS" })).toBeGreaterThan(0);
    // a correction (child 2 loses a mark) rewrites ONLY that child's total
    await saveResults(paperCode, [{ studentId: sids[2]!, items: [{ itemNo: ownNo(2), marks: 2 }] }], TEACHER);
    expect((await rec(2))!.marks).toBe(4);
    expect((await rec(0))!.marks).toBe(3);
  });
});

// ---------------------------------------------------------------------------
describe("switch ON: a delivered item gets its AS paper (Part A only)", () => {
  beforeAll(async () => {
    await setLoop(true, { minutesPerMark: 1.8 });
  });

  it("MATH (tree locked) → a normal paper; ENG (no tree) → a MARKS-ONLY paper; minutes follow marks (R26), day split set", async () => {
    const math = await schedule("MATH", 1);
    const mathSet = await basketSet("MATH", [MQ(2), MQ(3), MQ(4)]);
    const d = await deliver(math.entryId, math.weekNumber, mathSet);
    const item = (await AssignmentItem.findById(d.itemId))!;
    const paper = (await MasteryPaper.findOne({ "links.asItemId": item._id }))!;
    expect(paper.source).toBe("AS");
    expect(paper.trackerLinked).toBe(true);
    expect(paper.marksOnly).toBeFalsy();
    expect(paper.items.map((i) => i.qid)).toEqual([MQ(2), MQ(3), MQ(4)]);
    expect(paper.items[0]!.loCodes).toEqual([A]);
    expect(paper.perStudentItems).toHaveLength(0); // Part A only: every child has every item
    expect(item.estMinutes).toBe(11); // 6 marks × 1.8
    expect(item.doOnDay).toBe("FRI");

    const eng = await schedule("ENG", 1);
    const e = await deliver(eng.entryId, eng.weekNumber, await basketSet("ENG", [EQ(1), EQ(2)]));
    const engPaper = (await MasteryPaper.findOne({ "links.asItemId": new Types.ObjectId(e.itemId) }))!;
    expect(engPaper.marksOnly).toBe(true);
    expect(engPaper.items.every((i) => i.loCodes.length === 0)).toBe(true);
    // the week reconcile now counts both subjects with the policy rate
    const load = await assignmentWeekLoad(String(yearId), sectionId, 1);
    expect(load.totalMinutes).toBe(11 + 7); // (4 marks × 1.8) = 7
    expect(load.ceiling).toBe(360);
  });

  it("a delivery with no question set makes no paper — it stays a 2026-style tracker row", async () => {
    const sci = await schedule("SCI", 1);
    const d = await deliver(sci.entryId, sci.weekNumber, null);
    expect(await MasteryPaper.countDocuments({ "links.asItemId": new Types.ObjectId(d.itemId) })).toBe(0);
  });

  it("a sheet-linked item's minutes cannot be typed (trim the questions) — edit and trim both refuse", async () => {
    const math = await schedule("MATH", 2);
    const d = await deliver(math.entryId, math.weekNumber, await basketSet("MATH", [MQ(5), MQ(6)]));
    await expect(updateAssignmentItem({ itemId: d.itemId, estMinutes: 5, actorId: TEACHER_ID, isAdmin: true })).rejects.toThrow("প্রশ্নভিত্তিক শিটের সময়");
    await expect(setAssignmentItemMinutes(d.itemId, 5)).rejects.toThrow("প্রশ্নভিত্তিক শিটের সময়");
  });

  it("changing the question set re-syncs the paper while it is open; once the week is issued the paper is locked (guard 4)", async () => {
    const math = await schedule("MATH", 3);
    const d = await deliver(math.entryId, math.weekNumber, await basketSet("MATH", [MQ(7), MQ(8)]));
    const swapped = await basketSet("MATH", [MQ(7), MQ(9), MQ(10)]);
    await updateAssignmentItem({ itemId: d.itemId, setId: swapped, actorId: TEACHER_ID, isAdmin: true });
    const paper = (await MasteryPaper.findOne({ "links.asItemId": new Types.ObjectId(d.itemId) }))!;
    expect(paper.items.map((i) => i.qid)).toEqual([MQ(7), MQ(9), MQ(10)]);
    await confirmAssignmentWeek({ academicYearId: String(yearId), sectionId, weekNumber: 3, actorId: TEACHER_ID });
    const locked = await MasteryPaper.findById(paper._id);
    expect(locked!.lockedAt).toBeTruthy();
    expect(await QuestionUse.countDocuments({ sourceId: paper._id, kind: "AS", withdrawnAt: null })).toBe(3);
    await expect(updateAssignmentItem({ itemId: d.itemId, setId: await basketSet("MATH", [MQ(11)]), actorId: TEACHER_ID, isAdmin: true })).rejects.toThrow(PAPER_LOCKED_MESSAGE);
  });

  it("AC-C12: a second delivery of the same cell points to the extra homework", async () => {
    const math = await schedule("MATH", 1);
    await expect(deliver(math.entryId, math.weekNumber, null)).rejects.toThrow(SECOND_ASSIGNMENT_MESSAGE);
  });

  it("roll case 1: a previous week whose Sunday due rolled to the Monday of the next week's ISO week does NOT refuse the next delivery", async () => {
    const sci5 = await schedule("SCI", 5);
    const resolved = await resolveScheduleWeek(scheduleDoc!, 5);
    const due = new Date(resolved.dueDate!);
    const rolled = new Date(due.getFullYear(), due.getMonth(), due.getDate() - 6); // the Monday of week 5's ISO week
    await AssignmentItem.create({
      asId: "AS-C3-SCI-9999", academicYearId: yearId, scheduleEntryId: new Types.ObjectId(), weekNumber: 99, cycleWeek: 1, classId, classLevel: 3,
      sectionId: new Types.ObjectId(sectionId), subject: "SCI", teacherId: new Types.ObjectId(TEACHER_ID), deliveryDate: resolved.deliveryDate!, dueDate: rolled,
      estMinutes: 10, status: "DRAFT", deliveredBy: new Types.ObjectId(TEACHER_ID), deliveredAt: new Date(),
    });
    expect(isoWeekKey(new Date(Date.UTC(rolled.getFullYear(), rolled.getMonth(), rolled.getDate())))).toBe(isoWeekKey(new Date(Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()))));
    await expect(deliver(sci5.entryId, 5, null)).resolves.toMatchObject({ weekNumber: 5 });
  });

  it("roll case 2: a tailored paper built for the Sunday is linked to the item whose due day rolled to the Monday — never a second, untailored paper", async () => {
    const tailored = await draftAssignment("MATH", "2027-05-23", 2, 4, { bankA: true });
    await send(tailored._id);
    const item = await trackerItem("MATH", "2027-05-24", { setId: new Types.ObjectId(await basketSet("MATH", [MQ(13), MQ(14)])) });
    const { onAssignmentItemDelivered } = await import("../modules/mastery/services/AssignmentPaperService");
    await onAssignmentItemDelivered(item, TEACHER_ID);
    const papers = await MasteryPaper.find({ "links.asItemId": item._id });
    expect(papers).toHaveLength(1);
    expect(String(papers[0]!.links.assignmentId)).toBe(String(tailored._id));
    expect(papers[0]!.trackerLinked).toBe(true);
    // a DRAFT tailored assignment of that week also stops an untailored paper from being made
    await draftAssignment("MATH", "2027-05-30", 2, 4, { bankA: true });
    const item2 = await trackerItem("MATH", "2027-06-01", { setId: new Types.ObjectId(await basketSet("MATH", [MQ(13), MQ(14)])) });
    await onAssignmentItemDelivered(item2, TEACHER_ID);
    expect(await MasteryPaper.countDocuments({ "links.asItemId": item2._id })).toBe(0);
  });

  it("a failing tailored send leaves the untailored paper in place; the successful send replaces it", async () => {
    const item = await trackerItem("MATH", "2027-06-06", { setId: new Types.ObjectId(await basketSet("MATH", [MQ(13), MQ(14)])) });
    const { onAssignmentItemDelivered } = await import("../modules/mastery/services/AssignmentPaperService");
    await onAssignmentItemDelivered(item, TEACHER_ID);
    const untailored = (await MasteryPaper.findOne({ "links.asItemId": item._id }))!;
    expect(untailored.links.assignmentId).toBeUndefined();
    const asg = await draftAssignment("MATH", "2027-06-06", 2, 4, { bankA: true });
    const spy = jest.spyOn(MasteryPaper, "create").mockRejectedValueOnce(new Error("boom") as never);
    await expect(send(asg._id)).rejects.toThrow("boom");
    spy.mockRestore();
    expect(await MasteryPaper.countDocuments({ "links.asItemId": item._id })).toBe(1);
    expect(await MasteryPaper.exists({ _id: untailored._id })).toBeTruthy(); // never left without a paper
    await send(asg._id);
    const now = await MasteryPaper.find({ "links.asItemId": item._id });
    expect(now).toHaveLength(1);
    expect(now[0]!.links.assignmentId).toBeTruthy();
    expect(await MasteryPaper.exists({ _id: untailored._id })).toBeNull();
  });

  it("removing the question set clears the item's day split (no stale split for the week's day check)", async () => {
    const math = await schedule("MATH", 6);
    const d = await deliver(math.entryId, 6, await basketSet("MATH", [MQ(1), MQ(2)]));
    expect((await AssignmentItem.findById(d.itemId))!.doOnDay).toBe("FRI");
    await updateAssignmentItem({ itemId: d.itemId, setId: "", actorId: TEACHER_ID, isAdmin: true });
    const it = (await AssignmentItem.findById(d.itemId))!;
    expect(await MasteryPaper.countDocuments({ "links.asItemId": it._id })).toBe(0);
    expect(it.doOnDay).toBeUndefined();
    expect(it.minutesByDay).toBeUndefined();
  });

  it("editing the question set's basket in place re-syncs the item's open paper; resyncAssignmentPaper refuses a locked one", async () => {
    const set = await AssessmentSet.create({
      setType: "AS", sectionId: new Types.ObjectId(sectionId), classId, status: "draft", createdBy: new Types.ObjectId(TEACHER_ID),
      basketItems: [{ artifactId: new Types.ObjectId(gold.get(MQ(1))!), qid: MQ(1), marks: 2 }],
    });
    const math = await schedule("MATH", 7);
    const d = await deliver(math.entryId, 7, String(set._id));
    const paperOf = () => MasteryPaper.findOne({ "links.asItemId": new Types.ObjectId(d.itemId) });
    expect((await paperOf())!.items.map((i) => i.qid)).toEqual([MQ(1)]);
    const { addQuestionToSet } = await import("../modules/assessment/services/AssessmentService");
    await addQuestionToSet(String(set._id), gold.get(MQ(2))!, TEACHER_ID);
    expect((await paperOf())!.items.map((i) => i.qid)).toEqual([MQ(1), MQ(2)]);
    expect((await AssignmentItem.findById(d.itemId))!.estMinutes).toBe(7); // 4 marks × 1.8
    const { resyncAssignmentPaper } = await import("../modules/mastery/services/AssignmentPaperService");
    await expect(resyncAssignmentPaper(d.itemId, TEACHER_ID)).resolves.toEqual({ changed: false });
    await MasteryPaper.updateOne({ _id: (await paperOf())!._id }, { $set: { lockedAt: new Date() } });
    await AssessmentSet.updateOne({ _id: set._id }, { $push: { basketItems: { artifactId: new Types.ObjectId(gold.get(MQ(3))!), qid: MQ(3), marks: 2 } } });
    await expect(resyncAssignmentPaper(d.itemId, TEACHER_ID)).rejects.toThrow(PAPER_LOCKED_MESSAGE);
  });

  it("a delivery whose sheet cannot be made still delivers, with a Bangla paperWarning", async () => {
    const math = await schedule("MATH", 8);
    const bad = await AssessmentSet.create({
      setType: "AS", sectionId: new Types.ObjectId(sectionId), classId, status: "assembled", createdBy: new Types.ObjectId(TEACHER_ID),
      basketItems: [{ artifactId: new Types.ObjectId(), qid: "QP-NOT-IN-BANK", marks: 2 }],
    });
    const d = await deliver(math.entryId, 8, String(bad._id));
    expect(d.itemId).toBeTruthy();
    expect(d.paperWarning).toContain("প্রশ্নভিত্তিক শিট তৈরি হয়নি:");
    expect(await MasteryPaper.countDocuments({ "links.asItemId": new Types.ObjectId(d.itemId) })).toBe(0);
  });

  it("if the lock at issue fails, the AS ledger rows are still written (the homework fallback) and the failure is reported", async () => {
    const item = await trackerItem("MATH", "2027-06-13", { setId: new Types.ObjectId(await basketSet("MATH", [MQ(15), MQ(16)])) });
    const { onAssignmentItemDelivered, onAssignmentIssued } = await import("../modules/mastery/services/AssignmentPaperService");
    await onAssignmentItemDelivered(item, TEACHER_ID);
    const paper = (await MasteryPaper.findOne({ "links.asItemId": item._id }))!;
    const spy = jest.spyOn(MasteryPaper, "updateOne").mockRejectedValueOnce(new Error("lock down") as never);
    await expect(onAssignmentIssued(item._id)).rejects.toThrow("lock down");
    spy.mockRestore();
    const rows = await QuestionUse.find({ sourceId: paper._id, kind: "AS", withdrawnAt: null }).lean();
    expect(rows.map((r) => r.qid).sort()).toEqual([MQ(15), MQ(16)]);
  });
});

// ---------------------------------------------------------------------------
describe("CW — an absent child is defaulted ABSENT (no in-school evidence)", () => {
  it("a child the register shows absent that day gets no evidence from the CW sheet", async () => {
    const { StudentAttendanceDay } = await import("../modules/attendance/models/StudentAttendanceDay");
    await setLoop(true);
    await StudentAttendanceDay.create({ dateKey: "2026-11-11", sectionId: new Types.ObjectId(sectionId), absentStudentIds: [new Types.ObjectId(sids[4]!)], markedBy: new Types.ObjectId(TEACHER_ID), markedAt: new Date() } as never);
    const cw = await createPaper({ sectionId, subject: "MATH", source: "CW", date: "2026-11-11", items: [{ origin: "BANK", artifactId: gold.get(MQ(13)), loCode: A, questionTypeCode: "QT-SHORT" }] }, TEACHER);
    await confirmPaper(cw.paperId, TEACHER);
    const paper = (await MasteryPaper.findOne({ paperId: cw.paperId }))!;
    expect(await MasteryEvidence.countDocuments({ paperId: paper._id, studentId: sids[4] })).toBe(0);
    expect(await MasteryEvidence.countDocuments({ paperId: paper._id, studentId: sids[3] })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("CW — the in-class work paper and the in-school rule through the services (AC-D4)", () => {
  const S = () => sids[0]!;
  beforeAll(async () => {
    await setLoop(true);
  });
  const evRow = (paperId: Types.ObjectId, source: string, date: string, n: number, over: Record<string, unknown> = {}) => {
    const at = new Date(`${date}T00:00:00.000Z`);
    return {
      studentId: new Types.ObjectId(S()), sectionId: new Types.ObjectId(sectionId), academicYearId: yearId, classToken: "C3", subject: "MATH", loCode: A,
      chapterNumber: 7, source, paperId, itemNo: n, qid: `Z-${source}-${n}`, earned: 2, available: 2, at, week: isoWeekKey(at), signal: "NONE", ...over,
    };
  };

  it("four good homework / assignment items in two weeks → IMPROVING ('ক্লাসে যাচাই বাকি'); after a good CW item → MASTERED", async () => {
    await MasteryEvidence.deleteMany({});
    const p = new Types.ObjectId();
    await MasteryEvidence.create([
      evRow(p, "HW", "2027-05-03", 1), evRow(p, "HW", "2027-05-04", 2), evRow(p, "AS", "2027-05-10", 3), evRow(p, "HW", "2027-05-11", 4),
    ].map((r, i) => ({ ...r, paperId: new Types.ObjectId(), itemNo: 1, qid: `Z-${i}` })));
    const policy = (await getPolicy("C3", "MATH")).resolved;
    const rows = await liveSectionRows(new Types.ObjectId(sectionId), "MATH", A);
    expect(rows.every((r) => r.inSchool === false)).toBe(true);
    const before = computeSection(rows, policy, new Date("2027-05-20T00:00:00Z")).states.get(A)!.get(S())!;
    expect(before.state).toBe("IMPROVING");
    expect(before.inSchoolPending).toBe(true);

    // the CW paper through the services: created, confirmed → in-school evidence
    const cw = await createPaper({ sectionId, subject: "MATH", source: "CW", date: "2026-11-10", items: [{ origin: "BANK", artifactId: gold.get(MQ(12)), loCode: A, questionTypeCode: "QT-SHORT" }] }, TEACHER);
    expect(cw.source).toBe("CW");
    expect(await QuestionUse.countDocuments({ sourceType: "MASTERY_PAPER", qid: MQ(12) })).toBe(0); // never given for home
    await confirmPaper(cw.paperId, TEACHER);
    expect(await MasteryEvidence.countDocuments({ source: "CW", studentId: S() })).toBe(1);
    const rows2 = await liveSectionRows(new Types.ObjectId(sectionId), "MATH", A);
    expect(rows2.filter((r) => r.inSchool)).toHaveLength(6); // the six children's CW rows
    const after = computeSection(rows2, policy, new Date("2027-05-20T00:00:00Z")).states.get(A)!.get(S())!;
    expect(after.state).toBe("MASTERED");
    // the same evidence with the switch OFF reads the 2026 way: MASTERED already without the CW item
    const off = computeSection(rows, { ...policy, academicLoop2027On: false }, new Date("2027-05-20T00:00:00Z")).states.get(A)!.get(S())!;
    expect(off.state).toBe("MASTERED");
  });

  it("a CW sheet is dated today or earlier, never linked to homework or a test, and never printed for home", async () => {
    const item = [{ origin: "TEACHER" as const, textBn: "ক", loCode: A, questionTypeCode: "QT-SHORT" }];
    await expect(createPaper({ sectionId, subject: "MATH", source: "CW", date: "2099-01-01", items: item }, TEACHER)).rejects.toThrow("আজকের পরে");
    await expect(createPaper({ sectionId, subject: "MATH", source: "CW", date: "2026-11-10", hwItemId: String(new Types.ObjectId()), items: item }, TEACHER)).rejects.toThrow("বাড়ির কাজ");
    const { createPrintRequest } = await import("../modules/printing/services/PrintRequestService");
    const cw = (await MasteryPaper.findOne({ source: "CW" }))!;
    await expect(
      createPrintRequest({ title: "x", purpose: "HOMEWORK", sourceType: "MASTERY_PAPER", masteryPaperId: String(cw._id), actorId: TEACHER_ID } as never),
    ).rejects.toThrow(/শুধু বাড়ির কাজ বা অ্যাসাইনমেন্টের শিট/);
  });
});

// ---------------------------------------------------------------------------
describe("the section trigger (AC-F2), the recompute report and the CT warning (AC-F1)", () => {
  const section = () => new Types.ObjectId(sectionId);
  const row = (studentId: string, paperId: Types.ObjectId, source: string, date: string, earned: number, n = 1) => {
    const at = new Date(`${date}T00:00:00.000Z`);
    return {
      studentId: new Types.ObjectId(studentId), sectionId: section(), academicYearId: yearId, classToken: "C3", subject: "MATH", loCode: A, chapterNumber: 7,
      source, paperId, itemNo: n, qid: `T-${String(paperId)}-${studentId}`, earned, available: 2, at, week: isoWeekKey(at), signal: "NONE",
    };
  };
  const reset = async () => {
    await MasteryEvidence.deleteMany({});
    await MasteryAction.deleteMany({});
  };

  it("homework-only weakness opens a proposal with the switch OFF (2026) and NONE with it on; in-school weakness then opens one", async () => {
    await reset();
    const [h1, h2] = [new Types.ObjectId(), new Types.ObjectId()];
    // all six children are weak on two homework papers (0 / 2)
    await MasteryEvidence.create(sids.flatMap((s) => [row(s, h1, "HW", "2027-06-01", 0), row(s, h2, "HW", "2027-06-02", 0)]));
    await setLoop(false);
    expect(await evaluateSectionTriggers(section(), "MATH")).toBe(1); // 2026: every child's state counts
    await MasteryAction.deleteMany({});
    await setLoop(true);
    expect(await evaluateSectionTriggers(section(), "MATH")).toBe(0); // 2027: homework state is not in-school evidence
    // the same children are weak in two class papers → one PROPOSED action, counting the in-school papers
    const [c1, c2] = [new Types.ObjectId(), new Types.ObjectId()];
    await MasteryEvidence.create(sids.flatMap((s) => [row(s, c1, "CT", "2027-06-08", 0), row(s, c2, "CW", "2027-06-15", 0)]));
    expect(await evaluateSectionTriggers(section(), "MATH")).toBe(1);
    const action = (await MasteryAction.findOne({ sectionId: section(), loCode: A }))!;
    expect(action.status).toBe("PROPOSED");
    expect(action.trigger?.assessments).toBe(2); // the two in-school papers, not the four
    expect(action.trigger?.verdicts).toBe(6);
  });

  it("R17: a section action opened by the in-school trigger uses it everywhere — attendees, before % and the child list; OFF is the 2026 numbers", async () => {
    await reset();
    await setLoop(true);
    const [h1, h2, c1, c2] = [1, 2, 3, 4].map(() => new Types.ObjectId());
    await MasteryEvidence.create([
      // kids 0-2: weak at home AND in class; kid 3: weak at home only; kids 4-5: good at home
      ...sids.slice(0, 4).flatMap((s) => [row(s, h1, "HW", "2027-06-01", 0), row(s, h2, "HW", "2027-06-02", 0)]),
      ...sids.slice(4).flatMap((s) => [row(s, h1, "HW", "2027-06-01", 2), row(s, h2, "HW", "2027-06-02", 2)]),
      ...sids.slice(0, 3).flatMap((s) => [row(s, c1, "CT", "2027-06-08", 0), row(s, c2, "CT", "2027-06-15", 0)]),
    ]);
    expect(await evaluateSectionTriggers(section(), "MATH")).toBe(1);
    const action = (await MasteryAction.findOne({ sectionId: section(), loCode: A }))!;
    expect(action.trigger.weakStudentIds.map(String).sort()).toEqual(sids.slice(0, 3).sort());
    const { decideAction, actionDetail } = await import("../modules/mastery/services/MasteryActionService");
    const approved = await decideAction(String(action._id), { decision: "RETEACH", attendees: "WEAK" }, PRINCIPAL as never);
    const planned = (await MasteryAction.findById(action._id))!;
    expect(planned.plan!.studentIds.map(String).sort()).toEqual(sids.slice(0, 3).sort()); // not kid 3 (WEAK only by homework)
    expect(planned.before!.weakPct).toBe(100); // in-school: 3 of the 3 children with a class item
    expect(approved.now.weakPct).toBe(100);
    void actionDetail;
    // the same action decided with the rule OFF reads the 2026 numbers (every child's state)
    await MasteryAction.deleteMany({});
    await MasteryAction.create({
      scope: "SECTION", sectionId: section(), classId, academicYearId: yearId, classToken: "C3", subject: "MATH", loCode: A, kind: "EXTRA_CLASS", status: "PROPOSED",
      trigger: { at: new Date(), weakPct: 100, weak: 3, verdicts: 3, assessments: 2, weakStudentIds: sids.slice(0, 3).map((s) => new Types.ObjectId(s)) }, events: [{ at: new Date(), kind: "PROPOSED" }],
    });
    await setLoop(false);
    const off = (await MasteryAction.findOne({ loCode: A }))!;
    await decideAction(String(off._id), { decision: "RETEACH", attendees: "WEAK" }, PRINCIPAL as never);
    const after = (await MasteryAction.findById(off._id))!;
    expect(after.plan!.studentIds).toHaveLength(4); // kids 0-3: WEAK by state
    expect(after.before!.weakPct).toBe(67); // 4 of 6
    await setLoop(true);
  });

  it("only 2 of 6 children with an in-school item (both weak) → none: below sectionTriggerMinAssessedPct (50 %)", async () => {
    await reset();
    const [c1, c2] = [new Types.ObjectId(), new Types.ObjectId()];
    await MasteryEvidence.create(sids.slice(0, 2).flatMap((s) => [row(s, c1, "CT", "2027-06-08", 0), row(s, c2, "CT", "2027-06-15", 0)]));
    expect(await evaluateSectionTriggers(section(), "MATH")).toBe(0);
    // with 3 of 6 (exactly 50 %) it fires
    await MasteryEvidence.create([row(sids[2]!, c1, "CT", "2027-06-08", 0), row(sids[2]!, c2, "CT", "2027-06-15", 0)]);
    expect(await evaluateSectionTriggers(section(), "MATH")).toBe(1);
  });

  it("the recompute report lists what the in-school rule moves, refuses --apply with the switch off, and opens triggers with it on", async () => {
    await reset();
    const evs = sids.slice(0, 2).flatMap((s) => [
      row(s, new Types.ObjectId(), "HW", "2027-06-01", 2, 1), row(s, new Types.ObjectId(), "HW", "2027-06-02", 2, 1),
      row(s, new Types.ObjectId(), "AS", "2027-06-08", 2, 1), row(s, new Types.ObjectId(), "HW", "2027-06-09", 2, 1),
    ]);
    await MasteryEvidence.create(evs);
    await setLoop(false);
    const dry = await recomputeForSwitch({ now: new Date("2027-06-20T00:00:00Z") });
    expect(dry.switchOn).toBe(false);
    const row0 = dry.rows.find((r) => r.sectionId === sectionId)!;
    expect(row0.statesChanged).toBe(2); // two children: MASTERED (2026) → IMPROVING (2027)
    expect(row0.masteredLost).toBe(2);
    await expect(recomputeForSwitch({ apply: true })).rejects.toThrow(/switch it on first/);
    await setLoop(true);
    const applied = await recomputeForSwitch({ apply: true, now: new Date("2027-06-20T00:00:00Z") });
    expect(applied.applied).toBe(true);
    expect(applied.opened).toBe(0); // nobody is weak in class
  });

  it("AC-F1: a mastery-ON class test with no linked sheet warns (switch on); linking a sheet clears it; never a block", async () => {
    await setLoop(true);
    const ct = await ClassTest.create({
      ctId: "CT-C3-MATH-9002", academicYearId: yearId, sectionId: section(), subject: "MATH", testNumber: 2,
      examDate: new Date("2027-07-01T00:00:00Z"), totalMarks: 8, passMark: 3, source: "UPLOADED_PAPER", status: "PRINTED",
      requestedBy: new Types.ObjectId(TEACHER_ID), teacherId: new Types.ObjectId(TEACHER_ID),
    });
    expect((await classTestSheetLink(String(ct._id))).noSheetWarning).toBe(true);
    const items = [1, 2, 3, 4].map((n) => ({ origin: "TEACHER" as const, textBn: `প্রশ্ন ${n}`, loCode: A, questionTypeCode: "QT-SHORT" }));
    await createPaper({ sectionId, subject: "MATH", source: "CT", date: "2027-07-01", classTestId: String(ct._id), items }, TEACHER);
    const link = await classTestSheetLink(String(ct._id));
    expect(link.noSheetWarning).toBe(false);
    expect(link.paperId).not.toBeNull();
  });
});
