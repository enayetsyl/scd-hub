/**
 * PR-O (D-#1445) — a lesson plan carries its objective codes into the app.
 *
 * A plan JSON + Markdown pair whose footer has `Objective codes` is wrapped by the real
 * build_envelope.py (via buildEnvelopeFromPair, the path the Import screen uses), gated by the real
 * validate_import.py (importEnvelope) on in-memory MongoDB, and the class-note lesson picker
 * (sessionPlansFor) reads the codes from tags.lo_codes.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { buildEnvelopeFromPair, importEnvelope } from "../modules/content/services/ContentService";
import { sessionPlansFor } from "../modules/lesson-progress/services/LessonDeliveryService";

jest.setTimeout(180_000);

const CASES = path.resolve(__dirname, "../../import/cases/lo-codes");
const base = JSON.parse(fs.readFileSync(path.join(CASES, "pass_c1_math_plan_footer_codes.json"), "utf8")) as Record<string, any>;
const ACTOR = new Types.ObjectId().toString();
const MD = base.rendered_markdown as string;

/** The plan JSON of the Class 1 Math case with its footer's `Objective codes` set (undefined = key removed). */
function planWith(codes: string | undefined): Record<string, any> {
  const plan = JSON.parse(JSON.stringify(base.payload));
  delete plan.footer["Objective codes"];
  if (codes !== undefined) plan.footer["Objective codes"] = codes;
  return plan;
}
const wrap = (plan: Record<string, any>) => buildEnvelopeFromPair("p", JSON.stringify(plan), MD, "p.json", "Principal");

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
afterEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
});

describe("footer Objective codes -> tags.lo_codes", () => {
  it("a Class 1 Math session-plan pair with two codes imports with those two, and the picker shows them", async () => {
    const built = await wrap(planWith("LO-C1-MATH-07-01.1, LO-C1-MATH-07-02\nLO-C1-MATH-07-01.1"));
    expect(built.ok).toBe(true);
    expect((built.envelope as any).tags).toEqual({ lo_codes: ["LO-C1-MATH-07-01.1", "LO-C1-MATH-07-02"] });
    const r = await importEnvelope(built.envelope!, ACTOR);
    expect(r.failChecks).toEqual([]);
    expect(r.verdict).toBe("PASS");
    expect((await sessionPlansFor(1, "MATH")).map((s) => s.loCodes)).toEqual([["LO-C1-MATH-07-01.1", "LO-C1-MATH-07-02"]]);
    // The footer stays in the HTML-comment footer of the Markdown, not in the teacher-facing body.
    expect(MD).toMatch(/<!-- INTERNAL FOOTER/);
  });

  it("a wrong-class code is refused with the code named", async () => {
    const built = await wrap(planWith("LO-C1-MATH-07-01.1, LO-C2-MATH-07-02"));
    expect(built.ok).toBe(true);
    const r = await importEnvelope(built.envelope!, ACTOR);
    expect(r.verdict).toBe("FAIL");
    expect(r.failChecks.join("\n")).toMatch(/LO-C2-MATH-07-02/);
    expect(await ContentArtifact.countDocuments({})).toBe(0);
  });

  it("a malformed code is refused with the code named", async () => {
    const built = await wrap(planWith("LO-C1-MATH-7-2"));
    const r = await importEnvelope(built.envelope!, ACTOR);
    expect(r.verdict).toBe("FAIL");
    expect(r.failChecks.join("\n")).toMatch(/LO-C1-MATH-7-2/);
  });

  it("a pair without the key imports exactly as today (no tags)", async () => {
    const built = await wrap(planWith(undefined));
    expect(built.ok).toBe(true);
    expect((built.envelope as any).tags).toBeUndefined();
    const r = await importEnvelope(built.envelope!, ACTOR);
    expect(r.verdict).toBe("PASS");
    expect((await sessionPlansFor(1, "MATH")).map((s) => s.loCodes)).toEqual([[]]);
  });

  it("an empty key sets nothing", async () => {
    const built = await wrap(planWith(" , \n "));
    expect((built.envelope as any).tags).toBeUndefined();
  });

  it("a chapter plan with the key gets no tags", async () => {
    const plan = planWith("LO-C1-MATH-07-01.1");
    plan.plan_type = "chapter_plan";
    const built = await wrap(plan);
    if (built.ok) expect((built.envelope as any).tags).toBeUndefined();
    else expect(built.error).not.toMatch(/lo_codes/);
  });
});
