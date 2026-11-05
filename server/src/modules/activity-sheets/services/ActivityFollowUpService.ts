/**
 * Activity sheets — check & follow-up (AS-4, D-#988/#991, docs/prd-activity-sheets.md).
 *
 *  - Checked alert: when a sheet comes back, the family gets a notification
 *    (ACTIVITY_SHEET_CHECKED) — result, sticker, and the level-up hint when earned. No pop-up
 *    (D-#991: notification + Today card).
 *  - Answer page: visible to the guardian only after the sheet came back (D-#991). Rendered
 *    once from the bank's answer PDF and shared by every sheet on that page.
 *  - Level-up hint: `levelUpAfter` সব ঠিক at one level of a bank, and a harder level exists
 *    that suits the child's class → "try মাঝারি next".
 *  - Not returned: a sheet out longer than `notReturnedDays` is closed as NOT_RETURNED (worked
 *    out lazily at read time, no job) and its copy leaves the counts. No reminder (D-#991).
 *  - Stickers owed: returned through the box → the class teacher hands the sticker over and
 *    ticks it off (their own sections; the office sees all).
 *  - Today card: open sheets, the latest checked one, a hint, an owed sticker.
 * Identity plane; no corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { ACTIVITY_LEVELS, ACTIVITY_LEVEL_LABELS_BN, ACTIVITY_RESULT_LABELS_BN, callerHasPermission, type ActivityLevel } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError, assertGuardianOfStudent } from "../../../middleware/authz";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Student } from "../../foundation/models/Student";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { StoredFile } from "../../platform/models/StoredFile";
import { uploadToDrive } from "../../platform/services/DriveStore";
import { writeAudit } from "../../platform/services/AuditService";
import { emit } from "../../notifications/services/NotificationService";
import { ActivityBank, type IActivityBank } from "../models/ActivityBank";
import { ActivitySheet, type IActivitySheet } from "../models/ActivitySheet";
import { ActivityCopy } from "../models/ActivityCopy";
import { ActivityIssue, type IActivityIssue } from "../models/ActivityIssue";
import { ActivityError, loadActivityFile } from "./ActivityBankService";
import { activityRules } from "./ActivitySettingsService";
import { renderPage } from "./pdfTools";

export const FOLLOW_ERRORS_BN = {
  noAnswer: "এই শিটের উত্তর পাতা নেই",
  notBack: "শিটটি ফেরত আসার পরে উত্তর দেখা যাবে",
  notFound: "শিটটি পাওয়া যায়নি",
  forbidden: "অনুমতি নেই",
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const OUT = ["PRINTED", "HANDED"] as const;

// ---------------------------------------------------------------------------
// Not returned (lazy)
// ---------------------------------------------------------------------------

/** Close sheets out longer than the rule; their copies leave the tray counts. Idempotent. */
export async function sweepNotReturned(now = new Date()): Promise<number> {
  const rules = await activityRules();
  const cutoff = new Date(now.getTime() - rules.notReturnedDays * DAY_MS);
  const stale = await ActivityIssue.find({
    status: { $in: [...OUT] },
    $or: [{ handedAt: { $lt: cutoff } }, { handedAt: { $exists: false }, printedAt: { $lt: cutoff } }],
  })
    .select("_id copyId")
    .lean();
  if (stale.length === 0) return 0;
  await ActivityIssue.updateMany({ _id: { $in: stale.map((s) => s._id) }, status: { $in: [...OUT] } }, { $set: { status: "NOT_RETURNED" } });
  const copies = stale.map((s) => s.copyId).filter((c): c is Types.ObjectId => !!c);
  if (copies.length) await ActivityCopy.updateMany({ _id: { $in: copies }, status: "TAKEN" }, { $set: { status: "LOST" } });
  return stale.length;
}

// ---------------------------------------------------------------------------
// Level-up hint
// ---------------------------------------------------------------------------

export interface LevelUpHint {
  bankId: string;
  bankNameBn: string;
  from: ActivityLevel;
  to: ActivityLevel;
}

async function classLevelOf(studentId: Types.ObjectId | string): Promise<number | null> {
  const s = await Student.findById(studentId).select("classId").lean();
  if (!s) return null;
  const c = await Class.findById(s.classId).select("level").lean();
  return (c?.level as number) ?? null;
}

export async function levelUpHints(studentId: string): Promise<LevelUpHint[]> {
  const rules = await activityRules();
  const sid = new Types.ObjectId(studentId);
  const rows = await ActivityIssue.aggregate<{ _id: { bankId: Types.ObjectId; sheetId: Types.ObjectId } }>([
    { $match: { studentId: sid, status: "RETURNED", result: "ALL_CORRECT" } },
    { $group: { _id: { bankId: "$bankId", sheetId: "$sheetId" } } },
  ]);
  if (rows.length === 0) return [];
  const sheets = await ActivitySheet.find({ _id: { $in: rows.map((r) => r._id.sheetId) } }).select("bankId level").lean();
  const counts = new Map<string, number>();
  for (const s of sheets) counts.set(`${s.bankId}:${s.level}`, (counts.get(`${s.bankId}:${s.level}`) ?? 0) + 1);
  const level = await classLevelOf(sid);
  const banks = (await ActivityBank.find({ _id: { $in: [...new Set(sheets.map((s) => s.bankId.toString()))] }, status: "PUBLISHED" }).lean()) as unknown as IActivityBank[];
  const out: LevelUpHint[] = [];
  for (const b of banks) {
    // The highest level the child has mastered at this bank decides the hint.
    for (let i = ACTIVITY_LEVELS.length - 2; i >= 0; i--) {
      const from = ACTIVITY_LEVELS[i];
      if ((counts.get(`${b._id}:${from}`) ?? 0) < rules.levelUpAfter) continue;
      const to = ACTIVITY_LEVELS.slice(i + 1).find((l) => level !== null && (b.levelClasses?.[l] ?? []).includes(level));
      if (to && (counts.get(`${b._id}:${to}`) ?? 0) < rules.levelUpAfter) out.push({ bankId: b._id.toString(), bankNameBn: b.nameBn, from, to });
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checked alert
// ---------------------------------------------------------------------------

export const checkedKey = (issueId: string, guardianId: string): string => `ASC:${issueId}:${guardianId}`;

export async function alertChecked(issue: IActivityIssue): Promise<number> {
  if (issue.status !== "RETURNED" || !issue.result) return 0;
  const [student, sheet, bank, links] = await Promise.all([
    Student.findById(issue.studentId).select("name nameBn").lean(),
    ActivitySheet.findById(issue.sheetId).select("itemId level").lean(),
    ActivityBank.findById(issue.bankId).select("nameBn").lean(),
    GuardianLink.find({ studentId: issue.studentId }).select("guardianId active").lean(),
  ]);
  if (!student || !sheet || !bank) return 0;
  const guardians = await Guardian.find({ _id: { $in: links.filter((l) => l.active !== false).map((l) => l.guardianId) }, active: true }).select("_id").lean();
  const child = (student.nameBn || student.name) as string;
  const titleBn = issue.stickerGiven || issue.stickerOwed ? `${child} একটি অ্যাক্টিভিটি শিট শেষ করেছে ★` : `${child}-এর অ্যাক্টিভিটি শিট দেখা হয়েছে`;
  const parts = [`${bank.nameBn} (${ACTIVITY_LEVEL_LABELS_BN[sheet.level as ActivityLevel]}) — ${ACTIVITY_RESULT_LABELS_BN[issue.result]}।`];
  if (issue.stickerGiven) parts.push("স্টিকার পেয়েছে।");
  if (issue.stickerOwed) parts.push("স্টিকারটি শ্রেণি শিক্ষক দেবেন।");
  const hint = issue.result === "ALL_CORRECT" ? (await levelUpHints(issue.studentId.toString())).find((h) => h.bankId === issue.bankId.toString()) : undefined;
  if (hint) parts.push(`এবার ${ACTIVITY_LEVEL_LABELS_BN[hint.to]} স্তর চেষ্টা করতে পারে।`);
  parts.push("অ্যাপে উত্তর দেখে নিন।");
  let n = 0;
  for (const g of guardians) {
    const r = await emit({
      recipientGuardianId: g._id.toString(),
      recipientUserId: null,
      kind: "ACTIVITY_SHEET_CHECKED",
      titleBn,
      bodyBn: parts.join(" "),
      refs: { studentId: issue.studentId.toString() },
      dedupeKey: checkedKey(issue._id.toString(), g._id.toString()),
    }).catch(() => ({ created: false }));
    if (r.created) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Answer page
// ---------------------------------------------------------------------------

/** Render (once) and return the answer page of a returned sheet, as a JPEG data URI. */
export async function answerImage(ctx: AppContext, issueId: string): Promise<string> {
  if (!ctx.auth) throw new ForbiddenError(FOLLOW_ERRORS_BN.forbidden);
  if (!Types.ObjectId.isValid(issueId)) throw new ActivityError(FOLLOW_ERRORS_BN.notFound);
  const issue = await ActivityIssue.findById(issueId).lean();
  if (!issue) throw new ActivityError(FOLLOW_ERRORS_BN.notFound);
  const staff = callerHasPermission(ctx.auth, "activity_sheets:view");
  if (!staff) {
    await assertGuardianOfStudent(ctx, issue.studentId.toString());
    if (issue.status !== "RETURNED") throw new ActivityError(FOLLOW_ERRORS_BN.notBack);
  }
  const sheet = (await ActivitySheet.findById(issue.sheetId).lean()) as unknown as IActivitySheet | null;
  const bank = sheet ? await ActivityBank.findById(sheet.bankId).select("answerFileId").lean() : null;
  if (!sheet?.answerPage || !bank?.answerFileId) throw new ActivityError(FOLLOW_ERRORS_BN.noAnswer);
  let fileId = sheet.answerImageId;
  if (!fileId) {
    const jpg = await renderPage(await loadActivityFile(bank.answerFileId), sheet.answerPage, 1100);
    const driveFileId = await uploadToDrive({ name: `${sheet.itemId}-answer.jpg`, mime: "image/jpeg", data: jpg, year: String(new Date().getFullYear()), subfolder: "activity-sheets" });
    const f = await StoredFile.create({ kind: "activity_page", mime: "image/jpeg", sizeBytes: jpg.byteLength, originalName: `${sheet.itemId}-answer.jpg`, driveFileId, uploadedBy: ctx.auth.userId });
    fileId = f._id;
    await ActivitySheet.updateMany({ bankId: sheet.bankId, answerPage: sheet.answerPage }, { $set: { answerImageId: fileId } });
  }
  const data = await loadActivityFile(fileId);
  return `data:image/jpeg;base64,${data.toString("base64")}`;
}

/** GET /files/:id for an answer image: staff, or a guardian whose child returned a sheet on that page. */
export async function assertAnswerImageAccess(ctx: AppContext, fileId: Types.ObjectId): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError(FOLLOW_ERRORS_BN.forbidden);
  if (callerHasPermission(ctx.auth, "activity_sheets:view")) return;
  const sheets = await ActivitySheet.find({ answerImageId: fileId }).select("_id").lean();
  if (sheets.length === 0 || ctx.auth.role !== "GUARDIAN") throw new ForbiddenError(FOLLOW_ERRORS_BN.forbidden);
  const kids = (await GuardianLink.find({ guardianId: ctx.auth.userId }).select("studentId active").lean()).filter((l) => l.active !== false).map((l) => l.studentId);
  const ok = await ActivityIssue.exists({ studentId: { $in: kids }, sheetId: { $in: sheets.map((s) => s._id) }, status: "RETURNED" });
  if (!ok) throw new ForbiddenError(FOLLOW_ERRORS_BN.forbidden);
}

// ---------------------------------------------------------------------------
// Stickers owed
// ---------------------------------------------------------------------------

export interface OwedRow {
  issue: IActivityIssue;
  studentName: string;
  classLevel: number | null;
  sectionNameBn: string | null;
  bankNameBn: string;
}

export async function stickersOwed(ctx: AppContext): Promise<OwedRow[]> {
  if (!ctx.auth) throw new ForbiddenError(FOLLOW_ERRORS_BN.forbidden);
  const issues = (await ActivityIssue.find({ stickerOwed: true, status: "RETURNED" }).sort({ returnedAt: 1 }).lean()) as unknown as IActivityIssue[];
  if (issues.length === 0) return [];
  const students = await Student.find({ _id: { $in: issues.map((i) => i.studentId) } }).select("name nameBn classId sectionId").lean();
  let allowed: Set<string> | null = null;
  if (!callerHasPermission(ctx.auth, "activity_sheets:issue")) {
    allowed = new Set((await Section.find({ classTeacherId: ctx.auth.userId, active: true }).select("_id").lean()).map((s) => s._id.toString()));
  }
  const [classes, sections, banks] = await Promise.all([
    Class.find({ _id: { $in: students.map((s) => s.classId) } }).select("level").lean(),
    Section.find({ _id: { $in: students.map((s) => s.sectionId) } }).select("nameBn").lean(),
    ActivityBank.find({ _id: { $in: issues.map((i) => i.bankId) } }).select("nameBn").lean(),
  ]);
  const st = new Map(students.map((s) => [s._id.toString(), s]));
  const lv = new Map(classes.map((c) => [c._id.toString(), c.level as number]));
  const sec = new Map(sections.map((s) => [s._id.toString(), s.nameBn as string]));
  const bn = new Map(banks.map((b) => [b._id.toString(), b.nameBn]));
  return issues.flatMap((issue) => {
    const s = st.get(issue.studentId.toString());
    if (!s) return [];
    if (allowed && !allowed.has(s.sectionId?.toString())) return [];
    return [
      {
        issue,
        studentName: ((s.nameBn as string) || (s.name as string)) ?? "",
        classLevel: lv.get(s.classId?.toString()) ?? null,
        sectionNameBn: sec.get(s.sectionId?.toString()) ?? null,
        bankNameBn: bn.get(issue.bankId.toString()) ?? "",
      },
    ];
  });
}

export async function giveOwedStickers(ctx: AppContext, issueIds: string[]): Promise<number> {
  const allowed = new Set((await stickersOwed(ctx)).map((r) => r.issue._id.toString()));
  const ids = issueIds.filter((i) => allowed.has(i)).map((i) => new Types.ObjectId(i));
  if (ids.length === 0) return 0;
  const r = await ActivityIssue.updateMany({ _id: { $in: ids }, stickerOwed: true }, { $set: { stickerOwed: false, stickerGiven: true } });
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId: ctx.auth!.userId, targetKind: "ActivityIssue", meta: { op: "activityStickersGiven", count: r.modifiedCount } });
  return r.modifiedCount;
}

// ---------------------------------------------------------------------------
// Today card (guardian)
// ---------------------------------------------------------------------------

export interface ActivityToday {
  open: number;
  latest: { issue: IActivityIssue; bankNameBn: string; itemId: string } | null;
  hint: LevelUpHint | null;
  owed: number;
  doneThisMonth: number;
}

export async function activityToday(studentId: string, now = new Date()): Promise<ActivityToday> {
  await sweepNotReturned(now);
  const sid = new Types.ObjectId(studentId);
  const [open, latest, owed, done] = await Promise.all([
    ActivityIssue.countDocuments({ studentId: sid, status: { $in: ["REQUESTED", "PRINTED", "HANDED"] } }),
    ActivityIssue.findOne({ studentId: sid, status: "RETURNED", returnedAt: { $gte: new Date(now.getTime() - 7 * DAY_MS) } }).sort({ returnedAt: -1 }).lean(),
    ActivityIssue.countDocuments({ studentId: sid, stickerOwed: true }),
    ActivityIssue.countDocuments({ studentId: sid, status: "RETURNED", result: { $ne: "INCOMPLETE" }, returnedAt: { $gte: new Date(now.getTime() - 30 * DAY_MS) } }),
  ]);
  let latestView: ActivityToday["latest"] = null;
  if (latest) {
    const [sheet, bank] = await Promise.all([ActivitySheet.findById(latest.sheetId).select("itemId").lean(), ActivityBank.findById(latest.bankId).select("nameBn").lean()]);
    latestView = { issue: latest as unknown as IActivityIssue, bankNameBn: bank?.nameBn ?? "", itemId: sheet?.itemId ?? "" };
  }
  const hints = await levelUpHints(studentId);
  return { open, latest: latestView, hint: hints[0] ?? null, owed, doneThisMonth: done };
}
