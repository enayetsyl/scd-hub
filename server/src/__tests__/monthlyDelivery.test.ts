/**
 * MR-6 — telling the family (prd-monthly-report §9).
 *
 * The rule worth a test: a FIRST release and a RE-RELEASE must not read the same.
 * A family handed different numbers under an identical message has no way to know
 * the report changed.
 */
import { Types } from "mongoose";
import { deliverMonthlyReport } from "../modules/reports/services/MonthlyReportDeliveryService";
import type { IMonthlyReport } from "../modules/reports/models/MonthlyReport";

const rendered: string[] = [];
jest.mock("../modules/templates/services/MessageTemplateService", () => ({
  renderTemplate: jest.fn(async (key: string, p: Record<string, unknown>) => {
    rendered.push(key);
    return `${key}|${p.studentName}|${p.month}`;
  }),
}));

const emitted: Array<Record<string, unknown>> = [];
jest.mock("../modules/notifications/services/emitters", () => ({
  emitMonthlyReport: jest.fn(async (ev: Record<string, unknown>) => {
    emitted.push(ev);
    return ["g1", "g2"];
  }),
}));

let studentDoc: { name: string; nameBn?: string; phone?: string } | null = {
  name: "Maruf Hasan",
  nameBn: "মারুফ হাসান",
  phone: "01712345678",
};
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { findById: () => ({ select: () => ({ lean: async () => studentDoc }) }) },
}));

const report = (over: Partial<IMonthlyReport> = {}): Pick<IMonthlyReport, "_id" | "studentId" | "periodKey" | "revision" | "isRerelease"> =>
  ({
    _id: new Types.ObjectId(),
    studentId: new Types.ObjectId(),
    periodKey: "2026-07",
    revision: 1,
    isRerelease: false,
    ...over,
  }) as never;

beforeEach(() => {
  rendered.length = 0;
  emitted.length = 0;
  studentDoc = { name: "Maruf Hasan", nameBn: "মারুফ হাসান", phone: "01712345678" };
});

describe("MR-6 §9 — a revised report does not read like a new one", () => {
  test("a first release uses the RELEASED wording", async () => {
    const out = await deliverMonthlyReport(report());
    expect(rendered).toEqual([
      "monthly_report.released.title",
      "monthly_report.released.body",
      "monthly_report.released.wa",
    ]);
    expect(out.isRerelease).toBe(false);
  });

  test("a re-release uses the REVISED wording", async () => {
    await deliverMonthlyReport(report({ isRerelease: true, revision: 2 }));
    expect(rendered).toEqual([
      "monthly_report.revised.title",
      "monthly_report.revised.body",
      "monthly_report.revised.wa",
    ]);
  });

  test("the Bangla name is preferred, and the month travels as the raw key", async () => {
    const out = await deliverMonthlyReport(report());
    expect(out.studentName).toBe("মারুফ হাসান");
    expect(out.messageBn).toContain("মারুফ হাসান");
    expect(out.messageBn).toContain("2026-07");
  });
});

describe("MR-6 — both rails, and neither is silent about failing", () => {
  test("login-enabled guardians get an inbox notification", async () => {
    const out = await deliverMonthlyReport(report());
    expect(out.notifiedGuardianIds).toEqual(["g1", "g2"]);
    expect(emitted[0]).toMatchObject({ revision: 1, periodKey: "2026-07" });
  });

  test("the emitter is handed PRE-RENDERED text — no renderTemplate per guardian", async () => {
    await deliverMonthlyReport(report());
    // Three renders for the whole report, not three per family.
    expect(rendered).toHaveLength(3);
    expect(emitted[0].titleBn).toBe("monthly_report.released.title|মারুফ হাসান|2026-07");
  });

  test("a family with a phone gets a wa.me link", async () => {
    const out = await deliverMonthlyReport(report());
    expect(out.waLink).toContain("wa.me/01712345678");
    expect(out.unreachableByWa).toBe(false);
  });

  test("a phone-less family is reported UNREACHABLE, never silently skipped", async () => {
    studentDoc = { name: "Maruf Hasan", phone: undefined };
    const out = await deliverMonthlyReport(report());
    expect(out.waLink).toBeNull();
    expect(out.unreachableByWa).toBe(true);
  });

  test("a missing student row does not throw — the release already happened", async () => {
    studentDoc = null;
    const out = await deliverMonthlyReport(report());
    expect(out.studentName).toBe("");
    expect(out.unreachableByWa).toBe(true);
  });
});
