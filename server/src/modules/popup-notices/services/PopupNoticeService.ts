/**
 * Pop-up notices (D-#852–#858, docs/prd-popup-notice.md).
 *
 * Sender side (Office / Principal, `popup_notice:*`):
 *   saveDraft → publish (audience frozen into recipient rows, D-#853) → editLive (content
 *   only) / withdraw / duplicate; report + per-person list + follow-ups (remind, add new
 *   matches, wa.me list); saved audience lists (D-#854).
 *
 * Recipient side (any signed-in staff member or guardian, SELF):
 *   `myPopupQueue` — what to show on this app open, in order (D-#855); `recordPopupEvent`
 *   — seen / read / closed / answered / snoozed, monotonic and cross-device;
 *   `myPopupHistoryPage` — আমার বার্তা, the re-read list.
 *
 * WHAT THE SERVER DECIDES AND WHAT THE APP DECIDES. The close rules (scroll to the end,
 * minimum time, must answer) are enforced on screen; the server cannot watch a thumb.
 * The server decides WHAT is due and records what happened, and it refuses the events a
 * rule makes impossible (closing an answer-required notice by ✕, an auto-close on a
 * locked one, a second answer when changes are off). That is enough for the report to
 * be honest without pretending the server saw the reading.
 *
 * Identity/operational plane; no corpus path (ADR-005).
 */
import { Types } from "mongoose";
import type { AppContext } from "../../../context";
import { callerHasPermission, type Permission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { pageOf, queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { normalizePhone } from "../../foundation/services/credentials";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import {
  PopupNotice,
  POPUP_ACTION_KINDS,
  POPUP_REPEATS,
  POPUP_TONES,
  type IPopupNotice,
  type PopupAction,
  type PopupAudience,
  type PopupRepeat,
  type PopupRules,
  type PopupStaffFilter,
  type PopupTone,
} from "../models/PopupNotice";
import {
  PopupNoticeRecipient,
  POPUP_STATE_RANK,
  type IPopupNoticeRecipient,
  type PopupCloseMethod,
  type PopupRecipientKind,
  type PopupRecipientVars,
  type PopupState,
} from "../models/PopupNoticeRecipient";
import { PopupAudienceList } from "../models/PopupAudienceList";
import {
  PopupNoticeError,
  audienceIsEmpty,
  audienceTouches,
  describeAudience,
  normalizeAudience,
  resolveAudience,
  type PopupAudienceInput,
} from "./PopupAudienceService";

export { PopupNoticeError } from "./PopupAudienceService";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ACTIONS = 3;
/** Quick-info notices shown on one app open (owner, 2026-10-26: three is right). */
export const QUICK_PER_OPEN = 3;
const HISTORY_DAYS = 90;
const DEVICE_KINDS = new Set(["android", "ios", "web"]);
const ROLE_FROM_BN: Record<string, string> = { PRINCIPAL: "প্রধান শিক্ষক", OFFICE: "অফিস", TEACHER: "শিক্ষক" };

const bn = (n: number | string): string => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

function addDays(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function oid(id: string, what = "বার্তা"): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new PopupNoticeError(`${what} পাওয়া যায়নি`);
  return new Types.ObjectId(id);
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/** Each half of the audience needs its own send action (D-#857): a sender switched on for
 *  staff only cannot reach a guardian by picking a family into the list. */
export function assertCanSendTo(ctx: AppContext, audience: PopupAudience): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const touches = audienceTouches(audience);
  const can = (p: Permission) => callerHasPermission(ctx.auth!, p);
  if (touches.staff && !can("popup_notice:send_staff")) {
    throw new ForbiddenError("কর্মীদের পপ-আপ পাঠানোর অনুমতি আপনার নেই");
  }
  if (touches.guardian && !can("popup_notice:send_guardian")) {
    throw new ForbiddenError("অভিভাবকদের পপ-আপ পাঠানোর অনুমতি আপনার নেই");
  }
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export interface PopupRulesInput {
  autoCloseSec?: number | null;
  closeButton?: boolean | null;
  mustScrollToEnd?: boolean | null;
  minReadSec?: number | null;
  mustAct?: boolean | null;
  allowSnooze?: boolean | null;
  maxSnooze?: number | null;
  allowAnswerChange?: boolean | null;
}

export interface PopupActionInput {
  kind: string;
  labelBn: string;
  labelEn?: string | null;
  target?: string | null;
}

export interface PopupNoticeInput {
  titleBn: string;
  bodyBn: string;
  titleEn?: string | null;
  bodyEn?: string | null;
  tone?: string | null;
  attachmentUrl?: string | null;
  audience: PopupAudienceInput;
  audienceListId?: string | null;
  rules: PopupRulesInput;
  actions: PopupActionInput[];
  /** ISO instant; empty = when published. */
  startsAt?: string | null;
  endsOn: string;
  repeat?: string | null;
}

const isHttps = (u: string) => /^https:\/\/\S+$/i.test(u);

/** The close rules, validated (PRD §5.3). Throws a Bangla PopupNoticeError. */
export function normalizeRules(input: PopupRulesInput, actionCount: number): PopupRules {
  const autoCloseSec = Math.floor(input.autoCloseSec ?? 0);
  const minReadSec = Math.floor(input.minReadSec ?? 0);
  const mustScrollToEnd = !!input.mustScrollToEnd;
  const mustAct = !!input.mustAct;
  const allowSnooze = !!input.allowSnooze;
  const maxSnooze = Math.floor(input.maxSnooze ?? 2);
  // An answer-required notice never shows ✕ — the only way out is an answer.
  const closeButton = mustAct ? false : input.closeButton !== false;

  if (autoCloseSec !== 0 && (autoCloseSec < 3 || autoCloseSec > 60)) throw new PopupNoticeError("নিজে বন্ধ হওয়ার সময় ৩ থেকে ৬০ সেকেন্ড হতে হবে");
  if (minReadSec !== 0 && (minReadSec < 5 || minReadSec > 300)) throw new PopupNoticeError("ন্যূনতম পড়ার সময় ৫ থেকে ৩০০ সেকেন্ড হতে হবে");
  if (autoCloseSec > 0 && (mustScrollToEnd || minReadSec > 0 || mustAct)) {
    throw new PopupNoticeError("নিজে বন্ধ হওয়া আর পড়া/উত্তরের শর্ত একসাথে চলবে না");
  }
  if (mustAct && actionCount === 0) throw new PopupNoticeError("“উত্তর না দিলে বন্ধ হবে না” চালু থাকলে অন্তত একটি বোতাম দিতে হবে");
  if (!closeButton && !mustAct && autoCloseSec === 0 && actionCount === 0) {
    throw new PopupNoticeError("বার্তাটি বন্ধ করার কোনো উপায় নেই — ✕ বোতাম, একটি উত্তর বোতাম অথবা নিজে বন্ধ হওয়া চালু করুন");
  }
  if (allowSnooze && (maxSnooze < 1 || maxSnooze > 5)) throw new PopupNoticeError("“পরে মনে করিয়ে দিন” ১ থেকে ৫ বার হতে পারে");
  return {
    autoCloseSec,
    closeButton,
    mustScrollToEnd,
    minReadSec,
    mustAct,
    allowSnooze,
    maxSnooze: allowSnooze ? maxSnooze : 2,
    allowAnswerChange: !!input.allowAnswerChange,
  };
}

export function normalizeActions(input: PopupActionInput[]): PopupAction[] {
  if (input.length > MAX_ACTIONS) throw new PopupNoticeError("সর্বোচ্চ ৩টি বোতাম দেওয়া যায়");
  return input.map((a, i) => {
    if (!(POPUP_ACTION_KINDS as readonly string[]).includes(a.kind)) throw new PopupNoticeError("বোতামের ধরন সঠিক নয়");
    const labelBn = (a.labelBn ?? "").trim();
    if (!labelBn) throw new PopupNoticeError("প্রতিটি বোতামের লেখা দিতে হবে");
    if (labelBn.length > 40) throw new PopupNoticeError("বোতামের লেখা ৪০ অক্ষরের মধ্যে রাখুন");
    const target = (a.target ?? "").trim();
    if (a.kind === "OPEN_LINK" && !isHttps(target)) throw new PopupNoticeError("লিংক বোতামের জন্য https:// দিয়ে শুরু হওয়া ঠিকানা দিন");
    if (a.kind === "OPEN_SCREEN" && !target) throw new PopupNoticeError("কোন পাতা খুলবে তা বাছাই করুন");
    return {
      id: `a${i + 1}`,
      kind: a.kind as PopupAction["kind"],
      labelBn,
      labelEn: (a.labelEn ?? "").trim(),
      target: a.kind === "OPEN_LINK" || a.kind === "OPEN_SCREEN" ? target : "",
    };
  });
}

interface NormalizedContent {
  titleBn: string;
  bodyBn: string;
  titleEn: string;
  bodyEn: string;
  tone: PopupTone;
  attachmentUrl: string;
}

function normalizeContent(input: {
  titleBn: string;
  bodyBn: string;
  titleEn?: string | null;
  bodyEn?: string | null;
  tone?: string | null;
  attachmentUrl?: string | null;
}): NormalizedContent {
  const titleBn = (input.titleBn ?? "").trim();
  const bodyBn = (input.bodyBn ?? "").trim();
  if (!titleBn) throw new PopupNoticeError("শিরোনাম দিতে হবে");
  if (titleBn.length > 80) throw new PopupNoticeError("শিরোনাম ৮০ অক্ষরের মধ্যে রাখুন");
  if (!bodyBn) throw new PopupNoticeError("বার্তা লিখতে হবে");
  if (bodyBn.length > 10000) throw new PopupNoticeError("বার্তা ১০,০০০ অক্ষরের মধ্যে রাখুন");
  const tone = (input.tone ?? "info") as PopupTone;
  if (!(POPUP_TONES as readonly string[]).includes(tone)) throw new PopupNoticeError("বার্তার ধরন সঠিক নয়");
  const attachmentUrl = (input.attachmentUrl ?? "").trim();
  if (attachmentUrl && !isHttps(attachmentUrl)) throw new PopupNoticeError("সংযুক্তির ঠিকানা https:// দিয়ে শুরু হতে হবে");
  return {
    titleBn,
    bodyBn,
    titleEn: (input.titleEn ?? "").trim(),
    bodyEn: (input.bodyEn ?? "").trim(),
    tone,
    attachmentUrl,
  };
}

function normalizeSchedule(input: { startsAt?: string | null; endsOn: string; repeat?: string | null }): {
  startsAt: Date | null;
  endsOn: string;
  repeat: PopupRepeat;
} {
  let startsAt: Date | null = null;
  if (input.startsAt) {
    const d = new Date(input.startsAt);
    if (Number.isNaN(d.getTime())) throw new PopupNoticeError("শুরুর সময় সঠিক নয়");
    startsAt = d;
  }
  if (!input.endsOn || !DATE_KEY.test(input.endsOn)) throw new PopupNoticeError("শেষের তারিখ YYYY-MM-DD আকারে দিন");
  if (startsAt && input.endsOn < dhakaDayKey(startsAt)) throw new PopupNoticeError("শেষের তারিখ শুরুর আগে হতে পারে না");
  const repeat = (input.repeat ?? "daily") as PopupRepeat;
  if (!(POPUP_REPEATS as readonly string[]).includes(repeat)) throw new PopupNoticeError("কতবার দেখাবে তা সঠিক নয়");
  return { startsAt, endsOn: input.endsOn, repeat };
}

// ---------------------------------------------------------------------------
// Personalisation (D-#854: a tailored message)
// ---------------------------------------------------------------------------

/** The merge fields a sender may write into a title or body. */
export const POPUP_MERGE_FIELDS = ["{নাম}", "{সন্তান}", "{শ্রেণি}"] as const;

/** Fill {নাম} / {সন্তান} / {শ্রেণি} (and their English aliases) for one recipient. */
export function personalize(text: string, vars: Pick<PopupRecipientVars, "name" | "childNames" | "classLabels">): string {
  if (!text) return text;
  const child = vars.childNames.join(" ও ");
  const cls = vars.classLabels.join(", ");
  return text
    .replace(/\{(নাম|name)\}/gi, vars.name)
    .replace(/\{(সন্তান|child)\}/gi, child)
    .replace(/\{(শ্রেণি|class)\}/gi, cls);
}

// ---------------------------------------------------------------------------
// Derived status
// ---------------------------------------------------------------------------

export type PopupDisplayStatus = "DRAFT" | "SCHEDULED" | "LIVE" | "ENDED" | "WITHDRAWN";

export function displayStatus(n: Pick<IPopupNotice, "status" | "startsAt" | "endsOn">, now = new Date()): PopupDisplayStatus {
  if (n.status === "DRAFT") return "DRAFT";
  if (n.status === "WITHDRAWN") return "WITHDRAWN";
  if (n.startsAt && n.startsAt.getTime() > now.getTime()) return "SCHEDULED";
  if (n.endsOn < dhakaDayKey(now)) return "ENDED";
  return "LIVE";
}

// ---------------------------------------------------------------------------
// Sender: notice CRUD
// ---------------------------------------------------------------------------

export interface PopupNoticeDTO {
  id: string;
  titleBn: string;
  bodyBn: string;
  titleEn: string;
  bodyEn: string;
  tone: string;
  attachmentUrl: string;
  audience: PopupAudienceDTO;
  audienceListId: string | null;
  audienceSummary: string;
  rules: PopupRules;
  actions: PopupAction[];
  startsAt: string | null;
  endsOn: string;
  repeat: string;
  status: string;
  displayStatus: PopupDisplayStatus;
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

export interface PopupAudienceDTO {
  staff: PopupStaffFilter | null;
  guardian: { classLevels: number[]; sectionIds: string[] } | null;
  userIds: string[];
  studentIds: string[];
}

export function audienceDTO(a: PopupAudience | undefined | null): PopupAudienceDTO {
  return {
    staff: a?.staff
      ? {
          roles: a.staff.roles ?? [],
          employment: a.staff.employment ?? "current",
          genders: a.staff.genders ?? [],
          classLevels: a.staff.classLevels ?? [],
          subjects: a.staff.subjects ?? [],
          classTeachersOnly: !!a.staff.classTeachersOnly,
        }
      : null,
    guardian: a?.guardian
      ? { classLevels: a.guardian.classLevels ?? [], sectionIds: (a.guardian.sectionIds ?? []).map(String) }
      : null,
    userIds: (a?.userIds ?? []).map(String),
    studentIds: (a?.studentIds ?? []).map(String),
  };
}

async function namesOf(ids: Array<Types.ObjectId | undefined | null>): Promise<Map<string, { name: string; role: string }>> {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (list.length === 0) return new Map();
  const users = (await User.find({ _id: { $in: list } }).select("name role").lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; role: string }>;
  return new Map(users.map((u) => [u._id.toString(), { name: u.name, role: u.role }]));
}

async function countsFor(noticeIds: Types.ObjectId[]): Promise<Map<string, { seen: number; done: number; acted: number }>> {
  if (noticeIds.length === 0) return new Map();
  const rows = (await PopupNoticeRecipient.aggregate([
    { $match: { noticeId: { $in: noticeIds }, test: false, reachable: true } },
    {
      $group: {
        _id: "$noticeId",
        seen: { $sum: { $cond: [{ $ne: ["$state", "NOT_SEEN"] }, 1, 0] } },
        done: { $sum: { $cond: [{ $ne: ["$doneAt", null] }, 1, 0] } },
        acted: { $sum: { $cond: [{ $eq: ["$state", "ACTED"] }, 1, 0] } },
      },
    },
  ])) as Array<{ _id: Types.ObjectId; seen: number; done: number; acted: number }>;
  return new Map(rows.map((r) => [r._id.toString(), { seen: r.seen, done: r.done, acted: r.acted }]));
}

function toDTO(
  n: IPopupNotice,
  names: Map<string, { name: string; role: string }>,
  counts: Map<string, { seen: number; done: number; acted: number }>,
  now: Date,
): PopupNoticeDTO {
  const c = counts.get(n._id.toString()) ?? { seen: 0, done: 0, acted: 0 };
  return {
    id: n._id.toString(),
    titleBn: n.titleBn,
    bodyBn: n.bodyBn,
    titleEn: n.titleEn ?? "",
    bodyEn: n.bodyEn ?? "",
    tone: n.tone,
    attachmentUrl: n.attachmentUrl ?? "",
    audience: audienceDTO(n.audience),
    audienceListId: n.audienceListId ? n.audienceListId.toString() : null,
    audienceSummary: n.audienceSummary ?? "",
    rules: n.rules,
    actions: n.actions ?? [],
    startsAt: n.startsAt ? n.startsAt.toISOString() : null,
    endsOn: n.endsOn,
    repeat: n.repeat,
    status: n.status,
    displayStatus: displayStatus(n, now),
    version: n.version ?? 1,
    recipientCount: n.recipientCount ?? 0,
    unreachableCount: n.unreachableCount ?? 0,
    seenCount: c.seen,
    doneCount: c.done,
    actedCount: c.acted,
    publishedAt: n.publishedAt ? n.publishedAt.toISOString() : null,
    createdByName: names.get(n.createdBy?.toString())?.name ?? "",
    publishedByName: n.publishedBy ? names.get(n.publishedBy.toString())?.name ?? "" : "",
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

async function loadDTO(n: IPopupNotice, now = new Date()): Promise<PopupNoticeDTO> {
  const [names, counts] = await Promise.all([namesOf([n.createdBy, n.publishedBy]), countsFor([n._id])]);
  return toDTO(n, names, counts, now);
}

async function mustFind(id: string): Promise<IPopupNotice> {
  const n = await PopupNotice.findById(oid(id));
  if (!n) throw new PopupNoticeError("বার্তাটি পাওয়া যায়নি");
  return n;
}

export async function popupNoticesPage(args: PageArgs & { status?: string | null } = {}, now = new Date()): Promise<Page<PopupNoticeDTO>> {
  const filter: Record<string, unknown> = {};
  if (args.status === "DRAFT" || args.status === "WITHDRAWN") filter.status = args.status;
  else if (args.status === "PUBLISHED") filter.status = "PUBLISHED";
  return queryPage(PopupNotice, filter, { createdAt: -1, _id: -1 }, args, async (docs) => {
    const list = docs as unknown as IPopupNotice[];
    const [names, counts] = await Promise.all([
      namesOf(list.flatMap((n) => [n.createdBy, n.publishedBy])),
      countsFor(list.map((n) => n._id)),
    ]);
    return list.map((n) => toDTO(n, names, counts, now));
  });
}

export async function popupNotice(id: string, now = new Date()): Promise<PopupNoticeDTO> {
  return loadDTO(await mustFind(id), now);
}

/** Create (id null) or update a DRAFT. A published notice changes through `editLiveNotice`. */
export async function savePopupDraft(ctx: AppContext, id: string | null | undefined, input: PopupNoticeInput): Promise<PopupNoticeDTO> {
  const content = normalizeContent(input);
  const audience = normalizeAudience(input.audience);
  const actions = normalizeActions(input.actions ?? []);
  const rules = normalizeRules(input.rules ?? {}, actions.length);
  const schedule = normalizeSchedule(input);
  assertCanSendTo(ctx, audience);
  const userId = new Types.ObjectId(ctx.auth!.userId);
  const audienceSummary = await describeAudience(audience);
  const audienceListId = input.audienceListId && Types.ObjectId.isValid(input.audienceListId) ? new Types.ObjectId(input.audienceListId) : undefined;
  const fields = { ...content, audience, audienceListId, audienceSummary, rules, actions, ...schedule, updatedBy: userId };

  if (!id) {
    const created = await PopupNotice.create({ ...fields, status: "DRAFT", createdBy: userId });
    return loadDTO(created);
  }
  const n = await mustFind(id);
  if (n.status !== "DRAFT") throw new PopupNoticeError("পাঠানো বার্তার প্রাপক বা আচরণ বদলানো যায় না — লেখা ঠিক করুন, অথবা বন্ধ করে কপি করুন");
  assertCanSendTo(ctx, n.audience);
  n.set(fields);
  await n.save();
  return loadDTO(n);
}

export async function deletePopupDraft(ctx: AppContext, id: string): Promise<boolean> {
  const n = await mustFind(id);
  if (n.status !== "DRAFT") throw new PopupNoticeError("শুধু খসড়া মুছে ফেলা যায়; পাঠানো বার্তা বন্ধ করুন");
  assertCanSendTo(ctx, n.audience);
  await Promise.all([PopupNotice.deleteOne({ _id: n._id }), PopupNoticeRecipient.deleteMany({ noticeId: n._id })]);
  return true;
}

function recipientDoc(noticeId: Types.ObjectId, r: { kind: PopupRecipientKind; id: Types.ObjectId; reachable: boolean; vars: PopupRecipientVars }, test = false) {
  return {
    noticeId,
    recipientKind: r.kind,
    recipientId: r.id,
    reachable: r.reachable,
    test,
    vars: r.vars,
    state: "NOT_SEEN" as PopupState,
    lastShownDayKey: "",
    showCount: 0,
    readMs: 0,
    snoozeCount: 0,
    pending: false,
    deviceKinds: [],
  };
}

/** DRAFT → PUBLISHED: the audience is resolved once and frozen into recipient rows (D-#853). */
export async function publishPopupNotice(ctx: AppContext, id: string, now = new Date()): Promise<PopupNoticeDTO> {
  const n = await mustFind(id);
  if (n.status !== "DRAFT") throw new PopupNoticeError("বার্তাটি আগেই পাঠানো হয়েছে");
  assertCanSendTo(ctx, n.audience);
  if (audienceIsEmpty(n.audience)) throw new PopupNoticeError("কাকে পাঠাবেন তা বাছাই করুন");
  if (n.endsOn < dhakaDayKey(now)) throw new PopupNoticeError("শেষের তারিখ পেরিয়ে গেছে — তারিখ বদলে আবার পাঠান");

  const resolved = await resolveAudience(n.audience, now);
  if (resolved.recipients.length === 0) throw new PopupNoticeError("এই প্রাপক-তালিকায় কেউ মেলেনি");

  // Claim the transition first, so a double tap cannot publish (and write rows) twice.
  const claimed = await PopupNotice.findOneAndUpdate(
    { _id: n._id, status: "DRAFT" },
    {
      $set: {
        status: "PUBLISHED",
        startsAt: n.startsAt ?? now,
        publishedAt: now,
        publishedBy: new Types.ObjectId(ctx.auth!.userId),
        recipientCount: resolved.recipients.length,
        unreachableCount: resolved.unreachableCount,
        updatedBy: new Types.ObjectId(ctx.auth!.userId),
      },
    },
    { new: true },
  );
  if (!claimed) throw new PopupNoticeError("বার্তাটি আগেই পাঠানো হয়েছে");
  await PopupNoticeRecipient.deleteMany({ noticeId: n._id, test: false });
  await PopupNoticeRecipient.insertMany(resolved.recipients.map((r) => recipientDoc(n._id, r)), { ordered: false });

  await writeAudit({
    eventKind: "POPUP_NOTICE_PUBLISHED",
    actorId: ctx.auth!.userId,
    actorRole: ctx.auth!.role,
    targetId: n._id,
    targetKind: "PopupNotice",
    meta: {
      titleBn: n.titleBn,
      audience: n.audienceSummary,
      recipients: resolved.recipients.length,
      unreachable: resolved.unreachableCount,
      startsAt: (n.startsAt ?? now).toISOString(),
      endsOn: n.endsOn,
    },
  });
  return loadDTO(claimed, now);
}

export interface EditLiveInput {
  titleBn: string;
  bodyBn: string;
  titleEn?: string | null;
  bodyEn?: string | null;
  tone?: string | null;
  attachmentUrl?: string | null;
  endsOn: string;
  /** New labels for the existing buttons, in order (kinds and targets stay). */
  actionLabelsBn?: string[] | null;
  /** "Show again to everyone (important change)" — un-done every row and bring it back. */
  reshow?: boolean | null;
}

/** Fix the words of a sent notice (PRD §9). Audience, rules and button kinds stay locked. */
export async function editLiveNotice(ctx: AppContext, id: string, input: EditLiveInput, now = new Date()): Promise<PopupNoticeDTO> {
  const n = await mustFind(id);
  if (n.status !== "PUBLISHED") throw new PopupNoticeError("শুধু পাঠানো বার্তার লেখা এভাবে ঠিক করা যায়");
  assertCanSendTo(ctx, n.audience);
  const content = normalizeContent(input);
  if (!input.endsOn || !DATE_KEY.test(input.endsOn)) throw new PopupNoticeError("শেষের তারিখ YYYY-MM-DD আকারে দিন");
  if (n.startsAt && input.endsOn < dhakaDayKey(n.startsAt)) throw new PopupNoticeError("শেষের তারিখ শুরুর আগে হতে পারে না");
  const labels = input.actionLabelsBn ?? n.actions.map((a) => a.labelBn);
  if (labels.length !== n.actions.length) throw new PopupNoticeError("বোতামের সংখ্যা বদলানো যায় না");
  const actions = n.actions.map((a, i) => {
    const labelBn = (labels[i] ?? "").trim();
    if (!labelBn) throw new PopupNoticeError("প্রতিটি বোতামের লেখা দিতে হবে");
    return { id: a.id, kind: a.kind, labelBn, labelEn: a.labelEn, target: a.target };
  });
  const before = { titleBn: n.titleBn, bodyBn: n.bodyBn, endsOn: n.endsOn };
  n.set({ ...content, endsOn: input.endsOn, actions, version: (n.version ?? 1) + 1, updatedBy: new Types.ObjectId(ctx.auth!.userId) });
  await n.save();
  if (input.reshow) {
    await PopupNoticeRecipient.updateMany(
      { noticeId: n._id, test: false, reachable: true },
      { $set: { doneAt: null, pending: true, closeMethod: null } },
    );
  }
  await writeAudit({
    eventKind: "POPUP_NOTICE_EDITED",
    actorId: ctx.auth!.userId,
    actorRole: ctx.auth!.role,
    targetId: n._id,
    targetKind: "PopupNotice",
    meta: { before, after: { titleBn: n.titleBn, bodyBn: n.bodyBn, endsOn: n.endsOn }, version: n.version, reshow: !!input.reshow },
  });
  return loadDTO(n, now);
}

export async function withdrawPopupNotice(ctx: AppContext, id: string, now = new Date()): Promise<PopupNoticeDTO> {
  const n = await mustFind(id);
  if (n.status !== "PUBLISHED") throw new PopupNoticeError("শুধু পাঠানো বার্তা বন্ধ করা যায়");
  assertCanSendTo(ctx, n.audience);
  n.set({ status: "WITHDRAWN", withdrawnAt: now, withdrawnBy: new Types.ObjectId(ctx.auth!.userId), updatedBy: new Types.ObjectId(ctx.auth!.userId) });
  await n.save();
  await writeAudit({
    eventKind: "POPUP_NOTICE_WITHDRAWN",
    actorId: ctx.auth!.userId,
    actorRole: ctx.auth!.role,
    targetId: n._id,
    targetKind: "PopupNotice",
    meta: { titleBn: n.titleBn },
  });
  return loadDTO(n, now);
}

/** A new DRAFT carrying everything but the schedule (PRD §9 — "same notice to KG next week"). */
export async function duplicatePopupNotice(ctx: AppContext, id: string, now = new Date()): Promise<PopupNoticeDTO> {
  const n = await mustFind(id);
  assertCanSendTo(ctx, n.audience);
  const userId = new Types.ObjectId(ctx.auth!.userId);
  const today = dhakaDayKey(now);
  const created = await PopupNotice.create({
    titleBn: n.titleBn,
    bodyBn: n.bodyBn,
    titleEn: n.titleEn,
    bodyEn: n.bodyEn,
    tone: n.tone,
    attachmentUrl: n.attachmentUrl,
    audience: n.audience,
    audienceListId: n.audienceListId,
    audienceSummary: n.audienceSummary,
    rules: n.rules,
    actions: n.actions,
    startsAt: null,
    endsOn: addDays(today, 7),
    repeat: n.repeat,
    status: "DRAFT",
    createdBy: userId,
    updatedBy: userId,
  });
  return loadDTO(created, now);
}

/** "আমাকে আগে পাঠান": a test row for the sender alone, never counted (S-15). */
export async function sendPopupTestToMe(ctx: AppContext, id: string): Promise<boolean> {
  const n = await mustFind(id);
  if (n.status === "WITHDRAWN") throw new PopupNoticeError("বন্ধ করা বার্তা পরীক্ষা করা যায় না");
  assertCanSendTo(ctx, n.audience);
  const me = (await User.findById(ctx.auth!.userId).select("name role phone").lean()) as { _id: Types.ObjectId; name: string; role: string; phone?: string } | null;
  if (!me) throw new ForbiddenError("Unauthenticated");
  const vars: PopupRecipientVars = {
    name: me.name,
    // Sample values, so a sender sees how the merge fields will read for a guardian.
    childNames: ["(সন্তানের নাম)"],
    classLabels: ["(শ্রেণি)"],
    group: ROLE_FROM_BN[me.role] ?? me.role,
    phone: me.phone ?? "",
  };
  await PopupNoticeRecipient.findOneAndUpdate(
    { noticeId: n._id, recipientKind: "USER", recipientId: me._id, test: true },
    { $set: { ...recipientDoc(n._id, { kind: "USER", id: me._id, reachable: true, vars }, true), doneAt: null, closeMethod: null, choiceId: null, actedAt: null, readAt: null, firstSeenAt: null, lastSeenAt: null } },
    { upsert: true },
  );
  return true;
}

// ---------------------------------------------------------------------------
// Recipient: the queue + events + history
// ---------------------------------------------------------------------------

function meOf(ctx: AppContext): { kind: PopupRecipientKind; id: Types.ObjectId } | null {
  if (!ctx.auth || !Types.ObjectId.isValid(ctx.auth.userId)) return null;
  return { kind: ctx.auth.role === "GUARDIAN" ? "GUARDIAN" : "USER", id: new Types.ObjectId(ctx.auth.userId) };
}

/** Is this row due on this app open? (PRD §7) */
export function isDue(repeat: PopupRepeat, r: Pick<IPopupNoticeRecipient, "pending" | "doneAt" | "lastShownDayKey" | "showCount" | "test">, todayKey: string): boolean {
  if (r.test) return !r.doneAt;
  if (r.pending) return true;
  if (repeat === "window") return r.lastShownDayKey !== todayKey;
  if (r.doneAt) return false;
  if (repeat === "every_open") return true;
  if (repeat === "daily") return r.lastShownDayKey !== todayKey;
  return r.showCount === 0; // once
}

/** 0 must answer · 1 must read · 2 quick info — the queue order (PRD §5.4). */
export function priorityOf(rules: PopupRules): number {
  if (rules.mustAct) return 0;
  if (rules.mustScrollToEnd || rules.minReadSec > 0) return 1;
  return 2;
}

export interface PopupShow {
  noticeId: string;
  version: number;
  test: boolean;
  titleBn: string;
  bodyBn: string;
  titleEn: string;
  bodyEn: string;
  tone: string;
  attachmentUrl: string;
  fromLabel: string;
  rules: PopupRules;
  actions: PopupAction[];
  state: PopupState;
  choiceId: string | null;
  snoozeCount: number;
  canChangeAnswer: boolean;
  todayKey: string;
}

function showOf(n: IPopupNotice, r: IPopupNoticeRecipient, fromLabel: string, todayKey: string, now: Date): PopupShow {
  const live = n.status === "PUBLISHED" && displayStatus(n, now) === "LIVE";
  return {
    noticeId: n._id.toString(),
    version: n.version ?? 1,
    test: !!r.test,
    titleBn: personalize(n.titleBn, r.vars),
    bodyBn: personalize(n.bodyBn, r.vars),
    titleEn: personalize(n.titleEn ?? "", r.vars),
    bodyEn: personalize(n.bodyEn ?? "", r.vars),
    tone: n.tone,
    attachmentUrl: n.attachmentUrl ?? "",
    fromLabel,
    rules: n.rules,
    actions: n.actions ?? [],
    state: r.state,
    choiceId: r.choiceId ?? null,
    snoozeCount: r.snoozeCount ?? 0,
    canChangeAnswer: (live || !!r.test) && !!n.rules.allowAnswerChange && (n.actions ?? []).some((a) => a.kind === "CHOICE"),
    todayKey,
  };
}

/**
 * What to show on this app open, in order (D-#855). Never throws — it is read inside the
 * authenticated shell on every open, so a failure must render nothing (the 791e5fe rule).
 */
export async function myPopupQueue(ctx: AppContext, now = new Date()): Promise<PopupShow[]> {
  const me = meOf(ctx);
  if (!me) return [];
  const todayKey = dhakaDayKey(now);
  try {
    const live = (await PopupNotice.find({ status: "PUBLISHED", endsOn: { $gte: todayKey }, startsAt: { $lte: now } }).lean()) as unknown as IPopupNotice[];
    const rows = (await PopupNoticeRecipient.find({
      recipientKind: me.kind,
      recipientId: me.id,
      reachable: true,
      $or: [{ test: false, noticeId: { $in: live.map((n) => n._id) } }, { test: true, doneAt: null }],
    }).lean()) as unknown as IPopupNoticeRecipient[];
    if (rows.length === 0) return [];

    const byId = new Map(live.map((n) => [n._id.toString(), n]));
    const testIds = rows.filter((r) => r.test && !byId.has(r.noticeId.toString())).map((r) => r.noticeId);
    if (testIds.length) {
      const extra = (await PopupNotice.find({ _id: { $in: testIds }, status: { $ne: "WITHDRAWN" } }).lean()) as unknown as IPopupNotice[];
      for (const n of extra) byId.set(n._id.toString(), n);
    }
    const senders = await namesOf([...byId.values()].map((n) => n.publishedBy ?? n.createdBy));

    const due = rows
      .map((r) => ({ r, n: byId.get(r.noticeId.toString()) }))
      .filter((x): x is { r: IPopupNoticeRecipient; n: IPopupNotice } => !!x.n && isDue(x.n.repeat, x.r, todayKey))
      .sort(
        (a, b) =>
          priorityOf(a.n.rules) - priorityOf(b.n.rules) ||
          (a.n.publishedAt ?? a.n.createdAt).getTime() - (b.n.publishedAt ?? b.n.createdAt).getTime() ||
          a.n._id.toString().localeCompare(b.n._id.toString()),
      );
    let quick = 0;
    const out: PopupShow[] = [];
    for (const { r, n } of due) {
      if (priorityOf(n.rules) === 2) {
        if (quick >= QUICK_PER_OPEN) continue;
        quick += 1;
      }
      const sender = senders.get((n.publishedBy ?? n.createdBy).toString());
      out.push(showOf(n, r, sender ? ROLE_FROM_BN[sender.role] ?? sender.name : "", todayKey, now));
    }
    return out;
  } catch (err) {
    console.error("myPopupQueue read failed — showing nothing:", err);
    return [];
  }
}

export const POPUP_EVENT_KINDS = ["SEEN", "READ", "CLOSED", "ACTED", "SNOOZED"] as const;
export type PopupEventKind = (typeof POPUP_EVENT_KINDS)[number];

export interface PopupEventInput {
  noticeId: string;
  kind: string;
  test?: boolean | null;
  /** CLOSED: "auto" | "button". */
  method?: string | null;
  choiceId?: string | null;
  readMs?: number | null;
  device?: string | null;
}

const maxState = (a: PopupState, b: PopupState): PopupState => (POPUP_STATE_RANK[b] > POPUP_STATE_RANK[a] ? b : a);

/** Record one thing that happened to a pop-up on this person's screen. Monotonic, idempotent. */
export async function recordPopupEvent(ctx: AppContext, input: PopupEventInput, now = new Date()): Promise<PopupShow | null> {
  const me = meOf(ctx);
  if (!me) throw new ForbiddenError("Unauthenticated");
  if (!(POPUP_EVENT_KINDS as readonly string[]).includes(input.kind)) throw new PopupNoticeError("অজানা ঘটনা");
  const noticeId = oid(input.noticeId);
  const r = await PopupNoticeRecipient.findOne({ noticeId, recipientKind: me.kind, recipientId: me.id, test: !!input.test });
  if (!r || !r.reachable) throw new PopupNoticeError("বার্তাটি আপনার জন্য নয়");
  const n = await PopupNotice.findById(noticeId);
  if (!n || n.status === "WITHDRAWN" || (n.status === "DRAFT" && !r.test)) throw new PopupNoticeError("বার্তাটি আর চলছে না");
  const todayKey = dhakaDayKey(now);
  const live = n.status === "PUBLISHED" && displayStatus(n, now) === "LIVE";

  const set: Record<string, unknown> = {};
  const inc: Record<string, number> = {};
  let state: PopupState = r.state;
  if (input.readMs && input.readMs > (r.readMs ?? 0)) set.readMs = Math.min(Math.floor(input.readMs), 24 * 3600 * 1000);
  const device = (input.device ?? "").toLowerCase();
  const addDevice = DEVICE_KINDS.has(device) ? device : null;

  switch (input.kind as PopupEventKind) {
    case "SEEN":
      inc.showCount = 1;
      set.lastSeenAt = now;
      set.lastShownDayKey = todayKey;
      set.pending = false;
      if (!r.firstSeenAt) set.firstSeenAt = now;
      state = maxState(state, "SEEN");
      break;
    case "READ":
      state = maxState(state, "READ");
      if (!r.readAt) set.readAt = now;
      break;
    case "CLOSED": {
      const method = input.method === "auto" ? "auto" : "button";
      if (n.rules.mustAct) throw new PopupNoticeError("উত্তর না দিয়ে বার্তাটি বন্ধ করা যাবে না");
      if (method === "auto" && (n.rules.mustScrollToEnd || n.rules.minReadSec > 0 || !n.rules.autoCloseSec)) {
        throw new PopupNoticeError("এই বার্তা নিজে বন্ধ হয় না");
      }
      if (method === "button" && !n.rules.closeButton) throw new PopupNoticeError("এই বার্তা বন্ধ করার বোতাম নেই");
      state = maxState(state, method === "button" ? "READ" : "SEEN");
      if (method === "button" && !r.readAt) set.readAt = now;
      if (!r.doneAt) set.doneAt = now;
      set.closeMethod = method as PopupCloseMethod;
      set.pending = false;
      break;
    }
    case "ACTED": {
      const action = (n.actions ?? []).find((a) => a.id === input.choiceId);
      if (!action) throw new PopupNoticeError("এই উত্তরটি বার্তায় নেই");
      if (r.choiceId && r.choiceId !== action.id) {
        const mayChange = (live || r.test) && n.rules.allowAnswerChange;
        if (!mayChange) throw new PopupNoticeError("উত্তর আর বদলানো যাবে না");
      }
      state = "ACTED";
      set.choiceId = action.id;
      set.actedAt = now;
      if (!r.readAt) set.readAt = now;
      if (!r.doneAt) set.doneAt = now;
      set.closeMethod = "action";
      set.pending = false;
      break;
    }
    case "SNOOZED":
      if (!n.rules.allowSnooze) throw new PopupNoticeError("এই বার্তা পরে দেখার সুযোগ নেই");
      if ((r.snoozeCount ?? 0) >= n.rules.maxSnooze) throw new PopupNoticeError("আর পরে দেখার সুযোগ নেই — এখনই পড়ুন");
      inc.snoozeCount = 1;
      set.pending = true;
      break;
  }
  set.state = state;
  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(inc).length) update.$inc = inc;
  if (addDevice) update.$addToSet = { deviceKinds: addDevice };
  const saved = await PopupNoticeRecipient.findOneAndUpdate({ _id: r._id }, update, { new: true });

  if (input.kind === "ACTED" && !r.test && r.choiceId !== input.choiceId) {
    await writeAudit({
      eventKind: "POPUP_NOTICE_ANSWERED",
      actorId: me.id,
      actorRole: ctx.auth!.role,
      targetId: n._id,
      targetKind: "PopupNotice",
      meta: { choiceId: input.choiceId, previous: r.choiceId ?? null },
    });
  }
  const sender = (await namesOf([n.publishedBy ?? n.createdBy])).get((n.publishedBy ?? n.createdBy).toString());
  return saved ? showOf(n, saved, sender ? ROLE_FROM_BN[sender.role] ?? sender.name : "", todayKey, now) : null;
}

export interface PopupHistoryRow {
  show: PopupShow;
  publishedAt: string | null;
  choiceLabel: string;
  live: boolean;
}

/** আমার বার্তা — what I received in the last 90 days, newest first (PRD §8.3). */
export async function myPopupHistoryPage(ctx: AppContext, args: PageArgs = {}, now = new Date()): Promise<Page<PopupHistoryRow>> {
  const me = meOf(ctx);
  if (!me) return pageOf([], args);
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const notices = (await PopupNotice.find({ status: "PUBLISHED", publishedAt: { $gte: since }, startsAt: { $lte: now } })
    .select("_id")
    .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  const todayKey = dhakaDayKey(now);
  return queryPage(
    PopupNoticeRecipient,
    { recipientKind: me.kind, recipientId: me.id, test: false, reachable: true, noticeId: { $in: notices.map((x) => x._id) } },
    { createdAt: -1, _id: -1 },
    args,
    async (docs) => {
      const rows = docs as unknown as IPopupNoticeRecipient[];
      const ns = (await PopupNotice.find({ _id: { $in: rows.map((r) => r.noticeId) } }).lean()) as unknown as IPopupNotice[];
      const byId = new Map(ns.map((n) => [n._id.toString(), n]));
      const senders = await namesOf(ns.map((n) => n.publishedBy ?? n.createdBy));
      return rows.flatMap((r) => {
        const n = byId.get(r.noticeId.toString());
        if (!n) return [];
        const sender = senders.get((n.publishedBy ?? n.createdBy).toString());
        const show = showOf(n, r, sender ? ROLE_FROM_BN[sender.role] ?? sender.name : "", todayKey, now);
        return [{
          show,
          publishedAt: n.publishedAt ? n.publishedAt.toISOString() : null,
          choiceLabel: (n.actions ?? []).find((a) => a.id === r.choiceId)?.labelBn ?? "",
          live: displayStatus(n, now) === "LIVE",
        }];
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Sender: report + per-person list + follow-ups
// ---------------------------------------------------------------------------

export interface PopupReportGroup {
  group: string;
  reachable: number;
  seen: number;
  read: number;
  acted: number;
  done: number;
}

export interface PopupReport {
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
  groups: PopupReportGroup[];
}

type RecipientLean = Pick<IPopupNoticeRecipient, "state" | "doneAt" | "reachable" | "choiceId" | "vars">;

export async function popupNoticeReport(id: string): Promise<PopupReport> {
  const n = await mustFind(id);
  const rows = (await PopupNoticeRecipient.find({ noticeId: n._id, test: false })
    .select("state doneAt reachable choiceId vars.group")
    .lean()) as unknown as RecipientLean[];
  const reach = rows.filter((r) => r.reachable);
  const atLeast = (r: RecipientLean, s: PopupState) => POPUP_STATE_RANK[r.state] >= POPUP_STATE_RANK[s];
  const groups = new Map<string, PopupReportGroup>();
  for (const r of reach) {
    const key = r.vars?.group || "—";
    const g = groups.get(key) ?? { group: key, reachable: 0, seen: 0, read: 0, acted: 0, done: 0 };
    g.reachable += 1;
    if (atLeast(r, "SEEN")) g.seen += 1;
    if (atLeast(r, "READ")) g.read += 1;
    if (r.state === "ACTED") g.acted += 1;
    if (r.doneAt) g.done += 1;
    groups.set(key, g);
  }
  return {
    noticeId: n._id.toString(),
    recipients: rows.length,
    reachable: reach.length,
    unreachable: rows.length - reach.length,
    seen: reach.filter((r) => atLeast(r, "SEEN")).length,
    read: reach.filter((r) => atLeast(r, "READ")).length,
    acted: reach.filter((r) => r.state === "ACTED").length,
    done: reach.filter((r) => !!r.doneAt).length,
    notSeen: reach.filter((r) => r.state === "NOT_SEEN").length,
    choices: (n.actions ?? [])
      .filter((a) => a.kind === "CHOICE" || a.kind === "ACK")
      .map((a) => ({ id: a.id, label: a.labelBn, count: reach.filter((r) => r.choiceId === a.id).length })),
    groups: [...groups.values()].sort((a, b) => a.group.localeCompare(b.group)),
  };
}

export const POPUP_RECIPIENT_FILTERS = ["all", "not_seen", "not_done", "done", "unreachable"] as const;

export interface PopupRecipientRow {
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
  /** A ready wa.me link with this person's own (personalised) text; empty with no phone. */
  waLink: string;
}

/** WhatsApp text for one person (ADR-003): the personalised title + body, plain. */
function waLinkFor(n: IPopupNotice, r: IPopupNoticeRecipient): string {
  const phone = r.vars?.phone ? normalizePhone(r.vars.phone) : "";
  if (!phone) return "";
  const body = personalize(n.bodyBn, r.vars).replace(/\*\*(.+?)\*\*/g, "*$1*");
  const msg = `আসসালামু আলাইকুম।\n*${personalize(n.titleBn, r.vars)}*\n\n${body}\n\n— SCD`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

/** One notice's people, filtered by progress (paged, D-#761). Choice filter: `choice:<id>`. */
export async function popupRecipientsPage(id: string, filter: string | null | undefined, args: PageArgs = {}): Promise<Page<PopupRecipientRow>> {
  const n = await mustFind(id);
  const q: Record<string, unknown> = { noticeId: n._id, test: false };
  const f = filter ?? "all";
  if (f === "not_seen") Object.assign(q, { reachable: true, state: "NOT_SEEN" });
  else if (f === "not_done") Object.assign(q, { reachable: true, doneAt: null });
  else if (f === "done") Object.assign(q, { reachable: true, doneAt: { $ne: null } });
  else if (f === "unreachable") Object.assign(q, { reachable: false });
  else if (f.startsWith("choice:")) Object.assign(q, { reachable: true, choiceId: f.slice(7) });
  const labelOf = new Map((n.actions ?? []).map((a) => [a.id, a.labelBn]));
  return queryPage(PopupNoticeRecipient, q, { "vars.group": 1, "vars.name": 1, _id: 1 }, args, (docs) =>
    (docs as unknown as IPopupNoticeRecipient[]).map((r) => ({
      id: r.recipientId.toString(),
      kind: r.recipientKind,
      name: r.vars?.name ?? "",
      detail: r.recipientKind === "USER" ? r.vars?.group ?? "" : (r.vars?.childNames ?? []).join(", "),
      group: r.vars?.group ?? "",
      reachable: r.reachable,
      state: r.state,
      done: !!r.doneAt,
      closeMethod: r.closeMethod ?? "",
      choiceLabel: r.choiceId ? labelOf.get(r.choiceId) ?? "" : "",
      lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
      showCount: r.showCount ?? 0,
      readMs: r.readMs ?? 0,
      deviceKinds: r.deviceKinds ?? [],
      phone: r.vars?.phone ?? "",
      waLink: waLinkFor(n, r),
    })),
  );
}

/** "বাকিদের আবার দেখান": everyone reachable and not done sees it on the next open. */
export async function remindPopupNotice(ctx: AppContext, id: string): Promise<number> {
  const n = await mustFind(id);
  if (n.status !== "PUBLISHED") throw new PopupNoticeError("শুধু চলমান বার্তার জন্য মনে করানো যায়");
  const res = await PopupNoticeRecipient.updateMany({ noticeId: n._id, test: false, reachable: true, doneAt: null }, { $set: { pending: true } });
  await writeAudit({
    eventKind: "POPUP_NOTICE_FOLLOW_UP",
    actorId: ctx.auth!.userId,
    actorRole: ctx.auth!.role,
    targetId: n._id,
    targetKind: "PopupNotice",
    meta: { action: "remind", count: res.modifiedCount },
  });
  return res.modifiedCount;
}

/** "নতুন যারা মেলে, যোগ করুন": re-run the audience and add only people not on the list (D-#853). */
export async function addPopupMatches(ctx: AppContext, id: string, now = new Date()): Promise<number> {
  const n = await mustFind(id);
  if (n.status !== "PUBLISHED") throw new PopupNoticeError("শুধু চলমান বার্তায় নতুন প্রাপক যোগ করা যায়");
  assertCanSendTo(ctx, n.audience);
  const resolved = await resolveAudience(n.audience, now);
  const existing = (await PopupNoticeRecipient.find({ noticeId: n._id, test: false }).select("recipientKind recipientId").lean()) as unknown as Array<{ recipientKind: string; recipientId: Types.ObjectId }>;
  const have = new Set(existing.map((e) => `${e.recipientKind}:${e.recipientId.toString()}`));
  const fresh = resolved.recipients.filter((r) => !have.has(`${r.kind}:${r.id.toString()}`));
  if (fresh.length) {
    await PopupNoticeRecipient.insertMany(fresh.map((r) => recipientDoc(n._id, r)), { ordered: false });
    const all = existing.length + fresh.length;
    const unreachable = await PopupNoticeRecipient.countDocuments({ noticeId: n._id, test: false, reachable: false });
    await PopupNotice.updateOne({ _id: n._id }, { $set: { recipientCount: all, unreachableCount: unreachable } });
  }
  await writeAudit({
    eventKind: "POPUP_NOTICE_FOLLOW_UP",
    actorId: ctx.auth!.userId,
    actorRole: ctx.auth!.role,
    targetId: n._id,
    targetKind: "PopupNotice",
    meta: { action: "add_matches", count: fresh.length },
  });
  return fresh.length;
}

// ---------------------------------------------------------------------------
// Saved audience lists (D-#854)
// ---------------------------------------------------------------------------

export interface PopupAudienceListDTO {
  id: string;
  name: string;
  audience: PopupAudienceDTO;
  summary: string;
  updatedAt: string;
}

export async function popupAudienceListsPage(args: PageArgs = {}): Promise<Page<PopupAudienceListDTO>> {
  return queryPage(PopupAudienceList, { active: true }, { name: 1, _id: 1 }, args, async (docs) =>
    Promise.all(
      (docs as unknown as Array<{ _id: Types.ObjectId; name: string; audience: PopupAudience; updatedAt: Date }>).map(async (l) => ({
        id: l._id.toString(),
        name: l.name,
        audience: audienceDTO(l.audience),
        summary: await describeAudience(l.audience),
        updatedAt: l.updatedAt.toISOString(),
      })),
    ),
  );
}

export async function savePopupAudienceList(ctx: AppContext, id: string | null | undefined, name: string, input: PopupAudienceInput): Promise<PopupAudienceListDTO> {
  const clean = (name ?? "").trim();
  if (!clean) throw new PopupNoticeError("তালিকার নাম দিন");
  if (clean.length > 60) throw new PopupNoticeError("তালিকার নাম ৬০ অক্ষরের মধ্যে রাখুন");
  const audience = normalizeAudience(input);
  if (audienceIsEmpty(audience)) throw new PopupNoticeError("তালিকায় অন্তত একজন বা একটি ফিল্টার রাখুন");
  assertCanSendTo(ctx, audience);
  const userId = new Types.ObjectId(ctx.auth!.userId);
  let doc;
  if (id) {
    doc = await PopupAudienceList.findOneAndUpdate({ _id: oid(id, "তালিকা"), active: true }, { $set: { name: clean, audience, updatedBy: userId } }, { new: true });
    if (!doc) throw new PopupNoticeError("তালিকাটি পাওয়া যায়নি");
  } else {
    doc = await PopupAudienceList.create({ name: clean, audience, createdBy: userId, updatedBy: userId });
  }
  return { id: doc._id.toString(), name: doc.name, audience: audienceDTO(doc.audience), summary: await describeAudience(doc.audience), updatedAt: doc.updatedAt.toISOString() };
}

export async function deletePopupAudienceList(ctx: AppContext, id: string): Promise<boolean> {
  const doc = await PopupAudienceList.findOne({ _id: oid(id, "তালিকা"), active: true });
  if (!doc) throw new PopupNoticeError("তালিকাটি পাওয়া যায়নি");
  assertCanSendTo(ctx, doc.audience);
  doc.set({ active: false, updatedBy: new Types.ObjectId(ctx.auth!.userId) });
  await doc.save();
  return true;
}
