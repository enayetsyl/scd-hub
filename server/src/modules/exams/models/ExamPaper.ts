/**
 * ExamPaper — one subject's paper for one class in one exam (EX-1, D-#375/#376).
 *
 * COMPOSITION IS PER PAPER, NEVER PER CLASS BAND (D-#376). The obvious model — a
 * `classLevel → components` lookup — is wrong, and two independent findings prove it:
 *
 *   1. Class 3 Mathematics genuinely had no CT this cycle: ~16 of 17 Class-3 cards show a
 *      blank CT cell, so that ONE paper is ADAB/10 + FINAL/90 while its seven siblings are
 *      CT/10 + ADAB/10 + FINAL/80. A per-band lookup would have written a silent 0 CT into
 *      sixteen students' Maths rows and dragged each of their grades down a band.
 *   2. Nursery and KG share an identical subject list (Bangla/English/Math/Arabic/Quran)
 *      but NOT a component shape — Nursery is FINAL/100 only, KG is ADAB/10 + FINAL/90.
 *      A `subjects → components` map would collapse them and print an Adab column on a
 *      Nursery card.
 *
 * So three shapes are valid on day one and `components.length === 1` is NOT an error:
 *   1-component  Nursery            FINAL/100
 *   2-component  KG, C3 Maths       ADAB/10 + FINAL/90
 *   3-component  everything else    CT/10 + ADAB/10 + FINAL/80
 *
 * The ONLY composition guard is `Σ maxMarks === EXAM_PAPER_COMPONENT_TOTAL` (100).
 *
 * `paperFullMarks` is what the physical script was marked out of (the scans show 80, 100,
 * 200). The FINAL component's converted value is DERIVED on read via `convertMark`, never
 * stored (D-#85/D-#377a) — the hand arithmetic in the source margins is exactly what this
 * field exists to delete.
 */
import { Schema, model, Document, Types } from "mongoose";
import { EXAM_COMPONENTS, ROUTINE_SUBJECTS, CT_AGGREGATION_MODES } from "@scd/shared";
import type { ExamComponent, RoutineSubject, CtAggregationMode } from "@scd/shared";

export interface IPaperComponent {
  component: ExamComponent;
  maxMarks: number;
}

export interface IExamPaper extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  classId: Types.ObjectId;
  /** Optional: null means "the whole class". Present so a future split into real sections
   *  migrates no exam data (D-#379). */
  sectionId?: Types.ObjectId;
  /** ROUTINE_SUBJECTS, not SUBJECTS — the card needs ARABIC/ISLAM/QURAN, which the
   *  content-plane `SUBJECTS` enum deliberately does not carry (D-#54). */
  subject: RoutineSubject;
  components: IPaperComponent[];
  /** What the physical script was marked out of. */
  paperFullMarks: number;
  /** Per-paper override of the exam's CT aggregation rule (D-#378). */
  ctAggregationOverride?: { mode: CtAggregationMode; bestN?: number };
  examDateKey?: string;
  /** Reuses the Office print queue (D-#281/PQ) — this module never re-implements printing. */
  printRequestId?: Types.ObjectId;
  questionsPrintedCount?: number;
  /** EX-4: set when the paper's marks are locked. A tabulated paper is edit-locked; re-open
   *  is an audited `exam:manage` action. */
  tabulatedAt?: Date;
  tabulatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PaperComponentSchema = new Schema<IPaperComponent>(
  {
    component: { type: String, enum: EXAM_COMPONENTS, required: true },
    maxMarks: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false },
);

const ExamPaperSchema = new Schema<IExamPaper>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    subject: { type: String, enum: ROUTINE_SUBJECTS, required: true },
    components: { type: [PaperComponentSchema], required: true },
    paperFullMarks: { type: Number, required: true, min: 1 },
    ctAggregationOverride: {
      type: new Schema(
        {
          mode: { type: String, enum: CT_AGGREGATION_MODES, required: true },
          bestN: { type: Number, min: 1 },
        },
        { _id: false },
      ),
      required: false,
    },
    examDateKey: { type: String, trim: true },
    printRequestId: { type: Schema.Types.ObjectId, ref: "PrintRequest" },
    questionsPrintedCount: { type: Number, min: 0 },
    tabulatedAt: { type: Date },
    tabulatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

// One paper per (exam × class × subject) — the §6 invariant and the upsert key.
ExamPaperSchema.index({ examId: 1, classId: 1, subject: 1 }, { unique: true });
ExamPaperSchema.index({ examId: 1 });

export const ExamPaper = model<IExamPaper>("ExamPaper", ExamPaperSchema);
