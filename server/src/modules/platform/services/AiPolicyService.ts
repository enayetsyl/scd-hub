/**
 * AiPolicyService (AI-3, D-#1093) — versioned AI rules.
 *
 *   read   `ai_assist:read_rules` (teachers + Office): the ACTIVE version of each key — it
 *          doubles as the teachers' training sheet.
 *   write  `ai_assist:edit_rules` (Principal): every version, save a new one, switch one on,
 *          switch a key off. Saving never edits a version; it adds the next number.
 *
 * `activeAiPolicy(key)` is the internal read the AI features use; its `hash`
 * (`key@vN#sha12`) is stamped on every AI result and ledger row (D-#1093).
 *
 * Seed (AI-3s, D-#1102): on boot, a key with NO version gets v1 from
 * `server/assets/ai-policies/<key>.md` — INACTIVE, so nothing runs until the owner has
 * read, edited and switched on a standard.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { User } from "../../foundation/models/User";
import { AiPolicy, AI_POLICY_KEYS, type AiPolicyKey, type IAiPolicy } from "../models/AiPolicy";
import { writeAudit } from "./AuditService";

export const AI_POLICY_LABELS: Record<AiPolicyKey, { bn: string; en: string }> = {
  comment_standard: { bn: "দৈনিক মন্তব্যের মানদণ্ড", en: "Daily comment standard" },
  ct_comment_standard: { bn: "ক্লাস টেস্টের মন্তব্যের মানদণ্ড", en: "Class-test comment standard" },
  assistant_rules: { bn: "শিক্ষকের সহকারীর নিয়ম", en: "Teacher assistant rules" },
};

export const AI_POLICY_ASSET_DIR = path.resolve(__dirname, "../../../../assets/ai-policies");
const MIN_BODY = 20;
const MAX_BODY = 60_000;

export const bodyHashOf = (body: string): string => createHash("sha256").update(body).digest("hex").slice(0, 12);
export const policyHashOf = (key: string, version: number, bodyHash: string): string => `${key}@v${version}#${bodyHash}`;

export interface ActiveAiPolicy {
  key: AiPolicyKey;
  version: number;
  body: string;
  hash: string;
}

export interface AiPolicyVersionView {
  id: string;
  key: AiPolicyKey;
  version: number;
  body: string;
  hash: string;
  note: string | null;
  active: boolean;
  createdAt: Date;
  createdByName: string | null;
  activatedAt: Date | null;
}

export interface AiPolicySummary {
  key: AiPolicyKey;
  labelBn: string;
  labelEn: string;
  activeVersion: number | null;
  latestVersion: number | null;
  versions: number;
}

function parseKey(k: string): AiPolicyKey {
  if ((AI_POLICY_KEYS as readonly string[]).includes(k)) return k as AiPolicyKey;
  throw new Error("এই নিয়মের তালিকাটি চেনা যায়নি");
}

function assertRead(auth: AuthPayload | null): AuthPayload {
  if (!auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(auth, "ai_assist:read_rules") && !callerHasPermission(auth, "ai_assist:edit_rules")) {
    throw new ForbiddenError("এআই-এর নিয়ম দেখার অনুমতি নেই");
  }
  return auth;
}

function assertEdit(auth: AuthPayload | null): AuthPayload {
  if (!auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(auth, "ai_assist:edit_rules")) throw new ForbiddenError("এআই-এর নিয়ম বদলানোর অনুমতি নেই");
  return auth;
}

type PolicyDoc = Pick<IAiPolicy, "_id" | "key" | "version" | "body" | "bodyHash" | "note" | "active" | "createdAt" | "createdBy" | "activatedAt">;

async function views(docs: PolicyDoc[]): Promise<AiPolicyVersionView[]> {
  const ids = [...new Set(docs.map((d) => d.createdBy?.toString()).filter(Boolean))] as string[];
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select("name").lean() : [];
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));
  return docs.map((d) => ({
    id: d._id.toString(),
    key: d.key,
    version: d.version,
    body: d.body,
    hash: policyHashOf(d.key, d.version, d.bodyHash),
    note: d.note ?? null,
    active: d.active,
    createdAt: d.createdAt,
    createdByName: d.createdBy ? nameOf.get(d.createdBy.toString()) ?? null : null,
    activatedAt: d.activatedAt ?? null,
  }));
}

/** Internal: the active version of a key, or null (then the feature does not run). */
export async function activeAiPolicy(keyIn: string): Promise<ActiveAiPolicy | null> {
  const key = parseKey(keyIn);
  const d = (await AiPolicy.findOne({ key, active: true }).sort({ version: -1 }).lean()) as PolicyDoc | null;
  return d ? { key, version: d.version, body: d.body, hash: policyHashOf(key, d.version, d.bodyHash) } : null;
}

export async function aiPolicySummaries(authIn: AuthPayload | null): Promise<AiPolicySummary[]> {
  assertRead(authIn);
  const agg = await AiPolicy.aggregate<{ _id: AiPolicyKey; latest: number; versions: number; active: number | null }>([
    { $group: { _id: "$key", latest: { $max: "$version" }, versions: { $sum: 1 }, active: { $max: { $cond: ["$active", "$version", null] } } } },
  ]);
  return AI_POLICY_KEYS.map((key) => {
    const a = agg.find((x) => x._id === key);
    return {
      key,
      labelBn: AI_POLICY_LABELS[key].bn,
      labelEn: AI_POLICY_LABELS[key].en,
      activeVersion: a?.active ?? null,
      latestVersion: a?.latest ?? null,
      versions: a?.versions ?? 0,
    };
  });
}

/** The active version's text for a teacher (training sheet), or null. */
export async function activeAiPolicyView(authIn: AuthPayload | null, keyIn: string): Promise<AiPolicyVersionView | null> {
  assertRead(authIn);
  const key = parseKey(keyIn);
  const d = (await AiPolicy.findOne({ key, active: true }).sort({ version: -1 }).lean()) as PolicyDoc | null;
  return d ? (await views([d]))[0] : null;
}

export async function aiPolicyVersionsPage(authIn: AuthPayload | null, keyIn: string, args: PageArgs): Promise<Page<AiPolicyVersionView>> {
  assertEdit(authIn);
  const key = parseKey(keyIn);
  return queryPage(AiPolicy, { key }, { version: -1 }, args, (docs) => views(docs as unknown as PolicyDoc[]), 20);
}

export async function aiPolicyVersion(authIn: AuthPayload | null, id: string): Promise<AiPolicyVersionView> {
  assertEdit(authIn);
  if (!Types.ObjectId.isValid(id)) throw new Error("সংস্করণটি পাওয়া যায়নি");
  const d = (await AiPolicy.findById(id).lean()) as PolicyDoc | null;
  if (!d) throw new Error("সংস্করণটি পাওয়া যায়নি");
  return (await views([d]))[0];
}

/** Adds the next version (INACTIVE). Identical text to the latest version is refused. */
export async function saveAiPolicyVersion(authIn: AuthPayload | null, input: { key: string; body: string; note?: string | null }): Promise<AiPolicyVersionView> {
  const auth = assertEdit(authIn);
  const key = parseKey(input.key);
  const body = (input.body ?? "").replace(/\r\n/g, "\n").trim();
  if (body.length < MIN_BODY) throw new Error("নিয়মের লেখা খুব ছোট");
  if (body.length > MAX_BODY) throw new Error("নিয়মের লেখা খুব বড় (৬০,০০০ অক্ষরের বেশি)");
  const note = input.note?.trim() || undefined;
  const bodyHash = bodyHashOf(body);

  for (let tries = 0; tries < 3; tries++) {
    const latest = (await AiPolicy.findOne({ key }).sort({ version: -1 }).select("version bodyHash").lean()) as { version: number; bodyHash: string } | null;
    if (latest?.bodyHash === bodyHash) throw new Error("আগের সংস্করণের সঙ্গে কোনো পার্থক্য নেই");
    const version = (latest?.version ?? 0) + 1;
    try {
      const doc = await AiPolicy.create({ key, version, body, bodyHash, note, active: false, createdBy: new Types.ObjectId(auth.userId) });
      await writeAudit({
        eventKind: "AI_POLICY_SAVED",
        actorId: auth.userId,
        actorRole: auth.role,
        targetKind: "AiPolicy",
        targetId: doc._id.toString(),
        meta: { key, version, hash: policyHashOf(key, version, bodyHash), chars: body.length },
      });
      return (await views([doc.toObject() as unknown as PolicyDoc]))[0];
    } catch (err) {
      // Two saves at once took the same number — take the next one.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  throw new Error("সংরক্ষণ করা যায়নি — আবার চেষ্টা করুন");
}

/** Switches one version on; every other version of its key goes off. */
export async function activateAiPolicyVersion(authIn: AuthPayload | null, id: string): Promise<AiPolicyVersionView> {
  const auth = assertEdit(authIn);
  if (!Types.ObjectId.isValid(id)) throw new Error("সংস্করণটি পাওয়া যায়নি");
  const d = (await AiPolicy.findById(id).lean()) as PolicyDoc | null;
  if (!d) throw new Error("সংস্করণটি পাওয়া যায়নি");
  await AiPolicy.updateMany({ key: d.key, _id: { $ne: d._id }, active: true }, { $set: { active: false } });
  await AiPolicy.updateOne({ _id: d._id }, { $set: { active: true, activatedAt: new Date(), activatedBy: new Types.ObjectId(auth.userId) } });
  await writeAudit({
    eventKind: "AI_POLICY_ACTIVATED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "AiPolicy",
    targetId: d._id.toString(),
    meta: { key: d.key, version: d.version, hash: policyHashOf(d.key, d.version, d.bodyHash) },
  });
  return aiPolicyVersion(auth, id);
}

/** Switches a key off: no version active, so the feature that reads it stops. */
export async function deactivateAiPolicy(authIn: AuthPayload | null, keyIn: string): Promise<AiPolicySummary> {
  const auth = assertEdit(authIn);
  const key = parseKey(keyIn);
  const res = await AiPolicy.updateMany({ key, active: true }, { $set: { active: false } });
  if (res.modifiedCount > 0) {
    await writeAudit({ eventKind: "AI_POLICY_DEACTIVATED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiPolicy", meta: { key } });
  }
  return (await aiPolicySummaries(auth)).find((s) => s.key === key)!;
}

/**
 * Boot seed (AI-3s): v1 from server/assets/ai-policies/<key>.md for every key that has no
 * version yet — INACTIVE. Idempotent (the unique (key, version) index stops a double seed).
 * Returns the keys seeded.
 */
export async function seedAiPolicies(dir: string = AI_POLICY_ASSET_DIR): Promise<string[]> {
  const seeded: string[] = [];
  for (const key of AI_POLICY_KEYS) {
    const file = path.join(dir, `${key}.md`);
    if (!existsSync(file)) continue;
    if (await AiPolicy.exists({ key })) continue;
    const body = readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
    try {
      await AiPolicy.create({ key, version: 1, body, bodyHash: bodyHashOf(body), note: "প্রস্তাবিত খসড়া — বাস্তব মন্তব্য বিশ্লেষণ থেকে (Claude Code, ২০২৬-১১-০৮)", active: false });
      seeded.push(key);
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  return seeded;
}
