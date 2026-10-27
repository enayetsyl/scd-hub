/**
 * Class books (D-#870, docs/prd-class-books.md) — the classroom books families read
 * page by page in the app, view only. The upload is REST (lib/files.ts
 * pickAndUploadClassBook); everything else is here.
 */
import { gql } from "urql";

export interface ClassBookT {
  id: string;
  classLevel: number;
  classLabelBn: string;
  title: string;
  sortOrder: number;
  /** PROCESSING | READY | FAILED */
  status: string;
  error: string | null;
  pageCount: number;
  pageAspect: number;
  active: boolean;
  sourceName: string;
  createdAt: string;
}

const BOOK_FIELDS = `id classLevel classLabelBn title sortOrder status error pageCount pageAspect active sourceName createdAt`;

export const CLASS_BOOKS_QUERY = gql<{ classBooks: ClassBookT[] }, { classLevel?: number | null }>`
  query ClassBooks($classLevel: Int) {
    classBooks(classLevel: $classLevel) { ${BOOK_FIELDS} }
  }
`;

export const MY_CLASS_BOOKS_QUERY = gql<{ myClassBooks: ClassBookT[] }>`
  query MyClassBooks {
    myClassBooks { ${BOOK_FIELDS} }
  }
`;

export interface ClassBookPageT {
  bookId: string;
  page: number;
  pageCount: number;
  dataUri: string;
}

export const CLASS_BOOK_PAGE_QUERY = gql<{ classBookPage: ClassBookPageT }, { bookId: string; page: number }>`
  query ClassBookPage($bookId: String!, $page: Int!) {
    classBookPage(bookId: $bookId, page: $page) { bookId page pageCount dataUri }
  }
`;

export const UPDATE_CLASS_BOOK = gql<
  { updateClassBook: ClassBookT },
  { id: string; title?: string | null; classLevel?: number | null; sortOrder?: number | null; active?: boolean | null }
>`
  mutation UpdateClassBook($id: String!, $title: String, $classLevel: Int, $sortOrder: Int, $active: Boolean) {
    updateClassBook(id: $id, title: $title, classLevel: $classLevel, sortOrder: $sortOrder, active: $active) { ${BOOK_FIELDS} }
  }
`;

export const DELETE_CLASS_BOOK = gql<{ deleteClassBook: boolean }, { id: string }>`
  mutation DeleteClassBook($id: String!) {
    deleteClassBook(id: $id)
  }
`;
