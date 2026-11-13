/**
 * Data assistant DA-1 — contacts never leave the server (docs/prd-data-assistant-mcp.md §6, OD-2).
 * Every contact field in the seed (student, guardian, user, StaffProfile incl. NID and bank) holds a
 * unique MARKER (Latin and Bangla-digit phones, +880 forms, e-mails, addresses). Every tool runs as
 * the Principal with arguments that reach those records; no marker, no phone, no e-mail and no
 * denied key may appear anywhere in any result. Plus unit tests of redact.ts.
 */
import { runTool } from "../modules/data-assistant/runTool";
import { resetLimits } from "../modules/data-assistant/limits";
import { EMAIL_MASK, PHONE_MASK, hasContact, isDeniedKey, redact, sweepText } from "../modules/data-assistant/redact";
import { CONTACT_MARKERS, MARK, setupFixtures, teardownFixtures, toolCalls, type Fx } from "./dataAssistantFixtures";

jest.setTimeout(180_000);
let fx: Fx;
beforeAll(async () => {
  fx = await setupFixtures();
});
afterAll(async () => teardownFixtures(fx));

function deniedKeysIn(v: unknown, path = "$"): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => deniedKeysIn(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [...(isDeniedKey(k) ? [`${path}.${k}`] : []), ...deniedKeysIn(x, `${path}.${k}`)]);
  return [];
}
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

describe("every tool, as the Principal", () => {
  it("returns no contact marker, no phone, no e-mail and no denied key", async () => {
    for (const c of [...toolCalls(fx), { tool: "notices", mode: "x", args: {} }, { tool: "staff_attendance", mode: "range", args: { from: fx.today, to: fx.today } }]) {
      resetLimits();
      const r = await runTool(fx.auth.principal, c.tool, c.args, { surface: "claude" });
      const json = JSON.stringify(r.reply);
      for (const m of CONTACT_MARKERS) expect([c.tool, json.includes(m) ? m : null]).toEqual([c.tool, null]);
      expect([c.tool, strings(r.reply).filter(hasContact)]).toEqual([c.tool, []]);
      expect([c.tool, deniedKeysIn(r.reply)]).toEqual([c.tool, []]);
    }
  });
  it("the records were reached (names, relation, pay are there)", async () => {
    const s = await runTool(fx.auth.principal, "find_students", { query: "Ayesha" }, { surface: "in_app" });
    expect(JSON.stringify(s.reply)).toContain("Ayesha Test");
    const st = await runTool(fx.auth.principal, "find_staff", { query: "Rahim" }, { surface: "in_app" });
    expect(JSON.stringify(st.reply)).toContain("Rahim Staff");
    const ov = await runTool(fx.auth.principal, "student_overview", { student_id: fx.ids.studentA, include_comments: true }, { surface: "in_app" });
    expect(JSON.stringify(ov.reply)).toContain(PHONE_MASK);
  });
});

describe("guardians (owner Q3)", () => {
  it("relation always; the name only with guardians:view_all; never a contact", async () => {
    const p = await runTool(fx.auth.principal, "find_students", { query: "Ayesha" }, { surface: "in_app" });
    const pg = (p.reply as { data: Array<{ guardians: Array<{ relation: string; name?: string }> }> }).data[0].guardians;
    expect(pg).toEqual([{ relation: "mother", name: MARK.guardianName }]);
    // officeRevoked has guardians:view_all revoked (students:view_all kept).
    const o = await runTool(fx.auth.officeRevoked, "find_students", { query: "Ayesha" }, { surface: "in_app" });
    expect((o.reply as { data: Array<{ guardians: unknown[] }> }).data[0].guardians).toEqual([{ relation: "mother" }]);
    expect(JSON.stringify(o.reply)).not.toContain(MARK.guardianName);
  });
});

describe("redact.ts", () => {
  it("deletes denied keys at any depth, including the Phone/Email/Address suffixes", () => {
    const out = redact({ a: [{ phone: 1, nested: { guardianPhone: "x", homeAddress: "y", Email: "z", bankAccount: "b", nid: "n", keep: "ok" } }], waLink: "w", whatsapp: "w2" });
    expect(out).toEqual({ a: [{ nested: { keep: "ok" } }] });
  });
  it("sweeps Latin, Bangla-digit and +880 phones and e-mails; leaves amounts and ids alone", () => {
    expect(sweepText("call 01711-223344 now")).toBe(`call ${PHONE_MASK} now`);
    expect(sweepText("ফোন ০১৮১২৩৪৫৬৭৮")).toBe(`ফোন ${PHONE_MASK}`);
    expect(sweepText("+880 1612-998877")).toBe(PHONE_MASK);
    expect(sweepText("+8801712345678")).toBe(PHONE_MASK);
    expect(sweepText("mail a.b@x.example.org")).toBe(`mail ${EMAIL_MASK}`);
    expect(sweepText("net 1250000 taka, 17750")).toBe("net 1250000 taka, 17750");
    expect(sweepText("6553017123456789abcdef01")).toBe("6553017123456789abcdef01");
    expect(sweepText("ref 120171234567890")).toBe("ref 120171234567890");
  });
  it("keeps numbers, booleans, null; dates become ISO", () => {
    expect(redact({ n: 5, b: true, z: null, d: new Date("2026-01-02T00:00:00Z") })).toEqual({ n: 5, b: true, z: null, d: "2026-01-02T00:00:00.000Z" });
  });
});
