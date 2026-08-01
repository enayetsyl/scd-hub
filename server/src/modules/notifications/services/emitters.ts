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
import { User } from "../../foundation/models/User";
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
  /** One auto-issue notice per class per day (D-#314). */
  hwAutoIssued: (classId: string, dateKey: string) => `HWAI:${classId}:${dateKey}`,
  /** Per item+student+day+guardian (D-#260): every chase notifies the guardian, but
   *  re-chasing the same student the same day is a no-op for the inbox (once/day). */
  hwGuardianChase: (hwItemId: string, studentId: string, dateKey: string, guardianId: string) =>
    `HWCG:${hwItemId}:${studentId}:${dateKey}:${guardianId}`,
  /** Per assignment: re-running the host mutation can't double-notify. */
  reviewAssigned: (assignmentId: string) => `REV:${assignmentId}`,
  /** Per substitution: one notification per recorded cover. */
  coverAssigned: (substitutionId: string) => `COV:${substitutionId}`,
  /** One delivered-notice per print job (PQ-5, D-#281). */
  printDelivered: (printRequestId: string) => `PRD:${printRequestId}`,
  /** One new-request notice per print job per operator (D-#296). */
  printRequested: (printRequestId: string, recipientId: string) =>
    `PRQ:${printRequestId}:${recipientId}`,
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
  /** Per comment+guardian (CM-2): a comment is delivered once + then immutable, so a
   *  re-delivery is correctly a no-op (no version — unlike the class-test republish). */
  studentComment: (commentId: string, guardianId: string) => `SCMT:${commentId}:${guardianId}`,
  /** Keyed on the REVISION, not the report: a re-release is a new thing to say, so
   *  revision 2 must notify even though revision 1 already did (§9, D-#393). */
  monthlyReport: (reportId: string, revision: number, guardianId: string) =>
    `MRPT:${reportId}:${revision}:${guardianId}`,
  /** Per slot+guardian (CM-4): a re-dispatch of the same meeting slot is a no-op for the
   *  inbox (the wa.me link is re-built each call regardless). */
  meetingSchedule: (slotId: string, guardianId: string) => `MTSCH:${slotId}:${guardianId}`,
  /** Per student+guardian+asOf (FIN-2B): a re-run of the chase the same day is a no-op for
   *  the inbox; a new day's chase re-notifies (the wa.me link is re-built each call). */
  financeFeeDue: (studentId: string, guardianId: string, asOfKey: string) =>
    `FFEE:${studentId}:${guardianId}:${asOfKey}`,
  /** Per entry+guardian (SR-2): a revision entry is delivered once + then sealed, so a
   *  re-delivery is correctly a no-op for the inbox (the wa.me link is re-built each call). */
  revisionDelivery: (entryId: string, guardianId: string) => `SRDEL:${entryId}:${guardianId}`,
  /** Per student+streak-length+recipient (SR-2): the consecutive-absence escalation fires
   *  once per threshold crossing (the dispatch ledger guards re-fire; this guards re-emit). */
  revisionEscalation: (studentId: string, streakLength: number, recipientId: string) =>
    `SRESC:${studentId}:${streakLength}:${recipientId}`,
  /** Per slot+grant (PXG-1): idempotent on the (slotId, grantId) pair rather than
   *  slotId alone, since a revoke-then-reapprove cycle mints a NEW grant that should
   *  re-notify — but a retried call for the SAME grant is a no-op. */
  hrCoverAssigned: (slotId: string, grantId: string) => `HRCOV:${slotId}:${grantId}`,
  /** Per test+submission-stamp+recipient (CT-8): a re-submit after a send-back writes
   *  a NEW submittedAt stamp → a NEW key → the approvers RE-notify; a retry of the
   *  same stamp is a no-op. */
  ctResultSubmitted: (testId: string, submittedAtMs: number, recipientId: string) =>
    `CTSUB:${testId}:${submittedAtMs}:${recipientId}`,
  /** Per test+published-version+teacher (CT-8): a republish bumps publishedVersion →
   *  a NEW key → the teacher RE-notifies; the same version is a no-op. */
  ctResultPublished: (testId: string, publishedVersion: number, teacherId: string) =>
    `CTPUB:${testId}:v${publishedVersion}:${teacherId}`,
  /** Per leave-application + approver (owner 2026-07-26): one notice per approver;
   *  keyed on the application so a re-run of apply doesn't double-notify. */
  staffLeaveSubmitted: (leaveApplicationId: string, recipientId: string) =>
    `LEAVE:${leaveApplicationId}:${recipientId}`,
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
// D-#314 — auto-issue notice: the sweep confirmed+issued a class's day; the
// confirmer (homework delegate ?? class teacher) is INFORMED, not asked.
// ---------------------------------------------------------------------------

export interface HwAutoIssuedEvent {
  classId: IdLike;
  sectionId: IdLike;
  dateKey: string;
  issuedItems: number;
  dayTotal: number;
}

export async function emitHwAutoIssued(event: HwAutoIssuedEvent): Promise<void> {
  return bestEffort("HW auto-issued", async () => {
    const section = (await Section.findById(event.sectionId).lean()) as unknown as {
      classTeacherId?: IdLike;
      homeworkConfirmerId?: IdLike;
    } | null;
    const recipient = section?.homeworkConfirmerId ?? section?.classTeacherId;
    if (!recipient) return; // unassigned section — nobody to inform; skip, never throw

    await emit({
      recipientUserId: recipient.toString(),
      kind: "HW_AUTO_ISSUED",
      titleBn: await renderTemplate("homework.autoIssued.title"),
      bodyBn: await renderTemplate("homework.autoIssued.body", {
        issuedItems: event.issuedItems,
        dayTotal: event.dayTotal,
      }),
      refs: { sectionId: event.sectionId.toString(), date: event.dateKey },
      dedupeKey: dedupeKeys.hwAutoIssued(event.classId.toString(), event.dateKey),
    });
  });
}

// ---------------------------------------------------------------------------
// D-#260 — HW per-chase guardian notify: EVERY chase pushes the student's
// login-enabled guardians an in-app reminder (the push channel rides emit()),
// deduped once per student+item per day. Distinct from emitHwParentComms, which
// nudges the CLASS TEACHER at the 3rd chase. Contact-only guardians have no inbox
// (D-#31/#72). Best-effort: a notification problem never blocks the transition.
// ---------------------------------------------------------------------------

export interface HwGuardianChaseEvent {
  hwItemId: IdLike;
  hwId: string;
  studentId: IdLike;
  sectionId: IdLike;
  chaseCount: number;
  /** The chase transition timestamp — anchors the once-per-day dedupe key. */
  at: Date;
}

export async function emitHwGuardianChase(ev: HwGuardianChaseEvent): Promise<void> {
  return bestEffort("HW guardian chase", async () => {
    const links = (await GuardianLink.find({
      studentId: ev.studentId,
      active: { $ne: false }, // missing = active (pre-GP-1 rows)
    })
      .select("guardianId")
      .lean()) as unknown as Array<{ guardianId: IdLike }>;
    const guardianIds = [...new Set(links.map((l) => l.guardianId.toString()))];
    if (guardianIds.length === 0) return;

    // Login-enabled only — contact-only guardians have no inbox (D-#31/#72).
    const guardians = (await Guardian.find({ _id: { $in: guardianIds }, loginEnabled: true, active: true })
      .select("_id")
      .lean()) as unknown as Array<{ _id: IdLike }>;
    if (guardians.length === 0) return;

    // hwId + chaseCount are per-event (identical for every guardian) — render ONCE
    // outside the loop (the recorded MT N+1 guard), then emit per guardian.
    const dateKey = dateKeyOf(new Date(ev.at));
    const titleBn = await renderTemplate("homework.chase.title");
    const bodyBn = await renderTemplate("homework.chase.body", {
      hwId: ev.hwId,
      chaseCount: ev.chaseCount,
    });
    await Promise.all(
      guardians.map((g) =>
        emit({
          recipientGuardianId: g._id.toString(),
          kind: "HW_CHASE",
          titleBn,
          bodyBn,
          refs: {
            hwItemId: ev.hwItemId.toString(),
            studentId: ev.studentId.toString(),
            sectionId: ev.sectionId.toString(),
          },
          dedupeKey: dedupeKeys.hwGuardianChase(
            ev.hwItemId.toString(),
            ev.studentId.toString(),
            dateKey,
            g._id.toString(),
          ),
        }),
      ),
    );
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
// CM-4 (§4.1/§6, J-CM5) — parents'-meeting timing notice → the family's
// login-enabled guardians (across the slot's siblings), riding THIS seam (D-#72).
// GATED on the kind being registered (the §4.1/D-#94 path): "MEETING_SCHEDULE" is
// NOT yet in NOTIFICATION_KINDS (/shared/vocab.ts is locked by a parallel session,
// CO-1), so this emitter is a recorded no-op (returns []) and delivery falls through
// to the wa.me link the caller (MeetingDispatchService) builds for every family with
// a phone — exactly the CM-2 STUDENT_COMMENT / ASSIGNMENT_CHASE posture. Activation
// when the vocab lock frees = add MEETING_SCHEDULE to NOTIFICATION_KINDS; nothing
// here changes. The title + body are PRE-RENDERED by the caller (inline Bangla in
// CM-4; an MT key after activation) and passed in — renderTemplate is NEVER called
// inside this per-guardian loop (the recorded MT N+1 guard). Returns notified ids.
// ---------------------------------------------------------------------------

export const MEETING_SCHEDULE_KIND = "MEETING_SCHEDULE";

export interface MeetingScheduleEvent {
  meetingId: IdLike;
  slotId: IdLike;
  /** The family's children — guardians are resolved across all of them (siblings). */
  studentIds: IdLike[];
  /** Pre-rendered title (inline Bangla in CM-4). */
  titleBn: string;
  /** Pre-rendered per-slot body (the slot time, or On-Call). */
  messageBn: string;
}

export async function emitMeetingSchedule(ev: MeetingScheduleEvent): Promise<string[]> {
  const notified: string[] = [];
  await bestEffort("meeting schedule notice", async () => {
    // §4.1 / D-#94 safety net — a no-op until MEETING_SCHEDULE is registered (CM-4
    // ships it kind-gated because /shared/vocab.ts is locked by CO-1).
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(MEETING_SCHEDULE_KIND)) return;
    if (ev.studentIds.length === 0) return;

    const links = (await GuardianLink.find({
      studentId: { $in: ev.studentIds },
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
          kind: MEETING_SCHEDULE_KIND,
          titleBn: ev.titleBn,
          bodyBn: ev.messageBn,
          refs: { parentMeetingId: ev.meetingId.toString(), meetingSlotId: ev.slotId.toString() },
          dedupeKey: dedupeKeys.meetingSchedule(ev.slotId.toString(), g._id.toString()),
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

/** HR leave-cover approval (PXG-1, D-#268) — a SEPARATE flow from the routine
 *  module's R-4 direct-assign above, but reuses the SAME `COVER_ASSIGNED` kind +
 *  message templates (both already registered; no vocab/verifier change). No
 *  `substitutionId` here (the HR flow has no RoutineSubstitution doc) — dedupes on
 *  (slotId, grantId) instead. */
export interface HrCoverAssignedEvent {
  slotId: IdLike;
  grantId: IdLike;
  coverTeacherUserId: IdLike;
  /** YYYY-MM-DD — the one date this grant covers (per-meeting grants, PXG-1). */
  dateKey: string;
}

export async function emitHrCoverAssigned(event: HrCoverAssignedEvent): Promise<void> {
  return bestEffort("hr cover assigned", async () => {
    await emit({
      recipientUserId: event.coverTeacherUserId.toString(),
      kind: "COVER_ASSIGNED",
      titleBn: await renderTemplate("cover.assigned.title"),
      bodyBn: await renderTemplate("cover.assigned.body", { dateKey: event.dateKey }),
      refs: {
        slotId: event.slotId.toString(),
        date: event.dateKey,
      },
      dedupeKey: dedupeKeys.hrCoverAssigned(event.slotId.toString(), event.grantId.toString()),
    });
  });
}

// ---------------------------------------------------------------------------
// CM-2 (§6/J-CM1, D-#172) — daily student comment DELIVER → the student's
// login-enabled guardians, riding THIS seam (D-#72). STUDENT_COMMENT is a registered
// kind (CM-2). Contact-only guardians have no inbox (D-#31/#72) and are reached via
// the wa.me link the caller (CommentDeliveryService) builds for every family with a
// phone. The title + body are PRE-RENDERED by the caller and passed in, so
// renderTemplate/getEffectiveTemplate is NEVER called inside this per-guardian loop
// (the recorded MT N+1 guard). GATED on the kind being registered (the §4.1/D-#94
// safety net): if it's not yet in NOTIFICATION_KINDS the emitter is a no-op (returns
// []) and delivery falls through to wa.me only. Returns the notified guardian ids.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// MR-6 — a released monthly report → each login-enabled guardian of the child.
// Title + body PRE-RENDERED by the caller (MonthlyReportDeliveryService), so
// renderTemplate is never called inside this per-guardian loop (the MT N+1 guard).
// Contact-only guardians have no inbox; the caller's wa.me link reaches them
// (D-#31/#72). Returns the notified guardian ids.
// ---------------------------------------------------------------------------

export interface MonthlyReportEvent {
  reportId: IdLike;
  studentId: IdLike;
  revision: number;
  periodKey: string;
  /** Pre-rendered (monthly_report.released.title / .revised.title). */
  titleBn: string;
  /** Pre-rendered (monthly_report.released.body / .revised.body). */
  messageBn: string;
}

export async function emitMonthlyReport(ev: MonthlyReportEvent): Promise<string[]> {
  const notified: string[] = [];
  await bestEffort("monthly report released", async () => {
    if (!(NOTIFICATION_KINDS as readonly string[]).includes("MONTHLY_REPORT")) return;

    const links = (await GuardianLink.find({
      studentId: ev.studentId,
      active: { $ne: false },
    })
      .select("guardianId")
      .lean()) as unknown as Array<{ guardianId: IdLike }>;
    const guardianIds = [...new Set(links.map((l) => l.guardianId.toString()))];
    if (guardianIds.length === 0) return;

    const guardians = (await Guardian.find({ _id: { $in: guardianIds }, loginEnabled: true, active: true })
      .select("_id")
      .lean()) as unknown as Array<{ _id: IdLike }>;

    await Promise.all(
      guardians.map(async (g) => {
        await emit({
          recipientGuardianId: g._id.toString(),
          kind: "MONTHLY_REPORT",
          titleBn: ev.titleBn,
          bodyBn: ev.messageBn,
          refs: { studentId: ev.studentId.toString() },
          dedupeKey: dedupeKeys.monthlyReport(ev.reportId.toString(), ev.revision, g._id.toString()),
        });
        notified.push(g._id.toString());
      }),
    );
  });
  return notified;
}

export interface StudentCommentEvent {
  commentId: IdLike;
  studentId: IdLike;
  sectionId: IdLike;
  /** Pre-rendered (the student_comment.notify.title template). */
  titleBn: string;
  /** Pre-rendered (the student_comment.notify.body template). */
  messageBn: string;
}

export async function emitStudentComment(ev: StudentCommentEvent): Promise<string[]> {
  const notified: string[] = [];
  await bestEffort("student comment deliver", async () => {
    // §4.1 / D-#94 safety net — a no-op until the kind is registered (it is, CM-2).
    if (!(NOTIFICATION_KINDS as readonly string[]).includes("STUDENT_COMMENT")) return;

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
          kind: "STUDENT_COMMENT",
          titleBn: ev.titleBn,
          bodyBn: ev.messageBn,
          refs: {
            studentCommentId: ev.commentId.toString(),
            studentId: ev.studentId.toString(),
            sectionId: ev.sectionId.toString(),
          },
          dedupeKey: dedupeKeys.studentComment(ev.commentId.toString(), g._id.toString()),
        });
        notified.push(g._id.toString());
      }),
    );
  });
  return notified;
}

// ---------------------------------------------------------------------------
// FIN-2B — guardian fee-due chase → each login-enabled guardian of the student.
// Title + body PRE-RENDERED by the caller (FeeSupportService) — renderTemplate is
// NEVER called inside this per-guardian loop (the MT N+1 guard). Contact-only
// guardians have no inbox; they are reached via the wa.me link the caller builds
// for every family with a phone (D-#31/#72/#227). Returns the notified guardian ids.
// ---------------------------------------------------------------------------

export interface FinanceFeeDueEvent {
  studentId: IdLike;
  /** YYYY-MM-DD — the dedupe bucket (a re-run the same day is a no-op). */
  asOfKey: string;
  /** Pre-rendered (finance.fee_due.chase.title). */
  titleBn: string;
  /** Pre-rendered (finance.fee_due.chase.body). */
  messageBn: string;
}

export async function emitFinanceFeeDue(ev: FinanceFeeDueEvent): Promise<string[]> {
  const notified: string[] = [];
  await bestEffort("finance fee-due chase", async () => {
    if (!(NOTIFICATION_KINDS as readonly string[]).includes("FINANCE_FEE_DUE")) return;

    const links = (await GuardianLink.find({ studentId: ev.studentId, active: { $ne: false } })
      .select("guardianId")
      .lean()) as unknown as Array<{ guardianId: IdLike }>;
    const guardianIds = [...new Set(links.map((l) => l.guardianId.toString()))];
    if (guardianIds.length === 0) return;

    const guardians = (await Guardian.find({ _id: { $in: guardianIds }, loginEnabled: true, active: true })
      .select("_id")
      .lean()) as unknown as Array<{ _id: IdLike }>;

    await Promise.all(
      guardians.map(async (g) => {
        await emit({
          recipientGuardianId: g._id.toString(),
          kind: "FINANCE_FEE_DUE",
          titleBn: ev.titleBn,
          bodyBn: ev.messageBn,
          refs: { studentId: ev.studentId.toString() },
          dedupeKey: dedupeKeys.financeFeeDue(ev.studentId.toString(), g._id.toString(), ev.asOfKey),
        });
        notified.push(g._id.toString());
      }),
    );
  });
  return notified;
}

// ---------------------------------------------------------------------------
// SR-2 (§3, D-#244) — Saturday-revision guardian delivery → the student's
// login-enabled guardians, riding THIS seam (D-#72). SR_ABSENT / SR_DIGEST are
// registered kinds (SR-2). Contact-only guardians have no inbox (D-#31/#72) and are
// reached via the wa.me link the caller (RevisionDeliveryService) builds for every
// family with a phone. Title + body are PRE-RENDERED by the caller and passed in, so
// renderTemplate is NEVER called inside this per-guardian loop (the MT N+1 guard).
// Kind-gated safety net: a no-op (returns []) until the kind is registered. Returns
// the notified guardian ids.
// ---------------------------------------------------------------------------

export interface RevisionDeliveryEvent {
  entryId: IdLike;
  studentId: IdLike;
  /** SR_ABSENT (absent alert) or SR_DIGEST (present-student weekly digest). */
  kind: "SR_ABSENT" | "SR_DIGEST";
  /** Pre-rendered (sr.{absent,digest}.title). */
  titleBn: string;
  /** Pre-rendered (sr.{absent,digest}.body). */
  messageBn: string;
}

export async function emitRevisionDelivery(ev: RevisionDeliveryEvent): Promise<string[]> {
  const notified: string[] = [];
  await bestEffort("saturday-revision delivery", async () => {
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(ev.kind)) return;

    const links = (await GuardianLink.find({ studentId: ev.studentId, active: { $ne: false } })
      .select("guardianId")
      .lean()) as unknown as Array<{ guardianId: IdLike }>;
    const guardianIds = [...new Set(links.map((l) => l.guardianId.toString()))];
    if (guardianIds.length === 0) return;

    const guardians = (await Guardian.find({ _id: { $in: guardianIds }, loginEnabled: true, active: true })
      .select("_id")
      .lean()) as unknown as Array<{ _id: IdLike }>;

    await Promise.all(
      guardians.map(async (g) => {
        await emit({
          recipientGuardianId: g._id.toString(),
          kind: ev.kind,
          titleBn: ev.titleBn,
          bodyBn: ev.messageBn,
          refs: { revisionEntryId: ev.entryId.toString(), studentId: ev.studentId.toString() },
          dedupeKey: dedupeKeys.revisionDelivery(ev.entryId.toString(), g._id.toString()),
        });
        notified.push(g._id.toString());
      }),
    );
  });
  return notified;
}

// ---------------------------------------------------------------------------
// SR-2 (§3, D-#245) — consecutive-absence escalation → the student's login-enabled
// guardians AND every active Principal (reuses the SR_ABSENT kind with an escalation
// ref). The dispatch ledger (RevisionAbsenceDispatch) guards the once-per-threshold
// re-fire; this per-recipient dedupe guards the inbox re-emit. Title + body are
// PRE-RENDERED by the caller. Returns the notified recipient ids (guardians + principals).
// ---------------------------------------------------------------------------

export interface RevisionEscalationEvent {
  studentId: IdLike;
  streakLength: number;
  /** Active Principal user ids (resolved by the caller). */
  principalUserIds: IdLike[];
  /** Pre-rendered (sr.absent.title). */
  titleBn: string;
  /** Pre-rendered escalation body. */
  messageBn: string;
}

export async function emitRevisionEscalation(ev: RevisionEscalationEvent): Promise<string[]> {
  const notified: string[] = [];
  await bestEffort("saturday-revision absence escalation", async () => {
    if (!(NOTIFICATION_KINDS as readonly string[]).includes("SR_ABSENT")) return;

    // Guardians (login-enabled) of the student.
    const links = (await GuardianLink.find({ studentId: ev.studentId, active: { $ne: false } })
      .select("guardianId")
      .lean()) as unknown as Array<{ guardianId: IdLike }>;
    const guardianIds = [...new Set(links.map((l) => l.guardianId.toString()))];
    const guardians =
      guardianIds.length > 0
        ? ((await Guardian.find({ _id: { $in: guardianIds }, loginEnabled: true, active: true })
            .select("_id")
            .lean()) as unknown as Array<{ _id: IdLike }>)
        : [];

    const refs = {
      studentId: ev.studentId.toString(),
      streakLength: ev.streakLength,
      escalation: true,
    };

    await Promise.all([
      ...guardians.map(async (g) => {
        await emit({
          recipientGuardianId: g._id.toString(),
          kind: "SR_ABSENT",
          titleBn: ev.titleBn,
          bodyBn: ev.messageBn,
          refs,
          dedupeKey: dedupeKeys.revisionEscalation(ev.studentId.toString(), ev.streakLength, g._id.toString()),
        });
        notified.push(g._id.toString());
      }),
      ...ev.principalUserIds.map(async (p) => {
        await emit({
          recipientUserId: p.toString(),
          kind: "SR_ABSENT",
          titleBn: ev.titleBn,
          bodyBn: ev.messageBn,
          refs,
          dedupeKey: dedupeKeys.revisionEscalation(ev.studentId.toString(), ev.streakLength, p.toString()),
        });
        notified.push(p.toString());
      }),
    ]);
  });
  return notified;
}

// ---------------------------------------------------------------------------
// Print job delivered (PQ-5, D-#281)
// ---------------------------------------------------------------------------

export interface PrintDeliveredEvent {
  printRequestId: string;
  /** The teacher who filed the request — the only recipient. */
  requestedBy: string;
  title: string;
}

/**
 * Tell the requesting teacher their print job has been handed back. Best-effort:
 * a notification failure must never block `markDelivered` (D-#72). The Office is
 * the single actor — the teacher does NOT confirm receipt (owner ruling, D-#281).
 */
export async function emitPrintDelivered(event: PrintDeliveredEvent): Promise<void> {
  return bestEffort("print delivered", async () => {
    await emit({
      recipientUserId: event.requestedBy,
      kind: "PRINT_DELIVERED",
      titleBn: await renderTemplate("print.delivered.title"),
      bodyBn: await renderTemplate("print.delivered.body", { title: event.title }),
      refs: { printRequestId: event.printRequestId },
      dedupeKey: dedupeKeys.printDelivered(event.printRequestId),
    });
  });
}

export interface PrintRequestedEvent {
  printRequestId: string;
  title: string;
  requesterName: string;
}

/**
 * Tell every queue OPERATOR (active Principal/Office user) a new print request
 * was filed (D-#296) — the row rides every channel: the bell, native push, and
 * browser web-push. Best-effort; deduped per (job, operator).
 */
export async function emitPrintRequested(event: PrintRequestedEvent): Promise<void> {
  return bestEffort("print requested", async () => {
    const operators = (await User.find({ role: { $in: ["PRINCIPAL", "OFFICE"] }, active: true })
      .select("_id")
      .lean()) as unknown as Array<{ _id: IdLike }>;
    const titleBn = await renderTemplate("print.requested.title");
    const bodyBn = await renderTemplate("print.requested.body", {
      title: event.title,
      requesterName: event.requesterName,
    });
    for (const op of operators) {
      await emit({
        recipientUserId: op._id.toString(),
        kind: "PRINT_REQUESTED",
        titleBn,
        bodyBn,
        refs: { printRequestId: event.printRequestId },
        dedupeKey: dedupeKeys.printRequested(event.printRequestId, op._id.toString()),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// D-#342 — CT question-request loop
// ---------------------------------------------------------------------------

export interface CtQuestionNotifyEvent {
  requestId: string;
  titleBn: string;
  bodyBn: string;
  /** Stage-unique suffix (e.g. "review:r2") so later rounds are never deduped away. */
  dedupeSuffix: string;
}

/** Tell the REQUESTING teacher a paper round awaits their verdict. Best-effort. */
export async function emitCtQuestionTeacher(
  teacherId: string,
  event: CtQuestionNotifyEvent,
): Promise<void> {
  return bestEffort("ct question → teacher", async () => {
    await emit({
      recipientUserId: teacherId,
      kind: "CT_QUESTION_REVIEW",
      titleBn: event.titleBn,
      bodyBn: event.bodyBn,
      refs: { ctQuestionRequestId: event.requestId },
      dedupeKey: `ctq:${event.requestId}:${event.dedupeSuffix}`,
    });
  });
}

/** Tell every queue operator (active Principal/Office) about a loop event
 *  (new request / changes requested / confirmed). Best-effort. */
export async function emitCtQuestionOffice(event: CtQuestionNotifyEvent): Promise<void> {
  return bestEffort("ct question → office", async () => {
    const operators = (await User.find({ role: { $in: ["PRINCIPAL", "OFFICE"] }, active: true })
      .select("_id")
      .lean()) as unknown as Array<{ _id: IdLike }>;
    for (const op of operators) {
      await emit({
        recipientUserId: op._id.toString(),
        kind: "CT_QUESTION_OFFICE",
        titleBn: event.titleBn,
        bodyBn: event.bodyBn,
        refs: { ctQuestionRequestId: event.requestId },
        dedupeKey: `ctq:${event.requestId}:${event.dedupeSuffix}:${op._id.toString()}`,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// CT-8 submit/approve loop — SUBMITTED → every approver (active Principal/Office);
// PUBLISHED → the exam's requesting teacher. Same posture as the D-#342 question
// loop: staff-facing, inline pre-rendered Bangla, best-effort, app-native.
// ---------------------------------------------------------------------------

export interface CtResultSubmittedEvent {
  testId: string;
  ctId: string;
  /** The submittedAt stamp this submit wrote — anchors the dedupe key so a
   *  re-submit (after a send-back/recall) RE-notifies the approvers. */
  submittedAtMs: number;
  titleBn: string;
  bodyBn: string;
}

/** Tell every approver (active Principal/Office) a teacher submitted an exam's
 *  results for review/approval. Best-effort. */
export async function emitCtResultSubmitted(event: CtResultSubmittedEvent): Promise<void> {
  return bestEffort("ct result submitted → office", async () => {
    const operators = (await User.find({ role: { $in: ["PRINCIPAL", "OFFICE"] }, active: true })
      .select("_id")
      .lean()) as unknown as Array<{ _id: IdLike }>;
    for (const op of operators) {
      await emit({
        recipientUserId: op._id.toString(),
        kind: "CT_RESULT_SUBMITTED",
        titleBn: event.titleBn,
        bodyBn: event.bodyBn,
        refs: { classTestId: event.testId, ctId: event.ctId },
        dedupeKey: dedupeKeys.ctResultSubmitted(event.testId, event.submittedAtMs, op._id.toString()),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Staff leave submitted → every approver (active Principal/Office). App-native,
// inline Bangla, best-effort — mirrors the CT-8 submit notice (owner 2026-07-26).
// ---------------------------------------------------------------------------

export interface StaffLeaveSubmittedEvent {
  leaveApplicationId: string;
  titleBn: string;
  bodyBn: string;
}

/** Tell every approver (active Principal/Office) that a teacher submitted a leave
 *  application awaiting their approval. Best-effort. */
export async function emitStaffLeaveSubmitted(event: StaffLeaveSubmittedEvent): Promise<void> {
  return bestEffort("staff leave submitted → office", async () => {
    const operators = (await User.find({ role: { $in: ["PRINCIPAL", "OFFICE"] }, active: true })
      .select("_id")
      .lean()) as unknown as Array<{ _id: IdLike }>;
    for (const op of operators) {
      await emit({
        recipientUserId: op._id.toString(),
        kind: "STAFF_LEAVE_SUBMITTED",
        titleBn: event.titleBn,
        bodyBn: event.bodyBn,
        refs: { leaveApplicationId: event.leaveApplicationId },
        dedupeKey: dedupeKeys.staffLeaveSubmitted(event.leaveApplicationId, op._id.toString()),
      });
    }
  });
}

export interface CtResultPublishedEvent {
  testId: string;
  ctId: string;
  /** The exam's requesting teacher — the one recipient. */
  teacherUserId: string;
  /** The (max) version this publish stamped — part of the dedupe key so a
   *  republish (bumped version) RE-notifies; the same version is a no-op. */
  publishedVersion: number;
  titleBn: string;
  bodyBn: string;
}

/** Tell the exam's teacher their results were approved/published to guardians.
 *  Best-effort. */
export async function emitCtResultPublished(event: CtResultPublishedEvent): Promise<void> {
  return bestEffort("ct result published → teacher", async () => {
    await emit({
      recipientUserId: event.teacherUserId,
      kind: "CT_RESULT_PUBLISHED",
      titleBn: event.titleBn,
      bodyBn: event.bodyBn,
      refs: { classTestId: event.testId, ctId: event.ctId },
      dedupeKey: dedupeKeys.ctResultPublished(event.testId, event.publishedVersion, event.teacherUserId),
    });
  });
}
