// GE-1..GE-3 end-to-end verification against the LOCAL dev server + scdhub_local.
// Creates a throwaway guardian, logs in as them, records views through the real
// GraphQL mutation, reads the report as Principal, then REMOVES everything it made.
import { readFileSync } from "fs";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcryptjs";

const API = "http://localhost:4000/graphql";
const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
const uri = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();
const dbName = uri.match(/\/([^/?]+)(\?|$)/)?.[1] ?? "scdhub_local";

const TEST_IDENT = "01999000111";
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

async function gql(query: string, variables: Record<string, unknown> = {}, token?: string) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<{ data?: any; errors?: Array<{ message: string }> }>;
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  console.log(`DB: ${dbName}\n`);

  // --- fixture: a throwaway guardian linked to a real student ----------------
  await db.collection("guardians").deleteMany({ identifier: TEST_IDENT });
  const student = await db.collection("students").findOne({ active: true });
  if (!student) throw new Error("no active student in the local DB to link");
  const gId = new ObjectId();
  await db.collection("guardians").insertOne({
    _id: gId,
    identifierKind: "phone",
    identifier: TEST_IDENT,
    passwordHash: await bcrypt.hash("Test@12345", 10),
    loginEnabled: true,
    name: "GE টেস্ট অভিভাবক",
    phone: TEST_IDENT,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.collection("guardianlinks").insertOne({
    guardianId: gId, studentId: student._id, relation: "father", active: true, createdAt: new Date(),
  });
  console.log(`fixture guardian ${gId} -> student ${student.name}\n`);

  try {
    // --- 1. guardian logs in (this also writes the LOGIN_SUCCESS audit row) --
    console.log("=== guardian login ===");
    const gl = await gql(
      `mutation($i:String!,$k:String!,$p:String!){ guardianLogin(identifier:$i,identifierKind:$k,password:$p){ token } }`,
      { i: TEST_IDENT, k: "phone", p: "Test@12345" },
    );
    const gToken = gl.data?.guardianLogin?.token;
    check("guardian can log in", !!gToken, gl.errors);
    if (!gToken) throw new Error("cannot continue without a guardian token");

    // --- 2. record views through the REAL mutation ---------------------------
    console.log("\n=== recordGuardianView ===");
    const M = `mutation($s:String!,$sid:String){ recordGuardianView(surface:$s, studentId:$sid) }`;
    const r1 = await gql(M, { s: "HOME", sid: student._id.toString() }, gToken);
    check("known surface accepted", r1.data?.recordGuardianView === true, r1.errors ?? r1.data);
    const r2 = await gql(M, { s: "HOMEWORK", sid: student._id.toString() }, gToken);
    check("second surface accepted", r2.data?.recordGuardianView === true, r2.errors ?? r2.data);
    const r3 = await gql(M, { s: "TOTALLY_MADE_UP" }, gToken);
    check("unknown surface REJECTED (returns false)", r3.data?.recordGuardianView === false, r3.data);

    // repeat the same view: must COLLAPSE into the existing row, not add one
    await gql(M, { s: "HOME", sid: student._id.toString() }, gToken);
    await gql(M, { s: "HOME", sid: student._id.toString() }, gToken);
    const rows = await db.collection("guardianviews").find({ guardianId: gId }).toArray();
    const home = rows.find((r) => r.surface === "HOME");
    check("repeat opens collapse to ONE row per surface/day", rows.length === 2, rows.map((r) => r.surface));
    check("...with an incremented count (3 opens)", home?.count === 3, home?.count);
    check("no row was written for the unknown surface", !rows.some((r) => r.surface === "TOTALLY_MADE_UP"));

    // --- 3. the report, read as PRINCIPAL ------------------------------------
    console.log("\n=== guardianEngagement (Principal) ===");
    const pl = await gql(
      `mutation($e:String!,$p:String!){ staffLogin(email:$e,password:$p){ token } }`,
      { e: "enayetflweb@gmail.com", p: "Principal@123" },
    );
    const pToken = pl.data?.staffLogin?.token;
    check("principal can log in", !!pToken, pl.errors);

    const Q = `query($d:Int){ guardianEngagement(days:$d){
      summary{ totalGuardians loginEnabled contactOnly everLoggedIn neverLoggedIn active7 regular lapsed
               notificationsDelivered notificationsRead viewsRecorded viewsSince windowDays }
      guardians{ guardianId name band activeDays viewCount topSurfaces childNames loginEnabled }
      surfaces{ surface views distinctGuardians }
      inboxByKind{ kind delivered read } } }`;
    const rep = await gql(Q, { d: 90 }, pToken);
    check("report resolves for Principal", !!rep.data?.guardianEngagement, rep.errors);
    const R = rep.data?.guardianEngagement;
    if (R) {
      console.log(`  summary: ${R.summary.totalGuardians} guardians, ${R.summary.loginEnabled} with login, ` +
        `${R.summary.everLoggedIn} ever logged in, ${R.summary.active7} active 7d, ` +
        `${R.summary.viewsRecorded} views`);
      const me = R.guardians.find((g: any) => g.guardianId === gId.toString());
      check("the test guardian appears in the report", !!me, R.guardians.length);
      check("...banded from a real login just now (not NEVER)", me?.band !== "NEVER", me?.band);
      check("...with the recorded views attributed", me?.viewCount === 4, me?.viewCount);
      check("...and its child joined on", (me?.childNames?.length ?? 0) > 0, me?.childNames);
      const homeSurface = R.surfaces.find((s: any) => s.surface === "HOME");
      check("HOME surface shows the views", (homeSurface?.views ?? 0) >= 3, homeSurface);
      check("every declared surface is returned, zeros included", R.surfaces.length === 9, R.surfaces.length);
      check("viewsSince is now set (view data exists)", R.summary.viewsSince !== null, R.summary.viewsSince);
      check("summary denominator counts ALL guardians", R.summary.totalGuardians > 100, R.summary.totalGuardians);
      const bands = new Set(R.guardians.map((g: any) => g.band));
      console.log(`  bands present: ${[...bands].join(", ")}`);
      console.log(`  top surfaces: ${R.surfaces.slice(0, 3).map((s: any) => `${s.surface}=${s.views}`).join(", ")}`);
      if (R.inboxByKind.length) {
        console.log(`  inbox: ${R.inboxByKind.slice(0, 3).map((k: any) => `${k.kind} ${k.read}/${k.delivered}`).join(", ")}`);
      }
    }

    // --- 4. RBAC: the gates actually hold ------------------------------------
    console.log("\n=== RBAC ===");
    const asGuardian = await gql(Q, { d: 90 }, gToken);
    check("guardian CANNOT read the report", !!asGuardian.errors, asGuardian.data);
    const anon = await gql(Q, { d: 90 });
    check("anonymous CANNOT read the report", !!anon.errors, anon.data);
    const staffView = await gql(M, { s: "HOME" }, pToken);
    check("principal CANNOT record a guardian view", !!staffView.errors, staffView.data);

    // --- 5. filters ----------------------------------------------------------
    console.log("\n=== filters ===");
    const never = await gql(Q.replace("query($d:Int)", "query($d:Int,$b:String)")
      .replace("guardianEngagement(days:$d)", "guardianEngagement(days:$d,band:$b)"), { d: 90, b: "NEVER" }, pToken);
    const N = never.data?.guardianEngagement;
    check("band filter narrows the rows", N?.guardians.every((g: any) => g.band === "NEVER"), N?.guardians.length);
    check("...but leaves the denominator intact",
      N?.summary.totalGuardians === R?.summary.totalGuardians, N?.summary.totalGuardians);
  } finally {
    // --- cleanup: leave scdhub_local exactly as found ------------------------
    await db.collection("guardianviews").deleteMany({ guardianId: gId });
    await db.collection("guardianlinks").deleteMany({ guardianId: gId });
    await db.collection("guardians").deleteMany({ _id: gId });
    await db.collection("audits").deleteMany({ actorId: gId });
    console.log("\nfixture removed (guardian, link, views, audit rows)");
    await client.close();
  }

  console.log(`\nRESULT: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
