/**
 * Winter-task booklet review (D-#1620, docs/prd-winter-task.md) — the winter-holiday booklets
 * as editable text; a named reviewer suggests edits, the Principal accepts them.
 */
import { gql } from "urql";

export interface WinterBookletRowT {
  id: string;
  code: string;
  classLevel: number;
  classLabelBn: string;
  titleBn: string;
  version: number;
  /** DRAFT | IN_REVIEW | APPROVED */
  status: string;
  pageCount: number;
  openChanges: number;
  acceptedChanges: number;
}

export interface WinterBlockT {
  id: string;
  /** heading | text | item | prompt | line */
  kind: string;
  textBn: string;
  labelBn?: string;
  /** Present when an accepted change replaces the text. */
  acceptedBn?: string;
}

export interface WinterPageT {
  n: number;
  /** COVER | DAY | TICKSHEET */
  kind: string;
  dateKey?: string;
  subject?: string;
  week?: number;
  blocks: WinterBlockT[];
}

export interface WinterBookletDetailT {
  id: string;
  code: string;
  classLevel: number;
  classLabelBn: string;
  titleBn: string;
  version: number;
  status: string;
  pagesJson: string;
}

export interface WinterChangeT {
  id: string;
  bookletId: string;
  pageN: number;
  blockId: string | null;
  before: string;
  after: string;
  note: string | null;
  byName: string;
  mine: boolean;
  /** OPEN | ACCEPTED | REJECTED */
  status: string;
  stale: boolean;
  createdAt: string;
  editedAt: string | null;
}

const ROW = `id code classLevel classLabelBn titleBn version status pageCount openChanges acceptedChanges`;
const CHANGE = `id bookletId pageN blockId before after note byName mine status stale createdAt editedAt`;

export const WINTER_BOOKLETS_QUERY = gql<{ winterBooklets: WinterBookletRowT[] }>`
  query WinterBooklets { winterBooklets { ${ROW} } }
`;

export const WINTER_BOOKLET_QUERY = gql<{ winterBooklet: WinterBookletDetailT }, { id: string }>`
  query WinterBooklet($id: String!) {
    winterBooklet(id: $id) { id code classLevel classLabelBn titleBn version status pagesJson }
  }
`;

export const WINTER_CHANGES_QUERY = gql<{ winterChanges: WinterChangeT[] }, { bookletId: string; pageN?: number | null }>`
  query WinterChanges($bookletId: String!, $pageN: Int) {
    winterChanges(bookletId: $bookletId, pageN: $pageN) { ${CHANGE} }
  }
`;

export const SUGGEST_WINTER_CHANGE = gql<
  { suggestWinterChange: WinterChangeT },
  { bookletId: string; pageN: number; blockId?: string | null; after?: string | null; note?: string | null }
>`
  mutation SuggestWinterChange($bookletId: String!, $pageN: Int!, $blockId: String, $after: String, $note: String) {
    suggestWinterChange(bookletId: $bookletId, pageN: $pageN, blockId: $blockId, after: $after, note: $note) { ${CHANGE} }
  }
`;

export const EDIT_WINTER_CHANGE = gql<
  { editWinterChange: WinterChangeT },
  { id: string; after?: string | null; note?: string | null }
>`
  mutation EditWinterChange($id: String!, $after: String, $note: String) {
    editWinterChange(id: $id, after: $after, note: $note) { ${CHANGE} }
  }
`;

export const DELETE_WINTER_CHANGE = gql<{ deleteWinterChange: boolean }, { id: string }>`
  mutation DeleteWinterChange($id: String!) { deleteWinterChange(id: $id) }
`;

export const DECIDE_WINTER_CHANGE = gql<{ decideWinterChange: WinterChangeT }, { id: string; accept: boolean; seenVersion: string }>`
  mutation DecideWinterChange($id: String!, $accept: Boolean!, $seenVersion: String!) {
    decideWinterChange(id: $id, accept: $accept, seenVersion: $seenVersion) { ${CHANGE} }
  }
`;

export const SET_WINTER_BOOKLET_STATUS = gql<{ setWinterBookletStatus: WinterBookletRowT }, { id: string; status: string }>`
  mutation SetWinterBookletStatus($id: String!, $status: String!) {
    setWinterBookletStatus(id: $id, status: $status) { ${ROW} }
  }
`;

export const EXPORT_WINTER_BOOKLET_QUERY = gql<{ exportWinterBooklet: string }, { id: string }>`
  query ExportWinterBooklet($id: String!) { exportWinterBooklet(id: $id) }
`;
