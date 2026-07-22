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
  uploadedAt: string;
  uploadedByName: string | null;
}

export interface EnglishDriveDocFullT extends EnglishDriveDocT {
  contentMd: string | null;
}

const ENGLISH_DRIVE_DOC_FIELDS = `
  id classLevel blockNumber blockNumbers kind seq title version uploadedAt uploadedByName
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
  { id: string; colour: string; sides: string; copies: number }
>`
  mutation SendEnglishDriveDocToPrint($id: String!, $colour: String!, $sides: String!, $copies: Int!) {
    sendEnglishDriveDocToPrint(id: $id, colour: $colour, sides: $sides, copies: $copies) {
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
    contentMd: string;
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
    $contentMd: String!
  ) {
    uploadEnglishDriveDoc(
      classLevel: $classLevel
      blockNumber: $blockNumber
      blockNumbers: $blockNumbers
      kind: $kind
      seq: $seq
      title: $title
      version: $version
      contentMd: $contentMd
    ) {
      doc { ${ENGLISH_DRIVE_DOC_FIELDS} }
      replacedVersion
    }
  }
`;
