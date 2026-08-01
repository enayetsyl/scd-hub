/**
 * MonthlyReportSheetService (MR-7, prd-monthly-report §8) — the printable sheet.
 *
 * Builds MARKDOWN from the FROZEN snapshot and hands it to the existing pdfkit +
 * NotoSansBengali A4 engine (`routes/pdfRenderer.ts`) — the same path `/pdf/set`,
 * `/pdf/english-drive` and the student-profile sheet use. No headless browser: the
 * Slice-1 Oracle constraint still holds.
 *
 * NOTHING IS RECOMPUTED HERE. Every figure is read out of the snapshot the revision
 * froze, so the page, the screen and the guardian's copy cannot drift apart — a sheet
 * that re-derived its numbers would eventually print something the family's app does
 * not show.
 *
 * Three rules the page obeys because it leaves the building (§8):
 *   1. it prints ONLY what the caller may see — a narrowed sheet says so;
 *   2. it states its STATUS and revision, and when the data was read, so an
 *      unreleased draft can never be mistaken for the released document;
 *   3. it stamps who printed it and when. An unattributable document is a liability.
 *
 * Layout follows the sample rendered during planning: ≤7-column tables (the renderer's
 * weighted columns get cramped beyond that) at fontScale 0.92 / margin 38.
 */
import { bnNum as bn } from "../../../lib/bnNum";
import type { MonthlySnapshot } from "./MonthlyReportService";
import type { MonthlyReportStatus } from "../models/MonthlyReport";

const STATUS_BN: Record<MonthlyReportStatus, string> = {
  DRAFT: "খসড়া",
  READY: "প্রস্তুত",
  RELEASED: "প্রকাশিত",
  SUPERSEDED: "প্রতিস্থাপিত",
};

const TREND_BN: Record<string, string> = {
  UP: "উন্নতি",
  STEADY: "স্থিতিশীল",
  DOWN: "মনোযোগ প্রয়োজন",
  NOT_COMPARABLE: "তুলনাযোগ্য নয়",
};

const FLAG_BN: Record<string, string> = {
  ABSENT_STREAK: "টানা অনুপস্থিতি",
  ABSENT_UNCOVERED: "ছুটি ছাড়া অনুপস্থিতি",
  SERIOUS_MATTER: "গুরুতর বিষয় — শ্রেণি শিক্ষক যোগাযোগ করবেন",
};

const pct = (v: number | null | undefined): string => (v == null ? "—" : `${bn(Math.round(v))}%`);

/** A trend, with the delta it was decided on — the chip and the number agree. */
function trendText(t: { state: string; delta: number | null } | undefined): string {
  if (!t) return TREND_BN.NOT_COMPARABLE;
  const label = TREND_BN[t.state] ?? TREND_BN.NOT_COMPARABLE;
  if (t.delta == null) return label;
  return `${label} (${t.delta > 0 ? "+" : ""}${bn(t.delta)})`;
}

export interface SheetInput {
  snapshot: MonthlySnapshot;
  status: MonthlyReportStatus;
  revision: number;
  periodKey: string;
  dataAsOf: Date;
  provisional: boolean;
  /** The reviewed paragraph. Absent on a narrowed sheet (§4). */
  comment: string | null;
  studentName: string;
  classLabel: string;
  sectionLabel: string;
  rollNumber: string | null;
  /** False ⇒ narrowed to `subjectFilter`, and the page says so. */
  fullView: boolean;
  subjectFilter: string[];
  printedByName: string;
  printedAt: Date;
  /** What changed since the previous revision (§7.2). */
  changeLog: string[];
  subjectLabels: Record<string, string>;
}

const subjectBn = (code: string, labels: Record<string, string>): string => labels[code] ?? code;

/** PURE — asserted without generating a PDF. */
export function buildMonthlyReportMarkdown(input: SheetInput): string {
  const s = input.snapshot;
  const m = s.metrics;
  const t = s.trends;
  const out: string[] = [];
  const push = (...xs: string[]): void => {
    out.push(...xs);
  };

  push(`# মাসিক অগ্রগতি রিপোর্ট — ${bn(input.periodKey)}`, "");
  push(
    `**${input.studentName}** — ${input.classLabel} — শাখা: ${input.sectionLabel}` +
      (input.rollNumber ? ` — রোল: ${bn(input.rollNumber)}` : ""),
    "",
  );

  // The status band. A draft must never be mistaken for the released document.
  push(
    "| অবস্থা | সংস্করণ | তথ্য হালনাগাদ |",
    "|---|---|---|",
    `| ${STATUS_BN[input.status]}${input.provisional ? " — অসম্পূর্ণ তথ্য" : ""} | ${bn(input.revision)} | ${bn(
      input.dataAsOf.toISOString().slice(0, 10),
    )} |`,
    "",
  );

  if (!input.fullView) {
    push(
      `**এই রিপোর্টটি সীমিত:** শুধু ${input.subjectFilter.map((c) => subjectBn(c, input.subjectLabels)).join(", ")} বিষয়ের তথ্য দেখানো হয়েছে।`,
      "",
    );
  }

  if (input.comment) push("## সারসংক্ষেপ", "", input.comment, "");

  for (const f of s.flags ?? []) {
    push(`**${FLAG_BN[f.flag] ?? f.flag}${f.flag === "SERIOUS_MATTER" ? "" : `: ${bn(f.value)}`}**`, "");
  }

  // --- attendance ---------------------------------------------------------
  if (m?.attendance) {
    const a = m.attendance;
    const cohort = s.cohort;
    push("## উপস্থিতি", "");
    push(
      "| বিবরণ | এই মাস | শ্রেণি গড় | শ্রেণি সর্বোচ্চ | বিদ্যালয় সর্বোচ্চ |",
      "|---|---|---|---|---|",
      `| উপস্থিত দিন | ${bn(a.present)} / ${bn(a.schoolDays)} | — | ${
        cohort?.attendancePresentDays?.best == null ? "—" : bn(cohort.attendancePresentDays.best)
      } | ${s.schoolBestPresentDays == null ? "—" : bn(s.schoolBestPresentDays)} |`,
      `| উপস্থিতির হার | ${pct(a.rate)} | ${pct(cohort?.attendanceRate?.avg ?? null)} | ${pct(
        cohort?.attendanceRate?.best ?? null,
      )} | — |`,
      `| অনুপস্থিত (ছুটি নেওয়া) | ${bn(a.absentLeaveCovered)} | — | — | — |`,
      `| অনুপস্থিত (ছুটি ছাড়া) | ${bn(a.absentUncovered)} | — | — | — |`,
      `| টানা অনুপস্থিতি (সর্বোচ্চ) | ${bn(a.absentStreakMax)} | — | — | — |`,
      "",
      `প্রবণতা: **${trendText(t?.attendance)}**`,
      "",
    );
  }

  // --- the two trackers ---------------------------------------------------
  type TrackerBlock = NonNullable<typeof m>["homework"];
  const trackers: Array<[string, TrackerBlock, "homeworkSubmission" | "assignmentSubmission"]> = [];
  if (m?.homework) trackers.push(["বাড়ির কাজ", m.homework, "homeworkSubmission"]);
  if (m?.assignment) trackers.push(["অ্যাসাইনমেন্ট", m.assignment, "assignmentSubmission"]);

  for (const [title, block, trendKey] of trackers) {
    if (!block) continue;
    push(`## ${title}`, "");
    push(
      "| বিষয় | দেওয়া | উপস্থিত থাকাকালে প্রাপ্য | জমা | জমার হার | সঠিকতা |",
      "|---|---|---|---|---|---|",
      ...block.bySubject.map(
        (r) =>
          `| ${subjectBn(r.subject, input.subjectLabels)} | ${bn(r.issued)} | ${bn(r.expectedWhilePresent)} | ${bn(
            r.submitted,
          )} | ${pct(r.submissionRate)} | ${pct(r.qualityRate)} |`,
      ),
      `| **সব বিষয়** | **${bn(block.issued)}** | **${bn(block.expectedWhilePresent)}** | **${bn(
        block.submitted,
      )}** | **${pct(block.submissionRate)}** | **${pct(block.qualityRate)}** |`,
      "",
      `প্রবণতা: **${trendText(t?.[trendKey])}** — পুনঃজমা ${bn(block.resubmissions)} — অনুপস্থিত থাকায় জমা হয়নি ${bn(
        block.notSubmittedDueToAbsence,
      )} — রিমাইন্ডার ${bn(block.remindersSent)} — তথ্য সম্পূর্ণতা ${pct(block.coverage?.pct ?? null)}`,
      "",
    );
  }

  // --- class test ---------------------------------------------------------
  if (m?.classTest && m.classTest.testsHeld > 0) {
    const c = m.classTest;
    push("## ক্লাস টেস্ট", "");
    push(
      "| বিষয় | পরীক্ষা | অংশ নিয়েছে | অনুপস্থিত | নম্বর | হার |",
      "|---|---|---|---|---|---|",
      ...c.bySubject.map(
        (r) =>
          `| ${subjectBn(r.subject, input.subjectLabels)} | ${bn(r.testsHeld)} | ${bn(r.attended)} | ${bn(
            r.absent,
          )} | ${bn(r.marksObtained)} / ${bn(r.marksFull)} | ${pct(r.rate)} |`,
      ),
      `| **সব বিষয়** | **${bn(c.testsHeld)}** | **${bn(c.attended)}** | **${bn(c.absent)}** | **${bn(
        c.marksObtained,
      )} / ${bn(c.marksFull)}** | **${pct(c.rate)}** |`,
      "",
      `প্রবণতা: **${trendText(t?.classTest)}** — নম্বর আসেনি ${bn(c.unmarked)}টির — তথ্য সম্পূর্ণতা ${pct(
        c.coverage?.pct ?? null,
      )}`,
      "",
    );
  }

  // --- the smaller planes -------------------------------------------------
  if (m?.hifz && m.hifz.sessions > 0) {
    const h = m.hifz;
    push("## শনিবারের রিভিশন (হিফজ)", "");
    push(
      `অংশ নিয়েছে ${bn(h.present)} / ${bn(h.sessions)} — পড়া হয়েছে ${bn(h.juzHeard)} পারা — তানবিহ ${bn(
        h.tanbih,
      )} — ফাতহ ${bn(h.fath)} — ভুল ${bn(h.mistakes)}`,
      "",
    );
    if (h.latestNote) push(`শিক্ষকের মন্তব্য: ${h.latestNote}`, "");
  }

  if (m?.concerns) {
    push("## উদ্বেগ ও ইতিবাচক মন্তব্য", "");
    push(
      `উদ্বেগ ${bn(m.concerns.concern)} — ইতিবাচক ${bn(m.concerns.positive)} — প্রবণতা **${trendText(t?.concerns)}**`,
      "",
    );
  }

  if (m?.library && m.library.taken + m.library.stillHeld > 0) {
    const l = m.library;
    push("## লাইব্রেরি", "");
    push(
      `নিয়েছে ${bn(l.taken)} — সময়মতো ফেরত ${bn(l.returnedOnTime)} — দেরিতে ফেরত ${bn(l.returnedLate)} — মেয়াদোত্তীর্ণ ${bn(
        l.overdue,
      )}`,
      "",
    );
  }

  if (m?.participation) {
    push("## অভিভাবকের অংশগ্রহণ", "");
    push(
      `রিমাইন্ডার ${bn(m.participation.remindersSent)} — নোটিশ ${bn(m.participation.noticesSent)} — ফোন নম্বর ${
        m.participation.phoneOnFile ? "আছে" : "নেই"
      }`,
      "",
    );
  }

  // Absent for a teacher — the resolver strips the block before it reaches here.
  if (m?.fees) {
    push("## ফি (পরিশোধের হিসাব)", "");
    push(
      "| খাত | এই মাস |",
      "|---|---|",
      ...m.fees.byHead.map((h) => `| ${h.head} | ${bn(h.amount)} |`),
      `| **মোট পরিশোধিত** | **${bn(m.fees.paidTotal)}** |`,
      "",
      `বছরের শুরু থেকে ${bn(m.fees.paidYearToDate)}${
        m.fees.latestPaymentKey ? ` — সর্বশেষ পরিশোধ ${bn(m.fees.latestPaymentKey)}` : ""
      }`,
      "",
      "*বকেয়ার হিসাব এই রিপোর্টে দেখানো হয় না।*",
      "",
    );
  }

  if (input.changeLog.length > 0) {
    push("## যা পরিবর্তন হয়েছে", "");
    for (const c of input.changeLog) push(`- ${c}`);
    push("");
  }

  // --- the appendix: the rule that produced every chip on this page --------
  const cfg = s.config;
  if (cfg) {
    push("## পরিশিষ্ট — প্রবণতা নির্ণয়ের নিয়ম", "");
    push(
      "| মাপকাঠি | সীমা | ন্যূনতম তথ্য (উভয় মাসে) |",
      "|---|---|---|",
      `| উপস্থিতি | ${pct(cfg.attendanceThresholdPp)} | ${bn(cfg.attendanceMinDays)} কর্মদিবস |`,
      `| বাড়ির কাজ জমা | ${pct(cfg.homeworkThresholdPp)} | ${bn(cfg.homeworkMinSheets)}টি |`,
      `| অ্যাসাইনমেন্ট জমা | ${pct(cfg.assignmentThresholdPp)} | ${bn(cfg.assignmentMinItems)}টি |`,
      `| সঠিকতা | ${pct(cfg.qualityThresholdPp)} | ${bn(cfg.qualityMinChecked)}টি যাচাইকৃত |`,
      `| ক্লাস টেস্ট | ${pct(cfg.classTestThresholdPp)} | ${bn(cfg.classTestMinTests)}টি পরীক্ষা |`,
      `| উদ্বেগ | ${bn(cfg.concernThreshold)}টি | — |`,
      "",
      "ন্যূনতম তথ্যের কম হলে তুলনা দেখানো হয় না। এই সীমাগুলো এই সংস্করণের সঙ্গে সংরক্ষিত।",
      "",
    );
  }

  push(
    `প্রিন্ট করেছেন: ${input.printedByName} — ${bn(input.printedAt.toISOString().slice(0, 10))}`,
    "",
    input.status === "RELEASED"
      ? "প্রকাশের পর তথ্য পরিবর্তিত হলে নতুন সংস্করণ তৈরি হবে এবং তা আলাদাভাবে প্রকাশ করতে হবে।"
      : "**এই সংস্করণ এখনো প্রকাশিত হয়নি — এটি অভিভাবককে দেওয়ার জন্য নয়।**",
  );

  return out.join("\n");
}
