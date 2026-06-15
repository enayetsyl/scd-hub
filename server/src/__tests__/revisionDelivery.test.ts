/**
 * Saturday-Revision SR-2 tests (prd-sr2 §3/§4/§6, D-#244/#245).
 *
 * Vocab     — SR_ABSENT/SR_DIGEST registered + the sr.{absent,digest}.* MT keys.
 * Service   — buildDigestSummary (pure); deliverEntry (absent⇒SR_ABSENT, present⇒
 *             SR_DIGEST; wa.me + emit; seals deliveredAt; audited SR_ENTRY_DELIVERED);
 *             consecutiveAbsenceStreak; checkAbsenceEscalation (fires at threshold,
 *             idempotent per streak — J-SR2-4); get/setEscalationConfig (read-time
 *             default 2 — D-#97).
 *
 * DB-free (the repo convention): models, templates, emitters, and audit are mocked.
 */
import mongoose from "mongoose";
import {
  NOTIFICATION_KINDS,
  MESSAGE_TEMPLATE_KEYS,
  MESSAGE_TEMPLATE_REGISTRY,
} from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const mockEntryFindById = jest.fn();
const mockEntryFind = jest.fn();
jest.mock("../modules/saturday-revision/models/RevisionEntry", () => ({
  RevisionEntry: {
    findById: (id: unknown) => mockEntryFindById(id),
    find: (q: unknown) => mockEntryFind(q),
  },
}));

const mockConfigFindOne = jest.fn();
const mockConfigUpdate = jest.fn();
jest.mock("../modules/saturday-revision/models/RevisionEscalationConfig", () => ({
  RevisionEscalationConfig: {
    findOne: (q: unknown) => mockConfigFindOne(q),
    findOneAndUpdate: (q: unknown, u: unknown, o: unknown) => mockConfigUpdate(q, u, o),
  },
}));

const mockDispatchCreate = jest.fn();
jest.mock("../modules/saturday-revision/models/RevisionAbsenceDispatch", () => ({
  RevisionAbsenceDispatch: { create: (doc: unknown) => mockDispatchCreate(doc) },
}));

const mockStudentFindById = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { findById: (id: unknown) => mockStudentFindById(id) },
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => mockUserFind(q) },
}));

const mockRenderTemplate = jest.fn();
jest.mock("../modules/templates/services/MessageTemplateService", () => ({
  renderTemplate: (key: string, params: unknown) => mockRenderTemplate(key, params),
}));

const mockEmitDelivery = jest.fn();
const mockEmitEscalation = jest.fn();
jest.mock("../modules/notifications/services/emitters", () => ({
  emitRevisionDelivery: (ev: unknown) => mockEmitDelivery(ev),
  emitRevisionEscalation: (ev: unknown) => mockEmitEscalation(ev),
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// Import AFTER mocks
import {
  deliverEntry,
  consecutiveAbsenceStreak,
  checkAbsenceEscalation,
  getEscalationConfig,
  setEscalationConfig,
  buildDigestSummary,
  revisionWaLink,
  DEFAULT_ABSENCE_THRESHOLD,
} from "../modules/saturday-revision/services/RevisionDeliveryService";
import { RevisionError } from "../modules/saturday-revision/services/RevisionService";

const STUDENT_OID = oid();
const GROUP_OID = oid();
const ACTOR = oid().toString();
const SAT = new Date("2026-06-13T00:00:00Z");

const makeEntry = (over: Record<string, unknown> = {}) => {
  const doc: Record<string, unknown> = {
    _id: oid(), groupId: GROUP_OID, studentId: STUDENT_OID, date: SAT,
    present: false, juzRecords: [], teacherComment: undefined,
    deliveredAt: undefined, deliveryChannels: [], ...over,
  };
  doc.save = jest.fn(async () => doc);
  return doc;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockRenderTemplate.mockImplementation(async (key: string) => `TPL:${key}`);
  mockEmitDelivery.mockResolvedValue([oid().toString()]);
  mockEmitEscalation.mockResolvedValue([]);
  mockStudentFindById.mockReturnValue(leanChain({ _id: STUDENT_OID, nameBn: "আমিনা", phone: "01711-222333" }));
  mockConfigFindOne.mockReturnValue(leanChain(null)); // read-time default
  mockUserFind.mockReturnValue(leanChain([{ _id: oid() }]));
  // No streak by default (latest present) → no escalation.
  mockEntryFind.mockReturnValue(leanChain([{ present: true }]));
});

// ===========================================================================
// Vocab (§4)
// ===========================================================================

describe("SR-2 vocab", () => {
  test("SR_ABSENT + SR_DIGEST are registered kinds; the sr.* MT keys are in the registry", () => {
    expect(NOTIFICATION_KINDS).toContain("SR_ABSENT");
    expect(NOTIFICATION_KINDS).toContain("SR_DIGEST");
    for (const k of ["sr.absent.title", "sr.absent.body", "sr.absent.wa", "sr.digest.title", "sr.digest.body", "sr.digest.wa"]) {
      expect(MESSAGE_TEMPLATE_KEYS).toContain(k);
      expect(MESSAGE_TEMPLATE_REGISTRY[k as keyof typeof MESSAGE_TEMPLATE_REGISTRY]).toBeTruthy();
    }
  });
});

// ===========================================================================
// buildDigestSummary (pure)
// ===========================================================================

describe("buildDigestSummary", () => {
  test("summarises portions, tanbih/fath, mistakes, and the comment", () => {
    const s = buildDigestSummary(
      [
        { juz: 1, category: "MANZIL", amountJuz: 0.5, tanbih: 2, fath: 1, mistakes: { harf: 1, ghunnah: 0, madd: 0, other: 0 } },
        { juz: 2, category: "MANZIL", amountJuz: 1, tanbih: 1, fath: 0, mistakes: { harf: 0, ghunnah: 2, madd: 0, other: 0 } },
      ],
      "ভালো",
    );
    expect(s).toMatch(/পুরনো রিভিশন: 1.5 পারা/);
    expect(s).toMatch(/তানবিহ: 3, ফাতহ: 1/);
    expect(s).toMatch(/হরফে সমস্যা: 1/);
    expect(s).toMatch(/গুন্নাহ: 2/);
    expect(s).toMatch(/মন্তব্য: ভালো/);
  });

  test("an empty record list falls back to the comment / dash", () => {
    expect(buildDigestSummary([], "মন্তব্য")).toBe("মন্তব্য");
    expect(buildDigestSummary([])).toBe("—");
  });
});

describe("revisionWaLink", () => {
  test("builds a digits-only wa.me link; null without a phone", () => {
    expect(revisionWaLink("01711-222333", "hi")).toMatch(/^https:\/\/wa\.me\/01711222333\?text=/);
    expect(revisionWaLink(undefined, "hi")).toBeNull();
  });
});

// ===========================================================================
// deliverEntry
// ===========================================================================

describe("deliverEntry", () => {
  test("an ABSENT entry delivers SR_ABSENT, seals deliveredAt, audits SR_ENTRY_DELIVERED", async () => {
    const doc = makeEntry({ present: false });
    mockEntryFindById.mockResolvedValue(doc);
    const res = await deliverEntry(String(doc._id), ACTOR);
    expect(res.kind).toBe("SR_ABSENT");
    expect(res.waLink).toMatch(/wa\.me/);
    expect(res.deliveryChannels).toEqual(expect.arrayContaining(["wa", "inbox"]));
    expect(doc.deliveredAt).toBeInstanceOf(Date);
    expect((doc.save as jest.Mock)).toHaveBeenCalled();
    expect(mockEmitDelivery).toHaveBeenCalledWith(expect.objectContaining({ kind: "SR_ABSENT" }));
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "SR_ENTRY_DELIVERED" }));
  });

  test("a PRESENT entry delivers SR_DIGEST and does NOT escalate", async () => {
    const doc = makeEntry({ present: true, juzRecords: [{ juz: 1, category: "SABAQ", amountJuz: 1, tanbih: 0, fath: 0, mistakes: { harf: 0, ghunnah: 0, madd: 0, other: 0 } }] });
    mockEntryFindById.mockResolvedValue(doc);
    const res = await deliverEntry(String(doc._id), ACTOR);
    expect(res.kind).toBe("SR_DIGEST");
    expect(res.escalatedStreak).toBeNull();
    expect(mockEmitEscalation).not.toHaveBeenCalled();
  });

  test("a missing entry throws", async () => {
    mockEntryFindById.mockResolvedValue(null);
    await expect(deliverEntry(oid().toString(), ACTOR)).rejects.toBeInstanceOf(RevisionError);
  });
});

// ===========================================================================
// Escalation (D-#245)
// ===========================================================================

describe("consecutiveAbsenceStreak", () => {
  test("counts the leading run of absent entries, newest first", async () => {
    mockEntryFind.mockReturnValue(leanChain([{ present: false }, { present: false }, { present: true }, { present: false }]));
    expect(await consecutiveAbsenceStreak(STUDENT_OID.toString())).toBe(2);
  });

  test("0 when the latest entry is present", async () => {
    mockEntryFind.mockReturnValue(leanChain([{ present: true }, { present: false }]));
    expect(await consecutiveAbsenceStreak(STUDENT_OID.toString())).toBe(0);
  });
});

describe("checkAbsenceEscalation", () => {
  test("escalates at the threshold: creates a dispatch, emits to guardian + Principal, audits", async () => {
    mockEntryFind.mockReturnValue(leanChain([{ present: false }, { present: false }])); // streak 2 == default
    mockDispatchCreate.mockResolvedValue({ _id: oid() });
    const streak = await checkAbsenceEscalation(STUDENT_OID.toString(), SAT, "আমিনা", ACTOR);
    expect(streak).toBe(2);
    expect(mockDispatchCreate).toHaveBeenCalledWith(expect.objectContaining({ streakLength: 2 }));
    expect(mockEmitEscalation).toHaveBeenCalledWith(expect.objectContaining({ streakLength: 2 }));
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "SR_ABSENCE_ESCALATED" }));
  });

  test("below the threshold does nothing", async () => {
    mockEntryFind.mockReturnValue(leanChain([{ present: false }])); // streak 1 < 2
    expect(await checkAbsenceEscalation(STUDENT_OID.toString(), SAT, "আমিনা", ACTOR)).toBeNull();
    expect(mockDispatchCreate).not.toHaveBeenCalled();
  });

  test("idempotent: a duplicate dispatch (11000) does NOT re-escalate", async () => {
    mockEntryFind.mockReturnValue(leanChain([{ present: false }, { present: false }]));
    mockDispatchCreate.mockRejectedValue({ code: 11000 });
    expect(await checkAbsenceEscalation(STUDENT_OID.toString(), SAT, "আমিনা", ACTOR)).toBeNull();
    expect(mockEmitEscalation).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Config (read-time default — D-#97)
// ===========================================================================

describe("escalation config", () => {
  test("getEscalationConfig returns the read-time default when unset", async () => {
    mockConfigFindOne.mockReturnValue(leanChain(null));
    const c = await getEscalationConfig();
    expect(c).toEqual({ consecutiveAbsenceThreshold: DEFAULT_ABSENCE_THRESHOLD, isDefault: true });
  });

  test("setEscalationConfig validates a positive integer + audits", async () => {
    mockConfigUpdate.mockResolvedValue({});
    const c = await setEscalationConfig(3, ACTOR);
    expect(c.consecutiveAbsenceThreshold).toBe(3);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "SR_ESCALATION_CONFIG_SET" }));
    await expect(setEscalationConfig(0, ACTOR)).rejects.toThrow(/positive integer/);
  });
});
