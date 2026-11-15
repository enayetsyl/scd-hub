/**
 * D-#1633–#1635 — the Principal publishes a parents' meeting to guardians.
 *
 *   - the family reads the frozen numbers + the section best + the CURRENT final comment;
 *   - NEVER a class-teacher summary, a subject-teacher note, or a daily comment: a unique
 *     marker string seeded into every teacher-comment model must be absent from the JSON,
 *     and the guardian read path must not import those models at all (structural);
 *   - own child only; unpublished / withdrawn → not listed; publish is Principal-only;
 *   - publishing tells the families ONCE (pop-up + notification), every family on the
 *     meeting, attended or not; a printed snapshot beats a recompute; a later edit of the
 *     final comment shows.
 *
 * In-memory MongoDB, real services.
 */
import fs from "fs";
import path from "path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AppContext } from "../context";
import { ParentMeeting } from "../modules/comments/models/ParentMeeting";
import { ParentMeetingSlot } from "../modules/comments/models/ParentMeetingSlot";
import { MeetingComment } from "../modules/comments/models/MeetingComment";
import { MeetingSubjectNote } from "../modules/comments/models/MeetingSubjectNote";
import { MeetingFinalComment } from "../modules/comments/models/MeetingFinalComment";
import { StudentComment } from "../modules/comments/models/StudentComment";
import { ParentMeetingRelease } from "../modules/comments/models/ParentMeetingRelease";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { Student } from "../modules/foundation/models/Student";
import { User } from "../modules/foundation/models/User";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Notification } from "../modules/notifications/models/Notification";
import { PopupNotice } from "../modules/popup-notices/models/PopupNotice";
import {
  publishMeetingToGuardians,
  withdrawMeetingRelease,
  saveMeetingReleaseSnapshots,
  snapshotRowsFromBriefs,
  MEETING_RESULTS_TARGET,
  type ReleaseSnapshotRow,
} from "../modules/comments/services/MeetingReleaseService";
import { guardianMeetingResults } from "../modules/comments/services/MeetingReleaseReadService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let seq = 0;
let principal: AppContext;
const MARKER = "ZQX-TEACHER-ONLY-MARKER-7731";

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
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  await AcademicYear.create({ label: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), current: true });
  const p = await User.create({ email: `principal${++seq}@t.test`, passwordHash: "x", role: "PRINCIPAL", name: "Principal" });
  principal = { auth: { userId: p._id.toString(), role: "PRINCIPAL" } } as unknown as AppContext;
});

const guardianCtx = (id: string) => ({ auth: { userId: id, role: "GUARDIAN" } }) as unknown as AppContext;
const staffCtx = (role: string) => ({ auth: { userId: new Types.ObjectId().toString(), role } }) as unknown as AppContext;

async function meeting(): Promise<Types.ObjectId> {
  const r = await ParentMeeting.collection.insertOne({
    academicYearId: new Types.ObjectId(),
    instanceLabel: "2nd Meeting 2026",
    meetingDate: new Date("2026-11-14T00:00:00.000Z"),
    slotMinutes: 10,
    dayStartMinutes: 600,
    status: "scheduled",
    includeScope: { classIds: [], sectionIds: [] },
    guardianPublishedAt: null,
    guardianWithdrawnAt: null,
    guardianNotifiedAt: null,
  });
  return r.insertedId;
}

async function student(name: string): Promise<Types.ObjectId> {
  seq += 1;
  const r = await Student.collection.insertOne({
    schoolId: `S-${seq}`,
    name,
    classId: new Types.ObjectId(),
    sectionId: new Types.ObjectId(),
    active: true,
  });
  return r.insertedId;
}

async function guardian(childIds: Types.ObjectId[]): Promise<string> {
  seq += 1;
  const r = await Guardian.collection.insertOne({ identifierKind: "phone", identifier: `0170000${seq}`, name: `G${seq}`, loginEnabled: true, active: true });
  for (const c of childIds) {
    await GuardianLink.collection.insertOne({ guardianId: r.insertedId, studentId: c, relation: "father", active: true });
  }
  return r.insertedId.toString();
}

async function slot(meetingId: Types.ObjectId, order: number, studentIds: Types.ObjectId[], extra: Record<string, unknown> = {}): Promise<void> {
  await ParentMeetingSlot.collection.insertOne({
    meetingId,
    familyKey: `88017${order}${++seq}`,
    studentIds,
    classLabels: studentIds.map(() => "Three"),
    order,
    slotTime: 600 + order * 10,
    onCall: false,
    ...extra,
  });
}

const rowFor = (studentId: Types.ObjectId, present = 18): ReleaseSnapshotRow => ({
  studentId: studentId.toString(),
  window: { fromKey: "2026-06-01", toKey: "2026-11-14" },
  numbers: {
    attendance: { presentDays: present, markedDays: 20, absentDays: 1, leaveDays: 1 },
    classTests: { avgPercent: 72.5, sat: 4, held: 5 },
    homework: { submitted: 9, received: 10 },
    assignment: { submitted: 3, received: 4 },
  },
  classBest: { withheld: false, attendancePresentDays: 20, classTestAvgPct: 91, homeworkPct: 100, assignmentPct: 100 },
});

async function finalComment(meetingId: Types.ObjectId, studentId: Types.ObjectId, strengths: string, concerns = ""): Promise<void> {
  await MeetingFinalComment.collection.insertOne({
    meetingId, studentId, source: "OWN", strengths, concerns, authorUserId: new Types.ObjectId(), createdAt: new Date(), updatedAt: new Date(),
  });
}

/** Seed a teacher comment carrying the marker into EVERY teacher-side model. */
async function seedTeacherComments(meetingId: Types.ObjectId, studentId: Types.ObjectId): Promise<void> {
  const teacher = new Types.ObjectId();
  await MeetingComment.collection.insertOne({
    meetingId, studentId, authorUserId: teacher, positiveText: `good ${MARKER}`, concernText: `bad ${MARKER}`, createdAt: new Date(), updatedAt: new Date(),
  });
  await MeetingSubjectNote.collection.insertOne({
    meetingId, studentId, sectionId: new Types.ObjectId(), classId: new Types.ObjectId(), subject: "MATH", teacherId: teacher,
    strengths: `note ${MARKER}`, concerns: `note ${MARKER}`, writtenAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
  });
  await StudentComment.collection.insertOne({
    studentId, text: `daily ${MARKER}`, type: "CONCERN", sentiment: "NEGATIVE", createdAt: new Date(), updatedAt: new Date(),
  });
}

/** One published meeting, one family (guardian + child) with a printed snapshot and a final comment. */
async function publishedFamily() {
  const m = await meeting();
  const kid = await student("Asila Rahman");
  const g = await guardian([kid]);
  await slot(m, 1, [kid]);
  await saveMeetingReleaseSnapshots(m.toString(), [rowFor(kid)], "printed");
  await finalComment(m, kid, "ভালো পড়ে", "হাতের লেখা");
  await seedTeacherComments(m, kid);
  await publishMeetingToGuardians(principal, m.toString());
  return { m, kid, g };
}

describe("what a family reads", () => {
  it("the guardian sees their own child's published result: figures, section best, final comment", async () => {
    const { m, kid, g } = await publishedFamily();
    const rows = await guardianMeetingResults(guardianCtx(g), kid.toString());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      meetingId: m.toString(),
      instanceLabel: "2nd Meeting 2026",
      studentName: "Asila Rahman",
      fromKey: "2026-06-01",
      toKey: "2026-11-14",
      numbers: { attendance: { presentDays: 18, markedDays: 20, absentDays: 1, leaveDays: 1 }, classTests: { avgPercent: 72.5, sat: 4, held: 5 }, homework: { submitted: 9, received: 10 } },
      classBest: { withheld: false, attendancePresentDays: 20, classTestAvgPct: 91, homeworkPct: 100, assignmentPct: 100 },
      final: { strengths: "ভালো পড়ে", concerns: "হাতের লেখা" },
    });
  });

  it("never carries a class-teacher / subject-teacher / daily comment (marker absent from the JSON)", async () => {
    const { kid, g } = await publishedFamily();
    const mine = JSON.stringify(await guardianMeetingResults(guardianCtx(g), kid.toString()));
    expect(mine).toContain("ভালো পড়ে"); // the final comment IS there
    expect(mine).not.toContain(MARKER);
    // the staff door (parents_meeting:view) returns the same family-safe shape
    const asPrincipal = JSON.stringify(await guardianMeetingResults(principal, kid.toString()));
    expect(asPrincipal).not.toContain(MARKER);
  });

  it("the guardian read path cannot reach a teacher-comment model (structural)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../modules/comments/services/MeetingReleaseReadService.ts"), "utf8");
    const imports = src.split("\n").filter((l) => /^\s*(import|export\s.*from)\b/.test(l)).join("\n");
    for (const banned of ["MeetingComment", "MeetingSubjectNote", "StudentComment", "MeetingBriefService", "MeetingChainService"]) {
      expect(imports).not.toContain(banned);
    }
    const model = fs.readFileSync(path.join(__dirname, "../modules/comments/models/ParentMeetingRelease.ts"), "utf8");
    const fields = model.split(/\r?\n/).filter((l) => /^\s{4,}\w+:/.test(l)).join(" | ");
    expect(fields).not.toMatch(/text|comment|note|strengths|concerns/i); // numbers only: no field can hold a comment
  });

  it("another family is refused; so is a non-guardian without the meeting read permission", async () => {
    const { kid } = await publishedFamily();
    const other = await student("Other Child");
    const og = await guardian([other]);
    await expect(guardianMeetingResults(guardianCtx(og), kid.toString())).rejects.toThrow();
    await expect(guardianMeetingResults(staffCtx("TEACHER"), kid.toString())).rejects.toThrow();
  });

  it("an unpublished or withdrawn meeting is not listed", async () => {
    const m = await meeting();
    const kid = await student("Asila");
    const g = await guardian([kid]);
    await slot(m, 1, [kid]);
    await saveMeetingReleaseSnapshots(m.toString(), [rowFor(kid)], "printed");
    await finalComment(m, kid, "ভালো");
    expect(await guardianMeetingResults(guardianCtx(g), kid.toString())).toHaveLength(0);
    await publishMeetingToGuardians(principal, m.toString());
    expect(await guardianMeetingResults(guardianCtx(g), kid.toString())).toHaveLength(1);
    await withdrawMeetingRelease(principal, m.toString());
    expect(await guardianMeetingResults(guardianCtx(g), kid.toString())).toHaveLength(0);
  });

  it("a correction to the final comment after publishing shows (read live)", async () => {
    const { m, kid, g } = await publishedFamily();
    await MeetingFinalComment.updateOne({ meetingId: m, studentId: kid }, { $set: { strengths: "সংশোধিত মন্তব্য" } });
    const rows = await guardianMeetingResults(guardianCtx(g), kid.toString());
    expect(rows[0].final!.strengths).toBe("সংশোধিত মন্তব্য");
  });

  it("a child with no final comment still gets the figures (final = null)", async () => {
    const m = await meeting();
    const kid = await student("Asila");
    const g = await guardian([kid]);
    await slot(m, 1, [kid]);
    await saveMeetingReleaseSnapshots(m.toString(), [rowFor(kid)], "printed");
    await publishMeetingToGuardians(principal, m.toString());
    const rows = await guardianMeetingResults(guardianCtx(g), kid.toString());
    expect(rows[0].final).toBeNull();
    expect(rows[0].numbers.attendance.presentDays).toBe(18);
  });
});

describe("publishing", () => {
  it("is Principal-only", async () => {
    const m = await meeting();
    for (const role of ["OFFICE", "TEACHER", "GUARDIAN"]) {
      await expect(publishMeetingToGuardians(staffCtx(role), m.toString())).rejects.toThrow();
      await expect(withdrawMeetingRelease(staffCtx(role), m.toString())).rejects.toThrow();
    }
    expect((await ParentMeeting.findById(m).lean())!.guardianPublishedAt).toBeNull();
  });

  it("tells the families once: a second publish makes no second pop-up or notification", async () => {
    const { m, g } = await publishedFamily();
    const notes = await Notification.find({ recipientGuardianId: g }).lean();
    expect(await PopupNotice.countDocuments({})).toBe(1);
    expect(notes).toHaveLength(1);
    expect(notes[0].dedupeKey).toBe(`meeting-release:${m.toString()}:${g}`);
    expect(notes[0].refs).toMatchObject({ screenTarget: MEETING_RESULTS_TARGET });
    expect(notes[0].bodyBn).toContain("2nd Meeting 2026");

    const again = await publishMeetingToGuardians(principal, m.toString());
    expect(again.notified).toBe(false);
    // withdraw + re-publish never re-tells either
    await withdrawMeetingRelease(principal, m.toString());
    const third = await publishMeetingToGuardians(principal, m.toString());
    expect(third.notified).toBe(false);
    expect(await PopupNotice.countDocuments({})).toBe(1);
    expect(await Notification.countDocuments({ recipientGuardianId: g })).toBe(1);
  });

  it("includes every family on the meeting — attended or not — and computes a missing snapshot", async () => {
    const m = await meeting();
    const a = await student("Attended Kid");
    const b = await student("Absent Kid");
    const ga = await guardian([a]);
    const gb = await guardian([b]);
    await slot(m, 1, [a], { attended: true });
    await slot(m, 2, [b], { attended: false });
    await publishMeetingToGuardians(principal, m.toString());
    expect(await ParentMeetingRelease.countDocuments({ meetingId: m })).toBe(2);
    expect((await ParentMeetingRelease.findOne({ studentId: b }).lean())!.snapshotSource).toBe("computed");
    expect(await guardianMeetingResults(guardianCtx(ga), a.toString())).toHaveLength(1);
    expect(await guardianMeetingResults(guardianCtx(gb), b.toString())).toHaveLength(1);
    expect(await Notification.countDocuments({ kind: "SCHOOL_NOTICE" })).toBe(2);
  });

  it("a printed snapshot loaded by the script is kept over a computed one, even at publish", async () => {
    const m = await meeting();
    const kid = await student("Asila");
    await slot(m, 1, [kid]);
    await saveMeetingReleaseSnapshots(m.toString(), [rowFor(kid, 17)], "printed");
    await publishMeetingToGuardians(principal, m.toString());
    // a later computed write never replaces printed numbers
    await saveMeetingReleaseSnapshots(m.toString(), [rowFor(kid, 3)], "computed", { force: true });
    const row = (await ParentMeetingRelease.findOne({ studentId: kid }).lean())!;
    expect(row.snapshotSource).toBe("printed");
    expect(row.numbers.attendance.presentDays).toBe(17);
  });

  it("refuses to reload snapshots after publishing unless forced", async () => {
    const { m, kid } = await publishedFamily();
    await expect(saveMeetingReleaseSnapshots(m.toString(), [rowFor(kid, 5)], "printed")).rejects.toThrow();
    await saveMeetingReleaseSnapshots(m.toString(), [rowFor(kid, 5)], "printed", { force: true });
    expect((await ParentMeetingRelease.findOne({ studentId: kid }).lean())!.numbers.attendance.presentDays).toBe(5);
  });
});

describe("the load script's mapper", () => {
  it("reads only the numbers of printed brief rows (comment text in the file is ignored)", () => {
    const id = new Types.ObjectId().toString();
    const brief = {
      studentId: id,
      final: { strengths: MARKER, concerns: MARKER },
      summary: { strengths: MARKER, concerns: MARKER },
      subjectNotes: [{ strengths: MARKER }],
      numbers: {
        fromKey: "2026-06-01",
        toKey: "2026-11-14",
        attendance: { markedDays: 20, presentDays: 18, leaveDays: 1, absentDays: 1, days: [] },
        classTests: { held: 5, sat: 4, missed: 1, avgPercent: 72.5, bySubject: [], tests: [] },
        homework: { received: 10, submitted: 9, notSubmitted: 1, bySubject: [], missed: [] },
        assignment: { received: 4, submitted: 3, notSubmitted: 1, bySubject: [], missed: [] },
        notes: { concern: 1, positive: 0, items: [{ text: MARKER }] },
      },
      classBest: { rosterSize: 20, withheld: false, attendancePresentDays: 20, classTestAvgPct: 91, homeworkPct: 100, assignmentPct: 100 },
    };
    const rows = snapshotRowsFromBriefs([brief]);
    expect(JSON.stringify(rows)).not.toContain(MARKER);
    expect(rows[0]).toMatchObject({ studentId: id, window: { fromKey: "2026-06-01", toKey: "2026-11-14" }, numbers: { homework: { submitted: 9, received: 10 } } });
    expect(() => snapshotRowsFromBriefs([{ studentId: "x" }])).toThrow();
  });
});
