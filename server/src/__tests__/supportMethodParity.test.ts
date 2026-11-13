/**
 * CSP-2 — MD-7: one method text for every door (docs/prd-child-support-profile.md §6.2).
 *  - the pack's METHOD part equals method_vN.md byte for byte after LF normalisation (real pack and
 *    evaluation pack alike);
 *  - the Mode A prompt builder (`stagePrompt`) embeds the same text, section by section, in file order;
 *  - a CRLF checkout hashes and embeds the same text as an LF one (the loader normalises).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { currentMethodVersion, loadMethod, METHOD_DIR, stagePrompt } from "../modules/support-profile/services/methodDoc";
import { buildEvalPack } from "../modules/support-profile/eval/supportEvaluation";
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
    const m = loadMethod(version);
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

  it("the downloaded pack's METHOD part is the file, byte for byte, and its header carries the file's hash", async () => {
    const s = await setupBatch(run, fx);
    const d = await run(DOWNLOAD, P(fx), { b: s.batchId });
    expect(d.errors).toBeUndefined();
    const pack: string = d.data?.downloadSupportPack.content;
    const part = methodPart(pack);
    expect(part.startsWith(fileLf())).toBe(true);
    expect(pack).toContain(loadMethod(version).sha256);
  });
});
