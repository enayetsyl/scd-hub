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
  subject: string | null;
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
  neededByKey subject notes status
  requestedBy requesterName requestedAt printedAt deliveredAt cancelReason
`;

/** One bucket of the Office queue, oldest first. Requires roster:manage. */
export const PRINT_QUEUE_QUERY = gql<
  { printQueue: PrintRequestT[] },
  { status: string; limit?: number | null }
>`
  query PrintQueue($status: String!, $limit: Int) {
    printQueue(status: $status, limit: $limit) { ${PRINT_REQUEST_FIELDS} }
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

export const CANCEL_PRINT_REQUEST = gql<
  { cancelPrintRequest: PrintRequestT },
  { id: string; reason?: string | null }
>`
  mutation CancelPrintRequest($id: String!, $reason: String) {
    cancelPrintRequest(id: $id, reason: $reason) { ${PRINT_REQUEST_FIELDS} }
  }
`;
