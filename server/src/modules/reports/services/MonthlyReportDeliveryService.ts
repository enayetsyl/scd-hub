/**
 * MonthlyReportDeliveryService (MR-6, prd-monthly-report §9) — telling the family a
 * report is there, on the rails that already exist.
 *
 * TWO WORDINGS, NOT ONE (§9). A first release says "available"; a re-release says
 * "revised". A family handed different numbers under an identical message has no way
 * to know the report changed, which is precisely the trust this feature cannot spend.
 * The wording is chosen from `isRerelease`, which MR-3 stamps at release time.
 *
 * Delivery mirrors CommentDeliveryService exactly:
 *   • an in-app notification for every LOGIN-ENABLED guardian (the emit() seam →
 *     inbox + push);
 *   • a wa.me click-to-send link for EVERY family with a phone, because contact-only
 *     guardians have no inbox (D-#31/#72); phone-less families come back as
 *     `unreachableByWa` rather than silently vanishing.
 *
 * The bodies are rendered ONCE per report from the MT-1 registry (D-#131) and the
 * pre-rendered text handed to the emitter — renderTemplate is never called inside the
 * per-guardian loop (the N+1 guard).
 *
 * Delivery NEVER fails a release. A release is a decision that has already been made
 * and audited; a WhatsApp link that could not be built is a follow-up, not a reason to
 * pretend the release did not happen.
 */
import { Types } from "mongoose";
import { renderTemplate } from "../../templates/services/MessageTemplateService";
import { emitMonthlyReport } from "../../notifications/services/emitters";
import { Student } from "../../foundation/models/Student";
import { commentWaLink } from "../../comments/services/CommentDeliveryService";
import type { IMonthlyReport } from "../models/MonthlyReport";

export interface MonthlyReportDeliveryOutcome {
  reportId: string;
  studentId: string;
  studentName: string;
  periodKey: string;
  revision: number;
  isRerelease: boolean;
  /** The rendered Bangla body — the wa.me + inbox text. */
  messageBn: string;
  /** Click-to-send link (ADR-003 — always a MANUAL send), null with no phone. */
  waLink: string | null;
  unreachableByWa: boolean;
  /** Guardian ids that got an in-app notification. */
  notifiedGuardianIds: string[];
}

/** `2026-07` → `জুলাই ২০২৬` is a display concern; the template takes the raw key so
 *  the Principal can reword the sentence without a deploy. */
export async function deliverMonthlyReport(
  report: Pick<IMonthlyReport, "_id" | "studentId" | "periodKey" | "revision" | "isRerelease">,
): Promise<MonthlyReportDeliveryOutcome> {
  const student = (await Student.findById(report.studentId)
    .select("name nameBn phone")
    .lean()) as unknown as { name: string; nameBn?: string; phone?: string } | null;

  const studentName = student?.nameBn || student?.name || "";
  const kind = report.isRerelease ? "revised" : "released";
  const params = { studentName, month: report.periodKey };

  // Rendered ONCE, then reused for the inbox and the wa.me text.
  const [titleBn, messageBn, waText] = await Promise.all([
    renderTemplate(`monthly_report.${kind}.title` as "monthly_report.released.title", params),
    renderTemplate(`monthly_report.${kind}.body` as "monthly_report.released.body", params),
    renderTemplate(`monthly_report.${kind}.wa` as "monthly_report.released.wa", params),
  ]);

  const notifiedGuardianIds = await emitMonthlyReport({
    reportId: report._id as unknown as Types.ObjectId,
    studentId: report.studentId,
    revision: report.revision,
    periodKey: report.periodKey,
    titleBn,
    messageBn,
  });

  const waLink = commentWaLink(student?.phone, waText);

  return {
    reportId: report._id.toString(),
    studentId: report.studentId.toString(),
    studentName,
    periodKey: report.periodKey,
    revision: report.revision,
    isRerelease: report.isRerelease,
    messageBn,
    waLink,
    unreachableByWa: waLink === null,
    notifiedGuardianIds,
  };
}
