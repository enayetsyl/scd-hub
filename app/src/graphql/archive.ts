/**
 * Answer-script archive documents (AR-1..AR-3, prd-script-archive §7,
 * D-#443–#447). Validated against the real server schema by the
 * graphqlDocuments.test.ts gate — a field the server doesn't expose fails CI,
 * not the user.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

export interface StorageBoxT {
  id: string;
  boxCode: string;
  label: string | null;
  locationNote: string;
  status: string;
  createdAt: string;
  bundleCount: number;
  scriptCount: number;
}

export interface ScriptCheckoutT {
  toUserId: string;
  toUserName: string | null;
  purpose: string;
  expectedReturnDateKey: string | null;
  checkedOutAt: string;
  returnedAt: string | null;
  returnNote: string | null;
}

export interface ScriptBundleT {
  id: string;
  sourceKind: string;
  sourceRefId: string;
  sourceLabel: string;
  classLevel: number;
  subject: string;
  testNumber: number;
  examDate: string;
  scriptCount: number;
  boxId: string;
  filedBy: string;
  filedByName: string | null;
  filedAt: string;
  acknowledgedAt: string | null;
  status: string;
  checkouts: ScriptCheckoutT[];
  attachmentFileIds: string[];
  disposedAt: string | null;
  disposeReason: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  notes: string | null;
  overdue: boolean;
}

export interface ArchiveLocationT {
  testId: string;
  bundleId: string;
  boxCode: string;
  locationNote: string;
  status: string;
  holderName: string | null;
}

const BOX_FIELDS = `
  id boxCode label locationNote status createdAt bundleCount scriptCount
`;

const BUNDLE_FIELDS = `
  id sourceKind sourceRefId sourceLabel classLevel subject testNumber examDate
  scriptCount boxId filedBy filedByName filedAt acknowledgedAt status
  checkouts { toUserId toUserName purpose expectedReturnDateKey checkedOutAt returnedAt returnNote }
  attachmentFileIds disposedAt disposeReason voidedAt voidReason notes overdue
`;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const STORAGE_BOXES_QUERY = gql<{ storageBoxes: StorageBoxT[] }, { status?: string | null }>`
  query StorageBoxes($status: String) {
    storageBoxes(status: $status) { ${BOX_FIELDS} }
  }
`;

export const STORAGE_BOX_QUERY = gql<
  { storageBox: StorageBoxT | null; storageBoxBundles: ScriptBundleT[] },
  { id: string }
>`
  query StorageBox($id: String!) {
    storageBox(id: $id) { ${BOX_FIELDS} }
    storageBoxBundles(boxId: $id) { ${BUNDLE_FIELDS} }
  }
`;

export const SCRIPT_BUNDLE_QUERY = gql<{ scriptBundle: ScriptBundleT | null }, { id: string }>`
  query ScriptBundle($id: String!) {
    scriptBundle(id: $id) { ${BUNDLE_FIELDS} }
  }
`;

export const SCRIPT_BUNDLE_FOR_TEST_QUERY = gql<
  { scriptBundleForTest: ScriptBundleT | null },
  { sourceKind: string; refId: string }
>`
  query ScriptBundleForTest($sourceKind: String!, $refId: String!) {
    scriptBundleForTest(sourceKind: $sourceKind, refId: $refId) { ${BUNDLE_FIELDS} }
  }
`;

export const SCRIPT_BUNDLES_QUERY = gql<
  { scriptBundles: ScriptBundleT[] },
  { labelQuery?: string | null; status?: string | null; classLevel?: number | null }
>`
  query ScriptBundles($labelQuery: String, $status: String, $classLevel: Int) {
    scriptBundles(labelQuery: $labelQuery, status: $status, classLevel: $classLevel) {
      ${BUNDLE_FIELDS}
    }
  }
`;

export const OPEN_CHECKOUTS_QUERY = gql<{ openScriptCheckouts: ScriptBundleT[] }, NoVars>`
  query OpenScriptCheckouts {
    openScriptCheckouts { ${BUNDLE_FIELDS} }
  }
`;

export const PENDING_ACKS_QUERY = gql<{ pendingScriptAcks: ScriptBundleT[] }, NoVars>`
  query PendingScriptAcks {
    pendingScriptAcks { ${BUNDLE_FIELDS} }
  }
`;

export const DISPOSABLE_BUNDLES_QUERY = gql<{ disposableScriptBundles: ScriptBundleT[] }, NoVars>`
  query DisposableScriptBundles {
    disposableScriptBundles { ${BUNDLE_FIELDS} }
  }
`;

export const ARCHIVE_LOCATIONS_QUERY = gql<
  { archiveLocationsForTests: ArchiveLocationT[] },
  { testIds: string[] }
>`
  query ArchiveLocationsForTests($testIds: [String!]!) {
    archiveLocationsForTests(testIds: $testIds) {
      testId bundleId boxCode locationNote status holderName
    }
  }
`;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const FILE_SCRIPT_BUNDLE = gql<
  { fileScriptBundle: ScriptBundleT },
  {
    sourceKind: string;
    refId: string;
    scriptCount: number;
    boxId: string;
    notes?: string | null;
    attachmentFileIds?: string[] | null;
  }
>`
  mutation FileScriptBundle(
    $sourceKind: String!
    $refId: String!
    $scriptCount: Int!
    $boxId: String!
    $notes: String
    $attachmentFileIds: [String!]
  ) {
    fileScriptBundle(
      sourceKind: $sourceKind
      refId: $refId
      scriptCount: $scriptCount
      boxId: $boxId
      notes: $notes
      attachmentFileIds: $attachmentFileIds
    ) { ${BUNDLE_FIELDS} }
  }
`;

export const ACKNOWLEDGE_SCRIPT_BUNDLE = gql<
  { acknowledgeScriptBundle: ScriptBundleT },
  { id: string }
>`
  mutation AcknowledgeScriptBundle($id: String!) {
    acknowledgeScriptBundle(id: $id) { ${BUNDLE_FIELDS} }
  }
`;

export const CHECK_OUT_SCRIPT_BUNDLE = gql<
  { checkOutScriptBundle: ScriptBundleT },
  { id: string; toUserId: string; purpose: string; expectedReturnDateKey?: string | null }
>`
  mutation CheckOutScriptBundle(
    $id: String!
    $toUserId: String!
    $purpose: String!
    $expectedReturnDateKey: String
  ) {
    checkOutScriptBundle(
      id: $id
      toUserId: $toUserId
      purpose: $purpose
      expectedReturnDateKey: $expectedReturnDateKey
    ) { ${BUNDLE_FIELDS} }
  }
`;

export const CHECK_IN_SCRIPT_BUNDLE = gql<
  { checkInScriptBundle: ScriptBundleT },
  { id: string; note?: string | null; boxId?: string | null }
>`
  mutation CheckInScriptBundle($id: String!, $note: String, $boxId: String) {
    checkInScriptBundle(id: $id, note: $note, boxId: $boxId) { ${BUNDLE_FIELDS} }
  }
`;

export const DISPOSE_SCRIPT_BUNDLE = gql<
  { disposeScriptBundle: ScriptBundleT },
  { id: string; reason: string }
>`
  mutation DisposeScriptBundle($id: String!, $reason: String!) {
    disposeScriptBundle(id: $id, reason: $reason) { ${BUNDLE_FIELDS} }
  }
`;

export const VOID_SCRIPT_BUNDLE = gql<
  { voidScriptBundle: ScriptBundleT },
  { id: string; reason: string }
>`
  mutation VoidScriptBundle($id: String!, $reason: String!) {
    voidScriptBundle(id: $id, reason: $reason) { ${BUNDLE_FIELDS} }
  }
`;

export const CREATE_STORAGE_BOX = gql<
  { createStorageBox: StorageBoxT },
  { label?: string | null; locationNote: string }
>`
  mutation CreateStorageBox($label: String, $locationNote: String!) {
    createStorageBox(label: $label, locationNote: $locationNote) { ${BOX_FIELDS} }
  }
`;

export const UPDATE_STORAGE_BOX = gql<
  { updateStorageBox: StorageBoxT },
  { id: string; label?: string | null; locationNote?: string | null }
>`
  mutation UpdateStorageBox($id: String!, $label: String, $locationNote: String) {
    updateStorageBox(id: $id, label: $label, locationNote: $locationNote) { ${BOX_FIELDS} }
  }
`;

export const RETIRE_STORAGE_BOX = gql<{ retireStorageBox: StorageBoxT }, { id: string }>`
  mutation RetireStorageBox($id: String!) {
    retireStorageBox(id: $id) { ${BOX_FIELDS} }
  }
`;
