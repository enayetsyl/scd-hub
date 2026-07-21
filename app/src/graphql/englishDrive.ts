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
  blockNumber: number;
  kind: string;
  title: string;
  version: number;
  uploadedAt: string;
  uploadedByName: string | null;
}

export interface EnglishDriveDocFullT extends EnglishDriveDocT {
  contentMd: string | null;
}

const ENGLISH_DRIVE_DOC_FIELDS = `
  id classLevel blockNumber kind title version uploadedAt uploadedByName
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

export const UPLOAD_ENGLISH_DRIVE_DOC = gql<
  {
    uploadEnglishDriveDoc: {
      doc: EnglishDriveDocT;
      replacedVersion: number | null;
    };
  },
  {
    classLevel: number;
    blockNumber: number;
    kind: string;
    title: string;
    version: number;
    contentMd: string;
  }
>`
  mutation UploadEnglishDriveDoc(
    $classLevel: Int!
    $blockNumber: Int!
    $kind: String!
    $title: String!
    $version: Int!
    $contentMd: String!
  ) {
    uploadEnglishDriveDoc(
      classLevel: $classLevel
      blockNumber: $blockNumber
      kind: $kind
      title: $title
      version: $version
      contentMd: $contentMd
    ) {
      doc { ${ENGLISH_DRIVE_DOC_FIELDS} }
      replacedVersion
    }
  }
`;
