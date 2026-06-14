/**
 * ParentMeetingService (CM-3, prd-comments-meetings §3/§6, D-#123) — the parents'
 * meeting + its per-family slots: create, generate, reorder, On-Call, admin reads.
 * NO dispatch / no attendance-set / no MeetingComment — those are CM-4 / CM-5.
 *
 *   createParentMeeting — admin creates a meeting in `draft` (academicYear default =
 *                         current; instanceLabel + date + slotMinutes + dayStart +
 *                         includeScope); audited PARENT_MEETING_CREATED.
 *   generateSlots       — over the ACTIVE students in `includeScope`, group by
 *                         `Student.phone` → one slot per family (siblings collapsed,
 *                         J-CM3), default order class→section→name, sequential timed
 *                         slots from dayStart. WHOLESALE / idempotent (delete + relay,
 *                         the setVocabTestPositions posture); DRAFT-ONLY (D-#175);
 *                         audited PARENT_MEETING_SLOTS_GENERATED.
 *   setSlotOnCall       — flag a family On-Call (J-CM4: null time) + re-time the rest.
 *   reorderSlots        — admin reorder; the new order drives the slot times.
 *   reads               — the meeting + its slots, for the Office.
 *
 * Role RBAC (`roster:manage`, the D-#94 admin gate) is enforced by the RESOLVER —
 * this service trusts the actor. Identity-plane (slots name studentIds + the family
 * phone); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { ParentMeeting, type IParentMeeting, type ParentMeetingStatus } from "../models/ParentMeeting";
import { ParentMeetingSlot, type IParentMeetingSlot } from "../models/ParentMeetingSlot";
import { Student } from "../../foundation/models/Student";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { writeAudit } from "../../platform/services/AuditService";

/** A surfaced service error (Bangla-friendly message), mirroring the tracker pattern. */
export class ParentMeetingError extends Error {}

// ===========================================================================
// Shapes
// ===========================================================================

export interface ParentMeetingShape {
  id: string;
  academicYearId: string;
  instanceLabel: string;
  meetingDate: string;
  slotMinutes: number;
  dayStartMinutes: number;
  status: ParentMeetingStatus;
  includeClassIds: string[];
  includeSectionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ParentMeetingSlotShape {
  id: string;
  meetingId: string;
  familyKey: string;
  studentIds: string[];
  classLabels: string[];
  order: number;
  slotTime: number | null;
  onCall: boolean;
  dispatchedAt: string | null;
  attended: boolean | null;
  attendanceRemark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateSlotsResult {
  meetingId: string;
  slots: ParentMeetingSlotShape[];
  /** Distinct families (= slots) created. */
  familyCount: number;
  /** Families with a real phone (groupable + later dispatchable). */
  reachableCount: number;
  /** Phone-less single-student families (D-#174 — counted, never dropped). */
  unreachableCount: number;
}

function meetingShape(d: IParentMeeting): ParentMeetingShape {
  return {
    id: d._id.toString(),
    academicYearId: d.academicYearId.toString(),
    instanceLabel: d.instanceLabel,
    meetingDate: new Date(d.meetingDate).toISOString(),
    slotMinutes: d.slotMinutes,
    dayStartMinutes: d.dayStartMinutes,
    status: d.status,
    includeClassIds: (d.includeScope?.classIds ?? []).map((x) => x.toString()),
    includeSectionIds: (d.includeScope?.sectionIds ?? []).map((x) => x.toString()),
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}

function slotShape(d: IParentMeetingSlot): ParentMeetingSlotShape {
  return {
    id: d._id.toString(),
    meetingId: d.meetingId.toString(),
    familyKey: d.familyKey,
    studentIds: (d.studentIds ?? []).map((x) => x.toString()),
    classLabels: d.classLabels ?? [],
    order: d.order,
    slotTime: d.slotTime ?? null,
    onCall: !!d.onCall,
    dispatchedAt: d.dispatchedAt ? new Date(d.dispatchedAt).toISOString() : null,
    attended: d.attended ?? null,
    attendanceRemark: d.attendanceRemark ?? null,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}

// ===========================================================================
// Pure helpers (no DB/clock — unit-tested directly)
// ===========================================================================

/** A student flattened for slot grouping (the join of Student × Class × Section). */
export interface StudentForSlot {
  id: string;
  name: string;
  phone?: string | null;
  classLevel: number;
  classLabel: string;
  sectionCode: string;
}

export interface FamilyGroup {
  familyKey: string;
  studentIds: string[];
  classLabels: string[];
  hasPhone: boolean;
}

/** Phone → grouping key: digits-only (mirrors the wa.me builder). Empty ⇒ phone-less. */
function normalizePhone(phone: string | undefined | null): string {
  return (phone ?? "").replace(/\D/g, "");
}

function studentSortKey(s: StudentForSlot): [number, string, string] {
  return [s.classLevel, s.sectionCode, s.name];
}

function cmpKey(a: [number, string, string], b: [number, string, string]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
  return 0;
}

/**
 * Group active students into families by `Student.phone` (J-CM3 sibling collapse).
 * Phone-less students each become their own single-student family under a synthetic
 * `nophone:<id>` key (D-#174). Within a family, children sort class→section→name and
 * `classLabels` runs parallel to `studentIds`. Families sort by their lead (lowest)
 * child class→section→name (the default order, D-#123). Pure — no DB.
 */
export function groupFamilies(students: StudentForSlot[]): FamilyGroup[] {
  const byKey = new Map<string, StudentForSlot[]>();
  for (const s of students) {
    const digits = normalizePhone(s.phone);
    const key = digits ? digits : `nophone:${s.id}`;
    const arr = byKey.get(key) ?? [];
    arr.push(s);
    byKey.set(key, arr);
  }

  const families: { group: FamilyGroup; lead: [number, string, string] }[] = [];
  for (const [key, members] of byKey) {
    members.sort((a, b) => cmpKey(studentSortKey(a), studentSortKey(b)));
    families.push({
      group: {
        familyKey: key,
        studentIds: members.map((m) => m.id),
        classLabels: members.map((m) => m.classLabel),
        hasPhone: !key.startsWith("nophone:"),
      },
      lead: studentSortKey(members[0]),
    });
  }

  families.sort((a, b) => cmpKey(a.lead, b.lead));
  return families.map((f) => f.group);
}

/**
 * Assign sequential slot times to slots **already sorted by `order`**: timed slots
 * get `dayStartMinutes + i*slotMinutes` (i increments over timed slots only), On-Call
 * slots get null. Pure — the order drives the times (D-#123). Returns the times
 * parallel to the input.
 */
export function assignSlotTimes(
  slots: { onCall: boolean }[],
  dayStartMinutes: number,
  slotMinutes: number,
): (number | null)[] {
  let i = 0;
  return slots.map((s) => {
    if (s.onCall) return null;
    const t = dayStartMinutes + i * slotMinutes;
    i += 1;
    return t;
  });
}

// ===========================================================================
// createParentMeeting
// ===========================================================================

export interface CreateParentMeetingInput {
  academicYearId?: string;
  instanceLabel: string;
  meetingDate: string | Date;
  slotMinutes: number;
  dayStartMinutes: number;
  includeClassIds?: string[];
  includeSectionIds?: string[];
  actorId: string;
}

function toObjectIds(ids: string[] | undefined, label: string): Types.ObjectId[] {
  if (!ids || ids.length === 0) return [];
  return ids.map((id) => {
    if (!Types.ObjectId.isValid(id)) throw new ParentMeetingError(`Invalid ${label} id`);
    return new Types.ObjectId(id);
  });
}

export async function createParentMeeting(input: CreateParentMeetingInput): Promise<ParentMeetingShape> {
  const instanceLabel = (input.instanceLabel ?? "").trim();
  if (!instanceLabel) throw new ParentMeetingError("Meeting label is required");

  const meetingDate = new Date(input.meetingDate);
  if (Number.isNaN(meetingDate.getTime())) throw new ParentMeetingError("Invalid meeting date");

  if (!Number.isFinite(input.slotMinutes) || input.slotMinutes < 1) {
    throw new ParentMeetingError("slotMinutes must be at least 1");
  }
  if (!Number.isFinite(input.dayStartMinutes) || input.dayStartMinutes < 0 || input.dayStartMinutes > 24 * 60 - 1) {
    throw new ParentMeetingError("dayStartMinutes must be between 0 and 1439");
  }

  // Resolve the academic year (default = the current one) server-side.
  let academicYearId = input.academicYearId;
  if (academicYearId) {
    if (!Types.ObjectId.isValid(academicYearId)) throw new ParentMeetingError("Invalid academic year id");
  } else {
    const current = (await AcademicYear.findOne({ current: true }).select("_id").lean()) as
      | { _id: Types.ObjectId }
      | null;
    if (!current) throw new ParentMeetingError("No current academic year is set");
    academicYearId = current._id.toString();
  }

  const doc = await ParentMeeting.create({
    academicYearId: new Types.ObjectId(academicYearId),
    instanceLabel,
    meetingDate,
    slotMinutes: input.slotMinutes,
    dayStartMinutes: input.dayStartMinutes,
    status: "draft",
    includeScope: {
      classIds: toObjectIds(input.includeClassIds, "class"),
      sectionIds: toObjectIds(input.includeSectionIds, "section"),
    },
  });

  await writeAudit({
    eventKind: "PARENT_MEETING_CREATED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ParentMeeting",
    meta: { instanceLabel, academicYearId },
  });

  return meetingShape(doc);
}

// ===========================================================================
// generateSlots (wholesale / idempotent; DRAFT-only, D-#175)
// ===========================================================================

async function loadMeetingOrThrow(meetingId: string): Promise<IParentMeeting> {
  if (!Types.ObjectId.isValid(meetingId)) throw new ParentMeetingError("Invalid meeting id");
  const meeting = (await ParentMeeting.findById(meetingId)) as IParentMeeting | null;
  if (!meeting) throw new ParentMeetingError("Meeting not found");
  return meeting;
}

/** The active students in a meeting's includeScope, flattened for grouping. */
async function studentsInScope(meeting: IParentMeeting): Promise<StudentForSlot[]> {
  const classIds = meeting.includeScope?.classIds ?? [];
  const sectionIds = meeting.includeScope?.sectionIds ?? [];

  const filter: Record<string, unknown> = { active: true };
  if (classIds.length || sectionIds.length) {
    const or: Record<string, unknown>[] = [];
    if (sectionIds.length) or.push({ sectionId: { $in: sectionIds } });
    if (classIds.length) or.push({ classId: { $in: classIds } });
    filter.$or = or;
  }

  const students = (await Student.find(filter)
    .select("name phone classId sectionId")
    .lean()) as unknown as {
    _id: Types.ObjectId;
    name: string;
    phone?: string;
    classId: Types.ObjectId;
    sectionId: Types.ObjectId;
  }[];

  // Batch-load the class labels (level + nameBn) and section codes (no per-student query).
  const classOids = [...new Set(students.map((s) => s.classId.toString()))].map((x) => new Types.ObjectId(x));
  const sectionOids = [...new Set(students.map((s) => s.sectionId.toString()))].map((x) => new Types.ObjectId(x));
  const classes = (await Class.find({ _id: { $in: classOids } })
    .select("level nameBn")
    .lean()) as unknown as { _id: Types.ObjectId; level: number; nameBn: string }[];
  const sections = (await Section.find({ _id: { $in: sectionOids } })
    .select("code")
    .lean()) as unknown as { _id: Types.ObjectId; code: string }[];
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));
  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));

  return students.map((s) => {
    const cls = classById.get(s.classId.toString());
    const sec = sectionById.get(s.sectionId.toString());
    return {
      id: s._id.toString(),
      name: s.name,
      phone: s.phone,
      classLevel: cls?.level ?? 0,
      classLabel: cls?.nameBn ?? "",
      sectionCode: sec?.code ?? "",
    };
  });
}

export async function generateSlots(meetingId: string, actorId: string): Promise<GenerateSlotsResult> {
  const meeting = await loadMeetingOrThrow(meetingId);
  // Wholesale rebuild is only safe before dispatch/attendance — DRAFT-only (D-#175).
  if (meeting.status !== "draft") {
    throw new ParentMeetingError("Slots can only be generated while the meeting is a draft");
  }

  const students = await studentsInScope(meeting);
  const families = groupFamilies(students);
  // Fresh generation: every family is timed (On-Call is an admin flag applied after).
  const times = assignSlotTimes(
    families.map(() => ({ onCall: false })),
    meeting.dayStartMinutes,
    meeting.slotMinutes,
  );

  // Wholesale replace (the setVocabTestPositions posture) — delete then relay.
  await ParentMeetingSlot.deleteMany({ meetingId: meeting._id });

  const docs =
    families.length > 0
      ? ((await ParentMeetingSlot.insertMany(
          families.map((f, idx) => ({
            meetingId: meeting._id,
            familyKey: f.familyKey,
            studentIds: f.studentIds.map((id) => new Types.ObjectId(id)),
            classLabels: f.classLabels,
            order: idx,
            slotTime: times[idx],
            onCall: false,
          })),
        )) as unknown as IParentMeetingSlot[])
      : [];

  const reachableCount = families.filter((f) => f.hasPhone).length;
  const unreachableCount = families.length - reachableCount;

  await writeAudit({
    eventKind: "PARENT_MEETING_SLOTS_GENERATED",
    actorId,
    targetId: meeting._id,
    targetKind: "ParentMeeting",
    meta: { familyCount: families.length, reachableCount, unreachableCount },
  });

  return {
    meetingId: meeting._id.toString(),
    slots: docs.map(slotShape),
    familyCount: families.length,
    reachableCount,
    unreachableCount,
  };
}

// ===========================================================================
// re-time helper (shared by setSlotOnCall + reorderSlots)
// ===========================================================================

/** Re-time a meeting's slots from their current order + On-Call flags, persist, return. */
async function retimeAndReturn(meeting: IParentMeeting): Promise<ParentMeetingSlotShape[]> {
  const slots = (await ParentMeetingSlot.find({ meetingId: meeting._id })
    .sort({ order: 1 })
    .exec()) as IParentMeetingSlot[];
  const times = assignSlotTimes(
    slots.map((s) => ({ onCall: !!s.onCall })),
    meeting.dayStartMinutes,
    meeting.slotMinutes,
  );
  for (let i = 0; i < slots.length; i++) {
    slots[i].slotTime = times[i];
    await slots[i].save();
  }
  return slots.map(slotShape);
}

// ===========================================================================
// setSlotOnCall (J-CM4)
// ===========================================================================

export async function setSlotOnCall(
  slotId: string,
  onCall: boolean,
  actorId: string,
): Promise<ParentMeetingSlotShape[]> {
  if (!Types.ObjectId.isValid(slotId)) throw new ParentMeetingError("Invalid slot id");
  const slot = (await ParentMeetingSlot.findById(slotId)) as IParentMeetingSlot | null;
  if (!slot) throw new ParentMeetingError("Slot not found");

  const meeting = await loadMeetingOrThrow(slot.meetingId.toString());
  if (meeting.status !== "draft") {
    throw new ParentMeetingError("Slots can only be edited while the meeting is a draft");
  }

  slot.onCall = !!onCall;
  if (slot.onCall) slot.slotTime = null;
  await slot.save();

  const slots = await retimeAndReturn(meeting);

  await writeAudit({
    eventKind: "PARENT_MEETING_SLOTS_REORDERED",
    actorId,
    targetId: meeting._id,
    targetKind: "ParentMeeting",
    meta: { slotId, onCall: slot.onCall, action: "setOnCall" },
  });

  return slots;
}

// ===========================================================================
// reorderSlots (the order drives the times)
// ===========================================================================

export async function reorderSlots(
  meetingId: string,
  slotIds: string[],
  actorId: string,
): Promise<ParentMeetingSlotShape[]> {
  const meeting = await loadMeetingOrThrow(meetingId);
  if (meeting.status !== "draft") {
    throw new ParentMeetingError("Slots can only be reordered while the meeting is a draft");
  }

  const existing = (await ParentMeetingSlot.find({ meetingId: meeting._id })
    .select("_id")
    .lean()) as unknown as { _id: Types.ObjectId }[];
  const existingIds = existing.map((s) => s._id.toString()).sort();
  const givenIds = [...slotIds].sort();
  if (existingIds.length !== givenIds.length || existingIds.some((id, i) => id !== givenIds[i])) {
    throw new ParentMeetingError("The reorder list must be exactly the meeting's slots");
  }

  // Apply the new order (index in the provided list), then re-time.
  for (let i = 0; i < slotIds.length; i++) {
    await ParentMeetingSlot.updateOne({ _id: new Types.ObjectId(slotIds[i]) }, { $set: { order: i } });
  }

  const slots = await retimeAndReturn(meeting);

  await writeAudit({
    eventKind: "PARENT_MEETING_SLOTS_REORDERED",
    actorId,
    targetId: meeting._id,
    targetKind: "ParentMeeting",
    meta: { count: slotIds.length, action: "reorder" },
  });

  return slots;
}

// ===========================================================================
// Admin reads
// ===========================================================================

export async function listParentMeetings(academicYearId?: string): Promise<ParentMeetingShape[]> {
  const filter: Record<string, unknown> = {};
  if (academicYearId) {
    if (!Types.ObjectId.isValid(academicYearId)) throw new ParentMeetingError("Invalid academic year id");
    filter.academicYearId = new Types.ObjectId(academicYearId);
  }
  const docs = (await ParentMeeting.find(filter).sort({ meetingDate: -1 }).lean()) as unknown as IParentMeeting[];
  return docs.map(meetingShape);
}

export async function getParentMeeting(meetingId: string): Promise<ParentMeetingShape> {
  const meeting = await loadMeetingOrThrow(meetingId);
  return meetingShape(meeting);
}

export async function listMeetingSlots(meetingId: string): Promise<ParentMeetingSlotShape[]> {
  if (!Types.ObjectId.isValid(meetingId)) throw new ParentMeetingError("Invalid meeting id");
  const docs = (await ParentMeetingSlot.find({ meetingId: new Types.ObjectId(meetingId) })
    .sort({ order: 1 })
    .lean()) as unknown as IParentMeetingSlot[];
  return docs.map(slotShape);
}
