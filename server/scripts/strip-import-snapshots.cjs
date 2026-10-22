/**
 * One-off backfill for D-#816: drop `envelopeSnapshot` from PASS ImportBatch rows whose
 * ContentArtifact exists (the artifact's envelopeJson is the same envelope), keeping
 * `snapshotSha256` as the fingerprint. FAIL rows and rows without a live artifact keep
 * their snapshot.
 *
 * Archive-first: with APPLY=1 every snapshot about to be stripped is written to a gzipped
 * NDJSON file ({_id, importedAt, snapshotSha256, envelopeSnapshot} per line) and the file
 * is re-read and counted BEFORE any row is touched. A count mismatch aborts.
 *
 * Runs on the VM, piped on stdin so nothing lands in the deploy dir (reads .env itself —
 * sourcing it truncates the URI at the unquoted '&'):
 *
 *   ssh <vm> 'cd /opt/scdhub/prod && node' < server/scripts/strip-import-snapshots.cjs
 *   ssh <vm> 'cd /opt/scdhub/prod && APPLY=1 ARCHIVE_DIR=/opt/scdhub/backups node' < server/scripts/strip-import-snapshots.cjs
 *
 * Without APPLY=1 it only counts. Idempotent: a second run finds nothing to strip.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const readline = require("readline");
const mongoose = require("mongoose");

const APPLY = process.env.APPLY === "1";
const CHUNK = 500;
const MB = (b) => (b / 1024 / 1024).toFixed(2);
const sha256 = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function countLines(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()) });
  let n = 0;
  for await (const line of rl) if (line.trim()) n += 1;
  return n;
}

(async () => {
  const uri = fs.readFileSync(".env", "utf8").split("\n")
    .find((l) => l.startsWith("MONGODB_URI=")).slice("MONGODB_URI=".length).trim().replace(/^["']|["']$/g, "");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const db = mongoose.connection.db;
  const batches = db.collection("importbatches");
  const artifacts = db.collection("contentartifacts");
  console.log(`db=${db.databaseName} mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

  const statsBefore = await db.command({ collStats: "importbatches" });
  const filter = { verdict: "PASS", artifactId: { $exists: true }, envelopeSnapshot: { $exists: true } };
  const ids = (await batches.find(filter, { projection: { artifactId: 1 } }).toArray());

  // Only rows whose artifact really exists — otherwise the snapshot is the sole copy.
  const live = new Set();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK).map((r) => r.artifactId);
    const found = await artifacts.find({ _id: { $in: slice } }, { projection: { _id: 1 } }).toArray();
    for (const a of found) live.add(String(a._id));
  }
  const targets = ids.filter((r) => live.has(String(r.artifactId))).map((r) => r._id);
  const [{ bytes = 0 } = {}] = await batches.aggregate([
    { $match: { _id: { $in: targets } } },
    { $group: { _id: null, bytes: { $sum: { $bsonSize: "$envelopeSnapshot" } } } },
  ]).toArray();
  console.log(`PASS rows with snapshot: ${ids.length}; artifact exists: ${targets.length}; ` +
    `kept (no artifact): ${ids.length - targets.length}; snapshot bytes to free ≈ ${MB(bytes)} MB`);
  console.log(`importbatches before: data ${MB(statsBefore.size)} MB, storage ${MB(statsBefore.storageSize)} MB`);

  if (!APPLY || targets.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const dir = process.env.ARCHIVE_DIR;
  if (!dir) throw new Error("APPLY=1 needs ARCHIVE_DIR (the snapshots are archived before stripping)");
  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const outDir = path.join(dir, `import-snapshots-${db.databaseName}-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "snapshots.ndjson.gz");

  // 1. Archive.
  const gz = zlib.createGzip();
  const out = fs.createWriteStream(file);
  gz.pipe(out);
  const hashes = new Map();
  for (let i = 0; i < targets.length; i += CHUNK) {
    const rows = await batches.find({ _id: { $in: targets.slice(i, i + CHUNK) } },
      { projection: { importedAt: 1, envelopeSnapshot: 1 } }).toArray();
    for (const r of rows) {
      const h = sha256(r.envelopeSnapshot);
      hashes.set(String(r._id), h);
      if (!gz.write(JSON.stringify({ _id: String(r._id), importedAt: r.importedAt, snapshotSha256: h, envelopeSnapshot: r.envelopeSnapshot }) + "\n")) {
        await new Promise((res) => gz.once("drain", res));
      }
    }
  }
  gz.end();
  await new Promise((res, rej) => { out.on("finish", res); out.on("error", rej); });
  const archived = await countLines(file);
  console.log(`archived ${archived} snapshots → ${file} (${MB(fs.statSync(file).size)} MB gz)`);
  if (archived !== targets.length || hashes.size !== targets.length) {
    throw new Error(`archive count ${archived}/${hashes.size} ≠ targets ${targets.length} — nothing stripped`);
  }

  // 2. Strip, in chunks. The envelopeSnapshot guard makes a re-run a no-op.
  let modified = 0;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const ops = targets.slice(i, i + CHUNK).map((_id) => ({
      updateOne: {
        filter: { _id, envelopeSnapshot: { $exists: true } },
        update: { $set: { snapshotSha256: hashes.get(String(_id)) }, $unset: { envelopeSnapshot: 1 } },
      },
    }));
    const res = await batches.bulkWrite(ops, { ordered: false });
    modified += res.modifiedCount;
  }
  const statsAfter = await db.command({ collStats: "importbatches" });
  console.log(`stripped ${modified} rows; importbatches after: data ${MB(statsAfter.size)} MB ` +
    `(was ${MB(statsBefore.size)}), storage ${MB(statsAfter.storageSize)} MB`);
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error("ERR", e.message);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
