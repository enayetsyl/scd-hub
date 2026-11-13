/** CSP-4 — a version written by hand with the AI off (docs/prd-child-support-profile.md §6.7). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportProfileVersion } from "../modules/support-profile/models/SupportProfileVersion";
import { authOf, DECIDE, reportInput, runner, seedSupport, SUBMIT, type SupportFx } from "./supportFixtures";

let mongo: MongoMemoryServer;
const run = runner(builder.toSchema());
let fx: SupportFx;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
const P = () => authOf(fx.principal, "PRINCIPAL");
const HAND = `mutation($s: String!, $items: [SupportHandItemInput!]!) { createHandSupportVersion(studentId: $s, items: $items) { id status versionNo } }`;
const approved = async (who = fx.classTeacher, over: Record<string, unknown> = {}) => {
  const id = (await run(SUBMIT, authOf(who, "TEACHER"), { input: reportInput(fx.child, over) })).data?.submitSupportReport.report.id;
  await run(DECIDE, P(), { id, d: "APPROVED" });
  return id as string;
};

it("AI off → the Principal builds a version by hand; it gets the same computed level", async () => {
  const a = await approved();
  const b = await approved(fx.routineTeacher, { occurredOn: reportInput(fx.child).occurredOn, periodNo: 4 });
  const r = await run(HAND, P(), { s: String(fx.child), items: [{ section: "strengths", textBn: "দলে অঙ্কের কাজে সহপাঠীকে সাহায্য করে", reportIds: [a, b] }] });
  expect(r.errors).toBeUndefined();
  const v = await SupportProfileVersion.findById(r.data?.createHandSupportVersion.id).lean();
  expect(v!.mode).toBe("HAND");
  expect(v!.sections.strengths[0]).toMatchObject({ level: "ESTABLISHED", teachersCount: 2, obsCount: 2, sourceKind: "PRINCIPAL" });
  expect((await run(`mutation($v: String!) { publishSupportVersion(versionId: $v) { status } }`, P(), { v: r.data?.createHandSupportVersion.id })).data?.publishSupportVersion.status).toBe("PUBLISHED");
});

it("an item without a picked approved report is refused; a waiting report does not count", async () => {
  expect((await run(HAND, P(), { s: String(fx.child), items: [{ section: "strengths", textBn: "ভালো কাজ করে", reportIds: [] }] })).errors?.[0].message).toMatch(/অনুমোদিত রিপোর্ট/);
  const waiting = (await run(SUBMIT, authOf(fx.classTeacher, "TEACHER"), { input: reportInput(fx.child) })).data?.submitSupportReport.report.id;
  expect((await run(HAND, P(), { s: String(fx.child), items: [{ section: "strengths", textBn: "ভালো কাজ করে", reportIds: [waiting] }] })).errors?.[0].message).toMatch(/প্রমাণ নয়/);
});

it("hand-made items keep the section minimums (a concern item at SINGLE is refused)", async () => {
  const a = await approved(fx.classTeacher, { tone: "CONCERN", behaviour: "লম্বা লেখার কাজে ১০ মিনিট পর খাতা বন্ধ করেছে" });
  expect((await run(HAND, P(), { s: String(fx.child), items: [{ section: "triggers", textBn: "লম্বা লেখার কাজে অসুবিধা হয়", reportIds: [a] }] })).errors?.[0].message).toMatch(/প্রমাণ নয়/);
});
