/**
 * Teaching Notes operations (TN-1, prd-teaching-notes) — the (class × subject)
 * pedagogy library: Principal/Office upload answer guides, lesson notes and
 * syllabi; the class's subject teachers read them and (TN-2) comment.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

export interface TeachingNoteT {
  id: string;
  classLevel: number;
  subject: string;
  kind: string;
  seq: number;
  title: string;
  version: number;
  /** MD (markdown) | PDF | DOCX (binary opened via fileId). */
  format: string;
  /** The ORIGINAL binary StoredFile id (PDF/DOCX) — the download; null for MD. */
  fileId: string | null;
  /** DOCX: the converted PDF StoredFile — previews; null otherwise. */
  pdfFileId: string | null;
  fileName: string | null;
  fileMime: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
  commentCount: number;
  openCommentCount: number;
}

export interface TeachingNoteFullT extends TeachingNoteT {
  contentMd: string | null;
}

export interface TeachingNoteScopePairT {
  classLevel: number;
  subject: string;
}

const TEACHING_NOTE_FIELDS = `
  id classLevel subject kind seq title version format fileId pdfFileId fileName fileMime
  uploadedAt uploadedByName commentCount openCommentCount
`;

export const TEACHING_NOTE_MY_SCOPE = gql<
  { teachingNoteMyScope: TeachingNoteScopePairT[] },
  NoVars
>`
  query TeachingNoteMyScope {
    teachingNoteMyScope { classLevel subject }
  }
`;

export const TEACHING_NOTES = gql<
  { teachingNotes: TeachingNoteT[] },
  { classLevel?: number | null; subject?: string | null; kind?: string | null }
>`
  query TeachingNotes($classLevel: Int, $subject: String, $kind: String) {
    teachingNotes(classLevel: $classLevel, subject: $subject, kind: $kind) { ${TEACHING_NOTE_FIELDS} }
  }
`;

export const TEACHING_NOTE = gql<{ teachingNote: TeachingNoteFullT }, { id: string }>`
  query TeachingNote($id: String!) {
    teachingNote(id: $id) { ${TEACHING_NOTE_FIELDS} contentMd }
  }
`;

export const TEACHING_NOTE_VERSIONS = gql<
  { teachingNoteVersions: TeachingNoteT[] },
  { id: string }
>`
  query TeachingNoteVersions($id: String!) {
    teachingNoteVersions(id: $id) { ${TEACHING_NOTE_FIELDS} }
  }
`;

export const UPLOAD_TEACHING_NOTE = gql<
  {
    uploadTeachingNote: {
      note: TeachingNoteT;
      replacedVersion: number | null;
      openCommentCount: number;
    };
  },
  {
    classLevel: number;
    subject: string;
    kind: string;
    seq?: number | null;
    title: string;
    format?: string | null;
    contentMd?: string | null;
    fileId?: string | null;
    pdfFileId?: string | null;
    fileName?: string | null;
    fileMime?: string | null;
  }
>`
  mutation UploadTeachingNote(
    $classLevel: Int!
    $subject: String!
    $kind: String!
    $seq: Int
    $title: String!
    $format: String
    $contentMd: String
    $fileId: String
    $pdfFileId: String
    $fileName: String
    $fileMime: String
  ) {
    uploadTeachingNote(
      classLevel: $classLevel
      subject: $subject
      kind: $kind
      seq: $seq
      title: $title
      format: $format
      contentMd: $contentMd
      fileId: $fileId
      pdfFileId: $pdfFileId
      fileName: $fileName
      fileMime: $fileMime
    ) {
      note { ${TEACHING_NOTE_FIELDS} }
      replacedVersion
      openCommentCount
    }
  }
`;
