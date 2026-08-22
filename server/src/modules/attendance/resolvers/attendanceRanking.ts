/**
 * Attendance ranking resolvers (AR-1 — docs/prd-attendance-ranking.md).
 *
 * Two read-only queries over the two EXISTING registers; no capture, no new model.
 * Both gated `attendance:manage`, which is held by exactly Principal + Office today
 * — the owner's scoping needed no new permission (PRD §1).
 *
 * Identity/operational plane (ADR-005) — no corpus path.
 */
import { builder } from "../../../schema";
import {
  rankStudents,
  rankStaff,
  MIN_HELD_DAYS,
  type RankResult,
  type RankRow,
  type RankWindow,
  type StudentRankAxis,
  type StudentRankSort,
} from "../services/AttendanceRankingService";

const RankRowRef = builder.objectRef<RankRow>("AttendanceRankRow");
RankRowRef.implement({
  description:
    "One ranked person. `presentPct` is of HELD days (days the unit actually marked), " +
    "so `heldDays` travels with it — a rank off 4 days is not a rank off 60.",
  fields: (t) => ({
    rank: t.exposeInt("rank"),
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    unitLabel: t.exposeString("unitLabel"),
    classLabel: t.string({ nullable: true, resolve: (r) => r.classLabel ?? null }),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel ?? null }),
    heldDays: t.exposeInt("heldDays"),
    absentDays: t.exposeInt("absentDays"),
    presentPct: t.exposeFloat("presentPct"),
    lateDays: t.int({ nullable: true, resolve: (r) => r.lateDays ?? null }),
    leaveDays: t.int({ nullable: true, resolve: (r) => r.leaveDays ?? null }),
    belowFloor: t.exposeBoolean("belowFloor"),
  }),
});

const RankResultRef = builder.objectRef<RankResult>("AttendanceRanking");
RankResultRef.implement({
  fields: (t) => ({
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    unitCount: t.exposeInt("unitCount"),
    minHeldDays: t.int({ resolve: () => MIN_HELD_DAYS }),
    lastMarkedKey: t.string({ nullable: true, resolve: (r) => r.lastMarkedKey }),
    rows: t.field({ type: [RankRowRef], resolve: (r) => r.rows }),
  }),
});

builder.queryField("studentAttendanceRanking", (t) =>
  t.field({
    type: RankResultRef,
    description:
      "Rank students by present % of held days over a window. `window` ∈ week | month | " +
      "cumulative | annual; `axis` ∈ school | class | section (section register) or " +
      "group | track | level (Quran/Arabic subject-group register) — the two registers are " +
      "never mixed in one list. `axisValue` is the class/section/group id, or the track " +
      "(\"quran\"/\"arabic\") or level name. `sortBy` ∈ rank (default) | class — class regroups " +
      "the SAME numbered rows by the student’s general class and never renumbers them. " +
      "Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: {
      window: t.arg.string({ required: true }),
      anchorKey: t.arg.string({ required: true }),
      axis: t.arg.string({ required: true }),
      axisValue: t.arg.string({ required: false }),
      academicYearId: t.arg.string({ required: false }),
      sortBy: t.arg.string({ required: false }),
    },
    resolve: async (_root, args) =>
      rankStudents({
        window: args.window as RankWindow,
        anchorKey: args.anchorKey,
        axis: args.axis as StudentRankAxis,
        axisValue: args.axisValue ?? undefined,
        academicYearId: args.academicYearId ?? undefined,
        sortBy: (args.sortBy as StudentRankSort | null) ?? undefined,
      }),
  }),
);

builder.queryField("staffAttendanceRanking", (t) =>
  t.field({
    type: RankResultRef,
    description:
      "Rank staff by present % over a window, from the AT-1 biometric register. Approved " +
      "LEAVE is excluded from the denominator (leave is not absence); LATE counts as present, " +
      "is reported separately and breaks ties. Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: {
      window: t.arg.string({ required: true }),
      anchorKey: t.arg.string({ required: true }),
      academicYearId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args) =>
      rankStaff({
        window: args.window as RankWindow,
        anchorKey: args.anchorKey,
        academicYearId: args.academicYearId ?? undefined,
      }),
  }),
);
