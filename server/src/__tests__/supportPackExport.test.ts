/**
 * CSP-2 — export de-identification P-01 … P-08 (docs/prd-child-support-profile.md §6.11 DE-1 … DE-10,
 * NORMATIVE; D-#1586).
 */
import fs from "node:fs";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { SupportBatch } from "../modules/support-profile/models/SupportBatch";
import { Audit } from "../modules/platform/models/Audit";
import { loadMethod } from "../modules/support-profile/services/methodDoc";
import { authOf, daysAgoKey, reportInput, ROSTER, runner, seedSupport, SUBMIT, type SupportFx } from "./supportFixtures";
import { CANCEL_BATCH, CREATE_BATCH, DOWNLOAD, P, passEval } from "./supportBatchFixtures";
import { CLASSMATE_NICKNAME, PACK_TEXTS } from "./fixtures/support/pack";
import { SAFEGUARDING_FIXTURES } from "./fixtures/support/safeguarding";

let mongo: MongoMemoryServer;
const run = runner(builder.toSchema());
let fx: SupportFx;
let batchId = "";
let pack = "";
const ids: Record<string, string> = {};
const submit = async (key: string, over: Record<string, unknown>, sg?: string, who = fx.classTeacher) => {
  const r = await run(SUBMIT, authOf(who, "TEACHER"), { input: reportInput(fx.child, over), sg });
  ids[key] = r.data?.submitSupportReport.report?.id;
  return r;
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
  await passEval(fx);
  // P-02: the classmate's listed nickname (the live Student model has no nickname field; the pack
  // reads one when present).
  await mongoose.connection.db!.collection("students").updateOne({ _id: fx.classmate }, { $set: { nicknames: [CLASSMATE_NICKNAME] } });
  const first = ROSTER.child.nameBn.split(" ")[0];
  await submit("p01", { behaviour: PACK_TEXTS.p01(first, ROSTER.child.nameBn), occurredOn: daysAgoKey(6) });
  await submit("p02", { behaviour: PACK_TEXTS.p02(CLASSMATE_NICKNAME), occurredOn: daysAgoKey(3) });
  await submit("p03", { behaviour: PACK_TEXTS.p03(ROSTER.staff.classTeacher, ROSTER.staff.routineTeacher) }, undefined, fx.manualTeacher);
  await submit("p04", { settingNote: PACK_TEXTS.p04 });
  await submit("held", { behaviour: SAFEGUARDING_FIXTURES[0].bn, tone: "CONCERN" }, "NO");
  await submit("routed", { behaviour: SAFEGUARDING_FIXTURES[2].bn, tone: "CONCERN" }, "YES");
  const b = await run(CREATE_BATCH, P(fx), {});
  batchId = b.data?.createSupportBatch.id;
  const d = await run(DOWNLOAD, P(fx), { b: batchId });
  expect(d.errors).toBeUndefined();
  pack = d.data?.downloadSupportPack.content;
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("the analysis pack", () => {
  it("names no child, guardian or staff member of the roster; no phone, no school id, no section or school name, no calendar date, no Mongo id", () => {
    const names = [ROSTER.child.name, ROSTER.child.nameBn, ...ROSTER.child.nameBn.split(" "), ROSTER.classmate.name, ROSTER.classmate.nameBn, CLASSMATE_NICKNAME,
      ROSTER.otherChild.nameBn, ROSTER.guardian.name, ...Object.values(ROSTER.staff)];
    for (const n of names) expect([n, pack.includes(n)]).toEqual([n, false]);
    expect(pack).not.toMatch(/01712345678/);
    expect(pack).not.toMatch(/S-000\d/);
    expect(pack).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    expect(pack).not.toMatch(/\b[0-9a-f]{24}\b/);
    expect(pack).not.toContain("কুরআন ১"); // a group name
    expect(pack).not.toContain('"sectionId"');
  });

  it("P-01 the child → [S]; P-02 another child → [অন্য শিশু]; P-03 a staff name → a T- code; P-04 the phone masked", () => {
    expect(pack).toMatch(/\[S\] আজ দলে অঙ্ক করেছে। পরে \[S\] বোর্ডে/);
    expect(pack).toContain("[অন্য শিশু]-এর সাথে খেলেছে");
    expect(pack).toMatch(/T-\d{2} আপা বলেছেন সে আজ চুপচাপ ছিল; \[শিক্ষক\] স্যারও/);
    expect(pack).toContain("[PHONE]");
  });

  it("P-06 days are offsets with a weekday; P-08 neither the held nor the routed report is in the pack", async () => {
    expect(pack).toMatch(/"day": -6,\n\s*"weekday": "(Sun|Mon|Tue|Wed|Thu|Fri|Sat)"/);
    const b = await SupportBatch.findById(batchId).lean();
    const codes = b!.codeMap!.reports;
    for (const k of ["held", "routed"]) expect(codes.map((c) => String(c.reportId))).not.toContain(ids[k]);
  });

  it("holds the whole method file byte for byte, the batch code, the nonce, the method version and hash, the output format and the self-check", async () => {
    const m = loadMethod();
    const b = await SupportBatch.findById(batchId).lean();
    expect(pack.includes(m.text)).toBe(true);
    for (const x of [b!.code, b!.packNonce, `"methodVersion": "${m.version}"`, m.sha256, "## P-4 OUTPUT FORMAT", "support-result/v1", "## P-5 SELF-CHECK"]) expect(pack).toContain(x);
  });

  it("nothing is written to disk or a collection except the hash, the download entry and the audit row (meta has no text)", async () => {
    const b = await SupportBatch.findById(batchId).lean();
    expect(b!.packHash).toMatch(/^[0-9a-f]{64}$/);
    expect(b!.packDownloads).toHaveLength(1);
    const dbDump = JSON.stringify(await Promise.all((await mongoose.connection.db!.listCollections().toArray()).map((c) => mongoose.connection.db!.collection(c.name).find({}).toArray())));
    expect(dbDump).not.toContain("## P-2 METHOD");
    expect(fs.readdirSync(process.cwd()).filter((f) => f.startsWith("support-pack_"))).toEqual([]);
    const a = await Audit.findOne({ eventKind: "SUPPORT_PACK_DOWNLOADED" }).lean();
    expect(a?.meta).toMatchObject({ batchId, packHash: b!.packHash });
    expect(JSON.stringify(a?.meta)).not.toMatch(/অঙ্ক|\[S\]/);
  });

  it("P-07 the same child gets a different code in the next batch (deterministic: the random source is a counter)", async () => {
    await run(CANCEL_BATCH, P(fx), { b: batchId });
    // a counter instead of chance: two real random draws could collide once in 999 runs
    let n = 0;
    const spy = jest.spyOn(crypto, "randomInt").mockImplementation(((a: number, b?: number) => {
      const [lo, hi] = b === undefined ? [0, a] : [a, b];
      return lo + (n++ % (hi - lo));
    }) as typeof crypto.randomInt);
    try {
      const b2 = await run(CREATE_BATCH, P(fx), {});
      const first = (await SupportBatch.findById(b2.data?.createSupportBatch.id).lean())!.codeMap!.children[0].code;
      await run(CANCEL_BATCH, P(fx), { b: b2.data?.createSupportBatch.id });
      const b3 = await run(CREATE_BATCH, P(fx), {});
      const second = (await SupportBatch.findById(b3.data?.createSupportBatch.id).lean())!.codeMap!.children[0].code;
      expect(second).not.toBe(first);
      await run(CANCEL_BATCH, P(fx), { b: b3.data?.createSupportBatch.id });
    } finally {
      spy.mockRestore();
    }
  });

  it("P-05 a guardian's name in an unusual spelling, found only by the final scan → the download is refused and names the report", async () => {
    await SupportReport.updateMany({ status: "TO_PROCESS" }, { $set: { status: "WITHDRAWN" } });
    await submit("p05", { behaviour: PACK_TEXTS.p05 });
    const b = await run(CREATE_BATCH, P(fx), {});
    const r = await run(DOWNLOAD, P(fx), { b: b.data?.createSupportBatch.id });
    expect(r.errors?.[0].message).toMatch(/রিপোর্ট R-\d{3} ঠিক করুন/);
    expect((await SupportBatch.findById(b.data?.createSupportBatch.id).lean())!.packDownloads).toHaveLength(0);
  });

  it("refused in a 'view as' session and for every caller without `process`", async () => {
    const open = await SupportBatch.findOne({ status: "OPEN" }).lean();
    expect((await run(DOWNLOAD, authOf(fx.principal, "PRINCIPAL", { impersonatorId: String(fx.principal) }), { b: String(open!._id) })).errors).toBeDefined();
    expect((await run(DOWNLOAD, authOf(fx.classTeacher, "TEACHER"), { b: String(open!._id) })).errors).toBeDefined();
    expect((await run(DOWNLOAD, authOf(fx.office, "OFFICE", { grantedPermissions: ["support_profile:process"] }), { b: String(open!._id) })).errors).toBeDefined();
  });
});
