/**
 * Exams EX-6/EX-7 tests — the custody chain (docs/prd-exams.md §6, D-#382).
 *
 * This is the owner's core ask, so the guards are asserted individually:
 *   · only the NAMED receiver may acknowledge — not the giver, not a bystander;
 *   · a count mismatch keeps BOTH numbers and demands a note (DISPUTED is terminal);
 *   · the balance is DERIVED from events; nothing is a stored running total;
 *   · an unbalanced or disputed chain BLOCKS tabulation — the gate that makes the whole
 *     thing a control rather than a logbook.
 */
interface Row { _id: { toString(): string }; [k: string]: unknown }
const mockExams: Row[] = [];
const mockPapers: Row[] = [];
const mockEvents: Row[] = [];
const mockUsers: Row[] = [];
const mockMarks: Row[] = [];
let mockSeq = 0;
const mockAudits: Array<Record<string, unknown>> = [];
const mockNotifications: Array<Record<string, unknown>> = [];

const idOf = (rv: unknown) =>
  rv && typeof rv === "object" && !Array.isArray(rv) && !(rv instanceof Date)
    ? (rv as { toString(): string }).toString()
    : rv;
function matchVal(rv: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && !(cond instanceof Date) && "$in" in (cond as object)) {
    return (cond as { $in: unknown[] }).$in.map(idOf).includes(idOf(rv));
  }
  return idOf(rv) === idOf(cond);
}
const matches = (r: Row, q: Record<string, unknown>) =>
  Object.entries(q).every(([k, v]) => matchVal(r[k], v));

function makeModel(store: Row[], prefix: string) {
  return {
    create: (doc: Record<string, unknown>) => {
      const seq = ++mockSeq;
      const row: Row = { ...doc, _id: { toString: () => `${prefix}-${seq}` } };
      row.save = () => Promise.resolve(row);
      store.push(row);
      return Promise.resolve(row);
    },
    find: (q: Record<string, unknown> = {}) => {
      const hits = store.filter((r) => matches(r, q));
      const p = Promise.resolve(hits) as Promise<Row[]> & { sort: () => Promise<Row[]> };
      p.sort = () => Promise.resolve(hits);
      return p;
    },
    findOne: (q: Record<string, unknown> = {}) => Promise.resolve(store.find((r) => matches(r, q)) ?? null),
    findById: (id: unknown) => Promise.resolve(store.find((r) => r._id.toString() === idOf(id)) ?? null),
  };
}

jest.mock("../modules/exams/models/Exam", () => ({ Exam: makeModel(mockExams, "ex") }));
jest.mock("../modules/exams/models/ExamPaper", () => ({ ExamPaper: makeModel(mockPapers, "pp") }));
jest.mock("../modules/exams/models/ExamCustodyEvent", () => ({ ExamCustodyEvent: makeModel(mockEvents, "cu") }));
jest.mock("../modules/exams/models/ExamMark", () => ({
  ExamMark: makeModel(mockMarks, "mk"),
  MARK_SOURCES: ["MANUAL", "CT_PULL"],
}));
jest.mock("../modules/foundation/models/User", () => ({ User: makeModel(mockUsers, "us") }));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: Record<string, unknown>) => { mockAudits.push(p); return Promise.resolve(); },
}));
// EX-8 emits on handover + dispute. Mocked so the assertions below are about custody, not
// delivery — and so a real emit() cannot sit on a DB timeout inside notifyQuietly.
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (p: Record<string, unknown>) => { mockNotifications.push(p); return Promise.resolve({ created: true, dedupeKey: "" }); },
}));

import * as CS from "../modules/exams/services/ExamCustodyService";
import { ExamError } from "../modules/exams/services/ExamService";

const OFFICE = "0000000000000000000000a1";
const TEACHER = "0000000000000000000000b1";
const STRANGER = "0000000000000000000000b9";
const EXAM = "0000000000000000000000d1";
const PAPER = "0000000000000000000000c1";

beforeEach(() => {
  [mockExams, mockPapers, mockEvents, mockUsers, mockMarks].forEach((s) => (s.length = 0));
  mockAudits.length = 0;
  mockNotifications.length = 0;
  mockSeq = 0;
  mockExams.push({ _id: { toString: () => EXAM } });
  mockPapers.push({
    _id: { toString: () => PAPER },
    examId: { toString: () => EXAM },
    components: [{ component: "FINAL", maxMarks: 100 }],
    paperFullMarks: 100,
  });
  [OFFICE, TEACHER, STRANGER].forEach((id, i) =>
    mockUsers.push({ _id: { toString: () => id }, name: `User ${i}` }),
  );
});

const hand = (over: Partial<Parameters<typeof CS.recordHandover>[0]> = {}) =>
  CS.recordHandover(
    {
      examId: EXAM, paperId: PAPER, stage: "CHECK_ISSUE", itemKind: "ANSWER_SCRIPT",
      toUserId: TEACHER, declaredCount: 14, ...over,
    },
    OFFICE,
  );

/** Seed N present FINAL marks so `studentsPresent` is a real, derived number. */
const seedPresent = (n: number) => {
  for (let i = 0; i < n; i++) {
    mockMarks.push({
      _id: { toString: () => `mk-${i}` },
      paperId: { toString: () => PAPER },
      component: "FINAL",
      status: "PRESENT",
      rawMark: 50,
    });
  }
};

// ===========================================================================
// A. The two-signature rule
// ===========================================================================

describe("A. recordHandover", () => {
  test("starts PENDING_ACK — nothing is handed over until the receiver says so", async () => {
    const row = await hand();
    expect(row.status).toBe("PENDING_ACK");
    expect(row.declaredCount).toBe(14);
    expect(row.countedCount).toBeUndefined();
    expect(mockAudits.map((a) => a.eventKind)).toContain("EXAM_CUSTODY_HANDED_OVER");
  });

  test("refuses a handover to YOURSELF — a single signature proves nothing", async () => {
    await expect(hand({ toUserId: OFFICE })).rejects.toThrow(/নিজের কাছে/);
  });

  test("refuses an unknown receiver and an unknown stage", async () => {
    await expect(hand({ toUserId: "ghost" })).rejects.toThrow(ExamError);
    await expect(hand({ stage: "NOT_A_STAGE" as never })).rejects.toThrow(/অজানা ধাপ/);
  });

  test("refuses a paper from a different exam", async () => {
    mockExams.push({ _id: { toString: () => "other" } });
    await expect(hand({ examId: "other" })).rejects.toThrow(/এই পরীক্ষার নয়/);
  });
});

describe("B. acknowledgeHandover — ONLY the named receiver", () => {
  test("the receiver acknowledges with a MATCHING count → ACKNOWLEDGED", async () => {
    const row = await hand();
    const ack = await CS.acknowledgeHandover(row._id.toString(), 14, null, TEACHER);
    expect(ack.status).toBe("ACKNOWLEDGED");
    expect(ack.countedCount).toBe(14);
    expect(mockAudits.map((a) => a.eventKind)).toContain("EXAM_CUSTODY_ACKNOWLEDGED");
  });

  test("the GIVER cannot acknowledge their own handover", async () => {
    const row = await hand();
    await expect(CS.acknowledgeHandover(row._id.toString(), 14, null, OFFICE)).rejects.toThrow(/কেবল তিনিই/);
  });

  test("a third party cannot acknowledge", async () => {
    const row = await hand();
    await expect(CS.acknowledgeHandover(row._id.toString(), 14, null, STRANGER)).rejects.toThrow(/কেবল তিনিই/);
  });

  test("acknowledging twice is refused", async () => {
    const row = await hand();
    await CS.acknowledgeHandover(row._id.toString(), 14, null, TEACHER);
    await expect(CS.acknowledgeHandover(row._id.toString(), 14, null, TEACHER)).rejects.toThrow(/আগেই নিষ্পত্তি/);
  });
});

describe("C. a count MISMATCH keeps both numbers (D-#382)", () => {
  test("declared 14 vs counted 13 → DISPUTED, BOTH numbers retained", async () => {
    const row = await hand({ declaredCount: 14 });
    const d = await CS.acknowledgeHandover(row._id.toString(), 13, "one bundle short", TEACHER);
    expect(d.status).toBe("DISPUTED");
    expect(d.declaredCount).toBe(14); // the giver's figure is NOT overwritten
    expect(d.countedCount).toBe(13);  // the receiver's is recorded alongside
    expect(d.discrepancyNote).toBe("one bundle short");
  });

  test("a mismatch WITHOUT a note is refused — a bare mismatch explains nothing", async () => {
    const row = await hand({ declaredCount: 14 });
    await expect(CS.acknowledgeHandover(row._id.toString(), 13, null, TEACHER)).rejects.toThrow(/কারণ লিখতে হবে/);
    await expect(CS.acknowledgeHandover(row._id.toString(), 13, "   ", TEACHER)).rejects.toThrow(/কারণ লিখতে হবে/);
  });

  test("the dispute is audited with both counts", async () => {
    const row = await hand({ declaredCount: 14 });
    await CS.acknowledgeHandover(row._id.toString(), 13, "short", TEACHER);
    const audit = mockAudits.find((a) => a.eventKind === "EXAM_CUSTODY_DISPUTED");
    expect(audit?.meta).toMatchObject({ declaredCount: 14, countedCount: 13 });
  });

  test("DISPUTED is terminal — it cannot be cancelled away", async () => {
    const row = await hand({ declaredCount: 14 });
    await CS.acknowledgeHandover(row._id.toString(), 13, "short", TEACHER);
    await expect(CS.cancelHandover(row._id.toString(), OFFICE)).rejects.toThrow(/বাতিল করা যাবে না/);
  });
});

describe("D. cancelHandover", () => {
  test("the giver may withdraw a still-pending handover", async () => {
    const row = await hand();
    const c = await CS.cancelHandover(row._id.toString(), OFFICE);
    expect(c.status).toBe("CANCELLED");
  });

  test("the receiver cannot cancel it", async () => {
    const row = await hand();
    await expect(CS.cancelHandover(row._id.toString(), TEACHER)).rejects.toThrow(/যিনি হস্তান্তর করেছেন/);
  });
});

// ===========================================================================
// E. Reconciliation (EX-7)
// ===========================================================================

describe("E. custodyBalance — derived, never stored", () => {
  test("scripts out but not back is a blocker", async () => {
    seedPresent(12);
    const out = await hand({ stage: "CHECK_ISSUE", declaredCount: 12 });
    await CS.acknowledgeHandover(out._id.toString(), 12, null, TEACHER);

    const b = await CS.custodyBalance(PAPER);
    expect(b.balanced).toBe(false);
    expect(b.blockers.join(" ")).toMatch(/চেক/);
  });

  test("out and back equal ⇒ that leg balances", async () => {
    seedPresent(12);
    const out = await hand({ stage: "CHECK_ISSUE", declaredCount: 12 });
    await CS.acknowledgeHandover(out._id.toString(), 12, null, TEACHER);
    const back = await CS.recordHandover(
      { examId: EXAM, paperId: PAPER, stage: "CHECK_RETURN", itemKind: "ANSWER_SCRIPT", toUserId: OFFICE, declaredCount: 12 },
      TEACHER,
    );
    await CS.acknowledgeHandover(back._id.toString(), 12, null, OFFICE);

    const b = await CS.custodyBalance(PAPER);
    expect(b.blockers.filter((x) => x.includes("চেক"))).toHaveLength(0);
  });

  test("studentsPresent comes from the exam's OWN marks, never a typed number", async () => {
    seedPresent(9);
    const b = await CS.custodyBalance(PAPER);
    expect(b.studentsPresent).toBe(9);
  });

  test("returned scripts must match who actually sat the paper", async () => {
    seedPresent(12);
    const ret = await CS.recordHandover(
      { examId: EXAM, paperId: PAPER, stage: "SCRIPT_RETURN", itemKind: "ANSWER_SCRIPT", toUserId: OFFICE, declaredCount: 11 },
      TEACHER,
    );
    await CS.acknowledgeHandover(ret._id.toString(), 11, null, OFFICE);

    const b = await CS.custodyBalance(PAPER);
    expect(b.blockers.join(" ")).toMatch(/উপস্থিত 12 জন/);
  });

  test("questions: issued = used + unused returned (the owner's step 1/3/4)", async () => {
    seedPresent(12);
    const issue = await CS.recordHandover(
      { examId: EXAM, paperId: PAPER, stage: "QUESTION_ISSUE", itemKind: "QUESTION_PAPER", toUserId: TEACHER, declaredCount: 14 },
      OFFICE,
    );
    await CS.acknowledgeHandover(issue._id.toString(), 14, null, TEACHER);
    const unused = await CS.recordHandover(
      { examId: EXAM, paperId: PAPER, stage: "QUESTION_RETURN_UNUSED", itemKind: "QUESTION_PAPER", toUserId: OFFICE, declaredCount: 2 },
      TEACHER,
    );
    await CS.acknowledgeHandover(unused._id.toString(), 2, null, OFFICE);

    const b = await CS.custodyBalance(PAPER);
    // 14 = 12 present + 2 unused ⇒ no question blocker
    expect(b.blockers.filter((x) => x.startsWith("প্রশ্ন"))).toHaveLength(0);
  });

  test("a question imbalance is reported with the actual numbers", async () => {
    seedPresent(12);
    const issue = await CS.recordHandover(
      { examId: EXAM, paperId: PAPER, stage: "QUESTION_ISSUE", itemKind: "QUESTION_PAPER", toUserId: TEACHER, declaredCount: 14 },
      OFFICE,
    );
    await CS.acknowledgeHandover(issue._id.toString(), 14, null, TEACHER);
    // nothing returned: 14 ≠ 12 + 0
    const b = await CS.custodyBalance(PAPER);
    expect(b.blockers.join(" ")).toMatch(/প্রশ্ন: সরবরাহ 14/);
  });

  test("a DISPUTED event blocks on its own and does NOT count toward a balance", async () => {
    seedPresent(12);
    const out = await hand({ stage: "CHECK_ISSUE", declaredCount: 12 });
    await CS.acknowledgeHandover(out._id.toString(), 11, "one missing", TEACHER);

    const b = await CS.custodyBalance(PAPER);
    expect(b.balanced).toBe(false);
    expect(b.blockers.join(" ")).toMatch(/গরমিল/);
    // The disputed count is excluded — its number is exactly what is in dispute.
    expect(b.tallies.find((t) => t.stage === "CHECK_ISSUE")!.counted).toBe(0);
    expect(b.tallies.find((t) => t.stage === "CHECK_ISSUE")!.disputed).toBe(1);
  });

  test("a CANCELLED event drops out of the tallies entirely", async () => {
    seedPresent(12);
    const out = await hand({ stage: "CHECK_ISSUE", declaredCount: 99 });
    await CS.cancelHandover(out._id.toString(), OFFICE);
    const b = await CS.custodyBalance(PAPER);
    expect(b.tallies.find((t) => t.stage === "CHECK_ISSUE")!.declared).toBe(0);
  });

  test("an untouched paper with no events and no marks is trivially balanced", async () => {
    const b = await CS.custodyBalance(PAPER);
    expect(b.balanced).toBe(true);
  });
});

// ===========================================================================
// F. EX-8 reads
// ===========================================================================

describe("F. inbox + exceptions", () => {
  test("myPendingAcknowledgements returns only rows addressed to that user", async () => {
    await hand({ toUserId: TEACHER });
    await hand({ toUserId: STRANGER });
    const mine = await CS.myPendingAcknowledgements(TEACHER);
    expect(mine).toHaveLength(1);
    expect(idOf(mine[0].toUserId)).toBe(TEACHER);
  });

  test("an acknowledged row leaves the inbox", async () => {
    const row = await hand();
    await CS.acknowledgeHandover(row._id.toString(), 14, null, TEACHER);
    expect(await CS.myPendingAcknowledgements(TEACHER)).toHaveLength(0);
  });

  test("exceptions surface disputes and stale pendings separately", async () => {
    const disputedRow = await hand({ declaredCount: 5 });
    await CS.acknowledgeHandover(disputedRow._id.toString(), 4, "short", TEACHER);

    const stale = await hand({ declaredCount: 3 });
    (stale as unknown as Row).handedOverAt = new Date(Date.now() - 72 * 3600_000);

    const ex = await CS.custodyExceptions(EXAM, 48);
    expect(ex.disputed).toHaveLength(1);
    expect(ex.stale).toHaveLength(1);
  });

  test("a fresh pending is NOT stale", async () => {
    await hand();
    const ex = await CS.custodyExceptions(EXAM, 48);
    expect(ex.stale).toHaveLength(0);
  });
});

// ===========================================================================
// G. EX-8 notifications — best effort, never blocking
// ===========================================================================

describe("G. notifications", () => {
  test("a handover notifies the NAMED RECEIVER only", async () => {
    await hand({ toUserId: TEACHER });
    const notes = mockNotifications.filter((n) => n.kind === "EXAM_CUSTODY_HANDOVER");
    expect(notes).toHaveLength(1);
    expect(notes[0].recipientUserId).toBe(TEACHER);
  });

  test("a DISPUTE notifies the managers, not just the two signatories", async () => {
    mockUsers.push({ _id: { toString: () => "mgr-1" }, name: "Head", role: "PRINCIPAL", active: true });
    const row = await hand({ declaredCount: 14 });
    await CS.acknowledgeHandover(row._id.toString(), 13, "short", TEACHER);

    const notes = mockNotifications.filter((n) => n.kind === "EXAM_CUSTODY_DISPUTED");
    expect(notes).toHaveLength(1);
    expect(notes[0].recipientUserId).toBe("mgr-1");
    expect(String(notes[0].bodyBn)).toMatch(/14/);
    expect(String(notes[0].bodyBn)).toMatch(/13/);
  });

  test("a MATCHING acknowledgement raises no dispute notification", async () => {
    mockUsers.push({ _id: { toString: () => "mgr-1" }, name: "Head", role: "PRINCIPAL", active: true });
    const row = await hand();
    await CS.acknowledgeHandover(row._id.toString(), 14, null, TEACHER);
    expect(mockNotifications.filter((n) => n.kind === "EXAM_CUSTODY_DISPUTED")).toHaveLength(0);
  });
});
