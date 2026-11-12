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
import { buildPartA, buildPartB, pickQuestion, type BankQuestion, type BuilderContext, type OutcomeInfo } from "../assignmentBuilder";
import { sectionOutcomeSummary } from "../diagnosis";
import { loCodeMongoFilter, loCodesOf, questionTypeCodeOf } from "../bank";
import { groupStimulusParts, partLabelsByItem, printLabel, printPlan, stimulusRefOf } from "../parts";
import { isoWeekKey } from "../evidence";
import { notifyAssignmentSent } from "../notify";
import { isTaggedRow } from "../rollup";
import { untaggedRefusal } from "../taggedGuard";
import { masteryLevelLabels } from "./MasteryReviewService";
import { objectiveGrain } from "./MasteryGuardianService";
import type { MasteryLevelLabels } from "@scd/shared";

const oid = (s: string) => new Types.ObjectId(s);
const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const sum = (qs: { marks: number }[]) => qs.reduce((s, q) => s + q.marks, 0);

// ---------------------------------------------------------------------------
// Inputs and catalogue reads
// ---------------------------------------------------------------------------

export type LayoutInput = MasteryAssignmentLayout;

export async function marksTable(classToken: MasteryClassToken, subject: MasterySubject): Promise<Map<string, number>> {
  const rows = await MasteryQuestionType.find({ classToken, subject, active: true }).select("code marks").lean();
  return new Map(rows.filter((r) => typeof r.marks === "number" && r.marks > 0).map((r) => [r.code, r.marks as number]));
}

/** The gold, current, not-retired questions tagged with any of `codes`, with their text. */
export async function goldBank(codes: string[]): Promise<(BankQuestion & { textBn: string | null })[]> {
  if (codes.length === 0) return [];
  const arts = await ContentArtifact.find({
    docType: "question", current: true, retiredAt: null, reviewStatus: "gold", ...loCodeMongoFilter(codes),
  })
    .select("envelopeJson.tags envelopeJson.payload")
    .lean(); // bounded: one class × subject's gold questions
  return arts.flatMap((a) => {
    const env = (a.envelopeJson ?? {}) as Record<string, unknown>;
    const payload = env.payload as Record<string, unknown> | undefined;
    const qid = payload?.qid as string | undefined;
    if (!qid) return [];
    const text = payload?.question_text;
    return [{
      artifactId: String(a._id),
      qid,
      loCodes: loCodesOf(env.tags as Record<string, unknown>, payload),
      textBn: typeof text === "string" ? text : null,
      stimulusRef: stimulusRefOf(payload),
      qtCode: questionTypeCodeOf(payload),
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
async function startingLayout(sectionId: Types.ObjectId, subject: MasterySubject, classToken: MasteryClassToken): Promise<LayoutInput> {
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
  partA: QuestionView[];
  sheets: SheetSummary[];
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
  };
}

async function labelsFor(classToken: MasteryClassToken, subject: MasterySubject): Promise<Labels> {
  return new Map((await lockedOutcomes(classToken, subject)).map((o) => [o.code, o.labelBn]));
}

async function assignmentView(a: IMasteryAssignment): Promise<AssignmentView> {
  const [labels, sheets, roster, paper] = await Promise.all([
    labelsFor(a.classToken, a.subject),
    MasteryAssignmentSheet.find({ assignmentId: a._id }).lean(),
    rosterOf(a.sectionId),
    a.paperId ? MasteryPaper.findById(a.paperId).select("paperId").lean() : null,
  ]);
  const bySid = new Map(sheets.map((s) => [String(s.studentId), s]));
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
  const bctx: BuilderContext = { outcomes: outcomeInfo, taught: new Set(sec.states.keys()), bank, marksOf: marks, exposure, layout };

  const sectionWeak = [...sec.states.entries()].map(([loCode, per]) => ({
    loCode,
    weakPct: sectionOutcomeSummary([...per.values()].map((s) => s.state), sec.assessments.get(loCode) ?? 0, policy.resolved).weakPct,
  }));
  // PR-J (D-#1420): a question on any child's open extra sheet is seen by that child, so Part A (class-wide) avoids it.
  const extraSeen = await openExtraSeen(ctx.sectionId, input.subject);
  const openExtraQids = new Set([...extraSeen.values()].flatMap((q) => [...q]));
  const partA = buildPartA(sectionWeak, policy.resolved.sectionTriggerPct, new Set([...studentsByQid.keys(), ...openExtraQids]), bctx, openExtraQids);
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
    const built = buildPartB(states, bctx, partAQids);
    await MasteryAssignmentSheet.updateOne(
      { assignmentId: a._id, studentId: st._id },
      {
        $set: {
          items: built.items.map(toDoc),
          warnings: built.warnings,
          status: built.warnings.some((w) => w.code === "NO_UNSEEN_QUESTION") ? "NEEDS_REVIEW" : "DRAFT",
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
}

async function sheetDetailOf(a: IMasteryAssignment, sheet: IMasteryAssignmentSheet | (IMasteryAssignmentSheet & object)): Promise<SheetDetail> {
  const [outcomes, st] = await Promise.all([
    lockedOutcomes(a.classToken, a.subject),
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
  };
}

async function loadSheet(a: IMasteryAssignment, studentId: string): Promise<IMasteryAssignmentSheet> {
  if (!Types.ObjectId.isValid(studentId)) throw new MasteryWorkError("শিক্ষার্থী পাওয়া যায়নি।");
  const s = await MasteryAssignmentSheet.findOne({ assignmentId: a._id, studentId: oid(studentId) });
  if (!s) throw new MasteryWorkError("এই শিক্ষার্থীর শিট পাওয়া যায়নি।");
  return s;
}

export async function sheetDetail(assignmentId: string, studentId: string, auth: Auth): Promise<SheetDetail> {
  const a = await loadAssignment(assignmentId, auth);
  return sheetDetailOf(a, await loadSheet(a, studentId));
}

export type SheetOp = "SWAP" | "REMOVE" | "ADD_OWN" | "APPROVE";

export interface SheetEdit {
  op: SheetOp;
  index?: number | null;
  loCode?: string | null;
  questionTypeCode?: string | null;
  textBn?: string | null;
}

export async function editSheet(assignmentId: string, studentId: string, edit: SheetEdit, auth: Auth): Promise<SheetDetail> {
  const a = await loadAssignment(assignmentId, auth);
  assertDraft(a);
  const sheet = await loadSheet(a, studentId);
  const at = (i: number | null | undefined) => {
    if (i === null || i === undefined || !Number.isInteger(i) || i < 0 || i >= sheet.items.length) throw new MasteryWorkError("প্রশ্নটি পাওয়া যায়নি।");
    return i;
  };

  if (edit.op === "APPROVE") {
    sheet.status = "APPROVED";
    sheet.approvedBy = Types.ObjectId.isValid(auth.userId) ? oid(auth.userId) : undefined;
  } else {
    if (edit.op === "REMOVE") {
      sheet.items.splice(at(edit.index), 1);
    } else if (edit.op === "SWAP") {
      const i = at(edit.index);
      const cur = sheet.items[i];
      if (cur.origin !== "BANK") throw new MasteryWorkError("নিজের লেখা প্রশ্ন বদলাতে সরিয়ে নতুন লিখুন।");
      const rows = await liveSectionRows(a.sectionId, a.subject, cur.loCode);
      const seen = new Set(rows.filter((r) => r.studentId === studentId && r.qid).map((r) => r.qid as string));
      for (const q of [...sheet.items, ...a.partA]) if (q.qid) seen.add(q.qid);
      for (const q of (await openExtraSeen(a.sectionId, a.subject)).get(studentId) ?? []) seen.add(q);
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
        ...(next.stimulusRef ? { stimulusRef: next.stimulusRef } : {}),
      });
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
      if (!(o.questionTypeCodes ?? []).includes(qt)) throw new MasteryWorkError(`${qt || "ধরন"} এই কোডের প্রশ্নের ধরন নয়।`);
      const m = (await marksTable(a.classToken, a.subject)).get(qt);
      if (!m) throw new MasteryWorkError(`${qt}-এর নম্বর ঠিক করা নেই।`);
      sheet.items.push({ origin: "TEACHER", textBn: text, loCode: o.code, chapterNumber: o.chapterNumber ?? null, questionTypeCode: qt, marks: m, band: "TEACHER" });
      sheet.warnings = sheet.warnings.filter((w) => w.loCode !== o.code);
    } else {
      throw new MasteryWorkError("অজানা কাজ।");
    }
    sheet.edited = true;
    sheet.approvedBy = undefined;
    sheet.status = sheet.warnings.some((w) => w.code === "NO_UNSEEN_QUESTION") ? "NEEDS_REVIEW" : "DRAFT";
  }
  await sheet.save();
  return sheetDetailOf(a, sheet);
}

export async function approveAllSheets(assignmentId: string, auth: Auth): Promise<AssignmentView> {
  const a = await loadAssignment(assignmentId, auth);
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
  const a = await loadAssignment(assignmentId, auth);
  assertDraft(a);
  await assertEnabled(
    { sectionId: a.sectionId, classId: a.classId, academicYearId: a.academicYearId, classToken: a.classToken },
    a.subject,
  );
  const [sheets, roster] = await Promise.all([MasteryAssignmentSheet.find({ assignmentId: a._id }).lean(), rosterOf(a.sectionId)]);
  const pending = sheets.filter((s) => s.status !== "APPROVED").length;
  if (pending > 0) throw new MasteryWorkError(`${bn(pending)}টি শিট এখনো অনুমোদন হয়নি।`);
  const bySid = new Map(sheets.map((s) => [String(s.studentId), s]));
  const ordered = roster.flatMap((st) => (bySid.has(String(st._id)) ? [bySid.get(String(st._id))!] : []));
  if (ordered.length === 0) throw new MasteryWorkError("পাঠানোর মতো কোনো শিট নেই।");

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
    links: { assignmentId: a._id, ...(a.asItemId ? { asItemId: a.asItemId } : {}) },
    items,
    perStudentItems,
    rubricLoCodes: [],
    entryState: "OPEN",
    createdBy: Types.ObjectId.isValid(auth.userId) ? oid(auth.userId) : undefined,
  });
  a.status = "SENT";
  a.paperId = paper._id;
  a.sentAt = new Date();
  a.sentBy = Types.ObjectId.isValid(auth.userId) ? oid(auth.userId) : undefined;
  await a.save();
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
  void writeAudit({
    eventKind: "MASTERY_ASSIGNMENT_SENT",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryAssignment",
    targetId: a._id,
    meta: { paperId: paper.paperId, students: ordered.length, items: items.length, week: a.week },
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
      mixedText(doc, `${label.className} ${label.sectionName} · জমা: ${bn(a.dueDate.toISOString().slice(0, 10))} · সময় ${bn(a.layout.minutes)} মিনিট`, { width: W - 170 } as PDFKit.Mixins.TextOptions);
      const total = sum(partA) + sum(sheet.items);
      doc.fontSize(11).text(`নাম: ${personName(st)}`, M + W - 165, M, { width: 165, align: "right" });
      doc.text(`রোল: ${st.rollNumber ? bn(st.rollNumber) : "—"}`, { width: 165, align: "right" });
      doc.text(`পূর্ণমান: ${bn(total)}`, { width: 165, align: "right" });
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
