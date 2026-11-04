/**
 * Staff mistake record MR-6 (D-#952) on a real in-memory Mongo: the generic place note
 * (lines, episodes, owner) and one of its hooks end to end (a finance posting reversed).
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { FINANCE_EXPENSE_HEADS } from "@scd/shared";
import { User } from "../modules/foundation/models/User";
import { Notification } from "../modules/notifications/models/Notification";
import { StaffMistake } from "../modules/staff-mistakes/models/StaffMistake";
import { StaffMistakeNote } from "../modules/staff-mistakes/models/StaffMistakeNote";
import { FinancePosting } from "../modules/finance/models/FinancePosting";
import { recordPlaceMistake, staffMistakeNotesByIds } from "../modules/staff-mistakes/services/StaffMistakeNoteService";
import { explainMistake } from "../modules/staff-mistakes/services/StaffMistakeService";
import { reversePosting } from "../modules/finance/services/FinanceSnapshotService";
import { Task } from "../modules/workboard/models/Task";
import { setTaskStatus } from "../modules/workboard/services/TaskService";
import { dispatchTaskOverdue } from "../modules/workboard/services/TaskSweepService";
import { StaffProfile } from "../modules/foundation/models/StaffProfile";
import { StaffLeaveApplication } from "../modules/hr/models/StaffLeaveApplication";

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
    [User, Notification, StaffMistake, StaffMistakeNote, FinancePosting, Task, StaffProfile, StaffLeaveApplication].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})),
  );
});

async function user(name: string, role = "OFFICE"): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({
    name, role, active: true, phone: `8801766000${seq}`, passwordHash: "x",
    grantedPermissions: [], revokedPermissions: [], additionalTemplates: [],
  });
  return r.insertedId.toString();
}

describe("D-#952 — the generic place note", () => {
  it("gathers lines while the entry waits; after an explanation the next change is a new entry", async () => {
    const sender = await user("Shirin");
    const principal = await user("Principal", "PRINCIPAL");
    const at = new Date("2026-11-08T10:00:00+06:00");
    const base = { kind: "POPUP_NOTICE_CHANGE" as const, refKey: "notice-1", ownerId: sender, correctedBy: principal };
    expect(await recordPlaceMistake({ ...base, at, line: "\"নোটিশ\" — লেখা বদলানো হয়েছে; ৬২ জন আগেই দেখেছিলেন" })).toBe(true);
    await recordPlaceMistake({ ...base, at, line: "\"নোটিশ\" — বন্ধ করে দেওয়া হয়েছে; ৬২ জন আগেই দেখেছিলেন" });
    const notes = await StaffMistakeNote.find({}).lean();
    expect(notes.map((n) => [n.episode, n.lines.length])).toEqual([[1, 2]]);
    const entry = await StaffMistake.findOne({}).lean();
    expect([entry!.kind, String(entry!.staffUserId), entry!.status]).toEqual(["POPUP_NOTICE_CHANGE", sender, "EXPLANATION_DUE"]);

    await explainMistake({ mistakeId: String(entry!._id), actorId: sender, reasonCode: "PLAN_CHANGED", reasonText: "", now: at });
    expect((await StaffMistake.findById(entry!._id).lean())!.status).toBe("EXCUSED"); // accepted at once
    await recordPlaceMistake({ ...base, at, line: "আবার বদলানো হয়েছে" });
    expect((await StaffMistakeNote.find({}).sort({ episode: 1 }).lean()).map((n) => n.episode)).toEqual([1, 2]);
    expect(await StaffMistake.countDocuments()).toBe(2);

    const detail = (await staffMistakeNotesByIds([String(notes[0]!._id)])).get(String(notes[0]!._id))!;
    expect(detail.lines[0]).toMatchObject({ byName: "Principal" });
    expect(detail.lines[0]!.text).toContain("৬২ জন");
  });

  it("an old row with no owner records nothing", async () => {
    expect(await recordPlaceMistake({ kind: "PAYROLL_REOPEN", refKey: "x", ownerId: null, correctedBy: "x", at: new Date(), line: "-" })).toBe(false);
    expect(await StaffMistake.countDocuments()).toBe(0);
  });
});

describe("D-#952 — a reversed finance posting is the entrant's entry", () => {
  it("reversePosting records the original entrant", async () => {
    const clerk = await user("Kamrul");
    const principal = await user("Principal", "PRINCIPAL");
    const p = await FinancePosting.create({ date: new Date("2026-11-03"), kind: "EXPENSE", mode: "CASH", amount: 1500, expenseHead: FINANCE_EXPENSE_HEADS[0], enteredByUserId: new Types.ObjectId(clerk) });
    await reversePosting(String(p._id), { userId: principal, role: "PRINCIPAL" });
    const entry = await StaffMistake.findOne({}).lean();
    expect([entry!.kind, String(entry!.staffUserId)]).toEqual(["FINANCE_REVERSAL", clerk]);
    const note = await StaffMistakeNote.findOne({}).lean();
    expect(note!.lines[0]!.text).toContain("1500");
  });
});

describe("D-#953 — tier 2: a task reopened by someone else", () => {
  it("is a half-weight entry for whoever marked it done; reopening your own is not", async () => {
    const assignee = await user("Rahima", "TEACHER");
    const assigner = await user("Principal", "PRINCIPAL");
    const t = await Task.create({ titleBn: "তালিকা তৈরি", assigneeUserId: new Types.ObjectId(assignee), assignedBy: new Types.ObjectId(assigner), dueKey: "2026-11-10", effortMin: 30 });
    const asAssignee = { userId: assignee, role: "TEACHER" } as never;
    const asAssigner = { userId: assigner, role: "PRINCIPAL" } as never;
    await setTaskStatus(asAssignee, String(t._id), "DONE");
    await setTaskStatus(asAssignee, String(t._id), "TODO"); // own undo: nothing
    expect(await StaffMistake.countDocuments()).toBe(0);
    await setTaskStatus(asAssignee, String(t._id), "DONE");
    await setTaskStatus(asAssigner, String(t._id), "TODO");
    const entry = await StaffMistake.findOne({}).lean();
    expect([entry!.kind, entry!.tier, String(entry!.staffUserId)]).toEqual(["TASK_REOPENED", 2, assignee]);
    expect((await StaffMistakeNote.findOne({}).lean())!.lines[0]!.text).toContain("তালিকা তৈরি");
  });
});

describe("D-#955 — tier 3: missed duties", () => {
  it("an overdue task is recorded once, however many days the sweep runs", async () => {
    const assignee = await user("Rahima", "TEACHER");
    const assigner = await user("Principal", "PRINCIPAL");
    await Task.create({ titleBn: "রিপোর্ট জমা", assigneeUserId: new Types.ObjectId(assignee), assignedBy: new Types.ObjectId(assigner), dueKey: "2026-11-05", effortMin: 30 });
    await Task.create({ titleBn: "আজকের কাজ", assigneeUserId: new Types.ObjectId(assignee), assignedBy: new Types.ObjectId(assigner), dueKey: "2026-11-10", effortMin: 30 });
    await dispatchTaskOverdue(new Date("2026-11-08T08:00:00+06:00"));
    await dispatchTaskOverdue(new Date("2026-11-09T08:00:00+06:00"));
    const rows = await StaffMistake.find({}).lean();
    expect(rows.map((r) => [r.kind, r.tier, String(r.staffUserId), r.status])).toEqual([["TASK_OVERDUE", 3, assignee, "EXPLANATION_DUE"]]);
    expect((await StaffMistakeNote.findOne({}).lean())!.lines[0]!.text).toContain("রিপোর্ট জমা");
  });

  it("a duty missed on an approved leave day is accepted at once, with no explain notice", async () => {
    const teacher = await user("Nasrin", "TEACHER");
    const u = await User.findById(teacher).lean();
    const sp = await StaffProfile.collection.insertOne({ schoolId: "T-9", name: "Nasrin", category: "teacher", employmentType: "full_time", employmentStatus: "confirmed", phone: u!.phone, active: true });
    await StaffLeaveApplication.collection.insertOne({ staffProfileId: sp.insertedId, leaveType: "sick", fromKey: "2026-11-08", toKey: "2026-11-09", dayPart: "full", days: 2, reason: "জ্বর", status: "approved" });
    await recordPlaceMistake({ kind: "ATTENDANCE_NOT_MARKED", tier: 3, refKey: "2026-11-08:s1", ownerId: teacher, correctedBy: "system", at: new Date(), oncePerRef: true, leaveDateKey: "2026-11-08", line: "-" });
    const m = await StaffMistake.findOne({}).lean();
    expect([m!.status, m!.reasonCode]).toEqual(["EXCUSED", "ON_LEAVE"]);
    expect(await Notification.countDocuments({ kind: "STAFF_MISTAKE_EXPLAIN" })).toBe(0);
    // Not on leave the next week: explanation due as usual.
    await recordPlaceMistake({ kind: "ATTENDANCE_NOT_MARKED", tier: 3, refKey: "2026-11-15:s1", ownerId: teacher, correctedBy: "system", at: new Date(), oncePerRef: true, leaveDateKey: "2026-11-15", line: "-" });
    expect(await StaffMistake.countDocuments({ status: "EXPLANATION_DUE" })).toBe(1);
  });
});
