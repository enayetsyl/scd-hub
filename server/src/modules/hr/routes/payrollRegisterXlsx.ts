/**
 * Payroll-register workbook route (D-#625):
 *
 *   GET /export/payroll-register/:runId
 *
 * The owner asked to see "the gross pay, adjustment and net pay in another excel file
 * for making accounting adjustment". The advice pack cannot answer that: it is a payment
 * instruction, so it shows only what leaves the bank, split by channel, with no gross, no
 * deductions and nobody who could not be paid.
 *
 * A SECOND FILE, NOT A SECOND TRUTH. Every figure comes from the same stored payslips as
 * the advice pack and the screen; this file buckets and totals them. That is the same
 * discipline D-#601 had to impose after the payment CSV and the advice PDF disagreed
 * about who was payable, and D-#624 kept when the bank letter became editable.
 *
 * THE SAME GATE, RE-ASSERTED. A route is a second front door and this one names every
 * salary in the school, so it is `payroll:manage` exactly as the payslip query is, and it
 * is audited — an export of everyone's pay is an event.
 *
 * Unlike the payment export it does NOT require a locked run: reviewing the arithmetic
 * before approving is the point (see PayrollRegisterService). The run's status is printed
 * in the header block so a draft can never be mistaken for the final figures.
 */
import ExcelJS from "exceljs";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { callerHasPermission } from "@scd/shared";
import { buildContext } from "../../../context";
import { payrollRegister, type PayrollRegister, type RegisterRow } from "../services/PayrollRegisterService";
import { PayrollError } from "../services/payrollMath";
import { writeAudit } from "../../platform/services/AuditService";

export const payrollRegisterXlsxRouter: Router = createRouter();

payrollRegisterXlsxRouter.get("/:runId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  if (!callerHasPermission(ctx.auth, "payroll:manage")) {
    res.status(403).json({ error: "বেতন-রেজিস্টার রপ্তানি অফিস/অধ্যক্ষের কাজ" });
    return;
  }

  let register: PayrollRegister;
  try {
    register = await payrollRegister(req.params.runId);
  } catch (err: unknown) {
    const known = err instanceof PayrollError;
    res.status(known ? 400 : 500).json({ error: known ? err.message : "Export failed" });
    return;
  }

  const buffer = await buildRegisterWorkbook(register);

  await writeAudit({
    eventKind: "PAYROLL_REGISTER_EXPORTED",
    actorId: ctx.auth.userId,
    targetId: req.params.runId,
    targetKind: "PayrollRun",
    meta: { monthKey: register.monthKey, status: register.status, rows: register.rows.length },
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="payroll-register-${register.monthKey}.xlsx"`);
  res.setHeader("Content-Length", buffer.byteLength);
  res.send(buffer);
});

/** Money everywhere, so a column of figures reads as a column of figures. */
const MONEY = "#,##0";

/**
 * The register as a real .xlsx.
 *
 * THREE SHEETS, because accounts asks three different questions. "Register" is the one
 * that reconciles — a row per person, gross through to net, and every column footed.
 * "Adjustments" is the itemised detail behind those columns, which is what actually gets
 * posted. "Qard (advance)" is the loan movement, reported only as far as the data can
 * honestly support (see PayrollRegisterService).
 *
 * The header block names the run and its STATUS. A prepared run's figures can still
 * change, and a sheet that does not say so is a sheet somebody posts from.
 */
export async function buildRegisterWorkbook(reg: PayrollRegister): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SCD Hub";

  // --- Sheet 1: the register that reconciles ---------------------------------
  const ws = wb.addWorksheet("Register");
  ws.columns = [
    { header: "Sl", key: "sl", width: 5 },
    { header: "Name", key: "name", width: 26 },
    { header: "Category", key: "category", width: 14 },
    { header: "Method", key: "method", width: 10 },
    { header: "Gross", key: "gross", width: 12 },
    { header: "Unpaid leave (days)", key: "unpaidDays", width: 12 },
    { header: "Unpaid leave", key: "d_unpaid_leave", width: 12 },
    { header: "Lateness", key: "d_lateness", width: 11 },
    { header: "Advance (qard)", key: "d_advance_repayment", width: 13 },
    { header: "Statutory", key: "d_statutory", width: 11 },
    { header: "Other deduction", key: "d_other", width: 13 },
    { header: "Total deductions", key: "totalDed", width: 14 },
    { header: "Bonus", key: "a_bonus", width: 11 },
    { header: "Arrears", key: "a_arrears", width: 11 },
    { header: "Leave encashment", key: "a_leave_encashment", width: 14 },
    { header: "Other addition", key: "a_other", width: 13 },
    { header: "Total additions", key: "totalAdd", width: 13 },
    { header: "Net pay", key: "net", width: 12 },
    { header: "Check", key: "check", width: 8 },
  ];

  const headerBlock = [
    `Payroll register — ${reg.monthKey}`,
    `Run status: ${reg.status}${reg.status === "prepared" ? "  (DRAFT — not approved; these figures can still change)" : ""}`,
    `Working days: ${reg.workingDays}   Prepared: ${fmtDate(reg.preparedAt)}` +
      (reg.approvedAt ? `   Approved: ${fmtDate(reg.approvedAt)}` : ""),
    "Net pay = Gross + additions − deductions. The Check column re-adds each row from its own itemised columns; every value must be 0.",
  ];
  writeHeaderBlock(ws, headerBlock, 19);

  const headerRowNo = ws.rowCount + 1;
  ws.addRow(Object.fromEntries((ws.columns ?? []).map((c) => [c.key as string, c.header as string])));
  ws.getRow(headerRowNo).font = { bold: true };

  reg.rows.forEach((r, i) => moneyRow(ws.addRow(rowValues(r, i + 1)), r));
  const total = ws.addRow(rowValues(reg.totals, null));
  total.font = { bold: true };
  moneyRow(total, reg.totals);

  ws.views = [{ state: "frozen", ySplit: headerRowNo }];
  ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: headerRowNo, column: 19 } };

  // --- Sheet 2: the itemised lines behind those columns ----------------------
  const ls = wb.addWorksheet("Adjustments");
  ls.columns = [
    { header: "Name", key: "name", width: 26 },
    { header: "Kind", key: "kind", width: 11 },
    { header: "Type", key: "type", width: 20 },
    { header: "Days", key: "days", width: 8 },
    { header: "Amount", key: "amount", width: 12 },
    { header: "Note", key: "note", width: 52 },
  ];
  ls.getRow(1).font = { bold: true };
  for (const l of reg.lines) {
    const row = ls.addRow({
      name: l.name,
      kind: l.kind === "addition" ? "Addition" : "Deduction",
      type: l.type,
      days: l.days ?? "",
      amount: l.amount,
      note: l.note,
    });
    row.getCell("amount").numFmt = MONEY;
  }
  if (reg.lines.length === 0) ls.addRow({ name: "No additions or deductions in this run." });

  // --- Sheet 3: what the run did to the qard loans ---------------------------
  const as = wb.addWorksheet("Qard (advance)");
  as.columns = [
    { header: "Name", key: "name", width: 26 },
    { header: "Recovered in this run", key: "recovered", width: 18 },
    { header: "Balance now", key: "balance", width: 14 },
    { header: "Status", key: "status", width: 12 },
    { header: "Recovery mode", key: "mode", width: 14 },
  ];
  writeHeaderBlock(
    as,
    [
      "Qard recovered by this run.",
      '"Balance now" is TODAY\'s outstanding figure, not this run\'s closing balance: recovery commits when a run is approved, so on a draft run it has not moved yet, and on an older run a later one may have moved it again.',
    ],
    5,
  );
  const aHeader = as.rowCount + 1;
  as.addRow({ name: "Name", recovered: "Recovered in this run", balance: "Balance now", status: "Status", mode: "Recovery mode" });
  as.getRow(aHeader).font = { bold: true };
  for (const a of reg.advances) {
    const row = as.addRow({
      name: a.name,
      recovered: a.recoveredThisRun,
      balance: a.balanceNow,
      status: a.status,
      mode: a.recoveryMode,
    });
    row.getCell("recovered").numFmt = MONEY;
    row.getCell("balance").numFmt = MONEY;
  }
  if (reg.advances.length === 0) {
    as.addRow({ name: "No advance was recovered in this run." });
  } else {
    const t = as.addRow({
      name: "Total",
      recovered: reg.advances.reduce((n, a) => n + a.recoveredThisRun, 0),
      balance: reg.advances.reduce((n, a) => n + a.balanceNow, 0),
    });
    t.font = { bold: true };
    t.getCell("recovered").numFmt = MONEY;
    t.getCell("balance").numFmt = MONEY;
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function fmtDate(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

/** The title lines above a table, merged across its width so they read as prose. */
function writeHeaderBlock(ws: ExcelJS.Worksheet, lines: string[], width: number): void {
  lines.forEach((text, i) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, width);
    if (i === 0) row.font = { bold: true, size: 13 };
    row.getCell(1).alignment = { vertical: "middle", wrapText: false };
  });
  ws.addRow([]);
}

function rowValues(r: RegisterRow, sl: number | null): Record<string, string | number> {
  return {
    sl: sl ?? "",
    name: r.name,
    category: r.category,
    method: r.paymentMethod ?? "",
    gross: r.grossSalary,
    unpaidDays: r.unpaidLeaveDays,
    d_unpaid_leave: r.deductions.unpaid_leave,
    d_lateness: r.deductions.lateness,
    d_advance_repayment: r.deductions.advance_repayment,
    d_statutory: r.deductions.statutory,
    d_other: r.deductions.other,
    totalDed: r.totalDeductions,
    a_bonus: r.additions.bonus,
    a_arrears: r.additions.arrears,
    a_leave_encashment: r.additions.leave_encashment,
    a_other: r.additions.other,
    totalAdd: r.totalAdditions,
    net: r.netPay,
    check: r.check,
  };
}

/**
 * Money formatting, and the one piece of emphasis on the sheet: a non-zero `check` is
 * shown in red. It should never fire — but a reconciliation column nobody notices is not
 * a reconciliation.
 */
function moneyRow(row: ExcelJS.Row, r: RegisterRow): void {
  for (const key of [
    "gross", "d_unpaid_leave", "d_lateness", "d_advance_repayment", "d_statutory",
    "d_other", "totalDed", "a_bonus", "a_arrears", "a_leave_encashment", "a_other",
    "totalAdd", "net", "check",
  ]) {
    row.getCell(key).numFmt = MONEY;
  }
  if (r.check !== 0) {
    row.getCell("check").font = { bold: true, color: { argb: "FFCC0000" } };
  }
}
