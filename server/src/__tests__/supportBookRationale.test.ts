/**
 * Rationale reads (SB-5, D-#403/#404/#411).
 *
 * The three things that were missing: resolving a policy hash back to TEXT, resolving
 * actor ids to names across the plane boundary, and the memo that makes the first one
 * possible at all.
 */
import { Types } from "mongoose";

interface Row { [k: string]: unknown }
const mockPolicyDocs: Row[] = [];
const mockSnapshots: Row[] = [];
const mockUsers: Row[] = [];
let mockUserThrows = false;

const oid = (): Types.ObjectId => new Types.ObjectId();

function matches(row: Row, q: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(q)) {
    if (k === "$or") continue;
    if (v && typeof v === "object" && "$in" in (v as Record<string, unknown>)) {
      const list = (v as { $in: unknown[] }).$in.map(String);
      if (!list.includes(String(row[k]))) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

jest.mock("../modules/support-book/models/PolicyDoc", () => ({
  PolicyDoc: {
    find: (q: Record<string, unknown>) => ({
      lean: () => Promise.resolve(mockPolicyDocs.filter((d) => d.active === q.active)),
    }),
    findOne: (q: Record<string, unknown>) => {
      const hit = mockPolicyDocs.find((d) => matches(d, q)) ?? null;
      const p = Promise.resolve(hit) as Promise<Row | null> & {
        sort?: () => { lean: () => Promise<Row | null> };
        lean?: () => Promise<Row | null>;
      };
      p.sort = () => ({ lean: () => Promise.resolve(hit) });
      p.lean = () => Promise.resolve(hit);
      return p;
    },
    updateMany: () => Promise.resolve({ acknowledged: true }),
    create: (d: Row) => { const r = { _id: oid(), ...d }; mockPolicyDocs.push(r); return Promise.resolve(r); },
  },
}));

jest.mock("../modules/support-book/models/PolicySetSnapshot", () => ({
  PolicySetSnapshot: {
    updateOne: (q: Record<string, unknown>, u: Record<string, unknown>) => {
      if (!mockSnapshots.find((s) => matches(s, q))) {
        mockSnapshots.push({ ...(u.$setOnInsert as Row) });
      }
      return Promise.resolve({ acknowledged: true });
    },
    findOne: (q: Record<string, unknown>) => ({
      lean: () => Promise.resolve(mockSnapshots.find((s) => matches(s, q)) ?? null),
    }),
  },
}));

jest.mock("../modules/foundation/models/User", () => ({
  User: {
    find: (q: Record<string, unknown>) => ({
      select: () => ({
        lean: () => {
          if (mockUserThrows) return Promise.reject(new Error("identity plane unreachable"));
          return Promise.resolve(mockUsers.filter((u) => matches(u, q)));
        },
      }),
    }),
  },
}));

import { activePolicySet, resolvePolicySet, bodyHash } from "../modules/support-book/services/PolicySetService";
import { resolveActors, resolveActor } from "../modules/support-book/services/BookActorService";

const BOOK = "C1-BAN";

function seedDoc(docKey: string, version: number, body: string, active = true, bookId: string | null = null): Row {
  const d: Row = { _id: oid(), docKey, bookId, version, body, sha256: bodyHash(body), active, updatedAt: new Date("2026-07-01") };
  mockPolicyDocs.push(d);
  return d;
}

beforeEach(() => {
  mockPolicyDocs.length = 0; mockSnapshots.length = 0; mockUsers.length = 0;
  mockUserThrows = false;
});

describe("the policy-set memo (SB-5)", () => {
  it("records what a hash MEANS the first time it is seen", async () => {
    seedDoc("README", 2, "readme v2");
    seedDoc("REF2_REGISTER", 1, "names");
    const set = await activePolicySet(BOOK);
    expect(mockSnapshots).toHaveLength(1);
    expect(mockSnapshots[0].hash).toBe(set.hash);
    expect((mockSnapshots[0].members as Row[]).map((m) => m.docKey)).toEqual(["README", "REF2_REGISTER"]);
  });

  it("records WHICH documents were absent, so a thin set is visible later", async () => {
    seedDoc("README", 1, "only this");
    await activePolicySet(BOOK);
    expect(mockSnapshots[0].missing).toContain("REF2_REGISTER");
  });

  it("does not duplicate a hash it has already recorded", async () => {
    seedDoc("README", 1, "a");
    await activePolicySet(BOOK);
    await activePolicySet(BOOK);
    expect(mockSnapshots).toHaveLength(1);
  });

  it("a NEW policy version produces a NEW hash and a second memo", async () => {
    seedDoc("README", 1, "a");
    const first = await activePolicySet(BOOK);
    mockPolicyDocs.length = 0;
    seedDoc("README", 2, "a revised");
    const second = await activePolicySet(BOOK);
    expect(second.hash).not.toBe(first.hash);
    expect(mockSnapshots).toHaveLength(2);
  });
});

describe("resolving a hash back to TEXT — the point of D-#403", () => {
  it("returns the document versions AND their bodies", async () => {
    seedDoc("README", 3, "the rules as they stood");
    const set = await activePolicySet(BOOK);
    const resolved = await resolvePolicySet(set.hash, BOOK);
    expect(resolved).not.toBeNull();
    expect(resolved!.members[0].docKey).toBe("README");
    expect(resolved!.members[0].version).toBe(3);
    expect(resolved!.members[0].body).toBe("the rules as they stood");
  });

  it("flags a member that has since been SUPERSEDED", async () => {
    // The case where quoting today's text would mislead: the reader must be able to
    // see at a glance that policy has moved on since this decision was made.
    const doc = seedDoc("README", 1, "old rules");
    const set = await activePolicySet(BOOK);
    doc.active = false;
    const resolved = await resolvePolicySet(set.hash, BOOK);
    expect(resolved!.members[0].supersededSince).not.toBeNull();
    expect(resolved!.members[0].body).toBe("old rules"); // still the text that applied
  });

  it("says so plainly when a version is no longer in the store", async () => {
    seedDoc("README", 1, "gone soon");
    const set = await activePolicySet(BOOK);
    mockPolicyDocs.length = 0; // the version disappeared
    const resolved = await resolvePolicySet(set.hash, BOOK);
    expect(resolved!.members[0].body).toContain("no longer in the policy store");
  });

  it("returns null for a hash that predates the memo, rather than inventing one", async () => {
    expect(await resolvePolicySet("deadbeef", BOOK)).toBeNull();
  });
});

describe("actor resolution — the one cross-plane read (D-#404)", () => {
  it("resolves ids to names in ONE batched lookup", async () => {
    const a = oid(); const b = oid();
    mockUsers.push({ _id: a, name: "Fatima" }, { _id: b, name: "Umar" });
    const names = await resolveActors([a, b, a]); // duplicate id, deliberately
    expect(names.get(String(a))!.name).toBe("Fatima");
    expect(names.get(String(b))!.name).toBe("Umar");
    expect(names.size).toBe(2);
  });

  it("falls back to the email when an account has no name", async () => {
    const a = oid();
    mockUsers.push({ _id: a, email: "office@school" });
    expect((await resolveActor(a)).name).toBe("office@school");
  });

  it("marks an id that resolves to nothing as UNKNOWN rather than blank", async () => {
    // A deleted staff account is a real answer; an empty string renders as a gap that
    // looks like a bug.
    const gone = oid();
    const r = await resolveActor(gone);
    expect(r.known).toBe(false);
    expect(r.name).toBe("(unknown account)");
  });

  it("NEVER throws when the identity plane is unreachable", async () => {
    // A name lookup failing must not take down the timeline it decorates — which is
    // the only reason anyone opened the page.
    mockUserThrows = true;
    const a = oid();
    const r = await resolveActor(a);
    expect(r.known).toBe(false);
    expect(r.name).toBe("(unknown account)");
  });

  it("ignores a malformed id instead of throwing on the cast", async () => {
    const names = await resolveActors(["not-an-objectid"]);
    expect(names.size).toBe(0);
  });

  it("returns an empty map for no input, without querying", async () => {
    expect((await resolveActors([])).size).toBe(0);
  });
});
