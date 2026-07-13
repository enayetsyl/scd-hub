/**
 * ReconReportService — the Principal/Office "who didn't reconcile?" report.
 *
 * Homework reconciles DAILY (declare → the class teacher's confirmHomeworkDay
 * spawns the per-student records, HW-T2); assignments reconcile WEEKLY
 * (deliver → confirmAssignmentWeek, AS-T6). A miss means declarations/deliveries
 * exist but the confirm never happened — the per-student records don't exist, so
 * students silently get no due dates, no checking, no chases (live prod finding
 * 2026-07-13: Nursery had declared homework and had NEVER been confirmed).
 *
 *   hwReconMisses — per (class, day) in the range: ≥1 still-`declared` item and
 *                   the day's reconciliation is not `reconciled` (the same rule
 *                   as the pendingHomeworkSections reminder ladder — lockstep).
 *   asReconMisses — per (section, week) whose §4-resolved deliveryDate falls in
 *                   the range: ≥1 still-DRAFT item (records never spawned).
 *
 * Rows carry the section + class teacher (the accountable confirmer) so the
 * report answers "WHO didn't submit", not just "what's missing".
 * Identity/operational plane — no corpus path (ADR-005).
 */
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkReconciliation, reconDayKey } from "../models/HomeworkReconciliation";
import { AssignmentItem } from "../models/AssignmentItem";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { dateKeyOf, parseDateKey } from "../../attendance/dates";

export interface HwReconMiss {
  dateKey: string;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  /** The accountable confirmer: homework delegate ?? class teacher. Null = nobody assigned. */
  confirmerName: string | null;
  declaredItems: number;
  declaredMinutes: number;
}

export interface AsReconMiss {
  weekNumber: number;
  deliveryDateKey: string;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  /** The accountable confirmer: the section's class teacher. Null = nobody assigned. */
  confirmerName: string | null;
  draftItems: number;
  draftMinutes: number;
}

export interface ReconReport {
  fromKey: string;
  toKey: string;
  hwMisses: HwReconMiss[];
  asMisses: AsReconMiss[];
}

interface SectionInfo {
  nameBn: string;
  classLevel: number;
  confirmerName: string | null;
  hwConfirmerName: string | null;
}

/** Batched section → (name, class level, class-teacher/delegate names). */
async function sectionInfoMap(sectionIds: string[]): Promise<Map<string, SectionInfo>> {
  if (sectionIds.length === 0) return new Map();
  const sections = await Section.find({ _id: { $in: sectionIds } })
    .select("nameBn classId classTeacherId homeworkConfirmerId")
    .lean();
  const classes = await Class.find({ _id: { $in: sections.map((s) => s.classId) } })
    .select("level")
    .lean();
  const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level]));
  const userIds = new Set<string>();
  for (const s of sections) {
    if (s.classTeacherId) userIds.add(s.classTeacherId.toString());
    if (s.homeworkConfirmerId) userIds.add(s.homeworkConfirmerId.toString());
  }
  const users = userIds.size
    ? await User.find({ _id: { $in: [...userIds] } }).select("name").lean()
    : [];
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));

  const out = new Map<string, SectionInfo>();
  for (const s of sections) {
    const ctName = s.classTeacherId ? (nameOf.get(s.classTeacherId.toString()) ?? null) : null;
    const delegateName = s.homeworkConfirmerId ? (nameOf.get(s.homeworkConfirmerId.toString()) ?? null) : null;
    out.set(s._id.toString(), {
      nameBn: s.nameBn,
      classLevel: levelOf.get(s.classId.toString()) ?? 0,
      confirmerName: ctName,
      hwConfirmerName: delegateName ?? ctName,
    });
  }
  return out;
}

/** Inclusive local-day range bounds for a [fromKey, toKey] date-key pair. */
function rangeBounds(fromKey: string, toKey: string): { start: Date; end: Date } {
  const start = parseDateKey(fromKey);
  const last = parseDateKey(toKey);
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999);
  if (start.getTime() > end.getTime()) throw new Error("from must not be after to");
  return { start, end };
}

export async function reconciliationReport(fromKey: string, toKey: string): Promise<ReconReport> {
  const { start, end } = rangeBounds(fromKey, toKey);

  // --- Homework: (class, day) buckets of still-declared items in the range ------
  const hwItems = await HomeworkItem.find({
    status: "declared",
    dateGiven: { $gte: start, $lte: end },
  })
    .select("classId sectionId dateGiven timeDecl")
    .lean();

  const hwBuckets = new Map<
    string,
    { classId: string; sectionId: string; dateKey: string; items: number; minutes: number }
  >();
  for (const it of hwItems) {
    const dateKey = dateKeyOf(new Date(it.dateGiven));
    const key = `${it.classId.toString()}|${dateKey}`;
    const b =
      hwBuckets.get(key) ??
      hwBuckets
        .set(key, {
          classId: it.classId.toString(),
          sectionId: it.sectionId.toString(),
          dateKey,
          items: 0,
          minutes: 0,
        })
        .get(key)!;
    b.items += 1;
    b.minutes += it.timeDecl ?? 0;
  }

  // Drop buckets whose day WAS reconciled (same rule as pendingHomeworkSections).
  let hwPending = [...hwBuckets.values()];
  if (hwPending.length > 0) {
    const recons = await HomeworkReconciliation.find({
      classId: { $in: [...new Set(hwPending.map((b) => b.classId))] },
      reconDate: { $gte: reconDayKey(start), $lte: reconDayKey(end) },
      reconState: "reconciled",
    })
      .select("classId reconDate")
      .lean();
    const reconciled = new Set(
      recons.map((r) => `${r.classId.toString()}|${dateKeyOf(new Date(r.reconDate))}`),
    );
    hwPending = hwPending.filter((b) => !reconciled.has(`${b.classId}|${b.dateKey}`));
  }

  // --- Assignments: (section, week) buckets of still-DRAFT items in the range ---
  const asItems = await AssignmentItem.find({
    status: "DRAFT",
    deliveryDate: { $gte: start, $lte: end },
  })
    .select("sectionId weekNumber deliveryDate estMinutes")
    .lean();

  const asBuckets = new Map<
    string,
    { sectionId: string; weekNumber: number; deliveryDateKey: string; items: number; minutes: number }
  >();
  for (const it of asItems) {
    const key = `${it.sectionId.toString()}|${it.weekNumber}`;
    const b =
      asBuckets.get(key) ??
      asBuckets
        .set(key, {
          sectionId: it.sectionId.toString(),
          weekNumber: it.weekNumber,
          deliveryDateKey: dateKeyOf(new Date(it.deliveryDate)),
          items: 0,
          minutes: 0,
        })
        .get(key)!;
    b.items += 1;
    b.minutes += it.estMinutes ?? 0;
  }
  const asPending = [...asBuckets.values()];

  // --- Enrich with section/class/confirmer names (one batched pass) -------------
  const info = await sectionInfoMap([
    ...new Set([...hwPending.map((b) => b.sectionId), ...asPending.map((b) => b.sectionId)]),
  ]);

  const hwMisses: HwReconMiss[] = hwPending
    .map((b) => {
      const s = info.get(b.sectionId);
      return {
        dateKey: b.dateKey,
        sectionId: b.sectionId,
        sectionNameBn: s?.nameBn ?? b.sectionId,
        classLevel: s?.classLevel ?? 0,
        confirmerName: s?.hwConfirmerName ?? null,
        declaredItems: b.items,
        declaredMinutes: b.minutes,
      };
    })
    .sort((a, b) => (a.dateKey === b.dateKey ? a.classLevel - b.classLevel : a.dateKey < b.dateKey ? 1 : -1));

  const asMisses: AsReconMiss[] = asPending
    .map((b) => {
      const s = info.get(b.sectionId);
      return {
        weekNumber: b.weekNumber,
        deliveryDateKey: b.deliveryDateKey,
        sectionId: b.sectionId,
        sectionNameBn: s?.nameBn ?? b.sectionId,
        classLevel: s?.classLevel ?? 0,
        confirmerName: s?.confirmerName ?? null,
        draftItems: b.items,
        draftMinutes: b.minutes,
      };
    })
    .sort((a, b) =>
      a.deliveryDateKey === b.deliveryDateKey ? a.classLevel - b.classLevel : a.deliveryDateKey < b.deliveryDateKey ? 1 : -1,
    );

  return { fromKey, toKey, hwMisses, asMisses };
}
