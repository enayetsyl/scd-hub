/**
 * Mastery M-5 — section trigger → extra class → re-test → close (docs/prd-mastery.md §10 journeys
 * 6–7; D-#781 / #786 / #811).
 *
 *  - suggestOutcome (pure)
 *  - the trigger opens one PROPOSED action only after enough sheets, never a duplicate
 *  - approval: an Office user with the per-person `mastery:approve` grant succeeds; Office
 *    without it and a teacher are refused; REJECT needs a reason
 *  - plan: attendees = the WEAK students; re-test date defaults to class + retestAfterDays
 *  - held → re-test with unseen questions per attendee → marked → close with before / after
 *  - the section record lists it; the heat-map links the open action
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
import { MasteryAction } from "../modules/mastery/models/MasteryAction";
import { MasteryEvidence } from "../modules/mastery/models/MasteryEvidence";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { importCatalogue, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { confirmPaper, createPaper, paperDetail, saveResults } from "../modules/mastery/services/MasteryWorkService";
import { sectionHeatmap } from "../modules/mastery/services/MasteryDiagnosisService";
import {
  actionCounts,
  actionDetail,
  actionsPage,
  buildRetest,
  closeAction,
  decideAction,
  evaluateSectionTriggers,
  recordHeld,
  suggestOutcome,
} from "../modules/mastery/services/MasteryActionService";

jest.setTimeout(180_000);

describe("suggestOutcome (pure)", () => {
  it("SUCCESS under the line with ≥ 70 %; PARTIAL when something moved; else NOT_RESOLVED", () => {
    expect(suggestOutcome({ weakPct: 75, meanPct: 10 }, { weakPct: 25, meanPct: 80 }, 50)).toBe("SUCCESS");
    expect(suggestOutcome({ weakPct: 75, meanPct: 10 }, { weakPct: 60, meanPct: 40 }, 50)).toBe("PARTIAL");
    expect(suggestOutcome({ weakPct: 75, meanPct: 10 }, { weakPct: 75, meanPct: 15 }, 50)).toBe("NOT_RESOLVED");
  });
});

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
const OFFICE = { userId: new Types.ObjectId().toString(), role: "OFFICE" as const };
const OFFICE_APPROVER = { userId: new Types.ObjectId().toString(), role: "OFFICE" as const, grantedPermissions: ["mastery:approve"] as never };
let sectionId = "";
const sids: string[] = [];
const LO = "LO-C3-MATH-07-03";

const CATALOGUE = JSON.stringify({
  classToken: "C3",
  subject: "MATH",
  status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [{ code: LO, labelBn: "খাতায় লম্বা ভাগ", assess: "QUESTION", questionTypeCodes: ["QT-SOLVE"] }],
  questionTypes: [{ code: "QT-SOLVE", labelBn: "সমাধান করো", marks: 2 }],
});

async function hw(date: string, zeroFor: number[]) {
  const p = await createPaper({
    sectionId, subject: "MATH", source: "HW", date,
    items: [{ origin: "TEACHER", textBn: "৮৪৬ ÷ ৬", loCode: LO, questionTypeCode: "QT-SOLVE" }, { origin: "TEACHER", textBn: "৯৫২ ÷ ৭", loCode: LO, questionTypeCode: "QT-SOLVE" }],
  }, TEACHER);
  if (zeroFor.length) await saveResults(p.paperId, zeroFor.map((i) => ({ studentId: sids[i], items: [{ itemNo: 1, marks: 0 }, { itemNo: 2, marks: 0 }] })), TEACHER);
  await confirmPaper(p.paperId, TEACHER);
  return p.paperId;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = String(sec._id);
  for (let i = 1; i <= 4; i++) {
    const [s] = await Student.create([{ schoolId: `M5-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: sec._id, active: true }]);
    sids.push(String(s._id));
  }
  await importCatalogue(CATALOGUE, true, PRINCIPAL);
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL);
  const base = {
    docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 },
    curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold",
  };
  for (let i = 1; i <= 8; i++) {
    await ContentArtifact.create([{ ...base, envelopeJson: { tags: { topic_tag: LO }, payload: { qid: `QP-MATH-C3-U07-Q9600${i}`, topic_tag: LO, question_text: `ভাগ ${i}` } } }]);
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

describe("section trigger → extra class → re-test → close (DB)", () => {
  let actionId = "";

  it("one sheet is not enough; the second opens ONE proposal; re-evaluation never duplicates", async () => {
    await hw("2027-03-01", [0, 1, 2]);
    expect(await MasteryAction.countDocuments({})).toBe(0);
    await hw("2027-03-08", [0, 1, 2]);
    const open = await MasteryAction.find({}).lean();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ status: "PROPOSED", kind: "EXTRA_CLASS", loCode: LO, trigger: { weakPct: 75, weak: 3, verdicts: 4, assessments: 2 } });
    actionId = String(open[0]._id);
    expect(await evaluateSectionTriggers(new Types.ObjectId(sectionId), "MATH")).toBe(0);
    const h = await sectionHeatmap(sectionId, "MATH", TEACHER);
    expect(h.outcomes[0]).toMatchObject({ triggered: true, actionId, actionStatus: "PROPOSED" });
  });

  it("who may decide: Office with the grant yes; Office without it and a teacher no; reject needs a reason", async () => {
    const plan = { decision: "EXTRA_CLASS" as const, date: "2027-03-10", slotKind: "PERIOD" as const, periodNumber: 7, attendees: "WEAK" as const };
    await expect(decideAction(actionId, plan, OFFICE)).rejects.toThrow(/অনুমতি/);
    await expect(decideAction(actionId, plan, TEACHER)).rejects.toThrow(/অনুমতি/);
    await expect(decideAction(actionId, { decision: "REJECT" }, OFFICE_APPROVER)).rejects.toThrow(/কারণ/);
    await expect(decideAction(actionId, { ...plan, periodNumber: 0 }, OFFICE_APPROVER)).rejects.toThrow(/পিরিয়ড/);
    const d = await decideAction(actionId, plan, OFFICE_APPROVER);
    expect(d.status).toBe("APPROVED");
    expect(d.plan).toMatchObject({ date: "2027-03-10", slotKind: "PERIOD", periodNumber: 7, attendees: "WEAK", retestDate: "2027-03-17" });
    expect(d.students.filter((s) => s.inPlan).map((s) => s.studentId).sort()).toEqual([sids[0], sids[1], sids[2]].sort());
    expect(d.before).toMatchObject({ weakPct: 75, meanPct: 0 });
    await expect(decideAction(actionId, plan, PRINCIPAL)).rejects.toThrow(/আগেই/);
  });

  it("the teacher of the section sees it in the section record; an outsider does not", async () => {
    const page = await actionsPage("OPEN", { sectionId, subject: "MATH" }, {}, TEACHER);
    expect(page.rows.map((r) => r.id)).toEqual([actionId]);
    await expect(actionsPage("OPEN", {}, {}, TEACHER)).rejects.toThrow(/পুরো স্কুল/);
    mockTeacher.mockResolvedValue(null);
    await expect(actionDetail(actionId, { userId: new Types.ObjectId().toString(), role: "TEACHER" as const })).rejects.toThrow(/রুটিন/);
    expect((await actionCounts(OFFICE_APPROVER)).running).toBe(1);
  });

  it("held → re-test with unseen questions per attendee → marked → close", async () => {
    await expect(buildRetest(actionId, TEACHER)).rejects.toThrow(/আগে/);
    const held = await recordHeld(actionId, [{ studentId: sids[0], present: true }, { studentId: sids[1], present: true }, { studentId: sids[2], present: false }], TEACHER);
    expect(held.status).toBe("IN_PROGRESS");
    expect(held.students.find((s) => s.studentId === sids[2])!.present).toBe(false);

    const rt = await buildRetest(actionId, TEACHER);
    expect(rt.status).toBe("CHECKING");
    const paper = await MasteryPaper.findOne({ paperId: rt.retestPaperId! }).lean();
    expect(paper!.source).toBe("RETEST");
    expect(paper!.perStudentItems.map((x) => String(x.studentId)).sort()).toEqual([sids[0], sids[1]].sort());
    expect(paper!.perStudentItems.every((x) => x.itemNos.length === 2)).toBe(true);
    const d = await paperDetail(rt.retestPaperId!, TEACHER);
    expect(d.roster).toHaveLength(2);

    // Student 0 does well, student 1 does not; then confirm.
    await saveResults(rt.retestPaperId!, [{ studentId: sids[1], items: d.roster.find((r) => r.studentId === sids[1])!.itemNos!.map((n) => ({ itemNo: n, marks: 0 })) }], TEACHER);
    await confirmPaper(rt.retestPaperId!, TEACHER);
    const ev = await MasteryEvidence.countDocuments({ paperId: paper!._id, supersededAt: null });
    expect(ev).toBe(4);

    const before = await actionDetail(actionId, TEACHER);
    expect(before.retestConfirmed).toBe(true);
    expect(before.students.find((s) => s.studentId === sids[0])!.retestPct).toBe(100);
    expect(before.now.meanPct).toBe(50);
    expect(before.suggestedOutcome).toBe("PARTIAL");
    const closed = await closeAction(actionId, "PARTIAL", null, TEACHER);
    expect(closed).toMatchObject({ status: "CLOSED", outcome: "PARTIAL", after: { meanPct: 50 } });
    expect(closed.events.map((e) => e.kind)).toEqual(["PROPOSED", "APPROVED", "HELD", "RETEST_BUILT", "CLOSED"]);
    expect((await sectionHeatmap(sectionId, "MATH", TEACHER)).outcomes[0].actionId).toBeNull();
  });

  it("a closed action does not block a new proposal when the section is still over the line", async () => {
    await hw("2027-03-22", [0, 1, 2, 3]);
    const open = await MasteryAction.find({ status: "PROPOSED" }).lean();
    expect(open).toHaveLength(1);
    expect(String(open[0]._id)).not.toBe(actionId);
  });
});
