/**
 * Mastery M-6 — notifications and the guardian progress view (docs/prd-mastery.md §9, §10
 * journey 10; D-#783 / #812).
 *
 *  - dedupe keys carry the recipient (and the student for guardians) — never entity-only
 *  - a trigger tells every holder of mastery:approve (Principal + an Office grant), once
 *  - an approved extra class tells the routine teacher and each planned student's guardians;
 *    a re-teach tells the teacher only
 *  - a sent weekly assignment tells each student's guardians
 *  - childMasteryProgress: plain buckets, home tips, what the school did — no codes, no verdicts
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { masteryDedupe } from "../modules/mastery/notify";

const mockTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({
  resolveSubjectTeacher: (...a: unknown[]) => mockTeacher(...a),
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { User } from "../modules/foundation/models/User";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { Notification } from "../modules/notifications/models/Notification";
import { MasteryAction } from "../modules/mastery/models/MasteryAction";
import { importCatalogue, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { confirmPaper, createPaper, saveResults } from "../modules/mastery/services/MasteryWorkService";
import { decideAction } from "../modules/mastery/services/MasteryActionService";
import { approveAllSheets, buildAssignment, editSheet, sendAssignment } from "../modules/mastery/services/MasteryAssignmentService";
import { childMasteryProgress } from "../modules/mastery/services/MasteryGuardianService";

jest.setTimeout(180_000);

describe("dedupe keys (pure)", () => {
  it("carry the recipient — two people about the same thing never collide", () => {
    expect(masteryDedupe.proposal("a1", "u1")).not.toBe(masteryDedupe.proposal("a1", "u2"));
    expect(masteryDedupe.extraClassGuardian("a1", "s1", "g1")).not.toBe(masteryDedupe.extraClassGuardian("a1", "s2", "g1"));
    expect(masteryDedupe.assignmentSent("as1", "s1", "g1")).not.toBe(masteryDedupe.assignmentSent("as1", "s1", "g2"));
  });
});

let mongo: MongoMemoryServer;
let PRINCIPAL = { userId: "", role: "PRINCIPAL" as const };
let officeApproverId = "";
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
let sectionId = "";
const sids: string[] = [];
const gids: string[] = [];
const LO = "LO-C3-MATH-07-03";

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [p] = await User.create([{ email: "p@m6.test", passwordHash: "x", role: "PRINCIPAL", name: "Principal", active: true }]);
  PRINCIPAL = { userId: String(p._id), role: "PRINCIPAL" };
  const [o] = await User.create([{ email: "o@m6.test", passwordHash: "x", role: "OFFICE", name: "Office", active: true, grantedPermissions: ["mastery:approve"] }]);
  officeApproverId = String(o._id);
  await User.create([{ email: "o2@m6.test", passwordHash: "x", role: "OFFICE", name: "Office 2", active: true }]);
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = String(sec._id);
  for (let i = 1; i <= 3; i++) {
    const [s] = await Student.create([{ schoolId: `M6-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: sec._id, active: true }]);
    sids.push(String(s._id));
    const [g] = await Guardian.create([{ identifierKind: "phone", identifier: `0170000000${i}`, phone: `0170000000${i}`, name: `G${i}`, loginEnabled: true, active: true }]);
    gids.push(String(g._id));
    await GuardianLink.create([{ guardianId: g._id, studentId: s._id, relation: "FATHER" }]);
  }
  await importCatalogue(JSON.stringify({
    classToken: "C3", subject: "MATH", status: "LOCKED",
    chapters: [{ number: 7, titleBn: "ভাগ" }],
    outcomes: [{ code: LO, labelBn: "খাতায় লম্বা ভাগ", assess: "QUESTION", questionTypeCodes: ["QT-SOLVE"], homeTipBn: "প্রতিদিন একটি ভাগ খাতায় করান।" }],
    questionTypes: [{ code: "QT-SOLVE", labelBn: "সমাধান করো", marks: 2 }],
  }), true, PRINCIPAL);
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL);
  const base = {
    docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 },
    curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold",
  };
  for (let i = 1; i <= 8; i++) {
    await ContentArtifact.create([{ ...base, envelopeJson: { tags: { topic_tag: LO }, payload: { qid: `QP-MATH-C3-U07-Q9700${i}`, topic_tag: LO, question_text: `ভাগ ${i}` } } }]);
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

async function hw(date: string, zeroFor: number[]) {
  const p = await createPaper({
    sectionId, subject: "MATH", source: "HW", date,
    items: [{ origin: "TEACHER", textBn: "৮৪৬ ÷ ৬", loCode: LO, questionTypeCode: "QT-SOLVE" }, { origin: "TEACHER", textBn: "৯৫২ ÷ ৭", loCode: LO, questionTypeCode: "QT-SOLVE" }],
  }, TEACHER);
  await saveResults(p.paperId, zeroFor.map((i) => ({ studentId: sids[i], items: [{ itemNo: 1, marks: 0 }, { itemNo: 2, marks: 0 }] })), TEACHER);
  await confirmPaper(p.paperId, TEACHER);
}

describe("mastery notifications + guardian progress (DB)", () => {
  it("a proposal tells every approver (Principal + the Office grant, not other Office) — once", async () => {
    await hw("2027-03-01", [0, 1]);
    await hw("2027-03-08", [0, 1]);
    const rows = await Notification.find({ kind: "MASTERY_PROPOSAL" }).lean();
    expect(rows.map((r) => String(r.recipientUserId)).sort()).toEqual([PRINCIPAL.userId, officeApproverId].sort());
    expect(rows[0].refs?.masteryActionId).toBeTruthy();
    await hw("2027-03-09", [0, 1]); // re-evaluated, still the same open action
    expect(await Notification.countDocuments({ kind: "MASTERY_PROPOSAL" })).toBe(2);
  });

  it("an approved extra class tells the teacher and each planned student's guardians", async () => {
    const a = await MasteryAction.findOne({ status: "PROPOSED" }).lean();
    await decideAction(String(a!._id), { decision: "EXTRA_CLASS", date: "2027-03-11", slotKind: "PERIOD", periodNumber: 6, attendees: "WEAK" }, PRINCIPAL);
    const rows = await Notification.find({ kind: "MASTERY_EXTRA_CLASS" }).lean();
    expect(rows.filter((r) => r.recipientUserId).map((r) => String(r.recipientUserId))).toEqual([TEACHER_ID]);
    expect(rows.filter((r) => r.recipientGuardianId).map((r) => String(r.recipientGuardianId)).sort()).toEqual([gids[0], gids[1]].sort());
    const toG = rows.find((r) => String(r.recipientGuardianId) === gids[0])!;
    expect(toG.bodyBn).toMatch(/Student 1-এর জন্য/);
    expect(toG.bodyBn).not.toMatch(/দুর্বল|LO-C3/);
  });

  it("a sent weekly assignment tells each student's guardians", async () => {
    const layout = { totalMarks: 4, minutes: 20, partAOn: false, partAMarks: 0, partALoCodes: [], partBMarks: 4, mixWeak: 100, mixImproving: 0, mixRevision: 0, questionTypeCodes: [] };
    const as = await buildAssignment({ sectionId, subject: "MATH", dueDate: "2027-03-18", layout, rememberLayout: true }, TEACHER);
    const v = await approveAllSheets(as.id, TEACHER);
    for (const s of v.sheets.filter((x) => x.status !== "APPROVED")) await editSheet(as.id, s.studentId, { op: "APPROVE" }, TEACHER);
    await sendAssignment(as.id, TEACHER);
    const rows = await Notification.find({ kind: "MASTERY_ASSIGNMENT_SENT" }).lean();
    expect(rows.map((r) => String(r.recipientGuardianId)).sort()).toEqual([...gids].sort());
  });

  it("the guardian's progress view: plain buckets, home tip, what the school did", async () => {
    const [math] = await childMasteryProgress(sids[0]);
    expect(math.subject).toBe("MATH");
    expect(math.counts.attention).toBe(1);
    expect(math.attention[0]).toEqual({ labelBn: "খাতায় লম্বা ভাগ", homeTipBn: "প্রতিদিন একটি ভাগ খাতায় করান।" });
    expect(math.schoolDid).toEqual([expect.objectContaining({ date: "2027-03-11", kind: "EXTRA_CLASS", labelBn: "খাতায় লম্বা ভাগ", status: "APPROVED" })]);
    expect(math.assignmentsSent).toBe(1);
    expect(JSON.stringify(math)).not.toMatch(/LO-C3|দুর্বল|WEAK"/);
    const [other] = await childMasteryProgress(sids[2]);
    expect(other.schoolDid).toEqual([]);
  });
});
