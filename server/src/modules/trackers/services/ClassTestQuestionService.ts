/**
 * ClassTestQuestionService (owner ask 2026-07-20) — the question-paper request +
 * review loop in front of the EXISTING class-test print path:
 *
 *   teacher requests (class/subject/chapter/test#/marks/duration/exam date, all
 *   mandatory) → office uploads the paper + sends for review (repeatable rounds)
 *   → teacher approves (CONFIRMED, locked) or requests changes with a mandatory
 *   comment → once CONFIRMED the teacher sends to print FROM THE SAME record,
 *   which files the standard ClassTest + print-queue row (createRequest) — so
 *   printing/delivery logging stays exactly the existing flow.
 *
 * Role gates live in the resolver (teacher = tracker:write + section scope;
 * office = roster:manage); ROW gates (own request only) live here. All writes
 * audited. Bangla errors surface in the app as-is.
 */
import { Types } from "mongoose";
import { HW_SUBJECTS, HW_SUBJECT_LABELS_BN, type HwSubject } from "@scd/shared";
import {
  emitCtQuestionTeacher,
  emitCtQuestionOffice,
} from "../../notifications/services/emitters";
import {
  ClassTestQuestionRequest,
  type IClassTestQuestionRequest,
  type ICtQuestionRound,
} from "../models/ClassTestQuestionRequest";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { StoredFile } from "../../platform/models/StoredFile";
import { writeAudit } from "../../platform/services/AuditService";
import { suggestTestNumber, createRequest, type ClassTestShape } from "./ClassTestService";

export interface CtQuestionRoundShape {
  fileId: string;
  note: string | null;
  sentBy: string;
  sentAt: string;
  teacherComment: string | null;
  respondedAt: string | null;
}

export interface CtQuestionRequestShape {
  id: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  chapter: string;
  testNumber: number;
  totalMarks: number;
  durationMinutes: number;
  examDate: string;
  status: string;
  rounds: CtQuestionRoundShape[];
  currentFileId: string | null;
  requestedBy: string;
  requesterName: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  classTestId: string | null;
}

function shape(d: IClassTestQuestionRequest, requesterName: string | null = null): CtQuestionRequestShape {
  return {
    id: d._id.toString(),
    classLevel: d.classLevel,
    sectionId: d.sectionId.toString(),
    subject: d.subject,
    chapter: d.chapter,
    testNumber: d.testNumber,
    totalMarks: d.totalMarks,
    durationMinutes: d.durationMinutes,
    examDate: new Date(d.examDate).toISOString(),
    status: d.status,
    rounds: (d.rounds ?? []).map((r: ICtQuestionRound) => ({
      fileId: r.fileId.toString(),
      note: r.note ?? null,
      sentBy: r.sentBy.toString(),
      sentAt: new Date(r.sentAt).toISOString(),
      teacherComment: r.teacherComment ?? null,
      respondedAt: r.respondedAt ? new Date(r.respondedAt).toISOString() : null,
    })),
    currentFileId: d.currentFileId ? d.currentFileId.toString() : null,
    requestedBy: d.requestedBy.toString(),
    requesterName,
    requestedAt: new Date(d.requestedAt).toISOString(),
    confirmedAt: d.confirmedAt ? new Date(d.confirmedAt).toISOString() : null,
    classTestId: d.classTestId ? d.classTestId.toString() : null,
  };
}

// ---------------------------------------------------------------------------
// Teacher: create the request (every field mandatory)
// ---------------------------------------------------------------------------

export interface CreateCtQuestionInput {
  sectionId: string;
  subject: string;
  chapter: string;
  totalMarks: number;
  durationMinutes: number;
  examDate: string;
  actorId: string;
}

export async function createCtQuestionRequest(input: CreateCtQuestionInput): Promise<CtQuestionRequestShape> {
  if (!(HW_SUBJECTS as readonly string[]).includes(input.subject)) {
    throw new Error(`Unknown subject: ${input.subject}`);
  }
  if (!input.chapter || input.chapter.trim() === "") throw new Error("অধ্যায় নম্বর লিখুন");
  if (!Number.isInteger(input.totalMarks) || input.totalMarks < 1) {
    throw new Error("পূর্ণমান একটি ধনাত্মক সংখ্যা হতে হবে");
  }
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1) {
    throw new Error("সময় (মিনিট) একটি ধনাত্মক সংখ্যা হতে হবে");
  }
  const examDate = new Date(input.examDate);
  if (Number.isNaN(examDate.getTime())) throw new Error("পরীক্ষার তারিখ সঠিক নয়");

  // Year/level/class derived from the section — never client-supplied (D-#143).
  const section = (await Section.findById(input.sectionId).select("classId").lean()) as {
    classId: Types.ObjectId;
  } | null;
  if (!section) throw new Error("শাখা পাওয়া যায়নি");
  const klass = (await Class.findById(section.classId).select("level academicYearId").lean()) as {
    level: number;
    academicYearId: Types.ObjectId;
  } | null;
  if (!klass) throw new Error("শ্রেণি পাওয়া যায়নি");

  // Auto test number — the same human sequence CT-1 suggests (editable there, fixed here).
  const testNumber = await suggestTestNumber(
    klass.academicYearId.toString(),
    klass.level,
    input.subject as HwSubject,
  );

  const doc = await ClassTestQuestionRequest.create({
    academicYearId: klass.academicYearId,
    classLevel: klass.level,
    classId: section.classId,
    sectionId: new Types.ObjectId(input.sectionId),
    subject: input.subject,
    chapter: input.chapter.trim(),
    testNumber,
    totalMarks: input.totalMarks,
    durationMinutes: input.durationMinutes,
    examDate,
    status: "REQUESTED",
    requestedBy: new Types.ObjectId(input.actorId),
    requestedAt: new Date(),
  });

  await writeAudit({
    eventKind: "CT_QUESTION_REQUESTED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ClassTestQuestionRequest",
    meta: { subject: input.subject, chapter: doc.chapter, testNumber, sectionId: input.sectionId },
  });

  // D-#342 notify: the office queue has new work.
  const requester = (await User.findById(input.actorId).select("name").lean()) as {
    name?: string;
  } | null;
  await emitCtQuestionOffice({
    requestId: doc._id.toString(),
    titleBn: "নতুন প্রশ্নের অনুরোধ",
    bodyBn: `${HW_SUBJECT_LABELS_BN[input.subject as HwSubject] ?? input.subject} · শ্রেণি ${klass.level} · অধ্যায় ${doc.chapter}${requester?.name ? ` — ${requester.name}` : ""}`,
    dedupeSuffix: "new",
  });

  return shape(doc);
}

// ---------------------------------------------------------------------------
// Office: upload a paper + send for review (one round; repeatable)
// ---------------------------------------------------------------------------

export interface SendCtQuestionInput {
  id: string;
  fileId: string;
  note?: string | null;
  actorId: string;
}

export async function sendCtQuestionForReview(input: SendCtQuestionInput): Promise<CtQuestionRequestShape> {
  const doc = await ClassTestQuestionRequest.findById(input.id);
  if (!doc || doc.active === false) throw new Error("অনুরোধটি পাওয়া যায়নি");
  if (doc.status === "CONFIRMED" || doc.status === "PRINT_REQUESTED") {
    throw new Error("চূড়ান্ত হয়ে যাওয়া প্রশ্নে আর নতুন সংস্করণ পাঠানো যায় না");
  }
  const file = (await StoredFile.findById(input.fileId).lean()) as { kind: string } | null;
  if (!file) throw new Error("প্রশ্নপত্রের ফাইল পাওয়া যায়নি");
  if (file.kind !== "classtest_question") throw new Error("ফাইলটি ক্লাস-টেস্ট প্রশ্নপত্র নয়");

  doc.rounds.push({
    fileId: new Types.ObjectId(input.fileId),
    note: input.note?.trim() || null,
    sentBy: new Types.ObjectId(input.actorId),
    sentAt: new Date(),
    teacherComment: null,
    respondedAt: null,
  });
  doc.currentFileId = new Types.ObjectId(input.fileId);
  doc.status = "IN_REVIEW";
  await doc.save();

  await writeAudit({
    eventKind: "CT_QUESTION_SENT_FOR_REVIEW",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ClassTestQuestionRequest",
    meta: { round: doc.rounds.length, fileId: input.fileId },
  });

  // D-#342 notify: the requesting teacher has a paper to review.
  await emitCtQuestionTeacher(doc.requestedBy.toString(), {
    requestId: doc._id.toString(),
    titleBn: "প্রশ্নপত্র রিভিউর জন্য প্রস্তুত",
    bodyBn: `${HW_SUBJECT_LABELS_BN[doc.subject as HwSubject] ?? doc.subject} · শ্রেণি ${doc.classLevel} · টেস্ট ${doc.testNumber} — প্রশ্নটি দেখে মতামত দিন`,
    dedupeSuffix: `review:r${doc.rounds.length}`,
  });

  return shape(doc);
}

// ---------------------------------------------------------------------------
// Teacher: review — approve (lock) or request changes (mandatory comment)
// ---------------------------------------------------------------------------

export interface ReviewCtQuestionInput {
  id: string;
  approve: boolean;
  comment?: string | null;
  actorId: string;
}

export async function reviewCtQuestion(input: ReviewCtQuestionInput): Promise<CtQuestionRequestShape> {
  const doc = await ClassTestQuestionRequest.findById(input.id);
  if (!doc || doc.active === false) throw new Error("অনুরোধটি পাওয়া যায়নি");
  if (doc.requestedBy.toString() !== input.actorId) {
    throw new Error("শুধু অনুরোধকারী শিক্ষকই প্রশ্নটি রিভিউ করতে পারেন");
  }
  if (doc.status !== "IN_REVIEW") throw new Error("এই মুহূর্তে রিভিউ করার মতো কোনো সংস্করণ নেই");

  const last = doc.rounds[doc.rounds.length - 1];
  if (input.approve) {
    doc.status = "CONFIRMED";
    doc.confirmedAt = new Date();
    if (last) last.respondedAt = new Date();
  } else {
    const comment = (input.comment ?? "").trim();
    if (comment === "") throw new Error("কী পরিবর্তন দরকার তা লিখুন");
    doc.status = "CHANGES_REQUESTED";
    if (last) {
      last.teacherComment = comment;
      last.respondedAt = new Date();
    }
  }
  doc.markModified("rounds");
  await doc.save();

  await writeAudit({
    eventKind: "CT_QUESTION_REVIEWED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ClassTestQuestionRequest",
    meta: { approve: input.approve, comment: input.approve ? undefined : (input.comment ?? "").trim() },
  });

  // D-#342 notify: the office learns the verdict — a change request is new work;
  // a confirm means the paper is locked and the print request will follow.
  const subjectBn = HW_SUBJECT_LABELS_BN[doc.subject as HwSubject] ?? doc.subject;
  await emitCtQuestionOffice({
    requestId: doc._id.toString(),
    titleBn: input.approve ? "প্রশ্ন চূড়ান্ত হয়েছে" : "প্রশ্নে পরিবর্তন চেয়েছেন শিক্ষক",
    bodyBn: input.approve
      ? `${subjectBn} · শ্রেণি ${doc.classLevel} · টেস্ট ${doc.testNumber} — শিক্ষক নিশ্চিত করেছেন`
      : `${subjectBn} · শ্রেণি ${doc.classLevel} · টেস্ট ${doc.testNumber} — ${(input.comment ?? "").trim()}`,
    dedupeSuffix: input.approve ? "confirmed" : `changes:r${doc.rounds.length}`,
  });

  return shape(doc);
}

// ---------------------------------------------------------------------------
// Teacher: send the CONFIRMED paper to print — the EXISTING class-test path
// ---------------------------------------------------------------------------

export interface PrintCtQuestionInput {
  id: string;
  colour?: string | null;
  sides?: string | null;
  copies?: number | null;
  copiesMode?: string | null;
  actorId: string;
}

export interface PrintCtQuestionResult {
  request: CtQuestionRequestShape;
  classTest: ClassTestShape;
}

export async function requestCtQuestionPrint(input: PrintCtQuestionInput): Promise<PrintCtQuestionResult> {
  const doc = await ClassTestQuestionRequest.findById(input.id);
  if (!doc || doc.active === false) throw new Error("অনুরোধটি পাওয়া যায়নি");
  if (doc.requestedBy.toString() !== input.actorId) {
    throw new Error("শুধু অনুরোধকারী শিক্ষকই প্রিন্টে পাঠাতে পারেন");
  }
  if (doc.status !== "CONFIRMED") throw new Error("চূড়ান্ত নিশ্চিত করার পরই প্রিন্টে পাঠানো যায়");
  if (!doc.currentFileId) throw new Error("চূড়ান্ত প্রশ্নপত্রের ফাইল নেই");

  // The standard CT-1 path: official ClassTest + print-queue row; printing +
  // delivery keep their existing logging. The paper was uploaded by the OFFICE,
  // so the uploader-ownership check is waived for this internal, reviewed path.
  const classTest = await createRequest({
    sectionId: doc.sectionId.toString(),
    subject: doc.subject,
    examDate: new Date(doc.examDate).toISOString(),
    totalMarks: doc.totalMarks,
    source: "UPLOADED_PAPER",
    questionFileId: doc.currentFileId.toString(),
    colour: input.colour ?? undefined,
    sides: input.sides ?? undefined,
    copies: input.copies ?? undefined,
    copiesMode: input.copiesMode ?? undefined,
    testNumber: doc.testNumber,
    notes: `অধ্যায়: ${doc.chapter} · সময়: ${doc.durationMinutes} মিনিট`,
    actorId: input.actorId,
    allowForeignQuestionFile: true,
  });

  doc.status = "PRINT_REQUESTED";
  doc.classTestId = new Types.ObjectId(classTest.id);
  await doc.save();

  return { request: shape(doc), classTest };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

const STATUS_ORDER: Record<string, number> = {
  IN_REVIEW: 0,
  CHANGES_REQUESTED: 1,
  REQUESTED: 2,
  CONFIRMED: 3,
  PRINT_REQUESTED: 4,
};

/** The teacher's own requests — action-needed first, then newest. */
export async function myCtQuestionRequests(actorId: string): Promise<CtQuestionRequestShape[]> {
  const rows = (await ClassTestQuestionRequest.find({
    requestedBy: actorId,
    active: { $ne: false },
  }).lean()) as unknown as IClassTestQuestionRequest[];
  return rows
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
    )
    .map((r) => shape(r));
}

const QUEUE_ORDER: Record<string, number> = {
  REQUESTED: 0,
  CHANGES_REQUESTED: 1,
  IN_REVIEW: 2,
  CONFIRMED: 3,
  PRINT_REQUESTED: 4,
};

/**
 * Sidebar badge counts for the Class Test drawer item (owner ask 2026-07-25 —
 * mirrors the print-queue badges). `pending` = requests the OFFICE still owes a
 * paper on (REQUESTED + CHANGES_REQUESTED); `inReview` = papers waiting on the
 * TEACHER (IN_REVIEW). Office/Principal see the whole pipeline; a teacher sees
 * only their own requests (`ownerId`).
 */
export async function ctQuestionCounts(
  ownerId: string | null,
): Promise<{ pending: number; inReview: number }> {
  const base: Record<string, unknown> = { active: { $ne: false } };
  if (ownerId) base.requestedBy = ownerId;
  const [pending, inReview] = await Promise.all([
    ClassTestQuestionRequest.countDocuments({ ...base, status: { $in: ["REQUESTED", "CHANGES_REQUESTED"] } }),
    ClassTestQuestionRequest.countDocuments({ ...base, status: "IN_REVIEW" }),
  ]);
  return { pending, inReview };
}

/** The office queue — work-needed first, teacher names joined. */
export async function ctQuestionQueue(): Promise<CtQuestionRequestShape[]> {
  const rows = (await ClassTestQuestionRequest.find({
    active: { $ne: false },
  }).lean()) as unknown as IClassTestQuestionRequest[];
  const teacherIds = [...new Set(rows.map((r) => r.requestedBy.toString()))];
  const teachers = (await User.find({ _id: { $in: teacherIds } })
    .select("name")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name?: string }>;
  const nameById = new Map(teachers.map((t) => [t._id.toString(), t.name ?? null]));
  return rows
    .sort(
      (a, b) =>
        (QUEUE_ORDER[a.status] ?? 9) - (QUEUE_ORDER[b.status] ?? 9) ||
        new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
    )
    .map((r) => shape(r, nameById.get(r.requestedBy.toString()) ?? null));
}
