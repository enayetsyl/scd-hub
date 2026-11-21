/**
 * HomeworkFreeLineService — AL-4 (docs/prd-academic-loop-2027.md §3.1 "Free lines without marks", R22, AC-B14).
 *
 * A homework may carry free lines (textbook work, reading, memorise, handwriting, other) beside or instead of bank
 * questions. They have no marks and write no evidence; per child they are tracked as exceptions on the original record:
 * `freeLinesNotDone` holds the 0-based lines the child did NOT do (empty = all done once SUBMITTED). This service reads
 * the grid (children in student-ID order, D-#1463) and saves those ticks. Write scope is the resolver's.
 */
import { Types } from "mongoose";
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { Student } from "../../foundation/models/Student";
import { personName } from "../../../lib/personName";
import { bySchoolId } from "../../year-change/setup";

export interface FreeLineGridRow {
  recordId: string;
  studentId: string;
  name: string;
  schoolId: string | null;
  state: string;
  notDone: number[];
}

export interface FreeLineGrid {
  hwItemId: string;
  hwId: string;
  sectionId: string;
  subject: string;
  freeLines: { kind: string; textBn: string; estMinutes: number }[];
  rows: FreeLineGridRow[];
}

async function loadItem(hwItemId: string) {
  if (!Types.ObjectId.isValid(hwItemId)) throw new Error("বাড়ির কাজটি পাওয়া যায়নি");
  const item = await HomeworkItem.findById(hwItemId).select("hwId sectionId classId subject freeLines").lean();
  if (!item) throw new Error("বাড়ির কাজটি পাওয়া যায়নি");
  return item;
}

/** The item's section × subject — for the resolver's scope check, before any child data is read. */
export async function freeLineScope(hwItemId: string): Promise<{ sectionId: string; classId: string; subject: string }> {
  const item = await loadItem(hwItemId);
  return { sectionId: String(item.sectionId), classId: String(item.classId), subject: item.subject };
}

export async function freeLineGrid(hwItemId: string): Promise<FreeLineGrid> {
  const item = await loadItem(hwItemId);
  const recs = await HomeworkStudentRecord.find({ hwItemId: item._id, resubOf: null }).select("studentId state freeLinesNotDone").lean(); // bounded: one item's roster
  const kids = await Student.find({ _id: { $in: recs.map((r) => r.studentId) } }).select("name nameBn schoolId").lean(); // bounded: one section
  const byId = new Map(kids.map((k) => [String(k._id), k]));
  const rows = recs
    .map((r) => {
      const k = byId.get(String(r.studentId));
      return {
        recordId: String(r._id),
        studentId: String(r.studentId),
        name: personName(k),
        schoolId: k?.schoolId ?? null,
        state: r.state as string,
        notDone: [...(r.freeLinesNotDone ?? [])].sort((a, b) => a - b),
      };
    })
    .sort((a, b) => bySchoolId(a.schoolId ?? "", b.schoolId ?? ""));
  return {
    hwItemId: String(item._id),
    hwId: item.hwId,
    sectionId: String(item.sectionId),
    subject: item.subject,
    freeLines: (item.freeLines ?? []).map((l) => ({ kind: l.kind, textBn: l.textBn, estMinutes: l.estMinutes })),
    rows,
  };
}

/** Each row REPLACES that child's not-done list. A line index outside the homework's lines is refused. */
export async function saveFreeLineTicks(
  hwItemId: string,
  rows: { studentId: string; notDone: number[] }[],
): Promise<number> {
  const item = await loadItem(hwItemId);
  const n = (item.freeLines ?? []).length;
  if (n === 0) throw new Error("এই বাড়ির কাজে অন্যান্য কাজের লাইন নেই");
  let saved = 0;
  for (const r of rows) {
    const idx = [...new Set(r.notDone)].sort((a, b) => a - b);
    if (idx.some((i) => !Number.isInteger(i) || i < 0 || i >= n)) throw new Error("কাজের লাইনের নম্বর ঠিক নয়");
    if (!Types.ObjectId.isValid(r.studentId)) throw new Error("শিক্ষার্থী পাওয়া যায়নি");
    const res = await HomeworkStudentRecord.updateMany(
      { hwItemId: item._id, studentId: new Types.ObjectId(r.studentId), resubOf: null },
      { $set: { freeLinesNotDone: idx } },
    );
    if (res.matchedCount === 0) throw new Error("এই শিক্ষার্থীর এই বাড়ির কাজের রেকর্ড নেই");
    saved += 1;
  }
  return saved;
}
