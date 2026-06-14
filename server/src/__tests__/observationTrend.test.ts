/**
 * Classroom Observation CO-4 tests (prd-classroom-observation §CO-4, REF-11 §2.2/§8,
 * D-#85) — the READ-side DERIVED trend aggregates (nothing stored).
 *
 * Pure       — trendOf (↑/↓/→ = up/down/flat; one data point ⇒ flat).
 * Trend      — teacherDomainTrend builds a per-domain (D1..D5) chronological level
 *              series + the ↑/↓/→ indicator across ≥2 RELEASED REF-11 observations; an
 *              UPLOADED/ASSIGNED draft is EXCLUDED (query filters to released states);
 *              a single observation yields a flat (→) trend; a QURAN-form row carries no
 *              REF-11 domains and never enters the REF-11 trend; NO average field exists
 *              on the shape.
 * Signal     — schoolObservationPatterns surfaces the weakest domain(s) (lowest per-
 *              domain mean level) over staff-wide released REF-11 observations.
 * RBAC       — executed against the built schema with each role's context, so the real
 *              permission map runs: teacherObservationTrend is observation:read + ROW-
 *              SCOPED (a teacher reads OWN, is DENIED another teacher's; observation:manage
 *              reads any); schoolObservationPatterns is observation:manage (denied to a
 *              plain TEACHER, allowed to Principal/Office; GUARDIAN/unauthenticated denied).
 *
 * DB-free (repo convention): the ClassroomObservation model is mocked. The released-state
 * filter is applied by the query in the service, so the mock honours the `state` filter
 * to prove drafts are excluded.
 */
import mongoose from "mongoose";
import { graphql } from "graphql";
import type { ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const mockObsFind = jest.fn();
jest.mock("../modules/classroom-observation/models/ClassroomObservation", () => ({
  ClassroomObservation: {
    find: (q: unknown) => mockObsFind(q),
  },
}));

// Import AFTER mocks
import {
  trendOf,
  teacherDomainTrend,
  schoolObservationPatterns,
} from "../modules/classroom-observation/services/ClassroomObservationTrendService";
import { builder } from "../schema";
import "../modules/classroom-observation/resolvers/observationTrend";

const TEACHER = oid(); // the observed teacher whose trend we read
const OTHER = oid(); // a different teacher

const RELEASED = ["REVIEWED", "TEACHER_RESPONDED", "SUPERSEDED"];

/** A lean-doc-like observation (the service uses .find(...).lean(); no .sort chain). */
const makeObs = (over: Record<string, unknown> = {}) => ({
  _id: oid(),
  form: "REF11",
  teacherId: TEACHER,
  classDate: "2026-06-01",
  state: "REVIEWED",
  domains: [
    { domain: "D1", level: 2, note: "" },
    { domain: "D2", level: 2, note: "" },
    { domain: "D3", level: 2, note: "" },
    { domain: "D4", level: 2, note: "" },
    { domain: "D5", level: 2, note: "" },
  ],
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
  ...over,
});

/**
 * Wire mockObsFind to honour the service's query: it filters by `form`, `state.$in`
 * (released only) and optionally `teacherId`. Returns a `{ lean }` chain over the
 * matching subset — so an UPLOADED/ASSIGNED draft is filtered out exactly as the real
 * query would.
 */
const wireFind = (docs: Array<Record<string, unknown>>) => {
  mockObsFind.mockImplementation((q: Record<string, unknown>) => {
    const stateIn = ((q.state as { $in?: string[] })?.$in ?? RELEASED) as string[];
    const teacherFilter = q.teacherId ? String(q.teacherId) : null;
    const formFilter = q.form as string | undefined;
    const out = docs.filter((d) => {
      if (formFilter && d.form !== formFilter) return false;
      if (!stateIn.includes(d.state as string)) return false;
      if (teacherFilter && String(d.teacherId) !== teacherFilter) return false;
      return true;
    });
    return { lean: async () => out };
  });
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// trendOf (pure)
// ===========================================================================

describe("trendOf", () => {
  test("up / down / flat by latest vs previous; one data point ⇒ flat", () => {
    expect(trendOf(3, 2)).toBe("up");
    expect(trendOf(2, 3)).toBe("down");
    expect(trendOf(2, 2)).toBe("flat");
    expect(trendOf(2, null)).toBe("flat"); // single data point
    expect(trendOf(null, null)).toBe("flat");
  });
});

// ===========================================================================
// teacherDomainTrend — per-domain chronological series + ↑/↓/→
// ===========================================================================

describe("teacherDomainTrend", () => {
  test("builds a per-domain chronological series + indicator across ≥2 released observations", async () => {
    // Two released observations, out of input order — the service sorts chronologically.
    const newer = makeObs({
      classDate: "2026-06-10",
      createdAt: new Date("2026-06-10T00:00:00Z"),
      domains: [
        { domain: "D1", level: 4, note: "" }, // up vs 2
        { domain: "D2", level: 1, note: "" }, // down vs 3
        { domain: "D3", level: 3, note: "" }, // flat vs 3
        { domain: "D4", level: 2, note: "" },
        { domain: "D5", level: 2, note: "" },
      ],
    });
    const older = makeObs({
      classDate: "2026-06-01",
      createdAt: new Date("2026-06-01T00:00:00Z"),
      domains: [
        { domain: "D1", level: 2, note: "" },
        { domain: "D2", level: 3, note: "" },
        { domain: "D3", level: 3, note: "" },
        { domain: "D4", level: 2, note: "" },
        { domain: "D5", level: 2, note: "" },
      ],
    });
    wireFind([newer, older]); // deliberately newer-first to prove sorting

    const res = await teacherDomainTrend(TEACHER.toString());

    expect(res.observationCount).toBe(2);
    expect(res.firstClassDate).toBe("2026-06-01");
    expect(res.lastClassDate).toBe("2026-06-10");
    expect(res.domains).toHaveLength(5); // exactly D1..D5

    const byDomain = Object.fromEntries(res.domains.map((d) => [d.domain, d]));
    // chronological series (oldest → newest), with the observationId attached
    expect(byDomain.D1.series.map((p) => p.level)).toEqual([2, 4]);
    expect(byDomain.D1.series.map((p) => p.classDate)).toEqual(["2026-06-01", "2026-06-10"]);
    expect(byDomain.D1.series[0].observationId).toBe(String(older._id));
    expect(byDomain.D1.series[1].observationId).toBe(String(newer._id));
    // per-domain ↑/↓/→ indicators (latest vs previous)
    expect(byDomain.D1.trend).toBe("up");
    expect(byDomain.D2.trend).toBe("down");
    expect(byDomain.D3.trend).toBe("flat");

    // NO average across domains — the shape carries no total/average field anywhere.
    expect(res).not.toHaveProperty("average");
    expect(res).not.toHaveProperty("total");
    for (const d of res.domains) {
      expect(d).not.toHaveProperty("average");
      expect(d).not.toHaveProperty("total");
    }
  });

  test("excludes UPLOADED/ASSIGNED drafts (not yet a data point)", async () => {
    const released = makeObs({ state: "REVIEWED", classDate: "2026-06-01" });
    const draftA = makeObs({ state: "UPLOADED", classDate: "2026-06-05", domains: [] });
    const draftB = makeObs({ state: "ASSIGNED", classDate: "2026-06-08", domains: [] });
    wireFind([released, draftA, draftB]);

    const res = await teacherDomainTrend(TEACHER.toString());
    expect(res.observationCount).toBe(1); // only the released row counts
    expect(res.domains.find((d) => d.domain === "D1")!.series).toHaveLength(1);
  });

  test("a single released observation yields a flat (→) trend per domain", async () => {
    wireFind([makeObs({ state: "TEACHER_RESPONDED" })]);
    const res = await teacherDomainTrend(TEACHER.toString());
    expect(res.observationCount).toBe(1);
    for (const d of res.domains) {
      expect(d.previousLevel).toBeNull();
      expect(d.trend).toBe("flat");
    }
  });

  test("a QURAN-form observation has no REF-11 domains and never enters the trend", async () => {
    const ref11 = makeObs({ form: "REF11", state: "REVIEWED" });
    const quran = makeObs({ form: "QURAN", state: "REVIEWED", domains: [] });
    wireFind([ref11, quran]);

    const res = await teacherDomainTrend(TEACHER.toString());
    expect(res.observationCount).toBe(1); // the QURAN row is excluded (form REF11 filter)
    expect(res.domains.find((d) => d.domain === "D1")!.series).toHaveLength(1);
  });

  test("no released observations ⇒ empty trend (count 0, null range, 5 empty domains)", async () => {
    wireFind([]);
    const res = await teacherDomainTrend(TEACHER.toString());
    expect(res.observationCount).toBe(0);
    expect(res.firstClassDate).toBeNull();
    expect(res.lastClassDate).toBeNull();
    expect(res.domains).toHaveLength(5);
    expect(res.domains.every((d) => d.series.length === 0 && d.trend === "flat")).toBe(true);
  });
});

// ===========================================================================
// schoolObservationPatterns — weakest-domain training-need signal (§8)
// ===========================================================================

describe("schoolObservationPatterns", () => {
  test("surfaces the weakest domain(s) over staff-wide released observations", async () => {
    // Two teachers, three released REF-11 observations. D5 is consistently the lowest.
    const obs1 = makeObs({
      teacherId: TEACHER,
      domains: [
        { domain: "D1", level: 4, note: "" },
        { domain: "D2", level: 3, note: "" },
        { domain: "D3", level: 3, note: "" },
        { domain: "D4", level: 3, note: "" },
        { domain: "D5", level: 1, note: "" },
      ],
    });
    const obs2 = makeObs({
      teacherId: OTHER,
      domains: [
        { domain: "D1", level: 4, note: "" },
        { domain: "D2", level: 4, note: "" },
        { domain: "D3", level: 3, note: "" },
        { domain: "D4", level: 3, note: "" },
        { domain: "D5", level: 1, note: "" },
      ],
    });
    const draft = makeObs({ teacherId: OTHER, state: "ASSIGNED", domains: [] }); // excluded
    wireFind([obs1, obs2, draft]);

    const res = await schoolObservationPatterns();
    expect(res.observationCount).toBe(2); // the draft is excluded
    expect(res.weakestDomains).toEqual(["D5"]);

    const byDomain = Object.fromEntries(res.domains.map((d) => [d.domain, d]));
    expect(byDomain.D5.meanLevel).toBe(1);
    expect(byDomain.D5.sampleCount).toBe(2);
    expect(byDomain.D1.meanLevel).toBe(4);
    // domains surfaced weakest (lowest mean) first
    expect(res.domains[0].domain).toBe("D5");
  });

  test("ties surface every domain at the minimum mean", async () => {
    const obs = makeObs({
      domains: [
        { domain: "D1", level: 1, note: "" },
        { domain: "D2", level: 1, note: "" }, // tie at the minimum
        { domain: "D3", level: 4, note: "" },
        { domain: "D4", level: 4, note: "" },
        { domain: "D5", level: 4, note: "" },
      ],
    });
    wireFind([obs]);
    const res = await schoolObservationPatterns();
    expect([...res.weakestDomains].sort()).toEqual(["D1", "D2"]);
  });

  test("no released observations ⇒ no signal (count 0, empty weakest, null means)", async () => {
    wireFind([]);
    const res = await schoolObservationPatterns();
    expect(res.observationCount).toBe(0);
    expect(res.weakestDomains).toEqual([]);
    expect(res.domains).toHaveLength(5);
    expect(res.domains.every((d) => d.meanLevel === null && d.sampleCount === 0)).toBe(true);
  });
});

// ===========================================================================
// RBAC — executed against the built schema with each role's context
// ===========================================================================

// Register a noop so the builder has at least one always-present root field, then build once.
builder.mutationField("_trendTestNoop", (t) => t.boolean({ resolve: () => true }));
const schema = builder.toSchema();

type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string | null, userId = oid().toString()): Ctx => ({
  auth: role ? { role, userId } : null,
});

const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

describe("teacherObservationTrend — observation:read + row-scope", () => {
  const Q = `query($t: String!){ teacherObservationTrend(teacherId: $t){ teacherId observationCount domains { domain trend } } }`;

  test("a teacher reads OWN trend", async () => {
    wireFind([makeObs({ state: "REVIEWED" })]);
    const r = await graphql({
      schema,
      source: Q,
      contextValue: ctxOf("TEACHER", TEACHER.toString()),
      variableValues: { t: TEACHER.toString() },
    });
    expect(denied(r)).toBe(false);
    const data = r.data as { teacherObservationTrend: { teacherId: string; domains: unknown[] } };
    expect(data.teacherObservationTrend.teacherId).toBe(TEACHER.toString());
    expect(data.teacherObservationTrend.domains).toHaveLength(5);
  });

  test("a teacher is DENIED another teacher's trend (observer gets no arbitrary teacher)", async () => {
    wireFind([makeObs()]);
    const r = await graphql({
      schema,
      source: Q,
      contextValue: ctxOf("TEACHER", TEACHER.toString()),
      variableValues: { t: OTHER.toString() }, // not self
    });
    expect(denied(r)).toBe(true);
  });

  test("observation:manage (PRINCIPAL/OFFICE) reads ANY teacher's trend", async () => {
    for (const role of ["PRINCIPAL", "OFFICE"]) {
      wireFind([makeObs({ state: "REVIEWED" })]);
      const r = await graphql({
        schema,
        source: Q,
        contextValue: ctxOf(role),
        variableValues: { t: TEACHER.toString() },
      });
      expect(denied(r)).toBe(false);
      expect((r.data as { teacherObservationTrend: { teacherId: string } }).teacherObservationTrend.teacherId).toBe(
        TEACHER.toString(),
      );
    }
  });

  test("GUARDIAN (no observation:read) is denied at the scope layer", async () => {
    const r = await graphql({
      schema,
      source: Q,
      contextValue: ctxOf("GUARDIAN", TEACHER.toString()),
      variableValues: { t: TEACHER.toString() },
    });
    expect(denied(r)).toBe(true);
  });

  test("unauthenticated is denied", async () => {
    const r = await graphql({
      schema,
      source: Q,
      contextValue: ctxOf(null),
      variableValues: { t: TEACHER.toString() },
    });
    expect(denied(r)).toBe(true);
  });
});

describe("schoolObservationPatterns — observation:manage only", () => {
  const Q = `query { schoolObservationPatterns { observationCount weakestDomains domains { domain meanLevel } } }`;

  test("a plain TEACHER (no observation:manage) is denied at the scope layer", async () => {
    const r = await graphql({ schema, source: Q, contextValue: ctxOf("TEACHER") });
    expect(denied(r)).toBe(true);
  });

  test("PRINCIPAL/OFFICE (observation:manage) get the signal", async () => {
    for (const role of ["PRINCIPAL", "OFFICE"]) {
      wireFind([
        makeObs({
          domains: [
            { domain: "D1", level: 4, note: "" },
            { domain: "D2", level: 3, note: "" },
            { domain: "D3", level: 3, note: "" },
            { domain: "D4", level: 3, note: "" },
            { domain: "D5", level: 1, note: "" },
          ],
        }),
      ]);
      const r = await graphql({ schema, source: Q, contextValue: ctxOf(role) });
      expect(denied(r)).toBe(false);
      expect((r.data as { schoolObservationPatterns: { weakestDomains: string[] } }).schoolObservationPatterns.weakestDomains).toEqual(
        ["D5"],
      );
    }
  });

  test("GUARDIAN is denied", async () => {
    const r = await graphql({ schema, source: Q, contextValue: ctxOf("GUARDIAN") });
    expect(denied(r)).toBe(true);
  });

  test("unauthenticated is denied", async () => {
    const r = await graphql({ schema, source: Q, contextValue: ctxOf(null) });
    expect(denied(r)).toBe(true);
  });
});
