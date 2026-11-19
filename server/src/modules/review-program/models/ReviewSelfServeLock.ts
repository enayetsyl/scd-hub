/**
 * ReviewSelfServeLock - one tiny lock doc per ReviewProgram that serialises "আরও কাজ দিন" requests.
 *
 * Handing out a chapter is "supersede any open round, then create" (assignPlanReview /
 * assignQuestionReview), so two requests running at once could both pass the gate and the daily cap and
 * then supersede each other's new rounds. The lock is taken with ONE atomic upsert (it only matches a
 * lock that is free or stale) and released in `finally`; a crashed request frees itself after
 * `lockedUntil`. Operational plane, no identity.
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IReviewSelfServeLock extends Document {
  programId: Types.ObjectId;
  lockedUntil: Date;
}

const LockSchema = new Schema<IReviewSelfServeLock>(
  {
    programId: { type: Schema.Types.ObjectId, ref: "ReviewProgram", required: true, unique: true },
    lockedUntil: { type: Date, required: true },
  },
  { timestamps: false },
);

export const ReviewSelfServeLock = model<IReviewSelfServeLock>("ReviewSelfServeLock", LockSchema);

export const SELF_SERVE_LOCK_MS = 60_000;

/** Take the program's lock; false = somebody else holds it (and it is not stale). */
export async function acquireSelfServeLock(programId: Types.ObjectId, now = new Date()): Promise<boolean> {
  try {
    // Matches only a FREE lock; with no match the upsert tries to insert a second doc for the program,
    // which the unique index refuses - that refusal is the "busy" answer.
    await ReviewSelfServeLock.findOneAndUpdate(
      { programId, lockedUntil: { $lt: now } },
      { $set: { lockedUntil: new Date(now.getTime() + SELF_SERVE_LOCK_MS) } },
      { upsert: true },
    );
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

/** How long a request waits for another reviewer's request to finish before answering BUSY. A request
 *  normally holds the lock well under a second, so a tap at the same moment as a colleague's still succeeds. */
export const SELF_SERVE_WAIT_MS = 4_000;

/** Take the program's lock, waiting up to `waitMs` while somebody else holds it; false = still busy. */
export async function waitForSelfServeLock(programId: Types.ObjectId, waitMs = SELF_SERVE_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (await acquireSelfServeLock(programId)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 100 + Math.floor(Math.random() * 100)));
  }
}

export async function releaseSelfServeLock(programId: Types.ObjectId): Promise<void> {
  await ReviewSelfServeLock.updateOne({ programId }, { $set: { lockedUntil: new Date(0) } });
}
