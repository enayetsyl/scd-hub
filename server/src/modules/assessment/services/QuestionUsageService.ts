/**
 * QuestionUsageService — where has this question already been used? (QU-1, D-#608; re-pointed at the
 * QuestionUse ledger by AL-3, D-#1667)
 *
 * A teacher picking questions for a set had no way to know one was already in three other
 * sets, so the same question could land in this week's homework and last week's class test
 * with nobody noticing. QU-1 first read `AssessmentSet.basketItems[]`; the ledger (`QuestionUse`) now
 * holds every use — homework, assignment, class test, extra homework, re-test — so the bank badge shows
 * homework and assignment uses too. Same output as before plus a `kind` field; gate unchanged
 * (`question_sets:view`).
 *
 * **Keyed on the QID, never the artifactId.** A re-import creates a new artifact row for the same
 * question, so a set assembled last term points at the OLD row; querying by artifactId the history
 * would come back empty exactly when it matters most. Same reasoning that anchors review rounds on
 * the qid (QR-1).
 *
 * Two entry points on purpose, each sized for its caller:
 *   • `questionUsageCounts` / `questionUsageByKind` — numbers per qid, for a 40-row bank page. No joins, no names.
 *   • `questionUsage` — the rows for ONE question, for the preview.
 * A withdrawn use (a paper deleted / an issue undone before results) is not a use and never counts.
 */
import { Types } from "mongoose";
import { QuestionUse } from "../models/QuestionUse";
import { AssessmentSet } from "../models/AssessmentSet";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";

/** One use of a question, described the way a teacher recognises it. */
export interface QuestionUseDTO {
  /** The source the question was given from (the set, paper or homework item id). */
  setId: string;
  /** Free text and OPTIONAL on the set — the client falls back to the set type / kind. */
  setName: string | null;
  /** The set's own type (HW / AS / CT) when the source is a set, else the use kind. */
  setType: string;
  /** HW | AS | CT | EXTRA_HW | RETEST — the ledger kind (AL-3). */
  kind: string;
  status: string;
  classLevel: number | null;
  className: string | null;
  sectionName: string | null;
  /** The day it was given (CT: the exam date), as an ISO instant at 00:00Z of that day. */
  usedOn: string | null;
}

export interface QuestionUseKindCounts {
  total: number;
  hw: number;
  as: number;
  ct: number;
}

const KIND_BUCKET: Record<string, "hw" | "as" | "ct" | undefined> = { HW: "hw", EXTRA_HW: "hw", AS: "as", CT: "ct" };

/** Per-kind counts of USES (distinct sources) for each qid. Batched — one query for a whole page. */
export async function questionUsageByKind(qids: readonly string[]): Promise<Map<string, QuestionUseKindCounts>> {
  const wanted = [...new Set(qids.filter((q) => typeof q === "string" && q !== ""))];
  if (wanted.length === 0) return new Map();

  const rows = (await QuestionUse.aggregate([
    { $match: { qid: { $in: wanted }, withdrawnAt: null } },
    // A source counts once per question even if it reached several শাখা or lists the item twice.
    { $group: { _id: { qid: "$qid", kind: "$kind", sourceType: "$sourceType", sourceId: "$sourceId" } } },
    { $group: { _id: { qid: "$_id.qid", kind: "$_id.kind" }, n: { $sum: 1 } } },
  ])) as unknown as { _id: { qid: string; kind: string }; n: number }[];

  const out = new Map<string, QuestionUseKindCounts>();
  for (const r of rows) {
    const c = out.get(r._id.qid) ?? { total: 0, hw: 0, as: 0, ct: 0 };
    c.total += r.n;
    const b = KIND_BUCKET[r._id.kind];
    if (b) c[b] += r.n;
    out.set(r._id.qid, c);
  }
  return out;
}

/** How many uses each qid has. An unused question is ABSENT, not zero. */
export async function questionUsageCounts(qids: readonly string[]): Promise<Map<string, number>> {
  const by = await questionUsageByKind(qids);
  return new Map([...by].map(([q, c]) => [q, c.total]));
}

/** Every use of one question, newest first. */
export async function questionUsage(qid: string): Promise<QuestionUseDTO[]> {
  if (typeof qid !== "string" || qid.trim() === "") return [];

  const rows = (await QuestionUse.find({ qid: qid.trim(), withdrawnAt: null })
    .select({ kind: 1, sourceType: 1, sourceId: 1, sectionId: 1, givenOn: 1 })
    .lean()) as unknown as {
    kind: string;
    sourceType: string;
    sourceId: Types.ObjectId;
    sectionId: Types.ObjectId;
    givenOn: string;
  }[];
  if (rows.length === 0) return [];

  // Batched lookups, never one per row.
  const setIds = [...new Set(rows.filter((r) => r.sourceType === "ASSESSMENT_SET").map((r) => String(r.sourceId)))];
  const sectionIds = [...new Set(rows.map((r) => String(r.sectionId)))];
  const [sets, sections] = await Promise.all([
    setIds.length ? AssessmentSet.find({ _id: { $in: setIds } }).select({ name: 1, setType: 1, status: 1 }).lean() : Promise.resolve([]),
    Section.find({ _id: { $in: sectionIds } }).select({ nameBn: 1, classId: 1 }).lean(),
  ]);
  const classIds = [...new Set(sections.map((s) => String(s.classId)))];
  const classes = await Class.find({ _id: { $in: classIds } }).select({ nameBn: 1, level: 1 }).lean();
  const setById = new Map(sets.map((s) => [String(s._id), s]));
  const sectionById = new Map(sections.map((s) => [String(s._id), s]));
  const classById = new Map(classes.map((c) => [String(c._id), c]));

  // One line per (source, শাখা): a group-anchored test writes one row per member শাখা, a paper one per question.
  const seen = new Set<string>();
  const out: QuestionUseDTO[] = [];
  for (const r of rows) {
    const key = `${r.sourceType}|${r.sourceId}|${r.sectionId}|${r.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const set = setById.get(String(r.sourceId));
    const sec = sectionById.get(String(r.sectionId));
    const cls = sec ? classById.get(String(sec.classId)) : undefined;
    out.push({
      setId: String(r.sourceId),
      setName: set?.name && set.name.trim() !== "" ? set.name : null,
      setType: set?.setType ?? r.kind,
      kind: r.kind,
      status: set?.status ?? "given",
      classLevel: typeof cls?.level === "number" ? cls.level : null,
      className: cls?.nameBn ?? null,
      sectionName: sec?.nameBn ?? null,
      usedOn: r.givenOn ? new Date(`${r.givenOn}T00:00:00.000Z`).toISOString() : null,
    });
  }
  // Newest first: the most recent use is the one that decides whether to reuse.
  return out.sort((a, b) => (b.usedOn ?? "").localeCompare(a.usedOn ?? ""));
}
