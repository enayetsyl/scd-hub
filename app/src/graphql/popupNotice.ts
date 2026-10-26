/**
 * Pop-up notices (D-#852–#858, docs/prd-popup-notice.md).
 *
 * Recipient side: MY_POPUP_QUEUE (asked on app open by every login), RECORD_POPUP_EVENT,
 * MY_POPUP_HISTORY_PAGE (আমার বার্তা). Sender side (popup_notice:*): the list, the
 * composer's preview / people search / saved lists, the report and the follow-ups.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

export interface PopupRulesT {
  autoCloseSec: number;
  closeButton: boolean;
  mustScrollToEnd: boolean;
  minReadSec: number;
  mustAct: boolean;
  allowSnooze: boolean;
  maxSnooze: number;
  allowAnswerChange: boolean;
}

export interface PopupActionT {
  id: string;
  /** ACK | CHOICE | OPEN_SCREEN | OPEN_LINK */
  kind: string;
  labelBn: string;
  labelEn: string;
  target: string;
}

export interface PopupShowT {
  noticeId: string;
  version: number;
  test: boolean;
  titleBn: string;
  bodyBn: string;
  titleEn: string;
  bodyEn: string;
  /** info | important | urgent */
  tone: string;
  attachmentUrl: string;
  fromLabel: string;
  rules: PopupRulesT;
  actions: PopupActionT[];
  /** NOT_SEEN | SEEN | READ | ACTED */
  state: string;
  choiceId: string | null;
  snoozeCount: number;
  canChangeAnswer: boolean;
  todayKey: string;
}

const RULES = `rules { autoCloseSec closeButton mustScrollToEnd minReadSec mustAct allowSnooze maxSnooze allowAnswerChange }`;
const ACTIONS = `actions { id kind labelBn labelEn target }`;
const SHOW = `noticeId version test titleBn bodyBn titleEn bodyEn tone attachmentUrl fromLabel ${RULES} ${ACTIONS} state choiceId snoozeCount canChangeAnswer todayKey`;

export const MY_POPUP_QUEUE = gql<{ myPopupQueue: PopupShowT[] }, NoVars>`
  query MyPopupQueue {
    myPopupQueue { ${SHOW} }
  }
`;

export interface PopupEventVars {
  input: {
    noticeId: string;
    kind: "SEEN" | "READ" | "CLOSED" | "ACTED" | "SNOOZED";
    test?: boolean;
    method?: "auto" | "button";
    choiceId?: string;
    readMs?: number;
    device?: string;
  };
}

export const RECORD_POPUP_EVENT = gql<{ recordPopupEvent: PopupShowT | null }, PopupEventVars>`
  mutation RecordPopupEvent($input: PopupEventInput!) {
    recordPopupEvent(input: $input) { ${SHOW} }
  }
`;

export interface PopupHistoryRowT {
  show: PopupShowT;
  publishedAt: string | null;
  choiceLabel: string;
  live: boolean;
}

export interface PageT<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const MY_POPUP_HISTORY_PAGE = gql<{ myPopupHistoryPage: PageT<PopupHistoryRowT> }, { page?: number; pageSize?: number }>`
  query MyPopupHistoryPage($page: Int, $pageSize: Int) {
    myPopupHistoryPage(page: $page, pageSize: $pageSize) {
      rows { show { ${SHOW} } publishedAt choiceLabel live }
      total page pageSize
    }
  }
`;

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

export interface PopupStaffFilterT {
  roles: string[];
  employment: string;
  genders: string[];
  classLevels: number[];
  subjects: string[];
  classTeachersOnly: boolean;
}

export interface PopupAudienceT {
  staff: PopupStaffFilterT | null;
  guardian: { classLevels: number[]; sectionIds: string[] } | null;
  userIds: string[];
  studentIds: string[];
  excludeUserIds: string[];
  excludeGuardianIds: string[];
  excludeStudentIds: string[];
}

export interface PopupNoticeT {
  id: string;
  titleBn: string;
  bodyBn: string;
  titleEn: string;
  bodyEn: string;
  tone: string;
  attachmentUrl: string;
  audience: PopupAudienceT;
  audienceListId: string | null;
  audienceSummary: string;
  rules: PopupRulesT;
  actions: PopupActionT[];
  startsAt: string | null;
  endsOn: string;
  repeat: string;
  status: string;
  /** DRAFT | SCHEDULED | LIVE | ENDED | WITHDRAWN */
  displayStatus: string;
  version: number;
  recipientCount: number;
  unreachableCount: number;
  seenCount: number;
  doneCount: number;
  actedCount: number;
  publishedAt: string | null;
  createdByName: string;
  publishedByName: string;
  createdAt: string;
  updatedAt: string;
}

const AUDIENCE = `audience { staff { roles employment genders classLevels subjects classTeachersOnly } guardian { classLevels sectionIds } userIds studentIds excludeUserIds excludeGuardianIds excludeStudentIds }`;
const NOTICE = `id titleBn bodyBn titleEn bodyEn tone attachmentUrl ${AUDIENCE} audienceListId audienceSummary ${RULES} ${ACTIONS} startsAt endsOn repeat status displayStatus version recipientCount unreachableCount seenCount doneCount actedCount publishedAt createdByName publishedByName createdAt updatedAt`;

export const POPUP_NOTICES_PAGE = gql<{ popupNoticesPage: PageT<PopupNoticeT> }, { page?: number; pageSize?: number; status?: string | null }>`
  query PopupNoticesPage($page: Int, $pageSize: Int, $status: String) {
    popupNoticesPage(page: $page, pageSize: $pageSize, status: $status) {
      rows { ${NOTICE} }
      total page pageSize
    }
  }
`;

export const POPUP_NOTICE = gql<{ popupNotice: PopupNoticeT }, { id: string }>`
  query PopupNotice($id: String!) {
    popupNotice(id: $id) { ${NOTICE} }
  }
`;

/** What the composer sends — the server's PopupAudienceInput. */
export interface PopupAudienceInputT {
  staff?: {
    roles?: string[];
    employment?: string;
    genders?: string[];
    classLevels?: number[];
    subjects?: string[];
    classTeachersOnly?: boolean;
  } | null;
  guardian?: { classLevels?: number[]; sectionIds?: string[] } | null;
  userIds?: string[];
  studentIds?: string[];
  /** The sender's ✕ on the name list. */
  excludeUserIds?: string[];
  excludeGuardianIds?: string[];
  excludeStudentIds?: string[];
}

export interface PopupNoticeInputT {
  titleBn: string;
  bodyBn: string;
  titleEn?: string;
  bodyEn?: string;
  tone?: string;
  attachmentUrl?: string;
  audience: PopupAudienceInputT;
  audienceListId?: string | null;
  rules: Partial<PopupRulesT>;
  actions: Array<{ kind: string; labelBn: string; labelEn?: string; target?: string }>;
  startsAt?: string | null;
  endsOn: string;
  repeat?: string;
}

export const SAVE_POPUP_DRAFT = gql<{ savePopupDraft: PopupNoticeT }, { id?: string | null; input: PopupNoticeInputT }>`
  mutation SavePopupDraft($id: String, $input: PopupNoticeInput!) {
    savePopupDraft(id: $id, input: $input) { ${NOTICE} }
  }
`;

export const DELETE_POPUP_DRAFT = gql<{ deletePopupDraft: boolean }, { id: string }>`
  mutation DeletePopupDraft($id: String!) { deletePopupDraft(id: $id) }
`;

export const PUBLISH_POPUP_NOTICE = gql<{ publishPopupNotice: PopupNoticeT }, { id: string }>`
  mutation PublishPopupNotice($id: String!) {
    publishPopupNotice(id: $id) { ${NOTICE} }
  }
`;

export interface PopupEditLiveInputT {
  titleBn: string;
  bodyBn: string;
  titleEn?: string;
  bodyEn?: string;
  tone?: string;
  attachmentUrl?: string;
  endsOn: string;
  actionLabelsBn?: string[];
  reshow?: boolean;
}

export const EDIT_LIVE_POPUP_NOTICE = gql<{ editLivePopupNotice: PopupNoticeT }, { id: string; input: PopupEditLiveInputT }>`
  mutation EditLivePopupNotice($id: String!, $input: PopupEditLiveInput!) {
    editLivePopupNotice(id: $id, input: $input) { ${NOTICE} }
  }
`;

export const WITHDRAW_POPUP_NOTICE = gql<{ withdrawPopupNotice: PopupNoticeT }, { id: string }>`
  mutation WithdrawPopupNotice($id: String!) {
    withdrawPopupNotice(id: $id) { ${NOTICE} }
  }
`;

export const DUPLICATE_POPUP_NOTICE = gql<{ duplicatePopupNotice: PopupNoticeT }, { id: string }>`
  mutation DuplicatePopupNotice($id: String!) {
    duplicatePopupNotice(id: $id) { ${NOTICE} }
  }
`;

export const SEND_POPUP_TEST_TO_ME = gql<{ sendPopupTestToMe: boolean }, { id: string }>`
  mutation SendPopupTestToMe($id: String!) { sendPopupTestToMe(id: $id) }
`;

export const REMIND_POPUP_NOTICE = gql<{ remindPopupNotice: number }, { id: string }>`
  mutation RemindPopupNotice($id: String!) { remindPopupNotice(id: $id) }
`;

export const ADD_POPUP_MATCHES = gql<{ addPopupMatches: number }, { id: string }>`
  mutation AddPopupMatches($id: String!) { addPopupMatches(id: $id) }
`;

export interface PopupAudiencePreviewT {
  total: number;
  staffCount: number;
  guardianCount: number;
  reachableCount: number;
  unreachableCount: number;
  staffMissingGender: number;
  summary: string;
  people: PageT<{ kind: string; id: string; name: string; detail: string; reachable: boolean }>;
  /** People taken out with ✕ — for undo. */
  excluded: Array<{ kind: string; id: string; name: string; detail: string; reachable: boolean }>;
}

export const POPUP_AUDIENCE_PREVIEW = gql<
  { popupAudiencePreview: PopupAudiencePreviewT },
  { audience: PopupAudienceInputT; page?: number; pageSize?: number }
>`
  query PopupAudiencePreview($audience: PopupAudienceInput!, $page: Int, $pageSize: Int) {
    popupAudiencePreview(audience: $audience, page: $page, pageSize: $pageSize) {
      total staffCount guardianCount reachableCount unreachableCount staffMissingGender summary
      people { rows { kind id name detail reachable } total page pageSize }
      excluded { kind id name detail reachable }
    }
  }
`;

export interface PopupPersonHitT {
  /** USER (a staff login) | STUDENT (a family, by child) */
  kind: string;
  id: string;
  name: string;
  detail: string;
}

export const SEARCH_POPUP_PEOPLE = gql<{ searchPopupPeople: PageT<PopupPersonHitT> }, { query: string; page?: number; pageSize?: number }>`
  query SearchPopupPeople($query: String!, $page: Int, $pageSize: Int) {
    searchPopupPeople(query: $query, page: $page, pageSize: $pageSize) {
      rows { kind id name detail }
      total page pageSize
    }
  }
`;

export const POPUP_PICKED_PEOPLE = gql<{ popupPickedPeople: PopupPersonHitT[] }, { userIds: string[]; studentIds: string[] }>`
  query PopupPickedPeople($userIds: [String!]!, $studentIds: [String!]!) {
    popupPickedPeople(userIds: $userIds, studentIds: $studentIds) { kind id name detail }
  }
`;

export interface PopupAudienceListT {
  id: string;
  name: string;
  audience: PopupAudienceT;
  summary: string;
  updatedAt: string;
}

export const POPUP_AUDIENCE_LISTS_PAGE = gql<{ popupAudienceListsPage: PageT<PopupAudienceListT> }, { page?: number; pageSize?: number }>`
  query PopupAudienceListsPage($page: Int, $pageSize: Int) {
    popupAudienceListsPage(page: $page, pageSize: $pageSize) {
      rows { id name ${AUDIENCE} summary updatedAt }
      total page pageSize
    }
  }
`;

export const SAVE_POPUP_AUDIENCE_LIST = gql<
  { savePopupAudienceList: PopupAudienceListT },
  { id?: string | null; name: string; audience: PopupAudienceInputT }
>`
  mutation SavePopupAudienceList($id: String, $name: String!, $audience: PopupAudienceInput!) {
    savePopupAudienceList(id: $id, name: $name, audience: $audience) { id name ${AUDIENCE} summary updatedAt }
  }
`;

export const DELETE_POPUP_AUDIENCE_LIST = gql<{ deletePopupAudienceList: boolean }, { id: string }>`
  mutation DeletePopupAudienceList($id: String!) { deletePopupAudienceList(id: $id) }
`;

export interface PopupReportT {
  noticeId: string;
  recipients: number;
  reachable: number;
  unreachable: number;
  seen: number;
  read: number;
  acted: number;
  done: number;
  notSeen: number;
  choices: Array<{ id: string; label: string; count: number }>;
  groups: Array<{ group: string; reachable: number; seen: number; read: number; acted: number; done: number }>;
}

export const POPUP_NOTICE_REPORT = gql<{ popupNoticeReport: PopupReportT }, { id: string }>`
  query PopupNoticeReport($id: String!) {
    popupNoticeReport(id: $id) {
      noticeId recipients reachable unreachable seen read acted done notSeen
      choices { id label count }
      groups { group reachable seen read acted done }
    }
  }
`;

export interface PopupRecipientRowT {
  id: string;
  kind: string;
  name: string;
  detail: string;
  group: string;
  reachable: boolean;
  state: string;
  done: boolean;
  closeMethod: string;
  choiceLabel: string;
  lastSeenAt: string | null;
  showCount: number;
  readMs: number;
  deviceKinds: string[];
  phone: string;
  waLink: string;
}

export const POPUP_RECIPIENTS_PAGE = gql<
  { popupRecipientsPage: PageT<PopupRecipientRowT> },
  { id: string; filter?: string | null; page?: number; pageSize?: number }
>`
  query PopupRecipientsPage($id: String!, $filter: String, $page: Int, $pageSize: Int) {
    popupRecipientsPage(id: $id, filter: $filter, page: $page, pageSize: $pageSize) {
      rows { id kind name detail group reachable state done closeMethod choiceLabel lastSeenAt showCount readMs deviceKinds phone waLink }
      total page pageSize
    }
  }
`;
