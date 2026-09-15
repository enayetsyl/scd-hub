/**
 * liveClassBoard resolver — the Principal/Office "who is teaching what right now"
 * read (D-#670). One gated query serves both surfaces the owner asked for: the Today
 * card (the periods running this minute) and the full class × period day board.
 *
 * Gate: `routine:manage` — held by PRINCIPAL and OFFICE only, and permission-shaped
 * rather than role-shaped so a per-user grant (AC-1/D-#193) reaches it too. The board
 * names every teacher in the school against every class, which is oversight data, not
 * the row-scoped `routine:read` a teacher holds for their own timetable.
 */
import { builder } from "../../../schema";
import {
  liveClassBoard,
  type LiveClassBoard,
  type LiveClassCell,
  type LiveBoardPeriod,
  type LiveBoardRow,
} from "../services/LiveClassBoardService";

const LiveClassCellRef = builder.objectRef<LiveClassCell>("LiveClassCell").implement({
  description:
    "One class meeting on the board: the routine's teacher, the APPROVED cover teacher " +
    "when there is one, and whether anybody is actually taking it (D-#670).",
  fields: (t) => ({
    slotId: t.exposeString("slotId"),
    groupType: t.exposeString("groupType"),
    groupId: t.exposeString("groupId"),
    groupName: t.string({ nullable: true, resolve: (c) => c.groupName }),
    classLevel: t.int({ nullable: true, resolve: (c) => c.classLevel }),
    periodNumber: t.exposeInt("periodNumber"),
    startTime: t.string({ nullable: true, resolve: (c) => c.startTime }),
    endTime: t.string({ nullable: true, resolve: (c) => c.endTime }),
    subject: t.exposeString("subject"),
    track: t.exposeString("track"),
    teacherId: t.string({ nullable: true, resolve: (c) => c.teacherId }),
    teacherName: t.string({ nullable: true, resolve: (c) => c.teacherName }),
    coverTeacherId: t.string({ nullable: true, resolve: (c) => c.coverTeacherId }),
    coverTeacherName: t.string({ nullable: true, resolve: (c) => c.coverTeacherName }),
    pendingCoverTeacherName: t.string({ nullable: true, resolve: (c) => c.pendingCoverTeacherName }),
    coverSlotStatus: t.string({ nullable: true, resolve: (c) => c.coverSlotStatus }),
    absenceReason: t.string({ nullable: true, resolve: (c) => c.absenceReason }),
    status: t.string({ resolve: (c) => c.status }),
    phase: t.string({ resolve: (c) => c.phase }),
  }),
});

const LiveBoardPeriodRef = builder.objectRef<LiveBoardPeriod>("LiveBoardPeriod").implement({
  fields: (t) => ({
    periodNumber: t.exposeInt("periodNumber"),
    startTime: t.exposeString("startTime"),
    endTime: t.exposeString("endTime"),
    isBreak: t.exposeBoolean("isBreak"),
    phase: t.string({ resolve: (p) => p.phase }),
  }),
});

const LiveBoardRowRef = builder.objectRef<LiveBoardRow>("LiveBoardRow").implement({
  fields: (t) => ({
    groupType: t.exposeString("groupType"),
    groupId: t.exposeString("groupId"),
    label: t.exposeString("label"),
    sublabel: t.string({ nullable: true, resolve: (r) => r.sublabel }),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel }),
  }),
});

const LiveClassBoardRef = builder.objectRef<LiveClassBoard>("LiveClassBoard").implement({
  description: "The day's class × period board with the live period marked (D-#670).",
  fields: (t) => ({
    date: t.exposeString("date"),
    dayType: t.exposeString("dayType"),
    season: t.exposeString("season"),
    dayStartHHMM: t.exposeString("dayStartHHMM"),
    nowHHMM: t.exposeString("nowHHMM"),
    periods: t.field({ type: [LiveBoardPeriodRef], resolve: (b) => b.periods }),
    rows: t.field({ type: [LiveBoardRowRef], resolve: (b) => b.rows }),
    cells: t.field({ type: [LiveClassCellRef], resolve: (b) => b.cells }),
    liveCount: t.exposeInt("liveCount"),
    uncoveredNowCount: t.exposeInt("uncoveredNowCount"),
    uncoveredTodayCount: t.exposeInt("uncoveredTodayCount"),
  }),
});

builder.queryField("liveClassBoard", (t) =>
  t.field({
    type: LiveClassBoardRef,
    description:
      "Class-wise, period-wise teacher/cover board for a date, with the currently " +
      "running period marked — the Principal/Office live-class view (D-#670).",
    authScopes: { hasPermission: "routine:manage" },
    args: { date: t.arg.string({ required: true }) },
    resolve: (_root, args) => liveClassBoard(args.date),
  }),
);
