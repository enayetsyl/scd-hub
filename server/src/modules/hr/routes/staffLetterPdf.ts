/**
 * Staff-letter PDF renderer — GET /pdf/staff-letter/:id  (SH-1, D-#542).
 *
 * Renders a letter ENTIRELY from `StaffLetter.snapshot`. The live `StaffProfile` is
 * never read here, and that is the point: a letter the person signed in January must
 * still print identically after their address, designation or salary is edited in June.
 * If you find yourself wanting a field that is not on the snapshot, add it to the
 * snapshot at issue time — do not join the profile.
 *
 * The letter body is English (the Word template is), but the staff member's Bangla name
 * and any Bangla `extraText` render through `mixedText`, which switches between the
 * bundled Noto-Bengali subset and Helvetica per script run.
 *
 * GATE — `staff:manage`, the same permission that reads the staff record itself. No new
 * permission: a letter contains strictly less than the profile it was built from.
 */
import PDFDocument from "pdfkit";
import * as path from "path";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { callerHasPermission } from "@scd/shared";
import { mixedText } from "../../../routes/pdfRenderer";
import { buildContext } from "../../../context";
import { StaffLetter, type IStaffLetter, type ILetterSnapshot } from "../models/StaffLetter";

const FONT_PATH = path.resolve(__dirname, "../../../../assets/fonts/NotoSansBengali-Regular.ttf");

export const staffLetterPdfRouter: Router = createRouter();

/** "2026-08-25" → "25 August, 2026" — the template's own date format. */
const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export function longDate(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  const monthIdx = Number(m[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return dateKey;
  return `${Number(m[3])} ${MONTHS_EN[monthIdx]}, ${m[1]}`;
}

/** Whole-taka with thousands separators, for clause 1. */
export function taka(n: number): string {
  return n.toLocaleString("en-US");
}

staffLetterPdfRouter.get("/:id", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth || !callerHasPermission(ctx.auth, "staff:manage")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const letter = (await StaffLetter.findById(req.params.id).lean()) as IStaffLetter | null;
  if (!letter) {
    res.status(404).json({ error: "Letter not found" });
    return;
  }

  // Isolate the render: a renderer/font failure returns 500 rather than rejecting out
  // of the async handler and taking the Node process down (the Express 4 quirk).
  try {
    const pdfBuffer = await renderLetterToPdf(letter);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${letter.refNo.replace(/\//g, "-")}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.byteLength);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(`Letter PDF render failed for ${req.params.id}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * The numbered clauses, built from the snapshot.
 *
 * Clause 1 and clause 2 are MUTUALLY EXCLUSIVE (D-#542) — the source .docx carries
 * both, which is a copy-paste artefact rather than a document anyone can sign, so
 * exactly one of them is emitted here. Numbering is generated from the emitted list,
 * so dropping one never leaves a gap.
 */
/**
 * Start a new page if `needed` points of vertical space are not left on this one.
 *
 * Exported for the test: the arithmetic is what keeps a signature block whole, and it
 * is easier to assert on than a rendered PDF.
 */
export function needsNewPage(y: number, pageHeight: number, bottomMargin: number, needed: number): boolean {
  return y + needed > pageHeight - bottomMargin;
}

function keepTogether(doc: PDFKit.PDFDocument, needed: number): void {
  if (needsNewPage(doc.y, doc.page.height, doc.page.margins.bottom, needed)) doc.addPage();
}

export function buildClauses(s: ILetterSnapshot): string[] {
  const clauses: string[] = [];

  if (s.salaryMode === "paid") {
    clauses.push(
      `Your monthly remuneration will be Tk. ${taka(s.monthlySalary ?? 0)}. Income and other taxes ` +
        `arising out of the above earnings shall be borne by you. Increments and promotions are not ` +
        `automatically granted but shall be at the discretion of SCD management.`,
    );
  } else {
    clauses.push(
      `Remuneration: As you agreed, you would serve as an honorary teacher, insha'Allah. As such ` +
        `there would be no remuneration for you.`,
    );
  }

  clauses.push(
    `Conditions: You will be bound by the terms and conditions, policies, rules and regulations of ` +
      `SCD that are currently enforced and any new terms and conditions, policies, rules and ` +
      `regulations that may be effective in the future.`,
  );

  clauses.push(
    `Office Hours: Your working hours will be ${s.weeklyHours ?? "25 (5*5)"} hours a week divided into ` +
      `5 working days a week, which include both teaching and non-teaching tasks.`,
  );

  clauses.push(`Bonus, provident fund & gratuity: None.`);

  // The template says "Your duties as a principal" on a Junior Teacher's letter. The
  // real designation is snapshotted precisely so this clause names the actual post.
  clauses.push(
    `Job Description: Your duties as ${s.designation} will be as per the attached job description, ` +
      `which is subject to future revision if necessary. Further, you may have to do other work as ` +
      `assigned by your supervisor or SCD management.`,
  );

  clauses.push(
    `Leave: Your leave will be governed by the leave rules of SCD — a total of ${s.annualLeaveDays} days ` +
      `including sick leave and casual leave. Absence on medical grounds must be reported on the same ` +
      `day to your supervisor. A medical certificate from a registered medical practitioner must be ` +
      `produced on the 3rd day if you are absent for 3 days or more on medical grounds. Leave of 5 ` +
      `working days or more must be applied for at least two weeks in advance; four days or fewer, at ` +
      `least one week in advance. Unauthorized absence from duty will be treated as leave without pay. ` +
      `Teachers and staff are entitled to government and national holidays as per the academic calendar.`,
  );

  clauses.push(
    `Termination: No prior notice from either side is a prerequisite to terminate or resign while on ` +
      `probation. One month's prior notice from either side is a prerequisite once regularized. For ` +
      `gross misconduct, service may be dismissed at any time without notice, pay or other formalities.`,
  );

  clauses.push(
    `Secrecy and confidentiality: Except with the written consent of the School, you will — not only ` +
      `whilst you remain employed but always thereafter — maintain secrecy of any information of a ` +
      `confidential nature which comes into your possession during your employment.`,
  );

  clauses.push(
    `Interest of the school: You will be expected to use your best endeavours to promote the interest ` +
      `of the school for the satisfaction of Allah Subhanahu wa Ta'ala only, and to carry out all ` +
      `reasonable orders and instructions made by or on behalf of the school.`,
  );

  clauses.push(
    `Miscellaneous: Cell phones must be switched off or put on silent in the classroom or a meeting, ` +
      `and no calls answered there. You are required to conduct and dress yourself appropriately ` +
      `according to Islamic values, consistent with the proper performance of your duties.`,
  );

  return clauses;
}

/**
 * The service certificate (D-#583).
 *
 * It said: "…served the School for Community Development as X. This certificate is
 * issued on request." Three things wrong with that for the person holding it. It is
 * PAST TENSE for someone still teaching, so it reads as a leaving certificate. It
 * carries no DATES, and a period of service is the one fact a bank or a next employer
 * actually needs. And "issued on request" says nothing at all.
 *
 * So the tense follows `serviceTo`: absent means still serving. Dates are printed when
 * the profile has them, and the sentence still stands when it does not — a certificate
 * with a missing joining date should be weaker, not unissuable.
 */
export function certificateBody(s: ILetterSnapshot): string {
  const who = `${s.staffName} (ID ${s.schoolId})`;
  const school = "the School for Community Development (SCD)";
  const from = s.serviceFrom ? longDate(s.serviceFrom) : null;

  if (s.serviceTo) {
    const period = from
      ? ` from ${from} to ${longDate(s.serviceTo)}`
      : ` until ${longDate(s.serviceTo)}`;
    return (
      `This is to certify that ${who} served ${school} as ${s.designation}${period}. ` +
      `We wish them every success in their future endeavours.`
    );
  }

  const since = from ? ` since ${from}` : "";
  return (
    `This is to certify that ${who} has been serving ${school} as ${s.designation}${since}, ` +
    `and remains in the service of the school as at ${longDate(s.letterDate)}.`
  );
}

/** The confirmation letter is short — it restates the terms rather than re-issuing them. */
export function confirmationBody(s: ILetterSnapshot): string {
  const salaryLine =
    s.salaryMode === "paid" && s.monthlySalary
      ? ` Your monthly remuneration remains Tk. ${taka(s.monthlySalary)}.`
      : "";
  return (
    `With reference to your service as ${s.designation} at the School for Community Development (SCD), ` +
    `the management is pleased to confirm your employment with effect from ${longDate(s.confirmationDate ?? "")}, ` +
    `insha'Allah.${salaryLine} All other terms and conditions of your appointment remain unchanged, ` +
    `including your entitlement to a total of ${s.annualLeaveDays} days of leave per year, inclusive of ` +
    `sick and casual leave.`
  );
}

async function renderLetterToPdf(letter: IStaffLetter): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const s = letter.snapshot;

    const doc = new PDFDocument({
      margin: 56,
      size: "A4",
      info: {
        Title: `${letter.kind} — ${s.staffName} (${letter.refNo})`,
        Creator: "SCD Hub",
      },
    });
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("NotoSansBengali", FONT_PATH);
    doc.font("NotoSansBengali");

    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // A voided letter must SAY so on its face — someone holding the paper copy needs
    // to know it was superseded (D-#542).
    if (letter.status === "void") {
      doc.fontSize(9).fillColor("#B3261E");
      mixedText(doc, `VOID — superseded${letter.voidReason ? `: ${letter.voidReason}` : ""}`, {
        align: "right",
      });
      doc.fillColor("#000000");
      doc.moveDown(0.3);
    }

    // Ref / date line
    doc.fontSize(10);
    mixedText(doc, `Ref: ${letter.refNo}`, { continued: false });
    doc.moveUp(1);
    mixedText(doc, `Date: ${longDate(s.letterDate)}`, { align: "right" });
    doc.moveDown(1.2);

    // A service certificate is written to be SHOWN — to a bank, a landlord, the next
    // employer. Stamping it "STRICTLY CONFIDENTIAL" told the holder not to use it for
    // the only purpose it has (D-#583); that header belongs on the letters that carry
    // salary terms. The certificate is addressed to whoever ends up reading it.
    const isCertificate = letter.kind === "service_certificate";
    doc.fontSize(11);
    mixedText(doc, isCertificate ? "TO WHOM IT MAY CONCERN" : "STRICTLY CONFIDENTIAL");
    doc.moveDown(1);

    doc.fontSize(10);
    if (!isCertificate) {
      // Addressee
      mixedText(doc, "To");
      mixedText(doc, s.staffName);
      if (s.staffNameBn) mixedText(doc, s.staffNameBn);
      if (s.address) mixedText(doc, s.address, { width });
      doc.moveDown(1);

      mixedText(doc, "Assalaamu 'Alaikum,");
      doc.moveDown(0.8);
    }

    if (letter.kind === "confirmation") {
      mixedText(doc, confirmationBody(s), { width, align: "justify", lineGap: 1.5 });
      doc.moveDown(0.8);
    } else if (isCertificate) {
      mixedText(doc, certificateBody(s), { width, align: "justify", lineGap: 1.5 });
      doc.moveDown(0.8);
    } else {
      mixedText(
        doc,
        `With reference to your application and subsequent interview for the post of ${s.designation} ` +
          `in the School for Community Development (SCD), the management is pleased to appoint you as ` +
          `${s.designation}, insha'Allah, effective from ${s.effectiveFrom}, under the following terms ` +
          `and conditions:`,
        { width, align: "justify", lineGap: 1.5 },
      );
      doc.moveDown(0.6);

      const clauses = buildClauses(s);
      clauses.forEach((clause, i) => {
        mixedText(doc, `${i + 1}. ${clause}`, { width, align: "justify", lineGap: 1.5 });
        doc.moveDown(0.45);
      });
    }

    // The owner's optional extra paragraph — part of the snapshot, printed as written.
    if (letter.extraText) {
      doc.moveDown(0.4);
      mixedText(doc, letter.extraText, { width, align: "justify", lineGap: 1.5 });
      doc.moveDown(0.6);
    }

    if (letter.kind === "appointment") {
      mixedText(
        doc,
        `If the aforementioned terms and conditions are acceptable to you, please sign the duplicate of ` +
          `this letter in confirmation of your acceptance of the offer and return the same to us.`,
        { width, align: "justify", lineGap: 1.5 },
      );
      doc.moveDown(0.6);
      mixedText(
        doc,
        `We take this opportunity to welcome you to the School for Community Development and place our ` +
          `supplication to Allah to grant you a successful career with us.`,
        { width, align: "justify", lineGap: 1.5 },
      );
      doc.moveDown(1.4);
    } else {
      doc.moveDown(1.2);
    }

    // Signature block — kept whole (D-#583).
    //
    // pdfkit breaks wherever the text happens to reach the bottom margin, and on a
    // full-page appointment letter that landed mid-block: the signatory's name at the
    // foot of page 2 and his title at the head of page 3, or the acceptance line
    // orphaned from the signature rule it belongs to. A signature split across a page
    // is not a formatting nit on a document someone signs and files.
    keepTogether(doc, letter.kind === "appointment" ? 190 : 70);
    mixedText(doc, s.signatoryName);
    mixedText(doc, s.signatoryTitle);
    mixedText(doc, "School for Community Development");

    if (letter.kind === "appointment") {
      doc.moveDown(1.6);
      doc.fontSize(9);
      mixedText(
        doc,
        `I have read and understood the letter of appointment and willingly agree to accept the terms ` +
          `and conditions, as offered.`,
        { width, align: "justify" },
      );
      doc.moveDown(1.8);
      mixedText(doc, "..............................................                    ..............................");
      mixedText(doc, "Signature                                                                          Date");
    }

    doc.end();
  });
}
