/**
 * Salary sheet — GET /export/salary-sheet/:runId  (D-#914).
 *
 * The sheet that goes behind the office's salary vouchers: per person, gross, each kind of
 * deduction, each kind of addition and net, grouped by how the money is paid (own bank,
 * BEFTN, bKash, cash) with a subtotal per group and a grand total. The owner: *"prepare
 * spreadsheet … gross salary, deduction and net pay … in the voucher we will add only the
 * expenses."* See SalarySheetService for why the numbers are the register's, never a
 * second computation, and why the deductions are split around the Salary expense column
 * (D-#929: the voucher books that column and the adjustments, so the cash balance matches).
 *
 * GATE — `payroll:export`, the same switch as the register XLSX and the advice pack: it is
 * the same information, laid out for the voucher file. Audited (it names everyone's pay).
 */
import PDFDocument from "pdfkit";
import * as path from "path";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import {
  callerHasPermission,
  PAY_ADDITION_TYPE_LABELS_EN,
  PAY_DEDUCTION_TYPE_LABELS_EN,
  type PaymentChannel,
} from "@scd/shared";
import { mixedText, mixedTextInBox } from "../../../routes/pdfRenderer";
import { buildContext } from "../../../context";
import { salarySheet, salaryExpense, type SalarySheet } from "../services/SalarySheetService";
import type { RegisterRow } from "../services/PayrollRegisterService";
import { takaFigure } from "../services/takaWords";
import { PayrollError } from "../services/payrollMath";
import { writeAudit } from "../../platform/services/AuditService";
import { fitColumns, footer, letterhead, monthTitle, rowHeightFor, CELL_PAD } from "./paymentAdvicePdf";

const FONT_PATH = path.resolve(__dirname, "../../../../assets/fonts/NotoSansBengali-Regular.ttf");

export const salarySheetPdfRouter: Router = createRouter();

salarySheetPdfRouter.get("/:runId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  if (!callerHasPermission(ctx.auth, "payroll:export")) {
    res.status(403).json({ error: "বেতন শিট নামানো অফিস/অধ্যক্ষের কাজ" });
    return;
  }

  let sheet: SalarySheet;
  try {
    sheet = await salarySheet(req.params.runId);
  } catch (err: unknown) {
    const known = err instanceof PayrollError;
    res.status(known ? 400 : 500).json({ error: known ? err.message : "Salary sheet failed" });
    return;
  }

  try {
    const pdf = await renderSalarySheet(sheet);
    await writeAudit({
      eventKind: "PAYROLL_PAYMENT_EXPORTED",
      actorId: ctx.auth.userId,
      targetId: req.params.runId,
      targetKind: "PayrollRun",
      meta: {
        format: "salary-sheet-pdf",
        monthKey: sheet.monthKey,
        status: sheet.status,
        groups: sheet.groups.map((g) => ({ channel: g.channel, rows: g.rows.length, net: g.subtotal.netPay })),
      },
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="salary-sheet-${sheet.monthKey}.pdf"`);
    res.setHeader("Content-Length", pdf.byteLength);
    res.send(pdf);
  } catch (err) {
    console.error(`Salary sheet PDF failed for ${req.params.runId}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const GREEN = "#3F6C45";
const GROUP_FILL = "#E8F0E9";
const TOTAL_FILL = "#D5E3D7";
/** The Salary expense column — the figure the voucher books — stands out on every row. */
const EXPENSE_FILL = "#FFF4D6";

/** The heading over each group: the school's own bank by name, so it matches the letter. */
export function groupTitle(channel: PaymentChannel, schoolBankName: string): string {
  switch (channel) {
    case "internal":
      return `${schoolBankName.trim() || "Own bank"} — internal transfer`;
    case "beftn":
      return "Other banks — BEFTN";
    case "bkash":
      return "bKash";
    default:
      return "Cash";
  }
}

interface Col {
  key: string;
  label: string;
  w: number;
  numeric: boolean;
  emphasis?: boolean;
  value: (r: RegisterRow, i: number) => string;
}

/**
 * The columns for this month, in voucher order (D-#929): gross, the not-paid deductions,
 * the additions, SALARY EXPENSE, the adjustments, net pay. Only kinds that moved money.
 */
export function sheetColumns(
  sheet: Pick<SalarySheet, "notPaidColumns" | "additionColumns" | "adjustmentColumns">,
): Col[] {
  const money = (n: number): string => (n === 0 ? "" : takaFigure(n));
  const deduction = (t: SalarySheet["notPaidColumns"][number]): Col => ({
    key: `d:${t}`,
    label: `(-) ${PAY_DEDUCTION_TYPE_LABELS_EN[t]}`,
    w: 66,
    numeric: true,
    value: (r) => money(r.deductions[t]),
  });
  return [
    { key: "sl", label: "SL", w: 26, numeric: false, value: (_r, i) => (i >= 0 ? String(i + 1) : "") },
    { key: "name", label: "Name", w: 170, numeric: false, value: (r) => r.name },
    { key: "gross", label: "Gross salary", w: 70, numeric: true, value: (r) => takaFigure(r.grossSalary) },
    ...sheet.notPaidColumns.map(deduction),
    ...sheet.additionColumns.map<Col>((t) => ({
      key: `a:${t}`,
      label: `(+) ${PAY_ADDITION_TYPE_LABELS_EN[t]}`,
      w: 66,
      numeric: true,
      value: (r) => money(r.additions[t]),
    })),
    {
      key: "expense",
      label: "Salary expense",
      w: 74,
      numeric: true,
      emphasis: true,
      value: (r) => takaFigure(salaryExpense(r)),
    },
    ...sheet.adjustmentColumns.map(deduction),
    { key: "net", label: "Net pay", w: 74, numeric: true, value: (r) => takaFigure(r.netPay) },
  ];
}

export async function renderSalarySheet(sheet: SalarySheet): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      margin: 40,
      size: "A4",
      layout: "landscape",
      info: { Title: `Salary sheet ${sheet.monthKey}`, Creator: "SCD Hub" },
    });
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("NotoSansBengali", FONT_PATH);
    doc.font("NotoSansBengali");

    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startX = doc.page.margins.left;
    const cols = fitColumns(sheetColumns(sheet), width);

    const heading = (): void => {
      letterhead(doc, sheet);
      doc.fontSize(11);
      mixedText(doc, `Teachers/Admin Salary Sheet - ${monthTitle(sheet.monthKey)}`, { width, align: "center" });
      if (sheet.status !== "approved_locked") {
        doc.fontSize(9).fillColor("#B3261E");
        mixedText(doc, "DRAFT — not approved; these figures can still change", { width, align: "center" });
        doc.fillColor("#000000");
      }
      doc.moveDown(0.6);
      doc.fontSize(8);
    };

    const drawCells = (cells: string[], opts: { fill?: string; header?: boolean } = {}): void => {
      const height = rowHeightFor(
        cells.map((text, i) => (text ? doc.heightOfString(text, { width: cols[i].w - 6 }) : 0)),
      );
      if (doc.y + height > doc.page.height - doc.page.margins.bottom - 40) {
        footer(doc, sheet);
        doc.addPage();
        heading();
        drawHeader();
      }
      const y = doc.y;
      let x = startX;
      cells.forEach((text, i) => {
        const w = cols[i].w;
        const fill = opts.fill ?? (cols[i].emphasis ? EXPENSE_FILL : undefined);
        if (fill) doc.save().rect(x, y, w, height).fill(fill).restore();
        doc.save().rect(x, y, w, height).lineWidth(0.5).stroke("#999999").restore();
        doc.fillColor(opts.header ? "#FFFFFF" : "#000000");
        mixedTextInBox(doc, text, x + 3, y + CELL_PAD, w - 6, {
          align: cols[i].numeric && !opts.header ? "right" : "left",
        });
        x += w;
      });
      doc.fillColor("#000000");
      doc.x = startX;
      doc.y = y + height;
    };
    const drawHeader = (): void => drawCells(cols.map((c) => c.label), { fill: GREEN, header: true });

    /** A full-width band: a group's title. */
    const drawBand = (text: string): void => {
      const height = rowHeightFor([doc.heightOfString(text, { width: width - 6 })]);
      if (doc.y + height * 2 > doc.page.height - doc.page.margins.bottom - 40) {
        footer(doc, sheet);
        doc.addPage();
        heading();
        drawHeader();
      }
      const y = doc.y;
      doc.save().rect(startX, y, width, height).fill(GROUP_FILL).restore();
      doc.save().rect(startX, y, width, height).lineWidth(0.5).stroke("#999999").restore();
      mixedTextInBox(doc, text, startX + 3, y + CELL_PAD, width - 6, { align: "left" });
      doc.x = startX;
      doc.y = y + height;
    };

    const totalCells = (label: string, r: RegisterRow): string[] =>
      cols.map((c) => (c.key === "sl" ? "" : c.key === "name" ? label : c.value(r, -1)));

    heading();
    drawHeader();

    if (sheet.groups.length === 0) {
      doc.moveDown(1);
      mixedText(doc, `No payslips in ${monthTitle(sheet.monthKey)}.`, { width, align: "center" });
    }
    for (const g of sheet.groups) {
      drawBand(`${groupTitle(g.channel, sheet.policy.schoolBankName)}  (${g.rows.length})`);
      g.rows.forEach((r, i) => drawCells(cols.map((c) => c.value(r, i))));
      drawCells(totalCells("Subtotal", g.subtotal), { fill: GROUP_FILL });
    }
    if (sheet.groups.length > 0) {
      drawCells(totalCells("Grand total", sheet.total), { fill: TOTAL_FILL });
    }

    // A payslip whose lines do not add up to its net is said out loud (the register's `check`).
    const off = sheet.groups.flatMap((g) => g.rows).filter((r) => r.check !== 0);
    if (off.length > 0) {
      doc.moveDown(0.8);
      doc.fontSize(8).fillColor("#B3261E");
      mixedText(doc, `Check: ${off.map((r) => r.name).join(", ")} — the lines do not add up to the net pay. Open the register before using this sheet.`, { width });
      doc.fillColor("#000000");
    }

    // How to read the columns into the voucher — the reason the sheet is laid out this way.
    if (sheet.groups.length > 0) {
      doc.moveDown(0.8);
      doc.fontSize(8).fillColor("#444444");
      mixedText(
        doc,
        "Salary expense = Gross - deductions not paid (unpaid leave, lateness) + additions: book it as the salary expense. " +
          "The columns after it are adjustments (advance, loan, statutory, other): book them as recoveries. " +
          "Salary expense - adjustments = Net pay, the amount on the bank letter / cash voucher.",
        { width },
      );
      doc.fillColor("#000000");
    }

    // Signature lines, as on the school's voucher.
    if (doc.y + 70 > doc.page.height - doc.page.margins.bottom - 30) {
      footer(doc, sheet);
      doc.addPage();
    }
    const y = doc.y + 36;
    const lineW = 150;
    doc.fontSize(9);
    doc.save().moveTo(startX, y).lineTo(startX + lineW, y).lineWidth(0.5).stroke("#333333").restore();
    doc.save().moveTo(startX + width - lineW, y).lineTo(startX + width, y).lineWidth(0.5).stroke("#333333").restore();
    mixedTextInBox(doc, "Prepared by", startX, y + 4, lineW, { align: "center" });
    mixedTextInBox(doc, "Principal", startX + width - lineW, y + 4, lineW, { align: "center" });

    footer(doc, sheet);
    doc.end();
  });
}
