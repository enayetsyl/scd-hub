/**
 * `bookTeachersNow(book)` (docs/prd-book-lifecycle.md §7.3; owner Q5, D-#1597): the book's readers are,
 * TODAY, the teachers whose routine (active, unlapsed `teaching` scope grants) covers a section of the
 * book's class level in the book's subject, plus the class teachers of sections at that level — in
 * the current academic year. The same set receives errata and release notices.
 */
import { Types } from "mongoose";
import { ScopeGrant } from "../../foundation/models/ScopeGrant";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { Subject } from "../../foundation/models/Subject";
import { isGrantLapsed } from "../../foundation/services/ScopeGrantService";
import { currentAcademicYearId } from "../../foundation/services/currentYear";
import type { ISchoolBook } from "../models/SchoolBook";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { holderIdsOf } from "../../access-control/services/holders";
import { activeStaffIds } from "./names";

export async function bookTeachersNow(book: Pick<ISchoolBook, "classLevel" | "subject">, now = new Date()): Promise<Set<string>> {
  const yearId = await currentAcademicYearId();
  const classes = await Class.find({ level: book.classLevel, ...(yearId ? { academicYearId: yearId } : {}) }).select("_id").lean();
  if (!classes.length) return new Set();
  const classIds = classes.map((c) => c._id);
  const out = new Set<string>();
  const subject = await Subject.findOne({ code: book.subject }).select("_id").lean();
  if (subject) {
    const grants = await ScopeGrant.find({ kind: "teaching", active: true, classId: { $in: classIds }, subjectId: subject._id }).lean();
    for (const g of grants) if (!isGrantLapsed(g as { kind: string; expiresAt?: Date }, now)) out.add(String((g as { teacherId: Types.ObjectId }).teacherId));
  }
  // Subjects with no Subject row (ARABIC, QURAN, ...): the routine itself says who teaches the
  // class (owner Q5, D-#1625) — live slots of this subject for a section of the class, or for a
  // subject group (Quran/Arabic) that has a student of the class in it.
  const live = { subject: book.subject, isBreak: false, active: true, teacherId: { $exists: true }, effectiveFrom: { $lte: now }, $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gt: now } }] };
  for (const s of await RoutineSlot.find({ ...live, groupType: "section", classId: { $in: classIds } }).select("teacherId").lean()) if (s.teacherId) out.add(s.teacherId.toString());
  const sections = await Section.find({ classId: { $in: classIds } }).select("classTeacherId").lean();
  for (const s of sections) if (s.classTeacherId) out.add(s.classTeacherId.toString());
  return new Set(await activeStaffIds([...out]));
}

/** Who is TOLD (errata, release notices) and who is counted as a reader: the routine teachers of
 *  the book that actually hold `teacher_view` (a reader without it cannot open or tick anything). */
export async function bookViewersNow(book: Pick<ISchoolBook, "classLevel" | "subject">, now = new Date()): Promise<Set<string>> {
  const [teachers, holders] = await Promise.all([bookTeachersNow(book, now), holderIdsOf("book_lifecycle:teacher_view")]);
  const h = new Set(holders);
  return new Set([...teachers].filter((id) => h.has(id)));
}

export async function isBookReader(userId: string, book: Pick<ISchoolBook, "classLevel" | "subject">): Promise<boolean> {
  return (await bookTeachersNow(book)).has(userId);
}
