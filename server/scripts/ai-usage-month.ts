/**
 * AI usage reconciliation (AI-2, D-#1091) — READ-ONLY.
 *
 * Sums the `AiUsage` ledger for one Dhaka month, per provider and model and per feature,
 * so the owner can hold it against the DeepSeek console and Google AI Studio billing. A
 * gap means the price table (`server/src/modules/platform/ai/aiPrices.ts`) is wrong —
 * correct the table in a PR; the ledger keeps its old costs (history is not rewritten).
 *
 *   cd server && npx tsx scripts/ai-usage-month.ts [--month 2026-11]
 *   (no --month = the current Dhaka month)
 *
 * On prod, pipe it from /opt/scdhub/prod with the compiled ledger's database (see the
 * "prod env sourcing" note: node reads .env itself; never `. ./.env`).
 */
import "dotenv/config";
import mongoose from "mongoose";
import { AiUsage } from "../src/modules/platform/models/AiUsage";

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

function monthRange(key: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) throw new Error(`--month must look like 2026-11, got "${key}"`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { from: new Date(Date.UTC(y, mo, 1) - DHAKA_OFFSET_MS), to: new Date(Date.UTC(y, mo + 1, 1) - DHAKA_OFFSET_MS) };
}

function currentMonthKey(): string {
  const local = new Date(Date.now() + DHAKA_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  const i = process.argv.indexOf("--month");
  const month = i > -1 ? process.argv[i + 1] : currentMonthKey();
  const { from, to } = monthRange(month);
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  await mongoose.connect(uri);
  console.log(`database: ${mongoose.connection.db?.databaseName}  month: ${month} (Dhaka)  ${from.toISOString()} → ${to.toISOString()}`);

  const group = (key: Record<string, string>) =>
    AiUsage.aggregate<{ _id: Record<string, string>; calls: number; hit: number; miss: number; out: number; usd: number; capped: number; errors: number }>([
      { $match: { at: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: key,
          calls: { $sum: { $cond: [{ $ne: ["$outcome", "capped"] }, 1, 0] } },
          hit: { $sum: "$cacheHitTokens" },
          miss: { $sum: "$cacheMissTokens" },
          out: { $sum: "$outputTokens" },
          usd: { $sum: "$costUsd" },
          capped: { $sum: { $cond: [{ $eq: ["$outcome", "capped"] }, 1, 0] } },
          errors: { $sum: { $cond: [{ $eq: ["$outcome", "error"] }, 1, 0] } },
        },
      },
      { $sort: { usd: -1 } },
    ]);

  const line = (label: string, r: { calls: number; hit: number; miss: number; out: number; usd: number; capped: number; errors: number }) =>
    `  ${label.padEnd(34)} calls ${String(r.calls).padStart(6)}  cache-hit ${String(r.hit).padStart(10)}  miss ${String(r.miss).padStart(9)}  out ${String(r.out).padStart(9)}  $${r.usd.toFixed(4).padStart(9)}  errors ${r.errors}  capped ${r.capped}`;

  console.log("\nBy provider and model (compare with each provider's console):");
  for (const r of await group({ provider: "$provider", model: "$modelName" })) console.log(line(`${r._id.provider} / ${r._id.model}`, r));
  console.log("\nBy feature:");
  for (const r of await group({ feature: "$feature" })) console.log(line(r._id.feature, r));
  const total = (await group({}))[0];
  console.log(`\nTotal: $${(total?.usd ?? 0).toFixed(4)} over ${total?.calls ?? 0} calls`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
