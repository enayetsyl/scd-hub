/**
 * ClassTest — the exam header / print request (CT-1, prd-tracker-class-test §3.2,
 * D-#119/#120). ONE row per class test: born as the teacher's print request
 * (REQUESTED) and promoted to the official exam record on the Office's
 * mark-printed action (PRINTED); CANCELLED for a withdrawn request.
 *
 * The paper is either an assembled CT-kind question-pool set (`setId`, when
 * source = POOL_SET) or the teacher's own uploaded paper (`questionFileId` →
 * StoredFile `classtest_question`, when source = UPLOADED_PAPER) — exactly one.
 *
 * ANCHOR (D-#507): EXACTLY ONE of `sectionId` (a general-subject exam for one
 * section — every row before D-#507) or `subjectGroupId` (a cross-class Quran/
 * Arabic group, D-#48/#56). The ClassroomObservation anchor shape, for the same
 * reason: Arabic is taught to groups that mix students from several CLASSES, so a
 * group exam has no single section and no single class level. On a group-anchored
 * row `classId`/`classLevel` are therefore null and the roster is the group's
 * membership, not a section's.
 *
 * Build rulings (server-only, single-school live repo — AGENTS rule 3):
 *  - D-#145: NO `schoolId` (the §3.2 sketch lists it, but every live feature
 *    model drops it under the single-school convention — MT D-#140 precedent).
 *    (renumbered from D-#142 at merge — VC-3 took #142.)
 *  - D-#143: `academicYearId` + `classLevel` + `classId` are RESOLVED
 *    server-side from the section (Section → Class.level/academicYearId), never
 *    client-supplied — the §3.2 sketch named only classLevel+sectionId, but the
 *    §3.4 "year-continuous" sequence needs the year, and deriving the level
 *    server-side blocks sequence-key spoofing (the AssignmentItem D-#34 posture).
 *    On a group anchor there is no section to derive from, so the year comes from
 *    the CURRENT AcademicYear and the class fields stay null.
 *
 * `testNumber` is the human "Test #" (auto-suggested = max for this
 * class+subject + 1, editable); `ctId` is the atomic unique key. `deadlineDays`
 * is stored here (admin-configurable, default 2) — the school-day-aware deadline
 * derivation off `examDate` is CT-2, not built in this slice.
 *
 * Operational/identity plane behind the ADR-005 firewall (per-student results
 * land at CT-2). No corpus path.
 */
import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS, CLASS_TEST_SOURCES, CLASS_TEST_STATUSES } from "@scd/shared";
import type { HwSubject, ClassTestSource, ClassTestStatus } from "@scd/shared";

export interface IClassTest extends Document {
  _id: Types.ObjectId;
  /** CT_ID — `CT-C{class}-{SUBJECT}-{nnnn}` for a section anchor (D-#34), or
   *  `CT-G-{GROUP_CODE}-{nnnn}` for a subject-group anchor (D-#507). Unique,
   *  year-continuous. */
  ctId: string;
  academicYearId: Types.ObjectId;
  /** Section anchor only — null on a group-anchored row (a group spans classes). */
  classLevel?: number | null;
  classId?: Types.ObjectId | null;
  /** EXACTLY ONE of sectionId / subjectGroupId is set (validated in the service). */
  sectionId?: Types.ObjectId | null;
  /** D-#507: the cross-class Quran/Arabic group this exam was held for. */
  subjectGroupId?: Types.ObjectId | null;
  subject: HwSubject;
  /** Human "Test #" — auto-suggested (max+1 for class+subject), editable. */
  testNumber: number;
  examDate: Date;
  totalMarks: number;
  /** Configurable per test; default round(0.40 × totalMarks). */
  passMark: number;
  source: ClassTestSource;
  /** When POOL_SET — the assembled CT-kind AssessmentSet. */
  setId?: Types.ObjectId;
  /** When UPLOADED_PAPER — the StoredFile (classtest_question). */
  questionFileId?: Types.ObjectId;
  status: ClassTestStatus;
  /** School-days after examDate before the report is due (CT-2 derives it). */
  deadlineDays: number;
  /** The queue row this test's PRINTING is tracked on (PQ-5, D-#281). The Office
   *  works the unified PrintRequest queue; this test's status mirrors it. */
  printRequestId?: Types.ObjectId;
  /** The ACCOUNTABLE subject teacher — whose exam this is, whose account it shows
   *  in, and who the report attributes it to. Defaulted from the routine at
   *  creation (overridable when an admin requests on a teacher's behalf), so
   *  `requestedBy` stays purely "who entered it". Optional: rows created before
   *  this field are backfilled from the routine; readers fall back to
   *  `requestedBy`. Mirrors AssignmentItem.teacherId / .deliveredBy. */
  teacherId?: Types.ObjectId;
  requestedBy: Types.ObjectId;
  requestedAt: Date;
  printedBy?: Types.ObjectId;
  printedAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ClassTestSchema = new Schema<IClassTest>(
  {
    ctId: { type: String, required: true, unique: true },
    academicYearId: { type: Schema.Types.ObjectId, required: true },
    // Section anchor: class fields derived from it. Group anchor: all three null.
    classLevel: { type: Number, default: null },
    classId: { type: Schema.Types.ObjectId, ref: "Class", default: null },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", default: null },
    subjectGroupId: { type: Schema.Types.ObjectId, ref: "SubjectGroup", default: null },
    subject: { type: String, enum: HW_SUBJECTS, required: true },
    testNumber: { type: Number, required: true, min: 1 },
    examDate: { type: Date, required: true },
    totalMarks: { type: Number, required: true, min: 1 },
    passMark: { type: Number, required: true, min: 0 },
    source: { type: String, enum: CLASS_TEST_SOURCES, required: true },
    setId: { type: Schema.Types.ObjectId, ref: "AssessmentSet" },
    questionFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    status: { type: String, enum: CLASS_TEST_STATUSES, required: true, default: "REQUESTED" },
    deadlineDays: { type: Number, required: true, default: 2, min: 0 },
    teacherId: { type: Schema.Types.ObjectId },
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    requestedAt: { type: Date, required: true, default: () => new Date() },
    printedBy: { type: Schema.Types.ObjectId },
    printedAt: { type: Date },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

// Office print queue: pending requests, oldest first.
ClassTestSchema.index({ status: 1, requestedAt: 1 });
// Teacher's own requests + testNumber auto-suggest scan (per class+subject+year).
ClassTestSchema.index({ academicYearId: 1, classLevel: 1, subject: 1 });
ClassTestSchema.index({ requestedBy: 1, requestedAt: -1 });
// The subject teacher's own exams (their account / the report's teacher filter).
ClassTestSchema.index({ teacherId: 1, requestedAt: -1 });
ClassTestSchema.index({ sectionId: 1, status: 1 });
// D-#507: the group's own exams (the group teacher's list + the roster reads).
ClassTestSchema.index({ subjectGroupId: 1, requestedAt: -1 });

export const ClassTest = model<IClassTest>("ClassTest", ClassTestSchema);
