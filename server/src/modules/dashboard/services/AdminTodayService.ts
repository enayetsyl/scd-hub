/**
 * AdminTodayService (D-#316) — the Principal/Office Today dashboard read: ONE
 * round trip composing the modules' existing reads into generic cards.
 *
 * Output is deliberately GENERIC — `{ key, badges, rows, moreCount }` per card —
 * so the app renders every card with one component and new cards are mostly a
 * server change. Badge/tone keys are language-free (the app labels them);
 * row titles carry data (names) plus language-neutral codes (N/K/C1…, subject
 * codes — the glossary's "English codes on trackers" posture).
 *
 * Every block is BEST-EFFORT: a failing module yields its card with an `error`
 * badge instead of sinking the whole dashboard. Rows cap at 5 (`moreCount`
 * carries the rest); the tap-through screen shows everything.
 */
import { classPresenceForDate, unmarkedSections } from "../../attendance/services/AttendanceReportService";
import { parseDateKey } from "../../attendance/dates";
import { reconciliationReport, type ReconReport } from "../../trackers/services/ReconReportService";
import { homeworkLifecycleReport } from "../../trackers/services/HomeworkLifecycleReportService";
import { HomeworkReconciliation, reconDayKey } from "../../trackers/models/HomeworkReconciliation";
import { Class } from "../../foundation/models/Class";
import { listLeave } from "../../hr/services/StaffLeaveService";
import { needsCoverSlots } from "../../hr/services/CoverService";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { ClassroomObservation } from "../../classroom-observation/models/ClassroomObservation";
import { User } from "../../foundation/models/User";
import { reviewInbox } from "../../comments/services/StudentCommentService";
import { StudentComment } from "../../comments/models/StudentComment";
import { listPrintQueue } from "../../trackers/services/ClassTestService";
import { ClassTestResult } from "../../trackers/models/ClassTestResult";
import { printQueueCounts } from "../../printing/services/PrintRequestService";

export interface AdminCardBadge {
  key: string;
  value: number;
  /** ok | warn | danger | info | muted — the app maps to Badge tones. */
  tone: string;
}

export interface AdminCardRow {
  title: string;
  subtitle: string | null;
  value: string | null;
  tone: string;
}

export interface AdminTodayCard {
  /** attendance | hwCycle | hwLifecycle | assignments | leave | observations |
   *  comments | classTests | print — the app maps key → icon/title/target. */
  key: string;
  badges: AdminCardBadge[];
  rows: AdminCardRow[];
  /** Rows beyond the 5 shown — "…and N more" on the card. */
  moreCount: number;
}

const ROW_CAP = 5;

/** Language-neutral class-level code (glossary: English codes on trackers). */
const lvl = (level: number): string => (level === -1 ? "N" : level === 0 ? "K" : `C${level}`);

function cap(rows: AdminCardRow[]): { rows: AdminCardRow[]; moreCount: number } {
  return { rows: rows.slice(0, ROW_CAP), moreCount: Math.max(0, rows.length - ROW_CAP) };
}

/** A failing module yields its card with an `error` badge — never sinks the rest. */
async function safe(key: string, build: () => Promise<Omit<AdminTodayCard, "key">>): Promise<AdminTodayCard> {
  try {
    return { key, ...(await build()) };
  } catch (err) {
    console.error(`[adminToday] card "${key}" failed:`, err);
    return { key, badges: [{ key: "error", value: 1, tone: "danger" }], rows: [], moreCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

async function attendanceCard(dateKey: string): Promise<AdminTodayCard> {
  return safe("attendance", async () => {
    const [presence, unmarked] = await Promise.all([classPresenceForDate(dateKey), unmarkedSections(dateKey)]);
    const present = presence.reduce((s, c) => s + c.presentCount, 0);
    const absent = presence.reduce((s, c) => s + c.absentCount, 0);
    const rows = presence.map((c) => ({
      title: lvl(c.classLevel),
      subtitle: null,
      value: `${c.presentCount} / ${c.totalCount}${c.complete ? "" : " ⚠"}`,
      tone: c.complete ? (c.absentCount > 0 ? "warn" : "ok") : "danger",
    }));
    return {
      badges: [
        { key: "present", value: present, tone: "ok" },
        { key: "absent", value: absent, tone: absent > 0 ? "warn" : "ok" },
        { key: "unmarked", value: unmarked.length, tone: unmarked.length > 0 ? "danger" : "ok" },
      ],
      ...cap(rows),
    };
  });
}

async function hwCycleCard(dateKey: string, recon: ReconReport): Promise<AdminTodayCard> {
  return safe("hwCycle", async () => {
    const confirmed = (await HomeworkReconciliation.find({
      reconDate: reconDayKey(parseDateKey(dateKey)),
      reconState: "reconciled",
    })
      .select("classId autoIssued")
      .lean()) as unknown as Array<{ classId: { toString(): string }; autoIssued?: boolean }>;
    const classes = (await Class.find({ _id: { $in: confirmed.map((r) => r.classId) } })
      .select("level")
      .lean()) as unknown as Array<{ _id: { toString(): string }; level: number }>;
    const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level]));

    const pendingRows = recon.hwMisses.map((m) => ({
      title: `${lvl(m.classLevel)} — ${m.sectionNameBn}`,
      subtitle: m.confirmerName,
      value: `${m.declaredItems} · ${m.declaredMinutes}m`,
      tone: "danger",
    }));
    const confirmedRows = confirmed.map((r) => ({
      title: lvl(levelOf.get(r.classId.toString()) ?? 0),
      subtitle: null,
      value: r.autoIssued ? "🤖 ✓" : "✓",
      tone: "ok",
    }));
    return {
      badges: [
        { key: "pendingConfirm", value: recon.hwMisses.length, tone: recon.hwMisses.length > 0 ? "danger" : "ok" },
        { key: "notDeclared", value: recon.hwNotDeclared.length, tone: recon.hwNotDeclared.length > 0 ? "warn" : "ok" },
        { key: "confirmed", value: confirmed.length, tone: "ok" },
        { key: "autoIssued", value: confirmed.filter((r) => r.autoIssued).length, tone: "info" },
      ],
      ...cap([...pendingRows, ...confirmedRows]),
    };
  });
}

async function hwLifecycleCard(fromKey: string, toKey: string): Promise<AdminTodayCard> {
  return safe("hwLifecycle", async () => {
    const report = await homeworkLifecycleReport(fromKey, toKey);
    const rows = report.backlog.map((b) => ({
      title: `${lvl(b.classLevel)} — ${b.sectionNameBn} · ${b.subject}`,
      subtitle: b.teacherName,
      value: `${b.count} · ${b.oldestDays}d`,
      tone: "danger",
    }));
    const stuck = report.backlog.reduce((s, b) => s + b.count, 0);
    return {
      badges: [{ key: "checkingBacklog", value: stuck, tone: stuck > 0 ? "danger" : "ok" }],
      ...cap(rows),
    };
  });
}

async function assignmentsCard(recon: ReconReport): Promise<AdminTodayCard> {
  return safe("assignments", async () => {
    const declareRows = recon.asNotDeclared.map((m) => ({
      title: `${lvl(m.classLevel)} — ${m.sectionNameBn} · ${m.subject}`,
      subtitle: m.teacherName,
      value: `W${m.weekNumber}`,
      tone: "danger",
    }));
    const deliverRows = recon.asMisses.map((m) => ({
      title: `${lvl(m.classLevel)} — ${m.sectionNameBn}`,
      subtitle: m.confirmerName,
      value: `W${m.weekNumber} · ${m.draftItems}`,
      tone: "warn",
    }));
    return {
      badges: [
        { key: "declarePending", value: recon.asNotDeclared.length, tone: recon.asNotDeclared.length > 0 ? "danger" : "ok" },
        { key: "deliverPending", value: recon.asMisses.length, tone: recon.asMisses.length > 0 ? "warn" : "ok" },
      ],
      ...cap([...declareRows, ...deliverRows]),
    };
  });
}

async function leaveCard(dateKey: string): Promise<AdminTodayCard> {
  return safe("leave", async () => {
    const in7 = new Date(parseDateKey(dateKey));
    in7.setDate(in7.getDate() + 7);
    const toKey = `${in7.getFullYear()}-${String(in7.getMonth() + 1).padStart(2, "0")}-${String(in7.getDate()).padStart(2, "0")}`;
    const [applied, cover] = await Promise.all([listLeave({ status: "applied" }), needsCoverSlots(dateKey, toKey)]);
    const sorted = [...applied].sort(
      (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
    );
    const profiles = (await StaffProfile.find({ _id: { $in: sorted.map((l) => l.staffProfileId) } })
      .select("name nameBn")
      .lean()) as unknown as Array<{ _id: { toString(): string }; name: string; nameBn?: string }>;
    const nameOf = new Map(profiles.map((p) => [p._id.toString(), p.nameBn || p.name]));
    const rows = sorted.map((l) => ({
      title: nameOf.get(l.staffProfileId.toString()) ?? "—",
      subtitle: `${l.leaveType} · ${l.fromKey} → ${l.toKey}`,
      value: `${l.days}d`,
      tone: "warn",
    }));
    return {
      badges: [
        { key: "leavePending", value: applied.length, tone: applied.length > 0 ? "warn" : "ok" },
        { key: "needsCover", value: cover.length, tone: cover.length > 0 ? "danger" : "ok" },
      ],
      ...cap(rows),
    };
  });
}

async function observationsCard(): Promise<AdminTodayCard> {
  return safe("observations", async () => {
    const [uploaded, assigned, reviewed, responded, awaitingPublish, newest] = await Promise.all([
      ClassroomObservation.countDocuments({ state: "UPLOADED" }),
      ClassroomObservation.countDocuments({ state: "ASSIGNED" }),
      ClassroomObservation.countDocuments({ state: "REVIEWED" }),
      ClassroomObservation.countDocuments({ state: "TEACHER_RESPONDED" }),
      ClassroomObservation.countDocuments({ state: "REVIEWED", publishedAt: null }),
      ClassroomObservation.find({ state: { $ne: "SUPERSEDED" } })
        .sort({ createdAt: -1 })
        .limit(ROW_CAP)
        .select("teacherId state createdAt")
        .lean() as unknown as Promise<
        Array<{ teacherId: { toString(): string }; state: string; createdAt: Date }>
      >,
    ]);
    const users = (await User.find({ _id: { $in: newest.map((o) => o.teacherId) } })
      .select("name")
      .lean()) as unknown as Array<{ _id: { toString(): string }; name: string }>;
    const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));
    const rows = newest.map((o) => ({
      title: nameOf.get(o.teacherId.toString()) ?? "—",
      subtitle: o.state,
      value: null,
      tone: o.state === "TEACHER_RESPONDED" ? "ok" : o.state === "UPLOADED" ? "warn" : "info",
    }));
    return {
      badges: [
        { key: "obsUploaded", value: uploaded, tone: uploaded > 0 ? "warn" : "ok" },
        { key: "obsAssigned", value: assigned, tone: "info" },
        { key: "obsReviewed", value: reviewed, tone: "info" },
        { key: "obsResponded", value: responded, tone: "ok" },
        { key: "obsAwaitingPublish", value: awaitingPublish, tone: awaitingPublish > 0 ? "warn" : "ok" },
      ],
      rows,
      moreCount: 0,
    };
  });
}

async function commentsCard(dateKey: string): Promise<AdminTodayCard> {
  return safe("comments", async () => {
    const dayStart = parseDateKey(dateKey);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const [inbox, today] = await Promise.all([
      reviewInbox(),
      StudentComment.countDocuments({ createdAt: { $gte: dayStart, $lt: dayEnd } }),
    ]);
    const rows = inbox.map((c) => ({
      title: c.studentName,
      subtitle: c.authorName,
      value: c.type,
      tone: c.sentiment === "CONCERN" ? "warn" : "ok",
    }));
    return {
      badges: [
        { key: "commentsToday", value: today, tone: "info" },
        { key: "commentsPendingReview", value: inbox.length, tone: inbox.length > 0 ? "warn" : "ok" },
      ],
      ...cap(rows),
    };
  });
}

async function classTestsCard(): Promise<AdminTodayCard> {
  return safe("classTests", async () => {
    const [queue, awaitingApprovalTestIds] = await Promise.all([
      listPrintQueue(),
      ClassTestResult.distinct("testId", { submittedAt: { $ne: null }, publishedAt: null }) as unknown as Promise<
        unknown[]
      >,
    ]);
    const rows = queue.map((t: { ctId: string; subject: string; classLevel: number; examDate: string }) => ({
      title: `${t.ctId}`,
      subtitle: `${lvl(t.classLevel)} · ${t.subject}`,
      value: t.examDate ? String(t.examDate).slice(0, 10) : null,
      tone: "warn",
    }));
    return {
      badges: [
        { key: "ctPrintPending", value: queue.length, tone: queue.length > 0 ? "warn" : "ok" },
        {
          key: "ctAwaitingApproval",
          value: awaitingApprovalTestIds.length,
          tone: awaitingApprovalTestIds.length > 0 ? "warn" : "ok",
        },
      ],
      ...cap(rows),
    };
  });
}

async function printCard(): Promise<AdminTodayCard> {
  return safe("print", async () => {
    const counts = await printQueueCounts();
    return {
      badges: [
        { key: "printRequested", value: counts.requested, tone: counts.requested > 0 ? "danger" : "ok" },
        { key: "printToDeliver", value: counts.printed, tone: counts.printed > 0 ? "warn" : "ok" },
      ],
      rows: [],
      moreCount: 0,
    };
  });
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

export async function adminToday(dateKey: string, now = new Date()): Promise<AdminTodayCard[]> {
  parseDateKey(dateKey); // validate early — a bad key should 400, not error-card
  const weekAgo = new Date(parseDateKey(dateKey));
  weekAgo.setDate(weekAgo.getDate() - 6);
  const weekAgoKey = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, "0")}-${String(
    weekAgo.getDate(),
  ).padStart(2, "0")}`;

  // The recon read serves TWO cards — fetch once, best-effort.
  let recon: ReconReport;
  try {
    recon = await reconciliationReport(dateKey, dateKey, now);
  } catch (err) {
    console.error("[adminToday] reconciliationReport failed:", err);
    recon = { fromKey: dateKey, toKey: dateKey, hwMisses: [], asMisses: [], hwNotDeclared: [], hwNilDeclared: [], asNilDeclared: [], asNotDeclared: [] };
  }

  return Promise.all([
    attendanceCard(dateKey),
    hwCycleCard(dateKey, recon),
    hwLifecycleCard(weekAgoKey, dateKey),
    assignmentsCard(recon),
    leaveCard(dateKey),
    observationsCard(),
    commentsCard(dateKey),
    classTestsCard(),
    printCard(),
  ]);
}
