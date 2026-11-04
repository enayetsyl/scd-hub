/**
 * StaffMistakeNoteService (D-#952) — the one call the MR-6+ places make:
 *
 *   recordPlaceMistake({ kind, refKey, ownerId, correctedBy, at, line })
 *
 * appends the line to the open episode for (kind × refKey × owner) and makes it a StaffMistake
 * for the owner (explained later). Never throws: a failure is logged, and the action that
 * revealed the mistake goes ahead regardless.
 */
import { Types } from "mongoose";
import type { StaffMistakeKind } from "@scd/shared";
import { personName } from "../../../lib/personName";
import { StaffMistake } from "../models/StaffMistake";
import { StaffMistakeNote } from "../models/StaffMistakeNote";
import { User } from "../../foundation/models/User";
import { recordMistakeFromSource } from "./StaffMistakeService";

export interface PlaceMistakeInput {
  kind: StaffMistakeKind;
  /** Names the thing that changed — the same key gathers further changes while open. */
  refKey: string;
  /** Whose mistake it is; missing (old rows) → nothing is recorded. */
  ownerId: Types.ObjectId | string | null | undefined;
  correctedBy: string;
  at: Date;
  /** One Bangla line for the card. */
  line: string;
  tier?: number;
}

export async function recordPlaceMistake(ev: PlaceMistakeInput): Promise<boolean> {
  try {
    if (!ev.ownerId || !Types.ObjectId.isValid(ev.ownerId.toString())) return false;
    const owner = new Types.ObjectId(ev.ownerId.toString());
    const base = { kind: ev.kind, refKey: ev.refKey, staffUserId: owner };
    const last = await StaffMistakeNote.findOne(base).sort({ episode: -1 }).select("_id episode").lean();
    let episode = last?.episode ?? 1;
    if (last) {
      const entry = await StaffMistake.findOne({ kind: ev.kind, sourceId: last._id, staffUserId: owner }).select("status").lean();
      if (entry && entry.status !== "EXPLANATION_DUE") episode += 1;
    }
    const key = { ...base, episode };
    const line = { text: ev.line.slice(0, 500), at: ev.at, by: Types.ObjectId.isValid(ev.correctedBy) ? new Types.ObjectId(ev.correctedBy) : owner };
    let note;
    try {
      note = await StaffMistakeNote.findOneAndUpdate(key, { $setOnInsert: key, $push: { lines: line } }, { upsert: true, new: true });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      note = await StaffMistakeNote.findOneAndUpdate(key, { $push: { lines: line } }, { new: true });
    }
    if (!note) return false;
    await recordMistakeFromSource({ kind: ev.kind, tier: ev.tier ?? 1, sourceId: note._id, staffUserId: owner, correctedBy: ev.correctedBy, at: ev.at });
    return true;
  } catch (err) {
    console.error(`[StaffMistakeNoteService] recording ${ev.kind} failed (the action went ahead):`, err);
    return false;
  }
}

export interface StaffMistakeNoteShape {
  id: string;
  lines: { text: string; at: Date; byName: string }[];
}

export async function staffMistakeNotesByIds(ids: readonly string[]): Promise<Map<string, StaffMistakeNoteShape>> {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length === 0) return new Map();
  const notes = await StaffMistakeNote.find({ _id: { $in: valid } }).lean();
  const users = await User.find({ _id: { $in: notes.flatMap((n) => n.lines.map((l) => l.by)) } }).select("name nameBn").lean();
  const name = new Map(users.map((u) => [String(u._id), personName(u)]));
  return new Map(
    notes.map((n) => [
      String(n._id),
      { id: String(n._id), lines: n.lines.map((l) => ({ text: l.text, at: l.at, byName: name.get(String(l.by)) ?? "" })) },
    ]),
  );
}
