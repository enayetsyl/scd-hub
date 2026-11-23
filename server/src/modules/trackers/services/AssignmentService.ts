/**
 * AssignmentService (AS-T2, D-#85/D-#86) — delivery + collection lifecycle on
 * the SHARED engine (trackers/lifecycle.ts, D-#37 — its second consumer).
 *
 *   generateAsId            — atomic AS-{CLASS}-{SUBJECT}-{nnnn} (D-#34 pattern;
 *                             CLASS is C1..C5 / CK / CN — see `classToken`)
 *   deliverAssignmentItem   — materialize a schedule entry for a week (item) +
 *                             spawn per-student records: present → GIVEN,
 *                             absent → ABSENT_REDELIVER. Dates resolved
 *                             server-side per §4 — never client-supplied.
 *   redeliverAssignmentRecord — ABSENT_REDELIVER → GIVEN (the engine edge);
 *                             keeps the ITEM's due date (assignment due is
 *                             item-wide, unlike homework's next-school-day).
 *   collectAssignment       — the due-date pass: submitted → SUBMITTED,
 *                             non-submitted past due → CHASE (via DUE).
 *   sweepAssignmentChases   — every DUE record past its due date → CHASE.
 *   transitionAssignmentRecord — one legal engine transition (RETURNED etc.).
 *   assignmentItemCounts    — DERIVED #delivered/#notReceived/#submitted/
 *                             #missing + the missing-student list (PRD §1 —
 *                             counts are never typed).
 *
 * Write-scope (assertCanWrite) is enforced by the resolver, not here.
 */
import type { LifecycleState, HwSubject } from "@scd/shared";
import { acceptClaimsForRecords, hasOpenClaim } from "./WorkClaimService";
import { emitAssignmentFirstChase, emitWorkClaimResolved } from "../../notifications/services/emitters";
import { recordMarkCorrection, sameDayPersonChase } from "./MarkCorrectionService";
import { classToken } from "@scd/shared";
import { weeklyCeilingMinutes } from "../assignmentCeiling";
import { isLoop2027On } from "../../assessment/services/QuestionUseService";
import { SECOND_ASSIGNMENT_MESSAGE } from "../../mastery/assignmentBudget";
import { Types } from "mongoose";
import { StoredFile } from "../../platform/models/StoredFile";
import { AssignmentItem, type IAssignmentItem } from "../models/AssignmentItem";
import { AssignmentNilDeclaration } from "../models/AssignmentNilDeclaration";
import {
  AssignmentStudentRecord,
  type IAssignmentStudentRecord,
} from "../models/AssignmentStudentRecord";
import { AssignmentSequence } from "../models/AssignmentSequence";
import { nextYearSeq, createWithYearId } from "../../../lib/yearSequence";
import { AssignmentSchedule } from "../models/AssignmentSchedule";
import { Student } from "../../foundation/models/Student";
import { resolveScheduleWeek } from "./AssignmentScheduleService";
import { assertTransition } from "../lifecycle";
import { atMidnight, dateOnlyISO } from "../assignmentCalendar";
import { writeAudit } from "../../platform/services/AuditService";
import { isRehomed, resolveRecordOwners } from "../recordOwner";
import { recordPlaceMistake } from "../../staff-mistakes/services/StaffMistakeNoteService";
import { recordAbsentAtDelivery } from "./deliveryAttendanceCheck";
import { dateKeyOf } from "../../attendance/dates";
import { isPausedNow, loadPausePredicate } from "../../academic-pause/services/AcademicPauseService";

// ---------------------------------------------------------------------------
// AS_ID generation (D-#34 numbering pattern)
// ---------------------------------------------------------------------------

export async function generateAsId(
  academicYearId: string,
  classLevel: number,
  subject: HwSubject,
): Promise<string> {
  const seq = await nextYearSeq(AssignmentSequence, academicYearId, { classLevel, subject });
  const n = String(seq).padStart(4, "0");
  return `AS-${classToken(classLevel)}-${subject}-${n}`;
}

// ---------------------------------------------------------------------------
// deliverAssignmentItem (the Thursday pass, AJ-3)
// ---------------------------------------------------------------------------

export interface DeliveryRosterEntry {
  studentId: string;
  /** Present at delivery → GIVEN; absent → ABSENT_REDELIVER (engine entry states). */
  present: boolean;
}

export interface DeliverAssignmentInput {
  academicYearId: string;
  weekNumber: number;
  /** The rotation-entry subdocument id on AssignmentSchedule.entries. */
  entryId: string;
  /** The section the caller's write-scope was asserted against (resolver) —
   *  must match the entry's section, so scope can't be asserted on one
   *  section while delivering to another. */
  sectionId?: string;
  roster: DeliveryRosterEntry[];
  /** Optional link to an assembled AS set (D-#88). */
  setId?: string;
  /** Teacher-set marks ceiling for checking (D-#87). */
  totalMarks?: number;
  /** D-#478: the brief "what is the assignment" — required, non-blank. */
  description?: string;
  /** AS-T6 (D-#274): declared minutes for the weekly load ceiling. Default 20. */
  estMinutes?: number;
  /** Assignment sheet/instruction StoredFile ids (≤5, assignment_attachment, D-#298). */
  attachmentIds?: string[];
  actorId: string;
  at?: Date;
}

export const AS_MAX_ATTACHMENTS = 5;

/** D-#713: an assignment is handed out WITH its sheet — at least one attachment is
 *  required at delivery, and an edit may replace the files but never clear them.
 *  Bangla, because a teacher sees it on the delivery form. */
export const AS_ATTACHMENT_REQUIRED =
  "অন্তত একটি ফাইল যুক্ত করুন — অ্যাসাইনমেন্টের শিট বা নির্দেশনা ছাড়া দেওয়া যাবে না";

/** Validate delivery-pass attachments: ≤5 valid ObjectIds, every one an existing
 *  StoredFile of kind assignment_attachment — anything else (an hw_answer, a chat
 *  file) must never become class-readable through the item's read gate (D-#298). */
async function normalizeAttachmentIds(ids: string[] | undefined): Promise<Types.ObjectId[] | undefined> {
  if (!ids || ids.length === 0) return undefined;
  if (ids.length > AS_MAX_ATTACHMENTS) {
    throw new Error(`At most ${AS_MAX_ATTACHMENTS} attachments per assignment`);
  }
  if (ids.some((id) => !Types.ObjectId.isValid(id))) {
    throw new Error("Invalid attachment file id");
  }
  const found = await StoredFile.find({ _id: { $in: ids }, kind: "assignment_attachment" })
    .select("_id")
    .lean();
  if (found.length !== new Set(ids.map(String)).size) {
    throw new Error("Every attachment must be an uploaded assignment file");
  }
  return ids.map((id) => new Types.ObjectId(id));
}

export interface DeliverAssignmentResult {
  itemId: string;
  asId: string;
  weekNumber: number;
  subject: HwSubject;
  deliveryDate: string;
  dueDate: string;
  /** AS-T6: the item is DRAFT until the section's week is confirmed under the cap. */
  status: "DRAFT" | "ISSUED";
  estMinutes: number;
  /** Roster tallies (from draftRoster — records spawn only at confirmAssignmentWeek). */
  presentCount: number;
  absentCount: number;
  /** AL-6 (switch on): the item was delivered but its question sheet (AS paper) could not be made — Bangla reason. */
  paperWarning?: string;
}

export async function deliverAssignmentItem(
  input: DeliverAssignmentInput,
): Promise<DeliverAssignmentResult> {
  const schedule = await AssignmentSchedule.findOne({ academicYearId: input.academicYearId });
  if (!schedule) {
    throw new Error("No AssignmentSchedule for this academic year — set the term anchor first");
  }
  const entry = schedule.entries.id(input.entryId);
  if (!entry) throw new Error("Schedule entry not found in this year's rotation");
  if (input.sectionId && entry.sectionId.toString() !== input.sectionId) {
    throw new Error("sectionId does not match the schedule entry's section");
  }

  const resolved = await resolveScheduleWeek(schedule, input.weekNumber);
  if (resolved.cycleWeek !== entry.cycleWeek) {
    throw new Error(
      `Week ${input.weekNumber} is cycle week ${resolved.cycleWeek}, but this entry belongs to cycle week ${entry.cycleWeek}`,
    );
  }
  if (resolved.suspended || !resolved.deliveryDate || !resolved.dueDate) {
    throw new Error(
      `Week ${input.weekNumber} is suspended (no open day in its window, §4 rule 3) — no assignment is expected`,
    );
  }

  const existing = await AssignmentItem.findOne({
    academicYearId: input.academicYearId,
    weekNumber: input.weekNumber,
    sectionId: entry.sectionId,
    subject: entry.subject,
  }).lean();
  const loop2027 = await isLoop2027On();
  if (existing) {
    // AL-6 / AC-C12 (switch on): a second assignment for the cell points the teacher to the extra homework.
    throw new Error(loop2027 ? SECOND_ASSIGNMENT_MESSAGE : `Week ${input.weekNumber} ${entry.subject} for this section is already delivered`);
  }

  if (!Array.isArray(input.roster) || input.roster.length === 0) {
    throw new Error("The delivery pass needs the section roster (per-student GIVEN/ABSENT_REDELIVER)");
  }
  // D-#725: the roster must be THIS section's active children, once each. The client
  // builds it from studentsInSection, but confirmAssignmentWeek stamps every roster
  // child with the item's section — so a stale app or a script sending the whole C4
  // would hand বালিকা records to a বালক item, invisible to the বালিকা workspace.
  const rosterIds = input.roster.map((r) => r.studentId);
  if (new Set(rosterIds).size !== rosterIds.length) {
    throw new Error("রোস্টারে একই শিক্ষার্থী দুবার আছে");
  }
  if (!rosterIds.every((id) => Types.ObjectId.isValid(id))) throw new Error("Invalid studentId in the roster");
  const inSection = await Student.countDocuments({
    _id: { $in: rosterIds.map((id) => new Types.ObjectId(id)) },
    sectionId: entry.sectionId,
    active: true,
  });
  if (inSection !== rosterIds.length) {
    throw new Error("রোস্টারে এমন শিক্ষার্থী আছে যে এই শাখার নয় — পাতাটি রিফ্রেশ করে আবার দিন");
  }
  if (input.totalMarks !== undefined && (!Number.isInteger(input.totalMarks) || input.totalMarks < 1)) {
    throw new Error("totalMarks must be a positive integer");
  }
  const estMinutes = input.estMinutes ?? 20;
  if (!Number.isInteger(estMinutes) || estMinutes < 0) {
    throw new Error("estMinutes must be a non-negative integer");
  }
  // D-#478: the one line the family reads. Enforced HERE, not only at the resolver,
  // so every caller path (scripts, future composites) writes an item a guardian can
  // actually read. Bangla, because a teacher sees it on the delivery form.
  const description = input.description?.trim();
  if (!description) {
    throw new Error("অ্যাসাইনমেন্টে কী করতে হবে তা লিখুন — অভিভাবক এটিই দেখেন");
  }

  // Guard the optional question-set link. setId is free-text on the delivery
  // form; a non-id value (prod incident: a teacher typed the label word into
  // the box) must be rejected here, else AssignmentItem.create below casts it
  // to an ObjectId and throws a raw BSONError. Empty → no link.
  const setIdRaw = input.setId?.trim();
  const setId = setIdRaw === undefined || setIdRaw === "" ? undefined : setIdRaw;
  if (setId !== undefined && !Types.ObjectId.isValid(setId)) {
    throw new Error("Question-set id must be a valid id — leave it blank if there is no set");
  }

  const attachmentIds = await normalizeAttachmentIds(input.attachmentIds);
  // D-#713: enforced HERE, like the D-#478 description, so every caller path
  // (the period-card block, the full screen, scripts) delivers with a file.
  if (!attachmentIds) throw new Error(AS_ATTACHMENT_REQUIRED);

  const at = input.at ?? new Date();
  const asId = await generateAsId(input.academicYearId, entry.classLevel, entry.subject);

  // AS-T6 (D-#274): deliver DRAFTS the item — the present/absent roster is stored on
  // the item; per-student records are NOT spawned here. confirmAssignmentWeek issues
  // them once the section's weekly estMinutes sum is confirmed under the ceiling.
  const item = await createWithYearId({
    idField: "asId",
    seqModel: AssignmentSequence,
    academicYearId: input.academicYearId,
    key: { classLevel: entry.classLevel, subject: entry.subject },
    firstId: asId,
    makeId: () => generateAsId(input.academicYearId, entry.classLevel, entry.subject),
    create: (id) => AssignmentItem.create({
    asId: id,
    academicYearId: input.academicYearId,
    scheduleEntryId: entry._id,
    weekNumber: input.weekNumber,
    cycleWeek: entry.cycleWeek,
    classId: entry.classId,
    classLevel: entry.classLevel,
    sectionId: entry.sectionId,
    subject: entry.subject,
    teacherId: entry.teacherId,
    deliveryDate: resolved.deliveryDate,
    dueDate: resolved.dueDate,
    setId,
    totalMarks: input.totalMarks,
    description,
    estMinutes,
    status: "DRAFT",
    draftRoster: input.roster.map((r) => ({ studentId: r.studentId, present: r.present })),
    deliveredBy: input.actorId,
    deliveredAt: at,
    attachmentIds,
  }),
  });
  await AssignmentNilDeclaration.deleteOne({
    academicYearId: input.academicYearId,
    weekNumber: input.weekNumber,
    sectionId: entry.sectionId,
    subject: entry.subject,
  });
  // AL-6 (switch on): the item's AS paper — a tailored paper already sent for the week is linked, else one is made from
  // the item's question set. The delivery itself never fails on it (the item exists; the paper can be re-synced on edit).
  let paperWarning: string | undefined;
  if (loop2027) {
    try {
      await (await import("../../mastery/services/AssignmentPaperService")).onAssignmentItemDelivered(item, input.actorId);
    } catch (err) {
      // The delivery stands; the failure is reported to Sentry AND shown to the teacher (the app shows `paperWarning`).
      const { reportSilentFailure, reasonBn } = await import("../../../lib/reportError");
      await reportSilentFailure("assignment.asPaperAtDelivery", err, { itemId: String(item._id) });
      paperWarning = `প্রশ্নভিত্তিক শিট তৈরি হয়নি: ${reasonBn(err)}`;
    }
  }

  return {
    itemId: item._id.toString(),
    asId: item.asId,
    weekNumber: input.weekNumber,
    subject: entry.subject,
    deliveryDate: dateOnlyISO(item.deliveryDate),
    dueDate: dateOnlyISO(item.dueDate),
    status: "DRAFT",
    estMinutes,
    presentCount: input.roster.filter((r) => r.present).length,
    absentCount: input.roster.filter((r) => !r.present).length,
    ...(paperWarning ? { paperWarning } : {}),
  };
}

// ---------------------------------------------------------------------------
// System delivery of a TAILORED weekly assignment (AL-7, docs/prd-academic-loop-2027.md §4.6)
// ---------------------------------------------------------------------------

export interface SystemDeliveryInput {
  academicYearId: string;
  weekNumber: number;
  /** The rotation entry whose class / cycle / schedule ids the item takes: the subject's own cell, or — for a swapped-in
   *  subject (§4.5) — the DROPPED subject's cell (the rotation table is unchanged). */
  entryId: string;
  /** The item's subject: the assignment's own (the swapped-in subject differs from the entry's). */
  subject: HwSubject;
  /** The subject teacher: the entry's teacher, or the routine slot holder for a swapped-in subject. */
  teacherId: string;
  roster: DeliveryRosterEntry[];
  estMinutes: number;
  doOnDay?: "FRI" | "SAT" | "BOTH";
  minutesByDay?: { FRI: number; SAT: number };
  description: string;
  actorId: string;
  at?: Date;
}

/**
 * The SYSTEM delivery of a SENT tailored assignment's tracker item (release switch ON, Class 1–5; the caller checks). It is
 * the twin of `deliverAssignmentItem` for a week the subject teacher already finalised: the item is DRAFT with the counted
 * minutes and the Friday / Saturday split, the roster comes from the delivery-day attendance, and the D-#839 sweep then
 * issues the week as usual.
 *
 * NO attachment is required here — a lead-approved exception to D-#713 ("an assignment is handed out WITH its sheet"): for a
 * tailored week the AS paper (the per-child printed sheet) IS the sheet. Returns null when the cell already has an item.
 */
export async function deliverSystemAssignmentItem(input: SystemDeliveryInput): Promise<IAssignmentItem | null> {
  const schedule = await AssignmentSchedule.findOne({ academicYearId: input.academicYearId });
  if (!schedule) throw new Error("No AssignmentSchedule for this academic year — set the term anchor first");
  const entry = schedule.entries.id(input.entryId);
  if (!entry) throw new Error("Schedule entry not found in this year's rotation");
  const resolved = await resolveScheduleWeek(schedule, input.weekNumber);
  if (resolved.suspended || !resolved.deliveryDate || !resolved.dueDate) throw new Error(`Week ${input.weekNumber} is suspended — no assignment is expected`);
  const existing = await AssignmentItem.findOne({ academicYearId: input.academicYearId, weekNumber: input.weekNumber, sectionId: entry.sectionId, subject: input.subject }).lean();
  if (existing) return null;
  const at = input.at ?? new Date();
  const item = await createWithYearId({
    idField: "asId",
    seqModel: AssignmentSequence,
    academicYearId: input.academicYearId,
    key: { classLevel: entry.classLevel, subject: input.subject },
    firstId: await generateAsId(input.academicYearId, entry.classLevel, input.subject),
    makeId: () => generateAsId(input.academicYearId, entry.classLevel, input.subject),
    create: (id) =>
      AssignmentItem.create({
        asId: id,
        academicYearId: input.academicYearId,
        scheduleEntryId: entry._id,
        weekNumber: input.weekNumber,
        cycleWeek: entry.cycleWeek,
        classId: entry.classId,
        classLevel: entry.classLevel,
        sectionId: entry.sectionId,
        subject: input.subject,
        teacherId: input.teacherId,
        deliveryDate: resolved.deliveryDate,
        dueDate: resolved.dueDate,
        description: input.description,
        estMinutes: input.estMinutes,
        status: "DRAFT",
        ...(input.doOnDay ? { doOnDay: input.doOnDay } : {}),
        ...(input.minutesByDay ? { minutesByDay: input.minutesByDay } : {}),
        draftRoster: input.roster.map((r) => ({ studentId: r.studentId, present: r.present })),
        deliveredBy: input.actorId,
        deliveredAt: at,
      }),
  });
  return item;
}

// ---------------------------------------------------------------------------
// Edit / delete a delivered assignment (D-#353 policy — the D-#336 homework twin)
// ---------------------------------------------------------------------------

export interface UpdateAssignmentItemInput {
  itemId: string;
  estMinutes?: number;
  totalMarks?: number;
  setId?: string;
  /** D-#478: editable in BOTH states — a wrong instruction is exactly the thing a
   *  teacher must be able to correct after issue (the D-#336 homework posture). */
  description?: string;
  attachmentIds?: string[];
  actorId: string;
  /** Principal/Office may correct any cell; a teacher only their own rotation cell. */
  isAdmin?: boolean;
}

export interface UpdateAssignmentItemResult {
  itemId: string;
  asId: string;
  weekNumber: number;
  subject: HwSubject;
  status: "DRAFT" | "ISSUED";
  estMinutes: number;
  totalMarks: number | null;
  deliveryDate: string;
  dueDate: string;
}

const NOT_YOUR_CELL =
  "এই অ্যাসাইনমেন্টটি আপনার বিষয়/সপ্তাহের নয় — শুধু দায়িত্বপ্রাপ্ত শিক্ষক বা অফিস সম্পাদনা করতে পারে";

/** The cell's own subject teacher, or Principal/Office. */
function assertOwnsAssignmentCell(
  item: { teacherId: { toString(): string } },
  actorId: string,
  isAdmin: boolean | undefined,
): void {
  if (isAdmin) return;
  if (item.teacherId.toString() !== actorId) {
    throw new Error(NOT_YOUR_CELL);
  }
}

/**
 * D-#772 — how much of the item this actor may edit. "FULL": the cell's own teacher or
 * Principal/Office (D-#353, unchanged). "RECORD_HALF": the record owner (routine
 * subject teacher) of a section the item's records were REHOMED to by a split — a
 * pre-split সম্মিলিত item whose বালিকা copies this teacher now checks. That half may
 * only supply what checking needs (a missing totalMarks); the item's text, set and
 * attachments stay the item teacher's. Anyone else is refused.
 */
async function assignmentEditScope(
  item: { _id: unknown; teacherId: { toString(): string }; sectionId?: { toString(): string } | null; subject: string; deliveryDate: Date },
  actorId: string,
  isAdmin: boolean | undefined,
): Promise<"FULL" | "RECORD_HALF"> {
  if (isAdmin || item.teacherId.toString() === actorId) return "FULL";
  const sections = item.sectionId
    ? ((await AssignmentStudentRecord.distinct("sectionId", { asItemId: item._id })) as Array<{ toString(): string }>)
        .filter((s) => isRehomed(item.sectionId, s))
    : [];
  if (sections.length > 0) {
    const owners = await resolveRecordOwners(
      sections.map((s) => ({
        itemId: String(item._id),
        itemSectionId: item.sectionId!.toString(),
        recordSectionId: s.toString(),
        subject: item.subject,
        itemDate: new Date(item.deliveryDate),
        itemOwnerId: item.teacherId.toString(),
      })),
    );
    if ([...owners.values()].includes(actorId)) return "RECORD_HALF";
  }
  throw new Error(NOT_YOUR_CELL);
}

/**
 * Tiered edit (D-#353 — mirrors the D-#336 homework rule):
 *   DRAFT  (delivered, week not yet confirmed) → every delivery-form field:
 *     estMinutes, totalMarks, setId, attachmentIds. No student records exist yet.
 *   ISSUED (week confirmed, records spawned)   → descriptive only: totalMarks,
 *     setId, attachmentIds. **estMinutes is FROZEN** (it was validated against the
 *     weekly ceiling at confirmAssignmentWeek — editing it would silently rewrite
 *     a confirmed week's total), and so are deliveryDate/dueDate (students already
 *     hold those deadlines).
 * Identity (week/section/subject) and the §4-resolved dates are NEVER client-editable
 * at any status — a mis-delivered cell is fixed by delete + re-deliver while DRAFT.
 */
export async function updateAssignmentItem(
  input: UpdateAssignmentItemInput,
): Promise<UpdateAssignmentItemResult> {
  if (!Types.ObjectId.isValid(input.itemId)) throw new Error("Invalid assignment id");
  const item = await AssignmentItem.findById(input.itemId);
  if (!item) throw new Error("AssignmentItem not found");
  const scope = await assignmentEditScope(item, input.actorId, input.isAdmin);
  if (scope === "RECORD_HALF") {
    // A split half supplies what its checking needs — the missing পূর্ণমান — and
    // nothing else: the item text belongs to the item's teacher, and re-scaling an
    // already-set totalMarks would change the other half's marks too.
    const touchesOther =
      input.estMinutes !== undefined ||
      input.setId !== undefined ||
      input.description !== undefined ||
      input.attachmentIds !== undefined;
    if (touchesOther || input.totalMarks === undefined) {
      throw new Error(
        "বিভক্ত শাখার শিক্ষক এই অ্যাসাইনমেন্টের শুধু পূর্ণমান দিতে পারেন — বাকিটা দায়িত্বপ্রাপ্ত শিক্ষক বা অফিস সম্পাদনা করবেন",
      );
    }
    if (item.totalMarks !== undefined && item.totalMarks !== null) {
      throw new Error("পূর্ণমান আগেই দেওয়া আছে — পরিবর্তনের জন্য দায়িত্বপ্রাপ্ত শিক্ষক বা অফিসকে বলুন");
    }
  }

  const issued = item.status === "ISSUED";

  if (input.estMinutes !== undefined) {
    if (issued) {
      throw new Error(
        "ইস্যু হয়ে যাওয়ার পর সময় (মিনিট) পরিবর্তন করা যাবে না — সপ্তাহের লোড ইতিমধ্যে নিশ্চিত হয়েছে",
      );
    }
    if (!Number.isInteger(input.estMinutes) || input.estMinutes < 0) {
      throw new Error("estMinutes must be a non-negative integer");
    }
    // AL-6 (switch on): a sheet-linked item's time is its marks × the policy rate — trim the questions, not the minutes.
    if ((await isLoop2027On()) && (await linkedAsPaperOf(item._id))) throw new Error("প্রশ্নভিত্তিক শিটের সময় প্রশ্ন বদলে কমান");
    item.estMinutes = input.estMinutes;
  }

  if (input.totalMarks !== undefined) {
    if (!Number.isInteger(input.totalMarks) || input.totalMarks < 1) {
      throw new Error("totalMarks must be a positive integer");
    }
    // Never strand an already-checked record above the new ceiling (D-#87 invariant).
    const over = await AssignmentStudentRecord.findOne({
      asItemId: item._id,
      marks: { $gt: input.totalMarks },
    })
      .select("_id")
      .lean();
    if (over) {
      throw new Error(
        `পূর্ণমান ${input.totalMarks} করা যাবে না — কোনো শিক্ষার্থীর প্রাপ্ত নম্বর এর চেয়ে বেশি`,
      );
    }
    item.totalMarks = input.totalMarks;
  }

  if (input.setId !== undefined) {
    const raw = input.setId.trim();
    if (raw === "") {
      item.setId = undefined;
    } else {
      if (!Types.ObjectId.isValid(raw)) {
        throw new Error("Question-set id must be a valid id — leave it blank if there is no set");
      }
      item.setId = new Types.ObjectId(raw);
    }
  }

  if (input.description !== undefined) {
    const next = input.description.trim();
    // Editable after issue, but never CLEARABLE — blanking it would put the item
    // back in the state D-#478 exists to end.
    if (!next) {
      throw new Error("অ্যাসাইনমেন্টে কী করতে হবে তা লিখুন — অভিভাবক এটিই দেখেন");
    }
    item.description = next;
  }

  if (input.attachmentIds !== undefined) {
    // D-#713: replaceable, never CLEARABLE (the description rule above). An edit
    // that leaves attachmentIds out is untouched, so items delivered before the
    // rule existed stay editable.
    const next = await normalizeAttachmentIds(input.attachmentIds);
    if (!next) throw new Error(AS_ATTACHMENT_REQUIRED);
    item.attachmentIds = next;
  }

  // AL-6 (switch on): a changed question set re-syncs the item's AS paper; a locked / worked paper refuses (§3.1 guard 4).
  if (input.setId !== undefined && (await isLoop2027On())) {
    await (await import("../../mastery/services/AssignmentPaperService")).syncAsPaperForItem(item, input.actorId);
  }
  await item.save();
  // The Maruf incident (2026-07-23): a delivered assignment had no trace of who
  // touched it. Every after-the-fact edit is now on the audit log.
  await writeAudit({
    eventKind: "ASSIGNMENT_ITEM_EDITED",
    actorId: input.actorId,
    targetId: item._id,
    targetKind: "AssignmentItem",
    meta: {
      asId: item.asId,
      status: item.status,
      estMinutes: input.estMinutes,
      totalMarks: input.totalMarks,
      setId: input.setId,
      descriptionEdited: input.description !== undefined,
      attachments: input.attachmentIds?.length,
      ...(scope === "RECORD_HALF" ? { viaRecordSection: true } : {}),
    },
  });
  // D-#953: the students already had it — a changed set or text is the deliverer's correction
  // (supplying the missing total marks is not).
  if (item.status !== "DRAFT" && (input.setId !== undefined || input.description !== undefined)) {
    await recordPlaceMistake({ kind: "ASSIGNMENT_ITEM_CHANGED", tier: 2, refKey: item._id.toString(), ownerId: item.deliveredBy, correctedBy: input.actorId, at: new Date(), line: `${item.asId}: দেওয়ার পর প্রশ্ন / লেখা বদলানো হয়েছে` });
  }

  return {
    itemId: item._id.toString(),
    asId: item.asId,
    weekNumber: item.weekNumber,
    subject: item.subject,
    status: item.status,
    estMinutes: item.estMinutes,
    totalMarks: item.totalMarks ?? null,
    deliveryDate: dateOnlyISO(item.deliveryDate),
    dueDate: dateOnlyISO(item.dueDate),
  };
}

/** AL-6: the AS paper linked to an item (switch-on callers only). */
async function linkedAsPaperOf(itemId: Types.ObjectId) {
  return (await import("../../mastery/paperLink")).linkedAsPaper(itemId);
}

export interface DeleteAssignmentItemInput {
  itemId: string;
  actorId: string;
  isAdmin?: boolean;
}

/**
 * Delete a still-DRAFT delivery (D-#353). ISSUED is refused: per-student records
 * exist and carry lifecycle history — that is a revert, not a delete. Defensive
 * record check so a DRAFT that somehow spawned records is never silently orphaned.
 */
export async function deleteAssignmentItem(
  input: DeleteAssignmentItemInput,
): Promise<{ itemId: string; asId: string }> {
  if (!Types.ObjectId.isValid(input.itemId)) throw new Error("Invalid assignment id");
  const item = await AssignmentItem.findById(input.itemId);
  if (!item) throw new Error("AssignmentItem not found");
  assertOwnsAssignmentCell(item, input.actorId, input.isAdmin);

  if (item.status !== "DRAFT") {
    throw new Error("ইস্যু হয়ে যাওয়া অ্যাসাইনমেন্ট মুছে ফেলা যাবে না — শিক্ষার্থীদের রেকর্ড তৈরি হয়ে গেছে");
  }
  const spawned = await AssignmentStudentRecord.findOne({ asItemId: item._id }).select("_id").lean();
  if (spawned) {
    throw new Error("এই অ্যাসাইনমেন্টের শিক্ষার্থী রেকর্ড আছে — মুছে ফেলা যাবে না");
  }

  const asId = item.asId;
  // AL-4 (AC-B11): an AL-4 AS paper goes with its DRAFT — rows withdrawn, evidence none yet.
  await (await import("../../mastery/services/HomeworkPaperService")).removePaperOfAsItem(item._id);
  await AssignmentItem.deleteOne({ _id: item._id });
  await writeAudit({
    eventKind: "ASSIGNMENT_ITEM_DELETED",
    actorId: input.actorId,
    targetId: item._id,
    targetKind: "AssignmentItem",
    meta: { asId, weekNumber: item.weekNumber, subject: item.subject, sectionId: item.sectionId?.toString() },
  });
  return { itemId: input.itemId, asId };
}

// ---------------------------------------------------------------------------
// AS-T6 (D-#274) — weekly load ceiling: reconcile + confirm
// ---------------------------------------------------------------------------

export interface WeekLoadItem {
  itemId: string;
  asId: string;
  subject: HwSubject;
  estMinutes: number;
  status: "DRAFT" | "ISSUED";
  /** AL-6b (switch on): where the subject falls on the two home days; null on a 2026 item. */
  doOnDay: "FRI" | "SAT" | "BOTH" | null;
  friMinutes: number;
  satMinutes: number;
  /** AL-6b: the Bangla day label ("শুক্রবার" / "শনিবার" / "শুক্রবার: প্রশ্ন ১–৬ · শনিবার: প্রশ্ন ৭–১২"). */
  dayLabel: string | null;
  /** The same label in English (the app picks by language). */
  dayLabelEn: string | null;
}
export interface WeekLoadResult {
  academicYearId: string;
  sectionId: string;
  weekNumber: number;
  ceiling: number;
  /** Σ estMinutes over ALL items this week (DRAFT + ISSUED) — the section's weekly load. */
  totalMinutes: number;
  draftMinutes: number;
  overBy: number;
  withinCeiling: boolean;
  hasDrafts: boolean;
  /** AL-6b (switch on): one home day's cap in minutes (`perDayHours` × 60) and the minutes the week puts on each day. 0 = no day budget (2026). */
  dayCap: number;
  friTotal: number;
  satTotal: number;
  items: WeekLoadItem[];
}

/** The reconcile read: every assignment item for (section × week) with its minutes,
 *  the weekly total vs the 360 ceiling, and per-item DRAFT/ISSUED status. */
export async function assignmentWeekLoad(
  academicYearId: string,
  sectionId: string,
  weekNumber: number,
): Promise<WeekLoadResult> {
  const items = (await AssignmentItem.find({ academicYearId, sectionId, weekNumber })
    .sort({ subject: 1 })
    .lean()) as unknown as IAssignmentItem[];
  const totalMinutes = items.reduce((s, it) => s + (it.estMinutes ?? 0), 0);
  const draftMinutes = items.filter((it) => it.status === "DRAFT").reduce((s, it) => s + (it.estMinutes ?? 0), 0);
  const ceiling = await weeklyCeilingMinutes(); // AL-6: the policy cap with the release switch on, else the 360 constant
  const loop = await isLoop2027On();
  const paperSvc = loop ? await import("../../mastery/services/AssignmentPaperService") : null;
  const budget = loop ? await import("../../mastery/assignmentBudget") : null;
  const dayCap = budget ? budget.dayCapMinutes(await budget.budgetPolicy()) : 0;
  const rows: WeekLoadItem[] = [];
  for (const it of items) {
    rows.push({
      itemId: it._id.toString(),
      asId: it.asId,
      subject: it.subject,
      estMinutes: it.estMinutes ?? 0,
      status: it.status,
      doOnDay: loop ? (it.doOnDay ?? null) : null,
      friMinutes: loop ? (it.minutesByDay?.FRI ?? 0) : 0,
      satMinutes: loop ? (it.minutesByDay?.SAT ?? 0) : 0,
      ...(await (async () => {
        const l = paperSvc ? await paperSvc.dayLabelsOfItem(it) : null;
        return { dayLabel: l?.bn ?? null, dayLabelEn: l?.en ?? null };
      })()),
    });
  }
  return {
    academicYearId,
    sectionId,
    weekNumber,
    ceiling,
    totalMinutes,
    draftMinutes,
    overBy: Math.max(0, totalMinutes - ceiling),
    withinCeiling: totalMinutes <= ceiling,
    hasDrafts: items.some((it) => it.status === "DRAFT"),
    dayCap,
    friTotal: rows.reduce((n, r) => n + r.friMinutes, 0),
    satTotal: rows.reduce((n, r) => n + r.satMinutes, 0),
    items: rows,
  };
}

/** Trim a DRAFT item's declared minutes (to bring the week under the ceiling before
 *  confirm). ISSUED items are frozen — records already exist. */
export async function setAssignmentItemMinutes(
  itemId: string,
  estMinutes: number,
): Promise<{ itemId: string; estMinutes: number }> {
  if (!Number.isInteger(estMinutes) || estMinutes < 0) {
    throw new Error("estMinutes must be a non-negative integer");
  }
  const item = await AssignmentItem.findById(itemId);
  if (!item) throw new Error("AssignmentItem not found");
  if (item.status !== "DRAFT") {
    throw new Error("Only a DRAFT assignment's minutes can be changed (the week is already issued)");
  }
  if ((await isLoop2027On()) && (await linkedAsPaperOf(item._id))) throw new Error("প্রশ্নভিত্তিক শিটের সময় প্রশ্ন বদলে কমান");
  item.estMinutes = estMinutes;
  await item.save();
  return { itemId: item._id.toString(), estMinutes };
}

export interface ConfirmWeekResult {
  academicYearId: string;
  sectionId: string;
  weekNumber: number;
  ceiling: number;
  totalMinutes: number;
  itemsIssued: number;
  recordsIssued: number;
}

/** The AS-T6 gate: confirm a section's week. Sums the week's estMinutes (DRAFT +
 *  already-ISSUED); HARD-BLOCKS over AS_WEEKLY_CEILING_MIN (trim required). Otherwise
 *  spawns the per-student records for every DRAFT item from its stored roster and
 *  flips it to ISSUED. Records exist only after this — the homework confirmDay mirror. */
export async function confirmAssignmentWeek(input: {
  academicYearId: string;
  sectionId: string;
  weekNumber: number;
  actorId: string;
  at?: Date;
}): Promise<ConfirmWeekResult> {
  const items = await AssignmentItem.find({
    academicYearId: input.academicYearId,
    sectionId: input.sectionId,
    weekNumber: input.weekNumber,
  });
  if (items.length === 0) {
    throw new Error(`No assignments delivered for week ${input.weekNumber} in this section yet`);
  }
  const drafts = items.filter((it) => it.status === "DRAFT");
  if (drafts.length === 0) {
    throw new Error(`Week ${input.weekNumber} is already confirmed for this section`);
  }

  const totalMinutes = items.reduce((s, it) => s + (it.estMinutes ?? 0), 0);
  const ceiling = await weeklyCeilingMinutes();
  if (totalMinutes > ceiling) {
    throw new Error(
      `Week ${input.weekNumber} total ${totalMinutes} min exceeds the ${ceiling}-min weekly ceiling — ` +
        `trim a subject before confirming (AS-T6)`,
    );
  }
  // AL-6 / AC-C4 (switch on): the per-day budget — Friday + Saturday — and the day split of the items without one.
  const loop2027 = await isLoop2027On();
  if (loop2027) await (await import("../../mastery/services/AssignmentPaperService")).finaliseWeekDays(items);

  const at = input.at ?? new Date();
  let recordsIssued = 0;
  let itemsIssued = 0;
  for (const item of drafts) {
    // D-#839: claim the draft atomically before spawning its records. Records carry
    // no unique index (a resubmission shares asItemId+studentId), so a class teacher's
    // confirm racing the auto-issue sweep would otherwise insert every roster twice.
    // The loser of the claim skips the item; the winner owns its records.
    const claimed = await AssignmentItem.updateOne(
      { _id: item._id, status: "DRAFT" },
      { $set: { status: "ISSUED", issuedAt: at, issuedBy: input.actorId }, $unset: { draftRoster: 1 } },
    );
    if (claimed.modifiedCount === 0) continue;
    itemsIssued += 1;
    // AL-6 (switch on): the AS paper locks at issue and its §3.2 rows are written (guard 4); never fails the issue.
    if (loop2027) {
      try {
        await (await import("../../mastery/services/AssignmentPaperService")).onAssignmentIssued(item._id);
      } catch (err) {
        // The issue stands (the paper's own fallback already wrote its AS ledger rows); report it.
        await (await import("../../../lib/reportError")).reportSilentFailure("assignment.asPaperLockAtIssue", err, { itemId: String(item._id) });
      }
    }
    const roster = item.draftRoster ?? [];
    const records = roster.map((r) => {
      const state: LifecycleState = r.present ? "GIVEN" : "ABSENT_REDELIVER";
      return {
        asItemId: item._id,
        asId: item.asId,
        studentId: r.studentId,
        sectionId: item.sectionId,
        classId: item.classId,
        state,
        stateDates: [{ state, at, by: new Types.ObjectId(input.actorId) }],
        dueDate: r.present ? item.dueDate : undefined,
        chaseCount: 0,
        issuedBy: input.actorId,
      };
    });
    if (records.length > 0) {
      try {
        await AssignmentStudentRecord.insertMany(records);
      } catch (err) {
        // Hand the draft back so the next confirm can issue it, not an ISSUED item with no records.
        await AssignmentItem.updateOne(
          { _id: item._id },
          { $set: { status: "DRAFT", draftRoster: roster }, $unset: { issuedAt: 1, issuedBy: 1 } },
        );
        throw err;
      }
      recordsIssued += records.length;
    }
    // D-#1004: the teacher who delivered it captured the roster (no attendance gate).
    await recordAbsentAtDelivery({
      tracker: "as",
      itemId: item._id.toString(),
      label: item.asId,
      absentStudentIds: roster.filter((r) => !r.present).map((r) => String(r.studentId)),
      dateKey: item.deliveryDate ? dateKeyOf(item.deliveryDate) : "",
      ownerId: item.deliveredBy,
      at,
    });
  }

  return {
    academicYearId: input.academicYearId,
    sectionId: input.sectionId,
    weekNumber: input.weekNumber,
    ceiling,
    totalMinutes,
    itemsIssued,
    recordsIssued,
  };
}

// ---------------------------------------------------------------------------
// redeliverAssignmentRecord (absent student receives later)
// ---------------------------------------------------------------------------

export interface TransitionResult {
  recordId: string;
  asId: string;
  state: LifecycleState;
  chaseCount: number;
  dueDate: string | null;
  /** D-#892: this move corrected a chase a person made the same day (a recorded mistake). */
  markCorrected?: boolean;
}

function transitionShape(rec: IAssignmentStudentRecord): TransitionResult {
  return {
    recordId: rec._id.toString(),
    asId: rec.asId,
    state: rec.state,
    chaseCount: rec.chaseCount,
    dueDate: rec.dueDate ? dateOnlyISO(rec.dueDate) : null,
  };
}

export async function redeliverAssignmentRecord(
  recordId: string,
  actorId: string,
  at: Date = new Date(),
): Promise<TransitionResult> {
  const rec = await AssignmentStudentRecord.findById(recordId);
  if (!rec) throw new Error("AssignmentStudentRecord not found");
  assertTransition(rec.state, "GIVEN"); // legal only from ABSENT_REDELIVER
  const item = await AssignmentItem.findById(rec.asItemId).lean();
  if (!item) throw new Error("AssignmentItem not found");
  rec.state = "GIVEN";
  rec.stateDates.push({ state: "GIVEN", at, by: new Types.ObjectId(actorId) });
  rec.dueDate = new Date(item.dueDate); // item-wide due, not shifted per student
  await rec.save();
  return transitionShape(rec);
}

// ---------------------------------------------------------------------------
// (collectAssignment — the old AJ-4 Sunday pass — was retired with the roster-pass
//  workspace: the submit pass replaces it. Removed in the PR-3 cleanup, D-#356.)
// ---------------------------------------------------------------------------

/**
 * Sweep: every DUE record past its due date → CHASE (PRD AS-T2 "past-due
 * non-submitted records transition to CHASE"). Item-scoped or global.
 */
export async function sweepAssignmentChases(
  at: Date = new Date(),
  itemId?: string,
): Promise<number> {
  // D-#1655: no assignment chasing on a paused day.
  if (await isPausedNow("ASSIGNMENT_CHASE", at)) return 0;
  const filter: Record<string, unknown> = {
    state: "DUE",
    dueDate: { $lt: atMidnight(at) },
  };
  if (itemId) filter.asItemId = itemId;
  const candidates = await AssignmentStudentRecord.find(filter);
  // D-#1655: a record whose due day fell inside an ASSIGNMENT_CHASE window is never chased,
  // even after the window ends (same rule as homework).
  const dueKeys = candidates.filter((r) => r.dueDate).map((r) => dateKeyOf(new Date(r.dueDate as Date))).sort();
  const isPaused = dueKeys.length
    ? await loadPausePredicate(dueKeys[0], dueKeys[dueKeys.length - 1])
    : () => false;
  const due = candidates.filter((r) => !r.dueDate || !isPaused("ASSIGNMENT_CHASE", dateKeyOf(new Date(r.dueDate))));
  for (const rec of due) {
    rec.state = "CHASE";
    rec.chaseCount += 1;
    rec.stateDates.push({ state: "CHASE", at });
    await rec.save();
  }
  return due.length;
}

// ---------------------------------------------------------------------------
// transitionAssignmentRecord (one legal engine move — RETURNED, re-chase, …)
// ---------------------------------------------------------------------------

export async function transitionAssignmentRecord(
  recordId: string,
  toState: string,
  actorId: string,
  at: Date = new Date(),
): Promise<TransitionResult> {
  const rec = await AssignmentStudentRecord.findById(recordId);
  if (!rec) throw new Error("AssignmentStudentRecord not found");
  const to = toState as LifecycleState;
  const from = rec.state;
  assertTransition(from, to);
  // D-#892: read BEFORE the new stamp lands — the chase being corrected is the latest one.
  const correctedChase = from === "CHASE" && to === "SUBMITTED" ? sameDayPersonChase(rec.stateDates, at) : null;
  if (to === "CHASE") rec.chaseCount += 1;
  rec.state = to;
  rec.stateDates.push({ state: to, at, by: new Types.ObjectId(actorId) });
  await rec.save();

  // D-#552: the assignment twin of the homework hook — marking a student
  // submitted through any path closes an open guardian claim as ACCEPTED,
  // with no second tap for the teacher.
  if (to === "SUBMITTED") {
    const accepted = await acceptClaimsForRecords([rec._id], actorId, at);
    for (const claim of accepted) await emitWorkClaimResolved(claim);
  }

  // D-#891: the FIRST chase tells the family, with the gift warning (re-chases stay
  // silent; the teacher-sent follow-up ladder is separate). Held while the family has an
  // open claim on this very record (the D-#554 §6.4 posture). Best-effort inside.
  if (to === "CHASE" && rec.chaseCount === 1) {
    try {
      if (!(await hasOpenClaim(rec._id))) {
        const item = await AssignmentItem.findById(rec.asItemId).select("asId subject").lean();
        if (item) {
          await emitAssignmentFirstChase({
            recordId: rec._id,
            asId: item.asId,
            studentId: rec.studentId,
            sectionId: rec.sectionId,
            subject: item.subject,
            at,
          });
        }
      }
    } catch (err) {
      console.error("[AssignmentService] first-chase guardian notice failed (never blocks the chase):", err);
    }
  }

  // D-#892/#893: a same-day flip of a person-made chase is the chaser's recorded mistake.
  if (correctedChase) {
    await recordMarkCorrection({
      tracker: "ASSIGNMENT",
      recordId: rec._id,
      itemId: rec.asItemId,
      studentId: rec.studentId,
      sectionId: rec.sectionId,
      chase: correctedChase,
      correctedBy: actorId,
      at,
      via: "FLIP",
    });
  }

  return { ...transitionShape(rec), markCorrected: !!correctedChase };
}

// ---------------------------------------------------------------------------
// Derived counts + reads (PRD §1 — never typed)
// ---------------------------------------------------------------------------

export interface AssignmentItemCounts {
  itemId: string;
  asId: string;
  rosterCount: number;
  /** Ever received the paper (has a GIVEN stamp). */
  deliveredCount: number;
  /** Still waiting for redelivery (current ABSENT_REDELIVER). */
  notReceivedCount: number;
  /** Ever submitted (has a SUBMITTED stamp). */
  submittedCount: number;
  /** Currently being chased — the sheet's "missing" list, per student. */
  missingStudentIds: string[];
}

/** `sectionId` (D-#726): count only the records OF that section — the one the caller is
 *  scoped to. A pre-split item on the emptied সম্মিলিত holds both halves' children. */
export async function assignmentItemCounts(itemId: string, sectionId?: string): Promise<AssignmentItemCounts> {
  const item = await AssignmentItem.findById(itemId).lean();
  if (!item) throw new Error("AssignmentItem not found");
  const records = (await AssignmentStudentRecord.find({
    asItemId: itemId,
    ...(sectionId ? { sectionId: new Types.ObjectId(sectionId) } : {}),
    resubOf: null, // the original pass defines receipt/submission; resubmissions don't double-count
  }).lean()) as unknown as IAssignmentStudentRecord[];

  const has = (r: IAssignmentStudentRecord, s: LifecycleState) =>
    r.stateDates.some((d) => d.state === s);

  return {
    itemId: item._id.toString(),
    asId: item.asId,
    rosterCount: records.length,
    deliveredCount: records.filter((r) => has(r, "GIVEN")).length,
    notReceivedCount: records.filter((r) => r.state === "ABSENT_REDELIVER").length,
    submittedCount: records.filter((r) => has(r, "SUBMITTED")).length,
    missingStudentIds: records
      .filter((r) => r.state === "CHASE")
      .map((r) => r.studentId.toString()),
  };
}

export async function listAssignmentItems(filter: {
  academicYearId?: string;
  classId?: string;
  sectionId?: string;
  weekNumber?: number;
  teacherId?: string;
}): Promise<IAssignmentItem[]> {
  const q: Record<string, unknown> = {};
  if (filter.academicYearId) q.academicYearId = filter.academicYearId;
  if (filter.classId) q.classId = filter.classId;
  if (filter.sectionId) q.sectionId = filter.sectionId;
  if (filter.weekNumber !== undefined) q.weekNumber = filter.weekNumber;
  if (filter.teacherId) q.teacherId = filter.teacherId;
  return AssignmentItem.find(q).sort({ weekNumber: 1, subject: 1 }).lean() as unknown as Promise<
    IAssignmentItem[]
  >;
}

/** `sectionId` (D-#726): only that section's records — see `assignmentItemCounts`. */
export async function listAssignmentRecords(
  asItemId: string,
  sectionId?: string,
): Promise<IAssignmentStudentRecord[]> {
  return AssignmentStudentRecord.find({
    asItemId,
    ...(sectionId ? { sectionId: new Types.ObjectId(sectionId) } : {}),
  }).lean() as unknown as Promise<
    IAssignmentStudentRecord[]
  >;
}
