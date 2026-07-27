/**
 * ClassTestService (CT-1, prd-tracker-class-test §3/§5, D-#119/#120) — the
 * print-request → official-exam lifecycle on the class-test header.
 *
 *   generateCtId       — atomic CT-C{class}-{SUBJECT}-{nnnn} (D-#34 pattern).
 *   suggestTestNumber  — max human Test# for (year, class, subject) + 1.
 *   createRequest      — the teacher files a print request (REQUESTED): paper =
 *                        an assembled CT-kind set (setId) OR an uploaded paper
 *                        (questionFileId, owned by the requester). year/level/
 *                        class are RESOLVED from the section (D-#143), never
 *                        client-supplied. passMark defaults to round(0.40×total).
 *   markPrinted        — Office: REQUESTED → PRINTED, stamps printedBy/At. THE
 *                        RECORD IS NOW THE OFFICIAL EXAM (the exam-date deadline
 *                        anchor; the school-day derivation is CT-2).
 *   cancelRequest      — Office: REQUESTED → CANCELLED for a withdrawn request
 *                        (a PRINTED official exam can never be cancelled here).
 *
 * Write-scope (teacher `tracker:write` + `assertCanWrite` on the section; Office
 * `roster:manage`) is enforced by the RESOLVER — this service trusts the actor.
 * Audit: CLASS_TEST_REQUESTED / _PRINTED / _CANCELLED (append-only, ADR-008).
 */
import { Types } from "mongoose";
import {
  HW_SUBJECTS,
  CLASS_TEST_SOURCES,
} from "@scd/shared";
import type { HwSubject, ClassTestSource } from "@scd/shared";
import { ClassTest, type IClassTest } from "../models/ClassTest";
import { ClassTestSequence } from "../models/ClassTestSequence";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { dateKeyOf } from "../../attendance/dates";
import { AssessmentSet } from "../../assessment/models/AssessmentSet";
import { StoredFile } from "../../platform/models/StoredFile";
import { writeAudit } from "../../platform/services/AuditService";
import { createPrintRequest } from "../../printing/services/PrintRequestService";
import { PrintRequest } from "../../printing/models/PrintRequest";
import { resolveSubjectTeacher } from "../subjectTeacher";

// ---------------------------------------------------------------------------
// CT_ID generation (D-#34 numbering pattern) + Test# auto-suggest
// ---------------------------------------------------------------------------

export async function generateCtId(
  academicYearId: string,
  classLevel: number,
  subject: HwSubject,
): Promise<string> {
  const counter = await ClassTestSequence.findOneAndUpdate(
    { academicYearId, classLevel, subject },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  const n = String(counter.seq).padStart(4, "0");
  return `CT-C${classLevel}-${subject}-${n}`;
}

/** The next human "Test #": one past the highest existing testNumber for this
 *  (year × class × subject), counting REQUESTED + PRINTED (a cancelled request
 *  doesn't consume a number). Default 1 when none exist. Editable by the teacher. */
export async function suggestTestNumber(
  academicYearId: string,
  classLevel: number,
  subject: HwSubject,
): Promise<number> {
  const top = (await ClassTest.findOne({
    academicYearId,
    classLevel,
    subject,
    status: { $ne: "CANCELLED" },
  })
    .sort({ testNumber: -1 })
    .select("testNumber")
    .lean()) as { testNumber?: number } | null;
  return (top?.testNumber ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// createRequest (teacher files the print request — J1)
// ---------------------------------------------------------------------------

export interface CreateClassTestRequestInput {
  sectionId: string;
  subject: string;
  examDate: string;
  totalMarks: number;
  /** Optional; default = round(0.40 × totalMarks). */
  passMark?: number;
  source: string;
  /** When POOL_SET — the assembled CT-kind AssessmentSet. */
  setId?: string;
  /** When UPLOADED_PAPER — the StoredFile (classtest_question) the actor uploaded. */
  questionFileId?: string;
  /** How to print the paper — carried onto the queue row. Defaults BW/SINGLE when the
   *  caller omits them (validated in `createPrintRequest`, never silently coerced). */
  colour?: string;
  sides?: string;
  /** D-#303: how many copies — a typed number (default 1) or one per student present
   *  on the EXAM day (`CLASS_PRESENT`; the class is the section's own, the use day
   *  is the exam date — both derived server-side). */
  copies?: number;
  copiesMode?: string;
  /** Optional; default = suggestTestNumber(...). Editable. */
  testNumber?: number;
  /** Optional; default 2 (admin-configurable). */
  deadlineDays?: number;
  notes?: string;
  /** D-#339: register as ALREADY official — born PRINTED (printedBy/At = actor/now),
   *  NO print-queue row. For tests held without an office print request. */
  skipPrint?: boolean;
  /** CT-question flow (owner ask 2026-07-20): the paper was uploaded by the OFFICE
   *  and teacher-CONFIRMED in review — waive the uploader-ownership check. Set
   *  ONLY by ClassTestQuestionService; never exposed to a resolver arg. */
  allowForeignQuestionFile?: boolean;
  /** The ACCOUNTABLE subject teacher. Optional: Principal/Office requesting on a
   *  teacher's behalf pick them explicitly; otherwise the routine decides, and
   *  only a routine with no teacher for the cell falls back to the actor. */
  teacherId?: string;
  actorId: string;
  /** True when the actor holds `roster:manage` (Principal/Office). When they create
   *  WITHOUT an explicit teacher pick AND the routine names nobody, we refuse rather
   *  than silently self-assign the test to the admin (owner 2026-07-27, D-#366) — the
   *  exam would otherwise land in the principal's account instead of the subject
   *  teacher's. A plain teacher (no roster:manage) still falls back to themselves. */
  actorCanManage?: boolean;
}

export interface ClassTestShape {
  id: string;
  ctId: string;
  academicYearId: string;
  classLevel: number;
  classId: string;
  sectionId: string;
  subject: string;
  testNumber: number;
  examDate: string;
  totalMarks: number;
  passMark: number;
  source: string;
  setId: string | null;
  questionFileId: string | null;
  status: string;
  deadlineDays: number;
  /** Accountable subject teacher (null on pre-field rows until backfilled). */
  teacherId: string | null;
  requestedBy: string;
  requestedAt: string;
  printedBy: string | null;
  printedAt: string | null;
  notes: string | null;
}

export function classTestShape(d: IClassTest): ClassTestShape {
  return {
    id: d._id.toString(),
    ctId: d.ctId,
    academicYearId: d.academicYearId.toString(),
    classLevel: d.classLevel,
    classId: d.classId.toString(),
    sectionId: d.sectionId.toString(),
    subject: d.subject,
    testNumber: d.testNumber,
    examDate: new Date(d.examDate).toISOString(),
    totalMarks: d.totalMarks,
    passMark: d.passMark,
    source: d.source,
    setId: d.setId ? d.setId.toString() : null,
    questionFileId: d.questionFileId ? d.questionFileId.toString() : null,
    status: d.status,
    deadlineDays: d.deadlineDays,
    teacherId: d.teacherId ? d.teacherId.toString() : null,
    requestedBy: d.requestedBy.toString(),
    requestedAt: new Date(d.requestedAt).toISOString(),
    printedBy: d.printedBy ? d.printedBy.toString() : null,
    printedAt: d.printedAt ? new Date(d.printedAt).toISOString() : null,
    notes: d.notes ?? null,
  };
}

/** round(0.40 × totalMarks) — the §3.2 / §4 default pass mark. */
export function defaultPassMark(totalMarks: number): number {
  return Math.round(0.4 * totalMarks);
}

export async function createRequest(
  input: CreateClassTestRequestInput,
): Promise<ClassTestShape> {
  if (!(HW_SUBJECTS as readonly string[]).includes(input.subject)) {
    throw new Error(`Unknown subject: ${input.subject}`);
  }
  const subject = input.subject as HwSubject;

  if (!(CLASS_TEST_SOURCES as readonly string[]).includes(input.source)) {
    throw new Error(`Unknown source: ${input.source}`);
  }
  const source = input.source as ClassTestSource;

  // --- derive year/level/class from the section (D-#143; never client-supplied)
  const section = (await Section.findById(input.sectionId)
    .select("classId")
    .lean()) as { classId: Types.ObjectId } | null;
  if (!section) throw new Error("Section not found");
  const klass = (await Class.findById(section.classId)
    .select("level academicYearId")
    .lean()) as { level: number; academicYearId: Types.ObjectId } | null;
  if (!klass) throw new Error("Class not found for this section");

  // --- exam date
  const examDate = new Date(input.examDate);
  if (Number.isNaN(examDate.getTime())) throw new Error("examDate is not a valid date");

  // --- marks + pass mark
  if (!Number.isInteger(input.totalMarks) || input.totalMarks < 1) {
    throw new Error("totalMarks must be a positive integer");
  }
  const passMark = input.passMark ?? defaultPassMark(input.totalMarks);
  if (!Number.isInteger(passMark) || passMark < 0 || passMark > input.totalMarks) {
    throw new Error("passMark must be an integer between 0 and totalMarks");
  }

  // --- paper source: exactly one of setId / questionFileId, validated
  let setId: Types.ObjectId | undefined;
  let questionFileId: Types.ObjectId | undefined;
  if (source === "POOL_SET") {
    if (!input.setId) throw new Error("A POOL_SET class test needs a setId");
    if (input.questionFileId) throw new Error("A POOL_SET class test cannot also carry an uploaded paper");
    // Guard the id shape first: a bad value (e.g. "1") makes findById throw a Mongoose
    // CastError that the error-mask hides as "Unexpected error." Surface a helpful message.
    if (!Types.ObjectId.isValid(input.setId)) {
      throw new Error("That set id is not valid — pick an assembled Class Test set from the list.");
    }
    const set = (await AssessmentSet.findById(input.setId)
      .select("setType")
      .lean()) as { setType: string } | null;
    if (!set) throw new Error("No assembled set found for that id — pick one from the list.");
    if (set.setType !== "CT") throw new Error("The linked set is not a CT-kind (class-test) set");
    setId = new Types.ObjectId(input.setId);
  } else {
    if (!input.questionFileId) throw new Error("An UPLOADED_PAPER class test needs a questionFileId");
    if (input.setId) throw new Error("An UPLOADED_PAPER class test cannot also carry a pool set");
    const file = (await StoredFile.findById(input.questionFileId)
      .lean()) as { kind: string; uploadedBy: Types.ObjectId } | null;
    if (!file) throw new Error("Question file not found");
    if (file.kind !== "classtest_question") throw new Error("The linked file is not a class-test question paper");
    // The uploader must be the requesting teacher (the file is theirs, §5.2) —
    // EXCEPT the reviewed CT-question flow, where the OFFICE uploaded the paper
    // and the teacher confirmed it (allowForeignQuestionFile, service-internal).
    if (!input.allowForeignQuestionFile && file.uploadedBy.toString() !== input.actorId) {
      throw new Error("The uploaded paper was not uploaded by this teacher");
    }
    questionFileId = new Types.ObjectId(input.questionFileId);
  }

  // --- test number (auto-suggest unless the teacher overrides)
  let testNumber = input.testNumber;
  if (testNumber === undefined) {
    testNumber = await suggestTestNumber(klass.academicYearId.toString(), klass.level, subject);
  }
  if (!Number.isInteger(testNumber) || testNumber < 1) {
    throw new Error("testNumber must be a positive integer");
  }

  // --- deadline days (admin-configurable, default 2)
  const deadlineDays = input.deadlineDays ?? 2;
  if (!Number.isInteger(deadlineDays) || deadlineDays < 0) {
    throw new Error("deadlineDays must be a non-negative integer");
  }

  // --- copies (D-#303): a typed number (default 1) or per-present on the EXAM day.
  const copiesMode = input.copiesMode ?? "FIXED";
  if (copiesMode !== "FIXED" && copiesMode !== "CLASS_PRESENT") {
    throw new Error("Invalid copiesMode");
  }
  const copies = input.copies ?? 1;
  if (copiesMode === "FIXED" && (!Number.isInteger(copies) || copies < 1)) {
    throw new Error("copies must be a positive integer");
  }

  const ctId = await generateCtId(klass.academicYearId.toString(), klass.level, subject);

  // The ACCOUNTABLE subject teacher: an explicit pick (Principal/Office requesting
  // on a teacher's behalf) wins; otherwise the routine names the section×subject
  // teacher for the exam day; only if the routine names nobody does it fall back to
  // the requester. Keeps the exam in the right teacher's account and report row.
  const routineTeacherId =
    input.teacherId ?? (await resolveSubjectTeacher(input.sectionId, subject, examDate));
  // Guard (D-#366): a Principal/Office creator who neither picked a teacher nor has a
  // routine teacher for this cell must not silently self-own the exam — force an
  // explicit pick. A plain subject teacher still falls back to themselves (their test).
  if (!routineTeacherId && input.actorCanManage) {
    throw new Error(
      "Pick the subject teacher: the routine names no teacher for this section × subject on the exam date, " +
        "so the test cannot be attributed automatically. Choose whose exam this is.",
    );
  }
  const subjectTeacherId = routineTeacherId ?? input.actorId;

  // D-#339: a no-print register is born PRINTED — the record is the official exam
  // immediately (deadline clock anchors on the exam date as usual).
  const now = new Date();
  const doc = await ClassTest.create({
    ctId,
    academicYearId: klass.academicYearId,
    classLevel: klass.level,
    classId: section.classId,
    sectionId: new Types.ObjectId(input.sectionId),
    subject,
    testNumber,
    examDate,
    totalMarks: input.totalMarks,
    passMark,
    source,
    setId,
    questionFileId,
    status: input.skipPrint ? "PRINTED" : "REQUESTED",
    deadlineDays,
    teacherId: new Types.ObjectId(subjectTeacherId),
    requestedBy: new Types.ObjectId(input.actorId),
    requestedAt: now,
    printedBy: input.skipPrint ? new Types.ObjectId(input.actorId) : undefined,
    printedAt: input.skipPrint ? now : undefined,
    notes: input.notes,
  });

  await writeAudit({
    eventKind: input.skipPrint ? "CLASS_TEST_PRINTED" : "CLASS_TEST_REQUESTED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ClassTest",
    meta: { ctId, subject, source, sectionId: input.sectionId, testNumber, ...(input.skipPrint ? { skipPrint: true } : {}) },
  });

  if (input.skipPrint) {
    // No print concern — no queue row (the whole point of the no-print register).
    return classTestShape(doc as unknown as IClassTest);
  }

  // PQ-5 (D-#281): the printing concern moves to the unified queue. The ClassTest keeps
  // its own lifecycle (results, publish); the Office advances BOTH from one screen, and
  // `mirrorToClassTest` keeps this record's status in step. `trusted` because the source
  // was validated above — a class test's uploaded paper is a `classtest_question` file,
  // not a `print_upload`.
  // D-#303: the queue row's title names the requesting teacher (the Office scans titles),
  // and the copies choice + exam-day use date ride along so CLASS_PRESENT resolves
  // against the exam day's attendance.
  const requester = (await User.findById(input.actorId).select("name").lean()) as {
    name?: string;
  } | null;
  const printRequest = await createPrintRequest({
    title: `${ctId} · ${subject}${requester?.name ? ` — ${requester.name}` : ""}`,
    purpose: "CLASS_TEST",
    sourceType: source === "POOL_SET" ? "SET" : "UPLOAD",
    setId: setId ? setId.toString() : null,
    fileIds: questionFileId ? [questionFileId.toString()] : null,
    colour: input.colour ?? null,
    sides: input.sides ?? null,
    copies: copiesMode === "FIXED" ? copies : null,
    copiesMode,
    copiesClassId: copiesMode === "CLASS_PRESENT" ? doc.classId.toString() : null,
    neededByKey: dateKeyOf(examDate),
    classId: doc.classId?.toString() ?? null,
    sectionId: input.sectionId,
    subject,
    notes: input.notes ?? null,
    requestedBy: input.actorId,
    classTestId: doc._id.toString(),
    trusted: true,
  });
  await ClassTest.updateOne({ _id: doc._id }, { $set: { printRequestId: printRequest._id } });

  return classTestShape(doc as unknown as IClassTest);
}

// ---------------------------------------------------------------------------
// markPrinted (Office — J2) + cancelRequest
// ---------------------------------------------------------------------------

export async function markPrinted(id: string, actorId: string): Promise<ClassTestShape> {
  const doc = await ClassTest.findById(id);
  if (!doc) throw new Error("ClassTest not found");
  if (doc.status !== "REQUESTED") {
    throw new Error(`Only a REQUESTED class test can be marked printed (this one is ${doc.status})`);
  }
  doc.status = "PRINTED";
  doc.printedBy = new Types.ObjectId(actorId);
  doc.printedAt = new Date();
  await doc.save();

  await writeAudit({
    eventKind: "CLASS_TEST_PRINTED",
    actorId,
    targetId: doc._id,
    targetKind: "ClassTest",
    meta: { ctId: doc.ctId },
  });

  // PQ-5: keep the unified queue row in step. The Office normally advances the job FROM
  // the queue (which mirrors this way), but this legacy entry point must not let the two
  // drift. Guarded on REQUESTED so a mirrored write can never double-apply.
  await PrintRequest.updateOne(
    { classTestId: doc._id, status: "REQUESTED" },
    { $set: { status: "PRINTED", printedBy: new Types.ObjectId(actorId), printedAt: new Date() } },
  );

  return classTestShape(doc as unknown as IClassTest);
}

export async function cancelRequest(id: string, actorId: string): Promise<ClassTestShape> {
  const doc = await ClassTest.findById(id);
  if (!doc) throw new Error("ClassTest not found");
  if (doc.status !== "REQUESTED") {
    throw new Error(`Only a REQUESTED class test can be cancelled (this one is ${doc.status})`);
  }
  doc.status = "CANCELLED";
  await doc.save();

  await writeAudit({
    eventKind: "CLASS_TEST_CANCELLED",
    actorId,
    targetId: doc._id,
    targetKind: "ClassTest",
    meta: { ctId: doc.ctId },
  });

  // PQ-5: withdraw the unified queue row too (see markPrinted).
  await PrintRequest.updateOne(
    { classTestId: doc._id, status: "REQUESTED" },
    { $set: { status: "CANCELLED", cancelledBy: new Types.ObjectId(actorId), cancelledAt: new Date() } },
  );

  return classTestShape(doc as unknown as IClassTest);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getClassTest(id: string): Promise<ClassTestShape | null> {
  const doc = (await ClassTest.findById(id).lean()) as IClassTest | null;
  return doc ? classTestShape(doc) : null;
}

/** The Office print queue: pending requests (REQUESTED), oldest first. */
export async function listPrintQueue(): Promise<ClassTestShape[]> {
  const docs = (await ClassTest.find({ status: "REQUESTED" })
    .sort({ requestedAt: 1 })
    .lean()) as unknown as IClassTest[];
  return docs.map(classTestShape);
}

/** A teacher's own class tests (any status), newest first — the exams they are the
 *  ACCOUNTABLE subject teacher for, plus any they requested themselves. The union
 *  means an exam an admin registered on a teacher's behalf lands in the teacher's
 *  account, while the admin still sees what they entered. */
export async function listMyClassTests(actorId: string): Promise<ClassTestShape[]> {
  const docs = (await ClassTest.find({
    $or: [{ teacherId: actorId }, { requestedBy: actorId }],
  })
    .sort({ requestedAt: -1 })
    .lean()) as unknown as IClassTest[];
  return docs.map(classTestShape);
}

/** Class tests for a section (read-scope enforced by the resolver). */
export async function listClassTestsForSection(sectionId: string): Promise<ClassTestShape[]> {
  const docs = (await ClassTest.find({ sectionId })
    .sort({ requestedAt: -1 })
    .lean()) as unknown as IClassTest[];
  return docs.map(classTestShape);
}
