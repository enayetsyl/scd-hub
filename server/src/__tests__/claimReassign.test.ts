/**
 * BUG-WC-7 — an open claim must follow the teaching, not stay with whoever held it
 * the day it was filed.
 *
 * The prod case (2026-08-30): a subject was reassigned, so the teacher named on six
 * open C1 MATH claims could no longer open the tracker to answer them, while the
 * teacher who now held the grant was never told they existed.
 *
 * Owner rulings that these tests pin: the grant always wins over the timetable, and
 * the new teacher is notified IMMEDIATELY rather than at the next 11:30 rung.
 */
import mongoose from "mongoose";

const mockClaimFind = jest.fn();
const mockSubjectById = jest.fn();
const mockResolve = jest.fn();
const mockEmitHandover = jest.fn();
const mockAudit = jest.fn();
const mockEmit = jest.fn();
const mockStudentById = jest.fn();

// The notification SINK and the roster, so the real emitters can be driven without
// a database — everything else about them stays real, including the dedupe keys.
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (...a: unknown[]) => mockEmit(...a),
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockStudentById(id) }) }) },
}));

jest.mock("../modules/trackers/models/GuardianWorkClaim", () => ({
  GuardianWorkClaim: { find: (q: unknown) => mockClaimFind(q) },
}));
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockSubjectById(id) }) }) },
}));
jest.mock("../modules/trackers/services/ClaimRecipient", () => ({
  resolveClaimRecipient: (...a: unknown[]) => mockResolve(...a),
}));
jest.mock("../modules/notifications/services/emitters", () => ({
  ...jest.requireActual("../modules/notifications/services/emitters"),
  emitWorkClaimReassigned: (...a: unknown[]) => mockEmitHandover(...a),
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (...a: unknown[]) => mockAudit(...a),
}));

import {
  reassignClaimsForSubject,
  reassignAllOpenClaims,
  SYSTEM_ACTOR_ID,
} from "../modules/trackers/services/ClaimReassignService";

const oid = () => new mongoose.Types.ObjectId();
const SECTION = oid();
const SUBJECT_ID = oid();
const OLD_TEACHER = oid();
const NEW_TEACHER = oid();

/** A claim row as Mongoose hands it back: mutable, with a spy `save`. */
const claimDoc = (teacherId: mongoose.Types.ObjectId) => ({
  _id: oid(),
  tracker: "HOMEWORK" as const,
  workId: "HW-C1-MATH-0017",
  subject: "MATH",
  studentId: oid(),
  sectionId: SECTION,
  teacherId,
  teacherSource: "ROUTINE",
  claimedByGuardianId: oid(),
  save: jest.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSubjectById.mockResolvedValue({ code: "MATH" });
  mockStudentById.mockResolvedValue({ nameBn: "ইউসুফ খান সাফওয়ান" });
});

describe("reassignClaimsForSubject — the claim follows the teaching", () => {
  test("moves the claim to the new grant holder and notifies them AT ONCE", async () => {
    const claim = claimDoc(OLD_TEACHER);
    mockClaimFind.mockResolvedValue([claim]);
    mockResolve.mockResolvedValue({ teacherId: NEW_TEACHER, source: "GRANT" });

    const res = await reassignClaimsForSubject(SECTION, SUBJECT_ID, "admin-1");

    expect(res).toEqual({ examined: 1, moved: 1 });
    expect(claim.teacherId.toString()).toBe(NEW_TEACHER.toString());
    expect(claim.teacherSource).toBe("GRANT");
    expect(claim.save).toHaveBeenCalled();
    // the new owner is told now, not at tomorrow's rung
    expect(mockEmitHandover).toHaveBeenCalledTimes(1);
    expect(mockEmitHandover.mock.calls[0][0].teacherId).toBe(NEW_TEACHER.toString());
  });

  test("only PENDING claims for this section x subject are examined", async () => {
    mockClaimFind.mockResolvedValue([]);
    await reassignClaimsForSubject(SECTION, SUBJECT_ID);
    expect(mockClaimFind.mock.calls[0][0]).toMatchObject({
      sectionId: expect.anything(),
      subject: "MATH",
      status: "PENDING",
    });
  });

  test("an unchanged owner is left alone — no save, no second notification", async () => {
    const claim = claimDoc(OLD_TEACHER);
    mockClaimFind.mockResolvedValue([claim]);
    mockResolve.mockResolvedValue({ teacherId: OLD_TEACHER, source: "GRANT" });

    const res = await reassignClaimsForSubject(SECTION, SUBJECT_ID);

    expect(res.moved).toBe(0);
    expect(claim.save).not.toHaveBeenCalled();
    expect(mockEmitHandover).not.toHaveBeenCalled();
  });

  test("nobody reachable → the claim STAYS where it is rather than being orphaned", async () => {
    const claim = claimDoc(OLD_TEACHER);
    mockClaimFind.mockResolvedValue([claim]);
    mockResolve.mockResolvedValue(null);

    const res = await reassignClaimsForSubject(SECTION, SUBJECT_ID);

    expect(res.moved).toBe(0);
    expect(claim.teacherId.toString()).toBe(OLD_TEACHER.toString());
    expect(claim.save).not.toHaveBeenCalled();
  });

  test("the handover is audited", async () => {
    const claim = claimDoc(OLD_TEACHER);
    mockClaimFind.mockResolvedValue([claim]);
    mockResolve.mockResolvedValue({ teacherId: NEW_TEACHER, source: "GRANT" });

    await reassignClaimsForSubject(SECTION, SUBJECT_ID, "admin-1");

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "WORK_CLAIM_REASSIGNED",
        actorId: "admin-1",
        meta: expect.objectContaining({
          from: OLD_TEACHER.toString(),
          to: NEW_TEACHER.toString(),
        }),
      }),
    );
  });

  test("a failure moving claims never fails the grant change itself", async () => {
    mockClaimFind.mockRejectedValue(new Error("mongo is having a day"));
    await expect(reassignClaimsForSubject(SECTION, SUBJECT_ID)).resolves.toEqual({
      examined: 0,
      moved: 0,
    });
  });

  test("an unknown subject is a no-op, not a throw", async () => {
    mockSubjectById.mockResolvedValue(null);
    const res = await reassignClaimsForSubject(SECTION, SUBJECT_ID);
    expect(res).toEqual({ examined: 0, moved: 0 });
    expect(mockClaimFind).not.toHaveBeenCalled();
  });
});

describe("reassignAllOpenClaims — the daily safety net", () => {
  test("sweeps every open claim, whatever changed underneath it", async () => {
    const a = claimDoc(OLD_TEACHER);
    const b = claimDoc(OLD_TEACHER);
    mockClaimFind.mockResolvedValue([a, b]);
    mockResolve.mockResolvedValue({ teacherId: NEW_TEACHER, source: "GRANT" });

    const res = await reassignAllOpenClaims();

    expect(mockClaimFind.mock.calls[0][0]).toEqual({ status: "PENDING" });
    expect(res).toEqual({ examined: 2, moved: 2 });
    expect(mockEmitHandover).toHaveBeenCalledTimes(2);
  });
});

/**
 * The audit rows must be STORABLE, not merely requested.
 *
 * `writeAudit` swallows its own failures on purpose — a log write must never take
 * down the request — so an unstorable row is lost in silence. The first production
 * sweep moved 18 claims correctly and wrote 0 audit rows, because `actorId` was the
 * string "system" and `Audit.actorId` is an ObjectId. The old test asserted that
 * writeAudit was CALLED, which was true and useless.
 *
 * So these validate the captured payload against the real Audit schema. No database:
 * `validateSync` runs the same casts mongoose would run on save.
 */
describe("the audit row it writes can actually be stored", () => {
  test("the payload passes the real Audit schema", async () => {
    const claim = claimDoc(OLD_TEACHER);
    mockClaimFind.mockResolvedValue([claim]);
    mockResolve.mockResolvedValue({ teacherId: NEW_TEACHER, source: "GRANT" });

    await reassignClaimsForSubject(SECTION, SUBJECT_ID, "6a2f7c1af97c0ab0f571a14b");

    const { Audit } = jest.requireActual<{ Audit: new (d: unknown) => { validateSync(): unknown } }>(
      "../modules/platform/models/Audit",
    );
    const payload = mockAudit.mock.calls[0][0];
    expect(new Audit({ ...payload, eventAt: new Date() }).validateSync()).toBeUndefined();
  });

  test("the SWEEP's own actor casts — the exact production failure", async () => {
    const claim = claimDoc(OLD_TEACHER);
    mockClaimFind.mockResolvedValue([claim]);
    mockResolve.mockResolvedValue({ teacherId: NEW_TEACHER, source: "GRANT" });

    // no actorId: the daily sweep has no human behind it
    await reassignAllOpenClaims();

    const { Audit } = jest.requireActual<{ Audit: new (d: unknown) => { validateSync(): unknown } }>(
      "../modules/platform/models/Audit",
    );
    const payload = mockAudit.mock.calls[0][0];
    expect(payload.actorId).toBe(SYSTEM_ACTOR_ID);
    // "system" would fail here with a CastError, exactly as it did in production
    expect(new Audit({ ...payload, eventAt: new Date() }).validateSync()).toBeUndefined();
  });
});

describe("the handover notice must not be swallowed by the original filing", () => {
  /** The real emitters, with only the notification sink and the roster mocked. */
  const realEmitters = () =>
    jest.requireActual<{
      emitWorkClaimFiled: (e: Record<string, string>) => Promise<void>;
      emitWorkClaimReassigned: (e: Record<string, string>) => Promise<void>;
    }>("../modules/notifications/services/emitters");

  const event = (teacherId: string) => ({
    claimId: "claim-1",
    tracker: "HOMEWORK",
    workId: "HW-C1-MATH-0017",
    subject: "MATH",
    studentId: "student-1",
    sectionId: "section-1",
    teacherId,
    claimedByGuardianId: "guardian-1",
  });

  const keyOf = (call: number) => mockEmit.mock.calls[call][0].dedupeKey as string;

  test("a handover reaches the new owner even though the claim was already filed", async () => {
    const { emitWorkClaimFiled, emitWorkClaimReassigned } = realEmitters();

    await emitWorkClaimFiled(event("teacher-a"));
    await emitWorkClaimReassigned(event("teacher-b"));

    expect(mockEmit).toHaveBeenCalledTimes(2);
    // Different keys, or the second emit is deduped away and the new teacher —
    // the only person who can now answer the claim — is told nothing at all.
    expect(keyOf(1)).not.toBe(keyOf(0));
    expect(mockEmit.mock.calls[1][0].recipientUserId).toBe("teacher-b");
    expect(mockEmit.mock.calls[1][0].refs.workClaimId).toBe("claim-1");
  });

  test("each new owner is told, but no owner is told twice", async () => {
    const { emitWorkClaimReassigned } = realEmitters();

    await emitWorkClaimReassigned(event("teacher-b"));
    await emitWorkClaimReassigned(event("teacher-c"));
    await emitWorkClaimReassigned(event("teacher-b"));

    expect(keyOf(0)).not.toBe(keyOf(1));
    expect(keyOf(2)).toBe(keyOf(0));
  });
});
