/**
 * Pop-up notices (D-#852–#858, docs/prd-popup-notice.md).
 *
 *   Sender (Office / Principal):
 *     popupNoticesPage · popupNotice · popupNoticeReport · popupRecipientsPage ·
 *     popupAudiencePreview · searchPopupPeople · popupAudienceListsPage   — popup_notice:view
 *     savePopupDraft · deletePopupDraft · publishPopupNotice · editLivePopupNotice ·
 *     withdrawPopupNotice · duplicatePopupNotice · sendPopupTestToMe ·
 *     savePopupAudienceList · deletePopupAudienceList — popup_notice:send_staff OR :send_guardian;
 *       the service then checks each half of the audience against its own action (D-#857)
 *     remindPopupNotice · addPopupMatches                                  — popup_notice:follow_up
 *   Recipient (any login, guardians included — SELF, on the gate test's OPEN_FIELDS):
 *     myPopupQueue · recordPopupEvent · myPopupHistoryPage
 *
 * Identity plane; no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import { ForbiddenError } from "../../../middleware/authz";
import {
  normalizeAudience,
  pickedPeople,
  previewAudience,
  searchPopupPeople,
  type AudiencePreview,
  type AudiencePreviewPerson,
  type PopupPersonHit,
} from "../services/PopupAudienceService";
import {
  addPopupMatches,
  deletePopupAudienceList,
  deletePopupDraft,
  duplicatePopupNotice,
  editLiveNotice,
  myPopupHistoryPage,
  myPopupQueue,
  popupAudienceListsPage,
  popupNotice,
  popupNoticeReport,
  popupNoticesPage,
  popupRecipientsPage,
  publishPopupNotice,
  recordPopupEvent,
  remindPopupNotice,
  savePopupAudienceList,
  savePopupDraft,
  sendPopupTestToMe,
  withdrawPopupNotice,
  type PopupAudienceDTO,
  type PopupAudienceListDTO,
  type PopupHistoryRow,
  type PopupNoticeDTO,
  type PopupRecipientRow,
  type PopupReport,
  type PopupShow,
} from "../services/PopupNoticeService";
import type { PopupAction, PopupRules, PopupStaffFilter } from "../models/PopupNotice";

const SEND = ["popup_notice:send_staff", "popup_notice:send_guardian"] as const;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

const PopupRulesRef = builder.objectRef<PopupRules>("PopupRules").implement({
  description: "How a pop-up closes (PRD §5): auto-close, ✕, scroll-to-end, minimum read time, must answer, snooze.",
  fields: (t) => ({
    autoCloseSec: t.exposeInt("autoCloseSec"),
    closeButton: t.exposeBoolean("closeButton"),
    mustScrollToEnd: t.exposeBoolean("mustScrollToEnd"),
    minReadSec: t.exposeInt("minReadSec"),
    mustAct: t.exposeBoolean("mustAct"),
    allowSnooze: t.exposeBoolean("allowSnooze"),
    maxSnooze: t.exposeInt("maxSnooze"),
    allowAnswerChange: t.exposeBoolean("allowAnswerChange"),
  }),
});

const PopupActionRef = builder.objectRef<PopupAction>("PopupAction").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    kind: t.exposeString("kind"),
    labelBn: t.exposeString("labelBn"),
    labelEn: t.exposeString("labelEn"),
    target: t.exposeString("target"),
  }),
});

const PopupStaffFilterRef = builder.objectRef<PopupStaffFilter>("PopupStaffFilter").implement({
  fields: (t) => ({
    roles: t.exposeStringList("roles"),
    employment: t.exposeString("employment"),
    genders: t.exposeStringList("genders"),
    classLevels: t.exposeIntList("classLevels"),
    subjects: t.exposeStringList("subjects"),
    classTeachersOnly: t.exposeBoolean("classTeachersOnly"),
  }),
});

const PopupGuardianFilterRef = builder
  .objectRef<{ classLevels: number[]; sectionIds: string[] }>("PopupGuardianFilter")
  .implement({
    fields: (t) => ({
      classLevels: t.exposeIntList("classLevels"),
      sectionIds: t.exposeStringList("sectionIds"),
    }),
  });

const PopupAudienceRef = builder.objectRef<PopupAudienceDTO>("PopupAudience").implement({
  description: "An audience: staff filter ∪ guardian filter ∪ hand-picked staff ∪ hand-picked families (D-#853/#854).",
  fields: (t) => ({
    staff: t.field({ type: PopupStaffFilterRef, nullable: true, resolve: (a) => a.staff }),
    guardian: t.field({ type: PopupGuardianFilterRef, nullable: true, resolve: (a) => a.guardian }),
    userIds: t.exposeStringList("userIds"),
    studentIds: t.exposeStringList("studentIds"),
    excludeUserIds: t.exposeStringList("excludeUserIds"),
    excludeGuardianIds: t.exposeStringList("excludeGuardianIds"),
    excludeStudentIds: t.exposeStringList("excludeStudentIds"),
  }),
});

const PopupNoticeRef = builder.objectRef<PopupNoticeDTO>("PopupNotice").implement({
  description: "A pop-up notice as its sender sees it, with derived status and progress counts.",
  fields: (t) => ({
    id: t.exposeString("id"),
    titleBn: t.exposeString("titleBn"),
    bodyBn: t.exposeString("bodyBn"),
    titleEn: t.exposeString("titleEn"),
    bodyEn: t.exposeString("bodyEn"),
    tone: t.exposeString("tone"),
    attachmentUrl: t.exposeString("attachmentUrl"),
    audience: t.field({ type: PopupAudienceRef, resolve: (n) => n.audience }),
    audienceListId: t.string({ nullable: true, resolve: (n) => n.audienceListId }),
    audienceSummary: t.exposeString("audienceSummary"),
    rules: t.field({ type: PopupRulesRef, resolve: (n) => n.rules }),
    actions: t.field({ type: [PopupActionRef], resolve: (n) => n.actions }),
    startsAt: t.string({ nullable: true, resolve: (n) => n.startsAt }),
    endsOn: t.exposeString("endsOn"),
    repeat: t.exposeString("repeat"),
    status: t.exposeString("status"),
    displayStatus: t.exposeString("displayStatus", { description: "DRAFT | SCHEDULED | LIVE | ENDED | WITHDRAWN — derived from the dates." }),
    version: t.exposeInt("version"),
    recipientCount: t.exposeInt("recipientCount"),
    unreachableCount: t.exposeInt("unreachableCount"),
    seenCount: t.exposeInt("seenCount"),
    doneCount: t.exposeInt("doneCount"),
    actedCount: t.exposeInt("actedCount"),
    publishedAt: t.string({ nullable: true, resolve: (n) => n.publishedAt }),
    createdByName: t.exposeString("createdByName"),
    publishedByName: t.exposeString("publishedByName"),
    createdAt: t.exposeString("createdAt"),
    updatedAt: t.exposeString("updatedAt"),
  }),
});
const PopupNoticePageRef = pageRef("PopupNoticePage", PopupNoticeRef);

const PopupShowRef = builder.objectRef<PopupShow>("PopupShow").implement({
  description: "One pop-up due on this app open, already personalised for the caller.",
  fields: (t) => ({
    noticeId: t.exposeString("noticeId"),
    version: t.exposeInt("version"),
    test: t.exposeBoolean("test"),
    titleBn: t.exposeString("titleBn"),
    bodyBn: t.exposeString("bodyBn"),
    titleEn: t.exposeString("titleEn"),
    bodyEn: t.exposeString("bodyEn"),
    tone: t.exposeString("tone"),
    attachmentUrl: t.exposeString("attachmentUrl"),
    fromLabel: t.exposeString("fromLabel"),
    rules: t.field({ type: PopupRulesRef, resolve: (s) => s.rules }),
    actions: t.field({ type: [PopupActionRef], resolve: (s) => s.actions }),
    state: t.exposeString("state"),
    choiceId: t.string({ nullable: true, resolve: (s) => s.choiceId }),
    snoozeCount: t.exposeInt("snoozeCount"),
    canChangeAnswer: t.exposeBoolean("canChangeAnswer"),
    todayKey: t.exposeString("todayKey"),
  }),
});

const PopupHistoryRowRef = builder.objectRef<PopupHistoryRow>("PopupHistoryRow").implement({
  description: "One row of আমার বার্তা — a notice the caller received in the last 90 days.",
  fields: (t) => ({
    show: t.field({ type: PopupShowRef, resolve: (r) => r.show }),
    publishedAt: t.string({ nullable: true, resolve: (r) => r.publishedAt }),
    choiceLabel: t.exposeString("choiceLabel"),
    live: t.exposeBoolean("live"),
  }),
});
const PopupHistoryPageRef = pageRef("PopupHistoryPage", PopupHistoryRowRef);

const PopupChoiceCountRef = builder.objectRef<PopupReport["choices"][number]>("PopupChoiceCount").implement({
  fields: (t) => ({ id: t.exposeString("id"), label: t.exposeString("label"), count: t.exposeInt("count") }),
});
const PopupReportGroupRef = builder.objectRef<PopupReport["groups"][number]>("PopupReportGroup").implement({
  fields: (t) => ({
    group: t.exposeString("group"),
    reachable: t.exposeInt("reachable"),
    seen: t.exposeInt("seen"),
    read: t.exposeInt("read"),
    acted: t.exposeInt("acted"),
    done: t.exposeInt("done"),
  }),
});
const PopupReportRef = builder.objectRef<PopupReport>("PopupReport").implement({
  description: "Seen / read / answered for one notice, over the people who can receive pop-ups (test sends excluded).",
  fields: (t) => ({
    noticeId: t.exposeString("noticeId"),
    recipients: t.exposeInt("recipients"),
    reachable: t.exposeInt("reachable"),
    unreachable: t.exposeInt("unreachable"),
    seen: t.exposeInt("seen"),
    read: t.exposeInt("read"),
    acted: t.exposeInt("acted"),
    done: t.exposeInt("done"),
    notSeen: t.exposeInt("notSeen"),
    choices: t.field({ type: [PopupChoiceCountRef], resolve: (r) => r.choices }),
    groups: t.field({ type: [PopupReportGroupRef], resolve: (r) => r.groups }),
  }),
});

const PopupRecipientRowRef = builder.objectRef<PopupRecipientRow>("PopupRecipientRow").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    kind: t.exposeString("kind"),
    name: t.exposeString("name"),
    detail: t.exposeString("detail"),
    group: t.exposeString("group"),
    reachable: t.exposeBoolean("reachable"),
    state: t.exposeString("state"),
    done: t.exposeBoolean("done"),
    closeMethod: t.exposeString("closeMethod"),
    choiceLabel: t.exposeString("choiceLabel"),
    lastSeenAt: t.string({ nullable: true, resolve: (r) => r.lastSeenAt }),
    showCount: t.exposeInt("showCount"),
    readMs: t.exposeInt("readMs"),
    deviceKinds: t.exposeStringList("deviceKinds"),
    phone: t.exposeString("phone"),
    waLink: t.exposeString("waLink"),
  }),
});
const PopupRecipientPageRef = pageRef("PopupRecipientPage", PopupRecipientRowRef);

const AudiencePersonRef = builder.objectRef<AudiencePreviewPerson>("PopupAudiencePerson").implement({
  fields: (t) => ({
    kind: t.exposeString("kind"),
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    detail: t.exposeString("detail"),
    reachable: t.exposeBoolean("reachable"),
  }),
});
const AudiencePersonPageRef = pageRef("PopupAudiencePersonPage", AudiencePersonRef);

const AudiencePreviewRef = builder.objectRef<AudiencePreview>("PopupAudiencePreview").implement({
  description: "The composer's live count and name list for an audience, resolved now.",
  fields: (t) => ({
    total: t.exposeInt("total"),
    staffCount: t.exposeInt("staffCount"),
    guardianCount: t.exposeInt("guardianCount"),
    reachableCount: t.exposeInt("reachableCount"),
    unreachableCount: t.exposeInt("unreachableCount"),
    staffMissingGender: t.exposeInt("staffMissingGender"),
    summary: t.exposeString("summary"),
    people: t.field({ type: AudiencePersonPageRef, resolve: (p) => p.people }),
    excluded: t.field({ type: [AudiencePersonRef], description: "People the sender took out with ✕ — for undo.", resolve: (p) => p.excluded }),
  }),
});

const PersonHitRef = builder.objectRef<PopupPersonHit>("PopupPersonHit").implement({
  fields: (t) => ({
    kind: t.exposeString("kind"),
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    detail: t.exposeString("detail"),
  }),
});
const PersonHitPageRef = pageRef("PopupPersonHitPage", PersonHitRef);

const AudienceListRef = builder.objectRef<PopupAudienceListDTO>("PopupAudienceList").implement({
  description: "A saved, reusable audience — filters, hand-picked people, or both (D-#854).",
  fields: (t) => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    audience: t.field({ type: PopupAudienceRef, resolve: (l) => l.audience }),
    summary: t.exposeString("summary"),
    updatedAt: t.exposeString("updatedAt"),
  }),
});
const AudienceListPageRef = pageRef("PopupAudienceListPage", AudienceListRef);

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const StaffFilterInput = builder.inputType("PopupStaffFilterInput", {
  fields: (t) => ({
    roles: t.stringList({ required: false }),
    employment: t.string({ required: false, description: "current (probation + confirmed, default) | probation | confirmed" }),
    genders: t.stringList({ required: false }),
    classLevels: t.intList({ required: false }),
    subjects: t.stringList({ required: false }),
    classTeachersOnly: t.boolean({ required: false }),
  }),
});

const GuardianFilterInput = builder.inputType("PopupGuardianFilterInput", {
  fields: (t) => ({
    classLevels: t.intList({ required: false }),
    sectionIds: t.stringList({ required: false }),
  }),
});

const AudienceInput = builder.inputType("PopupAudienceInput", {
  description: "staff filter ∪ guardian filter ∪ userIds (staff) ∪ studentIds (families by child).",
  fields: (t) => ({
    staff: t.field({ type: StaffFilterInput, required: false }),
    guardian: t.field({ type: GuardianFilterInput, required: false }),
    userIds: t.stringList({ required: false }),
    studentIds: t.stringList({ required: false }),
    excludeUserIds: t.stringList({ required: false, description: "Staff taken out with ✕, whatever matched them." }),
    excludeGuardianIds: t.stringList({ required: false, description: "Guardians taken out with ✕." }),
    excludeStudentIds: t.stringList({ required: false, description: "Families with no guardian row, taken out with ✕." }),
  }),
});

const RulesInput = builder.inputType("PopupRulesInput", {
  fields: (t) => ({
    autoCloseSec: t.int({ required: false }),
    closeButton: t.boolean({ required: false }),
    mustScrollToEnd: t.boolean({ required: false }),
    minReadSec: t.int({ required: false }),
    mustAct: t.boolean({ required: false }),
    allowSnooze: t.boolean({ required: false }),
    maxSnooze: t.int({ required: false }),
    allowAnswerChange: t.boolean({ required: false }),
  }),
});

const ActionInput = builder.inputType("PopupActionInput", {
  fields: (t) => ({
    kind: t.string({ required: true, description: "ACK | CHOICE | OPEN_SCREEN | OPEN_LINK" }),
    labelBn: t.string({ required: true }),
    labelEn: t.string({ required: false }),
    target: t.string({ required: false }),
  }),
});

const NoticeInput = builder.inputType("PopupNoticeInput", {
  fields: (t) => ({
    titleBn: t.string({ required: true }),
    bodyBn: t.string({ required: true }),
    titleEn: t.string({ required: false }),
    bodyEn: t.string({ required: false }),
    tone: t.string({ required: false }),
    attachmentUrl: t.string({ required: false }),
    audience: t.field({ type: AudienceInput, required: true }),
    audienceListId: t.string({ required: false }),
    rules: t.field({ type: RulesInput, required: true }),
    actions: t.field({ type: [ActionInput], required: true }),
    startsAt: t.string({ required: false, description: "ISO instant; empty = when sent." }),
    endsOn: t.string({ required: true, description: "YYYY-MM-DD (Asia/Dhaka), inclusive." }),
    repeat: t.string({ required: false, description: "once | daily (default) | every_open | window" }),
  }),
});

const EditLiveInput = builder.inputType("PopupEditLiveInput", {
  fields: (t) => ({
    titleBn: t.string({ required: true }),
    bodyBn: t.string({ required: true }),
    titleEn: t.string({ required: false }),
    bodyEn: t.string({ required: false }),
    tone: t.string({ required: false }),
    attachmentUrl: t.string({ required: false }),
    endsOn: t.string({ required: true }),
    actionLabelsBn: t.stringList({ required: false }),
    reshow: t.boolean({ required: false }),
  }),
});

const EventInput = builder.inputType("PopupEventInput", {
  fields: (t) => ({
    noticeId: t.string({ required: true }),
    kind: t.string({ required: true, description: "SEEN | READ | CLOSED | ACTED | SNOOZED" }),
    test: t.boolean({ required: false }),
    method: t.string({ required: false, description: "CLOSED: auto | button" }),
    choiceId: t.string({ required: false }),
    readMs: t.int({ required: false }),
    device: t.string({ required: false, description: "android | ios | web" }),
  }),
});

const authed = (ctx: { auth: unknown }) => {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
};

// ---------------------------------------------------------------------------
// Sender — reads
// ---------------------------------------------------------------------------

builder.queryField("popupNoticesPage", (t) =>
  t.field({
    type: PopupNoticePageRef,
    description: "Every pop-up notice, newest first (paged). status: DRAFT | PUBLISHED | WITHDRAWN to filter.",
    authScopes: { hasPermission: "popup_notice:view" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }), status: t.arg.string({ required: false }) },
    resolve: (_r, args) => popupNoticesPage({ page: args.page, pageSize: args.pageSize, status: args.status }),
  }),
);

builder.queryField("popupNotice", (t) =>
  t.field({
    type: PopupNoticeRef,
    authScopes: { hasPermission: "popup_notice:view" },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args) => popupNotice(args.id),
  }),
);

builder.queryField("popupNoticeReport", (t) =>
  t.field({
    type: PopupReportRef,
    authScopes: { hasPermission: "popup_notice:view" },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args) => popupNoticeReport(args.id),
  }),
);

builder.queryField("popupRecipientsPage", (t) =>
  t.field({
    type: PopupRecipientPageRef,
    description: "One notice's people (paged). filter: all | not_seen | not_done | done | unreachable | choice:<actionId>.",
    authScopes: { hasPermission: "popup_notice:view" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }), id: t.arg.string({ required: true }), filter: t.arg.string({ required: false }) },
    resolve: (_r, args) => popupRecipientsPage(args.id, args.filter, { page: args.page, pageSize: args.pageSize }),
  }),
);

builder.queryField("popupAudiencePreview", (t) =>
  t.field({
    type: AudiencePreviewRef,
    description: "Who an audience reaches right now — the composer's live count and name list.",
    authScopes: { hasPermission: "popup_notice:view" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }), audience: t.arg({ type: AudienceInput, required: true }) },
    resolve: (_r, args) => previewAudience(normalizeAudience(args.audience), { page: args.page, pageSize: args.pageSize }),
  }),
);

builder.queryField("searchPopupPeople", (t) =>
  t.field({
    type: PersonHitPageRef,
    description: "The custom-list picker: staff by name, families by child's name or school id.",
    authScopes: { hasPermission: "popup_notice:view" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }), query: t.arg.string({ required: true }) },
    resolve: (_r, args) => searchPopupPeople(args.query, { page: args.page, pageSize: args.pageSize }),
  }),
);

builder.queryField("popupPickedPeople", (t) =>
  t.field({
    type: [PersonHitRef],
    description: "Names for a custom list's hand-picked staff and families (bounded by the ids given).",
    authScopes: { hasPermission: "popup_notice:view" },
    args: { userIds: t.arg.stringList({ required: true }), studentIds: t.arg.stringList({ required: true }) },
    resolve: (_r, args) => pickedPeople(args.userIds, args.studentIds),
  }),
);

builder.queryField("popupAudienceListsPage", (t) =>
  t.field({
    type: AudienceListPageRef,
    authScopes: { hasPermission: "popup_notice:view" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, args) => popupAudienceListsPage({ page: args.page, pageSize: args.pageSize }),
  }),
);

// ---------------------------------------------------------------------------
// Sender — writes
// ---------------------------------------------------------------------------

builder.mutationField("savePopupDraft", (t) =>
  t.field({
    type: PopupNoticeRef,
    description: "Create (no id) or update a DRAFT. The audience is checked against send_staff / send_guardian.",
    authScopes: { hasAnyPermission: [...SEND] },
    args: { id: t.arg.string({ required: false }), input: t.arg({ type: NoticeInput, required: true }) },
    resolve: (_r, args, ctx) => {
      authed(ctx);
      return savePopupDraft(ctx, args.id, args.input);
    },
  }),
);

builder.mutationField("deletePopupDraft", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasAnyPermission: [...SEND] },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => {
      authed(ctx);
      return deletePopupDraft(ctx, args.id);
    },
  }),
);

builder.mutationField("publishPopupNotice", (t) =>
  t.field({
    type: PopupNoticeRef,
    description: "Send a draft: the audience is frozen into recipient rows and it shows from its start time.",
    authScopes: { hasAnyPermission: [...SEND] },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => {
      authed(ctx);
      return publishPopupNotice(ctx, args.id);
    },
  }),
);

builder.mutationField("editLivePopupNotice", (t) =>
  t.field({
    type: PopupNoticeRef,
    description: "Fix the words or end date of a sent notice. reshow: show it again to everyone.",
    authScopes: { hasAnyPermission: [...SEND] },
    args: { id: t.arg.string({ required: true }), input: t.arg({ type: EditLiveInput, required: true }) },
    resolve: (_r, args, ctx) => {
      authed(ctx);
      return editLiveNotice(ctx, args.id, args.input);
    },
  }),
);

builder.mutationField("withdrawPopupNotice", (t) =>
  t.field({
    type: PopupNoticeRef,
    authScopes: { hasAnyPermission: [...SEND] },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => {
      authed(ctx);
      return withdrawPopupNotice(ctx, args.id);
    },
  }),
);

builder.mutationField("duplicatePopupNotice", (t) =>
  t.field({
    type: PopupNoticeRef,
    authScopes: { hasAnyPermission: [...SEND] },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => {
      authed(ctx);
      return duplicatePopupNotice(ctx, args.id);
    },
  }),
);

builder.mutationField("sendPopupTestToMe", (t) =>
  t.field({
    type: "Boolean",
    description: "Show this notice to the sender alone on their next app open — never counted.",
    authScopes: { hasAnyPermission: [...SEND] },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => {
      authed(ctx);
      return sendPopupTestToMe(ctx, args.id);
    },
  }),
);

builder.mutationField("savePopupAudienceList", (t) =>
  t.field({
    type: AudienceListRef,
    authScopes: { hasAnyPermission: [...SEND] },
    args: { id: t.arg.string({ required: false }), name: t.arg.string({ required: true }), audience: t.arg({ type: AudienceInput, required: true }) },
    resolve: (_r, args, ctx) => {
      authed(ctx);
      return savePopupAudienceList(ctx, args.id, args.name, args.audience);
    },
  }),
);

builder.mutationField("deletePopupAudienceList", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasAnyPermission: [...SEND] },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => {
      authed(ctx);
      return deletePopupAudienceList(ctx, args.id);
    },
  }),
);

builder.mutationField("remindPopupNotice", (t) =>
  t.field({
    type: "Int",
    description: "Show it again on the next app open to everyone not done. Returns how many.",
    authScopes: { hasPermission: "popup_notice:follow_up" },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => {
      authed(ctx);
      return remindPopupNotice(ctx, args.id);
    },
  }),
);

builder.mutationField("addPopupMatches", (t) =>
  t.field({
    type: "Int",
    description: "Re-run the audience and add only the people not already on the list. Returns how many.",
    authScopes: { hasPermission: "popup_notice:follow_up" },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => {
      authed(ctx);
      return addPopupMatches(ctx, args.id);
    },
  }),
);

// ---------------------------------------------------------------------------
// Recipient (SELF — staff and guardians alike)
// ---------------------------------------------------------------------------

builder.queryField("myPopupQueue", (t) =>
  t.field({
    type: [PopupShowRef],
    description:
      "The pop-ups due on this app open, in show order (answer-required, then read-required, then at most " +
      "3 quick-info). Never throws: it is read inside the authenticated shell on every open (791e5fe rule).",
    authScopes: { authenticated: true },
    resolve: (_r, _a, ctx) => myPopupQueue(ctx),
  }),
);

builder.mutationField("recordPopupEvent", (t) =>
  t.field({
    type: PopupShowRef,
    nullable: true,
    description: "Record what happened to one pop-up on the caller's screen. Monotonic and cross-device.",
    authScopes: { authenticated: true },
    args: { input: t.arg({ type: EventInput, required: true }) },
    resolve: (_r, args, ctx) => recordPopupEvent(ctx, args.input),
  }),
);

builder.queryField("myPopupHistoryPage", (t) =>
  t.field({
    type: PopupHistoryPageRef,
    description: "আমার বার্তা — the pop-ups the caller received in the last 90 days (paged).",
    authScopes: { authenticated: true },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, args, ctx) => myPopupHistoryPage(ctx, { page: args.page, pageSize: args.pageSize }),
  }),
);
