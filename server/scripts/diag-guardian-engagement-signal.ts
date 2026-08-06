// READ-ONLY: how much guardian-engagement signal actually exists today?
// Counts login-enabled guardians, guardian LOGIN_SUCCESS audit rows over time,
// and Notification read-rates per guardian. Nothing is written.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
const uri = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();

async function main() {
  const client = new MongoClient(uri);
  await client.connect();

  const admin = await client.db().admin().listDatabases();
  console.log("DATABASES:", admin.databases.map((d) => d.name).join(", "));
  const dbName = process.argv[2] ?? uri.match(/\/([^/?]+)(\?|$)/)?.[1] ?? "scdhub_prod";
  console.log("USING DB:", dbName, "\n");
  const db = client.db(dbName);

  // --- 1. Guardian population + how many can even produce a signal ---
  const gTotal = await db.collection("guardians").countDocuments({ active: { $ne: false } });
  const gLogin = await db.collection("guardians").countDocuments({ active: { $ne: false }, loginEnabled: true });
  console.log(`GUARDIANS: ${gTotal} active, ${gLogin} login-enabled (${gTotal ? Math.round((gLogin / gTotal) * 100) : 0}%)`);
  console.log(`  -> ${gTotal - gLogin} guardians can produce NO engagement signal at all\n`);

  // --- 2. Guardian logins in the audit log ---
  const logins = await db.collection("audits")
    .find({ eventKind: "LOGIN_SUCCESS", actorRole: "GUARDIAN" })
    .project({ actorId: 1, eventAt: 1 })
    .toArray();
  console.log(`GUARDIAN LOGIN_SUCCESS rows: ${logins.length}`);
  if (logins.length > 0) {
    const times = logins.map((r) => new Date(r.eventAt).getTime()).sort((a, b) => a - b);
    console.log(`  earliest: ${new Date(times[0]).toISOString().slice(0, 10)}`);
    console.log(`  latest:   ${new Date(times[times.length - 1]).toISOString().slice(0, 10)}`);
    const byGuardian = new Map<string, number>();
    for (const r of logins) {
      const k = r.actorId?.toString() ?? "(none)";
      byGuardian.set(k, (byGuardian.get(k) ?? 0) + 1);
    }
    console.log(`  distinct guardians who have EVER logged in: ${byGuardian.size} of ${gLogin} enabled`);
    const counts = [...byGuardian.values()].sort((a, b) => b - a);
    console.log(`  logins per guardian: max=${counts[0]} median=${counts[Math.floor(counts.length / 2)]} min=${counts[counts.length - 1]}`);

    const DAY = 86400000;
    const now = Date.now();
    for (const win of [7, 30, 90]) {
      const active = new Set(
        logins.filter((r) => now - new Date(r.eventAt).getTime() <= win * DAY)
          .map((r) => r.actorId?.toString()),
      );
      console.log(`  logged in within last ${win}d: ${active.size} guardians`);
    }
  }

  // --- 3. Notification read-state (the only per-item signal) ---
  const hasNotifs = (await db.listCollections({ name: "notifications" }).toArray()).length > 0;
  if (!hasNotifs) {
    console.log("\nNOTIFICATIONS: collection does not exist in this DB");
  } else {
    const nTotal = await db.collection("notifications").countDocuments({ recipientGuardianId: { $exists: true } });
    const nRead = await db.collection("notifications").countDocuments({
      recipientGuardianId: { $exists: true }, readAt: { $ne: null, $exists: true },
    });
    console.log(`\nGUARDIAN NOTIFICATIONS: ${nTotal} total, ${nRead} read (${nTotal ? Math.round((nRead / nTotal) * 100) : 0}%)`);

    const byKind = await db.collection("notifications").aggregate([
      { $match: { recipientGuardianId: { $exists: true } } },
      { $group: { _id: "$kind", total: { $sum: 1 }, read: { $sum: { $cond: [{ $ifNull: ["$readAt", false] }, 1, 0] } } } },
      { $sort: { total: -1 } },
    ]).toArray();
    if (byKind.length > 0) {
      console.log("  by kind (total / read / read%):");
      for (const k of byKind) {
        console.log(`    ${String(k._id).padEnd(28)} ${String(k.total).padStart(6)} ${String(k.read).padStart(6)}  ${k.total ? Math.round((k.read / k.total) * 100) : 0}%`);
      }
    }
  }

  // --- 4. Push installs ---
  const hasPush = (await db.listCollections({ name: "pushdevices" }).toArray()).length > 0;
  if (hasPush) {
    const pd = await db.collection("pushdevices").countDocuments({ guardianId: { $exists: true }, active: true });
    console.log(`\nPUSH DEVICES (guardian, active): ${pd}`);
  }

  await client.close();
}
main();
