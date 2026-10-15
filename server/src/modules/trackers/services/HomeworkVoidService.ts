/**
 * Removing a homework declaration that was never issued (HW-VOID, D-#741).
 *
 * The teacher's own delete (D-#336, `deleteHomeworkItem`) stops at the day's close:
 * once the section is reconciled the declarations are frozen. That leaves no way out
 * for the one kind of item confirm can never issue — a declaration with 0 questions
 * (`confirmHomeworkDay` skips `qCount <= 0`). Prod, 2026-10-15: a C1 teacher filed
 * "ক্লাস টেস্ট নেয়া হবে, জ্যামিতি অধ্যায়ের" — a class note — as Mathematics homework with
 * 0 questions; the day confirmed with "Issued items: 0" and the card stayed on the
 * reconcile screen for good, undeletable by anyone.
 *
 * `homework:void` (Principal + Office) removes such an item regardless of the day's
 * state. The one invariant that matters is unchanged: an item that has spawned student
 * records is NEVER removable — those records are the tracker's history. So the rule is
 * "still `declared` AND no student record", checked against the records themselves,
 * not inferred from `status` alone.
 *
 * Every removal is audited with the full item snapshot — a hard delete leaves nothing
 * else behind, and "who removed my homework?" must stay answerable.
 */
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { ClassNote } from "../../routine/models/ClassNote";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { dateKeyOf } from "../../attendance/dates";

/** How far back the clean-up list looks. Older stragglers are still removable by id. */
export const UNISSUED_LOOKBACK_DAYS = 30;

export interface UnissuedHomeworkDTO {
  itemId: string;
  hwId: string;
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  subject: string;
  dateKey: string;
  timeDecl: number;
  qCount: number;
  description: string | null;
  declaredByName: string;
}

/**
 * Declarations confirm will never issue: `declared` with 0 questions, newest first.
 * School-wide — the caller is Principal/Office (`homework:void`), both admin staff.
 */
export async function listUnissuedHomework(now: Date = new Date()): Promise<UnissuedHomeworkDTO[]> {
  const since = new Date(now.getTime() - UNISSUED_LOOKBACK_DAYS * 86_400_000);
  const items = await HomeworkItem.find({ status: "declared", qCount: { $lte: 0 }, dateGiven: { $gte: since } })
    .sort({ dateGiven: -1, classLevel: 1 })
    .lean();
  if (items.length === 0) return [];

  const ids = <T extends { toString(): string }>(xs: (T | null | undefined)[]): string[] =>
    [...new Set(xs.filter((x): x is T => !!x).map((x) => x.toString()))];
  const [classes, sections, users] = await Promise.all([
    Class.find({ _id: { $in: ids(items.map((i) => i.classId)) } }).select("nameBn").lean(),
    Section.find({ _id: { $in: ids(items.map((i) => i.sectionId)) } }).select("nameBn").lean(),
    User.find({ _id: { $in: ids(items.map((i) => i.declaredBy)) } }).select("name").lean(),
  ]);
  const className = new Map(classes.map((c) => [c._id.toString(), c.nameBn]));
  const sectionName = new Map(sections.map((s) => [s._id.toString(), s.nameBn]));
  const userName = new Map(users.map((u) => [u._id.toString(), u.name]));

  return items.map((i) => ({
    itemId: i._id.toString(),
    hwId: i.hwId,
    classId: i.classId.toString(),
    className: className.get(i.classId.toString()) ?? "",
    sectionId: i.sectionId ? i.sectionId.toString() : "",
    sectionName: i.sectionId ? sectionName.get(i.sectionId.toString()) ?? "" : "",
    subject: i.subject,
    dateKey: dateKeyOf(i.dateGiven as unknown as Date),
    timeDecl: i.timeDecl,
    qCount: i.qCount,
    description: i.description ?? null,
    declaredByName: i.declaredBy ? userName.get(i.declaredBy.toString()) ?? "" : "",
  }));
}

/** Remove a never-issued declaration, whatever the day's reconcile state (D-#741). */
export async function voidHomeworkItem(
  itemId: string,
  actorId: string,
): Promise<{ itemId: string; hwId: string }> {
  const item = await HomeworkItem.findById(itemId).lean();
  if (!item) throw new Error("বাড়ির কাজটি পাওয়া যায়নি");
  if (item.status !== "declared") {
    throw new Error("এই বাড়ির কাজ শিক্ষার্থীদের দেওয়া হয়ে গেছে — মুছে ফেলা যাবে না");
  }
  if (await HomeworkStudentRecord.exists({ hwItemId: item._id })) {
    throw new Error("এই বাড়ির কাজের শিক্ষার্থী-রেকর্ড আছে — মুছে ফেলা যাবে না");
  }
  // Conditional on status so a confirm that issues it in between wins, not the delete.
  const removed = await HomeworkItem.findOneAndDelete({ _id: item._id, status: "declared" }).lean();
  if (!removed) throw new Error("এই বাড়ির কাজ শিক্ষার্থীদের দেওয়া হয়ে গেছে — মুছে ফেলা যাবে না");

  // A class note that declared it (the class-note → homework bridge) keeps its text;
  // only the dangling link goes.
  await ClassNote.updateMany({ homeworkItemId: item._id }, { $unset: { homeworkItemId: 1 } });

  await writeAudit({
    eventKind: "HW_ITEM_VOIDED",
    actorId,
    targetId: item._id,
    targetKind: "HomeworkItem",
    meta: {
      hwId: item.hwId,
      classId: item.classId.toString(),
      sectionId: item.sectionId ? item.sectionId.toString() : null,
      subject: item.subject,
      dateKey: dateKeyOf(item.dateGiven as unknown as Date),
      timeDecl: item.timeDecl,
      qCount: item.qCount,
      description: item.description ?? null,
      declaredBy: item.declaredBy ? item.declaredBy.toString() : null,
    },
  });
  return { itemId: item._id.toString(), hwId: item.hwId };
}
