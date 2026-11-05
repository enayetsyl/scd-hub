/**
 * Activity sheets — the guardian path (AS-3, D-#988/#991, docs/prd-activity-sheets.md).
 *
 *  - Choose: a guardian sees the published banks whose levels suit their child's class, with
 *    sample pages; picks a bank + level. The app picks the next sheet the child has never had
 *    (all done → the one done longest ago, flagged as a repeat). Limits (D-#991): requests a
 *    week (rolling 7 days) and open sheets across both paths.
 *  - Morning batch: Office prints every requested sheet at once — each page stamped with the
 *    child's English name, class and date plus the copy QR; a Latin cover slip per section
 *    lists whose sheets follow. Requests → PRINTED.
 *  - Hand-out: the class teacher (or the office) taps the children on the roster → HANDED.
 *  - The child's list: what is open, what came back and how (the guardian's status view).
 * Identity plane; no corpus path (ADR-005).
 */
import { randomUUID } from "crypto";
import { Types } from "mongoose";
import { ACTIVITY_LEVELS, ROSTER_CLASS_LABELS_EN, callerHasPermission, type ActivityLevel, type RosterClassLevel } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError, assertGuardianOfStudent } from "../../../middleware/authz";
import { Student } from "../../foundation/models/Student";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { writeAudit } from "../../platform/services/AuditService";
import { ActivityBank, type IActivityBank } from "../models/ActivityBank";
import { ActivitySheet, type IActivitySheet } from "../models/ActivitySheet";
import { ActivityIssue, type IActivityIssue } from "../models/ActivityIssue";
import { ActivityError } from "./ActivityBankService";
import { activityRules } from "./ActivitySettingsService";
import { makeCopies, printRunPdf } from "./ActivityCornerService";
import type { CoverPage } from "./pdfTools";
import { sweepNotReturned } from "./ActivityFollowUpService";

export const GUARDIAN_ERRORS_BN = {
  notSuited: "এই ব্যাংক / স্তরটি আপনার সন্তানের শ্রেণির জন্য নয়",
  noSheets: "এই স্তরে এখন কোনো শিট নেই",
  weekly: "এই সপ্তাহে {n}টি শিট চাওয়া হয়ে গেছে — কয়েক দিন পরে আবার চাইতে পারবেন",
  tooMany: "সন্তানের হাতে আগেই {n}টি শিট আছে — আগে একটি শেষ করে ফেরত দিক",
  notYours: "এই অনুরোধটি পাওয়া যায়নি",
  notRequested: "শিটটি ছাপা হয়ে গেছে — আর বাতিল করা যাবে না",
  nothing: "ছাপার মতো কোনো অনুরোধ নেই",
  forbidden: "অনুমতি নেই",
} as const;

const OPEN = ["REQUESTED", "PRINTED", "HANDED"] as const;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function childClassLevel(studentId: string): Promise<{ level: number; sectionId: Types.ObjectId }> {
  const s = await Student.findById(studentId).select("classId sectionId").lean();
  if (!s) throw new ActivityError(GUARDIAN_ERRORS_BN.notYours);
  const c = await Class.findById(s.classId).select("level").lean();
  return { level: (c?.level as number) ?? -99, sectionId: s.sectionId as Types.ObjectId };
}

// ---------------------------------------------------------------------------
// Choose
// ---------------------------------------------------------------------------

export interface ChoiceLevel {
  level: ActivityLevel;
  sheetCount: number;
  doneByChild: number;
  sampleFileIds: Types.ObjectId[];
}
export interface ChoiceBank {
  bank: IActivityBank;
  levels: ChoiceLevel[];
}
export interface ChoicesView {
  banks: ChoiceBank[];
  weeklyLimit: number;
  usedThisWeek: number;
  maxOpen: number;
  open: number;
}

export async function activityChoices(studentId: string, now = new Date()): Promise<ChoicesView> {
  const { level } = await childClassLevel(studentId);
  const rules = await activityRules();
  const banks = (await ActivityBank.find({ status: "PUBLISHED" }).sort({ sortOrder: 1, code: 1 }).lean()) as unknown as IActivityBank[];
  const suited = banks.filter((b) => ACTIVITY_LEVELS.some((l) => (b.levelClasses?.[l] ?? []).includes(level)));
  const sid = new Types.ObjectId(studentId);
  const [counts, done, usedThisWeek, open] = await Promise.all([
    ActivitySheet.aggregate<{ _id: { bankId: Types.ObjectId; level: string }; n: number }>([
      { $match: { bankId: { $in: suited.map((b) => b._id) }, active: true, page: { $exists: true }, sourceFileId: { $exists: true } } },
      { $group: { _id: { bankId: "$bankId", level: "$level" }, n: { $sum: 1 } } },
    ]),
    ActivityIssue.aggregate<{ _id: { bankId: Types.ObjectId; sheetId: Types.ObjectId } }>([
      { $match: { studentId: sid, status: "RETURNED" } },
      { $group: { _id: { bankId: "$bankId", sheetId: "$sheetId" } } },
    ]),
    ActivityIssue.countDocuments({ studentId: sid, path: "GUARDIAN", status: { $ne: "CANCELLED" }, requestedAt: { $gte: new Date(now.getTime() - WEEK_MS) } }),
    ActivityIssue.countDocuments({ studentId: sid, status: { $in: [...OPEN] } }),
  ]);
  const doneSheets = await ActivitySheet.find({ _id: { $in: done.map((d) => d._id.sheetId) } }).select("bankId level").lean();
  const out = suited
    .map((bank) => ({
      bank,
      levels: ACTIVITY_LEVELS.filter((l) => (bank.levelClasses?.[l] ?? []).includes(level))
        .map((l) => ({
          level: l,
          sheetCount: counts.find((c) => c._id.bankId.toString() === bank._id.toString() && c._id.level === l)?.n ?? 0,
          doneByChild: doneSheets.filter((s) => s.bankId.toString() === bank._id.toString() && s.level === l).length,
          sampleFileIds: bank.sampleFileIds?.[l] ?? [],
        }))
        .filter((l) => l.sheetCount > 0),
    }))
    .filter((b) => b.levels.length > 0);
  return { banks: out, weeklyLimit: rules.weeklyRequests, usedThisWeek, maxOpen: rules.maxOpen, open };
}

/** The next sheet a child has never had at this bank + level; all done → the one done longest ago. */
export async function nextSheetFor(studentId: Types.ObjectId, bankId: Types.ObjectId, level: ActivityLevel): Promise<{ sheet: IActivitySheet; repeat: boolean } | null> {
  const sheets = (await ActivitySheet.find({ bankId, level, active: true, page: { $exists: true }, sourceFileId: { $exists: true } }).sort({ seq: 1 }).lean()) as unknown as IActivitySheet[];
  if (sheets.length === 0) return null;
  const had = await ActivityIssue.find({ studentId, bankId, status: { $ne: "CANCELLED" } }).select("sheetId requestedAt").lean();
  const last = new Map<string, number>();
  for (const h of had) last.set(h.sheetId.toString(), Math.max(last.get(h.sheetId.toString()) ?? 0, new Date(h.requestedAt).getTime()));
  const fresh = sheets.find((s) => !last.has(s._id.toString()));
  if (fresh) return { sheet: fresh, repeat: false };
  const oldest = [...sheets].sort((a, b) => (last.get(a._id.toString()) ?? 0) - (last.get(b._id.toString()) ?? 0))[0];
  return { sheet: oldest, repeat: true };
}

export async function requestSheet(ctx: AppContext, studentId: string, bankId: string, level: string, now = new Date()): Promise<IActivityIssue> {
  await assertGuardianOfStudent(ctx, studentId);
  if (!(ACTIVITY_LEVELS as readonly string[]).includes(level) || !Types.ObjectId.isValid(bankId)) throw new ActivityError(GUARDIAN_ERRORS_BN.notSuited);
  const lv = level as ActivityLevel;
  const bank = (await ActivityBank.findById(bankId).lean()) as unknown as IActivityBank | null;
  const { level: classLevel } = await childClassLevel(studentId);
  if (!bank || bank.status !== "PUBLISHED" || !(bank.levelClasses?.[lv] ?? []).includes(classLevel)) throw new ActivityError(GUARDIAN_ERRORS_BN.notSuited);
  const rules = await activityRules();
  const sid = new Types.ObjectId(studentId);
  const used = await ActivityIssue.countDocuments({ studentId: sid, path: "GUARDIAN", status: { $ne: "CANCELLED" }, requestedAt: { $gte: new Date(now.getTime() - WEEK_MS) } });
  if (used >= rules.weeklyRequests) throw new ActivityError(GUARDIAN_ERRORS_BN.weekly.replace("{n}", String(used)));
  const open = await ActivityIssue.countDocuments({ studentId: sid, status: { $in: [...OPEN] } });
  if (open >= rules.maxOpen) throw new ActivityError(GUARDIAN_ERRORS_BN.tooMany.replace("{n}", String(open)));
  const next = await nextSheetFor(sid, bank._id, lv);
  if (!next) throw new ActivityError(GUARDIAN_ERRORS_BN.noSheets);
  const issue = await ActivityIssue.create({
    studentId: sid,
    sheetId: next.sheet._id,
    bankId: bank._id,
    path: "GUARDIAN",
    status: "REQUESTED",
    repeat: next.repeat,
    requestedBy: new Types.ObjectId(ctx.auth!.userId),
    requestedAt: now,
  });
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId: ctx.auth!.userId, targetId: issue._id, targetKind: "ActivityIssue", meta: { op: "activityRequest", itemId: next.sheet.itemId, studentId } });
  return issue.toObject() as IActivityIssue;
}

export async function cancelRequest(ctx: AppContext, issueId: string): Promise<IActivityIssue> {
  if (!Types.ObjectId.isValid(issueId)) throw new ActivityError(GUARDIAN_ERRORS_BN.notYours);
  const issue = await ActivityIssue.findById(issueId);
  if (!issue || issue.path !== "GUARDIAN") throw new ActivityError(GUARDIAN_ERRORS_BN.notYours);
  await assertGuardianOfStudent(ctx, issue.studentId.toString());
  if (issue.status !== "REQUESTED") throw new ActivityError(GUARDIAN_ERRORS_BN.notRequested);
  issue.status = "CANCELLED";
  await issue.save();
  return issue.toObject() as IActivityIssue;
}

// ---------------------------------------------------------------------------
// The child's list (guardian status view; staff profile)
// ---------------------------------------------------------------------------

export interface ChildSheetRow {
  issue: IActivityIssue;
  sheet: IActivitySheet;
  bank: IActivityBank;
}

export async function childSheets(studentId: string, limit = 40): Promise<ChildSheetRow[]> {
  await sweepNotReturned();
  const issues = (await ActivityIssue.find({ studentId, status: { $ne: "CANCELLED" } }).sort({ requestedAt: -1 }).limit(limit).lean()) as unknown as IActivityIssue[];
  const [sheets, banks] = await Promise.all([
    ActivitySheet.find({ _id: { $in: issues.map((i) => i.sheetId) } }).lean(),
    ActivityBank.find({ _id: { $in: issues.map((i) => i.bankId) } }).lean(),
  ]);
  const sheetBy = new Map(sheets.map((s) => [s._id.toString(), s as unknown as IActivitySheet]));
  const bankBy = new Map(banks.map((b) => [b._id.toString(), b as unknown as IActivityBank]));
  return issues.flatMap((issue) => {
    const sheet = sheetBy.get(issue.sheetId.toString());
    const bank = bankBy.get(issue.bankId.toString());
    return sheet && bank ? [{ issue, sheet, bank }] : [];
  });
}

// ---------------------------------------------------------------------------
// Morning batch (Office) + hand-out (class teacher / office)
// ---------------------------------------------------------------------------

export interface BatchRow {
  issue: IActivityIssue;
  studentName: string;
  studentNameEn: string;
  classLevel: number | null;
  sectionId: string | null;
  sectionNameBn: string | null;
  sectionCode: string | null;
  itemId: string;
  bankNameBn: string;
}

async function decorate(issues: IActivityIssue[]): Promise<BatchRow[]> {
  if (issues.length === 0) return [];
  const [students, sheets, banks] = await Promise.all([
    Student.find({ _id: { $in: issues.map((i) => i.studentId) } }).select("name nameBn classId sectionId").lean(),
    ActivitySheet.find({ _id: { $in: issues.map((i) => i.sheetId) } }).select("itemId").lean(),
    ActivityBank.find({ _id: { $in: issues.map((i) => i.bankId) } }).select("nameBn").lean(),
  ]);
  const [classes, sections] = await Promise.all([
    Class.find({ _id: { $in: students.map((s) => s.classId) } }).select("level").lean(),
    Section.find({ _id: { $in: students.map((s) => s.sectionId) } }).select("nameBn code").lean(),
  ]);
  const st = new Map(students.map((s) => [s._id.toString(), s]));
  const lv = new Map(classes.map((c) => [c._id.toString(), c.level as number]));
  const sec = new Map(sections.map((s) => [s._id.toString(), s]));
  const item = new Map(sheets.map((s) => [s._id.toString(), s.itemId]));
  const bname = new Map(banks.map((b) => [b._id.toString(), b.nameBn]));
  return issues.map((issue) => {
    const s = st.get(issue.studentId.toString());
    const section = s ? sec.get(s.sectionId?.toString()) : undefined;
    return {
      issue,
      studentName: s ? (s.nameBn as string) || (s.name as string) : "—",
      studentNameEn: (s?.name as string) ?? "",
      classLevel: s ? lv.get(s.classId?.toString()) ?? null : null,
      sectionId: s?.sectionId?.toString() ?? null,
      sectionNameBn: (section?.nameBn as string) ?? null,
      sectionCode: (section?.code as string) ?? null,
      itemId: item.get(issue.sheetId.toString()) ?? "",
      bankNameBn: bname.get(issue.bankId.toString()) ?? "",
    };
  });
}

const sortRows = (rows: BatchRow[]) =>
  rows.sort((a, b) => (a.classLevel ?? 99) - (b.classLevel ?? 99) || (a.sectionCode ?? "").localeCompare(b.sectionCode ?? "") || a.studentNameEn.localeCompare(b.studentNameEn));

/** Requests waiting for the morning print (Office). */
export async function pendingRequests(): Promise<BatchRow[]> {
  const issues = (await ActivityIssue.find({ path: "GUARDIAN", status: "REQUESTED" }).sort({ requestedAt: 1 }).lean()) as unknown as IActivityIssue[];
  return sortRows(await decorate(issues));
}

const latinClass = (level: number | null): string => (level === null ? "" : ROSTER_CLASS_LABELS_EN[level as RosterClassLevel] ?? String(level));
const dhakaShort = (d: Date): string => d.toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short" });
/** pdf-lib's standard fonts are WinAnsi: keep a name printable (no Bangla, no emoji). */
const latin = (s: string): string => s.replace(/[^\x20-\x7E -ÿ]/g, "").replace(/\s+/g, " ").trim();

/** Print every requested sheet (or the chosen ones): PERSONAL copies, one run, requests → PRINTED. */
export async function printBatch(issueIds: string[] | null, actorId: string, now = new Date()): Promise<{ runId: string; sheets: number }> {
  const q: Record<string, unknown> = { path: "GUARDIAN", status: "REQUESTED" };
  if (issueIds && issueIds.length) q._id = { $in: issueIds.filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i)) };
  const rows = sortRows(await decorate((await ActivityIssue.find(q).lean()) as unknown as IActivityIssue[]));
  if (rows.length === 0) throw new ActivityError(GUARDIAN_ERRORS_BN.nothing);
  const runId = `batch-${randomUUID()}`;
  const copies = await makeCopies(rows.map((r) => ({ sheetId: r.issue.sheetId, kind: "PERSONAL" as const, status: "TAKEN" as const, printRunId: runId, issueId: r.issue._id })));
  await ActivityIssue.bulkWrite(
    rows.map((r, i) => ({
      updateOne: { filter: { _id: r.issue._id, status: "REQUESTED" }, update: { $set: { status: "PRINTED", printedAt: now, printRunId: runId, copyId: copies[i]._id } } },
    })),
  );
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetKind: "ActivityCopy", meta: { op: "printActivityBatch", runId, sheets: rows.length } });
  return { runId, sheets: rows.length };
}

/** A morning batch's PDF: a Latin cover slip before each section, each page with the child's line. */
export async function batchPdf(runId: string): Promise<Buffer> {
  const issues = (await ActivityIssue.find({ printRunId: runId }).lean()) as unknown as IActivityIssue[];
  const rows = await decorate(issues);
  const byCopy = new Map(rows.filter((r) => r.issue.copyId).map((r) => [r.issue.copyId!.toString(), r]));
  // Copies were made in the sorted order, so serial order = class → section → name.
  const ordered = [...byCopy.entries()];
  const covers = new Map<string, CoverPage>();
  const lines = new Map<string, string>();
  let lastSection: string | null = "∅";
  for (const [copyId, r] of ordered) {
    const name = latin(r.studentNameEn) || "—";
    const cls = latin(`${latinClass(r.classLevel)}${r.sectionCode ? ` ${r.sectionCode}` : ""}`);
    lines.set(copyId, `${name} · ${cls} · ${dhakaShort(r.issue.printedAt ? new Date(r.issue.printedAt) : new Date())}`);
    if (r.sectionId !== lastSection) {
      const group = ordered.filter(([, x]) => x.sectionId === r.sectionId).map(([, x]) => `${latin(x.studentNameEn) || "—"}  -  ${x.itemId}`);
      covers.set(copyId, { title: `${cls || "Class ?"}  -  ${group.length} sheet${group.length === 1 ? "" : "s"}`, lines: ["Hand these out to the children below:", "", ...group] });
      lastSection = r.sectionId;
    }
  }
  return printRunPdf(runId, covers, lines);
}

/** Printed sheets waiting to be handed out: the caller's class-teacher sections, or all for the office. */
export async function handOutRoster(ctx: AppContext): Promise<BatchRow[]> {
  if (!ctx.auth) throw new ForbiddenError(GUARDIAN_ERRORS_BN.forbidden);
  const issues = (await ActivityIssue.find({ path: "GUARDIAN", status: "PRINTED" }).sort({ printedAt: 1 }).lean()) as unknown as IActivityIssue[];
  const rows = sortRows(await decorate(issues));
  if (callerHasPermission(ctx.auth, "activity_sheets:issue")) return rows;
  const mine = new Set((await Section.find({ classTeacherId: ctx.auth.userId, active: true }).select("_id").lean()).map((s) => s._id.toString()));
  return rows.filter((r) => r.sectionId && mine.has(r.sectionId));
}

export async function handOut(ctx: AppContext, issueIds: string[], now = new Date()): Promise<number> {
  const allowed = new Set((await handOutRoster(ctx)).map((r) => r.issue._id.toString()));
  const ids = issueIds.filter((i) => allowed.has(i)).map((i) => new Types.ObjectId(i));
  if (ids.length === 0) return 0;
  const r = await ActivityIssue.updateMany({ _id: { $in: ids }, status: "PRINTED" }, { $set: { status: "HANDED", handedAt: now, handedBy: new Types.ObjectId(ctx.auth!.userId) } });
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId: ctx.auth!.userId, targetKind: "ActivityIssue", meta: { op: "activityHandOut", count: r.modifiedCount } });
  return r.modifiedCount;
}
