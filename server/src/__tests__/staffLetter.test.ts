/**
 * SH-1 / SH-2 — staff letters and the confirmation ledger (docs/prd-staff-hub.md,
 * D-#540/#542). Pure helpers exercised directly; the services run against mocked
 * models (DB-free, the repo's convention).
 *
 * The point under test is the one that makes a letter a RECORD rather than a printout:
 * the snapshot is built once, at issue, and the renderer reads nothing else.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockStaffFindById = jest.fn();
const mockStaffUpdateOne = jest.fn().mockResolvedValue({});
const mockLetterCreate = jest.fn();
const mockLetterFindOne = jest.fn();
const mockLetterFindById = jest.fn();
const mockPolicyFindOne = jest.fn();
const mockDebtFind = jest.fn(() => [] as unknown[]);
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: {
    findById: (id: unknown) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.lean = () => mockStaffFindById(id);
      // ConfirmationService needs a live document (it saves), so findById without
      // .lean() resolves the doc itself.
      return Object.assign(Promise.resolve(mockStaffFindById(id)), chain);
    },
    updateOne: (...a: unknown[]) => mockStaffUpdateOne(...a),
  },
}));
jest.mock("../modules/hr/models/StaffLetter", () => ({
  StaffLetter: {
    create: (d: unknown) => mockLetterCreate(d),
    findOne: (q: unknown) => ({ sort: () => ({ select: () => ({ lean: () => mockLetterFindOne(q) }) }) }),
    findById: (id: unknown) => mockLetterFindById(id),
    exists: jest.fn().mockResolvedValue(null),
    countDocuments: jest.fn().mockResolvedValue(0),
  },
}));
jest.mock("../modules/hr/models/HrPolicy", () => ({
  HrPolicy: { findOne: () => ({ lean: () => mockPolicyFindOne() }) },
}));
jest.mock("../modules/hr/models/ProbationLeaveDebt", () => ({
  ProbationLeaveDebt: {
    find: () => ({
      sort: () => ({ lean: async () => mockDebtFind() }),
      select: () => ({ lean: async () => mockDebtFind() }),
      lean: async () => mockDebtFind(),
    }),
    updateOne: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock("../modules/hr/services/LeaveEntitlementService", () => ({
  pooledBalanceForStaff: (...a: unknown[]) => mockPooledBalance(...a),
}));
const mockPooledBalance = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

import { issueLetter, effectiveFromText, LetterError } from "../modules/hr/services/StaffLetterService";
import { confirmEmployment, previewConfirmation } from "../modules/hr/services/ConfirmationService";
import { toDateKey, isProbationLeave } from "../modules/hr/services/ProbationDebtService";
import {
  buildClauses,
  longDate,
  taka,
  certificateBody,
  needsNewPage,
  buildContractSections,
} from "../modules/hr/routes/staffLetterPdf";
import { bnDigits, longDateBn } from "../modules/hr/services/supportContract";
import { HR_POLICY_DEFAULTS } from "@scd/shared";
import type { ILetterSnapshot } from "../modules/hr/models/StaffLetter";

const ACTOR = oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  mockPolicyFindOne.mockResolvedValue(null); // absent row → HR_POLICY_DEFAULTS
  mockDebtFind.mockReturnValue([]);
  mockLetterFindOne.mockResolvedValue(null); // no prior letter this year
  mockLetterCreate.mockImplementation(async (d: Record<string, unknown>) => ({ ...d, _id: oid() }));
});

// ===========================================================================
describe("letter text helpers (pure)", () => {
  test("effectiveFromText renders the template's month wording", () => {
    expect(effectiveFromText("2026-09-01")).toBe("September, 2026");
    expect(effectiveFromText("2022-01-15")).toBe("January, 2022");
  });

  test("effectiveFromText refuses a malformed date rather than printing junk", () => {
    expect(() => effectiveFromText("01-09-2026")).toThrow(LetterError);
    expect(() => effectiveFromText("2026-13-01")).toThrow(LetterError);
  });

  test("longDate + taka match the letter's own formatting", () => {
    expect(longDate("2026-08-25")).toBe("25 August, 2026");
    expect(taka(11000)).toBe("11,000");
  });
});

// ===========================================================================
describe("clause building — the .docx contradiction is RESOLVED, not reproduced (D-#542)", () => {
  function snap(over: Partial<ILetterSnapshot> = {}): ILetterSnapshot {
    return {
      staffName: "Suhel Ahmad",
      staffNameBn: null,
      schoolId: "20163",
      designation: "Junior Teacher",
      address: null,
      salaryMode: "paid",
      monthlySalary: 5000,
      weeklyHours: "25 (5*5)",
      annualLeaveDays: 20,
      effectiveFrom: "January, 2022",
      confirmationDate: null,
      signatoryName: "X",
      signatoryTitle: "Convener",
      letterDate: "2022-01-01",
      ...over,
    } as ILetterSnapshot;
  }

  /** Clause text + its sub-clauses, flattened — what the page actually says (D-#586). */
  const flat = (cs: ReturnType<typeof buildClauses>): string =>
    cs.map((c) => [c.text, ...(c.subs ?? [])].join(" ")).join(" ");

  test("a PAID letter prints the salary and NEVER the honorary clause", () => {
    const c = buildClauses(snap({ salaryMode: "paid", monthlySalary: 5000 }));
    expect(flat(c)).toContain("Tk. 5,000");
    expect(flat(c)).not.toMatch(/honorary/i);
  });

  test("an HONORARY letter prints no figure at all", () => {
    const c = buildClauses(snap({ salaryMode: "honorary", monthlySalary: null }));
    expect(flat(c)).toMatch(/honorary/i);
    expect(flat(c)).not.toMatch(/Tk\./);
  });

  test("clause 6 names the real post — never the template's stray 'principal'", () => {
    const c = buildClauses(snap({ designation: "Assistant Teacher" }));
    const jobDesc = c.find((x) => x.text.startsWith("Job Description"))?.text;
    expect(jobDesc).toContain("Assistant Teacher");
    expect(jobDesc).not.toMatch(/as a principal/i);
  });

  test("the leave clause carries the policy's pool figure, not a hardcoded 20", () => {
    expect(flat(buildClauses(snap({ annualLeaveDays: 20 })))).toContain("total of 20 days");
    expect(flat(buildClauses(snap({ annualLeaveDays: 25 })))).toContain("total of 25 days");
  });

  test("numbering is generated, so dropping a clause never leaves a gap", () => {
    const paid = buildClauses(snap({ salaryMode: "paid" }));
    const hon = buildClauses(snap({ salaryMode: "honorary", monthlySalary: null }));
    expect(paid).toHaveLength(hon.length); // exactly one salary clause either way
  });
});

// ===========================================================================
describe("issueLetter — the snapshot is the record (D-#542)", () => {
  const staffId = oid();
  function staffDoc(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      _id: staffId,
      name: "Suhel Ahmad",
      nameBn: "সুহেল আহমদ",
      schoolId: "20163",
      designation: "Junior Teacher",
      presentAddress: "Doloirgoan, Companigonj, Sylhet",
      monthlySalary: 5000,
      ...over,
    };
  }

  test("freezes the profile + policy into the snapshot, and allocates a ref no", async () => {
    mockStaffFindById.mockResolvedValue(staffDoc());
    const letter = await issueLetter({
      staffProfileId: staffId.toString(),
      kind: "appointment",
      effectiveFrom: "2022-01-01",
      salaryMode: "paid",
      letterDate: "2022-01-01",
      actorId: ACTOR,
    });
    const snap = (letter as unknown as { snapshot: ILetterSnapshot }).snapshot;
    expect(snap.staffName).toBe("Suhel Ahmad");
    expect(snap.designation).toBe("Junior Teacher");
    expect(snap.address).toBe("Doloirgoan, Companigonj, Sylhet");
    expect(snap.monthlySalary).toBe(5000);
    expect(snap.annualLeaveDays).toBe(HR_POLICY_DEFAULTS.annualLeaveDays);
    expect(snap.signatoryName).toBe(HR_POLICY_DEFAULTS.signatoryName);
    expect((letter as unknown as { refNo: string }).refNo).toBe("SCD/HR/2022/0001");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "STAFF_LETTER_ISSUED" }),
    );
  });

  test("the ref-no sequence continues from the year's highest, zero-padded", async () => {
    mockStaffFindById.mockResolvedValue(staffDoc());
    mockLetterFindOne.mockResolvedValue({ refSeq: 51 });
    const letter = await issueLetter({
      staffProfileId: staffId.toString(),
      kind: "appointment",
      effectiveFrom: "2026-09-01",
      salaryMode: "paid",
      letterDate: "2026-08-25",
      actorId: ACTOR,
    });
    expect((letter as unknown as { refNo: string }).refNo).toBe("SCD/HR/2026/0052");
  });

  /** The refusal IS the feature: the alternative is a signed letter with a wrong post. */
  test("refuses to issue with no designation — clause 6 would print nothing", async () => {
    mockStaffFindById.mockResolvedValue(staffDoc({ designation: null }));
    await expect(
      issueLetter({
        staffProfileId: staffId.toString(),
        kind: "appointment",
        effectiveFrom: "2026-09-01",
        salaryMode: "paid",
        actorId: ACTOR,
      }),
    ).rejects.toThrow(LetterError);
    expect(mockLetterCreate).not.toHaveBeenCalled();
  });

  test("refuses a PAID letter with no salary on record — rather than printing Tk. 0", async () => {
    mockStaffFindById.mockResolvedValue(staffDoc({ monthlySalary: null }));
    await expect(
      issueLetter({
        staffProfileId: staffId.toString(),
        kind: "appointment",
        effectiveFrom: "2026-09-01",
        salaryMode: "paid",
        actorId: ACTOR,
      }),
    ).rejects.toThrow(/বেতন/);
  });

  test("an honorary letter needs no salary and stores none", async () => {
    mockStaffFindById.mockResolvedValue(staffDoc({ monthlySalary: null }));
    const letter = await issueLetter({
      staffProfileId: staffId.toString(),
      kind: "appointment",
      effectiveFrom: "2026-09-01",
      salaryMode: "honorary",
      actorId: ACTOR,
    });
    expect((letter as unknown as { snapshot: ILetterSnapshot }).snapshot.monthlySalary).toBeNull();
  });

  /**
   * SH-9. The letter IS the agreed terms; the record that pays them must carry the same
   * figure. In the 2026-08-26 prod E2E test a letter was issued promising Tk. 12,345
   * against a profile with NO salary — the override lived only in the snapshot, nothing
   * looked wrong, and payroll would have computed nothing for that person.
   */
  test("a PAID letter writes its salary back to the profile", async () => {
    mockStaffFindById.mockResolvedValue(staffDoc({ monthlySalary: null }));
    await issueLetter({
      staffProfileId: staffId.toString(),
      kind: "appointment",
      effectiveFrom: "2026-09-01",
      salaryMode: "paid",
      monthlySalary: 12345,
      actorId: ACTOR,
    });
    expect(mockStaffUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: staffId }),
      { $set: { monthlySalary: 12345 } },
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "STAFF_PAY_SET", meta: expect.objectContaining({ via: "letter" }) }),
    );
  });

  test("no write-back when the profile already carries that figure", async () => {
    mockStaffFindById.mockResolvedValue(staffDoc({ monthlySalary: 5000 }));
    await issueLetter({
      staffProfileId: staffId.toString(),
      kind: "appointment",
      effectiveFrom: "2026-09-01",
      salaryMode: "paid",
      monthlySalary: 5000,
      actorId: ACTOR,
    });
    expect(mockStaffUpdateOne).not.toHaveBeenCalled();
  });

  test("an HONORARY letter writes nothing back — it promises no figure to honour", async () => {
    mockStaffFindById.mockResolvedValue(staffDoc({ monthlySalary: null }));
    await issueLetter({
      staffProfileId: staffId.toString(),
      kind: "appointment",
      effectiveFrom: "2026-09-01",
      salaryMode: "honorary",
      actorId: ACTOR,
    });
    expect(mockStaffUpdateOne).not.toHaveBeenCalled();
  });

  test("an honorary letter DROPS a salary even when one is on the profile", async () => {
    mockStaffFindById.mockResolvedValue(staffDoc({ monthlySalary: 11000 }));
    const letter = await issueLetter({
      staffProfileId: staffId.toString(),
      kind: "appointment",
      effectiveFrom: "2026-09-01",
      salaryMode: "honorary",
      actorId: ACTOR,
    });
    // A leftover figure on an honorary letter would let a later reader mistake it
    // for the agreed terms.
    expect((letter as unknown as { snapshot: ILetterSnapshot }).snapshot.monthlySalary).toBeNull();
  });
});

// ===========================================================================
describe("confirmEmployment — the settlement ledger (D-#540)", () => {
  const staffId = oid();

  function liveStaff(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      _id: staffId,
      name: "A",
      schoolId: "1",
      designation: "Teacher",
      employmentStatus: "probation",
      confirmationDate: undefined,
      joiningDate: new Date("2026-01-01"),
      monthlySalary: 11000,
      save: jest.fn().mockResolvedValue(undefined),
      ...over,
    };
  }

  test("previewConfirmation settles NOTHING — it is a dry run", async () => {
    mockDebtFind.mockReturnValue([{ _id: oid(), days: 6 }]);
    mockPooledBalance.mockResolvedValue({ allowanceDays: 10, remainingDays: 10 });
    const p = await previewConfirmation(staffId.toString());
    expect(p).toMatchObject({ heldDays: 6, poolRemaining: 10, fromPool: 6, toSalary: 0 });
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("6 held days against a 10-day pool → all 6 debited, 4 left, NO salary charge", async () => {
    mockStaffFindById.mockResolvedValue(liveStaff());
    mockDebtFind.mockReturnValue([{ _id: oid(), days: 4 }, { _id: oid(), days: 2 }]);
    mockPooledBalance.mockResolvedValue({ allowanceDays: 10, remainingDays: 10 });

    const res = await confirmEmployment({
      staffProfileId: staffId.toString(),
      confirmationDate: "2026-07-01",
      issueLetter: false,
      actorId: ACTOR,
    });
    expect(res.settlement.heldDays).toBe(6);
    expect(res.settlement.fromPool).toBe(6);
    expect(res.settlement.toSalary).toBe(0);
    expect(res.poolRemainingAfter).toBe(4);
  });

  test("held days OVER the pool: the pool absorbs what it can, the excess falls to salary", async () => {
    mockStaffFindById.mockResolvedValue(liveStaff());
    mockDebtFind.mockReturnValue([{ _id: oid(), days: 12 }]);
    mockPooledBalance.mockResolvedValue({ allowanceDays: 10, remainingDays: 10 });

    const res = await confirmEmployment({
      staffProfileId: staffId.toString(),
      confirmationDate: "2026-07-01",
      issueLetter: false,
      actorId: ACTOR,
    });
    expect(res.settlement.fromPool).toBe(10);
    expect(res.settlement.toSalary).toBe(2);
    expect(res.poolRemainingAfter).toBe(0);
  });

  test("stamps the date + flips the status, and audits with the ledger", async () => {
    const staff = liveStaff();
    mockStaffFindById.mockResolvedValue(staff);
    mockPooledBalance.mockResolvedValue({ allowanceDays: 20, remainingDays: 20 });

    await confirmEmployment({
      staffProfileId: staffId.toString(),
      confirmationDate: "2026-07-01",
      issueLetter: false,
      actorId: ACTOR,
    });
    expect(staff.employmentStatus).toBe("confirmed");
    // Stored at UTC midnight, so the ISO round-trip the GraphQL layer and the app both
    // do gives back the SAME day. Storing local midnight shifted it a day earlier at
    // Bangladesh's +06 offset — a confirmation on 1 July displayed as 30 June.
    expect((staff.confirmationDate as Date).toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(toDateKey(staff.confirmationDate as Date)).toBe("2026-07-01");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "STAFF_EMPLOYMENT_CONFIRMED" }),
    );
  });

  test("the stored date round-trips through BOTH readers — ISO and toDateKey agree", async () => {
    // The two readers that matter: `iso()` in the GraphQL layer (what the app slices)
    // and `toDateKey` (what the probation test compares against a fromKey). If these
    // ever disagree, leave on the confirmation date itself is silently unpaid.
    for (const dateKey of ["2026-01-01", "2026-07-01", "2026-12-31"]) {
      const staff = liveStaff();
      mockStaffFindById.mockResolvedValue(staff);
      mockPooledBalance.mockResolvedValue({ allowanceDays: 20, remainingDays: 20 });
      await confirmEmployment({
        staffProfileId: staffId.toString(),
        confirmationDate: dateKey,
        issueLetter: false,
        actorId: ACTOR,
      });
      const stored = staff.confirmationDate as Date;
      expect(stored.toISOString().slice(0, 10)).toBe(dateKey);
      expect(toDateKey(stored)).toBe(dateKey);
      expect(isProbationLeave(dateKey, stored)).toBe(false); // paid on the day itself
      expect(isProbationLeave("2025-12-31", stored)).toBe(true);
    }
  });

  /**
   * D-#574. Found by driving prod: a staff member with no designation was confirmed and
   * her held days settled, then the letter threw, the mutation errored, and — because
   * writeAudit sat below the letter — the confirmation went in with NO AUDIT ROW. The
   * operator was told twice that it had failed.
   */
  test("refuses BEFORE any write when the letter cannot be issued", async () => {
    const staff = liveStaff({ designation: undefined });
    mockStaffFindById.mockResolvedValue(staff);
    mockPooledBalance.mockResolvedValue({ allowanceDays: 20, remainingDays: 20 });

    await expect(
      confirmEmployment({
        staffProfileId: staffId.toString(),
        confirmationDate: "2026-07-01",
        issueLetter: true,
        actorId: ACTOR,
      }),
    ).rejects.toThrow(/পদবি/);

    // Nothing committed: no save, no settlement, no audit — a clean refusal.
    expect(staff.save).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("a letter failure is NON-FATAL — the confirmation stands and is audited", async () => {
    const staff = liveStaff({ designation: "Teacher" });
    mockStaffFindById.mockResolvedValue(staff);
    mockPooledBalance.mockResolvedValue({ allowanceDays: 20, remainingDays: 20 });
    // Something we did not foresee goes wrong inside the letter.
    mockLetterCreate.mockRejectedValueOnce(new Error("printer on fire"));

    const res = await confirmEmployment({
      staffProfileId: staffId.toString(),
      confirmationDate: "2026-07-01",
      issueLetter: true,
      actorId: ACTOR,
    });

    expect(staff.employmentStatus).toBe("confirmed");
    expect(res.letterId).toBeNull();
    expect(res.letterError).toMatch(/printer on fire/);
    // The audit is the point: the confirmation must never be invisible.
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "STAFF_EMPLOYMENT_CONFIRMED",
        meta: expect.objectContaining({ letterId: null, letterError: expect.stringMatching(/printer/) }),
      }),
    );
  });

  test("confirming WITHOUT a letter needs no designation at all", async () => {
    const staff = liveStaff({ designation: undefined });
    mockStaffFindById.mockResolvedValue(staff);
    mockPooledBalance.mockResolvedValue({ allowanceDays: 20, remainingDays: 20 });

    const res = await confirmEmployment({
      staffProfileId: staffId.toString(),
      confirmationDate: "2026-07-01",
      issueLetter: false,
      actorId: ACTOR,
    });
    expect(res.letterId).toBeNull();
    expect(res.letterError).toBeNull();
    expect(staff.employmentStatus).toBe("confirmed");
  });

  test("refuses a second confirmation — the date is not a field to re-edit here", async () => {
    mockStaffFindById.mockResolvedValue(liveStaff({ confirmationDate: new Date("2026-01-01") }));
    mockPooledBalance.mockResolvedValue({ allowanceDays: 20, remainingDays: 20 });
    await expect(
      confirmEmployment({
        staffProfileId: staffId.toString(),
        confirmationDate: "2026-07-01",
        issueLetter: false,
        actorId: ACTOR,
      }),
    ).rejects.toThrow(/ইতিমধ্যে স্থায়ী/);
  });

  test("refuses a confirmation dated BEFORE joining", async () => {
    mockStaffFindById.mockResolvedValue(liveStaff({ joiningDate: new Date("2026-06-01") }));
    mockPooledBalance.mockResolvedValue({ allowanceDays: 20, remainingDays: 20 });
    await expect(
      confirmEmployment({
        staffProfileId: staffId.toString(),
        confirmationDate: "2026-03-01",
        issueLetter: false,
        actorId: ACTOR,
      }),
    ).rejects.toThrow(/যোগদানের তারিখের আগে/);
  });

  test("refuses a malformed date rather than storing an Invalid Date", async () => {
    mockStaffFindById.mockResolvedValue(liveStaff());
    await expect(
      confirmEmployment({
        staffProfileId: staffId.toString(),
        confirmationDate: "01-07-2026",
        issueLetter: false,
        actorId: ACTOR,
      }),
    ).rejects.toThrow(/Invalid confirmation date/i);
  });
});

// ===========================================================================
describe("service certificate (D-#583)", () => {
  function certSnap(over: Partial<ILetterSnapshot> = {}): ILetterSnapshot {
    return {
      staffName: "Suhel Ahmad",
      staffNameBn: null,
      schoolId: "20163",
      designation: "Junior Teacher",
      address: null,
      salaryMode: "honorary",
      monthlySalary: null,
      weeklyHours: null,
      annualLeaveDays: 20,
      effectiveFrom: "January, 2022",
      confirmationDate: null,
      serviceFrom: "2022-01-10",
      serviceTo: null,
      signatoryName: "X",
      signatoryTitle: "Convener",
      letterDate: "2026-08-29",
      ...over,
    } as ILetterSnapshot;
  }

  test("a SERVING teacher gets the present tense — not a leaving certificate", () => {
    const body = certificateBody(certSnap());
    expect(body).toContain("has been serving");
    expect(body).not.toMatch(/\bserved\b/);
    // The one fact a bank or a next employer actually needs.
    expect(body).toContain("10 January, 2022");
    expect(body).toContain("29 August, 2026");
  });

  test("someone who has LEFT gets the past tense and both dates", () => {
    const body = certificateBody(certSnap({ serviceTo: "2026-06-30" }));
    expect(body).toContain("served");
    expect(body).toContain("from 10 January, 2022 to 30 June, 2026");
    expect(body).not.toContain("has been serving");
  });

  test("a missing joining date weakens the sentence, it does not break it", () => {
    const serving = certificateBody(certSnap({ serviceFrom: null }));
    expect(serving).toContain("has been serving");
    expect(serving).not.toContain("since");

    const left = certificateBody(certSnap({ serviceFrom: null, serviceTo: "2026-06-30" }));
    expect(left).toContain("until 30 June, 2026");
  });
});

// ===========================================================================
describe("the signature block is kept whole (D-#583)", () => {
  // A4 is 842pt tall; the letter uses a 56pt margin.
  const PAGE = 842;
  const MARGIN = 56;

  test("a block that fits stays on the page", () => {
    expect(needsNewPage(400, PAGE, MARGIN, 190)).toBe(false);
  });

  test("a block that would cross the bottom margin starts a new page", () => {
    expect(needsNewPage(700, PAGE, MARGIN, 190)).toBe(true);
  });

  test("the boundary is the bottom MARGIN, not the page edge", () => {
    // Exactly reaching the margin is fine; one point past it is not.
    expect(needsNewPage(PAGE - MARGIN - 190, PAGE, MARGIN, 190)).toBe(false);
    expect(needsNewPage(PAGE - MARGIN - 189, PAGE, MARGIN, 190)).toBe(true);
  });
});

// ===========================================================================
describe("the probation clause (D-#586)", () => {
  function snap2(over: Partial<ILetterSnapshot> = {}): ILetterSnapshot {
    return {
      staffName: "Suhel Ahmad",
      schoolId: "20163",
      designation: "Hifz Teacher",
      salaryMode: "paid",
      monthlySalary: 13000,
      weeklyHours: "44 (5*8+1*4)",
      annualLeaveDays: 20,
      effectiveFrom: "March, 2025",
      probationMonths: 6,
      signatoryName: "X",
      signatoryTitle: "Convener",
      letterDate: "2025-03-01",
      ...over,
    } as ILetterSnapshot;
  }
  const flat2 = (cs: ReturnType<typeof buildClauses>): string =>
    cs.map((c) => [c.text, ...(c.subs ?? [])].join(" ")).join(" ");

  test("probation is clause 1 and spells the length out, as the template does", () => {
    const c = buildClauses(snap2());
    expect(c[0].text).toMatch(/^Probation:/);
    expect(c[0].text).toContain("“Six” months");
    expect(c[0].text).toContain("regularized");
  });

  test("the length comes from the letter, not a constant — Dhaka's three still prints", () => {
    expect(buildClauses(snap2({ probationMonths: 3 }))[0].text).toContain("“Three” months");
    expect(buildClauses(snap2({ probationMonths: 1 }))[0].text).toContain("“One” month");
    expect(buildClauses(snap2({ probationMonths: 1 }))[0].text).not.toContain("months");
  });

  test("zero months omits the clause rather than printing 'Zero months'", () => {
    const c = buildClauses(snap2({ probationMonths: 0 }));
    expect(c[0].text).toMatch(/^Remuneration:/);
    expect(flat2(c)).not.toMatch(/probation of/i);
  });

  test("the updated template's structure is present: sub-clauses, Holidays, misconduct", () => {
    const c = buildClauses(snap2());
    // Increments moved under Remuneration as sub-clause (a).
    expect(c.find((x) => x.text.startsWith("Remuneration:"))?.subs?.[0]).toMatch(/Increments/);
    // Holidays is its own clause, not a sentence at the end of Leave.
    expect(c.some((x) => x.text.startsWith("Holidays:"))).toBe(true);
    const leave = c.find((x) => x.text.startsWith("Leave:"))!;
    expect(leave.subs).toHaveLength(3);
    expect(leave.subs![0]).toMatch(/Vice Principal/);
    // The three gross-misconduct grounds + the release-letter consequence.
    const term = c.find((x) => x.text.startsWith("Termination:"))!;
    expect(term.subs).toHaveLength(4);
    expect(term.subs!.join(" ")).toMatch(/Religious Extremism/);
    expect(term.subs![3]).toMatch(/Release Letter or Testimonial/);
  });
});

// ===========================================================================
describe("the Bangla support-staff contract (D-#586)", () => {
  function contractSnap(over: Partial<ILetterSnapshot> = {}): ILetterSnapshot {
    return {
      staffName: "Parul Begum",
      staffNameBn: "পারুল বেগম",
      schoolId: "30012",
      designation: "খালা (সহায়ক কর্মী)",
      salaryMode: "paid",
      monthlySalary: 10000,
      annualLeaveDays: 20,
      effectiveFrom: "June, 2025",
      probationMonths: 6,
      contractTitleBn: "খালা (সহায়ক কর্মী) নিয়োগ চুক্তিপত্র",
      employerNameBn: "এস সি ডি",
      employerAddressBn: "ঠিকানা",
      dutiesBn: ["ক্লাসরুম পরিষ্কার রাখা।"],
      workingHoursBn: "সকাল ৭:০০ – সন্ধ্যা ৬:৩০",
      signatoryName: "মো: রিজভী রহমান",
      signatoryTitle: "অধ্যক্ষ",
      letterDate: "2025-06-24",
      ...over,
    } as ILetterSnapshot;
  }
  const all = (secs: ReturnType<typeof buildContractSections>): string =>
    secs.map((s) => [s.heading, ...s.lines].join(" ")).join(" ");

  test("the leave line follows the school POOL, not a per-contract figure (owner's ruling)", () => {
    expect(all(buildContractSections(contractSnap()))).toContain("বাৎসরিক ২০");
    expect(all(buildContractSections(contractSnap({ annualLeaveDays: 25 })))).toContain("বাৎসরিক ২৫");
  });

  test("the food allowance appears only when there is one — the খালা's contract has none", () => {
    expect(all(buildContractSections(contractSnap()))).not.toContain("খাবার বাবদ");
    expect(all(buildContractSections(contractSnap({ foodAllowance: 2500 })))).toContain("খাবার বাবদ");
    expect(all(buildContractSections(contractSnap({ foodAllowance: 2500 })))).toContain("২,৫০০");
  });

  test("the probation period appears in §৭, in Bangla digits, and is omitted at zero", () => {
    expect(all(buildContractSections(contractSnap()))).toContain("৬ (৬) মাস");
    expect(all(buildContractSections(contractSnap({ probationMonths: 0 })))).not.toContain("প্রবেশনকাল");
  });

  test("money and dates are Bangla throughout — this document has no English in it", () => {
    expect(all(buildContractSections(contractSnap()))).toContain("১০,০০০");
    expect(longDateBn("2025-06-24")).toBe("২৪ জুন ২০২৫");
    expect(bnDigits(2026)).toBe("২০২৬");
  });
});
