/**
 * AS-T4 tests — Office follow-up + guardian escalation ladder (PRD §5 AS-T4, D-#88).
 *
 * AJ-6 — steps 1–2 create guardian in-app notification records (skippable);
 *        step 3 generates the Bangla WhatsApp message + wa.me link, logged
 *        PENDING with an outcome stamp; every step an append-only row.
 * Plus: §7 template placeholders; the emit()-seam gate (kind unregistered →
 *       recorded no-op); ladder ordering guards.
 *
 * DB-free: models + the emitter mocked (the real emitter's vocab gate is
 * tested separately at the bottom with the real function).
 */
import mongoose from "mongoose";

const mockRecFindById = jest.fn();
const mockItemFindById = jest.fn();
const mockStudentFindById = jest.fn();
const mockStudentFind = jest.fn();
const mockFuCount = jest.fn();
const mockFuCreate = jest.fn();
const mockFuFindById = jest.fn();
const mockFuFind = jest.fn();
const mockRecFind = jest.fn();
const mockItemFind = jest.fn();
const mockEmitChase = jest.fn();

jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: {
    findById: (id: unknown) => ({ lean: () => mockRecFindById(id) }),
    find: (q: unknown) => ({ lean: () => mockRecFind(q) }),
  },
}));
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: {
    findById: (id: unknown) => ({ lean: () => mockItemFindById(id) }),
    find: (q: unknown) => ({ lean: () => mockItemFind(q) }),
  },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: {
    findById: (id: unknown) => ({ select: () => ({ lean: () => mockStudentFindById(id) }) }),
    find: (q: unknown) => ({ select: () => ({ lean: () => mockStudentFind(q) }) }),
  },
}));
jest.mock("../modules/trackers/models/AssignmentFollowUp", () => {
  const actual = jest.requireActual("../modules/trackers/models/AssignmentFollowUp");
  return {
    ...actual,
    AssignmentFollowUp: {
      countDocuments: (q: unknown) => mockFuCount(q),
      create: (a: unknown) => mockFuCreate(a),
      findById: (id: unknown) => mockFuFindById(id),
      find: (q: unknown) => ({
        select: () => ({ lean: () => mockFuFind(q) }),
        sort: () => ({ lean: () => mockFuFind(q) }),
      }),
    },
  };
});
jest.mock("../modules/notifications/services/emitters", () => {
  const actual = jest.requireActual("../modules/notifications/services/emitters");
  return { ...actual, emitAssignmentGuardianChase: (...a: unknown[]) => mockEmitChase(...a) };
});

import {
  assignmentChaseList,
  escalateAssignmentChase,
  recordFollowUpOutcome,
  buildAssignmentGuardianMessage,
} from "../modules/trackers/services/AssignmentFollowUpService";

const oid = () => new mongoose.Types.ObjectId();
const ACTOR = oid().toString();
const REC_ID = oid();
const ITEM_ID = oid();
const STUDENT_ID = oid();

function chaseRec(over: Record<string, unknown> = {}) {
  return {
    _id: REC_ID,
    asItemId: ITEM_ID,
    asId: "AS-C2-BAN-0003",
    studentId: STUDENT_ID,
    sectionId: oid(),
    classId: oid(),
    state: "CHASE",
    chaseCount: 1,
    dueDate: new Date(2026, 0, 11),
    stateDates: [],
    ...over,
  };
}

const item = {
  _id: ITEM_ID,
  asId: "AS-C2-BAN-0003",
  subject: "BAN",
  weekNumber: 1,
  deliveryDate: new Date(2026, 0, 8),
  dueDate: new Date(2026, 0, 11),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRecFindById.mockResolvedValue(chaseRec());
  mockItemFindById.mockResolvedValue(item);
  mockStudentFindById.mockResolvedValue({ name: "Yousuf Bin Habib", phone: "+8801409514518" });
  mockFuCount.mockResolvedValue(0);
  mockFuCreate.mockImplementation((a: Record<string, unknown>) => Promise.resolve({ _id: oid(), ...a }));
  mockEmitChase.mockResolvedValue([]);
});

// ===========================================================================
// §7 — the generated guardian message
// ===========================================================================

describe("§7 — buildAssignmentGuardianMessage", () => {
  test("Bangla wording + placeholders: name, subject label BN, dates, AS-ID code", async () => {
    const msg = await buildAssignmentGuardianMessage({
      studentName: "Yousuf Bin Habib",
      subject: "BAN",
      asId: "AS-C2-BAN-0003",
      deliveryDate: new Date(2026, 0, 8),
      dueDate: new Date(2026, 0, 11),
    });
    expect(msg).toContain("আসসালামু আলাইকুম");
    expect(msg).toContain("Yousuf Bin Habib");
    expect(msg).toContain("বাংলা"); // subject label Bangla (acceptance #5)
    expect(msg).toContain("AS-C2-BAN-0003"); // English code on the form
    expect(msg).toContain("08/01/2026");
    expect(msg).toContain("11/01/2026");
    expect(msg).toContain("SCD Admin");
  });
});

// ===========================================================================
// Chase list (the Office worklist)
// ===========================================================================

describe("assignmentChaseList", () => {
  test("CHASE records join student + contact + days overdue + next ladder step", async () => {
    mockRecFind.mockResolvedValue([chaseRec()]);
    mockItemFind.mockResolvedValue([item]);
    mockStudentFind.mockResolvedValue([
      { _id: STUDENT_ID, name: "Yousuf Bin Habib", phone: "+8801409514518" },
    ]);
    mockFuFind.mockResolvedValue([{ recordId: REC_ID }]); // one step already taken

    const list = await assignmentChaseList(new Date(2026, 0, 14));
    expect(list).toHaveLength(1);
    expect(list[0].studentName).toBe("Yousuf Bin Habib");
    expect(list[0].guardianPhone).toBe("+8801409514518");
    expect(list[0].daysOverdue).toBe(3); // Jan 11 → Jan 14
    expect(list[0].followUpCount).toBe(1);
    expect(list[0].nextStepNumber).toBe(2);
    expect(list[0].subject).toBe("BAN");
  });

  test("empty when nobody is in CHASE", async () => {
    mockRecFind.mockResolvedValue([]);
    expect(await assignmentChaseList()).toHaveLength(0);
  });
});

// ===========================================================================
// AJ-6 — the escalation ladder
// ===========================================================================

describe("AJ-6 — escalateAssignmentChase", () => {
  test("step 1: in-app row RECORDED when the emit() seam wrote inbox rows", async () => {
    const g1 = oid().toString();
    mockEmitChase.mockResolvedValue([g1]);
    const res = await escalateAssignmentChase({ recordId: REC_ID.toString(), actorId: ACTOR });
    expect(res.stepNumber).toBe(1);
    expect(res.step).toBe("IN_APP_1");
    expect(res.sentStatus).toBe("RECORDED");
    expect(res.notifiedGuardianIds).toEqual([g1]);
    expect(mockEmitChase).toHaveBeenCalledWith(
      expect.objectContaining({ stepNumber: 1, asId: "AS-C2-BAN-0003" }),
    );
    const row = mockFuCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(row.step).toBe("IN_APP_1");
    expect(row.messageBn).toContain("আসসালামু আলাইকুম");
  });

  test("step 1 falls to SKIPPED when nothing deliverable (kind unregistered / contact-only)", async () => {
    mockEmitChase.mockResolvedValue([]);
    const res = await escalateAssignmentChase({ recordId: REC_ID.toString(), actorId: ACTOR });
    expect(res.sentStatus).toBe("SKIPPED");
  });

  test("Office may skip an in-app step explicitly — emitter not called", async () => {
    mockFuCount.mockResolvedValue(1); // step 2 next
    const res = await escalateAssignmentChase({ recordId: REC_ID.toString(), skipInApp: true, actorId: ACTOR });
    expect(res.step).toBe("IN_APP_2");
    expect(res.sentStatus).toBe("SKIPPED");
    expect(mockEmitChase).not.toHaveBeenCalled();
  });

  test("step 3: WhatsApp — Bangla message + wa.me link, PENDING for manual send (ADR-003)", async () => {
    mockFuCount.mockResolvedValue(2);
    const res = await escalateAssignmentChase({ recordId: REC_ID.toString(), actorId: ACTOR });
    expect(res.step).toBe("WHATSAPP");
    expect(res.sentStatus).toBe("PENDING");
    expect(res.waLink).toContain("https://wa.me/8801409514518");
    expect(res.waLink).toContain(encodeURIComponent("আসসালামু আলাইকুম"));
    expect(mockEmitChase).not.toHaveBeenCalled();
  });

  test("step 3 may be logged as CALL/OTHER instead; not before step 3", async () => {
    mockFuCount.mockResolvedValue(2);
    const res = await escalateAssignmentChase({ recordId: REC_ID.toString(), manualStep: "CALL", actorId: ACTOR });
    expect(res.step).toBe("CALL");

    mockFuCount.mockResolvedValue(0);
    await expect(
      escalateAssignmentChase({ recordId: REC_ID.toString(), manualStep: "CALL", actorId: ACTOR }),
    ).rejects.toThrow(/step 3/);
  });

  test("only CHASE records take follow-up", async () => {
    mockRecFindById.mockResolvedValue(chaseRec({ state: "SUBMITTED" }));
    await expect(
      escalateAssignmentChase({ recordId: REC_ID.toString(), actorId: ACTOR }),
    ).rejects.toThrow(/CHASE only/);
  });
});

// ===========================================================================
// Outcome stamp (sheet's Sent Status; append-only otherwise)
// ===========================================================================

describe("recordFollowUpOutcome", () => {
  test("PENDING → SENT with outcome; non-PENDING rows reject the stamp (ADR-008)", async () => {
    const row = {
      _id: oid(), sentStatus: "PENDING", outcome: undefined as string | undefined,
      sentAt: undefined as Date | undefined, save: jest.fn().mockResolvedValue(true),
    };
    mockFuFindById.mockResolvedValue(row);
    await recordFollowUpOutcome(row._id.toString(), "SENT", "অভিভাবক ফোন ধরেছেন", ACTOR);
    expect(row.sentStatus).toBe("SENT");
    expect(row.outcome).toBe("অভিভাবক ফোন ধরেছেন");
    expect(row.sentAt).toBeInstanceOf(Date);

    mockFuFindById.mockResolvedValue({ ...row, sentStatus: "RECORDED" });
    await expect(recordFollowUpOutcome(oid().toString(), "SENT", undefined, ACTOR)).rejects.toThrow(
      /PENDING/,
    );
  });
});

// ===========================================================================
// The emit()-seam gate — REAL emitter, vocab kind not yet registered
// ===========================================================================

describe("emitAssignmentGuardianChase (real) — vocab gate", () => {
  test("recorded no-op while ASSIGNMENT_CHASE is not in NOTIFICATION_KINDS (vocab frozen this session)", async () => {
    const real = jest.requireActual("../modules/notifications/services/emitters");
    const { NOTIFICATION_KINDS } = jest.requireActual("@scd/shared");
    expect(NOTIFICATION_KINDS).not.toContain(real.ASSIGNMENT_CHASE_KIND); // the precondition this session builds under
    const notified = await real.emitAssignmentGuardianChase({
      recordId: oid(), asItemId: oid(), asId: "AS-C1-BAN-0001",
      studentId: oid(), sectionId: oid(), stepNumber: 1, messageBn: "x",
    });
    expect(notified).toEqual([]); // no throw, no DB touch — activates when the kind lands
  });
});
