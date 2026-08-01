/**
 * PolicyDoc — the programme's governance, stored as DATA (SB-1, D-#403).
 *
 * The support-book and storybook programmes are governed by documents that live
 * upstream (README, SCHEMA, REF-1 curation policy, REF-2 content register,
 * ASSEMBLY, the per-book letter inventory). The app must READ them at generation
 * time — an authoring chat cannot emit a valid lesson without REF-2's name bank or
 * README §4's writing rules — but AGENTS' scope boundary keeps curriculum
 * governance out of the repo.
 *
 * Repo ≠ system. AGENTS governs what git carries; this collection is what the
 * server reads. It is the same posture the repo already takes toward curriculum
 * content, which is not in the tree either — it arrives as ContentArtifact rows
 * (ADR-006). No policy file enters /docs; no foreign D-series collides with ours.
 *
 * Two properties fall out, both load-bearing:
 *   1. Every generation stamps the ACTIVE SET's hash, so "why is পাঠ 40 written
 *      this way" is answered years later with the policy text as it stood THAT DAY
 *      rather than as it reads now. A superseded version is never deleted.
 *   2. Because prompt caching is a strict prefix match, a versioned byte-stable
 *      document is exactly what lets a ~20k-token policy prefix cache.
 *
 * Prose policy and ENFORCED policy stay separate layers: the model reads this text,
 * while the validator mechanically enforces the checks (README §4.2 — "the
 * validator is the net, not the method").
 */
import { Schema, Types, type Document } from "mongoose";
import { POLICY_DOC_KEYS, type PolicyDocKey } from "@scd/shared";
import { bookConnection } from "../../../bookDb";

export interface IPolicyDoc extends Document {
  _id: Types.ObjectId;
  docKey: PolicyDocKey;
  /** Set ONLY for per-book keys (LETTER_INVENTORY); null for programme-wide docs. */
  bookId: string | null;
  /** Monotonic per (docKey, bookId). Never reused, never rewritten. */
  version: number;
  /** The document verbatim — markdown for prose, raw JSON text for the inventory. */
  body: string;
  /** sha256 of `body`. Two versions with identical text keep distinct rows; the
   *  hash is what the policy-set hash is built from. */
  sha256: string;
  /** False once superseded. Superseded rows are RETAINED — an old timeline entry
   *  must still be able to show the text that was in force. */
  active: boolean;
  activeFrom: Date;
  uploadedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PolicyDocSchema = new Schema<IPolicyDoc>(
  {
    docKey: { type: String, enum: POLICY_DOC_KEYS, required: true },
    bookId: { type: String, default: null },
    version: { type: Number, required: true },
    body: { type: String, required: true },
    sha256: { type: String, required: true },
    active: { type: Boolean, required: true, default: true },
    activeFrom: { type: Date, required: true, default: () => new Date() },
    // Identity lives on the OTHER connection (D-#404) — a bare id, never a ref.
    uploadedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// Assemble the active set for a book (programme-wide docs + that book's inventory).
PolicyDocSchema.index({ active: 1, docKey: 1, bookId: 1 });
// Version history for one document, newest first.
PolicyDocSchema.index({ docKey: 1, bookId: 1, version: -1 });
// One version number per document — makes a concurrent double-activate a write error
// rather than two rows claiming to be v3.
PolicyDocSchema.index({ docKey: 1, bookId: 1, version: 1 }, { unique: true });

export const PolicyDoc = bookConnection.model<IPolicyDoc>("PolicyDoc", PolicyDocSchema);
