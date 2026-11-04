/**
 * MasteryRollupService — the leader dashboard's (পুরো স্কুল) domain → objective → sub-objective
 * roll-up (OT-3, docs/prd-objective-tree.md §8.1, mock 7's school view).
 *
 *   schoolRollup(subject) — for every class × subject switched on in the current academic year
 *                           whose catalogue is a TREE: per domain the counts per state over all of
 *                           its tagged rows × the class's students (+ share mastered / share weak);
 *                           per objective the students' rolled-up states; per tagged row the
 *                           students' states. Flat catalogues are left out (their views are unchanged).
 *
 * States are computed on read per section by the engine (D-#808), exactly as the section heat-map
 * computes them; a student with no evidence on a row counts NOT_ASSESSED. Approvers only (the
 * leader dashboard's gate, `mastery:approve`).
 */
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { MasteryClassToken, MasteryState, MasterySubject } from "@scd/shared";
import { MasteryEnablement } from "../models/MasteryEnablement";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { MasteryWorkError, classTokenForLevel, rosterOf, type Auth } from "./MasteryWorkService";
import { computeSection, diagnosisPolicy, liveSectionRows, loadTree } from "./MasteryDiagnosisService";
import { objectiveState, summarise, type StateSummary } from "../rollup";

export interface SchoolRollupClass {
  classToken: string;
  sections: number;
  students: number;
  domains: { code: string | null; labelBn: string | null; objectiveCodes: string[]; summary: StateSummary }[];
  objectives: {
    code: string;
    labelBn: string;
    domainCode: string | null;
    chapterNumber: number | null;
    tagged: boolean;
    childCodes: string[];
    /** The class's students' rolled-up states on this objective. */
    summary: StateSummary;
  }[];
  /** Tagged rows: the students' states (the sub-objective drill). */
  rows: { code: string; labelBn: string; parentCode: string | null; summary: StateSummary }[];
}

export interface SchoolRollup {
  subject: string;
  /** Subjects switched on this year (the chips). */
  subjects: string[];
  classes: SchoolRollupClass[];
}

/** The year the dashboard reads: the one marked current, else the newest with a switched-on pair. */
async function rollupYear(): Promise<Types.ObjectId | null> {
  const current = await AcademicYear.findOne({ current: true }).select("_id").lean();
  if (current) return current._id as Types.ObjectId;
  const ids = (await MasteryEnablement.distinct("academicYearId", { enabled: true })) as Types.ObjectId[];
  if (ids.length === 0) return null;
  const newest = await AcademicYear.findOne({ _id: { $in: ids } }).sort({ startDate: -1 }).select("_id").lean();
  return (newest?._id as Types.ObjectId | undefined) ?? null;
}

export async function schoolRollup(subjectArg: string | null | undefined, auth: Auth): Promise<SchoolRollup> {
  if (!callerHasPermission(auth, "mastery:approve")) throw new MasteryWorkError("পুরো স্কুলের অবস্থা দেখার অনুমতি আপনার নেই।");
  const yearId = await rollupYear();
  if (!yearId) return { subject: subjectArg ?? "", subjects: [], classes: [] };
  const enabled = await MasteryEnablement.find({ academicYearId: yearId, enabled: true }).select("classToken subject").lean();
  const subjects = [...new Set(enabled.map((e) => e.subject as string))].sort();
  const subject = (subjectArg && subjects.includes(subjectArg) ? subjectArg : subjects[0]) as MasterySubject | undefined;
  if (!subject) return { subject: "", subjects, classes: [] };

  const tokens = [...new Set(enabled.filter((e) => e.subject === subject).map((e) => e.classToken as MasteryClassToken))];
  const classes = await Class.find({ academicYearId: yearId }).select("level").lean();
  const out: SchoolRollupClass[] = [];
  for (const token of tokens.sort()) {
    const t = await loadTree(token, subject);
    if (!t.tree.isTree) continue;
    const classIds = classes.filter((c) => classTokenForLevel(c.level as number) === token).map((c) => c._id);
    const sections = await Section.find({ classId: { $in: classIds } }).select("_id").lean();
    const policy = await diagnosisPolicy(token, subject);
    // One state per (student, tagged row) across all sections of the class.
    const perStudent: ((code: string) => MasteryState)[] = [];
    for (const s of sections) {
      const sid = s._id as Types.ObjectId;
      const [rows, roster] = await Promise.all([liveSectionRows(sid, subject), rosterOf(sid)]);
      const sec = computeSection(rows, policy, new Date());
      for (const st of roster) {
        const id = String(st._id);
        perStudent.push((code) => sec.states.get(code)?.get(id)?.state ?? "NOT_ASSESSED");
      }
    }
    out.push({
      classToken: token,
      sections: sections.length,
      students: perStudent.length,
      domains: t.tree.domains.map((d) => ({
        code: d.code,
        labelBn: d.code ? t.domainLabel.get(d.code) ?? d.code : null,
        objectiveCodes: d.objectiveCodes,
        summary: summarise(perStudent.flatMap((stateOf) => d.taggedCodes.map(stateOf))),
      })),
      objectives: t.tree.objectives.map((o) => ({
        code: o.code,
        labelBn: o.labelBn,
        domainCode: o.domainCode,
        chapterNumber: o.chapterNumber,
        tagged: o.tagged,
        childCodes: o.childCodes,
        summary: summarise(perStudent.map((stateOf) => objectiveState(o, stateOf))),
      })),
      rows: t.tree.tagged.map((r) => ({
        code: r.code,
        labelBn: r.labelBn,
        parentCode: r.parentCode ?? null,
        summary: summarise(perStudent.map((stateOf) => stateOf(r.code))),
      })),
    });
  }
  return { subject, subjects, classes: out };
}
