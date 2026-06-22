/**
 * Scope-grant unit tests (ADR-017, D-#17/#18/#20).
 *
 * Tests run WITHOUT a DB connection — they exercise the pure logic functions
 * directly: window math, canRead, canWrite predicates.
 *
 * Integration tests (grant DB lifecycle) require a live Mongo and are
 * marked with @group integration — run separately with a test DB.
 */

import {
  isProxyActive,
  proxyWindowEnd,
  canRead,
  canWrite,
  validateSupervisoryGrant,
} from "../modules/foundation/services/ScopeGrantService";
import type { ScopeItem } from "../modules/foundation/services/ScopeGrantService";

// ---------------------------------------------------------------------------
// Proxy window helpers
// ---------------------------------------------------------------------------

describe("isProxyActive (D-#20 window logic)", () => {
  const START = new Date("2026-06-09T00:00:00+06:00"); // Dhaka day start
  const DURATION = 3; // active on Jun 9, 10, 11 (Dhaka)

  test("is active on the start day", () => {
    const now = new Date("2026-06-09T08:00:00+06:00");
    expect(isProxyActive(START, DURATION, now)).toBe(true);
  });

  test("is active on the last day (day 3)", () => {
    const now = new Date("2026-06-11T15:00:00+06:00");
    expect(isProxyActive(START, DURATION, now)).toBe(true);
  });

  test("is NOT active after window end (day 4)", () => {
    const now = new Date("2026-06-12T00:01:00+06:00");
    expect(isProxyActive(START, DURATION, now)).toBe(false);
  });

  test("is NOT active before start", () => {
    const now = new Date("2026-06-08T23:59:00+06:00");
    expect(isProxyActive(START, DURATION, now)).toBe(false);
  });

  test("1-day grant expires at end of the same day", () => {
    const now = new Date("2026-06-10T00:00:00+06:00"); // next day
    expect(isProxyActive(START, 1, now)).toBe(false);
  });

  test("proxyWindowEnd is exactly start + durationDays (Dhaka day boundary)", () => {
    const end = proxyWindowEnd(START, DURATION);
    // Should be 2026-06-12 00:00 Dhaka = 2026-06-11 18:00 UTC
    const endDhaka = end.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
    expect(endDhaka).toBe("2026-06-12");
  });
});

// ---------------------------------------------------------------------------
// Row-scope predicates
// ---------------------------------------------------------------------------

const SECTION_A = "sectionA";
const SECTION_B = "sectionB";
const CLASS_1 = "class1";
const CLASS_2 = "class2";
const SUBJ_BAN = "subjBAN";
const SUBJ_ENG = "subjENG";

function teachingScope(sectionId: string, classId: string, subjectId: string): ScopeItem {
  return { kind: "teaching", sectionId, classId, subjectId };
}

function supervisoryScope(
  extent: string,
  opts: { classId?: string; subjectId?: string; explicitSet?: Array<{ classId: string; subjectId: string }> } = {},
): ScopeItem {
  return { kind: "supervisory", extent, ...opts };
}

function proxyScope(sectionId: string, classId: string): ScopeItem {
  return { kind: "proxy", sectionId, classId, grantId: "g1" };
}

describe("canRead (D-#17 read scope)", () => {
  test("teaching grant allows read on own section", () => {
    const scopes = [teachingScope(SECTION_A, CLASS_1, SUBJ_BAN)];
    expect(canRead(scopes, SECTION_A, CLASS_1, SUBJ_BAN)).toBe(true);
  });

  test("teaching grant does NOT allow read on other section", () => {
    const scopes = [teachingScope(SECTION_A, CLASS_1, SUBJ_BAN)];
    expect(canRead(scopes, SECTION_B, CLASS_2, SUBJ_ENG)).toBe(false);
  });

  test("whole-school supervisory allows read on any section", () => {
    const scopes = [supervisoryScope("whole_school")];
    expect(canRead(scopes, SECTION_B, CLASS_2, SUBJ_ENG)).toBe(true);
  });

  test("grade_class supervisory allows read on that class only", () => {
    const scopes = [supervisoryScope("grade_class", { classId: CLASS_1 })];
    expect(canRead(scopes, SECTION_A, CLASS_1)).toBe(true);
    expect(canRead(scopes, SECTION_B, CLASS_2)).toBe(false);
  });

  test("subject_dept supervisory allows read on that subject only", () => {
    const scopes = [supervisoryScope("subject_dept", { subjectId: SUBJ_BAN })];
    expect(canRead(scopes, SECTION_A, CLASS_1, SUBJ_BAN)).toBe(true);
    expect(canRead(scopes, SECTION_B, CLASS_2, SUBJ_ENG)).toBe(false);
  });

  test("explicit_set supervisory allows only matching (class,subject) pairs", () => {
    const scopes = [
      supervisoryScope("explicit_set", {
        explicitSet: [{ classId: CLASS_1, subjectId: SUBJ_BAN }],
      }),
    ];
    expect(canRead(scopes, SECTION_A, CLASS_1, SUBJ_BAN)).toBe(true);
    expect(canRead(scopes, SECTION_A, CLASS_1, SUBJ_ENG)).toBe(false);
    expect(canRead(scopes, SECTION_B, CLASS_2, SUBJ_BAN)).toBe(false);
  });

  test("proxy grant allows read on covered section", () => {
    const scopes = [proxyScope(SECTION_B, CLASS_2)];
    expect(canRead(scopes, SECTION_B, CLASS_2)).toBe(true);
  });

  test("empty scopes denies everything", () => {
    expect(canRead([], SECTION_A, CLASS_1)).toBe(false);
  });
});

describe("canWrite (D-#18 write scope)", () => {
  test("teaching grant allows write on own section", () => {
    const scopes = [teachingScope(SECTION_A, CLASS_1, SUBJ_BAN)];
    expect(canWrite(scopes, SECTION_A)).toBe(true);
  });

  test("teaching grant does NOT allow write on other section", () => {
    const scopes = [teachingScope(SECTION_A, CLASS_1, SUBJ_BAN)];
    expect(canWrite(scopes, SECTION_B)).toBe(false);
  });

  test("supervisory grant does NOT allow write (read-only D-#17)", () => {
    const scopes = [supervisoryScope("whole_school")];
    expect(canWrite(scopes, SECTION_A)).toBe(false);
  });

  test("proxy grant allows write on covered section", () => {
    const scopes = [proxyScope(SECTION_B, CLASS_2)];
    expect(canWrite(scopes, SECTION_B)).toBe(true);
  });

  test("proxy grant does NOT allow write outside covered section", () => {
    const scopes = [proxyScope(SECTION_B, CLASS_2)];
    expect(canWrite(scopes, SECTION_A)).toBe(false);
  });

  test("union: teaching + supervisory — write only on teaching section", () => {
    const scopes: ScopeItem[] = [
      teachingScope(SECTION_A, CLASS_1, SUBJ_BAN),
      supervisoryScope("whole_school"),
    ];
    expect(canWrite(scopes, SECTION_A)).toBe(true);
    expect(canWrite(scopes, SECTION_B)).toBe(false); // supervisory is read-only
  });

  test("union: teaching + proxy — write on either covered section", () => {
    const scopes: ScopeItem[] = [
      teachingScope(SECTION_A, CLASS_1, SUBJ_BAN),
      proxyScope(SECTION_B, CLASS_2),
    ];
    expect(canWrite(scopes, SECTION_A)).toBe(true);
    expect(canWrite(scopes, SECTION_B)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Supervisory-grant request validation (D-#261)
// ---------------------------------------------------------------------------

describe("validateSupervisoryGrant (D-#261 extent args)", () => {
  test("whole_school needs no target", () => {
    expect(validateSupervisoryGrant({ extent: "whole_school" })).toBeNull();
  });

  test("subject_dept requires a subject", () => {
    expect(validateSupervisoryGrant({ extent: "subject_dept", subjectId: SUBJ_BAN })).toBeNull();
    expect(validateSupervisoryGrant({ extent: "subject_dept" })).toMatch(/subject/);
  });

  test("grade_class requires a class", () => {
    expect(validateSupervisoryGrant({ extent: "grade_class", classId: CLASS_1 })).toBeNull();
    expect(validateSupervisoryGrant({ extent: "grade_class" })).toMatch(/class/);
  });

  test("explicit_set requires at least one complete pair", () => {
    expect(
      validateSupervisoryGrant({ extent: "explicit_set", explicitSet: [{ classId: CLASS_1, subjectId: SUBJ_BAN }] }),
    ).toBeNull();
    expect(validateSupervisoryGrant({ extent: "explicit_set", explicitSet: [] })).toMatch(/at least one/);
    expect(
      validateSupervisoryGrant({ extent: "explicit_set", explicitSet: [{ classId: CLASS_1, subjectId: "" }] }),
    ).toMatch(/class and a subject/);
  });

  test("an unknown extent is rejected", () => {
    expect(validateSupervisoryGrant({ extent: "galaxy" })).toMatch(/unknown supervisory extent/);
  });
});
