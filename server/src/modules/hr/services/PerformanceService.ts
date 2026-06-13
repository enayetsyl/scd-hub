/**
 * PerformanceService (HR-4; prd-hr §5.1/§5.3, H5.1/H5.2/H5.4, D-#28/#112) —
 * observations → annual appraisal → development (CPD).
 *
 *   submitObservation      — record an observation event (the supervisor-extent gate
 *                            is applied in the resolver; this just persists + audits).
 *   upsertAppraisal        — Office/Principal PREPARE the annual draft (goals +
 *                            development needs), one per staff per academic year.
 *   signOffAppraisal       — PRINCIPAL-only: set the overall outcome + sign off, and
 *                            EMIT the development needs into the CPD log (H5.4 — review
 *                            and growth linked).
 *   addDevelopmentLog      — an ad-hoc CPD entry.
 *
 * The REF-11 per-observation rubric is curriculum-owned + parked (§6/§10).
 * Identity plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import type { AppraisalOutcome } from "@scd/shared";
import { APPRAISAL_OUTCOMES } from "@scd/shared";
import { Observation, type IObservation } from "../models/Observation";
import { Appraisal, type IAppraisal } from "../models/Appraisal";
import { DevelopmentLog, type IDevelopmentLog } from "../models/DevelopmentLog";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { writeAudit } from "../../platform/services/AuditService";
import { PerformanceError } from "./conductLadder";
import { parseDateKey } from "./dates";

const todayKey = (): string => new Date().toISOString().slice(0, 10);

// --- observations -----------------------------------------------------------

export interface SubmitObservationInput {
  staffProfileId: string;
  observerId: string;
  dateKey: string;
  classId?: string;
  subjectId?: string;
  notes: string;
  followUp?: string;
  rubricScores?: Record<string, unknown>;
}

export async function submitObservation(input: SubmitObservationInput): Promise<IObservation> {
  if (!input.notes.trim()) throw new PerformanceError("Observation notes are required");
  parseDateKey(input.dateKey); // validate the key
  const staff = await StaffProfile.findById(input.staffProfileId).select("_id").lean();
  if (!staff) throw new PerformanceError("Staff profile not found");

  const obs = await Observation.create({
    staffProfileId: new Types.ObjectId(input.staffProfileId),
    observerId: new Types.ObjectId(input.observerId),
    dateKey: input.dateKey,
    classId: input.classId ? new Types.ObjectId(input.classId) : null,
    subjectId: input.subjectId ? new Types.ObjectId(input.subjectId) : null,
    notes: input.notes.trim(),
    followUp: input.followUp?.trim() ?? null,
    rubricScores: input.rubricScores ?? null,
  });

  await writeAudit({
    eventKind: "OBSERVATION_SUBMITTED",
    actorId: input.observerId,
    targetId: obs._id,
    targetKind: "Observation",
    meta: { staffProfileId: input.staffProfileId, classId: input.classId ?? null, subjectId: input.subjectId ?? null },
  });
  return obs;
}

/** All observations of a staff member (admin read, performance:manage). */
export async function observationsForStaff(staffProfileId: string): Promise<IObservation[]> {
  return Observation.find({ staffProfileId: new Types.ObjectId(staffProfileId) })
    .sort({ dateKey: -1 })
    .lean() as unknown as Promise<IObservation[]>;
}

/** A supervisor's OWN observations only (H5.2 — never others' inputs/outcomes). */
export async function observationsByObserver(observerId: string): Promise<IObservation[]> {
  return Observation.find({ observerId: new Types.ObjectId(observerId) })
    .sort({ dateKey: -1 })
    .lean() as unknown as Promise<IObservation[]>;
}

// --- appraisal --------------------------------------------------------------

export interface UpsertAppraisalInput {
  staffProfileId: string;
  academicYearId: string;
  goals?: string[];
  developmentNeeds?: string[];
  actorId: string;
}

/** Prepare/edit a DRAFT appraisal (one per staff per year). A signed-off appraisal is
 *  immutable here — re-opening is out of scope (a new cycle is a new academic year). */
export async function upsertAppraisal(input: UpsertAppraisalInput): Promise<IAppraisal> {
  const existing = await Appraisal.findOne({
    staffProfileId: new Types.ObjectId(input.staffProfileId),
    academicYearId: new Types.ObjectId(input.academicYearId),
  });
  if (existing && existing.status === "signed_off") {
    throw new PerformanceError("A signed-off appraisal is immutable (start a new cycle)");
  }
  const doc =
    existing ??
    new Appraisal({
      staffProfileId: new Types.ObjectId(input.staffProfileId),
      academicYearId: new Types.ObjectId(input.academicYearId),
      status: "draft",
      preparedBy: new Types.ObjectId(input.actorId),
    });
  if (input.goals !== undefined) doc.goals = input.goals;
  if (input.developmentNeeds !== undefined) doc.developmentNeeds = input.developmentNeeds;
  await doc.save();

  await writeAudit({
    eventKind: "APPRAISAL_PREPARED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "Appraisal",
    meta: { staffProfileId: input.staffProfileId, academicYearId: input.academicYearId },
  });
  return doc;
}

export interface SignOffAppraisalInput {
  appraisalId: string;
  outcome: AppraisalOutcome;
  outcomeNote?: string;
  actorId: string;
}

/** PRINCIPAL-only sign-off: set the outcome, lock the appraisal, and emit the
 *  development needs into the CPD log (H5.2/H5.4 — review feeds growth). */
export async function signOffAppraisal(input: SignOffAppraisalInput): Promise<IAppraisal> {
  if (!APPRAISAL_OUTCOMES.includes(input.outcome)) {
    throw new PerformanceError(`Unknown appraisal outcome: ${input.outcome}`);
  }
  const doc = await Appraisal.findById(input.appraisalId);
  if (!doc) throw new PerformanceError("Appraisal not found");
  if (doc.status === "signed_off") throw new PerformanceError("This appraisal is already signed off");

  doc.status = "signed_off";
  doc.overallOutcome = input.outcome;
  doc.outcomeNote = input.outcomeNote?.trim() ?? null;
  doc.signedOffBy = new Types.ObjectId(input.actorId);
  doc.signedOffAt = new Date();
  await doc.save();

  await writeAudit({
    eventKind: "APPRAISAL_SIGNED_OFF",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "Appraisal",
    meta: { staffProfileId: doc.staffProfileId.toString(), outcome: input.outcome },
  });

  // Emit each development need as a CPD log entry, linked to this appraisal (H5.4).
  const key = todayKey();
  for (const need of doc.developmentNeeds ?? []) {
    if (!need.trim()) continue;
    const log = await DevelopmentLog.create({
      staffProfileId: doc.staffProfileId,
      activity: need.trim(),
      dateKey: key,
      sourceAppraisalId: doc._id,
      createdBy: new Types.ObjectId(input.actorId),
    });
    await writeAudit({
      eventKind: "DEVELOPMENT_LOGGED",
      actorId: input.actorId,
      targetId: log._id,
      targetKind: "DevelopmentLog",
      meta: { staffProfileId: doc.staffProfileId.toString(), sourceAppraisalId: doc._id.toString() },
    });
  }
  return doc;
}

export async function appraisalsForStaff(staffProfileId: string): Promise<IAppraisal[]> {
  return Appraisal.find({ staffProfileId: new Types.ObjectId(staffProfileId) })
    .sort({ createdAt: -1 })
    .lean() as unknown as Promise<IAppraisal[]>;
}

// --- development (CPD) ------------------------------------------------------

export interface AddDevelopmentLogInput {
  staffProfileId: string;
  activity: string;
  dateKey?: string;
  outcome?: string;
  actorId: string;
}

export async function addDevelopmentLog(input: AddDevelopmentLogInput): Promise<IDevelopmentLog> {
  if (!input.activity.trim()) throw new PerformanceError("A development activity is required");
  const key = input.dateKey ?? todayKey();
  parseDateKey(key); // validate
  const log = await DevelopmentLog.create({
    staffProfileId: new Types.ObjectId(input.staffProfileId),
    activity: input.activity.trim(),
    dateKey: key,
    outcome: input.outcome?.trim() ?? null,
    createdBy: new Types.ObjectId(input.actorId),
  });

  await writeAudit({
    eventKind: "DEVELOPMENT_LOGGED",
    actorId: input.actorId,
    targetId: log._id,
    targetKind: "DevelopmentLog",
    meta: { staffProfileId: input.staffProfileId },
  });
  return log;
}

export async function developmentLogForStaff(staffProfileId: string): Promise<IDevelopmentLog[]> {
  return DevelopmentLog.find({ staffProfileId: new Types.ObjectId(staffProfileId) })
    .sort({ dateKey: -1 })
    .lean() as unknown as Promise<IDevelopmentLog[]>;
}
