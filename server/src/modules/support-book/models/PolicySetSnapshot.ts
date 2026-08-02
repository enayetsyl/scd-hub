/**
 * PolicySetSnapshot — what a `policySetHash` actually REFERS to (SB-5, D-#403).
 *
 * Every patch, lesson and chat turn is stamped with the hash of the policy set that
 * produced it. Without this collection that stamp is a dead end: you can prove two
 * things were generated under the same policy, but you cannot say WHAT the policy was.
 * The whole point of D-#403 — answering "why is পাঠ 40 written this way" with the
 * policy text **as it stood that day** — needs the hash to be resolvable.
 *
 * It is a MEMO, not a source of truth: the documents themselves live in `PolicyDoc`
 * and are never deleted on supersession, so a snapshot only has to record WHICH
 * versions were in the set. Storing the bodies again would double the storage and
 * create a second thing to keep consistent.
 *
 * Written on first sight of a hash, then left alone. A hash is a pure function of its
 * members, so a row can never need updating — only inserting.
 */
import { Schema, Types, type Document } from "mongoose";
import { POLICY_DOC_KEYS, type PolicyDocKey } from "@scd/shared";
import { bookConnection } from "../../../bookDb";

export interface IPolicySetSnapshot extends Document {
  _id: Types.ObjectId;
  /** sha256 over "docKey:version:sha256" per member, in the fixed set order. */
  hash: string;
  /** The book whose set this was — `LETTER_INVENTORY` makes a set book-specific. */
  bookId: string;
  members: Array<{ docKey: PolicyDocKey; version: number; sha256: string }>;
  /** Keys the set expected and did not find, recorded so a thin set is visible later
   *  rather than looking like a complete one. */
  missing: PolicyDocKey[];
  firstSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PolicySetSnapshotSchema = new Schema<IPolicySetSnapshot>(
  {
    hash: { type: String, required: true },
    bookId: { type: String, required: true },
    members: {
      type: [{
        _id: false,
        docKey: { type: String, enum: POLICY_DOC_KEYS, required: true },
        version: { type: Number, required: true },
        sha256: { type: String, required: true },
      }],
      default: [],
    },
    missing: { type: [String], enum: POLICY_DOC_KEYS, default: [] },
    firstSeenAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

// The resolution lookup. Unique per (hash, book) so a concurrent double-write is a
// duplicate-key error rather than two rows describing the same set.
PolicySetSnapshotSchema.index({ hash: 1, bookId: 1 }, { unique: true });

export const PolicySetSnapshot = bookConnection.model<IPolicySetSnapshot>(
  "PolicySetSnapshot",
  PolicySetSnapshotSchema,
);
