/**
 * MasteryAssignmentService — M-4 of the mastery tracker: the weekly tailored assignment
 * (docs/prd-mastery.md §5.4 / §6.1, D-#780 / #809).
 *
 *  - assignmentFor          — the section × subject's assignment for a due date's week (or none),
 *                             plus the layout a new one starts from (remembered, else the policy)
 *  - buildAssignment        — create / rebuild the DRAFT from the teacher's layout (pure builder)
 *  - sheetDetail / editSheet — one student's Part B: swap, remove, add own question, approve
 *  - approveAllSheets       — approve every sheet the builder filled cleanly
 *  - sendAssignment         — write ONE MasteryPaper (source AS) with each student's item list
 *  - deleteAssignment       — a DRAFT only
 *  - renderAssignmentPdf    — A4, one page per student (Part A + Part B, answer + marks boxes)
 *
 * Gate: `mastery:create` at the resolver; here the add-on switch and the M-2 row rule (routine
 * holder or `mastery:edit_all`, D-#807). The assignment tracker is NOT written: a sheet may link
 * to the tracker's item for that week only to read who was absent / did not submit (D-#809).
 */
import path from "path";
import PDFDocument from "pdfkit";
import { Types } from "mongoose";
import { HW_SUBJECT_LABELS_BN } from "@scd/shared";
import type { MasteryClassToken, MasterySubject } from "@scd/shared";
import { MasteryAssignment, type IMasteryAssignment, type MasteryAssignmentLayout, type MasteryAssignmentQuestion } from "../models/MasteryAssignment";
import { MasteryAssignmentSheet, type IMasteryAssignmentSheet } from "../models/MasteryAssignmentSheet";
import { MasteryPaper } from "../models/MasteryPaper";
import { MasteryQuestionType } from "../models/MasteryQuestionType";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { AssignmentItem } from "../../trackers/models/AssignmentItem";
import { writeAudit } from "../../platform/services/AuditService";
import { personName } from "../../../lib/personName";
import { BENGALI_FONT, mixedText } from "../../../routes/pdfRenderer";
import { getPolicy, isMasteryEnabled } from "./MasteryCatalogueService";
import {
  MasteryWorkError,
  assertEnabled,
  assertMayWork,
  dayOf,
  nextPaperId,
  openExtraSeen,
  rosterOf,
  sectionContext,
  type Auth,
} from "./MasteryWorkService";
import { computeSection, liveSectionRows, lockedOutcomes, sectionLabel } from "./MasteryDiagnosisService";
import { buildPartA, buildPartB, pickQuestion, typeOfQuestion, type BankQuestion, type BuilderContext, type OutcomeInfo } from "../assignmentBuilder";
import { sectionOutcomeSummary } from "../diagnosis";
import { loCodeMongoFilter, loCodesOf, movedAliases, questionTypeCodeOf } from "../bank";
import { groupStimulusParts, partLabelsByItem, printLabel, printPlan, stimulusRefOf } from "../parts";
import { isoWeekKey } from "../evidence";
import { notifyAssignmentSent } from "../notify";
import { isTaggedRow } from "../rollup";
import { untaggedRefusal } from "../taggedGuard";
import { masteryLevelLabels } from "./MasteryReviewService";
import { objectiveGrain } from "./MasteryGuardianService";
import type { MasteryLevelLabels } from "@scd/shared";

import { examPoolClause, heldStimulusRefs, type ExamPoolLens } from "../examHold";
import { avoidFor, expandSections, homeworkUsedThisYear, isLoop2027On, noRepeatWeeks, qidsOf, recordUsesSafe, todayKey, usedInWindow, usesOfPaper, windowStartKey } from "../../assessment/services/QuestionUseService";
import { callerHasPermission } from "@scd/shared";
import { resolveSubjectTeacher } from "../../trackers/subjectTeacher";
import { resolveStaffProfileForUser } from "../../hr/services/staffMatch";
import { StaffLeaveApplication } from "../../hr/models/StaffLeaveApplication";
import { SECOND_ASSIGNMENT_MESSAGE, budgetPolicy, childDayLabel, dayLabel, staffDaySplit } from "../assignmentBudget";
import { dhakaDayKey } from "../../../lib/dhakaDay";
// AL-8: the week-reader rule lives beside the week view (a circular import, so it is loaded lazily where used).
async function mayReadAssignment(a: IMasteryAssignment, auth: Auth): Promise<boolean> {
  const { canReadAssignment } = await import("./AssignmentSuggestionService");
  return canReadAssignment(a, auth);
}

const oid = (s: string) => new Types.ObjectId(s);
const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const sum = (qs: { marks: number }[]) => qs.reduce((s, q) => s + q.marks, 0);

// ---------------------------------------------------------------------------
// Inputs and catalogue reads
// ---------------------------------------------------------------------------

export type LayoutInput = MasteryAssignmentLayout;

/**
 * Evidence rows of a শাখা AND, while it is a merged (combined) শাখা, of its source শাখা (§3.7, AC-U2): the children moved
 * to the combined শাখা keep the evidence written in their old one. A plain শাখা reads exactly `liveSectionRows`.
 */
export async function liveRowsWithMerges(sectionId: Types.ObjectId, subject: MasterySubject, loCode?: string) {
  const ids = await expandSections([sectionId]);
  const per = await Promise.all(ids.map((id) => liveSectionRows(id, subject, loCode)));
  return per.flat();
}

/** `openExtraSeen` over the same merged set of শাখা. */
export async function openExtraSeenWithMerges(sectionId: Types.ObjectId, subject: MasterySubject): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const id of await expandSections([sectionId])) {
    for (const [sid, qs] of await openExtraSeen(id, subject)) out.set(sid, new Set([...(out.get(sid) ?? []), ...qs]));
  }
  return out;
}

export async function marksTable(classToken: MasteryClassToken, subject: MasterySubject): Promise<Map<string, number>> {
  const rows = await MasteryQuestionType.find({ classToken, subject, active: true }).select("code marks").lean();
  return new Map(rows.filter((r) => typeof r.marks === "number" && r.marks > 0).map((r) => [r.code, r.marks as number]));
}

/**
 * The gold, current, not-retired questions tagged with any of `codes`, with their text. Questions held
 * for the exam papers (PR-I, D-#1408) are left out unless `examPool` says otherwise — every picker
 * takes the default, only the future exam-paper builder asks for `any` / `only`.
 */
export async function goldBank(codes: string[], examPool: ExamPoolLens = "exclude"): Promise<(BankQuestion & { textBn: string | null })[]> {
  if (codes.length === 0) return [];
  const alias = await movedAliases(codes); // old codes of moved rows still resolve (read-side alias)
  const arts = await ContentArtifact.find({
    docType: "question", current: true, retiredAt: null, reviewStatus: "gold", ...(examPoolClause(examPool) ?? {}), ...loCodeMongoFilter(alias.all),
  })
    .select("envelopeJson.tags envelopeJson.payload")
    .lean(); // bounded: one class × subject's gold questions
  // PR-I: the other parts of a passage with a held part stay out too (same stimulus_ref).
  let sibling = new Set<string>();
  if (examPool === "exclude") {
    sibling = await heldStimulusRefs(arts.map((a) => stimulusRefOf((a.envelopeJson as Record<string, unknown> | undefined)?.payload as Record<string, unknown> | undefined)).filter((x): x is string => Boolean(x)));
  }
  return arts.flatMap((a) => {
    const env = (a.envelopeJson ?? {}) as Record<string, unknown>;
    const payload = env.payload as Record<string, unknown> | undefined;
    const qid = payload?.qid as string | undefined;
    if (!qid) return [];
    const ref = stimulusRefOf(payload);
    if (ref && sibling.has(ref)) return [];
    const text = payload?.question_text;
    return [{
      artifactId: String(a._id),
      qid,
      loCodes: [...new Set(loCodesOf(env.tags as Record<string, unknown>, payload).map(alias.canon))],
      textBn: typeof text === "string" ? text : null,
      stimulusRef: stimulusRefOf(payload),
      qtCode: questionTypeCodeOf(payload),
      difficulty: typeof (env.tags as Record<string, unknown> | undefined)?.difficulty === "string" ? ((env.tags as Record<string, unknown>).difficulty as string) : null,
    }];
  });
}

function validateLayout(l: LayoutInput, marks: Map<string, number>, questionLos: Set<string>): LayoutInput {
  const half = (n: number) => Number.isFinite(n) && n >= 0 && Math.round(n * 2) === n * 2;
  if (!half(l.totalMarks) || l.totalMarks < 1 || l.totalMarks > 100) throw new MasteryWorkError("মোট নম্বর ১ থেকে ১০০-এর মধ্যে দিন।");
  if (!Number.isInteger(l.minutes) || l.minutes < 1 || l.minutes > 300) throw new MasteryWorkError("সময় ১ থেকে ৩০০ মিনিটের মধ্যে দিন।");
  const partAMarks = l.partAOn ? l.partAMarks : 0;
  if (!half(partAMarks) || !half(l.partBMarks)) throw new MasteryWorkError("অংশের নম্বর ০.৫-এর ধাপে দিন।");
  if (partAMarks + l.partBMarks !== l.totalMarks) {
    throw new MasteryWorkError(`অংশ ক (${bn(partAMarks)}) + অংশ খ (${bn(l.partBMarks)}) = মোট (${bn(l.totalMarks)}) হতে হবে।`);
  }
  const mix = [l.mixWeak, l.mixImproving, l.mixRevision];
  if (mix.some((x) => !Number.isInteger(x) || x < 0 || x > 100) || mix[0] + mix[1] + mix[2] !== 100) {
    throw new MasteryWorkError("দুর্বল + উন্নতি + রিভিশন মিলে ১০০% হতে হবে।");
  }
  const types = [...new Set(l.questionTypeCodes ?? [])];
  const badType = types.find((t) => !marks.has(t));
  if (badType) throw new MasteryWorkError(`${badType} এই শ্রেণি-বিষয়ের নম্বর-তালিকায় নেই।`);
  const los = [...new Set(l.partALoCodes ?? [])];
  const badLo = los.find((c) => !questionLos.has(c));
  if (badLo) throw new MasteryWorkError(`${badLo} এই শ্রেণি-বিষয়ের প্রশ্নভিত্তিক তালিকায় নেই।`);
  return { ...l, partAMarks, questionTypeCodes: types, partALoCodes: l.partAOn ? los : [] };
}

/** The layout a new assignment starts from: the last remembered one, else the school policy. */
export async function startingLayout(sectionId: Types.ObjectId, subject: MasterySubject, classToken: MasteryClassToken): Promise<LayoutInput> {
  const last = await MasteryAssignment.findOne({ sectionId, subject, rememberLayout: true }).sort({ dueDate: -1 }).select("layout").lean();
  if (last?.layout) return last.layout as LayoutInput;
  const p = (await getPolicy(classToken, subject)).resolved;
  return {
    totalMarks: p.assignmentTotalMarks,
    minutes: p.assignmentMinutes,
    partAOn: p.assignmentPartAOn,
    partAMarks: p.assignmentPartAOn ? p.assignmentPartAMarks : 0,
    partALoCodes: [],
    partBMarks: p.assignmentPartAOn ? p.assignmentPartBMarks : p.assignmentTotalMarks,
    mixWeak: p.assignmentMixWeak,
    mixImproving: p.assignmentMixImproving,
    mixRevision: p.assignmentMixRevision,
    questionTypeCodes: [],
  };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface QuestionView {
  origin: string;
  artifactId: string | null;
  qid: string | null;
  textBn: string | null;
  loCode: string;
  labelBn: string;
  chapterNumber: number | null;
  questionTypeCode: string;
  marks: number;
  band: string;
  /** AL-7: why the engine picked it; null on a 2026 / hand-built item. */
  reasonBn: string | null;
  /** AL-7: a question the শাখা had before, outside the window — "আবার". */
  repeat: boolean;
}

export interface SheetSummary {
  studentId: string;
  name: string;
  rollNumber: string | null;
  status: string;
  marks: number;
  items: { loCode: string; labelBn: string; band: string }[];
  warnings: { code: string; loCode: string | null; labelBn: string | null }[];
}

export interface AssignmentView {
  id: string;
  sectionId: string;
  subject: string;
  classToken: string;
  dueDate: string;
  week: string;
  layout: LayoutInput;
  rememberLayout: boolean;
  status: string;
  paperId: string | null;
  asItemId: string | null;
  /** AL-6b (switch on, set at finalise): the counted minutes of this subject and where they fall on the two home days. */
  countedMinutes: number | null;
  dayLabel: string | null;
  dayLabelEn: string | null;
  /** AL-7: the engine's audit (who built it, from what); null on a hand-built assignment. */
  suggestion: SuggestionView | null;
  partA: QuestionView[];
  sheets: SheetSummary[];
  /** AL-8: set only by `assignmentForReview` — the caller may change / finalise this draft (the rules the mutations use). */
  mayEdit?: boolean | null;
  mayFinalise?: boolean | null;
}

export interface SuggestionView {
  builtBy: "ENGINE" | "TEACHER";
  at: string;
  noLessonMarks: boolean;
  chapters: number[];
  excludedHw: number;
  excludedWindow: number;
  excludedSeen: number;
  /** A teacher changed the draft after the engine built it. */
  edited: boolean;
  needsReviewCount: number;
}

type Labels = Map<string, string>;

function questionView(q: MasteryAssignmentQuestion, labels: Labels): QuestionView {
  return {
    origin: q.origin,
    artifactId: q.artifactId ? String(q.artifactId) : null,
    qid: q.qid ?? null,
    textBn: q.textBn ?? null,
    loCode: q.loCode,
    labelBn: labels.get(q.loCode) ?? q.loCode,
    chapterNumber: q.chapterNumber ?? null,
    questionTypeCode: q.questionTypeCode,
    marks: q.marks,
    band: q.band,
    reasonBn: q.reasonBn ?? null,
    repeat: Boolean(q.repeat),
  };
}

async function labelsFor(classToken: MasteryClassToken, subject: MasterySubject): Promise<Labels> {
  return new Map((await lockedOutcomes(classToken, subject)).map((o) => [o.code, o.labelBn]));
}

/**
 * AL-6b (§4.4): the staff day label of a tailored assignment — Part A split over the whole sheet of the median child, plus
 * where the per-child part falls ("শুক্রবার: প্রশ্ন ১–৬ · শনিবার: প্রশ্ন ৭–১২ + নিজস্ব অংশ"). Null with no split (2026).
 */
async function staffDayLabels(a: IMasteryAssignment, sheets: { items: { marks: number }[] }[]): Promise<{ bn: string; en: string } | null> {
  if (!a.doOnDay) return null;
  let split: Parameters<typeof dayLabel>[2] = null;
  let own: Parameters<typeof dayLabel>[3] = null;
  if (a.doOnDay === "BOTH") {
    const ranked = [...sheets].sort((x, y) => sum(x.items) - sum(y.items));
    const mid = ranked[Math.floor(ranked.length / 2)];
    const aLines = printPlan(a.partA ?? [], 0);
    const lastA = aLines.at(-1)?.no ?? 0;
    const bLines = printPlan((mid?.items ?? []) as MasteryAssignmentQuestion[], lastA);
    const r = staffDaySplit(
      aLines.map((l) => ({ no: l.no, marks: l.item.marks })),
      bLines.map((l) => ({ no: l.no, marks: l.item.marks })),
      a.minutesByDay?.FRI ?? 0,
      (await budgetPolicy()).minutesPerMark,
    );
    split = r.split;
    own = r.own;
  }
  return { bn: dayLabel("bn", a.doOnDay, split, own) as string, en: dayLabel("en", a.doOnDay, split, own) as string };
}

export async function assignmentView(a: IMasteryAssignment): Promise<AssignmentView> {
  const [labels, sheets, roster, paper] = await Promise.all([
    labelsFor(a.classToken, a.subject),
    MasteryAssignmentSheet.find({ assignmentId: a._id }).lean(),
    rosterOf(a.sectionId),
    a.paperId ? MasteryPaper.findById(a.paperId).select("paperId").lean() : null,
  ]);
  const bySid = new Map(sheets.map((s) => [String(s.studentId), s]));
  const staff = await staffDayLabels(a, sheets);
  return {
    id: String(a._id),
    sectionId: String(a.sectionId),
    subject: a.subject,
    classToken: a.classToken,
    dueDate: a.dueDate.toISOString().slice(0, 10),
    week: a.week,
    layout: a.layout as LayoutInput,
    rememberLayout: a.rememberLayout,
    status: a.status,
    paperId: paper?.paperId ?? null,
    asItemId: a.asItemId ? String(a.asItemId) : null,
    countedMinutes: typeof a.countedMinutes === "number" ? a.countedMinutes : null,
    dayLabel: staff?.bn ?? null,
    dayLabelEn: staff?.en ?? null,
    suggestion: a.suggestion
      ? {
          builtBy: a.suggestion.builtBy,
          at: new Date(a.suggestion.at).toISOString(),
          noLessonMarks: Boolean(a.suggestion.inputs?.noLessonMarks),
          chapters: a.suggestion.inputs?.chapters ?? [],
          excludedHw: a.suggestion.inputs?.excluded?.hw ?? 0,
          excludedWindow: a.suggestion.inputs?.excluded?.window ?? 0,
          excludedSeen: a.suggestion.inputs?.excluded?.seen ?? 0,
          edited: Boolean(a.suggestion.editedAt),
          needsReviewCount: sheets.filter((s) => s.status === "NEEDS_REVIEW").length,
        }
      : null,
    partA: (a.partA ?? []).map((q) => questionView(q, labels)),
    sheets: roster.flatMap((st) => {
      const s = bySid.get(String(st._id));
      if (!s) return [];
      return [{
        studentId: String(st._id),
        name: personName(st),
        rollNumber: st.rollNumber ?? null,
        status: s.status,
        marks: sum(s.items),
        items: s.items.map((q) => ({ loCode: q.loCode, labelBn: labels.get(q.loCode) ?? q.loCode, band: q.band })),
        warnings: s.warnings.map((w) => ({ code: w.code, loCode: w.loCode ?? null, labelBn: w.loCode ? labels.get(w.loCode) ?? w.loCode : null })),
      }];
    }),
  };
}

async function loadAssignment(id: string, auth: Auth): Promise<IMasteryAssignment> {
  if (!Types.ObjectId.isValid(id)) throw new MasteryWorkError("অ্যাসাইনমেন্ট পাওয়া যায়নি।");
  const a = await MasteryAssignment.findById(id);
  if (!a) throw new MasteryWorkError("অ্যাসাইনমেন্ট পাওয়া যায়নি।");
  await assertMayWork(auth, a.sectionId, a.subject, new Date());
  return a;
}

const assertDraft = (a: IMasteryAssignment) => {
  if (a.status !== "DRAFT") throw new MasteryWorkError("পাঠানো অ্যাসাইনমেন্ট আর বদলানো যায় না।");
};

// ---------------------------------------------------------------------------
// Read: this week's assignment + the starting layout
// ---------------------------------------------------------------------------

export async function assignmentFor(
  sectionId: string,
  subject: MasterySubject,
  dueDate: string,
  auth: Auth,
): Promise<{ week: string; assignment: AssignmentView | null; startingLayout: LayoutInput }> {
  const ctx = await sectionContext(sectionId);
  await assertMayWork(auth, ctx.sectionId, subject, new Date());
  const week = isoWeekKey(dayOf(dueDate));
  const a = await MasteryAssignment.findOne({ sectionId: ctx.sectionId, subject, week });
  return {
    week,
    assignment: a ? await assignmentView(a) : null,
    startingLayout: a ? (a.layout as LayoutInput) : await startingLayout(ctx.sectionId, subject, ctx.classToken),
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface BuildInput {
  sectionId: string;
  subject: MasterySubject;
  dueDate: string;
  layout: LayoutInput;
  rememberLayout: boolean;
  asItemId?: string | null;
}

export async function buildAssignment(input: BuildInput, auth: Auth): Promise<AssignmentView> {
  const ctx = await sectionContext(input.sectionId);
  await assertEnabled(ctx, input.subject);
  await assertMayWork(auth, ctx.sectionId, input.subject, new Date());
  if (!Types.ObjectId.isValid(auth.userId)) throw new MasteryWorkError("ব্যবহারকারী পাওয়া যায়নি।");
  const due = dayOf(input.dueDate);
  const week = isoWeekKey(due);

  const [outcomes, marks, rows, policy, roster] = await Promise.all([
    lockedOutcomes(ctx.classToken, input.subject),
    marksTable(ctx.classToken, input.subject),
    liveSectionRows(ctx.sectionId, input.subject),
    getPolicy(ctx.classToken, input.subject),
    rosterOf(ctx.sectionId),
  ]);
  // Tagged rows only (OT-3): an untagged objective groups its children and takes no question.
  const grouping = await untaggedRefusal(input.layout?.partALoCodes ?? []);
  if (grouping) throw new MasteryWorkError(grouping);
  const questionOutcomes = outcomes.filter((o) => o.assess === "QUESTION" && isTaggedRow(o));
  const layout = validateLayout(input.layout, marks, new Set(questionOutcomes.map((o) => o.code)));

  let asItemId: Types.ObjectId | undefined;
  if (input.asItemId) {
    const it = Types.ObjectId.isValid(input.asItemId)
      ? await AssignmentItem.findOne({ _id: oid(input.asItemId), sectionId: ctx.sectionId, subject: input.subject }).select("_id").lean()
      : null;
    if (!it) throw new MasteryWorkError("ট্র্যাকারের এই অ্যাসাইনমেন্ট এই শাখা-বিষয়ের নয়।");
    asItemId = it._id as Types.ObjectId;
  }

  let a = await MasteryAssignment.findOne({ sectionId: ctx.sectionId, subject: input.subject, week });
  // AL-6 / AC-C12 (switch on): a second assignment for one ISO week × শাখা × subject is refused, pointing to extra homework.
  if (a && a.status !== "DRAFT" && (await isLoop2027On())) throw new MasteryWorkError(SECOND_ASSIGNMENT_MESSAGE);
  if (a) assertDraft(a);

  // Diagnosis of the whole section, read the way M-3 reads it (D-#808).
  const sec = computeSection(rows, policy.resolved, new Date());
  const outcomeInfo = new Map<string, OutcomeInfo>(
    questionOutcomes.map((o) => [o.code, { code: o.code, chapterNumber: o.chapterNumber ?? null, questionTypeCodes: o.questionTypeCodes ?? [] }]),
  );
  const bank = await goldBank([...outcomeInfo.keys()]);
  const exposure = new Map<string, number>();
  const studentsByQid = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.qid || r.routed) continue;
    const s = studentsByQid.get(r.qid) ?? new Set<string>();
    s.add(r.studentId);
    studentsByQid.set(r.qid, s);
  }
  for (const [q, s] of studentsByQid) exposure.set(q, s.size);
  const unmarkedTypes = new Set((await MasteryQuestionType.find({ classToken: ctx.classToken, subject: input.subject, active: true, marks: null }).select("code").lean()).map((t) => t.code));
  const bctx: BuilderContext = { outcomes: outcomeInfo, taught: new Set(sec.states.keys()), bank, marksOf: marks, unmarkedTypes, exposure, layout };

  const sectionWeak = [...sec.states.entries()].map(([loCode, per]) => ({
    loCode,
    weakPct: sectionOutcomeSummary([...per.values()].map((s) => s.state), sec.assessments.get(loCode) ?? 0, policy.resolved).weakPct,
  }));
  // PR-J (D-#1420): a question on any child's open extra sheet is seen by that child, so Part A (class-wide) avoids it.
  const extraSeen = await openExtraSeen(ctx.sectionId, input.subject);
  const openExtraQids = new Set([...extraSeen.values()].flatMap((q) => [...q]));
  // AL-3 (D-#1667, §4.3): never a homework question of the year, never a use in the no-repeat window — Part A
  // (class-wide) avoids every row of the শাখা, Part B each child's own rows. Read always; only R19 / R21 wait for the switch.
  const ledger = await avoidFor({
    sectionId: ctx.sectionId, academicYearId: ctx.academicYearId, classToken: ctx.classToken, subject: input.subject,
    studentIds: roster.map((st) => String(st._id)),
  });
  // Switch OFF: the ledger only widens the SOFT "seen" set, so Part A's fallback (a seen question when no unseen one
  // exists) still works exactly as in 2026. Switch ON: the hard rules of §4.3 (hardAvoid, no fallback).
  const loopOn = await isLoop2027On();
  const partA = buildPartA(
    sectionWeak, policy.resolved.sectionTriggerPct,
    new Set([...studentsByQid.keys(), ...openExtraQids, ...(loopOn ? [] : ledger.forSection)]), bctx,
    new Set([...openExtraQids, ...(loopOn ? ledger.forSection : [])]),
  );
  const partAQids = new Set(partA.map((q) => q.qid));

  const now = new Date();
  const by = oid(auth.userId);
  const toDoc = (q: (typeof partA)[number]): MasteryAssignmentQuestion => ({
    origin: q.origin, artifactId: oid(q.artifactId), qid: q.qid, textBn: q.textBn ?? undefined, loCode: q.loCode,
    chapterNumber: q.chapterNumber, questionTypeCode: q.questionTypeCode, marks: q.marks, band: q.band,
    ...(q.stimulusRef ? { stimulusRef: q.stimulusRef } : {}),
  });
  if (!a) {
    a = new MasteryAssignment({
      sectionId: ctx.sectionId, classId: ctx.classId, academicYearId: ctx.academicYearId, classToken: ctx.classToken,
      subject: input.subject, dueDate: due, week, status: "DRAFT", builtBy: by,
    });
  }
  a.dueDate = due;
  a.layout = layout;
  a.rememberLayout = input.rememberLayout;
  a.partA = partA.map(toDoc);
  a.asItemId = asItemId;
  a.builtAt = now;
  a.builtBy = by;
  await a.save();

  const existing = new Map((await MasteryAssignmentSheet.find({ assignmentId: a._id }).lean()).map((s) => [String(s.studentId), s]));
  for (const st of roster) {
    const sid = String(st._id);
    if (existing.get(sid)?.edited) continue; // the teacher's own changes survive a rebuild
    const states = new Map(
      [...sec.states.entries()].flatMap(([lo, per]) => {
        const s = per.get(sid);
        return s ? [[lo, { state: s.state, lastEvidenceAt: s.lastEvidenceAt, seenQids: extraSeen.has(sid) ? [...new Set([...s.seenQids, ...extraSeen.get(sid)!])] : s.seenQids }] as const] : [];
      }),
    );
    const built = buildPartB(states, bctx, new Set([...partAQids, ...ledger.forChild(sid)]));
    await MasteryAssignmentSheet.updateOne(
      { assignmentId: a._id, studentId: st._id },
      {
        $set: {
          items: built.items.map(toDoc),
          warnings: built.warnings,
          status: built.warnings.some((w) => w.code === "NO_UNSEEN_QUESTION" || w.code === "TYPE_HAS_NO_MARKS") ? "NEEDS_REVIEW" : "DRAFT",
          edited: false,
        },
        $unset: { approvedBy: 1 },
      },
      { upsert: true },
    );
  }
  void writeAudit({
    eventKind: "MASTERY_ASSIGNMENT_BUILT",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryAssignment",
    targetId: a._id,
    meta: { sectionId: input.sectionId, subject: input.subject, week, students: roster.length, partA: partA.length },
  });
  return assignmentView(a);
}

// ---------------------------------------------------------------------------
// One student's sheet
// ---------------------------------------------------------------------------

export interface SheetDetail {
  assignmentId: string;
  assignmentStatus: string;
  studentId: string;
  name: string;
  rollNumber: string | null;
  status: string;
  marks: number;
  targetMarks: number;
  items: QuestionView[];
  warnings: { code: string; loCode: string | null; labelBn: string | null }[];
  /** Outcomes this student could get a teacher-written question on (locked, question-assessed). */
  outcomeChoices: { loCode: string; labelBn: string; questionTypeCodes: string[] }[];
  /** PR-K: every active type of the class x subject marks table (with marks) - the add-own chips; the objective's list only orders them. */
  typeChoices: { code: string; labelBn: string; marks: number }[];
  /** AL-8: the caller may edit this sheet (the same rule the edit mutation applies); false = a read-only reader. */
  mayEdit?: boolean | null;
}

async function sheetDetailOf(a: IMasteryAssignment, sheet: IMasteryAssignmentSheet | (IMasteryAssignmentSheet & object)): Promise<SheetDetail> {
  const [outcomes, types, st] = await Promise.all([
    lockedOutcomes(a.classToken, a.subject),
    MasteryQuestionType.find({ classToken: a.classToken, subject: a.subject, active: true }).sort({ code: 1 }).select("code labelBn marks").lean(),
    rosterOf(a.sectionId).then((r) => r.find((x) => String(x._id) === String(sheet.studentId))),
  ]);
  const labels = new Map(outcomes.map((o) => [o.code, o.labelBn]));
  return {
    assignmentId: String(a._id),
    assignmentStatus: a.status,
    studentId: String(sheet.studentId),
    name: st ? personName(st) : "",
    rollNumber: st?.rollNumber ?? null,
    status: sheet.status,
    marks: sum(sheet.items),
    targetMarks: a.layout.partBMarks,
    items: sheet.items.map((q) => questionView(q, labels)),
    warnings: sheet.warnings.map((w) => ({ code: w.code, loCode: w.loCode ?? null, labelBn: w.loCode ? labels.get(w.loCode) ?? w.loCode : null })),
    outcomeChoices: outcomes
      .filter((o) => o.assess === "QUESTION" && isTaggedRow(o))
      .map((o) => ({ loCode: o.code, labelBn: o.labelBn, questionTypeCodes: o.questionTypeCodes ?? [] })),
    typeChoices: types.filter((x) => typeof x.marks === "number" && x.marks > 0).map((x) => ({ code: x.code, labelBn: x.labelBn, marks: x.marks as number })),
  };
}

async function loadSheet(a: IMasteryAssignment, studentId: string): Promise<IMasteryAssignmentSheet> {
  if (!Types.ObjectId.isValid(studentId)) throw new MasteryWorkError("শিক্ষার্থী পাওয়া যায়নি।");
  const s = await MasteryAssignmentSheet.findOne({ assignmentId: a._id, studentId: oid(studentId) });
  if (!s) throw new MasteryWorkError("এই শিক্ষার্থীর শিট পাওয়া যায়নি।");
  return s;
}

export async function sheetDetail(assignmentId: string, studentId: string, auth: Auth): Promise<SheetDetail> {
  try {
    const { a } = await loadForFinalise(assignmentId, auth); // = the row rule, plus the Office on a teacher's leave day (switch on)
    return { ...(await sheetDetailOf(a, await loadSheet(a, studentId))), mayEdit: a.status === "DRAFT" };
  } catch (err) {
    // AL-8 (switch on): the week's readers (class teacher, the week's subject teachers, today's substitute, the Office) read a
    // child's sheet READ-ONLY. Anyone else keeps the refusal above.
    if (!Types.ObjectId.isValid(assignmentId) || !(await isLoop2027On())) throw err;
    const a = await MasteryAssignment.findById(assignmentId);
    if (!a || !(await mayReadAssignment(a, auth))) throw err;
    return { ...(await sheetDetailOf(a, await loadSheet(a, studentId))), mayEdit: false };
  }
}

/** AL-8: can this caller change / finalise the draft? Exactly `loadForFinalise` (the row rule, or the Office on a leave day) on a DRAFT. */
export async function mayChangeDraft(a: IMasteryAssignment, auth: Auth): Promise<boolean> {
  if (a.status !== "DRAFT") return false;
  try {
    await loadForFinalise(String(a._id), auth);
    return true;
  } catch {
    return false;
  }
}

/** AL-8 (§4.6): a bank question a teacher may add — it passed the §4.3 re-check; `repeat` = seen before ("আবার", listed last). */
export interface AddCandidate {
  qid: string;
  textBn: string | null;
  loCode: string;
  labelBn: string;
  questionTypeCode: string;
  marks: number;
  repeat: boolean;
}

/**
 * AL-8: the bank questions the caller may ADD to the draft's common part (`studentId` null) or one child's Part B — the §4.3
 * exclusions applied once for the whole bank (a homework question of the year, anything used inside the no-repeat window, a
 * question already on the sheet, a type with no marks are left out). Questions the শাখা / child had before the window are
 * listed LAST, flagged `repeat`. `filter` is a text / code / objective search. Same reach as the edit mutations.
 */
export async function addCandidates(assignmentId: string, studentId: string | null, filter: string | null | undefined, auth: Auth, limit = 40): Promise<AddCandidate[]> {
  if (!(await isLoop2027On())) throw new MasteryWorkError(NOT_ON_MESSAGE);
  const { a } = await loadForFinalise(assignmentId, auth);
  assertDraft(a);
  const outcomes = (await lockedOutcomes(a.classToken, a.subject)).filter((o) => o.assess === "QUESTION" && isTaggedRow(o));
  const infos = new Map<string, OutcomeInfo>(outcomes.map((o) => [o.code, { code: o.code, chapterNumber: o.chapterNumber ?? null, questionTypeCodes: o.questionTypeCodes ?? [] }]));
  const labels = new Map(outcomes.map((o) => [o.code, o.labelBn]));
  const bank = await goldBank([...infos.keys()]);
  const sheets = await MasteryAssignmentSheet.find({ assignmentId: a._id }).select("studentId items.qid").lean();
  const on = new Set<string>(a.partA.map((q) => q.qid).filter((x): x is string => Boolean(x)));
  for (const s of sheets) if (!studentId || String(s.studentId) === studentId) for (const q of s.items) if (q.qid) on.add(q.qid);
  const sids = studentId ? [studentId] : (await rosterOf(a.sectionId)).map((s) => String(s._id));
  const weeks = await noRepeatWeeks(a.classToken, a.subject);
  const [hw, win, rows, marks] = await Promise.all([
    homeworkUsedThisYear({ sectionIds: [a.sectionId], academicYearId: a.academicYearId, studentIds: sids, subject: a.subject }),
    usedInWindow({ sectionIds: [a.sectionId], studentIds: sids, sinceDay: windowStartKey(todayKey(), weeks * 7), subject: a.subject }),
    liveRowsWithMerges(a.sectionId, a.subject),
    marksTable(a.classToken, a.subject),
  ]);
  const hwQ = qidsOf(hw, studentId ?? undefined);
  const winQ = qidsOf(win, studentId ?? undefined);
  const seenQ = new Set(rows.filter((r) => r.qid && (!studentId || r.studentId === studentId)).map((r) => r.qid as string));
  const needle = (filter ?? "").trim().toLowerCase();
  const out: AddCandidate[] = [];
  for (const q of bank) {
    if (on.has(q.qid) || hwQ.has(q.qid) || winQ.has(q.qid)) continue;
    const lo = q.loCodes.find((c) => infos.has(c));
    if (!lo) continue;
    const info = infos.get(lo)!;
    const qt = typeOfQuestion(q, info, { marksOf: marks, layout: OPEN_LAYOUT }, undefined);
    if (!qt) continue;
    const labelBn = labels.get(lo) ?? lo;
    if (needle && ![q.qid, q.textBn ?? "", lo, labelBn].some((t) => t.toLowerCase().includes(needle))) continue;
    out.push({ qid: q.qid, textBn: q.textBn ?? null, loCode: lo, labelBn, questionTypeCode: qt, marks: marks.get(qt)!, repeat: seenQ.has(q.qid) });
  }
  out.sort((x, y) => Number(x.repeat) - Number(y.repeat) || x.loCode.localeCompare(y.loCode) || x.qid.localeCompare(y.qid));
  return out.slice(0, Math.max(1, Math.min(limit, 100)));
}

export type SheetOp = "SWAP" | "REMOVE" | "ADD_OWN" | "ADD_BANK" | "APPROVE";

export interface SheetEdit {
  op: SheetOp;
  index?: number | null;
  loCode?: string | null;
  questionTypeCode?: string | null;
  textBn?: string | null;
  /** ADD_BANK (AL-7): the bank question to add. */
  qid?: string | null;
}

const NOT_ON_MESSAGE = "এই সুবিধা এখনো চালু হয়নি।";
const OPEN_LAYOUT = { partAOn: false, partAMarks: 0, partALoCodes: [] as string[], partBMarks: 0, mixWeak: 0, mixImproving: 0, mixRevision: 0, questionTypeCodes: [] as string[] };

export interface AddableQuestion {
  q: BankQuestion & { textBn: string | null };
  loCode: string;
  info: OutcomeInfo;
  questionTypeCode: string;
  marks: number;
  /** The শাখা (Part A) / the child (Part B) has seen it before — shown "আবার". */
  repeat: boolean;
}

/**
 * The §4.3 re-check of a bank question a teacher adds to an engine draft (AL-7, AC-C3): a homework question of the year
 * and any use inside the no-repeat window are refused with the reason; an unseen gold question passes. `studentId` = a
 * child's Part B (that child's own rows + the শাখা's), null = Part A. A question the child saw BEFORE the window is
 * allowed (it is how a NEEDS_REVIEW shortfall is resolved) and marked "আবার".
 */
export async function checkAddable(a: IMasteryAssignment, qid: string | null | undefined, studentId: string | null, alreadyOn: Set<string>): Promise<AddableQuestion> {
  const want = (qid ?? "").trim();
  if (!want) throw new MasteryWorkError("প্রশ্নের কোড দিন।");
  const outcomes = (await lockedOutcomes(a.classToken, a.subject)).filter((o) => o.assess === "QUESTION" && isTaggedRow(o));
  const infos = new Map<string, OutcomeInfo>(outcomes.map((o) => [o.code, { code: o.code, chapterNumber: o.chapterNumber ?? null, questionTypeCodes: o.questionTypeCodes ?? [] }]));
  const bank = await goldBank([...infos.keys()]);
  const q = bank.find((x) => x.qid === want);
  const lo = q?.loCodes.find((c) => infos.has(c));
  if (!q || !lo) throw new MasteryWorkError("এই প্রশ্নটি গোল্ড ব্যাংকে নেই, বা পরীক্ষার জন্য রাখা, বা এই শ্রেণি-বিষয়ের প্রশ্নভিত্তিক তালিকায় ট্যাগ করা নেই।");
  if (alreadyOn.has(q.qid)) throw new MasteryWorkError("প্রশ্নটি এই অ্যাসাইনমেন্টে আগেই আছে।");
  // Part A (no child): every child of the roster, so per-child rows and the rows a child earned in an earlier শাখা count too.
  const sids = studentId ? [studentId] : (await rosterOf(a.sectionId)).map((s) => String(s._id));
  const weeks = await noRepeatWeeks(a.classToken, a.subject);
  const [hw, win] = await Promise.all([
    homeworkUsedThisYear({ sectionIds: [a.sectionId], academicYearId: a.academicYearId, studentIds: sids, subject: a.subject }),
    usedInWindow({ sectionIds: [a.sectionId], studentIds: sids, sinceDay: windowStartKey(todayKey(), weeks * 7), subject: a.subject }),
  ]);
  if (qidsOf(hw, studentId ?? undefined).has(q.qid)) {
    throw new MasteryWorkError("এই প্রশ্নটি এই শিক্ষাবর্ষে বাড়ির কাজে দেওয়া হয়েছে — বাড়ির কাজের প্রশ্ন অ্যাসাইনমেন্টে দেওয়া যায় না।");
  }
  if (qidsOf(win, studentId ?? undefined).has(q.qid)) {
    throw new MasteryWorkError(`এই প্রশ্নটি গত ${bn(weeks)} সপ্তাহের মধ্যে দেওয়া হয়েছে — এখন আবার দেওয়া যায় না।`);
  }
  const marks = await marksTable(a.classToken, a.subject);
  const info = infos.get(lo)!;
  const qt = typeOfQuestion(q, info, { marksOf: marks, layout: OPEN_LAYOUT }, undefined);
  if (!qt) throw new MasteryWorkError("এই প্রশ্নের ধরনের নম্বর ঠিক করা নেই — নম্বর-তালিকা ঠিক করে তারপর যোগ করুন।");
  // A question the child (or, Part A, any child) has seen before the window is allowed ONLY as "আবার" — it is how a NEEDS_REVIEW
  // shortfall is resolved (§4.6). Mastery stays safe: only a child's FIRST attempt at a question counts as evidence, so a
  // repeat can never prove mastery (the same rule that keeps seen questions out of the engine's own Part B).
  const seen = (await liveRowsWithMerges(a.sectionId, a.subject, lo)).some((r) => r.qid === q.qid && (!studentId || r.studentId === studentId));
  return { q, loCode: lo, info, questionTypeCode: qt, marks: marks.get(qt)!, repeat: seen };
}

/** An edit to an engine draft: mark it edited and write the `AS_SUGGESTION_EDIT` audit row (before / after qid, who). */
async function auditSuggestionEdit(
  a: IMasteryAssignment,
  auth: Auth,
  meta: { op: string; part: "A" | "B"; studentId?: string; beforeQid: string | null; afterQid: string | null },
): Promise<void> {
  if (!a.suggestion) return; // a hand-built assignment writes no suggestion audit (2026 flow unchanged)
  a.suggestion.editedAt = new Date();
  a.markModified("suggestion");
  await a.save();
  void writeAudit({
    eventKind: "AS_SUGGESTION_EDIT",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryAssignment",
    targetId: a._id,
    meta: { ...meta, week: a.week, subject: a.subject },
  });
}

export async function editSheet(assignmentId: string, studentId: string, edit: SheetEdit, auth: Auth): Promise<SheetDetail> {
  const { a } = await loadForFinalise(assignmentId, auth);
  assertDraft(a);
  const sheet = await loadSheet(a, studentId);
  let beforeQid: string | null = null;
  let afterQid: string | null = null;
  const at = (i: number | null | undefined) => {
    if (i === null || i === undefined || !Number.isInteger(i) || i < 0 || i >= sheet.items.length) throw new MasteryWorkError("প্রশ্নটি পাওয়া যায়নি।");
    return i;
  };

  if (edit.op === "APPROVE") {
    sheet.status = "APPROVED";
    sheet.approvedBy = Types.ObjectId.isValid(auth.userId) ? oid(auth.userId) : undefined;
  } else {
    if (edit.op === "REMOVE") {
      const i = at(edit.index);
      beforeQid = sheet.items[i].qid ?? null;
      sheet.items.splice(i, 1);
    } else if (edit.op === "ADD_BANK") {
      // AL-7 (AC-C3): a bank question re-checked against §4.3 — a homework question or an in-window repeat is refused.
      if (!(await isLoop2027On())) throw new MasteryWorkError(NOT_ON_MESSAGE);
      const on = new Set([...sheet.items, ...a.partA].map((x) => x.qid).filter((x): x is string => Boolean(x)));
      const add = await checkAddable(a, edit.qid, studentId, on);
      sheet.items.push({
        origin: "BANK", artifactId: oid(add.q.artifactId), qid: add.q.qid, textBn: add.q.textBn ?? undefined, loCode: add.loCode,
        chapterNumber: add.info.chapterNumber, questionTypeCode: add.questionTypeCode, marks: add.marks, band: "TEACHER",
        reasonBn: add.repeat ? "আবার — শিক্ষকের যোগ করা প্রশ্ন" : "শিক্ষকের যোগ করা প্রশ্ন", repeat: add.repeat,
        ...(add.q.stimulusRef ? { stimulusRef: add.q.stimulusRef } : {}),
      });
      afterQid = add.q.qid;
      sheet.warnings = sheet.warnings.filter((w) => w.loCode !== add.loCode);
    } else if (edit.op === "SWAP") {
      const i = at(edit.index);
      const cur = sheet.items[i];
      beforeQid = cur.qid ?? null;
      if (cur.origin !== "BANK") throw new MasteryWorkError("নিজের লেখা প্রশ্ন বদলাতে সরিয়ে নতুন লিখুন।");
      const rows = await liveSectionRows(a.sectionId, a.subject, cur.loCode);
      const seen = new Set(rows.filter((r) => r.studentId === studentId && r.qid).map((r) => r.qid as string));
      for (const q of [...sheet.items, ...a.partA]) if (q.qid) seen.add(q.qid);
      for (const q of (await openExtraSeen(a.sectionId, a.subject)).get(studentId) ?? []) seen.add(q);
      // AL-3: a swap-in is no more a homework question of the year / in-window repeat than a built item.
      const ledger = await avoidFor({ sectionId: a.sectionId, academicYearId: a.academicYearId, classToken: a.classToken, subject: a.subject, studentIds: [studentId] });
      for (const q of ledger.forChild(studentId)) seen.add(q);
      const exposure = new Map<string, number>();
      for (const r of rows) if (r.qid) exposure.set(r.qid, (exposure.get(r.qid) ?? 0) + 1);
      // PR-G: the item keeps its type and marks, so a swap-in that carries a different type is not a candidate.
      const goldHere = await goldBank([cur.loCode]);
      const next = pickQuestion(cur.loCode, seen, { bank: goldHere.filter((q) => !q.qtCode || q.qtCode === cur.questionTypeCode), exposure });
      if (!next) throw new MasteryWorkError("এই কোডে এই শিক্ষার্থীর জন্য আর নতুন গোল্ড প্রশ্ন নেই — নিজে লিখুন।");
      const bank = goldHere.find((q) => q.qid === next.qid);
      sheet.items.splice(i, 1, {
        origin: "BANK", artifactId: oid(next.artifactId), qid: next.qid, textBn: bank?.textBn ?? undefined, loCode: cur.loCode,
        chapterNumber: cur.chapterNumber ?? null, questionTypeCode: cur.questionTypeCode, marks: cur.marks, band: cur.band,
        ...(a.suggestion ? { reasonBn: "বদলানো প্রশ্ন", repeat: false } : {}),
        ...(next.stimulusRef ? { stimulusRef: next.stimulusRef } : {}),
      });
      afterQid = next.qid;
      // A swapped-in part joins its stem's other parts (D-#926).
      if (next.stimulusRef) {
        const plain = sheet.items.map((x) => {
          const d = x as unknown as { toObject?: () => MasteryAssignmentQuestion };
          return d.toObject ? d.toObject() : x;
        });
        sheet.set("items", groupStimulusParts(plain));
      }
    } else if (edit.op === "ADD_OWN") {
      const text = (edit.textBn ?? "").trim();
      if (!text) throw new MasteryWorkError("নিজের প্রশ্নের লেখা দিন।");
      const grouping = await untaggedRefusal([edit.loCode ?? ""]);
      if (grouping) throw new MasteryWorkError(grouping);
      const o = (await lockedOutcomes(a.classToken, a.subject)).find((x) => x.code === edit.loCode && x.assess === "QUESTION" && isTaggedRow(x));
      if (!o) throw new MasteryWorkError("কোডটি এই শ্রেণি-বিষয়ের প্রশ্নভিত্তিক তালিকায় নেই।");
      const qt = edit.questionTypeCode ?? "";
      // PR-K: any active type of this class × subject's marks table (the objective's list only suggests).
      const m = (await marksTable(a.classToken, a.subject)).get(qt);
      if (!m) throw new MasteryWorkError(`${qt}-এর নম্বর ঠিক করা নেই।`);
      sheet.items.push({ origin: "TEACHER", textBn: text, loCode: o.code, chapterNumber: o.chapterNumber ?? null, questionTypeCode: qt, marks: m, band: "TEACHER" });
      sheet.warnings = sheet.warnings.filter((w) => w.loCode !== o.code);
    } else {
      throw new MasteryWorkError("অজানা কাজ।");
    }
    sheet.edited = true;
    sheet.approvedBy = undefined;
    sheet.status = sheet.warnings.some((w) => w.code === "NO_UNSEEN_QUESTION" || w.code === "TYPE_HAS_NO_MARKS") ? "NEEDS_REVIEW" : "DRAFT";
  }
  await sheet.save();
  if (edit.op !== "APPROVE") await auditSuggestionEdit(a, auth, { op: edit.op, part: "B", studentId, beforeQid, afterQid });
  return sheetDetailOf(a, sheet);
}

export interface PartAEdit {
  op: "SWAP" | "REMOVE" | "ADD_BANK";
  index?: number | null;
  qid?: string | null;
}

/**
 * AL-7 (§4.6): the common part of an engine draft — swap (another unseen question of the same objective that passes
 * §4.3), remove, add a bank question (re-checked, AC-C3). Switch on only; each change writes `AS_SUGGESTION_EDIT`.
 */
export async function editPartA(assignmentId: string, edit: PartAEdit, auth: Auth): Promise<AssignmentView> {
  if (!(await isLoop2027On())) throw new MasteryWorkError(NOT_ON_MESSAGE);
  const { a } = await loadForFinalise(assignmentId, auth);
  assertDraft(a);
  const at = (i: number | null | undefined) => {
    if (i === null || i === undefined || !Number.isInteger(i) || i < 0 || i >= a.partA.length) throw new MasteryWorkError("প্রশ্নটি পাওয়া যায়নি।");
    return i;
  };
  let beforeQid: string | null = null;
  let afterQid: string | null = null;
  if (edit.op === "REMOVE") {
    const i = at(edit.index);
    beforeQid = a.partA[i].qid ?? null;
    a.partA.splice(i, 1);
  } else if (edit.op === "ADD_BANK") {
    const sheetItems = (await MasteryAssignmentSheet.find({ assignmentId: a._id }).select("items.qid").lean()).flatMap((s) => s.items);
    const on = new Set([...a.partA, ...sheetItems].map((x) => x.qid).filter((x): x is string => Boolean(x)));
    const add = await checkAddable(a, edit.qid, null, on);
    a.partA.push({
      origin: "BANK", artifactId: oid(add.q.artifactId), qid: add.q.qid, textBn: add.q.textBn ?? undefined, loCode: add.loCode,
      chapterNumber: add.info.chapterNumber, questionTypeCode: add.questionTypeCode, marks: add.marks, band: "SECTION",
      reasonBn: add.repeat ? "আবার — শিক্ষকের যোগ করা প্রশ্ন" : "শিক্ষকের যোগ করা প্রশ্ন", repeat: add.repeat,
      ...(add.q.stimulusRef ? { stimulusRef: add.q.stimulusRef } : {}),
    });
    afterQid = add.q.qid;
  } else if (edit.op === "SWAP") {
    const i = at(edit.index);
    const cur = a.partA[i];
    beforeQid = cur.qid ?? null;
    if (cur.origin !== "BANK") throw new MasteryWorkError("নিজের লেখা প্রশ্ন বদলাতে সরিয়ে নতুন লিখুন।");
    const rows = await liveRowsWithMerges(a.sectionId, a.subject, cur.loCode);
    const roster = await rosterOf(a.sectionId);
    const ledger = await avoidFor({ sectionId: a.sectionId, academicYearId: a.academicYearId, classToken: a.classToken, subject: a.subject, studentIds: roster.map((s) => String(s._id)) });
    const avoid = new Set<string>([...ledger.forSection, ...rows.map((r) => r.qid).filter((x): x is string => Boolean(x))]);
    for (const q of [...a.partA, ...(await MasteryAssignmentSheet.find({ assignmentId: a._id }).select("items.qid").lean()).flatMap((s) => s.items)]) if (q.qid) avoid.add(q.qid);
    for (const q of [...(await openExtraSeenWithMerges(a.sectionId, a.subject)).values()].flatMap((s) => [...s])) avoid.add(q);
    const exposure = new Map<string, number>();
    for (const r of rows) if (r.qid) exposure.set(r.qid, (exposure.get(r.qid) ?? 0) + 1);
    const goldHere = await goldBank([cur.loCode]);
    const next = pickQuestion(cur.loCode, avoid, { bank: goldHere.filter((q) => !q.qtCode || q.qtCode === cur.questionTypeCode), exposure });
    if (!next) throw new MasteryWorkError("এই কোডে আর নতুন গোল্ড প্রশ্ন নেই — নিজে যোগ করুন।");
    const bank = goldHere.find((q) => q.qid === next.qid);
    a.partA.splice(i, 1, {
      origin: "BANK", artifactId: oid(next.artifactId), qid: next.qid, textBn: bank?.textBn ?? undefined, loCode: cur.loCode,
      chapterNumber: cur.chapterNumber ?? null, questionTypeCode: cur.questionTypeCode, marks: cur.marks, band: cur.band,
      reasonBn: "বদলানো প্রশ্ন", repeat: false,
      ...(next.stimulusRef ? { stimulusRef: next.stimulusRef } : {}),
    });
    afterQid = next.qid;
  } else {
    throw new MasteryWorkError("অজানা কাজ।");
  }
  a.markModified("partA");
  await a.save();
  await auditSuggestionEdit(a, auth, { op: edit.op, part: "A", beforeQid, afterQid });
  return assignmentView(a);
}

/** An approved staff leave covering `dateKey` (the same rule the mistake notes use). Never throws. */
export async function teacherOnApprovedLeave(userId: string | null | undefined, dateKey: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const profile = await resolveStaffProfileForUser(userId);
    if (!profile) return false;
    return !!(await StaffLeaveApplication.exists({ staffProfileId: profile._id, status: "approved", fromKey: { $lte: dateKey }, toKey: { $gte: dateKey } }));
  } catch {
    return false;
  }
}

/** Wednesday / Thursday (Dhaka) — the days R28 lets the substitute or the Office finalise for a teacher on leave. */
export const isFinaliseLeaveDay = (dayKey: string): boolean => [3, 4].includes(new Date(`${dayKey}T00:00:00.000Z`).getUTCDay());

/**
 * Finalise reach (AL-7, AC-C14, R28): the subject teacher, `mastery:edit_all` or today's substitute (the row rule), and — with
 * the switch on — a holder of `assignment:finalise_on_leave` (the Office) while the subject teacher is on approved leave on
 * the Wednesday or Thursday. Any other caller, and the Office on a normal day, is refused in Bangla.
 */
async function loadForFinalise(id: string, auth: Auth): Promise<{ a: IMasteryAssignment; viaLeave: boolean; bySubstitute: boolean }> {
  if (!Types.ObjectId.isValid(id)) throw new MasteryWorkError("অ্যাসাইনমেন্ট পাওয়া যায়নি।");
  const a = await MasteryAssignment.findById(id);
  if (!a) throw new MasteryWorkError("অ্যাসাইনমেন্ট পাওয়া যায়নি।");
  try {
    await assertMayWork(auth, a.sectionId, a.subject, new Date());
    // No wider reach than the row rule + the build permission (switch on or off): an Office login that merely holds a routine
    // slot of the শাখা is not a mastery builder.
    if (!callerHasPermission(auth, "mastery:create")) throw new MasteryWorkError("রুটিন অনুযায়ী এই শাখা ও বিষয়ের দায়িত্ব আপনার নয়।");
    const teacher = await resolveSubjectTeacher(String(a.sectionId), a.subject, new Date());
    const bySubstitute = Boolean(teacher && teacher !== String(auth.userId) && !callerHasPermission(auth, "mastery:edit_all") && (await isLoop2027On()));
    return { a, viaLeave: false, bySubstitute };
  } catch (err) {
    if (!(await isLoop2027On()) || !callerHasPermission(auth, "assignment:finalise_on_leave")) throw err;
    const today = dhakaDayKey(new Date());
    const teacher = await resolveSubjectTeacher(String(a.sectionId), a.subject, new Date());
    if (isFinaliseLeaveDay(today) && (await teacherOnApprovedLeave(teacher, today))) return { a, viaLeave: true, bySubstitute: false };
    throw new MasteryWorkError("বিষয়শিক্ষক ছুটিতে (বুধ বা বৃহস্পতিবার) না থাকলে অফিস অ্যাসাইনমেন্ট চূড়ান্ত করতে পারে না।");
  }
}

export async function approveAllSheets(assignmentId: string, auth: Auth): Promise<AssignmentView> {
  const { a } = await loadForFinalise(assignmentId, auth);
  assertDraft(a);
  await MasteryAssignmentSheet.updateMany(
    { assignmentId: a._id, status: "DRAFT" },
    { $set: { status: "APPROVED", ...(Types.ObjectId.isValid(auth.userId) ? { approvedBy: oid(auth.userId) } : {}) } },
  );
  return assignmentView(a);
}

export async function deleteAssignment(assignmentId: string, auth: Auth): Promise<boolean> {
  const a = await loadAssignment(assignmentId, auth);
  assertDraft(a);
  await MasteryAssignmentSheet.deleteMany({ assignmentId: a._id });
  await MasteryAssignment.deleteOne({ _id: a._id, status: "DRAFT" });
  return true;
}

// ---------------------------------------------------------------------------
// Send: one AS paper for the section, each student's own item list
// ---------------------------------------------------------------------------

export async function sendAssignment(assignmentId: string, auth: Auth): Promise<AssignmentView> {
  const { a, viaLeave, bySubstitute } = await loadForFinalise(assignmentId, auth);
  assertDraft(a);
  await assertEnabled(
    { sectionId: a.sectionId, classId: a.classId, academicYearId: a.academicYearId, classToken: a.classToken },
    a.subject,
  );
  const [sheets, roster] = await Promise.all([MasteryAssignmentSheet.find({ assignmentId: a._id }).lean(), rosterOf(a.sectionId)]);
  // AL-7 (AC-C11, switch on): a sheet with a gap (no unseen question) is named, so nothing half-built reaches the print queue.
  if (await isLoop2027On()) {
    const gaps = sheets.filter((s) => s.status === "NEEDS_REVIEW");
    if (gaps.length > 0) {
      const names = new Map(roster.map((st) => [String(st._id), personName(st)]));
      const list = gaps.map((s) => names.get(String(s.studentId)) ?? "").filter(Boolean);
      throw new MasteryWorkError(
        `${bn(gaps.length)}টি শিটে প্রশ্নের ঘাটতি আছে (${list.slice(0, 6).join(", ")}${list.length > 6 ? "…" : ""}) — প্রশ্ন যোগ করুন বা শিটটি দেখে অনুমোদন দিন, তারপর চূড়ান্ত করুন।`,
      );
    }
  }
  // R28: the Office finalises the system's draft as it stands — its clean DRAFT sheets count as approved (written below, only
  // after every refusal here and in the budget check has passed).
  const pending = sheets.filter((s) => s.status !== "APPROVED" && !(viaLeave && s.status === "DRAFT")).length;
  if (pending > 0) throw new MasteryWorkError(`${bn(pending)}টি শিট এখনো অনুমোদন হয়নি।`);
  const bySid = new Map(sheets.map((s) => [String(s.studentId), s]));
  const ordered = roster.flatMap((st) => (bySid.has(String(st._id)) ? [bySid.get(String(st._id))!] : []));
  if (ordered.length === 0) throw new MasteryWorkError("পাঠানোর মতো কোনো শিট নেই।");
  // AL-6 (switch on): the week + day budget (AC-C4, AC-C9) and the tracker item this AS paper links to. Off → nothing here.
  const loop = (await isLoop2027On()) ? await import("./AssignmentPaperService") : null;
  const plan = loop ? await loop.planFinalise(a, ordered) : null;

  type Item = {
    itemNo: number; origin: "BANK" | "TEACHER"; artifactId?: Types.ObjectId; qid?: string; textBn?: string; loCodes: string[];
    chapterNumber: number | null; questionTypeCode: string; marks: number; stimulusRef?: string; partLabel?: string;
  };
  const items: Item[] = [];
  const keyNo = new Map<string, number>();
  const add = (q: MasteryAssignmentQuestion): number => {
    const key = q.origin === "BANK" ? `B:${String(q.artifactId)}:${q.questionTypeCode}` : `T:${q.loCode}:${q.questionTypeCode}:${q.textBn}`;
    const have = keyNo.get(key);
    if (have) return have;
    const itemNo = items.length + 1;
    items.push({
      itemNo, origin: q.origin, artifactId: q.artifactId, qid: q.qid, textBn: q.origin === "TEACHER" ? q.textBn : undefined,
      loCodes: [q.loCode], chapterNumber: q.chapterNumber ?? null, questionTypeCode: q.questionTypeCode, marks: q.marks,
      ...(q.stimulusRef ? { stimulusRef: q.stimulusRef } : {}),
    });
    keyNo.set(key, itemNo);
    return itemNo;
  };
  const partANos = (a.partA ?? []).map(add);
  if (viaLeave) {
    await MasteryAssignmentSheet.updateMany({ assignmentId: a._id, status: "DRAFT" }, { $set: { status: "APPROVED", ...(Types.ObjectId.isValid(auth.userId) ? { approvedBy: oid(auth.userId) } : {}) } });
  }
  const perStudentItems = ordered.map((s) => ({ studentId: s.studentId, itemNos: [...partANos, ...s.items.map(add)] }));
  // ক/খ (D-#926): the paper records each part's label among its stem's parts on this paper.
  partLabelsByItem(items).forEach((label, i) => {
    if (label) items[i].partLabel = label;
  });

  const paper = await MasteryPaper.create({
    paperId: await nextPaperId(a.classToken, a.subject),
    source: "AS",
    title: "সাপ্তাহিক অ্যাসাইনমেন্ট",
    sectionId: a.sectionId,
    classId: a.classId,
    academicYearId: a.academicYearId,
    classToken: a.classToken,
    subject: a.subject,
    date: a.dueDate,
    links: { assignmentId: a._id, ...(plan?.asItemId ? { asItemId: plan.asItemId } : a.asItemId ? { asItemId: a.asItemId } : {}) },
    // AL-6: an AS paper linked to its tracker item is a tracker paper — the §3.1 guards, the write-back and the lock apply.
    ...(plan?.asItemId ? { trackerLinked: true, extra: false } : {}),
    items,
    perStudentItems,
    rubricLoCodes: [],
    entryState: "OPEN",
    createdBy: Types.ObjectId.isValid(auth.userId) ? oid(auth.userId) : undefined,
  });
  // AL-3: the AS paper went to the children — Part A (on every sheet) is a whole-শাখা use, Part B per child.
  await recordUsesSafe(usesOfPaper(paper, "AS", { givenOn: dhakaDayKey(new Date()), wholeIfAll: true }));
  if (plan) {
    a.countedMinutes = plan.counted;
    if (plan.placement) {
      a.doOnDay = plan.placement.doOnDay;
      a.minutesByDay = plan.placement.minutesByDay;
    }
    if (plan.asItemId) a.asItemId = plan.asItemId;
  }
  a.status = "SENT";
  a.paperId = paper._id;
  a.sentAt = new Date();
  a.sentBy = Types.ObjectId.isValid(auth.userId) ? oid(auth.userId) : undefined;
  await a.save();
  if (loop && plan) await loop.afterSend(a, plan, auth.userId);
  try {
    const names = new Map(roster.map((st) => [String(st._id), personName(st)]));
    await notifyAssignmentSent({
      assignmentId: String(a._id),
      subject: a.subject,
      dueYmd: a.dueDate.toISOString().slice(0, 10),
      students: ordered.map((s) => ({ studentId: String(s.studentId), name: names.get(String(s.studentId)) ?? "" })),
    });
  } catch (err) {
    console.error("[mastery] assignment notice failed:", err);
  }
  // AL-7: finalised on (or after) the delivery day → the tracker item is delivered right away (best effort; the tick retries).
  if (loop && plan) {
    try {
      await (await import("./AssignmentSuggestionService")).deliverTailoredFor(a, new Date());
    } catch (err) {
      await (await import("../../../lib/reportError")).reportSilentFailure("assignment.deliverTailoredAtFinalise", err, { assignmentId: String(a._id) });
    }
  }
  void writeAudit({
    eventKind: "MASTERY_ASSIGNMENT_SENT",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryAssignment",
    targetId: a._id,
    meta: {
      paperId: paper.paperId, students: ordered.length, items: items.length, week: a.week,
      // AL-7 (R28): who finalised for a teacher on leave, and why.
      ...(viaLeave || bySubstitute ? { finalisedOnLeaveBy: auth.userId, reason: viaLeave ? "TEACHER_ON_LEAVE" : "SUBSTITUTE_COVER" } : {}),
    },
  });
  return assignmentView(a);
}

// ---------------------------------------------------------------------------
// Tracker link options (read-only)
// ---------------------------------------------------------------------------

export interface TrackerOption {
  asItemId: string;
  asId: string;
  dueDate: string;
  description: string | null;
}

/** The section × subject's tracker assignment items due in the last / next 4 weeks. */
export async function trackerOptions(sectionId: string, subject: MasterySubject, auth: Auth): Promise<TrackerOption[]> {
  const ctx = await sectionContext(sectionId);
  await assertMayWork(auth, ctx.sectionId, subject, new Date());
  const from = new Date(Date.now() - 28 * 86_400_000);
  const to = new Date(Date.now() + 28 * 86_400_000);
  const rows = await AssignmentItem.find({ sectionId: ctx.sectionId, subject, dueDate: { $gte: from, $lte: to } })
    .select("asId dueDate description")
    .sort({ dueDate: -1 })
    .lean(); // bounded by the window: one item per section × subject × week
  return rows.map((r) => ({ asItemId: String(r._id), asId: r.asId, dueDate: new Date(r.dueDate).toISOString().slice(0, 10), description: r.description ?? null }));
}

// ---------------------------------------------------------------------------
// PDF — one A4 page per student: header, Part A, Part B, answer + marks boxes, code footer
// ---------------------------------------------------------------------------

const FONT_PATH = path.resolve(__dirname, "../../../../assets/fonts/NotoSansBengali-Regular.ttf");

export async function renderAssignmentPdf(assignmentId: string, studentId: string | null, auth: Auth): Promise<{ pdf: Buffer; filename: string }> {
  return renderPdfOf(await loadAssignment(assignmentId, auth), studentId, "STAFF");
}

/**
 * The code line in the PDF footer (OT-3, D-#923 / #925), named with the level word from পলিসি.
 * STAFF copy: the tagged codes as printed on the questions ("<objective word> / <sub word>: …" when
 * a sub-objective is among them). GUARDIAN copy: each code folded to its objective — never a
 * sub-objective code — under the objective word. `objectiveOf` maps a code to its objective code.
 */
export function pdfCodeLine(
  codes: string[],
  words: Pick<MasteryLevelLabels, "objectiveBn" | "subBn">,
  copy: "STAFF" | "GUARDIAN",
  objectiveOf: (code: string) => string | null,
): string {
  const short = (c: string) => c.replace(/^LO-[A-Z0-9]+-[A-Z][A-Z0-9]*-/, "");
  const list = copy === "GUARDIAN" ? codes.map((c) => objectiveOf(c)).filter((c): c is string => Boolean(c)) : codes;
  const uniq = [...new Set(list)];
  if (uniq.length === 0) return "";
  const hasSub = copy === "STAFF" && uniq.some((c) => /\.\d{1,2}$/.test(c));
  const word = hasSub ? `${words.objectiveBn} / ${words.subBn}` : words.objectiveBn;
  return `${word}: ${uniq.map(short).join(" · ")}`;
}

/**
 * A guardian's copy (M-4b): only a SENT assignment, only their child's page, only while the
 * add-on is on for that class × subject. The caller has already checked the guardian link.
 */
export async function renderAssignmentPdfForChild(assignmentId: string, studentId: string): Promise<{ pdf: Buffer; filename: string }> {
  const a = Types.ObjectId.isValid(assignmentId) ? await MasteryAssignment.findById(assignmentId) : null;
  const ok =
    a &&
    a.status === "SENT" &&
    Types.ObjectId.isValid(studentId) &&
    (await MasteryAssignmentSheet.exists({ assignmentId: a._id, studentId: oid(studentId) })) &&
    (await isMasteryEnabled(a.academicYearId, a.classToken, a.subject));
  if (!a || !ok) throw new MasteryWorkError("অ্যাসাইনমেন্ট পাওয়া যায়নি।");
  return renderPdfOf(a, studentId, "GUARDIAN");
}

/** The current stimulus (shared stem) of every part on the sheets: ref → title + body (D-#926). */
export async function stemsFor(items: { stimulusRef?: string | null }[]): Promise<Map<string, { title: string | null; content: string }>> {
  const refs = [...new Set(items.map((q) => q.stimulusRef).filter((r): r is string => Boolean(r)))];
  if (refs.length === 0) return new Map();
  const arts = await ContentArtifact.find({ docType: "stimulus", current: true, "envelopeJson.payload.stimulus_id": { $in: refs } })
    .select("envelopeJson.payload")
    .lean(); // bounded: the stems on one assignment
  const out = new Map<string, { title: string | null; content: string }>();
  for (const a of arts) {
    const p = ((a.envelopeJson ?? {}) as Record<string, unknown>).payload as Record<string, unknown> | undefined;
    if (typeof p?.stimulus_id !== "string") continue;
    out.set(p.stimulus_id, {
      title: typeof p.title === "string" ? p.title : null,
      content: typeof p.content === "string" ? p.content : "",
    });
  }
  return out;
}

async function renderPdfOf(a: IMasteryAssignment, studentId: string | null, copy: "STAFF" | "GUARDIAN"): Promise<{ pdf: Buffer; filename: string }> {
  const allCodes = [...(a.partA ?? []).map((q) => q.loCode)];
  const [sheets, roster, label, paper, words] = await Promise.all([
    MasteryAssignmentSheet.find({ assignmentId: a._id, ...(studentId && Types.ObjectId.isValid(studentId) ? { studentId: oid(studentId) } : {}) }).lean(),
    rosterOf(a.sectionId),
    sectionLabel(a.sectionId),
    a.paperId ? MasteryPaper.findById(a.paperId).select("paperId").lean() : null,
    masteryLevelLabels(),
  ]);
  if (studentId && sheets.length === 0) throw new MasteryWorkError("এই শিক্ষার্থীর শিট পাওয়া যায়নি।");
  for (const sh of sheets) allCodes.push(...sh.items.map((q) => q.loCode));
  const grain = copy === "GUARDIAN" ? await objectiveGrain(allCodes) : new Map<string, { code: string }>();
  const objectiveOf = (c: string) => grain.get(c)?.code ?? null;
  const bySid = new Map(sheets.map((s) => [String(s.studentId), s]));
  const pages = roster.flatMap((st) => (bySid.has(String(st._id)) ? [{ st, sheet: bySid.get(String(st._id))! }] : []));
  const subjectBn = (HW_SUBJECT_LABELS_BN as Record<string, string>)[a.subject] ?? a.subject;
  const code = paper?.paperId ?? `খসড়া · ${a.week}`;
  const partA = a.partA ?? [];
  const stems = await stemsFor([...partA, ...sheets.flatMap((s) => s.items)]);
  // AL-6b (§4.4): the day line — only an assignment finalised under the 2027 budget carries a split (`doOnDay`).
  const minutesPerMark = a.doOnDay ? (await budgetPolicy()).minutesPerMark : 0;
  // Each child's label comes from THEIR OWN questions and minutes: a sheet that fits Friday says "শুক্রবার".
  const dayLine = (sheetItems: MasteryAssignmentQuestion[]): string | null => {
    if (!a.doOnDay) return null;
    const lastA = printPlan(partA, 0).at(-1)?.no ?? 0;
    const lines = [...printPlan(partA, 0), ...printPlan(sheetItems, lastA)].map((l) => ({ no: l.no, marks: l.item.marks }));
    return childDayLabel("bn", a.doOnDay, lines, a.minutesByDay?.FRI ?? 0, minutesPerMark);
  };
  // 2027 sheets print the counted minutes (R26), not the layout's.
  const printedMinutes = typeof a.countedMinutes === "number" ? Math.round(a.countedMinutes) : a.layout.minutes;

  const pdf = await new Promise<Buffer>((resolve, reject) => {
    const M = 44;
    const doc = new PDFDocument({ size: "A4", margins: { top: M, bottom: M, left: M, right: M }, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont(BENGALI_FONT, FONT_PATH);
    const W = 595.28 - 2 * M;

    // `label` is the printed number: "৪." for a question, "৪(ক)" for a part (D-#926), "" for a
    // lone part under its stem (the stem line carries the number).
    const question = (label: string, q: MasteryAssignmentQuestion, indent = 24) => {
      const y0 = doc.y;
      doc.fontSize(12).fillColor("#111111");
      if (label) doc.font(BENGALI_FONT).text(label, M, y0, { width: indent });
      doc.x = M + indent;
      doc.y = y0;
      mixedText(doc, q.textBn ?? q.qid ?? "", { width: W - indent - 60 } as PDFKit.Mixins.TextOptions);
      const after = Math.max(doc.y, y0 + 16);
      doc.rect(M + W - 52, y0, 52, 22).strokeColor("#9AA59F").lineWidth(0.8).stroke();
      doc.fontSize(9).fillColor("#46554E").font(BENGALI_FONT).text(`/${bn(q.marks)}`, M + W - 52, y0 + 6, { width: 52, align: "center" });
      const boxH = q.marks <= 1 ? 26 : 48;
      doc.rect(M + indent, after + 4, W - indent - 60, boxH).strokeColor("#9AA59F").lineWidth(0.8).stroke();
      doc.x = M;
      doc.y = after + boxH + 12;
    };
    // The shared stem of a part group, printed once above its parts.
    const stem = (n: number, ref: string) => {
      const s = stems.get(ref);
      const y0 = doc.y;
      doc.fontSize(12).fillColor("#111111");
      doc.font(BENGALI_FONT).text(`${bn(n)}.`, M, y0, { width: 24 });
      doc.x = M + 24;
      doc.y = y0;
      const body = s ? [s.title, s.content].filter(Boolean).join("\n") : ref;
      mixedText(doc, body, { width: W - 24 - 60 } as PDFKit.Mixins.TextOptions);
      doc.x = M;
      doc.y = Math.max(doc.y, y0 + 16) + 6;
    };
    /** One part of the sheet, numbered from `startAt`; returns the last number used. */
    const questions = (items: MasteryAssignmentQuestion[], startAt: number): number => {
      let last = startAt;
      for (const line of printPlan(items, startAt)) {
        if (line.stimulusRef && line.startsGroup) stem(line.no, line.stimulusRef);
        if (line.partLabel) question(printLabel(bn(line.no), line.partLabel), line.item, 44);
        else if (line.stimulusRef) question("", line.item);
        else question(`${bn(line.no)}.`, line.item);
        last = line.no;
      }
      return last;
    };
    const head = (t: string, marks: number) => {
      const y = doc.y;
      doc.x = M;
      doc.fontSize(12).fillColor("#111111");
      mixedText(doc, t, { width: W - 90 } as PDFKit.Mixins.TextOptions);
      doc.font(BENGALI_FONT).fontSize(11).text(`${bn(marks)} নম্বর`, M + W - 90, y, { width: 90, align: "right" });
      const line = y + 20;
      doc.moveTo(M, line).lineTo(M + W, line).strokeColor("#111111").lineWidth(1.2).stroke();
      doc.x = M;
      doc.y = line + 8;
    };

    for (const { st, sheet } of pages) {
      doc.addPage();
      // The Bengali font has no middle dot; separators go through mixedText (Latin runs use Helvetica).
      doc.x = M;
      doc.y = M;
      doc.fontSize(17).fillColor("#111111");
      mixedText(doc, `সাপ্তাহিক অ্যাসাইনমেন্ট · ${subjectBn}`, { width: W - 170 } as PDFKit.Mixins.TextOptions);
      doc.fontSize(11);
      mixedText(doc, `${label.className} ${label.sectionName} · জমা: ${bn(a.dueDate.toISOString().slice(0, 10))} · সময় ${bn(printedMinutes)} মিনিট`, { width: W - 170 } as PDFKit.Mixins.TextOptions);
      const total = sum(partA) + sum(sheet.items);
      doc.fontSize(11).text(`নাম: ${personName(st)}`, M + W - 165, M, { width: 165, align: "right" });
      doc.text(`রোল: ${st.rollNumber ? bn(st.rollNumber) : "—"}`, { width: 165, align: "right" });
      doc.text(`পূর্ণমান: ${bn(total)}`, { width: 165, align: "right" });
      const when = dayLine(sheet.items);
      if (when) {
        doc.x = M;
        doc.fontSize(11);
        mixedText(doc, `কবে করবে: ${when}`, { width: W - 170 } as PDFKit.Mixins.TextOptions);
      }
      doc.y = Math.max(doc.y, M + 50);
      doc.moveTo(M, doc.y + 4).lineTo(M + W, doc.y + 4).strokeColor("#111111").lineWidth(2).stroke();
      doc.y += 14;
      let n = 0;
      if (partA.length > 0) {
        head("অংশ ক · সবার জন্য", sum(partA));
        n = questions(partA, n);
      }
      if (sheet.items.length > 0) {
        head(partA.length > 0 ? "অংশ খ · তোমার জন্য" : "তোমার জন্য", sum(sheet.items));
        n = questions(sheet.items, n);
      }
      const footY = 841.89 - M - 30;
      doc.moveTo(M, footY).lineTo(M + W, footY).strokeColor("#9AA59F").lineWidth(0.6).stroke();
      doc.fontSize(9).fillColor("#46554E").font(BENGALI_FONT).text("অভিভাবকের স্বাক্ষর: ____________________", M, footY + 6, { width: W / 2 });
      doc.font("Helvetica").fontSize(8).text(code, M + W / 2, footY + 6, { width: W / 2, align: "right" });
      const los = pdfCodeLine([...partA, ...sheet.items].map((q) => q.loCode), words, copy, objectiveOf);
      if (los) {
        doc.x = M + W / 2;
        doc.y = footY + 16;
        doc.fontSize(8);
        mixedText(doc, los, { width: W / 2, align: "right" } as PDFKit.Mixins.TextOptions);
      }
    }
    if (pages.length === 0) {
      doc.addPage();
      doc.font(BENGALI_FONT).fontSize(12).text("কোনো শিট নেই।");
    }
    doc.end();
  });
  return { pdf, filename: `assignment_${a.subject}_${a.week}${studentId ? `_${studentId}` : ""}` };
}
