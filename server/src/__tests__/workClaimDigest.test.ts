/**
 * D-#710 — the 10:30 guardian-claim digest (owner ruling 2026-10-04).
 *
 *   - "days pending" counts SCHOOL days from the claim's action day through today,
 *     inclusive; OFF / HOLIDAY / QURAN_ONLY days do not count; a future action day is 0
 *   - recipients = every Principal + Office user ∪ the Principal-named extras, deduped,
 *     inactive extras dropped
 *   - the per-teacher breakdown is oldest-first, then by count
 *   - the inbox row names the teachers with their counts and days, in Bangla digits
 *
 * DB-free: User, the config row, the calendar and the notification sink are mocked.
 */
import mongoose from "mongoose";

const mockDayType = jest.fn();
const mockUserFind = jest.fn();
const mockCfgFindOne = jest.fn();
const mockEmit = jest.fn();

const chain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: (d: Date) => mockDayType(d),
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => chain(mockUserFind(q)) },
}));
jest.mock("../modules/trackers/models/WorkClaimDigestConfig", () => ({
  WorkClaimDigestConfig: { findOne: (q: unknown) => chain(mockCfgFindOne(q)) },
}));
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (...a: unknown[]) => mockEmit(...a),
}));

import {
  makePendingDayCounter,
  digestRecipientIds,
  pendingByTeacher,
  isDigestRecipient,
  canWatchClaims,
} from "../modules/trackers/services/WorkClaimDigestService";
import { emitWorkClaimEscalation } from "../modules/notifications/services/emitters";
import { dateKeyOf } from "../modules/attendance/dates";

const oid = () => new mongoose.Types.ObjectId();

/** 2026-10-01 Thu … the school week: Fri OFF, Sat QURAN_ONLY, Sun–Thu FULL. */
function weekCalendar(d: Date): string {
  const day = d.getDay(); // 0 Sun … 5 Fri, 6 Sat
  if (day === 5) return "OFF";
  if (day === 6) return "QURAN_ONLY";
  if (dateKeyOf(d) === "2026-10-06") return "HOLIDAY";
  return "FULL";
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDayType.mockImplementation(async (d: Date) => weekCalendar(d));
  mockEmit.mockResolvedValue(undefined);
});

describe("makePendingDayCounter — school days at the teacher's hand", () => {
  const NOW = new Date(2026, 9, 5, 10, 30); // Mon 2026-10-05, 10:30

  test("an action day of TODAY is day 1", async () => {
    expect(await makePendingDayCounter(NOW)("2026-10-05")).toBe(1);
  });

  test("Friday and the Quran-only Saturday do not count", async () => {
    // Thu 10-01, [Fri OFF], [Sat QURAN_ONLY], Sun 10-04, Mon 10-05 → 3 school days
    expect(await makePendingDayCounter(NOW)("2026-10-01")).toBe(3);
  });

  test("a holiday does not count", async () => {
    const tue = new Date(2026, 9, 7, 10, 30); // Wed 10-07; Tue 10-06 is a holiday
    // Mon 10-05, [Tue HOLIDAY], Wed 10-07 → 2
    expect(await makePendingDayCounter(tue)("2026-10-05")).toBe(2);
  });

  test("an action day still in the future is 0", async () => {
    expect(await makePendingDayCounter(NOW)("2026-10-07")).toBe(0);
  });

  test("each calendar day is resolved once per counter, however many claims share it", async () => {
    const count = makePendingDayCounter(NOW);
    await count("2026-10-01");
    await count("2026-10-01");
    await count("2026-10-04");
    // 10-01..10-05 = 5 distinct days, each looked up exactly once
    expect(mockDayType).toHaveBeenCalledTimes(5);
  });
});

describe("digestRecipientIds — Principal + Office + the Principal's extras", () => {
  test("unions staff with ACTIVE extras and dedupes", async () => {
    const principal = oid(), akmol = oid(), akter = oid(), tazkir = oid(), gone = oid();
    mockCfgFindOne.mockReturnValue({ extraRecipientIds: [akter, tazkir, gone, akmol] });
    mockUserFind.mockImplementation((q: Record<string, unknown>) =>
      "$or" in q
        ? [{ _id: principal }, { _id: akmol }] // actingAsFilter(PRINCIPAL, OFFICE)
        : [{ _id: akter }, { _id: tazkir }, { _id: akmol }], // active extras — `gone` dropped
    );
    const ids = await digestRecipientIds();
    expect(ids.sort()).toEqual([principal, akmol, akter, tazkir].map(String).sort());
  });

  test("no config row → just Principal + Office (read-time default, never seeded)", async () => {
    const principal = oid();
    mockCfgFindOne.mockReturnValue(null);
    mockUserFind.mockReturnValue([{ _id: principal }]);
    expect(await digestRecipientIds()).toEqual([principal.toString()]);
  });

  test("canWatchClaims: Principal/Office always; a teacher only while on the digest", async () => {
    const akter = oid(), other = oid();
    mockCfgFindOne.mockReturnValue({ extraRecipientIds: [akter] });
    mockUserFind.mockReturnValue([{ _id: akter }]);
    const ctx = (userId: string, role: string) => ({ auth: { userId, role } as never });
    expect(await canWatchClaims(ctx(oid().toString(), "PRINCIPAL"))).toBe(true);
    expect(await canWatchClaims(ctx(oid().toString(), "OFFICE"))).toBe(true);
    expect(await canWatchClaims(ctx(akter.toString(), "TEACHER"))).toBe(true);
    expect(await canWatchClaims(ctx(other.toString(), "TEACHER"))).toBe(false);
    expect(await canWatchClaims({ auth: null })).toBe(false);
  });

  test("isDigestRecipient is true only for a listed, active user", async () => {
    const akter = oid();
    mockCfgFindOne.mockReturnValue({ extraRecipientIds: [akter] });
    mockUserFind.mockReturnValue([{ _id: akter }]);
    expect(await isDigestRecipient(akter.toString())).toBe(true);
    expect(await isDigestRecipient(oid().toString())).toBe(false);
  });
});

describe("pendingByTeacher — who holds how many, and the oldest wait", () => {
  test("groups per teacher, oldest-first then by count", async () => {
    const tamany = oid(), maruf = oid();
    mockUserFind.mockReturnValue([
      { _id: tamany, name: "Tamany" },
      { _id: maruf, name: "Maruf" },
    ]);
    const days: Record<string, number> = { a: 1, b: 4, c: 2 };
    const res = await pendingByTeacher(
      [
        { teacherId: maruf, actionDateKey: "a" },
        { teacherId: tamany, actionDateKey: "b" },
        { teacherId: tamany, actionDateKey: "c" },
      ],
      new Date(),
      async (k) => days[k],
    );
    expect(res).toEqual([
      { teacherId: tamany.toString(), teacherName: "Tamany", count: 2, oldestDays: 4 },
      { teacherId: maruf.toString(), teacherName: "Maruf", count: 1, oldestDays: 1 },
    ]);
  });
});

describe("emitWorkClaimEscalation — the 10:30 inbox row", () => {
  test("one row per recipient, naming teachers with count + days in Bangla digits", async () => {
    const at = new Date(2026, 9, 5, 10, 30);
    const sent = await emitWorkClaimEscalation(
      ["p", "a"],
      5,
      [
        { teacherName: "Tamany", count: 3, oldestDays: 4 },
        { teacherName: "Maruf", count: 2, oldestDays: 1 },
      ],
      at,
    );
    expect(sent).toBe(2);
    expect(mockEmit).toHaveBeenCalledTimes(2);
    const row = mockEmit.mock.calls[0][0] as { bodyBn: string; refs: { stage: string }; dedupeKey: string };
    expect(row.bodyBn).toBe(
      "৫টি জানানো সকাল ১০:৩০ পর্যন্ত নিষ্পন্ন হয়নি। শিক্ষকভিত্তিক: Tamany ৩টি (৪ দিন), Maruf ২টি (১ দিন)।",
    );
    expect(row.refs.stage).toBe("1030");
  });

  test("more than six teachers fold into 'আরও N জন'", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ teacherName: `T${i}`, count: 1, oldestDays: 1 }));
    await emitWorkClaimEscalation(["p"], 8, many, new Date(2026, 9, 5, 10, 30));
    const row = mockEmit.mock.calls[0][0] as { bodyBn: string };
    expect(row.bodyBn).toContain("T5 ১টি (১ দিন), আরও ২ জন।");
    expect(row.bodyBn).not.toContain("T6");
  });
});
