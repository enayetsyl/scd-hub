/**
 * Example data for the `content` help guides (lesson plans, plan review, question bank,
 * question review, notes & guides, English drive, worksheets, class books): LOCAL capture
 * runs only (prd-help-centre §5, HC-3).
 *
 * Create-only, built on the base school (../fixture.ts), and it refuses any database that is
 * not a local in-memory one. Every name is an example; no real person appears.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hc npx tsx scripts/help/fixtures/content.ts [--reset]
 *
 * Adds, through the app's own services (the real import gate, review and publish paths):
 *   - four session plans, ৫ম শ্রেণি English Unit 9 periods 1–4 (from docs/examples), imported as
 *     drafts. Period 1: reviewed and APPROVED by teacher2 (waits for sign-off); period 2:
 *     assigned to teacher2, not reviewed yet; periods 3–4: no reviewer;
 *   - the Project-04 example question bank (docs/examples), one import per subject:
 *     বাংলা Unit 13 (7 questions), English Unit 9 and Math Unit 9 (1 question + 1 stimulus each).
 *     English, Math and বাংলা Q06/Q07 are reviewed and PUBLISHED (the bank teachers browse);
 *     বাংলা Q01 approved by the teacher (waits for publish); Q02/Q03 assigned to the teacher,
 *     not reviewed; Q04/Q05 have no reviewer;
 *   - notes & guides for ৩য় শ্রেণি গণিত / বাংলা (markdown), one with a comment from the teacher;
 *   - English drive documents for ৫ম শ্রেণি Block 1 (markdown).
 * Worksheets and class books are added by the later parts of this file.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import type { AppContext } from "../../../src/context";
import { seedBaseSchool } from "../fixture";
import { importEnvelope, importQuestionBank } from "../../../src/modules/content/services/ContentService";
import { assignPlanReview, submitPlanReview } from "../../../src/modules/content/services/ReviewService";
import {
  assignQuestionReviewOne,
  submitQuestionReview,
  publishQuestion,
} from "../../../src/modules/questions/services/QuestionReviewService";
import { ContentArtifact } from "../../../src/modules/content/models/ContentArtifact";
import { ScopeGrant } from "../../../src/modules/foundation/models/ScopeGrant";
import { uploadTeachingNote } from "../../../src/modules/teaching-notes/services/TeachingNoteService";
import { addTeachingNoteComment } from "../../../src/modules/teaching-notes/services/TeachingNoteCommentService";
import { uploadEnglishDriveDoc } from "../../../src/modules/english-drive/services/EnglishDriveService";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

const REPO = path.resolve(__dirname, "../../../..");

type Role = "PRINCIPAL" | "OFFICE" | "TEACHER";
const ctxOf = (userId: Types.ObjectId, role: Role): AppContext =>
  ({ req: {} as never, res: {} as never, auth: { userId: String(userId), role } }) as AppContext;

function must<T extends { verdict: string; failChecks?: string[] }>(what: string, r: T): T {
  if (r.verdict !== "PASS") throw new Error(`${what}: import FAILED\n  ${(r.failChecks ?? []).join("\n  ")}`);
  return r;
}

const NOTE_MATH = `# গণিত: যোগের উত্তর লেখার নিয়ম

## প্রশ্ন পড়া
- প্রশ্নটি দুবার পড়ো। কী জানতে চাওয়া হয়েছে তার নিচে দাগ দাও।

## হিসাব করা
1. সংখ্যাগুলো এককের নিচে একক, দশকের নিচে দশক রেখে লেখো।
2. ডান দিক থেকে যোগ শুরু করো, হাতে রাখা সংখ্যা ভুলবে না।

## উত্তর লেখা
- শেষে একটি পূর্ণ বাক্যে উত্তর লেখো, যেমন: "মোট ৪৮টি আম আছে।"
`;

const NOTE_BAN = `# বাংলা: অনুচ্ছেদ লেখার নিয়ম

## শুরু
- প্রথম বাক্যে বিষয়টি সহজ করে বলো।

## মাঝের অংশ
- তিন-চারটি বাক্যে নিজের দেখা কথা লেখো।

## শেষ
- একটি বাক্যে নিজের ভালো লাগা বা শিক্ষা লেখো।
`;

const DRIVE_TN = `# Block 1 — Teacher's notes

## Aim
Pupils greet each other and say their names.

## Steps
1. Say "Assalamu alaikum. My name is Maryam." Pupils repeat.
2. Pair work: each pupil greets a partner.
3. Write the new words on the board: *name, friend, class*.
`;

const DRIVE_HW = `# Block 1 — Homework 1

1. Write your name in English.
2. Write two sentences about your best friend.
3. Copy the words: name, friend, class.
`;

export async function seedContent() {
  const base = await seedBaseSchool();
  const { users } = base;
  const P = String(users.principal);
  const O = String(users.office);
  const T = String(users.teacher);
  const T2 = String(users.teacher2);

  // ── Session plans: ৫ম শ্রেণি English Unit 9, periods 1–4 ─────────────────
  const example = JSON.parse(fs.readFileSync(path.join(REPO, "docs/examples/envelope_C5_ENG_U09_S01.json"), "utf8"));
  const planIds: string[] = [];
  for (const n of [1, 2, 3, 4]) {
    const env = JSON.parse(JSON.stringify(example));
    env.review_status = "draft";
    env.tags.lesson_ref = `C5-ENG-U09-S0${n}`;
    env.provenance.source_filename = `example_C5_ENG_U09_S0${n}_session.json`;
    env.payload.session_plan.period_index = n;
    env.rendered_markdown = String(env.rendered_markdown).replace("পিরিয়ড 1:", `পিরিয়ড ${n}:`).replace("(1/5)", `(${n}/5)`);
    must(`plan S0${n}`, await importEnvelope(env, P));
    const art = await ContentArtifact.findOne({
      docType: "session_plan",
      current: true,
      "envelopeJson.payload.session_plan.period_index": n,
    }).select("_id").lean();
    planIds.push(String(art!._id));
  }
  const r1 = await assignPlanReview({ artifactId: planIds[0], reviewerId: T2, assignedBy: O, actorRole: "OFFICE" });
  await submitPlanReview({
    assignmentId: r1.id,
    reviewerId: T2,
    verdict: "APPROVE",
    feedback: "পরিকল্পনাটি ক্লাসে চালানো যাবে। সময় ঠিক আছে।",
    actorRole: "TEACHER",
  });
  await assignPlanReview({ artifactId: planIds[1], reviewerId: T2, assignedBy: O, actorRole: "OFFICE" });

  // teacher2 also teaches বাংলা and গণিত in ৫ম, so the bank they browse holds all three subjects.
  await ScopeGrant.create(
    (["BAN", "MATH"] as const).map((code) => ({
      teacherId: users.teacher2,
      kind: "teaching",
      active: true,
      source: "manual",
      createdBy: users.principal,
      classId: base.classes.c5,
      sectionId: base.sections.c5,
      subjectId: base.subjects[code],
    })),
  );

  // ── Question bank (Project-04 examples), one import per subject ───────────
  const bank = JSON.parse(fs.readFileSync(path.join(REPO, "docs/examples/LOCKED_QuestionBank_Examples_v1.json"), "utf8"));
  for (const [sub, unit] of [["BAN", "পাখির মতো"], ["ENG", "Get Ready to Listen"], ["MATH", "Numbers"]] as const) {
    const part = {
      stimuli: bank.stimuli.filter((s: { stimulus_id: string }) => s.stimulus_id.includes(`-${sub}-`)),
      questions: bank.questions.filter((q: { qid: string }) => q.qid.includes(`-${sub}-`)),
    };
    must(`bank ${sub}`, await importQuestionBank(JSON.stringify(part), O, "Office", "KEEP_AS_IS", `C5_${sub}_bank_v1.json`, unit));
  }
  const qid = async (q: string) =>
    String((await ContentArtifact.findOne({ docType: "question", current: true, "envelopeJson.payload.qid": q }).select("_id").lean())!._id);
  const reviewQ = async (q: string, verdict: "APPROVE" | null, publish: boolean) => {
    const id = await qid(q);
    const round = await assignQuestionReviewOne({ artifactId: id, reviewerId: T, assignedBy: O, actorRole: "OFFICE" });
    if (verdict) await submitQuestionReview({ assignmentId: round.id, reviewerId: T, verdict, actorRole: "TEACHER" } as never);
    if (publish) await publishQuestion({ artifactId: id, actorId: P, actorRole: "PRINCIPAL" });
  };
  for (const q of ["QP-ENG-C5-U09-Q01", "QP-MATH-C5-U09-Q01", "QP-BAN-C5-U13-Q06", "QP-BAN-C5-U13-Q07"]) await reviewQ(q, "APPROVE", true);
  await reviewQ("QP-BAN-C5-U13-Q01", "APPROVE", false);
  await reviewQ("QP-BAN-C5-U13-Q02", null, false);
  await reviewQ("QP-BAN-C5-U13-Q03", null, false);

  // ── Notes & guides (৩য় শ্রেণি গণিত / বাংলা) ──────────────────────────────
  const math = await uploadTeachingNote({
    classLevel: 3, subject: "MATH", kind: "ANSWER_GUIDE", seq: 1, title: "যোগের উত্তর লেখার নিয়ম", format: "MD", contentMd: NOTE_MATH, actorId: O, actorRole: "OFFICE",
  });
  await uploadTeachingNote({
    classLevel: 3, subject: "BAN", kind: "ANSWER_GUIDE", seq: 1, title: "অনুচ্ছেদ লেখার নিয়ম", format: "MD", contentMd: NOTE_BAN, actorId: O, actorRole: "OFFICE",
  });
  await addTeachingNoteComment(ctxOf(users.teacher, "TEACHER"), {
    noteId: String(math.note.id),
    bodyBn: "হাতে রাখা সংখ্যার একটি উদাহরণ যোগ করলে শিক্ষার্থীদের বুঝতে সুবিধা হবে।",
    anchor: "হিসাব করা",
  });

  // ── English drive (৫ম শ্রেণি, Block 1) ──────────────────────────────────
  await uploadEnglishDriveDoc({ classLevel: 5, blockNumber: 1, kind: "TN", seq: 1, title: "Greetings and names", version: 1, format: "MD", contentMd: DRIVE_TN, actorId: O, actorRole: "OFFICE" });
  await uploadEnglishDriveDoc({ classLevel: 5, blockNumber: 1, kind: "HW", seq: 1, title: "My best friend", version: 1, format: "MD", contentMd: DRIVE_HW, actorId: O, actorRole: "OFFICE" });

  return { ...base, planIds };
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(uri);
    if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
    const ids = await seedContent();
    console.log("fixture: content (4 plans, 9 questions, 2 notes, 2 drive documents)");
    console.log(JSON.stringify({ planIds: ids.planIds }));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
