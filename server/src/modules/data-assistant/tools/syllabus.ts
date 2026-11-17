/**
 * exam_syllabus (owner 17 Nov 2026; docs/prd-data-assistant-mcp.md). The school's own exam syllabus:
 * which subjects a class sits, the full marks and date, and — for one subject — the syllabus prose
 * and the মানবন্টন rows. READ-ONLY, and it goes through the SAME read services as the
 * examSyllabusClass / examSyllabusDetail / examSyllabusLevelDetail screens, so the same visibility
 * applies: `exam_syllabus:view_all` (Principal/Office by default) sees every status, anyone else
 * only PUBLISHED rows. The service refuses a caller without `exam_syllabus:view`; a guardian is
 * refused here (the data assistant is staff-only). The syllabus prose is the school's own text, but
 * it still leaves inside the untrusted envelope and is never followed as an instruction. Teacher
 * send-back reasons, approver ids and sign-off stamps are never selected.
 */
import { Types } from "mongoose";
import { z } from "zod";
import { ROUTINE_SUBJECTS, type RoutineSubject } from "@scd/shared";
import { Class } from "../../foundation/models/Class";
import { Exam } from "../../exams/models/Exam";
import { ExamSyllabus } from "../../exams/models/ExamSyllabus";
import {
  assertExamPicker,
  classSyllabus,
  examSyllabusLevels,
  seesSyllabusDrafts,
  syllabusDetail,
  syllabusLevelDetail,
  type SyllabusShape,
} from "../../exams/services/ExamSyllabusReadService";
import { assertRule } from "../gates";
import { ToolInvalid, type ToolDef } from "../types";
import { wrapUntrusted } from "../untrusted";
import { CLASS_LEVEL, NAME_QUERY, SUBJECT } from "./common";

const GATE = { authenticated: true } as const;
/** Long enough for a whole syllabus sheet; the envelope still strips markers and contacts. */
const BODY_CAP = 6000;

const UNPUBLISHED_MSG = "এই সিলেবাস এখনও প্রকাশ করা হয়নি";

/** The service refuses an unpublished row to non-admins with this exact sentence; any other refusal stays denied. */
async function orUnpublished<T>(p: Promise<T>): Promise<{ row: T } | { unpublished: true }> {
  try {
    return { row: await p };
  } catch (e) {
    if ((e as Error)?.name === "ForbiddenError" && (e as Error).message === UNPUBLISHED_MSG) return { unpublished: true };
    throw e;
  }
}
const UNPUBLISHED_NOTE = "This syllabus is not published yet.";

const summary = (r: SyllabusShape, examName: string, admin = false) => ({
  exam: examName,
  class_label: r.classLabel || null,
  level_label: r.levelLabel || null,
  subject: r.subject,
  full_marks: r.fullMarks,
  exam_date: r.examDateKey,
  status: r.pending ? (admin ? "NOT_WRITTEN" : "NOT_PUBLISHED_YET") : r.status,
});

const detail = (r: SyllabusShape, examName: string, admin = false) => ({
  ...summary(r, examName, admin),
  written_marks: r.writtenMarks,
  oral_marks: r.oralMarks,
  total_marks: r.totalMarks,
  body_md: wrapUntrusted(r.bodyMd, BODY_CAP),
  marks: r.marks.map((m) => ({
    seq: m.seq,
    label: m.label,
    item_type: m.itemType ?? null,
    component: m.component ?? null,
    count: m.count ?? null,
    marks_each: m.marksEach ?? null,
    total: m.total,
  })),
  question_types: r.questionTypes,
});

export const examSyllabus: ToolDef = {
  name: "exam_syllabus",
  label_bn: "পরীক্ষার সিলেবাস",
  label_en: "Exam syllabus",
  description:
    "The school's own exam syllabus (পরীক্ষার সিলেবাস, পাঠ্যসূচি, মানবন্টন, পূর্ণমান, পরীক্ষার তারিখ, প্রশ্নের ধরন). " +
    "Without `subject`: the subjects of a class (or of every class) with full marks, exam date and status — no syllabus text. " +
    "With class_level + subject: the full syllabus text, the mark distribution rows and the question types. " +
    "For Quran or Arabic from class one up use track (quran|arabic) + level. `exam` is a name part or id; the default is the newest exam that has syllabus rows. " +
    "Principal and Office also see drafts and rows under review (status says which); everyone else sees published rows only. " +
    "It does not return exam marks or results (use exam_results) or teacher comments.",
  input: {
    exam: NAME_QUERY.optional().describe("part of the exam name, or an id; default = the newest exam with syllabus rows"),
    class_level: CLASS_LEVEL.optional(),
    subject: SUBJECT.optional().describe("BAN, ENG, MATH, SCI, BGS, ISLAM, ARABIC, QURAN, ICT …"),
    track: z.enum(["quran", "arabic"]).optional().describe("level syllabus: Quran or Arabic from class one up"),
    level: z.string().min(1).max(30).regex(/^[A-Za-z0-9_ -]+$/, "a level code").optional().describe("the level code, with track"),
  },
  gates: [{ mode: "default", rule: GATE, resolver: { file: "modules/exams/resolvers/examSyllabus.ts", field: "examSyllabusClass" } }],
  maxRows: 80,
  async run(ctx, a) {
    assertRule(ctx.auth, GATE);
    // Same door as the `exams` picker: someone it refuses must not get exam names from here either.
    assertExamPicker(ctx.app);
    const args = a as { exam?: string; class_level?: number; subject?: string; track?: "quran" | "arabic"; level?: string };
    const subject = args.subject ? (args.subject.toUpperCase() as RoutineSubject) : undefined;
    if (subject && !(ROUTINE_SUBJECTS as readonly string[]).includes(subject)) throw new ToolInvalid(`subject must be one of ${ROUTINE_SUBJECTS.join(", ")}.`);
    if (args.level && !args.track) throw new ToolInvalid("level needs track (quran or arabic).");

    const admin = seesSyllabusDrafts(ctx.auth);
    // ---- which exam -------------------------------------------------------------------
    const exams = (await Exam.find({}).select("name academicYearId createdAt").sort({ createdAt: -1 }).lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; academicYearId: Types.ObjectId }>;
    if (exams.length === 0) return { data: { note: "No exam has been created yet." }, rowCount: 0 };
    let exam: (typeof exams)[number] | undefined;
    if (args.exam) {
      const q = args.exam.trim().toLowerCase();
      const hits = /^[0-9a-f]{24}$/i.test(q) ? exams.filter((e) => String(e._id) === q) : exams.filter((e) => e.name.toLowerCase().includes(q));
      if (hits.length === 0) throw new ToolInvalid(`No exam matches that. Exams: ${exams.slice(0, 8).map((e) => e.name).join(" | ")}`);
      exam = hits[0];
    } else {
      const withRows = new Set((await ExamSyllabus.distinct("examId", admin ? {} : { publishedAt: { $ne: null } })).map(String));
      exam = exams.find((e) => withRows.has(String(e._id)));
      if (!exam) return { data: { note: "No exam has a syllabus that this person may see yet.", exams: exams.slice(0, 8).map((e) => e.name) }, rowCount: 0 };
    }
    const examId = String(exam._id);
    const head = { exam: exam.name, exam_id: examId, other_exams: exams.filter((e) => e !== exam).slice(0, 5).map((e) => e.name) };

    // ---- level syllabi (Quran / Arabic from class one up) ---------------------------------
    if (args.track) {
      if (args.level) {
        const got = await orUnpublished(syllabusLevelDetail(ctx.app, examId, args.track, args.level));
        if ("unpublished" in got) return { data: { ...head, note: UNPUBLISHED_NOTE }, rowCount: 0 };
        const row = got.row;
        if (!row) return { data: { ...head, note: "No syllabus has been written for that level yet." }, rowCount: 0 };
        return { data: { ...head, syllabus: detail(row, exam.name, admin) }, rowCount: 1 };
      }
      const levels = await examSyllabusLevels(ctx.app, examId);
      const rows = levels
        .filter((l) => l.track === args.track)
        .map((l) => ({
          track: l.track,
          level: l.level,
          label: l.label,
          ...(l.row ? summary(l.row, exam!.name, admin) : { subject: l.subject, status: "NO_SYLLABUS_YET" }),
        }));
      return { data: { ...head, levels: rows }, rowCount: rows.length };
    }

    // ---- class syllabi --------------------------------------------------------------------
    const classes = (await Class.find({ academicYearId: exam.academicYearId, ...(args.class_level !== undefined ? { level: args.class_level } : {}) })
      .select("level")
      .sort({ level: 1 })
      .lean()) as unknown as Array<{ _id: Types.ObjectId; level: number }>;
    if (classes.length === 0) return { data: { ...head, note: "No class of that level in the exam's year." }, rowCount: 0 };

    if (subject && args.class_level !== undefined) {
      const got = await orUnpublished(syllabusDetail(ctx.app, examId, String(classes[0]._id), subject));
      if ("unpublished" in got) return { data: { ...head, note: UNPUBLISHED_NOTE }, rowCount: 0 };
      const row = got.row;
      if (!row) {
        return {
          data: { ...head, note: "No syllabus row for that class and subject. Quran and Arabic from class one up are level syllabi: ask with track and level." },
          rowCount: 0,
        };
      }
      const view = await classSyllabus(ctx.app, examId, String(classes[0]._id));
      return {
        data: {
          ...head,
          syllabus: detail(row, exam.name, admin),
          class_question_types: view.questionTypes,
          ...(view.noteMd ? { class_note_md: wrapUntrusted(view.noteMd, 1500) } : {}),
        },
        rowCount: 1,
      };
    }

    const rows: ReturnType<typeof summary>[] = [];
    for (const c of classes) {
      const view = await classSyllabus(ctx.app, examId, String(c._id));
      for (const r of view.subjects) if (!subject || r.subject === subject) rows.push({ ...summary(r, exam.name, admin), class_label: view.classLabel });
    }
    const shown = rows.slice(0, 80);
    return {
      data: {
        ...head,
        ...(admin ? {} : { note: "Only published syllabi are shown to this person." }),
        subjects: shown,
      },
      rowCount: shown.length,
      truncated: rows.length > shown.length,
      total: rows.length,
    };
  },
};
