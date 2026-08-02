/**
 * PolicySetService — assembles the ACTIVE policy set for a book and hashes it
 * (SB-1, D-#403).
 *
 * The set is: every programme-wide document's active version, plus this book's own
 * `LETTER_INVENTORY` where one exists. Its hash is stamped onto every patch and
 * every merged lesson, which is what makes "why is পাঠ 40 written this way"
 * answerable years later with the policy text **as it stood that day** rather than
 * as it reads now.
 *
 * ORDER IS FIXED AND MUST STAY FIXED. Two reasons, and the second is the one people
 * forget: a stable order makes the hash reproducible, and — once SB-6 lands — it is
 * what lets a ~20k-token policy prefix actually cache, because prompt caching is a
 * strict prefix match. Sorting differently per call would silently halve nothing and
 * cost real money.
 */
import { createHash } from "node:crypto";
import { PolicyDoc, type IPolicyDoc } from "../models/PolicyDoc";
import { PER_BOOK_POLICY_DOC_KEYS, POLICY_DOC_KEYS, type PolicyDocKey } from "@scd/shared";
import type { LetterInventory } from "./validator/letterAudit";

/** The fixed concatenation order (see the header). Programme-wide docs first, in
 *  reading order, with the per-book inventory last because it is the only member
 *  that changes from book to book. */
const SET_ORDER: PolicyDocKey[] = [
  "README",
  "PROJECT_INSTRUCTIONS",
  "SCHEMA",
  "REF1_CURATION",
  "REF2_REGISTER",
  "ASSEMBLY",
  "DECISIONS",
  "LETTER_INVENTORY",
];

export interface PolicySet {
  docs: IPolicyDoc[];
  /** sha256 over "docKey:version:sha256" per member, in SET_ORDER. */
  hash: string;
  /** Keys expected but not present — reported, never silently tolerated. */
  missing: PolicyDocKey[];
}

/** Assemble the active set for a book. A missing document is REPORTED rather than
 *  skipped: generating against an incomplete policy set is exactly the failure the
 *  hash exists to make visible. */
export async function activePolicySet(bookId: string): Promise<PolicySet> {
  const docs = await PolicyDoc.find({
    active: true,
    $or: [{ bookId: null }, { bookId }],
  }).lean<IPolicyDoc[]>();

  const byKey = new Map<PolicyDocKey, IPolicyDoc>();
  for (const d of docs) {
    // A per-book document must match THIS book; a programme-wide one has bookId null.
    if (PER_BOOK_POLICY_DOC_KEYS.includes(d.docKey) && d.bookId !== bookId) continue;
    byKey.set(d.docKey, d);
  }

  const ordered: IPolicyDoc[] = [];
  const missing: PolicyDocKey[] = [];
  for (const key of SET_ORDER) {
    const d = byKey.get(key);
    if (d) ordered.push(d);
    else missing.push(key);
  }

  const h = createHash("sha256");
  for (const d of ordered) h.update(`${d.docKey}:${d.version}:${d.sha256}\n`);
  return { docs: ordered, hash: h.digest("hex"), missing };
}

/** The book's letter inventory, parsed — or null when it has none.
 *  A parse failure returns null rather than throwing, so the validator reports
 *  "inventory missing" (a RED it already handles) instead of the merge blowing up
 *  with a stack trace the author cannot act on. */
export function letterInventoryFrom(set: PolicySet): LetterInventory | null {
  const doc = set.docs.find((d) => d.docKey === "LETTER_INVENTORY");
  if (!doc) return null;
  try {
    const parsed = JSON.parse(doc.body) as LetterInventory;
    return parsed && typeof parsed === "object" && parsed.lessons ? parsed : null;
  } catch {
    return null;
  }
}

/** sha256 of a document body — the value stored on PolicyDoc.sha256. */
export function bodyHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

/** Activate a new version of a document, superseding the previous active one.
 *  Version numbers are monotonic per (docKey, bookId); the unique index on the model
 *  turns a concurrent double-activate into a write error rather than two rows both
 *  claiming to be v3. */
export async function activatePolicyDoc(params: {
  docKey: PolicyDocKey;
  bookId?: string | null;
  body: string;
  uploadedBy: import("mongoose").Types.ObjectId;
}): Promise<IPolicyDoc> {
  if (!POLICY_DOC_KEYS.includes(params.docKey)) {
    throw new Error(`unknown policy doc key: ${params.docKey}`);
  }
  const isPerBook = PER_BOOK_POLICY_DOC_KEYS.includes(params.docKey);
  const bookId = isPerBook ? (params.bookId ?? null) : null;
  if (isPerBook && !bookId) throw new Error(`${params.docKey} is per-book and needs a bookId`);

  const latest = await PolicyDoc.findOne({ docKey: params.docKey, bookId }).sort({ version: -1 }).lean<IPolicyDoc>();
  const version = (latest?.version ?? 0) + 1;

  // Supersede first: two active versions of one document would make the set
  // ambiguous, and an ambiguous set makes every hash downstream meaningless.
  await PolicyDoc.updateMany({ docKey: params.docKey, bookId, active: true }, { $set: { active: false } });

  return PolicyDoc.create({
    docKey: params.docKey,
    bookId,
    version,
    body: params.body,
    sha256: bodyHash(params.body),
    active: true,
    activeFrom: new Date(),
    uploadedBy: params.uploadedBy,
  });
}
