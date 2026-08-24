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
import { MAX_PRINT_UPLOADS, PLAN_DOC_TYPES, PRINT_COLOURS, PRINT_PURPOSES, PRINT_SIDES, PRINT_SOURCES, ROUTINE_SUBJECTS } from "@scd/shared";
import type { PrintColour, PrintPurpose, PrintRequestStatus, PrintSides, PrintSource } from "@scd/shared";
import { PrintRequest, type IPrintRequest } from "../models/PrintRequest";
import { AssessmentSet } from "../../assessment/models/AssessmentSet";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { StoredFile } from "../../platform/models/StoredFile";
import { writeAudit } from "../../platform/services/AuditService";
import { emitPrintDelivered, emitPrintRequested } from "../../notifications/services/emitters";
import { User } from "../../foundation/models/User";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { ClassTest } from "../../trackers/models/ClassTest";
import { classPresenceForDate } from "../../attendance/services/AttendanceReportService";
import { dateKeyOf, isValidDateKey, parseDateKey } from "../../attendance/dates";
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

/**
 * ASSIGNMENT-purpose jobs are the input to the assignment↔print gap report
 * (`asNotPrintedRows`, D-#459): that report's whole signal is "does a print
 * request exist matching this class+section+subject+date," so an untagged or
 * cross-class-tagged ASSIGNMENT request would produce a permanent false gap.
 * Required here (not just class/subject like other purposes stay optional).
 */
async function assertAssignmentTagging(
  classId: string | null | undefined,
  sectionId: string | null | undefined,
  subject: string | null | undefined,
): Promise<void> {
  if (!classId || !sectionId || !subject) {
    throw new PrintRequestError("অ্যাসাইনমেন্ট প্রিন্টের জন্য শ্রেণি, শাখা ও বিষয় আবশ্যক");
  }
  if (!Types.ObjectId.isValid(classId) || !Types.ObjectId.isValid(sectionId)) {
    throw new PrintRequestError("Invalid classId or sectionId");
  }
  const section = await Section.findOne({ _id: sectionId, classId }).select("_id").lean();
  if (!section) throw new PrintRequestError("এই শাখাটি নির্বাচিত শ্রেণির অন্তর্ভুক্ত নয়");
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
  if (input.purpose === "ASSIGNMENT") {
    await assertAssignmentTagging(input.classId, input.sectionId, input.subject);
  }

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
  // D-#296: nudge the queue's operators (bell + native push + browser push).
  // Skipped for the trusted internal class-test path — CT-1 has its own flow.
  if (!input.trusted) {
    const requester = await User.findById(input.requestedBy).select("name").lean();
    await emitPrintRequested({
      printRequestId: doc._id.toString(),
      title: doc.title,
      requesterName: requester?.name ?? "",
    });
  }
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

export const PRINT_QUEUE_PAGE_DEFAULT = 25;
export const PRINT_QUEUE_PAGE_MAX = 100;

export interface PrintQueuePage {
  items: IPrintRequest[];
  total: number;
  hasMore: boolean;
}

/**
 * How one bucket is ordered (D-#461, owner ask).
 *
 * The two ACTIVE buckets are work queues: the Office prints, then hands over, in the
 * order the requests came in — so oldest-first is the work order, not a default nobody
 * chose. Flipping them would bury the request that has waited longest.
 *
 * The two TERMINAL buckets are history: "what happened, most recent first", each keyed
 * on the stamp that ENDED it (a job delivered today belongs on top even if it was
 * requested weeks ago). `requestedAt` is the tiebreaker so the order is total even on
 * rows that predate those stamps.
 */
function queueSortFor(status: string): Record<string, 1 | -1> {
  switch (status) {
    case "DELIVERED":
      return { deliveredAt: -1, requestedAt: -1 };
    case "CANCELLED":
      return { cancelledAt: -1, requestedAt: -1 };
    default:
      return { requestedAt: 1 }; // REQUESTED / PRINTED — FIFO work order
  }
}

/** One bucket of the Office queue, paginated. Ordering per `queueSortFor`. */
export async function printQueue(
  status: string,
  limit = PRINT_QUEUE_PAGE_DEFAULT,
  offset = 0,
): Promise<PrintQueuePage> {
  if (!(["REQUESTED", "PRINTED", "DELIVERED", "CANCELLED"] as string[]).includes(status)) {
    throw new PrintRequestError("Invalid status");
  }
  const take = Math.min(Math.max(limit, 1), PRINT_QUEUE_PAGE_MAX);
  const skip = Math.max(offset, 0);
  const [items, total] = await Promise.all([
    PrintRequest.find({ status })
      .sort(queueSortFor(status))
      .skip(skip)
      .limit(take)
      .lean() as unknown as Promise<IPrintRequest[]>,
    PrintRequest.countDocuments({ status }),
  ]);
  return { items, total, hasMore: skip + items.length < total };
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

// ---------------------------------------------------------------------------
// D-#362 — the reprint history: what has already been printed, one row per document
// ---------------------------------------------------------------------------

/** Statuses that count as "already printed" — the only jobs the history offers for a
 *  reprint (owner ruling: paper that actually came off the printer; a cancelled or
 *  still-queued job is not history). */
const PRINTED_STATUSES = ["PRINTED", "DELIVERED"] as const;

export interface PrintHistoryFilter {
  /** PQ-8: matches the EFFECTIVE class — `classId`, or `copiesClassId` on a job that has
   *  no class of its own. See `effectiveClassIdOf`. */
  classId?: string | null;
  /** PQ-8: only jobs that name no class either way. Mutually exclusive with `classId`;
   *  passing both AND-s to nothing, which is the honest reading of the request. */
  noClass?: boolean | null;
  subject?: string | null;
  purpose?: string | null;
  /** Own-row scope: a teacher only ever sees the jobs they filed. */
  requestedBy?: string | null;
  /** PQ-7: printed-on window, inclusive `YYYY-MM-DD` keys. Applied to the JOBS before
   *  grouping, so "printed in June" means a print actually landed in June — not that the
   *  document's newest print did. */
  fromKey?: string | null;
  toKey?: string | null;
  /** Max GROUPS returned (not jobs scanned). */
  limit?: number | null;
}

export interface PrintHistoryRow {
  /** The grouping key — source identity × class × subject × purpose (see `historyKey`). */
  key: string;
  /** The most recent job in the group: the row's display representative AND the
   *  record a reprint clones from. */
  latest: IPrintRequest;
  /** How many times this document has been printed (jobs in the group). */
  printCount: number;
  lastPrintedAt: Date;
  firstPrintedAt: Date;
  /** Distinct requester ids across the group — the Office sees who has printed it. */
  requesterIds: string[];
  /** PQ-9: every job in the group. Tagging the row means tagging all of them — the row
   *  stands for the DOCUMENT, so tagging only `latest` would split it into two rows. */
  jobIds: string[];
  /** PQ-8: the class the row is FOR — `effectiveClassIdOf(latest)`, so a CLASS_PRESENT
   *  job counts under the class it prints for rather than under "no class". */
  classId: string | null;
  /** Resolved for sorting/display; null when the job named no class either way. */
  classLevel: number | null;
}

/** How many recent printed jobs one history read scans before grouping. Generous for a
 *  single school (a term is low hundreds of jobs); a read that hits the cap is reported
 *  through `PrintHistoryPage.scannedCapped` rather than silently truncated. */
export const PRINT_HISTORY_SCAN_CAP = 1000;

/** Default / max GROUPS one read returns. The default matches the scan cap so the page
 *  limit is never the silent ceiling (PQ-7 fix: at 263 grouped rows the old default of
 *  200 dropped 63 rows with nothing on screen to say so). */
export const PRINT_HISTORY_DEFAULT_LIMIT = 1000;
export const PRINT_HISTORY_MAX_LIMIT = 1000;

export interface PrintHistoryPage {
  rows: PrintHistoryRow[];
  /** True when the scan hit PRINT_HISTORY_SCAN_CAP, so older prints may be missing. */
  scannedCapped: boolean;
  /** PQ-7: true when MORE grouped rows matched than `limit` returned — the caller must
   *  say so rather than present a short list as the whole history. */
  truncated: boolean;
  /** How many grouped rows matched before `limit` was applied. */
  totalRows: number;
}

/**
 * The identity of "the same document, printed again".
 *
 * The SOURCE alone is not enough: one worksheet legitimately gets printed for class 3
 * Bangla and for class 4 Bangla, and the history is browsed BY class/subject/purpose —
 * collapsing those into one row would lose the axis the teacher navigates by. So the
 * key is source identity × class × subject × purpose, which still folds the real case
 * (the same sheet, same class, printed five times over a term) into one row.
 */
/**
 * The class a printed job is FOR, as the history means it (PQ-8).
 *
 * `classId` is the job's own class, but only the class-test path has ever set it: of 269
 * printed jobs on the live data 25 carried it, so a class chip built on `classId` alone
 * showed Nursery 0 / Class 1 1 while the school had printed for all of them. A
 * CLASS_PRESENT job, though, names `copiesClassId` — "one copy per student present in
 * THIS class" — which is a class the teacher explicitly chose, not an inference. Falling
 * back to it recovers 172 of the 244 untagged jobs (Nursery among them).
 *
 * `classId` wins where both exist: a sheet for class 1 whose count follows class 3's
 * attendance is a class-1 print.
 */
export function effectiveClassIdOf(doc: IPrintRequest): Types.ObjectId | null {
  return doc.classId ?? doc.copiesClassId ?? null;
}

export function historyKey(doc: IPrintRequest): string {
  let src: string;
  switch (doc.sourceType as PrintSource) {
    case "SET":
      src = `set:${doc.setId?.toString() ?? ""}`;
      break;
    case "CONTENT_ARTIFACT":
      src = `artifact:${doc.contentArtifactId?.toString() ?? ""}`;
      break;
    case "UPLOAD":
      // Sorted, so the same attachment set in a different order is still one document.
      src = `upload:${(doc.fileIds ?? []).map((f) => f.toString()).sort().join(",")}`;
      break;
    case "LINK":
      src = `link:${doc.linkUrl ?? ""}`;
      break;
    default:
      src = `${doc.sourceType}:${doc._id.toString()}`; // unknown source → never grouped
  }
  return [src, effectiveClassIdOf(doc)?.toString() ?? "-", doc.subject ?? "-", doc.purpose].join("|");
}

/** When a job was printed, for grouping — `printedAt` is stamped at markPrinted, but a
 *  migration-backfilled row may lack it, so fall back to the request time. */
function printedAtOf(doc: IPrintRequest): Date {
  return new Date(doc.printedAt ?? doc.requestedAt);
}

/**
 * Already-printed jobs, collapsed to ONE ROW PER DOCUMENT and ordered the way the
 * Office and teachers hunt for a reprint: class, then subject, then purpose
 * (classwork / homework / assignment / class test / …), newest print first inside a
 * group. Filters narrow the same three axes.
 *
 * The point is that a second print never needs the file sent again — the caller picks
 * the row and calls `reprintPrintRequest` on `latest`.
 */
export async function printHistory(filter: PrintHistoryFilter = {}): Promise<PrintHistoryPage> {
  const q: Record<string, unknown> = { status: { $in: PRINTED_STATUSES } };
  // Two clauses below each need their own `$or`, so they are AND-ed explicitly rather
  // than assigned to `q.$or` — the second assignment would silently drop the first.
  const and: Record<string, unknown>[] = [];

  if (filter.classId) {
    if (!Types.ObjectId.isValid(filter.classId)) throw new PrintRequestError("Invalid classId");
    const oid = new Types.ObjectId(filter.classId);
    // PQ-8: match the EFFECTIVE class — the job's own class, or the class its copy count
    // follows when it has no class of its own. Mirrors `effectiveClassIdOf`, including
    // the precedence: a job with a different `classId` must NOT match on copiesClassId.
    and.push({ $or: [{ classId: oid }, { classId: null, copiesClassId: oid }] });
  }
  if (filter.noClass) {
    // "Neither field names a class" — the honest remainder (72 live jobs), not everything
    // the old `classId`-only view lumped together.
    and.push({ classId: null, copiesClassId: null });
  }
  if (filter.subject) q.subject = filter.subject;
  if (filter.purpose) {
    if (!(PRINT_PURPOSES as readonly string[]).includes(filter.purpose)) {
      throw new PrintRequestError("Invalid purpose");
    }
    q.purpose = filter.purpose;
  }
  if (filter.requestedBy) {
    // A caller-supplied requester id (PQ-7) must not reach the ObjectId ctor unchecked —
    // a BSON throw would surface as a fault, not the input error it is.
    if (!Types.ObjectId.isValid(filter.requestedBy)) throw new PrintRequestError("Invalid requestedBy");
    q.requestedBy = new Types.ObjectId(filter.requestedBy);
  }

  // PQ-7 — the printed-on window. `printedAtOf` falls back to `requestedAt` for a
  // migration-backfilled row, so the query has to match on the same pair or those rows
  // would silently drop out of every dated view.
  if (filter.fromKey || filter.toKey) {
    const range: Record<string, Date> = {};
    if (filter.fromKey) {
      if (!isValidDateKey(filter.fromKey)) throw new PrintRequestError("fromKey must be YYYY-MM-DD");
      range.$gte = parseDateKey(filter.fromKey);
    }
    if (filter.toKey) {
      if (!isValidDateKey(filter.toKey)) throw new PrintRequestError("toKey must be YYYY-MM-DD");
      const end = parseDateKey(filter.toKey);
      end.setDate(end.getDate() + 1); // inclusive of the whole `toKey` day
      range.$lt = end;
    }
    if (range.$gte && range.$lt && range.$gte >= range.$lt) {
      throw new PrintRequestError("fromKey must not be after toKey");
    }
    and.push({ $or: [{ printedAt: range }, { printedAt: null, requestedAt: range }] });
  }

  if (and.length) q.$and = and;

  const docs = (await PrintRequest.find(q)
    .sort({ printedAt: -1, requestedAt: -1 })
    .limit(PRINT_HISTORY_SCAN_CAP)
    .lean()) as unknown as IPrintRequest[];

  const groups = new Map<string, PrintHistoryRow>();
  for (const doc of docs) {
    const key = historyKey(doc);
    const at = printedAtOf(doc);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        latest: doc,
        printCount: 1,
        lastPrintedAt: at,
        firstPrintedAt: at,
        requesterIds: [doc.requestedBy.toString()],
        jobIds: [doc._id.toString()],
        classId: effectiveClassIdOf(doc)?.toString() ?? null,
        classLevel: null,
      });
      continue;
    }
    existing.printCount += 1;
    existing.jobIds.push(doc._id.toString());
    if (at > existing.lastPrintedAt) {
      existing.latest = doc;
      existing.lastPrintedAt = at;
    }
    if (at < existing.firstPrintedAt) existing.firstPrintedAt = at;
    const requester = doc.requestedBy.toString();
    if (!existing.requesterIds.includes(requester)) existing.requesterIds.push(requester);
  }

  const rows = [...groups.values()];

  // Class LEVEL, not id, is the meaningful sort key ("Nursery … class 5"); one batched
  // lookup for the whole page, over the EFFECTIVE class (PQ-8) the row is grouped by.
  const classIds = [...new Set(rows.map((r) => r.classId).filter(Boolean))] as string[];
  if (classIds.length) {
    const classes = await Class.find({ _id: { $in: classIds } }).select("level").lean();
    const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level]));
    for (const r of rows) r.classLevel = r.classId ? (levelOf.get(r.classId) ?? null) : null;
  }

  // D-#461 (owner ask): MOST RECENTLY PRINTED first. The history answers "was this
  // printed lately, and can I reprint it" — a question about recency — so the date leads
  // and class/subject/purpose are only tiebreakers within the same instant. (It used to
  // lead on class level, which buried this week's prints under every Nursery row.)
  const purposeOrder = new Map((PRINT_PURPOSES as readonly string[]).map((p, i) => [p, i]));
  rows.sort(
    (a, b) =>
      b.lastPrintedAt.getTime() - a.lastPrintedAt.getTime() ||
      // A job with no class sorts last, not as level 0 (which would put it before class 1).
      (a.classLevel ?? Number.MAX_SAFE_INTEGER) - (b.classLevel ?? Number.MAX_SAFE_INTEGER) ||
      (a.latest.subject ?? "").localeCompare(b.latest.subject ?? "") ||
      (purposeOrder.get(a.latest.purpose) ?? 99) - (purposeOrder.get(b.latest.purpose) ?? 99),
  );

  const limit = Math.min(Math.max(filter.limit ?? PRINT_HISTORY_DEFAULT_LIMIT, 1), PRINT_HISTORY_MAX_LIMIT);
  return {
    rows: rows.slice(0, limit),
    scannedCapped: docs.length === PRINT_HISTORY_SCAN_CAP,
    truncated: rows.length > limit,
    totalRows: rows.length,
  };
}

// ---------------------------------------------------------------------------
// PQ-9 (D-#392) — tagging a historical job with the class/subject it was for
// ---------------------------------------------------------------------------

/**
 * What the file/job NAMES suggest a print was for.
 *
 * PQ-8 recovered every job that named a class through `copiesClassId`; 72 printed jobs
 * still name one nowhere. 41 of those DO carry a readable code in the attached file's
 * name or the title (`C1_Eng_Block02.pdf`, `Class 3 HW L2.pdf`, `English Drive C1_B3_PT`).
 * This reads that code so the tag control can arrive PRE-FILLED — a suggestion a person
 * confirms, never a silent write: on the live data the code names a class the requester
 * does not teach for 12 of the 22 rows where that could be cross-checked (coordination
 * work, or grants that have since changed), so it is evidence, not proof.
 */
export interface PrintTagSuggestion {
  /** Roster class LEVEL (-1 Nursery … 5), not an id — the caller maps it to a class. */
  classLevel: number | null;
  /** A `ROUTINE_SUBJECTS` code. */
  subject: string | null;
  /** The exact text the guess came from, so the confirming human can judge it. */
  evidence: string | null;
}

/**
 * Underscores are WORD characters, so `\bEng\b` never matches inside `C1_Eng_Block02` —
 * the exact shape the live file names use. Both readers match on a separator-normalized
 * copy; the ORIGINAL text is what gets shown back as evidence.
 */
function normalizeForMatch(text: string): string {
  return text.replace(/[_]+/g, " ");
}

/** `C1` / `C 1` / `Class 3` / `C1B03` / `-C1-` → level; Nursery/KG spelled either way. */
function classLevelFromText(raw: string): number | null {
  const text = normalizeForMatch(raw);
  // `Class 3` / `C-1` / `C_2` — a digit must follow the separator, so "Class Test" misses.
  const spelt = /\bC(?:lass)?[ _-]?([1-5])\b/i.exec(text);
  if (spelt) return Number(spelt[1]);
  // `C1B03`, `C4B02` — a code glued to the next token.
  const glued = /\bC([1-5])[A-Za-z_]/.exec(text);
  if (glued) return Number(glued[1]);
  const dashed = /-C([1-5])-/i.exec(text);
  if (dashed) return Number(dashed[1]);
  if (/\bnursery\b|নার্সারি/i.test(text)) return -1;
  if (/\bK\.?\s?G\b|\bC0\b|কেজি/i.test(text)) return 0;
  return null;
}

/** Subject code from a name. Bangladesh (BGS) is tested BEFORE Bangla, or every
 *  "Bangladesh & Global Studies" sheet would read as BAN. */
function subjectFromText(raw: string): string | null {
  const text = normalizeForMatch(raw);
  if (/bangladesh|\bBGS\b|বিশ্বপরিচয়/i.test(text)) return "BGS";
  if (/\bban(gla)?\b|বাংলা/i.test(text)) return "BAN";
  if (/\beng(lish)?\b|ইংরেজি/i.test(text)) return "ENG";
  if (/\bmath(s|ematics)?\b|গণিত/i.test(text)) return "MATH";
  if (/\bsci(ence)?\b|বিজ্ঞান/i.test(text)) return "SCI";
  if (/\bislam(iat)?\b|ইসলাম/i.test(text)) return "ISLAM";
  if (/\barabic\b|আরবি/i.test(text)) return "ARABIC";
  if (/\bqur(’|')?an\b|কুরআন/i.test(text)) return "QURAN";
  return null;
}

/**
 * Read a class/subject out of a job's own text. `fileNames` is checked FIRST — on the
 * live data the attached file names carry the code 38 times against the title's 3, and a
 * title is usually the generic "Print request — <teacher>".
 */
export function suggestTagFor(doc: {
  title?: string | null;
  fileNames?: string[];
}): PrintTagSuggestion {
  const candidates = [...(doc.fileNames ?? []), doc.title ?? ""].filter((t) => t.trim().length > 0);
  let classLevel: number | null = null;
  let subject: string | null = null;
  let evidence: string | null = null;
  for (const text of candidates) {
    const lvl = classLevelFromText(text);
    const sub = subjectFromText(text);
    if (classLevel === null && lvl !== null) {
      classLevel = lvl;
      evidence = text;
    }
    if (subject === null && sub !== null) {
      subject = sub;
      if (evidence === null) evidence = text;
    }
    if (classLevel !== null && subject !== null) break;
  }
  return { classLevel, subject, evidence };
}

export interface TagPrintRequestsInput {
  /** EVERY job behind the history row. The unit being tagged is the DOCUMENT the row
   *  stands for, not one of its prints — tagging only `latest` would split the group in
   *  two and leave the older prints unfindable. */
  ids: string[];
  /** Undefined leaves the class alone; null CLEARS it; an id sets it. */
  classId?: string | null;
  /** D-#459: undefined leaves the section alone; null CLEARS it; an id sets it. Required
   *  for the assignment↔print gap report to match a section-scoped ASSIGNMENT job. */
  sectionId?: string | null;
  subject?: string | null;
  actorId: string;
  isOffice: boolean;
}

/** A guard against a runaway id list; the largest live group is a handful of prints. */
const MAX_TAG_IDS = 200;

/**
 * Set (or clear) the class/subject a historical print job was FOR.
 *
 * The 31 jobs PQ-8 could not recover are unrecoverable from data — 18 are Google Docs
 * links with opaque ids, 13 are uploads with unrevealing names, and no requester teaches
 * only one class, so "infer it from who filed it" is ambiguous for every row. Only a
 * person knows, so this is how they say it.
 *
 * Scope mirrors `reprintPrintRequest`: the Office may tag any job, a teacher only their
 * own. A job carrying `classTestId` is REFUSED outright — its class belongs to the exam
 * record it mirrors (CT-1), and the history must not become a side door onto that.
 * All-or-nothing: a group is one document, so a partial write would leave it in two
 * states and silently split the row.
 */
export async function tagPrintRequests(input: TagPrintRequestsInput): Promise<IPrintRequest[]> {
  const setsClass = input.classId !== undefined;
  const setsSection = input.sectionId !== undefined;
  const setsSubject = input.subject !== undefined;
  if (!setsClass && !setsSection && !setsSubject) throw new PrintRequestError("Nothing to tag");

  if (input.ids.length === 0) throw new PrintRequestError("No print request given");
  if (input.ids.length > MAX_TAG_IDS) throw new PrintRequestError("Too many print requests at once");
  for (const id of input.ids) {
    if (!Types.ObjectId.isValid(id)) throw new PrintRequestError("Invalid print request id");
  }

  // Validate the target class against the ROSTER, not just its shape: a tag pointing at
  // a class that does not exist would read as "no class" forever after.
  let classId: Types.ObjectId | null = null;
  if (setsClass && input.classId !== null) {
    if (!Types.ObjectId.isValid(input.classId!)) throw new PrintRequestError("Invalid classId");
    classId = new Types.ObjectId(input.classId!);
    if (!(await Class.exists({ _id: classId }))) throw new PrintRequestError("Class not found");
  }
  // D-#459: a section only means something alongside a class — require classId to be set
  // in the SAME call (mirrors the NewPrintRequestScreen/assertAssignmentTagging flow,
  // where a section is always picked right after its class) rather than trusting a
  // section against whatever class the row happened to carry before this tag.
  let sectionId: Types.ObjectId | null = null;
  if (setsSection && input.sectionId !== null) {
    if (!setsClass || !classId) {
      throw new PrintRequestError("Tagging a section also requires tagging its class");
    }
    if (!Types.ObjectId.isValid(input.sectionId!)) throw new PrintRequestError("Invalid sectionId");
    sectionId = new Types.ObjectId(input.sectionId!);
    if (!(await Section.exists({ _id: sectionId, classId }))) {
      throw new PrintRequestError("এই শাখাটি নির্বাচিত শ্রেণির অন্তর্ভুক্ত নয়");
    }
  }
  if (setsSubject && input.subject !== null) {
    if (!(ROUTINE_SUBJECTS as readonly string[]).includes(input.subject!)) {
      throw new PrintRequestError("Invalid subject");
    }
  }

  const docs = await PrintRequest.find({ _id: { $in: input.ids.map((i) => new Types.ObjectId(i)) } });
  if (docs.length !== input.ids.length) throw new PrintRequestError("Print request not found");

  for (const doc of docs) {
    if (!input.isOffice && doc.requestedBy.toString() !== input.actorId) {
      throw new PrintRequestError("You may only tag your own print request");
    }
    if (doc.classTestId) {
      throw new PrintRequestError("A class-test job takes its class from the exam record");
    }
  }

  const updated: IPrintRequest[] = [];
  for (const doc of docs) {
    const before = {
      classId: doc.classId?.toString() ?? null,
      sectionId: doc.sectionId?.toString() ?? null,
      subject: doc.subject ?? null,
    };
    if (setsClass) {
      if (classId) doc.classId = classId;
      else doc.classId = undefined;
    }
    if (setsSection) {
      if (sectionId) doc.sectionId = sectionId;
      else doc.sectionId = undefined;
    }
    if (setsSubject) {
      if (input.subject) doc.subject = input.subject;
      else doc.subject = undefined;
    }
    await doc.save();
    await writeAudit({
      eventKind: "PRINT_REQUEST_CLASS_TAGGED",
      actorId: input.actorId,
      targetId: doc._id,
      targetKind: "PrintRequest",
      // Both sides recorded: the tag is a human judgement, so a later reader needs to see
      // what it replaced as well as who made it.
      meta: {
        before,
        after: {
          classId: doc.classId?.toString() ?? null,
          sectionId: doc.sectionId?.toString() ?? null,
          subject: doc.subject ?? null,
        },
        byOffice: input.isOffice,
      },
    });
    updated.push(doc);
  }
  return updated;
}

/**
 * Re-send an already-printed job to the queue WITHOUT re-uploading or re-attaching it
 * (D-#362) — the whole point of the history. Clones the original's source, print
 * settings and class/subject/purpose into a NEW `REQUESTED` job for a new use date.
 *
 * Deliberately NOT a pass-through to `createPrintRequest`:
 *   - the UPLOAD "you may only attach files you uploaded" check must not apply — the
 *     files were already accepted onto a printed job, and the Office reprints jobs
 *     that other people filed;
 *   - `classTestId` is NEVER copied. A class test's PRINTED status is what makes it the
 *     official exam (CT-1); a second print of the same paper must not mirror another
 *     transition onto that ClassTest.
 * The source is still re-checked for existence, so a reprint can't open onto a 404.
 */
export interface ReprintInput {
  sourceRequestId: string;
  /** The date the reprint will be USED — a reprint is always for a new day. */
  neededByKey: string;
  /** Override the original count; omitted keeps it. Only meaningful under FIXED —
   *  a CLASS_PRESENT job's count comes from the use day's attendance (D-#294). */
  copies?: number | null;
  /** How THIS reprint counts (D-#294); omitted keeps the original's mode. A
   *  CLASS_PRESENT job reprinted as FIXED is the "just print N this time" case —
   *  it drops `copiesClassId` so the typed number is what the Office prints. */
  copiesMode?: string | null;
  notes?: string | null;
  actorId: string;
  isOffice: boolean;
}

export async function reprintPrintRequest(input: ReprintInput): Promise<IPrintRequest> {
  const original = await PrintRequest.findById(input.sourceRequestId).lean();
  if (!original) throw new PrintRequestError("Print request not found");
  if (!(PRINTED_STATUSES as readonly string[]).includes(original.status)) {
    throw new PrintRequestError(
      `Only an already-printed job can be reprinted (this one is ${original.status})`,
    );
  }
  if (!input.isOffice && original.requestedBy.toString() !== input.actorId) {
    throw new PrintRequestError("You may only reprint your own print request");
  }
  if (!DATE_KEY_RE.test(input.neededByKey)) {
    throw new PrintRequestError("neededByKey must be YYYY-MM-DD");
  }
  const copies = input.copies ?? original.copies;
  if (!Number.isInteger(copies) || copies < 1) throw new PrintRequestError("copies must be a positive integer");
  // D-#294: the count mode carries over unless the reprint overrides it. A CLASS_PRESENT
  // clone IGNORES `copies` (it resolves from the use day's attendance and finalizes at
  // markPrinted), so a typed number is only honoured under FIXED — hence the override.
  const copiesMode = (input.copiesMode ?? original.copiesMode ?? "FIXED") as "FIXED" | "CLASS_PRESENT";
  if (copiesMode !== "FIXED" && copiesMode !== "CLASS_PRESENT") {
    throw new PrintRequestError("Invalid copiesMode");
  }
  if (copiesMode === "CLASS_PRESENT" && !original.copiesClassId) {
    throw new PrintRequestError("A per-class-present reprint needs the original's class");
  }
  if (original.purpose === "ASSIGNMENT") {
    await assertAssignmentTagging(
      original.classId?.toString(),
      original.sectionId?.toString(),
      original.subject,
    );
  }

  // The source must still resolve — but by EXISTENCE only (no uploader check, see above).
  await assertReprintSourceExists(original);

  const source = original.sourceType as PrintSource;
  const doc = await PrintRequest.create({
    title: original.title,
    purpose: original.purpose,
    sourceType: source,
    ...(source === "SET" ? { setId: original.setId } : {}),
    ...(source === "CONTENT_ARTIFACT" ? { contentArtifactId: original.contentArtifactId } : {}),
    ...(source === "UPLOAD" ? { fileIds: original.fileIds } : {}),
    ...(source === "LINK" ? { linkUrl: original.linkUrl } : {}),
    colour: original.colour,
    sides: original.sides,
    copies,
    copiesMode,
    // Only a CLASS_PRESENT clone keeps the counting class — carrying it onto a FIXED
    // reprint would leave the row looking like it still counts from attendance.
    ...(copiesMode === "CLASS_PRESENT" && original.copiesClassId
      ? { copiesClassId: original.copiesClassId }
      : {}),
    neededByKey: input.neededByKey,
    ...(original.classId ? { classId: original.classId } : {}),
    ...(original.sectionId ? { sectionId: original.sectionId } : {}),
    ...(original.subject ? { subject: original.subject } : {}),
    ...(input.notes ? { notes: input.notes } : original.notes ? { notes: original.notes } : {}),
    status: "REQUESTED" as PrintRequestStatus,
    requestedBy: new Types.ObjectId(input.actorId),
    requestedAt: new Date(),
  });

  await writeAudit({
    eventKind: "PRINT_REQUEST_REPRINTED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "PrintRequest",
    meta: {
      fromPrintRequestId: original._id.toString(),
      originalRequestedBy: original.requestedBy.toString(),
      purpose: original.purpose,
      sourceType: source,
      copies,
      copiesMode,
    },
  });
  publishRealtime("print_queue", { op: "created", id: doc._id.toString() });
  const requester = await User.findById(input.actorId).select("name").lean();
  await emitPrintRequested({
    printRequestId: doc._id.toString(),
    title: doc.title,
    requesterName: requester?.name ?? "",
  });
  return doc;
}

/** Existence-only source check for a reprint (the ownership/status rules that apply to a
 *  FRESH request were already satisfied when the original was printed). */
async function assertReprintSourceExists(
  original: Pick<IPrintRequest, "sourceType" | "setId" | "contentArtifactId" | "fileIds">,
): Promise<void> {
  switch (original.sourceType as PrintSource) {
    case "SET": {
      const set = await AssessmentSet.findById(original.setId).select("_id").lean();
      if (!set) throw new PrintRequestError("The question set no longer exists — file a new request");
      break;
    }
    case "CONTENT_ARTIFACT": {
      const artifact = await ContentArtifact.findById(original.contentArtifactId).select("_id").lean();
      if (!artifact) throw new PrintRequestError("The plan no longer exists — file a new request");
      break;
    }
    case "UPLOAD": {
      const ids = original.fileIds ?? [];
      const files = await StoredFile.find({ _id: { $in: ids } }).select("_id").lean();
      if (files.length !== ids.length) {
        throw new PrintRequestError("An attached file no longer exists — file a new request");
      }
      break;
    }
    case "LINK":
      break; // external by nature; nothing to verify
  }
}

/** The sidebar badge counts (D-#294): jobs awaiting printing / awaiting delivery. */
export async function printQueueCounts(): Promise<{ requested: number; printed: number }> {
  const [requested, printed] = await Promise.all([
    PrintRequest.countDocuments({ status: "REQUESTED" }),
    PrintRequest.countDocuments({ status: "PRINTED" }),
  ]);
  return { requested, printed };
}
