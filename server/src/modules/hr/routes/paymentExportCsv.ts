/**
 * Payment-export workbook route (D-#579; format corrected in D-#590):
 *
 *   GET /export/payment/:runId
 *
 * The payment list was a SCREEN. To pay 25 people the office had to copy names and
 * account numbers off it by hand, into the bank's own upload sheet — which is both the
 * slowest possible way and the one that mistypes an account number. This streams the
 * same rows as a workbook the bank sheet can absorb.
 *
 * PAYABLE ROWS ONLY. A row with no account number, an incomplete bank record, or a
 * zero net is not a payment instruction, and putting it in the file either fails the
 * upload or — worse — pays the wrong place. Those rows stay on the screen, listed
 * separately with the reason, so nobody is silently dropped from payday.
 *
 * THE SAME GATE AS THE QUERY, RE-ASSERTED HERE. A route is a second front door: this
 * file names people and their bank accounts, so it is `payroll:manage` exactly as
 * `payrollPaymentExport` is, and it issues only from a LOCKED run (the service
 * enforces that). Audited — an export of everyone's account numbers is an event.
 *
 * A REAL .xlsx, not a CSV: the account column is typed as text so Excel cannot strip
 * the leading zeros off an account number. See buildPaymentWorkbook below (D-#590).
 */
import ExcelJS from "exceljs";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { callerHasPermission } from "@scd/shared";
import { buildContext } from "../../../context";
import { paymentExport } from "../services/PayrollService";
import { PayrollError } from "../services/payrollMath";
import { writeAudit } from "../../platform/services/AuditService";

export const paymentExportCsvRouter: Router = createRouter();

paymentExportCsvRouter.get("/:runId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  if (!callerHasPermission(ctx.auth, "payroll:manage")) {
    res.status(403).json({ error: "বেতন-তালিকা রপ্তানি অফিস/অধ্যক্ষের কাজ" });
    return;
  }

  let rows;
  try {
    rows = await paymentExport(req.params.runId);
  } catch (err: unknown) {
    const known = err instanceof PayrollError;
    res.status(known ? 400 : 500).json({ error: known ? err.message : "Export failed" });
    return;
  }

  const payable = rows.filter((r) => r.blockedReason === null);
  const buffer = await buildPaymentWorkbook(payable);

  await writeAudit({
    eventKind: "PAYROLL_PAYMENT_EXPORTED",
    actorId: ctx.auth.userId,
    targetId: req.params.runId,
    targetKind: "PayrollRun",
    meta: { rows: payable.length, blocked: rows.length - payable.length },
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="payment-${req.params.runId}.xlsx"`);
  res.setHeader("Content-Length", buffer.byteLength);
  res.send(buffer);
});

/**
 * The payable rows as a real .xlsx, with the ACCOUNT COLUMN TYPED AS TEXT (D-#590).
 *
 * It used to be a CSV, and the CSV was correct: every field quoted, so
 * `"0011002200330"` sat on disk exactly as stored. Excel type-converts a quoted
 * numeric-looking field anyway, so the office opened the file and saw `11002200330` —
 * right-aligned, leading zeros gone. An account number without its leading zeros is a
 * different account, and a bKash number without its leading 0 is not a phone number.
 * This file goes to a bank.
 *
 * The unit test that was supposed to cover this asserted the CSV QUOTING rather than
 * what Excel does with it — green, and about the wrong end of the problem.
 *
 * The `="0011…"` CSV trick renders correctly in Excel but writes a formula into the
 * file, which is worse for any bank portal that parses it properly. So: a workbook,
 * where "this cell is text" is a real property of the cell rather than a hint.
 */
export async function buildPaymentWorkbook(
  payable: Array<{
    name: string;
    paymentMethod: string;
    account: string | null;
    accountName: string | null;
    bankName: string | null;
    bankBranch: string | null;
    netPay: number;
  }>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SCD Hub";
  const ws = wb.addWorksheet("Payment");

  ws.columns = [
    { header: "Name", key: "name", width: 28 },
    { header: "Method", key: "method", width: 10 },
    { header: "Account", key: "account", width: 22 },
    { header: "Account name", key: "accountName", width: 28 },
    { header: "Bank", key: "bankName", width: 16 },
    { header: "Branch", key: "bankBranch", width: 16 },
    { header: "Net pay", key: "netPay", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const r of payable) {
    const row = ws.addRow({
      name: r.name,
      method: r.paymentMethod,
      account: r.account ?? "",
      accountName: r.accountName ?? "",
      bankName: r.bankName ?? "",
      bankBranch: r.bankBranch ?? "",
      netPay: r.netPay,
    });
    // "@" is Excel's text format. Without it the cell is text on write and a number
    // the moment the file is opened — which is exactly how the zeros were lost.
    row.getCell("account").numFmt = "@";
    row.getCell("account").alignment = { horizontal: "left" };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
