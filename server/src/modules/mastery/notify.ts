/**
 * Mastery notifications (M-6, docs/prd-mastery.md §9, D-#812).
 *
 *  - MASTERY_PROPOSAL        → every holder of `mastery:approve` when a section crosses the line
 *  - MASTERY_EXTRA_CLASS     → the routine teacher (extra class or re-teach) and — for an extra
 *                              class — each planned student's guardians
 *  - MASTERY_ASSIGNMENT_SENT → each student's guardians when the weekly assignment is sent
 *
 * Every dedupe key carries the RECIPIENT (and the student for guardians): an entity-only key would
 * silently swallow the second person's notice (the WC-7 lesson). Callers never let a failure here
 * fail their own write.
 *
 * OT-3 (prd-objective-tree §8.1, D-#923 / #925): a notice names an outcome through `outcomeNaming` —
 * staff read "<objective word>: <objective> › <sub word>: <sub-objective>", guardians ONLY
 * "<objective word>: <objective>" (never a sub-objective). The level words come from পলিসি.
 */
import { Types } from "mongoose";
import { HW_SUBJECT_LABELS_BN } from "@scd/shared";
import { emit } from "../notifications/services/NotificationService";
import { holderIdsOf } from "../access-control/services/holders";
import { GuardianLink } from "../foundation/models/GuardianLink";
import { MasteryOutcome } from "./models/MasteryOutcome";
import { masteryLevelLabels } from "./services/MasteryReviewService";

export interface OutcomeNaming {
  /** The row's own label (a sub-objective's label is staff-only). */
  labelBn: string;
  /** The objective it belongs to (itself unless it is a sub-objective). */
  objectiveCode: string;
  objectiveLabelBn: string;
  isSub: boolean;
  /** For staff: the objective, then the sub-objective — with the level words. */
  staffBn: string;
  /** For guardians: the objective only (D-#925). */
  guardianBn: string;
}

/** How notices and the proposal screens name a tagged outcome (parent objective first, §8.1). */
export async function outcomeNaming(loCode: string): Promise<OutcomeNaming> {
  const [o, words] = await Promise.all([
    MasteryOutcome.findOne({ code: loCode }).select("code labelBn level parentCode").lean(),
    masteryLevelLabels(),
  ]);
  const labelBn = o?.labelBn ?? loCode;
  const parent = o?.level === "SUB" && o.parentCode ? await MasteryOutcome.findOne({ code: o.parentCode }).select("code labelBn").lean() : null;
  const objectiveLabelBn = parent?.labelBn ?? labelBn;
  return {
    labelBn,
    objectiveCode: parent?.code ?? loCode,
    objectiveLabelBn,
    isSub: Boolean(parent),
    staffBn: parent ? `${words.objectiveBn}: ${parent.labelBn} › ${words.subBn}: ${labelBn}` : `${words.objectiveBn}: ${labelBn}`,
    // A sub whose objective is gone is never named to a guardian by its own label.
    guardianBn: o?.level === "SUB" && !parent ? words.objectiveBn : `${words.objectiveBn}: ${objectiveLabelBn}`,
  };
}

const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const subjectBn = (s: string) => (HW_SUBJECT_LABELS_BN as Record<string, string>)[s] ?? s;

export const masteryDedupe = {
  proposal: (actionId: string, userId: string) => `MSPROP:${actionId}:${userId}`,
  extraClassTeacher: (actionId: string, userId: string) => `MSECT:${actionId}:${userId}`,
  extraClassGuardian: (actionId: string, studentId: string, guardianId: string) => `MSECG:${actionId}:${studentId}:${guardianId}`,
  assignmentSent: (assignmentId: string, studentId: string, guardianId: string) => `MSAS:${assignmentId}:${studentId}:${guardianId}`,
};

/** studentId → its active guardians' ids. */
async function guardiansOf(studentIds: string[]): Promise<Map<string, string[]>> {
  const ids = studentIds.filter((s) => Types.ObjectId.isValid(s)).map((s) => new Types.ObjectId(s));
  const links = (await GuardianLink.find({ studentId: { $in: ids }, active: { $ne: false } })
    .select("guardianId studentId")
    .lean()) as unknown as { guardianId: Types.ObjectId; studentId: Types.ObjectId }[];
  const out = new Map<string, string[]>();
  for (const l of links) out.set(String(l.studentId), [...(out.get(String(l.studentId)) ?? []), String(l.guardianId)]);
  return out;
}

export interface ProposalNotice {
  actionId: string;
  sectionId: string;
  where: string; // "তৃতীয় শ্রেণি বালক"
  subject: string;
  /** Staff naming (`outcomeNaming().staffBn`). */
  outcomeBn: string;
  weakPct: number;
}

export async function notifyProposal(p: ProposalNotice): Promise<number> {
  const approvers = await holderIdsOf("mastery:approve" as never);
  let sent = 0;
  for (const userId of approvers) {
    const r = await emit({
      recipientUserId: userId,
      kind: "MASTERY_PROPOSAL",
      titleBn: "অতিরিক্ত ক্লাসের প্রস্তাব",
      bodyBn: `${p.where} · ${subjectBn(p.subject)} · ${p.outcomeBn} — শাখার ${bn(p.weakPct)}% দুর্বল`,
      refs: { masteryActionId: p.actionId, sectionId: p.sectionId, subject: p.subject },
      dedupeKey: masteryDedupe.proposal(p.actionId, userId),
    });
    if (r.created) sent++;
  }
  return sent;
}

export interface ExtraClassNotice {
  actionId: string;
  sectionId: string;
  subject: string;
  /** Staff naming (the teacher's notice). */
  outcomeBn: string;
  /** Guardian naming — the objective only (D-#925). */
  guardianOutcomeBn: string;
  kind: "EXTRA_CLASS" | "RETEACH";
  teacherId: string | null;
  dateYmd: string | null;
  periodNumber: number | null;
  afterSchool: boolean;
  retestYmd: string;
  students: { studentId: string; name: string }[];
}

export async function notifyExtraClass(n: ExtraClassNotice): Promise<number> {
  let sent = 0;
  const when = n.dateYmd ? `${bn(n.dateYmd)} · ${n.afterSchool ? "ছুটির পর" : `পিরিয়ড ${bn(n.periodNumber ?? 0)}`}` : "";
  if (n.teacherId) {
    const r = await emit({
      recipientUserId: n.teacherId,
      kind: "MASTERY_EXTRA_CLASS",
      titleBn: n.kind === "EXTRA_CLASS" ? "অতিরিক্ত ক্লাস অনুমোদিত" : "রি-টিচের সিদ্ধান্ত",
      bodyBn:
        `${subjectBn(n.subject)} · ${n.outcomeBn} · ${bn(n.students.length)} জন` +
        (when ? ` · ${when}` : "") +
        ` · রি-টেস্ট ${bn(n.retestYmd)}`,
      refs: { masteryActionId: n.actionId, sectionId: n.sectionId, subject: n.subject },
      dedupeKey: masteryDedupe.extraClassTeacher(n.actionId, n.teacherId),
    });
    if (r.created) sent++;
  }
  if (n.kind !== "EXTRA_CLASS") return sent; // a re-teach happens in the normal period: nothing for the family to do
  const g = await guardiansOf(n.students.map((s) => s.studentId));
  for (const s of n.students) {
    for (const guardianId of g.get(s.studentId) ?? []) {
      const r = await emit({
        recipientGuardianId: guardianId,
        kind: "MASTERY_EXTRA_CLASS",
        titleBn: "অতিরিক্ত ক্লাস",
        bodyBn: `${s.name}-এর জন্য ${subjectBn(n.subject)}-এ অতিরিক্ত ক্লাস — ${n.guardianOutcomeBn}${when ? ` · ${when}` : ""}`,
        refs: { studentId: s.studentId, subject: n.subject },
        dedupeKey: masteryDedupe.extraClassGuardian(n.actionId, s.studentId, guardianId),
      });
      if (r.created) sent++;
    }
  }
  return sent;
}

export interface AssignmentNotice {
  assignmentId: string;
  subject: string;
  dueYmd: string;
  students: { studentId: string; name: string }[];
}

export async function notifyAssignmentSent(n: AssignmentNotice): Promise<number> {
  let sent = 0;
  const g = await guardiansOf(n.students.map((s) => s.studentId));
  for (const s of n.students) {
    for (const guardianId of g.get(s.studentId) ?? []) {
      const r = await emit({
        recipientGuardianId: guardianId,
        kind: "MASTERY_ASSIGNMENT_SENT",
        titleBn: "সাপ্তাহিক অ্যাসাইনমেন্ট",
        bodyBn: `${s.name} · ${subjectBn(n.subject)} · জমা ${bn(n.dueYmd)}`,
        refs: { studentId: s.studentId, subject: n.subject },
        dedupeKey: masteryDedupe.assignmentSent(n.assignmentId, s.studentId, guardianId),
      });
      if (r.created) sent++;
    }
  }
  return sent;
}
