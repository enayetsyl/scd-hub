/**
 * AssignmentFollowUpService (AS-T4, D-#88) — the Office-owned guardian
 * follow-up: chase list + escalation ladder + Bangla message generation +
 * manual wa.me path. Follow-up is an OFFICE action — the class-teacher gate
 * (D-#42/#45) is deliberately NOT used in this module (D-#88); the resolver
 * enforces Principal/Office.
 *
 * Ladder per chased record:
 *   step 1 (IN_APP_1) + step 2 (IN_APP_2) — guardian in-app notification rows
 *     via the D-#72 emit() seam (emitAssignmentGuardianChase). When nothing
 *     can be delivered (kind not yet registered / no login-enabled guardian /
 *     Office chose to skip) the step is logged SKIPPED — the PRD's recorded
 *     delivery-reality posture; the ladder still advances.
 *   step 3+ (WHATSAPP, or CALL/OTHER) — generated Bangla message + wa.me link
 *     (ADR-003 — always MANUAL send), logged PENDING until Office stamps the
 *     outcome (SENT/SKIPPED + free-text).
 *
 * Every step is an append-only AssignmentFollowUp row (ADR-008).
 */
import { HW_SUBJECT_LABELS_BN } from "@scd/shared";
import { AssignmentFollowUp, type FollowUpStep, type IAssignmentFollowUp } from "../models/AssignmentFollowUp";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import { AssignmentItem, type IAssignmentItem } from "../models/AssignmentItem";
import { Student } from "../../foundation/models/Student";
import { emitAssignmentGuardianChase } from "../../notifications/services/emitters";
import { atMidnight } from "../assignmentCalendar";

// ---------------------------------------------------------------------------
// The §7 guardian message (Bangla, generated; template reviewed by the
// Principal at AS-T4 build time — wording follows the sheet's Guardian
// Messages tab: আসসালামু আলাইকুম … মা'আসসালামাহ, SCD Admin)
// ---------------------------------------------------------------------------

function formatDateBn(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export interface GuardianMessageInput {
  studentName: string;
  subject: string;
  asId: string;
  deliveryDate: Date;
  dueDate: Date;
}

/** Placeholders filled from the record: student name, subject label (Bangla),
 *  delivery date, due date (PRD §7). English codes (AS-ID) stay English. */
export function buildAssignmentGuardianMessage(input: GuardianMessageInput): string {
  const subjectBn =
    (HW_SUBJECT_LABELS_BN as Record<string, string>)[input.subject] ?? input.subject;
  return (
    `আসসালামু আলাইকুম। সম্মানিত অভিভাবক, ` +
    `আপনার সন্তান ${input.studentName}-এর ${subjectBn} অ্যাসাইনমেন্টটি (${input.asId}) এখনও জমা হয়নি। ` +
    `অ্যাসাইনমেন্টটি ${formatDateBn(input.deliveryDate)} তারিখে দেওয়া হয়েছিল এবং ` +
    `${formatDateBn(input.dueDate)} তারিখে জমা দেওয়ার কথা ছিল। ` +
    `অনুগ্রহ করে আপনার সন্তানকে অ্যাসাইনমেন্টটি দ্রুত জমা দিতে সহায়তা করুন। ` +
    `মা'আসসালামাহ — SCD Admin`
  );
}

/** Normalise a phone to a wa.me target (digits only; same convention as the
 *  existing builders — ADR-003). */
function waLinkFor(phone: string | undefined, message: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d]/g, "");
  if (!digits) return undefined;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// ---------------------------------------------------------------------------
// Chase list (the Office worklist)
// ---------------------------------------------------------------------------

export interface ChaseListEntry {
  recordId: string;
  asItemId: string;
  asId: string;
  subject: string;
  weekNumber: number;
  studentId: string;
  studentName: string;
  /** Family contact phone (D-#59 — the guardian login/WA number). */
  guardianPhone: string | null;
  sectionId: string;
  classId: string;
  dueDate: string | null;
  daysOverdue: number;
  chaseCount: number;
  /** Ladder rows already taken for this record. */
  followUpCount: number;
  /** The step the next escalation will take (1/2 → in-app, 3+ → WhatsApp). */
  nextStepNumber: number;
}

export async function assignmentChaseList(asOf: Date = new Date()): Promise<ChaseListEntry[]> {
  const records = (await AssignmentStudentRecord.find({ state: "CHASE" }).lean()) as unknown as Array<{
    _id: { toString(): string };
    asItemId: { toString(): string };
    asId: string;
    studentId: { toString(): string };
    sectionId: { toString(): string };
    classId: { toString(): string };
    dueDate?: Date;
    chaseCount: number;
  }>;
  if (records.length === 0) return [];

  const itemIds = [...new Set(records.map((r) => r.asItemId.toString()))];
  const studentIds = [...new Set(records.map((r) => r.studentId.toString()))];
  const recordIds = records.map((r) => r._id.toString());

  const [items, students, followUps] = await Promise.all([
    AssignmentItem.find({ _id: { $in: itemIds } }).lean() as unknown as Promise<IAssignmentItem[]>,
    Student.find({ _id: { $in: studentIds } })
      .select("name phone")
      .lean() as unknown as Promise<Array<{ _id: { toString(): string }; name: string; phone?: string }>>,
    AssignmentFollowUp.find({ recordId: { $in: recordIds } })
      .select("recordId")
      .lean() as unknown as Promise<Array<{ recordId: { toString(): string } }>>,
  ]);
  const itemById = new Map(items.map((i) => [i._id.toString(), i]));
  const studentById = new Map(students.map((s) => [s._id.toString(), s]));
  const followUpCounts = new Map<string, number>();
  for (const f of followUps) {
    const k = f.recordId.toString();
    followUpCounts.set(k, (followUpCounts.get(k) ?? 0) + 1);
  }

  const today = atMidnight(asOf).getTime();
  return records
    .map((r) => {
      const item = itemById.get(r.asItemId.toString());
      const student = studentById.get(r.studentId.toString());
      const due = r.dueDate ? atMidnight(new Date(r.dueDate)).getTime() : null;
      const followUpCount = followUpCounts.get(r._id.toString()) ?? 0;
      return {
        recordId: r._id.toString(),
        asItemId: r.asItemId.toString(),
        asId: r.asId,
        subject: item?.subject ?? "?",
        weekNumber: item?.weekNumber ?? 0,
        studentId: r.studentId.toString(),
        studentName: student?.name ?? "?",
        guardianPhone: student?.phone ?? null,
        sectionId: r.sectionId.toString(),
        classId: r.classId.toString(),
        dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : null,
        daysOverdue: due === null ? 0 : Math.max(0, Math.round((today - due) / 86_400_000)),
        chaseCount: r.chaseCount,
        followUpCount,
        nextStepNumber: followUpCount + 1,
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

// ---------------------------------------------------------------------------
// Escalation (one ladder step per call)
// ---------------------------------------------------------------------------

export interface EscalateInput {
  recordId: string;
  /** Office may skip an in-app step explicitly (PRD: "mark in-app steps
   *  skipped and go straight to WhatsApp" — call once per skipped step). */
  skipInApp?: boolean;
  /** At step 3+ only: record a CALL/OTHER contact instead of WhatsApp. */
  manualStep?: "CALL" | "OTHER";
  actorId: string;
  at?: Date;
}

export interface EscalateResult {
  followUpId: string;
  recordId: string;
  stepNumber: number;
  step: FollowUpStep;
  sentStatus: string;
  messageBn: string;
  waLink: string | null;
  notifiedGuardianIds: string[];
}

export async function escalateAssignmentChase(input: EscalateInput): Promise<EscalateResult> {
  const rec = await AssignmentStudentRecord.findById(input.recordId).lean();
  if (!rec) throw new Error("AssignmentStudentRecord not found");
  if (rec.state !== "CHASE") {
    throw new Error("Follow-up applies to records in CHASE only (the chase list)");
  }
  const item = (await AssignmentItem.findById(rec.asItemId).lean()) as IAssignmentItem | null;
  if (!item) throw new Error("AssignmentItem not found");
  const student = (await Student.findById(rec.studentId).select("name phone").lean()) as unknown as {
    name: string;
    phone?: string;
  } | null;
  if (!student) throw new Error("Student not found");

  const taken = await AssignmentFollowUp.countDocuments({ recordId: rec._id });
  const stepNumber = taken + 1;
  const step: FollowUpStep =
    stepNumber === 1 ? "IN_APP_1" : stepNumber === 2 ? "IN_APP_2" : (input.manualStep ?? "WHATSAPP");
  if (input.manualStep && stepNumber < 3) {
    throw new Error("CALL/OTHER apply from step 3 — steps 1–2 are the in-app ladder (D-#88)");
  }

  const at = input.at ?? new Date();
  const messageBn = buildAssignmentGuardianMessage({
    studentName: student.name,
    subject: item.subject,
    asId: rec.asId,
    deliveryDate: new Date(item.deliveryDate),
    dueDate: new Date(item.dueDate),
  });

  let sentStatus: string;
  let waLink: string | undefined;
  let notified: string[] = [];

  if (step === "IN_APP_1" || step === "IN_APP_2") {
    if (!input.skipInApp) {
      notified = await emitAssignmentGuardianChase({
        recordId: rec._id,
        asItemId: item._id,
        asId: rec.asId,
        studentId: rec.studentId,
        sectionId: rec.sectionId,
        stepNumber,
        messageBn,
      });
    }
    // RECORDED when at least one inbox row was written; SKIPPED otherwise
    // (Office skip, contact-only guardians, or the kind not yet registered).
    sentStatus = notified.length > 0 ? "RECORDED" : "SKIPPED";
  } else {
    waLink = step === "WHATSAPP" ? waLinkFor(student.phone, messageBn) : undefined;
    sentStatus = "PENDING"; // Office sends manually, then stamps the outcome
  }

  const row = await AssignmentFollowUp.create({
    recordId: rec._id,
    asItemId: item._id,
    asId: rec.asId,
    studentId: rec.studentId,
    sectionId: rec.sectionId,
    stepNumber,
    step,
    messageBn,
    waLink,
    notifiedGuardianIds: notified,
    sentStatus,
    followUpDate: at,
    createdBy: input.actorId,
  });

  return {
    followUpId: row._id.toString(),
    recordId: rec._id.toString(),
    stepNumber,
    step,
    sentStatus,
    messageBn,
    waLink: waLink ?? null,
    notifiedGuardianIds: notified,
  };
}

// ---------------------------------------------------------------------------
// Outcome stamp (the ONLY post-append mutation — sheet's Sent Status)
// ---------------------------------------------------------------------------

export async function recordFollowUpOutcome(
  followUpId: string,
  sentStatus: "SENT" | "SKIPPED",
  outcome: string | undefined,
  actorId: string,
  at: Date = new Date(),
): Promise<IAssignmentFollowUp> {
  if (sentStatus !== "SENT" && sentStatus !== "SKIPPED") {
    throw new Error("The outcome stamp is SENT or SKIPPED");
  }
  const row = await AssignmentFollowUp.findById(followUpId);
  if (!row) throw new Error("AssignmentFollowUp not found");
  if (row.sentStatus !== "PENDING") {
    throw new Error("Only a PENDING manual step takes an outcome stamp (append-only log, ADR-008)");
  }
  row.sentStatus = sentStatus;
  if (outcome !== undefined) row.outcome = outcome;
  row.sentAt = at;
  await row.save();
  return row;
}

export async function listAssignmentFollowUps(recordId: string): Promise<IAssignmentFollowUp[]> {
  return AssignmentFollowUp.find({ recordId }).sort({ stepNumber: 1 }).lean() as unknown as Promise<
    IAssignmentFollowUp[]
  >;
}
