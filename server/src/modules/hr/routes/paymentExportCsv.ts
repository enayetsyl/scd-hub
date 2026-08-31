/**
 * Payment-export workbook route (D-#579; format corrected in D-#590; rebuilt in D-#601):
 *
 *   GET /export/payment/:runId
 *
 * The payment list was a SCREEN. To pay 25 people the office had to copy names and
 * account numbers off it by hand, into the bank's own upload sheet — which is both the
 * slowest possible way and the one that mistypes an account number. This streams the
 * same rows as a workbook the bank sheet can absorb.
 *
 * ONE SOURCE OF TRUTH WITH THE PDF (D-#601). This route used to build its rows from
 * `paymentExport`, an older query with its own idea of who is payable — one that never
 * looked at the routing number. The advice PDF, written later, refused a BEFTN row
 * without one. So the same locked run produced two documents that disagreed about
 * whether a person could be paid, and the spreadsheet was the permissive one: the
 * owner's August test listed a teacher as payable, with her bank's NAME sitting in the
 * account field, whom the PDF had already refused. Both now derive from
 * `paymentAdvice`, so a disagreement is no longer expressible.
 *
 * ONE SHEET PER CHANNEL, plus a sheet for everyone who cannot be paid. A bank file is
 * per-instruction: an internal transfer and a BEFTN transfer are different upload
 * formats, and only BEFTN carries a routing number. Cash is here too — it is not a bank
 * instruction, but the office still has to hand it over, and a person who appears on no
 * sheet at all is a person who does not get paid.
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
import { callerHasPermission, type PaymentChannel } from "@scd/shared";
import { buildContext } from "../../../context";
import { paymentAdvice, type PaymentAdvice } from "../services/PaymentAdviceService";
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

  let advice;
  try {
    advice = await paymentAdvice(req.params.runId);
  } catch (err: unknown) {
    const known = err instanceof PayrollError;
    res.status(known ? 400 : 500).json({ error: known ? err.message : "Export failed" });
    return;
  }

  const buffer = await buildPaymentWorkbook(advice);

  const payable = advice.groups.reduce((n, g) => n + g.rows.length, 0);
  const blocked = advice.groups.reduce((n, g) => n + g.blocked.length, 0);
  await writeAudit({
    eventKind: "PAYROLL_PAYMENT_EXPORTED",
    actorId: ctx.auth.userId,
    targetId: req.params.runId,
    targetKind: "PayrollRun",
    meta: { rows: payable, blocked },
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="payment-${req.params.runId}.xlsx"`);
  res.setHeader("Content-Length", buffer.byteLength);
  res.send(buffer);
});

/** What each channel's worksheet is called. Excel caps a tab name at 31 characters. */
const SHEET_NAME: Record<PaymentChannel, string> = {
  internal: "Own bank (internal)",
  beftn: "Other banks (BEFTN)",
  bkash: "bKash",
  cash: "Cash",
};

/** The sheet naming everyone the run cannot pay, and why. */
const BLOCKED_SHEET = "Cannot pay";

/**
 * The advice as a real .xlsx, with the ACCOUNT COLUMN TYPED AS TEXT (D-#590).
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
 *
 * The ROUTING NUMBER is text for the same reason and appears only on the BEFTN sheet,
 * which is the only instruction that has a column for it.
 */
export async function buildPaymentWorkbook(advice: PaymentAdvice): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SCD Hub";

  /** Columns are per-channel: an internal transfer has no bank, branch or routing. */
  const columnsFor = (channel: PaymentChannel): Array<{ header: string; key: string; width: number }> => {
    const head = [
      { header: "Name", key: "name", width: 28 },
      { header: "Account name", key: "accountName", width: 28 },
      { header: "Account", key: "account", width: 22 },
    ];
    const tail = [
      { header: "Amount", key: "amount", width: 12 },
      { header: "Payment info", key: "info", width: 20 },
    ];
    if (channel === "beftn") {
      return [
        ...head,
        { header: "Bank", key: "bankName", width: 24 },
        { header: "Branch", key: "bankBranch", width: 18 },
        { header: "Routing no", key: "routingNo", width: 14 },
        ...tail,
      ];
    }
    if (channel === "cash") {
      return [{ header: "Name", key: "name", width: 28 }, ...tail];
    }
    return [...head, ...tail];
  };

  /** Text, not number — the whole point of the workbook (D-#590). */
  const asText = (row: ExcelJS.Row, key: string): void => {
    const cell = row.getCell(key);
    cell.numFmt = "@";
    cell.alignment = { horizontal: "left" };
  };

  for (const g of advice.groups) {
    if (g.rows.length === 0) continue; // nothing to instruct on this channel
    const ws = wb.addWorksheet(SHEET_NAME[g.channel]);
    ws.columns = columnsFor(g.channel);
    ws.getRow(1).font = { bold: true };

    for (const r of g.rows) {
      const row = ws.addRow({
        name: r.name,
        accountName: r.accountName ?? "",
        account: r.account ?? "",
        bankName: r.bankName ?? "",
        bankBranch: r.bankBranch ?? "",
        routingNo: r.routingNo ?? "",
        amount: r.amount,
        info: advice.paymentInfo,
      });
      if (g.channel !== "cash") asText(row, "account");
      if (g.channel === "beftn") asText(row, "routingNo");
    }

    // The figure the covering letter quotes, on the sheet it refers to.
    const total = ws.addRow({ name: "Total", amount: g.total });
    total.font = { bold: true };
  }

  // Everyone the run cannot pay, with the reason — never silently absent (D-#601).
  const blocked = advice.groups.flatMap((g) =>
    g.blocked.map((r) => ({ channel: SHEET_NAME[g.channel], row: r })),
  );
  if (blocked.length > 0) {
    const ws = wb.addWorksheet(BLOCKED_SHEET);
    ws.columns = [
      { header: "Name", key: "name", width: 28 },
      { header: "Would have gone to", key: "channel", width: 22 },
      { header: "Why not", key: "reason", width: 26 },
      { header: "Amount", key: "amount", width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const b of blocked) {
      ws.addRow({
        name: b.row.name,
        channel: b.channel,
        reason: b.row.blockedReason ?? "",
        amount: b.row.amount,
      });
    }
  }

  // A run with nothing payable still produces a readable file rather than a workbook
  // with no worksheets, which Excel refuses to open at all.
  if (wb.worksheets.length === 0) {
    const ws = wb.addWorksheet("Payment");
    ws.addRow([`No payable lines in ${advice.monthKey}.`]);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
