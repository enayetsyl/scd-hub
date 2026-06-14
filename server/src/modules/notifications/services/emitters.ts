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
import { ROUTINE_SUBJECT_LABELS_BN, NOTIFICATION_KINDS } from "@scd/shared";
import { emit } from "./NotificationService";
import { renderTemplate } from "../../templates/services/MessageTemplateService";
import { Student } from "../../foundation/models/Student";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Section } from "../../foundation/models/Section";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { dateKeyOf } from "../../attendance/dates";

type IdLike = { toString(): string };

/** The best-effort contract, encoded once: an emitter failure is logged and
 *  swallowed — it must never throw into (or roll back) the host mutation.
 *  Every emitter body runs inside this; new emitters (N-2 scheduler) must too. */
async function bestEffort(label: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (err) {
    console.error(`notification emit failed (${label} — never blocks the host operation):`, err);
  }
}

/** Every dedupe-key format lives HERE — one registry of prefixes, so a new
 *  kind can't silently collide with an existing one (a colliding key is eaten
 *  by the unique index as a "duplicate" and the notification never appears). */
const dedupeKeys = {
  /** Per slot+date+guardian: a re-publish the same day re-emits the same key → no-op. */
  classNotePublished: (slotId: string, dateKey: string, guardianId: string) =>
    `CNPUB:${slotId}:${dateKey}:${guardianId}`,
  /** Per student+item (PRD N1.4): a 4th chase re-emits the same key → no-op. */
  hwParentComms: (hwItemId: string, studentId: string) => `HWPC:${hwItemId}:${studentId}`,
  /** Per assignment: re-running the host mutation can't double-notify. */
  reviewAssigned: (assignmentId: string) => `REV:${assignmentId}`,
  /** Per substitution: one notification per recorded cover. */
  coverAssigned: (substitutionId: string) => `COV:${substitutionId}`,
  /** Per record+ladder-step+guardian (AS-T4): re-running a step can't double-notify. */
  assignmentGuardianChase: (recordId: string, stepNumber: number, guardianId: string) =>
    `ASCH:${recordId}:${stepNumber}:${guardianId}`,
  /** Per test+student+guardian (VC-4): re-generating a test's messages is a no-op. */
  vocabResult: (testId: string, studentId: string, guardianId: string) =>
    `VOCR:${testId}:${studentId}:${guardianId}`,
  /** Per test+student+guardian+publishedVersion (CT-3, D-#122): a re-publish bumps
   *  publishedVersion → a NEW key → the result RE-notifies; the same version is a no-op. */
  classTestResult: (testId: string, studentId: string, guardianId: string, publishedVersion: number) =>
    `CTR:${testId}:${studentId}:${guardianId}:v${publishedVersion}`,
} as const;

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
  return bestEffort("class-note publish", async () => {
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
    const titleBn = await renderTemplate("classNote.published.title");
    const bodyBn = await renderTemplate("classNote.published.body", { subject: subjectBn });
    // One upsert per guardian — in parallel: this runs awaited inside the
    // publish mutation, and serial round-trips to Atlas would stall it.
    await Promise.all(
      guardians.map((g) =>
        emit({
          recipientGuardianId: g._id.toString(),
          kind: "CLASS_NOTE_PUBLISHED",
          titleBn,
          bodyBn,
          refs: {
            classNoteId: note._id.toString(),
            slotId: note.slotId.toString(),
            date: dateKey,
            groupType: note.groupType,
            groupId: note.groupId.toString(),
          },
          dedupeKey: dedupeKeys.classNotePublished(note.slotId.toString(), dateKey, g._id.toString()),
        }),
      ),
    );
  });
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
  return bestEffort("HW parent-comms", async () => {
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
      titleBn: await renderTemplate("homework.parentComms.title"),
      bodyBn: await renderTemplate("homework.parentComms.body", {
        hwId: record.hwId,
        chaseCount: record.chaseCount,
      }),
      refs: {
        hwItemId: record.hwItemId.toString(),
        studentId: record.studentId.toString(),
        sectionId: record.sectionId.toString(),
      },
      dedupeKey: dedupeKeys.hwParentComms(record.hwItemId.toString(), record.studentId.toString()),
    });
  });
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
  return bestEffort("review assigned", async () => {
    await emit({
      recipientUserId: assignment.reviewerId.toString(),
      kind: "REVIEW_ASSIGNED",
      titleBn: await renderTemplate("review.assigned.title"),
      bodyBn: await renderTemplate("review.assigned.body", {
        subject: assignment.subject,
        classLevel: assignment.classLevel,
        anchorWord: assignment.anchorWord,
        addressNumber: assignment.addressNumber,
        roundNumber: assignment.roundNumber,
      }),
      refs: {
        reviewAssignmentId: assignment._id.toString(),
        artifactId: assignment.artifactId.toString(),
      },
      dedupeKey: dedupeKeys.reviewAssigned(assignment._id.toString()),
    });
  });
}

// ---------------------------------------------------------------------------
// AS-T4 (D-#88) — assignment chase escalation steps 1–2 → the student's
// login-enabled guardians, riding THIS seam (the PRD pre-flight ruling: no
// parallel mechanism). GATED on the notification kind being registered:
// "ASSIGNMENT_CHASE" is NOT yet in NOTIFICATION_KINDS and /shared/vocab.ts is
// owned by another in-flight session, so this emitter is a recorded no-op
// (returns []) until the kind lands — exactly the PRD's delivery-reality
// posture (Office logs the step SKIPPED and proceeds to WhatsApp). Activation
// is a one-line vocab addition; nothing here changes.
// ---------------------------------------------------------------------------

export const ASSIGNMENT_CHASE_KIND = "ASSIGNMENT_CHASE";

export interface AssignmentGuardianChaseEvent {
  recordId: IdLike;
  asItemId: IdLike;
  asId: string;
  studentId: IdLike;
  sectionId: IdLike;
  stepNumber: number;
  /** The PRD §7 generated guardian message — the inbox body. */
  messageBn: string;
}

/** Returns the guardian ids whose inbox rows were written ([] when the kind is
 *  not yet registered, the student has no login-enabled guardian, or the emit
 *  failed — the caller logs the ladder step accordingly). */
export async function emitAssignmentGuardianChase(
  ev: AssignmentGuardianChaseEvent,
): Promise<string[]> {
  const notified: string[] = [];
  await bestEffort("assignment guardian chase", async () => {
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(ASSIGNMENT_CHASE_KIND)) return;

    const links = (await GuardianLink.find({
      studentId: ev.studentId,
      active: { $ne: false }, // missing = active (pre-GP-1 rows)
    })
      .select("guardianId")
      .lean()) as unknown as Array<{ guardianId: IdLike }>;
    const guardianIds = [...new Set(links.map((l) => l.guardianId.toString()))];
    if (guardianIds.length === 0) return;

    // Login-enabled only — contact-only guardians have no inbox (D-#31/D-#72);
    // they are reached at ladder step 3 via the manual WhatsApp path.
    const guardians = (await Guardian.find({ _id: { $in: guardianIds }, loginEnabled: true, active: true })
      .select("_id")
      .lean()) as unknown as Array<{ _id: IdLike }>;

    const titleBn = await renderTemplate("assignment.chase.title");
    await Promise.all(
      guardians.map(async (g) => {
        await emit({
          recipientGuardianId: g._id.toString(),
          kind: ASSIGNMENT_CHASE_KIND,
          titleBn,
          bodyBn: ev.messageBn,
          refs: {
            studentId: ev.studentId.toString(),
            sectionId: ev.sectionId.toString(),
          },
          dedupeKey: dedupeKeys.assignmentGuardianChase(
            ev.recordId.toString(),
            ev.stepNumber,
            g._id.toString(),
          ),
        });
        // The row exists after a non-throwing emit — newly written or deduped.
        notified.push(g._id.toString());
      }),
    );
  });
  return notified;
}

// ---------------------------------------------------------------------------
// VC-4 (§8, D-#154) — vocab result → the student's login-enabled guardians, riding
// THIS seam (D-#72). VOCAB_RESULT is a registered kind; contact-only guardians have
// no inbox (D-#31/#72) and are reached via the wa.me path the caller builds. The
// title + body are PRE-RENDERED by the caller (VocabGuardianService) and passed in,
// so renderTemplate/getEffectiveTemplate is NEVER called inside this per-guardian
// loop (the recorded MT N+1 guard). Returns the guardian ids whose inbox rows exist.
// ---------------------------------------------------------------------------

export interface VocabGuardianResultEvent {
  testId: IdLike;
  studentId: IdLike;
  sectionId: IdLike;
  /** Pre-rendered (the vocab.result.title template). */
  titleBn: string;
  /** Pre-rendered per-student body (the vocab.result.{regular|perfect|absent} template). */
  messageBn: string;
}

export async function emitVocabGuardianResult(ev: VocabGuardianResultEvent): Promise<string[]> {
  const notified: string[] = [];
  await bestEffort("vocab guardian result", async () => {
    const links = (await GuardianLink.find({
      studentId: ev.studentId,
      active: { $ne: false }, // missing = active (pre-GP-1 rows)
    })
      .select("guardianId")
      .lean()) as unknown as Array<{ guardianId: IdLike }>;
    const guardianIds = [...new Set(links.map((l) => l.guardianId.toString()))];
    if (guardianIds.length === 0) return;

    // Login-enabled only — contact-only guardians have no inbox (D-#31/#72); they are
    // reached via the wa.me link the caller produces for every family with a phone.
    const guardians = (await Guardian.find({ _id: { $in: guardianIds }, loginEnabled: true, active: true })
      .select("_id")
      .lean()) as unknown as Array<{ _id: IdLike }>;

    await Promise.all(
      guardians.map(async (g) => {
        await emit({
          recipientGuardianId: g._id.toString(),
          kind: "VOCAB_RESULT",
          titleBn: ev.titleBn,
          bodyBn: ev.messageBn,
          refs: { vocabTestId: ev.testId.toString(), studentId: ev.studentId.toString(), sectionId: ev.sectionId.toString() },
          dedupeKey: dedupeKeys.vocabResult(ev.testId.toString(), ev.studentId.toString(), g._id.toString()),
        });
        notified.push(g._id.toString());
      }),
    );
  });
  return notified;
}

// ---------------------------------------------------------------------------
// CT-3 (§5/§8, D-#122/#160) — class-test result PUBLISH → the student's login-enabled
// guardians, riding THIS seam (D-#72). CLASS_TEST_RESULT is a registered kind (CT-1);
// contact-only guardians have no inbox (D-#31/#72) and are reached via the wa.me link
// the caller builds. The title + body are PRE-RENDERED by the caller
// (ClassTestPublishService) and passed in, so renderTemplate/getEffectiveTemplate is
// NEVER called inside this per-guardian loop (the recorded MT N+1 guard). The
// dedupeKey carries `publishedVersion`, so a re-publish (version bumped) RE-notifies
// — the idempotent emit only swallows the SAME version. Returns the notified guardian ids.
// ---------------------------------------------------------------------------

export interface ClassTestGuardianResultEvent {
  testId: IdLike;
  studentId: IdLike;
  sectionId: IdLike;
  /** Bumped on each (re)publish — part of the dedupeKey so a republish re-notifies (D-#122). */
  publishedVersion: number;
  /** Pre-rendered (the class_test.result.title template). */
  titleBn: string;
  /** Pre-rendered per-student body (class_test.result.{regular|excellent|absent}). */
  messageBn: string;
}

export async function emitClassTestGuardianResult(ev: ClassTestGuardianResultEvent): Promise<string[]> {
  const notified: string[] = [];
  await bestEffort("class-test guardian result", async () => {
    const links = (await GuardianLink.find({
      studentId: ev.studentId,
      active: { $ne: false }, // missing = active (pre-GP-1 rows)
    })
      .select("guardianId")
      .lean()) as unknown as Array<{ guardianId: IdLike }>;
    const guardianIds = [...new Set(links.map((l) => l.guardianId.toString()))];
    if (guardianIds.length === 0) return;

    // Login-enabled only — contact-only guardians have no inbox (D-#31/#72); they are
    // reached via the wa.me link the caller produces for every family with a phone.
    const guardians = (await Guardian.find({ _id: { $in: guardianIds }, loginEnabled: true, active: true })
      .select("_id")
      .lean()) as unknown as Array<{ _id: IdLike }>;

    await Promise.all(
      guardians.map(async (g) => {
        await emit({
          recipientGuardianId: g._id.toString(),
          kind: "CLASS_TEST_RESULT",
          titleBn: ev.titleBn,
          bodyBn: ev.messageBn,
          refs: { classTestId: ev.testId.toString(), studentId: ev.studentId.toString(), sectionId: ev.sectionId.toString() },
          dedupeKey: dedupeKeys.classTestResult(
            ev.testId.toString(),
            ev.studentId.toString(),
            g._id.toString(),
            ev.publishedVersion,
          ),
        });
        notified.push(g._id.toString());
      }),
    );
  });
  return notified;
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
  return bestEffort("cover assigned", async () => {
    const dateKey = dateKeyOf(new Date(substitution.date));
    await emit({
      recipientUserId: substitution.coverTeacherId.toString(),
      kind: "COVER_ASSIGNED",
      titleBn: await renderTemplate("cover.assigned.title"),
      bodyBn: await renderTemplate("cover.assigned.body", { dateKey }),
      refs: {
        substitutionId: substitution._id.toString(),
        slotId: substitution.slotId.toString(),
        date: dateKey,
      },
      dedupeKey: dedupeKeys.coverAssigned(substitution._id.toString()),
    });
  });
}
