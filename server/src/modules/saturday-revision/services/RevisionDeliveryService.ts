/**
 * RevisionDeliveryService (SR-2, prd-sr2 §3, D-#244/#245) — deliver a Saturday Hifz
 * revision entry to the family + run the consecutive-absence escalation. NO recording
 * here (that is SR-1).
 *
 *   deliverEntry           — stamp `deliveredAt` + `deliveryChannels` (SEALS the SR-1
 *                            immutability — recordEntry/editEntry already refuse a
 *                            delivered entry), then deliver on the existing rails:
 *                              • absent (present=false) → render `sr.absent.*`;
 *                              • present → render `sr.digest.*` (portions by category,
 *                                Σ تنبیه/فتح, mistake-category summary, the comment);
 *                              • a wa.me link for EVERY family with a phone
 *                                (Student.phone, ADR-003; phone-less → unreachableByWa);
 *                              • `emitRevisionDelivery` → inbox + push for login-enabled
 *                                guardians (D-#72). After delivering an absent entry it
 *                                runs the consecutive-absence escalation.
 *   deliverGroupSaturday   — batch-deliver every entry for a (group × Saturday).
 *   get/setEscalationConfig — the read-time admin threshold (N=2 default, no seed — D-#97).
 *
 * Bodies render from the MT registry (`sr.absent.*` / `sr.digest.*`, D-#131 — NEVER
 * inline). **N+1 guard:** the title + body are rendered ONCE per recipient group and
 * passed pre-rendered to the emitter. Write-scope is enforced by the RESOLVER.
 * Identity plane (names studentIds); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import {
  REVISION_CATEGORY_LABELS_BN,
  REVISION_MISTAKE_CATEGORY_LABELS_BN,
} from "@scd/shared";
import type { RevisionCategory, RevisionMistakeCategory } from "@scd/shared";
import { RevisionEntry, type IRevisionEntry, type IJuzRecord } from "../models/RevisionEntry";
import { RevisionEscalationConfig } from "../models/RevisionEscalationConfig";
import { RevisionAbsenceDispatch } from "../models/RevisionAbsenceDispatch";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { renderTemplate } from "../../templates/services/MessageTemplateService";
import { emitRevisionDelivery, emitRevisionEscalation } from "../../notifications/services/emitters";
import { dateKeyOf } from "../../attendance/dates";
import { writeAudit } from "../../platform/services/AuditService";
import { RevisionError } from "./RevisionService";
import { actingAsFilter } from "../../foundation/services/RoleScope";

/** The read-time default consecutive-absence threshold (D-#245/#97 — no seed write). */
export const DEFAULT_ABSENCE_THRESHOLD = 2;

/** wa.me click-to-send link (ADR-003 — always a MANUAL send; null when no phone). */
export function revisionWaLink(phone: string | undefined | null, message: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export interface RevisionDeliveryOutcome {
  entryId: string;
  studentId: string;
  studentName: string;
  present: boolean;
  kind: "SR_ABSENT" | "SR_DIGEST";
  /** The rendered Bangla body (the wa.me + inbox text). */
  messageBn: string;
  waLink: string | null;
  unreachableByWa: boolean;
  notifiedGuardianIds: string[];
  deliveryChannels: string[];
  deliveredAt: string;
  /** The streak length at delivery if an absence escalation fired this call (else null). */
  escalatedStreak: number | null;
}

type StudentLite = { _id: Types.ObjectId; name?: string; nameBn?: string; phone?: string };

/** A Bangla per-juz digest of a present student's Saturday (the sr.digest.body `Summary`). */
export function buildDigestSummary(records: IJuzRecord[], teacherComment?: string): string {
  if (records.length === 0) return teacherComment?.trim() || "—";
  // Portions heard per category (Σ amountJuz).
  const byCategory = new Map<RevisionCategory, number>();
  let tanbih = 0;
  let fath = 0;
  const mistakeTotals: Record<RevisionMistakeCategory, number> = { HARF: 0, GHUNNAH: 0, MADD: 0, OTHER: 0 };
  for (const r of records) {
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.amountJuz);
    tanbih += r.tanbih ?? 0;
    fath += r.fath ?? 0;
    mistakeTotals.HARF += r.mistakes?.harf ?? 0;
    mistakeTotals.GHUNNAH += r.mistakes?.ghunnah ?? 0;
    mistakeTotals.MADD += r.mistakes?.madd ?? 0;
    mistakeTotals.OTHER += r.mistakes?.other ?? 0;
  }
  const portions = [...byCategory.entries()]
    .map(([cat, amt]) => `${REVISION_CATEGORY_LABELS_BN[cat]}: ${amt} পারা`)
    .join("; ");
  const mistakeStr = (Object.keys(mistakeTotals) as RevisionMistakeCategory[])
    .filter((k) => mistakeTotals[k] > 0)
    .map((k) => `${REVISION_MISTAKE_CATEGORY_LABELS_BN[k]}: ${mistakeTotals[k]}`)
    .join(", ");

  const lines: string[] = [];
  if (portions) lines.push(portions);
  lines.push(`তানবিহ: ${tanbih}, ফাতহ: ${fath}`);
  lines.push(mistakeStr ? `ভুল — ${mistakeStr}` : "ভুল নেই — মাশাআল্লাহ");
  if (teacherComment?.trim()) lines.push(`মন্তব্য: ${teacherComment.trim()}`);
  return lines.join("\n");
}

/**
 * Deliver one revision entry to the family (J-SR2-1/2/3). Idempotent on `deliveredAt`
 * (stamped once, on the first delivery — that seals immutability); the wa.me link is
 * (re)generated each call and the emit is dedupe-keyed per (entry, guardian). Returns
 * the per-entry delivery payload.
 */
export async function deliverEntry(entryId: string, actorId: string): Promise<RevisionDeliveryOutcome> {
  if (!Types.ObjectId.isValid(entryId)) throw new RevisionError("Invalid entry id");
  const entry = (await RevisionEntry.findById(entryId)) as IRevisionEntry | null;
  if (!entry) throw new RevisionError("Entry not found");

  const student = (await Student.findById(entry.studentId)
    .select("name nameBn phone")
    .lean()) as unknown as StudentLite | null;
  const studentName = student?.nameBn || student?.name || "শিক্ষার্থী";
  const dateKey = dateKeyOf(new Date(entry.date));
  const kind: "SR_ABSENT" | "SR_DIGEST" = entry.present ? "SR_DIGEST" : "SR_ABSENT";

  // N+1 guard: render the title + body ONCE here; the emitter takes pre-rendered text.
  const titleBn = await renderTemplate(entry.present ? "sr.digest.title" : "sr.absent.title");
  const messageBn = entry.present
    ? await renderTemplate("sr.digest.body", {
        StudentName: studentName,
        Date: dateKey,
        Summary: buildDigestSummary(entry.juzRecords ?? [], entry.teacherComment),
      })
    : await renderTemplate("sr.absent.body", { StudentName: studentName, Date: dateKey });

  const waLink = revisionWaLink(student?.phone, messageBn);
  const notifiedGuardianIds = await emitRevisionDelivery({
    entryId: entry._id,
    studentId: entry.studentId,
    kind,
    titleBn,
    messageBn,
  });

  const channels: string[] = [];
  if (waLink) channels.push("wa");
  if (notifiedGuardianIds.length > 0) channels.push("inbox");

  // Stamp deliveredAt ONCE (seals immutability); refresh deliveryChannels each call.
  const deliveredAt = entry.deliveredAt ?? new Date();
  entry.deliveredAt = deliveredAt;
  entry.deliveryChannels = channels;
  await entry.save();

  await writeAudit({
    eventKind: "SR_ENTRY_DELIVERED",
    actorId,
    targetId: entry._id,
    targetKind: "RevisionEntry",
    meta: {
      studentId: entry.studentId.toString(),
      groupId: entry.groupId.toString(),
      present: entry.present,
      channels,
      notifiedCount: notifiedGuardianIds.length,
      unreachableByWa: !waLink,
    },
  });

  // Consecutive-absence escalation — only on an absent delivery (J-SR2-4).
  let escalatedStreak: number | null = null;
  if (!entry.present) {
    escalatedStreak = await checkAbsenceEscalation(entry.studentId.toString(), new Date(entry.date), studentName, actorId);
  }

  return {
    entryId: entry._id.toString(),
    studentId: entry.studentId.toString(),
    studentName,
    present: entry.present,
    kind,
    messageBn,
    waLink,
    unreachableByWa: !waLink,
    notifiedGuardianIds,
    deliveryChannels: channels,
    deliveredAt: new Date(deliveredAt).toISOString(),
    escalatedStreak,
  };
}

/** Batch-deliver every entry for a (group × Saturday). Returns each entry's outcome. */
export async function deliverGroupSaturday(
  groupId: string,
  date: Date,
  actorId: string,
): Promise<RevisionDeliveryOutcome[]> {
  if (!Types.ObjectId.isValid(groupId)) throw new RevisionError("Invalid group id");
  const entries = (await RevisionEntry.find({ groupId: new Types.ObjectId(groupId), date })
    .select("_id")
    .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  const out: RevisionDeliveryOutcome[] = [];
  for (const e of entries) {
    out.push(await deliverEntry(e._id.toString(), actorId));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Consecutive-absence escalation (D-#245)
// ---------------------------------------------------------------------------

/** The most-recent consecutive run of absent (present=false) entries for a student
 *  (counting back over their recorded Saturdays, newest first). 0 when the latest
 *  recorded entry is present. */
export async function consecutiveAbsenceStreak(studentId: string): Promise<number> {
  const docs = (await RevisionEntry.find({ studentId: new Types.ObjectId(studentId) })
    .sort({ date: -1 })
    .select("present")
    .lean()) as unknown as Array<{ present: boolean }>;
  let streak = 0;
  for (const d of docs) {
    if (d.present === false) streak += 1;
    else break;
  }
  return streak;
}

export interface RevisionEscalationConfigShape {
  consecutiveAbsenceThreshold: number;
  isDefault: boolean;
}

export async function getEscalationConfig(): Promise<RevisionEscalationConfigShape> {
  const row = (await RevisionEscalationConfig.findOne({ key: "SINGLETON" }).lean()) as
    | { consecutiveAbsenceThreshold?: number }
    | null;
  if (!row || typeof row.consecutiveAbsenceThreshold !== "number") {
    return { consecutiveAbsenceThreshold: DEFAULT_ABSENCE_THRESHOLD, isDefault: true };
  }
  return { consecutiveAbsenceThreshold: row.consecutiveAbsenceThreshold, isDefault: false };
}

export async function setEscalationConfig(threshold: number, actorId: string): Promise<RevisionEscalationConfigShape> {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new RevisionError("The consecutive-absence threshold must be a positive integer");
  }
  await RevisionEscalationConfig.findOneAndUpdate(
    { key: "SINGLETON" },
    { $set: { consecutiveAbsenceThreshold: threshold } },
    { upsert: true, new: true },
  );
  await writeAudit({
    eventKind: "SR_ESCALATION_CONFIG_SET",
    actorId,
    targetKind: "RevisionEscalationConfig",
    meta: { consecutiveAbsenceThreshold: threshold },
  });
  return { consecutiveAbsenceThreshold: threshold, isDefault: false };
}

/**
 * Escalate when a student reaches N consecutive Saturday absences (J-SR2-4). Idempotent
 * per (student, streakLength) via the RevisionAbsenceDispatch ledger — fires once per
 * threshold crossing. Returns the streak that escalated this call, or null. The
 * notification reuses SR_ABSENT with an escalation ref (D-#245).
 */
export async function checkAbsenceEscalation(
  studentId: string,
  date: Date,
  studentName: string,
  actorId: string,
): Promise<number | null> {
  const { consecutiveAbsenceThreshold } = await getEscalationConfig();
  const streak = await consecutiveAbsenceStreak(studentId);
  if (streak < consecutiveAbsenceThreshold) return null;

  // Idempotency: one escalation per (student, streak length).
  try {
    await RevisionAbsenceDispatch.create({
      studentId: new Types.ObjectId(studentId),
      streakLength: streak,
      date,
      sentAt: new Date(),
    });
  } catch (err: unknown) {
    // Duplicate key ⇒ already escalated for this streak length — a silent no-op.
    if ((err as { code?: number })?.code === 11000) return null;
    throw err;
  }

  const principals = (await User.find(actingAsFilter(["PRINCIPAL"]))
    .select("_id")
    .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  const titleBn = await renderTemplate("sr.absent.title");
  const messageBn = await renderTemplate("sr.absent.body", {
    StudentName: studentName,
    Date: `${streak} সপ্তাহ ধারাবাহিক`,
  });
  await emitRevisionEscalation({
    studentId: new Types.ObjectId(studentId),
    streakLength: streak,
    principalUserIds: principals.map((p) => p._id),
    titleBn,
    messageBn,
  });

  await writeAudit({
    eventKind: "SR_ABSENCE_ESCALATED",
    actorId,
    targetId: new Types.ObjectId(studentId),
    targetKind: "Student",
    meta: { studentId, streakLength: streak, threshold: consecutiveAbsenceThreshold },
  });

  return streak;
}
