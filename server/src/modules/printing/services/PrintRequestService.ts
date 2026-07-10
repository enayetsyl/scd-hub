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
import { MAX_PRINT_UPLOADS, PLAN_DOC_TYPES, PRINT_PURPOSES, PRINT_SOURCES } from "@scd/shared";
import type { PrintPurpose, PrintRequestStatus, PrintSource } from "@scd/shared";
import { PrintRequest, type IPrintRequest } from "../models/PrintRequest";
import { AssessmentSet } from "../../assessment/models/AssessmentSet";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { StoredFile } from "../../platform/models/StoredFile";
import { writeAudit } from "../../platform/services/AuditService";

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
  copies?: number | null;
  neededByKey?: string | null;
  classId?: string | null;
  sectionId?: string | null;
  subject?: string | null;
  notes?: string | null;
  requestedBy: string;
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
  await assertSourceResolves(input);

  const copies = input.copies ?? 1;
  if (!Number.isInteger(copies) || copies < 1) throw new PrintRequestError("copies must be a positive integer");
  if (input.neededByKey && !DATE_KEY_RE.test(input.neededByKey)) {
    throw new PrintRequestError("neededByKey must be YYYY-MM-DD");
  }

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
    copies,
    ...(input.neededByKey ? { neededByKey: input.neededByKey } : {}),
    ...(input.classId ? { classId: new Types.ObjectId(input.classId) } : {}),
    ...(input.sectionId ? { sectionId: new Types.ObjectId(input.sectionId) } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
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
  return doc;
}

/** Load a request or fail loudly. */
async function require_(id: string): Promise<IPrintRequest> {
  const doc = await PrintRequest.findById(id);
  if (!doc) throw new PrintRequestError("Print request not found");
  return doc;
}

/** REQUESTED → PRINTED (Office/Principal). */
export async function markPrinted(id: string, actorId: string): Promise<IPrintRequest> {
  const doc = await require_(id);
  if (doc.status !== "REQUESTED") {
    throw new PrintRequestError(`Only a REQUESTED job can be marked printed (it is ${doc.status})`);
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
    meta: { requestedBy: doc.requestedBy.toString() },
  });
  return doc;
}

/** PRINTED → DELIVERED (Office/Principal). The requester is notified in PQ-5. */
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
