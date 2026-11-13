/**
 * attendance_day, student_attendance_history, attendance_ranking (docs/prd-data-assistant-mcp.md
 * §7 tools 5–7). Gates and row checks are the attendance screens' own.
 */
import { z } from "zod";
import { callerHasPermission } from "@scd/shared";
import { Class } from "../../foundation/models/Class";
import { currentYearFilter } from "../../foundation/services/currentYear";
import { Student } from "../../foundation/models/Student";
import { assertSectionReportAccess } from "../../attendance/resolvers/studentAttendance";
import { absenteeReport, studentAttendanceHistory, unmarkedSections } from "../../attendance/services/AttendanceReportService";
import { rankStaff, rankStudents } from "../../attendance/services/AttendanceRankingService";
import { assertRule, gateOf } from "../gates";
import { ToolInvalid, type ToolDef } from "../types";
import { cap, checkDay, checkRange, classLabelBn, CLASS_LEVEL, DATE_KEY, limitArg, OBJECT_ID } from "./common";

const DAY_GATE = { anyOf: ["attendance:view_all", "reports:attendance"] } as const;

export const attendanceDay: ToolDef = {
  name: "attendance_day",
  label_bn: "দিনের উপস্থিতি",
  label_en: "Attendance of a day",
  description:
    "Student attendance for one day (উপস্থিতি, অনুপস্থিত, কারা আসেনি, হাজিরা নেওয়া হয়নি): totals, per class and section, the absent students " +
    "(with whether a leave covers them) and the sections not marked yet. date defaults to today (Dhaka); at most 400 days back. Staff attendance is staff_attendance.",
  input: {
    date: DATE_KEY.optional(),
    class_level: CLASS_LEVEL.optional(),
    section_id: OBJECT_ID.optional(),
    include_absentees: z.boolean().optional(),
  },
  gates: [{ mode: "default", rule: DAY_GATE, resolver: { file: "modules/attendance/resolvers/studentAttendance.ts", field: "absenteeReport" } }],
  maxRows: 200,
  async run(ctx, a) {
    assertRule(ctx.auth, DAY_GATE);
    const args = a as { date?: string; class_level?: number; section_id?: string; include_absentees?: boolean };
    const date = args.date ?? ctx.today;
    checkDay(date, ctx.today, 400);
    const classes = (await absenteeReport(date)).filter((c) => args.class_level === undefined || c.classLevel === args.class_level);
    const sections = classes.flatMap((c) =>
      c.sections.filter((s) => !args.section_id || s.sectionId === args.section_id).map((s) => ({ c, s })),
    );
    const present = sections.reduce((n, x) => n + x.s.presentCount, 0);
    const absent = sections.reduce((n, x) => n + x.s.absentCount, 0);
    const absentees = sections.flatMap(({ c, s }) =>
      s.absentees.map((p) => ({
        student_id: p.studentId,
        school_id: p.schoolId,
        name: p.name,
        name_bn: p.nameBn,
        class_level: c.classLevel,
        class_label_bn: c.classNameBn ?? classLabelBn(c.classLevel),
        section_id: s.sectionId,
        section_label_bn: s.sectionNameBn,
        leave_covered: p.leaveCovered,
      })),
    );
    const leave = absentees.filter((x) => x.leave_covered).length;
    const unmarked = (await unmarkedSections(date)).filter(
      (u) => (args.class_level === undefined || u.classLevel === args.class_level) && (!args.section_id || u.sectionId === args.section_id),
    );
    const capped = cap(absentees, 200);
    return {
      data: {
        date,
        totals: { present, absent, of_them_on_leave: leave, rate_pct: present + absent ? Math.round((present / (present + absent)) * 1000) / 10 : null },
        by_class: classes.map((c) => ({ class_level: c.classLevel, class_label_bn: c.classNameBn ?? classLabelBn(c.classLevel), present: c.presentCount, absent: c.absentCount })),
        by_section: sections.map(({ c, s }) => ({ section_id: s.sectionId, class_label_bn: c.classNameBn ?? classLabelBn(c.classLevel), section_code: s.sectionCode, section_label_bn: s.sectionNameBn, present: s.presentCount, absent: s.absentCount })),
        ...(args.include_absentees === false ? {} : { absentees: capped.rows }),
        unmarked_sections: unmarked.map((u) => ({ section_id: u.sectionId, class_label_bn: u.classNameBn ?? classLabelBn(u.classLevel), section_label_bn: u.sectionNameBn, marker: u.markerName })),
      },
      rowCount: (args.include_absentees === false ? 0 : capped.rows.length) + unmarked.length,
      truncated: args.include_absentees !== false && capped.truncated,
      total: absentees.length,
    };
  },
};

const HISTORY_GATE = { anyOf: ["attendance:view", "attendance:view_all"] } as const;

export const studentAttendanceHistoryTool: ToolDef = {
  name: "student_attendance_history",
  label_bn: "শিক্ষার্থীর উপস্থিতির ইতিহাস",
  label_en: "A student's attendance history",
  description:
    "One student's day-by-day attendance between two dates (উপস্থিতির ইতিহাস, কতদিন অনুপস্থিত). Needs student_id from find_students; at most 366 days.",
  input: { student_id: OBJECT_ID, from: DATE_KEY, to: DATE_KEY },
  gates: [{ mode: "default", rule: HISTORY_GATE, resolver: { file: "modules/attendance/resolvers/studentAttendance.ts", field: "studentAttendanceHistory" } }],
  maxRows: 366,
  async run(ctx, a) {
    assertRule(ctx.auth, HISTORY_GATE);
    const args = a as { student_id: string; from: string; to: string };
    checkRange(args.from, args.to, 366);
    // The resolver's row check, unchanged: view_all, else the section's class teacher.
    if (!callerHasPermission(ctx.auth, "attendance:view_all")) {
      const s = (await Student.findById(args.student_id).select("sectionId").lean()) as { sectionId?: unknown } | null;
      if (!s?.sectionId) throw new ToolInvalid("Student not found.");
      await assertSectionReportAccess(ctx.app, String(s.sectionId));
    }
    const h = await studentAttendanceHistory(args.student_id, args.from, args.to);
    return {
      data: {
        student_id: h.studentId,
        from: args.from,
        to: args.to,
        totals: { marked_days: h.markedDays, absent_days: h.absentDays, present_pct: h.presentPct },
        days: h.days.map((d) => ({ date: d.dateKey, status: d.absent ? (d.leaveCovered ? "leave" : "absent") : "present" })),
      },
      rowCount: h.days.length,
    };
  },
};

const RANK_STUDENTS = { anyOf: ["attendance:view_all", "reports:attendance_ranking"] } as const;
const RANK_STAFF = { anyOf: ["staff_attendance:view_all", "reports:attendance_ranking"] } as const;

export const attendanceRanking: ToolDef = {
  name: "attendance_ranking",
  label_bn: "উপস্থিতির র‍্যাংকিং",
  label_en: "Attendance ranking",
  description:
    "Who has the lowest or highest attendance (সবচেয়ে কম/বেশি উপস্থিতি, র‍্যাংকিং) — students or staff — over a week, a month, or the school year so far. " +
    "window: week | month | year. anchor (a date in the window) defaults to today.",
  input: {
    who: z.enum(["students", "staff"]),
    window: z.enum(["week", "month", "year"]),
    anchor: DATE_KEY.optional(),
    order: z.enum(["lowest", "highest"]).optional(),
    class_level: CLASS_LEVEL.optional(),
    limit: limitArg(20, 50).optional(),
  },
  gates: [
    { mode: "students", rule: RANK_STUDENTS, resolver: { file: "modules/attendance/resolvers/attendanceRanking.ts", field: "studentAttendanceRanking" } },
    { mode: "staff", rule: RANK_STAFF, resolver: { file: "modules/attendance/resolvers/attendanceRanking.ts", field: "staffAttendanceRanking" } },
  ],
  maxRows: 50,
  async run(ctx, a) {
    const args = a as { who: "students" | "staff"; window: "week" | "month" | "year"; anchor?: string; order?: "lowest" | "highest"; class_level?: number; limit?: number };
    assertRule(ctx.auth, gateOf(attendanceRanking, args.who));
    const window = args.window === "year" ? "cumulative" : args.window;
    const anchorKey = args.anchor ?? ctx.today;
    let classId: string | undefined;
    if (args.who === "students" && args.class_level !== undefined) {
      // axis "level" would filter Quran SubjectGroup.level, not the class: resolve this year's class.
      const cls = (await Class.find({ ...(await currentYearFilter()), level: args.class_level, active: { $ne: false } }).select("_id").sort({ _id: 1 }).limit(1).lean()) as Array<{ _id: unknown }>;
      if (cls.length === 0) throw new ToolInvalid("No class at that level in the current academic year.");
      classId = String(cls[0]._id);
    }
    const res =
      args.who === "students"
        ? await rankStudents({ window, anchorKey, axis: classId ? "class" : "school", axisValue: classId })
        : await rankStaff({ window, anchorKey });
    const sorted = [...res.rows].sort((x, y) => (args.order === "highest" ? y.presentPct - x.presentPct : x.presentPct - y.presentPct));
    const c = cap(sorted, args.limit ?? 20);
    return {
      data: {
        from: res.fromKey,
        to: res.toKey,
        order: args.order ?? "lowest",
        rows: c.rows.map((r) => ({
          id: r.id,
          name: r.name,
          ...(args.who === "students" ? { class_label_bn: r.classLabel ?? null, unit: r.unitLabel } : { unit: r.unitLabel }),
          held_days: r.heldDays,
          absent_days: r.absentDays,
          present_pct: r.presentPct,
          late_days: r.lateDays ?? null,
          leave_days: r.leaveDays ?? null,
          too_few_days: r.belowFloor,
        })),
      },
      rowCount: c.rows.length,
      truncated: c.truncated,
      total: c.total,
    };
  },
};
