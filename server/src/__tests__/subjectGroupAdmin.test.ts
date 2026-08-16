/**
 * SubjectGroup admin (D-#500) — creating and retiring a Quran/Arabic group.
 *
 * `createSubjectGroup` existed on the server but was wired to no screen, and
 * there was no way to retire a group at all, so splitting a level (one combined
 * "Hifz 1" → boys + girls) could not be completed in the app. This covers the two
 * server-side rules that make the split safe:
 *
 *   1. `code` is normalised + uniqueness-checked, so QURAN_HIFZ_1_BOYS cannot be
 *      created twice under different casing.
 *   2. Retiring is REFUSED while members remain. `addGroupMember` enforces one
 *      group per TRACK by scanning every group of that track REGARDLESS of
 *      `active`, so a retired-but-populated group would silently block each of
 *      its own students from joining the group replacing it. Emptying first is
 *      the only order that works.
 *
 * Plus the read filter: `subjectGroups` hides retired groups unless asked, and
 * treats a MISSING `active` field as live (rows predate the field).
 *
 * Executes real GraphQL against the built schema so the scope-auth layer runs.
 * DB-free: the models are mocked.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();

const mockGroupFind = jest.fn();
const mockGroupFindOne = jest.fn();
const mockGroupFindById = jest.fn();
const mockGroupCreate = jest.fn();
const mockMembershipCount = jest.fn();

jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: {
    find: (q: unknown) => ({ sort: () => ({ lean: async () => mockGroupFind(q) }) }),
    findOne: (q: unknown) => ({ select: () => ({ lean: async () => mockGroupFindOne(q) }) }),
    findById: (id: unknown) => Promise.resolve(mockGroupFindById(id)),
    create: (doc: unknown) => Promise.resolve(mockGroupCreate(doc)),
  },
}));
jest.mock("../modules/routine/models/SubjectGroupMembership", () => ({
  SubjectGroupMembership: {
    countDocuments: (q: unknown) => Promise.resolve(mockMembershipCount(q)),
    find: () => ({ lean: async () => [] }),
    findOne: () => ({ lean: async () => null }),
  },
}));

import { builder } from "../schema";
import "../modules/routine/resolvers/routine";

const schema = builder.toSchema();

type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string | null): Ctx => ({
  auth: role ? { role, userId: oid().toString() } : null,
});
const run = (source: string, role: string | null = "PRINCIPAL"): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: ctxOf(role) }) as Promise<ExecutionResult>;

const errText = (r: ExecutionResult): string => (r.errors ?? []).map((e) => e.message).join(" | ");

const GROUP = oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  mockGroupFind.mockReturnValue([]);
  mockGroupFindOne.mockReturnValue(null);
  mockMembershipCount.mockReturnValue(0);
});

// ---------------------------------------------------------------------------
// createSubjectGroup
// ---------------------------------------------------------------------------

describe("createSubjectGroup", () => {
  const CREATE = (code: string, level = "Hifz 1", gender = "boys") => `
    mutation { createSubjectGroup(
      track: "quran", level: "${level}", gender: "${gender}",
      code: "${code}", nameBn: "হিফজ ১ ছেলে"
    ) { code level gender } }`;

  it("normalises the code — trims, uppercases, and collapses spaces", async () => {
    mockGroupCreate.mockImplementation((d: { code: string }) => ({ ...d, active: true }));
    const r = await run(CREATE("  quran hifz 1 boys  "));
    expect(errText(r)).toBe("");
    expect(mockGroupCreate).toHaveBeenCalledWith(
      expect.objectContaining({ code: "QURAN_HIFZ_1_BOYS" }),
    );
  });

  it("refuses a duplicate code rather than surfacing a raw Mongo key error", async () => {
    mockGroupFindOne.mockReturnValue({ _id: oid() });
    const r = await run(CREATE("QURAN_HIFZ_1_BOYS"));
    expect(errText(r)).toMatch(/আগে থেকেই আছে/);
    expect(mockGroupCreate).not.toHaveBeenCalled();
  });

  it("refuses a blank level", async () => {
    const r = await run(CREATE("QURAN_X_BOYS", "   "));
    expect(errText(r)).toMatch(/স্তর, কোড ও বাংলা নাম/);
    expect(mockGroupCreate).not.toHaveBeenCalled();
  });

  it("refuses an invalid gender", async () => {
    const r = await run(CREATE("QURAN_HIFZ_1_X", "Hifz 1", "other"));
    expect(errText(r)).toMatch(/Invalid gender/);
    expect(mockGroupCreate).not.toHaveBeenCalled();
  });

  it("is refused for a caller without routine:manage", async () => {
    const r = await run(CREATE("QURAN_HIFZ_1_BOYS"), "TEACHER");
    expect(errText(r)).not.toBe("");
    expect(mockGroupCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setSubjectGroupActive
// ---------------------------------------------------------------------------

describe("setSubjectGroupActive", () => {
  const RETIRE = `mutation { setSubjectGroupActive(groupId: "${GROUP}", active: false) { active } }`;
  const RESTORE = `mutation { setSubjectGroupActive(groupId: "${GROUP}", active: true) { active } }`;

  const savableGroup = () => {
    const doc = { _id: GROUP, active: true, save: jest.fn(async () => undefined) };
    mockGroupFindById.mockReturnValue(doc);
    return doc;
  };

  it("retires an EMPTY group", async () => {
    const doc = savableGroup();
    mockMembershipCount.mockReturnValue(0);
    const r = await run(RETIRE);
    expect(errText(r)).toBe("");
    expect(doc.active).toBe(false);
    expect(doc.save).toHaveBeenCalled();
  });

  it("REFUSES to retire a group that still has members, and names the count", async () => {
    const doc = savableGroup();
    mockMembershipCount.mockReturnValue(7);
    const r = await run(RETIRE);
    // The count matters: it tells the admin how much moving is left to do.
    expect(errText(r)).toMatch(/৭|7/);
    expect(errText(r)).toMatch(/নতুন গ্রুপে সরান/);
    expect(doc.save).not.toHaveBeenCalled();
    expect(doc.active).toBe(true);
  });

  it("restores a retired group WITHOUT the member check (only retiring is guarded)", async () => {
    const doc = { _id: GROUP, active: false, save: jest.fn(async () => undefined) };
    mockGroupFindById.mockReturnValue(doc);
    mockMembershipCount.mockReturnValue(7);
    const r = await run(RESTORE);
    expect(errText(r)).toBe("");
    expect(doc.active).toBe(true);
    expect(mockMembershipCount).not.toHaveBeenCalled();
  });

  it("errors on an unknown group", async () => {
    mockGroupFindById.mockReturnValue(null);
    const r = await run(RETIRE);
    expect(errText(r)).toMatch(/গ্রুপ পাওয়া যায়নি/);
  });

  it("is refused for a caller without routine:manage", async () => {
    savableGroup();
    const r = await run(RETIRE, "TEACHER");
    expect(errText(r)).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// subjectGroups read filter
// ---------------------------------------------------------------------------

describe("subjectGroups filter", () => {
  it("hides retired groups by default — matching 'not explicitly false' so pre-existing rows (no `active` field) stay visible", async () => {
    await run(`query { subjectGroups { id } }`);
    expect(mockGroupFind).toHaveBeenCalledWith({ active: { $ne: false } });
  });

  it("includes retired groups when the admin screen asks", async () => {
    await run(`query { subjectGroups(includeInactive: true) { id } }`);
    expect(mockGroupFind).toHaveBeenCalledWith({});
  });

  it("combines the track filter with the active filter", async () => {
    await run(`query { subjectGroups(track: "quran") { id } }`);
    expect(mockGroupFind).toHaveBeenCalledWith({ track: "quran", active: { $ne: false } });
  });
});
