/**
 * ClassroomObservationService (CO-1, prd-classroom-observation §5/§6, D-#146/#147/
 * #190/#191) — the REF-11 observation pipeline + the row-scoped reads.
 *
 *   uploadObservation   — Principal/Office create the observation (UPLOADED) and, in
 *                         the same step, ASSIGN a senior-teacher observer → ASSIGNED
 *                         (J1). CONFLICT GUARD: the observer can NOT be the observed
 *                         teacher (refused). Anchor = exactly one of section /
 *                         subjectGroup. Audited.
 *   assignObserver      — (re)assign the observer on an UPLOADED/ASSIGNED row (same
 *                         conflict guard); → ASSIGNED. Audited.
 *   reviewObservation   — the ASSIGNED observer scores+comments → REVIEWED. Since CO-8
 *                         (D-#271) this is observer/Principal-only — NOT released to the
 *                         teacher; it nudges Principal/Office to publish. The actor MUST
 *                         be the assigned observerId. Audited.
 *   publishObservation  — Principal/Office PUBLISH a REVIEWED row (CO-8) → stamps
 *                         `publishedAt`/`publishedBy`, releases + notifies the teacher.
 *                         Audited.
 *   requestReReview     — re-review: create a NEW ASSIGNED observation on the same
 *                         anchor/recording, mark the prior REVIEWED row SUPERSEDED
 *                         (`supersededById`/`prevObservationId`). Enables CO-7
 *                         calibration (≥1 observation per recording). Audited (both).
 *   reads               — getObservation / observationsForTeacher / myReviewQueue /
 *                         observerReviewsPaged (CO-11 own history, D-#363), plus the
 *                         PURE row-scope predicate `canReadObservation` (observer own;
 *                         observed teacher own at/after REVIEWED; Principal/Office all)
 *                         the resolver enforces.
 *   priorObservationContext — the CO-10 carry-forward slice (D-#363): a NARROW view of
 *                         the observation whose growth focus this review carries
 *                         forward, gated by `canReadPriorContext`. Read its docblock
 *                         before adding a field — the field set IS the visibility rule.
 *
 * Role RBAC (observation:upload / :review / :read / :manage) is enforced by the
 * RESOLVER; this service trusts the actor + applies the conflict guard + state gates.
 *
 * Identity/operational plane (names teacherId/observerId); NO corpus path (ADR-005).
 */
import { Types, type FilterQuery } from "mongoose";
import {
  OBSERVATION_FORMS,
  HW_SUBJECTS,
} from "@scd/shared";
import type { ObservationForm, ObservationState } from "@scd/shared";
import { ClassroomObservation, type IClassroomObservation } from "../models/ClassroomObservation";
import { validateRef11Payload, type Ref11PayloadInput } from "../ref11";
import { validateQuranPayload, type QuranPayloadInput } from "../quran";
import { writeAudit } from "../../platform/services/AuditService";
import { emit } from "../../notifications/services/NotificationService";
import { User } from "../../foundation/models/User";

export class ClassroomObservationError extends Error {}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface DomainScoreShape {
  domain: string;
  level: number;
  note: string;
}
export interface GateScoreShape {
  gate: string;
  result: string;
  breachNote: string | null;
}
export interface QuranRatingShape {
  criterion: string;
  score: number;
  note: string | null;
}
export interface QuranComplianceShape {
  item: string;
  yesNo: boolean;
}
export interface QuranPayloadShape {
  ratings: QuranRatingShape[];
  compliance: QuranComplianceShape[];
  strengths: string;
  improvements: string;
  suggestions: string;
}
export interface ClassroomObservationShape {
  id: string;
  form: ObservationForm;
  routineSlotId: string | null;
  sectionId: string | null;
  subjectGroupId: string | null;
  subject: string;
  teacherId: string;
  classDate: string;
  periodNumber: number | null;
  observerId: string | null;
  state: ObservationState;
  createdBy: string;
  assignedAt: string | null;
  reviewedAt: string | null;
  /** CO-8 (D-#271): publish stamp — teacher visibility gate. null = unpublished. */
  publishedAt: string | null;
  publishedBy: string | null;
  domains: DomainScoreShape[];
  gates: GateScoreShape[];
  oneStrength: string | null;
  growthFocus: string | null;
  prevObservationId: string | null;
  priorFocusProgress: string | null;
  /** CO-10 (D-#363): how the prior focus moved, in the observer's own words. */
  priorFocusNote: string | null;
  /** The Quran (ClassEcho) payload — set on a QURAN-form row at review, else null. */
  quran: QuranPayloadShape | null;
  /** CO-7 teacher fairness rating of the review (1–5; null until rated). */
  fairnessRating: number | null;
  usefulnessRating: number | null;
  fairnessRatedAt: string | null;
  recordingId: string | null;
  teacherResponse: string | null;
  supersededById: string | null;
  createdAt: string;
  updatedAt: string;
}

function shape(d: IClassroomObservation): ClassroomObservationShape {
  return {
    id: d._id.toString(),
    form: d.form,
    routineSlotId: d.routineSlotId ? d.routineSlotId.toString() : null,
    sectionId: d.sectionId ? d.sectionId.toString() : null,
    subjectGroupId: d.subjectGroupId ? d.subjectGroupId.toString() : null,
    subject: d.subject,
    teacherId: d.teacherId.toString(),
    classDate: d.classDate,
    periodNumber: d.periodNumber ?? null,
    observerId: d.observerId ? d.observerId.toString() : null,
    state: d.state,
    createdBy: d.createdBy.toString(),
    assignedAt: d.assignedAt ? new Date(d.assignedAt).toISOString() : null,
    reviewedAt: d.reviewedAt ? new Date(d.reviewedAt).toISOString() : null,
    publishedAt: d.publishedAt ? new Date(d.publishedAt).toISOString() : null,
    publishedBy: d.publishedBy ? d.publishedBy.toString() : null,
    domains: (d.domains ?? []).map((x) => ({ domain: x.domain, level: x.level, note: x.note })),
    gates: (d.gates ?? []).map((x) => ({ gate: x.gate, result: x.result, breachNote: x.breachNote ?? null })),
    oneStrength: d.oneStrength ?? null,
    growthFocus: d.growthFocus ?? null,
    prevObservationId: d.prevObservationId ? d.prevObservationId.toString() : null,
    priorFocusProgress: d.priorFocusProgress ?? null,
    priorFocusNote: d.priorFocusNote ?? null,
    quran: d.quran
      ? {
          ratings: (d.quran.ratings ?? []).map((x) => ({
            criterion: x.criterion,
            score: x.score,
            note: x.note ?? null,
          })),
          compliance: (d.quran.compliance ?? []).map((x) => ({ item: x.item, yesNo: x.yesNo })),
          strengths: d.quran.strengths,
          improvements: d.quran.improvements,
          suggestions: d.quran.suggestions,
        }
      : null,
    fairnessRating: d.fairnessRating ?? null,
    usefulnessRating: d.usefulnessRating ?? null,
    fairnessRatedAt: d.fairnessRatedAt ? new Date(d.fairnessRatedAt).toISOString() : null,
    recordingId: d.recordingId ? d.recordingId.toString() : null,
    teacherResponse: d.teacherResponse ?? null,
    supersededById: d.supersededById ? d.supersededById.toString() : null,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function oid(id: string, label: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new ClassroomObservationError(`Invalid ${label}`);
  return new Types.ObjectId(id);
}

function assertForm(form: string): ObservationForm {
  if (!(OBSERVATION_FORMS as readonly string[]).includes(form)) {
    throw new ClassroomObservationError(`form must be one of: ${OBSERVATION_FORMS.join(", ")}`);
  }
  return form as ObservationForm;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function assertClassDate(classDate: string): string {
  if (!DATE_RE.test(classDate ?? "")) throw new ClassroomObservationError("classDate must be YYYY-MM-DD");
  return classDate;
}

/** The Quran anchor subject (the Quran SubjectGroup track, D-#56). A QURAN observation
 *  uses the QURAN form, a non-Quran subject uses REF-11 — enforced both ways below. */
const QURAN_SUBJECT = "QURAN";

/**
 * Validate the session anchor: EXACTLY ONE of sectionId / subjectGroupId, and the
 * form ↔ subject must agree (CO-5):
 *   - subject === "QURAN"  ⟺  form === "QURAN" (the ClassEcho Quran form);
 *   - any other subject    ⟺  form === "REF11" (subject ∈ HW_SUBJECTS).
 * A mismatch (a Quran session on REF-11, or a non-Quran session on the Quran form) is
 * refused in Bangla.
 */
function assertAnchor(input: {
  form: ObservationForm;
  subject: string;
  sectionId?: string | null;
  subjectGroupId?: string | null;
}): { sectionId: Types.ObjectId | null; subjectGroupId: Types.ObjectId | null; subject: string } {
  const hasSection = !!input.sectionId;
  const hasGroup = !!input.subjectGroupId;
  if (hasSection === hasGroup) {
    throw new ClassroomObservationError("Provide exactly one of sectionId or subjectGroupId (the session anchor)");
  }
  const subject = (input.subject ?? "").trim();
  if (!subject) throw new ClassroomObservationError("subject is required");

  // Form ↔ subject must agree (CO-5): QURAN ⟺ Quran form; everything else ⟺ REF-11.
  if (subject === QURAN_SUBJECT) {
    if (input.form !== "QURAN") {
      throw new ClassroomObservationError("কুরআন শ্রেণির পর্যবেক্ষণে অবশ্যই কুরআন ফর্ম ব্যবহার করতে হবে (REF-11 নয়)");
    }
  } else {
    if (input.form === "QURAN") {
      throw new ClassroomObservationError("শুধু কুরআন বিষয়েই কুরআন ফর্ম ব্যবহার করা যাবে");
    }
    if (!(HW_SUBJECTS as readonly string[]).includes(subject)) {
      throw new ClassroomObservationError(
        `A REF-11 observation's subject must be one of: ${HW_SUBJECTS.join(", ")} (QURAN uses the Quran form — CO-5)`,
      );
    }
  }
  return {
    sectionId: hasSection ? oid(input.sectionId as string, "sectionId") : null,
    subjectGroupId: hasGroup ? oid(input.subjectGroupId as string, "subjectGroupId") : null,
    subject,
  };
}

// ---------------------------------------------------------------------------
// uploadObservation (J1 — Principal/Office upload + assign)
// ---------------------------------------------------------------------------

export interface UploadObservationInput {
  form: string;
  subject: string;
  teacherId: string;
  classDate: string;
  sectionId?: string | null;
  subjectGroupId?: string | null;
  routineSlotId?: string | null;
  periodNumber?: number | null;
  recordingId?: string | null;
  /** Assign the observer in the same step (J1). Omit to leave the row UPLOADED. */
  observerId?: string | null;
  /** The authenticated uploader (Principal/Office). */
  actorId: string;
}

export async function uploadObservation(input: UploadObservationInput): Promise<ClassroomObservationShape> {
  const form = assertForm(input.form);
  const classDate = assertClassDate(input.classDate);
  const teacherId = oid(input.teacherId, "teacherId");
  const anchor = assertAnchor({
    form,
    subject: input.subject,
    sectionId: input.sectionId,
    subjectGroupId: input.subjectGroupId,
  });

  let observerId: Types.ObjectId | null = null;
  let state: ObservationState = "UPLOADED";
  let assignedAt: Date | null = null;
  if (input.observerId) {
    observerId = oid(input.observerId, "observerId");
    // CONFLICT GUARD (§5/J1): the observer can NOT be the observed teacher.
    if (observerId.equals(teacherId)) {
      throw new ClassroomObservationError("An observer cannot be assigned their own teaching");
    }
    state = "ASSIGNED";
    assignedAt = new Date();
  }

  const doc = await ClassroomObservation.create({
    form,
    subject: anchor.subject,
    teacherId,
    classDate,
    sectionId: anchor.sectionId,
    subjectGroupId: anchor.subjectGroupId,
    routineSlotId: input.routineSlotId ? oid(input.routineSlotId, "routineSlotId") : null,
    periodNumber: input.periodNumber ?? null,
    recordingId: input.recordingId ? oid(input.recordingId, "recordingId") : null,
    observerId,
    state,
    assignedAt,
    createdBy: oid(input.actorId, "actorId"),
  });

  await writeAudit({
    eventKind: "CLASSROOM_OBSERVATION_UPLOADED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ClassroomObservation",
    meta: { form, teacherId: input.teacherId, classDate, state },
  });
  if (observerId) {
    await writeAudit({
      eventKind: "CLASSROOM_OBSERVATION_ASSIGNED",
      actorId: input.actorId,
      targetId: doc._id,
      targetKind: "ClassroomObservation",
      meta: { observerId: observerId.toString(), teacherId: input.teacherId },
    });
  }

  return shape(doc);
}

// ---------------------------------------------------------------------------
// assignObserver — (re)assign before review
// ---------------------------------------------------------------------------

export interface AssignObserverInput {
  observationId: string;
  observerId: string;
  /** The authenticated assigner (Principal/Office). */
  actorId: string;
}

export async function assignObserver(input: AssignObserverInput): Promise<ClassroomObservationShape> {
  const doc = (await ClassroomObservation.findById(input.observationId)) as IClassroomObservation | null;
  if (!doc) throw new ClassroomObservationError("Observation not found");
  if (doc.state !== "UPLOADED" && doc.state !== "ASSIGNED") {
    throw new ClassroomObservationError("Only an uploaded/assigned observation can be (re)assigned");
  }
  const observerId = oid(input.observerId, "observerId");
  // CONFLICT GUARD (§5): observer ≠ observed teacher.
  if (observerId.equals(doc.teacherId)) {
    throw new ClassroomObservationError("An observer cannot be assigned their own teaching");
  }
  doc.observerId = observerId;
  doc.state = "ASSIGNED";
  doc.assignedAt = new Date();
  await doc.save();

  await writeAudit({
    eventKind: "CLASSROOM_OBSERVATION_ASSIGNED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ClassroomObservation",
    meta: { observerId: observerId.toString(), teacherId: doc.teacherId.toString() },
  });

  return shape(doc);
}

// ---------------------------------------------------------------------------
// reviewObservation (J2 — the assigned observer scores + releases)
// ---------------------------------------------------------------------------

/**
 * Review input: the observer's REF-11 payload (the default), plus an OPTIONAL `quran`
 * payload for a QURAN-form row. The validator is chosen by the row's `form`, not by the
 * caller — a REF-11 row is scored with `validateRef11Payload`, a QURAN row with
 * `validateQuranPayload`. The wrong payload for the form is refused (in Bangla).
 */
export interface ReviewObservationInput extends Ref11PayloadInput {
  observationId: string;
  /** The authenticated observer — MUST equal the assigned observerId. */
  actorId: string;
  /** The Quran (ClassEcho) payload — required for + only valid on a QURAN-form row. */
  quran?: QuranPayloadInput;
}

export async function reviewObservation(input: ReviewObservationInput): Promise<ClassroomObservationShape> {
  const doc = (await ClassroomObservation.findById(input.observationId)) as IClassroomObservation | null;
  if (!doc) throw new ClassroomObservationError("Observation not found");
  if (doc.state !== "ASSIGNED") {
    throw new ClassroomObservationError("Only an assigned observation can be reviewed");
  }
  // Gated to the ASSIGNED observer (the base observation:review perm is widened to
  // the specific row here — a different teacher with observation:review is refused).
  if (!doc.observerId || doc.observerId.toString() !== input.actorId) {
    throw new ClassroomObservationError("Only the assigned observer may review this observation");
  }

  // The form decides the validator + the stored payload (CO-5): a QURAN row uses the
  // Quran (ClassEcho) form; every other row uses REF-11. NEVER REF-11 for QURAN.
  if (doc.form === "QURAN") {
    if (!input.quran) {
      throw new ClassroomObservationError("কুরআন ফর্মের পর্যবেক্ষণে কুরআন পেলোড প্রয়োজন");
    }
    const payload = validateQuranPayload(input.quran);
    doc.quran = payload;
    // A QURAN row never carries the REF-11 fields (left at their defaults).
  } else {
    const payload = validateRef11Payload(input);
    doc.domains = payload.domains;
    doc.gates = payload.gates;
    doc.oneStrength = payload.oneStrength;
    doc.growthFocus = payload.growthFocus;
    doc.priorFocusProgress = payload.priorFocusProgress;
    doc.priorFocusNote = payload.priorFocusNote;
  }
  doc.state = "REVIEWED"; // observer/Principal-only until PUBLISHED (CO-8, D-#271)
  doc.reviewedAt = new Date();
  await doc.save();

  await writeAudit({
    eventKind: "CLASSROOM_OBSERVATION_REVIEWED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ClassroomObservation",
    meta: { teacherId: doc.teacherId.toString(), observerId: input.actorId },
  });

  // CO-8 (D-#271): REVIEWED no longer releases to the teacher — nudge Principal/Office
  // that a review is waiting to be PUBLISHED. Best-effort; never rolls back the review.
  await emitReadyToPublish(doc);

  return shape(doc);
}

/** Best-effort release notice to the observed teacher. Since CO-8 (D-#271) this fires
 *  at PUBLISH (not review). Swallows its own failure with a log — the publish already
 *  committed. */
async function emitObservationReleased(doc: IClassroomObservation): Promise<void> {
  try {
    await emit({
      recipientUserId: doc.teacherId.toString(),
      kind: "OBSERVATION_RELEASED",
      titleBn: "আপনার শ্রেণি পর্যবেক্ষণ প্রকাশিত হয়েছে",
      bodyBn: "আপনার শ্রেণি পর্যবেক্ষণটি পর্যালোচনা সম্পন্ন হয়ে প্রকাশিত হয়েছে। অনুগ্রহ করে দেখে সাড়া দিন।",
      refs: { observationId: doc._id.toString(), teacherId: doc.teacherId.toString() },
      dedupeKey: `OBSREL:${doc._id.toString()}`,
    });
  } catch (err) {
    console.error("OBSERVATION_RELEASED emit failed (never blocks the release):", err);
  }
}

/** Best-effort "ready to publish" nudge to Principal/Office at REVIEWED (CO-8). One
 *  inbox row per manager; never blocks the review. */
async function emitReadyToPublish(doc: IClassroomObservation): Promise<void> {
  try {
    const managerIds = await managerRecipientIds();
    const obsId = doc._id.toString();
    await Promise.all(
      managerIds.map((userId) =>
        emit({
          recipientUserId: userId,
          kind: "OBSERVATION_READY_TO_PUBLISH",
          titleBn: "একটি পর্যবেক্ষণ প্রকাশের অপেক্ষায়",
          bodyBn: "একটি শ্রেণি পর্যবেক্ষণের পর্যালোচনা সম্পন্ন হয়েছে এবং শিক্ষকের কাছে প্রকাশের অপেক্ষায় আছে।",
          refs: { observationId: obsId, teacherId: doc.teacherId.toString() },
          dedupeKey: `OBSPUBREADY:${obsId}:${userId}`,
        }),
      ),
    );
  } catch (err) {
    console.error("OBSERVATION_READY_TO_PUBLISH emit failed (never blocks the review):", err);
  }
}

/** Principal + Office — the observation:manage holders who may publish. */
async function managerRecipientIds(): Promise<string[]> {
  const users = (await User.find({ role: { $in: ["PRINCIPAL", "OFFICE"] }, active: true })
    .select("_id")
    .lean()) as Array<{ _id: Types.ObjectId }>;
  return users.map((u) => u._id.toString());
}

// ---------------------------------------------------------------------------
// publishObservation (CO-8, D-#271 — Principal/Office release to the teacher)
// ---------------------------------------------------------------------------

export interface PublishObservationInput {
  observationId: string;
  /** The authenticated publisher (Principal/Office — observation:manage). */
  actorId: string;
}

/**
 * Publish a REVIEWED observation to the observed teacher (CO-8). Stamps `publishedAt` +
 * `publishedBy` and fires OBSERVATION_RELEASED to the teacher (the release moved here
 * from reviewObservation). Only a REVIEWED, not-yet-published row can be published — an
 * already-published row is refused so the teacher is not re-notified. Audited. RBAC
 * (observation:manage) is enforced by the resolver.
 */
export async function publishObservation(input: PublishObservationInput): Promise<ClassroomObservationShape> {
  const doc = (await ClassroomObservation.findById(input.observationId)) as IClassroomObservation | null;
  if (!doc) throw new ClassroomObservationError("Observation not found");
  if (doc.state !== "REVIEWED") {
    throw new ClassroomObservationError("শুধু পর্যালোচিত পর্যবেক্ষণই প্রকাশ করা যাবে");
  }
  if (doc.publishedAt) {
    throw new ClassroomObservationError("এই পর্যবেক্ষণ ইতিমধ্যে প্রকাশিত হয়েছে");
  }
  doc.publishedAt = new Date();
  doc.publishedBy = oid(input.actorId, "actorId");
  await doc.save();

  await writeAudit({
    eventKind: "CLASSROOM_OBSERVATION_PUBLISHED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ClassroomObservation",
    meta: { teacherId: doc.teacherId.toString(), observerId: doc.observerId ? doc.observerId.toString() : null },
  });

  // The release notice to the teacher now fires at PUBLISH (moved from review).
  await emitObservationReleased(doc);

  return shape(doc);
}

// ---------------------------------------------------------------------------
// respondToObservation (CO-3 — the observed teacher acknowledges the release)
// ---------------------------------------------------------------------------

export interface RespondToObservationInput {
  observationId: string;
  /** The authenticated actor — MUST be the observed teacher (obs.teacherId). */
  actorId: string;
  responseText: string;
}

/**
 * The observed teacher responds to a RELEASED observation (CO-3). ONLY the observed
 * teacher may respond, ONLY on a REVIEWED row; sets `teacherResponse` and transitions
 * REVIEWED → TEACHER_RESPONDED. Scores are NOT editable via this path (only the
 * response text is touched). Emits OBSERVATION_RESPONDED to the observer + the
 * Principal/observation:manage holders. Audited (CLASSROOM_OBSERVATION_RESPONDED).
 *
 * "Acknowledging = seen & discussed, not agreement" is UI copy — no server flag.
 */
export async function respondToObservation(
  input: RespondToObservationInput,
): Promise<ClassroomObservationShape> {
  const doc = (await ClassroomObservation.findById(input.observationId)) as IClassroomObservation | null;
  if (!doc) throw new ClassroomObservationError("Observation not found");
  // Gate to the observed teacher — a non-observed caller is refused in Bangla.
  if (doc.teacherId.toString() !== input.actorId) {
    throw new ClassroomObservationError("শুধু সংশ্লিষ্ট শিক্ষকই এই পর্যবেক্ষণে সাড়া দিতে পারবেন");
  }
  if (doc.state !== "REVIEWED") {
    throw new ClassroomObservationError("শুধু প্রকাশিত (পর্যালোচিত) পর্যবেক্ষণে সাড়া দেওয়া যাবে");
  }
  // CO-8 (D-#271): the teacher can only respond once the review is PUBLISHED.
  if (!doc.publishedAt) {
    throw new ClassroomObservationError("এই পর্যবেক্ষণ এখনো প্রকাশিত হয়নি");
  }
  const text = (input.responseText ?? "").trim();
  if (!text) throw new ClassroomObservationError("সাড়ার বিবরণ প্রয়োজন");

  doc.teacherResponse = text;
  doc.state = "TEACHER_RESPONDED";
  await doc.save();

  await writeAudit({
    eventKind: "CLASSROOM_OBSERVATION_RESPONDED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ClassroomObservation",
    meta: { teacherId: doc.teacherId.toString(), observerId: doc.observerId ? doc.observerId.toString() : null },
  });

  // Notify the observer + Principal(s) that the teacher has responded — best-effort,
  // never rolls back the transition.
  await emitObservationResponded(doc);

  return shape(doc);
}

/** Best-effort responded-notice to the observer + every Principal (CO-3). */
async function emitObservationResponded(doc: IClassroomObservation): Promise<void> {
  try {
    const principals = (await User.find({ role: "PRINCIPAL", active: true }).select("_id").lean()) as Array<{
      _id: Types.ObjectId;
    }>;
    // Observer + all Principals, deduped (a principal could also be the observer).
    const recipientIds = [
      ...new Set(
        [doc.observerId ? doc.observerId.toString() : null, ...principals.map((p) => p._id.toString())].filter(
          (x): x is string => !!x,
        ),
      ),
    ];
    const obsId = doc._id.toString();
    await Promise.all(
      recipientIds.map((userId) =>
        emit({
          recipientUserId: userId,
          kind: "OBSERVATION_RESPONDED",
          titleBn: "শিক্ষক পর্যবেক্ষণে সাড়া দিয়েছেন",
          bodyBn: "একজন শিক্ষক তাঁর শ্রেণি পর্যবেক্ষণে সাড়া দিয়েছেন।",
          refs: { observationId: obsId, teacherId: doc.teacherId.toString() },
          dedupeKey: `OBSRESP:${obsId}:${userId}`,
        }),
      ),
    );
  } catch (err) {
    console.error("OBSERVATION_RESPONDED emit failed (never blocks the response):", err);
  }
}

// ---------------------------------------------------------------------------
// requestReReview — re-review supersedes (new row; prior SUPERSEDED)
// ---------------------------------------------------------------------------

export interface RequestReReviewInput {
  /** The REVIEWED observation to re-review. */
  priorObservationId: string;
  /** The new observer (≠ the observed teacher). */
  observerId: string;
  /** The authenticated requester (Principal/Office). */
  actorId: string;
}

export async function requestReReview(input: RequestReReviewInput): Promise<ClassroomObservationShape> {
  const prior = (await ClassroomObservation.findById(input.priorObservationId)) as IClassroomObservation | null;
  if (!prior) throw new ClassroomObservationError("Observation not found");
  if (prior.state !== "REVIEWED" && prior.state !== "TEACHER_RESPONDED") {
    throw new ClassroomObservationError("Only a reviewed observation can be re-reviewed");
  }
  const observerId = oid(input.observerId, "observerId");
  if (observerId.equals(prior.teacherId)) {
    throw new ClassroomObservationError("An observer cannot be assigned their own teaching");
  }

  // Create a fresh ASSIGNED observation on the SAME anchor + recording (carry-forward
  // link via prevObservationId). The new review's priorFocusProgress will reference
  // the prior growth focus (§4).
  const fresh = await ClassroomObservation.create({
    form: prior.form,
    subject: prior.subject,
    teacherId: prior.teacherId,
    classDate: prior.classDate,
    sectionId: prior.sectionId ?? null,
    subjectGroupId: prior.subjectGroupId ?? null,
    routineSlotId: prior.routineSlotId ?? null,
    periodNumber: prior.periodNumber ?? null,
    recordingId: prior.recordingId ?? null,
    observerId,
    state: "ASSIGNED",
    assignedAt: new Date(),
    createdBy: oid(input.actorId, "actorId"),
    prevObservationId: prior._id,
  });

  prior.state = "SUPERSEDED";
  prior.supersededById = fresh._id;
  await prior.save();

  await writeAudit({
    eventKind: "CLASSROOM_OBSERVATION_SUPERSEDED",
    actorId: input.actorId,
    targetId: prior._id,
    targetKind: "ClassroomObservation",
    meta: { supersededById: fresh._id.toString(), teacherId: prior.teacherId.toString() },
  });
  await writeAudit({
    eventKind: "CLASSROOM_OBSERVATION_ASSIGNED",
    actorId: input.actorId,
    targetId: fresh._id,
    targetKind: "ClassroomObservation",
    meta: { observerId: observerId.toString(), teacherId: prior.teacherId.toString(), reReviewOf: prior._id.toString() },
  });

  return shape(fresh);
}

// ---------------------------------------------------------------------------
// requestCoReview — parallel co-review (new independent row; NO supersession, CO-9)
// ---------------------------------------------------------------------------

export interface RequestCoReviewInput {
  /** An existing observation on the recording to add a parallel reviewer to. */
  sourceObservationId: string;
  /** The additional observer (≠ observed teacher, ≠ an existing reviewer of this recording). */
  observerId: string;
  /** The authenticated requester (Principal/Office). */
  actorId: string;
}

/**
 * Add a PARALLEL co-reviewer to a recording (CO-9, D-#272). Creates a NEW independent
 * ASSIGNED observation on the SAME recording/anchor as `source`, WITHOUT superseding it
 * and WITHOUT prevObservationId — the opposite of requestReReview (which REPLACES). The
 * two rows are siblings grouped by the shared recordingId, each scored + published on its
 * own (CO-8). Guards: the source must have a recording; the co-observer ≠ the observed
 * teacher; and an observer already reviewing this recording is refused (no duplicate
 * reviewer rows). Audited.
 */
export async function requestCoReview(input: RequestCoReviewInput): Promise<ClassroomObservationShape> {
  const source = (await ClassroomObservation.findById(input.sourceObservationId)) as IClassroomObservation | null;
  if (!source) throw new ClassroomObservationError("Observation not found");
  if (!source.recordingId) {
    throw new ClassroomObservationError("সহ-পর্যালোচনার আগে সেশনের ভিডিও সংযুক্ত করতে হবে");
  }
  const observerId = oid(input.observerId, "observerId");
  if (observerId.equals(source.teacherId)) {
    throw new ClassroomObservationError("An observer cannot be assigned their own teaching");
  }
  // No duplicate reviewer rows on one recording (an active row by this observer).
  const dup = await ClassroomObservation.findOne({
    recordingId: source.recordingId,
    observerId,
    state: { $ne: "SUPERSEDED" },
  }).lean();
  if (dup) {
    throw new ClassroomObservationError("এই পর্যবেক্ষক ইতিমধ্যে এই সেশনটি পর্যালোচনা করছেন");
  }

  const fresh = await ClassroomObservation.create({
    form: source.form,
    subject: source.subject,
    teacherId: source.teacherId,
    classDate: source.classDate,
    sectionId: source.sectionId ?? null,
    subjectGroupId: source.subjectGroupId ?? null,
    routineSlotId: source.routineSlotId ?? null,
    periodNumber: source.periodNumber ?? null,
    recordingId: source.recordingId,
    observerId,
    state: "ASSIGNED",
    assignedAt: new Date(),
    createdBy: oid(input.actorId, "actorId"),
    // NO prevObservationId / supersededById — a sibling, not a replacement.
  });

  await writeAudit({
    eventKind: "CLASSROOM_OBSERVATION_ASSIGNED",
    actorId: input.actorId,
    targetId: fresh._id,
    targetKind: "ClassroomObservation",
    meta: {
      observerId: observerId.toString(),
      teacherId: source.teacherId.toString(),
      coReviewOf: source._id.toString(),
      recordingId: source.recordingId.toString(),
    },
  });

  return shape(fresh);
}

// ---------------------------------------------------------------------------
// Reads + the PURE row-scope predicate
// ---------------------------------------------------------------------------

/** A minimal actor for the row-scope predicate (decoupled from AppContext for tests). */
export interface ObservationActor {
  userId: string;
  /** True for Principal/Office (observation:manage) — sees ALL rows. */
  canManage: boolean;
}

/**
 * The PURE row-scope visibility rule (§5, D-#28). Returns whether `actor` may read
 * `obs`:
 *   - a manager (Principal/Office, observation:manage) sees ALL;
 *   - the assigned OBSERVER sees their own row (any state);
 *   - the OBSERVED teacher sees their own row ONLY once PUBLISHED (CO-8, D-#271) —
 *     `publishedAt` set; never a REVIEWED-but-unpublished row, never an UPLOADED/
 *     ASSIGNED row, and never another observer's in-progress input;
 *   - everyone else: denied.
 * (`publishedAt` is only ever stamped at/after REVIEWED, so the teacher branch need
 * not re-check `state`.)
 */
export function canReadObservation(
  actor: ObservationActor,
  obs: { teacherId: string; observerId: string | null; state: ObservationState; publishedAt: string | null },
): boolean {
  if (actor.canManage) return true;
  if (obs.observerId && obs.observerId === actor.userId) return true;
  if (obs.teacherId === actor.userId) {
    return !!obs.publishedAt;
  }
  return false;
}

export async function getObservation(observationId: string): Promise<ClassroomObservationShape | null> {
  if (!Types.ObjectId.isValid(observationId)) throw new ClassroomObservationError("Invalid observation id");
  const doc = (await ClassroomObservation.findById(observationId).lean()) as IClassroomObservation | null;
  return doc ? shape(doc) : null;
}

/** Every observation about a teacher, newest first (the resolver row-scopes the result). */
export async function observationsForTeacher(teacherId: string): Promise<ClassroomObservationShape[]> {
  const docs = (await ClassroomObservation.find({ teacherId: oid(teacherId, "teacherId") })
    .sort({ classDate: -1, createdAt: -1 })
    .lean()) as unknown as IClassroomObservation[];
  return docs.map(shape);
}

/** Every observation on a recording, oldest first — the CO-9 co-review group (the
 *  resolver gates this to Principal/Office oversight). */
export async function observationsForRecording(recordingId: string): Promise<ClassroomObservationShape[]> {
  const docs = (await ClassroomObservation.find({ recordingId: oid(recordingId, "recordingId") })
    .sort({ createdAt: 1 })
    .lean()) as unknown as IClassroomObservation[];
  return docs.map(shape);
}

// ---------------------------------------------------------------------------
// priorObservationContext — the CO-10 carry-forward slice (D-#363)
// ---------------------------------------------------------------------------

/**
 * The NARROW prior-observation slice the review form carries forward (CO-10, D-#363).
 *
 * This is deliberately NOT a `ClassroomObservationShape`. The prior review was usually
 * written by a DIFFERENT observer, whose row `canReadObservation` does not expose, so
 * the widening is held to exactly these fields: the developmental thread (what focus was
 * set, when, in which subject, and how it was last judged) and nothing else. There is NO
 * `domains`, NO `gates`, NO breach note, NO `teacherResponse`, NO fairness rating and —
 * deliberately — NO `observerId`: peer scores and peer identity stay private (D-#28).
 *
 * Adding a field here re-opens that decision. Don't widen it without a new ADR row.
 */
export interface PriorFocusContextShape {
  /** The prior observation's id — for the audit trail / a manager's own drill-down. */
  observationId: string;
  classDate: string;
  subject: string;
  form: ObservationForm;
  growthFocus: string | null;
  oneStrength: string | null;
  /** How the prior review itself judged ITS prior focus (the thread, one link back). */
  priorFocusProgress: string | null;
  /** False ⇒ the focus was set in a DIFFERENT subject; the UI says so, because that
   *  changes how the observer should read it. */
  sameSubject: boolean;
  /** True ⇒ resolved via `prevObservationId` (a re-review of the SAME session). */
  isReReview: boolean;
}

/** The states whose growth focus is settled enough to carry forward. An UPLOADED or
 *  ASSIGNED row has no payload at all; a SUPERSEDED one was still real feedback. */
const PRIOR_FOCUS_STATES: ObservationState[] = ["REVIEWED", "TEACHER_RESPONDED", "SUPERSEDED"];

function priorSlice(
  prior: IClassroomObservation,
  current: { subject: string },
  isReReview: boolean,
): PriorFocusContextShape {
  return {
    observationId: prior._id.toString(),
    classDate: prior.classDate,
    subject: prior.subject,
    form: prior.form,
    growthFocus: prior.growthFocus ?? null,
    oneStrength: prior.oneStrength ?? null,
    priorFocusProgress: prior.priorFocusProgress ?? null,
    sameSubject: prior.subject === current.subject,
    isReReview,
  };
}

/**
 * Resolve the observation whose growth focus `observationId` carries forward (CO-10):
 *   1. `prevObservationId` when set — a re-review points at its own predecessor, so
 *      there is nothing to search for;
 *   2. otherwise the newest REF-11 row for the SAME teacher with a non-null growthFocus,
 *      a settled state and `classDate <` this row's, PREFERRING the same subject — a
 *      same-subject prior is chosen ahead of any other-subject one, not merely sorted
 *      first, because "the focus you set in this subject" is the question being asked;
 *   3. else null (a first-ever observation — the form then hides both fields).
 *
 * REF-11 only: a QURAN row has no growthFocus and no progress field to answer.
 * Callers MUST gate access first (see `canReadPriorContext`) — this is a pure read.
 */
export async function priorObservationContext(
  observationId: string,
): Promise<PriorFocusContextShape | null> {
  const current = (await ClassroomObservation.findById(
    oid(observationId, "observationId"),
  ).lean()) as IClassroomObservation | null;
  if (!current) throw new ClassroomObservationError("Observation not found");
  // The carry-forward question only exists on the REF-11 form (§4).
  if (current.form !== "REF11") return null;

  // (1) A re-review already names its predecessor.
  if (current.prevObservationId) {
    const linked = (await ClassroomObservation.findById(
      current.prevObservationId,
    ).lean()) as IClassroomObservation | null;
    if (linked) return priorSlice(linked, current, true);
    // A dangling link falls through to the date search rather than returning nothing.
  }

  const base: FilterQuery<IClassroomObservation> = {
    _id: { $ne: current._id },
    teacherId: current.teacherId,
    form: "REF11",
    state: { $in: PRIOR_FOCUS_STATES },
    growthFocus: { $ne: null },
    classDate: { $lt: current.classDate },
  };
  const sort = { classDate: -1 as const, reviewedAt: -1 as const };

  // (2a) Same subject wins outright...
  const sameSubject = (await ClassroomObservation.findOne({ ...base, subject: current.subject })
    .sort(sort)
    .lean()) as IClassroomObservation | null;
  if (sameSubject) return priorSlice(sameSubject, current, false);

  // (2b) ...otherwise the most recent focus set in any subject.
  const anySubject = (await ClassroomObservation.findOne(base)
    .sort(sort)
    .lean()) as IClassroomObservation | null;
  return anySubject ? priorSlice(anySubject, current, false) : null;
}

/**
 * Who may pull the CO-10 slice for a row: the ASSIGNED OBSERVER of that row (they are
 * the one being asked the carry-forward question) or a manager. Deliberately NOT the
 * observed teacher — they read their own published feedback through the normal row
 * read; this endpoint exists to fill in a form, and its whole point is showing one
 * slice of a row the caller could not otherwise see.
 */
export function canReadPriorContext(
  actor: ObservationActor,
  obs: { observerId: string | null },
): boolean {
  if (actor.canManage) return true;
  return !!obs.observerId && obs.observerId === actor.userId;
}

// ---------------------------------------------------------------------------
// allObservationsPaged — the filtered + paginated oversight read (WS1)
// ---------------------------------------------------------------------------

/** Escape user text for a safe case-insensitive name regex. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface AllObservationsFilterInput {
  teacherId?: string | null;
  observerId?: string | null;
  state?: string | null;
  form?: string | null;
  subject?: string | null;
  /** The CLASS/section anchor (CO-11, D-#363) — every row stores one, no screen
   *  could filter on it. A subjectGroup-anchored row simply never matches. */
  sectionId?: string | null;
  /** CO-8 publish gate (D-#324): true = released to the teacher (publishedAt set);
   *  false = not yet published (publishedAt null); undefined = either. */
  published?: boolean | null;
  /** classDate >= dateFrom (YYYY-MM-DD, inclusive). */
  dateFrom?: string | null;
  /** classDate <= dateTo (YYYY-MM-DD, inclusive). */
  dateTo?: string | null;
  /** Free text matched against the observed-teacher / observer NAME (User lookup). */
  search?: string | null;
  limit?: number | null;
  offset?: number | null;
}

export interface ObservationPageShape {
  items: ClassroomObservationShape[];
  total: number;
  hasMore: boolean;
}

const OBS_PAGE_DEFAULT = 20;
const OBS_PAGE_MAX = 100;

/**
 * All observations for the Principal/Office oversight view, filtered + paginated (WS1).
 * Filters are AND-combined; `search` resolves to matching User ids and matches either
 * the observed teacher OR the observer. Sorted newest-first (classDate desc). Returns
 * the page plus the unpaged `total` so the UI can show counts / page bounds. classDate
 * is a "YYYY-MM-DD" string, so lexical range bounds are chronological.
 */
export async function allObservationsPaged(
  input: AllObservationsFilterInput,
): Promise<ObservationPageShape> {
  const q: FilterQuery<IClassroomObservation> = {};
  if (input.teacherId) q.teacherId = oid(input.teacherId, "teacherId");
  if (input.observerId) q.observerId = oid(input.observerId, "observerId");
  if (input.state) q.state = input.state;
  if (input.form) q.form = input.form;
  if (input.subject) q.subject = input.subject;
  if (input.sectionId) q.sectionId = oid(input.sectionId, "sectionId");
  // CO-8 publish gate (D-#324): publishedAt set = released to the teacher.
  if (input.published === true) q.publishedAt = { $ne: null };
  else if (input.published === false) q.publishedAt = null;
  if (input.dateFrom || input.dateTo) {
    const range: Record<string, string> = {};
    if (input.dateFrom) range.$gte = input.dateFrom;
    if (input.dateTo) range.$lte = input.dateTo;
    q.classDate = range;
  }
  if (input.search && input.search.trim()) {
    const re = new RegExp(escapeRegex(input.search.trim()), "i");
    const users = (await User.find({ name: re }).select("_id").lean()) as Array<{ _id: Types.ObjectId }>;
    if (users.length === 0) return { items: [], total: 0, hasMore: false };
    const ids = users.map((u) => u._id);
    q.$or = [{ teacherId: { $in: ids } }, { observerId: { $in: ids } }];
  }

  const limit = Math.min(Math.max(input.limit ?? OBS_PAGE_DEFAULT, 1), OBS_PAGE_MAX);
  const offset = Math.max(input.offset ?? 0, 0);

  const total = await ClassroomObservation.countDocuments(q);
  const docs = (await ClassroomObservation.find(q)
    .sort({ classDate: -1, createdAt: -1 })
    .skip(offset)
    .limit(limit)
    .lean()) as unknown as IClassroomObservation[];

  return { items: docs.map(shape), total, hasMore: offset + docs.length < total };
}

/**
 * The observer's OWN review history (CO-11, D-#363) — the same filter/paging engine as
 * `allObservationsPaged` with `observerId` FORCED to the caller.
 *
 * The force is the point: `observerId` is not an argument of the resolver, and any
 * caller-supplied one is dropped here too, so this can never be pointed at a peer's
 * work. No state restriction — `myReviewQueue` answers "what is still open", this
 * answers "everything I have touched", which is why a reviewed row stops vanishing the
 * moment it is submitted. Every returned row is one the caller observed, so
 * `canReadObservation` already permitted it: nothing is widened.
 */
export async function observerReviewsPaged(
  observerId: string,
  input: AllObservationsFilterInput,
): Promise<ObservationPageShape> {
  return allObservationsPaged({ ...input, observerId });
}

/** The observer's open review queue (ASSIGNED rows assigned to them). */
export async function myReviewQueue(observerId: string): Promise<ClassroomObservationShape[]> {
  const docs = (await ClassroomObservation.find({
    observerId: oid(observerId, "observerId"),
    state: "ASSIGNED",
  })
    .sort({ assignedAt: -1, createdAt: -1 })
    .lean()) as unknown as IClassroomObservation[];
  return docs.map(shape);
}
