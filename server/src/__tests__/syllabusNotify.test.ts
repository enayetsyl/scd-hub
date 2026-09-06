/**
 * Syllabus notification fan-out (D-#644).
 *
 * Publish → every LOGIN-ENABLED guardian of a child in the syllabus's CLASS, one
 * row each, keyed per guardian AND per publish stamp. Sign-off → the Principal,
 * who alone can publish it.
 *
 * The two things this suite exists to hold:
 *   1. the recipient set is drawn the way `guardianChildSyllabus` draws it (the
 *      CLASS, not a section), so nobody is told about a syllabus their own screen
 *      does not list;
 *   2. the dedupe key is PER GUARDIAN — an entity-only key silently swallows the
 *      re-emit to a guardian linked after the first publish (the recorded trap).
 *
 * DB-free (repo convention): models are mocked, the emitters are real.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockNotifUpdateOne = jest.fn();
jest.mock("../modules/notifications/models/Notification", () => ({
  ...jest.requireActual("../modules/notifications/models/Notification"),
  Notification: {
    updateOne: (f: unknown, u: unknown, o: unknown) => mockNotifUpdateOne(f, u, o),
    findOne: () => ({ lean: async () => null }),
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

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (f: unknown) => ({ select: () => ({ lean: () => mockUserFind(f) }) }) },
}));

import {
  emitSyllabusPublished,
  emitSyllabusAwaitingPublish,
} from "../modules/notifications/services/emitters";

const SYLLABUS = oid();
const EXAM = oid();
const CLASS = oid();
const PUBLISHED_AT = new Date("2026-09-06T04:00:00.000Z");
const APPROVED_AT = new Date("2026-09-05T09:30:00.000Z");

const STUDENT_A = oid();
const STUDENT_B = oid();
const G_LOGIN_1 = oid();
const G_LOGIN_2 = oid();
const PRINCIPAL_A = oid();

function publishEvent(over: Record<string, unknown> = {}) {
  return {
    syllabusId: SYLLABUS,
    examId: EXAM,
    classId: CLASS,
    subject: "ARABIC",
    publishedAt: PUBLISHED_AT,
    examName: "বার্ষিক পরীক্ষা ২০২৬",
    className: "তৃতীয় শ্রেণি",
    ...over,
  };
}

function approvedEvent(over: Record<string, unknown> = {}) {
  return {
    syllabusId: SYLLABUS,
    examId: EXAM,
    classId: CLASS,
    subject: "ARABIC",
    approvedAt: APPROVED_AT,
    examName: "বার্ষিক পরীক্ষা ২০২৬",
    className: "তৃতীয় শ্রেণি",
    teacherName: "Roksana Begum",
    ...over,
  };
}

/** Every emitted row, as (dedupeKey, $setOnInsert) pairs. */
function emitted() {
  return mockNotifUpdateOne.mock.calls.map(([filter, update]) => ({
    dedupeKey: (filter as { dedupeKey: string }).dedupeKey,
    row: (update as { $setOnInsert: Record<string, unknown> }).$setOnInsert,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifUpdateOne.mockResolvedValue({ upsertedCount: 1 });
  mockStudentFind.mockResolvedValue([{ _id: STUDENT_A }, { _id: STUDENT_B }]);
  mockLinkFind.mockResolvedValue([{ guardianId: G_LOGIN_1 }, { guardianId: G_LOGIN_2 }]);
  mockGuardianFind.mockResolvedValue([{ _id: G_LOGIN_1 }, { _id: G_LOGIN_2 }]);
  mockUserFind.mockResolvedValue([{ _id: PRINCIPAL_A }]);
});

// ===========================================================================
// publish → the class's guardians
// ===========================================================================

describe("emitSyllabusPublished", () => {
  test("one row per login-enabled guardian of the CLASS, carrying the deep-link refs", async () => {
    await emitSyllabusPublished(publishEvent());

    const rows = emitted();
    expect(rows).toHaveLength(2);
    for (const { row } of rows) {
      expect(row.kind).toBe("EXAM_SYLLABUS_PUBLISHED");
      expect(row.recipientUserId).toBeUndefined(); // a guardian row, never a staff one
      expect(row.refs).toEqual({
        syllabusId: SYLLABUS.toString(),
        examId: EXAM.toString(),
        classId: CLASS.toString(),
        subject: "ARABIC",
      });
      expect(row.bodyBn).toContain("তৃতীয় শ্রেণি");
      expect(row.bodyBn).toContain("বার্ষিক পরীক্ষা ২০২৬");
    }
    expect(rows.map((r) => r.row.recipientGuardianId).sort()).toEqual(
      [G_LOGIN_1.toString(), G_LOGIN_2.toString()].sort(),
    );
  });

  test("the recipient set is the CLASS's students — the same axis the guardian read uses", async () => {
    await emitSyllabusPublished(publishEvent());
    expect(mockStudentFind).toHaveBeenCalledWith({ classId: CLASS, active: true });
  });

  test("contact-only guardians are excluded — the query asks for login-enabled only", async () => {
    await emitSyllabusPublished(publishEvent());
    const filter = mockGuardianFind.mock.calls[0][0];
    expect(filter).toMatchObject({ loginEnabled: true, active: true });
  });

  test("the dedupe key is per GUARDIAN, so a newly linked family is not swallowed", async () => {
    await emitSyllabusPublished(publishEvent());
    const keys = emitted().map((r) => r.dedupeKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys.every((k) => k.startsWith(`SYLPUB:${SYLLABUS.toString()}:`))).toBe(true);
    expect(keys.some((k) => k.endsWith(G_LOGIN_1.toString()))).toBe(true);
  });

  test("re-publishing the same stamp repeats the key (a no-op); a NEW stamp re-notifies", async () => {
    await emitSyllabusPublished(publishEvent());
    const first = emitted().map((r) => r.dedupeKey);

    jest.clearAllMocks();
    mockNotifUpdateOne.mockResolvedValue({ upsertedCount: 0 });
    mockStudentFind.mockResolvedValue([{ _id: STUDENT_A }, { _id: STUDENT_B }]);
    mockLinkFind.mockResolvedValue([{ guardianId: G_LOGIN_1 }, { guardianId: G_LOGIN_2 }]);
    mockGuardianFind.mockResolvedValue([{ _id: G_LOGIN_1 }, { _id: G_LOGIN_2 }]);
    await emitSyllabusPublished(publishEvent());
    expect(emitted().map((r) => r.dedupeKey)).toEqual(first);

    // §7.3: an edit sends the row back to DRAFT; the re-publish is a new release.
    jest.clearAllMocks();
    mockNotifUpdateOne.mockResolvedValue({ upsertedCount: 1 });
    mockStudentFind.mockResolvedValue([{ _id: STUDENT_A }, { _id: STUDENT_B }]);
    mockLinkFind.mockResolvedValue([{ guardianId: G_LOGIN_1 }, { guardianId: G_LOGIN_2 }]);
    mockGuardianFind.mockResolvedValue([{ _id: G_LOGIN_1 }, { _id: G_LOGIN_2 }]);
    await emitSyllabusPublished(publishEvent({ publishedAt: new Date("2026-09-10T04:00:00.000Z") }));
    const republished = emitted().map((r) => r.dedupeKey);
    expect(republished.some((k) => first.includes(k))).toBe(false);
  });

  test("a class with no students, or none with a login-enabled guardian, emits nothing", async () => {
    mockStudentFind.mockResolvedValue([]);
    await emitSyllabusPublished(publishEvent());
    expect(mockNotifUpdateOne).not.toHaveBeenCalled();

    jest.clearAllMocks();
    mockStudentFind.mockResolvedValue([{ _id: STUDENT_A }]);
    mockLinkFind.mockResolvedValue([{ guardianId: G_LOGIN_1 }]);
    mockGuardianFind.mockResolvedValue([]); // contact-only family
    await emitSyllabusPublished(publishEvent());
    expect(mockNotifUpdateOne).not.toHaveBeenCalled();
  });

  test("a failure is swallowed — a notification never rolls back the publish", async () => {
    mockStudentFind.mockRejectedValue(new Error("atlas is down"));
    await expect(emitSyllabusPublished(publishEvent())).resolves.toBeUndefined();
  });
});

// ===========================================================================
// teacher sign-off → the Principal
// ===========================================================================

describe("emitSyllabusAwaitingPublish", () => {
  test("goes to the Principal — the only desk that can publish it", async () => {
    await emitSyllabusAwaitingPublish(approvedEvent());

    const rows = emitted();
    expect(rows).toHaveLength(1);
    expect(rows[0].row.kind).toBe("EXAM_SYLLABUS_AWAITING_PUBLISH");
    expect(rows[0].row.recipientUserId).toBe(PRINCIPAL_A.toString());
    expect(rows[0].row.recipientGuardianId).toBeUndefined();
    expect(rows[0].row.bodyBn).toContain("Roksana Begum");
    expect(rows[0].dedupeKey).toBe(
      `SYLAWP:${SYLLABUS.toString()}:${APPROVED_AT.toISOString()}:${PRINCIPAL_A.toString()}`,
    );
  });

  test("the lookup matches the publish gate — anyone ACTING as Principal, active only", async () => {
    await emitSyllabusAwaitingPublish(approvedEvent());
    const filter = mockUserFind.mock.calls[0][0];
    expect(filter).toMatchObject({ active: true });
    expect(JSON.stringify(filter)).toContain("PRINCIPAL");
  });

  test("a second sign-off after a send-back is a NEW stamp, so it notifies again", async () => {
    await emitSyllabusAwaitingPublish(approvedEvent());
    const first = emitted()[0].dedupeKey;

    jest.clearAllMocks();
    mockNotifUpdateOne.mockResolvedValue({ upsertedCount: 1 });
    mockUserFind.mockResolvedValue([{ _id: PRINCIPAL_A }]);
    await emitSyllabusAwaitingPublish(approvedEvent({ approvedAt: new Date("2026-09-07T06:00:00.000Z") }));
    expect(emitted()[0].dedupeKey).not.toBe(first);
  });

  test("no Principal on file emits nothing, and a failure is swallowed", async () => {
    mockUserFind.mockResolvedValue([]);
    await emitSyllabusAwaitingPublish(approvedEvent());
    expect(mockNotifUpdateOne).not.toHaveBeenCalled();

    mockUserFind.mockRejectedValue(new Error("atlas is down"));
    await expect(emitSyllabusAwaitingPublish(approvedEvent())).resolves.toBeUndefined();
  });
});
