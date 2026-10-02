/**
 * Delivery-day cover takes over the week's assignment (owner ruling 2026-10-02, D-#707).
 *
 * A leave cover normally covers one PERIOD (class note + homework). For the weekly
 * assignment the owner ruled that when the scheduled teacher is absent on the
 * DELIVERY day, the teacher covering that teacher's period of the same subject in the
 * same section that day becomes responsible for the week's assignment — it is the
 * cover who stands in front of the class with the packet. Nothing is moved in the
 * data: `expectedItemsForWeek` reports the cover as the cell's `teacherId`, so every
 * reader (the declare/print pending reports, the Today countdown, the prep prompts,
 * the handout board) follows it at once, and the scheduled teacher is kept as
 * `scheduledTeacherId`. The cover's proxy grant is for that section and subject on
 * that day, so it already passes `assertCanWrite` for the delivery.
 *
 * Both cover mechanisms are read — the routine's direct-assign `RoutineSubstitution`
 * (R-4) and the HR leave-cover `StaffCoverSlot` (PXG-1) — exactly as the handout
 * board and MyDayService do; the HR cover wins when both name a slot.
 */
import { RoutineSlot } from "../routine/models/RoutineSlot";
import { RoutineSubstitution } from "../routine/models/RoutineSubstitution";
import { StaffCoverSlot } from "../hr/models/StaffCoverSlot";
import { liveWindow } from "../routine/liveWindow";
import { DAYS_OF_WEEK } from "@scd/shared";
import { dateKeyOf } from "../attendance/dates";

export interface CoverCell {
  sectionId: string;
  subject: string;
  /** The rotation entry's scheduled teacher — only THEIR period's cover takes over. */
  teacherId: string;
}

const cellKey = (c: CoverCell): string => `${c.sectionId}|${c.subject}|${c.teacherId}`;

/**
 * For each cell, the teacher covering the scheduled teacher's period of that subject in
 * that section on `date` (earliest such period when there are several). Cells with no
 * cover are absent from the map. One query per collection for the whole batch.
 */
export async function deliveryDayCovers(cells: readonly CoverCell[], date: Date): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (cells.length === 0) return out;

  const slots = (await RoutineSlot.find({
    groupType: "section",
    groupId: { $in: [...new Set(cells.map((c) => c.sectionId))] },
    subject: { $in: [...new Set(cells.map((c) => c.subject))] },
    dayOfWeek: DAYS_OF_WEEK[date.getDay()],
    active: true,
    isBreak: false,
    ...liveWindow(date),
  })
    .select("_id groupId subject teacherId periodNumber")
    .lean()) as unknown as Array<{
    _id: { toString(): string };
    groupId: { toString(): string };
    subject: string;
    teacherId?: { toString(): string } | null;
    periodNumber: number;
  }>;
  const wanted = new Set(cells.map(cellKey));
  const mine = slots.filter(
    (s) => s.teacherId && wanted.has(`${s.groupId.toString()}|${s.subject}|${s.teacherId.toString()}`),
  );
  if (mine.length === 0) return out;

  const slotIds = mine.map((s) => s._id);
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const [subs, hrCovers] = await Promise.all([
    RoutineSubstitution.find({ slotId: { $in: slotIds }, active: true, date: { $gte: dayStart, $lte: dayEnd } })
      .select("slotId coverTeacherId")
      .lean(),
    StaffCoverSlot.find({ routineSlotId: { $in: slotIds }, dateKey: dateKeyOf(date), status: "approved" })
      .select("routineSlotId finalCoverTeacherUserId")
      .lean(),
  ]);
  const coverBySlot = new Map<string, string>();
  for (const su of subs) if (su.coverTeacherId) coverBySlot.set(su.slotId.toString(), su.coverTeacherId.toString());
  for (const cs of hrCovers) {
    if (cs.finalCoverTeacherUserId) coverBySlot.set(cs.routineSlotId.toString(), cs.finalCoverTeacherUserId.toString());
  }

  for (const s of [...mine].sort((a, b) => a.periodNumber - b.periodNumber)) {
    const cover = coverBySlot.get(s._id.toString());
    const key = `${s.groupId.toString()}|${s.subject}|${s.teacherId!.toString()}`;
    if (cover && cover !== s.teacherId!.toString() && !out.has(key)) out.set(key, cover);
  }
  return out;
}

export { cellKey as coverCellKey };
