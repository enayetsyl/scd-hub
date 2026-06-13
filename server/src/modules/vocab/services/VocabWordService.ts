/**
 * VocabWordService (VC-1; prd-vocabulary-tracker §3.2, D-#104/#105) — word-bank
 * CRUD: add / edit / (de)activate / read, scoped per (program × classLevel).
 *
 * RBAC + class-level write-reach are enforced in the resolver (a teacher may only
 * manage the bank of a class level they hold a writable scope on — J1); this
 * service is the pure persistence + validation + audit layer. Every mutation
 * appends an audit row (ADR-008). Identity/operational plane, NO corpus path.
 */
import { Types } from "mongoose";
import {
  VOCAB_PROGRAMS,
  ROSTER_CLASS_LEVELS,
  type VocabProgram,
  type RosterClassLevel,
} from "@scd/shared";
import { VocabWord, type IVocabWord } from "../models/VocabWord";
import { writeAudit } from "../../platform/services/AuditService";

export class VocabError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "VocabError";
  }
}

// ---------------------------------------------------------------------------
// Pure validators (reused by the resolver + exercised directly in tests)
// ---------------------------------------------------------------------------

/** Narrow an arbitrary string to a VocabProgram or throw (Bangla-free dev error). */
export function assertProgram(program: string): VocabProgram {
  if (!(VOCAB_PROGRAMS as readonly string[]).includes(program)) {
    throw new VocabError(`Unknown vocab program: ${program}`);
  }
  return program as VocabProgram;
}

/** Narrow an arbitrary number to a RosterClassLevel or throw. */
export function assertClassLevel(classLevel: number): RosterClassLevel {
  if (!(ROSTER_CLASS_LEVELS as readonly number[]).includes(classLevel)) {
    throw new VocabError(`Unknown roster class level: ${classLevel}`);
  }
  return classLevel as RosterClassLevel;
}

/** Trim + reject an empty/whitespace-only field. */
export function cleanField(value: string, label: string): string {
  const v = (value ?? "").trim();
  if (v.length === 0) throw new VocabError(`${label} must not be empty`);
  return v;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface AddVocabWordInput {
  program: string;
  classLevel: number;
  headword: string;
  banglaMeaning: string;
  actorId: string;
}

/** Add a word to the (program × classLevel) bank. */
export async function addVocabWord(input: AddVocabWordInput): Promise<IVocabWord> {
  const program = assertProgram(input.program);
  const classLevel = assertClassLevel(input.classLevel);
  const headword = cleanField(input.headword, "headword");
  const banglaMeaning = cleanField(input.banglaMeaning, "banglaMeaning");

  const word = await VocabWord.create({
    program,
    classLevel,
    headword,
    banglaMeaning,
    active: true,
    addedBy: new Types.ObjectId(input.actorId),
  });

  await writeAudit({
    eventKind: "VOCAB_WORD_ADDED",
    actorId: input.actorId,
    targetId: word._id,
    targetKind: "VocabWord",
    meta: { program, classLevel, headword },
  });

  return word;
}

export interface EditVocabWordInput {
  wordId: string;
  headword?: string;
  banglaMeaning?: string;
  actorId: string;
}

/** Edit a word's headword and/or Bangla meaning (program × classLevel are fixed —
 *  a word that belongs to a different bank is a new word, not an edit). */
export async function editVocabWord(input: EditVocabWordInput): Promise<IVocabWord> {
  const word = await VocabWord.findById(input.wordId);
  if (!word) throw new VocabError("Word not found");

  const patch: Partial<Pick<IVocabWord, "headword" | "banglaMeaning">> = {};
  if (input.headword !== undefined) patch.headword = cleanField(input.headword, "headword");
  if (input.banglaMeaning !== undefined) patch.banglaMeaning = cleanField(input.banglaMeaning, "banglaMeaning");
  if (Object.keys(patch).length === 0) throw new VocabError("Nothing to edit");

  word.set(patch);
  word.updatedBy = new Types.ObjectId(input.actorId);
  await word.save();

  await writeAudit({
    eventKind: "VOCAB_WORD_UPDATED",
    actorId: input.actorId,
    targetId: word._id,
    targetKind: "VocabWord",
    meta: { program: word.program, classLevel: word.classLevel, ...patch },
  });

  return word;
}

/** Deactivate (or reactivate) a word — soft, never a hard delete (D-#104). */
export async function setVocabWordActive(
  wordId: string,
  active: boolean,
  actorId: string,
): Promise<IVocabWord> {
  const word = await VocabWord.findById(wordId);
  if (!word) throw new VocabError("Word not found");

  word.active = active;
  word.updatedBy = new Types.ObjectId(actorId);
  await word.save();

  await writeAudit({
    eventKind: "VOCAB_WORD_DEACTIVATED",
    actorId,
    targetId: word._id,
    targetKind: "VocabWord",
    meta: { program: word.program, classLevel: word.classLevel, active },
  });

  return word;
}

export interface ListVocabWordsInput {
  program: string;
  classLevel: number;
  includeInactive?: boolean;
}

/** The bank for a (program × classLevel). Active rows by default; includeInactive
 *  surfaces deactivated words too (admin/audit view). Newest first. */
export async function listVocabWords(input: ListVocabWordsInput): Promise<IVocabWord[]> {
  const program = assertProgram(input.program);
  const classLevel = assertClassLevel(input.classLevel);
  const query: Record<string, unknown> = { program, classLevel };
  if (!input.includeInactive) query.active = true;
  return VocabWord.find(query).sort({ createdAt: -1 }).lean() as unknown as Promise<IVocabWord[]>;
}

/** One word by id (used by the resolver to resolve a word's class level for the
 *  write-reach gate before an edit/deactivate). */
export async function getVocabWord(wordId: string): Promise<IVocabWord | null> {
  return VocabWord.findById(wordId).lean() as unknown as Promise<IVocabWord | null>;
}
