/** CSP-2 — mapping the codes back (docs/prd-child-support-profile.md §6.11, DE-8/DE-9; D-#1586). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { SupportBatch } from "../modules/support-profile/models/SupportBatch";
import { SupportProfileVersion } from "../modules/support-profile/models/SupportProfileVersion";
import { sweepBatches, bnDate } from "../modules/support-profile/services/SupportBatchService";
import { runner, seedSupport, type SupportFx } from "./supportFixtures";
import { APPLY, codesOf, P, result, setupBatch, UPLOAD, type BatchSetup } from "./supportBatchFixtures";
import { printSchema } from "graphql";

let mongo: MongoMemoryServer;
const schema = builder.toSchema();
const run = runner(schema);
let fx: SupportFx;
let s1: BatchSetup;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
  s1 = await setupBatch(run, fx);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

it("on apply R-… → the right report, C-… → the right child, [S] → the first name, {{DATE:R-…}} → the date in Bangla; the authors' T- codes map to them", async () => {
  const c = await codesOf(s1.batchId, { R1: s1.r1, R2: s1.r2, A1: s1.a1 });
  const b = await SupportBatch.findById(s1.batchId).lean();
  expect(b!.codeMap!.children[0].studentId.toString()).toBe(String(fx.child));
  const r1Author = (await SupportReport.findById(s1.r1).lean())!.authorId;
  expect(b!.codeMap!.teachers.find((t) => String(t.userId) === String(r1Author))?.code).toMatch(/^T-\d{2}$/);
  const up = await run(UPLOAD, P(fx), { b: s1.batchId, t: result("I-01-correct.json", c), c: "claude.ai" });
  await run(APPLY, P(fx), { i: up.data?.uploadSupportResult.importId });
  expect((await SupportReport.findById(s1.r1).lean())?.status).toBe("PROCESSED");
  const draft = await SupportProfileVersion.findOne({ status: "DRAFT" }).lean();
  const a1 = await SupportReport.findById(s1.a1).lean();
  expect(draft!.sections.strengths[0].evidence.map(String)).toEqual([s1.a1]);
  expect(draft!.sections.strengths[0].textBn.startsWith(bnDate(a1!.occurredOn))).toBe(true);
  expect(draft!.sections.strengths[0].textBn).toContain("রাফি");
  expect(draft!.sections.strengths[0].textBn).not.toMatch(/\[S\]|\{\{|R-\d/);
});

it("the result of batch 1 uploaded against batch 2 is refused (nonce) — a code can never map to the wrong child", async () => {
  const c1 = await codesOf(s1.batchId, { R1: s1.r1, R2: s1.r2, A1: s1.a1 });
  const s2 = await setupBatch(run, fx, { skipEval: true });
  const r = await run(UPLOAD, P(fx), { b: s2.batchId, t: result("I-01-correct.json", c1), c: "claude.ai" });
  expect(r.errors?.[0].message).toMatch(/এই ব্যাচের ফলাফল নয়/);
});

it("no resolver returns the map", () => {
  const sdl = printSchema(schema);
  expect(sdl).not.toMatch(/codeMap|CodeMap/);
});

it("the map is deleted 30 days after the batch closes; the batch row stays; a late upload is then refused", async () => {
  const b = await SupportBatch.findById(s1.batchId);
  expect(b!.closedAt).not.toBeNull();
  await sweepBatches(new Date(b!.closedAt!.getTime() + 29 * 86_400_000));
  expect((await SupportBatch.findById(s1.batchId).lean())!.codeMap).not.toBeNull();
  await sweepBatches(new Date(b!.closedAt!.getTime() + 31 * 86_400_000));
  const after = await SupportBatch.findById(s1.batchId).lean();
  expect(after!.codeMap).toBeNull();
  expect(after!.codeMapDeletedAt).not.toBeNull();
  expect(after!.code).toMatch(/^B-\d{4}$/);
  // even reopened, a batch with no map refuses a result
  await SupportBatch.updateOne({ _id: s1.batchId }, { $set: { status: "OPEN" } });
  const c = { BATCH: after!.code, NONCE: after!.packNonce, METHOD: after!.methodVersion, R1: "R-001", R2: "R-002", A1: "R-003", C1: "C-001" };
  const r = await run(UPLOAD, P(fx), { b: s1.batchId, t: result("I-01-correct.json", c), c: "claude.ai" });
  expect(r.errors?.[0].message).toMatch(/বন্ধ/);
});
