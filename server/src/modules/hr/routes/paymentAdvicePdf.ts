/**
 * Salary-advice pack — GET /export/payment-advice/:runId  (D-#591).
 *
 * Produces, from a LOCKED run, the documents the school currently assembles by hand in
 * a spreadsheet and a Word template: for each bank channel a covering letter to the
 * manager of the school's bank, followed by the advice sheet it refers to, then the
 * cash list the office works from. The school's own June 2026 pack is the layout being
 * reproduced, down to the "Payment Info" column and the total in words.
 *
 * TWO SHEETS, NOT ONE, because the bank needs two different instructions: an internal
 * transfer between accounts at the same bank needs no bank/branch/routing columns, and
 * a BEFTN transfer cannot be issued without them.
 *
 * BLOCKED ROWS ARE PRINTED, in their own short section under each sheet, never dropped.
 * A person missing from an advice sheet is a person who does not get paid that month,
 * and the failure is silent unless the document says so.
 *
 * GATE — `payroll:manage`, the same permission as the payment export, re-asserted here
 * because a route is a second front door. Audited: this names everyone and their
 * account numbers.
 */
import PDFDocument from "pdfkit";
import * as path from "path";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { callerHasPermission, type PaymentChannel } from "@scd/shared";
import { mixedText, mixedTextInBox } from "../../../routes/pdfRenderer";
import { buildContext } from "../../../context";
import { paymentAdvice, type AdviceGroup, type PaymentAdvice } from "../services/PaymentAdviceService";
import { takaFigure, takaInWords } from "../services/takaWords";
import { PayrollError } from "../services/payrollMath";
import { writeAudit } from "../../platform/services/AuditService";

const FONT_PATH = path.resolve(__dirname, "../../../../assets/fonts/NotoSansBengali-Regular.ttf");

export const paymentAdvicePdfRouter: Router = createRouter();

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-06" → "June 2026", the sheet's own title wording. */
export function monthTitle(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  return `${MONTHS_EN[Number(m) - 1]} ${y}`;
}

/** "2026-07-01" → "01-07-2026", the letter's own date format. */
export function letterDateText(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${d}-${m}-${y}`;
}

/** What each channel's letter and sheet are called. */
const CHANNEL_TITLE: Record<PaymentChannel, string> = {
  internal: "Teachers/Admin Salary Advice Sheet",
  beftn: "Teachers/Admin Salary Advice Sheet (BEFTN)",
  bkash: "Teachers/Admin Salary — bKash",
  cash: "Teachers/Admin Salary — Cash",
};

/** The subject line of the covering letter, per channel. */
const CHANNEL_SUBJECT: Record<PaymentChannel, string> = {
  internal: "Proposal for Online Salary Disbursement for Teachers and Admin.",
  beftn: "Proposal for Online Salary Disbursement for Teachers and Admin by BEFTN.",
  bkash: "",
  cash: "",
};

paymentAdvicePdfRouter.get("/:runId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  if (!callerHasPermission(ctx.auth, "payroll:manage")) {
    res.status(403).json({ error: "বেতন-তালিকা রপ্তানি অফিস/অধ্যক্ষের কাজ" });
    return;
  }

  let advice: PaymentAdvice;
  try {
    advice = await paymentAdvice(req.params.runId);
  } catch (err: unknown) {
    const known = err instanceof PayrollError;
    res.status(known ? 400 : 500).json({ error: known ? err.message : "Advice failed" });
    return;
  }

  // The letterhead and the school's own bank are printed on a document that goes to a
  // bank over the school's name. Refuse rather than send a letter with blanks in it.
  const p = advice.policy;
  const missing = [
    !p.employerNameBn.trim() && !p.signatoryName.trim() ? "প্রতিষ্ঠানের নাম" : "",
    !p.orgAddress.trim() ? "ঠিকানা" : "",
    !p.schoolBankName.trim() ? "স্কুলের ব্যাংকের নাম" : "",
    !p.schoolAccountNo.trim() ? "স্কুলের হিসাব নম্বর" : "",
  ].filter(Boolean);
  if (missing.length > 0) {
    res.status(400).json({
      error: `চিঠির তথ্য নির্ধারিত নেই (${missing.join(", ")}) — এইচআর নীতিমালা থেকে একবার লিখে দিন`,
    });
    return;
  }

  try {
    const pdf = await renderAdvicePack(advice);
    await writeAudit({
      eventKind: "PAYROLL_PAYMENT_EXPORTED",
      actorId: ctx.auth.userId,
      targetId: req.params.runId,
      targetKind: "PayrollRun",
      meta: {
        format: "advice-pdf",
        monthKey: advice.monthKey,
        groups: advice.groups.map((g) => ({ channel: g.channel, rows: g.rows.length, total: g.total })),
      },
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="salary-advice-${advice.monthKey}.pdf"`);
    res.setHeader("Content-Length", pdf.byteLength);
    res.send(pdf);
  } catch (err) {
    console.error(`Advice PDF failed for ${req.params.runId}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const GREEN = "#3F6C45";

/** Padding above and below the text in a table cell. */
export const CELL_PAD = 5;

/**
 * A row is as tall as its tallest cell needs, never shorter than 20pt (D-#623).
 *
 * Exported so the rule is tested directly rather than through a rendered page: the
 * failure it prevents — a wrapped second line drawn outside its own border, on top of
 * the row beneath — is invisible to any assertion about the PDF as a whole. It was
 * found by the owner reading his own August pack, where one teacher's name sat across
 * the next teacher's.
 */
export function rowHeightFor(measuredHeights: number[], pad: number = CELL_PAD): number {
  const tallest = Math.max(...measuredHeights, 10);
  return Math.max(20, Math.ceil(tallest) + pad * 2);
}

/**
 * Scale a hand-laid-out column set to the printable width (D-#599).
 *
 * The widths are taken from the school's own Word template and total 598pt. An A4 page
 * with 48pt margins gives 499.3pt. Nothing complained: pdfkit drew the cells exactly
 * where it was told, off the edge of the paper, and the pack the owner downloaded had
 * its last column — the staff member's NAME, on all three sheets — severed. Proportions
 * are what the template is really specifying, so keep those and fit the page.
 *
 * Exported for the test: the arithmetic is the fix, so the test has to run THIS, not a
 * copy of it that agrees with itself.
 */
export function fitColumns<T extends { w: number }>(cols: T[], width: number): T[] {
  const total = cols.reduce((sum, c) => sum + c.w, 0);
  if (total <= 0) return cols;
  const scale = width / total;
  return cols.map((c) => ({ ...c, w: c.w * scale }));
}

export async function renderAdvicePack(advice: PaymentAdvice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      margin: 48,
      size: "A4",
      info: { Title: `Salary advice ${advice.monthKey}`, Creator: "SCD Hub" },
    });
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("NotoSansBengali", FONT_PATH);
    doc.font("NotoSansBengali");

    let first = true;
    for (const g of advice.groups) {
      // Nothing payable and nothing blocked = the channel is not in use this month.
      if (g.rows.length === 0 && g.blocked.length === 0) continue;

      // A covering letter is an INSTRUCTION to move money, signed in the school's name.
      // With nothing payable on the channel there is nothing to instruct, and the first
      // cut still wrote one: the owner's August pack carried a letter to the branch
      // manager asking him to "arrange payment Tk. 0/- (Zero Only)" because the only two
      // BEFTN staff were blocked for a missing routing number. The SHEET still prints —
      // it is the worklist naming who cannot be paid and why — but no letter (D-#598).
      const bankChannel =
        (g.channel === "internal" || g.channel === "beftn") && g.rows.length > 0;
      if (bankChannel) {
        if (!first) doc.addPage();
        drawLetter(doc, advice, g);
        first = false;
        doc.addPage();
      } else {
        if (!first) doc.addPage();
        first = false;
      }
      drawSheet(doc, advice, g);
    }

    // An empty run still produces a page, rather than a zero-byte file the operator
    // cannot tell apart from a failure.
    if (first) {
      letterhead(doc, advice);
      doc.moveDown(2);
      mixedText(doc, `No payable lines in ${monthTitle(advice.monthKey)}.`, { align: "center" });
    }

    doc.end();
  });
}

/** The school's letterhead, repeated on every page as the Word template has it. */
function letterhead(doc: PDFKit.PDFDocument, advice: PaymentAdvice): void {
  const p = advice.policy;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.fontSize(18);
  mixedText(doc, p.employerNameBn.trim() || "School for Community Development", {
    width,
    align: "center",
  });
  if (p.orgRegistrationNo.trim()) {
    doc.fontSize(8);
    mixedText(doc, `(Govt. Registration No. ${p.orgRegistrationNo})`, { width, align: "center" });
  }
  doc.moveDown(1.2);
  doc.fontSize(10);
}

/** The footer address block, as on the school's own letters. */
function footer(doc: PDFKit.PDFDocument, advice: PaymentAdvice): void {
  const p = advice.policy;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const y = doc.page.height - doc.page.margins.bottom - 26;
  doc.save();
  doc.moveTo(doc.page.margins.left, y - 6).lineTo(doc.page.margins.left + width, y - 6).lineWidth(0.5).stroke("#999999");
  doc.fontSize(8).fillColor("#333333");
  // mixedTextInBox, not doc.text (D-#600). Raw text draws in whatever font is current,
  // and letterhead() ends on the Bangla school name — so the Bengali face was left
  // active and this block's plain-ASCII address, phone and email came out as a row of
  // .notdef boxes on every page of the pack. The font has to be chosen per script run,
  // which is exactly what this helper is for.
  mixedTextInBox(doc, `Address: ${p.orgAddress}`, doc.page.margins.left, y, width, {
    align: "center",
  });
  const contact = [p.orgPhone && `Phone: ${p.orgPhone}`, p.orgEmail && `Email: ${p.orgEmail}`]
    .filter(Boolean)
    .join("      ");
  if (contact) {
    mixedTextInBox(doc, contact, doc.page.margins.left, y + 10, width, { align: "center" });
  }
  doc.restore();
}

/** The covering letter for one bank channel. */
function drawLetter(doc: PDFKit.PDFDocument, advice: PaymentAdvice, g: AdviceGroup): void {
  const p = advice.policy;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  letterhead(doc, advice);

  doc.fontSize(10);
  mixedText(doc, `Date: ${letterDateText(advice.letterDate)}`, { width });
  doc.moveDown(1.2);
  mixedText(doc, "To", { width });
  mixedText(doc, "The Manager", { width });
  mixedText(doc, p.schoolBankName, { width });
  if (p.schoolBankBranch.trim()) mixedText(doc, p.schoolBankBranch, { width });
  doc.moveDown(1);

  mixedText(doc, `Subject: ${CHANNEL_SUBJECT[g.channel]}`, { width });
  doc.moveDown(1);
  mixedText(doc, "Dear Muhtaram,", { width });
  doc.moveDown(0.5);

  mixedText(
    doc,
    `We “${p.employerNameBn.trim() || "School for Community Development"}” are clients of your bank. ` +
      `Our bearing account number ${p.schoolAccountNo}. Requesting you to arrange payment ` +
      `Tk. ${takaFigure(g.total)}/- (${takaInWords(g.total)}) for our payable Teachers salary payment ` +
      `online transfer as per attached Salary Advice Sheet - ${monthTitle(advice.monthKey)}.`,
    { width, align: "justify", lineGap: 1.5 },
  );
  doc.moveDown(1);
  mixedText(doc, "We anticipate your full cooperation in this regard.", { width });
  doc.moveDown(1.5);
  mixedText(doc, "Ma’assalamah,", { width });
  mixedText(doc, p.employerNameBn.trim() || "School for Community Development", { width });

  footer(doc, advice);
}

/** The advice sheet: a bordered table with a total row, per the school's layout. */
function drawSheet(doc: PDFKit.PDFDocument, advice: PaymentAdvice, g: AdviceGroup): void {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  letterhead(doc, advice);

  doc.fontSize(11);
  mixedText(doc, `${CHANNEL_TITLE[g.channel]} - ${monthTitle(advice.monthKey)}`, {
    width,
    align: "center",
  });
  doc.moveDown(0.8);

  const beftn = g.channel === "beftn";
  const rawCols = beftn
    ? [
        { key: "sl", label: "Sl", w: 26 },
        { key: "bankName", label: "Bank name", w: 92 },
        { key: "bankBranch", label: "Branch", w: 78 },
        { key: "account", label: "Account No", w: 104 },
        { key: "amount", label: "Amount", w: 54 },
        { key: "info", label: "Payment Info", w: 82 },
        { key: "routingNo", label: "Routing No", w: 66 },
        { key: "name", label: "Name", w: 96 },
      ]
    : [
        { key: "sl", label: "SL.", w: 30 },
        { key: "accountName", label: "Account Name", w: 150 },
        { key: "account", label: "Account No", w: 130 },
        { key: "amount", label: "Amount", w: 66 },
        { key: "info", label: "Payment Info", w: 110 },
        { key: "name", label: "Teachers/Admin", w: 112 },
      ];

  const cols = fitColumns(rawCols, width);

  const startX = doc.page.margins.left;
  doc.fontSize(8);

  const drawRow = (
    cells: string[],
    opts: { header?: boolean; bold?: boolean } = {},
  ): void => {
    /**
     * THE ROW GROWS TO ITS TALLEST CELL (D-#623).
     *
     * The height was fixed at 20pt while a cell that did not fit wrapped to 21.2pt, so
     * the second line was drawn OUTSIDE its own border and landed on top of the row
     * below: on the owner's August pack "Mahmudur Rahman Tazkir" sat across the next
     * teacher's name, and two bank names did the same. `lineBreak: false, ellipsis`
     * was being passed and did not take effect through the per-script writer.
     *
     * Truncating would have been the smaller change and the wrong one. This is a payment
     * instruction: a bank matches on the full name, and "Mahmudur Rahman Tazk…" is not a
     * name. D-#599 made the collision likely by scaling the columns 17% narrower to fit
     * the page — correct in itself, but it left the fixed height behind.
     */
    const pad = 5;
    const needed = Math.max(
      ...cells.map((text, i) => (text ? doc.heightOfString(text, { width: cols[i].w - 6 }) : 0)),
      10,
    );
    const height = Math.max(20, Math.ceil(needed) + pad * 2);

    // Keep the table off the footer.
    if (doc.y + height > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage();
      letterhead(doc, advice);
      doc.fontSize(8);
    }
    const y = doc.y;
    let x = startX;
    cells.forEach((text, i) => {
      const w = cols[i].w;
      if (opts.header) {
        doc.save().rect(x, y, w, height).fill(GREEN).restore();
      }
      doc.save().rect(x, y, w, height).lineWidth(0.5).stroke("#999999").restore();
      doc.fillColor(opts.header ? "#FFFFFF" : "#000000");
      const numeric = cols[i].key === "amount";
      // Per-script fonts here too (D-#600). Cells were drawn with raw doc.text, so a
      // cell inherited whichever font the previous mixedText call left behind. Every
      // name on this pack in the owner's test was English, which is the only reason it
      // looked fine — the real roster is Bangla, and those names would have printed as
      // boxes on the sheet the bank is asked to pay from.
      //
      // Wrapping is now ALLOWED, because the row was measured to hold it.
      mixedTextInBox(doc, text, x + 3, y + pad, w - 6, { align: numeric ? "right" : "left" });
      x += w;
    });
    doc.fillColor("#000000");
    doc.y = y + height;
  };

  drawRow(cols.map((c) => c.label), { header: true });

  g.rows.forEach((r, i) => {
    const cells = cols.map((c) => {
      switch (c.key) {
        case "sl": return String(i + 1);
        case "accountName": return r.accountName ?? r.name;
        case "account": return r.account ?? "";
        case "amount": return takaFigure(r.amount);
        case "info": return advice.paymentInfo;
        case "routingNo": return r.routingNo ?? "";
        case "bankName": return r.bankName ?? "";
        case "bankBranch": return r.bankBranch ?? "";
        default: return r.name;
      }
    });
    drawRow(cells);
  });

  // The total row: blank cells, then "Total Amount" beside the figure, as the school
  // has it — the number the covering letter quotes.
  const totalCells = cols.map((c) => {
    if (c.key === "amount") return takaFigure(g.total);
    if (c.key === "account" || c.key === "bankBranch") return "Total Amount";
    return "";
  });
  drawRow(totalCells);

  // Anyone this sheet CANNOT pay, said out loud on the document itself.
  if (g.blocked.length > 0) {
    // Back to the left margin first. Every cell was drawn at an explicit x, so doc.x is
    // still parked inside the LAST column — and text that inherits it starts three
    // quarters of the way across the page and runs off the edge, which is where the
    // owner's "Not included" list went: clipped mid-name, on the one section whose whole
    // job is to be read (D-#599).
    doc.x = startX;
    doc.moveDown(1);
    doc.fontSize(9).fillColor("#B3261E");
    mixedText(doc, "Not included — details incomplete:", { width });
    doc.fillColor("#000000").fontSize(8);
    for (const b of g.blocked) {
      mixedText(doc, `• ${b.name} — ${b.blockedReason} (Tk. ${takaFigure(b.amount)})`, { width });
    }
  }

  footer(doc, advice);
}
