/**
 * Revision 3 — one method, both modes (docs/prd-child-support-profile.md §6.2 MD-1…MD-7; D-#1584).
 * Mode A (the API run through `aiSend`) is CSP-7 and NOT built (owner Q-21): the half of this test that
 * runs a batch through a fake provider is left for CSP-7. What holds today is asserted here.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { SUPPORT_RESULT_SCHEMA } from "@scd/shared";
import "../registerResolvers";
import { builder } from "../schema";
import { currentMethodVersion, loadMethod, METHOD_DIR, stagePrompt } from "../modules/support-profile/services/methodDoc";
import { validateSupportResult } from "../modules/support-profile/services/supportResultValidator";
import { assertProducerPassed } from "../modules/support-profile/services/SupportBatchService";
import { runner, seedSupport, type SupportFx } from "./supportFixtures";
import { DOWNLOAD, P, setupBatch } from "./supportBatchFixtures";

const m = loadMethod("v1");

describe("the method file drives every stage byte for byte", () => {
  it.each(["CHECK", "COMPARE", "SYNTHESIS"] as const)("the %s prompt is the stage's marked sections, joined, in file order — and nothing else", (stage) => {
    const p = stagePrompt(stage, "v1");
    const expected = m.sections.filter((s) => s.stages.includes("ALL") || s.stages.includes(stage)).map((s) => s.text).join("");
    expect(p).toBe(expected);
    // every byte of the prompt comes from the file (no instruction text outside the method)
    let rest = m.text;
    for (const s of m.sections.filter((x) => x.stages.includes("ALL") || x.stages.includes(stage))) {
      expect(rest.includes(s.text)).toBe(true);
      rest = rest.slice(rest.indexOf(s.text) + s.text.length);
    }
  });
  it("CHECK holds the rubric and not the synthesis rules; SYNTHESIS holds the evidence rules", () => {
    expect(stagePrompt("CHECK", "v1")).toContain("## M-4 The bias rubric");
    expect(stagePrompt("CHECK", "v1")).not.toContain("## M-7 Evidence levels");
    expect(stagePrompt("SYNTHESIS", "v1")).toContain("## M-7 Evidence levels");
  });
});

describe("a new method version changes both stamps and voids old evaluations", () => {
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

  it("the pack holds the whole method file, its version and hash, and prints the same result schema", async () => {
    const s = await setupBatch(run, fx);
    const pack = (await run(DOWNLOAD, P(fx), { b: s.batchId })).data?.downloadSupportPack.content as string;
    expect(pack.includes(m.text)).toBe(true);
    expect(pack).toContain(m.sha256);
    expect(pack).toContain(JSON.stringify(SUPPORT_RESULT_SCHEMA));
  });

  it("method_v2 → a new version and hash; an evaluation passed for v1 is not valid for v2; a result stamped v1 is refused by a v2 batch", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "method-"));
    fs.copyFileSync(path.join(METHOD_DIR, "method_v1.md"), path.join(dir, "method_v1.md"));
    fs.writeFileSync(path.join(dir, "method_v2.md"), m.text.replace("version v1", "version v2"));
    expect(currentMethodVersion(dir)).toBe("v2");
    const v2 = loadMethod("v2", dir);
    expect(v2.sha256).not.toBe(m.sha256);
    // the evaluation passed in setupBatch was for v1
    await expect(assertProducerPassed({ kind: "CHAT", chatLabel: "claude.ai" }, "v1")).resolves.toBeUndefined();
    await expect(assertProducerPassed({ kind: "CHAT", chatLabel: "claude.ai" }, "v2")).rejects.toThrow(/মূল্যায়ন প্যাক/);
    const out = validateSupportResult(JSON.stringify({ schema: "support-result/v1", batch: "B-0002", nonce: "N", methodVersion: "v1", complete: true, reports: [], children: [], selfCheck: { reportsDone: 0, childrenDone: 0, everySentenceCited: true, noNamesOrCodesInSentences: true, noNewFacts: true, safeguardingMarked: true } }), {
      batchCode: "B-0002", nonce: "N", methodVersion: "v2", open: true, todayKey: "2026-11-13", reports: new Map(), children: new Set(), strategies: new Set(), items: new Set(), rosterNames: [],
    });
    expect(out.fileError).toBe("WRONG_METHOD");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.todo("CSP-7: one batch run once in Mode A (fake provider) and once in Mode B gives two runs with the same methodVersion and methodHash");
});
