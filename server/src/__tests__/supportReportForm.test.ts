/** CSP-1 — the report form's deterministic checks (§6.9, S-1, S-6, R-14; D-#1550). No AI. */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { sweepNotUsedText } from "../modules/support-profile/services/SupportReportService";
import { SupportReview } from "../modules/support-profile/models/SupportReview";
import { authOf, daysAgoKey, DECIDE, DRAFT, reportInput, ROSTER, runner, seedSupport, SUBMIT, type SupportFx } from "./supportFixtures";

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
const teacher = () => authOf(fx.classTeacher, "TEACHER");
const submit = (over: Record<string, unknown>) => run(SUBMIT, teacher(), { input: reportInput(fx.child, over) });

describe("report form", () => {
  it.each(["সে খুব বেয়াদব", "ও একটু বেয়াদপ", "মনে হয় অটিস্টিক", "ওর ADHD আছে", "সে খুব দুষ্টু"])("blocked term refuses submit: %s", async (behaviour) => {
    const r = await submit({ behaviour });
    expect(r.data?.submitSupportReport.outcome).toBe("BLOCKED");
    expect(r.data?.submitSupportReport.report).toBeNull();
  });

  it("an ASK term (অমনোযোগী) does not refuse submit; it is noted", async () => {
    const r = await submit({ behaviour: "গল্প পড়ার সময় অমনোযোগী ছিল, জানালার দিকে তাকিয়ে ছিল" });
    expect(r.data?.submitSupportReport.outcome).toBe("SAVED");
    expect(r.data?.submitSupportReport.askHits.map((h: { term: string }) => h.term)).toContain("অমনোযোগী");
  });

  it("F-23: a blocked word inside quotation marks in behaviour is allowed; the same word outside quotes is refused", async () => {
    expect((await submit({ behaviour: "সে বলল, 'তুই গাধা' এবং খাতা বন্ধ করল" })).data?.submitSupportReport.outcome).toBe("SAVED");
    expect((await submit({ behaviour: "সে বলল, “তুই গাধা”" })).data?.submitSupportReport.outcome).toBe("SAVED");
    expect((await submit({ behaviour: "সে একটা গাধা" })).data?.submitSupportReport.outcome).toBe("BLOCKED");
    // quotes are exempt only in behaviour
    expect((await submit({ tried: "বললাম 'গাধা' বলা যাবে না" })).data?.submitSupportReport.outcome).toBe("BLOCKED");
  });

  it("a future date and a date more than 7 days back are refused", async () => {
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await submit({ occurredOn: future })).errors?.[0].message).toMatch(/ভবিষ্যতের/);
    expect((await submit({ occurredOn: daysAgoKey(8) })).errors?.[0].message).toMatch(/৭ দিন/);
    expect((await submit({ occurredOn: daysAgoKey(7) })).data?.submitSupportReport.outcome).toBe("SAVED");
  });

  it("a 4th open draft on the same child is refused", async () => {
    for (let i = 0; i < 3; i++) expect((await run(DRAFT, authOf(fx.routineTeacher, "TEACHER"), { input: reportInput(fx.child) })).errors).toBeUndefined();
    const fourth = await run(DRAFT, authOf(fx.routineTeacher, "TEACHER"), { input: reportInput(fx.child) });
    expect(fourth.errors?.[0].message).toMatch(/৩টি খসড়া/);
  });

  it("antecedentTags: 0 or 4 are refused", async () => {
    expect((await submit({ antecedentTags: [] })).errors).toBeDefined();
    expect((await submit({ antecedentTags: ["GROUP_WORK", "SOLO_WORK", "WAITING", "OTHER"] })).errors).toBeDefined();
  });

  it("a classmate's roster name refuses the save with no AI (S-6)", async () => {
    const r = await submit({ behaviour: `সে ${ROSTER.classmate.nameBn.split(" ")[0]}-কে ধাক্কা দিয়েছে` });
    expect(r.data?.submitSupportReport.outcome).toBe("BLOCKED");
    expect(r.data?.submitSupportReport.blocked[0].kind).toBe("OTHER_CHILD");
    const en = await submit({ behaviour: `He pushed ${ROSTER.classmate.name} in the line` });
    expect(en.data?.submitSupportReport.outcome).toBe("BLOCKED");
  });

  it("NOT_USED text is deleted by the sweep after 30 days; the decision row is kept", async () => {
    const s = await submit({ behaviour: "পড়া বলার সময় দাঁড়িয়ে ছিল" });
    const id = s.data?.submitSupportReport.report.id;
    const d = await run(DECIDE, authOf(fx.principal, "PRINCIPAL"), { id, d: "NOT_USED", reason: "একই ঘটনা আগেই এসেছে" });
    expect(d.data?.decideSupportReport.status).toBe("NOT_USED");
    expect(await sweepNotUsedText(new Date(Date.now() + 29 * 86_400_000))).toBe(0);
    expect(await sweepNotUsedText(new Date(Date.now() + 31 * 86_400_000))).toBe(1);
    const r = await SupportReport.findById(id).lean();
    expect(r?.behaviour).toBe("");
    expect(r?.submittedText).toBeNull();
    expect(await SupportReview.countDocuments({ reportId: r?._id, decision: "NOT_USED" })).toBe(1);
  });
});
