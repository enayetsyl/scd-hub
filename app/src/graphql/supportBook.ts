/**
 * Support-book production (SB-1..SB-6) — the app's read/write surface.
 *
 * Everything here is gated server-side on a `book:*` permission (D-#405/#424). The
 * screens do not re-derive any of it: staleness, gate reasons and validator findings
 * are computed on the server and rendered verbatim, because a second implementation
 * of "is this stale" is exactly how the two drift.
 */
import { gql } from "urql";

export interface SupportBookT {
  bookId: string;
  bookType: string;
  classLevel: number;
  subject: string;
  titleBn: string;
  status: string;
  lessonCount: number;
}

export const SUPPORT_BOOKS = gql`
  query SupportBooks {
    supportBooks { bookId bookType classLevel subject titleBn status lessonCount }
  }
`;

/** One image slot as the illustrator works it. `complianceNote` is deliberately absent
 *  from the server type — stripe language must never reach a prompt (README §5). */
export interface SupportBookSlotT {
  bookId: string;
  lessonNo: number;
  slotId: string;
  sceneDescription: string | null;
  imageClass: string | null;
  action: string | null;
  containsLivingBeing: boolean | null;
  aspect: string | null;
  refs: string[];
  prompt: string | null;
  slotStatus: string | null;
  approved: string;
  cropped: string;
  upscaled: string;
  compliant: string;
  hasStale: boolean;
}

export const SUPPORT_BOOK_SLOTS = gql`
  query SupportBookSlots($bookId: String!, $lessonNo: Int) {
    supportBookSlots(bookId: $bookId, lessonNo: $lessonNo) {
      bookId lessonNo slotId
      sceneDescription imageClass action containsLivingBeing aspect refs prompt slotStatus
      approved cropped upscaled compliant hasStale
    }
  }
`;

export interface SupportBookAssetT {
  assetId: string;
  stage: string;
  fileId: string;
  source: string | null;
  generatorTool: string | null;
  current: boolean;
  uploadedAt: string;
  uploadedBy: string;
}

export const SUPPORT_BOOK_SLOT_HISTORY = gql`
  query SupportBookSlotHistory($bookId: String!, $slotId: String!) {
    supportBookSlotHistory(bookId: $bookId, slotId: $slotId) {
      assetId stage fileId source generatorTool current uploadedAt uploadedBy
    }
  }
`;

export interface StaleArtifactT { slotId: string; lessonNo: number; stage: string }

export const SUPPORT_BOOK_STALENESS = gql`
  query SupportBookStaleness($bookId: String!) {
    supportBookStaleness(bookId: $bookId) {
      blocksAssembly
      stale { slotId lessonNo stage }
    }
  }
`;
