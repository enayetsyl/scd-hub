/**
 * Storybook desk (SB-2, D-#982/#983/#985, docs/prd-storybook-reading.md).
 *
 *  - Copies: 1–2 per title, codes `SERIES-BOOK-COPY` (TRE-07-1), created in bulk per series;
 *    a QR sticker sheet (A4, 24 a page) prints from the office PC. The QR holds the code.
 *  - Lookup by code: the copy, its book and series, who has it now, who it is held for.
 *  - Children by school ID (numeric — prod IDs mix "0103" and "103"), name or roll; and the
 *    children seen at the desk today, so a daily swapper is one tap away.
 *  - Holiday rules: a dated window with a higher limit and one due day (D-#982).
 *
 * Issue / return themselves stay in LibraryCirculationService (one desk, one rule set).
 */
import { Types } from "mongoose";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { ROSTER_CLASS_LABELS_BN, type RosterClassLevel } from "@scd/shared";
import { Student } from "../../foundation/models/Student";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { writeAudit } from "../../platform/services/AuditService";
import { dhakaDayStart } from "../../../lib/dhakaDay";
import { BookTitle, type IBookTitle } from "../models/BookTitle";
import { BookCopy, type IBookCopy } from "../models/BookCopy";
import { BookLoan, type IBookLoan } from "../models/BookLoan";
import { BookReservation } from "../models/BookReservation";
import { StorySeries, type IStorySeries } from "../models/StorySeries";
import { LibraryHolidayRule, type ILibraryHolidayRule } from "../models/LibraryHolidayRule";
import { getEffectivePolicy } from "./LibraryPolicyService";
import { holidayRuleOn } from "./LibraryCirculationService";
import { LibraryError } from "../errors";

export const STORY_DESK_ERRORS_BN = {
  badCode: "কোডটি ঠিক নয় — যেমন TRE-07-1",
  notFound: "এই কোডের কোনো বই পাওয়া যায়নি",
  seriesNotFound: "সিরিজটি পাওয়া যায়নি",
  badCopies: "প্রতিটি বইয়ের কপি ১ থেকে ৫টি হতে পারে",
  noCopies: "স্টিকার ছাপার মতো কোনো কপি নেই",
  badDay: "তারিখ ঠিক নয়",
  badWindow: "ছুটির শেষ তারিখ শুরুর আগে হতে পারে না",
  badDue: "ফেরতের তারিখ ছুটির শেষ দিনের আগে হতে পারে না",
  badMax: "সর্বোচ্চ বইয়ের সংখ্যা ১ থেকে ২০ হতে পারে",
  badName: "ছুটির নাম লিখুন",
  ruleNotFound: "নিয়মটি পাওয়া যায়নি",
} as const;

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");

export function storyCopyCode(seriesCode: string, seriesNo: number, copyNo: number): string {
  return `${seriesCode}-${pad2(seriesNo)}-${copyNo}`;
}

/** "tre 7 1", "TRE-7-1", "tre07-1" → "TRE-07-1"; anything else is returned trimmed + upper-cased
 *  (an ordinary library accession number still works at the same desk). */
export function normalizeCopyCode(raw: string): string {
  const s = (raw ?? "").trim().toUpperCase();
  const m = s.match(/^([A-Z]{2,4})[\s-]*(\d{1,3})[\s-]+(\d{1,2})$/);
  return m ? storyCopyCode(m[1], Number(m[2]), Number(m[3])) : s;
}

/** Make sure every (active) book of a series has `copiesEach` copies; returns the codes made. */
export async function addStoryCopies(
  seriesId: string,
  copiesEach: number,
  seriesNos: number[] | null | undefined,
  actorId: string,
): Promise<string[]> {
  if (!Number.isInteger(copiesEach) || copiesEach < 1 || copiesEach > 5) throw new LibraryError(STORY_DESK_ERRORS_BN.badCopies);
  if (!Types.ObjectId.isValid(seriesId)) throw new LibraryError(STORY_DESK_ERRORS_BN.seriesNotFound);
  const series = (await StorySeries.findById(seriesId).lean()) as unknown as IStorySeries | null;
  if (!series) throw new LibraryError(STORY_DESK_ERRORS_BN.seriesNotFound);
  const q: Record<string, unknown> = { seriesId: series._id, active: true, seriesNo: { $exists: true } };
  if (seriesNos && seriesNos.length > 0) q.seriesNo = { $in: seriesNos };
  const titles = (await BookTitle.find(q).select("seriesNo").sort({ seriesNo: 1 }).lean()) as unknown as Array<Pick<IBookTitle, "_id" | "seriesNo">>;
  const made: string[] = [];
  for (const t of titles) {
    for (let k = 1; k <= copiesEach; k++) {
      const code = storyCopyCode(series.code, t.seriesNo!, k);
      if (await BookCopy.exists({ accessionNo: code })) continue;
      try {
        await BookCopy.create({ titleId: t._id, accessionNo: code, status: "AVAILABLE" });
        made.push(code);
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e; // a concurrent run made it — fine
      }
    }
  }
  await writeAudit({
    eventKind: "LIBRARY_CATALOG_CHANGED",
    actorId,
    targetId: series._id,
    targetKind: "StorySeries",
    meta: { op: "addStoryCopies", copiesEach, made: made.length },
  });
  return made;
}

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------

export interface DeskStudent {
  id: string;
  name: string;
  schoolId: string;
  rollNumber: string | null;
  classLabelBn: string;
  sectionNameBn: string | null;
  activeLoans: number;
  maxLoans: number;
  overdue: boolean;
}

async function decorateStudents(
  rows: Array<{ _id: Types.ObjectId; name: string; nameBn?: string; schoolId: string; rollNumber?: string; classId: Types.ObjectId; sectionId: Types.ObjectId }>,
  now = new Date(),
): Promise<DeskStudent[]> {
  if (rows.length === 0) return [];
  const [classes, sections, loans, policy, holiday] = await Promise.all([
    Class.find({ _id: { $in: rows.map((r) => r.classId) } }).select("level").lean(),
    Section.find({ _id: { $in: rows.map((r) => r.sectionId) } }).select("nameBn").lean(),
    BookLoan.find({ studentId: { $in: rows.map((r) => r._id) }, status: "ACTIVE" }).select("studentId dueDate").lean(),
    getEffectivePolicy("STUDENT"),
    holidayRuleOn(now),
  ]);
  const level = new Map(classes.map((c) => [c._id.toString(), c.level as number]));
  const secName = new Map(sections.map((s) => [s._id.toString(), s.nameBn as string]));
  const maxLoans = Math.max(policy.maxConcurrent, holiday?.maxConcurrent ?? 0);
  return rows.map((r) => {
    const mine = loans.filter((l) => l.studentId?.toString() === r._id.toString());
    const lv = level.get(r.classId.toString());
    return {
      id: r._id.toString(),
      name: r.nameBn || r.name,
      schoolId: r.schoolId,
      rollNumber: r.rollNumber ?? null,
      classLabelBn: lv === undefined ? "" : ROSTER_CLASS_LABELS_BN[lv as RosterClassLevel] ?? String(lv),
      sectionNameBn: secName.get(r.sectionId.toString()) ?? null,
      activeLoans: mine.length,
      maxLoans,
      overdue: mine.some((l) => new Date(l.dueDate).getTime() < now.getTime()),
    };
  });
}

const STUDENT_FIELDS = "name nameBn schoolId rollNumber classId sectionId";

/** A desk search: digits = a school ID, matched numerically (103 = 0103), else a name / roll. */
export async function findDeskStudents(search: string): Promise<DeskStudent[]> {
  const term = (search ?? "").trim();
  if (!term) return [];
  let q: Record<string, unknown>;
  if (/^\d+$/.test(term)) {
    q = { active: true, schoolId: new RegExp(`^0*${String(Number(term))}$`) };
  } else {
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    q = { active: true, $or: [{ name: rx }, { nameBn: rx }, { rollNumber: term }] };
  }
  const rows = await Student.find(q).select(STUDENT_FIELDS).limit(20).lean();
  return decorateStudents(rows as never);
}

/** Children who borrowed or returned at the desk today (Dhaka) — newest first. */
export async function deskStudentsToday(now = new Date()): Promise<DeskStudent[]> {
  const start = dhakaDayStart(now);
  const loans = await BookLoan.find({
    borrowerType: "STUDENT",
    $or: [{ issuedAt: { $gte: start } }, { returnedAt: { $gte: start } }],
  })
    .select("studentId issuedAt returnedAt")
    .lean();
  const order = new Map<string, number>();
  for (const l of loans) {
    const k = l.studentId?.toString();
    if (!k) continue;
    const at = Math.max(new Date(l.issuedAt).getTime(), l.returnedAt ? new Date(l.returnedAt).getTime() : 0);
    order.set(k, Math.max(order.get(k) ?? 0, at));
  }
  if (order.size === 0) return [];
  const rows = await Student.find({ _id: { $in: [...order.keys()] } }).select(STUDENT_FIELDS).lean();
  const out = await decorateStudents(rows as never, now);
  return out.sort((a, b) => (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0));
}

// ---------------------------------------------------------------------------
// Lookup by code
// ---------------------------------------------------------------------------

export interface CopyLookup {
  copy: IBookCopy;
  title: IBookTitle;
  series: IStorySeries | null;
  loan: IBookLoan | null;
  borrower: DeskStudent | null;
  heldFor: DeskStudent | null;
  waitingCount: number;
}

async function studentById(id: Types.ObjectId | string | undefined | null): Promise<DeskStudent | null> {
  if (!id) return null;
  const s = await Student.findById(id).select(STUDENT_FIELDS).lean();
  if (!s) return null;
  const [d] = await decorateStudents([s as never]);
  return d;
}

export async function lookupStoryCopy(rawCode: string): Promise<CopyLookup> {
  const code = normalizeCopyCode(rawCode);
  if (!code) throw new LibraryError(STORY_DESK_ERRORS_BN.badCode);
  const copy = (await BookCopy.findOne({ accessionNo: code }).lean()) as unknown as IBookCopy | null;
  if (!copy) throw new LibraryError(STORY_DESK_ERRORS_BN.notFound);
  const title = (await BookTitle.findById(copy.titleId).lean()) as unknown as IBookTitle;
  const [series, loan, held, waitingCount] = await Promise.all([
    title?.seriesId ? (StorySeries.findById(title.seriesId).lean() as unknown as Promise<IStorySeries | null>) : Promise.resolve(null),
    BookLoan.findOne({ copyId: copy._id, status: "ACTIVE" }).lean() as unknown as Promise<IBookLoan | null>,
    BookReservation.findOne({ heldCopyId: copy._id, status: "READY" }).lean(),
    BookReservation.countDocuments({ titleId: copy.titleId, status: "QUEUED" }),
  ]);
  return {
    copy,
    title,
    series,
    loan,
    borrower: loan?.borrowerType === "STUDENT" ? await studentById(loan.studentId) : null,
    heldFor: held?.studentId ? await studentById(held.studentId as Types.ObjectId) : null,
    waitingCount,
  };
}

// ---------------------------------------------------------------------------
// Holiday rules (D-#982)
// ---------------------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function libraryHolidayRules(includeInactive = false): Promise<ILibraryHolidayRule[]> {
  return (await LibraryHolidayRule.find(includeInactive ? {} : { active: true }).sort({ fromDay: -1 }).lean()) as unknown as ILibraryHolidayRule[];
}

export interface HolidayRuleInput {
  ruleId?: string | null;
  nameBn: string;
  fromDay: string;
  toDay: string;
  dueDay: string;
  maxConcurrent: number;
  active?: boolean | null;
}

export async function saveLibraryHolidayRule(input: HolidayRuleInput, actorId: string): Promise<ILibraryHolidayRule> {
  if (!input.nameBn?.trim()) throw new LibraryError(STORY_DESK_ERRORS_BN.badName);
  for (const d of [input.fromDay, input.toDay, input.dueDay]) if (!DAY.test(d ?? "")) throw new LibraryError(STORY_DESK_ERRORS_BN.badDay);
  if (input.toDay < input.fromDay) throw new LibraryError(STORY_DESK_ERRORS_BN.badWindow);
  if (input.dueDay < input.toDay) throw new LibraryError(STORY_DESK_ERRORS_BN.badDue);
  if (!Number.isInteger(input.maxConcurrent) || input.maxConcurrent < 1 || input.maxConcurrent > 20) throw new LibraryError(STORY_DESK_ERRORS_BN.badMax);
  const fields = {
    nameBn: input.nameBn.trim(),
    fromDay: input.fromDay,
    toDay: input.toDay,
    dueDay: input.dueDay,
    maxConcurrent: input.maxConcurrent,
    active: input.active ?? true,
  };
  let rule: ILibraryHolidayRule | null;
  if (input.ruleId) {
    if (!Types.ObjectId.isValid(input.ruleId)) throw new LibraryError(STORY_DESK_ERRORS_BN.ruleNotFound);
    rule = (await LibraryHolidayRule.findByIdAndUpdate(input.ruleId, { $set: fields }, { new: true }).lean()) as unknown as ILibraryHolidayRule | null;
    if (!rule) throw new LibraryError(STORY_DESK_ERRORS_BN.ruleNotFound);
  } else {
    rule = (await LibraryHolidayRule.create({ ...fields, createdBy: actorId })).toObject() as ILibraryHolidayRule;
  }
  await writeAudit({
    eventKind: "LIBRARY_CATALOG_CHANGED",
    actorId,
    targetId: rule._id,
    targetKind: "LibraryHolidayRule",
    meta: { op: input.ruleId ? "updateHolidayRule" : "createHolidayRule", ...fields },
  });
  return rule;
}

// ---------------------------------------------------------------------------
// Sticker sheet — A4, 3 × 8 labels; the QR holds the copy code
// ---------------------------------------------------------------------------

export async function storyStickerCodes(seriesId: string | null, codes: string[] | null): Promise<Array<{ code: string; seriesNo: number | null; seriesName: string }>> {
  let copies: IBookCopy[];
  if (codes && codes.length > 0) {
    copies = (await BookCopy.find({ accessionNo: { $in: codes.map(normalizeCopyCode) } }).lean()) as unknown as IBookCopy[];
  } else {
    if (!seriesId || !Types.ObjectId.isValid(seriesId)) throw new LibraryError(STORY_DESK_ERRORS_BN.seriesNotFound);
    const titles = await BookTitle.find({ seriesId }).select("_id").lean();
    copies = (await BookCopy.find({ titleId: { $in: titles.map((t) => t._id) }, status: { $ne: "WITHDRAWN" } }).lean()) as unknown as IBookCopy[];
  }
  if (copies.length === 0) throw new LibraryError(STORY_DESK_ERRORS_BN.noCopies);
  const titles = (await BookTitle.find({ _id: { $in: copies.map((c) => c.titleId) } }).select("seriesId seriesNo").lean()) as unknown as IBookTitle[];
  const series = (await StorySeries.find({ _id: { $in: titles.map((t) => t.seriesId).filter(Boolean) } }).select("nameEn code").lean()) as unknown as IStorySeries[];
  const tById = new Map(titles.map((t) => [t._id.toString(), t]));
  const sById = new Map(series.map((s) => [s._id.toString(), s]));
  return copies
    .map((c) => {
      const t = tById.get(c.titleId.toString());
      const s = t?.seriesId ? sById.get(t.seriesId.toString()) : undefined;
      return { code: c.accessionNo, seriesNo: t?.seriesNo ?? null, seriesName: s?.nameEn ?? s?.code ?? "" };
    })
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
}

export async function storyStickerPdf(labels: Array<{ code: string; seriesNo: number | null; seriesName: string }>): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: "SCD storybook stickers" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const COLS = 3, ROWS = 8, MX = 22, MY = 26;
  const W = (595.28 - MX * 2) / COLS;
  const H = (841.89 - MY * 2) / ROWS;
  labels.forEach((l, i) => {
    const slot = i % (COLS * ROWS);
    if (i > 0 && slot === 0) doc.addPage();
    const x = MX + (slot % COLS) * W;
    const y = MY + Math.floor(slot / COLS) * H;
    doc.save().lineWidth(0.4).dash(2, { space: 2 }).strokeColor("#999999").rect(x + 2, y + 2, W - 4, H - 4).stroke().restore();
    // QR on the right, drawn as vector squares so it prints sharp at any size.
    const qr = QRCode.create(l.code, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    const qSize = H - 18;
    const cell = qSize / n;
    const qx = x + W - qSize - 9;
    const qy = y + 9;
    doc.fillColor("#000000");
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) doc.rect(qx + c * cell, qy + r * cell, cell + 0.05, cell + 0.05).fill();
    // The big book number for the shelf, the code underneath, the series name small on top.
    doc.fillColor("#000000").font("Helvetica").fontSize(7).text(l.seriesName.slice(0, 26), x + 9, y + 9, { width: W - qSize - 22, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(34).text(l.seriesNo != null ? String(l.seriesNo) : "", x + 9, y + 21, { width: W - qSize - 22, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(10).text(l.code, x + 9, y + H - 24, { width: W - qSize - 18, lineBreak: false });
  });
  doc.end();
  return done;
}

