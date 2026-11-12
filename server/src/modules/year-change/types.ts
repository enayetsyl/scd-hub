/**
 * Year-change engine types (YC-4, docs/prd-year-change.md section 3, owner rulings 2026-11-12).
 *
 * No roll numbers anywhere (D-#1463): the student ID orders and labels children.
 */
import type { Role } from "@scd/shared";

export type SectionCode = "Main" | "Boys" | "Girls";
export const SECTION_CODES: readonly SectionCode[] = ["Main", "Boys", "Girls"];
/** Section names (owner ruling): 'মূল' for Nursery-C2, 'বালক' / 'বালিকা' for C3-C6. */
export const SECTION_LABEL_BN: Record<SectionCode, string> = { Main: "মূল", Boys: "বালক", Girls: "বালিকা" };

export type Decision = "PROMOTE" | "REPEAT" | "LEFT";
export type Gender = "male" | "female" | "other";

export interface ClassPlanInput {
  level: number;
  /** One section (Main) or Boys+Girls (or just one of them). */
  sections: SectionCode[];
}
export interface PromotionInput {
  studentId: string;
  decision: Decision;
  /** Optional manual placement; otherwise same-named section, or by gender when the target is split. */
  toSectionCode?: SectionCode;
}
export interface AdmissionInput {
  /** Typed by the Office; the engine checks uniqueness. */
  schoolId: string;
  name: string;
  nameBn?: string;
  gender: Gender;
  level: number;
  sectionCode?: SectionCode;
  guardianPhone: string;
}
export interface ClassTeacherInput {
  level: number;
  sectionCode: SectionCode;
  teacherId: string | null;
}

export interface PlanInput {
  fromYearId: string;
  toYearId: string;
  classPlan?: ClassPlanInput[];
  promotions?: PromotionInput[];
  admissions?: AdmissionInput[];
  classTeachers?: ClassTeacherInput[];
}

export interface PlanSectionRow {
  code: SectionCode;
  nameBn: string;
  /** Id of the existing next-year section, or null when the run would create it. */
  existingId: string | null;
  /** Children who will be in it (promoted in + repeaters + admissions). */
  children: number;
}
export interface PlanClassRow {
  level: number;
  nameBn: string;
  existingId: string | null;
  sections: PlanSectionRow[];
  promotedIn: number;
  repeaters: number;
  admissions: number;
  total: number;
  /** Children of THIS level (this year) who leave. */
  left: number;
}
export interface PlanEnrolmentRow {
  studentId: string;
  schoolId: string;
  name: string;
  fromLevel: number;
  fromSectionCode: string;
  decision: "PROMOTE" | "REPEAT";
  outcome: "PROMOTED" | "REPEATED";
  toLevel: number;
  toSectionCode: SectionCode;
  /** A PLANNED row of the same placement already exists (idempotent re-run). */
  exists: boolean;
  /** A PLANNED row of THIS run exists but in another section: it is moved (reconciled). */
  update: boolean;
}
export interface PlanLeaverRow {
  studentId: string;
  schoolId: string;
  name: string;
  fromLevel: number;
  fromSectionCode: string;
}
export interface PlanAdmissionRow {
  schoolId: string;
  name: string;
  nameBn?: string;
  gender: Gender;
  toLevel: number;
  toSectionCode: SectionCode;
  guardianPhone: string;
  exists: boolean;
  /** The admission exists from this run but was edited: it is updated, not skipped. */
  changed: boolean;
}
export interface PlanClassTeacherRow {
  level: number;
  sectionCode: SectionCode;
  teacherId: string;
  source: "PREFILLED" | "CHOSEN";
  /** The section already has this teacher (no write). */
  alreadySet: boolean;
}

export interface YearChangePlan {
  fromYearId: string;
  toYearId: string;
  fromLabel: string;
  toLabel: string;
  /** First day of the new year as a Dhaka date key, and the last day of the old one. */
  startKey: string;
  closeKey: string;
  classes: PlanClassRow[];
  enrolments: PlanEnrolmentRow[];
  leavers: PlanLeaverRow[];
  admissions: PlanAdmissionRow[];
  classTeachers: PlanClassTeacherRow[];
  /** The prepared run of this year pair being reconciled (null on a first prepare). */
  runId: string | null;
  /** Rows of THIS run the new plan no longer contains (deleted by the apply). */
  reconcile: {
    removeEnrolments: Array<{ studentId: string; schoolId: string; reason: string }>;
    removeAdmissions: Array<{ studentId: string; schoolId: string }>;
  };
  counts: {
    classesToCreate: number;
    sectionsToCreate: number;
    enrolmentsToCreate: number;
    enrolmentsExisting: number;
    promoted: number;
    repeaters: number;
    left: number;
    admissionsToCreate: number;
    admissionsExisting: number;
    classTeachersToSet: number;
    enrolmentsToUpdate: number;
    enrolmentsToRemove: number;
    admissionsToUpdate: number;
    admissionsToRemove: number;
  };
  /** Anything here blocks `applyPrepare`. */
  refusals: string[];
  /** Worth a look, never blocks. */
  warnings: string[];
}

/** Who is acting. The service checks the `year_change:*` right itself. */
export interface YearChangeActor {
  userId: string;
  role: Role;
  additionalTemplates?: readonly Role[];
}

/** Refusal that carries every reason (the dry run lists them all). */
export class YearChangeRefusal extends Error {
  constructor(public readonly reasons: string[]) {
    super(reasons.join("; "));
    this.name = "YearChangeRefusal";
  }
}

/** Bangla class names used only when the past year has no row of that level to copy the name from. */
export const LEVEL_NAME_BN: Record<number, string> = {
  [-1]: "নার্সারি",
  0: "কেজি",
  1: "প্রথম শ্রেণি",
  2: "দ্বিতীয় শ্রেণি",
  3: "তৃতীয় শ্রেণি",
  4: "চতুর্থ শ্রেণি",
  5: "পঞ্চম শ্রেণি",
  6: "ষষ্ঠ শ্রেণি",
};

/** The 2027 shape of owner ruling 2026-11-12: Nursery-C2 one section, C3-C6 Boys/Girls. */
export function defaultSections(level: number): SectionCode[] {
  return level >= 3 ? ["Boys", "Girls"] : ["Main"];
}

/** A section list is valid when it is exactly [Main], or a non-empty subset of {Boys, Girls}. */
export function validSectionShape(sections: readonly SectionCode[]): boolean {
  if (new Set(sections).size !== sections.length) return false;
  if (sections.length === 1 && sections[0] === "Main") return true;
  return sections.length > 0 && sections.every((c) => c === "Boys" || c === "Girls");
}
