/**
 * RoutineTriggerService (R-5, D-#52) — the routine-driven trigger schedule (bell)
 * + the class-note / daily-diary. The schedule is computed here; delivery (push)
 * rides the deferred messaging pipeline. Class-note publish is authorized to the
 * slot's teacher, its active cover, or an admin.
 */
import { Types } from "mongoose";
import { DAYS_OF_WEEK } from "@scd/shared";
import type { RoutineSubject } from "@scd/shared";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { SubjectGroup } from "../models/SubjectGroup";
import { User } from "../../foundation/models/User";
import { ScheduleWindow, type IScheduleWindow } from "../models/ScheduleWindow";
import { PeriodGrid, type IPeriodGrid } from "../models/PeriodGrid";
import { BellDutyAssignment, type IBellDutyAssignment } from "../models/BellDutyAssignment";
import { RoutineSlot, type IRoutineSlot } from "../models/RoutineSlot";
import { RoutineSubstitution } from "../models/RoutineSubstitution";
import { ClassNote, type IClassNote } from "../models/ClassNote";
import { StoredFile } from "../../platform/models/StoredFile";
import { computePeriodTimes, windowFor } from "../schedule";
import { buildBellSchedule, type BellTrigger } from "../trigger";
import { ForbiddenError } from "../../../middleware/authz";
import { emitClassNotePublished } from "../../notifications/services/emitters";
import { liveWindow } from "../liveWindow";

function dayBounds(date: Date): { start: Date; end: Date } {
  const s = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const e = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return { start: s, end: e };
}

/** The bell-ring schedule for a date + audience (R5.1): each period's end time and
 *  the admin who rings it (per-period override → whole-day duty admin → null). */
export async function bellSchedule(date: Date, audienceKey: string): Promise<BellTrigger[]> {
  const windows = (await ScheduleWindow.find({ active: true }).lean()) as unknown as IScheduleWindow[];
  const win = windowFor(date, windows);
  const season = win ? win.season : "regular";
  const dayStartMinutes = win ? win.dayStartMinutes : 420;
  const grid = (await PeriodGrid.findOne({ audienceKey, season, active: true }).lean()) as unknown as IPeriodGrid | null;
  if (!grid) return [];
  const periods = computePeriodTimes(dayStartMinutes, grid.periods);

  const { start, end } = dayBounds(date);
  const duties = (await BellDutyAssignment.find({ active: true, date: { $gte: start, $lte: end } }).lean()) as unknown as IBellDutyAssignment[];
  let wholeDay: string | null = null;
  const perPeriod: Record<number, string> = {};
  for (const d of duties) {
    if (d.periodNumber === undefined || d.periodNumber === null) wholeDay = d.adminId.toString();
    else perPeriod[d.periodNumber] = d.adminId.toString();
  }
  return buildBellSchedule(
    periods.map((p) => ({ number: p.number, isBreak: p.isBreak, endHHMM: p.endHHMM, track: p.track })),
    wholeDay,
    perPeriod,
  );
}

/** Assign (replace) the bell-duty admin for a date — whole-day (periodNumber null)
 *  or a single-period override (D-#54). */
export async function assignBellDuty(input: {
  date: Date;
  periodNumber?: number | null;
  adminId: string;
  actorId: string;
}): Promise<IBellDutyAssignment> {
  const { start, end } = dayBounds(input.date);
  const periodMatch = input.periodNumber == null ? { periodNumber: { $exists: false } } : { periodNumber: input.periodNumber };
  await BellDutyAssignment.updateMany(
    { active: true, date: { $gte: start, $lte: end }, ...periodMatch },
    { $set: { active: false } },
  );
  return BellDutyAssignment.create({
    date: input.date,
    periodNumber: input.periodNumber ?? undefined,
    adminId: new Types.ObjectId(input.adminId),
    createdBy: new Types.ObjectId(input.actorId),
  });
}

export async function bellDutyForDate(date: Date): Promise<IBellDutyAssignment[]> {
  const { start, end } = dayBounds(date);
  return BellDutyAssignment.find({ active: true, date: { $gte: start, $lte: end } }).lean() as unknown as IBellDutyAssignment[];
}

/** Publish (or update) the class-note for a slot on a date (R5.3). Authorized to the
 *  slot's teacher, its active cover for that date, or an admin (`canManage`). */
/** Normalize + cap class-note attachment ids (≤5, valid ObjectIds). */
function normalizeAttachmentIds(ids: string[] | null | undefined): Types.ObjectId[] {
  const valid = (ids ?? []).filter((id) => Types.ObjectId.isValid(id));
  if (valid.length > 5) throw new Error("A class note can carry at most 5 attachments");
  return valid.map((id) => new Types.ObjectId(id));
}

/**
 * D-#477: the slot + the "may I write this note?" ruling, resolved WITHOUT writing
 * anything. The composite entry point (DE-3) needs both before it touches the
 * homework tracker, so that a caller who cannot write the note never causes a
 * homework declaration as a side effect. `publishClassNote` runs the same check.
 */
export async function resolveNoteAuthorization(input: {
  slotId: string;
  date: Date;
  actorId: string;
  canManage: boolean;
}): Promise<IRoutineSlot> {
  const slot = (await RoutineSlot.findById(input.slotId).lean()) as unknown as IRoutineSlot | null;
  if (!slot) throw new Error("Routine slot not found");

  let allowed = input.canManage || (slot.teacherId ? slot.teacherId.toString() === input.actorId : false);
  if (!allowed) {
    const { start, end } = dayBounds(input.date);
    const cover = await RoutineSubstitution.findOne({
      slotId: input.slotId,
      active: true,
      coverTeacherId: input.actorId,
      date: { $gte: start, $lte: end },
    }).lean();
    allowed = cover !== null;
  }
  if (!allowed) throw new ForbiddenError("Only the slot's teacher (or cover) may publish its class note");
  return slot;
}

export async function publishClassNote(input: {
  slotId: string;
  date: Date;
  taughtSummaryBn: string;
  homeworkItemId?: string | null;
  attachmentIds?: string[] | null;
  actorId: string;
  canManage: boolean;
}): Promise<IClassNote> {
  const slot = await resolveNoteAuthorization(input);

  // Guard the optional homework link. homeworkItemId is free-text on the daily
  // note form; a non-id value (prod incident: non-id text crashed the ObjectId
  // cast) must be rejected here rather than thrown raw from the cast. Empty → no link.
  const hwIdRaw = input.homeworkItemId?.trim();
  const hwId = hwIdRaw === undefined || hwIdRaw === "" ? undefined : hwIdRaw;
  if (hwId !== undefined && !Types.ObjectId.isValid(hwId)) {
    throw new Error("Homework id must be a valid id — leave it blank if there is no linked homework");
  }
  const homeworkItemId = hwId ? new Types.ObjectId(hwId) : undefined;

  const publishedAt = new Date();
  await ClassNote.updateOne(
    { slotId: input.slotId, date: input.date },
    {
      $set: {
        groupType: slot.groupType,
        groupId: slot.groupId,
        subject: slot.subject,
        taughtSummaryBn: input.taughtSummaryBn,
        homeworkItemId,
        attachmentIds: normalizeAttachmentIds(input.attachmentIds),
        publishedBy: new Types.ObjectId(input.actorId),
        publishedAt,
      },
    },
    { upsert: true },
  );
  const note = (await ClassNote.findOne({ slotId: input.slotId, date: input.date }).lean()) as unknown as IClassNote;

  // N1.3 (R5.4, in-app half): notify each login-enabled guardian of the group.
  // Best-effort — a notification failure never blocks the publish (D-#72).
  await emitClassNotePublished(note);

  return note;
}

export async function classNotesForDate(
  groupType: "section" | "subjectgroup",
  groupId: string,
  date: Date,
): Promise<IClassNote[]> {
  const { start, end } = dayBounds(date);
  return ClassNote.find({ groupType, groupId, date: { $gte: start, $lte: end } })
    .sort({ subject: 1 })
    .lean() as unknown as IClassNote[];
}

/**
 * The range twin of `classNotesForDate` (D-#476) — every note the group has in
 * [from, to] in ONE query. The guardian class-notes history used to call the
 * single-day function once per day, which is why its window was pinned at a week;
 * this is what lets that window grow without the request count growing with it.
 * Newest day first, subject-ordered inside a day (the per-day sort the callers
 * already render by).
 */
export async function classNotesForRange(
  groupType: "section" | "subjectgroup",
  groupId: string,
  from: Date,
  to: Date,
): Promise<IClassNote[]> {
  const { start } = dayBounds(from);
  const { end } = dayBounds(to);
  return ClassNote.find({ groupType, groupId, date: { $gte: start, $lte: end } })
    .sort({ date: -1, subject: 1 })
    .lean() as unknown as IClassNote[];
}

// ---------------------------------------------------------------------------
// Class-note admin (Principal/Office): edit / delete / enriched list of all notes.
// ---------------------------------------------------------------------------

/**
 * Edit an existing note's summary and/or attachments.
 *
 * Principal/Office (`canManage`) may edit any note; every other caller may edit
 * only the note they authored — the same "your own note" rule the publish upsert
 * already gives a teacher (D-#336), now reachable from the archive list too.
 * `actorId` omitted = an internal call, unchecked.
 */
export async function updateClassNote(input: {
  id: string;
  taughtSummaryBn?: string | null;
  attachmentIds?: string[] | null;
  actorId?: string;
  canManage?: boolean;
}): Promise<IClassNote> {
  if (input.actorId && !input.canManage) {
    const existing = (await ClassNote.findById(input.id).select("publishedBy").lean()) as unknown as {
      publishedBy: Types.ObjectId;
    } | null;
    if (!existing) throw new Error("Class note not found");
    if (existing.publishedBy.toString() !== input.actorId) {
      throw new ForbiddenError("You can only edit your own class note");
    }
  }
  const set: Record<string, unknown> = {};
  if (input.taughtSummaryBn != null && input.taughtSummaryBn.trim() !== "") set.taughtSummaryBn = input.taughtSummaryBn.trim();
  if (input.attachmentIds !== undefined) set.attachmentIds = normalizeAttachmentIds(input.attachmentIds);
  if (Object.keys(set).length === 0) throw new Error("Nothing to update");
  const updated = (await ClassNote.findByIdAndUpdate(input.id, { $set: set }, { new: true }).lean()) as unknown as IClassNote | null;
  if (!updated) throw new Error("Class note not found");
  return updated;
}

/** Delete a class note (Principal/Office). Attachments' StoredFile rows are left intact. */
export async function deleteClassNote(id: string): Promise<{ id: string }> {
  const res = await ClassNote.findByIdAndDelete(id).lean();
  if (!res) throw new Error("Class note not found");
  return { id };
}

export interface ClassNoteAttachmentView {
  id: string;
  name: string;
  mime: string;
}
export interface ClassNoteAdminRow {
  id: string;
  date: string;
  subject: RoutineSubject;
  taughtSummaryBn: string;
  classLevel: number | null;
  classNameBn: string | null;
  sectionCode: string | null;
  sectionNameBn: string | null;
  subjectGroupNameBn: string | null;
  /** The section the note belongs to (null for a subject-group note) — the list
   *  screen filters on it, and the row needs it to render the section column. */
  sectionId: string | null;
  classId: string | null;
  authorId: string | null;
  authorName: string | null;
  publishedAt: string;
  attachments: ClassNoteAttachmentView[];
}

/**
 * Enrich raw notes into admin rows: class/section (or subject-group) names, the
 * author's name and the attachments' file names. One batched lookup per
 * collection, so the cost is flat in the number of notes — which is what lets the
 * paginated list below hand it a 50-row page without a per-row query storm.
 */
async function enrichClassNotes(notes: IClassNote[]): Promise<ClassNoteAdminRow[]> {
  if (notes.length === 0) return [];

  const sectionIds = new Set<string>();
  const subjectGroupIds = new Set<string>();
  const userIds = new Set<string>();
  const fileIds = new Set<string>();
  for (const n of notes) {
    if (n.groupType === "section") sectionIds.add(n.groupId.toString());
    else subjectGroupIds.add(n.groupId.toString());
    userIds.add(n.publishedBy.toString());
    for (const a of n.attachmentIds ?? []) fileIds.add(a.toString());
  }

  const [sections, subjectGroups, users, files] = await Promise.all([
    sectionIds.size ? Section.find({ _id: { $in: [...sectionIds] } }).select("classId code nameBn").lean() : Promise.resolve([]),
    subjectGroupIds.size ? SubjectGroup.find({ _id: { $in: [...subjectGroupIds] } }).select("nameBn").lean() : Promise.resolve([]),
    userIds.size ? User.find({ _id: { $in: [...userIds] } }).select("name").lean() : Promise.resolve([]),
    fileIds.size ? StoredFile.find({ _id: { $in: [...fileIds] } }).select("originalName mime").lean() : Promise.resolve([]),
  ]);
  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));
  const classIds = new Set(sections.map((s) => s.classId?.toString()).filter((x): x is string => !!x));
  const classes = classIds.size ? await Class.find({ _id: { $in: [...classIds] } }).select("level nameBn").lean() : [];
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));
  const sgById = new Map(subjectGroups.map((g) => [g._id.toString(), g]));
  const userById = new Map(users.map((u) => [u._id.toString(), u]));
  const fileById = new Map(files.map((f) => [f._id.toString(), f]));

  return notes.map((n) => {
    let classLevel: number | null = null;
    let classNameBn: string | null = null;
    let sectionCode: string | null = null;
    let sectionNameBn: string | null = null;
    let subjectGroupNameBn: string | null = null;
    let sectionId: string | null = null;
    let classId: string | null = null;
    if (n.groupType === "section") {
      sectionId = n.groupId.toString();
      const sec = sectionById.get(n.groupId.toString());
      if (sec) {
        sectionCode = sec.code ?? null;
        sectionNameBn = sec.nameBn ?? null;
        const cls = sec.classId ? classById.get(sec.classId.toString()) : null;
        if (cls) {
          classId = sec.classId!.toString();
          classLevel = cls.level ?? null;
          classNameBn = cls.nameBn ?? null;
        }
      }
    } else {
      subjectGroupNameBn = sgById.get(n.groupId.toString())?.nameBn ?? null;
    }
    return {
      id: n._id.toString(),
      date: new Date(n.date).toISOString(),
      subject: n.subject,
      taughtSummaryBn: n.taughtSummaryBn,
      classLevel,
      classNameBn,
      sectionCode,
      sectionNameBn,
      subjectGroupNameBn,
      sectionId,
      classId,
      authorId: n.publishedBy.toString(),
      authorName: userById.get(n.publishedBy.toString())?.name ?? null,
      publishedAt: new Date(n.publishedAt).toISOString(),
      attachments: (n.attachmentIds ?? []).map((a) => {
        const f = fileById.get(a.toString());
        return { id: a.toString(), name: f?.originalName ?? "file", mime: f?.mime ?? "" };
      }),
    };
  });
}

/** Principal/Office: every class note for a date — or an inclusive date RANGE when
 *  `dateTo` is given (admin filters, D-#309 pattern) — enriched with class/section
 *  names, author name and attachment file names. Newest first. */
export async function classNotesAdmin(date: Date, dateTo?: Date): Promise<ClassNoteAdminRow[]> {
  const { start } = dayBounds(dateTo && dateTo < date ? dateTo : date);
  const { end } = dayBounds(dateTo && dateTo > date ? dateTo : date);
  const notes = (await ClassNote.find({ date: { $gte: start, $lte: end } })
    .sort({ publishedAt: -1 })
    .lean()) as unknown as IClassNote[];
  return enrichClassNotes(notes);
}

// ---------------------------------------------------------------------------
// The whole class-note archive: filtered + paginated (owner ask 2026-08-17).
// ---------------------------------------------------------------------------

export interface ClassNoteListFilter {
  /** Inclusive date window; either end may stand alone. Omit both = all time. */
  from?: Date | null;
  to?: Date | null;
  classId?: string | null;
  sectionId?: string | null;
  subject?: string | null;
  /** The AUTHOR (publishedBy). The resolver pins this to the caller when they
   *  lack routine:manage — scoping is never left to the client. */
  teacherId?: string | null;
  page?: number | null;
  pageSize?: number | null;
}

export interface ClassNotePage {
  rows: ClassNoteAdminRow[];
  total: number;
  page: number;
  pageSize: number;
}

export const CLASS_NOTE_PAGE_SIZE = 50;
const CLASS_NOTE_PAGE_MAX = 200;

const asObjectId = (id: string): Types.ObjectId | null =>
  Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;

/** The mongo filter behind both the page and its filter-option lists. */
async function classNoteQuery(f: ClassNoteListFilter): Promise<Record<string, unknown>> {
  const q: Record<string, unknown> = {};
  if (f.from || f.to) {
    const a = f.from ?? f.to!;
    const b = f.to ?? f.from!;
    q.date = { $gte: dayBounds(a <= b ? a : b).start, $lte: dayBounds(a <= b ? b : a).end };
  }
  if (f.subject) q.subject = f.subject;
  if (f.teacherId) {
    // An unparseable id must match NOTHING rather than everything — a filter that
    // silently drops itself would show a teacher the whole school's notes.
    q.publishedBy = asObjectId(f.teacherId) ?? new Types.ObjectId();
  }
  if (f.sectionId) {
    q.groupType = "section";
    q.groupId = asObjectId(f.sectionId) ?? new Types.ObjectId();
  } else if (f.classId) {
    // A note stores its section, not its class, so the class filter widens to the
    // class's sections.
    const secs = (await Section.find({ classId: f.classId }).select("_id").lean()) as unknown as {
      _id: Types.ObjectId;
    }[];
    q.groupType = "section";
    q.groupId = { $in: secs.map((s) => s._id) };
  }
  return q;
}

/** One page of the class-note archive, newest first, with the total behind it. */
export async function classNotePage(f: ClassNoteListFilter): Promise<ClassNotePage> {
  const pageSize = Math.min(Math.max(f.pageSize ?? CLASS_NOTE_PAGE_SIZE, 1), CLASS_NOTE_PAGE_MAX);
  const page = Math.max(f.page ?? 1, 1);
  const q = await classNoteQuery(f);
  const [notes, total] = await Promise.all([
    ClassNote.find(q)
      .sort({ date: -1, publishedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean() as unknown as Promise<IClassNote[]>,
    ClassNote.countDocuments(q),
  ]);
  return { rows: await enrichClassNotes(notes), total, page, pageSize };
}

export interface ClassNoteFilterOption {
  id: string;
  label: string;
}
export interface ClassNoteFilterOptions {
  classes: ClassNoteFilterOption[];
  /** `parentId` = the owning class id, so the UI can narrow sections to a class. */
  sections: (ClassNoteFilterOption & { parentId: string | null })[];
  subjects: string[];
  teachers: ClassNoteFilterOption[];
}

/**
 * The values that actually EXIST in the caller's slice of the archive — the house
 * rule that a select never offers an option with zero matches (D-#309). Scoped by
 * the same `teacherId` pin as the page, so a teacher's selects describe their own
 * notes only.
 */
export async function classNoteFilterOptions(scope: { teacherId?: string | null }): Promise<ClassNoteFilterOptions> {
  const base = await classNoteQuery({ teacherId: scope.teacherId ?? null });
  const [subjects, authorIds, sectionIds] = await Promise.all([
    ClassNote.distinct("subject", base) as unknown as Promise<string[]>,
    ClassNote.distinct("publishedBy", base) as unknown as Promise<Types.ObjectId[]>,
    ClassNote.distinct("groupId", { ...base, groupType: "section" }) as unknown as Promise<Types.ObjectId[]>,
  ]);

  const sections = sectionIds.length
    ? ((await Section.find({ _id: { $in: sectionIds } })
        .select("classId code nameBn")
        .lean()) as unknown as { _id: Types.ObjectId; classId?: Types.ObjectId; code?: string; nameBn?: string }[])
    : [];
  const classIds = [...new Set(sections.map((s) => s.classId?.toString()).filter((x): x is string => !!x))];
  const [classes, users] = await Promise.all([
    classIds.length
      ? (Class.find({ _id: { $in: classIds } })
          .select("level nameBn")
          .lean() as unknown as Promise<{ _id: Types.ObjectId; level?: number; nameBn?: string }[]>)
      : Promise.resolve([]),
    authorIds.length
      ? (User.find({ _id: { $in: authorIds } })
          .select("name")
          .lean() as unknown as Promise<{ _id: Types.ObjectId; name?: string }[]>)
      : Promise.resolve([]),
  ]);

  const byLabel = (a: ClassNoteFilterOption, b: ClassNoteFilterOption): number => a.label.localeCompare(b.label);
  return {
    classes: classes
      .map((c) => ({ id: c._id.toString(), label: c.nameBn ?? String(c.level ?? ""), level: c.level ?? 0 }))
      .sort((a, b) => a.level - b.level)
      .map(({ id, label }) => ({ id, label })),
    sections: sections
      .map((s) => ({
        id: s._id.toString(),
        label: s.nameBn ?? s.code ?? "—",
        parentId: s.classId ? s.classId.toString() : null,
      }))
      .sort(byLabel),
    subjects: [...subjects].sort(),
    teachers: users.map((u) => ({ id: u._id.toString(), label: u.name ?? "—" })).sort(byLabel),
  };
}

/**
 * Slots on a date that still need a class note — for ONE teacher when
 * `teacherId` is given (the R5.3 per-teacher prompt), else for EVERY teacher
 * (the N-2 ladder/escalation work-list, D-#74). One truth: the scheduler and
 * `myClassNotePrompts` both read this.
 */
export interface ClassNoteSubmissionRow {
  groupType: "section" | "subjectgroup";
  groupId: string;
  classLevel: number | null;
  classNameBn: string | null;
  sectionCode: string | null;
  sectionNameBn: string | null;
  subjectGroupNameBn: string | null;
  teacherId: string | null;
  teacherName: string | null;
  teacherPhone: string | null;
  teacherSchoolId: string | null;
  publishedSubjects: RoutineSubject[];
  pendingSubjects: RoutineSubject[];
  publishedCount: number;
  pendingCount: number;
}

/** Principal/Office view: class-note submissions for a date grouped by section or
 *  subject-group + teacher. One row collects the subjects that are already posted
 *  and the subjects still pending for that teacher's date work-list. */
export async function classNoteSubmissionReport(date: Date): Promise<ClassNoteSubmissionRow[]> {
  const dayOfWeek = DAYS_OF_WEEK[date.getDay()];
  const { start, end } = dayBounds(date);
  const slots = (await RoutineSlot.find({
    dayOfWeek,
    active: true,
    isBreak: false,
    ...liveWindow(date),
  })
    .sort({ groupType: 1, groupId: 1, periodNumber: 1 })
    .lean()) as unknown as IRoutineSlot[];
  if (slots.length === 0) return [];

  const slotIds = slots.map((s) => s._id);
  const [subs, notes] = await Promise.all([
    RoutineSubstitution.find({
      slotId: { $in: slotIds },
      active: true,
      date: { $gte: start, $lte: end },
    }).lean(),
    ClassNote.find({ slotId: { $in: slotIds }, date: { $gte: start, $lte: end } }).select("slotId").lean(),
  ]);

  const coverBySlot = new Map(subs.map((su) => [su.slotId.toString(), su.coverTeacherId.toString()]));
  const noteBySlot = new Set(notes.map((n) => n.slotId.toString()));

  const sectionIds = new Set<string>();
  const classIds = new Set<string>();
  const subjectGroupIds = new Set<string>();
  const teacherIds = new Set<string>();
  for (const s of slots) {
    const teacherId = coverBySlot.get(s._id.toString()) ?? (s.teacherId ? s.teacherId.toString() : null);
    if (teacherId) teacherIds.add(teacherId);
    if (s.groupType === "section") {
      sectionIds.add(s.groupId.toString());
      if (s.classId) classIds.add(s.classId.toString());
    } else {
      subjectGroupIds.add(s.groupId.toString());
    }
  }

  const [sections, classes, subjectGroups, users] = await Promise.all([
    sectionIds.size > 0 ? Section.find({ _id: { $in: [...sectionIds] } }).select("classId code nameBn").lean() : Promise.resolve([]),
    classIds.size > 0 ? Class.find({ _id: { $in: [...classIds] } }).select("level nameBn").lean() : Promise.resolve([]),
    subjectGroupIds.size > 0 ? SubjectGroup.find({ _id: { $in: [...subjectGroupIds] } }).select("track level nameBn code").lean() : Promise.resolve([]),
    teacherIds.size > 0 ? User.find({ _id: { $in: [...teacherIds] } }).select("name phone").lean() : Promise.resolve([]),
  ]);

  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));
  const subjectGroupById = new Map(subjectGroups.map((g) => [g._id.toString(), g]));
  const userById = new Map(users.map((u) => [u._id.toString(), u]));
  const phones = [...new Set(users.map((u) => u.phone).filter((phone): phone is string => !!phone))];
  const staffProfiles =
    phones.length > 0
      ? await StaffProfile.find({ active: true, phone: { $in: phones } }).select("phone schoolId").lean()
      : [];
  const schoolIdByPhone = new Map(staffProfiles.map((s) => [s.phone ?? "", s.schoolId]));

  type RowState = ClassNoteSubmissionRow & { sortRank: string };
  const rows = new Map<string, RowState>();

  for (const s of slots) {
    const slotId = s._id.toString();
    const teacherId = coverBySlot.get(slotId) ?? (s.teacherId ? s.teacherId.toString() : null);
    const rowKey = `${s.groupType}|${s.groupId.toString()}|${teacherId ?? "none"}`;
    const published = noteBySlot.has(slotId);
    const teacher = teacherId ? userById.get(teacherId) : null;
    const teacherSchoolId = teacher?.phone ? schoolIdByPhone.get(teacher.phone) ?? null : null;

    const existing = rows.get(rowKey);
    if (existing) {
      (published ? existing.publishedSubjects : existing.pendingSubjects).push(s.subject);
      existing.publishedCount = existing.publishedSubjects.length;
      existing.pendingCount = existing.pendingSubjects.length;
      continue;
    }

    let classLevel: number | null = null;
    let classNameBn: string | null = null;
    let sectionCode: string | null = null;
    let sectionNameBn: string | null = null;
    let subjectGroupNameBn: string | null = null;
    let sortRank = "zzzz";

    if (s.groupType === "section") {
      const section = sectionById.get(s.groupId.toString());
      const cls = section?.classId ? classById.get(section.classId.toString()) : null;
      classLevel = cls ? cls.level : null;
      classNameBn = cls?.nameBn ?? null;
      sectionCode = section?.code ?? null;
      sectionNameBn = section?.nameBn ?? null;
      sortRank = `${String(classLevel ?? 999).padStart(4, "0")}|${classNameBn ?? ""}|${sectionNameBn ?? ""}|${teacher?.name ?? ""}`;
    } else {
      const group = subjectGroupById.get(s.groupId.toString());
      subjectGroupNameBn = group?.nameBn ?? null;
      const trackRank = group?.track === "quran" ? "1" : group?.track === "arabic" ? "2" : "9";
      sortRank = `9${trackRank}|${subjectGroupNameBn ?? ""}|${teacher?.name ?? ""}`;
    }

    rows.set(rowKey, {
      groupType: s.groupType,
      groupId: s.groupId.toString(),
      classLevel,
      classNameBn,
      sectionCode,
      sectionNameBn,
      subjectGroupNameBn,
      teacherId,
      teacherName: teacher?.name ?? null,
      teacherPhone: teacher?.phone ?? null,
      teacherSchoolId,
      publishedSubjects: published ? [s.subject] : [],
      pendingSubjects: published ? [] : [s.subject],
      publishedCount: published ? 1 : 0,
      pendingCount: published ? 0 : 1,
      sortRank,
    });
  }

  return [...rows.values()]
    .sort((a, b) => a.sortRank.localeCompare(b.sortRank))
    .map(({ sortRank: _sortRank, ...row }) => row);
}

export async function unwrittenClassNoteSlots(date: Date, teacherId?: string): Promise<IRoutineSlot[]> {
  const dayOfWeek = DAYS_OF_WEEK[date.getDay()];
  // The teacher filter is applied AFTER the cover overlay below, not in the query —
  // on a covered day the person who owes the note is the one who taught it, not the
  // one the slot names (owner report 2026-08-03). Filtering in the query would both
  // miss the periods a teacher covered and wrongly keep the ones they were away for.
  const slots = (await RoutineSlot.find({
    teacherId: { $exists: true, $ne: null },
    dayOfWeek,
    active: true,
    isBreak: false,
    ...liveWindow(date),
  })
    .sort({ periodNumber: 1 })
    .lean()) as unknown as IRoutineSlot[];

  const { start, end } = dayBounds(date);
  const slotIds = slots.map((s) => s._id);

  const subs = await RoutineSubstitution.find({
    active: true,
    slotId: { $in: slotIds },
    date: { $gte: start, $lte: end },
  })
    .select("slotId coverTeacherId")
    .lean();
  const coverBySlot = new Map(subs.map((su) => [su.slotId.toString(), su.coverTeacherId]));

  const notes = await ClassNote.find({ slotId: { $in: slotIds }, date: { $gte: start, $lte: end } }).select("slotId").lean();
  const noted = new Set(notes.map((n) => n.slotId.toString()));

  return slots
    .filter((s) => !noted.has(s._id.toString()))
    // Rewrite teacherId to WHO ACTUALLY TAUGHT IT, so every caller — the push ladder,
    // the in-app prompt — addresses the right person from one place.
    .map((s) => {
      const cover = coverBySlot.get(s._id.toString());
      return cover ? ({ ...s, teacherId: cover } as IRoutineSlot) : s;
    })
    .filter((s) => (teacherId ? s.teacherId?.toString() === teacherId : true));
}

/** The teacher's slots on a date that still need a class note (R5.3 reminder). */
export async function myClassNotePrompts(date: Date, teacherId: string): Promise<IRoutineSlot[]> {
  return unwrittenClassNoteSlots(date, teacherId);
}
