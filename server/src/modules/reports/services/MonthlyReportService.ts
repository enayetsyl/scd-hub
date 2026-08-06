/**
 * MonthlyReportService (MR-3, prd-monthly-report §7, D-#393/#394/#397/#398) — the
 * document's lifecycle: build a revision, decide whether it is worth being one,
 * release it, re-release it, revoke it.
 *
 * THE RULE THE WHOLE SLICE EXISTS FOR (D-#393): a RELEASED revision is immutable.
 * Late data never edits it — it creates revision N+1 in DRAFT beside it, and the
 * family keeps seeing revision N until a person releases the new one. Silently
 * changing a number a family has already read is the one failure this feature
 * cannot survive, so there is no code path that writes to a released row's snapshot.
 *
 * Two guards worth naming:
 *   - a recompute that changes NO REPORTED NUMBER creates nothing (§6.3). Without
 *     that, every nightly run would raise a revision and the office would drown in
 *     re-release prompts for noise.
 *   - release is refused while `provisional` (D-#394). The Principal may override
 *     with a reason; the Office may not.
 *
 * Role/permission gates (`report:release`, and the Principal-only overrides) are
 * enforced by the RESOLVER — this service takes the actor's role and trusts it.
 */
import { createHash } from "crypto";
import { Types } from "mongoose";
import { MonthlyReport, type IMonthlyReport, type IReportChange } from "../models/MonthlyReport";
import { Class } from "../../foundation/models/Class";
import { Student } from "../../foundation/models/Student";
import {
  commentFactsOf,
  generateGuardianComment,
  providerFromEnv,
  type CommentProvider,
} from "./MonthlyCommentService";
import { writeAudit } from "../../platform/services/AuditService";
import { dateKeyOf } from "../../attendance/dates";
import {
  monthWindowOf,
  previousPeriodKey,
  studentMonthMetrics,
  cohortOfRows,
  sectionMonthMetrics,
  schoolBestPresentDays,
  type StudentMonthMetrics,
  type SectionCohort,
} from "./MonthlyMetricsService";
import {
  coverageVerdictOf,
  flagsOf,
  monthTrendsOf,
  type FlagResult,
  type MonthTrends,
} from "./MonthlyTrendService";
import {
  readMonthlyReportConfig,
  type MonthlyReportConfigShape,
} from "./MonthlyReportConfigService";
import { defaultProfileWindow } from "../../trackers/services/StudentProfileContextService";

export class MonthlyReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonthlyReportError";
  }
}

// ---------------------------------------------------------------------------
// The frozen snapshot
// ---------------------------------------------------------------------------

export interface MonthlySnapshot {
  metrics: StudentMonthMetrics;
  previous: StudentMonthMetrics | null;
  cohort: SectionCohort | null;
  schoolBestPresentDays: number | null;
  trends: MonthTrends;
  flags: FlagResult[];
  /** The knobs in force when this revision was computed (D-#395). */
  config: MonthlyReportConfigShape;
}

// ---------------------------------------------------------------------------
// §6.3 — is this recompute worth a revision?
// ---------------------------------------------------------------------------

/** PURE. One tracker's `bySubject` rows, flattened into the same flat key shape as
 *  the rest of `reportedFigures` — `homework.bySubject.ENG.submitted`, etc. Mirrors
 *  exactly the fields `commentFactsOf`'s `subjectFactsOf` hands the model (2026-08-06,
 *  D-#459): before this, a comment could legitimately cite a subject's own numbers
 *  (added 2026-08-05) that the figuresHash binding never covered — two revisions with
 *  identical OVERALL totals but different per-subject splits hashed the same, so
 *  MR-8's "the figures moved, refuse the import" guarantee silently didn't apply to
 *  exactly the numbers it was meant to protect. Found by an owner-run audit of a real
 *  export file, not a test. */
function bySubjectFigures(
  prefix: string,
  rows: readonly { subject: string; submitted: number; expectedWhilePresent: number; checked: number; correct: number; partial: number; wrong: number; qualityRate: number | null }[],
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const r of rows) {
    out[`${prefix}.${r.subject}.submitted`] = r.submitted;
    out[`${prefix}.${r.subject}.expectedWhilePresent`] = r.expectedWhilePresent;
    out[`${prefix}.${r.subject}.checked`] = r.checked;
    out[`${prefix}.${r.subject}.correct`] = r.correct;
    out[`${prefix}.${r.subject}.partial`] = r.partial;
    out[`${prefix}.${r.subject}.wrong`] = r.wrong;
    out[`${prefix}.${r.subject}.qualityRate`] = r.qualityRate;
  }
  return out;
}

/**
 * PURE. The figures that actually PRINT. A revision is raised only when one of these
 * moves — the snapshot also carries timestamps and sample sizes, and a nightly rerun
 * that only re-stamps `dataAsOf` must not look like new information.
 */
export function reportedFigures(s: MonthlySnapshot): Record<string, string | number | null> {
  const m = s.metrics;
  const out: Record<string, string | number | null> = {
    "attendance.present": m.attendance.present,
    "attendance.schoolDays": m.attendance.schoolDays,
    "attendance.rate": m.attendance.rate,
    "attendance.absentUncovered": m.attendance.absentUncovered,
    "attendance.absentStreakMax": m.attendance.absentStreakMax,
    "homework.issued": m.homework.issued,
    "homework.submitted": m.homework.submitted,
    "homework.submissionRate": m.homework.submissionRate,
    "homework.qualityRate": m.homework.qualityRate,
    "homework.coverage": m.homework.coverage.pct,
    ...bySubjectFigures("homework.bySubject", m.homework.bySubject),
    "assignment.issued": m.assignment.issued,
    "assignment.submitted": m.assignment.submitted,
    "assignment.submissionRate": m.assignment.submissionRate,
    "assignment.qualityRate": m.assignment.qualityRate,
    "assignment.coverage": m.assignment.coverage.pct,
    ...bySubjectFigures("assignment.bySubject", m.assignment.bySubject),
    "classTest.testsHeld": m.classTest.testsHeld,
    "classTest.rate": m.classTest.rate,
    "classTest.unmarked": m.classTest.unmarked,
    "classTest.coverage": m.classTest.coverage.pct,
    "hifz.sessions": m.hifz.sessions,
    "hifz.present": m.hifz.present,
    "concerns.concern": m.concerns.concern,
    "concerns.positive": m.concerns.positive,
    "library.taken": m.library.taken,
    "library.overdue": m.library.overdue,
    "fees.paidTotal": m.fees.paidTotal,
    "fees.paidYearToDate": m.fees.paidYearToDate,
  };
  for (const [k, t] of Object.entries(s.trends)) out[`trend.${k}`] = t.state;
  // Null rather than "" when nothing is flagged, so the change log reads
  // "flags: — → SERIOUS_MATTER" instead of "flags: '' → SERIOUS_MATTER".
  out["flags"] = s.flags.length ? s.flags.map((f) => f.flag).sort().join(",") : null;
  return out;
}

/**
 * PURE. A stable fingerprint of everything a comment could legitimately describe
 * (MR-8 §8b.4). Stamped on export, re-checked on import: if a mark landed in between,
 * the hash moves and the comment is refused, because it describes numbers nobody will
 * ever see.
 *
 * Built from `reportedFigures` on purpose rather than the whole snapshot — the same
 * set the change log is diffed on. A nightly rerun that only re-stamps `dataAsOf`
 * must not invalidate comments already written against unchanged figures.
 *
 * Key order is sorted so the hash depends on the VALUES, not on the order
 * `reportedFigures` happens to build its object in.
 */
export function figuresHashOf(s: MonthlySnapshot): string {
  const figures = reportedFigures(s);
  const canonical = Object.keys(figures)
    .sort()
    .map((k) => `${k}=${figures[k] ?? ""}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** PURE. Field-by-field difference between two revisions' printed figures. */
export function diffFigures(
  before: Record<string, string | number | null>,
  after: Record<string, string | number | null>,
): IReportChange[] {
  const changes: IReportChange[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[key] ?? null;
    const a = after[key] ?? null;
    if (b === a) continue;
    changes.push({ field: key, before: b === null ? null : String(b), after: a === null ? null : String(a) });
  }
  return changes.sort((x, y) => x.field.localeCompare(y.field));
}

// ---------------------------------------------------------------------------
// §6.2 — where the month sits in its calendar
// ---------------------------------------------------------------------------

export const LOCK_STATES = ["OPEN", "WINDOW_CLOSED", "HARD_LOCKED"] as const;
export type LockState = (typeof LOCK_STATES)[number];

/**
 * PURE. `OPEN` — the nightly recompute may raise revisions. `WINDOW_CLOSED` — only a
 * person may recompute. `HARD_LOCKED` — corrections belong to the next month, and
 * only the Principal may reopen (D-#398).
 */
export function lockStateOf(
  periodKey: string,
  now: Date,
  cfg: MonthlyReportConfigShape,
): LockState {
  const { toKey } = monthWindowOf(periodKey);
  const monthEnd = new Date(`${toKey}T23:59:59.999Z`);
  const daysSince = Math.floor((now.getTime() - monthEnd.getTime()) / 86_400_000);
  if (daysSince <= cfg.revisionWindowDays) return "OPEN";
  if (daysSince <= cfg.hardLockDays) return "WINDOW_CLOSED";
  return "HARD_LOCKED";
}

// ---------------------------------------------------------------------------
// Release guard
// ---------------------------------------------------------------------------

export interface ReleaseVerdict {
  allowed: boolean;
  /** Machine-readable so the UI can offer the right remedy. */
  reason:
    | null
    | "ALREADY_RELEASED"
    | "NOT_REVIEWED"
    | "PROVISIONAL"
    | "HARD_LOCKED"
    | "REVOKED_STATE";
  requiresPrincipal: boolean;
}

/**
 * PURE. The gate, in one place, so the resolver and the UI cannot disagree about
 * why a button is disabled.
 *
 * `isPrincipal` does not skip the checks — it decides which refusals are
 * OVERRIDABLE. The Office sees the same reason and no override.
 */
export function releaseVerdictOf(
  report: {
    status: string;
    provisional: boolean;
    commentFinal?: string | null;
    reviewedAt?: Date | null;
  },
  lock: LockState,
  isPrincipal: boolean,
): ReleaseVerdict {
  if (report.status === "RELEASED") return { allowed: false, reason: "ALREADY_RELEASED", requiresPrincipal: false };
  if (report.status === "SUPERSEDED") return { allowed: false, reason: "REVOKED_STATE", requiresPrincipal: false };
  if (!report.reviewedAt || !(report.commentFinal ?? "").trim()) {
    // D-#399: a human either edited the draft or explicitly accepted it. There is no
    // override for this one — nobody may release words no person has read.
    return { allowed: false, reason: "NOT_REVIEWED", requiresPrincipal: false };
  }
  if (lock === "HARD_LOCKED") return { allowed: false, reason: "HARD_LOCKED", requiresPrincipal: true };
  if (report.provisional) return { allowed: false, reason: "PROVISIONAL", requiresPrincipal: true };
  return { allowed: true, reason: null, requiresPrincipal: false };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function computeSnapshot(
  studentId: string,
  periodKey: string,
  cfg: MonthlyReportConfigShape,
  now: Date,
  cohort: SectionCohort | null,
  schoolBest: number | null,
): Promise<MonthlySnapshot> {
  const [metrics, previous] = await Promise.all([
    studentMonthMetrics(studentId, periodKey, { now }),
    studentMonthMetrics(studentId, previousPeriodKey(periodKey), { now }).catch(() => null),
  ]);
  const trends = monthTrendsOf(metrics, previous, cfg);
  return {
    metrics,
    previous,
    cohort,
    schoolBestPresentDays: schoolBest,
    trends,
    flags: flagsOf(metrics, cfg),
    config: cfg,
  };
}

export interface BuildOutcome {
  report: IMonthlyReport;
  /** False when the recompute produced the same printed figures (§6.3). */
  created: boolean;
  changes: IReportChange[];
}

/**
 * Build (or re-build) one child's month.
 *
 * Revision 1 is created outright. Later runs compare the PRINTED figures against the
 * newest revision: identical → nothing is written; different → revision N+1 in DRAFT,
 * carrying the diff, while any RELEASED revision keeps its own row untouched.
 */
export async function buildMonthlyReport(
  studentId: string,
  periodKey: string,
  opts: { now?: Date; cohort?: SectionCohort | null; schoolBest?: number | null } = {},
): Promise<BuildOutcome> {
  const now = opts.now ?? new Date();
  const cfg = await readMonthlyReportConfig();

  const student = (await Student.findById(studentId).select("sectionId classId").lean()) as unknown as
    | { sectionId: Types.ObjectId; classId: Types.ObjectId }
    | null;
  if (!student) throw new MonthlyReportError("Student not found");

  const [snapshot, year] = await Promise.all([
    computeSnapshot(
      studentId,
      periodKey,
      cfg,
      now,
      opts.cohort ?? null,
      opts.schoolBest ?? null,
    ),
    defaultProfileWindow(now),
  ]);

  const verdict = coverageVerdictOf(snapshot.metrics, cfg);
  const latest = await newestRevision(studentId, periodKey);

  if (latest) {
    const changes = diffFigures(
      reportedFigures(latest.snapshot as unknown as MonthlySnapshot),
      reportedFigures(snapshot),
    );
    if (changes.length === 0) {
      // Nothing a reader would notice changed. Do NOT raise a revision.
      return { report: latest, created: false, changes: [] };
    }
    // A DRAFT that nobody has seen is amended in place — a revision number is for
    // what the family was shown, not for every nightly rerun before release.
    if (latest.status === "DRAFT") {
      latest.snapshot = snapshot as unknown as Record<string, unknown>;
      latest.dataAsOf = now;
      latest.provisional = verdict.provisional;
      latest.coveragePct = coveragePctOf(snapshot);
      latest.changeLog = changes;
      // The numbers moved under the reviewed text, so the review no longer stands.
      latest.reviewedAt = null;
      latest.reviewedByUserId = null;
      await latest.save();
      return { report: latest, created: false, changes };
    }

    const next = await MonthlyReport.create({
      studentId: new Types.ObjectId(studentId),
      sectionId: student.sectionId,
      classId: student.classId,
      academicYearId: year ? new Types.ObjectId(year.academicYearId) : null,
      periodKey,
      revision: latest.revision + 1,
      status: "DRAFT",
      snapshot,
      dataAsOf: now,
      provisional: verdict.provisional,
      coveragePct: coveragePctOf(snapshot),
      changeLog: changes,
    });
    return { report: next, created: true, changes };
  }

  const first = await MonthlyReport.create({
    studentId: new Types.ObjectId(studentId),
    sectionId: student.sectionId,
    classId: student.classId,
    academicYearId: year ? new Types.ObjectId(year.academicYearId) : null,
    periodKey,
    revision: 1,
    status: "DRAFT",
    snapshot,
    dataAsOf: now,
    provisional: verdict.provisional,
    coveragePct: coveragePctOf(snapshot),
    changeLog: [],
  });
  return { report: first, created: true, changes: [] };
}

function coveragePctOf(s: MonthlySnapshot): { homework: number | null; assignment: number | null; classTest: number | null } {
  return {
    homework: s.metrics.homework.coverage.pct,
    assignment: s.metrics.assignment.coverage.pct,
    classTest: s.metrics.classTest.coverage.pct,
  };
}

/** The newest revision of a (child × month), whatever its status. */
export async function newestRevision(studentId: string, periodKey: string): Promise<IMonthlyReport | null> {
  return MonthlyReport.findOne({ studentId: new Types.ObjectId(studentId), periodKey })
    .sort({ revision: -1 })
    .exec();
}

/** The revision the FAMILY is currently seeing, if any. */
export async function releasedRevision(studentId: string, periodKey: string): Promise<IMonthlyReport | null> {
  return MonthlyReport.findOne({ studentId: new Types.ObjectId(studentId), periodKey, status: "RELEASED" })
    .sort({ revision: -1 })
    .exec();
}

/** Build every child in a section, sharing ONE cohort computation (D-#396). */
export async function buildSectionMonthlyReports(
  sectionId: string,
  periodKey: string,
  opts: { now?: Date } = {},
): Promise<BuildOutcome[]> {
  const now = opts.now ?? new Date();
  const [section, schoolBest] = await Promise.all([
    sectionMonthMetrics(sectionId, periodKey, { now }),
    schoolBestPresentDays(periodKey),
  ]);
  const cfg = await readMonthlyReportConfig();
  const cohort = cohortOfRows(sectionId, periodKey, section.rows, section.rows.length, cfg.minSectionSizeForClassBest);

  const out: BuildOutcome[] = [];
  for (const row of section.rows) {
    out.push(await buildMonthlyReport(row.studentId, periodKey, { now, cohort, schoolBest }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Review + release
// ---------------------------------------------------------------------------

/**
 * Draft (or re-draft) the guardian paragraph onto a revision (MR-4).
 *
 * Writes `commentDraft` ONLY — never `commentFinal`, which a person must set. A fresh
 * draft CLEARS any prior review, because accepting text is a judgement about the words
 * that were actually read.
 */
export async function draftMonthlyComment(
  reportId: string,
  opts: { provider?: CommentProvider | null } = {},
): Promise<IMonthlyReport> {
  const report = await MonthlyReport.findById(reportId);
  if (!report) throw new MonthlyReportError("Report not found");
  if (report.status === "RELEASED" || report.status === "SUPERSEDED") {
    throw new MonthlyReportError("A released report cannot be re-drafted — a correction is a new revision");
  }

  const klass = (await Class.findById(report.classId).select("level").lean()) as { level: number } | null;
  const facts = commentFactsOf(report.snapshot as unknown as MonthlySnapshot, klass?.level ?? null);
  const provider = opts.provider === undefined ? providerFromEnv() : opts.provider;
  const draft = await generateGuardianComment(facts, provider);

  report.commentDraft = {
    text: draft.text,
    model: draft.model,
    promptVersion: draft.promptVersion,
    promptHash: draft.promptHash,
    generatedAt: draft.generatedAt,
    fallback: draft.fallback,
    fallbackReason: draft.fallbackReason,
  };
  report.reviewedAt = null;
  report.reviewedByUserId = null;
  if (report.status === "READY") report.status = "DRAFT";
  await report.save();
  return report;
}

/**
 * Draft many, ONE AT A TIME (MR-4).
 *
 * Strictly sequential and deliberately so: the free Gemini tier is rated per minute,
 * and firing a section's worth of requests at once would trip the limit and turn a
 * whole class into template fallbacks. A slow, complete run beats a fast, half-failed
 * one — the office presses this once for a month, not once per child.
 *
 * One child's failure never stops the rest; each outcome comes back with its reason,
 * and a report that fell back to the template still counts as drafted (it has a
 * usable paragraph) — the caller can see which ones from `fallback`.
 */
export async function draftMonthlyCommentsSequentially(
  reportIds: readonly string[],
  opts: { provider?: CommentProvider | null } = {},
): Promise<Array<{ reportId: string; drafted: boolean; fallback: boolean; error: string | null }>> {
  const out: Array<{ reportId: string; drafted: boolean; fallback: boolean; error: string | null }> = [];
  // Resolved ONCE: providerFromEnv() per child would re-read the env for every call
  // and lose the resolved-model memo the provider builds up.
  const provider = opts.provider === undefined ? providerFromEnv() : opts.provider;

  for (const id of reportIds) {
    try {
      const r = await draftMonthlyComment(id, { provider });
      out.push({ reportId: id, drafted: true, fallback: !!r.commentDraft?.fallback, error: null });
    } catch (err) {
      out.push({
        reportId: id,
        drafted: false,
        fallback: false,
        error: err instanceof Error ? err.message : "Failed",
      });
    }
  }
  return out;
}

/** Accept or edit the generated paragraph. Required before release (D-#399). */
export async function reviewMonthlyReport(
  reportId: string,
  text: string,
  actorId: string,
): Promise<IMonthlyReport> {
  const report = await MonthlyReport.findById(reportId);
  if (!report) throw new MonthlyReportError("Report not found");
  if (report.status === "RELEASED" || report.status === "SUPERSEDED") {
    throw new MonthlyReportError("A released report cannot be edited — a correction is a new revision");
  }
  const body = text.trim();
  if (!body) throw new MonthlyReportError("The guardian comment cannot be empty");

  report.commentFinal = body;
  report.reviewedByUserId = new Types.ObjectId(actorId);
  report.reviewedAt = new Date();
  report.status = "READY";
  await report.save();
  return report;
}

export interface ReleaseOptions {
  isPrincipal: boolean;
  batchId?: string | null;
  /** Required to release a provisional report or reopen a hard-locked month. */
  overrideReason?: string | null;
  now?: Date;
}

/**
 * Release one revision to the family.
 *
 * When an earlier revision is already released, THIS revision replaces it: the older
 * row is stamped SUPERSEDED (never edited otherwise) and the new one is flagged
 * `isRerelease`, which is what makes the family's notification say "revised" rather
 * than "available" (§9).
 */
export async function releaseMonthlyReport(
  reportId: string,
  actorId: string,
  opts: ReleaseOptions,
): Promise<IMonthlyReport> {
  const now = opts.now ?? new Date();
  const report = await MonthlyReport.findById(reportId);
  if (!report) throw new MonthlyReportError("Report not found");

  const cfg = await readMonthlyReportConfig();
  const lock = lockStateOf(report.periodKey, now, cfg);
  const verdict = releaseVerdictOf(report, lock, opts.isPrincipal);

  if (!verdict.allowed) {
    const reason = (opts.overrideReason ?? "").trim();
    const overridable = verdict.requiresPrincipal && opts.isPrincipal && reason.length > 0;
    if (!overridable) throw new MonthlyReportError(refusalMessage(verdict.reason));

    if (verdict.reason === "PROVISIONAL") {
      report.gateOverrideReason = reason;
      report.gateOverriddenByUserId = new Types.ObjectId(actorId);
      await writeAudit({
        eventKind: "MONTHLY_REPORT_GATE_OVERRIDDEN",
        actorId,
        targetKind: "MonthlyReport",
        targetId: report._id.toString(),
        meta: { periodKey: report.periodKey, revision: report.revision, reason, coverage: report.coveragePct },
      });
    } else if (verdict.reason === "HARD_LOCKED") {
      report.unlockReason = reason;
      await writeAudit({
        eventKind: "MONTHLY_REPORT_UNLOCKED",
        actorId,
        targetKind: "MonthlyReport",
        targetId: report._id.toString(),
        meta: { periodKey: report.periodKey, revision: report.revision, reason },
      });
    }
  }

  const prior = await releasedRevision(report.studentId.toString(), report.periodKey);
  if (prior && prior._id.toString() !== report._id.toString()) {
    prior.status = "SUPERSEDED";
    await prior.save();
  }

  report.status = "RELEASED";
  report.releasedAt = now;
  report.releasedByUserId = new Types.ObjectId(actorId);
  report.releaseBatchId = opts.batchId ?? null;
  report.isRerelease = !!prior && prior._id.toString() !== report._id.toString();
  report.revokedAt = null;
  report.revokedByUserId = null;
  report.revokeReason = null;
  await report.save();

  // MR-6: tell the family. Isolated on purpose — the release is already decided and
  // audited, so a template or transport failure is a follow-up, never a reason to
  // leave the document un-released.
  try {
    const { deliverMonthlyReport } = await import("./MonthlyReportDeliveryService");
    await deliverMonthlyReport(report);
  } catch (err) {
    console.error(`[MonthlyReport] delivery failed for ${report._id.toString()}:`, err);
  }

  await writeAudit({
    eventKind: report.isRerelease ? "MONTHLY_REPORT_RERELEASED" : "MONTHLY_REPORT_RELEASED",
    actorId,
    targetKind: "MonthlyReport",
    targetId: report._id.toString(),
    meta: {
      studentId: report.studentId.toString(),
      periodKey: report.periodKey,
      revision: report.revision,
      supersededRevision: prior && prior._id.toString() !== report._id.toString() ? prior.revision : null,
      batchId: opts.batchId ?? null,
      provisional: report.provisional,
    },
  });

  return report;
}

function refusalMessage(reason: ReleaseVerdict["reason"]): string {
  switch (reason) {
    case "ALREADY_RELEASED":
      return "This revision is already released";
    case "NOT_REVIEWED":
      return "The guardian comment must be reviewed before release";
    case "PROVISIONAL":
      return "The month's data is incomplete — only the Principal may release it, with a reason";
    case "HARD_LOCKED":
      return "This month is locked — only the Principal may reopen it, with a reason";
    case "REVOKED_STATE":
      return "A superseded revision cannot be released";
    default:
      return "This report cannot be released";
  }
}

/** Release many at once under ONE batch id. A refusal on one child does not abort
 *  the rest — the caller gets a per-student outcome so the office can see exactly
 *  which ones were held back and why. */
export async function bulkReleaseMonthlyReports(
  reportIds: readonly string[],
  actorId: string,
  opts: ReleaseOptions,
): Promise<Array<{ reportId: string; released: boolean; error: string | null }>> {
  const batchId = opts.batchId ?? new Types.ObjectId().toString();
  const out: Array<{ reportId: string; released: boolean; error: string | null }> = [];
  for (const id of reportIds) {
    try {
      await releaseMonthlyReport(id, actorId, { ...opts, batchId });
      out.push({ reportId: id, released: true, error: null });
    } catch (err) {
      out.push({ reportId: id, released: false, error: err instanceof Error ? err.message : "Failed" });
    }
  }
  return out;
}

/** Withdraw a released report (Principal only, enforced in the resolver). The row
 *  returns to READY — its numbers and its reviewed text are untouched, because the
 *  document is not the mistake; releasing it was. */
export async function revokeMonthlyReport(
  reportId: string,
  actorId: string,
  reason: string,
): Promise<IMonthlyReport> {
  const report = await MonthlyReport.findById(reportId);
  if (!report) throw new MonthlyReportError("Report not found");
  if (report.status !== "RELEASED") throw new MonthlyReportError("Only a released report can be revoked");
  const why = reason.trim();
  if (!why) throw new MonthlyReportError("A revoke needs a reason");

  report.status = "READY";
  report.revokedAt = new Date();
  report.revokedByUserId = new Types.ObjectId(actorId);
  report.revokeReason = why;
  await report.save();

  await writeAudit({
    eventKind: "MONTHLY_REPORT_REVOKED",
    actorId,
    targetKind: "MonthlyReport",
    targetId: report._id.toString(),
    meta: { studentId: report.studentId.toString(), periodKey: report.periodKey, revision: report.revision, reason: why, batchId: report.releaseBatchId },
  });

  return report;
}

/** Revoke every report released under one batch id — the undo for a wrong bulk
 *  release (D-#397). */
export async function revokeReleaseBatch(
  batchId: string,
  actorId: string,
  reason: string,
): Promise<number> {
  const rows = await MonthlyReport.find({ releaseBatchId: batchId, status: "RELEASED" }).select("_id").lean();
  let revoked = 0;
  for (const r of rows as Array<{ _id: Types.ObjectId }>) {
    await revokeMonthlyReport(r._id.toString(), actorId, reason);
    revoked += 1;
  }
  return revoked;
}

/** The nightly sweep's unit of work (§6.3): rebuild the open month for one section.
 *  A HARD_LOCKED month is skipped outright — reopening is a person's decision. */
export async function sweepSectionMonth(
  sectionId: string,
  periodKey: string,
  now: Date = new Date(),
): Promise<{ skipped: boolean; built: number; revisions: number }> {
  const cfg = await readMonthlyReportConfig();
  if (lockStateOf(periodKey, now, cfg) !== "OPEN") return { skipped: true, built: 0, revisions: 0 };
  const outcomes = await buildSectionMonthlyReports(sectionId, periodKey, { now });
  return {
    skipped: false,
    built: outcomes.length,
    revisions: outcomes.filter((o) => o.created).length,
  };
}

// ---------------------------------------------------------------------------
// The Principal's class roll-up (MR-7, prd §3)
// ---------------------------------------------------------------------------

export interface ClassRollup {
  sectionId: string;
  periodKey: string;
  students: number;
  released: number;
  awaitingReview: number;
  provisional: number;
  /** Cohort means over the children who HAVE a figure — never a fabricated zero. */
  avgAttendancePct: number | null;
  avgHomeworkSubmissionPct: number | null;
  avgClassTestPct: number | null;
  /** How many children tripped each absolute flag — where the Principal looks first. */
  flagCounts: Array<{ flag: string; students: number }>;
  /** Children whose attendance trend is DOWN this month. */
  attendanceDeclining: number;
}

/**
 * PURE. Rolls the section's newest revisions up into one row.
 *
 * Reads the STORED snapshots rather than recomputing: the Principal's view must be
 * the same arithmetic the families were sent, and a second computation path is how
 * the two start disagreeing.
 */
export function rollupOf(
  sectionId: string,
  periodKey: string,
  reports: ReadonlyArray<{
    status: string;
    provisional: boolean;
    reviewedAt?: Date | null;
    snapshot: Record<string, unknown>;
  }>,
): ClassRollup {
  const mean = (xs: number[]): number | null =>
    xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;

  const att: number[] = [];
  const hw: number[] = [];
  const ct: number[] = [];
  const flagAcc = new Map<string, number>();
  let attendanceDeclining = 0;

  for (const r of reports) {
    const s = r.snapshot as unknown as MonthlySnapshot;
    const m = s?.metrics;
    if (m?.attendance?.rate != null) att.push(m.attendance.rate);
    if (m?.homework?.submissionRate != null) hw.push(m.homework.submissionRate);
    if (m?.classTest?.rate != null) ct.push(m.classTest.rate);
    if (s?.trends?.attendance?.state === "DOWN") attendanceDeclining += 1;
    for (const f of s?.flags ?? []) flagAcc.set(f.flag, (flagAcc.get(f.flag) ?? 0) + 1);
  }

  return {
    sectionId,
    periodKey,
    students: reports.length,
    released: reports.filter((r) => r.status === "RELEASED").length,
    awaitingReview: reports.filter((r) => r.status !== "RELEASED" && !r.reviewedAt).length,
    provisional: reports.filter((r) => r.provisional).length,
    avgAttendancePct: mean(att),
    avgHomeworkSubmissionPct: mean(hw),
    avgClassTestPct: mean(ct),
    flagCounts: [...flagAcc.entries()]
      .map(([flag, students]) => ({ flag, students }))
      .sort((a, b) => b.students - a.students || a.flag.localeCompare(b.flag)),
    attendanceDeclining,
  };
}

/** One row per section for a month — the newest revision of each child. */
export async function monthlyClassRollup(sectionId: string, periodKey: string): Promise<ClassRollup> {
  const rows = (await MonthlyReport.find({ sectionId: new Types.ObjectId(sectionId), periodKey })
    .sort({ revision: -1 })
    .select("studentId status provisional reviewedAt snapshot")
    .lean()) as unknown as Array<{
    studentId: Types.ObjectId;
    status: string;
    provisional: boolean;
    reviewedAt?: Date | null;
    snapshot: Record<string, unknown>;
  }>;

  // Newest revision per child — a superseded one is history, not a second student.
  const newest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = r.studentId.toString();
    if (!newest.has(k)) newest.set(k, r);
  }
  return rollupOf(sectionId, periodKey, [...newest.values()]);
}

/** The period the nightly sweep should be working on: the month that has just ended. */
export function sweepPeriodKeyFor(now: Date): string {
  const key = dateKeyOf(now).slice(0, 7);
  return previousPeriodKey(key);
}
