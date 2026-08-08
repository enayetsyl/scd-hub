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
const STUDENT = oid();
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
  ];
  linkRows = [{ guardianId: G_REGULAR, studentId: STUDENT, active: true }];
  studentRows = [{ _id: STUDENT, name: "Child", nameBn: "শিশু", sectionId: SECTION }];
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

  test("rows are sorted least-engaged first — the chase list is the top of the screen", async () => {
    const rep = await guardianEngagement({ days: 90 });
    expect(rep.guardians[0].band).toBe("NEVER");
    expect(rep.guardians[rep.guardians.length - 1].band).toBe("REGULAR");
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

  test("the denominator ignores row filters", async () => {
    const filtered = await guardianEngagement({ days: 90, band: "NEVER" });
    // Both no-login families: the one who was given a login and never used it, and the
    // contact-only one who never had the option. Both belong in NEVER — each still
    // needs an action — and `loginEnabled` on the row is what tells them apart, so the
    // Principal knows whether to chase the family or first create the login.
    expect(filtered.guardians).toHaveLength(2);
    expect(filtered.guardians.map((r) => r.loginEnabled).sort()).toEqual([false, true]);
    expect(filtered.summary.totalGuardians).toBe(4); // not 2
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
