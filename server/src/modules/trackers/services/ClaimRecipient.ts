/**
 * Who should answer a guardian's claim (BUG-WC-2 / WC-5 / WC-7).
 *
 * Three revisions, each forced by real data:
 *
 *  1. Originally `record.issuedBy`. Wrong twice over — on assignments that field
 *     records who ran the DELIVERY PASS (a BGS claim reached an English teacher),
 *     and on historical homework it is the null ObjectId (claims addressed to a
 *     user that does not exist).
 *  2. Then the ROUTINE, per D-#530. Right about REACHABILITY — it is the only
 *     source covering ARABIC/QURAN, which have no `Subject` row — but wrong about
 *     CAPABILITY.
 *  3. Now the TEACHING GRANT first (owner ruling 2026-08-30).
 *
 * Why the grant wins: the app has two independent answers to "who teaches this
 * subject to this class". `RoutineSlot` is the timetable; `ScopeGrant` kind
 * `teaching` is what actually confers tracker WRITE access. Reassigning a subject
 * updates the grant, and the timetable can lag — so on prod 2026-08-30 a teacher
 * held 5 MATH routine slots and no grant: he received every claim for a subject he
 * could not open, while the teacher who held the grant heard nothing.
 *
 * So a candidate is only acceptable if they can ACT. Notifying someone powerless
 * is worse than notifying nobody: the claim looks addressed, and silently is not.
 */
import { Types } from "mongoose";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { Section } from "../../foundation/models/Section";
import { Subject } from "../../foundation/models/Subject";
import { User } from "../../foundation/models/User";
import { ScopeGrant } from "../../foundation/models/ScopeGrant";

/** The all-zero ObjectId that historical records carry instead of a real user. */
export const NULL_OBJECT_ID = "000000000000000000000000";

export interface ClaimRecipient {
  teacherId: Types.ObjectId;
  /** How we found them — stored on the claim so the queue can explain itself. */
  source: "GRANT" | "ROUTINE" | "CONFIRMER" | "CLASS_TEACHER" | "ISSUER";
}

/** True iff this id resolves to an ACTIVE user. The null ObjectId never does. */
async function activeUser(id?: Types.ObjectId | null): Promise<Types.ObjectId | null> {
  if (!id) return null;
  if (id.toString() === NULL_OBJECT_ID) return null;
  const u = await User.findOne({ _id: id, active: true }).select("_id").lean();
  return u ? id : null;
}

/**
 * Everyone holding a teaching grant for this (section × subject) — the people who
 * can actually write to the tracker here.
 *
 * Returns `null` (not `[]`) when the subject has no `Subject` row at all, which is
 * how ARABIC and QURAN present (D-#521/#530). `null` means "grants cannot answer
 * this question", so the routine is allowed to; `[]` means "grants answered, and
 * the answer is nobody".
 */
async function grantHolders(
  sectionId: Types.ObjectId,
  subject: string,
): Promise<Types.ObjectId[] | null> {
  const subjectRow = await Subject.findOne({ code: subject }).select("_id").lean();
  if (!subjectRow) return null;

  const grants = (await ScopeGrant.find({
    kind: "teaching",
    sectionId,
    subjectId: (subjectRow as { _id: Types.ObjectId })._id,
    active: true,
  })
    .select("teacherId")
    .lean()) as unknown as Array<{ teacherId: Types.ObjectId }>;

  return grants.map((g) => g.teacherId);
}

/**
 * Resolve who should answer a claim on (section × subject).
 *
 * Order: teaching grant → routine (only where grants cannot answer) → the
 * section's own owners → the issuer. `null` when nobody qualifies, so the caller
 * refuses rather than filing a claim into the void.
 */
export async function resolveClaimRecipient(
  sectionId: Types.ObjectId,
  subject: string,
  issuedBy?: Types.ObjectId | null,
): Promise<ClaimRecipient | null> {
  const holders = await grantHolders(sectionId, subject);

  // 1. The grant — whoever can actually act. When several hold it, prefer the one
  //    the ROUTINE also names (they are the one in front of the class), and among
  //    those the one who teaches it most; otherwise take any active holder.
  if (holders && holders.length > 0) {
    const slots = (await RoutineSlot.find({
      groupType: "section",
      groupId: sectionId,
      subject,
      active: { $ne: false },
      teacherId: { $in: holders },
    })
      .select("teacherId")
      .lean()) as unknown as Array<{ teacherId: Types.ObjectId }>;

    // Rank ONLY holders. The query already narrows to them; re-checking here means
    // a non-holder can never be promoted by the timetable, which is the whole point
    // of WC-7 and too important to leave resting on one `$in`.
    const holderSet = new Set(holders.map((h) => h.toString()));
    const tally = new Map<string, number>();
    for (const s of slots) {
      const k = s.teacherId.toString();
      if (!holderSet.has(k)) continue;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    const ranked = [
      ...[...tally.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
      ...holders.map((h) => h.toString()),
    ];
    for (const id of [...new Set(ranked)]) {
      const ok = await activeUser(new Types.ObjectId(id));
      if (ok) return { teacherId: ok, source: "GRANT" };
    }
  }

  // 2. The routine — ONLY where grants cannot answer (no `Subject` row: ARABIC,
  //    QURAN). Where a subject does have grants and nobody holds one, falling back
  //    to the timetable would reintroduce exactly the WC-7 failure.
  if (holders === null) {
    const slots = (await RoutineSlot.find({
      groupType: "section",
      groupId: sectionId,
      subject,
      active: { $ne: false },
      teacherId: { $exists: true, $ne: null },
    })
      .select("teacherId")
      .lean()) as unknown as Array<{ teacherId: Types.ObjectId }>;

    const tally = new Map<string, number>();
    for (const s of slots) {
      const k = s.teacherId.toString();
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    for (const [id] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
      const ok = await activeUser(new Types.ObjectId(id));
      if (ok) return { teacherId: ok, source: "ROUTINE" };
    }
  }

  // 3/4. The section's own owners — the emitHwAutoIssued fallback chain. They hold
  //      section-wide duty, so they can act even without the subject grant.
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

  // 5. Last resort: the issuer, but only if they are a real active user.
  const issuer = await activeUser(issuedBy);
  if (issuer) return { teacherId: issuer, source: "ISSUER" };

  return null;
}
