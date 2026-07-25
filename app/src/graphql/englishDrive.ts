/**
 * English Drive operations (D-#344) — the md-import + class-scoped teacher
 * library: Principal/Office upload block files + derivatives; the class's
 * English teachers read them, render the markdown and export the PDF.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

export interface EnglishDriveDocT {
  id: string;
  classLevel: number;
  /** Null = block-less (assignments are week-scoped, D-#346; PT uses blockNumbers). */
  blockNumber: number | null;
  /** The blocks a PT covers (D-#347); [] for every other kind. */
  blockNumbers: number[];
  kind: string;
  seq: number;
  title: string;
  version: number;
  /** MD (markdown) | PDF | DOCX (binary opened via fileId). Legacy rows = MD. */
  format: string;
  /** The ORIGINAL binary StoredFile id (PDF/DOCX) — the download; null for MD. */
  fileId: string | null;
  /** DOCX: the converted PDF StoredFile — previews + prints; null otherwise. */
  pdfFileId: string | null;
  fileName: string | null;
  fileMime: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
}

export interface EnglishDriveDocFullT extends EnglishDriveDocT {
  contentMd: string | null;
}

const ENGLISH_DRIVE_DOC_FIELDS = `
  id classLevel blockNumber blockNumbers kind seq title version format fileId pdfFileId fileName fileMime uploadedAt uploadedByName
`;

export const ENGLISH_DRIVE_MY_CLASS_LEVELS = gql<{ englishDriveMyClassLevels: number[] }, NoVars>`
  query EnglishDriveMyClassLevels {
    englishDriveMyClassLevels
  }
`;

export const ENGLISH_DRIVE_DOCS = gql<
  { englishDriveDocs: EnglishDriveDocT[] },
  { classLevel?: number | null }
>`
  query EnglishDriveDocs($classLevel: Int) {
    englishDriveDocs(classLevel: $classLevel) { ${ENGLISH_DRIVE_DOC_FIELDS} }
  }
`;

export const ENGLISH_DRIVE_DOC = gql<{ englishDriveDoc: EnglishDriveDocFullT }, { id: string }>`
  query EnglishDriveDoc($id: String!) {
    englishDriveDoc(id: $id) { ${ENGLISH_DRIVE_DOC_FIELDS} contentMd }
  }
`;

export const SEND_ENGLISH_DRIVE_TO_PRINT = gql<
  { sendEnglishDriveDocToPrint: { printRequestId: string; title: string } },
  {
    id: string;
    colour: string;
    sides: string;
    copies: number;
    contentMd?: string | null;
    fontScale?: number | null;
    lineSpacing?: number | null;
    margin?: number | null;
  }
>`
  mutation SendEnglishDriveDocToPrint(
    $id: String!
    $colour: String!
    $sides: String!
    $copies: Int!
    $contentMd: String
    $fontScale: Float
    $lineSpacing: Float
    $margin: Float
  ) {
    sendEnglishDriveDocToPrint(
      id: $id
      colour: $colour
      sides: $sides
      copies: $copies
      contentMd: $contentMd
      fontScale: $fontScale
      lineSpacing: $lineSpacing
      margin: $margin
    ) {
      printRequestId
      title
    }
  }
`;

export const UPLOAD_ENGLISH_DRIVE_DOC = gql<
  {
    uploadEnglishDriveDoc: {
      doc: EnglishDriveDocT;
      replacedVersion: number | null;
    };
  },
  {
    classLevel: number;
    blockNumber: number | null;
    blockNumbers?: number[] | null;
    kind: string;
    seq: number;
    title: string;
    version: number;
    format?: string | null;
    contentMd?: string | null;
    fileId?: string | null;
    pdfFileId?: string | null;
    fileName?: string | null;
    fileMime?: string | null;
  }
>`
  mutation UploadEnglishDriveDoc(
    $classLevel: Int!
    $blockNumber: Int
    $blockNumbers: [Int!]
    $kind: String!
    $seq: Int
    $title: String!
    $version: Int!
    $format: String
    $contentMd: String
    $fileId: String
    $pdfFileId: String
    $fileName: String
    $fileMime: String
  ) {
    uploadEnglishDriveDoc(
      classLevel: $classLevel
      blockNumber: $blockNumber
      blockNumbers: $blockNumbers
      kind: $kind
      seq: $seq
      title: $title
      version: $version
      format: $format
      contentMd: $contentMd
      fileId: $fileId
      pdfFileId: $pdfFileId
      fileName: $fileName
      fileMime: $fileMime
    ) {
      doc { ${ENGLISH_DRIVE_DOC_FIELDS} }
      replacedVersion
    }
  }
`;
