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
import { AssessmentSet } from "../../assessment/models/AssessmentSet";
import { StoredFile } from "../../platform/models/StoredFile";
import { writeAudit } from "../../platform/services/AuditService";
import { createPrintRequest } from "../../printing/services/PrintRequestService";
import { PrintRequest } from "../../printing/models/PrintRequest";

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
  /** Optional; default = suggestTestNumber(...). Editable. */
  testNumber?: number;
  /** Optional; default 2 (admin-configurable). */
  deadlineDays?: number;
  notes?: string;
  actorId: string;
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
    // The uploader must be the requesting teacher (the file is theirs, §5.2).
    if (file.uploadedBy.toString() !== input.actorId) {
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

  const ctId = await generateCtId(klass.academicYearId.toString(), klass.level, subject);

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
    status: "REQUESTED",
    deadlineDays,
    requestedBy: new Types.ObjectId(input.actorId),
    requestedAt: new Date(),
    notes: input.notes,
  });

  await writeAudit({
    eventKind: "CLASS_TEST_REQUESTED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ClassTest",
    meta: { ctId, subject, source, sectionId: input.sectionId, testNumber },
  });

  // PQ-5 (D-#281): the printing concern moves to the unified queue. The ClassTest keeps
  // its own lifecycle (results, publish); the Office advances BOTH from one screen, and
  // `mirrorToClassTest` keeps this record's status in step. `trusted` because the source
  // was validated above — a class test's uploaded paper is a `classtest_question` file,
  // not a `print_upload`.
  const printRequest = await createPrintRequest({
    title: `${ctId} · ${subject}`,
    purpose: "CLASS_TEST",
    sourceType: source === "POOL_SET" ? "SET" : "UPLOAD",
    setId: setId ? setId.toString() : null,
    fileIds: questionFileId ? [questionFileId.toString()] : null,
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

/** A teacher's own class tests (any status), newest first. */
export async function listMyClassTests(actorId: string): Promise<ClassTestShape[]> {
  const docs = (await ClassTest.find({ requestedBy: actorId })
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
