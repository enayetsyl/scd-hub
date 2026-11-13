/** CSP-5 — the light measures (docs/prd-child-support-profile.md §11, §16.8; D-#1559). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { printSchema } from "graphql";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { authOf, daysAgoKey, runner, seedSupport, type SupportFx } from "./supportFixtures";

let mongo: MongoMemoryServer;
const schema = builder.toSchema();
const run = runner(schema);
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

it("a child's measure is that child's own series; 'worked share' is null under 4 tries", async () => {
  const sid = new mongoose.Types.ObjectId();
  for (let i = 0; i < 3; i++) await SupportReport.create({ studentId: fx.child, authorId: fx.classTeacher, authorVia: "CLASS_TEACHER", occurredOn: daysAgoKey(i), tone: "POSITIVE", status: "APPROVED", strategyLinks: [{ strategyId: sid, outcome: "WORKED" }] });
  const q = await run(`query($s: String!) { supportChildIndicatorsJson(studentId: $s) }`, authOf(fx.principal, "PRINCIPAL"), { s: String(fx.child) });
  const j = JSON.parse(q.data?.supportChildIndicatorsJson);
  const month = j.months.find((m: { tries: number }) => m.tries > 0);
  if (month.tries < 4) expect(month.workedShare).toBeNull();
  await SupportReport.create({ studentId: fx.child, authorId: fx.classTeacher, authorVia: "CLASS_TEACHER", occurredOn: daysAgoKey(0), tone: "CONCERN", status: "APPROVED", strategyLinks: [{ strategyId: sid, outcome: "DID_NOT_WORK" }] });
  const j2 = JSON.parse((await run(`query($s: String!) { supportChildIndicatorsJson(studentId: $s) }`, authOf(fx.principal, "PRINCIPAL"), { s: String(fx.child) })).data?.supportChildIndicatorsJson);
  const m2 = j2.months.find((m: { month: string }) => m.month === daysAgoKey(0).slice(0, 7));
  expect(m2.tries).toBeGreaterThanOrEqual(4);
  expect(typeof m2.workedShare).toBe("number");
  expect(JSON.stringify(j2)).not.toMatch(/studentId|studentName|authorId|teacher/i);
});

it("the school totals name no child and no teacher; no field lists children or teachers ordered by a figure; teachers are refused", async () => {
  const t = await run(`query { supportSchoolTotalsJson }`, authOf(fx.principal, "PRINCIPAL"));
  const j = JSON.parse(t.data?.supportSchoolTotalsJson);
  expect(Object.keys(j).sort()).toEqual(["coverageShare", "freshCardShare", "goodThingShare", "medianDaysToDecision", "returnedByBatchShare", "safeguardingMedianHoursToSeen"]);
  expect((await run(`query { supportSchoolTotalsJson }`, authOf(fx.classTeacher, "TEACHER"))).errors).toBeDefined();
  expect(printSchema(schema)).not.toMatch(/support[A-Za-z]*(Ranking|Leader|Top|Worst)/);
});
