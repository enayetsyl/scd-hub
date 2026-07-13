/**
 * PrintRequestService (PQ-1, D-#281) — the print queue's status machine.
 *
 *   REQUESTED ──markPrinted──► PRINTED ──markDelivered──► DELIVERED
 *       │                         (Office / Principal, roster:manage)
 *       └──cancel──► CANCELLED   (requester while REQUESTED, or the Office)
 *
 * Three live statuses = the Office's three buckets (yet to print / printing done /
 * delivered). A PRINTED job cannot be cancelled — the paper already exists.
 * Every transition guards the CURRENT status and writes an audit row, mirroring
 * `ClassTestService` (which this generalizes).
 *
 * Sources are references by id, never PDF snapshots (see the model's header).
 */
import { Types } from "mongoose";
import { MAX_PRINT_UPLOADS, PLAN_DOC_TYPES, PRINT_COLOURS, PRINT_PURPOSES, PRINT_SIDES, PRINT_SOURCES } from "@scd/shared";
import type { PrintColour, PrintPurpose, PrintRequestStatus, PrintSides, PrintSource } from "@scd/shared";
import { PrintRequest, type IPrintRequest } from "../models/PrintRequest";
import { AssessmentSet } from "../../assessment/models/AssessmentSet";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { StoredFile } from "../../platform/models/StoredFile";
import { writeAudit } from "../../platform/services/AuditService";
import { emitPrintDelivered } from "../../notifications/services/emitters";
import { ClassTest } from "../../trackers/models/ClassTest";
import { classPresenceForDate } from "../../attendance/services/AttendanceReportService";
import { dateKeyOf } from "../../attendance/dates";
import { publishRealtime } from "../../realtime/bus";

export class PrintRequestError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PrintRequestError";
  }
}

export interface CreatePrintRequestInput {
  title: string;
  purpose: string;
  sourceType: string;
  setId?: string | null;
  contentArtifactId?: string | null;
  fileIds?: string[] | null;
  linkUrl?: string | null;
  /** Mandatory on a teacher's request; defaulted on the internal (trusted) path. */
  colour?: string | null;
  sides?: string | null;
  copies?: number | null;
  /** D-#294: FIXED (typed number, default) | CLASS_PRESENT (per student present on the use day). */
  copiesMode?: string | null;
  copiesClassId?: string | null;
  neededByKey?: string | null;
  classId?: string | null;
  sectionId?: string | null;
  subject?: string | null;
  notes?: string | null;
  requestedBy: string;
  /** PQ-5: this job IS a class-test paper — links the two records. */
  classTestId?: string | null;
  /**
   * PQ-5 internal caller (`ClassTestService`) that has ALREADY validated its source.
   * Skips `assertSourceResolves`, because a class test's uploaded paper is a
   * `classtest_question` StoredFile, not a `print_upload` — it was uploaded through
   * the class-test route and gated there. Never set from a GraphQL arg.
   */
  trusted?: boolean;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Only absolute http(s) URLs — a relative or `javascript:` link is never printable. */
export function isPrintableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Pure: validate the source discriminator against its payload (PQ1.2). */
export function validateSource(input: CreatePrintRequestInput): void {
  if (!(PRINT_SOURCES as readonly string[]).includes(input.sourceType)) {
    throw new PrintRequestError("Invalid sourceType");
  }
  switch (input.sourceType as PrintSource) {
    case "SET":
      if (!input.setId) throw new PrintRequestError("A SET request needs a setId");
      break;
    case "CONTENT_ARTIFACT":
      if (!input.contentArtifactId) {
        throw new PrintRequestError("A CONTENT_ARTIFACT request needs a contentArtifactId");
      }
      break;
    case "UPLOAD": {
      const n = input.fileIds?.length ?? 0;
      if (n === 0) throw new PrintRequestError("An UPLOAD request needs at least one file");
      if (n > MAX_PRINT_UPLOADS) {
        throw new PrintRequestError(`At most ${MAX_PRINT_UPLOADS} files per print request`);
      }
      break;
    }
    case "LINK":
      if (!input.linkUrl) throw new PrintRequestError("A LINK request needs a linkUrl");
      if (!isPrintableUrl(input.linkUrl)) throw new PrintRequestError("linkUrl must be an http(s) URL");
      break;
  }
}

/**
 * The referenced document must EXIST and be printable (PQ2.2–PQ2.4). Checked at
 * request time so the Office never opens a queue row onto a 404:
 *   SET              → the set exists and is ASSEMBLED (`/pdf/set/:id` refuses a draft,
 *                      and assembled ⇒ locked ⇒ immutable in content, so no snapshot)
 *   CONTENT_ARTIFACT → the artifact exists and is a chapter/session plan
 *   UPLOAD           → every fileId exists and is a `print_upload` the caller uploaded
 */
async function assertSourceResolves(input: CreatePrintRequestInput): Promise<void> {
  switch (input.sourceType as PrintSource) {
    case "SET": {
      const set = await AssessmentSet.findById(input.setId).select("status").lean();
      if (!set) throw new PrintRequestError("Question set not found");
      if (set.status !== "assembled") {
        throw new PrintRequestError("Only an ASSEMBLED set can be sent for printing");
      }
      break;
    }
    case "CONTENT_ARTIFACT": {
      const artifact = await ContentArtifact.findById(input.contentArtifactId).select("docType").lean();
      if (!artifact) throw new PrintRequestError("Plan not found");
      if (!(PLAN_DOC_TYPES as readonly string[]).includes(artifact.docType)) {
        throw new PrintRequestError("Only a chapter or session plan can be sent for printing");
      }
      break;
    }
    case "UPLOAD": {
      const ids = input.fileIds!;
      const files = await StoredFile.find({ _id: { $in: ids } }).select("kind uploadedBy").lean();
      if (files.length !== ids.length) throw new PrintRequestError("An uploaded file was not found");
      for (const f of files) {
        if (f.kind !== "print_upload") throw new PrintRequestError("File is not a print upload");
        if (f.uploadedBy?.toString() !== input.requestedBy) {
          throw new PrintRequestError("You may only attach files you uploaded");
        }
      }
      break;
    }
    case "LINK":
      break; // an external link cannot be verified — validated syntactically above
  }
}

export async function createPrintRequest(input: CreatePrintRequestInput): Promise<IPrintRequest> {
  if (!input.title?.trim()) throw new PrintRequestError("A print request needs a title");
  if (!(PRINT_PURPOSES as readonly string[]).includes(input.purpose)) {
    throw new PrintRequestError("Invalid purpose");
  }
  validateSource(input);
  if (!input.trusted) await assertSourceResolves(input);

  const copies = input.copies ?? 1;
  if (!Number.isInteger(copies) || copies < 1) throw new PrintRequestError("copies must be a positive integer");
  if (input.neededByKey && !DATE_KEY_RE.test(input.neededByKey)) {
    throw new PrintRequestError("neededByKey must be YYYY-MM-DD");
  }

  // D-#294: a per-class-present job needs the CLASS and the USE DATE — the count
  // resolves from that day's attendance when the Office prints.
  const copiesMode = (input.copiesMode ?? "FIXED") as "FIXED" | "CLASS_PRESENT";
  if (copiesMode !== "FIXED" && copiesMode !== "CLASS_PRESENT") {
    throw new PrintRequestError("Invalid copiesMode");
  }
  if (copiesMode === "CLASS_PRESENT") {
    if (!input.copiesClassId) throw new PrintRequestError("A per-class-present job needs the class");
    if (!input.neededByKey) {
      throw new PrintRequestError("A per-class-present job needs the date the print will be used");
    }
  }

  // Colour + sides are MANDATORY on a teacher's request — enforced at the RESOLVER, the
  // teacher-facing seam (live-testing requirement: the Office cannot start a job without
  // them). Here we only validate the VALUE, so internal callers and migration-backfilled
  // rows keep the schema defaults without a special-case flag.
  const colour = (input.colour ?? "BW") as PrintColour;
  const sides = (input.sides ?? "SINGLE") as PrintSides;
  if (!(PRINT_COLOURS as readonly string[]).includes(colour)) throw new PrintRequestError("Invalid colour");
  if (!(PRINT_SIDES as readonly string[]).includes(sides)) throw new PrintRequestError("Invalid sides");

  const source = input.sourceType as PrintSource;
  const doc = await PrintRequest.create({
    title: input.title.trim(),
    purpose: input.purpose as PrintPurpose,
    sourceType: source,
    ...(source === "SET" ? { setId: new Types.ObjectId(input.setId!) } : {}),
    ...(source === "CONTENT_ARTIFACT"
      ? { contentArtifactId: new Types.ObjectId(input.contentArtifactId!) }
      : {}),
    ...(source === "UPLOAD" ? { fileIds: input.fileIds!.map((id) => new Types.ObjectId(id)) } : {}),
    ...(source === "LINK" ? { linkUrl: input.linkUrl! } : {}),
    colour,
    sides,
    copies,
    copiesMode,
    ...(copiesMode === "CLASS_PRESENT" ? { copiesClassId: new Types.ObjectId(input.copiesClassId!) } : {}),
    ...(input.neededByKey ? { neededByKey: input.neededByKey } : {}),
    ...(input.classId ? { classId: new Types.ObjectId(input.classId) } : {}),
    ...(input.sectionId ? { sectionId: new Types.ObjectId(input.sectionId) } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.classTestId ? { classTestId: new Types.ObjectId(input.classTestId) } : {}),
    status: "REQUESTED" as PrintRequestStatus,
    requestedBy: new Types.ObjectId(input.requestedBy),
    requestedAt: new Date(),
  });

  await writeAudit({
    eventKind: "PRINT_REQUEST_CREATED",
    actorId: input.requestedBy,
    targetId: doc._id,
    targetKind: "PrintRequest",
    meta: { purpose: input.purpose, sourceType: source, copies },
  });
  publishRealtime("print_queue", { op: "created", id: doc._id.toString() });
  return doc;
}

/** Load a request or fail loudly. */
async function require_(id: string): Promise<IPrintRequest> {
  const doc = await PrintRequest.findById(id);
  if (!doc) throw new PrintRequestError("Print request not found");
  return doc;
}

/**
 * Mirror a transition onto the linked ClassTest (PQ-5). The class test keeps its own
 * lifecycle — its `PRINTED` status is what makes it the official exam (CT-1) — but the
 * Office now advances it from the unified queue, so the two must not drift.
 */
async function mirrorToClassTest(
  doc: IPrintRequest,
  status: "PRINTED" | "CANCELLED",
  actorId: string,
): Promise<void> {
  if (!doc.classTestId) return;
  const stamps =
    status === "PRINTED"
      ? { status, printedBy: new Types.ObjectId(actorId), printedAt: new Date() }
      : { status };
  await ClassTest.updateOne({ _id: doc.classTestId, status: "REQUESTED" }, { $set: stamps });
  await writeAudit({
    eventKind: status === "PRINTED" ? "CLASS_TEST_PRINTED" : "CLASS_TEST_CANCELLED",
    actorId,
    targetId: doc.classTestId,
    targetKind: "ClassTest",
    meta: { viaPrintRequestId: doc._id.toString() },
  });
}

// ---------------------------------------------------------------------------
// D-#294 — per-class-present copies, resolved from the USE day's attendance
// ---------------------------------------------------------------------------

export interface EffectiveCopies {
  /** The resolved count, or null while attendance for the use day is pending. */
  copies: number | null;
  /** True when the use day's attendance is not (yet) complete for the class. */
  pending: boolean;
}

/**
 * Resolve a CLASS_PRESENT job's copy count from the USE day's attendance
 * (`neededByKey`): the class's PRESENT students once every attendance unit
 * holding them is marked. A future use day, an incomplete day, or a class with
 * no marked units → pending (the Office may print with a manual count instead).
 */
export async function effectiveCopiesFor(
  doc: Pick<IPrintRequest, "copiesMode" | "copiesClassId" | "neededByKey" | "copies" | "status">,
  now: Date = new Date(),
): Promise<EffectiveCopies> {
  if (doc.copiesMode !== "CLASS_PRESENT") return { copies: doc.copies, pending: false };
  // Once printed, the finalized number on the row IS the answer.
  if (doc.status !== "REQUESTED") return { copies: doc.copies, pending: false };
  const useKey = doc.neededByKey;
  if (!useKey || !doc.copiesClassId) return { copies: null, pending: true };
  if (useKey > dateKeyOf(now)) return { copies: null, pending: true }; // attendance can't exist yet
  const presence = await classPresenceForDate(useKey);
  const row = presence.find((p) => p.classId === doc.copiesClassId!.toString());
  if (!row || !row.complete) return { copies: null, pending: true };
  return { copies: row.presentCount, pending: false };
}

/** REQUESTED → PRINTED (Office/Principal). For a CLASS_PRESENT job the count is
 *  FINALIZED onto `copies` here — the live attendance count of the use day, or
 *  `manualCopies` while that attendance is pending (D-#294). */
export async function markPrinted(
  id: string,
  actorId: string,
  manualCopies?: number | null,
): Promise<IPrintRequest> {
  const doc = await require_(id);
  if (doc.status !== "REQUESTED") {
    throw new PrintRequestError(`Only a REQUESTED job can be marked printed (it is ${doc.status})`);
  }

  let copiesSource: "fixed" | "attendance" | "manual" = "fixed";
  if (doc.copiesMode === "CLASS_PRESENT") {
    if (manualCopies != null) {
      if (!Number.isInteger(manualCopies) || manualCopies < 1) {
        throw new PrintRequestError("Manual copy count must be a positive integer");
      }
      doc.copies = manualCopies;
      copiesSource = "manual";
    } else {
      const resolved = await effectiveCopiesFor(doc);
      if (resolved.pending || resolved.copies === null) {
        throw new PrintRequestError(
          "Copy count not available — attendance for the use day is pending. Enter a manual count to print now.",
        );
      }
      doc.copies = resolved.copies;
      copiesSource = "attendance";
    }
  }

  doc.status = "PRINTED";
  doc.printedBy = new Types.ObjectId(actorId);
  doc.printedAt = new Date();
  await doc.save();
  await writeAudit({
    eventKind: "PRINT_REQUEST_PRINTED",
    actorId,
    targetId: doc._id,
    targetKind: "PrintRequest",
    meta: { requestedBy: doc.requestedBy.toString(), copies: doc.copies, copiesSource },
  });
  await mirrorToClassTest(doc, "PRINTED", actorId);
  publishRealtime("print_queue", { op: "printed", id: doc._id.toString() });
  return doc;
}

/**
 * PRINTED → DELIVERED (Office/Principal), then tell the requesting teacher. The Office
 * is the single actor — the teacher does NOT confirm receipt (owner ruling, D-#281).
 * The notify is best-effort and never blocks the transition (D-#72).
 */
export async function markDelivered(id: string, actorId: string): Promise<IPrintRequest> {
  const doc = await require_(id);
  if (doc.status !== "PRINTED") {
    throw new PrintRequestError(`Only a PRINTED job can be delivered (it is ${doc.status})`);
  }
  doc.status = "DELIVERED";
  doc.deliveredBy = new Types.ObjectId(actorId);
  doc.deliveredAt = new Date();
  await doc.save();
  await writeAudit({
    eventKind: "PRINT_REQUEST_DELIVERED",
    actorId,
    targetId: doc._id,
    targetKind: "PrintRequest",
    meta: { requestedBy: doc.requestedBy.toString() },
  });
  await emitPrintDelivered({
    printRequestId: doc._id.toString(),
    requestedBy: doc.requestedBy.toString(),
    title: doc.title,
  });
  publishRealtime("print_queue", { op: "delivered", id: doc._id.toString() });
  return doc;
}

/**
 * REQUESTED → CANCELLED. The requester may withdraw their own job; the Office may
 * cancel any REQUESTED job. A PRINTED (or DELIVERED) job cannot be cancelled — the
 * paper already exists.
 */
export async function cancelPrintRequest(
  id: string,
  actorId: string,
  opts: { isOffice: boolean; reason?: string | null },
): Promise<IPrintRequest> {
  const doc = await require_(id);
  if (doc.status !== "REQUESTED") {
    throw new PrintRequestError(`Only a REQUESTED job can be cancelled (it is ${doc.status})`);
  }
  if (!opts.isOffice && doc.requestedBy.toString() !== actorId) {
    throw new PrintRequestError("Only the requester or the Office may cancel this job");
  }
  doc.status = "CANCELLED";
  doc.cancelledBy = new Types.ObjectId(actorId);
  doc.cancelledAt = new Date();
  if (opts.reason) doc.cancelReason = opts.reason;
  await doc.save();
  await writeAudit({
    eventKind: "PRINT_REQUEST_CANCELLED",
    actorId,
    targetId: doc._id,
    targetKind: "PrintRequest",
    meta: { byOffice: opts.isOffice, reason: opts.reason ?? null },
  });
  await mirrorToClassTest(doc, "CANCELLED", actorId);
  publishRealtime("print_queue", { op: "cancelled", id: doc._id.toString() });
  return doc;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The Office queue for one bucket, oldest request first (index {status, requestedAt}). */
export async function printQueue(status: string, limit = 100): Promise<IPrintRequest[]> {
  if (!(["REQUESTED", "PRINTED", "DELIVERED", "CANCELLED"] as string[]).includes(status)) {
    throw new PrintRequestError("Invalid status");
  }
  return PrintRequest.find({ status })
    .sort({ requestedAt: 1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .lean() as unknown as Promise<IPrintRequest[]>;
}

/** A teacher's own requests, newest first. */
export async function myPrintRequests(userId: string, limit = 50): Promise<IPrintRequest[]> {
  return PrintRequest.find({ requestedBy: userId })
    .sort({ requestedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .lean() as unknown as Promise<IPrintRequest[]>;
}

export async function printRequestById(id: string): Promise<IPrintRequest | null> {
  return PrintRequest.findById(id).lean() as unknown as Promise<IPrintRequest | null>;
}

/** The sidebar badge counts (D-#294): jobs awaiting printing / awaiting delivery. */
export async function printQueueCounts(): Promise<{ requested: number; printed: number }> {
  const [requested, printed] = await Promise.all([
    PrintRequest.countDocuments({ status: "REQUESTED" }),
    PrintRequest.countDocuments({ status: "PRINTED" }),
  ]);
  return { requested, printed };
}
