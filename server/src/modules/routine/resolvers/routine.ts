/**
 * Routine module — R-1 resolvers (calendar/day-types + holidays + rooms +
 * SubjectGroups + membership + period grids + schedule windows).
 *
 * RBAC: reads gated `routine:read` (Principal/Teacher/Office), writes gated
 * `routine:manage` (Principal/Office) — D-#46. Operational/identity plane; no
 * corpus path. Slots + the conflict engine + scope binding are R-2 (not here).
 */
import { Types } from "mongoose";
import { builder } from "../../../schema";
import {
  PERIOD_TRACKS,
  SEASONS,
  GROUP_GENDERS,
  HOLIDAY_TYPES,
  type PeriodTrack,
} from "@scd/shared";
import { Room, type IRoom } from "../models/Room";
import { SubjectGroup, type ISubjectGroup } from "../models/SubjectGroup";
import { SubjectGroupMembership } from "../models/SubjectGroupMembership";
import { Student } from "../../foundation/models/Student";
import { PeriodGrid, type IPeriodGrid, type IGridPeriod } from "../models/PeriodGrid";
import { ScheduleWindow, type IScheduleWindow } from "../models/ScheduleWindow";
import { HolidayException, type IHolidayException } from "../models/HolidayException";
import { resolveDayType } from "../calendar";
import { computePeriodTimes, windowFor, dateRangesOverlap, minutesToHHMM, type ComputedPeriod } from "../schedule";

const idOf = (x: { _id: { toString(): string } }) => x._id.toString();

// ---------------------------------------------------------------------------
// Object types
// ---------------------------------------------------------------------------

const RoomRef = builder.objectRef<IRoom>("Room").implement({
  fields: (t) => ({
    id: t.string({ resolve: idOf }),
    code: t.exposeString("code"),
    nameBn: t.exposeString("nameBn"),
    capacity: t.int({ nullable: true, resolve: (r) => r.capacity ?? null }),
    active: t.exposeBoolean("active"),
  }),
});

const SubjectGroupRef = builder.objectRef<ISubjectGroup>("SubjectGroup").implement({
  fields: (t) => ({
    id: t.string({ resolve: idOf }),
    track: t.exposeString("track"),
    level: t.exposeString("level"),
    gender: t.exposeString("gender"),
    code: t.exposeString("code"),
    nameBn: t.exposeString("nameBn"),
    active: t.exposeBoolean("active"),
  }),
});

const GridPeriodRef = builder.objectRef<IGridPeriod>("GridPeriod").implement({
  fields: (t) => ({
    number: t.exposeInt("number"),
    durationMin: t.exposeInt("durationMin"),
    isBreak: t.exposeBoolean("isBreak"),
    track: t.exposeString("track"),
    nameBn: t.exposeString("nameBn"),
  }),
});

const PeriodGridRef = builder.objectRef<IPeriodGrid>("PeriodGrid").implement({
  fields: (t) => ({
    id: t.string({ resolve: idOf }),
    audienceKey: t.exposeString("audienceKey"),
    classLevels: t.exposeIntList("classLevels"),
    season: t.exposeString("season"),
    active: t.exposeBoolean("active"),
    periods: t.field({ type: [GridPeriodRef], resolve: (g) => g.periods }),
  }),
});

const ScheduleWindowRef = builder.objectRef<IScheduleWindow>("ScheduleWindow").implement({
  fields: (t) => ({
    id: t.string({ resolve: idOf }),
    academicYearId: t.string({ resolve: (w) => w.academicYearId.toString() }),
    fromDate: t.string({ resolve: (w) => new Date(w.fromDate).toISOString() }),
    toDate: t.string({ resolve: (w) => new Date(w.toDate).toISOString() }),
    season: t.exposeString("season"),
    dayStartMinutes: t.exposeInt("dayStartMinutes"),
    dayStartHHMM: t.string({ resolve: (w) => minutesToHHMM(w.dayStartMinutes) }),
    label: t.exposeString("label"),
    active: t.exposeBoolean("active"),
  }),
});

const HolidayExceptionRef = builder.objectRef<IHolidayException>("HolidayException").implement({
  fields: (t) => ({
    id: t.string({ resolve: idOf }),
    fromDate: t.string({ resolve: (h) => new Date(h.fromDate).toISOString() }),
    toDate: t.string({ resolve: (h) => new Date(h.toDate).toISOString() }),
    type: t.exposeString("type"),
    nameBn: t.exposeString("nameBn"),
    note: t.string({ nullable: true, resolve: (h) => h.note ?? null }),
    active: t.exposeBoolean("active"),
  }),
});

const ComputedPeriodRef = builder.objectRef<ComputedPeriod>("ComputedPeriod").implement({
  fields: (t) => ({
    number: t.exposeInt("number"),
    durationMin: t.exposeInt("durationMin"),
    isBreak: t.exposeBoolean("isBreak"),
    track: t.exposeString("track"),
    nameBn: t.exposeString("nameBn"),
    startHHMM: t.exposeString("startHHMM"),
    endHHMM: t.exposeString("endHHMM"),
  }),
});

interface ResolvedDay {
  dayType: string;
  season: string;
  dayStartHHMM: string;
  audienceKey: string;
  periods: ComputedPeriod[];
}

const ResolvedDayRef = builder.objectRef<ResolvedDay>("ResolvedDay").implement({
  fields: (t) => ({
    dayType: t.exposeString("dayType"),
    season: t.exposeString("season"),
    dayStartHHMM: t.exposeString("dayStartHHMM"),
    audienceKey: t.exposeString("audienceKey"),
    periods: t.field({ type: [ComputedPeriodRef], resolve: (d) => d.periods }),
  }),
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const GridPeriodInput = builder.inputType("GridPeriodInput", {
  fields: (t) => ({
    number: t.int({ required: true }),
    durationMin: t.int({ required: true }),
    isBreak: t.boolean({ required: true }),
    track: t.string({ required: true }),
    nameBn: t.string({ required: true }),
  }),
});

// ---------------------------------------------------------------------------
// Queries (routine:read)
// ---------------------------------------------------------------------------

builder.queryField("rooms", (t) =>
  t.field({
    type: [RoomRef],
    authScopes: { hasPermission: "routine:read" },
    resolve: async () => Room.find().sort({ code: 1 }).lean() as unknown as IRoom[],
  }),
);

builder.queryField("subjectGroups", (t) =>
  t.field({
    type: [SubjectGroupRef],
    authScopes: { hasPermission: "routine:read" },
    args: { track: t.arg.string({ required: false }) },
    resolve: async (_r, args) => {
      const q = args.track ? { track: args.track } : {};
      return SubjectGroup.find(q).sort({ code: 1 }).lean() as unknown as ISubjectGroup[];
    },
  }),
);

builder.queryField("subjectGroupMembers", (t) =>
  t.field({
    type: ["String"],
    authScopes: { hasPermission: "routine:read" },
    args: { groupId: t.arg.string({ required: true }) },
    resolve: async (_r, args) => {
      const rows = await SubjectGroupMembership.find({ groupId: args.groupId }).lean();
      return rows.map((m) => m.studentId.toString());
    },
  }),
);

// The members of a group WITH names — the admin "Group members" screen (R1.4)
// needs student names, and a Quran/Arabic group spans sections, so a section-scoped
// student read can't resolve them. Identity plane (studentId is already the join
// key on SubjectGroupMembership); no corpus path (ADR-005).
const GroupMemberRef = builder
  .objectRef<{ id: string; name: string; schoolId: string }>("SubjectGroupMemberProfile")
  .implement({
    fields: (t) => ({
      id: t.exposeString("id"),
      name: t.exposeString("name"),
      schoolId: t.exposeString("schoolId"),
    }),
  });

builder.queryField("subjectGroupMemberProfiles", (t) =>
  t.field({
    type: [GroupMemberRef],
    authScopes: { hasPermission: "routine:read" },
    args: { groupId: t.arg.string({ required: true }) },
    resolve: async (_r, args) => {
      const rows = await SubjectGroupMembership.find({ groupId: args.groupId }).lean();
      if (rows.length === 0) return [];
      const students = (await Student.find({ _id: { $in: rows.map((m) => m.studentId) } })
        .select("name schoolId")
        .sort({ name: 1 })
        .lean()) as unknown as Array<{ _id: { toString(): string }; name: string; schoolId: string }>;
      return students.map((s) => ({ id: s._id.toString(), name: s.name, schoolId: s.schoolId }));
    },
  }),
);

builder.queryField("periodGrids", (t) =>
  t.field({
    type: [PeriodGridRef],
    authScopes: { hasPermission: "routine:read" },
    args: { season: t.arg.string({ required: false }) },
    resolve: async (_r, args) => {
      const q = args.season ? { season: args.season } : {};
      return PeriodGrid.find(q).sort({ audienceKey: 1 }).lean() as unknown as IPeriodGrid[];
    },
  }),
);

builder.queryField("scheduleWindows", (t) =>
  t.field({
    type: [ScheduleWindowRef],
    authScopes: { hasPermission: "routine:read" },
    args: { academicYearId: t.arg.string({ required: true }) },
    resolve: async (_r, args) =>
      ScheduleWindow.find({ academicYearId: args.academicYearId })
        .sort({ fromDate: 1 })
        .lean() as unknown as IScheduleWindow[],
  }),
);

builder.queryField("holidays", (t) =>
  t.field({
    type: [HolidayExceptionRef],
    authScopes: { hasPermission: "routine:read" },
    resolve: async () =>
      HolidayException.find().sort({ fromDate: 1 }).lean() as unknown as IHolidayException[],
  }),
);

builder.queryField("dayType", (t) =>
  t.field({
    type: "String",
    authScopes: { hasPermission: "routine:read" },
    args: { date: t.arg.string({ required: true }) },
    resolve: async (_r, args) => {
      const d = new Date(args.date);
      if (isNaN(d.getTime())) throw new Error("Invalid date");
      return resolveDayType(d);
    },
  }),
);

/**
 * Resolve a full school day for a date + audience (R1.6): the day-type, the active
 * schedule window's season + day-start, and the period grid's clock times COMPUTED
 * from that day-start (D-#55). If no window covers the date, defaults to regular @
 * 07:00 (420). If no grid exists for (audience, season), periods is empty.
 */
builder.queryField("resolvedDay", (t) =>
  t.field({
    type: ResolvedDayRef,
    authScopes: { hasPermission: "routine:read" },
    args: {
      date: t.arg.string({ required: true }),
      audienceKey: t.arg.string({ required: true }),
    },
    resolve: async (_r, args): Promise<ResolvedDay> => {
      const d = new Date(args.date);
      if (isNaN(d.getTime())) throw new Error("Invalid date");
      const dayType = await resolveDayType(d);
      const windows = (await ScheduleWindow.find({ active: true }).lean()) as unknown as IScheduleWindow[];
      const win = windowFor(d, windows);
      const season = win ? win.season : "regular";
      const dayStartMinutes = win ? win.dayStartMinutes : 420;
      const grid = (await PeriodGrid.findOne({
        audienceKey: args.audienceKey,
        season,
        active: true,
      }).lean()) as unknown as IPeriodGrid | null;
      const periods = grid ? computePeriodTimes(dayStartMinutes, grid.periods) : [];
      return { dayType, season, dayStartHHMM: minutesToHHMM(dayStartMinutes), audienceKey: args.audienceKey, periods };
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations (routine:manage)
// ---------------------------------------------------------------------------

builder.mutationField("createRoom", (t) =>
  t.field({
    type: RoomRef,
    authScopes: { hasPermission: "routine:manage" },
    args: {
      code: t.arg.string({ required: true }),
      nameBn: t.arg.string({ required: true }),
      capacity: t.arg.int({ required: false }),
    },
    resolve: async (_r, args) =>
      Room.create({
        code: args.code,
        nameBn: args.nameBn,
        capacity: args.capacity ?? undefined,
      }),
  }),
);

builder.mutationField("setRoomActive", (t) =>
  t.field({
    type: RoomRef,
    authScopes: { hasPermission: "routine:manage" },
    args: {
      id: t.arg.string({ required: true }),
      active: t.arg.boolean({ required: true }),
    },
    resolve: async (_r, args) => {
      const room = await Room.findByIdAndUpdate(args.id, { active: args.active }, { new: true });
      if (!room) throw new Error("Room not found");
      return room;
    },
  }),
);

builder.mutationField("createSubjectGroup", (t) =>
  t.field({
    type: SubjectGroupRef,
    authScopes: { hasPermission: "routine:manage" },
    args: {
      track: t.arg.string({ required: true }),
      level: t.arg.string({ required: true }),
      gender: t.arg.string({ required: true }),
      code: t.arg.string({ required: true }),
      nameBn: t.arg.string({ required: true }),
    },
    resolve: async (_r, args) => {
      if (args.track !== "quran" && args.track !== "arabic")
        throw new Error("SubjectGroup track must be quran or arabic");
      if (!(GROUP_GENDERS as readonly string[]).includes(args.gender))
        throw new Error("Invalid gender");
      return SubjectGroup.create({
        track: args.track,
        level: args.level,
        gender: args.gender,
        code: args.code,
        nameBn: args.nameBn,
      });
    },
  }),
);

/**
 * Add a student to a Quran/Arabic group (R1.4). Enforces ≤1 group per TRACK per
 * student (the group carries the track, this membership row doesn't): if the
 * student is already in another group of the same track, reject.
 */
builder.mutationField("addGroupMember", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "routine:manage" },
    args: {
      groupId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_r, args) => {
      const group = await SubjectGroup.findById(args.groupId).lean();
      if (!group) throw new Error("SubjectGroup not found");
      const sameTrack = await SubjectGroup.find({ track: group.track }).select("_id").lean();
      const sameTrackIds = sameTrack.map((g) => g._id.toString());
      const existing = await SubjectGroupMembership.findOne({
        studentId: args.studentId,
        groupId: { $in: sameTrackIds },
      }).lean();
      if (existing && existing.groupId.toString() !== args.groupId)
        throw new Error(`Student is already in a ${group.track} group`);
      // `track` is denormalized so the unique (studentId, track) index is the hard
      // backstop if the check above is ever bypassed (race / direct write).
      await SubjectGroupMembership.updateOne(
        { groupId: args.groupId, studentId: args.studentId },
        {
          $setOnInsert: {
            groupId: new Types.ObjectId(args.groupId),
            studentId: new Types.ObjectId(args.studentId),
            track: group.track,
          },
        },
        { upsert: true },
      );
      return true;
    },
  }),
);

builder.mutationField("removeGroupMember", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "routine:manage" },
    args: {
      groupId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_r, args) => {
      await SubjectGroupMembership.deleteOne({ groupId: args.groupId, studentId: args.studentId });
      return true;
    },
  }),
);

/**
 * Create or replace the period grid for an (audienceKey, season) (R1.5). Validates
 * the track values + distinct period numbers + positive durations. Grids hold
 * durations only — clock times are computed from the schedule window (D-#55).
 */
builder.mutationField("upsertPeriodGrid", (t) =>
  t.field({
    type: PeriodGridRef,
    authScopes: { hasPermission: "routine:manage" },
    args: {
      audienceKey: t.arg.string({ required: true }),
      classLevels: t.arg.intList({ required: true }),
      season: t.arg.string({ required: true }),
      periods: t.arg({ type: [GridPeriodInput], required: true }),
    },
    resolve: async (_r, args) => {
      if (!(SEASONS as readonly string[]).includes(args.season))
        throw new Error("Invalid season");
      const periods: IGridPeriod[] = args.periods.map((p) => {
        if (!(PERIOD_TRACKS as readonly string[]).includes(p.track))
          throw new Error(`Invalid track: ${p.track}`);
        if (p.durationMin <= 0) throw new Error("durationMin must be > 0");
        return {
          number: p.number,
          durationMin: p.durationMin,
          isBreak: p.isBreak,
          track: p.track as PeriodTrack,
          nameBn: p.nameBn,
        };
      });
      const nums = periods.map((p) => p.number);
      if (new Set(nums).size !== nums.length) throw new Error("Period numbers must be distinct");
      const grid = await PeriodGrid.findOneAndUpdate(
        { audienceKey: args.audienceKey, season: args.season },
        { audienceKey: args.audienceKey, classLevels: args.classLevels, season: args.season, periods, active: true },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      return grid as unknown as IPeriodGrid;
    },
  }),
);

/**
 * Create a ScheduleWindow (R1.6). Rejects a window whose date range overlaps an
 * existing active window for the same academic year (windows don't overlap, D-#55).
 */
builder.mutationField("createScheduleWindow", (t) =>
  t.field({
    type: ScheduleWindowRef,
    authScopes: { hasPermission: "routine:manage" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      fromDate: t.arg.string({ required: true }),
      toDate: t.arg.string({ required: true }),
      season: t.arg.string({ required: true }),
      dayStartMinutes: t.arg.int({ required: true }),
      label: t.arg.string({ required: true }),
    },
    resolve: async (_r, args) => {
      if (!(SEASONS as readonly string[]).includes(args.season))
        throw new Error("Invalid season");
      const from = new Date(args.fromDate);
      const to = new Date(args.toDate);
      if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new Error("Invalid date");
      if (from.getTime() > to.getTime()) throw new Error("fromDate must be ≤ toDate");
      if (args.dayStartMinutes < 0 || args.dayStartMinutes > 1439)
        throw new Error("dayStartMinutes out of range");
      const existing = (await ScheduleWindow.find({
        academicYearId: args.academicYearId,
        active: true,
      }).lean()) as unknown as IScheduleWindow[];
      if (existing.some((w) => dateRangesOverlap(from, to, w.fromDate, w.toDate)))
        throw new Error("Schedule window overlaps an existing window");
      return ScheduleWindow.create({
        academicYearId: args.academicYearId,
        fromDate: from,
        toDate: to,
        season: args.season,
        dayStartMinutes: args.dayStartMinutes,
        label: args.label,
      });
    },
  }),
);

builder.mutationField("createHolidayException", (t) =>
  t.field({
    type: HolidayExceptionRef,
    authScopes: { hasPermission: "routine:manage" },
    args: {
      fromDate: t.arg.string({ required: true }),
      toDate: t.arg.string({ required: true }),
      type: t.arg.string({ required: true }),
      nameBn: t.arg.string({ required: true }),
      note: t.arg.string({ required: false }),
    },
    resolve: async (_r, args) => {
      if (!(HOLIDAY_TYPES as readonly string[]).includes(args.type))
        throw new Error("Invalid holiday type");
      const from = new Date(args.fromDate);
      const to = new Date(args.toDate);
      if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new Error("Invalid date");
      if (from.getTime() > to.getTime()) throw new Error("fromDate must be ≤ toDate");
      return HolidayException.create({
        fromDate: from,
        toDate: to,
        type: args.type,
        nameBn: args.nameBn,
        note: args.note ?? undefined,
      });
    },
  }),
);
