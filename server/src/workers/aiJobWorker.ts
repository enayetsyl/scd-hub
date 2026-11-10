#!/usr/bin/env node
/**
 * The AI Workspace batch-job worker — a SEPARATE PROCESS from the school API (W-4, D-#1213).
 *
 *   npm run worker:ai --workspace=server        (dev, tsx)
 *   npm run worker:ai:prod --workspace=server   (prod, built JS)
 *
 * Why its own process: a 20-item job is many minutes of calls, each up to 32k tokens out;
 * nothing about it should share the event loop that answers attendance and homework. It is
 * light (no Chromium): one Node process, two items at a time (concurrency 2), well under
 * 200 MB. The queue is the `aijobs` collection — no Redis (D-#1215).
 *
 * Off-peak jobs only start items while DeepSeek is off-peak (aiPrices.ts windows). A worker
 * stopped mid-item leaves it "running"; the next pass queues it again after 20 minutes.
 *
 * VM: a systemd unit next to the API's (ops/systemd/scdhub-ai-worker-{prod,dev}.service).
 */
import "dotenv/config";
import { connectDb, disconnectDb } from "../db";
import { refreshAiConfig } from "../modules/platform/services/AiSettingService";
import { loadRoleTemplateOverrides } from "../modules/access-control/services/RoleTemplateService";
import { registerExpoPushChannel } from "../modules/notifications/services/pushChannel";
import { registerWebPushChannel } from "../modules/notifications/services/webPushChannel";
import { workerTick } from "../modules/ai-workspace/services/JobService";

const TICK_MS = Number(process.env.AI_JOB_TICK_MS ?? 10_000);
const CONCURRENCY = Number(process.env.AI_JOB_CONCURRENCY ?? 2);

let stopping = false;

async function main(): Promise<void> {
  await connectDb();
  await loadRoleTemplateOverrides();
  await refreshAiConfig(true).catch((err) => console.error("[ai-worker] AI settings load failed — using .env:", err));
  // A finished job notifies its starter: this process must push too (the API registers its own).
  registerExpoPushChannel();
  registerWebPushChannel();
  console.log(`[ai-worker] up (concurrency ${CONCURRENCY}, tick ${TICK_MS} ms)`);
  const inFlight = new Set<string>();
  while (!stopping) {
    try {
      await refreshAiConfig();
      const started = await workerTick(CONCURRENCY, {}, inFlight);
      if (started > 0) continue; // more may be waiting
    } catch (err) {
      console.error("[ai-worker] tick failed:", err);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`[ai-worker] ${sig} — finishing the current items, then exiting`);
  });
}

main()
  .then(async () => {
    await disconnectDb();
    console.log("[ai-worker] stopped");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[ai-worker] fatal:", err);
    await disconnectDb().catch(() => undefined);
    process.exit(1);
  });
