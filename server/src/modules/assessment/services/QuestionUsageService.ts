/**
 * QuestionUsageService — where has this question already been used? (QU-1, D-#608; extended by AL-3, D-#1667)
 *
 * A teacher picking questions for a set had no way to know one was already in three other
 * sets, so the same question could land in this week's homework and last week's class test
 * with nobody noticing. QU-1 reads `AssessmentSet.basketItems[]` — EVERY set that holds the qid, drafts
 * included, exactly as before — and AL-3 ADDS the ledger's non-set uses (`QuestionUse` rows whose source is a
 * mastery paper or a tracker homework item: homework, assignment, extra homework, re-test, and CT from mastery CT
 * sheets). Ledger rows whose source is an AssessmentSet are NOT added: the set is already counted from its basket,
 * so nothing is counted twice and the badge is right the moment this deploys, before any backfill.
 * Same output as before plus a `kind` field; gate unchanged (`question_sets:view`).
 *
 * **Keyed on the QID, never the artifactId.** A re-import creates a new artifact row for the same
 * question, so a set assembled last term points at the OLD row; querying by artifactId the history
 * would come back empty exactly when it matters most. Same reasoning that anchors review rounds on
 * the qid (QR-1). A withdrawn ledger use (paper deleted / issue undone) never counts.
 *
 * Two entry points on purpose, each sized for its caller:
 *   • `questionUsageCounts` / `questionUsageByKind` — numbers per qid, for a 40-row bank page. No joins, no names.
 *   • `questionUsage` — the rows for ONE question, for the preview.
 */
import { Types } from "mongoose";
import { AssessmentSet } from "../models/AssessmentSet";
import { QuestionUse } from "../models/QuestionUse";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";

/** One use of a question, described the way a teacher recognises it. */
export interface QuestionUseDTO {
  /** The set / paper / homework item the question was given from. */
  setId: string;
  /** Free text and OPTIONAL on the model — the client falls back to the set type / kind. */
  setName: string | null;
  setType: string;
  /** HW | AS | CT | EXTRA_HW | RETEST (AL-3). For a set: its own type. */
  kind: string;
  status: string;
  classLevel: number | null;
  className: string | null;
  sectionName: string | null;
  /**
   * The date that tells a teacher whether reuse is a problem: for a set, when the work was DUE if it
   * had a due date, else assembled, else created; for a ledger use, the day it was given.
   */
  usedOn: string | null;
}

export interface QuestionUseKindCounts {
  total: number;
  hw: number;
  as: number;
  ct: number;
}

const KIND_BUCKET: Record<string, "hw" | "as" | "ct" | undefined> = { HW: "hw", EXTRA_HW: "hw", AS: "as", CT: "ct" };

const wantedOf = (qids: readonly string[]): string[] => [...new Set(qids.filter((q) => typeof q === "string" && q !== ""))];

/** The ledger's non-set uses per (qid, kind): distinct sources. */
async function ledgerKindCounts(wanted: string[]): Promise<{ _id: { qid: string; kind: string }; n: number }[]> {
  return (await QuestionUse.aggregate([
    { $match: { qid: { $in: wanted }, withdrawnAt: null, sourceType: { $ne: "ASSESSMENT_SET" } } },
    { $group: { _id: { qid: "$qid", kind: "$kind", sourceType: "$sourceType", sourceId: "$sourceId" } } },
    { $group: { _id: { qid: "$_id.qid", kind: "$_id.kind" }, n: { $sum: 1 } } },
  ])) as unknown as { _id: { qid: string; kind: string }; n: number }[];
}

/** How many sets each qid appears in (drafts included) plus its non-set ledger uses. Batched — one pass per page. */
export async function questionUsageCounts(qids: readonly string[]): Promise<Map<string, number>> {
  const wanted = wantedOf(qids);
  if (wanted.length === 0) return new Map();

  const rows = (await AssessmentSet.aggregate([
    { $match: { "basketItems.qid": { $in: wanted } } },
    { $unwind: "$basketItems" },
    // Re-match AFTER the unwind: the first $match keeps whole SETS, and a set containing one
    // wanted question also carries every other question it holds.
    { $match: { "basketItems.qid": { $in: wanted } } },
    // A set could in principle list the same qid twice; count SETS, not rows.
    { $group: { _id: { qid: "$basketItems.qid", setId: "$_id" } } },
    { $group: { _id: "$_id.qid", n: { $sum: 1 } } },
  ])) as unknown as { _id: string; n: number }[];

  const out = new Map(rows.map((r) => [r._id, r.n]));
  for (const r of await ledgerKindCounts(wanted)) out.set(r._id.qid, (out.get(r._id.qid) ?? 0) + r.n);
  return out;
}

/** The same uses split into homework (incl. extra) / assignment / class test — the bank badge (AL-3). */
export async function questionUsageByKind(qids: readonly string[]): Promise<Map<string, QuestionUseKindCounts>> {
  const wanted = wantedOf(qids);
  if (wanted.length === 0) return new Map();

  const sets = (await AssessmentSet.aggregate([
    { $match: { "basketItems.qid": { $in: wanted } } },
    { $unwind: "$basketItems" },
    { $match: { "basketItems.qid": { $in: wanted } } },
    { $group: { _id: { qid: "$basketItems.qid", setId: "$_id", setType: "$setType" } } },
    { $group: { _id: { qid: "$_id.qid", kind: "$_id.setType" }, n: { $sum: 1 } } },
  ])) as unknown as { _id: { qid: string; kind: string }; n: number }[];

  const out = new Map<string, QuestionUseKindCounts>();
  for (const r of [...sets, ...(await ledgerKindCounts(wanted))]) {
    const c = out.get(r._id.qid) ?? { total: 0, hw: 0, as: 0, ct: 0 };
    c.total += r.n;
    const b = KIND_BUCKET[r._id.kind];
    if (b) c[b] += r.n;
    out.set(r._id.qid, c);
  }
  return out;
}

/** Every set the question appears in plus its non-set ledger uses, newest first. */
export async function questionUsage(qid: string): Promise<QuestionUseDTO[]> {
  if (typeof qid !== "string" || qid.trim() === "") return [];
  const id = qid.trim();

  const sets = (await AssessmentSet.find({ "basketItems.qid": id })
    .select({ name: 1, setType: 1, status: 1, classId: 1, sectionId: 1, dueDate: 1, assembledAt: 1, createdAt: 1 })
    .lean()) as unknown as {
    _id: Types.ObjectId;
    name?: string;
    setType: string;
    status: string;
    classId?: Types.ObjectId;
    sectionId?: Types.ObjectId;
    dueDate?: Date;
    assembledAt?: Date;
    createdAt?: Date;
  }[];
  const uses = (await QuestionUse.find({ qid: id, withdrawnAt: null, sourceType: { $ne: "ASSESSMENT_SET" } })
    .select({ kind: 1, sourceType: 1, sourceId: 1, sectionId: 1, givenOn: 1 })
    .lean()) as unknown as { kind: string; sourceType: string; sourceId: Types.ObjectId; sectionId: Types.ObjectId; givenOn: string }[];
  if (sets.length === 0 && uses.length === 0) return [];

  // Batched lookups, never one per row.
  const sectionIds = [...new Set([...sets.map((s) => s.sectionId?.toString()), ...uses.map((u) => String(u.sectionId))].filter(Boolean))];
  const sections = await Section.find({ _id: { $in: sectionIds } }).select({ nameBn: 1, classId: 1 }).lean();
  const sectionById = new Map(sections.map((s) => [String(s._id), s]));
  const classIds = [...new Set([...sets.map((s) => s.classId?.toString()), ...sections.map((s) => String(s.classId))].filter(Boolean))];
  const classes = await Class.find({ _id: { $in: classIds } }).select({ nameBn: 1, level: 1 }).lean();
  const classById = new Map(classes.map((c) => [String(c._id), c]));

  const fromSets: QuestionUseDTO[] = sets.map((s) => {
    const sec = s.sectionId ? sectionById.get(s.sectionId.toString()) : undefined;
    const cls = classById.get((s.classId ?? sec?.classId)?.toString() ?? "");
    const when = s.dueDate ?? s.assembledAt ?? s.createdAt ?? null;
    return {
      setId: s._id.toString(),
      setName: s.name && s.name.trim() !== "" ? s.name : null,
      setType: s.setType,
      kind: s.setType,
      status: s.status,
      classLevel: typeof cls?.level === "number" ? cls.level : null,
      className: cls?.nameBn ?? null,
      sectionName: sec?.nameBn ?? null,
      usedOn: when ? new Date(when).toISOString() : null,
    };
  });

  // One line per (source, শাখা, kind): a paper may carry the question once per শাখা it reached.
  const seen = new Set<string>();
  const fromLedger: QuestionUseDTO[] = [];
  for (const u of uses) {
    const key = `${u.sourceType}|${u.sourceId}|${u.sectionId}|${u.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sec = sectionById.get(String(u.sectionId));
    const cls = sec ? classById.get(String(sec.classId)) : undefined;
    fromLedger.push({
      setId: String(u.sourceId),
      setName: null,
      setType: u.kind,
      kind: u.kind,
      status: "given",
      classLevel: typeof cls?.level === "number" ? cls.level : null,
      className: cls?.nameBn ?? null,
      sectionName: sec?.nameBn ?? null,
      usedOn: u.givenOn ? new Date(`${u.givenOn}T00:00:00.000Z`).toISOString() : null,
    });
  }
  // Newest first: the most recent use is the one that decides whether to reuse. A use with no date
  // sorts last rather than being dropped — it is still a use.
  return [...fromSets, ...fromLedger].sort((a, b) => (b.usedOn ?? "").localeCompare(a.usedOn ?? ""));
}
