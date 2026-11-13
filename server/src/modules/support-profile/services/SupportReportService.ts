/**
 * Continuous intake (docs/prd-child-support-profile.md §6.9, D-#1582) — NO AI runs here.
 *
 * At save, deterministic checks only: (1) required fields incl. the good thing (OA-2, D-#1583);
 * (2) the word lists (a block-list word refuses the save; an ask-list word is noted, S-1); (3) another
 * child's name (roster matcher) refuses the save (S-6); (4) the safeguarding sign list opens the
 * question before saving (§16.5 SG-4); (5) the date window, the draft limit, the field sizes.
 * The report waits as TO_PROCESS; its author sees it at once as pending. The Principal may decide a
 * waiting report directly with no AI (§6.7, `checkSkipped: DECIDED_DIRECTLY`).
 */
import { Types } from "mongoose";
import {
  SUPPORT_ANTECEDENTS,
  SUPPORT_CONTEXTS,
  SUPPORT_FIELD_LIMITS,
  SUPPORT_FUNCTIONS,
  SUPPORT_GOOD_NONE_REASONS,
  SUPPORT_HOW_OFTEN,
  SUPPORT_REPORT_SOURCES,
  SUPPORT_RESULTS,
  SUPPORT_STARTER_KEYS,
  SUPPORT_THRESHOLDS,
  SUPPORT_TONES,
  SUPPORT_EDITABLE_STATUSES,
  SUPPORT_DECIDABLE_STATUSES,
  daysBetweenKeys,
  scanSafeguarding,
  scanSupportTerms,
  type SafeguardingSign,
  type SupportReportStatus,
  type SupportTermHit,
} from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { writeAudit } from "../../platform/services/AuditService";
import { deidentify } from "../../platform/ai/deidentify";
import { scopeForStudent } from "../../platform/services/DeidScopeService";
import { raiseReferral } from "../../platform/safeguarding/SafeguardingService";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { SupportProfile } from "../models/SupportProfile";
import { SupportReport, type ISupportReport, type SupportTexts } from "../models/SupportReport";
import { SupportReview } from "../models/SupportReview";
import { SupportProfileRefusal } from "./errors";
import { accessToChild, holdsApprove, holdsViewAll, supportCaller, type SupportCtx } from "./supportAccess";
import { notifyHolders, notifyUser } from "./supportNotify";
import { readerOf } from "./supportScope";

export interface SupportReportInput {
  studentId: string;
  source?: string | null;
  seedCommentId?: string | null;
  occurredOn: string;
  groupType?: string | null;
  groupId?: string | null;
  subject?: string | null;
  periodNo?: number | null;
  context?: string | null;
  antecedentTags?: string[] | null;
  situation?: string | null;
  settingNote?: string | null;
  behaviour?: string | null;
  howOften?: string | null;
  minutes?: number | null;
  tried?: string | null;
  starterKeys?: string[] | null;
  result?: string | null;
  resultNote?: string | null;
  gotOrAvoided?: string[] | null;
  exception?: string | null;
  whatWorked?: string | null;
  goodThingText?: string | null;
  goodThingNone?: boolean | null;
  goodThingReasonKey?: string | null;
  goodThingReasonBn?: string | null;
  tone: string;
}

export type SafeguardingAnswer = "YES" | "NO";

export interface SubmitOutcome {
  outcome: "SAVED" | "BLOCKED" | "SAFEGUARDING_QUESTION" | "ROUTED";
  report: ISupportReport | null;
  blocked: { field: string; term: string; kind: string }[];
  askHits: { field: string; term: string }[];
  signs: SafeguardingSign[];
  /** The balance nudge (§7.6): the author's last 3 reports on this child were all CONCERN. Not stored. */
  balanceNudge: boolean;
}

const oid = (s: string): Types.ObjectId => {
  if (!Types.ObjectId.isValid(s)) throw new SupportProfileRefusal("ভুল আইডি।");
  return new Types.ObjectId(s);
};
const trimTo = (s: string | null | undefined, max: number, label: string): string => {
  const t = (s ?? "").trim();
  if (t.length > max) throw new SupportProfileRefusal(`${label} ${max} অক্ষরের বেশি হতে পারবে না।`);
  return t;
};
const oneOf = <T extends string>(v: string | null | undefined, list: readonly T[], label: string): T | null => {
  if (v == null || v === "") return null;
  if (!(list as readonly string[]).includes(v)) throw new SupportProfileRefusal(`${label}: ভুল মান।`);
  return v as T;
};

/** The text fields as one object (what the word lists and the referral read). */
export function textsOf(r: Pick<ISupportReport, "situation" | "settingNote" | "behaviour" | "tried" | "resultNote" | "exception" | "whatWorked" | "goodThing">): SupportTexts {
  return {
    situation: r.situation ?? "",
    settingNote: r.settingNote ?? "",
    behaviour: r.behaviour ?? "",
    tried: r.tried ?? "",
    resultNote: r.resultNote ?? "",
    exception: r.exception ?? "",
    whatWorked: r.whatWorked ?? "",
    goodThing: r.goodThing?.none ? "" : (r.goodThing?.textBn ?? ""),
  };
}

/** Normalise + size-check an input into the report's fields. `complete` = the submit rules. */
function normaliseInput(input: SupportReportInput, complete: boolean, todayKey: string) {
  const L = SUPPORT_FIELD_LIMITS;
  const source = oneOf(input.source ?? "TEACHER", SUPPORT_REPORT_SOURCES, "উৎস") ?? "TEACHER";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn ?? "")) throw new SupportProfileRefusal("তারিখ ঠিক নেই।");
  if (input.occurredOn > todayKey) throw new SupportProfileRefusal("ভবিষ্যতের তারিখে রিপোর্ট লেখা যায় না।");
  if (daysBetweenKeys(input.occurredOn, todayKey) > SUPPORT_THRESHOLDS.reportBackDays)
    throw new SupportProfileRefusal("রিপোর্ট সর্বোচ্চ ৭ দিন আগের ঘটনার হতে পারে।");
  const antecedentTags = (input.antecedentTags ?? []).map((a) => oneOf(a, SUPPORT_ANTECEDENTS, "ঠিক আগে কী চলছিল")!);
  const starterKeys = (input.starterKeys ?? []).map((a) => oneOf(a, SUPPORT_STARTER_KEYS as readonly string[], "চেনা কৌশল")!);
  const gotOrAvoided = (input.gotOrAvoided ?? []).map((a) => oneOf(a, SUPPORT_FUNCTIONS, "কী পেল বা এড়াল")!);
  const tone = oneOf(input.tone, SUPPORT_TONES, "রিপোর্টটি কেমন");
  const f = {
    source,
    occurredOn: input.occurredOn,
    groupType: (["section", "subjectgroup", "other"].includes(input.groupType ?? "") ? input.groupType : "section") as "section" | "subjectgroup" | "other",
    groupId: input.groupId && Types.ObjectId.isValid(input.groupId) ? new Types.ObjectId(input.groupId) : null,
    subject: trimTo(input.subject, 40, "বিষয়"),
    periodNo: input.periodNo ?? null,
    context: oneOf(input.context, SUPPORT_CONTEXTS, "প্রসঙ্গ"),
    antecedentTags,
    situation: trimTo(input.situation, L.situation, "তখন কী চলছিল"),
    settingNote: trimTo(input.settingNote, L.settingNote, "সেদিন আলাদা কিছু"),
    behaviour: trimTo(input.behaviour, L.behaviour, "শিক্ষার্থী কী করেছে"),
    howOften: oneOf(input.howOften, SUPPORT_HOW_OFTEN, "কতবার"),
    minutes: input.minutes ?? null,
    tried: trimTo(input.tried, L.tried, "আপনি কী করেছেন"),
    starterKeys,
    result: oneOf(input.result, SUPPORT_RESULTS, "এরপর কী হলো"),
    resultNote: trimTo(input.resultNote, L.resultNote, "এরপর কী হলো"),
    gotOrAvoided,
    exception: trimTo(input.exception, L.exception, "কখন ঠিক ছিল"),
    whatWorked: trimTo(input.whatWorked, L.whatWorked, "অন্য শিক্ষকের জন্য পরামর্শ"),
    goodThing: {
      textBn: input.goodThingNone ? null : trimTo(input.goodThingText, L.goodThing, "ভালো দিক") || null,
      none: !!input.goodThingNone,
      reasonKey: input.goodThingNone ? oneOf(input.goodThingReasonKey, SUPPORT_GOOD_NONE_REASONS, "কারণ") : null,
      reasonBn: input.goodThingNone ? trimTo(input.goodThingReasonBn, L.goodNoneReason, "কারণ") || null : null,
    },
    tone: tone ?? "MIXED",
  };
  if (f.minutes != null && (f.minutes < 0 || f.minutes > 600)) throw new SupportProfileRefusal("মিনিট ঠিক নেই।");
  if (!tone && complete) throw new SupportProfileRefusal("রিপোর্টটি কেমন — বাছুন।");
  if (antecedentTags.length > 3) throw new SupportProfileRefusal("'ঠিক আগে কী চলছিল' — সর্বোচ্চ ৩টি বাছুন।");
  if (complete) {
    const need = (v: string, label: string): void => {
      if (!v) throw new SupportProfileRefusal(`${label} — লিখুন।`);
    };
    if (source === "GUARDIAN_INFO") {
      need(f.situation, "বাসার কোন পরিস্থিতি");
      need(f.whatWorked, "অভিভাবক কী বলেছেন যা কাজে লাগে");
      f.goodThing = { textBn: null, none: false, reasonKey: null, reasonBn: null };
    } else {
      if (antecedentTags.length < 1) throw new SupportProfileRefusal("'ঠিক আগে কী চলছিল' — অন্তত ১টি বাছুন।");
      need(f.situation, "তখন ক্লাসে কী চলছিল");
      need(f.behaviour, "শিক্ষার্থী ঠিক কী করেছে বা বলেছে");
      need(f.tried, "আপনি কী করেছেন");
      if (!f.result) throw new SupportProfileRefusal("এরপর কী হলো — বাছুন।");
      // OA-2: a line, or "—" with a reason (OTHER needs its line).
      if (f.goodThing.none) {
        if (!f.goodThing.reasonKey) throw new SupportProfileRefusal("ভালো দিক না লিখলে কারণ বাছুন।");
        if (f.goodThing.reasonKey === "OTHER" && !f.goodThing.reasonBn) throw new SupportProfileRefusal("'অন্য' কারণটি এক লাইনে লিখুন।");
      } else if (!f.goodThing.textBn) {
        throw new SupportProfileRefusal("আজ এই শিশুর একটি ভালো দিক — লিখুন, অথবা — চাপুন ও কারণ বাছুন।");
      }
    }
  }
  return f;
}

type Fields = ReturnType<typeof normaliseInput>;

/** S-6: another child's name in any field (roster matcher, no AI). */
async function otherChildNamed(studentId: string, fields: Fields): Promise<string[]> {
  let scope;
  try {
    scope = await scopeForStudent(studentId);
  } catch {
    return [];
  }
  const people = scope.people.filter((p) => p.kind === "S");
  const hits: string[] = [];
  for (const [k, v] of Object.entries(textsOf(fields as never))) {
    if (!v) continue;
    if (/\[S\d+\]/.test(deidentify(v, { people }).text)) hits.push(k);
  }
  return hits;
}

const blockedOf = (hits: SupportTermHit[]): { field: string; term: string; kind: string }[] =>
  hits.filter((h) => h.severity === "BLOCK").map((h) => ({ field: h.field as string, term: h.term, kind: h.category as string }));
const asksOf = (hits: SupportTermHit[]) => hits.filter((h) => h.severity === "ASK").map((h) => ({ field: h.field, term: h.term }));

async function ensureProfile(studentId: string, byUserId: string): Promise<Types.ObjectId> {
  const existing = await SupportProfile.findOne({ studentId: oid(studentId) }).select("_id").lean();
  if (existing) return existing._id as Types.ObjectId;
  try {
    const p = await SupportProfile.create({ studentId: oid(studentId), openedVia: "FIRST_REPORT", openedBy: oid(byUserId), openedAt: new Date() });
    await writeAudit({ eventKind: "SUPPORT_PROFILE_OPENED", actorId: byUserId, targetId: studentId, targetKind: "Student", meta: { studentId, openedVia: "FIRST_REPORT" } });
    return p._id;
  } catch {
    const again = await SupportProfile.findOne({ studentId: oid(studentId) }).select("_id").lean();
    if (!again) throw new SupportProfileRefusal("প্রোফাইল খোলা গেল না।");
    return again._id as Types.ObjectId;
  }
}

async function ownEditable(auth: AuthPayload, reportId: string): Promise<ISupportReport> {
  const r = await SupportReport.findById(oid(reportId));
  if (!r || String(r.authorId) !== auth.userId) throw new SupportProfileRefusal("রিপোর্টটি পাওয়া যায়নি।");
  if (r.status === "IN_BATCH") throw new SupportProfileRefusal("রিপোর্টটি এখন প্রক্রিয়া চলছে — ব্যাচ শেষ হলে বদলানো যাবে।");
  if (!SUPPORT_EDITABLE_STATUSES.includes(r.status)) throw new SupportProfileRefusal("এই অবস্থায় রিপোর্টটি বদলানো যায় না।");
  return r;
}

function applyFields(r: ISupportReport, f: Fields): void {
  Object.assign(r, {
    source: f.source,
    occurredOn: f.occurredOn,
    groupType: f.groupType,
    groupId: f.groupId,
    subject: f.subject,
    periodNo: f.periodNo,
    context: f.context,
    antecedentTags: f.antecedentTags,
    situation: f.situation,
    settingNote: f.settingNote,
    behaviour: f.behaviour,
    howOften: f.howOften,
    minutes: f.minutes,
    tried: f.tried,
    starterKeys: f.starterKeys,
    result: f.result,
    resultNote: f.resultNote,
    gotOrAvoided: f.gotOrAvoided,
    exception: f.exception,
    whatWorked: f.whatWorked,
    goodThing: f.goodThing,
    tone: f.tone,
  });
}

/** Common opening of save/submit: access, cover-day rule, guardian-info rule. */
async function openFor(ctx: SupportCtx, input: SupportReportInput) {
  const acc = await accessToChild(ctx, input.studentId, "report");
  const todayKey = dhakaDayKey(new Date());
  const student = await Student.findById(oid(input.studentId)).select("_id").lean();
  if (!student) throw new SupportProfileRefusal("শিক্ষার্থী পাওয়া যায়নি।");
  if (acc.readerVia === "COVER" && input.occurredOn !== todayKey)
    throw new SupportProfileRefusal("কভার ক্লাসের দিনের ঘটনাই শুধু লেখা যায়।");
  if ((input.source ?? "TEACHER") === "GUARDIAN_INFO" && acc.mode !== "ALL" && acc.readerVia !== "CLASS_TEACHER")
    throw new SupportProfileRefusal("অভিভাবকের তথ্য শুধু শ্রেণি শিক্ষক বা প্রধান শিক্ষক লিখতে পারেন।");
  const authorVia = acc.mode === "ALL" ? "PRINCIPAL" : acc.readerVia === "CLASS_TEACHER" ? "CLASS_TEACHER" : acc.readerVia === "COVER" ? "COVER" : "TEACHING";
  return { ...acc, todayKey, authorVia: authorVia as ISupportReport["authorVia"] };
}

/** খসড়া রাখুন — a draft (no checks beyond sizes; ≤ 3 open drafts per child per author). */
export async function saveSupportDraft(ctx: SupportCtx, input: SupportReportInput, reportId?: string | null): Promise<ISupportReport> {
  const o = await openFor(ctx, input);
  const f = normaliseInput(input, false, o.todayKey);
  if (reportId) {
    const r = await ownEditable(o.auth, reportId);
    if (String(r.studentId) !== input.studentId) throw new SupportProfileRefusal("রিপোর্টটি অন্য শিক্ষার্থীর।");
    if (r.status !== "DRAFT") throw new SupportProfileRefusal("জমা দেওয়া রিপোর্ট খসড়া হিসেবে রাখা যায় না — আবার জমা দিন।");
    applyFields(r, f);
    await r.save();
    return r;
  }
  const open = await SupportReport.countDocuments({ authorId: oid(o.auth.userId), studentId: oid(input.studentId), status: "DRAFT" });
  if (open >= SUPPORT_THRESHOLDS.maxOpenDrafts) throw new SupportProfileRefusal("এই শিক্ষার্থীর ৩টি খসড়া আগেই আছে — আগে সেগুলো শেষ করুন।");
  const r = new SupportReport({
    studentId: oid(input.studentId),
    authorId: oid(o.auth.userId),
    authorVia: o.authorVia,
    seedCommentId: input.seedCommentId && Types.ObjectId.isValid(input.seedCommentId) ? new Types.ObjectId(input.seedCommentId) : null,
    status: "DRAFT",
    tone: f.tone,
  });
  applyFields(r, f);
  await r.save();
  return r;
}

/**
 * জমা দিন — save for processing (TO_PROCESS). Also the rewrite of a returned / questioned report:
 * the new text REPLACES the old (§2.4), the questions are deleted, `round` rises.
 */
export async function submitSupportReport(
  ctx: SupportCtx,
  input: SupportReportInput,
  opts: { reportId?: string | null; safeguardingAnswer?: SafeguardingAnswer | null; questionAnswers?: { flagId: string; answer: string; reasonBn?: string | null }[] | null } = {},
): Promise<SubmitOutcome> {
  const o = await openFor(ctx, input);
  const f = normaliseInput(input, true, o.todayKey);
  const base: SubmitOutcome = { outcome: "SAVED", report: null, blocked: [], askHits: [], signs: [], balanceNudge: false };

  // (2) word lists + (3) another child's name — refuse at once, no AI.
  const termHits = scanSupportTerms(textsOf(f as never));
  const blocked = blockedOf(termHits);
  for (const field of await otherChildNamed(input.studentId, f)) blocked.push({ field, term: "নামটি বাদ দিন", kind: "OTHER_CHILD" });
  if (blocked.length) return { ...base, outcome: "BLOCKED", blocked, askHits: asksOf(termHits) };

  // (4) safeguarding sign list → the question first (SG-4).
  const sg = scanSafeguarding(textsOf(f as never));
  const signs = [...new Set(sg.map((h) => h.sign))];
  if (signs.length && !opts.safeguardingAnswer) return { ...base, outcome: "SAFEGUARDING_QUESTION", signs, askHits: asksOf(termHits) };

  let r: ISupportReport;
  let wasStatus: SupportReportStatus | null = null;
  if (opts.reportId) {
    r = await ownEditable(o.auth, opts.reportId);
    if (String(r.studentId) !== input.studentId) throw new SupportProfileRefusal("রিপোর্টটি অন্য শিক্ষার্থীর।");
    wasStatus = r.status;
  } else {
    r = new SupportReport({
      studentId: oid(input.studentId),
      authorId: oid(o.auth.userId),
      authorVia: o.authorVia,
      seedCommentId: input.seedCommentId && Types.ObjectId.isValid(input.seedCommentId) ? new Types.ObjectId(input.seedCommentId) : null,
      tone: f.tone,
    });
  }
  applyFields(r, f);

  if (signs.length && opts.safeguardingAnswer === "YES") {
    return { ...base, outcome: "ROUTED", report: await routeToSafeguarding(r, o.auth.userId, signs, "SUPPORT_REPORT"), signs };
  }

  const now = new Date();
  // Answers to a batch's questions travel with the report (§6.12 step 5); the questions themselves go.
  if (wasStatus === "NEEDS_REWRITE") {
    for (const a of opts.questionAnswers ?? []) {
      const q = r.returnQuestions.find((x) => x.flagId === a.flagId);
      if (!q) continue;
      if (a.answer === "DISAGREE") {
        if (q.severity === "BLOCK") throw new SupportProfileRefusal("এই প্রশ্নে একমত না হওয়ার সুযোগ নেই — লেখাটি বদলান।");
        if (!a.reasonBn?.trim()) throw new SupportProfileRefusal("একমত না হলে এক লাইনে কারণ লিখুন।");
        r.teacherDisagreements.push({ flagId: q.flagId, category: q.category, reasonBn: a.reasonBn.trim().slice(0, 200) });
      }
      if (a.answer === "DONT_REMEMBER") r.dontRememberCount += 1;
    }
    r.returnQuestions = [];
    r.round += 1;
  }
  if (wasStatus === "RETURNED") {
    r.round += 1;
    r.rewriteRounds = 0; // a fresh count of 3 checks (§6.5)
  }
  r.askHits = asksOf(termHits);
  r.status = "TO_PROCESS";
  r.waitingSince = now;
  r.submittedAt = r.submittedAt ?? now;
  r.submittedText = textsOf(r);
  if (signs.length && opts.safeguardingAnswer === "NO") {
    r.safeguardingAsked = "TEACHER_SAID_NO";
    r.safeguardingHold = "OPEN";
    r.safeguardingHoldSource = "TERM_LIST";
  }
  r.profileId = r.profileId ?? (await ensureProfile(input.studentId, o.auth.userId));
  await r.save();

  await writeAudit({
    eventKind: "SUPPORT_REPORT_SUBMITTED",
    actorId: o.auth.userId,
    targetId: r._id.toString(),
    targetKind: "SupportReport",
    meta: { reportId: r._id.toString(), studentId: input.studentId, source: r.source, checkSkipped: r.checkSkipped, askCount: r.askHits.length, round: r.round },
  });
  if (r.safeguardingHold === "OPEN") {
    // SG-4: the teacher is never the only gate — a term-list hit sends a same-day notice.
    await notifyHolders("support_profile:approve" as never, "একটি রিপোর্টে সুরক্ষা-প্রশ্ন উঠেছিল — আজই দেখুন", `support-sg-hold:${r._id}`);
  }
  return { ...base, report: r, askHits: r.askHits, signs, balanceNudge: await balanceNudge(o.auth.userId, input.studentId) };
}

/** §7.6 balance nudge — computed now, not stored, only for the author. */
async function balanceNudge(authorId: string, studentId: string): Promise<boolean> {
  const last = await SupportReport.find({ authorId: oid(authorId), studentId: oid(studentId), status: { $nin: ["DRAFT", "WITHDRAWN", "SAFEGUARDING_ROUTED"] } })
    .sort({ createdAt: -1 })
    .limit(3)
    .select("tone")
    .lean();
  return last.length === 3 && last.every((x) => x.tone === "CONCERN");
}

/** SG-3: the text moves to the referral; the report keeps no text and is final. */
export async function routeToSafeguarding(r: ISupportReport, raisedBy: string, signs: SafeguardingSign[], source: "SUPPORT_REPORT" | "SUPPORT_BATCH"): Promise<ISupportReport> {
  const t = textsOf(r);
  const text = [t.situation, t.settingNote, t.behaviour, t.tried, t.resultNote, t.exception, t.whatWorked].filter(Boolean).join("\n");
  await raiseReferral({ studentId: String(r.studentId), raisedBy, source, signs, textBn: text });
  Object.assign(r, {
    situation: "",
    settingNote: "",
    behaviour: "",
    tried: "",
    resultNote: "",
    exception: "",
    whatWorked: "",
    goodThing: { textBn: null, none: false, reasonKey: null, reasonBn: null },
    submittedText: null,
    approvedText: null,
    returnQuestions: [],
    openFlags: [],
    askHits: [],
    batchId: null,
    status: "SAFEGUARDING_ROUTED",
    safeguardingHold: "NONE",
  });
  await r.save();
  return r;
}

/** Withdraw an own report while it waits (not while IN_BATCH). */
export async function withdrawSupportReport(ctx: SupportCtx, reportId: string): Promise<ISupportReport> {
  const auth = await supportCaller(ctx);
  const r = await ownEditable(auth, reportId);
  r.status = "WITHDRAWN";
  await r.save();
  await writeAudit({ eventKind: "SUPPORT_REPORT_WITHDRAWN", actorId: auth.userId, targetId: reportId, targetKind: "SupportReport", meta: { reportId, studentId: String(r.studentId), source: r.source } });
  return r;
}

/** The always-present button: a MANUAL referral with no report (SG-2 detector 3). */
export async function raiseSafeguardingConcern(ctx: SupportCtx, studentId: string, textBn: string): Promise<boolean> {
  await accessToChild(ctx, studentId, "report");
  const t = (textBn ?? "").trim();
  if (!t) throw new SupportProfileRefusal("শিশুর নিজের কথা বা যা দেখেছেন তা লিখুন।");
  const signs = [...new Set(scanSafeguarding({ behaviour: t }).map((h) => h.sign))];
  await raiseReferral({ studentId, raisedBy: ctx.auth!.userId, source: "MANUAL", signs, textBn: t });
  return true;
}

// ---------------------------------------------------------------------------------------------
// The Principal's decision (O-5) — directly on a waiting report (§6.7) or on a processed one
// ---------------------------------------------------------------------------------------------

export interface DecisionInput {
  reportId: string;
  decision: "APPROVED" | "APPROVED_EDITED" | "RETURNED" | "NOT_USED";
  reasonBn?: string | null;
  edited?: Partial<SupportTexts> | null;
}

export async function decideSupportReport(ctx: SupportCtx, d: DecisionInput): Promise<ISupportReport> {
  const auth = await supportCaller(ctx);
  if (!holdsApprove(auth)) throw new SupportProfileRefusal("রিপোর্ট অনুমোদনের অনুমতি নেই।");
  const r = await SupportReport.findById(oid(d.reportId));
  if (!r) throw new SupportProfileRefusal("রিপোর্টটি পাওয়া যায়নি।");
  if (!SUPPORT_DECIDABLE_STATUSES.includes(r.status)) throw new SupportProfileRefusal("এই অবস্থায় সিদ্ধান্ত দেওয়া যায় না।");
  if (r.safeguardingHold === "OPEN") throw new SupportProfileRefusal("আগে সুরক্ষা-প্রশ্নের সিদ্ধান্ত দিন।");
  const reason = (d.reasonBn ?? "").trim();
  if ((d.decision === "RETURNED" || d.decision === "NOT_USED") && !reason) throw new SupportProfileRefusal("কারণ লিখুন।");
  if (d.decision === "RETURNED" && !(await readerOf(String(r.studentId), String(r.authorId))))
    throw new SupportProfileRefusal("লেখক এখন আর এই শিক্ষার্থীর শিক্ষক নন — নিজে সম্পাদনা করুন বা 'প্রোফাইলে যাবে না' দিন।");

  const wasWaiting = r.status === "TO_PROCESS";
  if (wasWaiting) r.checkSkipped = "DECIDED_DIRECTLY";
  const now = new Date();
  const submitted = r.submittedText ?? textsOf(r);
  if (d.decision === "APPROVED" || d.decision === "APPROVED_EDITED") {
    const approved: SupportTexts = { ...submitted };
    if (d.decision === "APPROVED_EDITED") {
      for (const [k, v] of Object.entries(d.edited ?? {})) if (k in approved && typeof v === "string") (approved as unknown as Record<string, string>)[k] = v.trim();
      const blocked = blockedOf(scanSupportTerms(approved));
      if (blocked.length) throw new SupportProfileRefusal(`এই শব্দটি রাখা যাবে না: ${blocked[0].term}`);
    }
    r.submittedText = submitted;
    r.approvedText = approved;
    r.principalEdited = d.decision === "APPROVED_EDITED" && JSON.stringify(approved) !== JSON.stringify(submitted);
    r.status = "APPROVED";
  } else if (d.decision === "RETURNED") {
    r.status = "RETURNED";
    r.returnedAt = now;
  } else {
    r.status = "NOT_USED";
  }
  r.batchId = null;
  r.decidedBy = new Types.ObjectId(auth.userId);
  r.decidedAt = now;
  r.decisionReasonBn = reason || null;
  await r.save();
  await SupportReview.create({ profileId: r.profileId, kind: "REPORT_DECISION", reportId: r._id, decision: d.decision, reasonBn: reason, by: new Types.ObjectId(auth.userId), at: now });
  await writeAudit({ eventKind: "SUPPORT_REPORT_DECIDED", actorId: auth.userId, targetId: d.reportId, targetKind: "SupportReport", meta: { reportId: d.reportId, decision: d.decision, direct: wasWaiting } });
  const body =
    d.decision === "RETURNED"
      ? "আপনার রিপোর্ট ফেরত এসেছে — কারণ দেখুন"
      : d.decision === "NOT_USED"
        ? null
        : r.principalEdited
          ? "আপনার রিপোর্ট প্রোফাইলে যুক্ত হয়েছে — প্রধান শিক্ষক ভাষা সামান্য বদলেছেন, দেখে নিন"
          : "আপনার রিপোর্ট প্রোফাইলে যুক্ত হয়েছে, ধন্যবাদ";
  if (body && String(r.authorId) !== auth.userId) await notifyUser(String(r.authorId), body, `support-decided:${r._id}:${d.decision}`);
  return r;
}

/** SG-4 / SG-9: the Principal clears a safeguarding hold, or routes the report out. */
export async function resolveSafeguardingHold(ctx: SupportCtx, reportId: string, answer: SafeguardingAnswer): Promise<ISupportReport> {
  const auth = await supportCaller(ctx, { noViewAs: true });
  if (!holdsApprove(auth)) throw new SupportProfileRefusal("অনুমতি নেই।");
  const r = await SupportReport.findById(oid(reportId));
  if (!r || r.safeguardingHold !== "OPEN") throw new SupportProfileRefusal("এই রিপোর্টে খোলা সুরক্ষা-প্রশ্ন নেই।");
  const now = new Date();
  await SupportReview.create({ profileId: r.profileId, kind: "SAFEGUARDING_HOLD_DECISION", reportId: r._id, decision: answer === "YES" ? "ROUTED" : "CLEARED", by: new Types.ObjectId(auth.userId), at: now });
  if (answer === "YES") {
    const signs = [...new Set(scanSafeguarding(textsOf(r)).map((h) => h.sign))];
    const source = r.safeguardingHoldSource === "TERM_LIST" ? "SUPPORT_REPORT" : "SUPPORT_BATCH";
    return routeToSafeguarding(r, auth.userId, signs.length ? signs : ["SUDDEN_CHANGE"], source);
  }
  r.safeguardingHold = "CLEARED";
  await r.save();
  return r;
}

// ---------------------------------------------------------------------------------------------
// Lists — paged from the start (D-#761)
// ---------------------------------------------------------------------------------------------

export interface PageOut<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}
const paging = (a: { page?: number | null; pageSize?: number | null }) => {
  const page = Math.max(1, a.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, a.pageSize ?? 25));
  return { page, pageSize, skip: (page - 1) * pageSize };
};

export interface ReportView {
  r: ISupportReport;
  /** False when the author is no longer a reader: status only, no text (§8.2 rule 5). */
  textVisible: boolean;
  studentName: string | null;
  authorName: string | null;
}

async function studentNames(ids: Types.ObjectId[]): Promise<Map<string, string>> {
  const rows = await Student.find({ _id: { $in: ids } }).select("name nameBn").lean();
  return new Map(rows.map((s) => [String(s._id), s.nameBn || s.name]));
}

/** আমার রিপোর্ট — own reports; text only for children the author still reads (or a view_all holder). */
export async function myReportsPage(ctx: SupportCtx, args: { page?: number | null; pageSize?: number | null }): Promise<PageOut<ReportView>> {
  const auth = await supportCaller(ctx);
  const { page, pageSize, skip } = paging(args);
  const filter = { authorId: oid(auth.userId) };
  const [rows, total] = await Promise.all([SupportReport.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(pageSize), SupportReport.countDocuments(filter)]);
  const all = holdsViewAll(auth);
  const readable = new Map<string, boolean>();
  for (const sid of new Set(rows.map((r) => String(r.studentId)))) readable.set(sid, all || !!(await readerOf(sid, auth.userId)));
  const names = await studentNames(rows.map((r) => r.studentId));
  return {
    rows: rows.map((r) => {
      const vis = readable.get(String(r.studentId)) ?? false;
      return { r, textVisible: vis, studentName: vis ? (names.get(String(r.studentId)) ?? null) : null, authorName: null };
    }),
    total,
    page,
    pageSize,
  };
}

/** The Principal's waiting list (§6.9): TO_PROCESS + PROCESSED, a safeguarding hold pinned on top. */
export async function queuePage(
  ctx: SupportCtx,
  args: { status?: string | null; page?: number | null; pageSize?: number | null },
): Promise<PageOut<ReportView> & { waiting: number; oldestDays: number | null; held: number }> {
  const auth = await supportCaller(ctx);
  if (!holdsApprove(auth)) throw new SupportProfileRefusal("অনুমতি নেই।");
  const { page, pageSize, skip } = paging(args);
  const statuses = args.status === "PROCESSED" ? ["PROCESSED"] : args.status === "TO_PROCESS" ? ["TO_PROCESS"] : ["TO_PROCESS", "PROCESSED", "IN_BATCH"];
  const filter = { status: { $in: statuses } };
  const [rows, total, waiting, oldest, held] = await Promise.all([
    SupportReport.find(filter).sort({ safeguardingHold: -1, waitingSince: 1, createdAt: 1 }).skip(skip).limit(pageSize),
    SupportReport.countDocuments(filter),
    SupportReport.countDocuments({ status: "TO_PROCESS" }),
    SupportReport.findOne({ status: "TO_PROCESS" }).sort({ waitingSince: 1 }).select("waitingSince").lean(),
    SupportReport.countDocuments({ safeguardingHold: "OPEN", status: { $in: ["TO_PROCESS", "PROCESSED", "NEEDS_REWRITE"] } }),
  ]);
  // "OPEN" > "NONE" > "CLEARED" alphabetically is not the order we want: pin holds explicitly.
  rows.sort((a, b) => Number(b.safeguardingHold === "OPEN") - Number(a.safeguardingHold === "OPEN"));
  const names = await studentNames(rows.map((r) => r.studentId));
  const authors = new Map((await User.find({ _id: { $in: rows.map((r) => r.authorId) } }).select("name").lean()).map((u) => [String(u._id), u.name]));
  const oldestDays = oldest?.waitingSince ? Math.floor((Date.now() - new Date(oldest.waitingSince).getTime()) / 86_400_000) : null;
  return {
    rows: rows.map((r) => ({ r, textVisible: true, studentName: names.get(String(r.studentId)) ?? null, authorName: authors.get(String(r.authorId)) ?? null })),
    total,
    page,
    pageSize,
    waiting,
    oldestDays,
    held,
  };
}

/** One report: its author while a reader, or an approve / view_all holder. Audited as REPORT. */
export async function readReport(ctx: SupportCtx, reportId: string, via: string): Promise<ReportView> {
  const auth = await supportCaller(ctx);
  const r = await SupportReport.findById(oid(reportId));
  if (!r) throw new SupportProfileRefusal("রিপোর্টটি পাওয়া যায়নি।");
  const principal = holdsViewAll(auth) || holdsApprove(auth);
  let readerVia = "PRINCIPAL";
  if (!principal) {
    if (String(r.authorId) !== auth.userId) throw new SupportProfileRefusal("রিপোর্টটি পাওয়া যায়নি।");
    const rd = await readerOf(String(r.studentId), auth.userId);
    if (!rd) {
      return { r, textVisible: false, studentName: null, authorName: null };
    }
    readerVia = rd.via;
  }
  await writeAudit({
    eventKind: "SUPPORT_PROFILE_VIEWED",
    actorId: auth.userId,
    targetId: String(r.studentId),
    targetKind: "Student",
    meta: { studentId: String(r.studentId), versionNo: null, surface: "REPORT", via, readerVia, reportId },
  });
  const names = await studentNames([r.studentId]);
  const author = principal ? ((await User.findById(r.authorId).select("name").lean())?.name ?? null) : null;
  return { r, textVisible: true, studentName: names.get(String(r.studentId)) ?? null, authorName: author };
}

/** §2.4: a NOT_USED report's text is deleted after 30 days; the decision row stays. */
export async function sweepNotUsedText(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SUPPORT_THRESHOLDS.notUsedTextDays * 86_400_000);
  const res = await SupportReport.updateMany(
    { status: "NOT_USED", decidedAt: { $lte: cutoff }, $or: [{ behaviour: { $ne: "" } }, { situation: { $ne: "" } }, { submittedText: { $ne: null } }] },
    {
      $set: {
        situation: "",
        settingNote: "",
        behaviour: "",
        tried: "",
        resultNote: "",
        exception: "",
        whatWorked: "",
        "goodThing.textBn": null,
        submittedText: null,
        approvedText: null,
        returnQuestions: [],
        openFlags: [],
      },
    },
  );
  return res.modifiedCount;
}
