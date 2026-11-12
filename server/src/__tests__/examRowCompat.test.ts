/**
 * ONE exam record (ported 2026-11-11): the EX-1..EX-9 fields EXTEND the SY-1 `Exam` row,
 * they do not replace it. This pins the two promises that make that safe with no data
 * migration:
 *
 *   1. A row written by SY-1 — year, term, name, dates, createdBy; NO status, NO grade scale,
 *      NO CT rule, NO fail rule — still validates and loads, and reads back the EX defaults
 *      (PLANNED, the printed 2026 scale, MEAN, ANY_SUBJECT_F, publishedVersion 0).
 *   2. Everything the syllabus, exam routine, oral exam (viva), Quran exam, worksheet and
 *      paper-bank code reads — the identity fields and the one-per-(year, term) index — is
 *      exactly as it was, and the `exams` list answers those fields unchanged.
 *
 * DB-free, like the rest of the suite: `validateSync`, `hydrate` and the schema's own path
 * and index definitions are all in-memory mongoose.
 */
import mongoose from "mongoose";
import { DEFAULT_GRADE_SCALE, EXAM_TERMS } from "@scd/shared";
import { Exam } from "../modules/exams/models/Exam";
import { examCtAggregation, examGradeScale, examStatus } from "../modules/exams/examDefaults";
import { toShape, type ExamRowLike } from "../modules/exams/resolvers/exams";

const oid = () => new mongoose.Types.ObjectId();

/** Exactly the shape SY-1 writes (ExamService.createExam before EX-1). */
function sy1Row() {
  return {
    _id: oid(),
    academicYearId: oid(),
    term: "ANNUAL",
    name: "বার্ষিক পরীক্ষা ২০২৬",
    startDateKey: "2026-12-07",
    endDateKey: "2026-12-16",
    createdBy: oid(),
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
  };
}

describe("an SY-1 exam row (no status, no grade scale) stays valid", () => {
  test("it validates with no EX field supplied — no migration needed", () => {
    const { _id, createdAt, updatedAt, ...fields } = sy1Row();
    void _id; void createdAt; void updatedAt;
    const doc = new Exam(fields);
    expect(doc.validateSync()).toBeUndefined();
  });

  test("loaded from the database (hydrated), it carries the EX defaults", () => {
    const doc = Exam.hydrate(sy1Row());
    expect(doc.status).toBe("PLANNED");
    expect(doc.gradeScale.map((b) => b.letter)).toEqual(DEFAULT_GRADE_SCALE.map((b) => b.letter));
    expect(doc.failRule).toBe("ANY_SUBJECT_F");
    expect(doc.ctAggregation.mode).toBe("MEAN");
    expect(doc.publishedVersion).toBe(0);
    expect(doc.publishedAt).toBeUndefined();
    // Not guardian-visible: an SY-1 row was never published through EX-9.
  });

  test("read lean (no mongoose defaults), the read-side helpers give the same defaults", () => {
    const lean = sy1Row();
    expect(examStatus(lean)).toBe("PLANNED");
    expect(examGradeScale(lean)).toHaveLength(DEFAULT_GRADE_SCALE.length);
    expect(examCtAggregation(lean)).toEqual({ mode: "MEAN", bestN: 3 });
  });

  test("the default scale is a fresh copy — editing one exam's scale never edits another's", () => {
    const a = examGradeScale({});
    a[0].minPercent = 1;
    expect(examGradeScale({})[0].minPercent).toBe(DEFAULT_GRADE_SCALE[0].minPercent);
  });
});

describe("the SY-1 readers see exactly what they saw before", () => {
  const paths = Exam.schema.paths;

  test("identity fields keep their type, requiredness and enum", () => {
    expect(paths.academicYearId.instance).toBe("ObjectId");
    expect(paths.academicYearId.isRequired).toBe(true);
    expect(paths.term.instance).toBe("String");
    expect(paths.term.isRequired).toBe(true);
    expect((paths.term as unknown as { enumValues: string[] }).enumValues).toEqual([...EXAM_TERMS]);
    expect(paths.name.instance).toBe("String");
    expect(paths.name.isRequired).toBe(true);
    expect(paths.startDateKey.instance).toBe("String");
    expect(paths.startDateKey.isRequired).toBeFalsy();
    expect(paths.endDateKey.instance).toBe("String");
    expect(paths.endDateKey.isRequired).toBeFalsy();
    expect(paths.createdBy.isRequired).toBe(true);
  });

  test("still ONE exam per (year, term) — the index the syllabus coverage relies on", () => {
    const unique = Exam.schema
      .indexes()
      .filter(([, opts]) => (opts as { unique?: boolean }).unique)
      .map(([keys]) => keys);
    expect(unique).toEqual([{ academicYearId: 1, term: 1 }]);
  });

  test("the `exams` list answers an SY-1 row's own fields unchanged", () => {
    const row = sy1Row();
    const shape = toShape(row as unknown as ExamRowLike);
    expect(shape).toMatchObject({
      id: row._id.toString(),
      academicYearId: row.academicYearId.toString(),
      term: "ANNUAL",
      name: "বার্ষিক পরীক্ষা ২০২৬",
      startDateKey: "2026-12-07",
      endDateKey: "2026-12-16",
    });
    // …and the EX fields arrive defaulted, never null, so an older screen and a newer one agree.
    expect(shape.status).toBe("PLANNED");
    expect(shape.gradeScale).toHaveLength(DEFAULT_GRADE_SCALE.length);
    expect(shape.ctAggregationMode).toBe("MEAN");
    expect(shape.publishedAt).toBeNull();
  });

  test("missing dates stay null (the SY-1 contract), not undefined", () => {
    const row = { ...sy1Row(), startDateKey: undefined, endDateKey: undefined };
    const shape = toShape(row as unknown as ExamRowLike);
    expect(shape.startDateKey).toBeNull();
    expect(shape.endDateKey).toBeNull();
  });
});
