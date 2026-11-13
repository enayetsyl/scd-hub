/**
 * find_students, student_overview (docs/prd-data-assistant-mcp.md §7 tools 3–4).
 * Contacts are never selected (layer 1): the directory's guardian phones and the profile
 * header's phone/dob/address/guardian block are dropped here; redact() drops them again.
 */
import { z } from "zod";
import { callerHasPermission } from "@scd/shared";
import { Student } from "../../foundation/models/Student";
import { loadStudentDirectory } from "../../foundation/services/StudentDirectoryService";
import { skeleton } from "../../platform/ai/deidentify";
import { assertStudentProfileRead } from "../../trackers/resolvers/studentProfile";
import { assertReportRead, holdsViewAll, STUDENT_PROFILE_REPORT_GATE } from "../../trackers/resolvers/classTestSummary";
import { studentProfileAttendance, studentProfileComments, studentProfileHeader } from "../../trackers/services/StudentProfileContextService";
import { wholePicture } from "../../trackers/services/WholePictureService";
import { assertRule } from "../gates";
import { LONG_TEXT_CAP, wrapUntrusted } from "../untrusted";
import { ToolInvalid, type ToolDef } from "../types";
import { addDays, cap, checkRange, classLabelBn, CLASS_LEVEL, DATE_KEY, iso, limitArg, NAME_QUERY, OBJECT_ID } from "./common";

const FIND_STUDENTS_GATE = { anyOf: ["students:view_all"] } as const;

/** Bangla-variant tolerant match: exact substring, or the spelling-blind skeleton of each word. */
function nameMatches(q: string, ...names: Array<string | null | undefined>): boolean {
  const needle = q.trim().toLowerCase();
  const sk = needle.split(/\s+/).map(skeleton).filter(Boolean);
  return names.some((n) => {
    if (!n) return false;
    const hay = n.toLowerCase();
    if (hay.includes(needle)) return true;
    if (sk.length === 0) return false;
    const words = hay.split(/\s+/).map(skeleton);
    return sk.every((s) => words.some((w) => w.includes(s)));
  });
}

export const findStudents: ToolDef = {
  name: "find_students",
  label_bn: "শিক্ষার্থী খোঁজা",
  label_en: "Find students",
  description:
    "Find a student by name (English or Bangla) or school ID, or list a class / section roster (শিক্ষার্থী, ছাত্র, ছাত্রী, শ্রেণি, শাখা, তালিকা). " +
    "Returns student_id (use it with other tools), school ID, names, class and section labels, and each guardian's relation " +
    "(the guardian's name only for people allowed to see guardians). Never returns phone numbers, addresses or dates of birth.",
  input: {
    query: NAME_QUERY.optional().describe("part of a name in English or Bangla, or a school ID"),
    class_level: CLASS_LEVEL.optional(),
    section_id: OBJECT_ID.optional(),
    limit: limitArg(25, 100).optional(),
  },
  gates: [{ mode: "default", rule: FIND_STUDENTS_GATE, resolver: { file: "modules/foundation/resolvers/students.ts", field: "studentDirectory" } }],
  maxRows: 100,
  async run(ctx, a) {
    assertRule(ctx.auth, FIND_STUDENTS_GATE);
    const args = a as { query?: string; class_level?: number; section_id?: string; limit?: number };
    const showGuardianNames = callerHasPermission(ctx.auth, "guardians:view_all");
    const rows = (await loadStudentDirectory()).filter(
      (r) =>
        (args.class_level === undefined || r.classLevel === args.class_level) &&
        (!args.section_id || r.sectionId === args.section_id) &&
        (!args.query || r.schoolId.toLowerCase() === args.query.trim().toLowerCase() || nameMatches(args.query, r.name, r.nameBn)),
    );
    const c = cap(rows, args.limit ?? 25);
    return {
      data: c.rows.map((r) => ({
        student_id: r.id,
        school_id: r.schoolId,
        name: r.name,
        name_bn: r.nameBn,
        class_level: r.classLevel,
        class_label_bn: r.classNameBn ?? classLabelBn(r.classLevel),
        section_id: r.sectionId,
        section_code: r.sectionCode,
        section_label_bn: r.sectionNameBn,
        quran_group: r.quranGroup?.nameBn ?? null,
        arabic_group: r.arabicGroup?.nameBn ?? null,
        // Q3: relation always; name only with guardians:view_all; never a contact.
        guardians: r.guardians.map((g) => (showGuardianNames ? { relation: g.relation, name: g.name } : { relation: g.relation })),
      })),
      rowCount: c.rows.length,
      truncated: c.truncated,
      total: c.total,
    };
  },
};

const OVERVIEW_GATE = { anyOf: ["student_profile:view"] } as const;

export const studentOverview: ToolDef = {
  name: "student_overview",
  label_bn: "শিক্ষার্থীর অবস্থা",
  label_en: "Student overview",
  description:
    "How is one student doing? (কেমন করছে, অগ্রগতি, উপস্থিতি, বাড়ির কাজ, ক্লাস টেস্ট, মন্তব্য). Needs student_id from find_students. " +
    "Returns the header (name, class, section, class teacher), attendance for the window (default last 30 days, at most 366), " +
    "the 90-day whole picture (homework, assignments, class tests, signals) and, with include_comments, up to 20 newest teacher comments " +
    "as untrusted_text. Never returns contacts, guardians' details or support/welfare records.",
  input: {
    student_id: OBJECT_ID,
    from: DATE_KEY.optional(),
    to: DATE_KEY.optional(),
    include_comments: z.boolean().optional(),
  },
  gates: [{ mode: "default", rule: OVERVIEW_GATE, resolver: { file: "modules/trackers/resolvers/studentProfile.ts", field: "studentProfileHeader" } }],
  maxRows: 20,
  async run(ctx, a) {
    assertRule(ctx.auth, OVERVIEW_GATE);
    const args = a as { student_id: string; from?: string; to?: string; include_comments?: boolean };
    const to = args.to ?? ctx.today;
    const from = args.from ?? addDays(to, -29);
    checkRange(from, to, 366);
    // The screen's row check (same call, same window anchor as studentProfileAttendance).
    await assertStudentProfileRead(ctx.app, args.student_id, { onKey: to });
    const h = await studentProfileHeader(args.student_id, new Date());
    const att = await studentProfileAttendance(args.student_id, from, to);
    // studentWholePicture's own row check (today's section).
    if (!holdsViewAll(ctx.app, STUDENT_PROFILE_REPORT_GATE)) {
      const s = (await Student.findById(args.student_id).select("sectionId").lean()) as { sectionId?: unknown } | null;
      if (!s?.sectionId) throw new ToolInvalid("Student not found.");
      await assertReportRead(ctx.app, String(s.sectionId), { gate: STUDENT_PROFILE_REPORT_GATE });
    }
    const wp = await wholePicture(args.student_id);
    const out: Record<string, unknown> = {
      header: {
        student_id: h.studentId,
        school_id: h.schoolId,
        name: h.name,
        name_bn: h.nameBn,
        class_level: h.classLevel,
        class_label_bn: classLabelBn(h.classLevel),
        section_id: h.sectionId,
        section_label_bn: h.sectionNameBn,
        class_teacher: h.classTeacherName,
      },
      attendance: {
        from: att.fromKey,
        to: att.toKey,
        marked_days: att.markedDays,
        absent_days: att.absentDays,
        absent_not_on_leave: att.absentUncoveredDays,
        longest_absent_streak: att.absentStreakMax,
        present_pct: att.presentPct,
        trajectory: att.trajectory,
        leave_count: att.leaves.length,
        monthly: att.monthly.map((m) => ({ month: m.monthKey, marked_days: m.markedDays, absent_days: m.absentDays, present_pct: m.presentPct })),
      },
      last_90_days: {
        from: wp.fromKey,
        to: wp.toKey,
        homework: { given: wp.homework.total, done: wp.homework.done, open: wp.homework.open, chased: wp.homework.chased, completion_pct: wp.homework.completionPct },
        assignments: { given: wp.assignment.total, pending: wp.assignment.pending, late: wp.assignment.late, avg_marks_pct: wp.assignment.avgMarksPct },
        class_tests: {
          exams_present: wp.classTest.examsPresent,
          avg_pct: wp.classTest.avgPercent,
          trajectory: wp.classTest.trajectory,
          at_risk: wp.classTest.atRisk,
          best_subject: wp.classTest.bestSubject,
          weakest_subject: wp.classTest.weakestSubject,
          latest_rank: wp.classTest.latestRank,
          latest_rank_of: wp.classTest.latestRankOf,
          class_avg_pct: wp.classTest.classAvgPercent,
        },
        signals: [...wp.signals],
        overall: wp.overall,
      },
    };
    let rowCount = 1;
    if (args.include_comments) {
      // The profile's comments tab: same query gate + the same assertStudentProfileRead above.
      const c = await studentProfileComments(args.student_id, from, to);
      const newest = [...c.comments].sort((x, y) => +new Date(y.createdAt) - +new Date(x.createdAt)).slice(0, 20);
      out.comments = {
        count: c.tally.total,
        concern: c.tally.concern,
        positive: c.tally.positive,
        items: newest.map((m) => ({
          date: iso(m.createdAt)?.slice(0, 10) ?? null,
          author: m.authorName,
          type: m.type,
          sentiment: m.sentiment,
          text: wrapUntrusted(m.text, LONG_TEXT_CAP),
        })),
      };
      rowCount += newest.length;
    }
    return { data: out, rowCount };
  },
};
