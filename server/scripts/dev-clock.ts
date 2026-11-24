/**
 * AL-14: the dev-site clock control. LEAD-ONLY, on the dev VM. The dev API re-reads the doc within 60 s (no restart).
 * Refuses unless the DB name ends in `_dev`, the outgoing guard is closed and MONGODB_URI is not PROD_MONGODB_URI
 * (same guard as dev-mask). Needs `DEV_CLOCK_ALLOWED=1` in the dev API's environment to take effect there.
 *
 *   npx tsx server/scripts/dev-clock.ts show
 *   npx tsx server/scripts/dev-clock.ts set 2027-02-28 [--time 08:30]   # NOW = that Dhaka day (current time-of-day unless --time)
 *   npx tsx server/scripts/dev-clock.ts advance <days>                  # move forward (a few days at a time)
 *   npx tsx server/scripts/dev-clock.ts off                             # offset 0
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/db";
import { assertDevTarget } from "../src/lib/devData/guards";
import { dhakaDayKey } from "../src/lib/dhakaDay";
import { assertForwardOnly, offsetAdvanced, offsetForSet } from "../src/lib/devClockMath";
import { DEV_CLOCK_COLLECTION } from "../src/lib/devClockInstall";

function describe(offsetMs: number, label: string): string {
  const shifted = new Date(Date.now() + offsetMs);
  return `${label}: Dhaka today=${dhakaDayKey(shifted)} offsetDays=${(offsetMs / 86_400_000).toFixed(2)} (real today=${dhakaDayKey(new Date())})`;
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  if (!cmd || !["show", "set", "advance", "off"].includes(cmd)) {
    throw new Error("usage: dev-clock.ts show | set <YYYY-MM-DD> [--time HH:MM] | advance <days> | off");
  }
  await connectDb();
  try {
    assertDevTarget();
    console.log(`databaseName: ${mongoose.connection.db?.databaseName ?? "(unknown)"}`);
    const col = mongoose.connection.db!.collection(DEV_CLOCK_COLLECTION);
    const cur = (await col.findOne({ _id: "clock" as never })) as { offsetMs?: number } | null;
    const before = typeof cur?.offsetMs === "number" ? cur.offsetMs : 0;
    if (cmd === "show") {
      console.log(describe(before, "dev clock"));
      return;
    }
    if (cmd === "set" || cmd === "advance") assertForwardOnly(cmd, dhakaDayKey(new Date(Date.now() + before)), arg ?? "");
    let next: number;
    if (cmd === "off") next = 0;
    else if (cmd === "advance") {
      const days = Number(arg);
      if (!arg || !Number.isInteger(days)) throw new Error("advance needs a whole number of days");
      next = offsetAdvanced(before, days);
    } else {
      if (!arg) throw new Error("set needs a day YYYY-MM-DD");
      const ti = process.argv.indexOf("--time");
      const time = ti >= 0 ? process.argv[ti + 1] : undefined;
      next = offsetForSet(arg, new Date(), time);
    }
    await col.updateOne(
      { _id: "clock" as never },
      { $set: { offsetMs: next, setAt: new Date(), setBy: "lead-script", note: `dev-clock ${cmd}${arg ? " " + arg : ""}` } },
      { upsert: true },
    );
    if (cmd === "off") {
      // Login throttle windows were stamped on the shifted clock; clear them on this `_dev` database.
      const cleared = await mongoose.connection.db!.collection("loginthrottles").deleteMany({});
      console.log(`cleared ${cleared.deletedCount} login throttle row(s) (loginthrottles)`);
    }
    console.log(describe(next, "dev clock now"));
    console.log("the dev API picks it up within 60 s; testers' sessions issued before a jump may need a new login");
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error(String((err as Error)?.message ?? err));
  process.exit(1);
});
