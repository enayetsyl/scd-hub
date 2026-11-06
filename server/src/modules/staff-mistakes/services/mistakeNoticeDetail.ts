/**
 * One Bangla line naming WHICH thing a mistake is about — for the "please explain" notice
 * (D-#1012). Reads the same source detail the আমার ভুল ও ব্যাখ্যা list shows, so the notice and
 * the screen agree. Never throws: no line → the notice still goes, with the place title only.
 */
import type { StaffMistakeKind } from "@scd/shared";
import { HW_SUBJECT_LABELS_BN, type HwSubject } from "@scd/shared";
import { bnNum } from "../../../lib/bnNum";
import { markCorrectionNotesByIds } from "../../trackers/services/MarkCorrectionService";
import { attendanceCorrectionNotesByIds } from "../../attendance/services/AttendanceCorrectionService";
import { classTestCorrectionNotesByIds } from "../../trackers/services/ClassTestCorrectionService";
import { claimDetailsByIds, revertDetailsByIds } from "../../trackers/services/WorkMistakeService";
import { staffMistakeNotesByIds } from "./StaffMistakeNoteService";

const MAX = 180;

/** "রহিম, করিম ও আরও ২ জন" */
export function namesLine(names: readonly string[], show = 3): string {
  const unique = [...new Set(names.filter(Boolean))];
  const shown = unique.slice(0, show).join(", ");
  return unique.length > show ? `${shown} ও আরও ${bnNum(unique.length - show)} জন` : shown;
}

const subjectBn = (s: string | null | undefined): string => (s ? (HW_SUBJECT_LABELS_BN[s as HwSubject] ?? s) : "");
const join = (...parts: (string | null | undefined)[]): string => parts.filter((p) => p && p.trim()).join(" · ");
const clip = (s: string): string => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s);

export async function describeMistakeSource(kind: StaffMistakeKind, sourceId: string): Promise<string | null> {
  try {
    switch (kind) {
      case "MARK_CORRECTION": {
        const n = (await markCorrectionNotesByIds([sourceId])).get(sourceId);
        if (!n) return null;
        return clip(`${join(n.itemCode, subjectBn(n.subject), n.sectionLabel)} — ${namesLine(n.students.map((s) => s.studentName))}`);
      }
      case "ATTENDANCE_CORRECTION": {
        const n = (await attendanceCorrectionNotesByIds([sourceId])).get(sourceId);
        if (!n) return null;
        return clip(`${join(n.unitLabel, n.dateKey)} — ${namesLine(n.changes.map((c) => c.studentName))}`);
      }
      case "CLASS_TEST_MARKS":
      case "CLASS_TEST_SCRIPTS": {
        const n = (await classTestCorrectionNotesByIds([sourceId])).get(sourceId);
        if (!n) return null;
        const head = join(n.ctId, subjectBn(n.subject), n.testNumber ? `টেস্ট ${bnNum(n.testNumber)}` : "");
        const names = namesLine(n.changes.map((c) => c.studentName));
        return clip(names ? `${head} — ${names}` : head);
      }
      case "WORK_CLAIM_ACCEPTED":
      case "WORK_REVERT": {
        const map = kind === "WORK_CLAIM_ACCEPTED" ? await claimDetailsByIds([sourceId]) : await revertDetailsByIds([sourceId]);
        const n = map.get(sourceId);
        if (!n) return null;
        return clip(`${join(n.itemCode, subjectBn(n.subject))} — ${n.studentName}`);
      }
      default: {
        const n = (await staffMistakeNotesByIds([sourceId])).get(sourceId);
        const last = n?.lines[n.lines.length - 1];
        if (!last?.text) return null;
        const more = n!.lines.length > 1 ? ` (আরও ${bnNum(n!.lines.length - 1)}টি)` : "";
        return clip(`${last.text}${more}`);
      }
    }
  } catch (err) {
    console.error("[mistakeNoticeDetail] building the notice line failed (the notice still goes):", err);
    return null;
  }
}
