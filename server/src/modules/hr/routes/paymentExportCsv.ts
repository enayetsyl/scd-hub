/**
 * Payment-export CSV route (D-#579):
 *
 *   GET /export/payment/:runId
 *
 * The payment list was a SCREEN. To pay 25 people the office had to copy names and
 * account numbers off it by hand, into the bank's own upload sheet — which is both the
 * slowest possible way and the one that mistypes an account number. This streams the
 * same rows as a CSV the bank sheet can absorb.
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
 * UTF-8 BOM, deliberately: the office opens this in Excel on Windows, and without the
 * BOM every Bangla name arrives as mojibake.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { callerHasPermission } from "@scd/shared";
import { buildContext } from "../../../context";
import { paymentExport } from "../services/PayrollService";
import { PayrollError } from "../services/payrollMath";
import { writeAudit } from "../../platform/services/AuditService";

export const paymentExportCsvRouter: Router = createRouter();

/** RFC-4180: quote every field, double any inner quote. Account numbers keep their
 *  leading zeros this way, and a Bangla name with a comma cannot shift a column. */
export function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvLine(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

/** The header row, in the order a bank upload sheet expects it. */
export const CSV_HEADER = ["Name", "Method", "Account", "Account name", "Bank", "Branch", "Net pay"];

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
  const lines = [
    csvLine(CSV_HEADER),
    ...payable.map((r) =>
      csvLine([r.name, r.paymentMethod, r.account, r.accountName, r.bankName, r.bankBranch, r.netPay]),
    ),
  ];

  await writeAudit({
    eventKind: "PAYROLL_PAYMENT_EXPORTED",
    actorId: ctx.auth.userId,
    targetId: req.params.runId,
    targetKind: "PayrollRun",
    meta: { rows: payable.length, blocked: rows.length - payable.length },
  });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="payment-${req.params.runId}.csv"`);
  // The BOM is what makes Excel read this as UTF-8 rather than the system codepage.
  res.send(`﻿${lines.join("\r\n")}\r\n`);
});
