/**
 * MasteryActionService — M-5 of the mastery tracker: section trigger → extra class → re-test →
 * close with outcome (docs/prd-mastery.md §5.5 / §6.3 / §10 journeys 6–7, D-#781 / #786 / #811).
 *
 *  - evaluateSectionTriggers — after evidence is written: one PROPOSED action per section ×
 *                              subject × outcome over the trigger line (never a duplicate)
 *  - decideAction            — `mastery:approve`: EXTRA_CLASS (date + period / after school,
 *                              attendees, re-test date), RETEACH (normal period), or REJECT
 *  - recordHeld              — the teacher records the class and who came
 *  - buildRetest             — a RETEST work sheet: unseen gold questions per student on the outcome
 *  - closeAction             — before / after and the outcome (the app suggests one)
 *  - actionDetail / actionsPage / actionCounts — the action screen, the leader dashboard, the record
 *
 * Reach: an approver (`mastery:approve`, Principal by default, selected Office staff by grant —
 * D-#786) sees and decides every action; the routine holder (or `mastery:edit_all`) works their
 * own section's (held, re-test, close) — the M-2 row rule, never a role check (D-#799).
 */
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { MasteryActionOutcome, MasteryAttendeeSet, MasterySubject } from "@scd/shared";
import { MasteryAction, type IMasteryAction } from "../models/MasteryAction";
import { MasteryPaper } from "../models/MasteryPaper";
import { MasteryEvidence } from "../models/MasteryEvidence";
import { MasteryOutcome } from "../models/MasteryOutcome";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { resolveSubjectTeacher } from "../../trackers/subjectTeacher";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { personName } from "../../../lib/personName";
import { getPolicy, isMasteryEnabled } from "./MasteryCatalogueService";
import { MasteryWorkError, assertMayWork, dayOf, nextPaperId, rosterOf, sectionContext, type Auth } from "./MasteryWorkService";
import { computeSection, liveSectionRows, sectionLabel } from "./MasteryDiagnosisService";
import { goldBank, marksTable } from "./MasteryAssignmentService";
import { pickQuestion, typeFor } from "../assignmentBuilder";
import { sectionOutcomeSummary } from "../diagnosis";

const oid = (s: string) => new Types.ObjectId(s);
const DAY = 86_400_000;
/** Questions per student on a re-test (each a different unseen gold question on the outcome). */
export const RETEST_QUESTIONS = 2;
const OPEN = ["PROPOSED", "APPROVED", "IN_PROGRESS", "CHECKING"] as const;

const ymd = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const byOf = (auth: Auth) => (Types.ObjectId.isValid(auth.userId) ? oid(auth.userId) : undefined);
const canApprove = (auth: Auth) => callerHasPermission(auth, "mastery:approve");

async function mayWork(auth: Auth, a: IMasteryAction): Promise<boolean> {
  try {
    await assertMayWork(auth, a.sectionId, a.subject, new Date());
    return true;
  } catch {
    return false;
  }
}

async function loadAction(id: string): Promise<IMasteryAction> {
  if (!Types.ObjectId.isValid(id)) throw new MasteryWorkError("পদক্ষেপ পাওয়া যায়নি।");
  const a = await MasteryAction.findById(id);
  if (!a) throw new MasteryWorkError("পদক্ষেপ পাওয়া যায়নি।");
  return a;
}

/** Approver, or the routine holder of the section × subject. */
async function assertCanSee(auth: Auth, a: IMasteryAction): Promise<void> {
  if (canApprove(auth)) return;
  await assertMayWork(auth, a.sectionId, a.subject, new Date());
}

/** The section's states for one outcome right now, plus its summary. */
async function outcomeNow(a: Pick<IMasteryAction, "sectionId" | "subject" | "classToken" | "loCode">) {
  const [rows, policy] = await Promise.all([liveSectionRows(a.sectionId, a.subject, a.loCode), getPolicy(a.classToken, a.subject)]);
  const sec = computeSection(rows, policy.resolved, new Date());
  const per = sec.states.get(a.loCode) ?? new Map();
  const summary = sectionOutcomeSummary([...per.values()].map((s) => s.state), sec.assessments.get(a.loCode) ?? 0, policy.resolved);
  return { per, summary, policy: policy.resolved };
}

const meanOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length > 0 ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
};

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

/** Open a PROPOSED action for every outcome over the line that has no open action. Returns how many. */
export async function evaluateSectionTriggers(sectionId: Types.ObjectId, subject: MasterySubject): Promise<number> {
  const ctx = await sectionContext(String(sectionId));
  if (!(await isMasteryEnabled(ctx.academicYearId, ctx.classToken, subject))) return 0;
  const [rows, policy] = await Promise.all([liveSectionRows(ctx.sectionId, subject), getPolicy(ctx.classToken, subject)]);
  const sec = computeSection(rows, policy.resolved, new Date());
  let opened = 0;
  for (const [loCode, per] of sec.states) {
    const s = sectionOutcomeSummary([...per.values()].map((x) => x.state), sec.assessments.get(loCode) ?? 0, policy.resolved);
    if (!s.triggered) continue;
    if (await MasteryAction.exists({ sectionId: ctx.sectionId, subject, loCode, status: { $in: OPEN } })) continue;
    const now = new Date();
    try {
      const a = await MasteryAction.create({
        scope: "SECTION",
        sectionId: ctx.sectionId,
        classId: ctx.classId,
        academicYearId: ctx.academicYearId,
        classToken: ctx.classToken,
        subject,
        loCode,
        kind: "EXTRA_CLASS",
        status: "PROPOSED",
        trigger: {
          at: now, weakPct: s.weakPct ?? 0, weak: s.weak, verdicts: s.verdicts, assessments: sec.assessments.get(loCode) ?? 0,
          weakStudentIds: [...per.entries()].filter(([, x]) => x.state === "WEAK").map(([sid]) => oid(sid)),
        },
        events: [{ at: now, kind: "PROPOSED" }],
      });
      opened++;
      void writeAudit({
        eventKind: "MASTERY_ACTION_PROPOSED",
        targetKind: "MasteryAction",
        targetId: a._id,
        meta: { sectionId: String(ctx.sectionId), subject, loCode, weakPct: s.weakPct },
      });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err; // a parallel save opened it first
    }
  }
  return opened;
}

// ---------------------------------------------------------------------------
// Decide (approver)
// ---------------------------------------------------------------------------

export interface DecideInput {
  decision: "EXTRA_CLASS" | "RETEACH" | "REJECT";
  date?: string | null;
  slotKind?: "PERIOD" | "AFTER_SCHOOL" | null;
  periodNumber?: number | null;
  attendees?: MasteryAttendeeSet | null;
  retestDate?: string | null;
  note?: string | null;
}

export async function decideAction(id: string, input: DecideInput, auth: Auth): Promise<ActionDetail> {
  if (!canApprove(auth)) throw new MasteryWorkError("অতিরিক্ত ক্লাস অনুমোদনের অনুমতি আপনার নেই।");
  const a = await loadAction(id);
  if (a.status !== "PROPOSED") throw new MasteryWorkError("এই প্রস্তাবের সিদ্ধান্ত আগেই হয়ে গেছে।");
  const note = (input.note ?? "").trim() || undefined;
  const now = new Date();

  if (input.decision === "REJECT") {
    if (!note) throw new MasteryWorkError("ফেরত দেওয়ার কারণ লিখুন।");
    a.status = "REJECTED";
    a.events.push({ at: now, kind: "REJECTED", by: byOf(auth), note });
  } else {
    const isClass = input.decision === "EXTRA_CLASS";
    let date: Date | undefined;
    if (isClass) {
      if (!input.date) throw new MasteryWorkError("অতিরিক্ত ক্লাসের তারিখ দিন।");
      date = dayOf(input.date);
      if (input.slotKind !== "PERIOD" && input.slotKind !== "AFTER_SCHOOL") throw new MasteryWorkError("পিরিয়ড না ছুটির পর — বাছুন।");
      if (input.slotKind === "PERIOD" && !(Number.isInteger(input.periodNumber) && (input.periodNumber as number) >= 1 && (input.periodNumber as number) <= 12)) {
        throw new MasteryWorkError("পিরিয়ড নম্বর ১ থেকে ১২-এর মধ্যে দিন।");
      }
    }
    const attendees: MasteryAttendeeSet = input.attendees ?? "WEAK";
    const { per, summary, policy } = await outcomeNow(a);
    const roster = await rosterOf(a.sectionId);
    const want = (st: string) => (attendees === "SECTION" ? true : attendees === "WEAK_IMPROVING" ? st === "WEAK" || st === "IMPROVING" : st === "WEAK");
    const studentIds = roster.map((s) => String(s._id)).filter((sid) => want(per.get(sid)?.state ?? "NOT_ASSESSED"));
    if (studentIds.length === 0) throw new MasteryWorkError("এই বাছাইয়ে কোনো শিক্ষার্থী নেই।");
    const base = date ?? dayOf(ymd(now)!);
    const retestDate = input.retestDate ? dayOf(input.retestDate) : new Date(base.getTime() + policy.retestAfterDays * DAY);
    if (retestDate.getTime() < base.getTime()) throw new MasteryWorkError("রি-টেস্ট ক্লাসের পরে হতে হবে।");
    const teacher = await resolveSubjectTeacher(String(a.sectionId), a.subject, base);
    a.kind = isClass ? "EXTRA_CLASS" : "RETEACH";
    a.status = "APPROVED";
    a.plan = {
      date,
      slotKind: isClass ? (input.slotKind as "PERIOD" | "AFTER_SCHOOL") : undefined,
      periodNumber: isClass && input.slotKind === "PERIOD" ? (input.periodNumber as number) : undefined,
      teacherId: teacher && Types.ObjectId.isValid(String(teacher)) ? oid(String(teacher)) : undefined,
      attendees,
      studentIds: studentIds.map(oid),
      retestDate,
      note,
    };
    a.before = { weakPct: summary.weakPct, meanPct: meanOf(studentIds.map((sid) => per.get(sid)?.recentPct ?? null)) };
    a.events.push({ at: now, kind: isClass ? "APPROVED" : "RETEACH", by: byOf(auth), note });
  }
  await a.save();
  void writeAudit({
    eventKind: "MASTERY_ACTION_DECIDED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryAction",
    targetId: a._id,
    meta: { decision: input.decision, loCode: a.loCode, students: a.plan?.studentIds?.length ?? 0 },
  });
  return actionDetail(id, auth);
}

// ---------------------------------------------------------------------------
// Teacher steps
// ---------------------------------------------------------------------------

export async function recordHeld(id: string, attendance: { studentId: string; present: boolean }[], auth: Auth): Promise<ActionDetail> {
  const a = await loadAction(id);
  if (!(canApprove(auth) || (await mayWork(auth, a)))) throw new MasteryWorkError("রুটিন অনুযায়ী এই শাখা ও বিষয়ের দায়িত্ব আপনার নয়।");
  if (a.status !== "APPROVED" || a.kind !== "EXTRA_CLASS") throw new MasteryWorkError("এই পদক্ষেপে ক্লাসের হিসাব নেওয়ার সময় নয়।");
  const planned = new Set((a.plan?.studentIds ?? []).map(String));
  const marked = new Map(attendance.filter((x) => planned.has(x.studentId)).map((x) => [x.studentId, x.present]));
  a.attendance = [...planned].map((sid) => ({ studentId: oid(sid), present: marked.get(sid) ?? false }));
  if (!a.attendance.some((x) => x.present)) throw new MasteryWorkError("অন্তত একজন উপস্থিত থাকলে ক্লাস হয়েছে ধরা হয়।");
  a.status = "IN_PROGRESS";
  a.events.push({ at: new Date(), kind: "HELD", by: byOf(auth), note: `${a.attendance.filter((x) => x.present).length}/${a.attendance.length}` });
  await a.save();
  void writeAudit({
    eventKind: "MASTERY_EXTRA_CLASS_HELD",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryAction",
    targetId: a._id,
    meta: { present: a.attendance.filter((x) => x.present).length, planned: a.attendance.length },
  });
  return actionDetail(id, auth);
}

/** The re-test: RETEST_QUESTIONS unseen gold questions on the outcome for each student who sits it. */
export async function buildRetest(id: string, auth: Auth): Promise<ActionDetail> {
  const a = await loadAction(id);
  if (!(canApprove(auth) || (await mayWork(auth, a)))) throw new MasteryWorkError("রুটিন অনুযায়ী এই শাখা ও বিষয়ের দায়িত্ব আপনার নয়।");
  const ready = (a.kind === "EXTRA_CLASS" && a.status === "IN_PROGRESS") || (a.kind === "RETEACH" && a.status === "APPROVED");
  if (!ready) throw new MasteryWorkError(a.kind === "EXTRA_CLASS" ? "আগে অতিরিক্ত ক্লাসের হিসাব দিন।" : "এই পদক্ষেপে রি-টেস্ট তৈরির সময় নয়।");
  const sitting =
    a.kind === "EXTRA_CLASS"
      ? a.attendance.filter((x) => x.present).map((x) => String(x.studentId))
      : (a.plan?.studentIds ?? []).map(String);
  const [outcome, marks, rows] = await Promise.all([
    MasteryOutcome.findOne({ code: a.loCode }).select("code chapterNumber questionTypeCodes").lean(),
    marksTable(a.classToken, a.subject),
    liveSectionRows(a.sectionId, a.subject, a.loCode),
  ]);
  if (!outcome) throw new MasteryWorkError("শিখনফল পাওয়া যায়নি।");
  const info = { code: outcome.code, chapterNumber: outcome.chapterNumber ?? null, questionTypeCodes: outcome.questionTypeCodes ?? [] };
  const qt = typeFor(info, { marksOf: marks, layout: { questionTypeCodes: [] } as never });
  if (!qt) throw new MasteryWorkError("এই শিখনফলের প্রশ্নের ধরনের নম্বর ঠিক করা নেই।");
  const bank = await goldBank([a.loCode]);
  const exposure = new Map<string, number>();
  for (const r of rows) if (r.qid) exposure.set(r.qid, (exposure.get(r.qid) ?? 0) + 1);

  type Item = { itemNo: number; origin: "BANK"; artifactId: Types.ObjectId; qid: string; loCodes: string[]; chapterNumber: number | null; questionTypeCode: string; marks: number };
  const items: Item[] = [];
  const noOf = new Map<string, number>();
  const perStudentItems: { studentId: Types.ObjectId; itemNos: number[] }[] = [];
  for (const sid of sitting) {
    const seen = new Set(rows.filter((r) => r.studentId === sid && r.qid).map((r) => r.qid as string));
    const mine: number[] = [];
    for (let k = 0; k < RETEST_QUESTIONS; k++) {
      const q = pickQuestion(a.loCode, seen, { bank, exposure });
      if (!q) break;
      seen.add(q.qid);
      exposure.set(q.qid, (exposure.get(q.qid) ?? 0) + 1);
      let no = noOf.get(q.qid);
      if (!no) {
        no = items.length + 1;
        items.push({ itemNo: no, origin: "BANK", artifactId: oid(q.artifactId), qid: q.qid, loCodes: [a.loCode], chapterNumber: info.chapterNumber, questionTypeCode: qt, marks: marks.get(qt)! });
        noOf.set(q.qid, no);
      }
      mine.push(no);
    }
    if (mine.length > 0) perStudentItems.push({ studentId: oid(sid), itemNos: mine });
  }
  if (perStudentItems.length === 0) throw new MasteryWorkError("ব্যাংকে এই শিক্ষার্থীদের জন্য নতুন গোল্ড প্রশ্ন নেই — শ্রেণি পরীক্ষা নিজে তৈরি করুন।");
  const paper = await MasteryPaper.create({
    paperId: await nextPaperId(a.classToken, a.subject),
    source: "RETEST",
    title: "রি-টেস্ট",
    sectionId: a.sectionId,
    classId: a.classId,
    academicYearId: a.academicYearId,
    classToken: a.classToken,
    subject: a.subject,
    date: a.plan?.retestDate ?? dayOf(ymd(new Date())!),
    links: { actionId: a._id },
    items,
    perStudentItems,
    rubricLoCodes: [],
    entryState: "OPEN",
    createdBy: byOf(auth),
  });
  a.retestPaperId = paper._id;
  a.status = "CHECKING";
  a.events.push({ at: new Date(), kind: "RETEST_BUILT", by: byOf(auth), note: paper.paperId });
  await a.save();
  void writeAudit({
    eventKind: "MASTERY_RETEST_BUILT",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryAction",
    targetId: a._id,
    meta: { paperId: paper.paperId, students: perStudentItems.length, skipped: sitting.length - perStudentItems.length },
  });
  return actionDetail(id, auth);
}

/** The app's suggestion: SUCCESS under the line with the targeted students ≥ 70 %; PARTIAL if anything moved. */
export function suggestOutcome(
  before: { weakPct: number | null; meanPct: number | null } | undefined,
  after: { weakPct: number | null; meanPct: number | null },
  triggerPct: number,
): MasteryActionOutcome {
  if (after.weakPct !== null && after.weakPct < triggerPct && (after.meanPct ?? 0) >= 70) return "SUCCESS";
  const better =
    (after.meanPct !== null && before?.meanPct !== null && before?.meanPct !== undefined && after.meanPct >= before.meanPct + 10) ||
    (after.weakPct !== null && before?.weakPct !== null && before?.weakPct !== undefined && after.weakPct < before.weakPct);
  return better ? "PARTIAL" : "NOT_RESOLVED";
}

async function afterNow(a: IMasteryAction): Promise<{ weakPct: number | null; meanPct: number | null; retestConfirmed: boolean; perStudent: Map<string, number> }> {
  const { summary } = await outcomeNow(a);
  const perStudent = new Map<string, number>();
  let confirmed = false;
  if (a.retestPaperId) {
    const p = await MasteryPaper.findById(a.retestPaperId).select("entryState").lean();
    confirmed = p?.entryState === "CONFIRMED";
    if (confirmed) {
      const ev = await MasteryEvidence.find({ paperId: a.retestPaperId, supersededAt: null, routed: false }).select("studentId earned available").lean();
      const acc = new Map<string, { e: number; v: number }>();
      for (const r of ev) {
        const x = acc.get(String(r.studentId)) ?? { e: 0, v: 0 };
        x.e += r.earned;
        x.v += r.available;
        acc.set(String(r.studentId), x);
      }
      for (const [sid, x] of acc) if (x.v > 0) perStudent.set(sid, Math.round((x.e / x.v) * 100));
    }
  }
  return { weakPct: summary.weakPct, meanPct: meanOf([...perStudent.values()]), retestConfirmed: confirmed, perStudent };
}

export async function closeAction(id: string, outcome: MasteryActionOutcome, note: string | null | undefined, auth: Auth): Promise<ActionDetail> {
  const a = await loadAction(id);
  if (!(canApprove(auth) || (await mayWork(auth, a)))) throw new MasteryWorkError("রুটিন অনুযায়ী এই শাখা ও বিষয়ের দায়িত্ব আপনার নয়।");
  if (!["APPROVED", "IN_PROGRESS", "CHECKING"].includes(a.status)) throw new MasteryWorkError("এই পদক্ষেপ এখন বন্ধ করা যায় না।");
  if (!["SUCCESS", "PARTIAL", "NOT_RESOLVED"].includes(outcome)) throw new MasteryWorkError("ফল বাছুন।");
  const after = await afterNow(a);
  if (a.status !== "CHECKING" || !after.retestConfirmed) {
    if (!(note ?? "").trim()) throw new MasteryWorkError("রি-টেস্টের ফল ছাড়া বন্ধ করতে কারণ লিখুন।");
  }
  a.after = { weakPct: after.weakPct, meanPct: after.meanPct };
  a.outcome = outcome;
  a.status = "CLOSED";
  a.closedAt = new Date();
  a.closedBy = byOf(auth);
  a.events.push({ at: a.closedAt, kind: "CLOSED", by: byOf(auth), note: (note ?? "").trim() || undefined });
  await a.save();
  void writeAudit({
    eventKind: "MASTERY_ACTION_CLOSED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryAction",
    targetId: a._id,
    meta: { outcome, before: a.before, after: a.after },
  });
  return actionDetail(id, auth);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface ActionStudent {
  studentId: string;
  name: string;
  rollNumber: string | null;
  stateNow: string;
  weakAtTrigger: boolean;
  inPlan: boolean;
  present: boolean | null;
  recentPct: number | null;
  retestPct: number | null;
}

export interface ActionDetail {
  id: string;
  sectionId: string;
  sectionName: string;
  className: string;
  subject: string;
  loCode: string;
  labelBn: string;
  kind: string;
  status: string;
  trigger: { at: string; weakPct: number; weak: number; verdicts: number; assessments: number };
  plan: {
    date: string | null;
    slotKind: string | null;
    periodNumber: number | null;
    teacherName: string | null;
    attendees: string;
    retestDate: string | null;
    note: string | null;
  } | null;
  students: ActionStudent[];
  retestPaperId: string | null;
  retestConfirmed: boolean;
  before: { weakPct: number | null; meanPct: number | null } | null;
  after: { weakPct: number | null; meanPct: number | null } | null;
  /** Live numbers now (for an open action) — what closing would record. */
  now: { weakPct: number | null; meanPct: number | null };
  suggestedOutcome: string | null;
  outcome: string | null;
  events: { at: string; kind: string; byName: string | null; note: string | null }[];
  canApprove: boolean;
  canWork: boolean;
}

async function namesOf(ids: (Types.ObjectId | undefined)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter(Boolean).map(String))].filter((x) => Types.ObjectId.isValid(x));
  if (list.length === 0) return new Map();
  const users = await User.find({ _id: { $in: list.map(oid) } }).select("name nameBn").lean();
  return new Map(users.map((u) => [String(u._id), personName(u as { name?: string; nameBn?: string })]));
}

export async function actionDetail(id: string, auth: Auth): Promise<ActionDetail> {
  const a = await loadAction(id);
  await assertCanSee(auth, a);
  const [label, outcome, roster, { per, summary, policy }, paper, names, work] = await Promise.all([
    sectionLabel(a.sectionId),
    MasteryOutcome.findOne({ code: a.loCode }).select("labelBn").lean(),
    rosterOf(a.sectionId),
    outcomeNow(a),
    a.retestPaperId ? MasteryPaper.findById(a.retestPaperId).select("paperId").lean() : null,
    namesOf([a.plan?.teacherId, ...a.events.map((e) => e.by), a.closedBy]),
    mayWork(auth, a),
  ]);
  const open = (OPEN as readonly string[]).includes(a.status);
  const after = await afterNow(a);
  const planned = new Set((a.plan?.studentIds ?? []).map(String));
  const weakAt = new Set(a.trigger.weakStudentIds.map(String));
  const present = new Map(a.attendance.map((x) => [String(x.studentId), x.present]));
  const nowNumbers = { weakPct: summary.weakPct, meanPct: after.meanPct };
  return {
    id: String(a._id),
    sectionId: String(a.sectionId),
    ...label,
    subject: a.subject,
    loCode: a.loCode,
    labelBn: outcome?.labelBn ?? a.loCode,
    kind: a.kind,
    status: a.status,
    trigger: { at: a.trigger.at.toISOString(), weakPct: a.trigger.weakPct, weak: a.trigger.weak, verdicts: a.trigger.verdicts, assessments: a.trigger.assessments },
    plan: a.plan?.attendees
      ? {
          date: ymd(a.plan.date),
          slotKind: a.plan.slotKind ?? null,
          periodNumber: a.plan.periodNumber ?? null,
          teacherName: a.plan.teacherId ? names.get(String(a.plan.teacherId)) ?? null : null,
          attendees: a.plan.attendees,
          retestDate: ymd(a.plan.retestDate),
          note: a.plan.note ?? null,
        }
      : null,
    students: roster.map((s) => {
      const sid = String(s._id);
      return {
        studentId: sid,
        name: personName(s),
        rollNumber: s.rollNumber ?? null,
        stateNow: per.get(sid)?.state ?? "NOT_ASSESSED",
        weakAtTrigger: weakAt.has(sid),
        inPlan: planned.has(sid),
        present: present.has(sid) ? (present.get(sid) as boolean) : null,
        recentPct: per.get(sid)?.recentPct !== undefined && per.get(sid)?.recentPct !== null ? Math.round(per.get(sid)!.recentPct as number) : null,
        retestPct: after.perStudent.get(sid) ?? null,
      };
    }),
    retestPaperId: paper?.paperId ?? null,
    retestConfirmed: after.retestConfirmed,
    // Recorded when the plan is made; Mongoose returns an empty subdocument before that.
    before: a.plan?.attendees && a.before ? { weakPct: a.before.weakPct ?? null, meanPct: a.before.meanPct ?? null } : null,
    after: a.after && a.status === "CLOSED" ? { weakPct: a.after.weakPct ?? null, meanPct: a.after.meanPct ?? null } : null,
    now: nowNumbers,
    suggestedOutcome: open && a.status !== "PROPOSED" ? suggestOutcome(a.before, nowNumbers, policy.sectionTriggerPct) : null,
    outcome: a.outcome ?? null,
    events: a.events.map((e) => ({ at: e.at.toISOString(), kind: e.kind, byName: e.by ? names.get(String(e.by)) ?? null : null, note: e.note ?? null })),
    canApprove: canApprove(auth),
    canWork: work,
  };
}

export interface ActionSummary {
  id: string;
  sectionId: string;
  sectionName: string;
  className: string;
  subject: string;
  loCode: string;
  labelBn: string;
  kind: string;
  status: string;
  weakPct: number;
  weak: number;
  verdicts: number;
  assessments: number;
  planDate: string | null;
  retestDate: string | null;
  outcome: string | null;
  createdAt: string;
}

export type ActionFilter = "OPEN" | "PROPOSED" | "RUNNING" | "CLOSED" | "ALL";

export async function actionsPage(
  filter: ActionFilter,
  where: { sectionId?: string | null; subject?: MasterySubject | null },
  args: PageArgs,
  auth: Auth,
): Promise<Page<ActionSummary>> {
  const q: Record<string, unknown> = {};
  if (where.sectionId) {
    const ctx = await sectionContext(where.sectionId);
    q.sectionId = ctx.sectionId;
    if (where.subject) q.subject = where.subject;
    if (!canApprove(auth)) {
      if (!where.subject) throw new MasteryWorkError("বিষয় বাছুন।");
      await assertMayWork(auth, ctx.sectionId, where.subject, new Date());
    }
  } else if (!canApprove(auth)) {
    throw new MasteryWorkError("পুরো স্কুলের পদক্ষেপ দেখার অনুমতি আপনার নেই।");
  }
  if (filter === "OPEN") q.status = { $in: OPEN };
  else if (filter === "PROPOSED") q.status = "PROPOSED";
  else if (filter === "RUNNING") q.status = { $in: ["APPROVED", "IN_PROGRESS", "CHECKING"] };
  else if (filter === "CLOSED") q.status = { $in: ["CLOSED", "REJECTED"] };
  return queryPage(MasteryAction, q, { createdAt: -1, _id: -1 }, args, async (docs) => {
    const list = docs as unknown as IMasteryAction[];
    const [labels, outcomes] = await Promise.all([
      Promise.all([...new Set(list.map((d) => String(d.sectionId)))].map(async (sid) => [sid, await sectionLabel(oid(sid))] as const)).then((x) => new Map(x)),
      MasteryOutcome.find({ code: { $in: [...new Set(list.map((d) => d.loCode))] } }).select("code labelBn").lean().then((x) => new Map(x.map((o) => [o.code, o.labelBn]))),
    ]);
    return list.map((d) => ({
      id: String(d._id),
      sectionId: String(d.sectionId),
      sectionName: labels.get(String(d.sectionId))?.sectionName ?? "",
      className: labels.get(String(d.sectionId))?.className ?? "",
      subject: d.subject,
      loCode: d.loCode,
      labelBn: outcomes.get(d.loCode) ?? d.loCode,
      kind: d.kind,
      status: d.status,
      weakPct: d.trigger.weakPct,
      weak: d.trigger.weak,
      verdicts: d.trigger.verdicts,
      assessments: d.trigger.assessments,
      planDate: ymd(d.plan?.date),
      retestDate: ymd(d.plan?.retestDate),
      outcome: d.outcome ?? null,
      createdAt: d.createdAt.toISOString(),
    }));
  });
}

/** The leader dashboard's four numbers (approvers only). */
export async function actionCounts(auth: Auth): Promise<{ proposed: number; running: number; retestThisWeek: number; closed30: number }> {
  if (!canApprove(auth)) throw new MasteryWorkError("পুরো স্কুলের পদক্ষেপ দেখার অনুমতি আপনার নেই।");
  const now = Date.now();
  const [proposed, running, retestThisWeek, closed30] = await Promise.all([
    MasteryAction.countDocuments({ status: "PROPOSED" }),
    MasteryAction.countDocuments({ status: { $in: ["APPROVED", "IN_PROGRESS", "CHECKING"] } }),
    MasteryAction.countDocuments({ status: { $in: ["APPROVED", "IN_PROGRESS", "CHECKING"] }, "plan.retestDate": { $lte: new Date(now + 7 * DAY) } }),
    MasteryAction.countDocuments({ status: "CLOSED", closedAt: { $gte: new Date(now - 30 * DAY) } }),
  ]);
  return { proposed, running, retestThisWeek, closed30 };
}

/** Open (or latest) action per outcome for a section × subject — the heat-map's link. */
export async function openActionsFor(sectionId: Types.ObjectId, subject: MasterySubject): Promise<Map<string, { id: string; status: string }>> {
  const rows = await MasteryAction.find({ sectionId, subject, status: { $in: OPEN } }).select("loCode status").lean();
  return new Map(rows.map((r) => [r.loCode, { id: String(r._id), status: r.status }]));
}
