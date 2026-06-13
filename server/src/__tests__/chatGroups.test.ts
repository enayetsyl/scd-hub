/**
 * Messaging M-2 tests (prd-messaging §5 M-2, D-#78) — auto-provisioned groups +
 * manual groups + posting policy.
 *
 *   M2.auto    — syncSectionGroup/syncSubjectGroup/syncSchoolGroup upsert THE
 *                group and reconcile its AUTO membership from roster+routine
 *   J-M3       — the reconcile adds/removes only source:"auto" rows; a manual
 *                (Office-added) row is NEVER touched; an unchanged sync is a no-op
 *   M2.manual  — createGroupConversation (CHAT_GROUP_CREATED audit) + add/remove
 *                manual members + archive (CUSTOM only) + setPostingPolicy
 *   J-M7       — ANNOUNCEMENT blocks a non-manager's post (reactions are M-3);
 *                a manager posts; OPEN/DIRECT are unrestricted
 *   J-M2       — group-create authority is chat:manage (Principal/Office) only
 *
 * DB-free: Mongoose models mocked, the services real.
 */
import mongoose from "mongoose";
import { roleHasPermission, ROUTINE_SUBJECTS } from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mock models BEFORE importing the services under test
// ---------------------------------------------------------------------------

const mockConvUpsert = jest.fn();
const mockConvCreate = jest.fn();
const mockConvFindById = jest.fn();
const mockConvUpdateOne = jest.fn();
jest.mock("../modules/chat/models/Conversation", () => ({
  ...jest.requireActual("../modules/chat/models/Conversation"),
  Conversation: {
    findOneAndUpdate: (f: unknown, u: unknown, o: unknown) => ({ lean: () => mockConvUpsert(f, u, o) }),
    create: (d: unknown) => mockConvCreate(d),
    findById: (id: unknown) => ({ lean: () => mockConvFindById(id) }),
    updateOne: (f: unknown, u: unknown) => mockConvUpdateOne(f, u),
  },
}));

const mockMemberFind = jest.fn();
const mockMemberFindOne = jest.fn();
const mockMemberBulk = jest.fn();
const mockMemberDeleteMany = jest.fn();
const mockMemberDeleteOne = jest.fn();
const mockMemberUpdateOne = jest.fn();
jest.mock("../modules/chat/models/ConversationMember", () => ({
  ConversationMember: {
    find: (f: unknown) => ({ lean: () => mockMemberFind(f) }),
    findOne: (f: unknown) => ({ lean: () => mockMemberFindOne(f) }),
    bulkWrite: (ops: unknown, o: unknown) => mockMemberBulk(ops, o),
    deleteMany: (f: unknown) => mockMemberDeleteMany(f),
    deleteOne: (f: unknown) => mockMemberDeleteOne(f),
    updateOne: (f: unknown, u: unknown, o: unknown) => mockMemberUpdateOne(f, u, o),
  },
}));

const mockMsgCreate = jest.fn();
const mockMsgFindById = jest.fn();
jest.mock("../modules/chat/models/ChatMessage", () => ({
  ChatMessage: {
    create: (d: unknown) => mockMsgCreate(d),
    findById: (id: unknown) => ({ lean: () => mockMsgFindById(id) }),
  },
}));

const mockUserFind = jest.fn();
const mockUserFindById = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    find: (q: unknown) => ({ select: () => ({ lean: () => mockUserFind(q) }), lean: () => mockUserFind(q) }),
    findById: (id: unknown) => ({ lean: () => mockUserFindById(id) }),
  },
}));

const mockSectionFindById = jest.fn();
const mockSectionFind = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: {
    findById: (id: unknown) => ({ lean: () => mockSectionFindById(id) }),
    find: (q: unknown) => ({ select: () => ({ lean: () => mockSectionFind(q) }), lean: () => mockSectionFind(q) }),
  },
}));

const mockGrantFind = jest.fn();
jest.mock("../modules/foundation/models/ScopeGrant", () => ({
  ScopeGrant: {
    find: (q: unknown) => ({ select: () => ({ lean: () => mockGrantFind(q) }), lean: () => mockGrantFind(q) }),
  },
}));

const mockSlotFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: {
    find: (q: unknown) => ({ select: () => ({ lean: () => mockSlotFind(q) }), lean: () => mockSlotFind(q) }),
  },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

// Import AFTER mocks
import {
  syncSectionGroup,
  syncSubjectGroup,
  syncSchoolGroup,
  resyncAllChatGroups,
  createGroupConversation,
  addMember,
  removeMember,
  archiveConversation,
  setPostingPolicy,
} from "../modules/chat/services/ChatGroupService";
import { sendMessage, ChatError } from "../modules/chat/services/ChatService";

const CONV = oid();
const CT = oid();
const Z = oid();
const X = oid();
const Y = oid();
const ACTOR = oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  mockConvUpsert.mockResolvedValue({ _id: CONV, kind: "SECTION" });
  mockConvCreate.mockImplementation((d: Record<string, unknown>) =>
    Promise.resolve({ _id: CONV, ...d }),
  );
  mockMemberFind.mockResolvedValue([]);
  mockMemberBulk.mockResolvedValue({ upsertedCount: 0 });
  mockMemberDeleteMany.mockResolvedValue({ deletedCount: 0 });
  mockMemberDeleteOne.mockResolvedValue({ deletedCount: 0 });
  mockMemberUpdateOne.mockResolvedValue({ upsertedCount: 1 });
  mockUserFind.mockResolvedValue([]);
  mockSlotFind.mockResolvedValue([]);
  mockGrantFind.mockResolvedValue([]);
  mockWriteAudit.mockResolvedValue(undefined);
});

// ===========================================================================
// M2 auto-provision — desired membership from roster + routine
// ===========================================================================

describe("M2 syncSectionGroup", () => {
  test("upserts THE section group and reconciles auto membership (J-M3)", async () => {
    // Section: class teacher CT, no support; one routine-slot teacher Z.
    mockSectionFindById.mockResolvedValue({
      _id: oid(),
      active: true,
      nameBn: "তৃতীয় (ছেলে)",
      classTeacherId: CT,
      supportTeacherIds: [],
    });
    mockSlotFind.mockResolvedValue([{ teacherId: Z }]);
    mockGrantFind.mockResolvedValue([]);
    // Both CT and Z are active staff.
    mockUserFind.mockResolvedValue([{ _id: CT }, { _id: Z }]);
    // Existing members: a stale auto (X), an Office-added manual (Y), and Z (auto).
    mockMemberFind.mockResolvedValue([
      { userId: X, source: "auto" },
      { userId: Y, source: "manual" },
      { userId: Z, source: "auto" },
    ]);

    const res = await syncSectionGroup(oid().toString());

    // The auto conversation was upserted as a SECTION by refId.
    const [filter, update, opts] = mockConvUpsert.mock.calls[0];
    expect(filter).toMatchObject({ kind: "SECTION" });
    expect(update.$setOnInsert).toMatchObject({ kind: "SECTION", postingPolicy: "OPEN", active: true });
    expect(opts).toMatchObject({ upsert: true, new: true });

    // CT is ADDED as an auto row; Z already present (auto) so not re-added.
    const [ops] = mockMemberBulk.mock.calls[0];
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter.userId.toString()).toBe(CT.toString());
    expect(ops[0].updateOne.update.$setOnInsert.source).toBe("auto");

    // Stale auto X is removed; the MANUAL row Y is never touched (D-#49).
    const [delFilter] = mockMemberDeleteMany.mock.calls[0];
    expect(delFilter.source).toBe("auto");
    const removedIds = delFilter.userId.$in.map((id: { toString(): string }) => id.toString());
    expect(removedIds).toContain(X.toString());
    expect(removedIds).not.toContain(Y.toString());
    expect(removedIds).not.toContain(Z.toString());

    expect(res).toEqual({ conversationId: CONV.toString(), added: 1, removed: 1 });
  });

  test("an unchanged membership is a no-op (idempotent) — no add, no remove", async () => {
    mockSectionFindById.mockResolvedValue({
      _id: oid(),
      active: true,
      nameBn: "x",
      classTeacherId: CT,
      supportTeacherIds: [],
    });
    mockUserFind.mockResolvedValue([{ _id: CT }]);
    mockMemberFind.mockResolvedValue([{ userId: CT, source: "auto" }]);

    const res = await syncSectionGroup(oid().toString());
    expect(mockMemberBulk).not.toHaveBeenCalled();
    expect(mockMemberDeleteMany).not.toHaveBeenCalled();
    expect(res).toMatchObject({ added: 0, removed: 0 });
  });

  test("an inactive or missing section is skipped (returns null, no upsert)", async () => {
    mockSectionFindById.mockResolvedValue({ _id: oid(), active: false });
    expect(await syncSectionGroup(oid().toString())).toBeNull();
    mockSectionFindById.mockResolvedValue(null);
    expect(await syncSectionGroup(oid().toString())).toBeNull();
    expect(mockConvUpsert).not.toHaveBeenCalled();
  });

  test("guardians/inactive users are filtered out of the desired set (D-#76)", async () => {
    mockSectionFindById.mockResolvedValue({
      _id: oid(),
      active: true,
      nameBn: "x",
      classTeacherId: CT,
      supportTeacherIds: [Z],
    });
    // The staff filter only returns CT (Z was inactive/guardian → dropped).
    mockUserFind.mockResolvedValue([{ _id: CT }]);
    mockMemberFind.mockResolvedValue([]);
    await syncSectionGroup(oid().toString());
    const [ops] = mockMemberBulk.mock.calls[0];
    const addedIds = ops.map((o: { updateOne: { filter: { userId: { toString(): string } } } }) =>
      o.updateOne.filter.userId.toString(),
    );
    expect(addedIds).toEqual([CT.toString()]);
    expect(addedIds).not.toContain(Z.toString());
  });
});

describe("M2 syncSubjectGroup", () => {
  test("upserts THE subject group keyed by the ROUTINE_SUBJECTS value", async () => {
    mockConvUpsert.mockResolvedValue({ _id: CONV, kind: "SUBJECT" });
    mockSlotFind.mockResolvedValue([{ teacherId: CT }]);
    mockUserFind.mockResolvedValue([{ _id: CT }]);
    await syncSubjectGroup("MATH");
    const [filter] = mockConvUpsert.mock.calls[0];
    expect(filter).toEqual({ kind: "SUBJECT", refId: "MATH" });
  });
});

describe("M2 syncSchoolGroup", () => {
  test("upserts the school singleton (all active non-guardian staff)", async () => {
    mockConvUpsert.mockResolvedValue({ _id: CONV, kind: "SCHOOL" });
    mockUserFind.mockResolvedValue([{ _id: CT }, { _id: Z }]);
    await syncSchoolGroup();
    const [filter] = mockConvUpsert.mock.calls[0];
    expect(filter.kind).toBe("SCHOOL");
    // The school-member query excludes guardians.
    const userQueries = mockUserFind.mock.calls.map((c) => c[0]);
    expect(userQueries.some((q) => q.role && q.role.$ne === "GUARDIAN")).toBe(true);
  });
});

describe("M2 resyncAllChatGroups", () => {
  test("iterates every ROUTINE_SUBJECTS value + the school singleton and audits", async () => {
    mockSectionFind.mockResolvedValue([]); // no sections → only subjects + school
    const summary = await resyncAllChatGroups(ACTOR);
    expect(summary).toEqual({ sections: 0, subjects: ROUTINE_SUBJECTS.length, school: 1 });
    // One upsert per subject + one for school.
    expect(mockConvUpsert).toHaveBeenCalledTimes(ROUTINE_SUBJECTS.length + 1);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CHAT_MEMBERSHIP_CHANGED", actorId: ACTOR }),
    );
  });
});

// ===========================================================================
// M2 manual groups (CUSTOM) — chat:manage
// ===========================================================================

describe("M2 createGroupConversation", () => {
  test("creates a CUSTOM group, adds creator+members as MANUAL, audits CHAT_GROUP_CREATED", async () => {
    mockUserFind.mockResolvedValue([{ _id: CT }, { _id: Z }]);
    const conv = await createGroupConversation({
      title: "  Sports Day committee  ",
      memberIds: [CT.toString(), Z.toString()],
      createdBy: ACTOR,
    });
    expect(conv._id).toBe(CONV);
    expect(mockConvCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "CUSTOM", title: "Sports Day committee", postingPolicy: "OPEN" }),
    );
    const [ops] = mockMemberBulk.mock.calls[0];
    for (const o of ops) expect(o.updateOne.update.$setOnInsert.source).toBe("manual");
    // creator is always a member
    const memberIds = ops.map((o: { updateOne: { filter: { userId: { toString(): string } } } }) =>
      o.updateOne.filter.userId.toString(),
    );
    expect(memberIds).toContain(ACTOR);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CHAT_GROUP_CREATED", actorId: ACTOR }),
    );
  });

  test("an empty title is rejected (Bangla)", async () => {
    await expect(
      createGroupConversation({ title: "   ", memberIds: [], createdBy: ACTOR }),
    ).rejects.toThrow(ChatError);
    expect(mockConvCreate).not.toHaveBeenCalled();
  });
});

describe("M2 add/remove member", () => {
  test("addMember writes a MANUAL row on a non-DIRECT group + audits", async () => {
    mockConvFindById.mockResolvedValue({ _id: CONV, kind: "SECTION" });
    mockUserFind.mockResolvedValue([{ _id: Z }]);
    await addMember(CONV.toString(), Z.toString(), ACTOR);
    const [, update] = mockMemberUpdateOne.mock.calls[0];
    expect(update.$setOnInsert.source).toBe("manual");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CHAT_MEMBERSHIP_CHANGED" }),
    );
  });

  test("addMember to a DIRECT thread is rejected", async () => {
    mockConvFindById.mockResolvedValue({ _id: CONV, kind: "DIRECT" });
    await expect(addMember(CONV.toString(), Z.toString(), ACTOR)).rejects.toThrow(ChatError);
    expect(mockMemberUpdateOne).not.toHaveBeenCalled();
  });

  test("removeMember deletes ONLY the manual row (auto rows are owned by the sync)", async () => {
    mockConvFindById.mockResolvedValue({ _id: CONV, kind: "SECTION" });
    await removeMember(CONV.toString(), Z.toString(), ACTOR);
    const [filter] = mockMemberDeleteOne.mock.calls[0];
    expect(filter.source).toBe("manual");
  });
});

describe("M2 archiveConversation", () => {
  test("archives a CUSTOM group (active=false)", async () => {
    mockConvFindById.mockResolvedValue({ _id: CONV, kind: "CUSTOM", active: true });
    const res = await archiveConversation(CONV.toString(), ACTOR);
    expect(mockConvUpdateOne).toHaveBeenCalledWith({ _id: CONV.toString() }, { $set: { active: false } });
    expect(res.active).toBe(false);
  });

  test("refuses to archive a non-CUSTOM (auto) group", async () => {
    mockConvFindById.mockResolvedValue({ _id: CONV, kind: "SECTION", active: true });
    await expect(archiveConversation(CONV.toString(), ACTOR)).rejects.toThrow(ChatError);
    expect(mockConvUpdateOne).not.toHaveBeenCalled();
  });
});

describe("M2 setPostingPolicy", () => {
  test("persists ANNOUNCEMENT on a group", async () => {
    mockConvFindById.mockResolvedValue({ _id: CONV, kind: "SCHOOL" });
    const res = await setPostingPolicy(CONV.toString(), "ANNOUNCEMENT", ACTOR);
    expect(mockConvUpdateOne).toHaveBeenCalledWith(
      { _id: CONV.toString() },
      { $set: { postingPolicy: "ANNOUNCEMENT" } },
    );
    expect(res.postingPolicy).toBe("ANNOUNCEMENT");
  });

  test("a DIRECT thread cannot have its posting policy changed", async () => {
    mockConvFindById.mockResolvedValue({ _id: CONV, kind: "DIRECT" });
    await expect(setPostingPolicy(CONV.toString(), "ANNOUNCEMENT", ACTOR)).rejects.toThrow(ChatError);
  });
});

// ===========================================================================
// J-M7 — ANNOUNCEMENT enforcement in sendMessage (the M-2 seam)
// ===========================================================================

describe("J-M7 ANNOUNCEMENT posting policy gate", () => {
  beforeEach(() => {
    // The caller is a member of an ANNOUNCEMENT group.
    mockConvFindById.mockResolvedValue({ _id: CONV, kind: "SCHOOL", active: true, postingPolicy: "ANNOUNCEMENT" });
    mockMemberFindOne.mockResolvedValue({ conversationId: CONV, userId: CT, source: "auto" });
    mockMsgCreate.mockImplementation((d: Record<string, unknown>) =>
      Promise.resolve({ _id: oid(), ...d, createdAt: new Date() }),
    );
    mockConvUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  test("a non-manager is blocked from posting (reactions are M-3)", async () => {
    await expect(
      sendMessage({ conversationId: CONV.toString(), senderId: CT.toString(), body: "hi", canManage: false }),
    ).rejects.toThrow(/ব্যবস্থাপক/);
    expect(mockMsgCreate).not.toHaveBeenCalled();
  });

  test("a manager (chat:manage) posts successfully", async () => {
    const msg = await sendMessage({
      conversationId: CONV.toString(),
      senderId: CT.toString(),
      body: "ঘোষণা",
      canManage: true,
    });
    expect(msg.body).toBe("ঘোষণা");
    expect(mockMsgCreate).toHaveBeenCalled();
  });

  test("an OPEN group is unrestricted for everyone", async () => {
    mockConvFindById.mockResolvedValue({ _id: CONV, kind: "SECTION", active: true, postingPolicy: "OPEN" });
    await sendMessage({ conversationId: CONV.toString(), senderId: CT.toString(), body: "hi", canManage: false });
    expect(mockMsgCreate).toHaveBeenCalled();
  });
});

// ===========================================================================
// J-M2 — group-create authority is chat:manage (Principal/Office) only
// ===========================================================================

describe("J-M2 group-create authority (RBAC)", () => {
  test("chat:manage is held by PRINCIPAL/OFFICE only — teachers cannot create groups", () => {
    expect(roleHasPermission("PRINCIPAL", "chat:manage")).toBe(true);
    expect(roleHasPermission("OFFICE", "chat:manage")).toBe(true);
    expect(roleHasPermission("TEACHER", "chat:manage")).toBe(false);
    expect(roleHasPermission("GUARDIAN", "chat:manage")).toBe(false);
  });
});
