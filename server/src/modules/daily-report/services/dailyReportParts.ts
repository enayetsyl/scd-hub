/**
 * The parts of the daily school report (D-#1050, docs/prd-daily-report.md §2). One builder per
 * part, each READING the module services the existing reports already use — no part keeps its
 * own copy of a rule. Each builder is best-effort: a throw becomes an ERROR line, never a
 * missing report (the AdminTodayService posture).
 *
 * Counting (D-#1050): every part lists the day's duties; each lands in onTime (done by its usual
 * time) or problems (late, or still not done when the report is made). `mistakes` is only the
 * staff mistake record's new entries. A part with nothing due shows NA, never a problem.
 *
 * `replayable` parts can be re-run later for the SAME day: the next day's report compares the
 * re-run with what was saved to show "fixed later" (D-#1050). The saved day never changes.
 */
import {
  DAILY_REPORT_SECTION_PERMISSION,
  STAFF_MISTAKE_KIND_TITLE_BN,
  type DailyReportSection,
  type DailyReportStatus,
  type StaffMistakeKind,
} from "@scd/shared";
import { parseDateKey } from "../../attendance/dates";
import { classPresenceForDate, unmarkedSections, absentNoApplication } from "../../attendance/services/AttendanceReportService";
import { StudentAttendanceDay } from "../../attendance/models/StudentAttendanceDay";
import { TeacherAttendanceDay } from "../../attendance/models/TeacherAttendanceDay";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { User } from "../../foundation/models/User";
import { needsCoverSlots } from "../../hr/services/CoverService";
import { classNoteSubmissionReport } from "../../routine/services/RoutineTriggerService";
import { ClassroomObservation } from "../../classroom-observation/models/ClassroomObservation";
import { reconciliationReport, type ReconReport } from "../../trackers/services/ReconReportService";
import { HomeworkReconciliation, reconDayKey } from "../../trackers/models/HomeworkReconciliation";
import { handoutBoard, packetCount, unprintedCount } from "../../trackers/services/AssignmentHandoutService";
import { reportsStatus } from "../../trackers/services/ClassTestSummaryService";
import { StaffMistake } from "../../staff-mistakes/models/StaffMistake";
import { StaffWarning } from "../../staff-mistakes/models/StaffWarning";
import { principalUserIds } from "../../staff-mistakes/services/principalPrivacy";
import { Task } from "../../workboard/models/Task";
import { PrintRequest } from "../../printing/models/PrintRequest";
import { printQueueCounts } from "../../printing/services/PrintRequestService";
import { reviewInboxCount } from "../../comments/services/StudentCommentService";
import { StudentComment } from "../../comments/models/StudentComment";
import { GuardianView } from "../../engagement/models/GuardianView";
import { GuardianWorkClaim } from "../../trackers/models/GuardianWorkClaim";
import { dailySnapshot } from "../../finance/services/FinanceSnapshotService";
import { backupStatus, hourlyBackupStatus } from "../../platform/services/BackupService";
import { getTickerHealth } from "../../notifications/services/tickerHeartbeat";
import { personName } from "../../../lib/personName";
import type { IDailyReportItem, IDailyReportLink, IDailyReportPart, IDailyReportStat } from "../models/DailyReport";

/** Problem rows kept per part; the rest is `itemsMore` (the full list is the linked report). */
export const ITEM_CAP = 40;

export interface PartContext {
  dateKey: string;
  dayType: string;
  /** The moment the part is judged at (18:00 for the saved report, now for "so far"). */
  asOf: Date;
  /** Shared by HOMEWORK and ASSIGNMENT — fetched once per build. */
  recon: () => Promise<ReconReport>;
  /** The "fixed later" re-run of an earlier day: a duty done SINCE (on any day) no longer counts
   *  as a problem. False for the saved report, where only work done by the end of the day counts. */
  replay?: boolean;
}

export interface PartDraft {
  onTime: number;
  problems: number;
  mistakes?: number;
  principalOwnMistakes?: number;
  stats: IDailyReportStat[];
  items: IDailyReportItem[];
  link: IDailyReportLink | null;
  /** Nothing was due today (exam day, a closed tracker, no duties). */
  na?: boolean;
  /** Override the computed status (SYSTEM: a missed backup is BAD at once). */
  status?: DailyReportStatus;
}

export interface PartBuilder {
  key: DailyReportSection;
  replayable: boolean;
  build: (ctx: PartContext) => Promise<PartDraft>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Language-neutral class code (glossary: English codes on trackers). */
export const lvl = (level: number | null | undefined): string =>
  level == null ? "—" : level === -1 ? "N" : level === 0 ? "K" : `C${level}`;

export function link(tab: string, screen: string, params: Record<string, string | undefined>, perms: string[]): IDailyReportLink {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) clean[k] = v;
  return { tab, screen, params: JSON.stringify(clean), perms };
}

const item = (
  tone: IDailyReportItem["tone"],
  title: string,
  subtitle: string | null,
  value: string | null,
  to: IDailyReportLink | null,
  principalOnly = false,
): IDailyReportItem => ({ tone, title, subtitle, value, link: to, principalOnly });

/** Mirrors app/src/lib/navGates.ts REPORT_LEAF_ACTIONS for the leaves a part jumps to. */
const LEAF = {
  AttendanceReport: ["reports:attendance", "attendance:view_all"],
  ClassNoteReport: ["reports:class_note", "class_note:view_all"],
  ReconciliationReport: ["reports:reconciliation"],
  ClassTestDashboard: ["reports:class_test_dashboard", "class_test:view_all"],
  WorkClaimQueue: ["reports:guardian_claims"],
  DailySnapshot: ["reports:daily_snapshot", "finance_ledger:view"],
  LoadGrid: ["reports:workload", "work_board:view_all"],
} as const;

function dayBounds(dateKey: string): { start: Date; end: Date } {
  const start = parseDateKey(dateKey);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function statusOf(d: PartDraft): DailyReportStatus {
  if (d.status) return d.status;
  if (d.na) return "NA";
  if ((d.mistakes ?? 0) > 0 && d.problems === 0) return "WARN";
  if (d.problems === 0) return d.onTime === 0 && d.stats.every((s) => s.value === 0) ? "NA" : "OK";
  const total = d.onTime + d.problems;
  return d.problems * 3 >= total ? "BAD" : "WARN";
}

/** Run one builder; a throw becomes an ERROR line (never sinks the report). */
export async function runPart(b: PartBuilder, ctx: PartContext): Promise<IDailyReportPart> {
  try {
    const d = await b.build(ctx);
    const items = d.items;
    return {
      key: b.key,
      status: statusOf(d),
      onTime: d.na ? 0 : d.onTime,
      problems: d.na ? 0 : d.problems,
      mistakes: d.mistakes ?? 0,
      principalOwnMistakes: d.principalOwnMistakes ?? 0,
      stats: d.stats,
      items: items.slice(0, ITEM_CAP),
      itemsMore: Math.max(0, items.length - ITEM_CAP),
      link: d.link,
      fixedLater: 0,
    };
  } catch (err) {
    console.error(`[dailyReport] part "${b.key}" failed:`, err);
    return {
      key: b.key,
      status: "ERROR",
      onTime: 0,
      problems: 0,
      mistakes: 0,
      principalOwnMistakes: 0,
      stats: [],
      items: [],
      itemsMore: 0,
      link: null,
      fixedLater: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

const attendance: PartBuilder = {
  key: "ATTENDANCE",
  replayable: true,
  build: async ({ dateKey, dayType }) => {
    const partLink = link("ReportsTab", "AttendanceReport", { date: dateKey }, [...LEAF.AttendanceReport]);
    if (dayType !== "FULL") return { onTime: 0, problems: 0, stats: [], items: [], link: partLink, na: true };
    const [presence, unmarked, markedUnits, noApp] = await Promise.all([
      classPresenceForDate(dateKey),
      unmarkedSections(dateKey, { withMarkers: true }),
      StudentAttendanceDay.countDocuments({ dateKey }),
      absentNoApplication(null, dateKey, dateKey),
    ]);
    const present = presence.reduce((s, c) => s + c.presentCount, 0);
    const absent = presence.reduce((s, c) => s + c.absentCount, 0);
    // One problem per still-unmarked UNIT (a Class 1–5 section waits on its Quran groups).
    const items: IDailyReportItem[] = [];
    for (const s of unmarked) {
      for (const u of s.pendingUnits) {
        items.push(
          item("MISSED", `${lvl(s.classLevel)} · ${s.sectionNameBn}`, u.markerName, u.label,
            link("ReportsTab", "AttendanceReport", { date: dateKey, sectionId: s.sectionId }, [...LEAF.AttendanceReport])),
        );
      }
    }
    return {
      onTime: markedUnits,
      problems: items.length,
      stats: [
        { key: "present", value: present },
        { key: "absent", value: absent },
        { key: "absentNoApplication", value: noApp.length },
      ],
      items,
      link: partLink,
    };
  },
};

const staff: PartBuilder = {
  key: "STAFF",
  replayable: true,
  build: async ({ dateKey }) => {
    const [days, cover] = await Promise.all([
      TeacherAttendanceDay.find({ dateKey }).select("staffProfileId status punchIn").lean(),
      needsCoverSlots(dateKey, dateKey),
    ]);
    const profiles = (await StaffProfile.find({ _id: { $in: days.map((d) => d.staffProfileId) } })
      .select("name nameBn")
      .lean()) as unknown as Array<{ _id: { toString(): string }; name: string; nameBn?: string }>;
    const nameOf = new Map(profiles.map((p) => [p._id.toString(), personName(p, "—")]));
    const count = (s: string) => days.filter((d) => d.status === s).length;
    const coverLink = link("HrTab", "NeedsCoverInbox", {}, ["cover:view_all"]);
    const items: IDailyReportItem[] = [
      ...cover.map((c) =>
        item("MISSED", `${c.className ?? c.subjectGroupName ?? "—"}${c.sectionName ? ` · ${c.sectionName}` : ""} · P${c.periodNumber}`,
          c.absentTeacherName, c.subjectName ?? c.routineSubject, coverLink),
      ),
      ...days
        .filter((d) => d.status === "ABSENT")
        .map((d) => item("MISSED", nameOf.get(d.staffProfileId.toString()) ?? "—", null, "ABSENT", null)),
      ...days
        .filter((d) => d.status === "LATE")
        .map((d) => item("LATE", nameOf.get(d.staffProfileId.toString()) ?? "—", null, d.punchIn ?? null, null)),
    ];
    return {
      onTime: count("PRESENT"),
      problems: items.length,
      stats: [
        { key: "staffPresent", value: count("PRESENT") },
        { key: "staffLate", value: count("LATE") },
        { key: "staffAbsent", value: count("ABSENT") },
        { key: "staffLeave", value: count("LEAVE") },
        { key: "coverUnfilled", value: cover.length },
        // The biometric sheet is imported by hand; until it is, late/absent cannot be counted.
        { key: "staffSheetMissing", value: days.length === 0 ? 1 : 0 },
      ],
      items,
      link: coverLink,
    };
  },
};

const teaching: PartBuilder = {
  key: "TEACHING",
  replayable: true,
  build: async ({ dateKey }) => {
    const partLink = link("ReportsTab", "ClassNoteReport", { date: dateKey }, [...LEAF.ClassNoteReport]);
    const { start, end } = dayBounds(dateKey);
    const [rows, observed] = await Promise.all([
      classNoteSubmissionReport(parseDateKey(dateKey)),
      ClassroomObservation.countDocuments({ createdAt: { $gte: start, $lt: end } }),
    ]);
    const written = rows.reduce((s, r) => s + r.publishedCount, 0);
    const missing = rows.reduce((s, r) => s + r.pendingCount, 0);
    const items = rows
      .filter((r) => r.pendingCount > 0)
      .map((r) =>
        item("MISSED",
          r.groupType === "section" ? `${lvl(r.classLevel)} · ${r.sectionNameBn ?? "—"}` : r.subjectGroupNameBn ?? "—",
          r.teacherName, r.pendingSubjects.join(", "), partLink),
      );
    return {
      onTime: written,
      problems: missing,
      stats: [
        { key: "notesWritten", value: written },
        { key: "notesMissing", value: missing },
        { key: "observationsToday", value: observed },
      ],
      items,
      link: partLink,
      na: rows.length === 0,
    };
  },
};

const homework: PartBuilder = {
  key: "HOMEWORK",
  replayable: true,
  build: async ({ dateKey, recon }) => {
    const partLink = link("ReportsTab", "ReconciliationReport", { date: dateKey }, [...LEAF.ReconciliationReport]);
    const [r, confirmed] = await Promise.all([
      recon(),
      HomeworkReconciliation.countDocuments({ reconDate: reconDayKey(parseDateKey(dateKey)), reconState: "reconciled" }),
    ]);
    const items = [
      ...r.hwNotDeclared.map((n) => item("MISSED", `${lvl(n.classLevel)} · ${n.sectionNameBn}`, n.teacherName, n.subject, partLink)),
      ...r.hwMisses.map((m) => item("LATE", `${lvl(m.classLevel)} · ${m.sectionNameBn}`, m.confirmerName, `${m.declaredItems}`, partLink)),
    ];
    return {
      onTime: confirmed,
      problems: items.length,
      stats: [
        { key: "hwIssued", value: confirmed },
        { key: "hwNotDeclared", value: r.hwNotDeclared.length },
        { key: "hwNotIssued", value: r.hwMisses.length },
      ],
      items,
      link: partLink,
    };
  },
};

const assignment: PartBuilder = {
  key: "ASSIGNMENT",
  replayable: true,
  build: async ({ dateKey, recon }) => {
    const partLink = link("ReportsTab", "ReconciliationReport", { date: dateKey }, [...LEAF.ReconciliationReport]);
    const [r, board] = await Promise.all([recon(), handoutBoard(parseDateKey(dateKey))]);
    const packets = packetCount(board.sections);
    const unprinted = unprintedCount(board.sections);
    const items = [
      ...r.asNotDeclared.map((n) => item("MISSED", `${lvl(n.classLevel)} · ${n.sectionNameBn}`, n.teacherName, `${n.subject} · W${n.weekNumber}`, partLink)),
      ...r.asMisses.map((m) => item("LATE", `${lvl(m.classLevel)} · ${m.sectionNameBn}`, m.confirmerName, `W${m.weekNumber}`, partLink)),
    ];
    return {
      onTime: Math.max(0, packets - unprinted),
      problems: items.length + unprinted,
      stats: [
        { key: "asPackets", value: packets },
        { key: "asUnprinted", value: unprinted },
        { key: "asNotDeclared", value: r.asNotDeclared.length },
        { key: "asNotDelivered", value: r.asMisses.length },
      ],
      items,
      link: partLink,
      na: packets === 0 && items.length === 0,
    };
  },
};

const classTest: PartBuilder = {
  key: "CLASS_TEST",
  replayable: true,
  build: async ({ dateKey, asOf }) => {
    const partLink = link("ReportsTab", "ClassTestDashboard", {}, [...LEAF.ClassTestDashboard]);
    const rows = await reportsStatus({ asOf }, { withTeacherNames: true });
    const sameDay = (iso: string | null) => (iso ? iso.slice(0, 10) === dateKey : false);
    const takenToday = rows.filter((r) => String(r.examDate).slice(0, 10) === dateKey).length;
    const publishedToday = rows.filter((r) => r.publishComplete && sameDay(r.publishedAt)).length;
    const overdue = rows.filter((r) => r.overdue);
    const items = overdue.map((r) =>
      item(r.teacherOverdue ? "LATE" : "MISSED",
        r.ctId,
        r.teacherOverdue ? r.teacherName : null,
        `${r.classLevel == null ? r.subject : `${lvl(r.classLevel)} · ${r.subject}`} · ${r.schoolDaysLate}d`,
        link("ClassTestTab", "ClassTestResultsView", { testId: r.testId, title: r.ctId }, ["class_test:view_all"])),
    );
    return {
      onTime: publishedToday,
      problems: overdue.length,
      stats: [
        { key: "ctTakenToday", value: takenToday },
        { key: "ctPublishedToday", value: publishedToday },
        { key: "ctAwaitingSubmit", value: overdue.filter((r) => r.teacherOverdue).length },
        { key: "ctAwaitingPublish", value: overdue.filter((r) => !r.teacherOverdue).length },
      ],
      items,
      link: partLink,
    };
  },
};

const mistakes: PartBuilder = {
  key: "MISTAKES",
  replayable: false,
  build: async ({ dateKey, asOf }) => {
    const { start, end } = dayBounds(dateKey);
    const [rows, explainDue, pendingReview, warnings, principals] = await Promise.all([
      StaffMistake.find({ dateKey }).select("staffUserId kind tier").lean(),
      StaffMistake.countDocuments({ status: "EXPLANATION_DUE", explainDueAt: { $lt: asOf } }),
      StaffMistake.countDocuments({ status: "PENDING_REVIEW" }),
      StaffWarning.countDocuments({ createdAt: { $gte: start, $lt: end } }),
      principalUserIds(),
    ]);
    const principalSet = new Set(principals);
    const users = (await User.find({ _id: { $in: rows.map((r) => r.staffUserId) } }).select("name").lean()) as unknown as Array<{
      _id: { toString(): string };
      name: string;
    }>;
    const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));
    const items = rows.map((r) => {
      const uid = r.staffUserId.toString();
      const name = nameOf.get(uid) ?? "—";
      return item("MISTAKE", name, STAFF_MISTAKE_KIND_TITLE_BN[r.kind as StaffMistakeKind] ?? r.kind, `T${r.tier}`,
        link("HrTab", "PersonMistakes", { staffUserId: uid, name }, ["staff_mistakes:view_all", "staff_mistakes:review"]),
        principalSet.has(uid));
    });
    const tier = (t: number) => rows.filter((r) => r.tier === t).length;
    return {
      onTime: 0,
      // An explanation past its deadline is a problem; the entries themselves count as mistakes.
      problems: explainDue,
      mistakes: rows.length,
      principalOwnMistakes: items.filter((i) => i.principalOnly).length,
      stats: [
        { key: "tier1", value: tier(1) },
        { key: "tier2", value: tier(2) },
        { key: "tier3", value: tier(3) },
        { key: "explainOverdue", value: explainDue },
        { key: "pendingReview", value: pendingReview },
        { key: "warningsToday", value: warnings },
      ],
      items,
      link: link("HrTab", "StaffMistakeSummary", {}, ["staff_mistakes:view_all"]),
    };
  },
};

const workBoard: PartBuilder = {
  key: "WORK_BOARD",
  replayable: true,
  build: async ({ dateKey, replay }) => {
    // A replay asks "is it done now?", so a task finished the next morning counts as fixed later.
    const end = replay ? new Date(8.64e15) : dayBounds(dateKey).end;
    const [due, olderOpen] = await Promise.all([
      Task.find({ dueKey: dateKey, cancelledAt: null }).select("titleBn assigneeUserId status doneAt").lean(),
      Task.countDocuments({ dueKey: { $lt: dateKey }, cancelledAt: null, status: { $ne: "DONE" } }),
    ]);
    const doneInTime = due.filter((t) => t.status === "DONE" && t.doneAt && t.doneAt < end);
    const open = due.filter((t) => !(t.status === "DONE" && t.doneAt && t.doneAt < end));
    const users = (await User.find({ _id: { $in: open.map((t) => t.assigneeUserId) } }).select("name").lean()) as unknown as Array<{
      _id: { toString(): string };
      name: string;
    }>;
    const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));
    const items = open.map((t) =>
      item("MISSED", t.titleBn, nameOf.get(t.assigneeUserId.toString()) ?? "—", null,
        link("WorkBoardTab", "TaskDetail", { taskId: t._id.toString() }, ["work_board:view_all"])),
    );
    return {
      onTime: doneInTime.length,
      problems: open.length,
      stats: [
        { key: "tasksDue", value: due.length },
        { key: "tasksDone", value: doneInTime.length },
        { key: "tasksOlderOpen", value: olderOpen },
      ],
      items,
      link: link("ReportsTab", "LoadGrid", {}, [...LEAF.LoadGrid]),
      na: due.length === 0 && olderOpen === 0,
    };
  },
};

const office: PartBuilder = {
  key: "OFFICE",
  replayable: false,
  build: async ({ dateKey }) => {
    const { start, end } = dayBounds(dateKey);
    const [queue, waitingSinceBefore, printedToday, pendingReview, commentsToday] = await Promise.all([
      printQueueCounts(),
      PrintRequest.countDocuments({ status: "REQUESTED", requestedAt: { $lt: start } }),
      PrintRequest.countDocuments({ requestedAt: { $gte: start, $lt: end }, status: { $ne: "REQUESTED" } }),
      reviewInboxCount(),
      StudentComment.countDocuments({ createdAt: { $gte: start, $lt: end } }),
    ]);
    return {
      onTime: printedToday,
      // A print job still waiting from an earlier day is the desk's problem today.
      problems: waitingSinceBefore,
      stats: [
        { key: "printRequested", value: queue.requested },
        { key: "printToDeliver", value: queue.printed },
        { key: "printOld", value: waitingSinceBefore },
        { key: "commentsToday", value: commentsToday },
        { key: "commentsPendingReview", value: pendingReview },
      ],
      items: [],
      link: link("PrintTab", "PrintHome", {}, ["printing:view_all"]),
    };
  },
};

const guardians: PartBuilder = {
  key: "GUARDIANS",
  replayable: false,
  build: async ({ dateKey }) => {
    const { start } = dayBounds(dateKey);
    const dayAgo = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    const [active, pending, waitingLong] = await Promise.all([
      GuardianView.distinct("guardianId", { dayKey: dateKey }),
      GuardianWorkClaim.countDocuments({ status: "PENDING" }),
      GuardianWorkClaim.countDocuments({ status: "PENDING", claimedAt: { $lt: dayAgo } }),
    ]);
    return {
      onTime: 0,
      problems: waitingLong,
      stats: [
        { key: "familiesActive", value: active.length },
        { key: "claimsPending", value: pending },
        { key: "claimsWaitingLong", value: waitingLong },
      ],
      items: [],
      link: link("ReportsTab", "WorkClaimQueue", {}, [...LEAF.WorkClaimQueue]),
    };
  },
};

const finance: PartBuilder = {
  key: "FINANCE",
  replayable: false,
  build: async ({ dateKey }) => {
    const snap = await dailySnapshot(dateKey);
    const sum = (f: (l: { in: number; out: number; closing: number }) => number) =>
      Math.round(snap.ledgers.reduce((s, l) => s + f(l), 0));
    return {
      onTime: 0,
      problems: 0,
      stats: [
        { key: "income", value: sum((l) => l.in) },
        { key: "expense", value: sum((l) => l.out) },
        { key: "closing", value: sum((l) => l.closing) },
      ],
      items: [],
      link: link("ReportsTab", "DailySnapshot", { date: dateKey }, [...LEAF.DailySnapshot]),
      status: "OK",
    };
  },
};

const system: PartBuilder = {
  key: "SYSTEM",
  replayable: false,
  build: async ({ asOf }) => {
    const [nightly, hourly] = await Promise.all([backupStatus(asOf), hourlyBackupStatus(asOf)]);
    const ticker = getTickerHealth(asOf);
    // The report is itself made by the ticker, so a stale heartbeat here means it was just restarted.
    const tickerStale = ticker.ageSeconds != null && ticker.ageSeconds > 5 * 60;
    const bad = (b: string) => b === "critical";
    const warn = (b: string) => b === "warn";
    const items: IDailyReportItem[] = [];
    if (bad(nightly.band) || warn(nightly.band)) items.push(item(bad(nightly.band) ? "MISSED" : "LATE", "nightly-backup", null, `${nightly.ageDays ?? "?"}d`, null));
    if (bad(hourly.band) || warn(hourly.band)) items.push(item(bad(hourly.band) ? "MISSED" : "LATE", "hourly-backup", null, `${hourly.ageHours ?? "?"}h`, null));
    if (tickerStale) items.push(item("LATE", "reminder-clock", null, `${Math.round((ticker.ageSeconds ?? 0) / 60)}m`, null));
    const anyCritical = bad(nightly.band) || bad(hourly.band);
    return {
      onTime: 3 - items.length,
      problems: items.length,
      stats: [
        { key: "backupNightlyAgeDays", value: nightly.ageDays ?? -1 },
        { key: "backupHourlyAgeHours", value: hourly.ageHours ?? -1 },
      ],
      items,
      link: link("AdminTab", "SystemHealth", {}, ["system_health:view"]),
      status: anyCritical ? "BAD" : undefined,
    };
  },
};

/** The parts in report order. Each part's switch: DAILY_REPORT_SECTION_PERMISSION. */
export const PART_BUILDERS: readonly PartBuilder[] = [
  attendance,
  staff,
  teaching,
  homework,
  assignment,
  classTest,
  mistakes,
  workBoard,
  office,
  guardians,
  finance,
  system,
];

export { DAILY_REPORT_SECTION_PERMISSION };
