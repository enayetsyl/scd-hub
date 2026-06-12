/**
 * Event-driven emitters (N-1, D-#72) — one thin, BEST-EFFORT wrapper per event,
 * each calling only NotificationService.emit() (the single door). Every wrapper
 * swallows its own failure with a server-side log: a notification problem must
 * never block or roll back the host mutation (publish / transition / assign) —
 * the same posture D-#75 sets for the push channel.
 *
 * The four phase-1 events (PRD §7 N-1):
 *   class-note publish → login-enabled guardians   (N1.3, R5.4 partial)
 *   HW chase reaches 3 → the section's class teacher (N1.4, §7.2/D-#34/D-#45)
 *   plan-review round assigned → the reviewer        (N1.5)
 *   cover assigned → the covering teacher            (N1.6; cancel emits nothing)
 *
 * Identity-plane only (reads roster/guardian linkage to resolve recipients);
 * no corpus path (N5.1).
 */
import { ROUTINE_SUBJECT_LABELS_BN } from "@scd/shared";
import { emit } from "./NotificationService";
import { Student } from "../../foundation/models/Student";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Section } from "../../foundation/models/Section";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { dateKeyOf } from "../../attendance/dates";

type IdLike = { toString(): string };

// ---------------------------------------------------------------------------
// N1.3 — class-note publish → each login-enabled guardian of the group
// ---------------------------------------------------------------------------

export interface ClassNotePublishedEvent {
  _id: IdLike;
  slotId: IdLike;
  groupType: "section" | "subjectgroup";
  groupId: IdLike;
  date: Date;
  subject: string;
}

export async function emitClassNotePublished(note: ClassNotePublishedEvent): Promise<void> {
  try {
    const studentIds =
      note.groupType === "section"
        ? (
            (await Student.find({ sectionId: note.groupId, active: true }).select("_id").lean()) as unknown as Array<{ _id: IdLike }>
          ).map((s) => s._id)
        : (
            (await SubjectGroupMembership.find({ groupId: note.groupId }).select("studentId").lean()) as unknown as Array<{ studentId: IdLike }>
          ).map((m) => m.studentId);
    if (studentIds.length === 0) return;

    const links = (await GuardianLink.find({
      studentId: { $in: studentIds },
      active: { $ne: false }, // missing = active (pre-GP-1 rows)
    })
      .select("guardianId")
      .lean()) as unknown as Array<{ guardianId: IdLike }>;
    const guardianIds = [...new Set(links.map((l) => l.guardianId.toString()))];
    if (guardianIds.length === 0) return;

    // Login-enabled only — contact-only guardians have no inbox (D-#31, the
    // recorded D-#72 limitation; they wait for the WA/SMS phase).
    const guardians = (await Guardian.find({ _id: { $in: guardianIds }, loginEnabled: true, active: true })
      .select("_id")
      .lean()) as unknown as Array<{ _id: IdLike }>;

    const dateKey = dateKeyOf(new Date(note.date));
    const subjectBn = (ROUTINE_SUBJECT_LABELS_BN as Record<string, string>)[note.subject] ?? note.subject;
    for (const g of guardians) {
      await emit({
        recipientGuardianId: g._id.toString(),
        kind: "CLASS_NOTE_PUBLISHED",
        titleBn: "পাঠ নোট প্রকাশিত হয়েছে",
        bodyBn: `${subjectBn} — আজ ক্লাসে যা পড়ানো হয়েছে তার নোট প্রকাশিত হয়েছে।`,
        refs: {
          classNoteId: note._id.toString(),
          slotId: note.slotId.toString(),
          date: dateKey,
          groupType: note.groupType,
          groupId: note.groupId.toString(),
        },
        dedupeKey: `CNPUB:${note.slotId.toString()}:${dateKey}:${g._id.toString()}`,
      });
    }
  } catch (err) {
    console.error("notification emit failed (class-note publish — never blocks the publish):", err);
  }
}

// ---------------------------------------------------------------------------
// N1.4 — HW chase count reaches 3 → the section's class teacher (D-#45 owner)
// ---------------------------------------------------------------------------

export interface HwParentCommsEvent {
  hwItemId: IdLike;
  hwId: string;
  studentId: IdLike;
  sectionId: IdLike;
  chaseCount: number;
}

export async function emitHwParentComms(record: HwParentCommsEvent): Promise<void> {
  try {
    const section = (await Section.findById(record.sectionId).lean()) as unknown as {
      classTeacherId?: IdLike;
    } | null;
    const classTeacherId = section?.classTeacherId;
    // Unassigned section → nobody owns parent comms yet (the CT-1 admin
    // overview already flags it); skip, never throw.
    if (!classTeacherId) return;

    await emit({
      recipientUserId: classTeacherId.toString(),
      kind: "HW_PARENT_COMMS",
      titleBn: "অভিভাবকের সাথে যোগাযোগ প্রয়োজন",
      bodyBn: `বাড়ির কাজ ${record.hwId}: একজন শিক্ষার্থীর তাগাদা ${record.chaseCount} বার হয়েছে — অভিভাবককে জানান।`,
      refs: {
        hwItemId: record.hwItemId.toString(),
        studentId: record.studentId.toString(),
        sectionId: record.sectionId.toString(),
      },
      // Per student+item (PRD N1.4): a 4th chase re-emits the same key → no-op.
      dedupeKey: `HWPC:${record.hwItemId.toString()}:${record.studentId.toString()}`,
    });
  } catch (err) {
    console.error("notification emit failed (HW parent-comms — never blocks the transition):", err);
  }
}

// ---------------------------------------------------------------------------
// N1.5 — plan-review round assigned → the reviewer
// ---------------------------------------------------------------------------

export interface ReviewAssignedEvent {
  _id: IdLike;
  reviewerId: IdLike;
  artifactId: IdLike;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  roundNumber: number;
}

export async function emitReviewAssigned(assignment: ReviewAssignedEvent): Promise<void> {
  try {
    await emit({
      recipientUserId: assignment.reviewerId.toString(),
      kind: "REVIEW_ASSIGNED",
      titleBn: "পরিকল্পনা পর্যালোচনার দায়িত্ব",
      bodyBn: `${assignment.subject} · শ্রেণি ${assignment.classLevel} · ${assignment.anchorWord} ${assignment.addressNumber} — পরিকল্পনাটি আপনার পর্যালোচনার জন্য নির্ধারিত হয়েছে (রাউন্ড ${assignment.roundNumber})।`,
      refs: {
        reviewAssignmentId: assignment._id.toString(),
        artifactId: assignment.artifactId.toString(),
      },
      dedupeKey: `REV:${assignment._id.toString()}`,
    });
  } catch (err) {
    console.error("notification emit failed (review assigned — never blocks the assignment):", err);
  }
}

// ---------------------------------------------------------------------------
// N1.6 — cover assigned → the covering teacher (cancel emits nothing)
// ---------------------------------------------------------------------------

export interface CoverAssignedEvent {
  _id: IdLike;
  slotId: IdLike;
  date: Date;
  coverTeacherId: IdLike;
}

export async function emitCoverAssigned(substitution: CoverAssignedEvent): Promise<void> {
  try {
    const dateKey = dateKeyOf(new Date(substitution.date));
    await emit({
      recipientUserId: substitution.coverTeacherId.toString(),
      kind: "COVER_ASSIGNED",
      titleBn: "কাভার ক্লাসের দায়িত্ব",
      bodyBn: `${dateKey} তারিখে একটি ক্লাস কাভারের দায়িত্ব আপনাকে দেওয়া হয়েছে — আমার রুটিন দেখুন।`,
      refs: {
        substitutionId: substitution._id.toString(),
        slotId: substitution.slotId.toString(),
        date: dateKey,
      },
      dedupeKey: `COV:${substitution._id.toString()}`,
    });
  } catch (err) {
    console.error("notification emit failed (cover assigned — never blocks the assignment):", err);
  }
}
