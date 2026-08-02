/**
 * BookActorService — turns bare actor ids into names (SB-5, D-#404/#411).
 *
 * THE ONE PLACE A BOOK READ TOUCHES IDENTITY, and it is deliberately here rather than
 * anywhere near a model. D-#404 puts the book plane on its own connection precisely so
 * that no schema can `ref` a `User` and no query can `populate` one. That leaves the
 * resolver layer to join the two by id — which is allowed, and is exactly what this
 * does — but it should happen in one named place that can be pointed at, not scattered
 * through six resolvers.
 *
 * The timeline is unreadable without it: "actor 6512ab…" tells a reader nothing about
 * why a sentence reads the way it does, and the whole value of the editorial log is
 * that a person can follow it years later.
 *
 * BATCHED ON PURPOSE. A 200-row timeline resolved one id at a time is 200 round trips
 * to the other connection; a book's timeline is one of the few reads here that can be
 * long.
 */
import { Types } from "mongoose";
import { User } from "../../foundation/models/User";

export interface ActorName {
  userId: string;
  /** The display name, or a stable placeholder — never an empty string, which renders
   *  as a gap that looks like a bug. */
  name: string;
  /** False when the id resolves to nothing: a deleted staff account, or a seed row.
   *  Surfaced rather than hidden, because "unknown author" is a real answer. */
  known: boolean;
}

/**
 * Resolve many actor ids at once. Never throws — a name lookup failing must not take
 * down the timeline it decorates, which is the only reason anyone opened the page.
 */
export async function resolveActors(ids: Array<Types.ObjectId | string>): Promise<Map<string, ActorName>> {
  const out = new Map<string, ActorName>();
  const unique = [...new Set(ids.map(String))].filter((id) => Types.ObjectId.isValid(id));
  if (!unique.length) return out;

  try {
    // Cross-connection by ID ONLY (D-#404). No populate, no $lookup — those cannot
    // work across connections, which is the guarantee, not an inconvenience.
    const users = await User.find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } })
      .select("_id name email")
      .lean();
    for (const u of users) {
      const rec = u as unknown as { _id: Types.ObjectId; name?: string; email?: string };
      out.set(String(rec._id), {
        userId: String(rec._id),
        name: rec.name || rec.email || "(unnamed account)",
        known: true,
      });
    }
  } catch {
    // Fall through to placeholders below.
  }

  for (const id of unique) {
    if (!out.has(id)) out.set(id, { userId: id, name: "(unknown account)", known: false });
  }
  return out;
}

/** One id. Convenience over the batch; still never throws. */
export async function resolveActor(id: Types.ObjectId | string): Promise<ActorName> {
  const m = await resolveActors([id]);
  return m.get(String(id)) ?? { userId: String(id), name: "(unknown account)", known: false };
}
