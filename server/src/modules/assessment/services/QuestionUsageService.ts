/**
 * QuestionUsageService — where has this question already been used? (QU-1, D-#608)
 *
 * A teacher picking questions for a set had no way to know one was already in three other
 * sets, so the same question could land in this week's homework and last week's class test
 * with nobody noticing. The link already existed — `AssessmentSet.basketItems[]` stores
 * `{ artifactId, qid, marks }` — it was simply never read.
 *
 * **Keyed on the QID, never the artifactId.** A re-import creates a new artifact row for the
 * same question, so a set assembled last term points at the OLD row; querying by artifactId
 * the history would come back empty exactly when it matters most. Same reasoning that anchors
 * review rounds on the qid (QR-1).
 *
 * Two entry points on purpose, each sized for its caller:
 *   • `questionUsageCounts` — one number per qid, for a 40-row bank page. No joins, no names.
 *   • `questionUsage` — the full rows for ONE question, for the preview.
 * A single "return everything" query would have made the bank list carry 40 sets' worth of
 * names and dates to render a badge.
 */
import { Types } from "mongoose";
import { AssessmentSet } from "../models/AssessmentSet";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";

/** One set a question appears in, described the way a teacher recognises it. */
export interface QuestionUseDTO {
  setId: string;
  /** Free text and OPTIONAL on the model — the client falls back to the set type. */
  setName: string | null;
  setType: string;
  status: string;
  classLevel: number | null;
  className: string | null;
  sectionName: string | null;
  /**
   * The date that tells a teacher whether reuse is a problem: when the work was DUE if it
   * had a due date, else when the set was assembled, else when it was created. "Class 5 last
   * month" is a reason not to reuse; "class 3 two years ago" is not, and only a date says which.
   */
  usedOn: string | null;
}

/** How many sets each qid appears in. Batched — one query for a whole page. */
export async function questionUsageCounts(qids: readonly string[]): Promise<Map<string, number>> {
  const wanted = [...new Set(qids.filter((q) => typeof q === "string" && q !== ""))];
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

  return new Map(rows.map((r) => [r._id, r.n]));
}

/** Every set one question appears in, newest use first. */
export async function questionUsage(qid: string): Promise<QuestionUseDTO[]> {
  if (typeof qid !== "string" || qid.trim() === "") return [];

  const sets = (await AssessmentSet.find({ "basketItems.qid": qid.trim() })
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
  if (sets.length === 0) return [];

  // Two batched lookups, never one per row.
  const classIds = [...new Set(sets.map((s) => s.classId?.toString()).filter(Boolean))];
  const sectionIds = [...new Set(sets.map((s) => s.sectionId?.toString()).filter(Boolean))];
  const [classes, sections] = await Promise.all([
    Class.find({ _id: { $in: classIds } }).select({ nameBn: 1, level: 1 }).lean(),
    Section.find({ _id: { $in: sectionIds } }).select({ nameBn: 1 }).lean(),
  ]);
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));
  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));

  return sets
    .map((s) => {
      const cls = s.classId ? classById.get(s.classId.toString()) : undefined;
      const sec = s.sectionId ? sectionById.get(s.sectionId.toString()) : undefined;
      const when = s.dueDate ?? s.assembledAt ?? s.createdAt ?? null;
      return {
        setId: s._id.toString(),
        setName: s.name && s.name.trim() !== "" ? s.name : null,
        setType: s.setType,
        status: s.status,
        classLevel: typeof cls?.level === "number" ? cls.level : null,
        className: cls?.nameBn ?? null,
        sectionName: sec?.nameBn ?? null,
        usedOn: when ? new Date(when).toISOString() : null,
      };
    })
    // Newest first: the most recent use is the one that decides whether to reuse. A set with
    // no date at all sorts last rather than being dropped — it is still a use.
    .sort((a, b) => (b.usedOn ?? "").localeCompare(a.usedOn ?? ""));
}
