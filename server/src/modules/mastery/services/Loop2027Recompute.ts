/**
 * Turning `academicLoop2027On` on recomputes every mastery state ONCE (docs/prd-academic-loop-2027.md §3.6; AL-6).
 *
 * A child's state is computed ON READ from the live evidence (D-#808) — nothing is stored — so "recompute" here means:
 *   1. a REPORT of what the 2027 in-school rule (§3.8) changes against the 2026 rule, per class × subject: how many
 *      student × objective states move (MASTERED → IMPROVING, …) and which open re-teach proposals stand on an
 *      objective whose in-school evidence no longer reaches the trigger (listed, NEVER closed by this run);
 *   2. with `apply`: `evaluateSectionTriggers` for every শাখা × subject with mastery ON, so a section whose in-school
 *      evidence now crosses the line gets its PROPOSED action (the same call every confirm makes).
 *
 * Refuses `apply` while the switch is off (the trigger would read the 2026 rule). Dry run by default. The script wrapper
 * is `server/scripts/loop2027-recompute.ts` (lead only; never run from a worktree against production).
 */
import type { Types } from "mongoose";
import type { MasterySubject } from "@scd/shared";
import { MasteryEnablement } from "../models/MasteryEnablement";
import { MasteryAction } from "../models/MasteryAction";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { isLoop2027On } from "../../assessment/services/QuestionUseService";
import { getPolicy } from "./MasteryCatalogueService";
import { computeSection, liveSectionRows } from "./MasteryDiagnosisService";
import { evaluateSectionTriggers } from "./MasteryActionService";
import { inSchoolSectionSummary } from "../diagnosis";
import { classTokenForLevel, rosterOf } from "./MasteryWorkService";

export interface RecomputeRow {
  classToken: string;
  subject: string;
  sectionId: string;
  /** Student × objective states that differ between the 2026 and the 2027 rule. */
  statesChanged: number;
  /** …of which MASTERED (or REVISION_DUE) under 2026 that read otherwise under 2027. */
  masteredLost: number;
  /** Open PROPOSED re-teach actions whose objective no longer meets the in-school trigger. */
  staleProposals: string[];
  /** Objectives that meet the in-school trigger now but have no open action (apply opens them). */
  newTriggers: string[];
}

export interface RecomputeReport {
  switchOn: boolean;
  applied: boolean;
  rows: RecomputeRow[];
  opened: number;
}

export async function recomputeForSwitch(opts: { apply?: boolean; now?: Date } = {}): Promise<RecomputeReport> {
  const apply = opts.apply === true;
  const now = opts.now ?? new Date();
  const switchOn = await isLoop2027On();
  if (apply && !switchOn) throw new Error("academicLoop2027On is false — switch it on first, then recompute.");
  const rows: RecomputeRow[] = [];
  let opened = 0;
  const enabled = await MasteryEnablement.find({ enabled: true }).select("academicYearId classToken subject").lean(); // bounded: classes × subjects of the year
  for (const en of enabled) {
    const classes = await Class.find({ academicYearId: en.academicYearId }).select("_id level").lean();
    const ofToken = classes.filter((c) => classTokenForLevel(c.level as number) === en.classToken);
    if (ofToken.length === 0) continue;
    const sections = await Section.find({ classId: { $in: ofToken.map((c) => c._id) } }).select("_id").lean();
    const policy = (await getPolicy(en.classToken, en.subject as MasterySubject)).resolved;
    for (const sec of sections) {
      const sectionId = sec._id as Types.ObjectId;
      const live = await liveSectionRows(sectionId, en.subject as MasterySubject);
      if (live.length === 0) continue;
      const before = computeSection(live, { ...policy, academicLoop2027On: false }, now);
      const after = computeSection(live, { ...policy, academicLoop2027On: true }, now);
      let statesChanged = 0;
      let masteredLost = 0;
      for (const [lo, per] of after.states) {
        for (const [sid, st] of per) {
          const was = before.states.get(lo)?.get(sid);
          if (!was || was.state === st.state) continue;
          statesChanged += 1;
          if (was.state === "MASTERED" || was.state === "REVISION_DUE") masteredLost += 1;
        }
      }
      const roster = (await rosterOf(sectionId)).length;
      const open = await MasteryAction.find({ sectionId, subject: en.subject, status: "PROPOSED" }).select("loCode").lean();
      const openByLo = new Set(open.map((a) => a.loCode));
      const staleProposals: string[] = [];
      const newTriggers: string[] = [];
      const byLo = new Map<string, typeof live>();
      for (const r of live) byLo.set(r.loCode, [...(byLo.get(r.loCode) ?? []), r]);
      for (const [lo, rs] of byLo) {
        const trig = inSchoolSectionSummary(rs, { ...policy, academicLoop2027On: true }, roster).triggered;
        if (openByLo.has(lo) && !trig) staleProposals.push(lo);
        if (!openByLo.has(lo) && trig) newTriggers.push(lo);
      }
      rows.push({ classToken: en.classToken, subject: en.subject, sectionId: String(sectionId), statesChanged, masteredLost, staleProposals, newTriggers });
      if (apply) opened += await evaluateSectionTriggers(sectionId, en.subject as MasterySubject);
    }
  }
  return { switchOn, applied: apply, rows, opened };
}
