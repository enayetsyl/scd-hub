/**
 * Who should answer a guardian's claim (fixes BUG-WC-2 and BUG-WC-5).
 *
 * The original design copied `record.issuedBy` into `claim.teacherId`. That is
 * the wrong field, twice over, and prod proved both on 2026-08-27:
 *
 *  - On ASSIGNMENTS, `issuedBy` records who ran the DELIVERY PASS, not who
 *    teaches the subject. One teacher hands out the whole section across every
 *    subject, so `AS-C3-BGS-0002` was attributed to an English teacher while the
 *    real BGS teacher never heard about it.
 *  - On historical/backfilled homework, `issuedBy` is the null ObjectId
 *    `000…000`, so 21 of 23 claims were addressed to a user that does not exist.
 *
 * `issuedBy` answers "who handed this out". A claim needs "who collects it".
 * Those coincide for same-day homework and routinely diverge otherwise.
 *
 * So the recipient is derived from the ROUTINE — the same source D-#530 chose for
 * exam sign-off, and for the same reason: it is the only source that reaches
 * ARABIC and QURAN, which have no `Subject` row at all. When the routine names
 * nobody, fall back to the section's homework confirmer and then its class
 * teacher — the `emitHwAutoIssued` chain, reused rather than reinvented.
 */
import { Types } from "mongoose";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";

/** The all-zero ObjectId that historical records carry instead of a real user. */
export const NULL_OBJECT_ID = "000000000000000000000000";

export interface ClaimRecipient {
  teacherId: Types.ObjectId;
  /** How we found them — stored on the claim so the queue can explain itself. */
  source: "ROUTINE" | "CONFIRMER" | "CLASS_TEACHER" | "ISSUER";
}

/** True iff this id resolves to an ACTIVE user. The null ObjectId never does. */
async function activeUser(id?: Types.ObjectId | null): Promise<Types.ObjectId | null> {
  if (!id) return null;
  if (id.toString() === NULL_OBJECT_ID) return null;
  const u = await User.findOne({ _id: id, active: true }).select("_id").lean();
  return u ? id : null;
}

/**
 * Resolve who should answer a claim on (section × subject).
 *
 * `issuedBy` is consulted LAST and only when it is a real active user — it is
 * still the best answer for a same-day homework item the subject teacher issued
 * themselves, but it must never win over the routine.
 */
export async function resolveClaimRecipient(
  sectionId: Types.ObjectId,
  subject: string,
  issuedBy?: Types.ObjectId | null,
): Promise<ClaimRecipient | null> {
  // 1. The routine: whoever teaches this subject to this section. Several slots
  //    may name the same person; take the one who teaches it MOST (the D-#531
  //    tie-break — the person who actually carries the subject).
  const slots = (await RoutineSlot.find({
    groupType: "section",
    groupId: sectionId,
    subject,
    active: { $ne: false },
    teacherId: { $exists: true, $ne: null },
  })
    .select("teacherId")
    .lean()) as unknown as Array<{ teacherId: Types.ObjectId }>;

  if (slots.length > 0) {
    const tally = new Map<string, number>();
    for (const s of slots) {
      const k = s.teacherId.toString();
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    for (const [id] of ranked) {
      const ok = await activeUser(new Types.ObjectId(id));
      if (ok) return { teacherId: ok, source: "ROUTINE" };
    }
  }

  // 2/3. The section's own owners — the emitHwAutoIssued fallback chain.
  const section = (await Section.findById(sectionId)
    .select("homeworkConfirmerId classTeacherId")
    .lean()) as unknown as {
    homeworkConfirmerId?: Types.ObjectId;
    classTeacherId?: Types.ObjectId;
  } | null;

  const confirmer = await activeUser(section?.homeworkConfirmerId);
  if (confirmer) return { teacherId: confirmer, source: "CONFIRMER" };

  const classTeacher = await activeUser(section?.classTeacherId);
  if (classTeacher) return { teacherId: classTeacher, source: "CLASS_TEACHER" };

  // 4. Last resort: the issuer, but only if they are a real active user.
  const issuer = await activeUser(issuedBy);
  if (issuer) return { teacherId: issuer, source: "ISSUER" };

  // Nobody reachable. The caller must refuse rather than file a claim into the
  // void — a claim nobody receives still escalates, naming nobody to chase.
  return null;
}
