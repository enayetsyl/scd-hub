/**
 * Load the owner-approved 2026 Nursery oral question sets (VV-6, D-#1275–#1277,
 * docs/prd-viva.md §9.4) into the Nursery বাংলা and ইংরেজি oral papers, through the app's own
 * compiled service (server/dist → saveVivaPaper), never raw writes.
 *
 * The sets live in server/assets/viva/nursery-sets-2026.json (no student data). The papers are
 * found by subject among the ORAL papers of the Nursery class (Class.level -1) that are still in
 * the routine; anything missing, ambiguous, already marked or already drawn stops the run.
 * saveVivaPaper itself checks that every set adds up to the same total.
 *
 * Read-only by default: prints each paper as it is now and what would be written. APPLY=1 writes.
 * Re-running after a successful APPLY is refused only once a set has been drawn or a mark entered.
 *
 *   cd /opt/scdhub/<env> && TZ=Asia/Dhaka [APPLY=1] [ACTOR_ID=<userId>] node server/scripts/load-viva-sets-2026.cjs
 *
 * Run from the repo/deploy root (it reads ./.env, ./server/dist and ./server/assets). Prints no
 * student or staff names.
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const serverRequire = (m) => require(require.resolve(m, { paths: [path.join(ROOT, "server"), ROOT] }));
const mongoose = serverRequire("mongoose");

function readUri() {
  // Local rehearsal only (an in-memory DB); a deploy run always reads ./.env.
  if (process.env.LOAD_MONGODB_URI) return process.env.LOAD_MONGODB_URI;
  const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const line = env.split("\n").find((l) => l.startsWith("MONGODB_URI="));
  if (!line) throw new Error("MONGODB_URI not in .env");
  return line.slice("MONGODB_URI=".length).trim();
}

(async () => {
  if (new Date().getTimezoneOffset() !== -360) throw new Error("run with TZ=Asia/Dhaka");
  const APPLY = process.env.APPLY === "1";
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "assets", "viva", "nursery-sets-2026.json"), "utf8"));
  await mongoose.connect(readUri());
  console.log(`DB ${mongoose.connection.db.databaseName} · ${APPLY ? "APPLY" : "dry run"}`);

  const dist = (p) => require(path.join(ROOT, "server", "dist", p));
  const { User } = dist("modules/foundation/models/User.js");
  const { Class } = dist("modules/foundation/models/Class.js");
  const { VivaPaper } = dist("modules/viva/models/VivaPaper.js");
  const { VivaMark } = dist("modules/viva/models/VivaMark.js");
  const svc = dist("modules/viva/services/VivaService.js");
  if (typeof svc.drawVivaSet !== "function") throw new Error("server/dist predates question sets (D-#1275) — deploy first");

  const actorId = process.env.ACTOR_ID
    ?? String((await User.findOne({ role: "PRINCIPAL", active: true }, { _id: 1 }).lean())?._id ?? "");
  if (!actorId) throw new Error("no ACTOR_ID and no active Principal");
  const ctx = { auth: { userId: actorId, role: "PRINCIPAL", grantedPermissions: [], revokedPermissions: [], additionalTemplates: [] } };

  // Papers are created from the routine on read; make sure they exist.
  await svc.syncVivaPapers(actorId);
  const nursery = (await Class.find({ level: -1 }, { _id: 1 }).lean()).map((c) => c._id);
  const problems = [];
  const plan = [];
  for (const want of data.papers) {
    const papers = await VivaPaper.find({ classId: { $in: nursery }, subject: want.subject, inRoutine: true }).lean();
    if (papers.length !== 1) {
      problems.push(`${want.subject}: ${papers.length} Nursery oral papers in the routine (want 1)`);
      continue;
    }
    const p = papers[0];
    const marked = await VivaMark.countDocuments({ paperId: p._id, "marks.0": { $exists: true } });
    const drawn = await VivaMark.countDocuments({ paperId: p._id, setKey: { $ne: null } });
    const sets = (p.sets && p.sets.length ? p.sets : [{ label: "(one list)", items: p.items }]);
    console.log(`\n${want.subject} paper ${p._id} · ${p.dateKey} · full ${p.fullMarks}${p.lockedAt ? " · LOCKED" : ""} · marked ${marked} · drawn ${drawn}`);
    for (const s of sets) console.log(`  now ${s.label}: ${s.items.map((i) => `${i.label} (${i.marks})`).join(" | ")}`);
    if (p.lockedAt) problems.push(`${want.subject}: paper is locked`);
    if (marked || drawn) problems.push(`${want.subject}: ${marked} children marked, ${drawn} drawn — the paper can no longer change`);
    const totals = want.sets.map((s) => s.items.reduce((a, i) => a + (i.parts && i.parts.length ? i.parts.length * i.partMarks : i.marks), 0));
    if (totals.some((t) => t !== want.fullMarks)) problems.push(`${want.subject}: set totals ${totals.join("/")} ≠ ${want.fullMarks}`);
    for (const s of want.sets) {
      console.log(`  new ${s.label}: ${s.items.map((i) => (i.parts && i.parts.length ? `${i.label} [${i.parts.join(" ")}] ×${i.partMarks}` : `${i.label} (${i.marks})`)).join(" | ")}`);
    }
    plan.push({ id: String(p._id), subject: want.subject, sets: want.sets });
  }
  if (problems.length) {
    console.log("\nSTOP:\n  " + problems.join("\n  "));
    await mongoose.disconnect();
    process.exit(1);
  }
  if (!APPLY) {
    console.log("\nDry run OK — re-run with APPLY=1 to write.");
    await mongoose.disconnect();
    return;
  }
  for (const p of plan) {
    const saved = await svc.saveVivaPaper(ctx, p.id, null, p.sets);
    console.log(`SAVED ${p.subject}: ${saved.sets.length} sets · full ${saved.fullMarks} · ${saved.sets.map((s) => `${s.key}=${s.label}`).join(", ")}`);
  }
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error("FAILED:", e.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
