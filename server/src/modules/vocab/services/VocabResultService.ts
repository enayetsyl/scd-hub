/**
 * VocabResultService (VC-3; prd-vocabulary-tracker §3.6/§4, D-#142) — mistake capture
 * (the student × position grid) + the DERIVED per-student result. The operator gate
 * (tracker:write + assigned/covering tester) is enforced in the resolver.
 *
 * Capture is WHOLESALE per (student × test): one submit sets the attendance flag and
 * replaces that student's mistake rows — so the stored marks always mirror the grid.
 * Everything downstream (score, wrong-count, wrong-words) is derived (D-#85).
 *
 * Identity-plane (names studentIds); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { type VocabProgram, type VocabDirection, type VocabAttendanceStatus } from "@scd/shared";
import { VocabTest } from "../models/VocabTest";
import { VocabTestPosition } from "../models/VocabTestPosition";
import { VocabWord } from "../models/VocabWord";
import { VocabStudentTest, type IVocabStudentTest } from "../models/VocabStudentTest";
import { VocabStudentResult } from "../models/VocabStudentResult";
import { writeAudit } from "../../platform/services/AuditService";
import { VocabError } from "./VocabWordService";
import { scoreStudent, wrongFieldsValid, type PositionLite } from "./vocabScoring";

interface PositionInfo {
  direction: VocabDirection;
  wordId: string;
}

/** All positions of a test as a map positionId → {direction, wordId}. */
async function loadPositionMap(testId: string): Promise<Map<string, PositionInfo>> {
  const positions = await VocabTestPosition.find({ testId: new Types.ObjectId(testId) })
    .select("_id direction wordId")
    .lean();
  const map = new Map<string, PositionInfo>();
  for (const p of positions as Array<{ _id: Types.ObjectId; direction: VocabDirection; wordId: Types.ObjectId }>) {
    map.set(p._id.toString(), { direction: p.direction, wordId: p.wordId.toString() });
  }
  return map;
}

export interface MistakeInput {
  positionId: string;
  wrongFields: number[];
}

export interface SubmitStudentResultInput {
  testId: string;
  studentId: string;
  status: string; // PRESENT | ABSENT
  mistakes?: MistakeInput[];
  actorId: string;
}

/**
 * Record a student's result for a test (wholesale). PRESENT replaces the student's
 * mistake rows from `mistakes` (validating each against the test's positions); ABSENT
 * clears any mistakes. Flips the test to `marked`. Audited.
 */
export async function submitStudentResult(input: SubmitStudentResultInput): Promise<IVocabStudentTest> {
  if (input.status !== "PRESENT" && input.status !== "ABSENT") {
    throw new VocabError("status must be PRESENT or ABSENT");
  }
  const status = input.status as VocabAttendanceStatus;

  const test = await VocabTest.findById(input.testId).lean();
  if (!test) throw new VocabError("Test not found");
  const program = (test as { program: VocabProgram }).program;

  const studentOid = new Types.ObjectId(input.studentId);
  const testOid = new Types.ObjectId(input.testId);

  if (status === "ABSENT") {
    await VocabStudentResult.deleteMany({ testId: testOid, studentId: studentOid });
  } else {
    const positionMap = await loadPositionMap(input.testId);
    const mistakes = input.mistakes ?? [];
    const seen = new Set<string>();
    for (const m of mistakes) {
      const pos = positionMap.get(m.positionId);
      if (!pos) throw new VocabError("A marked position does not belong to this test");
      if (seen.has(m.positionId)) throw new VocabError("Duplicate position in the marks");
      seen.add(m.positionId);
      if (!wrongFieldsValid(pos.direction, program, m.wrongFields)) {
        throw new VocabError("Invalid wrongFields for a position (1-based, within its field count)");
      }
    }
    // Wholesale replace: clear then insert the non-empty mistakes.
    await VocabStudentResult.deleteMany({ testId: testOid, studentId: studentOid });
    if (mistakes.length > 0) {
      await VocabStudentResult.insertMany(
        mistakes.map((m) => ({
          testId: testOid,
          studentId: studentOid,
          positionId: new Types.ObjectId(m.positionId),
          wrongFields: m.wrongFields,
          recordedBy: new Types.ObjectId(input.actorId),
        })),
      );
    }
  }

  const anchor = await VocabStudentTest.findOneAndUpdate(
    { testId: testOid, studentId: studentOid },
    { $set: { status, recordedBy: new Types.ObjectId(input.actorId) } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  // First result recorded flips the test to `marked` (VC-3 owns this transition).
  if ((test as { status: string }).status !== "marked") {
    await VocabTest.findByIdAndUpdate(testOid, { status: "marked" });
  }

  await writeAudit({
    eventKind: "VOCAB_RESULT_RECORDED",
    actorId: input.actorId,
    targetId: testOid,
    targetKind: "VocabTest",
    meta: { studentId: input.studentId, status, mistakeCount: status === "ABSENT" ? 0 : (input.mistakes?.length ?? 0) },
  });

  return anchor as IVocabStudentTest;
}

// ---------------------------------------------------------------------------
// Derived reads (D-#85 — never stored)
// ---------------------------------------------------------------------------

export interface WrongWord {
  positionId: string;
  direction: VocabDirection;
  headword: string;
  banglaMeaning: string;
  wrongFields: number[];
}

export interface DerivedStudentResult {
  testId: string;
  studentId: string;
  status: VocabAttendanceStatus;
  /** Null when ABSENT (excluded from scoring, §4). */
  score: number | null;
  totalMarks: number;
  marksLost: number | null;
  wrongCount: number | null;
  wrongWords: WrongWord[];
}

/** The derived result for one student on a test. Null if the student was never recorded. */
export async function studentResult(testId: string, studentId: string): Promise<DerivedStudentResult | null> {
  const testOid = new Types.ObjectId(testId);
  const studentOid = new Types.ObjectId(studentId);
  const anchor = await VocabStudentTest.findOne({ testId: testOid, studentId: studentOid }).lean();
  if (!anchor) return null;

  const test = await VocabTest.findById(testOid).select("program totalMarks dictationHalfMissCounts").lean();
  if (!test) return null;
  const t = test as { program: VocabProgram; totalMarks: number; dictationHalfMissCounts: boolean };
  const status = (anchor as { status: VocabAttendanceStatus }).status;

  if (status === "ABSENT") {
    return { testId, studentId, status, score: null, totalMarks: t.totalMarks, marksLost: null, wrongCount: null, wrongWords: [] };
  }

  const positionMap = await loadPositionMap(testId);
  const positions: PositionLite[] = [...positionMap.entries()].map(([positionId, info]) => ({ positionId, direction: info.direction }));
  const mistakes = await VocabStudentResult.find({ testId: testOid, studentId: studentOid }).select("positionId wrongFields").lean();
  const mistakesByPositionId = new Map<string, number[]>();
  for (const m of mistakes as Array<{ positionId: Types.ObjectId; wrongFields: number[] }>) {
    mistakesByPositionId.set(m.positionId.toString(), m.wrongFields);
  }

  const score = scoreStudent({
    positions,
    mistakesByPositionId,
    totalMarks: t.totalMarks,
    program: t.program,
    dictationHalfMissCounts: t.dictationHalfMissCounts,
  });

  // Wrong-words join (for reports + VC-4 guardian messages).
  const wrongWordIds = score.wrongPositionIds
    .map((pid) => positionMap.get(pid)?.wordId)
    .filter((id): id is string => !!id);
  const words = await VocabWord.find({ _id: { $in: wrongWordIds.map((id) => new Types.ObjectId(id)) } })
    .select("_id headword banglaMeaning")
    .lean();
  const wordById = new Map(
    (words as Array<{ _id: Types.ObjectId; headword: string; banglaMeaning: string }>).map((w) => [w._id.toString(), w]),
  );
  const wrongWords: WrongWord[] = score.wrongPositionIds.map((pid) => {
    const info = positionMap.get(pid)!;
    const word = wordById.get(info.wordId);
    return {
      positionId: pid,
      direction: info.direction,
      headword: word?.headword ?? "",
      banglaMeaning: word?.banglaMeaning ?? "",
      wrongFields: mistakesByPositionId.get(pid) ?? [],
    };
  });

  return {
    testId,
    studentId,
    status,
    score: score.score,
    totalMarks: t.totalMarks,
    marksLost: score.marksLost,
    wrongCount: score.wrongCount,
    wrongWords,
  };
}

/** The derived results for every recorded student on a test (basic per-test report;
 *  the full class/cumulative reporting is VC-4). */
export async function testResults(testId: string): Promise<DerivedStudentResult[]> {
  const anchors = await VocabStudentTest.find({ testId: new Types.ObjectId(testId) }).select("studentId").lean();
  const out: DerivedStudentResult[] = [];
  for (const a of anchors as Array<{ studentId: Types.ObjectId }>) {
    const r = await studentResult(testId, a.studentId.toString());
    if (r) out.push(r);
  }
  return out;
}
