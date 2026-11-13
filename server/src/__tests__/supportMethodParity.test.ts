/**
 * CSP-2 — MD-7: one method text for every door (docs/prd-child-support-profile.md §6.2).
 *  - the pack's METHOD part equals method_vN.md byte for byte after LF normalisation (real pack and
 *    evaluation pack alike);
 *  - the Mode A prompt builder (`stagePrompt`) embeds the same text, section by section, in file order;
 *  - a CRLF checkout hashes and embeds the same text as an LF one (the loader normalises).
 * Revision 3 (D-#1584): Mode A (the API run through `aiSend`) is CSP-7 and NOT built (owner Q-21); the
 * fake-provider half is left for CSP-7.
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
import { buildEvalPack } from "../modules/support-profile/eval/supportEvaluation";
import { validateSupportResult } from "../modules/support-profile/services/supportResultValidator";
import { assertProducerPassed } from "../modules/support-profile/services/SupportBatchService";
import { runner, seedSupport, type SupportFx } from "./supportFixtures";
import { DOWNLOAD, P, setupBatch } from "./supportBatchFixtures";

const version = currentMethodVersion();
const fileLf = (): string => fs.readFileSync(path.join(METHOD_DIR, `method_${version}.md`), "utf8").replace(/\r\n/g, "\n");

/** The METHOD part of a pack: from the P-2 heading to the P-3 heading. */
const methodPart = (pack: string): string => {
  const start = pack.indexOf("## P-2 METHOD\n\n") + "## P-2 METHOD\n\n".length;
  return pack.slice(start, pack.indexOf("\n\n## P-3 DATA", start) + 1);
};

describe("MD-7 parity", () => {
  it("the evaluation pack's METHOD part is the file, byte for byte", () => {
    const part = methodPart(buildEvalPack().content);
    expect(part.startsWith(fileLf())).toBe(true);
    expect(part.slice(fileLf().length)).toMatch(/^\n?$/);
  });

  it("every Mode A stage prompt is made of the file's own sections, byte for byte, in file order", () => {
    const text = fileLf();
    const m = loadMethod("v1");
    expect(m.sections.map((s) => s.text).join("")).toBe(text);
    for (const stage of ["CHECK", "COMPARE", "SYNTHESIS"] as const) {
      const prompt = stagePrompt(stage);
      let at = 0;
      for (const s of m.sections.filter((x) => x.stages.includes("ALL") || x.stages.includes(stage))) {
        const i = text.indexOf(s.text, at);
        expect([stage, s.id, i >= 0]).toEqual([stage, s.id, true]);
        expect(prompt.includes(s.text)).toBe(true);
        at = i + s.text.length;
      }
      expect(prompt.length).toBeLessThanOrEqual(text.length);
    }
  });

  it("a CRLF copy of the file hashes and splits exactly like the LF one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "method-crlf-"));
    try {
      fs.writeFileSync(path.join(dir, `method_${version}.md`), fileLf().replace(/\n/g, "\r\n"));
      const crlf = loadMethod(version, dir);
      const lf = loadMethod(version);
      expect(crlf.sha256).toBe(lf.sha256);
      expect(crlf.text).toBe(lf.text);
      expect(crlf.sections.map((s) => s.id)).toEqual(lf.sections.map((s) => s.id));
      expect(crlf.text.includes("\r")).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

const m = loadMethod("v1");

describe("MD-7 parity — each stage prompt is the stage's marked sections", () => {
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

describe("MD-7 parity — the real pack", () => {
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

  it("one batch: the pack's METHOD part is the file byte for byte, it holds the hash and the result schema, and the batch row is stamped with the file's methodVersion and methodHash", async () => {
    const s = await setupBatch(run, fx); // only one batch may be open at a time
    const d = await run(DOWNLOAD, P(fx), { b: s.batchId });
    expect(d.errors).toBeUndefined();
    const pack: string = d.data?.downloadSupportPack.content;
    expect(methodPart(pack).startsWith(fileLf())).toBe(true);
    expect(pack).toContain(loadMethod(version).sha256);
    expect(pack.includes(m.text)).toBe(true);
    expect(pack).toContain(JSON.stringify(SUPPORT_RESULT_SCHEMA));
    // methodHash pin: the stored stamp is the file's own
    const { SupportBatch } = await import("../modules/support-profile/models/SupportBatch");
    const row = await SupportBatch.findById(s.batchId).lean();
    expect(row?.methodVersion).toBe(version);
    expect(row?.methodHash).toBe(loadMethod(version).sha256);
  });

  it("method_v2 → a new version and hash; an evaluation passed for v1 is not valid for v2; a result stamped v1 is WRONG_METHOD when the batch expects v2", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "method-"));
    try {
    fs.copyFileSync(path.join(METHOD_DIR, "method_v1.md"), path.join(dir, "method_v1.md"));
    fs.writeFileSync(path.join(dir, "method_v2.md"), m.text.replace("version v1", "version v2"));
    expect(currentMethodVersion(dir)).toBe("v2");
    const v2 = loadMethod("v2", dir);
    expect(v2.sha256).not.toBe(m.sha256);
    // the evaluation passed in setupBatch was for v1
    await expect(assertProducerPassed({ kind: "CHAT", chatLabel: "claude.ai" }, "v1", m.sha256)).resolves.toBeUndefined();
      // methodHash pin: the same version with a different file hash is NOT passed
      await expect(assertProducerPassed({ kind: "CHAT", chatLabel: "claude.ai" }, "v1", "0".repeat(64))).rejects.toThrow(/মূল্যায়ন প্যাক/);
    await expect(assertProducerPassed({ kind: "CHAT", chatLabel: "claude.ai" }, "v2", v2.sha256)).rejects.toThrow(/মূল্যায়ন প্যাক/);
    const out = validateSupportResult(JSON.stringify({ schema: "support-result/v1", batch: "B-0002", nonce: "N", methodVersion: "v1", complete: true, reports: [], children: [], selfCheck: { reportsDone: 0, childrenDone: 0, everySentenceCited: true, noNamesOrCodesInSentences: true, noNewFacts: true, safeguardingMarked: true } }), {
      batchCode: "B-0002", nonce: "N", methodVersion: "v2", open: true, todayKey: "2026-11-13", reports: new Map(), children: new Set(), strategies: new Set(), items: new Set(), rosterNames: [],
    });
    expect(out.fileError).toBe("WRONG_METHOD");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.todo("CSP-7: one batch run once in Mode A (fake provider) and once in Mode B gives two runs with the same methodVersion and methodHash");
});
