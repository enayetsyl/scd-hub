/**
 * CSP-5 — the lifecycle sweeps, notices and light measures (docs/prd-child-support-profile.md §7.3,
 * §7.6, §7.8, §9.7, §11, §16.8; D-#1558, D-#1559, D-#1589).
 *
 *  - leaver sweep: a child with enrolment rows none of which covers today → the profile is LEFT;
 *    teachers lose access at once; NOTHING is deleted, `purgeAfterKey` stays null (owner Q-2);
 *    no AiExchange row is touched (owner Q-3, D-#1179).
 *  - notices (never naming a child): new class (first day of a grant), cover morning, monthly nudge to
 *    a teacher who wrote nothing this month, review due, the approval-load review day.
 *  - measures: one child's OWN series, or school totals — never a list of children or teachers
 *    ordered by a behaviour figure (M-1 … M-7).
 */
import { Types } from "mongoose";
import { SUPPORT_SECTIONS, callerHasPermission, type Permission } from "@scd/shared";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { writeAudit } from "../../platform/services/AuditService";
import { holderIdsOf } from "../../access-control/services/holders";
import { Enrolment } from "../../foundation/models/Enrolment";
import { ScopeGrant } from "../../foundation/models/ScopeGrant";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { SafeguardingReferral } from "../../platform/safeguarding/SafeguardingReferral";
import { SupportProfile } from "../models/SupportProfile";
import { SupportProfileVersion } from "../models/SupportProfileVersion";
import { SupportReport } from "../models/SupportReport";
import { SupportSetting } from "../models/SupportSetting";
import { SupportStrategy } from "../models/SupportStrategy";
import { SupportReview } from "../models/SupportReview";
import { SupportProfileRefusal } from "./errors";
import { isSwitchedOn, supportCaller, type SupportCtx } from "./supportAccess";
import { studentsReadBy } from "./supportScope";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { RoutineSubstitution } from "../../routine/models/RoutineSubstitution";
import { notifyHolders, notifyUser } from "./supportNotify";
import { strategyCounts } from "./supportStrategies";

const DAY = 86_400_000;
const addDays = (key: string, n: number): string => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** A child who has enrolment rows but none covering today has left (D-#1460). */
export async function leaverSweep(now: Date = new Date()): Promise<number> {
  const today = dhakaDayKey(now);
  let n = 0;
  for (const p of await SupportProfile.find({ status: "OPEN" }).select("studentId status")) {
    const any = await Enrolment.exists({ studentId: p.studentId });
    if (!any) continue;
    const covering = await Enrolment.exists({
      studentId: p.studentId,
      status: { $in: ["ACTIVE", "CLOSED"] },
      startKey: { $lte: today },
      $or: [{ endKey: { $exists: false } }, { endKey: null }, { endKey: { $gte: today } }],
    });
    if (covering) continue;
    p.status = "LEFT";
    await p.save();
    await writeAudit({ eventKind: "SUPPORT_PROFILE_CLOSED", targetId: String(p.studentId), targetKind: "Student", meta: { studentId: String(p.studentId), reason: "LEFT" } });
    n++;
  }
  return n;
}

async function sectionsWithPublishedProfiles(): Promise<Map<string, number>> {
  const ps = await SupportProfile.find({ status: "OPEN", currentVersionId: { $ne: null } }).select("studentId").lean();
  const today = dhakaDayKey(new Date());
  const enr = await Enrolment.find({
    studentId: { $in: ps.map((p) => p.studentId) },
    status: { $in: ["ACTIVE", "CLOSED"] },
    startKey: { $lte: today },
    $or: [{ endKey: { $exists: false } }, { endKey: null }, { endKey: { $gte: today } }],
  })
    .select("sectionId")
    .lean();
  const m = new Map<string, number>();
  for (const e of enr) m.set(String(e.sectionId), (m.get(String(e.sectionId)) ?? 0) + 1);
  return m;
}

/** §9.7: the first day a teacher teaches a section with profiles; the cover morning. Nothing while the switch is OFF. */
export async function newClassAndCoverNotices(now: Date = new Date()): Promise<number> {
  if (!(await isSwitchedOn())) return 0;
  const today = dhakaDayKey(now);
  const counts = await sectionsWithPublishedProfiles();
  const groupCounts = await groupsWithPublishedProfiles();
  if (!counts.size && !groupCounts.size) return 0;
  const bn = (k: number) => k.toLocaleString("bn-BD");
  let n = 0;
  const dayStart = new Date(`${today}T00:00:00+06:00`);
  const dayEnd = new Date(dayStart.getTime() + DAY);
  const groupKeys = [...counts.keys(), ...groupCounts.keys()].map((x) => new Types.ObjectId(x));
  const slots = await RoutineSlot.find({ groupType: { $in: ["section", "subjectgroup"] }, groupId: { $in: groupKeys }, active: true, effectiveFrom: { $gte: dayStart, $lt: dayEnd } })
    .select("teacherId groupId groupType")
    .lean();
  for (const s of slots) {
    if (!s.teacherId) continue;
    const c = (s.groupType === "subjectgroup" ? groupCounts : counts).get(String(s.groupId)) ?? 0;
    if (!c) continue;
    if (await notifyUser(String(s.teacherId), `আপনার নতুন ক্লাসে ${bn(c)} জন শিক্ষার্থীর সহায়তা প্রোফাইল আছে — ক্লাসের আগে পড়ে নিন`, `support-newclass:${s.groupId}`)) n++;
  }
  const covers = await ScopeGrant.find({ kind: "proxy", proxyStatus: "active", sectionId: { $in: [...counts.keys()].map((x) => new Types.ObjectId(x)) }, startDate: { $gte: dayStart, $lt: dayEnd } }).lean();
  for (const g of covers as unknown as { coveringTeacherId: Types.ObjectId; _id: Types.ObjectId }[]) {
    if (await notifyUser(String(g.coveringTeacherId), "আজকের কভার ক্লাসের সহায়তা প্রোফাইল দেখে নিন", `support-cover:${g._id}:${today}`)) n++;
  }
  // a cover for one period (Quran / Arabic groups included)
  const subs = await RoutineSubstitution.find({ active: true, date: { $gte: dayStart, $lt: dayEnd } }).select("slotId coverTeacherId").lean();
  if (subs.length) {
    const subSlots = await RoutineSlot.find({ _id: { $in: subs.map((x) => x.slotId) } }).select("groupType groupId").lean();
    const slotOf = new Map(subSlots.map((x) => [String(x._id), x]));
    for (const sub of subs) {
      const sl = slotOf.get(String(sub.slotId));
      if (!sl || !sub.coverTeacherId) continue;
      const c = (sl.groupType === "subjectgroup" ? groupCounts : counts).get(String(sl.groupId)) ?? 0;
      if (c && (await notifyUser(String(sub.coverTeacherId), "আজকের কভার ক্লাসের সহায়তা প্রোফাইল দেখে নিন", `support-coverperiod:${sub.slotId}:${today}`))) n++;
    }
  }
  return n;
}

async function groupsWithPublishedProfiles(): Promise<Map<string, number>> {
  const ps = await SupportProfile.find({ status: "OPEN", currentVersionId: { $ne: null } }).select("studentId").lean();
  const m = new Map<string, number>();
  if (!ps.length) return m;
  const mem = await SubjectGroupMembership.find({ studentId: { $in: ps.map((p) => p.studentId) } }).select("groupId").lean();
  for (const x of mem) m.set(String(x.groupId), (m.get(String(x.groupId)) ?? 0) + 1);
  return m;
}

/** §7.6: on the 25th, a gentle nudge to each report holder who wrote nothing this month. No count. */
export async function monthlyNudge(now: Date = new Date()): Promise<number> {
  if (!(await isSwitchedOn())) return 0;
  const today = dhakaDayKey(now);
  if (!today.endsWith("-25")) return 0;
  const month = today.slice(0, 7);
  const wrote = new Set((await SupportReport.find({ occurredOn: { $gte: `${month}-01` }, status: { $ne: "DRAFT" } }).distinct("authorId")).map(String));
  let n = 0;
  // only a teacher who currently reads at least one child with an open profile (§7.6)
  const openIds = (await SupportProfile.find({ status: "OPEN" }).select("studentId").lean()).map((p) => String(p.studentId));
  for (const uid of await holderIdsOf("support_profile:report" as Permission)) {
    if (wrote.has(uid)) continue;
    if (!openIds.length || !(await studentsReadBy(uid, openIds, now)).size) continue;
    if (await notifyUser(uid, "এ মাসে কোন শিক্ষার্থীর সাথে কী কাজ করেছে? ছোট করে লিখে দিন", `support-monthly:${month}`)) n++;
  }
  return n;
}

/** §7.3 review due (ONE notice with a count); §7.8 the approval-load review day. Nothing while the switch is OFF. */
export async function reviewNotices(now: Date = new Date()): Promise<number> {
  if (!(await isSwitchedOn())) return 0;
  const today = dhakaDayKey(now);
  let n = 0;
  const due = await SupportProfile.countDocuments({ status: "OPEN", nextReviewDueKey: { $lte: today } });
  if (due > 0) {
    n += await notifyHolders("support_profile:approve" as Permission, `${due.toLocaleString("bn-BD")} টি প্রোফাইলের পর্যালোচনা বাকি — শিক্ষার্থী সহায়তা খুলে দেখুন`, `support-review:${today}`);
  }
  const s = await SupportSetting.findOne({ key: "main" }).lean();
  if (s?.approvalLoadReviewDueKey && s.approvalLoadReviewDueKey <= today) {
    n += await notifyHolders("support_profile:approve" as Permission, "সহায়তা রিপোর্ট: অনুমোদনের চাপ পর্যালোচনার দিন", `support-load-review:${s.approvalLoadReviewDueKey}`);
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// §7.8 approval load (OA-4) — derived on read from report timestamps; school totals only
// ---------------------------------------------------------------------------------------------

export interface ApprovalLoad {
  reviewDueKey: string | null;
  weeks: { weekEndKey: string; waitingForDecision: number; saved: number; decided: number }[];
  largest: number;
  medianDaysToDecision: number | null;
  longestDaysToDecision: number | null;
  quickApprovableShare: number | null;
  waitingToProcess: number;
  oldestWaitingDays: number | null;
  tooHeavy: boolean;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** The last 4 school-week ends (Thursday 23:59 Dhaka). */
function weekEnds(now: Date): Date[] {
  const out: Date[] = [];
  const key = dhakaDayKey(now);
  let d = new Date(`${key}T23:59:59+06:00`);
  while (new Date(`${dhakaDayKey(d)}T12:00:00+06:00`).getUTCDay() !== 4) d = new Date(d.getTime() - DAY);
  for (let i = 0; i < 4; i++) out.push(new Date(d.getTime() - i * 7 * DAY));
  return out.reverse();
}

export async function approvalLoad(ctx: SupportCtx, now: Date = new Date()): Promise<ApprovalLoad> {
  const auth = await supportCaller(ctx);
  if (!callerHasPermission(auth, "support_profile:approve" as Permission)) throw new SupportProfileRefusal("অনুমতি নেই।");
  return computeApprovalLoad(now);
}

export async function computeApprovalLoad(now: Date = new Date()): Promise<ApprovalLoad> {
  const since = new Date(now.getTime() - 35 * DAY);
  const reps = await SupportReport.find({ $or: [{ processedAt: { $gte: since } }, { submittedAt: { $gte: since } }, { status: "PROCESSED" }] })
    .select("submittedAt processedAt decidedAt status")
    .lean();
  const weeks = weekEnds(now).map((end) => {
    const start = new Date(end.getTime() - 7 * DAY);
    const t = end.getTime();
    const r = reps as unknown as { submittedAt?: Date | null; processedAt?: Date | null; decidedAt?: Date | null }[];
    return {
      weekEndKey: dhakaDayKey(end),
      waitingForDecision: r.filter((x) => x.processedAt && x.processedAt.getTime() <= t && (!x.decidedAt || x.decidedAt.getTime() > t)).length,
      saved: r.filter((x) => x.submittedAt && x.submittedAt > start && x.submittedAt.getTime() <= t).length,
      decided: r.filter((x) => x.decidedAt && x.decidedAt > start && x.decidedAt.getTime() <= t).length,
    };
  });
  const decided = (reps as unknown as { submittedAt?: Date | null; decidedAt?: Date | null }[]).filter((x) => x.submittedAt && x.decidedAt);
  const days = decided.map((x) => Math.max(0, Math.round((x.decidedAt!.getTime() - x.submittedAt!.getTime()) / DAY)));
  const waiting = await SupportReport.countDocuments({ status: "TO_PROCESS" });
  const oldest = await SupportReport.findOne({ status: "TO_PROCESS" }).sort({ waitingSince: 1 }).select("waitingSince").lean();
  const processed = await SupportReport.find({ status: "PROCESSED" });
  const { isQuickApprovable } = await import("./supportQueueExtras");
  const s = await SupportSetting.findOne({ key: "main" }).lean();
  const ends = weeks.slice(-2);
  const med = median(days);
  return {
    reviewDueKey: s?.approvalLoadReviewDueKey ?? null,
    weeks,
    largest: Math.max(0, ...weeks.map((w) => w.waitingForDecision)),
    medianDaysToDecision: med,
    longestDaysToDecision: days.length ? Math.max(...days) : null,
    quickApprovableShare: processed.length ? Math.round((processed.filter((x) => isQuickApprovable(x)).length / processed.length) * 100) : null,
    waitingToProcess: waiting,
    oldestWaitingDays: oldest?.waitingSince ? Math.floor((now.getTime() - new Date(oldest.waitingSince).getTime()) / DAY) : null,
    tooHeavy: (ends.length === 2 && ends.every((w) => w.waitingForDecision > 25)) || (med != null && med > 7),
  };
}

/** §7.8: the owner's choice at the review is recorded; the next review date is set (default 90 days). */
export async function recordApprovalLoadChoice(ctx: SupportCtx, choice: string, nextInDays = 90): Promise<string> {
  const auth = await supportCaller(ctx, { noViewAs: true });
  if (!callerHasPermission(auth, "support_profile:manage" as Permission)) throw new SupportProfileRefusal("অনুমতি নেই।");
  const next = addDays(dhakaDayKey(new Date()), Math.max(7, Math.min(365, nextInDays)));
  await SupportSetting.updateOne({ key: "main" }, { $set: { approvalLoadReviewDueKey: next } }, { upsert: true });
  await SupportReview.create({ profileId: null, kind: "PERIODIC_REVIEW", decision: `APPROVAL_LOAD:${choice}`.slice(0, 60), by: new Types.ObjectId(auth.userId), at: new Date() });
  return next;
}

// ---------------------------------------------------------------------------------------------
// §11 measures — one child's own series, or school totals; never a ranked list
// ---------------------------------------------------------------------------------------------

export interface ChildIndicators {
  months: { month: string; positive: number; concern: number; tries: number; workedShare: number | null }[];
  strategiesReused: number;
  goalProgress: { itemId: string; progress: string; at: Date }[];
}

export async function childIndicators(ctx: SupportCtx, studentId: string): Promise<ChildIndicators> {
  const auth = await supportCaller(ctx);
  if (!callerHasPermission(auth, "support_profile:view_all" as Permission)) throw new SupportProfileRefusal("অনুমতি নেই।");
  const sid = new Types.ObjectId(studentId);
  const reps = await SupportReport.find({ studentId: sid, status: "APPROVED" }).select("occurredOn tone strategyLinks authorId").lean();
  const byMonth = new Map<string, { positive: number; concern: number; tries: number; worked: number }>();
  for (const r of reps) {
    const m = r.occurredOn.slice(0, 7);
    const b = byMonth.get(m) ?? { positive: 0, concern: 0, tries: 0, worked: 0 };
    if (r.tone === "POSITIVE") b.positive++;
    if (r.tone === "CONCERN") b.concern++;
    for (const l of r.strategyLinks) {
      b.tries++;
      if (l.outcome !== "DID_NOT_WORK") b.worked++;
    }
    byMonth.set(m, b);
  }
  const profile = await SupportProfile.findOne({ studentId: sid }).select("_id").lean();
  const strategies = profile ? await SupportStrategy.find({ profileId: profile._id }).select("_id createdFromReportId").lean() : [];
  const counts = await strategyCounts(strategies.map((s) => s._id as Types.ObjectId));
  const goals = profile ? await SupportReview.find({ profileId: profile._id, kind: "GOAL_PROGRESS" }).sort({ at: -1 }).limit(20).lean() : [];
  return {
    months: [...byMonth.entries()].sort().map(([month, b]) => ({ month, positive: b.positive, concern: b.concern, tries: b.tries, workedShare: b.tries >= 4 ? Math.round((b.worked / b.tries) * 100) : null })),
    strategiesReused: [...counts.values()].filter((c) => c.teachers >= 2).length,
    goalProgress: goals.map((g) => ({ itemId: g.reasonBn, progress: g.decision, at: g.at })),
  };
}

export interface SchoolTotals {
  coverageShare: number | null;
  medianDaysToDecision: number | null;
  goodThingShare: number | null;
  returnedByBatchShare: number | null;
  freshCardShare: number | null;
  safeguardingMedianHoursToSeen: number | null;
}

export async function schoolTotals(ctx: SupportCtx): Promise<SchoolTotals> {
  const auth = await supportCaller(ctx);
  if (!callerHasPermission(auth, "support_profile:view_all" as Permission)) throw new SupportProfileRefusal("অনুমতি নেই।");
  const today = dhakaDayKey(new Date());
  const profiles = await SupportProfile.find({ status: "OPEN" }).select("currentVersionId").lean();
  const versions = await SupportProfileVersion.find({ _id: { $in: profiles.map((p) => p.currentVersionId).filter(Boolean) } }).lean();
  const children = await Enrolment.distinct("studentId", { status: "ACTIVE" });
  const covered = versions.filter((v) => (v.sections?.strengths ?? []).length >= 2).length;
  const items = versions.flatMap((v) => SUPPORT_SECTIONS.flatMap((s) => v.sections?.[s] ?? []));
  const fresh = items.filter((i) => i.lastEvidenceKey && (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${i.lastEvidenceKey}T00:00:00Z`).getTime()) / DAY <= 180).length;
  const reps = await SupportReport.find({ status: { $nin: ["DRAFT", "WITHDRAWN"] }, source: { $ne: "GUARDIAN_INFO" } }).select("goodThing submittedAt decidedAt aiChecks").lean();
  const good = reps.filter((r) => r.goodThing?.textBn && !r.goodThing.none).length;
  const checked = reps.filter((r) => (r.aiChecks ?? []).length > 0);
  const returned = checked.filter((r) => (r.aiChecks as { verdict: string }[]).some((c) => c.verdict === "NEEDS_REWRITE")).length;
  const days = reps.filter((r) => r.submittedAt && r.decidedAt).map((r) => Math.round((r.decidedAt!.getTime() - r.submittedAt!.getTime()) / DAY));
  const refs = await SafeguardingReferral.find({ seenAt: { $ne: null } }).select("raisedAt seenAt").lean();
  const hours = refs.map((r) => Math.round((r.seenAt!.getTime() - r.raisedAt.getTime()) / 3600_000));
  const share = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  return {
    coverageShare: share(covered, children.length),
    medianDaysToDecision: median(days),
    goodThingShare: share(good, reps.length),
    returnedByBatchShare: share(returned, checked.length),
    freshCardShare: share(fresh, items.length),
    safeguardingMedianHoursToSeen: median(hours),
  };
}
