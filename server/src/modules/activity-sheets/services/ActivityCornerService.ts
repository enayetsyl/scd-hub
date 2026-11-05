/**
 * The activity corner (AS-2, D-#988, docs/prd-activity-sheets.md) — trays, stock print runs,
 * the desk pick-up and the return check.
 *
 *  - Trays: pre-printed STOCK copies per bank × level. A restock print run takes the next
 *    `restockSheets` sheets of each chosen level by the bank's rotation pointer, makes
 *    `restockCopies` copies of each (one ActivityCopy row each, serial in the QR), and the
 *    PDF is built on demand from the run's copies (GET /files/activity-print?runId=…).
 *  - Take: the child brings a tray sheet to the desk; the desk scans the copy QR (or types
 *    AS-000231), types the child's school ID (103 = 0103) or searches a name, checks the
 *    name, saves → an ActivityIssue (TRAY, HANDED). A sheet the child had before is flagged
 *    (`repeat`), never blocked; the open-sheet limit is enforced.
 *  - Return: scan the copy → সব ঠিক / কিছু ভুল / অসম্পূর্ণ → sticker unless অসম্পূর্ণ. Through
 *    the return box the sticker is owed (the class teacher hands it over). A copy that was
 *    never scanned out (busy time) is recorded at return with the child named then.
 * Identity plane (students); no corpus path (ADR-005).
 */
import { randomUUID } from "crypto";
import { Types } from "mongoose";
import {
  ACTIVITY_LEVELS,
  ACTIVITY_RESULTS,
  ROSTER_CLASS_LABELS_BN,
  type ActivityLevel,
  type ActivityResult,
  type RosterClassLevel,
} from "@scd/shared";
import { Student } from "../../foundation/models/Student";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { writeAudit } from "../../platform/services/AuditService";
import { ActivityBank, type IActivityBank } from "../models/ActivityBank";
import { ActivitySheet, type IActivitySheet } from "../models/ActivitySheet";
import { ActivityCopy, copyCode, parseCopyCode, type IActivityCopy } from "../models/ActivityCopy";
import { ActivityIssue, type IActivityIssue } from "../models/ActivityIssue";
import { ActivityError, loadActivityFile } from "./ActivityBankService";
import { activityRules } from "./ActivitySettingsService";
import { afterReturn } from "./activityHooks";
import { sweepNotReturned } from "./ActivityFollowUpService";
import { buildSheetsPdf, type CoverPage, type StampedPage } from "./pdfTools";

export const CORNER_ERRORS_BN = {
  badCode: "কোডটি ঠিক নয় (যেমন AS-000231)",
  copyNotFound: "এই কোডের কোনো শিট নেই",
  notInTray: "এই শিটটি এখন ট্রেতে নেই",
  notOut: "এই শিটটি কারও কাছে নেই — ফেরত নেওয়ার কিছু নেই",
  alreadyBack: "এই শিটটি আগেই ফেরত নেওয়া হয়েছে",
  lost: "এই শিটটি হারানো হিসেবে লেখা আছে",
  studentNotFound: "শিক্ষার্থী পাওয়া যায়নি",
  tooMany: "এই শিক্ষার্থীর হাতে আগেই {n}টি শিট আছে — আগে একটি ফেরত দিক",
  badResult: "ফলাফল বাছাই করুন",
  whoIsIt: "স্ক্যান না করে নেওয়া শিট — কে করেছে তা বাছাই করুন",
  nothingToPrint: "ছাপার মতো শিট নেই — ব্যাংক প্রকাশিত ও পৃষ্ঠাসহ কিনা দেখুন",
  runNotFound: "এই ছাপার তালিকা পাওয়া যায়নি",
  notTake: "শুধু ট্রে থেকে নেওয়া শিট বাতিল করা যায়",
} as const;

const OPEN_STATUSES = ["REQUESTED", "PRINTED", "HANDED"] as const;

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------

export interface CornerStudent {
  id: string;
  name: string;
  nameEn: string;
  schoolId: string;
  rollNumber: string | null;
  classLevel: number | null;
  classLabelBn: string;
  sectionNameBn: string | null;
  openSheets: number;
}

const STUDENT_FIELDS = "name nameBn schoolId rollNumber classId sectionId";
type StudentRow = { _id: Types.ObjectId; name: string; nameBn?: string; schoolId: string; rollNumber?: string; classId: Types.ObjectId; sectionId: Types.ObjectId };

export async function decorateCornerStudents(rows: StudentRow[]): Promise<CornerStudent[]> {
  if (rows.length === 0) return [];
  const [classes, sections, open] = await Promise.all([
    Class.find({ _id: { $in: rows.map((r) => r.classId) } }).select("level").lean(),
    Section.find({ _id: { $in: rows.map((r) => r.sectionId) } }).select("nameBn").lean(),
    ActivityIssue.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { studentId: { $in: rows.map((r) => r._id) }, status: { $in: [...OPEN_STATUSES] } } },
      { $group: { _id: "$studentId", n: { $sum: 1 } } },
    ]),
  ]);
  const level = new Map(classes.map((c) => [c._id.toString(), c.level as number]));
  const secName = new Map(sections.map((s) => [s._id.toString(), s.nameBn as string]));
  const openBy = new Map(open.map((o) => [o._id.toString(), o.n]));
  return rows.map((r) => {
    const lv = level.get(r.classId?.toString());
    return {
      id: r._id.toString(),
      name: r.nameBn || r.name,
      nameEn: r.name,
      schoolId: r.schoolId,
      rollNumber: r.rollNumber ?? null,
      classLevel: lv ?? null,
      classLabelBn: lv === undefined ? "" : ROSTER_CLASS_LABELS_BN[lv as RosterClassLevel] ?? String(lv),
      sectionNameBn: secName.get(r.sectionId?.toString()) ?? null,
      openSheets: openBy.get(r._id.toString()) ?? 0,
    };
  });
}

/** Digits = a school ID, matched numerically (103 = 0103); else a name / roll. */
export async function findCornerStudents(search: string): Promise<CornerStudent[]> {
  const term = (search ?? "").trim();
  if (!term) return [];
  let q: Record<string, unknown>;
  if (/^\d+$/.test(term)) q = { active: true, schoolId: new RegExp(`^0*${String(Number(term))}$`) };
  else {
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    q = { active: true, $or: [{ name: rx }, { nameBn: rx }, { rollNumber: term }] };
  }
  const rows = (await Student.find(q).select(STUDENT_FIELDS).limit(20).lean()) as unknown as StudentRow[];
  return decorateCornerStudents(rows);
}

async function cornerStudent(studentId: string): Promise<CornerStudent> {
  if (!Types.ObjectId.isValid(studentId)) throw new ActivityError(CORNER_ERRORS_BN.studentNotFound);
  const row = (await Student.findById(studentId).select(STUDENT_FIELDS).lean()) as unknown as StudentRow | null;
  if (!row) throw new ActivityError(CORNER_ERRORS_BN.studentNotFound);
  return (await decorateCornerStudents([row]))[0];
}

// ---------------------------------------------------------------------------
// Trays + stock print runs
// ---------------------------------------------------------------------------

export interface TrayLevel {
  level: ActivityLevel;
  inTray: number;
  out: number;
  low: boolean;
  printable: number;
}
export interface TrayView {
  bank: IActivityBank;
  levels: TrayLevel[];
}

export async function trayView(): Promise<{ trays: TrayView[]; lowTray: number; busyMode: boolean }> {
  await sweepNotReturned();
  const rules = await activityRules();
  const banks = (await ActivityBank.find({ status: "PUBLISHED" }).sort({ sortOrder: 1, code: 1 }).lean()) as unknown as IActivityBank[];
  const ids = banks.map((b) => b._id);
  const [copies, printable] = await Promise.all([
    ActivityCopy.aggregate<{ _id: { bankId: Types.ObjectId; level: string; status: string }; n: number }>([
      { $match: { kind: "STOCK", status: { $in: ["IN_TRAY", "TAKEN"] } } },
      { $lookup: { from: ActivitySheet.collection.name, localField: "sheetId", foreignField: "_id", as: "s" } },
      { $unwind: "$s" },
      { $match: { "s.bankId": { $in: ids } } },
      { $group: { _id: { bankId: "$s.bankId", level: "$s.level", status: "$status" }, n: { $sum: 1 } } },
    ]),
    ActivitySheet.aggregate<{ _id: { bankId: Types.ObjectId; level: string }; n: number }>([
      { $match: { bankId: { $in: ids }, active: true, page: { $exists: true }, sourceFileId: { $exists: true } } },
      { $group: { _id: { bankId: "$bankId", level: "$level" }, n: { $sum: 1 } } },
    ]),
  ]);
  const count = (b: IActivityBank, l: string, status: string) =>
    copies.find((c) => c._id.bankId.toString() === b._id.toString() && c._id.level === l && c._id.status === status)?.n ?? 0;
  const trays = banks.map((bank) => ({
    bank,
    levels: ACTIVITY_LEVELS.map((level) => {
      const inTray = count(bank, level, "IN_TRAY");
      const can = printable.find((p) => p._id.bankId.toString() === bank._id.toString() && p._id.level === level)?.n ?? 0;
      return { level, inTray, out: count(bank, level, "TAKEN"), low: can > 0 && inTray < rules.lowTray, printable: can };
    }),
  }));
  return { trays, lowTray: rules.lowTray, busyMode: rules.busyMode };
}

async function nextSerial(): Promise<number> {
  const last = await ActivityCopy.findOne({}).sort({ serial: -1 }).select("serial").lean();
  return (last?.serial ?? 0) + 1;
}

/** Make copy rows with fresh serials; retries once on a serial clash (two desks at once). */
export async function makeCopies(rows: Array<Omit<Partial<IActivityCopy>, "serial">>): Promise<IActivityCopy[]> {
  for (let attempt = 0; ; attempt++) {
    const start = await nextSerial();
    try {
      return (await ActivityCopy.insertMany(rows.map((r, i) => ({ ...r, serial: start + i })), { ordered: true })) as unknown as IActivityCopy[];
    } catch (e) {
      if ((e as { code?: number })?.code !== 11000 || attempt >= 3) throw e;
      await ActivityCopy.deleteMany({ printRunId: rows[0]?.printRunId, serial: { $gte: start } });
    }
  }
}

export interface StockPick {
  bankId: string;
  level: ActivityLevel;
}

/**
 * A restock run: for each (bank, level) the next `sheets` sheets by rotation, `copies` copies
 * each. `picks` empty = every LOW tray. Returns the run id the PDF route builds from.
 */
export async function printStock(picks: StockPick[], actorId: string, opts: { sheets?: number | null; copies?: number | null } = {}): Promise<{ runId: string; copies: number; sheets: number }> {
  const rules = await activityRules();
  const perLevel = opts.sheets ?? rules.restockSheets;
  const copiesEach = opts.copies ?? rules.restockCopies;
  let wanted = picks;
  if (wanted.length === 0) {
    const { trays } = await trayView();
    wanted = trays.flatMap((t) => t.levels.filter((l) => l.low).map((l) => ({ bankId: t.bank._id.toString(), level: l.level })));
  }
  const runId = `stock-${randomUUID()}`;
  const rows: Array<Partial<IActivityCopy>> = [];
  let sheetCount = 0;
  for (const p of wanted) {
    if (!Types.ObjectId.isValid(p.bankId)) continue;
    const bank = await ActivityBank.findById(p.bankId);
    if (!bank || bank.status !== "PUBLISHED") continue;
    const sheets = (await ActivitySheet.find({ bankId: bank._id, level: p.level, active: true, page: { $exists: true }, sourceFileId: { $exists: true } })
      .sort({ seq: 1 })
      .select("_id")
      .lean()) as unknown as IActivitySheet[];
    if (sheets.length === 0) continue;
    const n = Math.min(perLevel, sheets.length);
    let at = (bank.rotation?.[p.level] ?? 0) % sheets.length;
    for (let i = 0; i < n; i++) {
      const s = sheets[at];
      for (let c = 0; c < copiesEach; c++) rows.push({ sheetId: s._id, kind: "STOCK", status: "IN_TRAY", printRunId: runId });
      sheetCount++;
      at = (at + 1) % sheets.length;
    }
    bank.rotation[p.level] = at;
    bank.markModified("rotation");
    await bank.save();
  }
  if (rows.length === 0) throw new ActivityError(CORNER_ERRORS_BN.nothingToPrint);
  await makeCopies(rows);
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetKind: "ActivityCopy", meta: { op: "printActivityStock", runId, copies: rows.length, sheets: sheetCount } });
  return { runId, copies: rows.length, sheets: sheetCount };
}

/** The PDF of one print run (stock or a morning batch), in copy order; covers per batch group. */
export async function printRunPdf(runId: string, covers?: Map<string, CoverPage>, lines?: Map<string, string>): Promise<Buffer> {
  const copies = (await ActivityCopy.find({ printRunId: runId }).sort({ serial: 1 }).lean()) as unknown as IActivityCopy[];
  if (copies.length === 0) throw new ActivityError(CORNER_ERRORS_BN.runNotFound);
  const sheets = (await ActivitySheet.find({ _id: { $in: [...new Set(copies.map((c) => c.sheetId.toString()))] } }).lean()) as unknown as IActivitySheet[];
  const sheetBy = new Map(sheets.map((s) => [s._id.toString(), s]));
  const fileIds = [...new Set(sheets.map((s) => s.sourceFileId?.toString()).filter((x): x is string => !!x))];
  const sources = await Promise.all(fileIds.map((id) => loadActivityFile(id)));
  const srcIndex = new Map(fileIds.map((id, i) => [id, i]));
  const items: Array<StampedPage | { cover: CoverPage }> = [];
  for (const c of copies) {
    const cover = covers?.get(c._id.toString());
    if (cover) items.push({ cover });
    const s = sheetBy.get(c.sheetId.toString());
    if (!s?.sourceFileId || !s.page) continue;
    items.push({ source: srcIndex.get(s.sourceFileId.toString())!, page: s.page, code: copyCode(c.serial), line: lines?.get(c._id.toString()) });
  }
  return buildSheetsPdf(sources, items);
}

// ---------------------------------------------------------------------------
// The desk
// ---------------------------------------------------------------------------

export interface DeskCopyView {
  copy: IActivityCopy;
  code: string;
  sheet: IActivitySheet;
  bank: IActivityBank;
  issue: IActivityIssue | null;
  holder: CornerStudent | null;
  busyMode: boolean;
}

async function copyByCode(raw: string): Promise<IActivityCopy> {
  const serial = parseCopyCode(raw);
  if (serial === null) throw new ActivityError(CORNER_ERRORS_BN.badCode);
  const copy = (await ActivityCopy.findOne({ serial }).lean()) as unknown as IActivityCopy | null;
  if (!copy) throw new ActivityError(CORNER_ERRORS_BN.copyNotFound);
  return copy;
}

export async function deskCopy(raw: string): Promise<DeskCopyView> {
  const copy = await copyByCode(raw);
  const [sheet, rules] = await Promise.all([ActivitySheet.findById(copy.sheetId).lean(), activityRules()]);
  if (!sheet) throw new ActivityError(CORNER_ERRORS_BN.copyNotFound);
  const bank = (await ActivityBank.findById(sheet.bankId).lean()) as unknown as IActivityBank;
  const issue = (await ActivityIssue.findOne({ copyId: copy._id, status: { $ne: "CANCELLED" } }).sort({ createdAt: -1 }).lean()) as unknown as IActivityIssue | null;
  const holder = issue ? await cornerStudent(issue.studentId.toString()).catch(() => null) : null;
  return { copy, code: copyCode(copy.serial), sheet: sheet as unknown as IActivitySheet, bank, issue, holder, busyMode: rules.busyMode };
}

async function hadBefore(studentId: Types.ObjectId, sheetId: Types.ObjectId, exceptIssue?: Types.ObjectId): Promise<boolean> {
  return !!(await ActivityIssue.exists({ studentId, sheetId, status: { $nin: ["CANCELLED"] }, ...(exceptIssue ? { _id: { $ne: exceptIssue } } : {}) }));
}

/** A tray sheet goes home with a child (desk scan + school ID). */
export async function deskTake(raw: string, studentId: string, actorId: string, now = new Date()): Promise<IActivityIssue> {
  const copy = await copyByCode(raw);
  if (copy.status !== "IN_TRAY") throw new ActivityError(copy.status === "LOST" ? CORNER_ERRORS_BN.lost : CORNER_ERRORS_BN.notInTray);
  const kid = await cornerStudent(studentId);
  const rules = await activityRules();
  if (kid.openSheets >= rules.maxOpen) throw new ActivityError(CORNER_ERRORS_BN.tooMany.replace("{n}", String(kid.openSheets)));
  const sheet = await ActivitySheet.findById(copy.sheetId).select("bankId").lean();
  if (!sheet) throw new ActivityError(CORNER_ERRORS_BN.copyNotFound);
  const moved = await ActivityCopy.updateOne({ _id: copy._id, status: "IN_TRAY" }, { $set: { status: "TAKEN" } });
  if (moved.modifiedCount === 0) throw new ActivityError(CORNER_ERRORS_BN.notInTray);
  const sid = new Types.ObjectId(studentId);
  const issue = await ActivityIssue.create({
    studentId: sid,
    sheetId: copy.sheetId,
    bankId: sheet.bankId,
    copyId: copy._id,
    path: "TRAY",
    status: "HANDED",
    repeat: await hadBefore(sid, copy.sheetId),
    requestedAt: now,
    handedAt: now,
    handedBy: new Types.ObjectId(actorId),
  });
  await ActivityCopy.updateOne({ _id: copy._id }, { $set: { issueId: issue._id } });
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: issue._id, targetKind: "ActivityIssue", meta: { op: "activityTake", code: copyCode(copy.serial), studentId } });
  return issue.toObject() as IActivityIssue;
}

/** Undo a wrong take (wrong child typed): the copy goes back to the tray. */
export async function cancelTake(raw: string, actorId: string): Promise<IActivityCopy> {
  const copy = await copyByCode(raw);
  const issue = await ActivityIssue.findOne({ copyId: copy._id, status: "HANDED", path: "TRAY" });
  if (!issue) throw new ActivityError(CORNER_ERRORS_BN.notTake);
  issue.status = "CANCELLED";
  await issue.save();
  await ActivityCopy.updateOne({ _id: copy._id }, { $set: { status: "IN_TRAY" }, $unset: { issueId: 1 } });
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: issue._id, targetKind: "ActivityIssue", meta: { op: "activityCancelTake", code: copyCode(copy.serial) } });
  return (await ActivityCopy.findById(copy._id).lean()) as unknown as IActivityCopy;
}

export interface ReturnInput {
  code: string;
  result: string;
  /** Returned through the box: no child at the desk, the sticker is owed. */
  viaBox?: boolean | null;
  /** Only for a copy never scanned out (busy time): who did it. */
  studentId?: string | null;
}

/** A finished sheet comes back: result + sticker (unless অসম্পূর্ণ). */
export async function deskReturn(input: ReturnInput, actorId: string, now = new Date()): Promise<IActivityIssue> {
  if (!(ACTIVITY_RESULTS as readonly string[]).includes(input.result)) throw new ActivityError(CORNER_ERRORS_BN.badResult);
  const result = input.result as ActivityResult;
  const copy = await copyByCode(input.code);
  if (copy.status === "LOST") throw new ActivityError(CORNER_ERRORS_BN.lost);
  if (copy.status === "RETURNED") throw new ActivityError(CORNER_ERRORS_BN.alreadyBack);
  const sticker = result !== "INCOMPLETE";
  const viaBox = !!input.viaBox;
  let issue = await ActivityIssue.findOne({ copyId: copy._id, status: { $in: [...OPEN_STATUSES] } });
  if (!issue) {
    // Never scanned out: a busy-time take (or a personal copy whose hand-out wasn't tapped).
    if (copy.kind !== "STOCK" || copy.status !== "IN_TRAY") throw new ActivityError(CORNER_ERRORS_BN.notOut);
    if (!input.studentId) throw new ActivityError(CORNER_ERRORS_BN.whoIsIt);
    await cornerStudent(input.studentId);
    const sheet = await ActivitySheet.findById(copy.sheetId).select("bankId").lean();
    const sid = new Types.ObjectId(input.studentId);
    issue = new ActivityIssue({
      studentId: sid,
      sheetId: copy.sheetId,
      bankId: sheet!.bankId,
      copyId: copy._id,
      path: "TRAY",
      status: "HANDED",
      unscannedTake: true,
      repeat: await hadBefore(sid, copy.sheetId),
      requestedAt: now,
    });
  }
  const moved = await ActivityCopy.updateOne({ _id: copy._id, status: { $in: ["IN_TRAY", "TAKEN"] } }, { $set: { status: "RETURNED", issueId: issue._id } });
  if (moved.modifiedCount === 0) throw new ActivityError(CORNER_ERRORS_BN.alreadyBack);
  issue.status = "RETURNED";
  issue.result = result;
  issue.returnedAt = now;
  issue.checkedBy = new Types.ObjectId(actorId);
  issue.stickerGiven = sticker && !viaBox;
  issue.stickerOwed = sticker && viaBox;
  if (!issue.handedAt) issue.handedAt = now;
  await issue.save();
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: issue._id, targetKind: "ActivityIssue", meta: { op: "activityReturn", code: copyCode(copy.serial), result, viaBox } });
  await afterReturn(issue.toObject() as IActivityIssue).catch((e) => console.warn("activity afterReturn:", (e as Error)?.message));
  return issue.toObject() as IActivityIssue;
}

/** A copy that will never come back (torn, lost): out of the tray counts; an open issue is dropped. */
export async function markCopyLost(raw: string, actorId: string): Promise<IActivityCopy> {
  const copy = await copyByCode(raw);
  await ActivityCopy.updateOne({ _id: copy._id }, { $set: { status: "LOST" } });
  await ActivityIssue.updateMany({ copyId: copy._id, status: { $in: [...OPEN_STATUSES] } }, { $set: { status: "NOT_RETURNED" } });
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: copy._id, targetKind: "ActivityCopy", meta: { op: "activityCopyLost", code: copyCode(copy.serial) } });
  return (await ActivityCopy.findById(copy._id).lean()) as unknown as IActivityCopy;
}

/** Today's desk log (Dhaka day): takes and returns, newest first. */
export async function deskToday(start: Date): Promise<IActivityIssue[]> {
  return (await ActivityIssue.find({ $or: [{ handedAt: { $gte: start }, path: "TRAY" }, { returnedAt: { $gte: start } }] })
    .sort({ updatedAt: -1 })
    .limit(60)
    .lean()) as unknown as IActivityIssue[];
}
