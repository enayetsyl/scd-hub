/**
 * The editable letter, where it meets the run and where it meets the database (D-#624).
 *
 * `adviceLetter.test.ts` pins the substitution rule. This pins the two joins that rule
 * has to the rest of the system:
 *   - `letterParagraphs` — which figures the letter takes from the RUN rather than from
 *     whatever the school typed;
 *   - `setHrPolicy` — that a placeholder nobody can fill is refused while it is still in
 *     a text box, instead of printing to a bank verbatim.
 *
 * DB-free: models mocked, the repo's convention.
 */
import mongoose from "mongoose";
import { DEFAULT_ADVICE_LETTER_BODY } from "@scd/shared";

const mockPolicyFindOne = jest.fn(() => null as unknown);
const mockUpdate = jest.fn(async (_f: unknown, u: { $set: Record<string, unknown> }) => u.$set);
jest.mock("../modules/hr/models/HrPolicy", () => ({
  HrPolicy: {
    findOne: () => ({ lean: async () => mockPolicyFindOne() }),
    findOneAndUpdate: (f: unknown, u: unknown) => mockUpdate(f, u as never),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: jest.fn(async () => undefined) }));

import { letterParagraphs } from "../modules/hr/routes/paymentAdvicePdf";
import { getHrPolicy, setHrPolicy } from "../modules/hr/services/HrPolicyService";
import type { PaymentAdvice, AdviceGroup } from "../modules/hr/services/PaymentAdviceService";

const ACTOR = new mongoose.Types.ObjectId().toString();

const policy = (over: Record<string, unknown> = {}) =>
  ({
    employerNameBn: "SCD Sylhet",
    schoolBankName: "Islami Bank Bangladesh PLC",
    schoolBankBranch: "Dakshin Surma, Sylhet",
    schoolAccountNo: "20503210201210503",
    adviceLetterBody: DEFAULT_ADVICE_LETTER_BODY,
    ...over,
  }) as unknown as PaymentAdvice["policy"];

const advice = (over: Record<string, unknown> = {}): PaymentAdvice =>
  ({ monthKey: "2026-08", paymentInfo: "SCD Aug '26 Salary", letterDate: "2026-09-01",
     policy: policy(over), groups: [] }) as PaymentAdvice;

const group = (total: number, rowCount: number): AdviceGroup =>
  ({ channel: "beftn", total, blocked: [],
     rows: Array.from({ length: rowCount }, () => ({})) }) as unknown as AdviceGroup;

beforeEach(() => {
  mockPolicyFindOne.mockReset();
  mockPolicyFindOne.mockReturnValue(null);
  mockUpdate.mockClear();
});

describe("the school chooses the words; the run chooses the figures", () => {
  test("the amount, the words, the month and the count all come from the run", () => {
    const paras = letterParagraphs(
      advice({ adviceLetterBody: "Pay {{amount}} ({{amountWords}}) to {{staffCount}} staff for {{month}}." }),
      group(240500, 25),
    );
    expect(paras).toEqual([
      "Pay 240,500 (Two Lac Forty Thousand Five Hundred Only) to 25 staff for August 2026.",
    ]);
  });

  test("a school that types its own total does NOT get to override the run", () => {
    // The point of keeping figures out of the editable text: a letter asking for a number
    // the attached sheet does not add up to is a letter the bank will bounce, or worse honour.
    const paras = letterParagraphs(
      advice({ adviceLetterBody: "Pay Tk. 99,999 — that is, {{amount}}." }),
      group(240500, 25),
    );
    expect(paras[0]).toContain("240,500");
  });

  test("an absent body prints the standard letter rather than throwing mid-pack", () => {
    const paras = letterParagraphs(advice({ adviceLetterBody: undefined }), group(12000, 1));
    expect(paras[0]).toContain("are clients of your bank");
    expect(paras[0]).toContain("12,000");
  });
});

describe("saving the wording", () => {
  test("a typo'd placeholder is refused, and names both the typo and the valid set", async () => {
    await expect(
      setHrPolicy({ adviceLetterBody: "Pay Tk. {{amont}} for {{month}}.", actorId: ACTOR }),
    ).rejects.toThrow(/\{\{amont\}\}/);
    await expect(
      setHrPolicy({ adviceLetterBody: "Pay Tk. {{amont}}.", actorId: ACTOR }),
    ).rejects.toThrow(/\{\{amountWords\}\}/);
    // Nothing reached the database.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("a valid body is stored verbatim, blank lines and all", async () => {
    const body = "Dear Sir,\n\nPlease transfer {{amount}} for {{month}}.";
    await setHrPolicy({ adviceLetterBody: body, actorId: ACTOR });
    expect(mockUpdate.mock.calls[0][1].$set.adviceLetterBody).toBe(body);
  });

  test("an empty stored body reads back as the default, so clearing it is the way out", async () => {
    mockPolicyFindOne.mockReturnValue({ adviceLetterBody: "" } as unknown);
    expect((await getHrPolicy()).adviceLetterBody).toBe(DEFAULT_ADVICE_LETTER_BODY);
  });

  test("editing another policy field does not disturb the wording", async () => {
    mockPolicyFindOne.mockReturnValue({ adviceLetterBody: "Custom {{amount}}." } as unknown);
    await setHrPolicy({ signatoryName: "Someone Else", actorId: ACTOR });
    expect(mockUpdate.mock.calls[0][1].$set.adviceLetterBody).toBe("Custom {{amount}}.");
  });
});
