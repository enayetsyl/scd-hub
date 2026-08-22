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
  uploadedById: string;
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
  uploadedAt uploadedById uploadedByName commentCount openCommentCount
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

// ---------------------------------------------------------------------------
// TN-2 — improvement comments. The thread is anchored to the note's IDENTITY,
// so passing any version's id returns the same comments (D-#516).
// ---------------------------------------------------------------------------

export interface TeachingNoteCommentT {
  id: string;
  noteId: string;
  classLevel: number;
  subject: string;
  kind: string;
  seq: number;
  /** The version its author was reading. */
  versionSeen: number;
  bodyBn: string;
  anchor: string | null;
  authorId: string;
  authorName: string | null;
  status: string;
  addressedByName: string | null;
  addressedAt: string | null;
  addressedNote: string | null;
  createdAt: string;
  /** True when versionSeen < currentVersion — "written on v2, current is v3". */
  staleForCurrentVersion: boolean;
  currentVersion: number;
  noteTitle: string;
}

const TEACHING_NOTE_COMMENT_FIELDS = `
  id noteId classLevel subject kind seq versionSeen bodyBn anchor authorId authorName
  status addressedByName addressedAt addressedNote createdAt staleForCurrentVersion
  currentVersion noteTitle
`;

export const TEACHING_NOTE_COMMENTS = gql<
  { teachingNoteComments: TeachingNoteCommentT[] },
  { noteId: string }
>`
  query TeachingNoteComments($noteId: String!) {
    teachingNoteComments(noteId: $noteId) { ${TEACHING_NOTE_COMMENT_FIELDS} }
  }
`;

export const OPEN_TEACHING_NOTE_COMMENTS = gql<
  { openTeachingNoteComments: TeachingNoteCommentT[] },
  NoVars
>`
  query OpenTeachingNoteComments {
    openTeachingNoteComments { ${TEACHING_NOTE_COMMENT_FIELDS} }
  }
`;

export const ADD_TEACHING_NOTE_COMMENT = gql<
  { addTeachingNoteComment: TeachingNoteCommentT },
  { noteId: string; bodyBn: string; anchor?: string | null }
>`
  mutation AddTeachingNoteComment($noteId: String!, $bodyBn: String!, $anchor: String) {
    addTeachingNoteComment(noteId: $noteId, bodyBn: $bodyBn, anchor: $anchor) {
      ${TEACHING_NOTE_COMMENT_FIELDS}
    }
  }
`;

export const SET_TEACHING_NOTE_COMMENT_STATUS = gql<
  { setTeachingNoteCommentStatus: TeachingNoteCommentT },
  { commentId: string; status: string; addressedNote?: string | null }
>`
  mutation SetTeachingNoteCommentStatus(
    $commentId: String!
    $status: String!
    $addressedNote: String
  ) {
    setTeachingNoteCommentStatus(
      commentId: $commentId
      status: $status
      addressedNote: $addressedNote
    ) { ${TEACHING_NOTE_COMMENT_FIELDS} }
  }
`;

export const ADDRESS_TEACHING_NOTE_COMMENTS = gql<
  { addressTeachingNoteComments: number },
  { commentIds: string[]; addressedNote?: string | null }
>`
  mutation AddressTeachingNoteComments($commentIds: [String!]!, $addressedNote: String) {
    addressTeachingNoteComments(commentIds: $commentIds, addressedNote: $addressedNote)
  }
`;

export const DELETE_TEACHING_NOTE_COMMENT = gql<
  { deleteTeachingNoteComment: boolean },
  { commentId: string }
>`
  mutation DeleteTeachingNoteComment($commentId: String!) {
    deleteTeachingNoteComment(commentId: $commentId)
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
