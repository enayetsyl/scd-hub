/**
 * ClassTestResult — one student's result on a class test (CT-2, prd-tracker-class-test
 * §3.3, D-#121/#158). ONE row per (student × exam) — freely editable, NO retake /
 * resubmission lifecycle (distinct from the homework tracker, D-#121).
 *
 *   PRESENT → carries `marks` (0 ≤ marks ≤ the test's totalMarks); percent and
 *             pass/fail are DERIVED at read time, never stored (D-#85).
 *   ABSENT  → carries NO marks (excluded from class denominators, §4); feeds the
 *             Absent guardian template (CT-3).
 *
 * `weakness` + `guardianAction` are parent-facing (reach the guardian card / message
 * at CT-3); `teacherAction` is INTERNAL (never exposed to a guardian, J7/D-#68).
 *
 * `publishedAt` / `publishedVersion` exist on the model now (the §3.3 shape) but the
 * publish flow + guardian delivery is CT-3 — this slice never sets them beyond the
 * `publishedVersion: 0` default (an unpublished result).
 *
 * Build ruling D-#145 convention: NO `schoolId` (single-school live repo — the CT-1 /
 * MT-1 D-#140 precedent). Operational/identity plane behind the ADR-005 firewall
 * (names studentId) — no corpus path.
 */
import { Schema, model, Document, Types } from "mongoose";
import { CLASS_TEST_ATTENDANCE_STATUSES } from "@scd/shared";
import type { ClassTestAttendanceStatus } from "@scd/shared";

export interface IClassTestResult extends Document {
  _id: Types.ObjectId;
  testId: Types.ObjectId;
  studentId: Types.ObjectId;
  status: ClassTestAttendanceStatus;
  /** Only when PRESENT; 0 ≤ marks ≤ the test's totalMarks. Undefined when ABSENT. */
  marks?: number;
  /** Parent-facing observation (reaches the guardian card at CT-3). */
  weakness?: string;
  /** INTERNAL teacher note — never exposed to a guardian (J7/D-#68). */
  teacherAction?: string;
  /** Parent-facing "what the guardian should do". */
  guardianAction?: string;
  /** CT-8 approval gate: teacher proposes for release (guardian does NOT see yet). */
  submittedAt?: Date;
  submittedBy?: Types.ObjectId;
  /** CT-8: Office/Principal "send back" — reason returned to the teacher; row → DRAFT. */
  sendBackReason?: string;
  sendBackAt?: Date;
  sendBackBy?: Types.ObjectId;
  /** Set on APPROVE (CT-8) — the guardian-visible flag (was: CT-3 teacher publish). */
  publishedAt?: Date;
  /** Bumped on each (re)publish so CT-3's dedupeKey re-notifies (default 0 = unpublished). */
  publishedVersion: number;
  enteredBy: Types.ObjectId;
  /** CS-2 (docs/prd-ct-scripts.md §5, D-#716): the scanned pages of this student's
   *  script, in order (StoredFile kind `classtest_script`). */
  scriptFileIds?: Types.ObjectId[];
  /** A PRESENT student whose paper was not received (lost / not handed in) — lets
   *  the test reach UPLOAD_DONE without a scan. Never set on an ABSENT row. */
  scriptMissing?: boolean;
  scriptMissingReason?: string | null;
  scriptTaggedBy?: Types.ObjectId | null;
  scriptTaggedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ClassTestResultSchema = new Schema<IClassTestResult>(
  {
    testId: { type: Schema.Types.ObjectId, ref: "ClassTest", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    status: { type: String, enum: CLASS_TEST_ATTENDANCE_STATUSES, required: true },
    marks: { type: Number, min: 0 },
    weakness: { type: String, trim: true },
    teacherAction: { type: String, trim: true },
    guardianAction: { type: String, trim: true },
    submittedAt: { type: Date },
    submittedBy: { type: Schema.Types.ObjectId },
    sendBackReason: { type: String, trim: true },
    sendBackAt: { type: Date },
    sendBackBy: { type: Schema.Types.ObjectId },
    publishedAt: { type: Date },
    publishedVersion: { type: Number, required: true, default: 0, min: 0 },
    enteredBy: { type: Schema.Types.ObjectId, required: true },
    scriptFileIds: { type: [{ type: Schema.Types.ObjectId, ref: "StoredFile" }], default: undefined },
    scriptMissing: { type: Boolean },
    scriptMissingReason: { type: String, trim: true, default: null },
    scriptTaggedBy: { type: Schema.Types.ObjectId, default: null },
    scriptTaggedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One result per student per exam (the §3.3 invariant; the upsert key).
ClassTestResultSchema.index({ testId: 1, studentId: 1 }, { unique: true });
// CS-2: the file read gate reverse-resolves a scan to its owning row.
ClassTestResultSchema.index({ scriptFileIds: 1 }, { sparse: true });
// D-#751: the admin dashboard's "submitted, awaiting approval" read (unpublished + submitted).
ClassTestResultSchema.index({ publishedAt: 1, submittedAt: 1 });

export const ClassTestResult = model<IClassTestResult>("ClassTestResult", ClassTestResultSchema);
