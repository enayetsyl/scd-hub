/**
 * PR-P (brief 6 §7) — a 2nd-paper objective may name a 1st-paper objective as its earlier step.
 *
 * Map        — BAN2 -> BAN, ENG2 -> ENG; no reverse, no other pair.
 * Invariants — C6 BAN2 naming BAN codes of C6 / C5 passes; ENG / MATH refused; a C6 BAN row naming a
 *              BAN2 code refused; a later class refused.
 * Import     — the real C6_BAN2 tree imports with partner codes live in the catalogue; refused with a
 *              partner code that is RETIRED or of another subject.
 * Diagnosis  — resolveEarlierSteps reads the BAN row's own state for a BAN2 row's earlier step.
 *
 * In-memory MongoDB, real services.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { checkTreeInvariants, masteryPartnerSubject, readDomainsFile, readTreeFile, type TreeFile } from "@scd/shared";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { importCatalogue } from "../modules/mastery/services/MasteryCatalogueService";
import { resolveEarlierSteps } from "../modules/mastery/services/MasteryDiagnosisService";

jest.setTimeout(120_000);

const DOCS = path.resolve(__dirname, "../../../docs/mastery/objective-tree");
const TREE_TEXT = fs.readFileSync(path.join(DOCS, "C6_BAN2.tree.json"), "utf8");
const DOMAINS_TEXT = fs.readFileSync(path.join(DOCS, "domains/BAN2.json"), "utf8");
const fresh = (): Record<string, any> => JSON.parse(TREE_TEXT);
const actor = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };

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

const readTree = (raw: unknown): TreeFile => {
  const r = readTreeFile(raw);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.tree;
};
const domainCodes = (): string[] => {
  const d = readDomainsFile(JSON.parse(DOMAINS_TEXT));
  if (!d.ok) throw new Error(d.errors.join("; "));
  return d.domains.domains.map((x) => x.code);
};
const rules = (vs: { rule: string }[]) => [...new Set(vs.map((v) => v.rule))].sort();

const BAN6 = "LO-C6-BAN-01-01";
const BAN5 = "LO-C5-BAN-02-01";
const seed = (code: string, subject: string, classToken: string, status = "DRAFT") =>
  MasteryOutcome.collection.insertOne({ code, subject, classToken, labelBn: `ধাপ ${code}`, assess: "QUESTION", order: 0, status, tagged: true, level: "OBJECTIVE" });

/** The real tree with its first tagged row's earlier step replaced. */
function withPrereqs(prereqs: string[]): Record<string, any> {
  const t = fresh();
  const n = t.nodes.find((x: any) => x.tagged);
  n.prereqCodes = prereqs;
  return t;
}
const importIt = (t: unknown) => importCatalogue(JSON.stringify(t), false, actor, DOMAINS_TEXT);

describe("partner map", () => {
  it("is BAN2 -> BAN and ENG2 -> ENG only, one direction", () => {
    expect(masteryPartnerSubject("BAN2")).toBe("BAN");
    expect(masteryPartnerSubject("ENG2")).toBe("ENG");
    for (const s of ["BAN", "ENG", "MATH", "SCI", "ICT"]) expect(masteryPartnerSubject(s)).toBeNull();
  });
});

describe("invariants", () => {
  const run = (subject: string, classToken: string, pre: string, external: string[]) => {
    const t = readTree(fresh());
    const n = t.nodes.find((x) => x.tagged)!;
    return rules(
      checkTreeInvariants({
        classToken: classToken as any,
        subject: subject as any,
        nodes: t.nodes.map((x) => (x === n ? { ...x, prereqCodes: [pre] } : x)),
        domainCodes: domainCodes(),
        mode: "REVIEW",
        externalCodes: external,
      }),
    );
  };
  it("a C6 BAN2 row may name BAN codes of C6 and C5", () => {
    expect(run("BAN2", "C6", BAN6, [BAN6])).toEqual([]);
    expect(run("BAN2", "C6", BAN5, [BAN5])).toEqual([]);
  });
  it("a C6 BAN2 row naming ENG or MATH is refused", () => {
    expect(run("BAN2", "C6", "LO-C6-ENG-01-01", ["LO-C6-ENG-01-01"])).toEqual(["PREREQ_RESOLVES"]);
    expect(run("BAN2", "C6", "LO-C5-MATH-01-01", ["LO-C5-MATH-01-01"])).toEqual(["PREREQ_RESOLVES"]);
  });
  it("a BAN row naming a BAN2 code is refused (no reverse)", () => {
    // (the BAN2 nodes under subject BAN also trip unrelated code/domain rules; only PREREQ_RESOLVES matters)
    expect(run("BAN", "C6", "LO-C6-BAN2-01-01", ["LO-C6-BAN2-01-01"])).toContain("PREREQ_RESOLVES");
  });
  it("a partner code of a later class is refused", () => {
    expect(run("BAN2", "C5", "LO-C6-BAN-01-01", ["LO-C6-BAN-01-01"])).toContain("PREREQ_RESOLVES");
  });
});

describe("import", () => {
  it("the unchanged C6 BAN2 tree still imports", async () => {
    const r = await importIt(fresh());
    expect(r.ok).toBe(true);
  });
  it("accepts live BAN codes of C6 and C5", async () => {
    await seed(BAN6, "BAN", "C6");
    await seed(BAN5, "BAN", "C5");
    const r = await importIt(withPrereqs([BAN6, BAN5]));
    expect(r.ok).toBe(true);
  });
  it("refuses ENG / MATH codes, a RETIRED BAN code and an unknown BAN code", async () => {
    await seed("LO-C6-ENG-01-01", "ENG", "C6");
    await seed("LO-C5-MATH-01-01", "MATH", "C5");
    await seed(BAN6, "BAN", "C6", "RETIRED");
    for (const bad of ["LO-C6-ENG-01-01", "LO-C5-MATH-01-01", BAN6, BAN5]) {
      const r = await importIt(withPrereqs([bad]));
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).toContain("PREREQ_RESOLVES");
    }
  });
  it("a C6 BAN tree naming a BAN2 code is refused", async () => {
    await seed("LO-C6-BAN2-01-01", "BAN2", "C6");
    const t = JSON.parse(fs.readFileSync(path.join(DOCS, "C6_BAN.tree.json"), "utf8"));
    const n = t.nodes.find((x: any) => x.tagged);
    n.prereqCodes = ["LO-C6-BAN2-01-01"];
    const r = await importCatalogue(JSON.stringify(t), false, actor, fs.readFileSync(path.join(DOCS, "domains/BAN.json"), "utf8"));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("PREREQ_RESOLVES");
  });
});

describe("diagnosis", () => {
  it("an earlier step of a BAN2 row reads the BAN row's state (noData without evidence; never the BAN2 section)", async () => {
    await seed(BAN6, "BAN", "C6");
    const steps = await resolveEarlierSteps(new Types.ObjectId().toString(), "C6", "BAN2", [BAN6], () => "STRONG" as any);
    const s = steps.get(BAN6)!;
    // The stub for same-subject rows would say STRONG; a partner code must not use it.
    expect(s.noData).toBe(true);
    expect(s.state).toBeNull();
    expect(s.labelBn).toContain(BAN6);
  });
});
