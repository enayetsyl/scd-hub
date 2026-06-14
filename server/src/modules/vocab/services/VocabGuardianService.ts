/**
 * VocabGuardianService (VC-4; prd-vocabulary-tracker §8, D-#154) — generate the
 * Bangla guardian messages for a vocab test (Regular / Perfect / Absent) or a
 * cumulative period, and deliver them: a wa.me click-to-send link for EVERY family
 * (ADR-003) + an in-app Notification for login-enabled guardians via the emit() seam
 * (D-#72). Contact-only guardians stay wa.me-only (D-#31/#72).
 *
 * The message bodies are NOT inline strings — they are rendered from the merged
 * Message-Templates registry (`vocab.result.*`, built on MT-1 per D-#131) so the
 * Principal can edit them. N+1 guard (the recorded MT follow-up): the title is
 * rendered ONCE per batch and each per-student body ONCE per student — renderTemplate
 * is never called inside the per-guardian loop (the emitter takes pre-rendered text).
 *
 * Gated `message:dispatch` in the resolver (Principal/Teacher/Office — the
 * assignment-chase R-T2 posture; Guardian denied). Identity-plane; NO corpus path.
 */
import { Types } from "mongoose";
import { VOCAB_DIRECTION_LABELS_BN, type VocabDirection } from "@scd/shared";
import { VocabTest, type IVocabTest } from "../models/VocabTest";
import { Student } from "../../foundation/models/Student";
import { renderTemplate } from "../../templates/services/MessageTemplateService";
import { emitVocabGuardianResult } from "../../notifications/services/emitters";
import { writeAudit } from "../../platform/services/AuditService";
import { testResults, type DerivedStudentResult, type WrongWord } from "./VocabResultService";
import { vocabStudentCumulative } from "./VocabSummaryService";
import { type PersistentWord, type CumulativeMode } from "./vocabAggregate";

/** Single-school convention — the {School} signature line. */
const SCHOOL = "SCD";

// ---------------------------------------------------------------------------
// Formatting helpers (Bangla)
// ---------------------------------------------------------------------------

export function formatDateBn(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** Per-direction wrong-word lists (the legacy SecB/SecC/SecD lists, generalised). One
 *  line per direction the student missed: "শ্রুতিলিখন: cat (বিড়াল), dog (কুকুর)". */
export function formatWrongWords(wrongWords: WrongWord[]): string {
  const byDir = new Map<VocabDirection, string[]>();
  const seen = new Set<string>();
  for (const w of wrongWords) {
    const key = `${w.direction}:${w.wordId}`;
    if (seen.has(key)) continue; // a 2-field dictation miss is still one word
    seen.add(key);
    const list = byDir.get(w.direction) ?? [];
    list.push(w.banglaMeaning ? `${w.headword} (${w.banglaMeaning})` : w.headword);
    byDir.set(w.direction, list);
  }
  const lines: string[] = [];
  for (const [dir, words] of byDir) {
    lines.push(`${VOCAB_DIRECTION_LABELS_BN[dir] ?? dir}: ${words.join(", ")}`);
  }
  return lines.length > 0 ? lines.join("\n") : "—";
}

/** Persistent weak words for the cumulative message: "cat (বিড়াল) — ৩বার". */
export function formatPersistentWords(words: PersistentWord[]): string {
  if (words.length === 0) return "—";
  return words
    .map((w) => `${w.headword}${w.banglaMeaning ? ` (${w.banglaMeaning})` : ""} — ${w.missCount}বার`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Per-test message build (Perfect / Regular / Absent) — body rendered once/student
// ---------------------------------------------------------------------------

export type VocabMessageKind = "perfect" | "regular" | "absent";

/** Which template variant a derived result maps to (§8). */
export function vocabMessageKind(result: DerivedStudentResult): VocabMessageKind {
  if (result.status === "ABSENT") return "absent";
  if ((result.wrongCount ?? 0) === 0 && result.score === result.totalMarks) return "perfect";
  return "regular";
}

/** Render the per-student Bangla body for a test result (Perfect/Regular/Absent). */
export async function buildVocabResultMessage(
  result: DerivedStudentResult,
  studentName: string,
  testDate: Date,
): Promise<{ kind: VocabMessageKind; messageBn: string }> {
  const kind = vocabMessageKind(result);
  const dateBn = formatDateBn(testDate);
  let messageBn: string;
  if (kind === "absent") {
    messageBn = await renderTemplate("vocab.result.absent.body", {
      StudentName: studentName,
      TestDate: dateBn,
      School: SCHOOL,
    });
  } else if (kind === "perfect") {
    messageBn = await renderTemplate("vocab.result.perfect.body", {
      StudentName: studentName,
      TestDate: dateBn,
      Score: result.score ?? 0,
      TotalMarks: result.totalMarks,
      School: SCHOOL,
    });
  } else {
    messageBn = await renderTemplate("vocab.result.regular.body", {
      StudentName: studentName,
      TestDate: dateBn,
      Score: result.score ?? 0,
      TotalMarks: result.totalMarks,
      WrongCount: result.wrongCount ?? 0,
      WrongWords: formatWrongWords(result.wrongWords),
      School: SCHOOL,
    });
  }
  return { kind, messageBn };
}

// ---------------------------------------------------------------------------
// wa.me link (ADR-003 — always a MANUAL click-to-send)
// ---------------------------------------------------------------------------

function waLinkFor(phone: string | undefined | null, message: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// ---------------------------------------------------------------------------
// Per-test generation (J6 — "Given a marked test, generate messages")
// ---------------------------------------------------------------------------

export interface VocabMessageRecipient {
  studentId: string;
  studentName: string;
  kind: VocabMessageKind | "cumulative";
  messageBn: string;
  /** wa.me link for the family phone (null when no phone on file). */
  waLink: string | null;
  /** True when the family has no phone → only the in-app inbox path applies. */
  unreachableByWa: boolean;
  /** Login-enabled guardian ids that got an in-app inbox row. */
  notifiedGuardianIds: string[];
}

export interface GenerateVocabMessagesResult {
  testId: string;
  recipients: VocabMessageRecipient[];
  unreachableCount: number;
}

/**
 * Generate + deliver the per-student messages for a marked test. wa.me for every
 * family with a phone; in-app Notification for login-enabled guardians (D-#72).
 * The title is rendered ONCE; each body ONCE per student (N+1 guard). Audited.
 */
export async function generateVocabTestMessages(input: {
  testId: string;
  actorId: string;
}): Promise<GenerateVocabMessagesResult> {
  const test = (await VocabTest.findById(input.testId).lean()) as unknown as IVocabTest | null;
  if (!test) throw new Error("Test not found");

  const results = await testResults(input.testId);
  const studentIds = results.map((r) => new Types.ObjectId(r.studentId));
  const students = (await Student.find({ _id: { $in: studentIds } })
    .select("name nameBn phone")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; nameBn?: string; phone?: string }>;
  const studentById = new Map(students.map((s) => [s._id.toString(), s]));

  // N+1 guard: render the title ONCE for the whole batch (above the student + guardian loops).
  const titleBn = await renderTemplate("vocab.result.title");
  const testDate = new Date(test.testDate);

  const recipients: VocabMessageRecipient[] = [];
  let unreachableCount = 0;

  for (const result of results) {
    const student = studentById.get(result.studentId);
    const studentName = student?.nameBn || student?.name || "শিক্ষার্থী";
    const { kind, messageBn } = await buildVocabResultMessage(result, studentName, testDate);

    const waLink = waLinkFor(student?.phone, messageBn);
    if (!waLink) unreachableCount++;

    const notifiedGuardianIds = await emitVocabGuardianResult({
      testId: test._id,
      studentId: new Types.ObjectId(result.studentId),
      sectionId: test.sectionId,
      titleBn,
      messageBn,
    });

    recipients.push({
      studentId: result.studentId,
      studentName,
      kind,
      messageBn,
      waLink,
      unreachableByWa: !waLink,
      notifiedGuardianIds,
    });
  }

  await writeAudit({
    eventKind: "VOCAB_RESULT_MESSAGED",
    actorId: input.actorId,
    targetId: test._id,
    targetKind: "VocabTest",
    meta: {
      mode: "test",
      recipientCount: recipients.length,
      notifiedCount: recipients.reduce((n, r) => n + r.notifiedGuardianIds.length, 0),
      unreachableCount,
    },
  });

  return { testId: input.testId, recipients, unreachableCount };
}

// ---------------------------------------------------------------------------
// Cumulative generation (J6 — "(or Cumulative)") — per-student period roll-up
// ---------------------------------------------------------------------------

/** Render a student's cumulative Bangla body (§8). */
export async function buildVocabCumulativeMessage(
  cumulative: { numTests: number; rollup: { averageScore: number; averageTotal: number }; periodLabel: string; persistentWords: PersistentWord[] },
  studentName: string,
): Promise<string> {
  return renderTemplate("vocab.result.cumulative.body", {
    StudentName: studentName,
    PeriodLabel: cumulative.periodLabel,
    NumTests: cumulative.numTests,
    Score: cumulative.rollup.averageScore,
    TotalMarks: cumulative.rollup.averageTotal,
    PersistentWords: formatPersistentWords(cumulative.persistentWords),
    School: SCHOOL,
  });
}

export interface GenerateVocabCumulativeResult {
  sectionId: string;
  program: string | null;
  recipients: VocabMessageRecipient[];
  unreachableCount: number;
}

/**
 * Generate + deliver per-student CUMULATIVE messages for a section over the active
 * period (D-#153 window; `asOf` passed in). Only students with ≥1 test in the window
 * are messaged. wa.me + emit() exactly as the per-test path. Audited.
 */
export async function generateVocabCumulativeMessages(input: {
  sectionId: string;
  program?: string | null;
  mode?: CumulativeMode | null;
  asOf: Date;
  n?: number | null;
  actorId: string;
}): Promise<GenerateVocabCumulativeResult> {
  // Students with a recorded test in this section/program (newest tests first).
  const testQuery: Record<string, unknown> = { sectionId: new Types.ObjectId(input.sectionId) };
  if (input.program) testQuery.program = input.program;
  const tests = (await VocabTest.find(testQuery).select("_id sectionId").lean()) as unknown as Array<{
    _id: Types.ObjectId;
    sectionId: Types.ObjectId;
  }>;
  const testIds = tests.map((t) => t._id);
  const { VocabStudentTest } = await import("../models/VocabStudentTest");
  const anchors = (await VocabStudentTest.find({ testId: { $in: testIds } })
    .select("studentId")
    .lean()) as unknown as Array<{ studentId: Types.ObjectId }>;
  const studentIds = [...new Set(anchors.map((a) => a.studentId.toString()))];

  const students = (await Student.find({ _id: { $in: studentIds.map((id) => new Types.ObjectId(id)) } })
    .select("name nameBn phone")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; nameBn?: string; phone?: string }>;
  const studentById = new Map(students.map((s) => [s._id.toString(), s]));

  const titleBn = await renderTemplate("vocab.result.title");
  const sectionOid = new Types.ObjectId(input.sectionId);

  const recipients: VocabMessageRecipient[] = [];
  let unreachableCount = 0;

  for (const studentId of studentIds) {
    const cumulative = await vocabStudentCumulative(studentId, {
      program: input.program ?? null,
      mode: input.mode ?? null,
      asOf: input.asOf,
      n: input.n ?? null,
    });
    if (cumulative.numTests === 0) continue; // outside the window → skip

    const student = studentById.get(studentId);
    const studentName = student?.nameBn || student?.name || "শিক্ষার্থী";
    const messageBn = await buildVocabCumulativeMessage(cumulative, studentName);

    const waLink = waLinkFor(student?.phone, messageBn);
    if (!waLink) unreachableCount++;

    // Reuse the result emitter (no per-test id for cumulative → key on the section as
    // a synthetic "test" id so re-running is still idempotent per student+guardian).
    const notifiedGuardianIds = await emitVocabGuardianResult({
      testId: sectionOid,
      studentId: new Types.ObjectId(studentId),
      sectionId: sectionOid,
      titleBn,
      messageBn,
    });

    recipients.push({
      studentId,
      studentName,
      kind: "cumulative",
      messageBn,
      waLink,
      unreachableByWa: !waLink,
      notifiedGuardianIds,
    });
  }

  await writeAudit({
    eventKind: "VOCAB_RESULT_MESSAGED",
    actorId: input.actorId,
    targetId: sectionOid,
    targetKind: "Section",
    meta: {
      mode: "cumulative",
      program: input.program ?? null,
      recipientCount: recipients.length,
      notifiedCount: recipients.reduce((n, r) => n + r.notifiedGuardianIds.length, 0),
      unreachableCount,
    },
  });

  return { sectionId: input.sectionId, program: input.program ?? null, recipients, unreachableCount };
}
