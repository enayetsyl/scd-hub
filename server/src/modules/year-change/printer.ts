/**
 * Plain-text dry-run printers (YC-4). Used by the tests and by server/scripts/year-change.ts.
 * Bangla labels, no roll numbers: children are listed by school ID.
 */
import { LEVEL_NAME_BN, SECTION_LABEL_BN, type YearChangePlan } from "./types";
import type { CutoverPlan } from "./cutover";
import type { UndoPlan } from "./undo";

const levelBn = (l: number): string => LEVEL_NAME_BN[l] ?? `শ্রেণি ${l}`;

export function printPlan(p: YearChangePlan): string {
  const out: string[] = [];
  out.push(`শিক্ষাবর্ষ পরিবর্তন — প্রস্তুতি (ড্রাই রান): ${p.fromLabel} → ${p.toLabel}`);
  out.push(`নতুন বর্ষ শুরু ${p.startKey}; পুরোনো বর্ষের শেষ দিন ${p.closeKey}`);
  out.push("");
  out.push("শ্রেণি ও শাখা");
  for (const c of p.classes) {
    const secs = c.sections.map((s) => `${s.nameBn} ${s.children} জন${s.existingId ? "" : " (নতুন)"}`).join(" | ");
    out.push(`  ${levelBn(c.level)}${c.existingId ? "" : " (নতুন)"}: ${secs} — মোট ${c.total} (উত্তীর্ণ ${c.promotedIn}, পুনরায় ${c.repeaters}, ভর্তি ${c.admissions}; এ শ্রেণি ছাড়বে ${c.left})`);
  }
  out.push("");
  out.push("শিক্ষার্থী (আইডি অনুযায়ী)");
  for (const e of p.enrolments) {
    out.push(`  ${e.schoolId} ${e.name}: ${levelBn(e.fromLevel)} ${e.fromSectionCode} → ${levelBn(e.toLevel)} ${SECTION_LABEL_BN[e.toSectionCode]} [${e.outcome === "PROMOTED" ? "উত্তীর্ণ" : "পুনরায়"}]${e.exists ? " (আছে)" : ""}`);
  }
  for (const l of p.leavers) out.push(`  ${l.schoolId} ${l.name}: ${levelBn(l.fromLevel)} — চলে গেছে`);
  if (p.admissions.length) {
    out.push("");
    out.push("নতুন ভর্তি");
    for (const a of p.admissions) out.push(`  ${a.schoolId} ${a.name}: ${levelBn(a.toLevel)} ${SECTION_LABEL_BN[a.toSectionCode]}, অভিভাবক ${a.guardianPhone}${a.exists ? " (আছে)" : ""}`);
  }
  if (p.classTeachers.length) {
    out.push("");
    out.push("শ্রেণি শিক্ষক");
    for (const t of p.classTeachers) out.push(`  ${levelBn(t.level)} ${SECTION_LABEL_BN[t.sectionCode]}: ${t.teacherId} [${t.source === "PREFILLED" ? "আগের বছর থেকে" : "বাছাই"}]${t.alreadySet ? " (আছে)" : ""}`);
  }
  if (p.reconcile.removeEnrolments.length || p.reconcile.removeAdmissions.length || p.counts.enrolmentsToUpdate || p.counts.admissionsToUpdate) {
    out.push("");
    out.push(`আগের প্রস্তুতি (রান ${p.runId}) মেলানো হবে`);
    for (const r of p.reconcile.removeEnrolments) out.push(`  মুছবে: ${r.schoolId} — প্ল্যান করা তালিকাভুক্তি (${r.reason})`);
    for (const r of p.reconcile.removeAdmissions) out.push(`  মুছবে: ভর্তি ${r.schoolId}`);
    for (const e of p.enrolments.filter((x) => x.update)) out.push(`  বদলাবে: ${e.schoolId} → ${levelBn(e.toLevel)} ${SECTION_LABEL_BN[e.toSectionCode]}`);
    for (const a of p.admissions.filter((x) => x.changed)) out.push(`  হালনাগাদ: ভর্তি ${a.schoolId} → ${levelBn(a.toLevel)} ${SECTION_LABEL_BN[a.toSectionCode]}`);
  }
  const c = p.counts;
  out.push("");
  out.push(
    `মোট: নতুন শ্রেণি ${c.classesToCreate}, নতুন শাখা ${c.sectionsToCreate}, নতুন তালিকাভুক্তি (PLANNED) ${c.enrolmentsToCreate} (আগে থেকে ${c.enrolmentsExisting}), উত্তীর্ণ ${c.promoted}, পুনরায় ${c.repeaters}, চলে গেছে ${c.left}, নতুন ভর্তি ${c.admissionsToCreate} (আগে থেকে ${c.admissionsExisting}), শ্রেণি শিক্ষক বসবে ${c.classTeachersToSet}`,
  );
  for (const w of p.warnings) out.push(`সতর্কতা: ${w}`);
  if (p.refusals.length) {
    out.push("");
    out.push("আটকে আছে (প্রস্তুতি চালানো যাবে না):");
    for (const r of p.refusals) out.push(`  - ${r}`);
  } else out.push("কোনো বাধা নেই।");
  return out.join("\n");
}

export function printCutover(p: CutoverPlan): string {
  const out: string[] = [];
  out.push(`শিক্ষাবর্ষ পরিবর্তন — উত্তরণ (ড্রাই রান) রান ${p.runId}`);
  out.push(`অবস্থা: ${p.status}`);
  out.push(`পুরোনো তালিকাভুক্তি বন্ধ হবে ${p.closeKey} (উত্তীর্ণ ${p.promoted}, পুনরায় ${p.repeated}, চলে গেছে ${p.left})`);
  out.push(`নতুন তালিকাভুক্তি চালু হবে ${p.startKey} (${p.activating} টি; ভর্তি ${p.admitted})`);
  out.push(`শিক্ষার্থীর শ্রেণি/শাখা বদলাবে: ${p.studentsChanged}; পঞ্চম শ্রেণির বৃত্তি চিহ্ন মুছবে: ${p.scholarshipCleared}`);
  out.push(`শ্রেণিভিত্তিক উন্নতি-কাজ শেষ হবে: ${p.improvementToEnd}`);
  out.push(`চলতি বর্ষ হবে: ${p.toLabel}`);
  const OUT: Record<string, string> = { PROMOTED: "উত্তীর্ণ", REPEATED: "পুনরায়", LEFT: "চলে গেছে", ADMITTED: "নতুন ভর্তি" };
  const lvl = (l: number | null, c: string | null): string => (l === null ? "—" : `${levelBn(l)}${c ? " " + (SECTION_LABEL_BN[c as keyof typeof SECTION_LABEL_BN] ?? c) : ""}`);
  for (const c of p.children) out.push(`  ${c.schoolId} ${c.name}: ${lvl(c.fromLevel, c.fromCode)} → ${lvl(c.toLevel, c.toCode)} [${OUT[c.outcome]}]`);
  for (const i of p.improvement) out.push(`  উন্নতি-কাজ শেষ হবে: ${i.subject} (শেষ দিন ${i.lastDay})`);
  if (p.refusals.length) {
    out.push("আটকে আছে:");
    for (const r of p.refusals) out.push(`  - ${r}`);
  } else out.push("কোনো বাধা নেই।");
  return out.join("\n");
}

const UNDO_LABELS_BN: Record<string, string> = {
  enrolments: "মুছবে: প্ল্যান করা তালিকাভুক্তি",
  admissions: "মুছবে: ভর্তি-শিক্ষার্থী",
  guardianLinks: "মুছবে: অভিভাবক সংযোগ",
  sections: "মুছবে: শাখা",
  classes: "মুছবে: শ্রেণি",
  classTeachersRestored: "ফিরবে: আগের শ্রেণি শিক্ষক",
  studentsRestored: "ফিরবে: শিক্ষার্থীর আগের অবস্থা",
  pastEnrolmentsReopened: "আবার চালু হবে: পুরোনো বছরের তালিকাভুক্তি",
  newEnrolmentsToPlanned: "আবার প্ল্যান করা হবে: নতুন বছরের তালিকাভুক্তি",
  improvementRestarted: "আবার চালু হবে: শ্রেণিভিত্তিক উন্নতি-কাজ",
  homeworkOnNewSections: "নতুন শাখায় থেকে যাবে: বাড়ির কাজ",
  assignmentsOnNewSections: "নতুন শাখায় থেকে যাবে: অ্যাসাইনমেন্ট",
  attendanceDaysOnNewSections: "নতুন শাখায় থেকে যাবে: উপস্থিতির দিন",
};

export function printUndo(p: UndoPlan): string {
  const out: string[] = [];
  out.push(`${p.kind === "PREPARE" ? "প্রস্তুতি বাতিল" : "পরিবর্তন ফিরিয়ে নেওয়া"} (ড্রাই রান) — রান ${p.runId}`);
  for (const [k, v] of Object.entries(p.counts)) out.push(`  ${UNDO_LABELS_BN[k] ?? k}: ${v}`);
  if (p.changedAfter?.length) out.push(`  কাট-ওভারের পরে বদলানো শিক্ষার্থী: ${p.changedAfter.join(", ")}`);
  if (p.createdAfter?.length) out.push(`  কাট-ওভারের পরে নতুন শাখায় যোগ হওয়া শিক্ষার্থী: ${p.createdAfter.join(", ")}`);
  for (const n of p.notes) out.push(`  নোট: ${n}`);
  if (p.refusals.length) {
    out.push("আটকে আছে:");
    for (const r of p.refusals) out.push(`  - ${r}`);
  }
  return out.join("\n");
}
