/**
 * Section merge / split (D-#62) — the Principal combines a class's gender-split
 * sections into one combined section (students moved, sources deactivated) and can
 * reverse it later. Identity-plane; no corpus path (ADR-005).
 *
 * Reversal precision:
 *   - students present at merge time return to their exact original section (`moves`);
 *   - students enrolled into the combined section AFTER the merge are placed by
 *     gender — each source section's dominant gender is derived from `moves` joined
 *     with the live `Student.gender` — falling back to the first source section.
 */
import { Types } from "mongoose";
import { Section } from "../models/Section";
import { Student } from "../models/Student";
import { SectionMerge } from "../models/SectionMerge";
import { writeAudit } from "../../platform/services/AuditService";

export class SectionMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SectionMergeError";
  }
}

const COMBINED_CODE = "ALL";
const DEFAULT_COMBINED_NAME_BN = "সম্মিলিত";

/**
 * Given the merge `moves` and a `studentId → gender` map, return `gender → sectionId`:
 * each source section is labelled with the gender most of its moved students had,
 * then inverted so a split can route a same-gender newcomer to the right section.
 * Pure (no I/O) — the unit-tested core of split placement.
 */
export function deriveGenderToSource(
  moves: { studentId: string; fromSectionId: string }[],
  genderOf: Map<string, string>,
): Record<string, string> {
  // sectionId → (gender → count)
  const tally = new Map<string, Map<string, number>>();
  for (const m of moves) {
    const gender = genderOf.get(m.studentId);
    if (!gender) continue;
    const g = tally.get(m.fromSectionId) ?? new Map<string, number>();
    g.set(gender, (g.get(gender) ?? 0) + 1);
    tally.set(m.fromSectionId, g);
  }
  const genderToSection: Record<string, string> = {};
  for (const [sectionId, g] of tally) {
    let dominant = "";
    let best = -1;
    for (const [gender, n] of g) {
      if (n > best) {
        best = n;
        dominant = gender;
      }
    }
    // First section to claim a gender wins (gender sections are 1:1 in practice).
    if (dominant && !(dominant in genderToSection)) genderToSection[dominant] = sectionId;
  }
  return genderToSection;
}

/** Merge all active sections of a class into one combined section. */
export async function mergeSections(
  classId: string,
  combinedNameBn: string | null,
  actorId: string,
): Promise<{ combinedSectionId: string; movedStudents: number; sourceSectionIds: string[] }> {
  const existing = await SectionMerge.findOne({ classId, status: "active" });
  if (existing) throw new SectionMergeError("This class is already merged. Split it first.");

  const sources = await Section.find({ classId, active: true }).lean();
  if (sources.length < 2) {
    throw new SectionMergeError("A class needs at least two active sections to merge.");
  }
  const sourceIds = sources.map((s) => s._id);

  // Reuse a prior combined section for this class if one exists (merge/split cycles),
  // else create it. Keeps the unique (classId, code) index happy across cycles.
  let combined = await Section.findOne({ classId, code: COMBINED_CODE });
  if (combined) {
    combined.nameBn = combinedNameBn?.trim() || DEFAULT_COMBINED_NAME_BN;
    combined.active = true;
    await combined.save();
  } else {
    combined = await Section.create({
      classId,
      code: COMBINED_CODE,
      nameBn: combinedNameBn?.trim() || DEFAULT_COMBINED_NAME_BN,
      active: true,
    });
  }

  const students = await Student.find({ sectionId: { $in: sourceIds }, active: true })
    .select("_id sectionId")
    .lean();
  const moves = students.map((s) => ({ studentId: s._id, fromSectionId: s.sectionId }));

  if (moves.length > 0) {
    await Student.updateMany(
      { _id: { $in: moves.map((m) => m.studentId) } },
      { $set: { sectionId: combined._id } },
    );
  }
  await Section.updateMany({ _id: { $in: sourceIds } }, { $set: { active: false } });

  await SectionMerge.create({
    classId,
    combinedSectionId: combined._id,
    sourceSectionIds: sourceIds,
    moves,
    status: "active",
    mergedBy: actorId,
    mergedAt: new Date(),
  });

  await writeAudit({
    eventKind: "SECTIONS_MERGED",
    actorId,
    targetId: combined._id,
    targetKind: "Section",
    meta: { classId, sourceSectionIds: sourceIds.map((id) => id.toString()), movedStudents: moves.length },
  });

  return {
    combinedSectionId: combined._id.toString(),
    movedStudents: moves.length,
    sourceSectionIds: sourceIds.map((id) => id.toString()),
  };
}

/** Reverse a class's active merge: students go back to their source sections. */
export async function splitSections(
  classId: string,
  actorId: string,
): Promise<{ restoredSections: number; movedStudents: number }> {
  const merge = await SectionMerge.findOne({ classId, status: "active" });
  if (!merge) throw new SectionMergeError("This class is not merged.");

  await Section.updateMany({ _id: { $in: merge.sourceSectionIds } }, { $set: { active: true } });

  const movesById = new Map(merge.moves.map((m) => [m.studentId.toString(), m.fromSectionId.toString()]));

  // Live gender for every student currently in the combined section (covers both
  // the originally-moved students and any enrolled after the merge).
  const inCombined = await Student.find({ sectionId: merge.combinedSectionId, active: true })
    .select("_id gender")
    .lean();
  const genderOf = new Map<string, string>();
  for (const s of inCombined) if (s.gender) genderOf.set(s._id.toString(), s.gender);

  const genderToSource = deriveGenderToSource(
    merge.moves.map((m) => ({ studentId: m.studentId.toString(), fromSectionId: m.fromSectionId.toString() })),
    genderOf,
  );
  const fallback = merge.sourceSectionIds[0].toString();

  // Group every combined student → its destination section, then bulk-move.
  const byDest = new Map<string, Types.ObjectId[]>();
  for (const s of inCombined) {
    const sid = s._id.toString();
    const dest = movesById.get(sid) ?? (s.gender ? genderToSource[s.gender] : undefined) ?? fallback;
    const list = byDest.get(dest) ?? [];
    list.push(s._id);
    byDest.set(dest, list);
  }
  let moved = 0;
  for (const [dest, ids] of byDest) {
    await Student.updateMany({ _id: { $in: ids } }, { $set: { sectionId: new Types.ObjectId(dest) } });
    moved += ids.length;
  }

  await Section.updateOne({ _id: merge.combinedSectionId }, { $set: { active: false } });

  merge.status = "split";
  merge.splitBy = new Types.ObjectId(actorId);
  merge.splitAt = new Date();
  await merge.save();

  await writeAudit({
    eventKind: "SECTIONS_SPLIT",
    actorId,
    targetId: merge.combinedSectionId,
    targetKind: "Section",
    meta: { classId, restoredSections: merge.sourceSectionIds.length, movedStudents: moved },
  });

  return { restoredSections: merge.sourceSectionIds.length, movedStudents: moved };
}

/** The classes currently merged (one row each) — drives the admin UI's state. */
export async function activeSectionMerges(): Promise<
  { id: string; classId: string; combinedSectionId: string; sourceSectionIds: string[] }[]
> {
  const merges = await SectionMerge.find({ status: "active" }).lean();
  return merges.map((m) => ({
    id: m._id.toString(),
    classId: m.classId.toString(),
    combinedSectionId: m.combinedSectionId.toString(),
    sourceSectionIds: m.sourceSectionIds.map((id) => id.toString()),
  }));
}
