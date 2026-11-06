/**
 * Staff mistake record MR-2 (D-#940–#942, #1005) on a real in-memory Mongo: the warning ladder,
 * the face-to-face meeting, the per-person summary and the Principal's rules.
 *
 * Mistakes are inserted directly (the MR-1 suite covers how they are caught); the ladder
 * reads COUNTED rows by `decidedAt`.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { STAFF_MISTAKE_DEFAULT_SETTINGS, staffMistakeSettingsError } from "@scd/shared";
import { User } from "../modules/foundation/models/User";
import { Notification } from "../modules/notifications/models/Notification";
import { StaffMistake } from "../modules/staff-mistakes/models/StaffMistake";
import { StaffMistakeSettings } from "../modules/staff-mistakes/models/StaffMistakeSettings";
import { StaffWarning } from "../modules/staff-mistakes/models/StaffWarning";
import {
  decideMistake,
  explainDeadline,
  recordMistakeFromSource,
  settleOverdueMistakes,
} from "../modules/staff-mistakes/services/StaffMistakeService";
import {
  acknowledgeWarning,
  evaluateLadder,
  myOpenWarning,
  recordMeeting,
  scheduleMeeting,
  staffMistakeSummary,
} from "../modules/staff-mistakes/services/StaffWarningService";
import { getStaffMistakeSettings, setStaffMistakeSettings } from "../modules/staff-mistakes/services/StaffMistakeSettingsService";

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
    [User, Notification, StaffMistake, StaffMistakeSettings, StaffWarning].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

const NOW = new Date("2026-11-08T12:00:00+06:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

async function user(name: string, role = "TEACHER"): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({
    name, role, active: true, phone: `8801722000${seq}`, passwordHash: "x",
    // D-#1016: these suites test the told flow (explain notice, decisions, warnings).
    grantedPermissions: ["staff_mistakes:view_own"], revokedPermissions: [], additionalTemplates: [],
  });
  return r.insertedId.toString();
}

async function counted(staffUserId: string, decidedAt: Date, tier = 1, status = "COUNTED"): Promise<string> {
  seq += 1;
  // Raw insert so createdAt is the day it was caught (the summary's period reads createdAt).
  const r = await StaffMistake.collection.insertOne({
    staffUserId: new Types.ObjectId(staffUserId), kind: "MARK_CORRECTION", tier,
    sourceId: new Types.ObjectId(), dateKey: decidedAt.toISOString().slice(0, 10), status,
    explainDueAt: decidedAt, decidedAt, autoCounted: false, createdAt: decidedAt, updatedAt: decidedAt,
  });
  return r.insertedId.toString();
}

const kinds = async (kind: string) => Notification.find({ kind }).lean();

describe("D-#940 — the warning ladder", () => {
  it("3 counted in 30 days → one WARNING, the person and reviewers told; it never repeats in the window", async () => {
    const t = await user("Rashed");
    const office = await user("Kamrul", "OFFICE");
    await counted(t, daysAgo(20));
    await counted(t, daysAgo(10));
    expect(await evaluateLadder(t, NOW)).toHaveLength(0);
    await counted(t, daysAgo(1));
    const made = await evaluateLadder(t, NOW);
    expect(made.map((w) => w.step)).toEqual(["WARNING"]);
    expect(made[0]!.mistakeIds).toHaveLength(3);

    const toPerson = await kinds("STAFF_MISTAKE_WARNING");
    expect(toPerson.map((n) => String(n.recipientUserId))).toEqual([t]);
    expect(toPerson[0]!.bodyBn).toContain("৩টি");
    const toOffice = await kinds("STAFF_MISTAKE_STEP");
    expect(toOffice.map((n) => String(n.recipientUserId))).toContain(office);

    await counted(t, daysAgo(0));
    expect(await evaluateLadder(t, NOW)).toHaveLength(0); // 4 < 5, WARNING already given
  });

  it("an old mistake outside the window does not count; tier weights apply", async () => {
    const t = await user("Rashed");
    await counted(t, daysAgo(45));
    await counted(t, daysAgo(5));
    await counted(t, daysAgo(4), 2); // half
    await counted(t, daysAgo(3), 3); // half
    expect(await evaluateLadder(t, NOW)).toHaveLength(0); // 1 + 0.5 + 0.5 = 2 < 3
    await counted(t, daysAgo(2), 2);
    await counted(t, daysAgo(1), 2);
    expect((await evaluateLadder(t, NOW)).map((w) => w.step)).toEqual(["WARNING"]); // 3
  });

  it("jumping straight to 5 gives WARNING and MEETING; the person hears once, about the meeting", async () => {
    const t = await user("Rashed");
    for (let i = 1; i <= 5; i++) await counted(t, daysAgo(i));
    const made = await evaluateLadder(t, NOW);
    expect(made.map((w) => w.step).sort()).toEqual(["MEETING", "WARNING"]);
    const toPerson = await kinds("STAFF_MISTAKE_WARNING");
    expect(toPerson).toHaveLength(1);
    expect(toPerson[0]!.bodyBn).toContain("সামনাসামনি");
  });

  it("CONDUCT tells conduct holders (the Principal), and opens nothing", async () => {
    const t = await user("Rashed");
    const principal = await user("Principal", "PRINCIPAL");
    for (let i = 1; i <= 8; i++) await counted(t, daysAgo(i * 5));
    const made = await evaluateLadder(t, NOW);
    expect(made.map((w) => w.step)).toContain("CONDUCT");
    const conduct = (await kinds("STAFF_MISTAKE_STEP")).filter((n) => n.bodyBn.includes("শৃঙ্খলার ধাপ"));
    expect(conduct.map((n) => String(n.recipientUserId))).toContain(principal);
  });

  it("is checked when a reviewer counts a mistake, and when an overdue explanation settles", async () => {
    const t = await user("Rashed");
    const office = await user("Kamrul", "OFFICE");
    await counted(t, daysAgo(3));
    const pending = await counted(t, daysAgo(2), 1, "PENDING_REVIEW");
    await decideMistake({ mistakeId: pending, actorId: office, decision: "COUNT", now: NOW });
    expect(await StaffWarning.countDocuments()).toBe(0); // 2
    // An explanation that ran out: settled → counted → ladder.
    await StaffMistake.create({
      staffUserId: new Types.ObjectId(t), kind: "MARK_CORRECTION", tier: 1, sourceId: new Types.ObjectId(),
      dateKey: "2026-11-06", status: "EXPLANATION_DUE", explainDueAt: daysAgo(1),
    });
    expect(await settleOverdueMistakes(NOW)).toBe(1);
    expect(await StaffWarning.countDocuments({ step: "WARNING" })).toBe(1);
  });
});

describe("D-#941 — the pop-up and the meeting", () => {
  it("the pop-up shows until বুঝেছি; booking a meeting brings it back with the time", async () => {
    const t = await user("Rashed");
    const office = await user("Kamrul", "OFFICE");
    for (let i = 1; i <= 5; i++) await counted(t, daysAgo(i));
    await evaluateLadder(t, NOW);

    const open = await myOpenWarning(t);
    expect(open!.step).toBe("MEETING");
    expect(open!.mistakes).toHaveLength(5);
    await acknowledgeWarning({ warningId: open!.id, userId: t, now: NOW });
    expect(await myOpenWarning(t)).toBeNull(); // both rungs closed by one tap

    await expect(scheduleMeeting({ warningId: open!.id, actorId: t, at: "2026-11-10T12:30:00+06:00", place: "কক্ষ" })).rejects.toThrow("নিজের");
    await scheduleMeeting({ warningId: open!.id, actorId: office, at: "2026-11-10T12:30:00+06:00", place: "প্রধান শিক্ষকের কক্ষ" });
    const back = await myOpenWarning(t);
    expect(back!.meetingPlace).toBe("প্রধান শিক্ষকের কক্ষ");
    expect(back!.meetingSetByName).toBe("Kamrul");
    expect(await kinds("STAFF_MISTAKE_MEETING")).toHaveLength(1);

    // "অন্য সময় চাই" closes it and tells the meeting holders.
    const before = (await kinds("STAFF_MISTAKE_STEP")).length;
    await acknowledgeWarning({ warningId: back!.id, userId: t, otherTime: true, now: NOW });
    const asks = (await kinds("STAFF_MISTAKE_STEP")).filter((n) => n.titleBn.includes("সময় বদলাতে"));
    expect((await kinds("STAFF_MISTAKE_STEP")).length).toBe(before + asks.length);
    expect(asks.map((n) => String(n.recipientUserId))).toContain(office);
    expect((await StaffWarning.findById(back!.id).lean())!.otherTimeAskedAt).not.toBeNull();
  });

  it("recording the meeting keeps what was agreed and can send the summary", async () => {
    const t = await user("Rashed");
    const office = await user("Kamrul", "OFFICE");
    const other = await user("Someone");
    for (let i = 1; i <= 3; i++) await counted(t, daysAgo(i));
    const [w] = await evaluateLadder(t, NOW);
    await expect(recordMeeting({ warningId: w!._id.toString(), actorId: office, who: "", discussion: " ", actions: "", sendSummary: false })).rejects.toThrow("আলোচনা");
    await expect(recordMeeting({ warningId: w!._id.toString(), actorId: office, who: "", discussion: "x", actions: "", followUpDateKey: "6/12", sendSummary: false })).rejects.toThrow("তারিখ");
    const done = await recordMeeting({
      warningId: w!._id.toString(), actorId: office, who: "প্রধান শিক্ষক", discussion: "যোগে ভুল",
      actions: "প্রকাশের আগে মোট মিলিয়ে নেবেন", followUpDateKey: "2026-12-06", sendSummary: true, now: NOW,
    });
    expect(done.meetingRecordedByName).toBe("Kamrul");
    expect(done.followUpDateKey).toBe("2026-12-06");
    const sent = await kinds("STAFF_MISTAKE_MEETING");
    expect(sent[0]!.bodyBn).toContain("মিলিয়ে নেবেন");
    await expect(acknowledgeWarning({ warningId: w!._id.toString(), userId: other })).rejects.toThrow("আপনার নয়");
  });
});

describe("D-#942 — the summary", () => {
  it("per person: counted, weighted, pending, excused, the top place and the highest rung", async () => {
    const a = await user("Rashed");
    const b = await user("Nasrin");
    for (let i = 1; i <= 3; i++) await counted(a, daysAgo(i));
    await counted(a, daysAgo(2), 1, "PENDING_REVIEW");
    await counted(b, daysAgo(2), 2);
    await counted(b, daysAgo(3), 1, "EXCUSED");
    await counted(b, daysAgo(60)); // outside 30 days
    await evaluateLadder(a, NOW);

    const s = await staffMistakeSummary(30, NOW);
    const ra = s.rows.find((r) => r.staffUserId === a)!;
    const rb = s.rows.find((r) => r.staffUserId === b)!;
    expect(s.rows[0]!.staffUserId).toBe(a); // most weighted first
    expect([ra.counted, ra.weighted, ra.pending, ra.warningStep, ra.topKind]).toEqual([3, 3, 1, "WARNING", "MARK_CORRECTION"]);
    expect([rb.counted, rb.weighted, rb.excused]).toEqual([1, 0.5, 1]);
    expect(s.totals).toEqual({ counted: 4, pending: 1, excused: 1, warnings: 1 });
    expect(s.byKind).toEqual([{ kind: "MARK_CORRECTION", counted: 4 }]);
  });
});

describe("D-#1005 — the Principal's rules", () => {
  it("validates, saves, and drives the ladder, the deadline and the switches", async () => {
    const principal = await user("Principal", "PRINCIPAL");
    const t = await user("Rashed");
    expect(staffMistakeSettingsError({ ...STAFF_MISTAKE_DEFAULT_SETTINGS, rungs: STAFF_MISTAKE_DEFAULT_SETTINGS.rungs.slice(0, 2) })).toContain("তিনটি");
    await expect(
      setStaffMistakeSettings({ ...STAFF_MISTAKE_DEFAULT_SETTINGS, tierWeights: { 1: 9, 2: 1, 3: 1 } }, principal),
    ).rejects.toThrow("ওজন");

    const saved = await setStaffMistakeSettings(
      {
        rungs: [{ step: "WARNING", count: 2, windowDays: 14 }, { step: "MEETING", count: 4, windowDays: 30 }, { step: "CONDUCT", count: 10, windowDays: 90 }],
        tierWeights: { 1: 1, 2: 1, 3: 0 },
        deadline: "HOURS_24",
        disabledKinds: ["MARK_CORRECTION", "NOT_A_KIND"],
      },
      principal,
    );
    expect(saved.rungs[0]).toEqual({ step: "WARNING", count: 2, windowDays: 14 });
    expect(saved.disabledKinds).toEqual(["MARK_CORRECTION"]);
    expect((await getStaffMistakeSettings()).deadline).toBe("HOURS_24");

    await counted(t, daysAgo(2));
    await counted(t, daysAgo(1));
    expect((await evaluateLadder(t, NOW)).map((w) => w.step)).toEqual(["WARNING"]); // 2 now reaches it

    // A switched-off place records nothing.
    const none = await recordMistakeFromSource({
      kind: "MARK_CORRECTION", tier: 1, sourceId: new Types.ObjectId(), staffUserId: t, correctedBy: t, at: NOW,
    });
    expect(none).toBeNull();
  });

  it("deadline rules: 24 hours, or 17:00 on the third school day", () => {
    const thu = new Date("2026-11-12T15:00:00+06:00");
    expect(explainDeadline(thu, "HOURS_24").toISOString()).toBe(new Date("2026-11-13T15:00:00+06:00").toISOString());
    expect(explainDeadline(thu, "SCHOOL_DAYS_3").toISOString()).toBe(new Date("2026-11-17T17:00:00+06:00").toISOString());
  });
});
