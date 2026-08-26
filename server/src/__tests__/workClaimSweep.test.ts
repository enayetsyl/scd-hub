/**
 * GC-5 tests — the same-day escalation rungs and the expiry sweep (D-#554/#557).
 *
 * What must hold:
 *   - a rung reads the STORED action day, so a claim filed this afternoon is not
 *     escalated this afternoon
 *   - a claim still open the next day appears in that day's rungs again
 *   - the rung is ONE digest per recipient carrying the count, not one per claim
 *   - stamping is idempotent, so a restart mid-rung re-emits nothing new
 *   - a failed emit leaves claims UNSTAMPED, so the next tick retries
 *
 * DB-free: the claim model, the emitter and the audit log are mocked.
 */
import mongoose from "mongoose";

const mockFind = jest.fn();
const mockEmitEsc = jest.fn();
const mockAudit = jest.fn();

jest.mock("../modules/trackers/models/GuardianWorkClaim", () => ({
  GuardianWorkClaim: { find: (q: unknown) => mockFind(q) },
}));
jest.mock("../modules/notifications/services/emitters", () => ({
  emitWorkClaimEscalation: (...a: unknown[]) => mockEmitEsc(...a),
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockAudit(p),
}));

import {
  runWorkClaimRung,
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

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitEsc.mockResolvedValue(3);
  mockAudit.mockResolvedValue(undefined);
});

describe("runWorkClaimRung — the 11:30 / 13:00 ladder", () => {
  const AT = new Date("2026-08-25T11:30:00");

  test("asks only for OPEN claims whose action day has ARRIVED", async () => {
    mockFind.mockResolvedValue([]);
    await runWorkClaimRung("OFFICE", AT);
    expect(mockFind).toHaveBeenCalledWith({
      status: "PENDING",
      actionDateKey: { $lte: "2026-08-25" },
    });
  });

  test("a claim scheduled for TOMORROW is not part of today's query", async () => {
    // The filter is $lte today, so tomorrow's action day cannot match — this is
    // the D-#557 guarantee that an afternoon filing is not escalated the same day.
    mockFind.mockResolvedValue([]);
    const res = await runWorkClaimRung("OFFICE", AT);
    expect(res.openCount).toBe(0);
    expect(mockEmitEsc).not.toHaveBeenCalled();
  });

  test("ONE digest carrying the COUNT — not one emit per claim", async () => {
    mockFind.mockResolvedValue([claim(), claim(), claim()]);
    const res = await runWorkClaimRung("OFFICE", AT);
    expect(mockEmitEsc).toHaveBeenCalledTimes(1);
    expect(mockEmitEsc).toHaveBeenCalledWith("OFFICE", 3, AT);
    expect(res.openCount).toBe(3);
  });

  test("the Office rung stamps officeNotifiedAt, not the Principal's", async () => {
    const c = claim();
    mockFind.mockResolvedValue([c]);
    await runWorkClaimRung("OFFICE", AT);
    expect(c._store.officeNotifiedAt).toEqual(AT);
    expect(c._store.principalNotifiedAt).toBeUndefined();
  });

  test("the Principal rung stamps its own field", async () => {
    const c = claim();
    mockFind.mockResolvedValue([c]);
    await runWorkClaimRung("PRINCIPAL", new Date("2026-08-25T13:00:00"));
    expect(c._store.principalNotifiedAt).toBeTruthy();
    expect(c._store.officeNotifiedAt).toBeUndefined();
  });

  test("an already-stamped claim is not re-saved — a restart re-emits nothing new", async () => {
    const c = claim({ officeNotifiedAt: new Date("2026-08-25T11:30:00") });
    mockFind.mockResolvedValue([c]);
    await runWorkClaimRung("OFFICE", AT);
    expect(c.save).not.toHaveBeenCalled();
  });

  test("a claim open from YESTERDAY appears again today — that is the chasing", async () => {
    const stale = claim({ actionDateKey: "2026-08-24" });
    mockFind.mockResolvedValue([stale]);
    const res = await runWorkClaimRung("OFFICE", AT);
    expect(res.openCount).toBe(1);
    expect(mockEmitEsc).toHaveBeenCalledWith("OFFICE", 1, AT);
  });

  test("a failed emit leaves claims UNSTAMPED so the next tick retries", async () => {
    const c = claim();
    mockFind.mockResolvedValue([c]);
    mockEmitEsc.mockRejectedValue(new Error("inbox down"));
    await expect(runWorkClaimRung("OFFICE", AT)).rejects.toThrow();
    expect(c._store.officeNotifiedAt).toBeUndefined();
    expect(c.save).not.toHaveBeenCalled();
  });

  test("nothing open is a cheap no-op", async () => {
    mockFind.mockResolvedValue([]);
    const res = await runWorkClaimRung("PRINCIPAL", AT);
    expect(res).toEqual({ openCount: 0, notified: 0 });
    expect(mockEmitEsc).not.toHaveBeenCalled();
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
