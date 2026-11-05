/**
 * ClassTestCorrectionService (D-#945) — guardians were shown a class test and then it changed:
 *
 *   marksSnapshotDiff / recordMarksCorrection   a result re-published with different marks
 *   recordScriptsPulledBack                      published scripts unpublished
 *
 * Each becomes a tier-1 StaffMistake for the owner, who explains later (the re-publish and the
 * pull-back are usually done by Office, not the person at fault). Best-effort: a failure is
 * logged and NEVER blocks the publish.
 */
import { Types } from "mongoose";
import type { StaffMistakeKind } from "@scd/shared";
import { personName } from "../../../lib/personName";
import {
  ClassTestCorrectionNote,
  type ClassTestCorrectionChange,
  type ClassTestCorrectionKind,
  type IClassTestCorrectionNote,
} from "../models/ClassTestCorrectionNote";
import { ClassTest } from "../models/ClassTest";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { StaffMistake } from "../../staff-mistakes/models/StaffMistake";
import { recordMistakeFromSource } from "../../staff-mistakes/services/StaffMistakeService";

const MISTAKE_KIND: Record<ClassTestCorrectionKind, StaffMistakeKind> = {
  MARKS: "CLASS_TEST_MARKS",
  SCRIPTS: "CLASS_TEST_SCRIPTS",
};

export interface ResultSnapshotLike {
  marks?: number | null;
  status: string;
  enteredBy: Types.ObjectId | string;
  publishedSnapshot?: { marks: number | null; status: string; enteredBy: Types.ObjectId | string } | null;
}

/** The change a re-publish makes, or null when guardians would see the same thing. */
export function marksSnapshotDiff(row: ResultSnapshotLike): { fromMarks: number | null; toMarks: number | null; fromStatus: string; toStatus: string; owner: string } | null {
  const snap = row.publishedSnapshot;
  if (!snap) return null; // never shown before
  const toMarks = row.marks ?? null;
  if ((snap.marks ?? null) === toMarks && snap.status === row.status) return null;
  return { fromMarks: snap.marks ?? null, toMarks, fromStatus: snap.status, toStatus: row.status, owner: String(snap.enteredBy) };
}

/** The snapshot to store at publish time (null when the row has no entrant to own it). */
export function snapshotOf(row: { marks?: number | null; status?: string; enteredBy?: Types.ObjectId | string | null }) {
  if (!row.enteredBy || !row.status) return null;
  return { marks: row.marks ?? null, status: row.status, enteredBy: new Types.ObjectId(row.enteredBy.toString()) };
}

async function appendToEpisode(
  testId: Types.ObjectId,
  kind: ClassTestCorrectionKind,
  owner: Types.ObjectId,
  changes: ClassTestCorrectionChange[],
): Promise<IClassTestCorrectionNote | null> {
  const base = { testId, kind, staffUserId: owner };
  const last = await ClassTestCorrectionNote.findOne(base).sort({ episode: -1 }).select("_id episode").lean();
  let episode = last?.episode ?? 1;
  if (last) {
    const entry = await StaffMistake.findOne({ kind: MISTAKE_KIND[kind], sourceId: last._id, staffUserId: owner }).select("status").lean();
    if (entry && entry.status !== "EXPLANATION_DUE") episode += 1;
  }
  const key = { ...base, episode };
  try {
    return await ClassTestCorrectionNote.findOneAndUpdate(key, { $setOnInsert: key, $push: { changes: { $each: changes } } }, { upsert: true, new: true });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    return ClassTestCorrectionNote.findOneAndUpdate(key, { $push: { changes: { $each: changes } } }, { new: true });
  }
}

/** Changed rows of one publish, grouped by whose marks they were. */
export async function recordMarksCorrection(ev: {
  testId: Types.ObjectId | string;
  rows: { studentId: Types.ObjectId | string; diff: NonNullable<ReturnType<typeof marksSnapshotDiff>> }[];
  actorId: string;
  at: Date;
}): Promise<number> {
  try {
    if (ev.rows.length === 0) return 0;
    const testId = new Types.ObjectId(ev.testId.toString());
    const byOwner = new Map<string, ClassTestCorrectionChange[]>();
    for (const r of ev.rows) {
      const list = byOwner.get(r.diff.owner) ?? [];
      list.push({
        studentId: new Types.ObjectId(r.studentId.toString()),
        fromMarks: r.diff.fromMarks,
        toMarks: r.diff.toMarks,
        fromStatus: r.diff.fromStatus,
        toStatus: r.diff.toStatus,
        at: ev.at,
        by: new Types.ObjectId(ev.actorId),
      });
      byOwner.set(r.diff.owner, list);
    }
    for (const [ownerId, changes] of byOwner) {
      const owner = new Types.ObjectId(ownerId);
      const note = await appendToEpisode(testId, "MARKS", owner, changes);
      if (!note) continue;
      await recordMistakeFromSource({ kind: "CLASS_TEST_MARKS", tier: 1, sourceId: note._id, staffUserId: owner, correctedBy: ev.actorId, at: ev.at });
    }
    return byOwner.size;
  } catch (err) {
    console.error("[ClassTestCorrectionService] recording a marks correction failed (publish unaffected):", err);
    return 0;
  }
}

/** Published scripts pulled back: the publisher's entry. */
export async function recordScriptsPulledBack(ev: { testId: Types.ObjectId | string; publishedBy: Types.ObjectId | string; actorId: string; at: Date }): Promise<boolean> {
  try {
    const owner = new Types.ObjectId(ev.publishedBy.toString());
    const note = await appendToEpisode(new Types.ObjectId(ev.testId.toString()), "SCRIPTS", owner, [{ at: ev.at, by: new Types.ObjectId(ev.actorId) }]);
    if (!note) return false;
    await recordMistakeFromSource({ kind: "CLASS_TEST_SCRIPTS", tier: 1, sourceId: note._id, staffUserId: owner, correctedBy: ev.actorId, at: ev.at });
    return true;
  } catch (err) {
    console.error("[ClassTestCorrectionService] recording a scripts pull-back failed (unpublish unaffected):", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reads — the detail behind a staff mistake entry
// ---------------------------------------------------------------------------

export interface ClassTestCorrectionNoteShape {
  id: string;
  kind: ClassTestCorrectionKind;
  ctId: string;
  subject: string;
  testNumber: number;
  totalMarks: number;
  changes: { studentName: string; fromMarks: number | null; toMarks: number | null; fromStatus: string | null; toStatus: string | null; at: Date; byName: string }[];
}

export async function classTestCorrectionNotesByIds(ids: readonly string[]): Promise<Map<string, ClassTestCorrectionNoteShape>> {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length === 0) return new Map();
  const notes = await ClassTestCorrectionNote.find({ _id: { $in: valid } }).lean();
  const [tests, students, users] = await Promise.all([
    ClassTest.find({ _id: { $in: notes.map((n) => n.testId) } }).select("ctId subject testNumber totalMarks").lean(),
    Student.find({ _id: { $in: notes.flatMap((n) => n.changes.map((c) => c.studentId).filter(Boolean)) } }).select("name nameBn").lean(),
    User.find({ _id: { $in: notes.flatMap((n) => n.changes.map((c) => c.by)) } }).select("name nameBn").lean(),
  ]);
  const test = new Map(tests.map((t) => [String(t._id), t]));
  const studentName = new Map(students.map((s) => [String(s._id), personName(s)]));
  const userName = new Map(users.map((u) => [String(u._id), personName(u)]));
  return new Map(
    notes.map((n) => {
      const t = test.get(String(n.testId));
      return [
        String(n._id),
        {
          id: String(n._id),
          kind: n.kind,
          ctId: t?.ctId ?? "",
          subject: t?.subject ?? "",
          testNumber: t?.testNumber ?? 0,
          totalMarks: t?.totalMarks ?? 0,
          changes: n.changes.map((c) => ({
            studentName: c.studentId ? (studentName.get(String(c.studentId)) ?? "") : "",
            fromMarks: c.fromMarks ?? null,
            toMarks: c.toMarks ?? null,
            fromStatus: c.fromStatus ?? null,
            toStatus: c.toStatus ?? null,
            at: c.at,
            byName: userName.get(String(c.by)) ?? "",
          })),
        },
      ];
    }),
  );
}
