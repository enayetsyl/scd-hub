/**
 * Print queue operations (PQ-3/PQ-4, D-#281) — one queue for everything the Office
 * prints. Teachers file requests (`tracker:write`) and may withdraw their own while
 * REQUESTED; the Office works the queue (`roster:manage`).
 */
import { gql } from "urql";

export interface PrintFileT {
  id: string;
  name: string;
  mime: string;
}

export interface PrintRequestT {
  id: string;
  title: string;
  purpose: string;
  sourceType: string;
  setId: string | null;
  contentArtifactId: string | null;
  fileIds: string[];
  files: PrintFileT[];
  linkUrl: string | null;
  colour: string;
  sides: string;
  copies: number;
  /** D-#294: FIXED (typed number) | CLASS_PRESENT (per student present on the use day). */
  copiesMode: string;
  copiesClassId: string | null;
  copiesClassLevel: number | null;
  /** Resolved count for CLASS_PRESENT jobs; null while the use day's attendance is pending. */
  effectiveCopies: number | null;
  copiesPending: boolean;
  neededByKey: string | null;
  /** D-#362: the job's own class/section — the reprint history groups and labels by it. */
  classId: string | null;
  classLevel: number | null;
  sectionId: string | null;
  sectionNameBn: string | null;
  subject: string | null;
  /** PQ-5: set when this job prints a CLASS TEST's paper — cancelling it retires the
   *  exam too, so the queue confirms with that spelled out (D-#627). */
  classTestId: string | null;
  notes: string | null;
  status: string;
  requestedBy: string;
  requesterName: string | null;
  requestedAt: string;
  printedAt: string | null;
  deliveredAt: string | null;
  cancelReason: string | null;
}

const PRINT_REQUEST_FIELDS = `
  id title purpose sourceType setId contentArtifactId fileIds linkUrl
  files { id name mime }
  colour sides copies copiesMode copiesClassId copiesClassLevel effectiveCopies copiesPending
  neededByKey classId classLevel sectionId sectionNameBn subject classTestId notes status
  requestedBy requesterName requestedAt printedAt deliveredAt cancelReason
`;

/** One PAGE of a queue bucket (D-#461). The active buckets stay oldest-first (the order
 *  the Office works them); DELIVERED/CANCELLED are newest-first. Requires roster:manage. */
export const PRINT_QUEUE_QUERY = gql<
  { printQueue: { items: PrintRequestT[]; total: number; hasMore: boolean } },
  { status: string; limit?: number | null; offset?: number | null }
>`
  query PrintQueue($status: String!, $limit: Int, $offset: Int) {
    printQueue(status: $status, limit: $limit, offset: $offset) {
      items { ${PRINT_REQUEST_FIELDS} }
      total
      hasMore
    }
  }
`;

/** The caller's own requests, newest first. */
export const MY_PRINT_REQUESTS_QUERY = gql<{ myPrintRequests: PrintRequestT[] }, { limit?: number | null }>`
  query MyPrintRequests($limit: Int) {
    myPrintRequests(limit: $limit) { ${PRINT_REQUEST_FIELDS} }
  }
`;

export interface CreatePrintRequestVars {
  title: string;
  purpose: string;
  sourceType: string;
  setId?: string | null;
  contentArtifactId?: string | null;
  fileIds?: string[] | null;
  linkUrl?: string | null;
  /** Mandatory — the Office cannot start a job without these. */
  colour: string;
  sides: string;
  copies: number;
  /** D-#294: FIXED (default) | CLASS_PRESENT (+ copiesClassId). */
  copiesMode?: string | null;
  copiesClassId?: string | null;
  neededByKey: string;
  classId?: string | null;
  sectionId?: string | null;
  subject?: string | null;
  notes?: string | null;
}

export const CREATE_PRINT_REQUEST = gql<{ createPrintRequest: PrintRequestT }, CreatePrintRequestVars>`
  mutation CreatePrintRequest(
    $title: String!, $purpose: String!, $sourceType: String!,
    $setId: String, $contentArtifactId: String, $fileIds: [String!], $linkUrl: String,
    $colour: String!, $sides: String!, $copies: Int!, $copiesMode: String, $copiesClassId: String,
    $neededByKey: String!,
    $classId: String, $sectionId: String, $subject: String, $notes: String
  ) {
    createPrintRequest(
      title: $title, purpose: $purpose, sourceType: $sourceType,
      setId: $setId, contentArtifactId: $contentArtifactId, fileIds: $fileIds, linkUrl: $linkUrl,
      colour: $colour, sides: $sides, copies: $copies, copiesMode: $copiesMode, copiesClassId: $copiesClassId,
      neededByKey: $neededByKey,
      classId: $classId, sectionId: $sectionId, subject: $subject, notes: $notes
    ) { ${PRINT_REQUEST_FIELDS} }
  }
`;

export const MARK_PRINT_REQUEST_PRINTED = gql<
  { markPrintRequestPrinted: PrintRequestT },
  { id: string; copies?: number | null }
>`
  mutation MarkPrintRequestPrinted($id: String!, $copies: Int) {
    markPrintRequestPrinted(id: $id, copies: $copies) { ${PRINT_REQUEST_FIELDS} }
  }
`;

/** D-#294: the sidebar badge counts — pending printing / pending delivery. */
export const PRINT_QUEUE_COUNTS = gql<{ printQueueCounts: { requested: number; printed: number } }, Record<string, never>>`
  query PrintQueueCounts {
    printQueueCounts { requested printed }
  }
`;

export const MARK_PRINT_REQUEST_DELIVERED = gql<{ markPrintRequestDelivered: PrintRequestT }, { id: string }>`
  mutation MarkPrintRequestDelivered($id: String!) {
    markPrintRequestDelivered(id: $id) { ${PRINT_REQUEST_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// D-#362 — reprint history: find what was already printed, send it again
// ---------------------------------------------------------------------------

export interface PrintHistoryRowT {
  key: string;
  /** The most recent print of this document — what a reprint clones. */
  latest: PrintRequestT;
  printCount: number;
  lastPrintedAt: string;
  firstPrintedAt: string;
  requesterNames: string[];
  /** PQ-7: index-aligned with `requesterNames` — the teacher filter keys off these. */
  requesterIds: string[];
  /** PQ-8: the class the ROW is for — the job's own class, else the class its copy count
   *  follows. Browse by this, not `latest.classId`: only the class-test path sets that. */
  classId: string | null;
  classLevel: number | null;
  /** PQ-9: every job behind the row — what the tag mutation is called with. */
  jobIds: string[];
  /** PQ-9: read out of the job's own file name / title, present only on an untagged row.
   *  A pre-fill for the tag control; `suggestionEvidence` is the text it came from. */
  suggestedClassId: string | null;
  suggestedClassLevel: number | null;
  suggestedSubject: string | null;
  suggestionEvidence: string | null;
}

/** Already-printed jobs, ONE ROW PER DOCUMENT, ordered class → subject → purpose →
 *  newest print. The Office sees everyone's; a teacher sees only their own (server-side
 *  scope — there is no argument to widen it).
 *
 *  PQ-7: `fromKey`/`toKey` narrow the PRINTED-ON window server-side (applied to the jobs
 *  before grouping); `truncated` reports a page cut short instead of hiding it. */
export const PRINT_HISTORY_QUERY = gql<
  { printHistory: { rows: PrintHistoryRowT[]; scannedCapped: boolean; truncated: boolean; totalRows: number } },
  {
    classId?: string | null;
    subject?: string | null;
    purpose?: string | null;
    requestedBy?: string | null;
    fromKey?: string | null;
    toKey?: string | null;
    limit?: number | null;
  }
>`
  query PrintHistory(
    $classId: String, $subject: String, $purpose: String,
    $requestedBy: String, $fromKey: String, $toKey: String, $limit: Int
  ) {
    printHistory(
      classId: $classId, subject: $subject, purpose: $purpose,
      requestedBy: $requestedBy, fromKey: $fromKey, toKey: $toKey, limit: $limit
    ) {
      scannedCapped
      truncated
      totalRows
      rows {
        key printCount lastPrintedAt firstPrintedAt requesterNames requesterIds classId classLevel
        jobIds suggestedClassId suggestedClassLevel suggestedSubject suggestionEvidence
        latest { ${PRINT_REQUEST_FIELDS} }
      }
    }
  }
`;

/** PQ-9: name the class/subject a historical job was for. Pass the row's whole `jobIds`
 *  list — the row is a document, not a single print. Omitting an argument leaves that
 *  field alone; passing null clears it. */
export const TAG_PRINT_REQUESTS = gql<
  { tagPrintRequests: PrintRequestT[] },
  { ids: string[]; classId?: string | null; sectionId?: string | null; subject?: string | null }
>`
  mutation TagPrintRequests($ids: [String!]!, $classId: String, $sectionId: String, $subject: String) {
    tagPrintRequests(ids: $ids, classId: $classId, sectionId: $sectionId, subject: $subject) {
      id
    }
  }
`;

/** Re-queue an already-printed job — same source, no re-upload — for a new use date. */
export const REPRINT_PRINT_REQUEST = gql<
  { reprintPrintRequest: PrintRequestT },
  {
    id: string;
    neededByKey: string;
    copies?: number | null;
    /** D-#294: omitted keeps the original's mode; FIXED makes `copies` the count. */
    copiesMode?: string | null;
    notes?: string | null;
  }
>`
  mutation ReprintPrintRequest(
    $id: String!, $neededByKey: String!, $copies: Int, $copiesMode: String, $notes: String
  ) {
    reprintPrintRequest(
      id: $id, neededByKey: $neededByKey, copies: $copies, copiesMode: $copiesMode, notes: $notes
    ) {
      ${PRINT_REQUEST_FIELDS}
    }
  }
`;

export const CANCEL_PRINT_REQUEST = gql<
  { cancelPrintRequest: PrintRequestT },
  { id: string; reason?: string | null }
>`
  mutation CancelPrintRequest($id: String!, $reason: String) {
    cancelPrintRequest(id: $id, reason: $reason) { ${PRINT_REQUEST_FIELDS} }
  }
`;
