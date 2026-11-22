/**
 * HomeworkPickRules — AL-5: the SAME exclusions the homework draft uses (§4.3, §4.7, R21, R23), applied to what a
 * teacher swaps in or adds by hand.
 *
 *   UNUSED   nobody in the শাখা (or any child on its roster) has had it, no open extra sheet holds it, and the
 *            homework share (R21) of its objective still has room
 *   REPEAT   the শাখা had it before, longer ago than `assignmentNoRepeatWeeks × 7` days and no open extra sheet
 *            holds it (R23) — offered last and marked "আবার"
 *   BLOCKED  everything else: it was given in the window (any kind, to the শাখা or a child), or the শাখা has seen it
 *
 * `homeworkCandidates` is the read the picker's swap / add list is built from (ranked UNUSED first, REPEAT last,
 * blocked ones left out). `assertPicksAllowed` is the save-time guard: a refusal in Bangla naming the question.
 * Both are only called with the release switch on.
 */
import type { MasterySubject } from "@scd/shared";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { Student } from "../../foundation/models/Student";
import { avoidFor, isLoop2027On, type SectionAvoid } from "../../assessment/services/QuestionUseService";
import { getPolicy } from "./MasteryCatalogueService";
import { goldBank } from "./MasteryAssignmentService";
import { homeworkShareLeft, openExtraQidsOf, sectionSeen } from "./MasteryHomeworkService";
import { MasteryWorkError, assertMayWork, sectionContext, type Auth, type SectionCtx } from "./MasteryWorkService";

const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

export type PickStatus = "UNUSED" | "REPEAT" | "BLOCKED";

export interface PickLedger {
  led: SectionAvoid;
  seen: Set<string>;
  openExtra: Set<string>;
  sharePct: number;
  weeks: number;
}

export async function pickLedger(ctx: SectionCtx, subject: MasterySubject, dateKey: string): Promise<PickLedger> {
  const roster = (await Student.find({ sectionId: ctx.sectionId, active: true }).select("_id").lean()).map((s) => String(s._id)); // one roster
  const [led, seen, openExtra, policy] = await Promise.all([
    avoidFor({ sectionId: ctx.sectionId, academicYearId: ctx.academicYearId, classToken: ctx.classToken, subject, studentIds: roster, today: dateKey }),
    sectionSeen(ctx.sectionId, subject),
    openExtraQidsOf(ctx.sectionId, subject),
    getPolicy(ctx.classToken, subject),
  ]);
  return { led, seen: new Set(seen.keys()), openExtra, sharePct: Number(policy.resolved.homeworkBankSharePct), weeks: Math.round(led.windowDays / 7) };
}

/** The status of one qid (the share is checked separately, per objective). */
export function pickStatus(qid: string, L: PickLedger): PickStatus {
  if (L.openExtra.has(qid) || L.led.windowQids.has(qid)) return "BLOCKED";
  if (L.led.forSection.has(qid) || L.seen.has(qid)) return L.led.lastOn.has(qid) ? "REPEAT" : "BLOCKED";
  return "UNUSED";
}

export interface HomeworkCandidate {
  qid: string;
  textBn: string | null;
  loCode: string;
  marks: number;
  repeat: boolean;
}

/** Gold bank questions on these objectives the শাখা may be given as homework now: UNUSED first, REPEAT last (oldest use first). */
export async function homeworkCandidates(ctx: SectionCtx, subject: MasterySubject, dateKey: string, loCodes: string[]): Promise<HomeworkCandidate[]> {
  const codes = [...new Set(loCodes.filter(Boolean))];
  if (codes.length === 0) return [];
  const [L, bank] = await Promise.all([pickLedger(ctx, subject, dateKey), goldBank(codes)]);
  const marks = new Map<string, number>();
  const arts = await ContentArtifact.find({ docType: "question", current: true, retiredAt: null, reviewStatus: "gold", "envelopeJson.payload.qid": { $in: bank.map((b) => b.qid) } })
    .select("envelopeJson.payload.qid envelopeJson.payload.marks")
    .lean(); // bounded: the gold questions of the named objectives
  for (const a of arts) {
    const p = ((a.envelopeJson ?? {}) as { payload?: { qid?: string; marks?: unknown } }).payload;
    if (p?.qid) marks.set(p.qid, typeof p.marks === "number" && p.marks > 0 ? p.marks : 1);
  }
  const out: HomeworkCandidate[] = [];
  for (const code of codes) {
    const pool = bank.filter((q) => q.loCodes.includes(code));
    const room = homeworkShareLeft(pool.map((q) => q.qid), L.led, L.sharePct, pool.length);
    let left = room;
    for (const q of pool) {
      const st = pickStatus(q.qid, L);
      if (st === "BLOCKED") continue;
      if (st === "UNUSED") {
        if (left <= 0) continue; // the homework share of this objective is used up
        left -= 1;
      }
      if (out.some((o) => o.qid === q.qid)) continue;
      out.push({ qid: q.qid, textBn: q.textBn ?? null, loCode: code, marks: marks.get(q.qid) ?? 1, repeat: st === "REPEAT" });
    }
  }
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => Number(a.c.repeat) - Number(b.c.repeat) || (a.c.repeat ? (L.led.lastOn.get(a.c.qid) ?? "").localeCompare(L.led.lastOn.get(b.c.qid) ?? "") : 0) || a.i - b.i)
    .map((x) => x.c);
}

/**
 * The save-time guard. `fresh` = the bank qids this save adds (not already on the sheet); `objectiveOf` maps a qid to
 * the objective code the paper will hang it on (absent / "" for a marks-only paper: no share to apply).
 */
export async function assertPicksAllowed(ctx: SectionCtx, subject: MasterySubject, dateKey: string, fresh: string[], objectiveOf: Map<string, string>): Promise<void> {
  if (fresh.length === 0) return;
  const L = await pickLedger(ctx, subject, dateKey);
  const unusedByCode = new Map<string, string[]>();
  for (const qid of fresh) {
    const st = pickStatus(qid, L);
    if (st === "BLOCKED") {
      throw new MasteryWorkError(
        !L.led.windowQids.has(qid)
          ? `প্রশ্ন ${qid} এই শাখার শিক্ষার্থীরা আগে পেয়েছে — আবার দেওয়া যাবে না।`
          : `প্রশ্ন ${qid} গত ${bn(L.weeks)} সপ্তাহের মধ্যে এই শাখার কোনো শিক্ষার্থীকে দেওয়া হয়েছে — এখন আবার দেওয়া যাবে না।`,
      );
    }
    const code = objectiveOf.get(qid) ?? "";
    if (st === "UNUSED" && code) unusedByCode.set(code, [...(unusedByCode.get(code) ?? []), qid]);
  }
  if (unusedByCode.size === 0) return;
  const bank = await goldBank([...unusedByCode.keys()]);
  for (const [code, qids] of unusedByCode) {
    const room = homeworkShareLeft(bank.filter((q) => q.loCodes.includes(code)).map((q) => q.qid), L.led, L.sharePct, qids.length);
    if (room < qids.length) {
      throw new MasteryWorkError(`প্রশ্ন ${qids[room]}: ${code} ধাপে বাড়ির কাজের জন্য নির্ধারিত ভাগ (${bn(L.sharePct)}%) শেষ — অন্য ধাপ বা আগে দেওয়া প্রশ্ন বেছে নিন।`);
    }
  }
}

/** The picker's read: row rule first (the subject teacher, today's substitute, mastery:edit_all), switch off → nothing. */
export async function homeworkCandidatesFor(sectionId: string, subject: MasterySubject, dateKey: string, loCodes: string[], auth: Auth): Promise<HomeworkCandidate[]> {
  if (!(await isLoop2027On())) return [];
  const ctx = await sectionContext(sectionId);
  await assertMayWork(auth, ctx.sectionId, subject, new Date(`${dateKey}T00:00:00.000Z`));
  return homeworkCandidates(ctx, subject, dateKey, loCodes);
}
