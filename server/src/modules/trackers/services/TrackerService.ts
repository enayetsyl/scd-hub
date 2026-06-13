/**
 * TrackerService — open/record/close trackers (J4.1–J4.4).
 *
 * openTracker   — creates an open TrackerRecord keyed to an AssessmentSet.
 * recordEntry   — upserts one student entry; emits tracker_recorded CorpusEvent (ADR-005).
 * closeTracker  — sets status=closed, closedAt=now.
 * listTrackers  — filter by sectionId / kind / setId / status.
 * getTrackerSummary — aggregate stats for one record.
 * buildNonSubmitterLink — pure function; wa.me deep link for non-submitters (J4.2, ADR-003).
 *
 * Write-scope is enforced by the resolver (assertCanWrite), not here.
 */
import crypto from "crypto";
import { TrackerRecord } from "../models/TrackerRecord";
import { AssessmentSet } from "../../assessment/models/AssessmentSet";
import { CorpusEvent } from "../../corpus/models/CorpusEvent";
import { SET_TYPE_TO_TRACKER } from "@scd/shared";
import type { TrackerKind } from "@scd/shared";
import { renderTemplate } from "../../templates/services/MessageTemplateService";

/** Deterministic pseudonym for a student — sha256(studentId), ADR-005. */
function pseudonymize(studentId: string): string {
  return crypto.createHash("sha256").update(studentId).digest("hex");
}

// ---------------------------------------------------------------------------
// openTracker
// ---------------------------------------------------------------------------

export interface OpenTrackerResult {
  trackerId: string;
  trackerKind: TrackerKind;
  setId: string;
  sectionId: string;
  classId: string;
  status: string;
}

export async function openTracker(
  setId: string,
  sectionId: string,
  actorId: string,
): Promise<OpenTrackerResult> {
  const set = await AssessmentSet.findById(setId).lean();
  if (!set) throw new Error("AssessmentSet not found");

  const trackerKind = SET_TYPE_TO_TRACKER[set.setType];
  const classId = set.classId.toString();

  const doc = await TrackerRecord.create({
    trackerKind,
    setId,
    sectionId,
    classId,
    entries: [],
    status: "open",
    createdBy: actorId,
  });

  return {
    trackerId: doc._id.toString(),
    trackerKind,
    setId,
    sectionId,
    classId,
    status: "open",
  };
}

// ---------------------------------------------------------------------------
// recordEntry
// ---------------------------------------------------------------------------

export interface RecordEntryInput {
  trackerId: string;
  studentId: string;
  /** CT only */
  score?: number;
  /** AS only */
  submitted?: boolean;
  /** HW only */
  complete?: boolean;
  actorId: string;
}

export interface RecordEntryResult {
  trackerId: string;
  pseudoStudentId: string;
  entryCount: number;
}

export async function recordEntry(input: RecordEntryInput): Promise<RecordEntryResult> {
  const tracker = await TrackerRecord.findById(input.trackerId);
  if (!tracker) throw new Error("TrackerRecord not found");
  if (tracker.status !== "open") throw new Error("Tracker is closed");

  const pseudoStudentId = pseudonymize(input.studentId);

  const idx = tracker.entries.findIndex((e) => e.pseudoStudentId === pseudoStudentId);
  if (idx >= 0) {
    if (input.score !== undefined) tracker.entries[idx].score = input.score;
    if (input.submitted !== undefined) tracker.entries[idx].submitted = input.submitted;
    if (input.complete !== undefined) tracker.entries[idx].complete = input.complete;
  } else {
    tracker.entries.push({
      pseudoStudentId,
      score: input.score,
      submitted: input.submitted,
      complete: input.complete,
    });
  }

  await tracker.save();

  // De-identified corpus event — NO identity fields (ADR-005)
  const pseudoActorId = Buffer.from(input.actorId).toString("base64");
  await CorpusEvent.create({
    eventKind: "tracker_recorded",
    pseudoActorId,
    occurredAt: new Date(),
    meta: {
      trackerId: tracker._id.toString(),
      trackerKind: tracker.trackerKind,
      pseudoStudentId,
      setId: tracker.setId.toString(),
    },
  });

  return {
    trackerId: tracker._id.toString(),
    pseudoStudentId,
    entryCount: tracker.entries.length,
  };
}

// ---------------------------------------------------------------------------
// closeTracker
// ---------------------------------------------------------------------------

export interface CloseTrackerResult {
  trackerId: string;
  status: string;
  closedAt: string;
}

export async function closeTracker(trackerId: string): Promise<CloseTrackerResult> {
  const tracker = await TrackerRecord.findById(trackerId);
  if (!tracker) throw new Error("TrackerRecord not found");
  if (tracker.status === "closed") throw new Error("Tracker is already closed");

  const now = new Date();
  tracker.status = "closed";
  tracker.closedAt = now;
  await tracker.save();

  return {
    trackerId: tracker._id.toString(),
    status: "closed",
    closedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// listTrackers
// ---------------------------------------------------------------------------

export interface ListTrackersInput {
  sectionId: string;
  trackerKind?: TrackerKind;
  setId?: string;
  status?: string;
}

export async function listTrackers(input: ListTrackersInput) {
  const filter: Record<string, unknown> = { sectionId: input.sectionId };
  if (input.trackerKind) filter.trackerKind = input.trackerKind;
  if (input.setId) filter.setId = input.setId;
  if (input.status) filter.status = input.status;
  return TrackerRecord.find(filter).sort({ createdAt: -1 }).lean();
}

// ---------------------------------------------------------------------------
// getTrackerSummary
// ---------------------------------------------------------------------------

export interface TrackerSummaryResult {
  trackerId: string;
  trackerKind: TrackerKind;
  totalEntries: number;
  submittedCount: number;
  completeCount: number;
  averageScore: number | null;
}

export async function getTrackerSummary(trackerId: string): Promise<TrackerSummaryResult> {
  const tracker = await TrackerRecord.findById(trackerId).lean();
  if (!tracker) throw new Error("TrackerRecord not found");

  const entries = tracker.entries;
  const totalEntries = entries.length;
  const submittedCount = entries.filter((e) => e.submitted === true).length;
  const completeCount = entries.filter((e) => e.complete === true).length;

  const scored = entries.filter((e) => typeof e.score === "number");
  const averageScore =
    scored.length > 0
      ? scored.reduce((sum, e) => sum + (e.score ?? 0), 0) / scored.length
      : null;

  return {
    trackerId,
    trackerKind: tracker.trackerKind,
    totalEntries,
    submittedCount,
    completeCount,
    averageScore,
  };
}

// ---------------------------------------------------------------------------
// buildNonSubmitterLink — pure function, no HTTP endpoint (J4.2, ADR-003)
// ---------------------------------------------------------------------------

/**
 * Returns a wa.me deep link pre-filled with a Bangla non-submission message.
 * No server dispatch — teacher copies and sends manually (ADR-003, R-T2).
 */
export async function buildNonSubmitterLink(
  guardianPhone: string,
  studentName: string,
  setTitle: string,
): Promise<string> {
  const phone = guardianPhone.replace(/[\s\-\(\)]/g, "");
  const msg = await renderTemplate("tracker.nonSubmitter.wa", { studentName, setTitle });
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}
