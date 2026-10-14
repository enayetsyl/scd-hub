/**
 * Class-test dashboard SCOPE filters (D-#740, owner ask 2026-10-14: "add filter and
 * search here … class, subject, teacher, section and other relevant thing").
 *
 * The scope narrows EVERYTHING on the dashboard — the KPI tiles, the script-stage
 * tiles, the per-test list and the overdue-by-teacher card — so "Overdue 11" always
 * means "11 of the tests you are looking at". That works because the tiles are a pure
 * fold over the same reports-status rows the list renders: `ctDashboardKpis` mirrors
 * `principalDashboard` (server ClassTestSummaryService) line for line, and on an empty
 * scope it returns exactly the server's numbers.
 *
 * Pure and dependency-free (like `ctDashboardOrder`), so the rule can be checked
 * without a running app.
 */

/** The fields the scope + the KPI fold need — any reports-status row satisfies this. */
export interface CtScopeRow {
  ctId: string;
  subject: string;
  testNumber: number;
  classLevel: number | null;
  sectionId: string | null;
  subjectGroupId: string | null;
  teacherId: string;
  teacherName: string;
  examDate: string;
  state: string;
  teacherOverdue: boolean;
}

/** `section` takes a section id, or GROUP_SECTION for the group-anchored tests
 *  (Arabic/Quran groups: no class, no section — D-#507). */
export const GROUP_SECTION = "__group";

export interface CtScope {
  search: string;
  classLevel: number | null;
  section: string | null;
  subject: string | null;
  teacherId: string | null;
  /** Dhaka calendar days, "YYYY-MM-DD"; "" = open. Inclusive. */
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_CT_SCOPE: CtScope = {
  search: "",
  classLevel: null,
  section: null,
  subject: null,
  teacherId: null,
  dateFrom: "",
  dateTo: "",
};

export const ctScopeActiveCount = (s: CtScope): number =>
  [s.search.trim() !== "", s.classLevel !== null, s.section !== null, s.subject !== null, s.teacherId !== null, s.dateFrom !== "", s.dateTo !== ""].filter(Boolean).length;

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
/** Lower-case, no spaces, Bangla digits → ASCII, so "টেস্ট ৬", "#6" and "6" all meet. */
export const ctSearchKey = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[০-৯]/g, (c) => String(BN_DIGITS.indexOf(c)))
    .replace(/\s+/g, "");

/**
 * Does the row fall inside the scope? `haystack` is the row's display text (subject
 * label, section/class name …) built by the screen, which owns the labels; the ctId,
 * teacher name and test number are always searched.
 * `dayKey` turns the ISO examDate into a Dhaka calendar day (labels.dhakaDateKey).
 */
export function inCtScope(
  r: CtScopeRow,
  s: CtScope,
  haystack: string,
  dayKey: (iso: string) => string,
): boolean {
  if (s.classLevel !== null && r.classLevel !== s.classLevel) return false;
  if (s.section !== null) {
    if (s.section === GROUP_SECTION ? r.sectionId !== null || !r.subjectGroupId : r.sectionId !== s.section) return false;
  }
  if (s.subject !== null && r.subject !== s.subject) return false;
  if (s.teacherId !== null && r.teacherId !== s.teacherId) return false;
  if (s.dateFrom || s.dateTo) {
    const day = dayKey(r.examDate);
    if (s.dateFrom && day < s.dateFrom) return false;
    if (s.dateTo && day > s.dateTo) return false;
  }
  const q = ctSearchKey(s.search);
  if (q) {
    const hay = ctSearchKey(`${r.ctId} ${r.teacherName} #${r.testNumber} ${haystack}`);
    // Every word must hit somewhere: "arabic mariam" narrows, it does not widen.
    const words = s.search.trim().split(/\s+/).map(ctSearchKey).filter(Boolean);
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

export interface CtKpis {
  logged: number;
  complete: number;
  inProgress: number;
  notStarted: number;
  overdue: number;
  awaitingSubmit: number;
  awaitingPublish: number;
  completionRatePct: number | null;
  overdueByTeacher: { teacherId: string; teacherName: string; overdueCount: number }[];
}

/** The dashboard tiles over a set of rows — the server's principalDashboard fold. */
export function ctDashboardKpis(rows: readonly CtScopeRow[]): CtKpis {
  let complete = 0;
  let inProgress = 0;
  let notStarted = 0;
  let overdue = 0;
  let awaitingSubmit = 0;
  let awaitingPublish = 0;
  const byTeacher = new Map<string, { teacherName: string; overdueCount: number }>();
  for (const r of rows) {
    if (r.state === "complete") complete++;
    else if (r.state === "overdue") {
      overdue++;
      if (r.teacherOverdue) {
        awaitingSubmit++;
        const t = byTeacher.get(r.teacherId) ?? { teacherName: r.teacherName, overdueCount: 0 };
        t.overdueCount++;
        byTeacher.set(r.teacherId, t);
      } else awaitingPublish++;
    } else if (r.state === "in_progress") inProgress++;
    else notStarted++;
  }
  const logged = rows.length;
  return {
    logged,
    complete,
    inProgress,
    notStarted,
    overdue,
    awaitingSubmit,
    awaitingPublish,
    completionRatePct: logged === 0 ? null : Math.round((complete / logged) * 100),
    overdueByTeacher: [...byTeacher.entries()]
      .map(([teacherId, t]) => ({ teacherId, ...t }))
      .sort((a, b) => b.overdueCount - a.overdueCount),
  };
}
