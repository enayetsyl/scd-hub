/**
 * Activity banks (AS-1, D-#988/#989, docs/prd-activity-sheets.md) — the bank manager.
 *
 *  - Import a bank from the three files the school already keeps: the sheet PDF (one sheet a
 *    page), the answer PDF (several answers a page) and the index CSV ("Item ID, Bank, Level,
 *    Classes, Details, Page in bank PDF, …"). The CSV says which page is which sheet and which
 *    classes each level suits; the answer page of each sheet is found by reading the sheet ids
 *    printed on the answer PDF. A bank may arrive with its CSV alone (Mazes, Sudoku) and get
 *    its pages later (attach).
 *  - Add sheets to a bank (a PDF of new pages → the next ids per level), replace one sheet's
 *    page, retire / restore a sheet, edit the bank (names, skill area, level → classes, status).
 *  - Sample pages (2 per level) are rendered once and kept, for the guardian's preview.
 * PDFs live in Drive (StoredFile `activity_bank_pdf` / `activity_answer_pdf`) and are never
 * served whole. Identity-free module data; the child records are ActivityIssue (identity plane).
 */
import { assertGuardianFeature } from "../../guardian-access/services/GuardianFeatureService";
import { Types } from "mongoose";
import {
  ACTIVITY_LEVELS,
  ACTIVITY_SKILL_AREAS,
  ACTIVITY_BANK_STATUSES,
  ROSTER_CLASS_LEVEL_MAX,
  ROSTER_CLASS_LEVEL_MIN,
  callerHasPermission,
  type ActivityBankStatus,
  type ActivityLevel,
  type ActivitySkillArea,
} from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { StoredFile } from "../../platform/models/StoredFile";
import { downloadFromDrive, uploadToDrive } from "../../platform/services/DriveStore";
import { writeAudit } from "../../platform/services/AuditService";
import { guardianClassLevels } from "../../class-books/services/ClassBookService";
import { ActivityBank, type IActivityBank } from "../models/ActivityBank";
import { ActivitySheet, type IActivitySheet } from "../models/ActivitySheet";
import { pdfPageCount, pdfPageTexts, renderPage } from "./pdfTools";

export class ActivityError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ActivityError";
  }
}

export const ACTIVITY_ERRORS_BN = {
  noRows: "সূচি (CSV) ফাইলে কোনো শিট পাওয়া যায়নি",
  pickCode: "সূচিতে কয়েকটি ব্যাংক আছে — কোনটি তুলবেন তার কোড দিন:",
  codeMissing: "এই কোডের কোনো শিট সূচিতে নেই",
  dupBank: "এই কোডের একটি ব্যাংক আগেই আছে — শিট যোগ করতে ব্যাংকটি খুলুন",
  badPage: "সূচির পৃষ্ঠা নম্বর PDF-এর পৃষ্ঠার চেয়ে বেশি",
  badSkill: "দক্ষতা বাছাই করুন",
  badName: "ব্যাংকের নাম (বাংলা) লিখুন",
  bankNotFound: "ব্যাংকটি পাওয়া যায়নি",
  sheetNotFound: "শিটটি পাওয়া যায়নি",
  badLevel: "স্তর ঠিক নয় (সহজ / মাঝারি / কঠিন)",
  badLevels: "শ্রেণি ঠিক নয়",
  badStatus: "অবস্থা ঠিক নয়",
  pdfNeeded: "PDF ফাইল দিন",
  onePage: "একটি শিট বদলাতে এক পৃষ্ঠার PDF দিন",
  noPdf: "এই ব্যাংকের শিটের PDF এখনো নেই",
  forbidden: "অনুমতি নেই",
} as const;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export interface IndexRow {
  itemId: string;
  bank: string;
  level: ActivityLevel;
  classesText: string;
  details: string;
  page: number | null;
}

/** RFC-4180-ish: quoted fields, doubled quotes, commas inside quotes; BOM stripped. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export function parseIndexCsv(text: string): IndexRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.findIndex((h) => h.startsWith(name));
  const iId = col("item id"), iBank = col("bank"), iLevel = col("level"), iClasses = col("classes"), iDetails = col("details"), iPage = col("page");
  return rows.slice(1).flatMap((r) => {
    const itemId = (r[iId] ?? "").trim().toUpperCase();
    const level = (r[iLevel] ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}-[EMH]-\d{1,4}$/.test(itemId) || !(ACTIVITY_LEVELS as readonly string[]).includes(level)) return [];
    const page = Number(r[iPage]);
    return [{ itemId, bank: (r[iBank] ?? "").trim(), level: level as ActivityLevel, classesText: (r[iClasses] ?? "").trim(), details: (r[iDetails] ?? "").trim(), page: Number.isInteger(page) && page > 0 ? page : null }];
  });
}

export const csvBankCodes = (rows: IndexRow[]): string[] => [...new Set(rows.map((r) => r.itemId.slice(0, 2)))];

/** "Nursery – KG" → [-1, 0]; "Class 3 – 6" → [3, 4, 5]; "KG – Class 1" → [0, 1]; "Class 2" → [2]. */
export function classLevelsOf(text: string): number[] {
  const toLevel = (t: string): number | null => {
    const x = t.trim().toLowerCase();
    if (/nursery/.test(x)) return -1;
    if (/^kg$|kindergarten/.test(x)) return 0;
    const m = x.match(/(\d+)/);
    return m ? Number(m[1]) : null;
  };
  const parts = text.split(/\s*[–—-]\s*/).map(toLevel).filter((n): n is number => n !== null);
  if (parts.length === 0) return [];
  const lo = Math.min(...parts), hi = Math.max(...parts);
  const out: number[] = [];
  for (let l = Math.max(lo, ROSTER_CLASS_LEVEL_MIN); l <= Math.min(hi, ROSTER_CLASS_LEVEL_MAX); l++) out.push(l);
  return out;
}

/** Sheet id → answer page: the first page whose text carries the id. */
export function answerPagesOf(pageTexts: string[]): Map<string, number> {
  const out = new Map<string, number>();
  pageTexts.forEach((t, i) => {
    for (const m of t.matchAll(/\b([A-Z]{2}-[EMH]-\d{3,4})\b/g)) if (!out.has(m[1])) out.set(m[1], i + 1);
  });
  return out;
}

function oid(id: string, msg: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new ActivityError(msg);
  return new Types.ObjectId(id);
}

export const sheetItemId = (code: string, level: ActivityLevel, seq: number): string => `${code}-${level}-${String(seq).padStart(3, "0")}`;

// ---------------------------------------------------------------------------
// Files — Drive, with a small cache (bank PDFs are read again at every print run)
// ---------------------------------------------------------------------------

const fileCache = new Map<string, Buffer>();
let fileCacheBytes = 0;
const FILE_CACHE_MAX = 64 * 1024 * 1024;

export function clearActivityFileCache(): void {
  fileCache.clear();
  fileCacheBytes = 0;
}

export async function loadActivityFile(fileId: Types.ObjectId | string): Promise<Buffer> {
  const k = fileId.toString();
  const hit = fileCache.get(k);
  if (hit) {
    fileCache.delete(k);
    fileCache.set(k, hit);
    return hit;
  }
  const f = await StoredFile.findById(k).lean();
  if (!f) throw new ActivityError(ACTIVITY_ERRORS_BN.noPdf);
  const data = await downloadFromDrive(f.driveFileId);
  if (data.byteLength <= FILE_CACHE_MAX) {
    fileCache.set(k, data);
    fileCacheBytes += data.byteLength;
    for (const [key, v] of fileCache) {
      if (fileCacheBytes <= FILE_CACHE_MAX) break;
      fileCache.delete(key);
      fileCacheBytes -= v.byteLength;
    }
  }
  return data;
}

async function storeFile(data: Buffer, kind: "activity_bank_pdf" | "activity_answer_pdf" | "activity_page", name: string, mime: string, actorId: string): Promise<Types.ObjectId> {
  const driveFileId = await uploadToDrive({ name, mime, data, year: String(new Date().getFullYear()), subfolder: "activity-sheets" });
  const f = await StoredFile.create({ kind, mime, sizeBytes: data.byteLength, originalName: name, driveFileId, uploadedBy: actorId });
  return f._id;
}

/** Render + keep 2 sample pages per level (the guardian's preview). Best effort. */
async function renderSamples(bank: IActivityBank, actorId: string): Promise<void> {
  const samples: Record<ActivityLevel, Types.ObjectId[]> = { E: [], M: [], H: [] };
  for (const level of ACTIVITY_LEVELS) {
    const first = (await ActivitySheet.find({ bankId: bank._id, level, active: true, sourceFileId: { $exists: true } }).sort({ seq: 1 }).limit(2).lean()) as unknown as IActivitySheet[];
    for (const s of first) {
      try {
        const pdf = await loadActivityFile(s.sourceFileId!);
        const jpg = await renderPage(pdf, s.page!, 900);
        samples[level].push(await storeFile(jpg, "activity_page", `${s.itemId}.jpg`, "image/jpeg", actorId));
      } catch (e) {
        console.warn("activity sample render failed:", (e as Error)?.message);
      }
    }
  }
  await ActivityBank.updateOne({ _id: bank._id }, { $set: { sampleFileIds: samples } });
}

// ---------------------------------------------------------------------------
// Import / attach / add / replace / retire / edit
// ---------------------------------------------------------------------------

export interface ImportBankInput {
  actorId: string;
  nameBn: string;
  nameEn?: string | null;
  skillArea: string;
  bankNo?: number | null;
  sortOrder?: number | null;
  /** Which bank to take from a combined index CSV (the school's CSVs hold several banks). */
  code?: string | null;
  csvText: string;
  sheetPdf?: Buffer | null;
  answerPdf?: Buffer | null;
}

export interface ImportResult {
  bank: IActivityBank;
  sheets: number;
  answersFound: number;
  warnings: string[];
}

function assertSkill(s: string): ActivitySkillArea {
  if (!(ACTIVITY_SKILL_AREAS as readonly string[]).includes(s)) throw new ActivityError(ACTIVITY_ERRORS_BN.badSkill);
  return s as ActivitySkillArea;
}

export async function importBank(input: ImportBankInput): Promise<ImportResult> {
  if (!input.nameBn?.trim()) throw new ActivityError(ACTIVITY_ERRORS_BN.badName);
  const skillArea = assertSkill(input.skillArea);
  const all = parseIndexCsv(input.csvText);
  if (all.length === 0) throw new ActivityError(ACTIVITY_ERRORS_BN.noRows);
  const codes = csvBankCodes(all);
  const want = input.code?.trim().toUpperCase() || null;
  if (!want && codes.length !== 1) throw new ActivityError(`${ACTIVITY_ERRORS_BN.pickCode} ${codes.join(", ")}`);
  const code = want ?? codes[0];
  const rows = all.filter((r) => r.itemId.startsWith(`${code}-`));
  if (rows.length === 0) throw new ActivityError(ACTIVITY_ERRORS_BN.codeMissing);
  if (await ActivityBank.exists({ code })) throw new ActivityError(ACTIVITY_ERRORS_BN.dupBank);
  const warnings: string[] = [];

  let pageCount = 0;
  if (input.sheetPdf) {
    pageCount = await pdfPageCount(input.sheetPdf);
    const maxPage = Math.max(0, ...rows.map((r) => r.page ?? 0));
    if (maxPage > pageCount) throw new ActivityError(ACTIVITY_ERRORS_BN.badPage);
  } else warnings.push("শিটের PDF নেই — পরে PDF দিলে শিটগুলো ছাপা যাবে");

  const levelClasses: Record<ActivityLevel, number[]> = { E: [], M: [], H: [] };
  const levelClassText: Partial<Record<ActivityLevel, string>> = {};
  for (const r of rows) {
    if (!levelClassText[r.level]) {
      levelClassText[r.level] = r.classesText;
      levelClasses[r.level] = classLevelsOf(r.classesText);
    }
  }
  const sheetFileId = input.sheetPdf ? await storeFile(input.sheetPdf, "activity_bank_pdf", `${code}-sheets.pdf`, "application/pdf", input.actorId) : undefined;
  let answerMap = new Map<string, number>();
  let answerFileId: Types.ObjectId | undefined;
  if (input.answerPdf) {
    answerMap = answerPagesOf(await pdfPageTexts(input.answerPdf));
    answerFileId = await storeFile(input.answerPdf, "activity_answer_pdf", `${code}-answers.pdf`, "application/pdf", input.actorId);
  }
  const bank = await ActivityBank.create({
    code,
    bankNo: input.bankNo ?? undefined,
    nameBn: input.nameBn.trim(),
    nameEn: input.nameEn?.trim() || rows[0].bank || undefined,
    skillArea,
    levelClasses,
    levelClassText,
    sheetFileId,
    answerFileId,
    sortOrder: input.sortOrder ?? input.bankNo ?? 0,
    status: "DRAFT",
  });
  await ActivitySheet.insertMany(
    rows.map((r) => ({
      itemId: r.itemId,
      bankId: bank._id,
      level: r.level,
      seq: Number(r.itemId.split("-")[2]),
      classLevels: levelClasses[r.level],
      details: r.details || undefined,
      sourceFileId: sheetFileId,
      page: sheetFileId ? r.page ?? undefined : undefined,
      answerPage: answerMap.get(r.itemId),
      active: true,
    })),
  );
  if (sheetFileId) await renderSamples(bank, input.actorId);
  const missingAnswers = input.answerPdf ? rows.filter((r) => !answerMap.has(r.itemId)).length : 0;
  if (missingAnswers > 0) warnings.push(`${missingAnswers}টি শিটের উত্তর উত্তরপত্রে পাওয়া যায়নি`);
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId: input.actorId, targetId: bank._id, targetKind: "ActivityBank", meta: { op: "importActivityBank", code, sheets: rows.length, pageCount } });
  return { bank: (await ActivityBank.findById(bank._id).lean()) as unknown as IActivityBank, sheets: rows.length, answersFound: answerMap.size, warnings };
}

/** Give a bank its sheet PDF (an indexed bank with no pages yet) and/or a new answer PDF. */
export async function attachBankPdfs(bankId: string, sheetPdf: Buffer | null, answerPdf: Buffer | null, actorId: string): Promise<IActivityBank> {
  const bank = await ActivityBank.findById(oid(bankId, ACTIVITY_ERRORS_BN.bankNotFound));
  if (!bank) throw new ActivityError(ACTIVITY_ERRORS_BN.bankNotFound);
  if (!sheetPdf && !answerPdf) throw new ActivityError(ACTIVITY_ERRORS_BN.pdfNeeded);
  if (sheetPdf) {
    const count = await pdfPageCount(sheetPdf);
    const sheets = (await ActivitySheet.find({ bankId: bank._id, sourceFileId: { $exists: false } }).lean()) as unknown as IActivitySheet[];
    const fileId = await storeFile(sheetPdf, "activity_bank_pdf", `${bank.code}-sheets.pdf`, "application/pdf", actorId);
    bank.sheetFileId = fileId;
    // Sheets without a page take theirs from the PDF in level order, page 2 onward (page 1 = the bank's guide).
    const ordered = sheets.sort((a, b) => ACTIVITY_LEVELS.indexOf(a.level) - ACTIVITY_LEVELS.indexOf(b.level) || a.seq - b.seq);
    if (ordered.length + 1 > count) throw new ActivityError(ACTIVITY_ERRORS_BN.badPage);
    await ActivitySheet.bulkWrite(ordered.map((s, i) => ({ updateOne: { filter: { _id: s._id }, update: { $set: { sourceFileId: fileId, page: i + 2 } } } })));
  }
  if (answerPdf) {
    const map = answerPagesOf(await pdfPageTexts(answerPdf));
    bank.answerFileId = await storeFile(answerPdf, "activity_answer_pdf", `${bank.code}-answers.pdf`, "application/pdf", actorId);
    const sheets = await ActivitySheet.find({ bankId: bank._id }).select("itemId").lean();
    await ActivitySheet.bulkWrite(sheets.filter((s) => map.has(s.itemId)).map((s) => ({ updateOne: { filter: { _id: s._id }, update: { $set: { answerPage: map.get(s.itemId) } } } })));
  }
  await bank.save();
  if (sheetPdf) await renderSamples(bank, actorId);
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: bank._id, targetKind: "ActivityBank", meta: { op: "attachActivityPdfs", sheets: !!sheetPdf, answers: !!answerPdf } });
  return (await ActivityBank.findById(bank._id).lean()) as unknown as IActivityBank;
}

/** A PDF of new pages → new sheets with the next ids. `levels` = one level for all, or one per page. */
export async function addSheets(bankId: string, pdf: Buffer, levels: ActivityLevel[], details: string[] | null, actorId: string): Promise<IActivitySheet[]> {
  const bank = await ActivityBank.findById(oid(bankId, ACTIVITY_ERRORS_BN.bankNotFound));
  if (!bank) throw new ActivityError(ACTIVITY_ERRORS_BN.bankNotFound);
  if (levels.length === 0 || levels.some((l) => !(ACTIVITY_LEVELS as readonly string[]).includes(l))) throw new ActivityError(ACTIVITY_ERRORS_BN.badLevel);
  const count = await pdfPageCount(pdf);
  const fileId = await storeFile(pdf, "activity_bank_pdf", `${bank.code}-added-${Date.now()}.pdf`, "application/pdf", actorId);
  const next: Record<ActivityLevel, number> = { E: 0, M: 0, H: 0 };
  for (const l of ACTIVITY_LEVELS) {
    const last = await ActivitySheet.findOne({ bankId: bank._id, level: l }).sort({ seq: -1 }).select("seq").lean();
    next[l] = (last?.seq ?? 0) + 1;
  }
  const docs = Array.from({ length: count }, (_, i) => {
    const level = levels.length === 1 ? levels[0] : levels[i] ?? levels[levels.length - 1];
    const seq = next[level]++;
    return {
      itemId: sheetItemId(bank.code, level, seq),
      bankId: bank._id,
      level,
      seq,
      classLevels: bank.levelClasses?.[level] ?? [],
      details: details?.[i]?.trim() || undefined,
      sourceFileId: fileId,
      page: i + 1,
      active: true,
    };
  });
  const made = (await ActivitySheet.insertMany(docs)) as unknown as IActivitySheet[];
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: bank._id, targetKind: "ActivityBank", meta: { op: "addActivitySheets", count, levels } });
  return made;
}

export async function replaceSheet(sheetId: string, pdf: Buffer, actorId: string): Promise<IActivitySheet> {
  const sheet = await ActivitySheet.findById(oid(sheetId, ACTIVITY_ERRORS_BN.sheetNotFound));
  if (!sheet) throw new ActivityError(ACTIVITY_ERRORS_BN.sheetNotFound);
  if ((await pdfPageCount(pdf)) !== 1) throw new ActivityError(ACTIVITY_ERRORS_BN.onePage);
  sheet.sourceFileId = await storeFile(pdf, "activity_bank_pdf", `${sheet.itemId}.pdf`, "application/pdf", actorId);
  sheet.page = 1;
  await sheet.save();
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: sheet._id, targetKind: "ActivitySheet", meta: { op: "replaceActivitySheet", itemId: sheet.itemId } });
  return sheet.toObject() as IActivitySheet;
}

export async function setSheetActive(sheetId: string, active: boolean, actorId: string): Promise<IActivitySheet> {
  const sheet = await ActivitySheet.findByIdAndUpdate(oid(sheetId, ACTIVITY_ERRORS_BN.sheetNotFound), { $set: { active } }, { new: true }).lean();
  if (!sheet) throw new ActivityError(ACTIVITY_ERRORS_BN.sheetNotFound);
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: sheet._id, targetKind: "ActivitySheet", meta: { op: active ? "restoreActivitySheet" : "retireActivitySheet" } });
  return sheet as unknown as IActivitySheet;
}

export interface BankPatch {
  nameBn?: string | null;
  nameEn?: string | null;
  skillArea?: string | null;
  status?: string | null;
  sortOrder?: number | null;
  levelClasses?: { E?: number[] | null; M?: number[] | null; H?: number[] | null } | null;
}

export async function updateBank(bankId: string, patch: BankPatch, actorId: string): Promise<IActivityBank> {
  const bank = await ActivityBank.findById(oid(bankId, ACTIVITY_ERRORS_BN.bankNotFound));
  if (!bank) throw new ActivityError(ACTIVITY_ERRORS_BN.bankNotFound);
  if (patch.nameBn != null) {
    if (!patch.nameBn.trim()) throw new ActivityError(ACTIVITY_ERRORS_BN.badName);
    bank.nameBn = patch.nameBn.trim();
  }
  if (patch.nameEn != null) bank.nameEn = patch.nameEn.trim() || undefined;
  if (patch.skillArea != null) bank.skillArea = assertSkill(patch.skillArea);
  if (patch.sortOrder != null) bank.sortOrder = patch.sortOrder;
  if (patch.status != null) {
    if (!(ACTIVITY_BANK_STATUSES as readonly string[]).includes(patch.status)) throw new ActivityError(ACTIVITY_ERRORS_BN.badStatus);
    bank.status = patch.status as ActivityBankStatus;
  }
  if (patch.levelClasses) {
    for (const l of ACTIVITY_LEVELS) {
      const v = patch.levelClasses[l];
      if (!v) continue;
      if (v.some((n) => !Number.isInteger(n) || n < ROSTER_CLASS_LEVEL_MIN || n > ROSTER_CLASS_LEVEL_MAX)) throw new ActivityError(ACTIVITY_ERRORS_BN.badLevels);
      bank.levelClasses[l] = [...new Set(v)].sort((a, b) => a - b);
      await ActivitySheet.updateMany({ bankId: bank._id, level: l }, { $set: { classLevels: bank.levelClasses[l] } });
    }
    bank.markModified("levelClasses");
  }
  await bank.save();
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: bank._id, targetKind: "ActivityBank", meta: { op: "updateActivityBank", fields: Object.keys(patch) } });
  return bank.toObject() as IActivityBank;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface BankView {
  bank: IActivityBank;
  counts: Record<ActivityLevel, number>;
  retired: number;
  withoutPages: number;
  answers: number;
}

export async function listBanks(opts: { publishedOnly?: boolean; classLevels?: number[] | null } = {}): Promise<BankView[]> {
  const q: Record<string, unknown> = opts.publishedOnly ? { status: "PUBLISHED" } : {};
  const banks = (await ActivityBank.find(q).sort({ sortOrder: 1, code: 1 }).lean()) as unknown as IActivityBank[];
  const sheets = await ActivitySheet.find({ bankId: { $in: banks.map((b) => b._id) } }).select("bankId level active sourceFileId answerPage").lean();
  const out = banks.map((bank) => {
    const own = sheets.filter((s) => s.bankId.toString() === bank._id.toString());
    const live = own.filter((s) => s.active);
    return {
      bank,
      counts: { E: live.filter((s) => s.level === "E").length, M: live.filter((s) => s.level === "M").length, H: live.filter((s) => s.level === "H").length },
      retired: own.length - live.length,
      withoutPages: live.filter((s) => !s.sourceFileId).length,
      answers: live.filter((s) => !!s.answerPage).length,
    };
  });
  if (!opts.classLevels) return out;
  const want = opts.classLevels;
  return out.filter((v) => ACTIVITY_LEVELS.some((l) => (v.bank.levelClasses?.[l] ?? []).some((c) => want.includes(c))));
}

export async function bankSheets(bankId: string): Promise<IActivitySheet[]> {
  return (await ActivitySheet.find({ bankId }).sort({ level: 1, seq: 1 }).lean()) as unknown as IActivitySheet[];
}

/**
 * GET /files/:id gate for the activity_* kinds. The bank PDFs are never served whole except
 * to the bank manager (activity_sheets:manage). A sample page: staff with activity_sheets:view,
 * or a guardian when the bank is published and suits one of their children's classes.
 */
export async function assertActivityFileReadAccess(ctx: AppContext, file: { _id: Types.ObjectId; kind: string }): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError(ACTIVITY_ERRORS_BN.forbidden);
  if (file.kind !== "activity_page") {
    if (!callerHasPermission(ctx.auth, "activity_sheets:manage")) throw new ForbiddenError(ACTIVITY_ERRORS_BN.forbidden);
    return;
  }
  if (callerHasPermission(ctx.auth, "activity_sheets:view")) return;
  await assertGuardianFeature(ctx, "ACTIVITY_SHEETS");
  const id = file._id;
  const bank = await ActivityBank.findOne({ $or: [{ "sampleFileIds.E": id }, { "sampleFileIds.M": id }, { "sampleFileIds.H": id }] }).lean();
  if (bank) {
    if (!callerHasPermission(ctx.auth, "guardian:read_child") || bank.status !== "PUBLISHED") throw new ForbiddenError(ACTIVITY_ERRORS_BN.forbidden);
    const levels = await guardianClassLevels(ctx.auth.userId);
    const all = [...bank.levelClasses.E, ...bank.levelClasses.M, ...bank.levelClasses.H];
    if (!all.some((l) => levels.includes(l))) throw new ForbiddenError(ACTIVITY_ERRORS_BN.forbidden);
    return;
  }
  // An answer page (AS-4): a guardian whose child returned a sheet on that page.
  const { assertAnswerImageAccess } = await import("./ActivityFollowUpService");
  await assertAnswerImageAccess(ctx, id);
}

/** A sample page as a JPEG data URI (the storybookImage pattern), behind the file gate. */
export async function activityImage(ctx: AppContext, fileId: string): Promise<string> {
  const id = oid(fileId, ACTIVITY_ERRORS_BN.sheetNotFound);
  const file = await StoredFile.findById(id).select("kind").lean();
  if (!file || file.kind !== "activity_page") throw new ActivityError(ACTIVITY_ERRORS_BN.sheetNotFound);
  await assertActivityFileReadAccess(ctx, { _id: id, kind: file.kind });
  const data = await loadActivityFile(id);
  return `data:image/jpeg;base64,${data.toString("base64")}`;
}
