/**
 * IntegrityTagService - the term tag after an outside-help outcome (AL-12, docs/prd-academic-loop-2027.md section 3.4,
 * AC-H4/H5, R16 + R32, D-#1676).
 *
 * The tag is READ from the cases, never copied: a case whose outcome is GUARDIAN_DID or UNCLEAR carries `tagActive` +
 * `tagUntil` (the end of the term in which it was recorded). Staff surfaces (the student profile, the marks views, the
 * meeting brief) show it for the term; closing a case never changes a mark.
 *
 *  - GUARDIAN_DID : staff tag AND the guardian's gentle note on that subject.
 *  - UNCLEAR      : staff tag only - no guardian note (R36, Q4).
 *  - CHILD_DID    : no tag, no note.
 *
 * The guardian note carries a fixed sentence and a subject code - NO case, NO number, NO objective, NO outcome word, so
 * a guardian-facing type can never leak a case (the firewall test reads this file's exports).
 */
import { Types } from "mongoose";
import { Student } from "../../foundation/models/Student";
import { IntegrityCase, type IIntegrityCase } from "../models/IntegrityCase";
import { caseRows, tagIsOn, type CaseRow } from "./IntegrityService";

/** The note on a marks row of a tagged objective (staff views). */
export const OUTSIDE_HELP_MARK_BN = "বাড়ির কাজে বাইরের সাহায্য সন্দেহ";
/** The guardian's gentle note (never names a case or a number). */
export const GUARDIAN_HELP_NOTE_BN = "বাড়ির কাজ শিশুকে নিজে করতে দিন";

export interface StaffTag {
  caseId: string;
  studentId: string;
  subject: string;
  loCode: string;
  loLabelBn: string;
  outcome: string;
  tagUntil: string;
  /** `integrityRecurringCases`+ cases for this child in the term: the "বারবার" badge (AC-H5). */
  recurring: boolean;
}

export interface GuardianHelpNote {
  subject: string;
  noteBn: string;
}

const liveTagQuery = (now: Date, extra: Record<string, unknown>) => ({ tagActive: true, tagUntil: { $gt: now }, ...extra });

const asTags = (cases: readonly IIntegrityCase[], rows: readonly CaseRow[]): StaffTag[] =>
  cases.flatMap((c, i) => {
    const r = rows[i];
    return r && r.outcome ? [{ caseId: r.id, studentId: r.studentId, subject: r.subject, loCode: r.loCode, loLabelBn: r.loLabelBn, outcome: r.outcome, tagUntil: r.tagUntil ?? "", recurring: r.recurring }] : [];
  });

/** Every live tag of one child (staff: the profile, the meeting brief). */
export async function tagsForStudent(studentId: string, now: Date = new Date()): Promise<StaffTag[]> {
  if (!Types.ObjectId.isValid(studentId)) return [];
  const cases = (await IntegrityCase.find(liveTagQuery(now, { studentId: new Types.ObjectId(studentId) })).sort({ closedAt: -1 })).filter((c) => tagIsOn(c, now));
  return asTags(cases, await caseRows(cases, now));
}

/** Every live tag on a শাখা (+ optional subject): the marks views mark a tagged objective's HW/AS marks. */
export async function tagsForSection(sectionId: string, subject: string | null | undefined, now: Date = new Date()): Promise<StaffTag[]> {
  if (!Types.ObjectId.isValid(sectionId)) return [];
  const kids = await Student.find({ sectionId: new Types.ObjectId(sectionId), active: true }).select("_id").lean();
  if (kids.length === 0) return [];
  const cases = (
    await IntegrityCase.find(liveTagQuery(now, { studentId: { $in: kids.map((k) => k._id) }, ...(subject ? { subject } : {}) })).sort({ closedAt: -1 }).limit(500)
  ).filter((c) => tagIsOn(c, now));
  return asTags(cases, await caseRows(cases, now));
}

/** The guardian's gentle notes for one child: only outcome GUARDIAN_DID, one per subject, until the term ends. */
export async function guardianNotesFor(studentId: string, now: Date = new Date()): Promise<GuardianHelpNote[]> {
  if (!Types.ObjectId.isValid(studentId)) return [];
  const cases = await IntegrityCase.find(liveTagQuery(now, { studentId: new Types.ObjectId(studentId), outcome: "GUARDIAN_DID" })).select("subject tagUntil tagActive").lean();
  const subjects = [...new Set(cases.filter((c) => tagIsOn(c, now)).map((c) => c.subject))].sort();
  return subjects.map((subject) => ({ subject, noteBn: GUARDIAN_HELP_NOTE_BN }));
}
