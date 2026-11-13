/**
 * Book lifecycle, BL-3 (docs/prd-book-lifecycle.md §12, §15.4; S11/S12): submit, the VR-7 tick,
 * bundle and transcription uploads, instructions. Zips download over REST (lib/bookLcFiles.ts).
 */
import { gql } from "urql";

export interface BlSubmitT {
  status: string;
  blocking: { code: string; level: string; messageBn: string }[];
  warnings: { code: string; level: string; messageBn: string }[];
}
export const BL_SUBMIT_DRAFT = gql<{ submitBookLcDraft: BlSubmitT }, { draftId: string; summaryBn?: string | null; bump?: string | null }>`
  mutation SubmitBookLcDraft($draftId: String!, $summaryBn: String, $bump: String) {
    submitBookLcDraft(draftId: $draftId, summaryBn: $summaryBn, bump: $bump) { status blocking { code level messageBn } warnings { code level messageBn } }
  }
`;
export const BL_ACK_UNEXPLAINED = gql<{ ackBookLcUnexplained: boolean }, { draftId: string; chapterKey: string; index: number }>`
  mutation AckBookLcUnexplained($draftId: String!, $chapterKey: String!, $index: Int!) { ackBookLcUnexplained(draftId: $draftId, chapterKey: $chapterKey, index: $index) }
`;
export const BL_UPLOAD_RESULT = gql<{ uploadBookLcBundleResult: { draftId: string; chapters: { key: string; status: string; blocking: number; unexplained: number }[] } }, { bookId: string; text: string }>`
  mutation UploadBookLcBundleResult($bookId: String!, $text: String!) { uploadBookLcBundleResult(bookId: $bookId, text: $text) { draftId chapters { key status blocking unexplained } } }
`;
export const BL_UPLOAD_TRANSCRIPTION = gql<{ uploadBookLcTranscription: { code: string }[] }, { roundId: string; text: string }>`
  mutation UploadBookLcTranscription($roundId: String!, $text: String!) { uploadBookLcTranscription(roundId: $roundId, text: $text) { code } }
`;
export const BL_INSTRUCTIONS = gql<{ bookLcInstructionsPage: { rows: { id: string; code: string; textBn: string; needsReview: boolean }[]; total: number; page: number; pageSize: number } }, { bookId: string; page?: number | null; pageSize?: number | null }>`
  query BookLcInstructions($bookId: String!, $page: Int, $pageSize: Int) { bookLcInstructionsPage(bookId: $bookId, page: $page, pageSize: $pageSize) { rows { id code textBn needsReview } total page pageSize } }
`;
export const BL_ADD_INSTRUCTION = gql<{ addBookLcInstruction: { id: string; code: string } }, { bookId: string; textBn: string; needsReview?: boolean | null }>`
  mutation AddBookLcInstruction($bookId: String!, $textBn: String!, $needsReview: Boolean) { addBookLcInstruction(bookId: $bookId, textBn: $textBn, needsReview: $needsReview) { id code } }
`;
