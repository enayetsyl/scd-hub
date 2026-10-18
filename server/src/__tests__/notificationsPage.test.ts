/**
 * D-#761 — the inbox, PAGED and UNREAD FIRST, and the detail screen's by-id read.
 *
 *   1. every unread row comes before every read row, newest first inside each run; the
 *      page seam between the two runs neither repeats nor drops a row
 *   2. an OLD unread row is reachable (it used to hide past the newest 100 while the
 *      bell badge counted it)
 *   3. own-row only: another recipient's rows never appear, by page or by id
 *
 * DB-free: the Notification model is an in-memory store behind the mock.
 */
import mongoose from "mongoose";

interface Row {
  _id: mongoose.Types.ObjectId;
  recipientUserId?: string | null;
  recipientGuardianId?: string | null;
  readAt: Date | null;
  createdAt: Date;
}
const mockRows: Row[] = [];

/** The subset of a Mongo filter the service sends: equality, `readAt: null`, `$ne: null`. */
function mockMatches(row: Record<string, unknown>, q: Record<string, unknown>): boolean {
  return Object.entries(q).every(([k, v]) => {
    const have = row[k] ?? null;
    if (v && typeof v === "object" && "$ne" in (v as object)) return have !== (v as { $ne: unknown }).$ne;
    if (v === null) return have === null;
    return String(have) === String(v);
  });
}

jest.mock("../modules/notifications/models/Notification", () => {
  const actual = jest.requireActual("../modules/notifications/models/Notification");
  return {
    ...actual,
    Notification: {
      countDocuments: async (q: Record<string, unknown>) => mockRows.filter((r) => mockMatches(r as never, q)).length,
      findOne: (q: Record<string, unknown>) => ({
        lean: async () => mockRows.find((r) => mockMatches(r as never, q)) ?? null,
      }),
      find: (q: Record<string, unknown>) => {
        let sort: Record<string, number> = {};
        let skip = 0;
        let limit = Infinity;
        const chain = {
          sort: (s: Record<string, number>) => { sort = s; return chain; },
          skip: (n: number) => { skip = n; return chain; },
          limit: (n: number) => { limit = n; return chain; },
          lean: async () => {
            const hit = mockRows.filter((r) => mockMatches(r as never, q));
            // createdAt as an ISO string, _id as its hex: both order lexically.
            const keyOf = (r: Row, k: string): string => {
              const v = (r as unknown as Record<string, unknown>)[k];
              return v instanceof Date ? v.toISOString() : String(v);
            };
            hit.sort((a, b) => {
              for (const [k, dir] of Object.entries(sort)) {
                const x = keyOf(a, k);
                const y = keyOf(b, k);
                if (x !== y) return (x < y ? -1 : 1) * dir;
              }
              return 0;
            });
            return hit.slice(skip, skip + limit);
          },
        };
        return chain;
      },
    },
  };
});

import { myNotificationsPage, myNotificationById } from "../modules/notifications/services/NotificationService";

const oid = () => new mongoose.Types.ObjectId();
const ME = oid().toString();
const SOMEONE_ELSE = oid().toString();

/** Day `d` of July; `read` = read on that day. */
function add(d: number, read: boolean, recipient = ME): Row {
  const row: Row = {
    _id: oid(),
    recipientUserId: recipient,
    recipientGuardianId: null,
    createdAt: new Date(Date.UTC(2026, 6, d)),
    readAt: read ? new Date(Date.UTC(2026, 6, d, 12)) : null,
  };
  mockRows.push(row);
  return row;
}

beforeEach(() => {
  mockRows.length = 0;
});

describe("myNotificationsPage — unread first, then read, newest first in each", () => {
  test("orders unread before read across pages, with a clean seam", async () => {
    // 3 unread (an OLD one among them) and 4 read, interleaved in time.
    const oldUnread = add(1, false);
    add(2, true);
    const u5 = add(5, false);
    add(6, true);
    add(7, true);
    const u9 = add(9, false);
    add(10, true);
    add(3, false, SOMEONE_ELSE); // never mine

    const p1 = await myNotificationsPage({ userId: ME }, { page: 1, pageSize: 2 });
    const p2 = await myNotificationsPage({ userId: ME }, { page: 2, pageSize: 2 });
    const p3 = await myNotificationsPage({ userId: ME }, { page: 3, pageSize: 2 });
    const p4 = await myNotificationsPage({ userId: ME }, { page: 4, pageSize: 2 });

    expect([p1.total, p2.total, p3.total, p4.total]).toEqual([7, 7, 7, 7]);
    // Page 1: the two newest unread. Page 2 straddles the seam: the OLD unread, then the
    // newest read row.
    expect(p1.rows.map((r) => r._id)).toEqual([u9._id, u5._id]);
    expect(p2.rows[0]._id).toEqual(oldUnread._id);
    expect(p2.rows[1].readAt).not.toBeNull();
    const all = [...p1.rows, ...p2.rows, ...p3.rows, ...p4.rows];
    expect(all).toHaveLength(7);
    expect(new Set(all.map((r) => r._id.toString())).size).toBe(7);
    // Read rows newest first.
    const readDays = all.filter((r) => r.readAt).map((r) => new Date(r.createdAt).getUTCDate());
    expect(readDays).toEqual([10, 7, 6, 2]);
  });

  test("a page wholly inside the read run skips the unread query", async () => {
    add(1, false);
    for (let d = 2; d <= 6; d++) add(d, true);
    const p = await myNotificationsPage({ userId: ME }, { page: 2, pageSize: 3 });
    expect(p.rows.map((r) => new Date(r.createdAt).getUTCDate())).toEqual([4, 3, 2]);
  });

  test("an empty inbox is an empty first page", async () => {
    expect(await myNotificationsPage({ userId: ME }, {})).toEqual({ rows: [], total: 0, page: 1, pageSize: 50 });
  });

  test("a guardian reads guardian rows", async () => {
    mockRows.push({ _id: oid(), recipientUserId: null, recipientGuardianId: ME, createdAt: new Date(), readAt: null });
    add(1, false); // a USER row with the same id string is not the guardian's
    const p = await myNotificationsPage({ guardianId: ME }, {});
    expect(p.total).toBe(1);
  });
});

describe("myNotificationById — the detail screen", () => {
  test("finds an own row however old", async () => {
    const old = add(1, true);
    for (let d = 2; d <= 28; d++) add(d, false);
    expect((await myNotificationById(old._id.toString(), { userId: ME }))?._id).toEqual(old._id);
  });

  test("another recipient's row, an unknown id and a malformed id are all null", async () => {
    const theirs = add(1, false, SOMEONE_ELSE);
    expect(await myNotificationById(theirs._id.toString(), { userId: ME })).toBeNull();
    expect(await myNotificationById(oid().toString(), { userId: ME })).toBeNull();
    expect(await myNotificationById("not-an-id", { userId: ME })).toBeNull();
  });
});
