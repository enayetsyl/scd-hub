/**
 * Staff-letter PDF renderer — GET /pdf/staff-letter/:id  (SH-1, D-#542).
 *
 * Renders a letter ENTIRELY from `StaffLetter.snapshot`. The live `StaffProfile` is
 * never read here, and that is the point: a letter the person signed in January must
 * still print identically after their address, designation or salary is edited in June.
 * If you find yourself wanting a field that is not on the snapshot, add it to the
 * snapshot at issue time — do not join the profile.
 *
 * Three of the four kinds are English (their Word templates are), and the staff member's
 * Bangla name or a Bangla `extraText` render through `mixedText`, which switches between
 * the bundled Noto-Bengali subset and Helvetica per script run. The fourth —
 * `support_contract` — is Bangla throughout and is a different DOCUMENT rather than a
 * translation (two parties, a duties schedule, both signatures), so it has its own
 * renderer below instead of a flag threaded through this one (D-#586).
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
import { bnDigits, longDateBn, takaBn } from "../services/supportContract";

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

/** A clause: a numbered paragraph, optionally with lettered sub-paragraphs. */
export interface Clause {
  text: string;
  subs?: string[];
}

/** "Three", "Six" — the template spells the probation length out, in quotes. */
const MONTH_WORDS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten", "Eleven", "Twelve",
];
export function monthsWord(n: number): string {
  return MONTH_WORDS[n] ?? String(n);
}

/**
 * The appointment letter's numbered clauses, following the school's CURRENT Word
 * template (D-#586) rather than the older one SH-1 was built from.
 *
 * What changed, and why each matters:
 *   1. PROBATION IS CLAUSE 1 and it was missing entirely. The letter every teacher
 *      signs opens by saying how long probation runs and that service is regularized
 *      on completing it — and the app, which settles held probation leave at exactly
 *      that moment (D-#540), was printing a letter that never mentioned it.
 *   2. Sub-clauses are real. Increments sit under Remuneration; the medical-certificate
 *      and notice-period rules sit under Leave; phone and dress sit under Miscellaneous.
 *      Flattening them into one paragraph is how a rule stops being findable.
 *   3. Holidays is its own clause, not a sentence buried at the end of Leave.
 *   4. Termination names the three gross-misconduct grounds and says that dismissal on
 *      those grounds forfeits the release letter and testimonial. That last sentence is
 *      a consequence a signatory has to have been told about.
 *   5. Escalation is named: absence is reported to the supervisor/Vice Principal, and
 *      the medical certificate goes to the Principal.
 */
export function buildClauses(s: ILetterSnapshot): Clause[] {
  const clauses: Clause[] = [];

  // 1. Probation. Zero months = a school that does not use probation, and the clause is
  //    then omitted rather than printed as "Zero months".
  const months = s.probationMonths ?? 0;
  if (months > 0) {
    clauses.push({
      text:
        `Probation: You will be on probation of “${monthsWord(months)}” month${months === 1 ? "" : "s"} ` +
        `from the date of your joining. On successful completion of the probationary period, your ` +
        `service will be regularized insha’Allah.`,
    });
  }

  // 2. Remuneration — paid and honorary remain MUTUALLY EXCLUSIVE (D-#542).
  if (s.salaryMode === "paid") {
    clauses.push({
      text:
        `Remuneration: Your monthly remuneration will be Tk. ${taka(s.monthlySalary ?? 0)}/-. Income and ` +
        `other taxes arising out of the above earnings shall be borne by you.`,
      subs: [
        `Increments (and promotions) are not automatically granted but shall be at the discretion of ` +
          `SCD management.`,
      ],
    });
  } else {
    clauses.push({
      text:
        `Remuneration: As you agreed, you would serve as an honorary teacher, insha’Allah. As such ` +
        `there would be no remuneration for you.`,
    });
  }

  clauses.push({
    text:
      `Conditions: You will be bound by the terms and conditions, policies, rules and regulations of ` +
      `SCD that are currently enforced and any new terms and conditions, policies, rules and ` +
      `regulations that may be effective in the future.`,
  });

  clauses.push({
    text:
      `Office Hours: Your working hours will be ${s.weeklyHours ?? "25 (5*5)"} hours a week, which ` +
      `include both teaching and non-teaching tasks.`,
  });

  clauses.push({ text: `Bonus, provident fund & gratuity: None.` });

  // The old template said "your duties as a principal" on a Junior Teacher's letter.
  // The designation is snapshotted precisely so this clause names the actual post.
  clauses.push({
    text:
      `Job Description: Your duties as ${s.designation} will be as per the attached job description, ` +
      `which is subject to future revision if necessary. Further, you may have to do other work as ` +
      `assigned by your supervisor or SCD management.`,
  });

  clauses.push({
    text:
      `Leave: Your leave will be governed by the leave rules of SCD (a total of ${s.annualLeaveDays} days ` +
      `including sick leave and casual leave).`,
    subs: [
      `Absence on medical grounds must be reported on the same day to your supervisor / Vice Principal. ` +
        `A medical certificate, issued by a registered medical practitioner, has to be produced on the ` +
        `3rd day to the Principal if you are absent for 3 days or more on medical grounds.`,
      `An employee willing to take leave of 5 working days or more must apply for it at least two weeks ` +
        `in advance; for four days or less, at least one week in advance.`,
      `Unauthorized absence from duty will be treated as leave without pay.`,
    ],
  });

  clauses.push({
    text:
      `Holidays: The teachers and staff of SCD are entitled to enjoy the government / national holidays ` +
      `as per the government and academic calendar of SCD.`,
  });

  clauses.push({
    text:
      `Termination: No prior notice from either side is a prerequisite to terminate or resign from the ` +
      `job while on probation. One month’s prior notice from either side is a prerequisite to terminate ` +
      `or resign from the job once regularized. For gross misconduct, your service may be dismissed at ` +
      `any time without any notice or pay or any other formalities. Gross misconduct includes, but is ` +
      `not limited to, the following:`,
    subs: [
      `Failure to Report in Time: this includes failure to be present on the stipulated date of ` +
        `returning to school after breaks, holidays, or the opening of the school term without a valid ` +
        `reason or prior approval. It also covers consistently arriving late to work or other ` +
        `scheduled activities.`,
      `Behavioural Issues: behaviour that reflects poorly on the individual’s integrity, honesty and ` +
        `professionalism, including but not limited to dishonesty, theft, fraud, breach of ` +
        `confidentiality, physical or mental harassment, or any actions towards students or colleagues ` +
        `that undermine trust within the organization.`,
      `Religious Extremism: promoting, endorsing or engaging in activities associated with radical or ` +
        `extreme religious views within the workplace, including any behaviour that incites hatred, ` +
        `discrimination or violence based on religious beliefs.`,
      `If your employment is terminated due to any of the aforementioned clauses, you will not be ` +
        `eligible to receive a Release Letter or Testimonial.`,
    ],
  });

  clauses.push({
    text:
      `Secrecy and confidentiality: Except with the written consent of the School, you will — not only ` +
      `whilst you remain employed but always thereafter — maintain secrecy of any information of a ` +
      `confidential nature which comes into your possession during your employment.`,
  });

  clauses.push({
    text:
      `Interest of the school: You will be expected to use your best endeavours to promote the interest ` +
      `of the school for the satisfaction of Allah Subhanahu wa Ta’ala only, and to carry out all ` +
      `reasonable orders and instructions made by or on behalf of the school.`,
  });

  clauses.push({
    text: `Miscellaneous: You shall be bound to abide by the following regulations:`,
    subs: [
      `Your cell phone must be switched off or put in silent mode when you are in the classroom or a ` +
        `meeting. Under no circumstances should you answer any phone call while you are in the ` +
        `classroom or a meeting.`,
      `You are required to conduct and dress yourself appropriately according to Islamic values, ` +
        `consistent with the proper performance of your duties.`,
    ],
  });

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

/**
 * The Bangla support-staff contract's eight numbered sections (D-#586).
 *
 * Returned as data rather than drawn inline so the wording is testable without
 * rendering a PDF — the same reason `buildClauses` is a pure function. §১ (identity)
 * and §৩ (duties) are drawn separately by the renderer because they are lists, not
 * paragraphs.
 */
export interface ContractSection {
  heading: string;
  lines: string[];
}

export function buildContractSections(s: ILetterSnapshot): ContractSection[] {
  const pay: string[] = [`মাসিক নির্ধারিত বেতন: ${takaBn(s.monthlySalary ?? 0)} মাত্র।`];
  if (s.foodAllowance && s.foodAllowance > 0) {
    pay.push(`খাবার বাবদ: ${takaBn(s.foodAllowance)} মাত্র।`);
  }
  pay.push("কোনো উৎসব বা বার্ষিক বোনাস প্রযোজ্য নয়।");
  pay.push("বেতন প্রতি মাসের ১-৫ তারিখের মধ্যে নগদ বা ব্যাংক হিসাবের মাধ্যমে প্রদান করা হইবে।");

  const probation =
    s.probationMonths && s.probationMonths > 0
      ? [
          `যোগদানের তারিখ থেকে ${bnDigits(s.probationMonths)} (${bnDigits(s.probationMonths)}) মাস ` +
            `শিক্ষানবিশকাল হিসাবে গণ্য হইবে। এই সময়ের মধ্যে চুক্তিবহির্ভূত কিছু পরিলক্ষিত হইলে ` +
            `তাৎক্ষণিকভাবে চাকরিচ্যুত করা হইবে।`,
        ]
      : [];

  return [
    {
      heading: "২. চাকরির ধরন ও সময়কাল:",
      lines: [
        "এই চাকরিটি একটি চলমান ভিত্তিতে প্রদান করা হইল। তবে উভয় পক্ষের সম্মতিতে বা চুক্তিপত্রে " +
          "উল্লেখিত শর্ত লঙ্ঘন হইলে যে কোনো সময় এই চুক্তি বাতিলযোগ্য।",
      ],
    },
    {
      heading: "৪. বেতন ও সুবিধাদি:",
      lines: pay,
    },
    {
      heading: "৫. ছুটি ও অনুপস্থিতি:",
      lines: [
        "কর্মী প্রতি সপ্তাহে শুক্রবার ছুটি পাইবেন।",
        // The pool, not a per-contract figure: what the contract promises and what
        // আমার ছুটি shows must be the same number (owner's ruling, D-#586).
        `বাৎসরিক ${bnDigits(s.annualLeaveDays)} (${bnDigits(s.annualLeaveDays)}) দিন ছুটি ভোগ করিতে পারিবেন।`,
        "জরুরি প্রয়োজনে অতিরিক্ত ছুটির ক্ষেত্রে কর্তৃপক্ষের পূর্বানুমতি নিতে হইবে।",
        "অনুমতি ছাড়া অনুপস্থিত থাকিলে দৈনিক বেতন কর্তন এবং প্রয়োজনে ব্যবস্থা গ্রহণ করা হইবে।",
      ],
    },
    {
      heading: "৬. আচরণ ও গোপনীয়তা:",
      lines: [
        "কর্মীকে সদাচরণ, কর্তব্যনিষ্ঠা ও সততার সহিত দায়িত্ব পালন করিতে হইবে।",
        "প্রতিষ্ঠানের কোনো তথ্য, নথি বা অভ্যন্তরীণ বিষয় গোপন রাখিতে হইবে।",
      ],
    },
    {
      heading: "৭. অবসান / চুক্তি বাতিল:",
      lines: [
        "উভয় পক্ষ ১ (এক) মাসের পূর্ব নোটিশ প্রদানপূর্বক এই চুক্তি বাতিল করিতে পারিবে।",
        ...probation,
        "গুরুতর শৃঙ্খলাভঙ্গ, চুরি, অসদাচরণ বা কর্তৃপক্ষের নির্দেশ অমান্য করিলে চুক্তি তাৎক্ষণিকভাবে বাতিলযোগ্য।",
      ],
    },
    {
      heading: "৮. অন্যান্য:",
      lines: [
        "কর্মীর পরিচয়পত্র প্রদান করা হইবে এবং ডিউটির সময় তা পরিধান বাধ্যতামূলক।",
        "প্রয়োজনে এই চুক্তির শর্তাবলি ভবিষ্যতে আপডেট করা যাইতে পারে, যা উভয় পক্ষের আলোচনায় নির্ধারিত হইবে।",
        "এই চুক্তিপত্রটি উভয় পক্ষ পূর্ণ সদিচ্ছায় ও স্বজ্ঞানে পাঠ করিয়া সম্মত হইয়া স্বাক্ষর করিলাম।",
      ],
    },
  ];
}

/** The Bangla contract page. A different document from the English letters — two
 *  parties, a duties schedule, and BOTH signatures — so it gets its own renderer
 *  rather than a flag inside the other one. */
function renderContract(doc: PDFKit.PDFDocument, letter: IStaffLetter, width: number): void {
  const s = letter.snapshot;

  doc.fontSize(13);
  mixedText(doc, s.contractTitleBn ?? "নিয়োগ চুক্তিপত্র", { width, align: "center" });
  doc.moveDown(0.8);

  doc.fontSize(10);
  mixedText(doc, `চাকরিদানকারী প্রতিষ্ঠান: ${s.employerNameBn ?? ""}`, { width });
  mixedText(doc, `ঠিকানা: ${s.employerAddressBn ?? ""}`, { width });
  mixedText(doc, `রেফারেন্স: ${letter.refNo}`, { width });
  doc.moveDown(0.6);

  mixedText(
    doc,
    "এই চুক্তিপত্রটি প্রণয়ন করা হইল নিম্নবর্ণিত শর্ত ও বিধি অনুযায়ী, যা চাকরিদানকারী প্রতিষ্ঠান " +
      "এবং কর্মী উভয় পক্ষের সম্মতিতে কার্যকর হইতেছে:",
    { width, align: "justify", lineGap: 1.5 },
  );
  doc.moveDown(0.8);

  // §১ — identity
  mixedText(doc, "১. কর্মীর পরিচয়:", { width });
  const idRows: Array<[string, string | null | undefined]> = [
    ["নাম", s.staffNameBn || s.staffName],
    ["ঠিকানা (স্থায়ী)", s.permanentAddressBn],
    ["ঠিকানা (বর্তমান)", s.presentAddressBn],
    ["পদবি", s.designation],
    ["যোগদানের তারিখ", longDateBn(s.joiningDateBn)],
    ["যোগাযোগ", s.contactBn],
  ];
  for (const [label, value] of idRows) {
    if (!value) continue;
    mixedText(doc, `${label}: ${value}`, { width: width - 12, indent: 12 });
  }
  doc.moveDown(0.7);

  const sections = buildContractSections(s);

  // §২ first, then §৩ (hours + duties), then the rest — the contract's own order.
  const drawSection = (sec: ContractSection): void => {
    mixedText(doc, sec.heading, { width });
    for (const line of sec.lines) {
      mixedText(doc, `• ${line}`, { width: width - 12, indent: 12, align: "justify", lineGap: 1.5 });
    }
    doc.moveDown(0.7);
  };

  drawSection(sections[0]);

  mixedText(doc, "৩. কর্মঘণ্টা ও দায়িত্ব:", { width });
  if (s.workingHoursBn) {
    mixedText(doc, s.workingHoursBn, { width: width - 12, indent: 12, align: "justify", lineGap: 1.5 });
  }
  for (const duty of s.dutiesBn ?? []) {
    mixedText(doc, `• ${duty}`, { width: width - 12, indent: 12, align: "justify", lineGap: 1.5 });
  }
  doc.moveDown(0.7);

  for (const sec of sections.slice(1)) drawSection(sec);

  // The owner's optional extra paragraph, printed as written.
  if (letter.extraText) {
    mixedText(doc, letter.extraText, { width, align: "justify", lineGap: 1.5 });
    doc.moveDown(0.7);
  }

  // BOTH signatures — this is a contract, not a letter from the school.
  keepTogether(doc, 170);
  mixedText(doc, `তারিখ: ${longDateBn(s.letterDate)}`, { width });
  doc.moveDown(1.4);
  mixedText(doc, `কর্মীর নাম: ${s.employeeSignatureNameBn ?? s.staffName}`, { width });
  mixedText(doc, "কর্মীর স্বাক্ষর: ...........................................", { width });
  doc.moveDown(1.2);
  mixedText(doc, "কর্তৃপক্ষের পক্ষে:", { width });
  mixedText(doc, `নাম: ${s.signatoryName}`, { width });
  mixedText(doc, `পদবি: ${s.signatoryTitle}`, { width });
  mixedText(doc, "স্বাক্ষর ও সীল: ...........................................", { width });
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

    // The Bangla contract is a different DOCUMENT, not a variant of the letter: its own
    // header, its own body, and two signatures. It branches here, whole (D-#586).
    if (letter.kind === "support_contract") {
      renderContract(doc, letter, width);
      doc.end();
      return;
    }

    // A service certificate is written to be SHOWN — to a bank, a landlord, the next
    // employer. Stamping it "STRICTLY CONFIDENTIAL" told the holder not to use it for
    // the only purpose it has (D-#583); that header belongs on the letters that carry
    // salary terms. The certificate is addressed to whoever ends up reading it.
    const isCertificate = letter.kind === "service_certificate";
    doc.fontSize(11);
    // The heading NAMES the document, as the school's own template does. "STRICTLY
    // CONFIDENTIAL" was on all three, which told the holder of a certificate not to use
    // it for its only purpose and told the holder of an appointment letter nothing about
    // what they were holding (D-#583/#586).
    mixedText(
      doc,
      isCertificate
        ? "TO WHOM IT MAY CONCERN"
        : letter.kind === "confirmation"
          ? "CONFIRMATION OF EMPLOYMENT"
          : "APPOINTMENT LETTER",
    );
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
        mixedText(doc, `${i + 1}. ${clause.text}`, { width, align: "justify", lineGap: 1.5 });
        // Sub-clauses are indented and lettered, as the template has them: a rule that
        // is findable ("Leave, clause b") rather than a sentence inside a paragraph.
        (clause.subs ?? []).forEach((sub, j) => {
          doc.moveDown(0.2);
          mixedText(doc, `${String.fromCharCode(97 + j)}. ${sub}`, {
            width: width - 18,
            align: "justify",
            lineGap: 1.5,
            indent: 18,
          });
        });
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
