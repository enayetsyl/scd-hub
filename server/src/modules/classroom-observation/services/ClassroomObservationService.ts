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
 *   reviewObservation   — the ASSIGNED observer scores+comments → REVIEWED (releases
 *                         to the observed teacher; NO Principal sign-off). The actor
 *                         MUST be the assigned observerId. Audited.
 *   requestReReview     — re-review: create a NEW ASSIGNED observation on the same
 *                         anchor/recording, mark the prior REVIEWED row SUPERSEDED
 *                         (`supersededById`/`prevObservationId`). Enables CO-7
 *                         calibration (≥1 observation per recording). Audited (both).
 *   reads               — getObservation / observationsForTeacher / myReviewQueue,
 *                         plus the PURE row-scope predicate `canReadObservation`
 *                         (observer own; observed teacher own at/after REVIEWED;
 *                         Principal/Office all) the resolver enforces.
 *
 * Role RBAC (observation:upload / :review / :read / :manage) is enforced by the
 * RESOLVER; this service trusts the actor + applies the conflict guard + state gates.
 *
 * Identity/operational plane (names teacherId/observerId); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import {
  OBSERVATION_FORMS,
  HW_SUBJECTS,
} from "@scd/shared";
import type { ObservationForm, ObservationState } from "@scd/shared";
import { ClassroomObservation, type IClassroomObservation } from "../models/ClassroomObservation";
import { validateRef11Payload, type Ref11PayloadInput } from "../ref11";
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
  domains: DomainScoreShape[];
  gates: GateScoreShape[];
  oneStrength: string | null;
  growthFocus: string | null;
  prevObservationId: string | null;
  priorFocusProgress: string | null;
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
    domains: (d.domains ?? []).map((x) => ({ domain: x.domain, level: x.level, note: x.note })),
    gates: (d.gates ?? []).map((x) => ({ gate: x.gate, result: x.result, breachNote: x.breachNote ?? null })),
    oneStrength: d.oneStrength ?? null,
    growthFocus: d.growthFocus ?? null,
    prevObservationId: d.prevObservationId ? d.prevObservationId.toString() : null,
    priorFocusProgress: d.priorFocusProgress ?? null,
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

/**
 * Validate the session anchor: EXACTLY ONE of sectionId / subjectGroupId, and the
 * subject must be a REF-11 (HW_SUBJECTS) subject when the form is REF11 (QURAN is CO-5).
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
  if (input.form === "REF11" && !(HW_SUBJECTS as readonly string[]).includes(subject)) {
    throw new ClassroomObservationError(
      `A REF-11 observation's subject must be one of: ${HW_SUBJECTS.join(", ")} (QURAN uses the Quran form — CO-5)`,
    );
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

export interface ReviewObservationInput extends Ref11PayloadInput {
  observationId: string;
  /** The authenticated observer — MUST equal the assigned observerId. */
  actorId: string;
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

  const payload = validateRef11Payload(input);

  doc.domains = payload.domains;
  doc.gates = payload.gates;
  doc.oneStrength = payload.oneStrength;
  doc.growthFocus = payload.growthFocus;
  doc.priorFocusProgress = payload.priorFocusProgress;
  doc.state = "REVIEWED"; // releases to the observed teacher — no Principal sign-off
  doc.reviewedAt = new Date();
  await doc.save();

  await writeAudit({
    eventKind: "CLASSROOM_OBSERVATION_REVIEWED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ClassroomObservation",
    meta: { teacherId: doc.teacherId.toString(), observerId: input.actorId },
  });

  // CO-3 release notify: tell the observed teacher their observation is out (REVIEWED).
  // ONE emit, kind-gated; best-effort — a notification failure never rolls back the
  // release (the D-#75 posture). N+1-safe (single recipient, single emit).
  await emitObservationReleased(doc);

  return shape(doc);
}

/** Best-effort release notice to the observed teacher (CO-3). Swallows its own
 *  failure with a log — the release transition already committed. */
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
  if (prior.state !== "REVIEWED") {
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
 *   - the OBSERVED teacher sees their own row ONLY at/after REVIEWED (REVIEWED /
 *     TEACHER_RESPONDED / SUPERSEDED) — never an UPLOADED/ASSIGNED row, and never
 *     another observer's in-progress input;
 *   - everyone else: denied.
 */
export function canReadObservation(
  actor: ObservationActor,
  obs: { teacherId: string; observerId: string | null; state: ObservationState },
): boolean {
  if (actor.canManage) return true;
  if (obs.observerId && obs.observerId === actor.userId) return true;
  if (obs.teacherId === actor.userId) {
    return obs.state === "REVIEWED" || obs.state === "TEACHER_RESPONDED" || obs.state === "SUPERSEDED";
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
