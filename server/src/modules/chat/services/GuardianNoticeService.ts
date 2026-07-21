/**
 * GuardianNoticeService (M-6, D-#79/#111) — compose a guardian notice and fan it
 * out as per-guardian ADR-003 wa.me links. Guardians are recipients, not chat
 * participants (D-#76); no guardian login is needed — the composer (a teacher or
 * Office) taps through the returned links or copies them.
 *
 * Contact = the family phone on the Student row (the D-#31/#59 reality: one
 * shared family contact, the same number the guardian login is keyed to —
 * mirrors LibraryChaseService / attendance guardianChaseLink). Students with no
 * phone on file are reported as `unreachableCount` (no link can be built).
 *
 * AUTHORIZATION is enforced at the RESOLVER (the D-#42 pattern, no new perm):
 * SECTION → the section's class teacher (assertIsClassTeacher) OR chat:manage;
 * SCHOOL → chat:manage. This service only composes + persists + audits.
 *
 * Identity-plane (ADR-005) — students/sections/composer; no corpus path.
 */
import { Types } from "mongoose";
import type { AppContext } from "../../../context";
import { assertIsClassTeacher, ForbiddenError } from "../../../middleware/authz";
import { Student } from "../../foundation/models/Student";
import { writeAudit } from "../../platform/services/AuditService";
import { normalizePhone } from "../../foundation/services/credentials";
import { GuardianNotice } from "../models/GuardianNotice";
import { ChatError } from "./ChatService";

/**
 * The D-#45 parent-comms authorization (no new permission, the D-#42 pattern):
 *   SCHOOL  → chat:manage (Principal/Office) only.
 *   SECTION → the section's class teacher (assertIsClassTeacher) OR chat:manage.
 * `canManage` = does the caller hold chat:manage (computed at the resolver).
 * Throws ForbiddenError (Bangla) when denied — the J-M8 acceptance.
 */
export async function assertCanComposeNotice(
  ctx: AppContext,
  args: { scope: "SCHOOL" | "SECTION"; sectionId?: string | null; canManage: boolean },
): Promise<void> {
  if (args.scope === "SCHOOL") {
    if (!args.canManage) {
      throw new ForbiddenError("স্কুল-ব্যাপী বার্তা শুধুমাত্র অফিস/প্রিন্সিপাল পাঠাতে পারেন");
    }
    return;
  }
  if (!args.sectionId) throw new ChatError("শ্রেণি-বার্তার জন্য সেকশন নির্বাচন করুন");
  if (!args.canManage) await assertIsClassTeacher(ctx, args.sectionId);
}

/** Pure: the ADR-003 Bangla guardian-notice deep link. */
export function buildGuardianNoticeLink(args: {
  toPhone: string;
  studentName: string;
  title: string;
  body: string;
}): string {
  const phone = normalizePhone(args.toPhone);
  const msg =
    `আসসালামু আলাইকুম। ${args.studentName} এর অভিভাবক,\n` +
    `SCD থেকে একটি জরুরি বার্তা:\n` +
    `${args.title}\n${args.body}\n` +
    `মাআসসালামাহ।`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

export interface NoticeRecipient {
  studentId: string;
  studentName: string;
  phone: string;
  waLink: string;
}

export interface ComposeNoticeInput {
  scope: "SCHOOL" | "SECTION";
  title: string;
  body: string;
  /** Required when scope === "SECTION". */
  sectionId?: string | null;
  composedBy: string;
}

export interface ComposeNoticeResult {
  noticeId: string;
  scope: "SCHOOL" | "SECTION";
  title: string;
  body: string;
  recipientCount: number;
  /** Active students in scope that had NO phone on file (no link possible). */
  unreachableCount: number;
  recipients: NoticeRecipient[];
}

/** Compose a guardian notice, persist it, audit NOTICE_SENT, and return the
 *  wa.me fan-out. Authorization must already be enforced by the resolver. */
export async function composeGuardianNotice(
  input: ComposeNoticeInput,
): Promise<ComposeNoticeResult> {
  const title = (input.title ?? "").trim();
  const body = (input.body ?? "").trim();
  if (!title || !body) throw new ChatError("শিরোনাম এবং বার্তা উভয়ই দিতে হবে");
  if (input.scope === "SECTION" && !input.sectionId) {
    throw new ChatError("শ্রেণি-বার্তার জন্য সেকশন নির্বাচন করুন");
  }

  const filter: Record<string, unknown> = { active: true };
  if (input.scope === "SECTION") filter.sectionId = new Types.ObjectId(input.sectionId!);
  const students = (await Student.find(filter)
    .select("name nameBn phone")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; nameBn?: string; phone?: string }>;

  const recipients: NoticeRecipient[] = [];
  let unreachableCount = 0;
  for (const s of students) {
    const studentName = s.nameBn || s.name;
    if (!s.phone) {
      unreachableCount += 1;
      continue;
    }
    recipients.push({
      studentId: s._id.toString(),
      studentName,
      phone: normalizePhone(s.phone),
      waLink: buildGuardianNoticeLink({ toPhone: s.phone, studentName, title, body }),
    });
  }

  const notice = await GuardianNotice.create({
    scope: input.scope,
    sectionId: input.scope === "SECTION" ? new Types.ObjectId(input.sectionId!) : undefined,
    title,
    body,
    composedBy: new Types.ObjectId(input.composedBy),
    recipientCount: recipients.length,
  });

  await writeAudit({
    eventKind: "NOTICE_SENT",
    actorId: input.composedBy,
    targetId: notice._id,
    targetKind: "GuardianNotice",
    meta: {
      scope: input.scope,
      sectionId: input.sectionId ?? null,
      recipientCount: recipients.length,
      unreachableCount,
    },
  });

  return {
    noticeId: notice._id.toString(),
    scope: input.scope,
    title,
    body,
    recipientCount: recipients.length,
    unreachableCount,
    recipients,
  };
}
