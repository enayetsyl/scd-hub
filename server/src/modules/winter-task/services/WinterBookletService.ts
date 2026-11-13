/**
 * WinterBookletService (D-#1620) — the winter-holiday booklets as editable text, a reviewer who
 * suggests edits page by page, and the Principal who accepts or rejects them.
 *
 *  - winter_task:review  see every booklet; add / edit / delete OWN OPEN suggestions and page notes.
 *  - winter_task:manage  import, accept / reject, mark APPROVED, export the accepted text.
 *
 * Import is a server script (scripts/import-winter-booklets.ts), not a screen. A re-import keeps a
 * suggestion whose block id and `before` text still match the new text; any other becomes `stale`.
 * Nothing here touches identity data (no student / guardian / staff joins except the reviewer's name).
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
  badStatus: "অবস্থা ঠিক নয়",
} as const;

export const MAX_TEXT = 2000;
export const MAX_NOTE = 1000;

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

/** Validate the exported JSON. Returns the clean payload or a list of problems (English, for the operator). */
export function validateWinterImport(raw: unknown): { ok: true; payload: WinterImportPayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["not an object"] };
  const code = typeof raw.code === "string" ? raw.code.trim() : "";
  if (!code) errors.push("code missing");
  const classLevel = raw.classLevel;
  if (typeof classLevel !== "number" || !Number.isInteger(classLevel) || classLevel < ROSTER_CLASS_LEVEL_MIN || classLevel > ROSTER_CLASS_LEVEL_MAX) {
    errors.push("classLevel must be an integer " + ROSTER_CLASS_LEVEL_MIN + ".." + ROSTER_CLASS_LEVEL_MAX);
  }
  const titleBn = typeof raw.titleBn === "string" ? raw.titleBn.trim() : "";
  if (!titleBn) errors.push("titleBn missing");
  const version = typeof raw.version === "number" && Number.isInteger(raw.version) && raw.version >= 1 ? raw.version : 1;
  const pagesIn = Array.isArray(raw.pages) ? raw.pages : null;
  if (!pagesIn || pagesIn.length === 0) errors.push("pages missing");
  const pages: IWinterPage[] = [];
  const seenPages = new Set<number>();
  const seenBlocks = new Set<string>();
  (pagesIn ?? []).forEach((p, pi) => {
    if (!isObj(p)) return void errors.push(`pages[${pi}] not an object`);
    const n = p.n;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) return void errors.push(`pages[${pi}].n invalid`);
    if (seenPages.has(n)) errors.push(`page ${n} repeated`);
    seenPages.add(n);
    if (!(WINTER_PAGE_KINDS as readonly string[]).includes(p.kind as string)) errors.push(`page ${n}: bad kind`);
    const blocksIn = Array.isArray(p.blocks) ? p.blocks : null;
    if (!blocksIn) return void errors.push(`page ${n}: blocks missing`);
    const blocks: IWinterPage["blocks"] = [];
    blocksIn.forEach((b, bi) => {
      if (!isObj(b)) return void errors.push(`page ${n} block ${bi} not an object`);
      const id = typeof b.id === "string" ? b.id.trim() : "";
      if (!id) return void errors.push(`page ${n} block ${bi}: id missing`);
      if (seenBlocks.has(id)) errors.push(`block id ${id} repeated`);
      seenBlocks.add(id);
      if (!(WINTER_BLOCK_KINDS as readonly string[]).includes(b.kind as string)) errors.push(`block ${id}: bad kind`);
      if (typeof b.textBn !== "string") errors.push(`block ${id}: textBn must be a string`);
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
  if (errors.length) return { ok: false, errors };
  pages.sort((a, b) => a.n - b.n);
  return { ok: true, payload: { code, classLevel: classLevel as number, titleBn, version, pages } };
}

export interface WinterImportReport {
  code: string;
  mode: "create" | "update";
  pages: number;
  blocks: number;
  version: number;
  keptChanges: number;
  staleChanges: number;
}

function blockTextMap(pages: IWinterPage[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of pages) for (const b of p.blocks) m.set(b.id, b.textBn);
  return m;
}

/** Whether a change still lines up with the booklet's (new) text. Pure. */
export function changeIsStale(c: { blockId: string | null; pageN: number; before: string }, texts: Map<string, string>, pageNs: Set<number>): boolean {
  if (c.blockId === null) return !pageNs.has(c.pageN);
  const now = texts.get(c.blockId);
  return now === undefined || now !== c.before;
}

/** Create or replace a booklet from the exported JSON. `apply` false = report only (nothing written). */
export async function importWinterBooklet(payload: WinterImportPayload, opts: { apply: boolean; actorId?: string }): Promise<WinterImportReport> {
  const existing = await WinterBooklet.findOne({ code: payload.code });
  const blocks = payload.pages.reduce((n, p) => n + p.blocks.length, 0);
  const texts = blockTextMap(payload.pages);
  const pageNs = new Set(payload.pages.map((p) => p.n));
  let kept = 0;
  let stale = 0;
  const live = existing ? await WinterBookletChange.find({ bookletId: existing._id, status: { $in: ["OPEN", "ACCEPTED"] } }) : [];
  for (const c of live) (changeIsStale(c, texts, pageNs) ? stale++ : kept++);
  const report: WinterImportReport = {
    code: payload.code,
    mode: existing ? "update" : "create",
    pages: payload.pages.length,
    blocks,
    version: payload.version,
    keptChanges: kept,
    staleChanges: stale,
  };
  if (!opts.apply) return report;

  const doc =
    existing ??
    new WinterBooklet({ code: payload.code, classLevel: payload.classLevel, titleBn: payload.titleBn, status: "IN_REVIEW" });
  doc.classLevel = payload.classLevel;
  doc.titleBn = payload.titleBn;
  doc.version = payload.version;
  doc.pages = payload.pages;
  await doc.save();
  for (const c of live) {
    const s = changeIsStale(c, texts, pageNs);
    if (c.stale !== s) {
      c.stale = s;
      await c.save();
    }
  }
  // A change that was stale earlier may line up again (a later import restored the text).
  const earlier = await WinterBookletChange.find({ bookletId: doc._id, status: { $in: ["OPEN", "ACCEPTED"] }, stale: true });
  for (const c of earlier) {
    if (!changeIsStale(c, texts, pageNs)) {
      c.stale = false;
      await c.save();
    }
  }
  await writeAudit({
    eventKind: "WINTER_BOOKLET_IMPORTED",
    actorId: opts.actorId,
    targetId: doc._id,
    targetKind: "WinterBooklet",
    meta: { code: payload.code, version: payload.version, pages: report.pages, blocks, kept, stale },
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

/** The text that would print: the block's own text with the newest non-stale ACCEPTED change applied. */
function acceptedTexts(accepted: IWinterBookletChange[]): Map<string, string> {
  const m = new Map<string, string>();
  const sorted = [...accepted].sort((a, b) => (a.decidedAt?.getTime() ?? 0) - (b.decidedAt?.getTime() ?? 0));
  for (const c of sorted) if (c.blockId && !c.stale) m.set(c.blockId, c.after);
  return m;
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
  const accepted = await WinterBookletChange.find({ bookletId: b._id, status: "ACCEPTED" }).lean();
  const acc = acceptedTexts(accepted as unknown as IWinterBookletChange[]);
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

export async function suggestWinterChange(ctx: AppContext, input: SuggestInput): Promise<WinterChangeRow> {
  const { userId } = requireAny(ctx);
  const booklet = Types.ObjectId.isValid(input.bookletId) ? await WinterBooklet.findById(input.bookletId) : null;
  if (!booklet) throw new Error(WINTER_ERRORS_BN.notFound);
  const page = booklet.pages.find((p) => p.n === input.pageN);
  if (!page) throw new Error(WINTER_ERRORS_BN.pageMissing);
  const note = clean(input.note);
  if (note.length > MAX_NOTE) throw new Error(WINTER_ERRORS_BN.tooLong);
  const blockId = input.blockId ? input.blockId : null;

  if (blockId === null) {
    if (!note) throw new Error(WINTER_ERRORS_BN.nothingToSave);
    const row = await WinterBookletChange.create({ bookletId: booklet._id, pageN: page.n, blockId: null, before: "", after: "", note, by: userId });
    await writeAudit({ eventKind: "WINTER_CHANGE_SUGGESTED", actorId: userId, targetId: row._id, targetKind: "WinterBookletChange", meta: { bookletId: input.bookletId, pageN: page.n, blockId: null } });
    return changeRow(row, await namesOf([row.by]), userId);
  }

  const block = page.blocks.find((b) => b.id === blockId);
  if (!block) throw new Error(WINTER_ERRORS_BN.blockMissing);
  if (block.kind === "line") throw new Error(WINTER_ERRORS_BN.blockFixed);
  const hasAfter = input.after !== undefined && input.after !== null;
  const after = hasAfter ? clean(input.after) : block.textBn;
  if (after.length > MAX_TEXT) throw new Error(WINTER_ERRORS_BN.tooLong);
  if (after === block.textBn.trim() && !note) throw new Error(WINTER_ERRORS_BN.same);

  // One open suggestion per person per block: a second tap edits it.
  const mine = await WinterBookletChange.findOne({ bookletId: booklet._id, blockId, by: userId, status: "OPEN" });
  if (mine) {
    const prev = mine.after;
    mine.after = after;
    mine.note = note || undefined;
    mine.before = block.textBn;
    mine.stale = false;
    mine.editedAt = new Date();
    await mine.save();
    await writeAudit({ eventKind: "WINTER_CHANGE_EDITED", actorId: userId, targetId: mine._id, targetKind: "WinterBookletChange", meta: { before: prev, after } });
    return changeRow(mine, await namesOf([mine.by]), userId);
  }
  const row = await WinterBookletChange.create({ bookletId: booklet._id, pageN: page.n, blockId, before: block.textBn, after, note: note || undefined, by: userId });
  await writeAudit({ eventKind: "WINTER_CHANGE_SUGGESTED", actorId: userId, targetId: row._id, targetKind: "WinterBookletChange", meta: { bookletId: input.bookletId, pageN: page.n, blockId } });
  return changeRow(row, await namesOf([row.by]), userId);
}

async function ownOpenChange(ctx: AppContext, id: string): Promise<{ row: IWinterBookletChange; userId: string }> {
  const { userId } = requireAny(ctx);
  const row = Types.ObjectId.isValid(id) ? await WinterBookletChange.findById(id) : null;
  if (!row) throw new Error(WINTER_ERRORS_BN.changeMissing);
  if (row.by.toString() !== userId) throw new ForbiddenError(WINTER_ERRORS_BN.notOwn);
  if (row.status !== "OPEN") throw new Error(WINTER_ERRORS_BN.notOpen);
  return { row, userId };
}

export async function editWinterChange(ctx: AppContext, id: string, input: { after?: string | null; note?: string | null }): Promise<WinterChangeRow> {
  const { row, userId } = await ownOpenChange(ctx, id);
  if (row.stale) throw new Error(WINTER_ERRORS_BN.stale);
  const note = clean(input.note);
  if (note.length > MAX_NOTE) throw new Error(WINTER_ERRORS_BN.tooLong);
  const prev = row.after;
  if (row.blockId === null) {
    if (!note) throw new Error(WINTER_ERRORS_BN.nothingToSave);
    row.note = note;
  } else {
    if (input.after !== undefined && input.after !== null) {
      const after = clean(input.after);
      if (after.length > MAX_TEXT) throw new Error(WINTER_ERRORS_BN.tooLong);
      if (after === row.before.trim() && !note) throw new Error(WINTER_ERRORS_BN.same);
      row.after = after;
    }
    row.note = note || undefined;
  }
  row.editedAt = new Date();
  await row.save();
  await writeAudit({ eventKind: "WINTER_CHANGE_EDITED", actorId: userId, targetId: row._id, targetKind: "WinterBookletChange", meta: { before: prev, after: row.after } });
  return changeRow(row, await namesOf([row.by]), userId);
}

export async function deleteWinterChange(ctx: AppContext, id: string): Promise<boolean> {
  const { row, userId } = await ownOpenChange(ctx, id);
  row.status = "DELETED";
  await row.save();
  await writeAudit({ eventKind: "WINTER_CHANGE_DELETED", actorId: userId, targetId: row._id, targetKind: "WinterBookletChange", meta: { bookletId: row.bookletId.toString(), pageN: row.pageN, blockId: row.blockId } });
  return true;
}

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

export async function decideWinterChange(ctx: AppContext, id: string, accept: boolean): Promise<WinterChangeRow> {
  const userId = requireManage(ctx);
  const row = Types.ObjectId.isValid(id) ? await WinterBookletChange.findById(id) : null;
  if (!row) throw new Error(WINTER_ERRORS_BN.changeMissing);
  if (row.status !== "OPEN") throw new Error(WINTER_ERRORS_BN.notOpen);
  if (accept && row.stale) throw new Error(WINTER_ERRORS_BN.stale);
  row.status = accept ? "ACCEPTED" : "REJECTED";
  row.decidedBy = new Types.ObjectId(userId);
  row.decidedAt = new Date();
  await row.save();
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
 * The booklet in the import shape with every non-stale ACCEPTED change applied, plus the
 * page notes and the accepted edits as a list — what the build step needs to rebuild the PDF.
 */
export async function exportAcceptedWinterBooklet(ctx: AppContext, id: string): Promise<string> {
  requireManage(ctx);
  const b = Types.ObjectId.isValid(id) ? await WinterBooklet.findById(id).lean() : null;
  if (!b) throw new Error(WINTER_ERRORS_BN.notFound);
  const accepted = (await WinterBookletChange.find({ bookletId: b._id, status: "ACCEPTED" }).lean()) as unknown as IWinterBookletChange[];
  const acc = acceptedTexts(accepted);
  const notes = (await WinterBookletChange.find({ bookletId: b._id, blockId: null, status: { $in: ["OPEN", "ACCEPTED"] } }).lean()) as unknown as IWinterBookletChange[];
  const out = {
    code: b.code,
    classLevel: b.classLevel,
    titleBn: b.titleBn,
    version: b.version,
    status: b.status,
    pages: b.pages.map((p) => ({ ...p, blocks: p.blocks.map((k) => (acc.has(k.id) ? { ...k, textBn: acc.get(k.id)! } : k)) })),
    acceptedChanges: accepted.filter((c) => c.blockId && !c.stale).map((c) => ({ pageN: c.pageN, blockId: c.blockId, before: c.before, after: c.after, note: c.note ?? null })),
    pageNotes: notes.map((c) => ({ pageN: c.pageN, note: c.note ?? "", status: c.status })),
  };
  return JSON.stringify(out, null, 1);
}

export type { IWinterBooklet };
