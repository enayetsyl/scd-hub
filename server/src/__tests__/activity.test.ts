/**
 * Person-activity read tests (AL-1, D-#645).
 *
 * RBAC     — the timeline rides `audit:read`, which stays PRINCIPAL-only.
 * Labels   — every declared kind has a Bangla + English name and a real family;
 *            an unknown kind read back from an older build is title-cased, never
 *            dropped.
 * Window   — Dhaka calendar days, malformed/inverted/over-wide windows refused.
 * Read     — audit + both trackers queried with the right shapes, tracker passes
 *            folded to (item × state × day) with a count, merged newest-first,
 *            `truncated` raised when a source hits its cap, View-as rows flagged.
 *
 * DB-free (repo convention): Audit, the two tracker models, User and Guardian
 * are mocked.
 */
import mongoose from "mongoose";
import { roleHasPermission, ROLES, LIFECYCLE_STATE_LABELS_BN } from "@scd/shared";

const oid = (): mongoose.Types.ObjectId => new mongoose.Types.ObjectId();

const mockAuditFind = jest.fn();
const mockAuditAggregate = jest.fn();
jest.mock("../modules/platform/models/Audit", () => ({
  Audit: {
    find: (q: unknown) => ({
      sort: () => ({ limit: (n: number) => ({ lean: async () => mockAuditFind(q, n) }) }),
    }),
    aggregate: async (p: unknown) => mockAuditAggregate(p),
  },
}));
const mockHwAggregate = jest.fn();
jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { aggregate: async (p: unknown) => mockHwAggregate(p) },
}));
const mockAsAggregate = jest.fn();
jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: { aggregate: async (p: unknown) => mockAsAggregate(p) },
}));
const mockUserFind = jest.fn();
const mockUserById = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    find: (q: unknown) => ({
      select: () => ({ limit: () => ({ lean: async () => mockUserFind(q) }) }),
    }),
    findById: (id: unknown) => ({ select: () => ({ lean: async () => mockUserById(id) }) }),
  },
}));
const mockGuardianFind = jest.fn();
const mockGuardianById = jest.fn();
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: {
    find: (q: unknown) => ({
      select: () => ({ limit: () => ({ lean: async () => mockGuardianFind(q) }) }),
    }),
    findById: (id: unknown) => ({ select: () => ({ lean: async () => mockGuardianById(id) }) }),
  },
}));

import {
  activityPeople,
  activityPerson,
  personActivity,
  personActivityDays,
  resolveWindow,
  ACTIVITY_MAX_RANGE_DAYS,
} from "../modules/platform/services/ActivityService";
import {
  AUDIT_KIND_LABELS,
  ACTIVITY_GROUPS,
  ACTIVITY_GROUP_LABELS,
  auditKindLabel,
  kindsInGroup,
} from "../modules/platform/auditLabels";

const PERSON = oid();
const OTHER = oid();
const ITEM = oid();

beforeEach(() => {
  jest.clearAllMocks();
  mockAuditFind.mockReturnValue([]);
  mockAuditAggregate.mockReturnValue([]);
  mockHwAggregate.mockReturnValue([]);
  mockAsAggregate.mockReturnValue([]);
  mockUserFind.mockReturnValue([]);
  mockGuardianFind.mockReturnValue([]);
  mockUserById.mockReturnValue(null);
  mockGuardianById.mockReturnValue(null);
});

describe("RBAC — the timeline adds no permission", () => {
  test("audit:read is still PRINCIPAL-only", () => {
    expect(ROLES.filter((r) => roleHasPermission(r, "audit:read"))).toEqual(["PRINCIPAL"]);
  });
});

describe("kind labels", () => {
  test("every declared kind has a Bangla name, an English name and a real group", () => {
    for (const [kind, label] of Object.entries(AUDIT_KIND_LABELS)) {
      expect(label.bn.trim().length).toBeGreaterThan(0);
      expect(label.en.trim().length).toBeGreaterThan(0);
      expect(ACTIVITY_GROUPS).toContain(label.group);
      // The Bangla must not merely echo the SCREAMING_CASE it is naming.
      expect(label.bn).not.toBe(kind);
    }
  });

  test("every group has a label and, except OTHER, at least one kind", () => {
    for (const g of ACTIVITY_GROUPS) {
      expect(ACTIVITY_GROUP_LABELS[g].bn.trim().length).toBeGreaterThan(0);
      if (g !== "OTHER") expect(kindsInGroup(g).length).toBeGreaterThan(0);
    }
  });

  test("a kind from an older build is title-cased, not dropped", () => {
    const l = auditKindLabel("SOME_RETIRED_KIND");
    expect(l.bn).toBe("Some Retired Kind");
    expect(l.group).toBe("OTHER");
  });

  test("a known kind resolves to its declared label", () => {
    expect(auditKindLabel("LOGIN_SUCCESS").group).toBe("ACCESS");
    expect(auditKindLabel("ATTENDANCE_MARKED").bn).toBe(AUDIT_KIND_LABELS.ATTENDANCE_MARKED.bn);
  });
});

describe("resolveWindow — Dhaka calendar days", () => {
  test("a day starts at 00:00 Dhaka, which is 18:00 UTC the day before", () => {
    const { start, end } = resolveWindow("2026-08-12", "2026-08-12");
    expect(start.toISOString()).toBe("2026-08-11T18:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-12T17:59:59.999Z");
  });

  test("refuses a malformed day rather than widening to everything", () => {
    expect(() => resolveWindow("12/08/2026", "2026-08-12")).toThrow(/YYYY-MM-DD/);
    expect(() => resolveWindow("2026-08-12", "")).toThrow(/YYYY-MM-DD/);
  });

  test("refuses an inverted window and an over-wide one", () => {
    expect(() => resolveWindow("2026-08-12", "2026-08-01")).toThrow(/earlier/);
    expect(() => resolveWindow("2020-01-01", "2026-08-12")).toThrow(
      new RegExp(String(ACTIVITY_MAX_RANGE_DAYS)),
    );
  });
});

describe("personActivity — the audit source", () => {
  test("asks for the person's own rows AND rows written through their account", async () => {
    await personActivity({ personId: PERSON.toString(), from: "2026-08-01", to: "2026-08-31" });
    const [q] = mockAuditFind.mock.calls[0];
    expect(q.$or).toHaveLength(2);
    expect(q.$or[0].actorId.toString()).toBe(PERSON.toString());
    expect(q.$or[1].onBehalfOf.toString()).toBe(PERSON.toString());
    expect(q.eventAt.$gte.toISOString()).toBe("2026-07-31T18:00:00.000Z");
    expect(q.eventAt.$lte.toISOString()).toBe("2026-08-31T17:59:59.999Z");
  });

  test("a group filter expands to that family's kinds, never a free string", async () => {
    await personActivity({
      personId: PERSON.toString(),
      from: "2026-08-01",
      to: "2026-08-31",
      group: "ATTENDANCE",
    });
    const [q] = mockAuditFind.mock.calls[0];
    expect(q.eventKind.$in).toContain("ATTENDANCE_MARKED");
    expect(q.eventKind.$in).not.toContain("LOGIN_SUCCESS");
  });

  test("an unknown group is REFUSED — never shown as an empty timeline", async () => {
    // Returning [] here would read as "this person did nothing", which is the
    // most damaging wrong answer the screen can give about a member of staff.
    await expect(
      personActivity({
        personId: PERSON.toString(),
        from: "2026-08-01",
        to: "2026-08-31",
        group: "NOT_A_GROUP",
      }),
    ).rejects.toThrow(/unknown activity group/);
    await expect(
      personActivity({
        personId: PERSON.toString(),
        from: "2026-08-01",
        to: "2026-08-31",
        source: "GUESSWORK",
      }),
    ).rejects.toThrow(/unknown activity source/);
    expect(mockAuditFind).not.toHaveBeenCalled();
  });

  test("renders the readable label and flags a View-as row", async () => {
    mockAuditFind.mockReturnValue([
      {
        _id: oid(),
        eventKind: "ATTENDANCE_MARKED",
        eventAt: new Date("2026-08-12T04:30:00.000Z"),
        actorId: OTHER,
        onBehalfOf: PERSON,
        targetKind: "Section",
        targetId: ITEM,
        meta: { sectionId: "s1" },
      },
    ]);
    const { rows } = await personActivity({
      personId: PERSON.toString(),
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(rows[0].labelBn).toBe(AUDIT_KIND_LABELS.ATTENDANCE_MARKED.bn);
    expect(rows[0].group).toBe("ATTENDANCE");
    expect(rows[0].viaViewAs).toBe(true);
    expect(rows[0].count).toBe(1);
    // 04:30Z is 10:30 in Dhaka — the same calendar day.
    expect(rows[0].day).toBe("2026-08-12");
    expect(rows[0].metaJson).toBe(JSON.stringify({ sectionId: "s1" }));
  });

  test("a row the person wrote themselves is not flagged as View-as", async () => {
    mockAuditFind.mockReturnValue([
      { _id: oid(), eventKind: "LOGIN_SUCCESS", eventAt: new Date("2026-08-12T04:00:00.000Z"), actorId: PERSON },
    ]);
    const { rows } = await personActivity({
      personId: PERSON.toString(),
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(rows[0].viaViewAs).toBe(false);
  });

  test("an evening action after 18:00 UTC belongs to the NEXT Dhaka day", async () => {
    mockAuditFind.mockReturnValue([
      { _id: oid(), eventKind: "LOGIN_SUCCESS", eventAt: new Date("2026-08-12T19:00:00.000Z"), actorId: PERSON },
    ]);
    const { rows } = await personActivity({
      personId: PERSON.toString(),
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(rows[0].day).toBe("2026-08-13");
  });
});

describe("personActivity — the tracker sources", () => {
  const fold = (state: string, day: string, count: number, lastAt: string) => ({
    _id: { item: ITEM, state, day },
    count,
    firstAt: new Date(lastAt),
    lastAt: new Date(lastAt),
    code: "HW-C5-ENG-0012",
  });

  test("a pass is ONE row carrying the student count, not one row per student", async () => {
    mockHwAggregate.mockReturnValue([fold("SUBMITTED", "2026-08-12", 28, "2026-08-12T04:34:00.000Z")]);
    const { rows } = await personActivity({
      personId: PERSON.toString(),
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("HOMEWORK");
    expect(rows[0].count).toBe(28);
    expect(rows[0].targetLabel).toBe("HW-C5-ENG-0012");
    expect(rows[0].labelBn).toContain(LIFECYCLE_STATE_LABELS_BN.SUBMITTED);
    expect(rows[0].group).toBe("HOMEWORK");
    // The fold key is the identity, so the same window re-read gives the same id.
    expect(rows[0].id).toBe(`HOMEWORK:${ITEM.toString()}:SUBMITTED:2026-08-12`);
  });

  test("the fold pipeline narrows before the unwind AND again after it", async () => {
    await personActivity({ personId: PERSON.toString(), from: "2026-08-01", to: "2026-08-31" });
    const [pipeline] = mockHwAggregate.mock.calls[0];
    expect(pipeline[0].$match["stateDates.by"].toString()).toBe(PERSON.toString());
    expect(pipeline[1].$unwind).toBe("$stateDates");
    // Without the second $match, a record touched by this person on ANY day would
    // contribute every OTHER person's stamps to the count.
    expect(pipeline[2].$match["stateDates.by"].toString()).toBe(PERSON.toString());
    expect(pipeline[3].$group._id.day.$dateToString.timezone).toBe("Asia/Dhaka");
  });

  test("both trackers are read, and the assignment row names the assignment", async () => {
    mockAsAggregate.mockReturnValue([
      { ...fold("CHECKED", "2026-08-12", 5, "2026-08-12T05:00:00.000Z"), code: "AS-C5-ENG-0003" },
    ]);
    const { rows } = await personActivity({
      personId: PERSON.toString(),
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(rows[0].source).toBe("ASSIGNMENT");
    expect(rows[0].targetKind).toBe("AssignmentItem");
    expect(rows[0].targetLabel).toBe("AS-C5-ENG-0003");
  });

  test("an audit KIND filter skips the trackers — a lifecycle state is not an audit kind", async () => {
    await personActivity({
      personId: PERSON.toString(),
      from: "2026-08-01",
      to: "2026-08-31",
      kind: "LOGIN_SUCCESS",
    });
    expect(mockHwAggregate).not.toHaveBeenCalled();
    expect(mockAsAggregate).not.toHaveBeenCalled();
  });

  test("a source filter queries only that source", async () => {
    await personActivity({
      personId: PERSON.toString(),
      from: "2026-08-01",
      to: "2026-08-31",
      source: "HOMEWORK",
    });
    expect(mockAuditFind).not.toHaveBeenCalled();
    expect(mockAsAggregate).not.toHaveBeenCalled();
    expect(mockHwAggregate).toHaveBeenCalled();
  });

  test("the HOMEWORK group filter reaches homework but not assignments", async () => {
    await personActivity({
      personId: PERSON.toString(),
      from: "2026-08-01",
      to: "2026-08-31",
      group: "HOMEWORK",
    });
    expect(mockHwAggregate).toHaveBeenCalled();
    expect(mockAsAggregate).not.toHaveBeenCalled();
  });
});

describe("personActivity — merge, cap and refusals", () => {
  test("sources interleave newest-first", async () => {
    mockAuditFind.mockReturnValue([
      { _id: oid(), eventKind: "LOGIN_SUCCESS", eventAt: new Date("2026-08-12T03:00:00.000Z"), actorId: PERSON },
    ]);
    mockHwAggregate.mockReturnValue([
      {
        _id: { item: ITEM, state: "SUBMITTED", day: "2026-08-12" },
        count: 3,
        firstAt: new Date("2026-08-12T05:00:00.000Z"),
        lastAt: new Date("2026-08-12T05:00:00.000Z"),
        code: "HW-1",
      },
    ]);
    const { rows } = await personActivity({
      personId: PERSON.toString(),
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(rows.map((r) => r.source)).toEqual(["HOMEWORK", "AUDIT"]);
  });

  test("a source at its cap raises `truncated` instead of pretending the day is complete", async () => {
    mockAuditFind.mockReturnValue(
      Array.from({ length: 2 }, () => ({
        _id: oid(),
        eventKind: "LOGIN_SUCCESS",
        eventAt: new Date("2026-08-12T03:00:00.000Z"),
        actorId: PERSON,
      })),
    );
    const r = await personActivity({
      personId: PERSON.toString(),
      from: "2026-08-01",
      to: "2026-08-31",
      limit: 2,
    });
    expect(r.truncated).toBe(true);
    expect(r.rows).toHaveLength(2);
  });

  test("a malformed person id reads empty instead of throwing", async () => {
    const r = await personActivity({ personId: "not-an-id", from: "2026-08-01", to: "2026-08-31" });
    expect(r).toEqual({ rows: [], truncated: false });
    expect(mockAuditFind).not.toHaveBeenCalled();
  });
});

describe("personActivityDays", () => {
  test("folds the three sources into one per-day total, newest day first", async () => {
    mockAuditAggregate.mockReturnValue([
      { _id: "2026-08-12", n: 4 },
      { _id: "2026-08-10", n: 1 },
    ]);
    mockHwAggregate.mockReturnValue([{ _id: "2026-08-12", n: 28 }]);
    mockAsAggregate.mockReturnValue([{ _id: "2026-08-11", n: 6 }]);
    const days = await personActivityDays({
      personId: PERSON.toString(),
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(days.map((d) => d.day)).toEqual(["2026-08-12", "2026-08-11", "2026-08-10"]);
    expect(days[0]).toMatchObject({ audit: 4, homework: 28, assignment: 0, total: 32 });
    expect(days[1]).toMatchObject({ assignment: 6, total: 6 });
  });
});

describe("activityPeople / activityPerson", () => {
  test("a search is escaped, so a name with a dot cannot become a wildcard", async () => {
    await activityPeople({ search: "Md. Tazkir" });
    const [q] = mockUserFind.mock.calls[0];
    expect((q.name as RegExp).source).toContain("Md\\. Tazkir");
    expect((q.name as RegExp).test("MdXTazkir")).toBe(false);
  });

  test("staff sort ahead of guardians", async () => {
    mockUserFind.mockReturnValue([{ _id: OTHER, name: "Tazkir", role: "TEACHER", active: true }]);
    mockGuardianFind.mockReturnValue([{ _id: PERSON, name: "Abu Bakr", active: true }]);
    const people = await activityPeople({});
    expect(people.map((p) => p.kind)).toEqual(["STAFF", "GUARDIAN"]);
    expect(people[0].role).toBe("TEACHER");
    expect(people[1].role).toBe("GUARDIAN");
  });

  test("an empty search lists without a name clause", async () => {
    await activityPeople({});
    expect(mockUserFind.mock.calls[0][0]).toEqual({});
  });

  test("a person resolves from either identity collection", async () => {
    mockUserById.mockReturnValue({ _id: PERSON, name: "Tazkir", role: "TEACHER", active: false });
    const staff = await activityPerson(PERSON.toString());
    expect(staff).toMatchObject({ name: "Tazkir", role: "TEACHER", kind: "STAFF", active: false });

    mockUserById.mockReturnValue(null);
    mockGuardianById.mockReturnValue({ _id: OTHER, name: "Guardian", active: true });
    const guardian = await activityPerson(OTHER.toString());
    expect(guardian).toMatchObject({ role: "GUARDIAN", kind: "GUARDIAN" });
  });

  test("an unknown person is null, not an exception", async () => {
    expect(await activityPerson(oid().toString())).toBeNull();
    expect(await activityPerson("nope")).toBeNull();
  });
});
