/**
 * READ-ONLY prod diagnostic: which subject groups exist, per track, and how Quran /
 * Arabic sessions are actually anchored. Answers the question the 2026-09-14 upload
 * fix could not verify locally: are there arabic-track groups to pick at all?
 *
 * Run ON THE VM, from /opt/scdhub/prod, piping this file in over stdin — do NOT
 * `. ./.env` first (the unquoted `&` in MONGODB_URI silently empties it):
 *
 *   ssh -i ~/.ssh/scdhub-deploy-2026 <vm> 'cd /opt/scdhub/prod && node' \
 *     < server/scripts/diag-subject-group-tracks.cjs
 */
const fs = require("fs");
const { MongoClient } = require("mongodb");

function readEnv(p) {
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

(async () => {
  const uri = process.env.MONGODB_URI || readEnv("./.env").MONGODB_URI;
  if (!uri) throw new Error("no MONGODB_URI");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  // Guard: say plainly which database this is before reading anything from it.
  console.log("DB NAME: " + db.databaseName);

  const groups = await db
    .collection("subjectgroups")
    .find({})
    .sort({ track: 1, code: 1 })
    .toArray();

  const byTrack = {};
  for (const g of groups) {
    const live = g.active !== false;
    byTrack[g.track] = byTrack[g.track] || { live: 0, retired: 0 };
    byTrack[g.track][live ? "live" : "retired"]++;
  }
  console.log("\n=== subjectgroups: " + groups.length + " total ===");
  console.log("by track: " + JSON.stringify(byTrack));
  console.log("\ntrack | code | level | gender | nameBn | live");
  for (const g of groups) {
    console.log(
      [g.track, g.code, g.level, g.gender, g.nameBn, g.active !== false].join(" | "),
    );
  }

  // THE question for the upload picker: does the Arabic track have live groups?
  const liveArabic = groups.filter((g) => g.track === "arabic" && g.active !== false);
  console.log(
    "\n>>> live ARABIC groups: " +
      liveArabic.length +
      (liveArabic.length === 0
        ? "  <-- picker will be EMPTY; create them in the subject-group admin first"
        : ""),
  );

  // Cross-check: how the routine anchors these two subjects today.
  for (const subj of ["QURAN", "ARABIC"]) {
    const slots = await db.collection("routineslots").find({ subject: subj }).toArray();
    let grp = 0;
    let sec = 0;
    for (const s of slots) {
      if (s.subjectGroupId) grp++;
      else if (s.sectionId) sec++;
    }
    console.log(
      "routine slots " + subj + ": " + slots.length + " (group=" + grp + ", section=" + sec + ")",
    );
  }

  // Existing observations: form / subject / anchor kind, plus any track mismatch the
  // new server guard would now refuse.
  const obs = await db.collection("classroomobservations").find({}).toArray();
  const trackById = new Map(groups.map((g) => [g._id.toString(), g.track]));
  const expected = { QURAN: "quran", ARABIC: "arabic" };
  const tally = {};
  const mismatched = [];
  const orphaned = [];
  for (const o of obs) {
    const kind = o.subjectGroupId ? "group" : o.sectionId ? "section" : "NONE";
    const k = o.form + " / " + o.subject + " / " + kind;
    tally[k] = (tally[k] || 0) + 1;
    if (o.subjectGroupId) {
      const t = trackById.get(o.subjectGroupId.toString());
      if (!t) orphaned.push(o._id.toString());
      else if (expected[o.subject] && t !== expected[o.subject]) {
        mismatched.push(o._id.toString() + " (" + o.subject + " on " + t + ")");
      }
    }
  }
  console.log("\n=== classroomobservations: " + obs.length + " ===");
  for (const k of Object.keys(tally).sort()) console.log("  " + k + ": " + tally[k]);
  console.log("\ngroup-anchored rows pointing at a MISSING group: " + orphaned.length);
  for (const x of orphaned.slice(0, 20)) console.log("  " + x);
  console.log("track-MISMATCHED rows (the new guard would refuse these): " + mismatched.length);
  for (const x of mismatched.slice(0, 20)) console.log("  " + x);

  await client.close();
})().catch((e) => {
  console.error("ERR " + e.message);
  process.exit(1);
});
