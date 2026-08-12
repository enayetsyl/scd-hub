// Executed check that the SERVER SCHEMA serves exactly what the APP asks for.
// This is the gap left by graphqlDocuments.test.ts, which cannot run in a nested
// worktree (two `graphql` instances). Sends the app's REAL query text.
const API = "http://localhost:4055/graphql";

// Copied verbatim from app/src/graphql/engagement.ts — if the app asks for a field the
// server does not expose, this fails with GRAPHQL_VALIDATION_FAILED.
const APP_QUERY = `
  query GuardianEngagement($days: Int, $sectionId: String, $band: String) {
    guardianEngagement(days: $days, sectionId: $sectionId, band: $band) {
      summary {
        totalGuardians loginEnabled contactOnly everLoggedIn neverLoggedIn
        active7 active30 active90 regular occasional lapsed
        studentsTotal studentsReachable studentsUnreachable studentsNoCredentials
        excludedNonDesignated excludedButLoginEnabled
        notificationsDelivered notificationsRead viewsRecorded viewsSince windowDays
      }
      guardians {
        guardianId name phone loginEnabled childNames sectionNames band
        lastLoginAt loginCount activeDays notificationsDelivered notificationsRead
        viewCount lastViewAt topSurfaces
      }
      surfaces { surface views distinctGuardians lastAt }
      inboxByKind { kind delivered read }
      generatedAt
    }
  }
`;

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`, detail !== undefined ? JSON.stringify(detail).slice(0, 300) : ""); }
}

async function gql(query: string, variables: Record<string, unknown> = {}, token?: string) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<{ data?: any; errors?: Array<{ message: string; extensions?: any }> }>;
}

async function main() {
  const pl = await gql(
    `mutation($e:String!,$p:String!){ staffLogin(email:$e,password:$p){ token } }`,
    { e: "enayetflweb@gmail.com", p: "Principal@123" },
  );
  const token = pl.data?.staffLogin?.token;
  check("principal login", !!token, pl.errors);
  if (!token) process.exit(1);

  console.log("\n=== the APP's exact query against the SERVER schema ===");
  const r = await gql(APP_QUERY, { days: 90, sectionId: null, band: null }, token);
  const validationErr = r.errors?.find((e) => e.extensions?.code === "GRAPHQL_VALIDATION_FAILED");
  check("no field the app asks for is missing from the schema", !validationErr, validationErr?.message);
  check("query resolves", !!r.data?.guardianEngagement, r.errors);

  const s = r.data?.guardianEngagement?.summary;
  const rows = r.data?.guardianEngagement?.guardians ?? [];
  if (s) {
    console.log(`\n  students ${s.studentsReachable}/${s.studentsTotal} reachable · ` +
      `${s.totalGuardians} designated guardians · ${s.neverLoggedIn} to chase · ` +
      `${s.excludedNonDesignated} excluded (${s.excludedButLoginEnabled} would see an empty portal)`);
    console.log("\n=== the reported defects, re-checked over the wire ===");
    check("every listed guardian has at least one child (the blank-child symptom)",
      rows.every((g: any) => g.childNames.length > 0),
      rows.filter((g: any) => !g.childNames.length).slice(0, 3).map((g: any) => g.name));
    check("summary tile and NEVER band agree",
      rows.filter((g: any) => g.band === "NEVER").length === s.neverLoggedIn);
    check("no contact-only guardian is banded NEVER",
      rows.every((g: any) => !(g.band === "NEVER" && g.loginEnabled === false)));
    check("contact-only guardians are banded NO_LOGIN",
      rows.filter((g: any) => !g.loginEnabled).every((g: any) => g.band === "NO_LOGIN"));
    check("student coverage adds up", s.studentsReachable + s.studentsUnreachable === s.studentsTotal);
  }

  console.log("\n=== band filters ===");
  for (const band of ["NO_LOGIN", "NEVER", "LAPSED"]) {
    const f = await gql(APP_QUERY, { days: 90, sectionId: null, band }, token);
    const gs = f.data?.guardianEngagement?.guardians ?? [];
    check(`${band}: every row is in-band (n=${gs.length})`, gs.every((g: any) => g.band === band));
    check(`${band}: denominator unchanged`,
      f.data?.guardianEngagement?.summary.totalGuardians === s.totalGuardians);
  }

  console.log("\n=== RBAC still holds ===");
  const anon = await gql(APP_QUERY, { days: 90 }, undefined);
  check("anonymous refused", !!anon.errors);

  console.log(`\nRESULT: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
