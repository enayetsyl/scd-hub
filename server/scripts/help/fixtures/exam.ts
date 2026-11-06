/**
 * Example data for the "ক্লাস টেস্ট ও পরীক্ষা" help guides (specs/exam*.cjs).
 *
 * Create-only, LOCAL ONLY: it refuses any database that is not an in-memory one
 * (mongodb://127.0.0.1:<port>/). Built on seedBaseSchool(); every name is an example.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hc npx tsx scripts/help/fixtures/exam.ts [--reset]
 *
 * What it adds, mostly through the app's own services so the screens show real states:
 *   - a routine (teacher: ৩য় বালক গণিত + বাংলা + বিজ্ঞান; teacher2: ৩য় বালিকা ইংরেজি + গণিত, ৫ম ক ইংরেজি);
 *   - class tests at every step: printed with no marks, marks submitted for approval,
 *     one still waiting to print, and five whose answer scripts sit at each script stage;
 *   - three question-paper requests to the Office (new, in review, final);
 *   - eight published গণিত questions for ৩য় শ্রেণি and one draft set;
 *   - the 2026 annual exam: syllabus rows at each approval stage, a draft exam routine,
 *     and a draft Quran oral exam with papers and sittings;
 *   - Class 5 scholarship practice: topics, two scored papers and one waiting for marks.
 *   - StoredFile rows standing in for uploads (a local run has no Google Drive): papers,
 *     scanned pages, and the fixed ids the specs' faked uploads answer with.
 * Fixed ids the spec needs are exported as constants below.
 */
import mongoose, { Types } from "mongoose";
import { seedBaseSchool } from "../fixture";
import { RoutineSlot } from "../../../src/modules/routine/models/RoutineSlot";
import { SubjectGroup } from "../../../src/modules/routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../../src/modules/routine/models/SubjectGroupMembership";
import { StoredFile } from "../../../src/modules/platform/models/StoredFile";
import { ContentArtifact } from "../../../src/modules/content/models/ContentArtifact";
import * as CT from "../../../src/modules/trackers/services/ClassTestService";
import * as CTR from "../../../src/modules/trackers/services/ClassTestResultService";
import * as CTP from "../../../src/modules/trackers/services/ClassTestPublishService";
import * as CTQ from "../../../src/modules/trackers/services/ClassTestQuestionService";
import * as CTS from "../../../src/modules/trackers/services/ClassTestScriptService";
import * as Sets from "../../../src/modules/assessment/services/AssessmentService";
import * as Exams from "../../../src/modules/exams/services/ExamService";
import * as Syl from "../../../src/modules/exams/services/ExamSyllabusService";
import * as ExR from "../../../src/modules/exams/services/ExamRoutineService";
import * as Sch from "../../../src/modules/scholarship/services/ScholarshipService";
import * as QX from "../../../src/modules/quran-exam/services/QuranExamService";
import type { AppContext } from "../../../src/context";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

/** The StoredFile the spec's faked upload answers with (no Drive locally). */
export const FAKE_PAPER_FILE_ID = "6600000000000000000000a1";
/** Scanned script pages the faked /files/ctscript upload hands out, in order. */
export const FAKE_SCRIPT_FILE_IDS = ["6600000000000000000000b1", "6600000000000000000000b2", "6600000000000000000000b3", "6600000000000000000000b4", "6600000000000000000000b5", "6600000000000000000000b6"];

type Role = "PRINCIPAL" | "OFFICE" | "TEACHER";
const ctxOf = (userId: Types.ObjectId, role: Role): AppContext =>
  ({ req: {} as never, res: {} as never, auth: { userId: String(userId), role } }) as AppContext;

async function fakeFile(kind: string, name: string, uploadedBy: Types.ObjectId, id?: string): Promise<string> {
  const f = await StoredFile.create({
    ...(id ? { _id: new Types.ObjectId(id) } : {}),
    kind,
    mime: name.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
    sizeBytes: 120_000,
    originalName: name,
    driveFileId: `local-example-${new Types.ObjectId().toString()}`,
    uploadedBy,
  });
  return String(f._id);
}

export async function seedExam() {
  const base = await seedBaseSchool();
  const U = base.users;
  const S = base.sections;
  const C = base.classes;
  const st = base.students;
  const P = String(U.principal);
  const O = String(U.office);

  // ── Routine: who teaches what (the class-test teacher, syllabus approver and
  //    scholarship scope all read it). Sun–Thu, one period each.
  const slot = (sectionId: Types.ObjectId, classId: Types.ObjectId, subject: string, teacherId: Types.ObjectId, period: number) =>
    ["SUN", "MON", "TUE", "WED", "THU"].map((dayOfWeek) => ({
      groupType: "section",
      groupId: sectionId,
      classId,
      dayOfWeek,
      periodNumber: period,
      subject,
      track: "general",
      isBreak: false,
      teacherId,
      effectiveFrom: new Date("2026-01-01"),
      active: true,
      createdBy: U.principal,
    }));
  await RoutineSlot.create([
    ...slot(S.c3Boys, C.c3, "MATH", U.teacher, 1),
    ...slot(S.c3Boys, C.c3, "BAN", U.teacher, 2),
    ...slot(S.c3Boys, C.c3, "SCI", U.teacher, 3),
    ...slot(S.c3Girls, C.c3, "ENG", U.teacher2, 1),
    ...slot(S.c3Girls, C.c3, "MATH", U.teacher2, 2),
    ...slot(S.c5, C.c5, "ENG", U.teacher2, 1),
  ]);

  // ── Class tests ─────────────────────────────────────────────────────────
  async function registerWithPaper(sectionId: Types.ObjectId, subject: string, testNumber: number, examDate: string, teacherId: Types.ObjectId, totalMarks = 20) {
    const fileId = await fakeFile("classtest_question", `${subject}-CT${testNumber}.pdf`, teacherId);
    return CT.createRequest({
      sectionId: String(sectionId),
      subject,
      source: "UPLOADED_PAPER",
      questionFileId: fileId,
      examDate,
      totalMarks,
      testNumber,
      skipPrint: true,
      teacherId: String(teacherId),
      actorId: String(teacherId),
    });
  }

  const marksOf = [17, 14, 9, 19, 12, 16];
  async function enterAll(testId: string, studentIds: Types.ObjectId[], by: Types.ObjectId, absentLast = false) {
    for (const [i, sid] of studentIds.entries()) {
      const absent = absentLast && i === studentIds.length - 1;
      await CTR.enterResult({
        testId,
        studentId: String(sid),
        status: absent ? "ABSENT" : "PRESENT",
        marks: absent ? undefined : marksOf[i % marksOf.length],
        weakness: !absent && marksOf[i % marksOf.length] < 10 ? "ভাগের নিয়ম আরও অনুশীলন দরকার" : undefined,
        actorId: String(by),
      });
    }
  }

  // T1 — printed, no marks yet (the teacher's marks-entry walk).
  const t1 = await registerWithPaper(S.c3Boys, "MATH", 1, "2026-11-03", U.teacher);
  // T2 — marks entered and submitted: waits for the Principal's approval.
  const t2 = await registerWithPaper(S.c3Boys, "BAN", 1, "2026-11-02", U.teacher);
  await enterAll(t2.id, st.c3Boys, U.teacher, true);
  await CTP.submitExam(t2.id, String(U.teacher));
  // T4 — printed, no marks: the details-correction and retire walks.
  const t4 = await registerWithPaper(S.c3Boys, "MATH", 3, "2026-11-04", U.teacher, 30);
  // T3 — still waiting to print (a real print request; the date can still move).
  const reqFile = await fakeFile("classtest_question", "গণিত-টেস্ট-২.pdf", U.teacher);
  await CT.createRequest({
    sectionId: String(S.c3Boys),
    subject: "MATH",
    source: "UPLOADED_PAPER",
    questionFileId: reqFile,
    examDate: "2026-11-12",
    totalMarks: 25,
    testNumber: 2,
    colour: "BW",
    sides: "SINGLE",
    copies: 6,
    copiesMode: "FIXED",
    teacherId: String(U.teacher),
    actorId: String(U.teacher),
  } as never);

  // Five published tests whose answer scripts sit at each stage of the script flow.
  async function published(sectionId: Types.ObjectId, subject: string, n: number, date: string, teacherId: Types.ObjectId, kids: Types.ObjectId[]) {
    const t = await registerWithPaper(sectionId, subject, n, date, teacherId);
    await enterAll(t.id, kids, teacherId, true);
    await CTP.submitExam(t.id, String(teacherId));
    await CTP.approveExam(t.id, P);
    return t.id;
  }
  async function attachAll(testId: string, kids: Types.ObjectId[]) {
    for (const [i, sid] of kids.slice(0, kids.length - 1).entries()) {
      const f = await fakeFile("classtest_script", `script-${i + 1}.jpg`, U.office);
      await CTS.attachScriptPages(testId, String(sid), [f], O);
    }
  }
  // S1: DUE — the teacher still has to hand the scripts in.
  await published(S.c3Girls, "ENG", 1, "2026-11-02", U.teacher2, st.c3Girls);
  // S2: received, nothing scanned yet.
  const s2 = await published(S.c3Girls, "ENG", 2, "2026-11-03", U.teacher2, st.c3Girls);
  await CTS.receiveScripts(s2, 5, O);
  // S3: every present child's script tagged — ready to publish.
  const s3 = await published(S.c3Girls, "MATH", 1, "2026-11-02", U.teacher2, st.c3Girls);
  await CTS.receiveScripts(s3, 5, O);
  await attachAll(s3, st.c3Girls);
  // S4: scans published — the Office hands the bundle back.
  const s4 = await published(S.c3Girls, "MATH", 2, "2026-11-03", U.teacher2, st.c3Girls);
  await CTS.receiveScripts(s4, 5, O);
  await attachAll(s4, st.c3Girls);
  await CTS.publishScripts(s4, O);
  // S5: with the teacher — to be returned to the children.
  const s5 = await published(S.c5, "ENG", 1, "2026-11-02", U.teacher2, st.c5);
  await CTS.receiveScripts(s5, 5, O);
  await attachAll(s5, st.c5);
  await CTS.publishScripts(s5, O);
  await CTS.handBackScripts(s5, O);

  // ── Question-paper requests to the Office ───────────────────────────────
  await CTQ.createCtQuestionRequest({
    sectionId: String(S.c3Boys), subject: "MATH", chapter: "৫", totalMarks: 20, durationMinutes: 40, examDate: "2026-11-18", actorId: String(U.teacher),
  });
  const q2 = await CTQ.createCtQuestionRequest({
    sectionId: String(S.c3Boys), subject: "BAN", chapter: "৪", totalMarks: 20, durationMinutes: 40, examDate: "2026-11-19", actorId: String(U.teacher),
  });
  await CTQ.sendCtQuestionForReview({ id: q2.id, fileId: await fakeFile("classtest_question", "বাংলা-অধ্যায়-৪.pdf", U.office), note: "দ্বিতীয় প্রশ্নটি নতুন করে দেওয়া হলো", actorId: O });
  const q3 = await CTQ.createCtQuestionRequest({
    sectionId: String(S.c3Boys), subject: "MATH", chapter: "৬", totalMarks: 25, durationMinutes: 45, examDate: "2026-11-24", actorId: String(U.teacher),
  });
  await CTQ.sendCtQuestionForReview({ id: q3.id, fileId: await fakeFile("classtest_question", "গণিত-অধ্যায়-৬.pdf", U.office), actorId: O });
  await CTQ.reviewCtQuestion({ id: q3.id, approve: true, actorId: String(U.teacher) });
  // The Office's prepared paper the spec's faked upload hands back.
  await fakeFile("classtest_question", "গণিত-অধ্যায়-৫.pdf", U.office, FAKE_PAPER_FILE_ID);
  for (const [i, id] of FAKE_SCRIPT_FILE_IDS.entries()) await fakeFile("classtest_script", `scan-${i + 1}.jpg`, U.office, id);

  // ── Published questions (the question-set walk) ─────────────────────────
  const QS = [
    ["৩৪৫ + ২৮৭ = কত?", "mcq", 1],
    ["৫০০ থেকে ১৭৮ বিয়োগ করো।", "short_answer", 2],
    ["একটি বাক্সে ২৪টি পেনসিল আছে। ৬টি বাক্সে কতটি পেনসিল?", "short_answer", 3],
    ["৭২ কে ৮ দিয়ে ভাগ করো।", "short_answer", 2],
    ["শূন্যস্থান পূরণ করো: ৯ × ___ = ৬৩", "fill_blank", 1],
    ["রহিমের কাছে ১২০ টাকা ছিল। সে ৪৫ টাকার খাতা কিনল। তার কাছে কত টাকা রইল?", "short_answer", 3],
    ["সত্য/মিথ্যা: ১০০০ হলো চার অঙ্কের ক্ষুদ্রতম সংখ্যা।", "true_false", 1],
    ["৪৮ কে ৬টি সমান ভাগে ভাগ করলে প্রতি ভাগে কত হবে?", "short_answer", 2],
  ] as const;
  for (const [i, [text, type, marks]] of QS.entries()) {
    const qid = `QP-MATH-C3-U03-Q${String(9100 + i)}`;
    await ContentArtifact.create({
      docType: "question",
      subject: "MATH",
      classLevel: 3,
      address: { anchorWord: "Unit", number: 3, title: "যোগ, বিয়োগ, গুণ ও ভাগ" },
      curationTag: "KEEP_AS_IS",
      reviewStatus: "gold",
      tags: { difficulty: "medium", paper_role: "structured" },
      provenance: { source_project: "P04", author: "help-example", content_version: "v1" },
      envelopeJson: {
        envelope_version: "1.0",
        doc_type: "question",
        subject: "MATH",
        class_level: 3,
        tags: { difficulty: "medium", paper_role: "structured" },
        payload: { qid, question_text: text, question_type: type, marks, difficulty: "medium", paper_role: "structured", lesson_ref: "৩.১" },
      },
      current: true,
      importedBy: U.principal,
      importedAt: new Date(Date.now() - i * 60_000),
    });
  }

  // A draft class-test set with two questions (the add-and-finalise walk).
  const qids = (await ContentArtifact.find({ docType: "question", classLevel: 3 }).sort({ importedAt: -1 }).select("_id").lean()).map((a) => String(a._id));
  const draft = await Sets.createSet({ setType: "CT", sectionId: String(S.c3Boys), classId: String(C.c3), name: "গণিত ক্লাস টেস্ট ৩", actorId: String(U.teacher) });
  for (const id of qids.slice(0, 2)) await Sets.addQuestionToSet(draft.setId, id, String(U.teacher));

  // ── The annual exam: syllabus, routine, Quran exam ──────────────────────
  const office = ctxOf(U.office, "OFFICE");
  const exam = await Exams.createExam(office, {
    academicYearId: String(base.yearId), term: "ANNUAL", name: "বার্ষিক পরীক্ষা ২০২৬", startDateKey: "2026-11-15", endDateKey: "2026-11-30",
  });
  const examId = String(exam._id);
  const marks = (rows: [string, string, number, number][]) =>
    rows.map(([label, itemType, count, each], i) => ({ seq: i + 1, label, itemType, count, marksEach: each, total: count * each }));
  const save = (classId: Types.ObjectId, subject: string, bodyMd: string, rows: [string, string, number, number][], examDateKey: string) =>
    Syl.saveSyllabus(office, {
      examId, classId: String(classId), subject: subject as never, fullMarks: 100, bodyMd,
      marks: marks(rows) as never, questionTypes: [...new Set(rows.map((r) => r[1]))] as never, examDateKey,
    });
  // বাংলা: published (the read walk).
  const ban = await save(C.c3, "BAN", "অধ্যায় ১–৮: গদ্য ও কবিতা, বানান, যুক্তবর্ণ, বিরামচিহ্ন।", [
    ["বহুনির্বাচনি প্রশ্ন", "mcq", 20, 1], ["শূন্যস্থান পূরণ", "fill_blank", 10, 2], ["সংক্ষিপ্ত প্রশ্ন", "short_answer", 10, 3], ["রচনা", "descriptive", 1, 30],
  ], "2026-11-16");
  await Syl.submitSyllabusToTeacher(office, String(ban._id));
  await Syl.approveSyllabusAsTeacher(ctxOf(U.teacher, "TEACHER"), String(ban._id));
  await Syl.publishSyllabus(ctxOf(U.principal, "PRINCIPAL"), String(ban._id));
  // গণিত: the teacher approved — waits for the Principal.
  const math = await save(C.c3, "MATH", "অধ্যায় ১–৭: সংখ্যা, যোগ, বিয়োগ, গুণ, ভাগ, ভগ্নাংশ, পরিমাপ।", [
    ["বহুনির্বাচনি প্রশ্ন", "mcq", 20, 1], ["সংক্ষিপ্ত প্রশ্ন", "short_answer", 10, 2], ["সমস্যা সমাধান", "short_answer", 10, 6],
  ], "2026-11-18");
  await Syl.submitSyllabusToTeacher(office, String(math._id));
  await Syl.approveSyllabusAsTeacher(ctxOf(U.teacher, "TEACHER"), String(math._id));
  // ইংরেজি: sent to the routine teacher (teacher2) for approval.
  const eng = await save(C.c3, "ENG", "Units 1–12: reading, vocabulary, grammar (nouns, verbs), paragraph writing.", [
    ["MCQ", "mcq", 20, 1], ["Fill in the blanks", "fill_blank", 10, 2], ["Short questions", "short_answer", 10, 3], ["Paragraph", "descriptive", 1, 30],
  ], "2026-11-17");
  await Syl.submitSyllabusToTeacher(office, String(eng._id));

  await ExR.saveExamRoutineClass(office, examId, String(C.c3), [
    { dateKey: "2026-11-16", subject: "BAN", kind: "WRITTEN", start: "07:30", end: "10:30" },
    { dateKey: "2026-11-17", subject: "ENG", kind: "WRITTEN", start: "07:30", end: "10:30" },
    { dateKey: "2026-11-18", subject: "MATH", kind: "WRITTEN", start: "07:30", end: "10:30" },
    { dateKey: "2026-11-19", subject: "ISLAM", kind: "ORAL", start: null, end: null },
  ] as never, "পরীক্ষা শুরুর ১৫ মিনিট আগে শ্রেণিকক্ষে উপস্থিত থাকতে হবে।");
  await ExR.saveExamRoutineClass(office, examId, String(C.c5), [
    { dateKey: "2026-11-16", subject: "ENG", kind: "WRITTEN", start: "07:30", end: "10:30" },
    { dateKey: "2026-11-17", subject: "BAN", kind: "WRITTEN", start: "07:30", end: "10:30" },
    { dateKey: "2026-11-18", subject: "MATH", kind: "WRITTEN", start: "07:30", end: "10:30" },
  ] as never, null);

  // Quran oral exam: one নাজেরা group per শাখা of ৩য় শ্রেণি, both examiners teach.
  const boysGroup = await SubjectGroup.create({ track: "quran", level: "নাজেরা", gender: "boys", code: "Q-NZ-B", nameBn: "নাজেরা (বালক)" });
  const girlsGroup = await SubjectGroup.create({ track: "quran", level: "নাজেরা", gender: "girls", code: "Q-NZ-G", nameBn: "নাজেরা (বালিকা)" });
  await SubjectGroupMembership.create([
    ...st.c3Boys.map((studentId) => ({ groupId: boysGroup._id, studentId, track: "quran" })),
    ...st.c3Girls.map((studentId) => ({ groupId: girlsGroup._id, studentId, track: "quran" })),
  ]);
  await QX.loadQuranExamSittings(O, examId, [], "2026-11-26");
  await QX.saveQuranExamPaper(office, examId, {
    level: "নাজেরা",
    scheme: "ITEMS",
    fullMarks: 90,
    durationMin: 10,
    sections: [
      { title: "তিলাওয়াত", items: [{ label: "সূরা থেকে পড়া", marks: 40 }, { label: "তাজবীদ", marks: 20 }] },
      { title: "মুখস্থ", items: [{ label: "ছোট সূরা", marks: 20 }, { label: "দোয়া", marks: 10 }] },
    ],
  });
  const times = ["07:30", "07:40", "07:50", "08:00", "08:10", "08:20"];
  const end = (t: string) => { const [h, m] = t.split(":").map(Number); const x = h * 60 + m + 10; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
  const sit = (kids: Types.ObjectId[], groupId: Types.ObjectId, examinerId: Types.ObjectId, dateKey: string) =>
    kids.map((sid, i) => ({ studentId: String(sid), groupId: String(groupId), level: "নাজেরা", dateKey, start: times[i], end: end(times[i]), examinerId: String(examinerId), portionLabel: "সূরা আল-বাকারা ১–২০ আয়াত" }));
  await QX.loadQuranExamSittings(O, examId, [
    // 4 Nov: already held — the girls' marks are still pending (the monitor and reminder walk).
    ...sit(st.c3Girls, girlsGroup._id, U.teacher2, "2026-11-04"),
    // 22 Nov: the boys sit with teacher (the examiner's marks walk).
    ...sit(st.c3Boys, boysGroup._id, U.teacher, "2026-11-22"),
  ]);

  // ── Class 5 scholarship practice ────────────────────────────────────────
  const desk = { userId: P, role: "PRINCIPAL" };
  const topics: string[] = [];
  for (const [labelBn, axis, chapters] of [
    ["Reading comprehension", "skill", [1, 2, 3]],
    ["Vocabulary", "skill", [1, 2]],
    ["Grammar: tense", "content", [4, 5]],
    ["Paragraph writing", "skill", [6]],
  ] as const) {
    topics.push(await Sch.saveTopic({ subject: "ENG", classLevel: 5, labelBn, axis, chapters: [...chapters] }, desk));
  }
  const items = [
    { itemNo: 1, label: "Read and answer", subject: "ENG", topicCode: topics[0], chapters: [1, 2], itemType: "short_answer", marks: 10 },
    { itemNo: 2, label: "Word meanings", subject: "ENG", topicCode: topics[1], chapters: [1], itemType: "mcq", marks: 5 },
    { itemNo: 3, label: "Change the tense", subject: "ENG", topicCode: topics[2], chapters: [4], itemType: "short_answer", marks: 5 },
    { itemNo: 4, label: "Write a paragraph", subject: "ENG", topicCode: topics[3], chapters: [6], itemType: "descriptive", marks: 10 },
  ] as const;
  const p1 = await Sch.declarePaper({ sectionId: String(S.c5), subjects: ["ENG"], name: "ইংরেজি অনুশীলন ১", paperDate: new Date("2026-10-27"), totalMarks: 30, items: items as never }, desk);
  const scores = [[8, 4, 3, 7], [6, 5, 2, 5], [9, 3, 4, 8], [4, 2, 1, 3], [7, 4, 5, 6], [5, 3, 2, 4]];
  await Sch.enterScores(String(p1._id), st.c5.map((sid, i) => ({
    studentId: String(sid), status: "PRESENT", itemMarks: scores[i].map((m, k) => ({ itemNo: k + 1, marks: m })),
  })) as never, desk);
  const p2 = await Sch.declarePaper({ sectionId: String(S.c5), subjects: ["ENG"], name: "ইংরেজি অনুশীলন ২", paperDate: new Date("2026-11-01"), totalMarks: 30, items: items as never }, desk);
  const scores2 = [[9, 4, 2, 8], [5, 4, 3, 4], [10, 5, 4, 9], [3, 1, 2, 2], [8, 3, 4, 7], [6, 2, 1, 5]];
  await Sch.enterScores(String(p2._id), st.c5.map((sid, i) => ({
    studentId: String(sid), status: "PRESENT", itemMarks: scores2[i].map((m, k) => ({ itemNo: k + 1, marks: m })),
  })) as never, desk);
  // Paper 3 waits for marks (the marks walk).
  await Sch.declarePaper({ sectionId: String(S.c5), subjects: ["ENG"], name: "ইংরেজি অনুশীলন ৩", paperDate: new Date("2026-11-04"), totalMarks: 30, items: items as never }, desk);

  return { ...base, examId, t1: t1.id, t2: t2.id, t4: t4.id, s2, s3, s4, s5 };
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(uri);
    if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
    const ids = await seedExam();
    console.log("fixture: exam (class tests, scripts, question papers, sets, syllabus, exam routine, Quran exam, scholarship)");
    console.log(JSON.stringify(ids));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
