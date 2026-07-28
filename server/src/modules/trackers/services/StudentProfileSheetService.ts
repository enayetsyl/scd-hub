/**
 * StudentProfileSheetService (SP-4, prd-student-profile §9, D-#360) — renders the
 * profile as a printable sheet for a parent meeting.
 *
 * It builds MARKDOWN and hands it to the existing pdfkit + NotoSansBengali A4 engine
 * (`routes/pdfRenderer.ts`, the same path `/pdf/set` and `/pdf/english-drive` use).
 * No headless browser: the Oracle Always-Free constraint behind that choice (Slice-1
 * decision) still holds.
 *
 * Two rules the sheet must obey, because it leaves the building:
 *   1. it prints ONLY what the caller may see — a narrowed subject teacher's sheet is
 *      narrowed, and says so on the page;
 *   2. it stamps WHO printed it and WHEN. A sheet handed to a guardian is a document;
 *      an unattributable document is a liability.
 *
 * The markdown is assembled here (pure, testable) and rendered by the caller, so the
 * body can be asserted without generating a PDF.
 */
import type { StudentProfileHeader, StudentProfileAttendance, StudentProfileComments } from "./StudentProfileContextService";
import type { StudentTrackerPanel, TrackerCounters } from "./StudentProfileService";
import type { StudentProfile as ClassTestProfile } from "./ClassTestSummaryService";

/** Bangla numerals, matching the app's `bnNum` so the sheet reads like the screen.
 *  Definition moved to `lib/bnNum` (shared with the chase-message renderers); kept
 *  exported under this name so existing callers are untouched. */
export { bnNum as bn } from "../../../lib/bnNum";
import { bnNum as bn } from "../../../lib/bnNum";

const ROSTER_CLASS_BN: Record<number, string> = {
  [-1]: "নার্সারি",
  0: "কেজি",
  1: "প্রথম শ্রেণি",
  2: "দ্বিতীয় শ্রেণি",
  3: "তৃতীয় শ্রেণি",
  4: "চতুর্থ শ্রেণি",
  5: "পঞ্চম শ্রেণি",
};

/** Subject code → Bangla, via the shared HW subject labels (the app's rule). */
function subjectBn(code: string, labels: Record<string, string>): string {
  return labels[code] ?? code;
}

export interface SheetInput {
  header: StudentProfileHeader;
  attendance: StudentProfileAttendance;
  homework: StudentTrackerPanel;
  assignment: StudentTrackerPanel;
  classTest: ClassTestProfile;
  comments: StudentProfileComments;
  /** Bangla subject labels (HW_SUBJECT_LABELS_BN) — injected so this stays pure. */
  subjectLabels: Record<string, string>;
  /** Who is printing, stamped in the footer (§9). */
  printedByName: string;
  printedAt: Date;
  /** False ⇒ the sheet is narrowed to `subjectFilter` and says so. */
  fullView: boolean;
  subjectFilter: string[];
}

function counterRow(label: string, c: TrackerCounters): string {
  const quality = c.qualityPct == null ? "—" : `${bn(c.qualityPct)}%`;
  const submission = c.submissionPct == null ? "—" : `${bn(c.submissionPct)}%`;
  return `| ${label} | ${bn(c.sheets)} | ${bn(c.received)} | ${bn(c.submitted)} (${submission}) | ${bn(c.notSubmitted)} | ${bn(c.correct)}/${bn(c.partial)}/${bn(c.wrong)} | ${quality} |`;
}

function trackerSection(title: string, panel: StudentTrackerPanel, labels: Record<string, string>): string[] {
  const out: string[] = [`## ${title}`];
  if (panel.totals.sheets === 0) {
    out.push("এই সময়সীমায় কোনো তথ্য নেই।", "");
    return out;
  }
  out.push(
    "| বিষয় | মোট | পেয়েছে | জমা (হার) | জমা দেয়নি | সঠিক/আংশিক/ভুল | সঠিকতা |",
    "|---|---|---|---|---|---|---|",
    counterRow("সব বিষয়", panel.totals),
  );
  for (const row of panel.bySubject) {
    // TrackerSubjectRow IS the counters plus `subject` (the nesting exists only in
    // the GraphQL shape), so the row passes straight through.
    out.push(counterRow(subjectBn(row.subject, labels), row));
  }
  const t = panel.totals;
  const extras: string[] = [];
  if (t.absentAtIssue > 0) extras.push(`অনুপস্থিত থাকায় পায়নি ${bn(t.absentAtIssue)}`);
  if (t.notReceivedStill > 0) extras.push(`এখনো পায়নি ${bn(t.notReceivedStill)}`);
  if (t.chased > 0) extras.push(`রিমাইন্ডার পেয়েছে ${bn(t.chased)}`);
  if (t.resubmissions > 0) extras.push(`পুনঃজমা ${bn(t.resubmissions)}`);
  if (t.avgMarksPct != null) extras.push(`গড় নম্বর ${bn(t.avgMarksPct)}%`);
  if (extras.length) out.push("", extras.join(" · "));
  out.push("");
  return out;
}

/**
 * Assemble the sheet's markdown. PURE — no DB, no clock (the timestamp is injected),
 * so the body is asserted in tests without rendering a PDF.
 */
export function buildProfileSheetMarkdown(input: SheetInput): string {
  const { header: h, attendance: a, classTest: ct, comments: cm, subjectLabels: L } = input;
  const lines: string[] = [];

  const className = ROSTER_CLASS_BN[h.classLevel] ?? `শ্রেণি ${bn(h.classLevel)}`;
  lines.push(`# ${h.nameBn || h.name}`);
  lines.push(
    [
      className,
      h.sectionNameBn ? `শাখা ${h.sectionNameBn}` : null,
      h.rollNumber ? `রোল ${bn(h.rollNumber)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  if (h.classTeacherName) lines.push(`শ্রেণি শিক্ষক: ${h.classTeacherName}`);
  const primary = h.guardians.find((g) => g.primary) ?? h.guardians[0];
  if (primary) {
    lines.push(`অভিভাবক: ${primary.name}${primary.relation ? ` (${primary.relation})` : ""}${primary.phone ? ` · ${primary.phone}` : ""}`);
  }
  lines.push(`সময়সীমা: ${a.fromKey} — ${a.toKey}`);
  if (!input.fullView) {
    // Printed ON the sheet: a partial document that looks whole is the real risk.
    lines.push(
      `**দ্রষ্টব্য:** এই রিপোর্টে শুধু আপনার বিষয়ের তথ্য আছে (${input.subjectFilter.map((s) => subjectBn(s, L)).join(", ") || "—"})।`,
    );
  }
  lines.push("");

  // --- attendance -----------------------------------------------------------
  lines.push("## উপস্থিতি");
  lines.push(
    `উপস্থিতির হার **${bn(a.presentPct)}%** — গণনাকৃত দিন ${bn(a.markedDays)}, অনুপস্থিত ${bn(a.absentDays)}, ছুটি ছাড়া অনুপস্থিত ${bn(a.absentUncoveredDays)}, একটানা সর্বোচ্চ ${bn(a.absentStreakMax)} দিন।`,
  );
  if (a.recentPresentPct != null && a.earlierPresentPct != null) {
    lines.push(`সাম্প্রতিক ${bn(a.recentPresentPct)}% / পূর্বের ${bn(a.earlierPresentPct)}%`);
  }
  if (a.leaves.length > 0) {
    lines.push("", "ছুটির আবেদন:");
    for (const l of a.leaves) {
      lines.push(`- ${l.fromKey} → ${l.toKey} (${bn(l.daysInWindow)} দিন) — ${l.reason}`);
    }
  }
  lines.push("");

  // --- trackers -------------------------------------------------------------
  lines.push(...trackerSection("বাড়ির কাজ", input.homework, L));
  lines.push(...trackerSection("অ্যাসাইনমেন্ট", input.assignment, L));

  // --- class test -----------------------------------------------------------
  lines.push("## ক্লাস টেস্ট");
  if (ct.bySubject.length === 0) {
    lines.push("এই সময়সীমায় কোনো ফলাফল নেই।", "");
  } else {
    lines.push("| বিষয় | পরীক্ষা | গড় | সর্বশেষ | প্রবণতা |", "|---|---|---|---|---|");
    for (const b of ct.bySubject) {
      const trend = b.trend === "up" ? "উন্নতি" : b.trend === "down" ? "অবনতি" : "স্থির";
      lines.push(
        `| ${subjectBn(b.subject, L)} | ${bn(b.examsTaken)} | ${b.avgPercent == null ? "—" : `${bn(b.avgPercent)}%`} | ${b.latestPercent == null ? "—" : `${bn(b.latestPercent)}%`} | ${trend} |`,
      );
    }
    const an = ct.analytics;
    const bits: string[] = [];
    if (an.avgPercent != null) bits.push(`সার্বিক গড় ${bn(an.avgPercent)}%`);
    if (an.bestSubject) bits.push(`সবচেয়ে ভালো ${subjectBn(an.bestSubject, L)}`);
    if (an.weakestSubject) bits.push(`দুর্বল ${subjectBn(an.weakestSubject, L)}`);
    if (an.recurringWeaknesses.length > 0) {
      bits.push(`বার বার: ${an.recurringWeaknesses.map((w) => `${w.tag} ×${bn(w.count)}`).join(", ")}`);
    }
    if (bits.length) lines.push("", bits.join(" · "));

    // The teacher's own words are the meeting material — carry the latest of each.
    const latest = ct.results.find((r) => r.weakness || r.teacherAction || r.guardianAction);
    if (latest) {
      lines.push("", "**শিক্ষকের মন্তব্য**");
      if (latest.weakness) lines.push(`- লক্ষণীয় দিক: ${latest.weakness}`);
      if (latest.teacherAction) lines.push(`- শিক্ষকের করণীয়: ${latest.teacherAction}`);
      if (latest.guardianAction) lines.push(`- অভিভাবকের করণীয়: ${latest.guardianAction}`);
    }
    lines.push("");
  }

  // --- comments + meetings --------------------------------------------------
  lines.push("## মন্তব্য ও অভিভাবক সভা");
  lines.push(
    `উদ্বেগ ${bn(cm.tally.concern)} · প্রশংসা ${bn(cm.tally.positive)}${cm.tally.undelivered > 0 ? ` · পাঠানো হয়নি ${bn(cm.tally.undelivered)}` : ""}`,
  );
  for (const c of cm.comments.slice(0, 5)) {
    lines.push(`- ${c.text}${c.authorName ? ` — ${c.authorName}` : ""}`);
  }
  for (const m of cm.timeline.meetingComments.slice(-2)) {
    const parts = [m.positiveText, m.concernText].filter(Boolean).join(" / ");
    if (parts) lines.push(`- ${m.instanceLabel}: ${parts}`);
  }
  lines.push("");

  // --- footer: traceability (§9) -------------------------------------------
  const stamp = input.printedAt.toISOString().slice(0, 16).replace("T", " ");
  lines.push("---", `প্রিন্ট করেছেন: ${input.printedByName} · ${stamp} (UTC)`);

  return lines.join("\n");
}

