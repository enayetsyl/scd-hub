/**
 * WinterBookletService (D-#1620) — the winter-holiday booklets as editable text, a reviewer who
 * suggests edits page by page, and the Principal who accepts or rejects them.
 *
 *  - winter_task:review  see every booklet; add / edit / delete OWN OPEN suggestions and page notes.
 *  - winter_task:manage  accept / reject, mark APPROVED, export the accepted text.
 *
 * Rules worth knowing:
 *  - Suggestions CHAIN on the current text: a new suggestion's `before` is the block's current text
 *    (the newest accepted text, else the imported text), so an earlier acceptance is never dropped.
 *    Accepting a suggestion makes every other open suggestion on that block with a different
 *    `before` stale.
 *  - APPROVED locks the booklet: no suggest / edit / delete / decide until it is reopened.
 *  - Every status or text change is one atomic findOneAndUpdate guarded by the state the caller saw.
 *  - Import is a server script (scripts/import-winter-booklets.ts). A re-import that changes any text
 *    moves the booklet back to IN_REVIEW and re-judges every open / accepted suggestion (`classifyChanges`).
 * Nothing here touches identity data (no student / guardian joins except the reviewer's name).
 */
import { Types } from "mongoose";
import { ROSTER_CLASS_LABELS_BN, ROSTER_CLASS_LEVEL_MAX, ROSTER_CLASS_LEVEL_MIN, callerHasPermission } from "@scd/shared";
import type { RosterClassLevel } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import {
  WINTER_BLOCK_KINDS,
  WINTER_BOOKLET_STATUSES,
  WINTER_PAGE_KINDS,
  WinterBooklet,
  type IWinterBooklet,
  type IWinterPage,
  type WinterBookletStatus,
} from "../models/WinterBooklet";
import { WinterBookletChange, type IWinterBookletChange } from "../models/WinterBookletChange";

export const WINTER_ERRORS_BN = {
  forbidden: "এই কাজের অনুমতি নেই",
  notFound: "খাতাটি পাওয়া যায়নি",
  pageMissing: "এই পৃষ্ঠাটি খাতায় নেই",
  blockMissing: "এই লেখাটি পৃষ্ঠায় নেই",
  blockFixed: "এই অংশটি লেখা নয় — শুধু মন্তব্য দিন",
  nothingToSave: "বদলানো লেখা বা মন্তব্য দিন",
  same: "লেখাটি আগের মতোই আছে",
  tooLong: "লেখাটি অনেক বড়ো",
  changeMissing: "প্রস্তাবটি পাওয়া যায়নি",
  notOwn: "শুধু নিজের প্রস্তাব বদলানো যায়",
  notOpen: "প্রস্তাবটি আর খোলা নেই",
  stale: "খাতার লেখা বদলে গেছে — প্রস্তাবটি আবার দেখে নিন; এটি বাতিল করুন বা মুছুন",
  changed: "প্রস্তাবটি এর মধ্যে বদলে গেছে — পাতাটি আবার খুলে দেখুন",
  approvedLocked: "খাতাটি অনুমোদিত — আবার পর্যালোচনায় না নিলে প্রস্তাব বদলানো যায় না",
  badStatus: "অবস্থা ঠিক নয়",
} as const;

export const MAX_TEXT = 2000;
export const MAX_NOTE = 1000;
export const MAX_PAGES = 60;
export const MAX_BLOCKS_PER_PAGE = 400;
export const MAX_BLOCKS = 3000;

const canManage = (ctx: AppContext): boolean => !!ctx.auth && callerHasPermission(ctx.auth, "winter_task:manage");
const canReview = (ctx: AppContext): boolean => !!ctx.auth && callerHasPermission(ctx.auth, "winter_task:review");

function requireAny(ctx: AppContext): { userId: string; manage: boolean } {
  if (!ctx.auth || (!canManage(ctx) && !canReview(ctx))) throw new ForbiddenError(WINTER_ERRORS_BN.forbidden);
  return { userId: ctx.auth.userId, manage: canManage(ctx) };
}
function requireManage(ctx: AppContext): string {
  if (!canManage(ctx)) throw new ForbiddenError(WINTER_ERRORS_BN.forbidden);
  return ctx.auth!.userId;
}

// ---------------------------------------------------------------------------
// Import payload (pure validation — shared by the script and the tests)
// ---------------------------------------------------------------------------

export interface WinterImportPayload {
  code: string;
  classLevel: number;
  titleBn: string;
  version: number;
  pages: IWinterPage[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Validate the exported JSON. Returns the clean payload or a list of problems (English, for the operator). */
export function validateWinterImport(raw: unknown): { ok: true; payload: WinterImportPayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["not an object"] };
  const code = typeof raw.code === "string" ? raw.code.trim() : "";
  if (!code || code.length > 40) errors.push("code missing or too long");
  const classLevel = raw.classLevel;
  if (typeof classLevel !== "number" || !Number.isInteger(classLevel) || classLevel < ROSTER_CLASS_LEVEL_MIN || classLevel > ROSTER_CLASS_LEVEL_MAX) {
    errors.push("classLevel must be an integer " + ROSTER_CLASS_LEVEL_MIN + ".." + ROSTER_CLASS_LEVEL_MAX);
  }
  const titleBn = typeof raw.titleBn === "string" ? raw.titleBn.trim() : "";
  if (!titleBn) errors.push("titleBn missing");
  const version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) errors.push("version must be an integer >= 1");
  const pagesIn = Array.isArray(raw.pages) ? raw.pages : null;
  if (!pagesIn || pagesIn.length === 0) errors.push("pages missing");
  else if (pagesIn.length > MAX_PAGES) errors.push(`too many pages (max ${MAX_PAGES})`);
  const pages: IWinterPage[] = [];
  const seenPages = new Set<number>();
  const seenBlocks = new Set<string>();
  (pagesIn ?? []).slice(0, MAX_PAGES).forEach((p, pi) => {
    if (!isObj(p)) return void errors.push(`pages[${pi}] not an object`);
    const n = p.n;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) return void errors.push(`pages[${pi}].n invalid`);
    if (seenPages.has(n)) errors.push(`page ${n} repeated`);
    seenPages.add(n);
    if (!(WINTER_PAGE_KINDS as readonly string[]).includes(p.kind as string)) errors.push(`page ${n}: bad kind`);
    if (p.dateKey !== undefined && (typeof p.dateKey !== "string" || !DATE_KEY.test(p.dateKey))) errors.push(`page ${n}: dateKey must be YYYY-MM-DD`);
    if (p.week !== undefined && (typeof p.week !== "number" || !Number.isInteger(p.week) || p.week < 1 || p.week > 10)) errors.push(`page ${n}: week must be 1..10`);
    if (p.subject !== undefined && (typeof p.subject !== "string" || p.subject.length > 100)) errors.push(`page ${n}: subject invalid`);
    const blocksIn = Array.isArray(p.blocks) ? p.blocks : null;
    if (!blocksIn) return void errors.push(`page ${n}: blocks missing`);
    if (blocksIn.length > MAX_BLOCKS_PER_PAGE) return void errors.push(`page ${n}: too many blocks (max ${MAX_BLOCKS_PER_PAGE})`);
    const blocks: IWinterPage["blocks"] = [];
    blocksIn.forEach((b, bi) => {
      if (!isObj(b)) return void errors.push(`page ${n} block ${bi} not an object`);
      const id = typeof b.id === "string" ? b.id.trim() : "";
      if (!id || id.length > 100) return void errors.push(`page ${n} block ${bi}: id missing or too long`);
      if (seenBlocks.has(id)) errors.push(`block id ${id} repeated`);
      seenBlocks.add(id);
      if (!(WINTER_BLOCK_KINDS as readonly string[]).includes(b.kind as string)) errors.push(`block ${id}: bad kind`);
      if (typeof b.textBn !== "string") errors.push(`block ${id}: textBn must be a string`);
      else if (b.textBn.length > MAX_TEXT) errors.push(`block ${id}: textBn longer than ${MAX_TEXT}`);
      if (b.labelBn !== undefined && (typeof b.labelBn !== "string" || b.labelBn.length > 200)) errors.push(`block ${id}: labelBn invalid`);
      blocks.push({
        id,
        kind: b.kind as IWinterPage["blocks"][number]["kind"],
        textBn: typeof b.textBn === "string" ? b.textBn : "",
        ...(typeof b.labelBn === "string" && b.labelBn ? { labelBn: b.labelBn } : {}),
      });
    });
    pages.push({
      n,
      kind: p.kind as IWinterPage["kind"],
      ...(typeof p.dateKey === "string" && p.dateKey ? { dateKey: p.dateKey } : {}),
      ...(typeof p.subject === "string" && p.subject ? { subject: p.subject } : {}),
      ...(typeof p.week === "number" ? { week: p.week } : {}),
      blocks,
    });
  });
  if (seenBlocks.size > MAX_BLOCKS) errors.push(`too many blocks (max ${MAX_BLOCKS})`);
  if (errors.length) return { ok: false, errors };
  pages.sort((a, b) => a.n - b.n);
  return { ok: true, payload: { code, classLevel: classLevel as number, titleBn, version: version as number, pages } };
}

// ---------------------------------------------------------------------------
// Judging suggestions against the booklet text (pure)
// ---------------------------------------------------------------------------

export type ChangeVerdict = "ok" | "absorbed" | "lost";

export interface JudgeableChange {
  id: string;
  pageN: number;
  blockId: string | null;
  before: string;
  after: string;
  status: string;
  decidedAt?: Date | null;
}

function blockTextMap(pages: IWinterPage[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of pages) for (const b of p.blocks) m.set(b.id, b.textBn);
  return m;
}

/**
 * Judge every OPEN / ACCEPTED suggestion against `pages`. Accepted ones are walked per block in
 * decision order as a chain from the imported text: a link whose `before` is the running text is
 * "ok" (the running text becomes its `after`); a link whose `after` already equals the running text
 * is "absorbed" (the new import already contains it); anything else is "lost". An OPEN suggestion is
 * "ok" only when its `before` is the block's current text (after the accepted chain); a note is "ok"
 * while its page exists. Also returns the current text of every block.
 */
export function classifyChanges(pages: IWinterPage[], changes: JudgeableChange[]): { verdicts: Map<string, ChangeVerdict>; current: Map<string, string> } {
  const current = blockTextMap(pages);
  const pageNs = new Set(pages.map((p) => p.n));
  const verdicts = new Map<string, ChangeVerdict>();
  const accepted = changes
    .filter((c) => c.status === "ACCEPTED" && c.blockId !== null)
    .sort((a, b) => (a.decidedAt?.getTime() ?? 0) - (b.decidedAt?.getTime() ?? 0));
  for (const c of accepted) {
    const run = current.get(c.blockId as string);
    if (run === undefined) verdicts.set(c.id, "lost");
    else if (c.before === run) {
      verdicts.set(c.id, "ok");
      current.set(c.blockId as string, c.after);
    } else verdicts.set(c.id, c.after === run ? "absorbed" : "lost");
  }
  for (const c of changes) {
    if (verdicts.has(c.id)) continue;
    if (c.blockId === null) verdicts.set(c.id, pageNs.has(c.pageN) ? "ok" : "lost");
    else {
      const run = current.get(c.blockId);
      verdicts.set(c.id, run !== undefined && c.before === run ? "ok" : run !== undefined && c.after === run ? "absorbed" : "lost");
    }
  }
  return { verdicts, current };
}

const judgeable = (c: IWinterBookletChange): JudgeableChange => ({
  id: c._id.toString(),
  pageN: c.pageN,
  blockId: c.blockId ?? null,
  before: c.before,
  after: c.after,
  status: c.status,
  decidedAt: c.decidedAt ?? null,
});

/** The newest valid accepted text per block (chain order). */
function acceptedTexts(accepted: IWinterBookletChange[]): Map<string, string> {
  const m = new Map<string, string>();
  const sorted = [...accepted].sort((a, b) => (a.decidedAt?.getTime() ?? 0) - (b.decidedAt?.getTime() ?? 0));
  for (const c of sorted) if (c.blockId && !c.stale) m.set(c.blockId, c.after);
  return m;
}

async function acceptedFor(bookletId: Types.ObjectId): Promise<Map<string, string>> {
  const rows = (await WinterBookletChange.find({ bookletId, status: "ACCEPTED", blockId: { $ne: null } }).lean()) as unknown as IWinterBookletChange[];
  return acceptedTexts(rows);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface WinterImportReport {
  code: string;
  mode: "create" | "update";
  pages: number;
  blocks: number;
  version: number;
  keptChanges: number;
  staleChanges: number;
  /** Accepted suggestions whose `after` is already the new text (nothing lost). */
  absorbedAccepted: number;
  /** Accepted suggestions whose text is NOT in the new import — block ids, to re-apply by hand. */
  lostAccepted: string[];
  /** The booklet was APPROVED / DRAFT and a text changed: back to IN_REVIEW. */
  statusReset: boolean;
}

function textsDiffer(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return true;
  for (const [k, v] of a) if (b.get(k) !== v) return true;
  return false;
}

/** Create or replace a booklet from the exported JSON. `apply` false = report only (nothing written). */
export async function importWinterBooklet(payload: WinterImportPayload, opts: { apply: boolean; actorId?: string }): Promise<WinterImportReport> {
  const existing = await WinterBooklet.findOne({ code: payload.code });
  const blocks = payload.pages.reduce((n, p) => n + p.blocks.length, 0);
  const live = existing ? await WinterBookletChange.find({ bookletId: existing._id, status: { $in: ["OPEN", "ACCEPTED"] } }) : [];
  const { verdicts } = classifyChanges(payload.pages, live.map(judgeable));
  let kept = 0;
  let stale = 0;
  let absorbed = 0;
  const lost: string[] = [];
  for (const c of live) {
    const v = verdicts.get(c._id.toString())!;
    if (v === "ok") kept++;
    else stale++;
    if (c.status === "ACCEPTED") {
      if (v === "absorbed") absorbed++;
      if (v === "lost") lost.push(c.blockId ?? `page-${c.pageN}`);
    }
  }
  const changedText = !!existing && textsDiffer(blockTextMap(existing.pages), blockTextMap(payload.pages));
  const statusReset = !!existing && changedText && existing.status !== "IN_REVIEW";
  const report: WinterImportReport = {
    code: payload.code,
    mode: existing ? "update" : "create",
    pages: payload.pages.length,
    blocks,
    version: payload.version,
    keptChanges: kept,
    staleChanges: stale,
    absorbedAccepted: absorbed,
    lostAccepted: lost,
    statusReset,
  };
  if (!opts.apply) return report;

  const doc =
    existing ??
    new WinterBooklet({ code: payload.code, classLevel: payload.classLevel, titleBn: payload.titleBn, status: "IN_REVIEW" });
  doc.classLevel = payload.classLevel;
  doc.titleBn = payload.titleBn;
  doc.version = payload.version;
  doc.pages = payload.pages;
  if (statusReset) doc.status = "IN_REVIEW";
  await doc.save();
  // Un-stale first (a restored text), then stale: keeps the partial unique index (one live OPEN per person per block) happy.
  const order = [...live].sort((a, b) => Number(b.stale) - Number(a.stale));
  for (const c of order) {
    const s = verdicts.get(c._id.toString())! !== "ok";
    if (c.stale === s) continue;
    try {
      await WinterBookletChange.updateOne({ _id: c._id }, { $set: { stale: s } });
    } catch {
      // a duplicate live suggestion by the same person on the block: leave this one stale
    }
  }
  await writeAudit({
    eventKind: "WINTER_BOOKLET_IMPORTED",
    actorId: opts.actorId,
    targetId: doc._id,
    targetKind: "WinterBooklet",
    meta: { code: payload.code, version: payload.version, pages: report.pages, blocks, kept, stale, absorbed, lostAccepted: lost.slice(0, 30), statusReset },
  });
  return report;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface WinterBookletRow {
  id: string;
  code: string;
  classLevel: number;
  classLabelBn: string;
  titleBn: string;
  version: number;
  status: string;
  pageCount: number;
  /** Review: my open suggestions. Manage: everyone's open suggestions. */
  openChanges: number;
  acceptedChanges: number;
}

export interface WinterChangeRow {
  id: string;
  bookletId: string;
  pageN: number;
  blockId: string | null;
  before: string;
  after: string;
  note: string | null;
  byName: string;
  mine: boolean;
  status: string;
  stale: boolean;
  createdAt: string;
  editedAt: string | null;
}

function classLabel(level: number): string {
  return ROSTER_CLASS_LABELS_BN[level as RosterClassLevel] ?? String(level);
}

export async function listWinterBooklets(ctx: AppContext): Promise<WinterBookletRow[]> {
  const { userId, manage } = requireAny(ctx);
  const books = await WinterBooklet.find({}).sort({ classLevel: 1 }).lean();
  if (books.length === 0) return [];
  const counts = await WinterBookletChange.aggregate<{ _id: { b: Types.ObjectId; s: string }; n: number }>([
    { $match: { bookletId: { $in: books.map((b) => b._id) }, status: { $in: ["OPEN", "ACCEPTED"] }, ...(manage ? {} : { by: new Types.ObjectId(userId) }) } },
    { $group: { _id: { b: "$bookletId", s: "$status" }, n: { $sum: 1 } } },
  ]);
  const get = (id: Types.ObjectId, s: string) => counts.find((c) => c._id.b.equals(id) && c._id.s === s)?.n ?? 0;
  return books.map((b) => ({
    id: b._id.toString(),
    code: b.code,
    classLevel: b.classLevel,
    classLabelBn: classLabel(b.classLevel),
    titleBn: b.titleBn,
    version: b.version,
    status: b.status,
    pageCount: b.pages.length,
    openChanges: get(b._id, "OPEN"),
    acceptedChanges: get(b._id, "ACCEPTED"),
  }));
}

export interface WinterBookletDetail {
  id: string;
  code: string;
  classLevel: number;
  classLabelBn: string;
  titleBn: string;
  version: number;
  status: string;
  /** JSON: pages [{ n, kind, dateKey?, subject?, week?, blocks: [{ id, kind, textBn, labelBn?, acceptedBn? }] }] */
  pagesJson: string;
}

export async function getWinterBooklet(ctx: AppContext, id: string): Promise<WinterBookletDetail> {
  requireAny(ctx);
  const b = Types.ObjectId.isValid(id) ? await WinterBooklet.findById(id).lean() : null;
  if (!b) throw new Error(WINTER_ERRORS_BN.notFound);
  const acc = await acceptedFor(b._id);
  const pages = b.pages.map((p) => ({
    ...p,
    blocks: p.blocks.map((k) => (acc.has(k.id) && acc.get(k.id) !== k.textBn ? { ...k, acceptedBn: acc.get(k.id) } : k)),
  }));
  return {
    id: b._id.toString(),
    code: b.code,
    classLevel: b.classLevel,
    classLabelBn: classLabel(b.classLevel),
    titleBn: b.titleBn,
    version: b.version,
    status: b.status,
    pagesJson: JSON.stringify(pages),
  };
}

function changeRow(c: IWinterBookletChange, names: Map<string, string>, me: string): WinterChangeRow {
  return {
    id: c._id.toString(),
    bookletId: c.bookletId.toString(),
    pageN: c.pageN,
    blockId: c.blockId ?? null,
    before: c.before,
    after: c.after,
    note: c.note ?? null,
    byName: names.get(c.by.toString()) ?? "",
    mine: c.by.toString() === me,
    status: c.status,
    stale: !!c.stale,
    createdAt: new Date(c.createdAt).toISOString(),
    editedAt: c.editedAt ? new Date(c.editedAt).toISOString() : null,
  };
}

async function namesOf(ids: Types.ObjectId[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.map((i) => i.toString()))];
  const users = await User.find({ _id: { $in: uniq } }, { name: 1 }).lean();
  return new Map(users.map((u) => [u._id.toString(), u.name]));
}

/** Review: my suggestions (not deleted). Manage: everyone's. Optional page filter. */
export async function winterChanges(ctx: AppContext, bookletId: string, pageN?: number | null): Promise<WinterChangeRow[]> {
  const { userId, manage } = requireAny(ctx);
  if (!Types.ObjectId.isValid(bookletId)) return [];
  const q: Record<string, unknown> = { bookletId: new Types.ObjectId(bookletId), status: { $ne: "DELETED" } };
  if (!manage) q.by = new Types.ObjectId(userId);
  if (pageN != null) q.pageN = pageN;
  const rows = await WinterBookletChange.find(q).sort({ pageN: 1, createdAt: 1 });
  const names = await namesOf(rows.map((r) => r.by));
  return rows.map((r) => changeRow(r, names, userId));
}

// ---------------------------------------------------------------------------
// Reviewer writes
// ---------------------------------------------------------------------------

export interface SuggestInput {
  bookletId: string;
  pageN: number;
  blockId?: string | null;
  /** The new text; "" removes the text. Omit for a page note. */
  after?: string | null;
  note?: string | null;
}

const clean = (s: string | null | undefined): string => (s ?? "").replace(/\r\n/g, "\n").trim();

function assertUnlocked(b: { status: string }): void {
  if (b.status === "APPROVED") throw new Error(WINTER_ERRORS_BN.approvedLocked);
}

const isDup = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { code?: number }).code === 11000;

export async function suggestWinterChange(ctx: AppContext, input: SuggestInput): Promise<WinterChangeRow> {
  const { userId } = requireAny(ctx);
  const booklet = Types.ObjectId.isValid(input.bookletId) ? await WinterBooklet.findById(input.bookletId) : null;
  if (!booklet) throw new Error(WINTER_ERRORS_BN.notFound);
  assertUnlocked(booklet);
  const page = booklet.pages.find((p) => p.n === input.pageN);
  if (!page) throw new Error(WINTER_ERRORS_BN.pageMissing);
  const note = clean(input.note);
  if (note.length > MAX_NOTE) throw new Error(WINTER_ERRORS_BN.tooLong);
  const blockId = input.blockId ? input.blockId : null;
  const me = new Types.ObjectId(userId);

  if (blockId === null) {
    if (!note) throw new Error(WINTER_ERRORS_BN.nothingToSave);
    const row = await WinterBookletChange.create({ bookletId: booklet._id, pageN: page.n, blockId: null, before: "", after: "", note, by: me });
    await writeAudit({ eventKind: "WINTER_CHANGE_SUGGESTED", actorId: userId, targetId: row._id, targetKind: "WinterBookletChange", meta: { bookletId: input.bookletId, pageN: page.n, blockId: null, noteLen: note.length } });
    return changeRow(row, await namesOf([row.by]), userId);
  }

  const block = page.blocks.find((b) => b.id === blockId);
  if (!block) throw new Error(WINTER_ERRORS_BN.blockMissing);
  if (block.kind === "line") throw new Error(WINTER_ERRORS_BN.blockFixed);
  // The text the reviewer is looking at: the newest accepted text, else the imported text.
  const currentText = (await acceptedFor(booklet._id)).get(blockId) ?? block.textBn;
  const hasAfter = input.after !== undefined && input.after !== null;
  const after = hasAfter ? clean(input.after) : currentText;
  if (after.length > MAX_TEXT) throw new Error(WINTER_ERRORS_BN.tooLong);
  if (after === currentText.trim() && !note) throw new Error(WINTER_ERRORS_BN.same);

  // One live OPEN suggestion per person per block: a second tap edits it (unique partial index backs this).
  const editMine = async (): Promise<IWinterBookletChange | null> =>
    WinterBookletChange.findOneAndUpdate(
      { bookletId: booklet._id, blockId, by: me, status: "OPEN", stale: false },
      { $set: { after, before: currentText, note: note || null, editedAt: new Date() } },
      { new: true },
    );
  let row = await editMine();
  if (row) {
    await writeAudit({ eventKind: "WINTER_CHANGE_EDITED", actorId: userId, targetId: row._id, targetKind: "WinterBookletChange", meta: { bookletId: input.bookletId, pageN: page.n, blockId, afterLen: after.length } });
    return changeRow(row, await namesOf([row.by]), userId);
  }
  try {
    row = await WinterBookletChange.create({ bookletId: booklet._id, pageN: page.n, blockId, before: currentText, after, note: note || undefined, by: me });
  } catch (e) {
    if (!isDup(e)) throw e;
    row = await editMine(); // a double tap created it a moment ago
    if (!row) throw new Error(WINTER_ERRORS_BN.changed);
  }
  await writeAudit({ eventKind: "WINTER_CHANGE_SUGGESTED", actorId: userId, targetId: row._id, targetKind: "WinterBookletChange", meta: { bookletId: input.bookletId, pageN: page.n, blockId, beforeLen: currentText.length, afterLen: after.length } });
  return changeRow(row, await namesOf([row.by]), userId);
}

/** Why an atomic own-OPEN update found nothing: re-read the row and say so. */
async function explainMiss(id: string, userId: string, needFresh: boolean): Promise<never> {
  const row = Types.ObjectId.isValid(id) ? await WinterBookletChange.findById(id) : null;
  if (!row) throw new Error(WINTER_ERRORS_BN.changeMissing);
  if (row.by.toString() !== userId) throw new ForbiddenError(WINTER_ERRORS_BN.notOwn);
  const b = await WinterBooklet.findById(row.bookletId).lean();
  if (b) assertUnlocked(b);
  if (row.status !== "OPEN") throw new Error(WINTER_ERRORS_BN.notOpen);
  if (needFresh && row.stale) throw new Error(WINTER_ERRORS_BN.stale);
  throw new Error(WINTER_ERRORS_BN.changed);
}

async function assertBookletUnlockedFor(id: string): Promise<IWinterBookletChange> {
  const row = Types.ObjectId.isValid(id) ? await WinterBookletChange.findById(id) : null;
  if (!row) throw new Error(WINTER_ERRORS_BN.changeMissing);
  const b = await WinterBooklet.findById(row.bookletId).lean();
  if (b) assertUnlocked(b);
  return row;
}

export async function editWinterChange(ctx: AppContext, id: string, input: { after?: string | null; note?: string | null }): Promise<WinterChangeRow> {
  const { userId } = requireAny(ctx);
  const cur = await assertBookletUnlockedFor(id);
  if (cur.by.toString() !== userId) throw new ForbiddenError(WINTER_ERRORS_BN.notOwn);
  if (cur.status !== "OPEN") throw new Error(WINTER_ERRORS_BN.notOpen);
  if (cur.stale) throw new Error(WINTER_ERRORS_BN.stale);
  const note = clean(input.note);
  if (note.length > MAX_NOTE) throw new Error(WINTER_ERRORS_BN.tooLong);
  const set: Record<string, unknown> = { editedAt: new Date() };
  if (cur.blockId === null) {
    if (!note) throw new Error(WINTER_ERRORS_BN.nothingToSave);
    set.note = note;
  } else {
    if (input.after !== undefined && input.after !== null) {
      const after = clean(input.after);
      if (after.length > MAX_TEXT) throw new Error(WINTER_ERRORS_BN.tooLong);
      if (after === cur.before.trim() && !note) throw new Error(WINTER_ERRORS_BN.same);
      set.after = after;
    }
    set.note = note || null;
  }
  const row = await WinterBookletChange.findOneAndUpdate({ _id: cur._id, by: new Types.ObjectId(userId), status: "OPEN", stale: false }, { $set: set }, { new: true });
  if (!row) return explainMiss(id, userId, true);
  await writeAudit({ eventKind: "WINTER_CHANGE_EDITED", actorId: userId, targetId: row._id, targetKind: "WinterBookletChange", meta: { bookletId: row.bookletId.toString(), pageN: row.pageN, blockId: row.blockId, prevAfterLen: cur.after.length, afterLen: row.after.length } });
  return changeRow(row, await namesOf([row.by]), userId);
}

export async function deleteWinterChange(ctx: AppContext, id: string): Promise<boolean> {
  const { userId } = requireAny(ctx);
  const cur = await assertBookletUnlockedFor(id);
  const row = await WinterBookletChange.findOneAndUpdate({ _id: cur._id, by: new Types.ObjectId(userId), status: "OPEN" }, { $set: { status: "DELETED" } }, { new: true });
  if (!row) return explainMiss(id, userId, false);
  await writeAudit({ eventKind: "WINTER_CHANGE_DELETED", actorId: userId, targetId: row._id, targetKind: "WinterBookletChange", meta: { bookletId: row.bookletId.toString(), pageN: row.pageN, blockId: row.blockId } });
  return true;
}

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

/**
 * Accept or reject one suggestion. `seenVersion` is the `editedAt` the Principal saw ("" = never
 * edited): if the reviewer changed it since, nothing happens. An accept also needs the suggestion's
 * `before` to be the block's CURRENT text (accepted chain, else imported), and then makes every other
 * open suggestion on that block with a different `before` stale.
 */
export async function decideWinterChange(ctx: AppContext, id: string, accept: boolean, seenVersion: string): Promise<WinterChangeRow> {
  const userId = requireManage(ctx);
  const cur = await assertBookletUnlockedFor(id);
  if (cur.status !== "OPEN") throw new Error(WINTER_ERRORS_BN.notOpen);
  if (accept && cur.stale) throw new Error(WINTER_ERRORS_BN.stale);
  const seen = seenVersion ? new Date(seenVersion) : null;
  if (seen && Number.isNaN(seen.getTime())) throw new Error(WINTER_ERRORS_BN.changed);
  const editedAtMatch = seen ? { editedAt: seen } : { editedAt: null };

  if (accept && cur.blockId !== null) {
    const booklet = await WinterBooklet.findById(cur.bookletId).lean();
    const block = booklet?.pages.flatMap((p) => p.blocks).find((b) => b.id === cur.blockId);
    const currentText = (await acceptedFor(cur.bookletId)).get(cur.blockId) ?? block?.textBn;
    if (currentText === undefined || cur.before !== currentText) {
      await WinterBookletChange.updateOne({ _id: cur._id, status: "OPEN" }, { $set: { stale: true } });
      throw new Error(WINTER_ERRORS_BN.stale);
    }
  }
  const row = await WinterBookletChange.findOneAndUpdate(
    { _id: cur._id, status: "OPEN", ...(accept ? { stale: false } : {}), ...editedAtMatch, after: cur.after, before: cur.before },
    { $set: { status: accept ? "ACCEPTED" : "REJECTED", decidedBy: new Types.ObjectId(userId), decidedAt: new Date() } },
    { new: true },
  );
  if (!row) {
    const now = await WinterBookletChange.findById(id);
    if (!now || now.status !== "OPEN") throw new Error(WINTER_ERRORS_BN.notOpen);
    throw new Error(now.stale ? WINTER_ERRORS_BN.stale : WINTER_ERRORS_BN.changed);
  }
  if (accept && row.blockId !== null) {
    // Others that were built on the old text no longer line up.
    await WinterBookletChange.updateMany(
      { bookletId: row.bookletId, blockId: row.blockId, status: "OPEN", _id: { $ne: row._id }, before: { $ne: row.after } },
      { $set: { stale: true } },
    );
  }
  await writeAudit({ eventKind: "WINTER_CHANGE_DECIDED", actorId: userId, targetId: row._id, targetKind: "WinterBookletChange", meta: { accepted: accept, bookletId: row.bookletId.toString(), pageN: row.pageN, blockId: row.blockId } });
  return changeRow(row, await namesOf([row.by]), userId);
}

export async function setWinterBookletStatus(ctx: AppContext, id: string, status: string): Promise<WinterBookletRow> {
  const userId = requireManage(ctx);
  if (!(WINTER_BOOKLET_STATUSES as readonly string[]).includes(status)) throw new Error(WINTER_ERRORS_BN.badStatus);
  const b = Types.ObjectId.isValid(id) ? await WinterBooklet.findById(id) : null;
  if (!b) throw new Error(WINTER_ERRORS_BN.notFound);
  const before = b.status;
  b.status = status as WinterBookletStatus;
  await b.save();
  await writeAudit({ eventKind: "WINTER_BOOKLET_STATUS", actorId: userId, targetId: b._id, targetKind: "WinterBooklet", meta: { before, after: status } });
  const rows = await listWinterBooklets(ctx);
  return rows.find((r) => r.id === id)!;
}

/**
 * The booklet in the import shape with the accepted suggestions applied in decision order (each on top
 * of the last), the page notes, the accepted edits, and the accepted edits that no longer line up
 * (`staleAccepted`) — what the build step needs to rebuild the PDF.
 */
export async function exportAcceptedWinterBooklet(ctx: AppContext, id: string): Promise<string> {
  requireManage(ctx);
  const b = Types.ObjectId.isValid(id) ? await WinterBooklet.findById(id).lean() : null;
  if (!b) throw new Error(WINTER_ERRORS_BN.notFound);
  const accepted = (await WinterBookletChange.find({ bookletId: b._id, status: "ACCEPTED" }).sort({ decidedAt: 1 }).lean()) as unknown as IWinterBookletChange[];
  const acc = acceptedTexts(accepted);
  const notes = (await WinterBookletChange.find({ bookletId: b._id, blockId: null, status: { $in: ["OPEN", "ACCEPTED"] } }).lean()) as unknown as IWinterBookletChange[];
  const row = (c: IWinterBookletChange) => ({ pageN: c.pageN, blockId: c.blockId, before: c.before, after: c.after, note: c.note ?? null });
  const out = {
    code: b.code,
    classLevel: b.classLevel,
    titleBn: b.titleBn,
    version: b.version,
    status: b.status,
    pages: b.pages.map((p) => ({ ...p, blocks: p.blocks.map((k) => (acc.has(k.id) ? { ...k, textBn: acc.get(k.id)! } : k)) })),
    acceptedChanges: accepted.filter((c) => c.blockId && !c.stale).map(row),
    staleAccepted: accepted.filter((c) => c.blockId && c.stale).map(row),
    pageNotes: notes.map((c) => ({ pageN: c.pageN, note: c.note ?? "", status: c.status })),
  };
  return JSON.stringify(out, null, 1);
}

export type { IWinterBooklet };
