/**
 * A guardian linked to a child and unlinked again soon after by SOMEONE ELSE was most likely
 * linked to the wrong child (D-#1004) — tier 2 for whoever made the link. The link itself keeps
 * no author, so the latest GUARDIAN_LINK audit row that switched it on names them. A link that
 * stood longer than GUARDIAN_LINK_MISTAKE_DAYS is an ordinary change (a family left, a parent
 * swapped), and unlinking your own link is nobody's mistake. Never throws.
 */
import { Audit } from "../../platform/models/Audit";
import { Student } from "../models/Student";
import { Guardian } from "../models/Guardian";
import { recordPlaceMistake } from "../../staff-mistakes/services/StaffMistakeNoteService";

export const GUARDIAN_LINK_MISTAKE_DAYS = 30;

export async function recordGuardianUnlink(guardianId: string, studentId: string, actorId: string | undefined, now: Date = new Date()): Promise<boolean> {
  try {
    if (!actorId) return false;
    const linked = await Audit.findOne({
      eventKind: "GUARDIAN_LINK",
      "meta.guardianId": guardianId,
      "meta.studentId": studentId,
      "meta.active": { $ne: false },
    })
      .sort({ eventAt: -1 })
      .select("actorId eventAt")
      .lean();
    if (!linked?.actorId || String(linked.actorId) === actorId) return false;
    const days = (now.getTime() - new Date(linked.eventAt).getTime()) / 86_400_000;
    if (days > GUARDIAN_LINK_MISTAKE_DAYS) return false;
    const [student, guardian] = await Promise.all([
      Student.findById(studentId).select("name nameBn").lean(),
      Guardian.findById(guardianId).select("name").lean(),
    ]);
    const child = student?.nameBn || student?.name || "শিক্ষার্থী";
    const parent = guardian?.name || "অভিভাবক";
    return await recordPlaceMistake({
      kind: "GUARDIAN_LINK_UNDONE",
      tier: 2,
      refKey: `${guardianId}:${studentId}`,
      ownerId: linked.actorId,
      correctedBy: actorId,
      at: now,
      line: `${parent} — ${child}: যুক্ত করার ${Math.max(0, Math.floor(days))} দিনের মধ্যে সংযোগ খুলে ফেলা হয়েছে`,
    });
  } catch (err) {
    console.error("[guardianLinkMistake] recording the undone link failed (the unlink went ahead):", err);
    return false;
  }
}
