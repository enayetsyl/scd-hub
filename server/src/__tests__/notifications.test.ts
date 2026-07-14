/**
 * Notifications N-1 tests (prd-notifications §8 N1.*, D-#72).
 *
 * N1.1 — emit() is idempotent by dedupeKey (duplicate = silent no-op; the
 *        unique-index race resolves to a no-op too); validates exactly-one
 *        recipient + a known kind
 * N1.2 — inbox reads are own-row only (user vs guardian recipient filters)
 * N1.3 — emitClassNotePublished → login-enabled guardians of the group only
 *        (section + subjectgroup resolution; contact-only guardians get nothing)
 * N1.4 — emitHwParentComms → the section's class teacher, deduped per
 *        student+item; unassigned section = skip (the host-side ≥3 threshold is
 *        covered in homework.test.ts)
 * N1.5 — emitReviewAssigned → the reviewer (host call covered in review.test.ts)
 * N1.6 — emitCoverAssigned → the covering teacher (host call + cancel-emits-
 *        nothing covered in routineCover.test.ts)
 * N1.7 — markRead is own-row (another recipient's row denied); markAllRead
 * Channel fan-out — registered channels run best-effort on NEW rows only and
 *        never block the row (D-#75 posture; runs LAST — registry is module-global).
 *
 * DB-free: Mongoose models mocked, the service + emitters real.
 */
import mongoose from "mongoose";
import { ForbiddenError } from "../middleware/authz";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mock models BEFORE importing the service under test
// ---------------------------------------------------------------------------

const mockNotifUpdateOne = jest.fn();
const mockNotifFindOne = jest.fn();
const mockNotifFind = jest.fn();
const mockNotifCount = jest.fn();
const mockNotifFindOneAndUpdate = jest.fn();
const mockNotifUpdateMany = jest.fn();

jest.mock("../modules/notifications/models/Notification", () => ({
  // Keep the real exports (assertExactlyOneRecipient) — only the model is mocked.
  ...jest.requireActual("../modules/notifications/models/Notification"),
  Notification: {
    updateOne: (f: unknown, u: unknown, o: unknown) => mockNotifUpdateOne(f, u, o),
    findOne: (f: unknown) => ({ lean: () => mockNotifFindOne(f) }),
    find: (f: unknown) => ({ sort: () => ({ limit: () => ({ lean: () => mockNotifFind(f) }) }) }),
    countDocuments: (f: unknown) => mockNotifCount(f),
    findOneAndUpdate: (f: unknown, u: unknown, o: unknown) => ({ lean: () => mockNotifFindOneAndUpdate(f, u, o) }),
    updateMany: (f: unknown, u: unknown) => mockNotifUpdateMany(f, u),
  },
}));

const mockStudentFind = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (f: unknown) => ({ select: () => ({ lean: () => mockStudentFind(f) }) }) },
}));

const mockGuardianFind = jest.fn();
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: { find: (f: unknown) => ({ select: () => ({ lean: () => mockGuardianFind(f) }) }) },
}));

const mockLinkFind = jest.fn();
jest.mock("../modules/foundation/models/GuardianLink", () => ({
  GuardianLink: { find: (f: unknown) => ({ select: () => ({ lean: () => mockLinkFind(f) }) }) },
}));

const mockSectionFindById = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => ({ lean: () => mockSectionFindById(id) }) },
}));

const mockMembershipFind = jest.fn();
jest.mock("../modules/routine/models/SubjectGroupMembership", () => ({
  SubjectGroupMembership: { find: (f: unknown) => ({ select: () => ({ lean: () => mockMembershipFind(f) }) }) },
}));

// Import AFTER mocks
import {
  emit,
  registerChannel,
  myNotifications,
  myUnreadCount,
  markRead,
  markManyRead,
  markAllRead,
} from "../modules/notifications/services/NotificationService";
import {
  emitClassNotePublished,
  emitHwParentComms,
  emitHwGuardianChase,
  emitReviewAssigned,
  emitCoverAssigned,
} from "../modules/notifications/services/emitters";

const USER_ID = oid().toString();
const GUARDIAN_ID = oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifUpdateOne.mockResolvedValue({ upsertedCount: 1 });
  mockNotifFindOne.mockResolvedValue(null);
  mockNotifFind.mockResolvedValue([]);
  mockNotifCount.mockResolvedValue(0);
  mockNotifUpdateMany.mockResolvedValue({ modifiedCount: 0 });
});

function baseEmit(over: Record<string, unknown> = {}) {
  return {
    recipientUserId: USER_ID,
    kind: "REVIEW_ASSIGNED",
    titleBn: "শিরোনাম",
    bodyBn: "বিস্তারিত",
    dedupeKey: "TEST:1",
    ...over,
  };
}

// ===========================================================================
// N1.1 — emit() idempotency + validation
// ===========================================================================

describe("N1.1 emit — idempotent by dedupeKey", () => {
  test("a new dedupeKey writes exactly one row ($setOnInsert upsert)", async () => {
    const res = await emit(baseEmit());
    expect(res.created).toBe(true);
    expect(mockNotifUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update, opts] = mockNotifUpdateOne.mock.calls[0];
    expect(filter).toEqual({ dedupeKey: "TEST:1" });
    expect(update.$setOnInsert).toMatchObject({
      recipientUserId: USER_ID,
      kind: "REVIEW_ASSIGNED",
      titleBn: "শিরোনাম",
      bodyBn: "বিস্তারিত",
    });
    expect(opts).toEqual({ upsert: true });
  });

  test("the same dedupeKey emitted twice is a silent no-op", async () => {
    await emit(baseEmit());
    mockNotifUpdateOne.mockResolvedValue({ upsertedCount: 0 }); // row already exists
    const res = await emit(baseEmit());
    expect(res.created).toBe(false);
  });

  test("a concurrent duplicate (unique-index E11000 race) is a silent no-op, not an error", async () => {
    mockNotifUpdateOne.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    const res = await emit(baseEmit());
    expect(res.created).toBe(false);
  });

  test("exactly one recipient is required (both / neither rejected)", async () => {
    await expect(emit(baseEmit({ recipientUserId: null }))).rejects.toThrow(/exactly one/);
    await expect(emit(baseEmit({ recipientGuardianId: GUARDIAN_ID }))).rejects.toThrow(/exactly one/);
  });

  test("unknown kinds and missing dedupeKey are rejected", async () => {
    await expect(emit(baseEmit({ kind: "NOT_A_KIND" }))).rejects.toThrow(/unknown notification kind/);
    await expect(emit(baseEmit({ dedupeKey: "" }))).rejects.toThrow(/dedupeKey is required/);
  });
});

// ===========================================================================
// N1.2 — own-row inbox reads
// ===========================================================================

describe("N1.2 own-row inbox", () => {
  test("a staff recipient reads only recipientUserId rows", async () => {
    await myNotifications({ userId: USER_ID });
    expect(mockNotifFind).toHaveBeenCalledWith({ recipientUserId: USER_ID });
  });

  test("a guardian recipient reads only recipientGuardianId rows (never staff rows)", async () => {
    await myNotifications({ guardianId: GUARDIAN_ID });
    expect(mockNotifFind).toHaveBeenCalledWith({ recipientGuardianId: GUARDIAN_ID });
  });

  test("unreadOnly narrows to unread rows", async () => {
    await myNotifications({ userId: USER_ID }, { unreadOnly: true });
    expect(mockNotifFind).toHaveBeenCalledWith({ recipientUserId: USER_ID, readAt: null });
  });

  test("a recipient must be exactly one of user/guardian", async () => {
    await expect(myNotifications({})).rejects.toThrow(/exactly one/);
    await expect(myNotifications({ userId: USER_ID, guardianId: GUARDIAN_ID })).rejects.toThrow(/exactly one/);
  });

  test("unread count filters to the recipient's unread rows", async () => {
    mockNotifCount.mockResolvedValue(3);
    const n = await myUnreadCount({ guardianId: GUARDIAN_ID });
    expect(n).toBe(3);
    expect(mockNotifCount).toHaveBeenCalledWith({ recipientGuardianId: GUARDIAN_ID, readAt: null });
  });
});

// ===========================================================================
// N1.7 — markRead / markAllRead (own-row)
// ===========================================================================

describe("N1.7 markRead", () => {
  const NOTIF_ID = oid().toString();

  test("the recipient marks their own unread row read", async () => {
    const row = { _id: NOTIF_ID, readAt: new Date() };
    mockNotifFindOneAndUpdate.mockResolvedValue(row);
    const res = await markRead(NOTIF_ID, { userId: USER_ID });
    expect(res).toBe(row);
    const [filter, update] = mockNotifFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: NOTIF_ID, recipientUserId: USER_ID, readAt: null });
    expect(update.$set.readAt).toBeInstanceOf(Date);
  });

  test("re-marking an already-read own row is a no-op that returns the row", async () => {
    const row = { _id: NOTIF_ID, readAt: new Date("2026-06-01") };
    mockNotifFindOneAndUpdate.mockResolvedValue(null); // not unread any more
    mockNotifFindOne.mockResolvedValue(row); // but it IS this recipient's row
    const res = await markRead(NOTIF_ID, { userId: USER_ID });
    expect(res).toBe(row);
  });

  test("another recipient's row is denied", async () => {
    mockNotifFindOneAndUpdate.mockResolvedValue(null);
    mockNotifFindOne.mockResolvedValue(null); // not an own row at all
    await expect(markRead(NOTIF_ID, { userId: USER_ID })).rejects.toThrow(ForbiddenError);
  });

  test("markAllRead flips only the recipient's unread rows", async () => {
    mockNotifUpdateMany.mockResolvedValue({ modifiedCount: 4 });
    const n = await markAllRead({ guardianId: GUARDIAN_ID });
    expect(n).toBe(4);
    const [filter, update] = mockNotifUpdateMany.mock.calls[0];
    expect(filter).toEqual({ recipientGuardianId: GUARDIAN_ID, readAt: null });
    expect(update.$set.readAt).toBeInstanceOf(Date);
  });

  test("markManyRead flips only the recipient's picked unread rows (D-#307)", async () => {
    const ids = [oid().toString(), oid().toString()];
    mockNotifUpdateMany.mockResolvedValue({ modifiedCount: 2 });
    const n = await markManyRead(ids, { userId: USER_ID });
    expect(n).toBe(2);
    const [filter, update] = mockNotifUpdateMany.mock.calls[0];
    expect(filter).toEqual({ _id: { $in: ids }, recipientUserId: USER_ID, readAt: null });
    expect(update.$set.readAt).toBeInstanceOf(Date);
  });

  test("markManyRead with an empty pick is a no-op that never hits the DB", async () => {
    const n = await markManyRead([], { userId: USER_ID });
    expect(n).toBe(0);
    expect(mockNotifUpdateMany).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// N1.3 — class-note publish → login-enabled guardians only
// ===========================================================================

describe("N1.3 emitClassNotePublished", () => {
  const SLOT_ID = oid();
  const GROUP_ID = oid();
  const G_LOGIN = oid();
  const DATE = new Date(2026, 5, 2); // 2026-06-02

  function note(groupType: "section" | "subjectgroup" = "section") {
    return { _id: oid(), slotId: SLOT_ID, groupType, groupId: GROUP_ID, date: DATE, subject: "BAN" };
  }

  test("section group: one row per LOGIN-ENABLED guardian; contact-only get nothing", async () => {
    const s1 = oid(), s2 = oid();
    mockStudentFind.mockResolvedValue([{ _id: s1 }, { _id: s2 }]);
    // Two siblings link the same login guardian (dedup) + a contact-only guardian.
    const G_CONTACT_ONLY = oid();
    mockLinkFind.mockResolvedValue([
      { guardianId: G_LOGIN },
      { guardianId: G_LOGIN },
      { guardianId: G_CONTACT_ONLY },
    ]);
    mockGuardianFind.mockResolvedValue([{ _id: G_LOGIN }]); // loginEnabled filter drops the other

    await emitClassNotePublished(note("section"));

    // The guardian lookup filters to login-enabled + active (D-#31 limitation).
    expect(mockGuardianFind).toHaveBeenCalledWith(
      expect.objectContaining({ loginEnabled: true, active: true }),
    );
    expect(mockNotifUpdateOne).toHaveBeenCalledTimes(1); // ONE login guardian → ONE row
    const [filter, update] = mockNotifUpdateOne.mock.calls[0];
    expect(filter).toEqual({ dedupeKey: `CNPUB:${SLOT_ID.toString()}:2026-06-02:${G_LOGIN.toString()}` });
    expect(update.$setOnInsert).toMatchObject({
      recipientGuardianId: G_LOGIN.toString(),
      kind: "CLASS_NOTE_PUBLISHED",
    });
  });

  test("subjectgroup: members resolve via SubjectGroupMembership, not Section students", async () => {
    mockMembershipFind.mockResolvedValue([{ studentId: oid() }]);
    mockLinkFind.mockResolvedValue([{ guardianId: G_LOGIN }]);
    mockGuardianFind.mockResolvedValue([{ _id: G_LOGIN }]);

    await emitClassNotePublished(note("subjectgroup"));

    expect(mockMembershipFind).toHaveBeenCalledTimes(1);
    expect(mockStudentFind).not.toHaveBeenCalled();
    expect(mockNotifUpdateOne).toHaveBeenCalledTimes(1);
  });

  test("no students / no login guardians → nothing emitted", async () => {
    mockStudentFind.mockResolvedValue([]);
    await emitClassNotePublished(note("section"));
    expect(mockNotifUpdateOne).not.toHaveBeenCalled();
  });

  test("best-effort: an internal failure never throws into the publish", async () => {
    mockStudentFind.mockRejectedValue(new Error("db down"));
    await expect(emitClassNotePublished(note("section"))).resolves.toBeUndefined();
  });
});

// ===========================================================================
// N1.4 — HW parent-comms → the section's class teacher
// ===========================================================================

describe("N1.4 emitHwParentComms", () => {
  const ITEM_ID = oid();
  const STUDENT_ID = oid();
  const SECTION_ID = oid();
  const TEACHER_ID = oid();

  function record() {
    return { hwItemId: ITEM_ID, hwId: "HW-C1-MATH-0007", studentId: STUDENT_ID, sectionId: SECTION_ID, chaseCount: 3 };
  }

  test("emits to the class teacher, deduped per student+item", async () => {
    mockSectionFindById.mockResolvedValue({ classTeacherId: TEACHER_ID });
    await emitHwParentComms(record());
    expect(mockNotifUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = mockNotifUpdateOne.mock.calls[0];
    expect(filter).toEqual({ dedupeKey: `HWPC:${ITEM_ID.toString()}:${STUDENT_ID.toString()}` });
    expect(update.$setOnInsert).toMatchObject({
      recipientUserId: TEACHER_ID.toString(),
      kind: "HW_PARENT_COMMS",
    });
    expect(update.$setOnInsert.bodyBn).toContain("HW-C1-MATH-0007");
  });

  test("an unassigned section is skipped (no class teacher → nothing to send, no throw)", async () => {
    mockSectionFindById.mockResolvedValue({ classTeacherId: undefined });
    await emitHwParentComms(record());
    expect(mockNotifUpdateOne).not.toHaveBeenCalled();
  });

  test("best-effort: a lookup failure never throws into the transition", async () => {
    mockSectionFindById.mockRejectedValue(new Error("db down"));
    await expect(emitHwParentComms(record())).resolves.toBeUndefined();
  });
});

// ===========================================================================
// D-#260 — HW per-chase guardian notify → login-enabled guardians, once per day
// ===========================================================================

describe("emitHwGuardianChase (D-#260)", () => {
  const ITEM_ID = oid();
  const STUDENT_ID = oid();
  const SECTION_ID = oid();
  const G_LOGIN = oid();
  const AT = new Date(2026, 5, 2); // 2026-06-02

  function event() {
    return { hwItemId: ITEM_ID, hwId: "HW-C5-ENG-0042", studentId: STUDENT_ID, sectionId: SECTION_ID, chaseCount: 1, at: AT };
  }

  test("one row per LOGIN-ENABLED guardian; deduped per student+item+day; contact-only get nothing", async () => {
    const G_CONTACT_ONLY = oid();
    // Two sibling links to the same login guardian (dedup) + a contact-only guardian.
    mockLinkFind.mockResolvedValue([{ guardianId: G_LOGIN }, { guardianId: G_LOGIN }, { guardianId: G_CONTACT_ONLY }]);
    mockGuardianFind.mockResolvedValue([{ _id: G_LOGIN }]); // loginEnabled filter drops the contact-only one

    await emitHwGuardianChase(event());

    expect(mockGuardianFind).toHaveBeenCalledWith(expect.objectContaining({ loginEnabled: true, active: true }));
    expect(mockNotifUpdateOne).toHaveBeenCalledTimes(1); // ONE login guardian → ONE row
    const [filter, update] = mockNotifUpdateOne.mock.calls[0];
    expect(filter).toEqual({ dedupeKey: `HWCG:${ITEM_ID.toString()}:${STUDENT_ID.toString()}:2026-06-02:${G_LOGIN.toString()}` });
    expect(update.$setOnInsert).toMatchObject({ recipientGuardianId: G_LOGIN.toString(), kind: "HW_CHASE" });
    expect(update.$setOnInsert.bodyBn).toContain("HW-C5-ENG-0042");
  });

  test("no login-enabled guardian → nothing emitted", async () => {
    mockLinkFind.mockResolvedValue([{ guardianId: G_LOGIN }]);
    mockGuardianFind.mockResolvedValue([]);
    await emitHwGuardianChase(event());
    expect(mockNotifUpdateOne).not.toHaveBeenCalled();
  });

  test("best-effort: a lookup failure never throws into the transition", async () => {
    mockLinkFind.mockRejectedValue(new Error("db down"));
    await expect(emitHwGuardianChase(event())).resolves.toBeUndefined();
  });
});

// ===========================================================================
// N1.5 / N1.6 — review assigned / cover assigned
// ===========================================================================

describe("N1.5 emitReviewAssigned", () => {
  test("emits to the reviewer with the round's refs, deduped per assignment", async () => {
    const ASSIGNMENT_ID = oid();
    const REVIEWER_ID = oid();
    const ARTIFACT_ID = oid();
    await emitReviewAssigned({
      _id: ASSIGNMENT_ID,
      reviewerId: REVIEWER_ID,
      artifactId: ARTIFACT_ID,
      subject: "BAN",
      classLevel: 3,
      anchorWord: "পাঠ",
      addressNumber: "5",
      roundNumber: 2,
    });
    expect(mockNotifUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = mockNotifUpdateOne.mock.calls[0];
    expect(filter).toEqual({ dedupeKey: `REV:${ASSIGNMENT_ID.toString()}` });
    expect(update.$setOnInsert).toMatchObject({
      recipientUserId: REVIEWER_ID.toString(),
      kind: "REVIEW_ASSIGNED",
      refs: expect.objectContaining({
        reviewAssignmentId: ASSIGNMENT_ID.toString(),
        artifactId: ARTIFACT_ID.toString(),
      }),
    });
  });
});

describe("N1.6 emitCoverAssigned", () => {
  test("emits to the covering teacher with slot+date refs, deduped per substitution", async () => {
    const SUB_ID = oid();
    const SLOT_ID = oid();
    const COVER_ID = oid();
    await emitCoverAssigned({
      _id: SUB_ID,
      slotId: SLOT_ID,
      date: new Date(2026, 5, 2),
      coverTeacherId: COVER_ID,
    });
    expect(mockNotifUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = mockNotifUpdateOne.mock.calls[0];
    expect(filter).toEqual({ dedupeKey: `COV:${SUB_ID.toString()}` });
    expect(update.$setOnInsert).toMatchObject({
      recipientUserId: COVER_ID.toString(),
      kind: "COVER_ASSIGNED",
      refs: expect.objectContaining({ slotId: SLOT_ID.toString(), date: "2026-06-02" }),
    });
  });
});

// ===========================================================================
// Channel fan-out (the seam, D-#72/D-#75 posture) — LAST: the registry is
// module-global, so once registered the channel sees every later NEW row.
// ===========================================================================

describe("channel fan-out behind emit()", () => {
  const deliver = jest.fn();

  test("a registered channel runs on a NEW row only", async () => {
    registerChannel({ name: "test-channel", deliver });
    const row = { _id: oid(), dedupeKey: "CH:1" };
    mockNotifFindOne.mockResolvedValue(row);
    deliver.mockResolvedValue(undefined);

    await emit(baseEmit({ dedupeKey: "CH:1" }));
    expect(deliver).toHaveBeenCalledWith(row);

    deliver.mockClear();
    mockNotifUpdateOne.mockResolvedValue({ upsertedCount: 0 }); // duplicate emit
    await emit(baseEmit({ dedupeKey: "CH:1" }));
    expect(deliver).not.toHaveBeenCalled(); // no fan-out on a no-op
  });

  test("a channel failure never blocks the row (emit still resolves created=true)", async () => {
    mockNotifFindOne.mockResolvedValue({ _id: oid(), dedupeKey: "CH:2" });
    deliver.mockRejectedValue(new Error("push service down"));
    const res = await emit(baseEmit({ dedupeKey: "CH:2" }));
    expect(res.created).toBe(true);
  });
});
