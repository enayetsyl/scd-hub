/**
 * AssignmentSuggestionService — AL-7 of the 2027 academic loop (docs/prd-academic-loop-2027.md §4, D-#1668): the weekly
 * assignment suggestion engine wired to the tailored `MasteryAssignment`.
 *
 *   buildSuggestedDraft      one DRAFT per শাখা × subject from `suggestion.ts` (never touches a finalised one; a rebuild keeps
 *                            the sheets a teacher edited)
 *   suggestAssignment        "প্রস্তাব দিন": build (or, after the confirm dialog, rebuild) for the caller's subject(s)
 *   assignmentSuggestionWeek the week's rotation subjects, each draft's state, the swap card, the day plan
 *   acceptAssignmentSwap     the swap card (class teacher / Office, R29)
 *   assignmentLoad           the per-child weekly load (AC-C10)
 *   runAsDraft / asDraftReady  the \`ASDRAFT\` scheduler family (lead days, pauses, Class 1–5 only, idempotent)
 *
 * Everything here runs only with \`academicLoop2027On\` (§3.6): the callers read the switch, so with it off a 2026 flow is
 * byte-for-byte unchanged. Nursery / KG have no weekly assignment (R25, AC-C15).
 */
import { Types } from "mongoose";
import { HW_SUBJECTS, HW_SUBJECT_LABELS_BN, callerHasPermission } from "@scd/shared";
import type { MasterySubject } from "@scd/shared";
import { MasteryAssignment, type IMasteryAssignment, type MasteryAssignmentQuestion } from "../models/MasteryAssignment";
import { MasteryAssignmentSheet } from "../models/MasteryAssignmentSheet";
import { MasteryPaper } from "../models/MasteryPaper";
import { AssignmentItem } from "../../trackers/models/AssignmentItem";
import { HomeworkItem } from "../../trackers/models/HomeworkItem";
import { AssignmentSchedule } from "../../trackers/models/AssignmentSchedule";
import { atMidnight, weekNumberFor } from "../../trackers/assignmentCalendar";
import { declareNoAssignment, expectedItemsForWeek, loadOpenDayPredicate, type ExpectedItem, type ExpectedWeek } from "../../trackers/services/AssignmentScheduleService";
import { resolveSubjectTeacher } from "../../trackers/subjectTeacher";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { isClassTeacher } from "../../../middleware/authz";
import { isPausedOn } from "../../academic-pause/services/AcademicPauseService";
import { Audit } from "../../platform/models/Audit";
import { StudentAttendanceDay } from "../../attendance/models/StudentAttendanceDay";
import { resolveUnitsForIds } from "../../attendance/attendanceUnit";
import { deliverSystemAssignmentItem } from "../../trackers/services/AssignmentService";
import { emit } from "../../notifications/services/NotificationService";
import { holderIdsOf } from "../../access-control/services/holders";
import { writeAudit } from "../../platform/services/AuditService";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { personName } from "../../../lib/personName";
import { reportSilentFailure } from "../../../lib/reportError";
import { expandSections, avoidFor, isLoop2027On } from "../../assessment/services/QuestionUseService";
import { sectionObjectiveRows } from "../../lesson-progress/services/ObjectiveLessonService";
import { getPolicy, isMasteryEnabled } from "./MasteryCatalogueService";
import { MasteryWorkError, assertMayWork, dayOf, rosterOf, sectionContext, type Auth, type SectionCtx } from "./MasteryWorkService";
import { computeSection, lockedOutcomes, sectionLabel } from "./MasteryDiagnosisService";
import { assignmentView, goldBank, liveRowsWithMerges, marksTable, openExtraSeenWithMerges, startingLayout, type AssignmentView } from "./MasteryAssignmentService";
import { isTodaySubstituteFor } from "./HomeworkPaperService";
import { VERDICT_STATES } from "../diagnosis";
import { isoWeekKey } from "../evidence";
import { isTaggedRow } from "../rollup";
import { MasteryQuestionType } from "../models/MasteryQuestionType";
import {
  budgetPolicy,
  countedMinutes,
  dayCapMinutes,
  hasAssignmentBudget,
  loadsOf,
  weekBudgetMinutes,
  type BudgetPolicy,
  type DoOnDay,
} from "../assignmentBudget";
import {
  childLoad,
  draftDayOf,
  extraHomeworkDays,
  planDays,
  shareMarks,
  splitSubjectMarks,
  suggest,
  swapCard,
  type ChildLoad,
  type SubjectLoad,
  type SubjectWeak,
  type SuggestChild,
  type SuggestInput,
  type SwapCard,
  type TaughtChapter,
} from "../suggestion";
import type { OutcomeInfo, StudentOutcomeState } from "../assignmentBuilder";

const oid = (s: string | Types.ObjectId) => new Types.ObjectId(String(s));
const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const sumMarks = (xs: { marks: number }[]) => xs.reduce((s, x) => s + x.marks, 0);
const subjectBn = (s: string): string => (HW_SUBJECT_LABELS_BN as Record<string, string>)[s] ?? s;

/** The system's actor on an engine-built draft (the all-zero never-a-user sentinel, as the D-#839 sweep uses). */
export const AS_DRAFT_ACTOR_ID = "000000000000000000000000";

export const NOT_ON = "এই সুবিধা এখনো চালু হয়নি।";
export const NO_ASSIGNMENT_FOR_SMALL = "নার্সারি ও কেজি-তে সাপ্তাহিক অ্যাসাইনমেন্ট নেই।";
export const FINALISED_MESSAGE = "এই অ্যাসাইনমেন্ট চূড়ান্ত হয়ে গেছে — আর বদলানো যায় না।";
const MANUAL_MESSAGE = "এই বিষয়ে শিখন-দক্ষতা চালু নেই — নিজে তৈরি করুন।";
const NO_TREE_MESSAGE = "এই শ্রেণি-বিষয়ের শিখনফল তালিকা এখনো চূড়ান্ত হয়নি — নিজে তৈরি করুন।";

const localDay = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
const keyOfLocal = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Lesson facts: what was taught (recency) and who missed what
// ---------------------------------------------------------------------------

export interface LessonFacts {
  chapters: TaughtChapter[];
  taughtCodes: Set<string>;
  /** studentId → the objectives taught on a day they were absent. */
  missedBy: Map<string, { loCode: string; missedOn: string }[]>;
}

/**
 * The classes the শাখা (and, merged, its source শাখা — §3.7) had: chapters with the last day a session of them was marked
 * taught, the taught objectives, and the children absent on a day an objective was taught (D-#950). Chapters come from the
 * class notes' lesson marks, never from anything a teacher ticks (R2).
 */
export async function lessonFactsOf(sectionId: Types.ObjectId, subject: string, outcomes: Map<string, OutcomeInfo>): Promise<LessonFacts> {
  const out: LessonFacts = { chapters: [], taughtCodes: new Set(), missedBy: new Map() };
  const sections = await expandSections([sectionId]);
  const last = new Map<number, string>();
  for (const sid of sections) {
    let rows: Awaited<ReturnType<typeof sectionObjectiveRows>> = [];
    try {
      rows = await sectionObjectiveRows(String(sid), subject);
    } catch {
      continue; // a source শাখা with no class level — nothing to read
    }
    for (const r of rows) {
      const info = outcomes.get(r.code);
      if (!info || r.taught.length === 0) continue;
      out.taughtCodes.add(r.code);
      if (info.chapterNumber !== null) {
        const day = r.taught[r.taught.length - 1]!.dateKey;
        if (!last.has(info.chapterNumber) || last.get(info.chapterNumber)! < day) last.set(info.chapterNumber, day);
      }
      for (const t of r.taught) {
        for (const ab of t.absent) {
          out.missedBy.set(ab.studentId, [...(out.missedBy.get(ab.studentId) ?? []), { loCode: r.code, missedOn: t.dateKey }]);
        }
      }
    }
  }
  out.chapters = [...last.entries()].map(([chapterNumber, lastTaughtDay]) => ({ chapterNumber, lastTaughtDay })).sort((a, b) => a.chapterNumber - b.chapterNumber);
  return out;
}

// ---------------------------------------------------------------------------
// Build one draft
// ---------------------------------------------------------------------------

export type DraftState = "CREATED" | "REBUILT" | "EXISTS" | "FINALISED" | "MANUAL";

export interface BuildDraftInput {
  sectionId: string;
  subject: MasterySubject;
  /** The due day (YYYY-MM-DD) whose ISO week is the assignment's week. */
  dueYmd: string;
  /** Subjects in this শাখা's week (rotation cells that are not "no assignment"): the budget share = week ÷ this. */
  nSubjects: number;
  builtBy: "ENGINE" | "TEACHER";
  /** The user who asked (the zero sentinel for the scheduler). */
  actorId: string;
  /** Replace an existing DRAFT (sheets a teacher edited are kept). */
  rebuild?: boolean;
  /** AL-7 (§4.5): this draft is a swapped-in subject — ASDRAFT, the swap card and the system delivery recognise it. */
  swap?: { drop: string; add: string };
}

export interface BuildDraftResult {
  state: DraftState;
  assignment: IMasteryAssignment | null;
  /** NEEDS_REVIEW child names (empty unless built now). */
  needsReview: string[];
  /** No class note marked a session taught: Part A is empty. */
  noLessonMarks: boolean;
}

/** One class × subject's tagged QUESTION objectives as the builder wants them. */
async function questionOutcomes(ctx: SectionCtx, subject: MasterySubject) {
  const rows = (await lockedOutcomes(ctx.classToken, subject)).filter((o) => o.assess === "QUESTION" && isTaggedRow(o));
  const outcomes = new Map<string, OutcomeInfo>(rows.map((o) => [o.code, { code: o.code, chapterNumber: o.chapterNumber ?? null, questionTypeCodes: o.questionTypeCodes ?? [] }]));
  const labels = new Map(rows.map((o) => [o.code, o.labelBn]));
  return { outcomes, labels };
}

export async function buildSuggestedDraft(input: BuildDraftInput): Promise<BuildDraftResult> {
  const ctx = await sectionContext(input.sectionId);
  if (!hasAssignmentBudget(ctx.classToken)) throw new MasteryWorkError(NO_ASSIGNMENT_FOR_SMALL);
  if (!(await isMasteryEnabled(ctx.academicYearId, ctx.classToken, input.subject))) return { state: "MANUAL", assignment: null, needsReview: [], noLessonMarks: false };
  const due = dayOf(input.dueYmd);
  const week = isoWeekKey(due);
  const existing = await MasteryAssignment.findOne({ sectionId: ctx.sectionId, subject: input.subject, week });
  if (existing && existing.status !== "DRAFT") return { state: "FINALISED", assignment: existing, needsReview: [], noLessonMarks: false };
  if (existing && !input.rebuild) return { state: "EXISTS", assignment: existing, needsReview: [], noLessonMarks: Boolean(existing.suggestion?.inputs?.noLessonMarks) };

  const { outcomes, labels } = await questionOutcomes(ctx, input.subject);
  if (outcomes.size === 0) throw new MasteryWorkError(NO_TREE_MESSAGE);

  const now = new Date();
  const [marks, rows, policy, roster, bp, extraSeen, unmarked, base] = await Promise.all([
    marksTable(ctx.classToken, input.subject),
    liveRowsWithMerges(ctx.sectionId, input.subject), // a merged শাখা also reads its source শাখা (AC-U2)
    getPolicy(ctx.classToken, input.subject),
    rosterOf(ctx.sectionId),
    budgetPolicy(),
    openExtraSeenWithMerges(ctx.sectionId, input.subject),
    MasteryQuestionType.find({ classToken: ctx.classToken, subject: input.subject, active: true, marks: null }).select("code").lean(),
    startingLayout(ctx.sectionId, input.subject, ctx.classToken),
  ]);
  const p = policy.resolved;
  const sec = computeSection(rows, p, now);
  const studentIds = roster.map((s) => String(s._id));
  const [bank, ledger, lessons] = await Promise.all([
    goldBank([...outcomes.keys()]),
    avoidFor({ sectionId: ctx.sectionId, academicYearId: ctx.academicYearId, classToken: ctx.classToken, subject: input.subject, studentIds }),
    lessonFactsOf(ctx.sectionId, input.subject, outcomes),
  ]);

  // Who has seen what (evidence): the শাখা-wide set, and how many children saw each question.
  const seenBy = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.qid || r.routed) continue;
    const s = seenBy.get(r.qid) ?? new Set<string>();
    s.add(r.studentId);
    seenBy.set(r.qid, s);
  }
  const openExtra = new Set([...extraSeen.values()].flatMap((q) => [...q]));
  const sectionWeak = new Map<string, { weak: number; improving: number; assessed: number }>();
  for (const [lo, per] of sec.states) {
    if (!outcomes.has(lo)) continue;
    let weak = 0;
    let improving = 0;
    for (const s of per.values()) {
      if (s.state === "WEAK") weak++;
      else if (s.state === "IMPROVING") improving++;
    }
    sectionWeak.set(lo, { weak, improving, assessed: sec.assessments.get(lo) ?? 0 });
  }
  const children: SuggestChild[] = roster.map((st) => {
    const sid = String(st._id);
    const states = new Map<string, StudentOutcomeState>();
    for (const [lo, per] of sec.states) {
      const s = per.get(sid);
      if (!s || !outcomes.has(lo)) continue;
      states.set(lo, { state: s.state, lastEvidenceAt: s.lastEvidenceAt, seenQids: extraSeen.has(sid) ? [...new Set([...s.seenQids, ...extraSeen.get(sid)!])] : s.seenQids });
    }
    return { studentId: sid, states, missed: lessons.missedBy.get(sid) ?? [], avoid: ledger.forChild(sid) };
  });

  // The subject's share of the week (§4.4): marks = floor(share ÷ minutesPerMark), split Part A : Part B in the layout's ratio.
  const total = shareMarks(weekBudgetMinutes(bp), Math.max(1, input.nSubjects), bp);
  const split = splitSubjectMarks(total, base.partAOn, base.partAMarks, base.partBMarks);
  const input2: SuggestInput = {
    seed: `${String(ctx.sectionId)}|${week}|${input.subject}`,
    today: dhakaDayKey(now),
    policy: {
      recentWeeks: p.suggestRecentWeeks,
      recentWeight: p.suggestRecentWeight,
      revisionPct: p.suggestRevisionPct,
      missedEasyQuestions: p.suggestMissedEasyQuestions,
      missedObjectivesPerWeek: p.suggestMissedObjectivesPerWeek,
    },
    partAMarks: split.partA,
    partBMarks: split.partB,
    layout: { questionTypeCodes: base.questionTypeCodes ?? [], mixWeak: base.mixWeak, mixImproving: base.mixImproving, mixRevision: base.mixRevision },
    outcomes,
    labels,
    taughtChapters: lessons.chapters,
    taughtCodes: new Set([...lessons.taughtCodes, ...sec.states.keys()]),
    sectionWeak,
    children,
    bank,
    marksOf: marks,
    unmarkedTypes: new Set(unmarked.map((t) => t.code)),
    exposure: new Map([...seenBy].map(([q, s]) => [q, s.size])),
    seenBySection: new Set([...seenBy.keys()]),
    openExtra,
    ledger: { hwYear: ledger.homeworkYear, window: ledger.windowQids, lastOn: ledger.lastOn },
  };
  const out = suggest(input2);

  // Persist: the assignment, then each child's sheet (an edited sheet survives a rebuild — the teacher's own changes).
  const by = oid(input.actorId);
  const a =
    existing ??
    new MasteryAssignment({ sectionId: ctx.sectionId, classId: ctx.classId, academicYearId: ctx.academicYearId, classToken: ctx.classToken, subject: input.subject, status: "DRAFT", builtBy: by, rememberLayout: false });
  const totalMarks = split.partA + split.partB;
  a.dueDate = due;
  a.week = week;
  a.layout = {
    totalMarks: Math.max(1, totalMarks),
    minutes: Math.max(1, Math.min(300, Math.round(totalMarks * bp.minutesPerMark))),
    partAOn: split.partA > 0,
    partAMarks: split.partA,
    partALoCodes: [],
    partBMarks: split.partB,
    mixWeak: base.mixWeak,
    mixImproving: base.mixImproving,
    mixRevision: base.mixRevision,
    questionTypeCodes: base.questionTypeCodes ?? [],
  };
  const toDoc = (q: (typeof out.partA)[number]): MasteryAssignmentQuestion => ({
    origin: q.origin, artifactId: oid(q.artifactId), qid: q.qid, textBn: q.textBn ?? undefined, loCode: q.loCode, chapterNumber: q.chapterNumber,
    questionTypeCode: q.questionTypeCode, marks: q.marks, band: q.band, reasonBn: q.reasonBn, repeat: q.repeat,
    ...(q.stimulusRef ? { stimulusRef: q.stimulusRef } : {}),
  });
  a.partA = out.partA.map(toDoc);
  a.builtAt = now;
  a.builtBy = by;
  const reasons: NonNullable<IMasteryAssignment["suggestion"]>["reasons"] = out.partA.map((q) => ({ studentId: null, qid: q.qid, loCode: q.loCode, reasonBn: q.reasonBn, repeat: q.repeat }));
  const keep = new Map((await MasteryAssignmentSheet.find({ assignmentId: a._id }).lean()).map((s) => [String(s.studentId), s]));
  const stillThere = new Set(studentIds);
  const needsReview: string[] = [];
  const names = new Map(roster.map((st) => [String(st._id), personName(st)]));
  // Save the assignment first (the sheets key on its id).
  a.suggestion = {
    builtBy: input.builtBy,
    at: now,
    inputs: { chapters: out.chaptersUsed, weakCounts: out.weakCounts, excluded: out.excluded, noLessonMarks: out.noLessonMarks },
    reasons: [],
    ...(existing?.suggestion?.editedAt ? { editedAt: existing.suggestion.editedAt } : {}),
    ...((input.swap ?? existing?.suggestion?.swap) ? { swap: (input.swap ?? existing?.suggestion?.swap)! } : {}),
  };
  await a.save();
  for (const sh of out.sheets) {
    const prior = keep.get(sh.studentId);
    if (prior?.edited) {
      for (const q of prior.items) reasons.push({ studentId: sh.studentId, qid: q.qid ?? null, loCode: q.loCode, reasonBn: q.reasonBn ?? "শিক্ষকের বদলানো প্রশ্ন", repeat: Boolean(q.repeat) });
      if (prior.status === "NEEDS_REVIEW") needsReview.push(names.get(sh.studentId) ?? "");
      continue;
    }
    for (const q of sh.items) reasons.push({ studentId: sh.studentId, qid: q.qid, loCode: q.loCode, reasonBn: q.reasonBn, repeat: q.repeat });
    if (sh.status === "NEEDS_REVIEW") needsReview.push(names.get(sh.studentId) ?? "");
    await MasteryAssignmentSheet.updateOne(
      { assignmentId: a._id, studentId: oid(sh.studentId) },
      { $set: { items: sh.items.map(toDoc), warnings: sh.warnings, status: sh.status, edited: false }, $unset: { approvedBy: 1 } },
      { upsert: true },
    );
  }
  // A child who left the roster takes their sheet with them.
  for (const sid of keep.keys()) if (!stillThere.has(sid)) await MasteryAssignmentSheet.deleteOne({ assignmentId: a._id, studentId: oid(sid) });
  a.suggestion.reasons = reasons;
  a.markModified("suggestion");
  await a.save();
  // The persistent marker per (week, শাখা, subject): ASDRAFT never re-creates a draft a teacher deleted (restart / next tick).
  await writeAudit({
    eventKind: "MASTERY_ASSIGNMENT_BUILT",
    actorId: input.actorId,
    targetKind: "MasteryAssignment",
    targetId: a._id,
    meta: { sectionId: input.sectionId, subject: input.subject, week, students: roster.length, partA: out.partA.length, engine: true, builtBy: input.builtBy, rebuilt: Boolean(existing) },
  });
  return { state: existing ? "REBUILT" : "CREATED", assignment: a, needsReview: needsReview.filter(Boolean), noLessonMarks: out.noLessonMarks };
}

// ---------------------------------------------------------------------------
// The week: rotation cells, drafts, swap card, day plan
// ---------------------------------------------------------------------------

/** The week whose due day is `dueYmd` (the due Sunday falls in the NEXT calendar week of its Thursday delivery, so look around). */
export async function weekForDue(academicYearId: Types.ObjectId | string, dueYmd: string): Promise<ExpectedWeek | null> {
  const schedule = await AssignmentSchedule.findOne({ academicYearId: oid(academicYearId) });
  if (!schedule) return null;
  const w0 = weekNumberFor(schedule.termStartDate, localDay(dueYmd));
  for (const w of [w0, w0 - 1, w0 + 1]) {
    if (w < 1 || w > 53) continue;
    const week = await expectedItemsForWeek(String(academicYearId), w).catch(() => null);
    if (week && !week.suspended && week.dueDate && week.dueDate.slice(0, 10) === dueYmd) return week;
  }
  return null;
}

const cellsOf = (week: ExpectedWeek | null, sectionId: string): ExpectedItem[] => (week?.items ?? []).filter((i) => i.sectionId === sectionId && i.classLevel >= 1);

export interface SubjectWeakStats extends SubjectWeak {
  subject: string;
}

/** A শাখা × subject's WEAK child × objective rows and rows with a verdict (the swap card reads these). */
export async function subjectWeakStats(ctx: SectionCtx, subject: MasterySubject): Promise<SubjectWeak> {
  const [rows, policy] = await Promise.all([liveRowsWithMerges(ctx.sectionId, subject), getPolicy(ctx.classToken, subject)]);
  const sec = computeSection(rows, policy.resolved, new Date());
  let weak = 0;
  let verdict = 0;
  for (const per of sec.states.values()) {
    for (const s of per.values()) {
      if (s.state === "WEAK") weak++;
      if ((VERDICT_STATES as readonly string[]).includes(s.state)) verdict++;
    }
  }
  return { subject, weakRows: weak, verdictRows: verdict };
}

/** The swap card of a শাখা's week (§4.5), or null. Expired once the delivery day has passed (AC-C6). */
export async function swapCardFor(ctx: SectionCtx, week: ExpectedWeek, rotationDrafts: Map<string, IMasteryAssignment | null>, today: string): Promise<SwapCard | null> {
  if (week.suspended || !week.deliveryDate || today > week.deliveryDate.slice(0, 10)) return null;
  // One swap a week: once a subject was swapped in, the swapped-in draft is part of the week and no second card is offered.
  if ([...rotationDrafts.values()].some((d) => d?.suggestion?.swap)) return null;
  const cells = cellsOf(week, String(ctx.sectionId));
  const inRotation = new Set(cells.map((c) => c.subject as string));
  const policy = (await getPolicy(null, null)).resolved;
  const rotation: SubjectWeak[] = [];
  for (const c of cells) {
    if (c.nilDeclared || !(await isMasteryEnabled(ctx.academicYearId, ctx.classToken, c.subject as MasterySubject))) continue;
    const st = await subjectWeakStats(ctx, c.subject as MasterySubject);
    rotation.push({ ...st, finalised: rotationDrafts.get(c.subject)?.status === "SENT" || c.delivered });
  }
  if (rotation.length === 0) return null;
  const others: SubjectWeak[] = [];
  for (const s of HW_SUBJECTS) {
    if (inRotation.has(s) || !(await isMasteryEnabled(ctx.academicYearId, ctx.classToken, s as MasterySubject))) continue;
    others.push(await subjectWeakStats(ctx, s as MasterySubject));
  }
  return swapCard(rotation, others, policy.swapSuggestWeakPct);
}

export interface SuggestionSubjectView {
  subject: string;
  subjectBn: string;
  teacherId: string | null;
  teacherName: string | null;
  /** MANUAL = mastery off ("নিজে তৈরি করুন"), NIL = "no assignment this week", DELIVERED = the tracker item was delivered without a draft. */
  state: "NONE" | "DRAFT" | "SENT" | "MANUAL" | "NIL" | "DELIVERED";
  assignmentId: string | null;
  builtBy: string | null;
  edited: boolean;
  needsReviewCount: number;
  /** The counted minutes (finalised) or the draft's estimate. */
  minutes: number | null;
  doOnDay: DoOnDay | null;
  noLessonMarks: boolean;
  /** When there are no lesson marks: the chapters the teacher can choose (chapter number + objectives). */
  chapterChoices: { chapterNumber: number; objectives: number }[];
  /** The subject is in the rotation (false = swapped in). */
  inRotation: boolean;
}

export interface SuggestionWeekView {
  week: string;
  dueDate: string;
  deliveryDate: string | null;
  weekNumber: number | null;
  /** False for Nursery / KG, a suspended week, or no rotation for the due day. */
  hasWeek: boolean;
  suspended: boolean;
  subjects: SuggestionSubjectView[];
  swapCard: (SwapCard & { dropSubjectBn: string; addSubjectBn: string }) | null;
  /** The caller may accept the swap card (the শাখা's class teacher or the Office). */
  canAcceptSwap: boolean;
  /** Planned minutes on Friday / Saturday (finalised placement, else the draft's planned split). */
  dayPlan: { FRI: number; SAT: number; overBy: number; dayCap: number };
}

const teacherNames = async (ids: string[]): Promise<Map<string, string>> => {
  const valid = [...new Set(ids)].filter((i) => Types.ObjectId.isValid(i));
  if (valid.length === 0) return new Map();
  const users = await User.find({ _id: { $in: valid.map(oid) } }).select("name nameBn").lean();
  return new Map(users.map((u) => [String(u._id), personName(u)]));
};

/** Who may read a শাখা's week and load (§4.4): every subject teacher of the week, the class teacher, today's substitute, Office / Principal. */
export async function assertWeekReader(auth: Auth, sectionId: Types.ObjectId, cells: ExpectedItem[]): Promise<void> {
  if (callerHasPermission(auth, "assignment:view_all") || callerHasPermission(auth, "mastery:edit_all")) return;
  const sec = await Section.findById(sectionId).select("classTeacherId").lean();
  if (isClassTeacher(sec?.classTeacherId ? String(sec.classTeacherId) : null, String(auth.userId))) return;
  if (cells.some((c) => c.teacherId === String(auth.userId) || c.scheduledTeacherId === String(auth.userId))) return;
  for (const c of cells) if (await isTodaySubstituteFor(String(auth.userId), sectionId, c.subject)) return;
  throw new MasteryWorkError("এই শাখার সাপ্তাহিক অ্যাসাইনমেন্ট শুধু এই সপ্তাহের বিষয়শিক্ষক, ক্লাস শিক্ষক ও অফিস দেখতে পারেন।");
}

/**
 * AL-8 (§4.4 reach): may this caller READ one weekly assignment? Everyone `assertWeekReader` admits for the week — the class
 * teacher, a rotation-cell teacher, today's substitute, the Office / Principal — plus the subject's own teacher (a swapped-in
 * subject has no rotation cell). Reading is not editing: the edit mutations keep their own row rule.
 */
export async function canReadAssignment(a: IMasteryAssignment, auth: Auth): Promise<boolean> {
  if (callerHasPermission(auth, "assignment:comment") || callerHasPermission(auth, "assignment:view_all") || callerHasPermission(auth, "mastery:edit_all")) return true;
  try {
    await assertMayWork(auth, a.sectionId, a.subject as MasterySubject, new Date());
    return true;
  } catch {
    /* fall through to the week's readers */
  }
  try {
    const ctx = await sectionContext(String(a.sectionId));
    const week = await weekForDue(ctx.academicYearId, a.dueDate.toISOString().slice(0, 10));
    await assertWeekReader(auth, ctx.sectionId, cellsOf(week, String(ctx.sectionId)));
    return true;
  } catch {
    return false;
  }
}

async function mayAcceptSwap(auth: Auth, sectionId: Types.ObjectId): Promise<boolean> {
  if (callerHasPermission(auth, "assignment:view_all")) return true; // the Office (reach), R29
  const sec = await Section.findById(sectionId).select("classTeacherId").lean();
  return isClassTeacher(sec?.classTeacherId ? String(sec.classTeacherId) : null, String(auth.userId));
}

export async function assignmentSuggestionWeek(sectionId: string, dueYmd: string, auth: Auth): Promise<SuggestionWeekView> {
  const ctx = await sectionContext(sectionId);
  const due = dayOf(dueYmd);
  const empty = (suspended: boolean, bp: BudgetPolicy): SuggestionWeekView => ({
    week: isoWeekKey(due), dueDate: dueYmd, deliveryDate: null, weekNumber: null, hasWeek: false, suspended, subjects: [], swapCard: null, canAcceptSwap: false,
    dayPlan: { FRI: 0, SAT: 0, overBy: 0, dayCap: dayCapMinutes(bp) },
  });
  const bp = await budgetPolicy();
  // Switch OFF (or Nursery / KG): the empty shape — no swap card, no rotation read (AC-R1, AC-C15).
  if (!hasAssignmentBudget(ctx.classToken) || !(await isLoop2027On())) return empty(false, bp);
  const week = await weekForDue(ctx.academicYearId, dueYmd);
  const cells = cellsOf(week, String(ctx.sectionId));
  await assertWeekReader(auth, ctx.sectionId, cells);
  if (!week) return empty(false, bp);
  const isoWeek = isoWeekKey(due);
  const drafts = await MasteryAssignment.find({ sectionId: ctx.sectionId, week: isoWeek });
  const bySubject = new Map(drafts.map((d) => [d.subject as string, d]));
  const sheets = await MasteryAssignmentSheet.find({ assignmentId: { $in: drafts.map((d) => d._id) } }).select("assignmentId status edited items.marks").lean();
  const teachers = await teacherNames(cells.map((c) => c.teacherId));
  const subjects: SuggestionSubjectView[] = [];
  const planned: { subject: string; minutes: number }[] = [];
  const estimates = new Map<string, number>();
  const outcomesBySubject = new Map<string, Awaited<ReturnType<typeof questionOutcomes>>>();

  const subjectList = [...cells.map((c) => ({ subject: c.subject as string, cell: c as ExpectedItem | null })), ...drafts.filter((d) => !cells.some((c) => c.subject === d.subject)).map((d) => ({ subject: d.subject as string, cell: null }))];
  for (const { subject, cell } of subjectList) {
    const a = bySubject.get(subject) ?? null;
    const mine = a ? sheets.filter((s) => String(s.assignmentId) === String(a._id)) : [];
    const enabled = await isMasteryEnabled(ctx.academicYearId, ctx.classToken, subject as MasterySubject);
    let minutes: number | null = null;
    if (a) {
      minutes = typeof a.countedMinutes === "number" ? a.countedMinutes : countedMinutes(sumMarks(a.partA ?? []), mine.map((s) => sumMarks(s.items)), bp);
      estimates.set(subject, minutes);
      if (a.status !== "SENT") planned.push({ subject, minutes });
    }
    let state: SuggestionSubjectView["state"] = "NONE";
    if (a) state = a.status === "SENT" ? "SENT" : "DRAFT";
    else if (cell?.nilDeclared) state = "NIL";
    else if (!enabled) state = "MANUAL";
    else if (cell?.delivered) state = "DELIVERED";
    let chapterChoices: SuggestionSubjectView["chapterChoices"] = [];
    const noLessonMarks = Boolean(a?.suggestion?.inputs?.noLessonMarks);
    if (noLessonMarks) {
      const oc = outcomesBySubject.get(subject) ?? (await questionOutcomes(ctx, subject as MasterySubject));
      outcomesBySubject.set(subject, oc);
      const count = new Map<number, number>();
      for (const o of oc.outcomes.values()) if (o.chapterNumber !== null) count.set(o.chapterNumber, (count.get(o.chapterNumber) ?? 0) + 1);
      chapterChoices = [...count.entries()].map(([chapterNumber, objectives]) => ({ chapterNumber, objectives })).sort((x, y) => x.chapterNumber - y.chapterNumber);
    }
    subjects.push({
      subject, subjectBn: subjectBn(subject), teacherId: cell?.teacherId ?? null, teacherName: cell ? teachers.get(cell.teacherId) ?? null : null, state,
      assignmentId: a ? String(a._id) : null, builtBy: a?.suggestion?.builtBy ?? null, edited: Boolean(a?.suggestion?.editedAt),
      needsReviewCount: mine.filter((s) => s.status === "NEEDS_REVIEW").length, minutes: minutes === null ? null : Math.round(minutes),
      doOnDay: (a?.doOnDay as DoOnDay | undefined) ?? null, noLessonMarks, chapterChoices, inRotation: Boolean(cell),
    });
  }
  // The day plan: a finalised subject keeps its placement; the drafts are placed largest first, Friday first, on what is left.
  // Seeded with what the finalised subjects and the delivered tracker items already hold — the very seed `placeSubject` uses
  // at finalise — so the planned split matches what the finalise will do.
  const fixed = drafts.filter((d) => d.status === "SENT");
  const dayCap = dayCapMinutes(bp);
  const items = await AssignmentItem.find({ sectionId: ctx.sectionId, academicYearId: ctx.academicYearId, weekNumber: week.weekNumber }).select("subject minutesByDay").lean();
  const tailoredNow = new Set(drafts.map((d) => d.subject as string));
  const seed = loadsOf([...fixed.map((d) => ({ minutesByDay: d.minutesByDay })), ...items.filter((i) => !tailoredNow.has(i.subject)).map((i) => ({ minutesByDay: i.minutesByDay }))]);
  const plan = planDays(planned, dayCap, seed);
  const dayPlan = { FRI: Math.round(plan.loads.FRI), SAT: Math.round(plan.loads.SAT), overBy: Math.round(plan.overBy), dayCap };

  const today = dhakaDayKey(new Date());
  const card = await swapCardFor(ctx, week, bySubject, today);
  return {
    week: isoWeek, dueDate: dueYmd, deliveryDate: week.deliveryDate ? week.deliveryDate.slice(0, 10) : null, weekNumber: week.weekNumber, hasWeek: true, suspended: false,
    subjects,
    swapCard: card ? { ...card, dropSubjectBn: subjectBn(card.dropSubject), addSubjectBn: subjectBn(card.addSubject) } : null,
    canAcceptSwap: card ? await mayAcceptSwap(auth, ctx.sectionId) : false,
    dayPlan,
  };
}

const sum2 = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

// ---------------------------------------------------------------------------
// "প্রস্তাব দিন": build / rebuild on request
// ---------------------------------------------------------------------------

export interface SuggestResultItem {
  subject: string;
  state: DraftState;
  assignment: AssignmentView | null;
  noLessonMarks: boolean;
  needsReviewCount: number;
}

export interface SuggestResult {
  items: SuggestResultItem[];
  /** Rotation subjects with mastery off — "নিজে তৈরি করুন" (the 2026 tracker flow). */
  manualSubjects: string[];
}

/** The subjects swapped IN for this week (§4.5): drafts carrying `suggestion.swap` that are not a rotation cell. */
async function swappedInSubjects(sectionId: Types.ObjectId, iso: string, cellSubjects: string[]): Promise<string[]> {
  const rows = await MasteryAssignment.find({ sectionId, week: iso, "suggestion.swap": { $exists: true } }).select("subject").lean();
  return rows.map((r) => r.subject as string).filter((s) => !cellSubjects.includes(s));
}

export async function suggestAssignment(input: { sectionId: string; dueYmd: string; subject?: string | null; rebuild?: boolean }, auth: Auth): Promise<SuggestResult> {
  if (!(await isLoop2027On())) throw new MasteryWorkError(NOT_ON);
  if (!Types.ObjectId.isValid(auth.userId)) throw new MasteryWorkError("ব্যবহারকারী পাওয়া যায়নি।");
  const ctx = await sectionContext(input.sectionId);
  if (!hasAssignmentBudget(ctx.classToken)) throw new MasteryWorkError(NO_ASSIGNMENT_FOR_SMALL);
  const week = await weekForDue(ctx.academicYearId, input.dueYmd);
  // AC-C13: a holiday / paused week has no assignment — a named subject is refused, the whole-week ask returns nothing.
  if (!week && input.subject) throw new MasteryWorkError("এই সপ্তাহে অ্যাসাইনমেন্ট নেই (ছুটি বা বিরতির সপ্তাহ) — প্রস্তাব দেওয়া যায় না।");
  const cells = cellsOf(week, String(ctx.sectionId)).filter((c) => !c.nilDeclared);
  const iso = isoWeekKey(dayOf(input.dueYmd));
  const swappedIn = await swappedInSubjects(ctx.sectionId, iso, cells.map((c) => c.subject as string));
  const wanted = input.subject ? [input.subject] : cells.map((c) => c.subject as string);
  const out: SuggestResult = { items: [], manualSubjects: [] };
  // The budget share counts every subject of the week — a "নিজে তৈরি করুন" subject keeps its share, a swapped-in one takes the dropped one's.
  const n = Math.max(1, cells.length + swappedIn.length);
  for (const subject of wanted) {
    if (input.subject) {
      // A named subject must be in this week's rotation, or already be its (swapped-in) draft.
      if (week && !cells.some((c) => c.subject === subject) && !swappedIn.includes(subject)) throw new MasteryWorkError("এই বিষয় এই সপ্তাহের রোটেশনে নেই।");
    }
    try {
      await assertMayWork(auth, ctx.sectionId, subject as MasterySubject, new Date());
    } catch (err) {
      if (input.subject) throw err; // asked for this subject by name
      continue; // the Office / class teacher asking for the whole week: only the subjects they may work
    }
    if (!(await isMasteryEnabled(ctx.academicYearId, ctx.classToken, subject as MasterySubject))) {
      if (input.subject) throw new MasteryWorkError(MANUAL_MESSAGE);
      out.manualSubjects.push(subject);
      continue;
    }
    const r = await buildSuggestedDraft({ sectionId: input.sectionId, subject: subject as MasterySubject, dueYmd: input.dueYmd, nSubjects: n, builtBy: "TEACHER", actorId: auth.userId, rebuild: Boolean(input.rebuild) });
    if (r.state === "FINALISED" && input.subject) throw new MasteryWorkError(FINALISED_MESSAGE);
    out.items.push({
      subject, state: r.state, assignment: r.assignment ? await assignmentView(r.assignment) : null, noLessonMarks: r.noLessonMarks, needsReviewCount: r.needsReview.length,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Swap card: accept
// ---------------------------------------------------------------------------

export async function acceptAssignmentSwap(
  input: { sectionId: string; dueYmd: string; dropSubject: string; addSubject: string; confirmEdited?: boolean },
  auth: Auth,
): Promise<SuggestResultItem> {
  if (!(await isLoop2027On())) throw new MasteryWorkError(NOT_ON);
  if (!Types.ObjectId.isValid(auth.userId)) throw new MasteryWorkError("ব্যবহারকারী পাওয়া যায়নি।");
  const ctx = await sectionContext(input.sectionId);
  if (!hasAssignmentBudget(ctx.classToken)) throw new MasteryWorkError(NO_ASSIGNMENT_FOR_SMALL);
  // R29: the শাখা's class teacher or the Office — a plain subject teacher is refused.
  if (!(await mayAcceptSwap(auth, ctx.sectionId))) throw new MasteryWorkError("বিষয় বদলের প্রস্তাব শুধু শাখার ক্লাস শিক্ষক বা অফিস গ্রহণ করতে পারেন।");
  const week = await weekForDue(ctx.academicYearId, input.dueYmd);
  if (!week || !week.deliveryDate) throw new MasteryWorkError("এই সপ্তাহের রোটেশন পাওয়া যায়নি।");
  const iso = isoWeekKey(dayOf(input.dueYmd));
  const today = dhakaDayKey(new Date());
  if (today > week.deliveryDate.slice(0, 10)) throw new MasteryWorkError("বিষয় বদলের প্রস্তাবের সময় শেষ — অ্যাসাইনমেন্ট দেওয়ার দিন পেরিয়ে গেছে।");
  const cells = cellsOf(week, String(ctx.sectionId));
  const dropCell = cells.find((c) => c.subject === input.dropSubject);
  if (!dropCell) throw new MasteryWorkError("বদলানোর বিষয়টি এই সপ্তাহের রোটেশনে নেই।");
  const drafts = new Map((await MasteryAssignment.find({ sectionId: ctx.sectionId, week: iso })).map((d) => [d.subject as string, d]));
  const dropDraft = drafts.get(input.dropSubject) ?? null;
  // A finalised subject cannot be swapped (AC-C6).
  if (dropDraft?.status === "SENT" || dropCell.delivered) throw new MasteryWorkError("চূড়ান্ত হয়ে যাওয়া বিষয় বদলানো যায় না।");
  // The pair must be what the card offers now (a stale or forged pair is refused).
  const card = await swapCardFor(ctx, week, drafts, today);
  if (!card || card.dropSubject !== input.dropSubject || card.addSubject !== input.addSubject) throw new MasteryWorkError("এই বদলের প্রস্তাব এখন আর প্রযোজ্য নয় — পাতাটি রিফ্রেশ করুন।");
  if (dropDraft) {
    const edited = Boolean(dropDraft.suggestion?.editedAt) || (await MasteryAssignmentSheet.exists({ assignmentId: dropDraft._id, edited: true })) !== null;
    if (edited && !input.confirmEdited) {
      throw new MasteryWorkError("বিষয়শিক্ষক এই খসড়া ইতিমধ্যে সম্পাদনা করেছেন — বদলালে তাঁর পরিবর্তন মুছে যাবে। নিশ্চিত করে আবার চাপুন।");
    }
  }
  // Order matters (nothing is half-done): build the new draft FIRST — a failure leaves the week untouched — then declare the
  // dropped cell "no assignment this week" (so the week still auto-issues, D-#839; the rotation table is unchanged), and only
  // then delete the dropped draft. A failed declaration undoes the new draft and throws.
  const n = Math.max(1, cells.filter((c) => !c.nilDeclared).length);
  const built = await buildSuggestedDraft({ sectionId: input.sectionId, subject: input.addSubject as MasterySubject, dueYmd: input.dueYmd, nSubjects: n, builtBy: "ENGINE", actorId: auth.userId, rebuild: true, swap: { drop: input.dropSubject, add: input.addSubject } });
  if (!built.assignment) throw new MasteryWorkError(MANUAL_MESSAGE);
  try {
    await declareNoAssignment({ academicYearId: String(ctx.academicYearId), weekNumber: week.weekNumber, entryId: dropCell.entryId, sectionId: String(ctx.sectionId), reason: "OTHER", actorId: auth.userId });
  } catch (err) {
    await MasteryAssignmentSheet.deleteMany({ assignmentId: built.assignment._id });
    await MasteryAssignment.deleteOne({ _id: built.assignment._id });
    await reportSilentFailure("assignmentSwap.declareNil", err, { sectionId: input.sectionId, week: iso });
    throw new MasteryWorkError("বিষয় বদল সম্পন্ন হয়নি — বাদ দেওয়া বিষয়ের ‘এই সপ্তাহে অ্যাসাইনমেন্ট নেই’ ঘোষণা করা যায়নি। আবার চেষ্টা করুন।");
  }
  if (dropDraft) {
    await MasteryAssignmentSheet.deleteMany({ assignmentId: dropDraft._id });
    await MasteryAssignment.deleteOne({ _id: dropDraft._id, status: "DRAFT" });
  }
  // Both subject teachers are told: the cell's teacher and the routine slot holder of the new subject.
  const newTeacher = await resolveSubjectTeacher(String(ctx.sectionId), input.addSubject, dayOf(input.dueYmd));
  const where = await whereOf(ctx.sectionId);
  const body = `${where} · এই সপ্তাহে ${subjectBn(input.dropSubject)}-এর বদলে ${subjectBn(input.addSubject)}-এর অ্যাসাইনমেন্ট হবে`;
  for (const [teacher, role] of [[dropCell.teacherId, "DROP"], [newTeacher, "ADD"]] as const) {
    if (!teacher) continue;
    await emit({
      recipientUserId: teacher, kind: "AS_SWAP_SUGGESTED", titleBn: "অ্যাসাইনমেন্টে বিষয় বদল", bodyBn: body,
      refs: { sectionId: input.sectionId, subject: role === "DROP" ? input.dropSubject : input.addSubject, masteryAssignmentId: String(built.assignment._id), date: input.dueYmd },
      dedupeKey: `ASSWA:${iso}:${input.sectionId}:${input.dropSubject}:${input.addSubject}:${teacher}`,
    }).catch((err) => reportSilentFailure("assignmentSwap.notify", err, { teacher }));
  }
  void writeAudit({
    eventKind: "MASTERY_ASSIGNMENT_BUILT", actorId: auth.userId, actorRole: auth.role, targetKind: "MasteryAssignment", targetId: built.assignment._id,
    meta: { swap: { drop: input.dropSubject, add: input.addSubject }, week: iso, sectionId: input.sectionId },
  });
  return { subject: input.addSubject, state: built.state, assignment: await assignmentView(built.assignment), noLessonMarks: built.noLessonMarks, needsReviewCount: built.needsReview.length };
}

async function whereOf(sectionId: Types.ObjectId): Promise<string> {
  const l = await sectionLabel(sectionId);
  return [l.className, l.sectionName].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Per-child weekly load (AC-C10)
// ---------------------------------------------------------------------------

export interface ChildLoadRow extends ChildLoad {
  studentId: string;
  name: string;
  schoolId: string | null;
  subjects: { subject: string; fri: number; sat: number }[];
}

export interface AssignmentLoadView {
  week: string;
  dayCap: number;
  children: ChildLoadRow[];
  /** The Thursday class homework — LISTED, never counted in the 360 / 180 budgets (R27). */
  thursdayHomework: { subject: string; minutes: number; description: string | null }[];
}

const schoolNo = (s?: string | null): number => (s && /^\d+$/.test(s) ? Number(s) : Number.MAX_SAFE_INTEGER);

export async function assignmentLoad(sectionId: string, dueYmd: string, auth: Auth): Promise<AssignmentLoadView> {
  const ctx = await sectionContext(sectionId);
  const bp = await budgetPolicy();
  const dayCap = dayCapMinutes(bp);
  const iso = isoWeekKey(dayOf(dueYmd));
  const base: AssignmentLoadView = { week: iso, dayCap, children: [], thursdayHomework: [] };
  if (!hasAssignmentBudget(ctx.classToken) || !(await isLoop2027On())) return base; // OFF: the plain / empty shape
  const week = await weekForDue(ctx.academicYearId, dueYmd);
  const cells = cellsOf(week, String(ctx.sectionId));
  await assertWeekReader(auth, ctx.sectionId, cells);
  if (!week) return base;

  const [drafts, roster] = await Promise.all([MasteryAssignment.find({ sectionId: ctx.sectionId, week: iso }), rosterOf(ctx.sectionId)]);
  const sheets = await MasteryAssignmentSheet.find({ assignmentId: { $in: drafts.map((d) => d._id) } }).select("assignmentId studentId items.marks").lean();
  // Planned placement of the drafts, beside what the finalised ones already hold.
  const fixed = drafts.filter((d) => d.status === "SENT");
  const open = drafts.filter((d) => d.status !== "SENT");
  const minutesOf = (d: IMasteryAssignment) => countedMinutes(sumMarks(d.partA ?? []), sheets.filter((s) => String(s.assignmentId) === String(d._id)).map((s) => sumMarks(s.items)), bp);
  // Seeded like `placeSubject` at finalise: the finalised subjects and the delivered tracker items hold their minutes first.
  const trackerForSeed = await AssignmentItem.find({ sectionId: ctx.sectionId, academicYearId: ctx.academicYearId, weekNumber: week.weekNumber }).select("subject minutesByDay").lean();
  const tailoredSubjectsSeed = new Set(drafts.map((d) => d.subject as string));
  const seed = loadsOf([...fixed.map((d) => ({ minutesByDay: d.minutesByDay })), ...trackerForSeed.filter((i) => !tailoredSubjectsSeed.has(i.subject)).map((i) => ({ minutesByDay: i.minutesByDay }))]);
  const plan = planDays(open.map((d) => ({ subject: d.subject as string, minutes: minutesOf(d) })), dayCap, seed);
  const placeOf = (d: IMasteryAssignment): { doOnDay: DoOnDay; fri: number } => {
    if (d.status === "SENT" && d.doOnDay) return { doOnDay: d.doOnDay, fri: d.minutesByDay?.FRI ?? 0 };
    const pl = plan.placed.get(d.subject as string);
    return { doOnDay: pl?.doOnDay ?? "FRI", fri: pl?.minutesByDay.FRI ?? 0 };
  };
  // A delivered tracker item with no tailored draft still takes the children's time (the same minutes for everyone).
  const trackerItems = await AssignmentItem.find({ sectionId: ctx.sectionId, academicYearId: ctx.academicYearId, weekNumber: week.weekNumber }).select("subject estMinutes doOnDay minutesByDay").lean();
  const tailoredSubjects = new Set(drafts.map((d) => d.subject as string));
  // Weekend extra homework (PR-D sheets dated from the delivery day through Saturday).
  const dFrom = localDay((week.deliveryDate as string).slice(0, 10));
  const extras = await MasteryPaper.find({
    sectionId: ctx.sectionId, extra: true, source: "HW", date: { $gte: new Date(Date.UTC(dFrom.getFullYear(), dFrom.getMonth(), dFrom.getDate())), $lte: new Date(Date.UTC(dFrom.getFullYear(), dFrom.getMonth(), dFrom.getDate() + 3)) },
  }).select("date items perStudentItems").lean(); // bounded: a শাখা's extra sheets of one weekend
  const thu = (await HomeworkItem.find({ sectionId: ctx.sectionId, dateGiven: new Date(Date.UTC(dFrom.getFullYear(), dFrom.getMonth(), dFrom.getDate())) })
    .select("subject description paperId freeLines")
    .lean()) as unknown as { subject: string; description?: string; paperId?: Types.ObjectId; freeLines?: { estMinutes: number }[] }[];
  // The Thursday class homework's minutes: its paper's marks at the policy rate, plus the free lines' own estimates (R22, R26).
  const thuPaperIds: Types.ObjectId[] = [];
  for (const h of thu) if (h.paperId) thuPaperIds.push(h.paperId as Types.ObjectId);
  const thuRows = (await MasteryPaper.find({ _id: { $in: thuPaperIds } }).select("items.marks").lean()) as unknown as { _id: Types.ObjectId; items: { marks: number }[] }[];
  const thuPapers = new Map<string, number>();
  for (const p of thuRows) thuPapers.set(String(p._id), sumMarks(p.items));

  const ordered = [...roster].sort((a, b) => schoolNo(a.schoolId) - schoolNo(b.schoolId) || personName(a).localeCompare(personName(b)));
  const children: ChildLoadRow[] = ordered.map((st) => {
    const sid = String(st._id);
    const subj: SubjectLoad[] = [];
    for (const d of drafts) {
      const mine = sheets.find((s) => String(s.assignmentId) === String(d._id) && String(s.studentId) === sid);
      const pl = placeOf(d);
      subj.push({ subject: d.subject as string, doOnDay: pl.doOnDay, friMinutes: pl.fri, childMinutes: (sumMarks(d.partA ?? []) + sumMarks(mine?.items ?? [])) * bp.minutesPerMark });
    }
    for (const it of trackerItems) {
      if (tailoredSubjects.has(it.subject)) continue;
      subj.push({ subject: it.subject, doOnDay: (it.doOnDay as DoOnDay | undefined) ?? "FRI", friMinutes: it.minutesByDay?.FRI ?? 0, childMinutes: it.estMinutes ?? 0 });
    }
    const extra = { FRI: 0, SAT: 0 };
    for (const p of extras) {
      const my = (p.perStudentItems ?? []).find((x) => String(x.studentId) === sid);
      if (!my) continue;
      const marks = p.items.filter((i) => my.itemNos.includes(i.itemNo)).reduce((s, i) => s + i.marks, 0);
      const d = extraHomeworkDays(new Date(p.date).getUTCDay(), marks * bp.minutesPerMark);
      extra.FRI += d.FRI;
      extra.SAT += d.SAT;
    }
    const load = childLoad(subj, extra, dayCap);
    return {
      ...load, studentId: sid, name: personName(st), schoolId: st.schoolId ?? null,
      subjects: subj.map((s) => {
        const dm = dayMinutes(s);
        return { subject: s.subject, fri: Math.round(dm.FRI), sat: Math.round(dm.SAT) };
      }),
    };
  });
  void fixed;
  return {
    ...base,
    children,
    thursdayHomework: thu.map((h) => ({
      subject: h.subject,
      minutes: Math.round((h.paperId ? thuPapers.get(String(h.paperId)) ?? 0 : 0) * bp.minutesPerMark + (h.freeLines ?? []).reduce((s, l) => s + (l.estMinutes ?? 0), 0)),
      description: h.description ?? null,
    })),
  };
}

function dayMinutes(s: SubjectLoad): { FRI: number; SAT: number } {
  if (s.doOnDay === "FRI") return { FRI: s.childMinutes, SAT: 0 };
  if (s.doOnDay === "SAT") return { FRI: 0, SAT: s.childMinutes };
  const fri = Math.min(s.childMinutes, Math.max(0, s.friMinutes));
  return { FRI: fri, SAT: s.childMinutes - fri };
}

// ---------------------------------------------------------------------------
// System delivery of the tracker item (finalise → delivery day → D-#839 sweep)
// ---------------------------------------------------------------------------

/** Who of these children was marked absent on `dateKey` (the units they sat in; Quran-group attendance included, D-#823). */
async function absentOnDay(studentIds: string[], dateKey: string): Promise<Set<string>> {
  const units = await resolveUnitsForIds(studentIds);
  const or = [...new Map([...units.values()].map((u) => [`${u.unitType}:${u.unitId}`, u])).values()].flatMap((u) =>
    Types.ObjectId.isValid(u.unitId) ? [{ [u.unitType === "subjectgroup" ? "subjectGroupId" : "sectionId"]: oid(u.unitId), dateKey }] : [],
  );
  if (or.length === 0) return new Set();
  const recs = await StudentAttendanceDay.find({ $or: or }).select("absentStudentIds").lean(); // bounded: the units of one শাখা on one day
  return new Set(recs.flatMap((r) => (r.absentStudentIds ?? []).map(String)));
}

export type TailoredDelivery = "DELIVERED" | "EXISTS" | "NOT_YET" | "SKIPPED";

/**
 * Deliver the tracker item of a SENT tailored assignment (release switch on, Class 1–5): on / after the delivery day, once
 * (the cell has no item yet). A swapped-in subject (`suggestion.swap`) takes the dropped cell's class / cycle / entry ids with
 * ITS OWN subject, and the routine slot holder as teacher. The existing `onAssignmentItemDelivered` hook then links the paper
 * and carries the counted minutes and the Friday / Saturday split onto the item.
 */
export async function deliverTailoredFor(a: IMasteryAssignment, now: Date = new Date()): Promise<TailoredDelivery> {
  if (a.status !== "SENT" || !hasAssignmentBudget(a.classToken)) return "SKIPPED";
  if (!(await isLoop2027On())) return "SKIPPED";
  const dueYmd = a.dueDate.toISOString().slice(0, 10);
  const week = await weekForDue(a.academicYearId, dueYmd);
  if (!week || !week.deliveryDate) return "SKIPPED";
  if (dhakaDayKey(now) < week.deliveryDate.slice(0, 10)) return "NOT_YET"; // not before the delivery day
  const exists = await AssignmentItem.exists({ academicYearId: a.academicYearId, weekNumber: week.weekNumber, sectionId: a.sectionId, subject: a.subject });
  if (exists) return "EXISTS";
  const cells = cellsOf(week, String(a.sectionId));
  const own = cells.find((c) => c.subject === a.subject);
  const swap = a.suggestion?.swap;
  const entryCell = own ?? (swap ? cells.find((c) => c.subject === swap.drop) : undefined);
  if (!entryCell) return "SKIPPED"; // neither a rotation cell nor a swapped-in subject: a hand-built week stays with its teacher
  const teacherId = own ? own.teacherId : ((await resolveSubjectTeacher(String(a.sectionId), a.subject, a.dueDate)) ?? entryCell.teacherId);
  const kids = (await rosterOf(a.sectionId)).map((s) => String(s._id));
  const absent = await absentOnDay(kids, week.deliveryDate.slice(0, 10));
  const item = await deliverSystemAssignmentItem({
    academicYearId: String(a.academicYearId),
    weekNumber: week.weekNumber,
    entryId: entryCell.entryId,
    subject: a.subject as never,
    teacherId,
    roster: kids.map((studentId) => ({ studentId, present: !absent.has(studentId) })),
    estMinutes: Math.max(0, Math.round(a.countedMinutes ?? 0)),
    ...(a.doOnDay ? { doOnDay: a.doOnDay } : {}),
    ...(a.minutesByDay ? { minutesByDay: { FRI: a.minutesByDay.FRI ?? 0, SAT: a.minutesByDay.SAT ?? 0 } } : {}),
    description: `সাপ্তাহিক অ্যাসাইনমেন্ট — ${subjectBn(a.subject)}: প্রিন্ট করা নিজের শিট থেকে করবে`,
    actorId: AS_DRAFT_ACTOR_ID,
    at: now,
  });
  if (!item) return "EXISTS";
  a.asItemId = item._id;
  await a.save();
  try {
    await (await import("./AssignmentPaperService")).onAssignmentItemDelivered(item, AS_DRAFT_ACTOR_ID);
  } catch (err) {
    await reportSilentFailure("assignment.tailoredLink", err, { itemId: String(item._id) });
  }
  return "DELIVERED";
}

/** The tick's pass, BEFORE the D-#839 sweep: every SENT tailored assignment of the last fortnight whose item is due for delivery. */
export async function deliverTailoredItems(now: Date = new Date()): Promise<number> {
  if (!(await isLoop2027On())) return 0;
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const sent = await MasteryAssignment.find({ status: "SENT", sentAt: { $gte: since }, asItemId: { $exists: false } }); // bounded: a fortnight of sent weeks
  let n = 0;
  for (const a of sent) {
    try {
      if ((await deliverTailoredFor(a, now)) === "DELIVERED") n++;
    } catch (err) {
      await reportSilentFailure("assignment.deliverTailored", err, { assignmentId: String(a._id) });
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// ASDRAFT: the scheduler family
// ---------------------------------------------------------------------------

/** Cheap gate the tick calls first: the switch is on and today's \`asDraftHour\` has been reached (Dhaka). */
export async function asDraftReady(now: Date = new Date()): Promise<boolean> {
  const p = (await getPolicy(null, null)).resolved;
  if (p.academicLoop2027On !== true) return false;
  return now.getHours() * 60 + now.getMinutes() >= Math.round(Number(p.asDraftHour) * 60);
}

export interface AsDraftSummary {
  created: number;
  existing: number;
  manual: number;
  failed: number;
}

const notifyDraft = async (a: IMasteryAssignment, teacherId: string, where: string, gaps: string[]): Promise<void> => {
  const gapLine = gaps.length > 0 ? ` · ${bn(gaps.length)} জনের শিটে প্রশ্নের ঘাটতি আছে — আগে দেখে নিন` : "";
  await emit({
    recipientUserId: teacherId, kind: "AS_DRAFT_READY", titleBn: "সাপ্তাহিক অ্যাসাইনমেন্টের খসড়া তৈরি",
    bodyBn: `${where} · ${subjectBn(a.subject)} — প্রস্তাব দেখে চূড়ান্ত করুন${gapLine}`,
    refs: { sectionId: String(a.sectionId), subject: a.subject, masteryAssignmentId: String(a._id), date: a.dueDate.toISOString().slice(0, 10) },
    // The recipient, the week and the শাখা × subject: a second teacher (a cover) is never swallowed by the first.
    dedupeKey: `ASDR:${a.week}:${String(a.sectionId)}:${a.subject}:${teacherId}`,
  });
};

/**
 * \`ASDRAFT\` (§4.1): \`asDraftLeadDays\` school days before the RESOLVED delivery day (a holiday roll moves it), skipping a
 * SUSPENDED week and an \`ASSIGNMENT_GENERATION\` pause (AC-C13). Class 1–5 only (AC-C15). For each rotation cell with mastery
 * on, no "no assignment" declaration and no assignment yet: one DRAFT, then the notice to the cell's teacher (the cover on the
 * delivery day). Idempotent (AC-C1): a second run finds the drafts and creates nothing.
 */
export async function runAsDraft(now: Date = new Date()): Promise<AsDraftSummary> {
  const sum: AsDraftSummary = { created: 0, existing: 0, manual: 0, failed: 0 };
  const policy = (await getPolicy(null, null)).resolved;
  if (policy.academicLoop2027On !== true) return sum;
  const todayK = dhakaDayKey(now);
  const schedules = await AssignmentSchedule.find({}); // bounded: one per academic year
  for (const sch of schedules) {
    const w0 = weekNumberFor(sch.termStartDate, atMidnight(now));
    if (w0 < 1) continue;
    for (const w of [w0, w0 + 1]) {
      if (w > 53) continue;
      let week: ExpectedWeek;
      try {
        week = await expectedItemsForWeek(String(sch.academicYearId), w);
      } catch {
        continue;
      }
      if (week.suspended || !week.deliveryDate || !week.dueDate) continue; // a holiday week or an ASSIGNMENT_GENERATION pause (D-#1655)
      const deliveryKey = week.deliveryDate.slice(0, 10);
      const delivery = localDay(deliveryKey);
      const open = await loadOpenDayPredicate(new Date(delivery.getTime() - 20 * 86_400_000), delivery);
      const draftKey = keyOfLocal(draftDayOf(delivery, Number(policy.asDraftLeadDays), open));
      // A week whose delivery day is paused is already `suspended` (resolveScheduleWeek). When only the draft day is paused, the
      // draft runs on the first unpaused school day, up to the delivery day.
      let effective: string | null = null;
      for (let d = localDay(draftKey); keyOfLocal(d) <= deliveryKey; d.setDate(d.getDate() + 1)) {
        if (!open(d)) continue;
        if (!(await isPausedOn("ASSIGNMENT_GENERATION", keyOfLocal(d)))) {
          effective = keyOfLocal(d);
          break;
        }
      }
      if (!effective || todayK < effective || todayK > deliveryKey) continue;
      await draftWeek(week, sum, now);
    }
  }
  return sum;
}

async function draftWeek(week: ExpectedWeek, sum: AsDraftSummary, now: Date): Promise<void> {
  const dueYmd = (week.dueDate as string).slice(0, 10);
  const bySection = new Map<string, ExpectedItem[]>();
  for (const c of week.items) if (c.classLevel >= 1) bySection.set(c.sectionId, [...(bySection.get(c.sectionId) ?? []), c]);
  for (const [sectionId, all] of bySection) {
    const cells = all.filter((c) => !c.nilDeclared);
    if (cells.length === 0) continue;
    let ctx: SectionCtx;
    try {
      ctx = await sectionContext(sectionId);
    } catch {
      continue; // an inactive / retired শাখা
    }
    const where = await whereOf(ctx.sectionId);
    const iso = isoWeekKey(dayOf(dueYmd));
    const drafts = new Map<string, IMasteryAssignment | null>((await MasteryAssignment.find({ sectionId: ctx.sectionId, week: iso })).map((d) => [d.subject as string, d]));
    const nSubjects = cells.length + (await swappedInSubjects(ctx.sectionId, iso, cells.map((c) => c.subject as string))).length;
    for (const cell of cells) {
      if (cell.delivered) continue; // the teacher already delivered a tracker item (2026 style): never override it
      // A draft ASDRAFT (or a teacher's request) built once is never built again after a teacher deleted it.
      if (!drafts.get(cell.subject) && (await engineBuiltBefore(sectionId, cell.subject, iso))) {
        sum.existing++;
        continue;
      }
      try {
        const r = await buildSuggestedDraft({ sectionId, subject: cell.subject as MasterySubject, dueYmd, nSubjects, builtBy: "ENGINE", actorId: AS_DRAFT_ACTOR_ID });
        drafts.set(cell.subject, r.assignment);
        if (r.state === "MANUAL") sum.manual++;
        else if (r.state === "CREATED") {
          sum.created++;
          if (r.assignment) await notifyDraft(r.assignment, cell.teacherId, where, r.needsReview);
        } else sum.existing++;
      } catch (err) {
        sum.failed++;
        await reportSilentFailure("asDraft.build", err, { sectionId, subject: cell.subject });
      }
    }
    try {
      await emitSwapCard(ctx, week, drafts, where, now);
    } catch (err) {
      await reportSilentFailure("asDraft.swapCard", err, { sectionId });
    }
  }
}

/** The persistent per-(week, শাখা, subject) marker: an engine build was audited (`engine: true`), even if the draft was deleted since. */
export async function engineBuiltBefore(sectionId: string, subject: string, week: string): Promise<boolean> {
  return (await Audit.exists({ eventKind: "MASTERY_ASSIGNMENT_BUILT", "meta.engine": true, "meta.sectionId": sectionId, "meta.subject": subject, "meta.week": week })) !== null;
}

/** The swap card's notice: the class teacher and the Office, once per (week, শাখা, pair, recipient) (R29). */
async function emitSwapCard(ctx: SectionCtx, week: ExpectedWeek, drafts: Map<string, IMasteryAssignment | null>, where: string, now: Date): Promise<void> {
  const card = await swapCardFor(ctx, week, drafts, dhakaDayKey(now));
  if (!card) return;
  const sec = await Section.findById(ctx.sectionId).select("classTeacherId").lean();
  // The Office = holders of the swap action who also hold the all-শাখা reach (a plain teacher holds the action by designation only).
  const accepters = await holderIdsOf("assignment:accept_swap");
  const viewers = new Set(await holderIdsOf("assignment:view_all"));
  const recipients = new Set<string>([...(sec?.classTeacherId ? [String(sec.classTeacherId)] : []), ...accepters.filter((id) => viewers.has(id))]);
  const iso = isoWeekKey(dayOf((week.dueDate as string).slice(0, 10)));
  for (const r of recipients) {
    await emit({
      recipientUserId: r, kind: "AS_SWAP_SUGGESTED", titleBn: "অ্যাসাইনমেন্টে বিষয় বদলের প্রস্তাব",
      bodyBn: `${where} · এই সপ্তাহে ${subjectBn(card.dropSubject)}-এর বদলে ${subjectBn(card.addSubject)}? (${bn(card.addWeakPct)}% দুর্বল)`,
      refs: { sectionId: String(ctx.sectionId), subject: card.addSubject, date: (week.dueDate as string).slice(0, 10) },
      dedupeKey: `ASSW:${iso}:${String(ctx.sectionId)}:${card.dropSubject}:${card.addSubject}:${r}`,
    });
  }
}
