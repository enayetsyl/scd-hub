/**
 * Book PDF (PB-1/PB-2, D-#1661) — the real printed pages of a school book: the teachers' shelf,
 * one page at a time, and the Office upload screen's data. The upload itself is REST
 * (lib/files.ts pickAndUploadBookPdf).
 */
import { gql } from "urql";

export interface BookPdfChapterT {
  key: string;
  title: string;
  fromPage: number;
  toPage: number;
}

export interface BookPdfT {
  id: string;
  bookCode: string;
  classLevel: number;
  subject: string;
  titleBn: string;
  versionLabel: string;
  sourceName: string;
  /** PROCESSING | READY | FAILED */
  status: string;
  error: string | null;
  replacing: boolean;
  pageCount: number;
  pageAspect: number;
  active: boolean;
  chapters: BookPdfChapterT[];
  updatedAt: string;
}

const PDF_FIELDS = `id bookCode classLevel subject titleBn versionLabel sourceName status error replacing pageCount pageAspect active updatedAt chapters { key title fromPage toPage }`;

export const BOOK_PDF_SHELF = gql<{ bookPdfShelf: BookPdfT[] }>`
  query BookPdfShelf {
    bookPdfShelf { ${PDF_FIELDS} }
  }
`;

export interface BookPdfPageT {
  pdfId: string;
  page: number;
  pageCount: number;
  dataUri: string;
}

export const BOOK_PDF_PAGE = gql<{ bookPdfPage: BookPdfPageT }, { pdfId: string; page: number }>`
  query BookPdfPage($pdfId: String!, $page: Int!) {
    bookPdfPage(pdfId: $pdfId, page: $page) { pdfId page pageCount dataUri }
  }
`;

export interface BookPdfAdminRowT {
  bookCode: string;
  classLevel: number;
  subject: string;
  titleBn: string;
  pdf: BookPdfT | null;
}

export const BOOK_PDF_ADMIN_SHELF = gql<{ bookPdfAdminShelf: BookPdfAdminRowT[] }>`
  query BookPdfAdminShelf {
    bookPdfAdminShelf { bookCode classLevel subject titleBn pdf { ${PDF_FIELDS} } }
  }
`;

export const BOOK_CHAPTER_KEYS = gql<{ bookChapterKeys: { key: string; title: string }[] }, { bookCode: string }>`
  query BookChapterKeys($bookCode: String!) {
    bookChapterKeys(bookCode: $bookCode) { key title }
  }
`;

export const SET_BOOK_PDF_CHAPTERS = gql<
  { setBookPdfChapters: BookPdfT },
  { bookCode: string; chapters: { key: string; title?: string | null; fromPage: number; toPage: number }[] }
>`
  mutation SetBookPdfChapters($bookCode: String!, $chapters: [BookPdfChapterInput!]!) {
    setBookPdfChapters(bookCode: $bookCode, chapters: $chapters) { ${PDF_FIELDS} }
  }
`;

export const UPDATE_BOOK_PDF = gql<{ updateBookPdf: BookPdfT }, { bookCode: string; versionLabel?: string | null; active?: boolean | null }>`
  mutation UpdateBookPdf($bookCode: String!, $versionLabel: String, $active: Boolean) {
    updateBookPdf(bookCode: $bookCode, versionLabel: $versionLabel, active: $active) { ${PDF_FIELDS} }
  }
`;

export const DELETE_BOOK_PDF = gql<{ deleteBookPdf: boolean }, { bookCode: string }>`
  mutation DeleteBookPdf($bookCode: String!) {
    deleteBookPdf(bookCode: $bookCode)
  }
`;
