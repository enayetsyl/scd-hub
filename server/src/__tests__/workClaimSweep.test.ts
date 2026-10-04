/**
 * GC-5 / D-#710 tests — the 10:30 escalation digest and the expiry sweep.
 *
 * What must hold:
 *   - the digest reads the STORED action day, so a claim filed after 10:30 is not
 *     escalated the same day
 *   - a claim still open the next day appears in that day's digest again
 *   - ONE digest per recipient carrying the count + per-teacher breakdown, never
 *     one per claim; recipients come from the digest service (Principal + Office +
 *     the Principal-named extras)
 *   - stamping is idempotent, so a restart mid-digest re-emits nothing new
 *   - a failed emit leaves claims UNSTAMPED, so the next tick retries
 *
 * DB-free: the claim model, the digest service, the emitter and the audit log are mocked.
 */
import mongoose from "mongoose";

const mockFind = jest.fn();
const mockEmitEsc = jest.fn();
const mockAudit = jest.fn();
const mockRecipients = jest.fn();
const mockByTeacher = jest.fn();

jest.mock("../modules/trackers/models/GuardianWorkClaim", () => ({
  GuardianWorkClaim: { find: (q: unknown) => mockFind(q) },
}));
jest.mock("../modules/notifications/services/emitters", () => ({
  emitWorkClaimEscalation: (...a: unknown[]) => mockEmitEsc(...a),
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockAudit(p),
}));
jest.mock("../modules/trackers/services/WorkClaimDigestService", () => ({
  digestRecipientIds: () => mockRecipients(),
  pendingByTeacher: (...a: unknown[]) => mockByTeacher(...a),
}));

import {
  runWorkClaimDigest,
  expireStaleWorkClaims,
} from "../modules/trackers/services/WorkClaimSweepService";

const oid = () => new mongoose.Types.ObjectId();

function claim(over: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = {
    _id: oid(),
    workId: "HW-C4-MATH-0012",
    teacherId: oid(),
    actionDateKey: "2026-08-25",
    status: "PENDING",
    officeNotifiedAt: undefined,
    principalNotifiedAt: undefined,
    ...over,
  };
  return {
    ...store,
    get: (k: string) => store[k],
    set: (k: string, v: unknown) => {
      store[k] = v;
      (store as never as Record<string, unknown>)[k] = v;
    },
    save: jest.fn().mockResolvedValue(undefined),
    _store: store,
  };
}

const RECIPIENTS = ["principal", "akmol", "akter", "tazkir"];
const BREAKDOWN = [{ teacherId: "t1", teacherName: "Tamany", count: 2, oldestDays: 3 }];

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitEsc.mockResolvedValue(4);
  mockAudit.mockResolvedValue(undefined);
  mockRecipients.mockResolvedValue(RECIPIENTS);
  mockByTeacher.mockResolvedValue(BREAKDOWN);
});

describe("runWorkClaimDigest — the one 10:30 digest (D-#710)", () => {
  const AT = new Date("2026-08-25T10:30:00");

  test("asks only for OPEN claims whose action day has ARRIVED", async () => {
    mockFind.mockResolvedValue([]);
    await runWorkClaimDigest(AT);
    expect(mockFind).toHaveBeenCalledWith({
      status: "PENDING",
      actionDateKey: { $lte: "2026-08-25" },
    });
  });

  test("nothing open is a cheap no-op — no recipients looked up, nothing emitted", async () => {
    mockFind.mockResolvedValue([]);
    const res = await runWorkClaimDigest(AT);
    expect(res).toEqual({ openCount: 0, notified: 0 });
    expect(mockEmitEsc).not.toHaveBeenCalled();
    expect(mockRecipients).not.toHaveBeenCalled();
  });

  test("ONE digest to every recipient, carrying the COUNT and the per-teacher breakdown", async () => {
    const claims = [claim(), claim(), claim()];
    mockFind.mockResolvedValue(claims);
    const res = await runWorkClaimDigest(AT);
    expect(mockEmitEsc).toHaveBeenCalledTimes(1);
    expect(mockEmitEsc).toHaveBeenCalledWith(RECIPIENTS, 3, BREAKDOWN, AT);
    // The breakdown is computed from exactly the due claims' teacher + action day.
    expect(mockByTeacher.mock.calls[0][0]).toEqual(
      claims.map((c) => ({ teacherId: c._store.teacherId, actionDateKey: c._store.actionDateKey })),
    );
    expect(res).toEqual({ openCount: 3, notified: 4 });
  });

  test("stamps principalNotifiedAt — the queue then reads '১০:৩০ পার'", async () => {
    const c = claim();
    mockFind.mockResolvedValue([c]);
    await runWorkClaimDigest(AT);
    expect(c._store.principalNotifiedAt).toEqual(AT);
    expect(c._store.officeNotifiedAt).toBeUndefined();
  });

  test("an already-stamped claim is not re-saved — a restart re-emits nothing new", async () => {
    const c = claim({ principalNotifiedAt: new Date("2026-08-24T10:30:00") });
    mockFind.mockResolvedValue([c]);
    await runWorkClaimDigest(AT);
    expect(c.save).not.toHaveBeenCalled();
  });

  test("a claim open from YESTERDAY appears again today — that is the chasing", async () => {
    mockFind.mockResolvedValue([claim({ actionDateKey: "2026-08-24" })]);
    const res = await runWorkClaimDigest(AT);
    expect(res.openCount).toBe(1);
    expect(mockEmitEsc).toHaveBeenCalledWith(RECIPIENTS, 1, BREAKDOWN, AT);
  });

  test("a failed emit leaves claims UNSTAMPED so the next tick retries", async () => {
    const c = claim();
    mockFind.mockResolvedValue([c]);
    mockEmitEsc.mockRejectedValue(new Error("inbox down"));
    await expect(runWorkClaimDigest(AT)).rejects.toThrow();
    expect(c._store.principalNotifiedAt).toBeUndefined();
    expect(c.save).not.toHaveBeenCalled();
  });
});

describe("expireStaleWorkClaims — queue hygiene, never deletion", () => {
  test("an expired claim is marked EXPIRED and AUDITED, never removed", async () => {
    const c = claim({ actionDateKey: "2026-07-01" });
    mockFind.mockResolvedValue([c]);
    const n = await expireStaleWorkClaims(new Date("2026-08-25T13:00:00"));
    expect(n).toBe(1);
    // the service assigns .status directly (not via .set), so it lands on the doc
    expect((c as unknown as { status: string }).status).toBe("EXPIRED");
    expect(c.save).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "WORK_CLAIM_EXPIRED" }),
    );
  });

  test("the cutoff is generous — a claim from a few days ago is NOT expired", async () => {
    mockFind.mockResolvedValue([]);
    await expireStaleWorkClaims(new Date("2026-08-25T13:00:00"));
    const filter = mockFind.mock.calls[0][0] as { actionDateKey: { $lt: string } };
    // 7 school days rounded up to 11 calendar days → 2026-08-14.
    expect(filter.actionDateKey.$lt < "2026-08-20").toBe(true);
    expect(filter.actionDateKey.$lt > "2026-08-01").toBe(true);
  });
});
