/**
 * Mastery M-1 — the question bank speaks learning-outcome codes (docs/prd-mastery.md §6.2,
 * D-#785).
 *
 * loCodesOf        — lo_codes wins; else an LO topic_tag; a legacy TOP- row has none.
 * loCodeMongoFilter — matches by primary topic_tag OR any lo_codes entry.
 * import warnings  — the REAL harness + importEnvelope: an LO unknown to the catalogue, or
 *                    still DRAFT, imports with a [MASTERY-LO] warning (never a refusal); once
 *                    the catalogue is LOCKED the same question imports clean.
 *
 * In-memory MongoDB, real services, real Python harness (CI installs jsonschema).
 */
import fs from "node:fs";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { loCodeMongoFilter, loCodesOf, masteryImportWarnings } from "../modules/mastery/bank";
import { importCatalogue, lockCatalogue } from "../modules/mastery/services/MasteryCatalogueService";
import { importEnvelope } from "../modules/content/services/ContentService";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
const actor = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
const CASES = path.resolve(__dirname, "../../import/cases/lo-codes");
const caseEnv = (name: string) => JSON.parse(fs.readFileSync(path.join(CASES, `${name}.json`), "utf8")) as Record<string, unknown>;
/** A case plus the address the bank builder always adds (ContentArtifact requires one to store). */
const storable = (name: string) => ({ ...caseEnv(name), address: { anchor_word: "অধ্যায়", number: 7, title: "ভাগ" } });

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

const catalogue = (status = "DRAFT") =>
  JSON.stringify({
    classToken: "C3",
    subject: "MATH",
    status,
    chapters: [{ number: 7, titleBn: "ভাগ" }],
    outcomes: [
      { code: "LO-C3-MATH-07-03", labelBn: "খাতায় লম্বা ভাগ", assess: "QUESTION", questionTypeCodes: [] },
      { code: "LO-C3-MATH-SK-ANS-01", labelBn: "উত্তর-বাক্য", assess: "QUESTION", questionTypeCodes: [] },
    ],
    questionTypes: [],
  });

describe("loCodesOf (pure)", () => {
  it("lo_codes wins; else an LO topic_tag; a legacy TOP- row has none", () => {
    expect(loCodesOf({}, { topic_tag: "LO-C3-MATH-07-03", lo_codes: ["LO-C3-MATH-07-03", "LO-C3-MATH-SK-ANS-01"] })).toEqual([
      "LO-C3-MATH-07-03",
      "LO-C3-MATH-SK-ANS-01",
    ]);
    expect(loCodesOf({ topic_tag: "LO-C3-MATH-07-03" }, {})).toEqual(["LO-C3-MATH-07-03"]);
    expect(loCodesOf({ topic_tag: "TOP-MATH-C3-05" }, { topic_tag: "TOP-MATH-C3-05" })).toEqual([]);
    expect(loCodesOf(null, null)).toEqual([]);
  });
});

describe("loCodeMongoFilter", () => {
  it("matches by primary topic_tag or by any lo_codes entry", async () => {
    const col = mongoose.connection.collection("lofilter_probe");
    await col.insertMany([
      { k: "primary", envelopeJson: { tags: { topic_tag: "LO-C3-MATH-07-03" } } },
      { k: "listed", envelopeJson: { tags: { topic_tag: "LO-C3-MATH-07-02", lo_codes: ["LO-C3-MATH-07-02", "LO-C3-MATH-SK-ANS-01"] } } },
      { k: "legacy", envelopeJson: { tags: { topic_tag: "TOP-MATH-C3-05" } } },
    ]);
    const hit = async (codes: string[]) => (await col.find(loCodeMongoFilter(codes)).toArray()).map((d) => d.k).sort();
    expect(await hit(["LO-C3-MATH-07-03"])).toEqual(["primary"]);
    expect(await hit(["LO-C3-MATH-SK-ANS-01"])).toEqual(["listed"]);
    expect(await hit(["LO-C3-MATH-07-03", "LO-C3-MATH-SK-ANS-01"])).toEqual(["listed", "primary"]);
    await col.drop();
  });
});

describe("import warnings (D-#785)", () => {
  it("unknown → DRAFT → LOCKED → RETIRED says what is wrong, and never blocks", async () => {
    const env = caseEnv("pass_lo_codes_two");
    expect((await masteryImportWarnings(env)).join("\n")).toMatch(/not in the mastery catalogue/);
    await importCatalogue(catalogue(), true, actor);
    expect((await masteryImportWarnings(env)).join("\n")).toMatch(/still DRAFT/);
    await lockCatalogue("C3", "MATH", actor);
    expect(await masteryImportWarnings(env)).toEqual([]);
    expect(await masteryImportWarnings({ doc_type: "lesson_plan", payload: { topic_tag: "LO-C3-MATH-07-03" } })).toEqual([]);
  });

  it("the real harness imports an LO-tagged question with a warning, then clean once locked", async () => {
    const first = await importEnvelope(storable("pass_lo_topic"), actor.userId);
    expect(first.verdict).toBe("PASS");
    expect(first.warnings.join("\n")).toMatch(/\[MASTERY-LO\] LO-C3-MATH-07-03 is not in the mastery catalogue/);

    await importCatalogue(catalogue("LOCKED"), true, actor);
    const again = await importEnvelope(storable("pass_lo_topic"), actor.userId);
    expect(again.verdict).toBe("PASS");
    expect(again.warnings.some((w) => w.includes("MASTERY-LO"))).toBe(false);
  });

  it("the real harness still refuses an LO from another class (no app check needed)", async () => {
    const res = await importEnvelope(storable("fail_lo_wrong_class"), actor.userId);
    expect(res.verdict).toBe("FAIL");
    expect(res.failChecks.join("\n")).toMatch(/\[LO\]/);
  });

  it("a legacy TOP- question imports with no mastery warning at all", async () => {
    const res = await importEnvelope(storable("pass_legacy_top"), actor.userId);
    expect(res.verdict).toBe("PASS");
    expect(res.warnings.some((w) => w.includes("MASTERY-LO"))).toBe(false);
  });
});
