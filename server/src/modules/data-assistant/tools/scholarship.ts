/**
 * scholarship_analysis (owner 16 Nov 2026; docs/prd-data-assistant-mcp.md).
 * Which question types / chapters is the scholarship class weak in, class-wide and per student.
 * It reuses ScholarshipAnalysisService (the reliability floor, bands, ABSENT-is-not-zero) and adds
 * no maths of its own beyond pooling the service's own tallies per subject. Numbers only: no item
 * text, no teacher note, no comment, no contact is ever selected.
 * Gate = the scholarshipStudent / scholarshipClass resolvers' `scholarship_practice:view`
 * (catalogue alias `scholarship:read`); those resolvers apply no extra row scope, so neither do we.
 */
import { z } from "zod";
import { Types } from "mongoose";
import { Student } from "../../foundation/models/Student";
import { loadStudentDirectory } from "../../foundation/services/StudentDirectoryService";
import { practiceHintBn } from "../../scholarship/practiceHint";
import { ScholarshipPaper } from "../../scholarship/models/ScholarshipPaper";
import {
  classAnalysis,
  labelLookup,
  loadScope,
  narrowToSubject,
  percentOf,
  rankBy,
  sittingRosterFilter,
  studentAnalysis,
  tallyStudent,
  type AnalysisScope,
  type AxisRow,
  type PaperWithScores,
} from "../../scholarship/services/ScholarshipAnalysisService";
import { assertRule } from "../gates";
import { ToolInvalid, type ToolDef } from "../types";
import { cap, currentSections, DATE_KEY, NAME_QUERY, SUBJECT } from "./common";
import { nameMatches } from "./students";

const GATE = { anyOf: ["scholarship_practice:view"] } as const;
const SUBJECTS = ["BAN", "ENG", "MATH", "SCI", "BGS"] as const;
const r1 = (x: number) => Math.round(x * 10) / 10;

type Tot = { e: number; a: number };

/** Per student → per subject marks on the TOPIC axis (it partitions, so it reconciles to the paper total). */
function subjectTotals(data: readonly PaperWithScores[], studentIds: readonly string[]): Map<string, Map<string, Tot>> {
  const out = new Map<string, Map<string, Tot>>();
  for (const sid of studentIds) {
    const per = new Map<string, Tot>();
    for (const t of tallyStudent(data, sid, "topic").values()) {
      const cur = per.get(t.subject) ?? { e: 0, a: 0 };
      cur.e += t.earned.reduce((x, y) => x + y, 0);
      cur.a += t.available.reduce((x, y) => x + y, 0);
      per.set(t.subject, cur);
    }
    out.set(sid, per);
  }
  return out;
}

const pct = (t: Tot | undefined): number | null => (t ? percentOf(t.e, t.a) : null);

export const scholarshipAnalysis: ToolDef = {
  name: "scholarship_analysis",
  label_bn: "বৃত্তি প্রস্তুতির বিশ্লেষণ",
  label_en: "Scholarship weakness analysis",
  description:
    "Scholarship practice (Class 5) weakness analysis: which question types or chapters are weak (বৃত্তি, বৃত্তি পরীক্ষা, দুর্বলতা, দুর্বল প্রশ্নের ধরন, অধ্যায়, অনুশীলন, শিক্ষার্থীভিত্তিক). " +
    "Without `student`: the class overview (papers scored and class average per subject, the 2 weakest question types per subject, one line per sitting student). " +
    "With `student` (name fragment or school ID): that child's overall %, per-paper trend with the exact marks (marks_obtained out of full_marks, plus %), per-subject vs class, 2 weakest types per subject with a Bangla practice hint, strengths, " +
    "and types with too little data (never called weak). Absent papers are not zeros. Numbers only: never returns question text, teacher notes or comments.",
  input: {
    class_level: z.number().int().min(1).max(5).optional().describe("scholarship class, default 5"),
    student: NAME_QUERY.optional().describe("part of a name (English or Bangla) or a school ID"),
    subject: SUBJECT.optional().describe("BAN, ENG, MATH, SCI or BGS"),
    axis: z.enum(["topic", "chapter"]).optional().describe("question type (default) or chapter"),
  },
  gates: [{ mode: "default", rule: GATE, resolver: { file: "modules/scholarship/resolvers/scholarship.ts", field: "scholarshipStudent" } }],
  maxRows: 60,
  async run(ctx, a) {
    assertRule(ctx.auth, GATE);
    const args = a as { class_level?: number; student?: string; subject?: string; axis?: "topic" | "chapter" };
    const classLevel = args.class_level ?? 5;
    const axis = args.axis ?? "topic";
    const subject = args.subject ? args.subject.toUpperCase() : undefined;
    if (subject && !(SUBJECTS as readonly string[]).includes(subject)) throw new ToolInvalid("subject must be one of BAN, ENG, MATH, SCI, BGS.");

    const anchor = (await currentSections(classLevel))[0];
    if (!anchor) return { data: { class_level: classLevel, note: "No active class of this level in the current year." }, rowCount: 0 };
    const scope: AnalysisScope = { classLevel, sectionId: anchor.sectionId, subject: subject as AnalysisScope["subject"] };

    const roster = (await Student.find(await sittingRosterFilter(anchor.sectionId)).select("_id schoolId name nameBn").lean()) as Array<{
      _id: Types.ObjectId;
      schoolId?: string;
      name?: string;
      nameBn?: string;
    }>;
    const ids = roster.map((s) => String(s._id));
    const data: PaperWithScores[] = narrowToSubject(await loadScope(scope), scope.subject);
    const subjectsShown = subject ? [subject] : [...SUBJECTS];
    const totals = subjectTotals(data, ids);

    const classTot = (sub: string): Tot => {
      const t: Tot = { e: 0, a: 0 };
      for (const per of totals.values()) {
        const x = per.get(sub);
        if (x) {
          t.e += x.e;
          t.a += x.a;
        }
      }
      return t;
    };
    const papersBySubject = (sub: string) => data.filter(({ paper }) => paper.items.some((i) => i.subject === sub)).length;

    if (!args.student) {
      const cls = await classAnalysis(scope, axis);
      const bySub = new Map<string, Array<{ type: string; class_percent: number; band: string; marks_available: number }>>();
      for (const row of cls.rows) {
        if (row.band === "insufficient" || row.classPercent === null || row.band === "good") continue;
        const list = bySub.get(row.subject) ?? [];
        list.push({ type: row.label, class_percent: row.classPercent, band: row.band, marks_available: row.cells.reduce((s, c) => s + c.available, 0) });
        bySub.set(row.subject, list);
      }
      const papersSatOf = (sid: string) =>
        data.filter(({ paper, scores }) => paper.items.length > 0 && scores.some((s) => String(s.studentId) === sid && s.status === "PRESENT")).length;
      const students = roster
        .map((s) => {
          const id = String(s._id);
          const per = totals.get(id) ?? new Map<string, Tot>();
          const all = [...per.values()].reduce((x, y) => ({ e: x.e + y.e, a: x.a + y.a }), { e: 0, a: 0 });
          const subs = [...per.entries()].map(([k, v]) => ({ k, p: pct(v) })).filter((x): x is { k: string; p: number } => x.p !== null);
          subs.sort((x, y) => x.p - y.p);
          return {
            student_id: id,
            school_id: s.schoolId ?? null,
            name: s.name ?? s.nameBn ?? "—",
            overall_percent: all.a > 0 ? r1((all.e / all.a) * 100) : null,
            papers_sat: papersSatOf(id),
            weakest_subject: subs[0]?.k ?? null,
          };
        })
        .sort((x, y) => (x.overall_percent ?? 101) - (y.overall_percent ?? 101));
      const c = cap(students, 60);
      return {
        data: {
          class_level: classLevel,
          axis,
          sitting_students: students.length,
          subjects: subjectsShown.map((sub) => {
            const n = papersBySubject(sub);
            return {
              subject: sub,
              papers_scored: n,
              class_average_percent: pct(classTot(sub)),
              ...(n < 2 ? { note: "fewer than 2 papers — read with care" } : {}),
              weakest_types: (bySub.get(sub) ?? []).slice(0, 2),
            };
          }),
          students: c.rows,
        },
        rowCount: c.rows.length,
        truncated: c.truncated,
        total: c.total,
      };
    }

    // ---- one student -------------------------------------------------------------------
    const q = args.student.trim().toLowerCase();
    const dir = (await loadStudentDirectory()).filter(
      (r) => r.classLevel === classLevel && (r.schoolId.toLowerCase() === q || nameMatches(args.student!, r.name, r.nameBn)),
    );
    if (dir.length === 0) throw new ToolInvalid("No student of this class matches that name or school ID.");
    const exact = dir.filter((r) => r.schoolId.toLowerCase() === q);
    const pick = exact.length === 1 ? exact : dir;
    if (pick.length > 1) {
      const c = cap(pick, 10);
      return {
        data: {
          ambiguous: true,
          message: "More than one student matches — ask which one, then call again with the school ID.",
          candidates: c.rows.map((r) => ({ student_id: r.id, school_id: r.schoolId, name: r.name, name_bn: r.nameBn, section_label_bn: r.sectionNameBn })),
        },
        rowCount: c.rows.length,
        truncated: c.truncated,
        total: c.total,
      };
    }
    const st = pick[0];
    if (!ids.includes(st.id)) return { data: { student: { student_id: st.id, school_id: st.schoolId, name: st.name }, note: "This child is not on the scholarship sitting list." }, rowCount: 1 };

    const an = await studentAnalysis(scope, st.id);
    const fullMarksOf = new Map(data.map(({ paper }) => [String(paper._id), paper.items.reduce((s, i) => s + i.marks, 0)]));
    const rows: AxisRow[] = axis === "chapter" ? an.chapters : an.topics;
    const mine = totals.get(st.id) ?? new Map<string, Tot>();
    const hint = (r: AxisRow) => (axis === "topic" ? practiceHintBn(r.label, r.subject) : null);
    const graded = rows.filter((r) => r.percent !== null && r.band !== "insufficient");
    const weak = subjectsShown.flatMap((sub) =>
      graded
        .filter((r) => r.subject === sub && (r.band === "weak" || r.band === "fair"))
        .sort((x, y) => (x.percent ?? 0) - (y.percent ?? 0))
        .slice(0, 2)
        .map((r) => ({
          subject: sub,
          type: r.label,
          percent: r.percent,
          band: r.band,
          class_percent: r.classPercent,
          marks_available: r.available,
          practice_hint_bn: hint(r),
        })),
    );
    const strengths = graded
      .filter((r) => r.band === "good")
      .sort((x, y) => (y.percent ?? 0) - (x.percent ?? 0))
      .slice(0, 4)
      .map((r) => ({ subject: r.subject, type: r.label, percent: r.percent, class_percent: r.classPercent }));
    const notEnough = rows
      .filter((r) => r.band === "insufficient")
      .map((r) => ({ subject: r.subject, type: r.label, marks_available: r.available }))
      .slice(0, 20);
    return {
      data: {
        student: { student_id: st.id, school_id: st.schoolId, name: st.name, name_bn: st.nameBn },
        class_level: classLevel,
        axis,
        overall_percent: an.overallPercent,
        papers_sat: an.papersSat,
        // Exact marks, not only %: marks_obtained / marks_out_of are summed over the items this
        // child was marked on (the same base the % uses); full_marks is the paper's whole total
        // in scope, and differs only when some item has no mark entered for her.
        paper_trend: an.papers.map((p) => {
          const full = fullMarksOf.get(p.paperId) ?? p.available;
          return {
            paper: p.label,
            date: p.date,
            marks_obtained: p.earned,
            marks_out_of: p.available,
            full_marks: full,
            ...(p.available < full ? { note: "some items have no mark entered" } : {}),
            percent: p.percent,
          };
        }),
        subjects: subjectsShown
          .filter((sub) => mine.has(sub))
          .map((sub) => ({ subject: sub, percent: pct(mine.get(sub)), class_percent: pct(classTot(sub)), papers_scored: papersBySubject(sub) })),
        weakest_types: weak,
        strengths,
        not_enough_data: notEnough,
      },
      rowCount: weak.length + strengths.length + notEnough.length + 1,
    };
  },
};

// ---------------------------------------------------------------------------
// scholarship_results — the plain results table (owner 17 Nov 2026)
// ---------------------------------------------------------------------------

type ResultItem = { item_no: number; subject: string; type: string; marks_available: number; marks_obtained: number | null };
type ResultRow = {
  paper: string;
  paper_id: string | null;
  date: string | null;
  subjects: string[];
  student_id: string;
  school_id: string | null;
  name: string;
  status: "PRESENT" | "ABSENT" | "NOT_ENTERED";
  marks_obtained: number | null;
  marks_out_of: number | null;
  full_marks: number;
  percent: number | null;
  position: number | null;
  of: number | null;
  items?: ResultItem[];
};

const dayKey = (d: Date | string | undefined): string | null => (d ? new Date(d).toISOString().slice(0, 10) : null);
/** Half marks are legal; sum in halves so floats never leak (the service's own rule). */
const sumHalves = (xs: readonly number[]): number => xs.reduce((a, b) => a + Math.round(b * 2), 0) / 2;

export const scholarshipResults: ToolDef = {
  name: "scholarship_results",
  label_bn: "বৃত্তি পরীক্ষার নম্বর",
  label_en: "Scholarship marks and results",
  description:
    "Exact scholarship practice-paper marks for every paper and student (বৃত্তি পরীক্ষার নম্বর, প্রাপ্ত নম্বর, পূর্ণমান, শতাংশ, মেধাক্রম, অবস্থান, অনুপস্থিত, ফলাফল). " +
    "One row per paper and student: marks_obtained out of full_marks, percent, position among those who sat, and status PRESENT / ABSENT / NOT_ENTERED (absent is never a zero). " +
    "Plus a per-paper summary (class average, highest_percent, lowest_percent). Use it for 'marks', 'result', 'position', 'who got what'. " +
    "Filters: student (name or school ID), subject, paper (name or SP- id), from/to dates, last N papers; per_item adds each question's marks (numbers only). " +
    "For weak topics or chapters use scholarship_analysis. Never returns question text, teacher notes or comments.",
  input: {
    class_level: z.number().int().min(1).max(5).optional().describe("scholarship class, default 5"),
    student: NAME_QUERY.optional().describe("part of a name (English or Bangla) or a school ID"),
    subject: SUBJECT.optional().describe("BAN, ENG, MATH, SCI or BGS"),
    paper: z.string().min(1).max(60).regex(/^[\p{L}\p{M}\p{N} .'+_-]+$/u, "part of the paper name, or an SP- id").optional(),
    from: DATE_KEY.optional().describe("papers dated on or after (YYYY-MM-DD)"),
    to: DATE_KEY.optional().describe("papers dated on or before (YYYY-MM-DD)"),
    last: z.number().int().min(1).max(60).optional().describe("only the newest N papers"),
    per_item: z.boolean().optional().describe("add each item's marks (numbers only); default false"),
  },
  gates: [{ mode: "default", rule: GATE, resolver: { file: "modules/scholarship/resolvers/scholarship.ts", field: "scholarshipClass" } }],
  // ~345 bytes a row (measured with long Bangla names): 100 rows plus the paper summary stay inside the 60 KB reply limit (capReply).
  maxRows: 100,
  async run(ctx, a) {
    assertRule(ctx.auth, GATE);
    const args = a as { class_level?: number; student?: string; subject?: string; paper?: string; from?: string; to?: string; last?: number; per_item?: boolean };
    const classLevel = args.class_level ?? 5;
    const subject = args.subject ? args.subject.toUpperCase() : undefined;
    if (subject && !(SUBJECTS as readonly string[]).includes(subject)) throw new ToolInvalid("subject must be one of BAN, ENG, MATH, SCI, BGS.");
    if (args.per_item && !args.student && !args.paper) throw new ToolInvalid("per_item needs a student or a paper: narrow the request to one child or one paper.");
    if (args.from && args.to && args.from > args.to) throw new ToolInvalid(`"from" (${args.from}) is after "to" (${args.to}).`);

    const anchor = (await currentSections(classLevel))[0];
    if (!anchor) return { data: { class_level: classLevel, note: "No active class of this level in the current year." }, rowCount: 0 };
    const scope: AnalysisScope = { classLevel, sectionId: anchor.sectionId, subject: subject as AnalysisScope["subject"] };

    const roster = (await Student.find(await sittingRosterFilter(anchor.sectionId)).select("_id schoolId name nameBn").lean()) as Array<{
      _id: Types.ObjectId;
      schoolId?: string;
      name?: string;
      nameBn?: string;
    }>;

    // ---- which students ----------------------------------------------------------
    let targets = roster;
    if (args.student) {
      const q = args.student.trim().toLowerCase();
      const dir = (await loadStudentDirectory()).filter(
        (r) => r.classLevel === classLevel && (r.schoolId.toLowerCase() === q || nameMatches(args.student!, r.name, r.nameBn)),
      );
      if (dir.length === 0) throw new ToolInvalid("No student of this class matches that name or school ID.");
      const exact = dir.filter((r) => r.schoolId.toLowerCase() === q);
      const pick = exact.length === 1 ? exact : dir;
      if (pick.length > 1) {
        const c = cap(pick, 10);
        return {
          data: {
            ambiguous: true,
            message: "More than one student matches — ask which one, then call again with the school ID.",
            candidates: c.rows.map((r) => ({ student_id: r.id, school_id: r.schoolId, name: r.name, name_bn: r.nameBn, section_label_bn: r.sectionNameBn })),
          },
          rowCount: c.rows.length,
          truncated: c.truncated,
          total: c.total,
        };
      }
      const st = pick[0];
      targets = roster.filter((s) => String(s._id) === st.id);
      if (targets.length === 0) return { data: { student: { student_id: st.id, school_id: st.schoolId, name: st.name }, note: "This child is not on the scholarship sitting list." }, rowCount: 1 };
    }

    // ---- which papers --------------------------------------------------------------
    let data: PaperWithScores[] = narrowToSubject(await loadScope(scope), scope.subject); // oldest first
    const metaDocs = (await ScholarshipPaper.find({ _id: { $in: data.map((d) => d.paper._id) } })
      .select("paperId subjects")
      .lean()) as unknown as Array<{ _id: Types.ObjectId; paperId?: string; subjects?: string[] }>;
    const metaOf = new Map(metaDocs.map((m) => [String(m._id), m]));
    if (args.paper) {
      const q = args.paper.trim().toLowerCase();
      data = data.filter(({ paper }) => {
        const pid = (metaOf.get(String(paper._id))?.paperId ?? "").toLowerCase();
        return pid.includes(q) || (paper.name ?? "").toLowerCase().includes(q);
      });
    }
    if (args.from || args.to) {
      data = data.filter(({ paper }) => {
        const d = dayKey(paper.paperDate);
        return d !== null && (!args.from || d >= args.from) && (!args.to || d <= args.to);
      });
    }
    data = data.filter(({ paper }) => paper.items.length > 0);
    if (args.last) data = data.slice(-args.last);
    if (data.length === 0) return { data: { class_level: classLevel, papers: [], rows: [], note: "No scored paper matches these filters." }, rowCount: 0 };

    const rosterIds = roster.map((s) => String(s._id));
    const labelOf = await labelLookup(classLevel);

    const rows: ResultRow[] = [];
    const papers: Array<Record<string, unknown> & { _date: string }> = [];
    for (const { paper, scores } of data) {
      const pid = String(paper._id);
      const meta = metaOf.get(pid);
      const paperName = paper.name ?? meta?.paperId ?? pid;
      const full = sumHalves(paper.items.map((i) => i.marks));
      const subjectsHere = [...new Set(paper.items.map((i) => i.subject))];
      const date = dayKey(paper.paperDate);
      const byStudent = new Map(scores.map((s) => [String(s.studentId), s]));

      const totalsOf = (sid: string): { e: number; a: number; got: Map<number, number> } | null => {
        const row = byStudent.get(sid);
        if (!row || row.status !== "PRESENT") return null;
        const got = new Map(row.itemMarks.map((m) => [m.itemNo, m.marks]));
        const e: number[] = [];
        const av: number[] = [];
        for (const it of paper.items) {
          const m = got.get(it.itemNo);
          if (m === undefined) continue;
          e.push(m);
          av.push(it.marks);
        }
        return av.length ? { e: sumHalves(e), a: sumHalves(av), got } : null;
      };
      const pctOf = (t: { e: number; a: number } | null): number | null => (t && t.a > 0 ? r1((t.e / t.a) * 100) : null);

      // Position is counted over the whole sitting roster, not only the asked-for student.
      const ranks = rankBy(rosterIds.map((id) => ({ id, percent: pctOf(totalsOf(id)) })));
      const percents = rosterIds.map((id) => pctOf(totalsOf(id))).filter((x): x is number => x !== null);
      const absent = rosterIds.filter((id) => byStudent.get(id)?.status === "ABSENT").length;
      papers.push({
        paper: paperName,
        paper_id: meta?.paperId ?? null,
        date,
        subjects: subjectsHere,
        full_marks: full,
        sat: percents.length,
        absent,
        class_average_percent: percents.length ? r1(percents.reduce((x, y) => x + y, 0) / percents.length) : null,
        highest_percent: percents.length ? Math.max(...percents) : null,
        lowest_percent: percents.length ? Math.min(...percents) : null,
        _date: date ?? "",
      });

      for (const s of targets) {
        const sid = String(s._id);
        const sc = byStudent.get(sid);
        const t = totalsOf(sid);
        // A PRESENT row with no item marks yet is NOT_ENTERED: never a bare PRESENT with null marks.
        const status: ResultRow["status"] = !sc ? "NOT_ENTERED" : sc.status === "ABSENT" ? "ABSENT" : t ? "PRESENT" : "NOT_ENTERED";
        const rk = ranks.get(sid);
        const row: ResultRow = {
          paper: paperName,
          paper_id: meta?.paperId ?? null,
          date,
          subjects: subjectsHere,
          student_id: sid,
          school_id: s.schoolId ?? null,
          name: s.name ?? s.nameBn ?? "—",
          status,
          marks_obtained: t ? t.e : null,
          marks_out_of: t ? t.a : null,
          full_marks: full,
          percent: pctOf(t),
          position: rk?.rank ?? null,
          of: rk?.of ?? null,
        };
        if (args.per_item && t) {
          row.items = paper.items.map((it) => ({
            item_no: it.itemNo,
            subject: it.subject,
            type: it.topicCode?.trim() ? labelOf(it.topicCode, it.subject) : it.itemType,
            marks_available: it.marks,
            marks_obtained: t.got.get(it.itemNo) ?? null,
          }));
        }
        rows.push(row);
      }
    }

    // Newest paper first, then position (unplaced last), then name.
    rows.sort(
      (x, y) =>
        (y.date ?? "").localeCompare(x.date ?? "") ||
        x.paper.localeCompare(y.paper) ||
        (x.position ?? 1e9) - (y.position ?? 1e9) ||
        x.name.localeCompare(y.name),
    );
    papers.sort((x, y) => y._date.localeCompare(x._date));
    const itemsMax = Math.max(...data.map((d) => d.paper.items.length));
    // per_item rows carry up to ~175 bytes an item (Bangla type labels): keep the reply under ~45 KB so capReply never trims silently.
    const rowCap = args.per_item ? Math.max(3, Math.min(60, Math.floor(45000 / (345 + 175 * itemsMax)))) : 100;
    const c = cap(rows, rowCap);
    return {
      data: {
        class_level: classLevel,
        note:
          "marks_obtained / marks_out_of cover the items the child was marked on (the base percent uses); full_marks is the paper's whole total in scope. ABSENT and NOT_ENTERED rows have no marks, never zero." +
          (c.truncated ? ` Showing ${c.rows.length} of ${c.total} rows — narrow by student, paper or last.` : ""),
        papers: papers.map(({ _date, ...p }) => p),
        rows: c.rows,
      },
      rowCount: c.rows.length,
      truncated: c.truncated,
      total: c.total,
    };
  },
};
