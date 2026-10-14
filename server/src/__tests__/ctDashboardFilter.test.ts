/**
 * Class-test dashboard scope (D-#740) — APP-side rules, tested here because the app
 * workspace has no test runner (the `childClassTests.test.ts` posture).
 *
 * 1. `inCtScope` — class / section / group tests / subject / teacher / exam-date range
 *    / multi-word search with Bangla digits.
 * 2. `ctDashboardKpis` — the tile fold. It must equal the server's principalDashboard
 *    fold, or the tiles would change when the dashboard stopped asking the server.
 */

// A module, not a script: without an import/export its names (`row`, `Row`) would be
// globals and collide with other require()-style tests under tsc.
export {};

// require(), not import: the server's tsc gate roots at server/src. RN-free module.
const lib = require("../../../app/src/lib/ctDashboardFilter") as {
  GROUP_SECTION: string;
  EMPTY_CT_SCOPE: Scope;
  ctScopeActiveCount: (s: Scope) => number;
  ctSearchKey: (s: string) => string;
  inCtScope: (r: Row, s: Scope, haystack: string, dayKey: (iso: string) => string) => boolean;
  ctDashboardKpis: (rows: Row[]) => {
    logged: number;
    complete: number;
    inProgress: number;
    notStarted: number;
    overdue: number;
    awaitingSubmit: number;
    awaitingPublish: number;
    completionRatePct: number | null;
    overdueByTeacher: { teacherId: string; teacherName: string; overdueCount: number }[];
  };
};

interface Scope {
  search: string;
  classLevel: number | null;
  section: string | null;
  subject: string | null;
  teacherId: string | null;
  dateFrom: string;
  dateTo: string;
}
interface Row {
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

const row = (p: Partial<Row>): Row => ({
  ctId: "CT-C3-MATH-0001",
  subject: "MATH",
  testNumber: 1,
  classLevel: 3,
  sectionId: "sec3",
  subjectGroupId: null,
  teacherId: "t1",
  teacherName: "Farhana Begum",
  examDate: "2026-09-30T18:00:00.000Z", // Dhaka 2026-10-01
  state: "complete",
  teacherOverdue: false,
  ...p,
});
// The app's dhakaDateKey, inlined (labels.ts pulls in RN).
const dayKey = (iso: string): string => new Date(new Date(iso).getTime() + 6 * 3600e3).toISOString().slice(0, 10);
const S = (p: Partial<Scope>): Scope => ({ ...lib.EMPTY_CT_SCOPE, ...p });
const hit = (r: Row, s: Partial<Scope>, hay = ""): boolean => lib.inCtScope(r, S(s), hay, dayKey);

describe("inCtScope (D-#740)", () => {
  it("an empty scope keeps every row", () => {
    expect(hit(row({}), {})).toBe(true);
    expect(lib.ctScopeActiveCount(lib.EMPTY_CT_SCOPE)).toBe(0);
  });

  it("class, section, subject and teacher are exact matches", () => {
    const r = row({});
    expect(hit(r, { classLevel: 3 })).toBe(true);
    expect(hit(r, { classLevel: 4 })).toBe(false);
    expect(hit(r, { section: "sec3" })).toBe(true);
    expect(hit(r, { section: "sec4" })).toBe(false);
    expect(hit(r, { subject: "MATH" })).toBe(true);
    expect(hit(r, { subject: "ENGLISH" })).toBe(false);
    expect(hit(r, { teacherId: "t1" })).toBe(true);
    expect(hit(r, { teacherId: "t2" })).toBe(false);
    expect(lib.ctScopeActiveCount(S({ classLevel: 3, teacherId: "t1", search: "  " }))).toBe(2);
  });

  it("the group option keeps only group-anchored tests (no section, a subject group)", () => {
    const group = row({ classLevel: null, sectionId: null, subjectGroupId: "g1", subject: "ARABIC" });
    expect(hit(group, { section: lib.GROUP_SECTION })).toBe(true);
    expect(hit(row({}), { section: lib.GROUP_SECTION })).toBe(false);
    // A group test has no class, so a class filter drops it.
    expect(hit(group, { classLevel: 3 })).toBe(false);
  });

  it("the exam-date range is inclusive and read on the Dhaka day, not the UTC one", () => {
    const r = row({}); // UTC 30 Sep 18:00 = Dhaka 1 Oct
    expect(hit(r, { dateFrom: "2026-10-01" })).toBe(true);
    expect(hit(r, { dateTo: "2026-10-01" })).toBe(true);
    expect(hit(r, { dateTo: "2026-09-30" })).toBe(false);
    expect(hit(r, { dateFrom: "2026-10-02" })).toBe(false);
  });

  it("search: ctId, teacher, test number and the screen's labels; every word must hit", () => {
    const r = row({ ctId: "CT-G-ARABIC_BOOK_2_GIRLS-0001", subject: "ARABIC", teacherName: "Mariam Begum", testNumber: 6 });
    const hay = "আরবি ARABIC শ্রেণি ৩ টেস্ট # 6";
    expect(hit(r, { search: "book_2" }, hay)).toBe(true);
    expect(hit(r, { search: "mariam" }, hay)).toBe(true);
    expect(hit(r, { search: "আরবি" }, hay)).toBe(true);
    expect(hit(r, { search: "#6" }, hay)).toBe(true);
    expect(hit(r, { search: "টেস্ট ৬" }, hay)).toBe(true); // Bangla digit meets ASCII 6
    expect(hit(r, { search: "arabic mariam" }, hay)).toBe(true);
    expect(hit(r, { search: "arabic kamal" }, hay)).toBe(false);
    expect(lib.ctSearchKey("Test ১২")).toBe("test12");
  });
});

describe("ctDashboardKpis — the server's principalDashboard fold", () => {
  it("counts each state once, splits overdue by owner and names the late teachers", () => {
    const rows = [
      row({ state: "complete" }),
      row({ state: "complete" }),
      row({ state: "in_progress" }),
      row({ state: "not_started" }),
      row({ state: "overdue", teacherOverdue: true, teacherId: "t2", teacherName: "Kamal" }),
      row({ state: "overdue", teacherOverdue: true, teacherId: "t2", teacherName: "Kamal" }),
      row({ state: "overdue", teacherOverdue: true }),
      row({ state: "overdue", teacherOverdue: false }),
    ];
    const k = lib.ctDashboardKpis(rows);
    expect(k).toMatchObject({
      logged: 8,
      complete: 2,
      inProgress: 1,
      notStarted: 1,
      overdue: 4,
      awaitingSubmit: 3,
      awaitingPublish: 1,
      completionRatePct: 25,
    });
    expect(k.awaitingSubmit + k.awaitingPublish).toBe(k.overdue);
    expect(k.overdueByTeacher).toEqual([
      { teacherId: "t2", teacherName: "Kamal", overdueCount: 2 },
      { teacherId: "t1", teacherName: "Farhana Begum", overdueCount: 1 },
    ]);
  });

  it("an empty scope reads — for the rate, not 0%", () => {
    expect(lib.ctDashboardKpis([]).completionRatePct).toBeNull();
  });

  it("rounds the rate like the server (109/125 → 87)", () => {
    const rows = [...Array(125)].map((_, i) => row({ state: i < 109 ? "complete" : "in_progress" }));
    expect(lib.ctDashboardKpis(rows).completionRatePct).toBe(87);
  });
});
