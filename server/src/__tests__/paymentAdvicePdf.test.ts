/**
 * The rendered advice pack (D-#598, D-#599, D-#600).
 *
 * These render a REAL PDF and count what came out, because every defect fixed here was
 * invisible to a test that checked the inputs: the pack the owner downloaded in the
 * 2026-08 prod test was assembled from correct data and was still wrong on the page.
 *
 * Page COUNT is the assertion for the letter gate — a covering letter is a page, so a
 * letter that should not exist shows up as a page that should not exist — and the raw
 * PDF is searched for the /Type /Page objects rather than trusting a return value.
 */
import { renderAdvicePack, fitColumns, rowHeightFor, CELL_PAD } from "../modules/hr/routes/paymentAdvicePdf";
import type { PaymentAdvice, AdviceRow } from "../modules/hr/services/PaymentAdviceService";

const POLICY = {
  employerNameBn: "এস সি ডি",
  signatoryName: "Md. Enamul Haque",
  orgRegistrationNo: "310021031",
  orgAddress: "Urmee 45, West Shibgonj, Sylhet.",
  orgPhone: "01600319999",
  orgEmail: "principal.sylhet@scdbd.org",
  schoolBankName: "Islami Bank Bangladesh PLC",
  schoolBankBranch: "Dakshin Surma, Sylhet",
  schoolAccountNo: "20503210201210503",
} as unknown as PaymentAdvice["policy"];

const row = (over: Partial<AdviceRow>): AdviceRow => ({
  staffProfileId: "s1",
  name: "মোঃ করিম",
  accountName: "Md Karim",
  account: "0011002200330",
  bankName: "Islami Bank Bangladesh PLC",
  bankBranch: "Sylhet",
  routingNo: null,
  amount: 10000,
  blockedReason: null,
  ...over,
});

const advice = (groups: PaymentAdvice["groups"]): PaymentAdvice => ({
  monthKey: "2026-08",
  paymentInfo: "SCD Aug '26 Salary",
  letterDate: "2026-09-01",
  policy: POLICY,
  groups,
});

/** How many pages the reader will see. */
function pageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe("the covering letter is an instruction, so it is only written when there is one (D-#598)", () => {
  test("a channel with nothing payable gets its SHEET but no letter", async () => {
    const pdf = await renderAdvicePack(
      advice([
        {
          channel: "beftn",
          rows: [],
          total: 0,
          blocked: [row({ name: "Test BEFTN Teacher", blockedReason: "রাউটিং নম্বর নেই", amount: 12000 })],
        },
      ]),
    );
    // The sheet, and only the sheet: one page. Before this, the pack opened with a
    // letter to the branch manager asking him to "arrange payment Tk. 0/- (Zero Only)".
    expect(pageCount(pdf)).toBe(1);
  });

  test("a channel WITH payable rows still gets both letter and sheet", async () => {
    const pdf = await renderAdvicePack(
      advice([{ channel: "internal", rows: [row({})], total: 10000, blocked: [] }]),
    );
    expect(pageCount(pdf)).toBe(2);
  });

  test("the mixed case the owner actually had: internal pays, BEFTN is all blocked", async () => {
    const pdf = await renderAdvicePack(
      advice([
        { channel: "internal", rows: [row({})], total: 10000, blocked: [] },
        {
          channel: "beftn",
          rows: [],
          total: 0,
          blocked: [row({ name: "Test BEFTN Teacher", blockedReason: "রাউটিং নম্বর নেই", amount: 12000 })],
        },
        { channel: "cash", rows: [row({ name: "Test Cash Staff", amount: 8000 })], total: 8000, blocked: [] },
      ]),
    );
    // internal letter + internal sheet + BEFTN sheet + cash sheet = 4.
    // It was 5, and the extra one was the zero-value letter.
    expect(pageCount(pdf)).toBe(4);
  });

  test("a run with nothing at all still produces a readable one-page file", async () => {
    const pdf = await renderAdvicePack(advice([]));
    expect(pageCount(pdf)).toBe(1);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("the sheet fits the page it is printed on (D-#599)", () => {
  /**
   * The column widths were laid out against the school's Word template and totalled
   * 598pt; A4 with 48pt margins gives 499.3pt of printable width. Every sheet lost its
   * last column — the staff member's NAME — off the right edge.
   */
  const A4_WIDTH = 595.28;
  const PRINTABLE = A4_WIDTH - 48 - 48;

  test.each([
    ["internal" as const, [30, 150, 130, 66, 110, 112]],
    ["beftn" as const, [26, 92, 78, 104, 54, 82, 66, 96]],
  ])("%s columns are scaled to the printable width, not past it", (_channel, widths) => {
    const raw = widths.map((w) => ({ w }));
    // As authored they overflow — that IS the bug, kept here so the test still means
    // something if someone "fixes" it by editing the numbers instead.
    expect(widths.reduce((a, b) => a + b, 0)).toBeGreaterThan(PRINTABLE);

    const fitted = fitColumns(raw, PRINTABLE);
    expect(fitted.reduce((sum, c) => sum + c.w, 0)).toBeCloseTo(PRINTABLE, 5);
    // Proportions preserved: the template's relative layout is what it is specifying.
    expect(fitted[1].w / fitted[0].w).toBeCloseTo(widths[1] / widths[0], 8);
  });

  test("degenerate input is left alone rather than dividing by zero", () => {
    expect(fitColumns([], 499)).toEqual([]);
    expect(fitColumns([{ w: 0 }], 499)).toEqual([{ w: 0 }]);
  });

  test("a Bangla name and a blocked list render without throwing", async () => {
    // Cells and the blocked list are drawn per script run now (D-#600); a Bangla name
    // used to inherit whichever font the previous call left active.
    const pdf = await renderAdvicePack(
      advice([
        {
          channel: "beftn",
          rows: [row({ name: "মোছাঃ আফিজা খাতুন", routingNo: "015914152", bankName: "Al-Arafah Islami Bank" })],
          total: 10000,
          blocked: [row({ name: "মোঃ আকবর হুসেইন", blockedReason: "রাউটিং নম্বর নেই" })],
        },
      ]),
    );
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(pageCount(pdf)).toBe(2);
  });
});

describe("a table row is as tall as its tallest cell (D-#623)", () => {
  /**
   * The owner's August pack: "Mahmudur Rahman Tazkir" is 100pt of text in a 74pt
   * column, so it wrapped to 21.2pt inside a row fixed at 20pt — and the second line
   * was drawn outside its own border, on top of the next teacher's name. Two bank
   * names and the Payment Info column did the same. D-#599 made it likely by scaling
   * the columns 17% narrower to fit the page, which left the fixed height behind.
   */
  test("a cell that wraps makes the row grow", () => {
    // One line of 8pt text measures 10.6pt: 11 + 5 above + 5 below = 21.
    expect(rowHeightFor([10.6])).toBe(21);
    // Two lines measure 21.2pt, and the row grows to hold them instead of spilling.
    expect(rowHeightFor([21.2])).toBe(32);
    expect(rowHeightFor([21.2])).toBeGreaterThan(rowHeightFor([10.6]));
  });

  test("the TALLEST cell decides, not the first or the last", () => {
    expect(rowHeightFor([10, 31.8, 10])).toBe(rowHeightFor([31.8]));
    expect(rowHeightFor([10, 10, 10])).toBe(20);
  });

  test("an empty row still has a height — no zero-height borders", () => {
    expect(rowHeightFor([])).toBe(20);
    expect(rowHeightFor([0, 0])).toBe(20);
  });

  test("the text always fits inside the row it was measured for", () => {
    for (const h of [10.6, 21.2, 31.8, 42.4]) {
      // drawn at y + CELL_PAD, so the last line must end before y + height
      expect(CELL_PAD + h).toBeLessThanOrEqual(rowHeightFor([h]));
    }
  });
});
