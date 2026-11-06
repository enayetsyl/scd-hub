/**
 * Daily school report (D-#1030–#1035, docs/prd-daily-report.md) on a real in-memory Mongo:
 * the saved day, who sees which parts, the Principal's own mistakes, the 18:00 notification,
 * the unread Today card, "fixed later", history + repeated problems, and sharing with an end day.
 *
 * Parts whose modules have no data in this fixture still build (NA/OK) or fail into an ERROR line;
 * either way the report is saved — the posture under test.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { DAILY_REPORT_SECTION_PERMISSION, onTimeRate } from "@scd/shared";
import { User } from "../modules/foundation/models/User";
import { Notification } from "../modules/notifications/models/Notification";
import { StaffMistake } from "../modules/staff-mistakes/models/StaffMistake";
import { Task } from "../modules/workboard/models/Task";
import { DailyReport, type IDailyReportPart } from "../modules/daily-report/models/DailyReport";
import { DailyReportShare } from "../modules/daily-report/models/DailyReportShare";
import { DailyReportSettings } from "../modules/daily-report/models/DailyReportSettings";
import {
  dailyReportFor,
  headlineOf,
  makeDailyReport,
  markDailyReportSeen,
  myUnreadDailyReport,
  notificationBody,
  notifyDailyReport,
  partForViewer,
  reportHistory,
  runDailyReport,
  saveSettings,
  viewerFor,
  DailyReportError,
} from "../modules/daily-report/services/DailyReportService";
import { listShares, removeDailyReportShare, shareDailyReport, sweepExpiredShares } from "../modules/daily-report/services/DailyReportShareService";
import { statusOf } from "../modules/daily-report/services/dailyReportParts";
import { ANY_PART } from "../modules/daily-report/partSwitches";

jest.setTimeout(180_000);

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
    [User, Notification, StaffMistake, Task, DailyReport, DailyReportShare, DailyReportSettings].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

// Sunday 8 and Monday 9 November 2026 — weekdays the calendar treats as school days.
const DAY1 = "2026-11-08";
const DAY2 = "2026-11-09";
const at = (key: string, hh = 18) => new Date(`${key}T${String(hh).padStart(2, "0")}:00:00+06:00`);

async function user(name: string, role = "TEACHER", granted: string[] = []): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({
    name, role, active: true, phone: `8801733000${seq}`, passwordHash: "x",
    grantedPermissions: granted, revokedPermissions: [], additionalTemplates: [],
  });
  return r.insertedId.toString();
}

async function profile(userId: string) {
  const u = await User.findById(userId).lean();
  return {
    userId,
    role: u!.role,
    additionalTemplates: u!.additionalTemplates ?? [],
    grantedPermissions: u!.grantedPermissions ?? [],
    revokedPermissions: u!.revokedPermissions ?? [],
  };
}

async function task(title: string, assignee: string, assigner: string, dueKey: string, done: Date | null) {
  seq += 1;
  await Task.collection.insertOne({
    titleBn: title, assigneeUserId: new Types.ObjectId(assignee), assignedBy: new Types.ObjectId(assigner),
    priority: "NORMAL", dueKey, slot: "ANY", effortMin: 15, status: done ? "DONE" : "TODO",
    doneAt: done ?? undefined, cancelledAt: null, createdAt: at(dueKey, 8), updatedAt: at(dueKey, 8),
  });
}

async function mistake(staffUserId: string, dateKey: string, tier = 1) {
  seq += 1;
  await StaffMistake.collection.insertOne({
    staffUserId: new Types.ObjectId(staffUserId), kind: "MARK_CORRECTION", tier, sourceId: new Types.ObjectId(),
    dateKey, status: "EXPLANATION_DUE", explainDueAt: at(dateKey, 23), autoCounted: false,
    createdAt: at(dateKey, 10), updatedAt: at(dateKey, 10),
  });
}

const part = (parts: IDailyReportPart[], key: string) => parts.find((p) => p.key === key)!;

describe("pure helpers", () => {
  test("on-time rate, status and the notification body", () => {
    expect(onTimeRate(0, 0)).toBeNull();
    expect(onTimeRate(42, 7)).toBe(86);
    expect(statusOf({ onTime: 5, problems: 0, stats: [], items: [], link: null })).toBe("OK");
    expect(statusOf({ onTime: 9, problems: 1, stats: [], items: [], link: null })).toBe("WARN");
    expect(statusOf({ onTime: 2, problems: 1, stats: [], items: [], link: null })).toBe("BAD");
    expect(statusOf({ onTime: 0, problems: 0, stats: [], items: [], link: null, na: true })).toBe("NA");
    expect(notificationBody({ onTime: 42, problems: 7, mistakes: 2, rate: 86 }, 81)).toBe(
      "সময়মতো ৪২ · সমস্যা ৭ · ভুল ২\nসময়মতো কাজ ৮৬% (আগের ৫ দিনে ৮১%)",
    );
    expect(notificationBody({ onTime: 0, problems: 0, mistakes: 0, rate: null }, null)).toBe("সময়মতো ০ · সমস্যা ০ · ভুল ০");
  });
});

describe("the saved day", () => {
  test("is made once, keeps every part, counts the work board and the mistakes", async () => {
    const principal = await user("Principal", "PRINCIPAL");
    const t1 = await user("Rahima");
    await task("ক্যাশ এন্ট্রি", t1, principal, DAY1, at(DAY1, 11));
    await task("নোটিশ টানানো", t1, principal, DAY1, null);
    await mistake(t1, DAY1, 2);
    await mistake(principal, DAY1, 1);

    const first = await makeDailyReport(DAY1, at(DAY1));
    expect(first.created).toBe(true);
    expect(first.report.parts).toHaveLength(12);
    const wb = part(first.report.parts, "WORK_BOARD");
    expect([wb.onTime, wb.problems, wb.status]).toEqual([1, 1, "BAD"]);
    expect(wb.items[0]).toMatchObject({ title: "নোটিশ টানানো", subtitle: "Rahima" });
    expect(JSON.parse(wb.items[0].link!.params)).toHaveProperty("taskId");
    const ms = part(first.report.parts, "MISTAKES");
    expect([ms.mistakes, ms.principalOwnMistakes]).toEqual([2, 1]);
    // The attendance jump carries the report's day (D-#1035).
    expect(JSON.parse(part(first.report.parts, "ATTENDANCE").link!.params)).toEqual({ date: DAY1 });

    const again = await makeDailyReport(DAY1, at(DAY1, 19));
    expect(again.created).toBe(false);
    expect(await DailyReport.countDocuments({})).toBe(1);
  });

  test("next day: yesterday's problems fixed after the report are counted as fixed later; the old day is unchanged", async () => {
    const principal = await user("Principal", "PRINCIPAL");
    const t1 = await user("Kamrul");
    await task("রিপোর্ট জমা", t1, principal, DAY1, null);
    await makeDailyReport(DAY1, at(DAY1));
    // Done the NEXT morning — after the first report, and after that day ended.
    await Task.updateOne({ titleBn: "রিপোর্ট জমা" }, { $set: { status: "DONE", doneAt: at(DAY2, 9) } });
    const { report } = await makeDailyReport(DAY2, at(DAY2));
    expect(report.previousDateKey).toBe(DAY1);
    expect(part(report.parts, "WORK_BOARD").fixedLater).toBe(1);
    const old = await DailyReport.findOne({ dateKey: DAY1 }).lean();
    expect(part(old!.parts, "WORK_BOARD").problems).toBe(1);
  });
});

describe("who sees what", () => {
  test("a person sees only the parts they hold, with headline counts for those parts only", async () => {
    const principal = await user("Principal", "PRINCIPAL");
    const teacher = await user("Salma", "TEACHER", ["reports:daily_work_board"]);
    await task("কাজ ১", teacher, principal, DAY1, null);
    await mistake(teacher, DAY1, 3);
    await makeDailyReport(DAY1, at(DAY1));

    const v = await viewerFor(await profile(teacher), DAY1);
    expect(v.sections).toEqual(["WORK_BOARD"]);
    const view = await dailyReportFor(DAY1, v, at(DAY2));
    expect(view!.parts.map((p) => p.key)).toEqual(["WORK_BOARD"]);
    expect(view!.headline).toMatchObject({ onTime: 0, problems: 1, mistakes: 0 });

    const nobody = await viewerFor(await profile(await user("No parts")), DAY1);
    await expect(dailyReportFor(DAY1, nobody)).rejects.toBeInstanceOf(DailyReportError);
  });

  test("the Principal's own mistakes never reach someone who may not see them (D-#1000)", async () => {
    const principal = await user("Principal", "PRINCIPAL");
    const office = await user("Office", "OFFICE", ["reports:daily_mistakes"]);
    await mistake(principal, DAY1, 1);
    await mistake(office, DAY1, 2);
    const { report } = await makeDailyReport(DAY1, at(DAY1));

    const pv = await viewerFor(await profile(principal), DAY1);
    expect(part(report.parts, "MISTAKES").mistakes).toBe(2);
    expect(partForViewer(part(report.parts, "MISTAKES"), pv).mistakes).toBe(2);

    const ov = await viewerFor(await profile(office), DAY1);
    expect(ov.mayPrincipalMistakes).toBe(false);
    const seen = partForViewer(part(report.parts, "MISTAKES"), ov);
    expect(seen.mistakes).toBe(1);
    expect(seen.items.map((i) => i.title)).toEqual(["Office"]);
    expect(seen.stats.some((s) => s.key.startsWith("tier"))).toBe(false);
    expect(headlineOf([seen], ["MISTAKES"]).mistakes).toBe(1);

    // The same through the notification, on the hydrated report makeDailyReport returned.
    await DailyReportShare.collection.insertOne({
      userId: new Types.ObjectId(office), sections: ["MISTAKES"], grantedPerms: [], notify: true, untilKey: null,
      sharedBy: new Types.ObjectId(principal), createdAt: new Date(), updatedAt: new Date(),
    });
    expect(await notifyDailyReport(report)).toBe(2);
    const body = (await Notification.findOne({ kind: "DAILY_REPORT", recipientUserId: new Types.ObjectId(office) }).lean())!.bodyBn;
    expect(body).toBe("সময়মতো ০ · সমস্যা ০ · ভুল ১");
  });
});

describe("the 18:00 notification and the Today card", () => {
  test("Principal + shared-with-notify are told once; opening the day clears the card", async () => {
    const principal = await user("Principal", "PRINCIPAL");
    const office = await user("Kamrul", "OFFICE");
    const quiet = await user("Rahima", "TEACHER");
    const actor = { userId: principal, role: "PRINCIPAL" };
    await shareDailyReport(actor, { userId: office, sections: ["WORK_BOARD"], notify: true, untilKey: null }, DAY1);
    await shareDailyReport(actor, { userId: quiet, sections: ["WORK_BOARD"], notify: false, untilKey: null }, DAY1);
    await task("কাজ ১", office, principal, DAY1, at(DAY1, 9));

    expect(await runDailyReport(at(DAY1))).toBe(2);
    expect(await runDailyReport(at(DAY1, 19))).toBe(0);
    const rows = await Notification.find({ kind: "DAILY_REPORT" }).lean();
    expect(rows.map((r) => String(r.recipientUserId)).sort()).toEqual([principal, office].sort());
    const officeRow = rows.find((r) => String(r.recipientUserId) === office)!;
    expect(officeRow.bodyBn).toBe("সময়মতো ১ · সমস্যা ০ · ভুল ০\nসময়মতো কাজ ১০০%");
    expect(officeRow.refs).toMatchObject({ date: DAY1 });
    // Re-notifying the same day makes no second row (dedupe per person per day).
    const report = await DailyReport.findOne({ dateKey: DAY1 });
    expect(await notifyDailyReport(report!)).toBe(0);

    const ov = await viewerFor(await profile(office), DAY1);
    expect((await myUnreadDailyReport(ov))!.dateKey).toBe(DAY1);
    await markDailyReportSeen(office, DAY1);
    expect(await myUnreadDailyReport(ov)).toBeNull();
  });

  test("the Principal can switch their own notification off in settings", async () => {
    const principal = await user("Principal", "PRINCIPAL");
    await saveSettings({ sendMinutes: 18 * 60, headlineSections: ["WORK_BOARD"], notifyPrincipal: false }, principal);
    expect(await runDailyReport(at(DAY1))).toBe(0);
    await expect(saveSettings({ sendMinutes: 9 * 60, headlineSections: ["WORK_BOARD"], notifyPrincipal: true }, principal)).rejects.toBeInstanceOf(
      DailyReportError,
    );
  });
});

describe("sharing with an optional end day (D-#1034)", () => {
  test("grants only what the person lacks and takes back only the share's own grants", async () => {
    const principal = await user("Principal", "PRINCIPAL");
    const office = await user("Kamrul", "OFFICE", ["reports:daily_homework"]);
    const actor = { userId: principal, role: "PRINCIPAL" };

    await shareDailyReport(actor, { userId: office, sections: ["HOMEWORK", "ATTENDANCE"], notify: true, untilKey: null }, DAY1);
    let u = await User.findById(office).lean();
    expect([...u!.grantedPermissions].sort()).toEqual(["reports:daily_attendance", "reports:daily_homework"]);
    expect((await DailyReportShare.findOne({ userId: office }).lean())!.grantedPerms).toEqual(["reports:daily_attendance"]);

    await shareDailyReport(actor, { userId: office, sections: ["HOMEWORK", "FINANCE"], notify: false, untilKey: "2026-11-30" }, DAY1);
    u = await User.findById(office).lean();
    expect([...u!.grantedPermissions].sort()).toEqual(["reports:daily_finance", "reports:daily_homework"]);
    expect((await listShares(DAY1))[0]).toMatchObject({ name: "Kamrul", sections: ["HOMEWORK", "FINANCE"], notify: false, untilKey: "2026-11-30", expired: false });

    await removeDailyReportShare(actor, office);
    u = await User.findById(office).lean();
    // The switch held before the share stays.
    expect(u!.grantedPermissions).toEqual(["reports:daily_homework"]);
    expect(await DailyReportShare.countDocuments({})).toBe(0);
  });

  test("a share past its end day is refused at once and removed by the sweep", async () => {
    const principal = await user("Principal", "PRINCIPAL");
    const teacher = await user("Salma");
    const actor = { userId: principal, role: "PRINCIPAL" };
    await shareDailyReport(actor, { userId: teacher, sections: ["ATTENDANCE"], notify: true, untilKey: DAY1 }, DAY1);
    expect((await viewerFor(await profile(teacher), DAY1)).sections).toEqual(["ATTENDANCE"]);
    // The day after the end day: still granted on the user row, but no longer visible.
    expect((await viewerFor(await profile(teacher), DAY2)).sections).toEqual([]);
    expect(await sweepExpiredShares(DAY2)).toBe(1);
    expect((await User.findById(teacher).lean())!.grantedPermissions).toEqual([]);
  });

  test("bad input is refused in Bangla", async () => {
    const principal = await user("Principal", "PRINCIPAL");
    const teacher = await user("Salma");
    const actor = { userId: principal, role: "PRINCIPAL" };
    await expect(shareDailyReport(actor, { userId: teacher, sections: [], notify: true, untilKey: null }, DAY1)).rejects.toBeInstanceOf(DailyReportError);
    await expect(shareDailyReport(actor, { userId: teacher, sections: ["ATTENDANCE"], notify: true, untilKey: "2026-11-01" }, DAY1)).rejects.toBeInstanceOf(DailyReportError);
    await expect(shareDailyReport(actor, { userId: principal, sections: ["ATTENDANCE"], notify: true, untilKey: null }, DAY1)).rejects.toBeInstanceOf(DailyReportError);
  });
});

describe("history", () => {
  test("totals, the span before, and places that went wrong on 3+ days — never people", async () => {
    const principal = await user("Principal", "PRINCIPAL");
    const pv = await viewerFor(await profile(principal), DAY1);
    const mk = (dateKey: string, problems: number, onTime: number) =>
      DailyReport.collection.insertOne({
        dateKey, dayType: "FULL", generatedAt: at(dateKey), previousDateKey: null, notifiedUserIds: [],
        parts: [{
          key: "ATTENDANCE", status: problems ? "WARN" : "OK", onTime, problems, mistakes: 0, principalOwnMistakes: 0, stats: [],
          items: problems ? [{ tone: "MISSED", title: "C3 · বালিকা", subtitle: "Rahima", value: "Qaida 2", link: null, principalOnly: false }] : [],
          itemsMore: 0, link: null, fixedLater: 0,
        }],
      });
    await mk("2026-11-01", 1, 9);
    await mk("2026-11-02", 1, 9);
    await mk("2026-11-03", 1, 9);
    await mk("2026-11-04", 0, 10);
    await mk("2026-10-27", 5, 5);

    const h = await reportHistory("2026-11-01", "2026-11-07", pv);
    expect(h.days).toHaveLength(4);
    expect(h.total).toMatchObject({ onTime: 37, problems: 3, rate: 93 });
    expect(h.previous).toMatchObject({ onTime: 5, problems: 5, rate: 50 });
    expect(h.repeated).toEqual([{ key: "ATTENDANCE", title: "C3 · বালিকা", subtitle: "Qaida 2", days: 3 }]);
    expect(h.parts.find((p) => p.key === "ATTENDANCE")).toMatchObject({ rate: 93, prevRate: 50 });
    await expect(reportHistory("2026-11-07", "2026-11-01", pv)).rejects.toBeInstanceOf(DailyReportError);
  });
});

test("every part has its own catalogue switch, and the resolver gate names each one", () => {
  expect(Object.values(DAILY_REPORT_SECTION_PERMISSION)).toHaveLength(12);
  expect([...ANY_PART].sort()).toEqual([...Object.values(DAILY_REPORT_SECTION_PERMISSION)].sort());
});
