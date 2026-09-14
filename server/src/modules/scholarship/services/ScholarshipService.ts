/**
 * ScholarshipService — declare a practice paper, and write its per-item marks
 * (SC-0/SC-1/SC-2, docs/prd-scholarship-practice.md, D-#656..#665).
 *
 * Every rule that makes the later analysis trustworthy is enforced HERE, at write time,
 * because an analysis cannot repair a paper that was declared wrong: the marks must add
 * up to the full marks, every item's subject must be one the paper actually covers,
 * every topic must exist for that subject, and no cell may exceed its item.
 */
import { Types } from "mongoose";
import {
  HW_SUBJECTS,
  SYLLABUS_ITEM_TYPES,
  type HwSubject,
  type SyllabusItemType,
  type ScholarshipAttendanceStatus,
} from "@scd/shared";
import { ScholarshipPaper, type IScholarshipPaper } from "../models/ScholarshipPaper";
import { ScholarshipScore } from "../models/ScholarshipScore";
import { ScholarshipSequence } from "../models/ScholarshipSequence";
import { ScholarshipTopic } from "../models/ScholarshipTopic";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { Student } from "../../foundation/models/Student";
import { resolveSubjectTeacher } from "../../trackers/subjectTeacher";
import { writeAudit } from "../../platform/services/AuditService";

// ---------------------------------------------------------------------------
// paperId generation
// ---------------------------------------------------------------------------

/** `subjects` sorted + "+"-joined, so the sequence key is stable however the caller
 *  ordered them and `[SCI, BGS]` and `[BGS, SCI]` share one number line. */
export function subjectKeyOf(subjects: readonly HwSubject[]): string {
  return [...subjects].sort().join("+");
}

export async function generatePaperId(
  academicYearId: string | Types.ObjectId,
  classLevel: number,
  subjects: readonly HwSubject[],
): Promise<string> {
  const subjectKey = subjectKeyOf(subjects);
  const counter = await ScholarshipSequence.findOneAndUpdate(
    { academicYearId, classLevel, subjectKey },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  const n = String(counter.seq).padStart(4, "0");
  return `SP-C${classLevel}-${subjectKey}-${n}`;
}

// ---------------------------------------------------------------------------
// Authorization — the routine is the scope, not the permission
// ---------------------------------------------------------------------------

export interface Actor {
  userId: string;
  role: string;
}

/**
 * A TEACHER holds `scholarship:manage` as a BASE permission, so the permission is not
 * the scope (D-#656). She may only touch a paper whose class × subject the ROUTINE
 * names her on — the CT-1 / D-#521 posture, and the same source the class-test
 * accountable-teacher default reads, so the two can never disagree.
 *
 * Unscoped, a teacher base permission would be a write on every class's papers. That is
 * exactly the QR-9 near-miss, where `content:review` on TEACHER would have handed every
 * teacher a write over the whole question bank.
 *
 * PRINCIPAL and OFFICE are the desk: they declare and score on anyone's behalf.
 * A paper that spans subjects passes if she holds ANY of them — she marked the half she
 * teaches, and refusing her the sitting she invigilated helps nobody.
 */
export async function assertMayManage(
  actor: Actor,
  sectionId: string | Types.ObjectId,
  subjects: readonly HwSubject[],
  on: Date,
): Promise<void> {
  if (actor.role === "PRINCIPAL" || actor.role === "OFFICE") return;
  if (actor.role !== "TEACHER") {
    throw new Error("এই কাজটি করার অনুমতি নেই।");
  }
  for (const subject of subjects) {
    const teacherId = await resolveSubjectTeacher(String(sectionId), subject, on);
    if (teacherId && String(teacherId) === String(actor.userId)) return;
  }
  throw new Error("রুটিন অনুযায়ী এই শ্রেণি ও বিষয়ের দায়িত্ব আপনার নয়।");
}

// ---------------------------------------------------------------------------
// Declare a paper (SC-1)
// ---------------------------------------------------------------------------

export interface DeclareItemInput {
  itemNo: number;
  label: string;
  subject: HwSubject;
  topicCode: string;
  chapters?: number[];
  itemType: SyllabusItemType;
  marks: number;
}

export interface DeclarePaperInput {
  sectionId: string;
  subjects: HwSubject[];
  name: string;
  paperDate?: Date;
  totalMarks: number;
  durationMinutes?: number;
  sourceNote?: string;
  questionFileId?: string;
  items: DeclareItemInput[];
}

/** Marks may carry a half (the English paper's item 10 is 0.5 × 10) but nothing finer —
 *  a third of a mark is not a thing a marker can award, and it makes every subtotal a
 *  floating-point argument. */
function isHalfStep(n: number): boolean {
  return Number.isFinite(n) && Math.round(n * 2) === n * 2;
}

/** Float-safe sum for half-mark values: work in halves, divide once at the end. */
export function sumMarks(values: readonly number[]): number {
  return values.reduce((a, b) => a + Math.round(b * 2), 0) / 2;
}

/**
 * Validate the declared structure. Returns the Bangla complaint, or null when the paper
 * is sound. Split out from the write so the app can show the same message live while the
 * teacher is still typing the item list.
 */
export async function validateItems(
  subjects: readonly HwSubject[],
  totalMarks: number,
  items: readonly DeclareItemInput[],
  classLevel: number,
): Promise<string | null> {
  if (subjects.length === 0) return "অন্তত একটি বিষয় দিতে হবে।";
  if (new Set(subjects).size !== subjects.length) return "একই বিষয় দুইবার দেওয়া হয়েছে।";
  for (const s of subjects) {
    if (!HW_SUBJECTS.includes(s)) return `অজানা বিষয়: ${s}`;
  }
  if (items.length === 0) return "অন্তত একটি আইটেম দিতে হবে।";

  const seen = new Set<number>();
  for (const it of items) {
    if (!Number.isInteger(it.itemNo) || it.itemNo < 1) return "আইটেম নম্বর ১ বা তার বেশি হতে হবে।";
    if (seen.has(it.itemNo)) return `আইটেম ${it.itemNo} একাধিকবার আছে।`;
    seen.add(it.itemNo);
    if (!it.label?.trim()) return `আইটেম ${it.itemNo}-এর নাম লেখা হয়নি।`;
    // D-#664: a combined Science + BGS paper is one sitting with two halves, so the
    // subject lives on the item. An item naming a subject the paper does not cover
    // would put its marks into a roll-up nobody is looking at.
    if (!subjects.includes(it.subject)) {
      return `আইটেম ${it.itemNo}-এর বিষয় (${it.subject}) এই প্রশ্নপত্রের বিষয়ের মধ্যে নেই।`;
    }
    if (!SYLLABUS_ITEM_TYPES.includes(it.itemType)) {
      return `আইটেম ${it.itemNo}-এর ধরন অজানা।`;
    }
    if (!isHalfStep(it.marks) || it.marks <= 0) {
      return `আইটেম ${it.itemNo}-এর নম্বর ০.৫-এর গুণিতক হতে হবে।`;
    }
    if ((it.chapters ?? []).some((c) => !Number.isInteger(c) || c < 1)) {
      return `আইটেম ${it.itemNo}-এর অধ্যায় নম্বর ঠিক নেই।`;
    }
  }

  // Every topic must already exist for ITS OWN item's subject — an item tagged with a
  // topic from another subject would corrupt that subject's roll-up silently, and a
  // typo'd code would create a bucket of one that never matches anything again.
  const codes = [...new Set(items.map((i) => i.topicCode))];
  const rows = (await ScholarshipTopic.find({
    classLevel,
    code: { $in: codes },
  })
    .select("code subject")
    .lean()) as { code: string; subject: HwSubject }[];
  const bySubject = new Map(rows.map((r) => [`${r.subject}::${r.code}`, true]));
  for (const it of items) {
    if (!bySubject.has(`${it.subject}::${it.topicCode}`)) {
      return `আইটেম ${it.itemNo}-এর টপিক (${it.topicCode}) ${it.subject} বিষয়ের তালিকায় নেই।`;
    }
  }

  // The Σ guard (D-#656, the ExamSyllabus validateMarkRows posture). Refuse the paper;
  // never store one whose parts do not add up, because every percentage the analysis
  // ever prints is a fraction of these numbers.
  const sum = sumMarks(items.map((i) => i.marks));
  if (sum !== totalMarks) {
    return `আইটেমের যোগফল ${sum}, কিন্তু পূর্ণমান ${totalMarks}।`;
  }
  return null;
}

export async function declarePaper(
  input: DeclarePaperInput,
  actor: Actor,
): Promise<IScholarshipPaper> {
  // Class fields are RESOLVED from the section, never client-supplied (D-#143).
  const section = (await Section.findById(input.sectionId)
    .select("classId")
    .lean()) as { classId: Types.ObjectId } | null;
  if (!section) throw new Error("শাখা পাওয়া যায়নি।");
  const klass = (await Class.findById(section.classId)
    .select("level academicYearId")
    .lean()) as { level: number; academicYearId: Types.ObjectId } | null;
  if (!klass) throw new Error("এই শাখার শ্রেণি পাওয়া যায়নি।");

  const on = input.paperDate ?? new Date();
  await assertMayManage(actor, input.sectionId, input.subjects, on);

  if (!input.name?.trim()) throw new Error("প্রশ্নপত্রের নাম লেখা হয়নি।");
  if (!Number.isFinite(input.totalMarks) || input.totalMarks <= 0) {
    throw new Error("পূর্ণমান ঠিক নেই।");
  }
  const complaint = await validateItems(input.subjects, input.totalMarks, input.items, klass.level);
  if (complaint) throw new Error(complaint);

  const paperId = await generatePaperId(klass.academicYearId, klass.level, input.subjects);
  const paper = await ScholarshipPaper.create({
    paperId,
    academicYearId: klass.academicYearId,
    classLevel: klass.level,
    classId: section.classId,
    sectionId: new Types.ObjectId(input.sectionId),
    subjects: input.subjects,
    name: input.name.trim(),
    paperDate: input.paperDate,
    totalMarks: input.totalMarks,
    durationMinutes: input.durationMinutes,
    sourceNote: input.sourceNote?.trim(),
    questionFileId: input.questionFileId ? new Types.ObjectId(input.questionFileId) : undefined,
    status: "DECLARED",
    items: input.items.map((i) => ({ ...i, chapters: i.chapters ?? [], label: i.label.trim() })),
    declaredBy: new Types.ObjectId(actor.userId),
    declaredAt: new Date(),
  });

  await writeAudit({
    eventKind: "SCHOLARSHIP_PAPER_DECLARED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: paper._id,
    targetKind: "ScholarshipPaper",
    meta: {
      paperId,
      subjects: input.subjects,
      itemCount: input.items.length,
      totalMarks: input.totalMarks,
    },
  });
  return paper;
}

// ---------------------------------------------------------------------------
// Enter marks (SC-2)
// ---------------------------------------------------------------------------

export interface ScoreRowInput {
  studentId: string;
  status: ScholarshipAttendanceStatus;
  /** Only when PRESENT. */
  itemMarks?: { itemNo: number; marks: number }[];
  note?: string;
}

/**
 * Upsert one or more students' per-item marks on one paper. Freely re-callable — a
 * correction is an ordinary write, with no resubmission lifecycle (D-#121's posture).
 *
 * ABSENT carries no marks at all: not zeros. A zero says "sat it and scored nothing",
 * which is a real and different fact, and storing zeros for an absent student would drag
 * her into every class mean as if she had answered (D-#660).
 */
export async function enterScores(
  paperId: string,
  rows: readonly ScoreRowInput[],
  actor: Actor,
): Promise<number> {
  const paper = (await ScholarshipPaper.findById(paperId).lean()) as IScholarshipPaper | null;
  if (!paper) throw new Error("প্রশ্নপত্র পাওয়া যায়নি।");
  await assertMayManage(actor, paper.sectionId, paper.subjects, paper.paperDate ?? new Date());
  if (rows.length === 0) return 0;

  const maxByItem = new Map(paper.items.map((i) => [i.itemNo, i.marks]));

  // Every student must actually be on this paper's section roster. Without this a typo'd
  // id creates a score row for a child in another class, which then shows up in this
  // class's mean and in no roster anywhere — invisible from both ends.
  const ids = [...new Set(rows.map((r) => r.studentId))];
  const onRoster = (await Student.find({
    _id: { $in: ids.map((i) => new Types.ObjectId(i)) },
    sectionId: paper.sectionId,
  })
    .select("_id")
    .lean()) as { _id: Types.ObjectId }[];
  const rosterSet = new Set(onRoster.map((s) => String(s._id)));

  for (const r of rows) {
    if (!rosterSet.has(r.studentId)) {
      throw new Error("এই শিক্ষার্থী এই শাখার তালিকায় নেই।");
    }
    if (r.status === "ABSENT") continue;
    const marks = r.itemMarks ?? [];
    if (marks.length === 0) continue;
    const seen = new Set<number>();
    for (const m of marks) {
      const max = maxByItem.get(m.itemNo);
      if (max === undefined) throw new Error(`আইটেম ${m.itemNo} এই প্রশ্নপত্রে নেই।`);
      if (seen.has(m.itemNo)) throw new Error(`আইটেম ${m.itemNo}-এর নম্বর একাধিকবার দেওয়া হয়েছে।`);
      seen.add(m.itemNo);
      if (!isHalfStep(m.marks) || m.marks < 0) {
        throw new Error(`আইটেম ${m.itemNo}-এর নম্বর ০.৫-এর গুণিতক হতে হবে।`);
      }
      if (m.marks > max) {
        throw new Error(`আইটেম ${m.itemNo}-এ সর্বোচ্চ ${max}, দেওয়া হয়েছে ${m.marks}।`);
      }
    }
  }

  for (const r of rows) {
    await ScholarshipScore.findOneAndUpdate(
      { paperId: paper._id, studentId: new Types.ObjectId(r.studentId) },
      {
        $set: {
          status: r.status,
          itemMarks: r.status === "PRESENT" ? (r.itemMarks ?? []) : [],
          note: r.note?.trim(),
          enteredBy: new Types.ObjectId(actor.userId),
        },
      },
      { upsert: true, new: true },
    );
  }

  // DECLARED → SCORED on the first marks in. Never demoted: a paper that has been
  // scored stays scored even if every row is later corrected back to ABSENT.
  if (paper.status === "DECLARED") {
    await ScholarshipPaper.updateOne({ _id: paper._id }, { $set: { status: "SCORED" } });
  }

  await writeAudit({
    eventKind: "SCHOLARSHIP_SCORES_ENTERED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: paper._id,
    targetKind: "ScholarshipPaper",
    meta: { paperId: paper.paperId, students: rows.length },
  });
  return rows.length;
}
