/**
 * VocabTestService (VC-2; prd-vocabulary-tracker §3.3/§3.4, D-#106/#127) — build a
 * test: create it (draft), auto-lay positions from selected words per direction, edit
 * its metadata, and read it back. No marking here (that is VC-3).
 *
 * The operator gate (assigned-or-covering teacher + tracker:write) is enforced in the
 * resolver; this service is the pure-ish persistence + layout + validation + audit
 * layer. Identity/operational plane, NO corpus path.
 */
import { Types } from "mongoose";
import {
  VOCAB_PROGRAM_DIRECTIONS,
  type VocabProgram,
  type VocabDirection,
} from "@scd/shared";
import { VocabTest, type IVocabTest } from "../models/VocabTest";
import { VocabTestPosition, type IVocabTestPosition } from "../models/VocabTestPosition";
import { VocabWord } from "../models/VocabWord";
import { writeAudit } from "../../platform/services/AuditService";
import { assertProgram, assertClassLevel, cleanField, VocabError } from "./VocabWordService";
import { weekStartFor, atMidnight } from "./vocabCalendar";

// ---------------------------------------------------------------------------
// Pure layout engine (§3.4) — directions validated against the program's set
// ---------------------------------------------------------------------------

export interface DirectionSelection {
  direction: string;
  wordIds: string[];
}

export interface LaidPosition {
  direction: VocabDirection;
  qNumber: number;
  wordId: string;
}

/**
 * Lay out positions from a per-direction word selection: 1-based qNumber within each
 * direction, in the order the words were given. Rejects a direction the program does
 * not use (D-#105) and an empty/duplicate-direction selection. Pure — no DB.
 */
export function layoutPositions(program: VocabProgram, selections: DirectionSelection[]): LaidPosition[] {
  const allowed = VOCAB_PROGRAM_DIRECTIONS[program];
  const seen = new Set<string>();
  const positions: LaidPosition[] = [];
  for (const sel of selections) {
    if (!(allowed as readonly string[]).includes(sel.direction)) {
      throw new VocabError(`Program ${program} does not use direction ${sel.direction}`);
    }
    if (seen.has(sel.direction)) {
      throw new VocabError(`Duplicate direction in selection: ${sel.direction}`);
    }
    seen.add(sel.direction);
    sel.wordIds.forEach((wordId, i) => {
      positions.push({ direction: sel.direction as VocabDirection, qNumber: i + 1, wordId });
    });
  }
  if (positions.length === 0) throw new VocabError("A test needs at least one word in one direction");
  return positions;
}

// ---------------------------------------------------------------------------
// Create / edit / read
// ---------------------------------------------------------------------------

export interface CreateTestInput {
  program: string;
  sectionId: string;
  classLevel: number;
  testDate: Date;
  label: string;
  totalMarks: number;
  dictationHalfMissCounts?: boolean;
  actorId: string;
}

export async function createVocabTest(input: CreateTestInput): Promise<IVocabTest> {
  const program = assertProgram(input.program);
  const classLevel = assertClassLevel(input.classLevel);
  const label = cleanField(input.label, "label");
  if (!Number.isFinite(input.totalMarks) || input.totalMarks < 0) {
    throw new VocabError("totalMarks must be a non-negative number");
  }
  const testDate = atMidnight(input.testDate);

  const test = await VocabTest.create({
    program,
    sectionId: new Types.ObjectId(input.sectionId),
    classLevel,
    testDate,
    weekOf: weekStartFor(testDate),
    label,
    totalMarks: input.totalMarks,
    dictationHalfMissCounts: input.dictationHalfMissCounts ?? false,
    status: "draft",
    createdBy: new Types.ObjectId(input.actorId),
  });

  await writeAudit({
    eventKind: "VOCAB_TEST_CREATED",
    actorId: input.actorId,
    targetId: test._id,
    targetKind: "VocabTest",
    meta: { program, sectionId: input.sectionId, classLevel, testDate: testDate.toISOString(), label },
  });

  return test;
}

export interface UpdateTestInput {
  testId: string;
  label?: string;
  totalMarks?: number;
  dictationHalfMissCounts?: boolean;
  testDate?: Date;
  actorId: string;
}

/** Edit a test's metadata (program/section/classLevel are fixed). Not allowed once
 *  `marked` (results exist — VC-3 owns that transition). */
export async function updateVocabTest(input: UpdateTestInput): Promise<IVocabTest> {
  const test = await VocabTest.findById(input.testId);
  if (!test) throw new VocabError("Test not found");
  if (test.status === "marked") throw new VocabError("A marked test cannot be edited");

  if (input.label !== undefined) test.label = cleanField(input.label, "label");
  if (input.totalMarks !== undefined) {
    if (!Number.isFinite(input.totalMarks) || input.totalMarks < 0) {
      throw new VocabError("totalMarks must be a non-negative number");
    }
    test.totalMarks = input.totalMarks;
  }
  if (input.dictationHalfMissCounts !== undefined) test.dictationHalfMissCounts = input.dictationHalfMissCounts;
  if (input.testDate !== undefined) {
    const d = atMidnight(input.testDate);
    test.testDate = d;
    test.weekOf = weekStartFor(d);
  }
  await test.save();

  await writeAudit({
    eventKind: "VOCAB_TEST_UPDATED",
    actorId: input.actorId,
    targetId: test._id,
    targetKind: "VocabTest",
    meta: { label: test.label, totalMarks: test.totalMarks, dictationHalfMissCounts: test.dictationHalfMissCounts },
  });

  return test;
}

export interface SetPositionsInput {
  testId: string;
  selections: DirectionSelection[];
  actorId: string;
}

/**
 * Replace a test's positions from a per-direction word selection (§3.4). Validates
 * directions against the program, validates every word belongs to the test's
 * (program × classLevel) bank and is active, then rebuilds positions wholesale
 * (delete + relay) and flips the test to `ready`. A marked test is frozen.
 */
export async function setVocabTestPositions(input: SetPositionsInput): Promise<IVocabTestPosition[]> {
  const test = await VocabTest.findById(input.testId);
  if (!test) throw new VocabError("Test not found");
  if (test.status === "marked") throw new VocabError("A marked test cannot be re-laid");

  const laid = layoutPositions(test.program as VocabProgram, input.selections);

  // Every selected word must belong to this test's bank (program × classLevel) + be active.
  const wordIds = [...new Set(laid.map((p) => p.wordId))];
  const valid = await VocabWord.find({
    _id: { $in: wordIds.map((id) => new Types.ObjectId(id)) },
    program: test.program,
    classLevel: test.classLevel,
    active: true,
  })
    .select("_id")
    .lean();
  const validSet = new Set(valid.map((w) => w._id.toString()));
  const stray = wordIds.find((id) => !validSet.has(id));
  if (stray) {
    throw new VocabError("A selected word is not an active word in this test's (program × class) bank");
  }

  // Rebuild positions wholesale so they always mirror the current selection.
  await VocabTestPosition.deleteMany({ testId: test._id });
  const docs = laid.map((p) => ({
    testId: test._id,
    direction: p.direction,
    qNumber: p.qNumber,
    wordId: new Types.ObjectId(p.wordId),
  }));
  await VocabTestPosition.insertMany(docs);

  test.status = "ready";
  await test.save();

  await writeAudit({
    eventKind: "VOCAB_TEST_POSITIONS_SET",
    actorId: input.actorId,
    targetId: test._id,
    targetKind: "VocabTest",
    meta: { positionCount: laid.length, directions: [...new Set(laid.map((p) => p.direction))] },
  });

  return VocabTestPosition.find({ testId: test._id })
    .sort({ direction: 1, qNumber: 1 })
    .lean() as unknown as Promise<IVocabTestPosition[]>;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getVocabTest(testId: string): Promise<IVocabTest | null> {
  return VocabTest.findById(testId).lean() as unknown as Promise<IVocabTest | null>;
}

export async function positionsForTest(testId: string): Promise<IVocabTestPosition[]> {
  return VocabTestPosition.find({ testId: new Types.ObjectId(testId) })
    .sort({ direction: 1, qNumber: 1 })
    .lean() as unknown as Promise<IVocabTestPosition[]>;
}

export interface ListTestsInput {
  sectionId?: string;
  program?: string;
  weekOf?: Date;
}

export async function listVocabTests(input: ListTestsInput): Promise<IVocabTest[]> {
  const query: Record<string, unknown> = {};
  if (input.sectionId) query.sectionId = new Types.ObjectId(input.sectionId);
  if (input.program) query.program = assertProgram(input.program);
  if (input.weekOf) query.weekOf = weekStartFor(input.weekOf);
  return VocabTest.find(query).sort({ testDate: -1 }).lean() as unknown as Promise<IVocabTest[]>;
}
