/**
 * CSP-1 — "teaches the child now" (docs/prd-child-support-profile.md §8.2, D-#1547). Pure: the
 * computeSupportReaders core is tested with no database.
 */
import { computeSupportReaders, type ScopeInputs } from "../modules/support-profile/services/supportScope";

const T = "2026-11-12";
const base = (over: Partial<ScopeInputs> = {}): ScopeInputs => ({
  todayKey: T,
  sectionId: "sec1",
  classTeacherId: "ct",
  subjectGroupIds: ["q1", "a1"],
  teachingGrants: [],
  slots: [],
  proxyGrants: [],
  groupCovers: [],
  ...over,
});
const ids = (inp: ScopeInputs) => Object.fromEntries(computeSupportReaders(inp).map((r) => [r.userId, r.via]));

describe("currentSupportReaders (pure)", () => {
  it("class teacher → reader", () => expect(ids(base())).toEqual({ ct: "CLASS_TEACHER" }));

  it("routine teaching grant → reader from the slot's effectiveFrom; the day before → none", () => {
    const routine = {
      teachingGrants: [{ teacherId: "t1", sectionId: "sec1", source: "routine" as const, active: true, expiresKey: null }],
      slots: [{ teacherId: "t1", groupType: "section" as const, groupId: "sec1", fromKey: T, toKey: null, active: true }],
    };
    expect(ids(base(routine)).t1).toBe("TEACHING");
    expect(ids(base({ ...routine, todayKey: "2026-11-11" })).t1).toBeUndefined();
  });

  it("manual teaching grant → reader; expired → none", () => {
    const g = (expiresKey: string | null) => ({ teachingGrants: [{ teacherId: "t2", sectionId: "sec1", source: "manual" as const, active: true, expiresKey }] });
    expect(ids(base(g(null))).t2).toBe("TEACHING");
    expect(ids(base(g(T))).t2).toBeUndefined();
  });

  it("Quran and Arabic teachers of the child's subject groups → readers", () => {
    const slots = [
      { teacherId: "quran", groupType: "subjectgroup" as const, groupId: "q1", fromKey: "2026-01-01", toKey: null, active: true },
      { teacherId: "arabic", groupType: "subjectgroup" as const, groupId: "a1", fromKey: "2026-01-01", toKey: null, active: true },
      { teacherId: "otherGroup", groupType: "subjectgroup" as const, groupId: "q9", fromKey: "2026-01-01", toKey: null, active: true },
    ];
    const r = ids(base({ slots }));
    expect(r.quran).toBe("TEACHING");
    expect(r.arabic).toBe("TEACHING");
    expect(r.otherGroup).toBeUndefined();
  });

  it("cover/proxy grant today → full reader with via COVER; tomorrow → none", () => {
    const p = { proxyGrants: [{ coveringTeacherId: "cov", sectionId: "sec1", startKey: T, durationDays: 1, live: true }] };
    expect(ids(base(p)).cov).toBe("COVER");
    expect(ids(base({ ...p, todayKey: "2026-11-13" })).cov).toBeUndefined();
    // a Quran-group cover (a routine substitution) is a reader on its day only
    const g = { groupCovers: [{ coverTeacherId: "qcov", groupId: "q1", dateKey: T, active: true }] };
    expect(ids(base(g)).qcov).toBe("COVER");
    expect(ids(base({ ...g, todayKey: "2026-11-13" })).qcov).toBeUndefined();
  });

  it("retired grant → none from the retirement day (slot effectiveTo is exclusive)", () => {
    const routine = {
      teachingGrants: [{ teacherId: "t1", sectionId: "sec1", source: "routine" as const, active: true, expiresKey: null }],
      slots: [{ teacherId: "t1", groupType: "section" as const, groupId: "sec1", fromKey: "2026-09-01", toKey: T, active: true }],
    };
    expect(ids(base(routine)).t1).toBeUndefined();
    expect(ids(base({ ...routine, todayKey: "2026-11-11" })).t1).toBe("TEACHING");
    expect(ids(base({ teachingGrants: [{ teacherId: "t3", sectionId: "sec1", source: "manual", active: false, expiresKey: null }] })).t3).toBeUndefined();
  });

  it("supervisory / delegation / past-year ties are never inputs → none", () => {
    // Only teaching, proxy and routine data are inputs; a supervisor appears nowhere.
    expect(Object.keys(ids(base()))).toEqual(["ct"]);
  });

  it("child moved section → the old section's teachers none, the new ones readers", () => {
    const grants = [
      { teacherId: "oldT", sectionId: "sec1", source: "manual" as const, active: true, expiresKey: null },
      { teacherId: "newT", sectionId: "sec2", source: "manual" as const, active: true, expiresKey: null },
    ];
    const r = ids(base({ sectionId: "sec2", classTeacherId: "ct2", teachingGrants: grants }));
    expect(r.oldT).toBeUndefined();
    expect(r.newT).toBe("TEACHING");
    expect(r.ct).toBeUndefined();
    expect(r.ct2).toBe("CLASS_TEACHER");
  });

  it("a child with no section today (left) has no section readers", () => {
    expect(ids(base({ sectionId: null }))).toEqual({});
  });
});
