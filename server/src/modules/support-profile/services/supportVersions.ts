/**
 * Profile versions (docs/prd-child-support-profile.md §5.2, §6.6, §7.3, §9.2, §9.5; CSP-4).
 *
 *  - publish: the second Principal check of O-5 (D-#1555). Refused while any citation is provisional
 *    (rule 16); every level is recomputed from APPROVED reports only and frozen; an item that now falls
 *    below its section minimum is dropped (counted); a version with no strength cannot publish (S-2);
 *    the card is rebuilt by the §16.7 rules (do's PREVENT → TEACH → RESPOND → STRENGTHEN, ESTABLISHED
 *    first, ≤ 2 marked leads only when < 3 established do's; every avoid needs its "বরং"). A PUBLISHED
 *    version is never edited — a change is a new version.
 *  - reconcile (rule 16): when a cited report is approved its provisional citation becomes firm; when it
 *    is returned / not used / withdrawn / routed the citation is removed, the item recomputed and dropped
 *    if it fails.
 *  - hand-made version (§6.7): the Principal picks APPROVED reports; same levels, same minimums.
 *  - history: versions (paged), a diff of two versions, the readers list (`কে পড়েছেন`).
 */
import { Types } from "mongoose";
import { randomBytes } from "node:crypto";
import {
  SUPPORT_SECTIONS,
  SUPPORT_SECTION_MIN_LEVEL,
  SUPPORT_SKILLS,
  SUPPORT_STRATEGY_KINDS,
  SUPPORT_THRESHOLDS,
  callerHasPermission,
  goodThingCounts,
  evidenceLevel,
  insideWindow,
  levelRank,
  sideOfSection,
  type Permission,
  type SupportSection,
} from "@scd/shared";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { writeAudit } from "../../platform/services/AuditService";
import { Audit } from "../../platform/models/Audit";
import { User } from "../../foundation/models/User";
import { SupportProfile } from "../models/SupportProfile";
import { SupportProfileVersion, type ISupportProfileVersion, type SupportItem } from "../models/SupportProfileVersion";
import { SupportReport } from "../models/SupportReport";
import { SupportReview } from "../models/SupportReview";
import { SupportProfileRefusal } from "./errors";
import { supportCaller, holdsViewAll, isSwitchedOn, type SupportCtx } from "./supportAccess";
import { functionTagKept, reportUsableOnSide, viaGoodThingOf } from "./supportEvidenceRules";
import { textProblem as validatorTextProblem } from "./supportResultValidator";
import { notifyUser } from "./supportNotify";
import { currentSupportReaders } from "./supportScope";

const oid = (s: string | Types.ObjectId): Types.ObjectId => new Types.ObjectId(String(s));
const KIND_ORDER = ["PREVENT", "TEACH", "RESPOND", "STRENGTHEN"];

async function assertApprove(ctx: SupportCtx) {
  const auth = await supportCaller(ctx, { noViewAs: true });
  if (!callerHasPermission(auth, "support_profile:approve" as Permission)) throw new SupportProfileRefusal("প্রকাশের অনুমতি নেই।");
  return auth;
}

const plainItem = (it: SupportItem): SupportItem => {
  const o = typeof (it as unknown as { toObject?: () => SupportItem }).toObject === "function" ? (it as unknown as { toObject: () => SupportItem }).toObject() : it;
  return { ...o, evidence: [...(o.evidence ?? [])], provisionalEvidence: [...(o.provisionalEvidence ?? [])], counterEvidence: [...(o.counterEvidence ?? [])] };
};

/** Recompute one item from its APPROVED citations. Returns the item with fresh counts, or null when it fails. */
async function recompute(profileId: Types.ObjectId, section: SupportSection, it: SupportItem, todayKey: string, statuses: string[] = ["APPROVED"]): Promise<SupportItem | null> {
  const side = sideOfSection(section);
  const ids = [...it.evidence, ...it.counterEvidence].map(String);
  const reps = await SupportReport.find({ _id: { $in: ids.map(oid) }, profileId, status: { $in: statuses } })
    .select("authorId occurredOn periodNo context subject source result tone goodThing gotOrAvoided")
    .lean();
  const ok = (id: Types.ObjectId) => reps.find((r) => String(r._id) === String(id) && (!side || insideWindow(side, r.occurredOn, todayKey)));
  const gt = (id: Types.ObjectId) => goodThingCounts(ok(id)!.goodThing);
  // E-2: on the positive side a CONCERN report counts only through a concrete good thing (as the validator does).
  const evidence = it.evidence.filter((e) => ok(e) && reportUsableOnSide(side, ok(e)!.tone, gt(e)));
  const counter = it.counterEvidence.filter((e) => ok(e));
  if (!evidence.length) return null;
  const ev = (id: Types.ObjectId) => {
    const r = ok(id)!;
    return { id: String(r._id), authorId: String(r.authorId), occurredOn: r.occurredOn, slot: r.periodNo != null ? `P${r.periodNo}` : (r.context ?? "OTHER"), setting: r.subject || r.context || "OTHER", source: r.source, result: r.result, viaGoodThing: viaGoodThingOf(side, r.tone, goodThingCounts(r.goodThing)) };
  };
  const s = evidenceLevel({ side: side ?? "POSITIVE", evidence: evidence.map(ev), counter: counter.map(ev), isStrategy: section === "works", todayKey });
  if (section !== "goals") {
    const min = SUPPORT_SECTION_MIN_LEVEL[section];
    if (!s.level || (min && levelRank(s.level) < levelRank(min))) return null;
    if (section === "works" && !evidence.some((e) => ["WORKED", "PARTLY"].includes(ok(e)!.result ?? ""))) return null;
  }
  // E-12: a possible reason survives only with ≥ 3 observations from ≥ 2 teachers that share it.
  const functionTag = functionTagKept(it.functionTag, evidence.map((e) => ({ ...ev(e), gotOrAvoided: ok(e)!.gotOrAvoided ?? [] })));
  return {
    ...it,
    functionTag,
    evidence,
    provisionalEvidence: [],
    counterEvidence: counter,
    level: s.level,
    obsCount: s.obsCount,
    teachersCount: s.teachersCount,
    settings: s.settings,
    firstEvidenceKey: s.firstEvidenceKey,
    lastEvidenceKey: s.lastEvidenceKey,
    hasGuardianInfo: s.hasGuardianInfo,
    mixed: s.mixed,
  };
}

const actionable = (i: SupportItem) => !!i.actionable && i.actionable.verbFirst && i.actionable.observable && i.actionable.specific && i.actionable.doable;

/** §16.7.2: the card order and limits, decided by the server. */
export function buildCard(sections: Record<SupportSection, SupportItem[]>, proposed: { doItemIds: string[]; avoidItemIds: string[]; strengthItemIds: string[]; goalItemId: string | null }) {
  const byId = new Map(SUPPORT_SECTIONS.flatMap((s) => sections[s].map((i) => [i.itemId, { ...i, section: s }] as const)));
  const dos = proposed.doItemIds
    .map((id) => byId.get(id))
    .filter((i): i is SupportItem & { section: SupportSection } => !!i && i.section === "works" && actionable(i) && [...i.textBn].length <= SUPPORT_THRESHOLDS.cardTextChars && !i.mixed);
  const established = dos.filter((i) => levelRank(i.level) >= levelRank("ESTABLISHED"));
  const leads = established.length < 3 ? dos.filter((i) => levelRank(i.level) < levelRank("ESTABLISHED")).sort((a, b) => levelRank(b.level) - levelRank(a.level)).slice(0, SUPPORT_THRESHOLDS.cardLeads) : [];
  const order = (a: SupportItem, b: SupportItem) => KIND_ORDER.indexOf(a.kind ?? "") - KIND_ORDER.indexOf(b.kind ?? "") || levelRank(b.level) - levelRank(a.level);
  const doIds = [...established.sort(order), ...leads.sort(order)].slice(0, SUPPORT_THRESHOLDS.cardDo).map((i) => i.itemId);
  const avoidIds = proposed.avoidItemIds
    .map((id) => byId.get(id))
    .filter((i) => !!i && i.section === "avoid" && !!i.insteadItemId && byId.get(i.insteadItemId)?.section === "works" && levelRank(i.level) >= levelRank("ESTABLISHED") && !i.mixed)
    .slice(0, SUPPORT_THRESHOLDS.cardAvoid)
    .map((i) => i!.itemId);
  const strengthIds = proposed.strengthItemIds.filter((id) => byId.get(id)?.section === "strengths" && levelRank(byId.get(id)!.level) >= levelRank("EMERGING")).slice(0, SUPPORT_THRESHOLDS.cardStrengths);
  const goalId = proposed.goalItemId && byId.get(proposed.goalItemId)?.section === "goals" ? proposed.goalItemId : null;
  return { doItemIds: doIds, avoidItemIds: avoidIds, strengthItemIds: strengthIds, goalItemId: goalId };
}

type SectionsMap = Record<SupportSection, SupportItem[]>;
const emptySections = (): SectionsMap => Object.fromEntries(SUPPORT_SECTIONS.map((s) => [s, [] as SupportItem[]])) as unknown as SectionsMap;

/**
 * Rewrite a DRAFT's sections atomically: load, change, write back only if the document is still at the
 * version we read (a lost-update guard); retry on a clash. `fn` returns the new sections and how many
 * items it dropped. Returns false when the draft is gone or no longer a DRAFT.
 */
async function mutateDraft(versionId: Types.ObjectId, fn: (sections: SectionsMap, profileId: Types.ObjectId) => Promise<{ sections: SectionsMap; dropped: number }>): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const v = await SupportProfileVersion.findById(versionId).lean();
    if (!v || v.status !== "DRAFT") return false;
    const base = emptySections();
    for (const s of SUPPORT_SECTIONS) base[s] = (v.sections?.[s] ?? []).map(plainItem);
    const out = await fn(base, v.profileId);
    const res = await SupportProfileVersion.updateOne(
      { _id: versionId, status: "DRAFT", __v: (v as unknown as { __v: number }).__v },
      { $set: { sections: out.sections, droppedItems: (v.droppedItems ?? 0) + out.dropped }, $inc: { __v: 1 } },
    );
    if (res.modifiedCount === 1) return true;
  }
  throw new SupportProfileRefusal("খসড়াটি একই সময়ে বদলেছে — আবার চেষ্টা করুন।");
}

/** Rule 16 — keep DRAFT versions in step with a decision on a report they cite. */
export async function reconcileDrafts(reportId: Types.ObjectId, event: "APPROVED" | "REMOVED"): Promise<number> {
  const lists = ["provisionalEvidence", "evidence", "counterEvidence"];
  const drafts = await SupportProfileVersion.find({ status: "DRAFT", $or: SUPPORT_SECTIONS.flatMap((s) => lists.map((l) => ({ [`sections.${s}.${l}`]: reportId }))) })
    .select("_id")
    .lean();
  const today = dhakaDayKey(new Date());
  const cites = (l: Types.ObjectId[]) => l.some((x) => String(x) === String(reportId));
  const without = (l: Types.ObjectId[]) => l.filter((x) => String(x) !== String(reportId));
  let total = 0;
  for (const d of drafts) {
    let last = 0;
    await mutateDraft(d._id, async (sections, profileId) => {
      let dropped = 0; // per draft and per attempt
      const next = emptySections();
      for (const s of SUPPORT_SECTIONS) {
        for (const it of sections[s]) {
          if (!cites(it.provisionalEvidence) && !cites(it.evidence) && !cites(it.counterEvidence)) {
            next[s].push(it);
            continue;
          }
          if (event === "APPROVED") {
            // Only a provisional citation becomes firm; a counter citation stays a counter citation.
            if (cites(it.provisionalEvidence)) {
              it.provisionalEvidence = without(it.provisionalEvidence);
              if (!cites(it.evidence)) it.evidence.push(reportId);
            }
            next[s].push(it);
            continue;
          }
          it.provisionalEvidence = without(it.provisionalEvidence);
          it.evidence = without(it.evidence);
          it.counterEvidence = without(it.counterEvidence);
          // Recompute with what is left (approved firm + still-provisional count as the draft's view).
          const keep = it.evidence.length + it.provisionalEvidence.length > 0 ? await recomputeDraft(profileId, s, it, today) : null;
          if (keep) next[s].push(keep);
          else dropped++;
        }
      }
      last = dropped;
      return { sections: next, dropped };
    });
    total += last;
  }
  return total;
}

/** A draft item's level counting provisional citations too (rule 15); null when it fails its minimum. */
async function recomputeDraft(profileId: Types.ObjectId, section: SupportSection, it: SupportItem, todayKey: string): Promise<SupportItem | null> {
  // The draft's view: firm (APPROVED) + still-provisional (PROCESSED in the same batch) citations.
  const firm = new Set(it.evidence.map(String));
  const r = await recompute(profileId, section, { ...it, evidence: [...it.evidence, ...it.provisionalEvidence] }, todayKey, ["APPROVED", "PROCESSED"]);
  if (!r) return null;
  return { ...r, evidence: r.evidence.filter((e) => firm.has(String(e))), provisionalEvidence: r.evidence.filter((e) => !firm.has(String(e))) };
}

/** Principal-written text: the validator's checks WITH the roster / staff names and the code scan (rule 14). */
async function principalTextProblem(t: string | null | undefined): Promise<string | null> {
  if (!t || !t.trim()) return "বাক্যটি লিখুন।";
  const { packRoster } = await import("./SupportBatchService");
  const roster = await packRoster();
  const rosterNames = [...roster.students, ...roster.guardians, ...roster.staff].flatMap((p) => p.names).filter((n) => [...n.trim()].length >= 3);
  const reason = validatorTextProblem(t, { reports: new Map(), rosterNames }, null);
  if (!reason) return null;
  const msg: Record<string, string> = {
    SAFEGUARDING_TERM: "সুরক্ষা-শব্দ আছে — এটি প্রোফাইলে যাবে না।",
    LABEL_TERM: "লেবেল বা রোগের নাম আছে।",
    FREQUENCY_WORD: "'সবসময়'-এর মতো শব্দ চলবে না।",
    LINK_OR_HTML: "কোড বা লিংক চলবে না।",
    TOKEN_OR_NAME: "নাম বা কোড চলবে না।",
  };
  return msg[reason] ?? "এই বাক্য চলবে না।";
}
async function assertPlainText(t: string | null | undefined, optional = false): Promise<void> {
  if (optional && (!t || !t.trim())) return;
  const problem = await principalTextProblem(t);
  if (problem) throw new SupportProfileRefusal(problem);
}

export async function publishVersion(ctx: SupportCtx, versionId: string, changeNoteBn?: string | null): Promise<ISupportProfileVersion> {
  const auth = await assertApprove(ctx);
  if (!Types.ObjectId.isValid(versionId)) throw new SupportProfileRefusal("খসড়া পাওয়া যায়নি।");
  const v = await SupportProfileVersion.findById(oid(versionId));
  if (!v || v.status !== "DRAFT") throw new SupportProfileRefusal("খসড়া পাওয়া যায়নি।");
  const p0 = await SupportProfile.findById(v.profileId);
  if (!p0) throw new SupportProfileRefusal("প্রোফাইল পাওয়া যায়নি।");
  if (p0.currentVersionId) {
    const cur = await SupportProfileVersion.findById(p0.currentVersionId).select("versionNo").lean();
    if (cur && v.versionNo < cur.versionNo) throw new SupportProfileRefusal("এই খসড়াটি বর্তমান সংস্করণের চেয়ে পুরোনো — এটি বাতিল করুন।");
  }
  await assertPlainText(changeNoteBn, true);
  // Rule 16: no citation of any kind may be unapproved. A provisional id whose report is now APPROVED is firm
  // (an event may have been lost); a counter id must be APPROVED too.
  const plain = emptySections();
  for (const s of SUPPORT_SECTIONS) plain[s] = (v.sections[s] ?? []).map(plainItem);
  const pending = [...new Set(SUPPORT_SECTIONS.flatMap((s) => plain[s].flatMap((i) => [...i.provisionalEvidence, ...i.counterEvidence]).map(String)))];
  const approvedIds = new Set((await SupportReport.find({ _id: { $in: pending.map(oid) }, profileId: v.profileId, status: "APPROVED" }).select("_id").lean()).map((r) => String(r._id)));
  for (const s of SUPPORT_SECTIONS)
    for (const i of plain[s]) {
      if (i.provisionalEvidence.some((x) => !approvedIds.has(String(x))) || i.counterEvidence.some((x) => !approvedIds.has(String(x))))
        throw new SupportProfileRefusal("খসড়ায় এখনো অনুমোদন-বাকি রিপোর্টের উল্লেখ আছে — আগে সেগুলোর সিদ্ধান্ত দিন।");
      const firmNow = i.provisionalEvidence.filter((x) => !i.evidence.some((e) => String(e) === String(x)));
      i.evidence = [...i.evidence, ...firmNow];
      i.provisionalEvidence = [];
    }
  const today = dhakaDayKey(new Date());
  let dropped = 0;
  const sections = emptySections();
  for (const s of SUPPORT_SECTIONS) {
    for (const it of plain[s]) {
      const r = await recompute(v.profileId, s, it, today);
      if (r) sections[s].push(r);
      else dropped++;
    }
  }
  if (sections.goals.length > SUPPORT_THRESHOLDS.maxActiveGoals) throw new SupportProfileRefusal("সর্বোচ্চ ২টি লক্ষ্য রাখা যায়।");
  if (!sections.strengths.length) throw new SupportProfileRefusal("প্রকাশের জন্য অন্তত একটি শক্তির দিক দরকার — শিক্ষকদের ভালো দিকের রিপোর্ট লিখতে বলুন।");
  const card = buildCard(sections, { doItemIds: v.card.doItemIds, avoidItemIds: v.card.avoidItemIds, strengthItemIds: v.card.strengthItemIds, goalItemId: v.card.goalItemId });
  const now = new Date();
  const note = changeNoteBn?.trim() ? changeNoteBn.trim().slice(0, 300) : null;
  // Claim the draft atomically: a second publish (or a concurrent edit) finds nothing to claim.
  const claimed = await SupportProfileVersion.findOneAndUpdate(
    { _id: v._id, status: "DRAFT", __v: (v as unknown as { __v: number }).__v },
    { $set: { sections, card, status: "PUBLISHED", publishedBy: oid(auth.userId), publishedAt: now, droppedItems: v.droppedItems + dropped, ...(note ? { changeNoteBn: note } : {}) }, $inc: { __v: 1 } },
    { new: true },
  );
  if (!claimed) throw new SupportProfileRefusal("খসড়াটি এইমাত্র বদলেছে বা প্রকাশ হয়েছে — আবার দেখুন।");
  const concern = ["triggers", "feelings", "avoid"].some((s) => sections[s as SupportSection].length > 0) || sections.goals.length > 0;
  const [y, m, d] = today.split("-").map(Number);
  const switched = await SupportProfile.findOneAndUpdate(
    { _id: v.profileId, currentVersionId: p0.currentVersionId ?? null },
    { $set: { currentVersionId: v._id, nextReviewDueKey: new Date(Date.UTC(y, m - 1, d + (concern ? 90 : 365))).toISOString().slice(0, 10), lastReviewedAt: now } },
    { new: true },
  );
  if (!switched) {
    // Another publish moved the profile first — put this draft back so nothing is half-done.
    await SupportProfileVersion.updateOne({ _id: v._id, status: "PUBLISHED" }, { $set: { status: "DRAFT", publishedBy: null, publishedAt: null } });
    throw new SupportProfileRefusal("প্রোফাইল এইমাত্র আরেকটি সংস্করণে বদলেছে — আবার দেখুন।");
  }
  // §9.7: current teachers are told — only when the feature is on and the profile is open; the notice names no child.
  if (switched.status === "OPEN" && (await isSwitchedOn())) {
    for (const r of await currentSupportReaders(String(switched.studentId))) await notifyUser(r.userId, "একটি সহায়তা প্রোফাইল হালনাগাদ হয়েছে — ক্লাসের আগে দেখে নিন", `support-published:${v._id}`);
  }
  const perLevel: Record<string, number> = {};
  for (const s of SUPPORT_SECTIONS) for (const i of sections[s]) perLevel[i.level ?? "NONE"] = (perLevel[i.level ?? "NONE"] ?? 0) + 1;
  await SupportReview.create({ profileId: v.profileId, kind: "VERSION_PUBLISH", versionId: v._id, decision: "PUBLISHED", reasonBn: claimed.changeNoteBn, by: oid(auth.userId), at: now });
  await writeAudit({ eventKind: "SUPPORT_VERSION_PUBLISHED", actorId: auth.userId, targetId: String(v._id), targetKind: "SupportProfileVersion", meta: { versionNo: v.versionNo, perLevel, droppedItems: dropped } });
  return claimed;
}

export async function discardVersion(ctx: SupportCtx, versionId: string): Promise<ISupportProfileVersion> {
  const auth = await assertApprove(ctx);
  if (!Types.ObjectId.isValid(versionId)) throw new SupportProfileRefusal("খসড়া পাওয়া যায়নি।");
  const v = await SupportProfileVersion.findOneAndUpdate({ _id: oid(versionId), status: "DRAFT" }, { $set: { status: "DISCARDED" } }, { new: true });
  if (!v) throw new SupportProfileRefusal("খসড়া পাওয়া যায়নি।");
  await SupportReview.create({ profileId: v.profileId, kind: "VERSION_DISCARD", versionId: v._id, decision: "DISCARDED", by: oid(auth.userId), at: new Date() });
  await writeAudit({ eventKind: "SUPPORT_VERSION_DISCARDED", actorId: auth.userId, targetId: String(v._id), targetKind: "SupportProfileVersion", meta: { versionNo: v.versionNo } });
  return v;
}

/** Edit a DRAFT item's wording (its evidence stays) or delete it. A PUBLISHED version is never edited. */
export async function editDraftItem(ctx: SupportCtx, versionId: string, itemId: string, textBn: string | null): Promise<ISupportProfileVersion> {
  await assertApprove(ctx);
  if (!Types.ObjectId.isValid(versionId)) throw new SupportProfileRefusal("সংস্করণ পাওয়া যায়নি।");
  const v0 = await SupportProfileVersion.findById(oid(versionId)).select("status").lean();
  if (!v0) throw new SupportProfileRefusal("সংস্করণ পাওয়া যায়নি।");
  if (v0.status !== "DRAFT") throw new SupportProfileRefusal("প্রকাশিত সংস্করণ বদলানো যায় না — নতুন সংস্করণ করুন।");
  if (textBn != null) await assertPlainText(textBn);
  let found = false;
  const ok = await mutateDraft(oid(versionId), async (sections) => {
    found = false;
    for (const s of SUPPORT_SECTIONS) {
      const idx = sections[s].findIndex((i) => i.itemId === itemId);
      if (idx < 0) continue;
      found = true;
      if (textBn == null) sections[s].splice(idx, 1);
      else sections[s][idx] = { ...sections[s][idx], textBn: textBn.trim().slice(0, 300), sourceKind: "PRINCIPAL" };
      break;
    }
    return { sections, dropped: 0 };
  });
  if (!ok) throw new SupportProfileRefusal("প্রকাশিত সংস্করণ বদলানো যায় না — নতুন সংস্করণ করুন।");
  if (!found) throw new SupportProfileRefusal("বাক্যটি পাওয়া যায়নি।");
  return (await SupportProfileVersion.findById(oid(versionId)))!;
}

export interface HandItemInput {
  section: string;
  textBn: string;
  reportIds: string[];
  kind?: string | null;
  skillKey?: string | null;
  baselineBn?: string | null;
  expectedBn?: string | null;
  verbFirst?: boolean | null;
}

/** §6.7: the Principal writes a version by hand — every item must pick APPROVED reports of this child. */
export async function handVersion(ctx: SupportCtx, studentId: string, items: HandItemInput[], card?: { doItemIds?: string[]; strengthItemIds?: string[] } | null): Promise<ISupportProfileVersion> {
  const auth = await assertApprove(ctx);
  const p = await SupportProfile.findOne({ studentId: oid(studentId) });
  if (!p) throw new SupportProfileRefusal("প্রোফাইল পাওয়া যায়নি।");
  const today = dhakaDayKey(new Date());
  const sections = Object.fromEntries(SUPPORT_SECTIONS.map((s) => [s, [] as SupportItem[]])) as Record<SupportSection, SupportItem[]>;
  const refToId = new Map<number, string>();
  for (const [n, h] of items.entries()) {
    if (!(SUPPORT_SECTIONS as readonly string[]).includes(h.section)) throw new SupportProfileRefusal("অজানা অংশ।");
    await assertPlainText(h.textBn);
    await assertPlainText(h.baselineBn, true);
    await assertPlainText(h.expectedBn, true);
    if (h.kind && !(SUPPORT_STRATEGY_KINDS as readonly string[]).includes(h.kind)) throw new SupportProfileRefusal("অজানা ধরন।");
    if (h.skillKey && !(SUPPORT_SKILLS as readonly string[]).includes(h.skillKey)) throw new SupportProfileRefusal("অজানা দক্ষতা।");
    if (!h.reportIds.length) throw new SupportProfileRefusal("প্রতিটি বাক্যের জন্য অন্তত একটি অনুমোদিত রিপোর্ট বাছুন।");
    const itemId = `it_${randomBytes(5).toString("hex")}`;
    const draft: SupportItem = {
      itemId,
      textBn: h.textBn.trim().slice(0, 300),
      evidence: h.reportIds.filter((x) => Types.ObjectId.isValid(x)).map(oid),
      provisionalEvidence: [],
      counterEvidence: [],
      sourceKind: "PRINCIPAL",
      level: null,
      obsCount: 0,
      teachersCount: 0,
      settings: [],
      firstEvidenceKey: null,
      lastEvidenceKey: null,
      hasGuardianInfo: false,
      mixed: false,
      kind: h.kind ?? null,
      skillKey: h.skillKey ?? null,
      baselineBn: h.baselineBn ?? null,
      expectedBn: h.expectedBn ?? null,
      actionable: h.verbFirst ? { verbFirst: true, observable: true, specific: true, doable: true } : null,
    };
    const section = h.section as SupportSection;
    if (section === "goals" && (!draft.skillKey || !draft.baselineBn || !draft.expectedBn)) throw new SupportProfileRefusal("লক্ষ্যের জন্য দক্ষতা, এখনকার অবস্থা ও প্রত্যাশা লিখুন।");
    const r = await recompute(p._id, section, draft, today);
    if (!r) throw new SupportProfileRefusal("বাছাই করা রিপোর্টগুলো এই অংশের জন্য যথেষ্ট প্রমাণ নয় (বা অনুমোদিত নয়)।");
    sections[section].push(r);
    refToId.set(n, itemId);
  }
  if (sections.goals.length > SUPPORT_THRESHOLDS.maxActiveGoals) throw new SupportProfileRefusal("সর্বোচ্চ ২টি লক্ষ্য রাখা যায়।");
  const last = await SupportProfileVersion.findOne({ profileId: p._id }).sort({ versionNo: -1 }).select("versionNo").lean();
  const pick = (ids?: string[]) => (ids ?? []).map((i) => refToId.get(Number(i)) ?? i);
  return SupportProfileVersion.create({
    profileId: p._id,
    versionNo: (last?.versionNo ?? 0) + 1,
    status: "DRAFT",
    sections,
    card: { doItemIds: pick(card?.doItemIds), avoidItemIds: [], strengthItemIds: pick(card?.strengthItemIds), goalItemId: sections.goals[0]?.itemId ?? null },
    mode: "HAND",
    producer: "PRINCIPAL",
    createdBy: oid(auth.userId),
  });
}

/** History — versions of a child, newest first (paged). */
export async function versionsPage(ctx: SupportCtx, studentId: string, args: { page?: number | null; pageSize?: number | null }) {
  const auth = await supportCaller(ctx);
  if (!holdsViewAll(auth)) throw new SupportProfileRefusal("অনুমতি নেই।");
  const p = await SupportProfile.findOne({ studentId: oid(studentId) }).select("_id studentId").lean();
  if (!p) return { rows: [], total: 0, page: 1, pageSize: 20 };
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, args.pageSize ?? 20));
  const [rows, total] = await Promise.all([
    SupportProfileVersion.find({ profileId: p._id }).sort({ versionNo: -1 }).skip((page - 1) * pageSize).limit(pageSize),
    SupportProfileVersion.countDocuments({ profileId: p._id }),
  ]);
  await writeAudit({ eventKind: "SUPPORT_PROFILE_VIEWED", actorId: auth.userId, targetId: studentId, targetKind: "Student", meta: { studentId, versionNo: null, surface: "HISTORY", via: "QUEUE", readerVia: "PRINCIPAL" } });
  return { rows, total, page, pageSize };
}

export interface VersionDiff {
  added: string[];
  removed: string[];
  changed: { before: string; after: string }[];
}

/** The diff between two versions of one profile — by item id, then by text. */
export function diffVersions(a: ISupportProfileVersion, b: ISupportProfileVersion): VersionDiff {
  const items = (v: ISupportProfileVersion) => SUPPORT_SECTIONS.flatMap((s) => (v.sections[s] ?? []).map((i) => ({ id: i.itemId, text: i.textBn })));
  const A = items(a);
  const B = items(b);
  const aIds = new Map(A.map((i) => [i.id, i.text]));
  const bIds = new Map(B.map((i) => [i.id, i.text]));
  const added = B.filter((i) => !aIds.has(i.id) && !A.some((x) => x.text === i.text)).map((i) => i.text);
  const removed = A.filter((i) => !bIds.has(i.id) && !B.some((x) => x.text === i.text)).map((i) => i.text);
  const changed = B.filter((i) => aIds.has(i.id) && aIds.get(i.id) !== i.text).map((i) => ({ before: aIds.get(i.id)!, after: i.text }));
  return { added, removed, changed };
}

/** The diff of two versions of one child — PUBLISHED versions and the one open DRAFT only; audited as HISTORY. */
export async function versionDiff(ctx: SupportCtx, studentId: string, fromId: string, toId: string): Promise<VersionDiff> {
  const auth = await supportCaller(ctx);
  if (!holdsViewAll(auth)) throw new SupportProfileRefusal("অনুমতি নেই।");
  if (![studentId, fromId, toId].every((x) => Types.ObjectId.isValid(x))) throw new SupportProfileRefusal("ভুল আইডি।");
  const p = await SupportProfile.findOne({ studentId: oid(studentId) }).select("_id").lean();
  const [x, y] = await Promise.all([SupportProfileVersion.findById(oid(fromId)), SupportProfileVersion.findById(oid(toId))]);
  if (!p || !x || !y || String(x.profileId) !== String(p._id) || String(y.profileId) !== String(p._id)) throw new SupportProfileRefusal("সংস্করণ পাওয়া যায়নি।");
  if (![x, y].every((v) => v.status === "PUBLISHED" || v.status === "DRAFT")) throw new SupportProfileRefusal("বাতিল করা খসড়ার সঙ্গে তুলনা করা যায় না।");
  if (x.status === "DRAFT" && y.status === "DRAFT") throw new SupportProfileRefusal("দুটি খসড়ার তুলনা করা যায় না।");
  await writeAudit({ eventKind: "SUPPORT_PROFILE_VIEWED", actorId: auth.userId, targetId: studentId, targetKind: "Student", meta: { studentId, versionNo: null, versionNos: [x.versionNo, y.versionNo], surface: "HISTORY", via: "QUEUE", readerVia: "PRINCIPAL" } });
  return diffVersions(x, y);
}

/** কে পড়েছেন — reads of THIS child's profile, from the audit rows (paged). */
export async function readersPage(ctx: SupportCtx, studentId: string, args: { page?: number | null; pageSize?: number | null }) {
  const auth = await supportCaller(ctx);
  if (!holdsViewAll(auth)) throw new SupportProfileRefusal("অনুমতি নেই।");
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, args.pageSize ?? 50));
  const filter = { eventKind: "SUPPORT_PROFILE_VIEWED", targetId: studentId };
  const [rows, total] = await Promise.all([Audit.find(filter).sort({ _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(), Audit.countDocuments(filter)]);
  const names = new Map((await User.find({ _id: { $in: rows.map((r) => r.actorId).filter(Boolean) } }).select("name").lean()).map((u) => [String(u._id), u.name]));
  return {
    rows: rows.map((r) => {
      const meta = (r.meta ?? {}) as { surface?: string; via?: string };
      return { who: names.get(String(r.actorId)) ?? "", at: (r as unknown as { createdAt?: Date; at?: Date }).createdAt ?? (r as unknown as { at?: Date }).at ?? new Date(0), surface: meta.surface ?? "", via: meta.via ?? "" };
    }),
    total,
    page,
    pageSize,
  };
}

/** §11 / E-11: the Principal marks a goal's progress at a review (stored as a decision row). */
export async function markGoalProgress(ctx: SupportCtx, studentId: string, itemId: string, progress: string): Promise<boolean> {
  const auth = await assertApprove(ctx);
  // §8.1: goals sit under `manage` (LOCKED) — the Principal holds it; nobody else does.
  if (!callerHasPermission(auth, "support_profile:manage" as Permission)) throw new SupportProfileRefusal("লক্ষ্য নিয়ে কাজ করার অনুমতি নেই।");
  if (!["NOT_YET", "AS_EXPECTED", "MORE"].includes(progress)) throw new SupportProfileRefusal("অজানা অগ্রগতি।");
  const p = await SupportProfile.findOne({ studentId: oid(studentId) });
  if (!p?.currentVersionId) throw new SupportProfileRefusal("প্রকাশিত প্রোফাইল নেই।");
  const v = await SupportProfileVersion.findById(p.currentVersionId).lean();
  if (!(v?.sections.goals ?? []).some((g) => g.itemId === itemId)) throw new SupportProfileRefusal("লক্ষ্যটি পাওয়া যায়নি।");
  await SupportReview.create({ profileId: p._id, kind: "GOAL_PROGRESS", versionId: p.currentVersionId, decision: progress, reasonBn: itemId, by: oid(auth.userId), at: new Date() });
  return true;
}
