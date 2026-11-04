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
    [User, Notification, StaffMistake, StaffMistakeNote, FinancePosting].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})),
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
