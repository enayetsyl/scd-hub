/**
 * Guardian-engagement tests (GE-1..GE-3, D-#464/#465).
 *
 * RBAC    — the report rides `audit:read` (Principal-only); recording a view rides
 *           `guardian:read_child` (GUARDIAN-only). Both verifier-proven sets.
 * Banding — NEVER vs LAPSED is the distinction the report exists to make, and
 *           last-login is LIFETIME so a long-silent family never reads as NEVER.
 * Window  — the summary denominator is every active guardian regardless of filters.
 * Views   — unknown surfaces are dropped; the day-collapse key omits absent refs.
 *
 * DB-free (repo convention): every model is mocked.
 */
import mongoose from "mongoose";
import { roleHasPermission, ROLES } from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

const G_REGULAR = oid();
const G_LAPSED = oid();
const G_NEVER = oid();
const G_CONTACT = oid();
/** The SECOND parent: a real guardian record whose link was deactivated when the school
 *  issued the portal to the other parent (D-#474). Must never reach the report. */
const G_OTHER_PARENT = oid();
/** A guardian whose only link points at a student who has left. Also not a live family. */
const G_DEPARTED = oid();
const STUDENT = oid();
const STUDENT_2 = oid();
const STUDENT_3 = oid();
const STUDENT_4 = oid();
const STUDENT_GONE = oid();
const SECTION = oid();

const DAY = 86_400_000;
const now = Date.now();

let guardianRows: unknown[] = [];
let linkRows: unknown[] = [];
let studentRows: unknown[] = [];
let sectionRows: unknown[] = [];
let auditRows: unknown[] = [];
let viewRows: unknown[] = [];
let oldestView: unknown = null;
let notificationRows: unknown[] = [];

const selectLean = (get: () => unknown[]) => ({
  select: () => ({ lean: async () => get() }),
  lean: async () => get(),
});

jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: { find: () => selectLean(() => guardianRows) },
}));
jest.mock("../modules/foundation/models/GuardianLink", () => ({
  GuardianLink: { find: () => selectLean(() => linkRows) },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: () => selectLean(() => studentRows) },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: () => selectLean(() => sectionRows) },
}));
jest.mock("../modules/platform/models/Audit", () => ({
  Audit: { find: () => selectLean(() => auditRows) },
}));
jest.mock("../modules/notifications/models/Notification", () => ({
  Notification: { find: () => selectLean(() => notificationRows) },
}));

const mockViewUpdateOne = jest.fn();
jest.mock("../modules/engagement/models/GuardianView", () => ({
  GuardianView: {
    find: () => selectLean(() => viewRows),
    findOne: () => ({ sort: () => ({ select: () => ({ lean: async () => oldestView }) }) }),
    updateOne: (...args: unknown[]) => mockViewUpdateOne(...args),
  },
}));

import { guardianEngagement } from "../modules/engagement/services/GuardianEngagementService";
import { recordView } from "../modules/engagement/services/GuardianViewService";

beforeEach(() => {
  jest.clearAllMocks();
  mockViewUpdateOne.mockResolvedValue({ acknowledged: true });

  guardianRows = [
    { _id: G_REGULAR, name: "নিয়মিত অভিভাবক", phone: "01700000001", loginEnabled: true },
    { _id: G_LAPSED, name: "নিষ্ক্রিয় অভিভাবক", phone: "01700000002", loginEnabled: true },
    { _id: G_NEVER, name: "লগইনহীন অভিভাবক", phone: "01700000003", loginEnabled: true },
    { _id: G_CONTACT, name: "শুধু যোগাযোগ", phone: "01700000004", loginEnabled: false },
    // Both of these are login-ENABLED, which is exactly why they used to pollute the
    // chase list: nothing on the guardian record itself marks them as non-portal.
    { _id: G_OTHER_PARENT, name: "দ্বিতীয় অভিভাবক", phone: "01700000005", loginEnabled: true },
    { _id: G_DEPARTED, name: "চলে যাওয়া শিক্ষার্থীর অভিভাবক", phone: "01700000006", loginEnabled: true },
  ];
  linkRows = [
    { guardianId: G_REGULAR, studentId: STUDENT, active: true },
    { guardianId: G_LAPSED, studentId: STUDENT_2, active: true },
    { guardianId: G_NEVER, studentId: STUDENT_3, active: true },
    { guardianId: G_CONTACT, studentId: STUDENT_4, active: true },
    // The second parent of STUDENT: same child, link deactivated by the school.
    { guardianId: G_OTHER_PARENT, studentId: STUDENT, active: false },
    // Link still active, but the student is gone — Student.find(active:true) drops them.
    { guardianId: G_DEPARTED, studentId: STUDENT_GONE, active: true },
  ];
  studentRows = [
    { _id: STUDENT, name: "Child", nameBn: "শিশু", sectionId: SECTION },
    { _id: STUDENT_2, name: "Child2", nameBn: "শিশু২", sectionId: SECTION },
    { _id: STUDENT_3, name: "Child3", nameBn: "শিশু৩", sectionId: SECTION },
    { _id: STUDENT_4, name: "Child4", nameBn: "শিশু৪", sectionId: SECTION },
  ];
  sectionRows = [{ _id: SECTION, nameBn: "ক শাখা", code: "A" }];

  // REGULAR: 10 distinct days inside the window. LAPSED: one login 60 days ago.
  auditRows = [
    ...Array.from({ length: 10 }, (_, i) => ({
      actorId: G_REGULAR,
      eventAt: new Date(now - (i + 1) * DAY),
    })),
    { actorId: G_LAPSED, eventAt: new Date(now - 60 * DAY) },
  ];
  viewRows = [];
  oldestView = null;
  notificationRows = [];
});

describe("RBAC", () => {
  test("audit:read (the report gate) is Principal-only", () => {
    const holders = ROLES.filter((r) => roleHasPermission(r, "audit:read"));
    expect(holders).toEqual(["PRINCIPAL"]);
  });

  test("guardian:read_child (the view-recording gate) is GUARDIAN-only", () => {
    const holders = ROLES.filter((r) => roleHasPermission(r, "guardian:read_child"));
    expect(holders).toEqual(["GUARDIAN"]);
  });
});

describe("Engagement banding", () => {
  test("a family with many active days inside the window is REGULAR", async () => {
    const rep = await guardianEngagement({ days: 90 });
    const row = rep.guardians.find((r) => r.guardianId === G_REGULAR.toString())!;
    expect(row.band).toBe("REGULAR");
    expect(row.activeDays).toBe(10);
  });

  test("a family last seen beyond the lapse threshold is LAPSED, never NEVER", async () => {
    const rep = await guardianEngagement({ days: 90 });
    const row = rep.guardians.find((r) => r.guardianId === G_LAPSED.toString())!;
    expect(row.band).toBe("LAPSED");
    expect(row.lastLoginAt).not.toBeNull();
  });

  test("last-login is LIFETIME: a login older than the window still prevents NEVER", async () => {
    // 30-day window excludes the 60-day-old login from the counters, but the family
    // HAS used the app — mislabelling it NEVER would send it to the wrong queue.
    const rep = await guardianEngagement({ days: 30 });
    const row = rep.guardians.find((r) => r.guardianId === G_LAPSED.toString())!;
    expect(row.band).toBe("LAPSED");
    expect(row.activeDays).toBe(0);
  });

  test("a login-enabled family that never signed in is NEVER", async () => {
    const rep = await guardianEngagement({ days: 90 });
    const row = rep.guardians.find((r) => r.guardianId === G_NEVER.toString())!;
    expect(row.band).toBe("NEVER");
    expect(row.lastLoginAt).toBeNull();
  });

  test("a designated guardian with NO login issued is NO_LOGIN, never NEVER", async () => {
    // D-#474: chasing them is meaningless — nobody gave them a password. The action is
    // to ISSUE one, which is a different queue.
    const rep = await guardianEngagement({ days: 90 });
    const row = rep.guardians.find((r) => r.guardianId === G_CONTACT.toString())!;
    expect(row.band).toBe("NO_LOGIN");
    expect(row.loginEnabled).toBe(false);
  });

  test("rows are sorted most-actionable first — the chase list is the top of the screen", async () => {
    const rep = await guardianEngagement({ days: 90 });
    expect(rep.guardians[0].band).toBe("NO_LOGIN");
    expect(rep.guardians[1].band).toBe("NEVER");
    expect(rep.guardians[rep.guardians.length - 1].band).toBe("REGULAR");
  });
});

describe("Designated-guardian rule (D-#474)", () => {
  test("the second parent, whose link was deactivated, is EXCLUDED from the report", async () => {
    // The defect this fixes: 63% of the live chase list was second parents who were
    // never issued the portal and could never have logged in.
    const rep = await guardianEngagement({ days: 90 });
    expect(rep.guardians.map((r) => r.guardianId)).not.toContain(G_OTHER_PARENT.toString());
  });

  test("a guardian whose only student has left is EXCLUDED even though the link is active", async () => {
    const rep = await guardianEngagement({ days: 90 });
    expect(rep.guardians.map((r) => r.guardianId)).not.toContain(G_DEPARTED.toString());
  });

  test("only the four designated guardians remain", async () => {
    const rep = await guardianEngagement({ days: 90 });
    expect(rep.guardians).toHaveLength(4);
    expect(rep.summary.totalGuardians).toBe(4);
  });

  test("the exclusion is REPORTED, not silent — and flags logins that would show nothing", async () => {
    const rep = await guardianEngagement({ days: 90 });
    expect(rep.summary.excludedNonDesignated).toBe(2);
    // Both excluded rows are login-enabled: they can sign in and land on an empty
    // portal, which reads to a family as a broken app. Nothing else reports this.
    expect(rep.summary.excludedButLoginEnabled).toBe(2);
  });
});

describe("Student-level reachability (D-#474)", () => {
  test("a student counts as reachable when ANY designated guardian has signed in", async () => {
    const rep = await guardianEngagement({ days: 90 });
    // STUDENT (via G_REGULAR) and STUDENT_2 (via G_LAPSED) have logins; 3 and 4 do not.
    expect(rep.summary.studentsTotal).toBe(4);
    expect(rep.summary.studentsReachable).toBe(2);
    expect(rep.summary.studentsUnreachable).toBe(2);
  });

  test("an unreachable student with no credentials anywhere is counted apart", async () => {
    const rep = await guardianEngagement({ days: 90 });
    // STUDENT_4's only designated guardian is contact-only → credential gap, not a chase.
    expect(rep.summary.studentsNoCredentials).toBe(1);
  });

  test("a second guardian who HAS logged in makes the child reachable", async () => {
    // Re-activate the second parent's link and give them a login: the child is now
    // covered even though G_REGULAR's own row is unchanged. Chasing either would be
    // waste — which is the whole reason student-level coverage exists.
    linkRows = [
      { guardianId: G_NEVER, studentId: STUDENT_3, active: true },
      { guardianId: G_OTHER_PARENT, studentId: STUDENT_3, active: true },
    ];
    studentRows = [{ _id: STUDENT_3, name: "Child3", nameBn: "শিশু৩", sectionId: SECTION }];
    auditRows = [{ actorId: G_OTHER_PARENT, eventAt: new Date(now - 2 * DAY) }];
    const rep = await guardianEngagement({ days: 90 });
    expect(rep.summary.studentsTotal).toBe(1);
    expect(rep.summary.studentsReachable).toBe(1);
    expect(rep.guardians.find((r) => r.guardianId === G_NEVER.toString())!.band).toBe("NEVER");
  });
});

describe("Summary", () => {
  test("contact-only guardians are counted apart from never-logged-in", async () => {
    const rep = await guardianEngagement({ days: 90 });
    // G_CONTACT has no login at all; G_NEVER has one but has not used it. Merging
    // them would hide that the two need different fixes.
    expect(rep.summary.contactOnly).toBe(1);
    expect(rep.summary.neverLoggedIn).toBe(1);
    expect(rep.summary.loginEnabled).toBe(3);
    expect(rep.summary.totalGuardians).toBe(4);
  });

  test("the NEVER filter returns ONLY chaseable rows — no contact-only mixed in", async () => {
    // The reported symptom: filtering NEVER returned contact-only guardians too, so the
    // list disagreed with the "never logged in" tile and the chase list was unusable.
    const filtered = await guardianEngagement({ days: 90, band: "NEVER" });
    expect(filtered.guardians).toHaveLength(1);
    expect(filtered.guardians[0].loginEnabled).toBe(true);
    expect(filtered.guardians).toHaveLength(filtered.summary.neverLoggedIn); // tile == list
  });

  test("contact-only rows are reachable under their own band", async () => {
    const filtered = await guardianEngagement({ days: 90, band: "NO_LOGIN" });
    expect(filtered.guardians).toHaveLength(1);
    expect(filtered.guardians[0].loginEnabled).toBe(false);
  });

  test("the denominator ignores row filters", async () => {
    const filtered = await guardianEngagement({ days: 90, band: "NEVER" });
    expect(filtered.summary.totalGuardians).toBe(4); // not 1
  });

  test("viewsSince is null when no view has ever been recorded", async () => {
    const rep = await guardianEngagement({ days: 90 });
    expect(rep.summary.viewsSince).toBeNull();
    expect(rep.summary.viewsRecorded).toBe(0);
  });

  test("children and sections are joined onto the row", async () => {
    const rep = await guardianEngagement({ days: 90 });
    const row = rep.guardians.find((r) => r.guardianId === G_REGULAR.toString())!;
    expect(row.childNames).toEqual(["শিশু"]);
    expect(row.sectionNames).toEqual(["ক শাখা"]);
  });
});

describe("Surfaces and inbox", () => {
  test("every declared surface is returned, including the ones with zero views", async () => {
    viewRows = [{ guardianId: G_REGULAR, surface: "HOME", count: 5, lastAt: new Date(now - DAY) }];
    oldestView = { firstAt: new Date(now - 5 * DAY) };
    const rep = await guardianEngagement({ days: 90 });
    const home = rep.surfaces.find((s) => s.surface === "HOME")!;
    expect(home.views).toBe(5);
    expect(home.distinctGuardians).toBe(1);
    // A screen nobody opens IS the finding — dropping it would hide it.
    expect(rep.surfaces.find((s) => s.surface === "FEES")!.views).toBe(0);
    expect(rep.summary.viewsSince).not.toBeNull();
  });

  test("surface views sum the collapsed per-day counts, not the row count", async () => {
    viewRows = [
      { guardianId: G_REGULAR, surface: "HOMEWORK", count: 4, lastAt: new Date(now - DAY) },
      { guardianId: G_LAPSED, surface: "HOMEWORK", count: 3, lastAt: new Date(now - 2 * DAY) },
    ];
    const rep = await guardianEngagement({ days: 90 });
    const hw = rep.surfaces.find((s) => s.surface === "HOMEWORK")!;
    expect(hw.views).toBe(7);
    expect(hw.distinctGuardians).toBe(2);
  });

  test("inbox delivered/read is tallied per kind", async () => {
    notificationRows = [
      { recipientGuardianId: G_REGULAR, kind: "CLASS_TEST_RESULT", readAt: new Date() },
      { recipientGuardianId: G_LAPSED, kind: "CLASS_TEST_RESULT", readAt: null },
      { recipientGuardianId: G_LAPSED, kind: "CLASS_NOTE_PUBLISHED", readAt: null },
    ];
    const rep = await guardianEngagement({ days: 90 });
    const ct = rep.inboxByKind.find((k) => k.kind === "CLASS_TEST_RESULT")!;
    expect(ct).toEqual({ kind: "CLASS_TEST_RESULT", delivered: 2, read: 1 });
    expect(rep.summary.notificationsDelivered).toBe(3);
    expect(rep.summary.notificationsRead).toBe(1);
  });
});

describe("recordView", () => {
  test("an unknown surface is dropped, never stored", async () => {
    const ok = await recordView({ guardianId: G_REGULAR.toString(), surface: "NOT_A_SURFACE" });
    expect(ok).toBe(false);
    expect(mockViewUpdateOne).not.toHaveBeenCalled();
  });

  test("a known surface upserts with an incrementing count", async () => {
    const ok = await recordView({ guardianId: G_REGULAR.toString(), surface: "HOME" });
    expect(ok).toBe(true);
    const [filter, update, opts] = mockViewUpdateOne.mock.calls[0];
    expect(filter).toMatchObject({ surface: "HOME" });
    expect(filter.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(update.$inc).toEqual({ count: 1 });
    expect(opts).toEqual({ upsert: true });
  });

  test("absent refId/studentId are OMITTED so they hit the index's missing-value slot", async () => {
    await recordView({ guardianId: G_REGULAR.toString(), surface: "HOME", refId: null, studentId: null });
    const [filter] = mockViewUpdateOne.mock.calls[0];
    expect("refId" in filter).toBe(false);
    expect("studentId" in filter).toBe(false);
  });

  test("a telemetry failure never throws — it must not break a guardian's screen", async () => {
    mockViewUpdateOne.mockRejectedValueOnce(new Error("mongo down"));
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      recordView({ guardianId: G_REGULAR.toString(), surface: "HOME" }),
    ).resolves.toBe(false);
    errSpy.mockRestore();
  });
});
