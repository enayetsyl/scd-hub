/**
 * BL-1 — permissions (docs/prd-book-lifecycle.md §7, §19 bookLcPermissions; D-#1596).
 * Fixtures: Principal, Office (template), Office + manage, Office + release, Office trying a LOCKED
 * finalize grant, Teacher (template), Guardian. Office with manage can make a packet, upload scans
 * and transcribe, but can never record a verdict or ruling, direct-fix approve or mark final.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { readFileSync, readdirSync } from "fs";
import * as path from "path";
import { CATALOGUE_PERMISSIONS, catalogueAction, callerHasPermission, type Permission } from "@scd/shared";
import { setupLc, teardownLc, resetBooks, importSample, item, childVersion, roundSent, samplePdf, attachMasterPdf, type LcFx } from "./bookLcFixtures";
import { canBookLc } from "../modules/book-lifecycle/services/access";
import { approveDirectFix, createBook, importBook, markFinal } from "../modules/book-lifecycle/services/versionService";
import { addReviewerPoints, addRoundScan, makePacket, openRound, detectPageMap, setPageMap, recordReturn } from "../modules/book-lifecycle/services/roundService";
import { openDecision, ruleDecisionSelf } from "../modules/book-lifecycle/services/feedbackService";
import { assertBookLcFileReadAccess } from "../modules/book-lifecycle/routes/bookLcFiles";
import { loadBook } from "../modules/book-lifecycle/services/store";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { ForbiddenError } from "../middleware/authz";
import { sampleMaster } from "./bookLcFixtures";
import type { AppContext } from "../context";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());

const ACTIONS = ["view", "manage", "finalize", "release", "ai_edit", "teacher_view", "report"];

describe("catalogue", () => {
  it("book_lifecycle has exactly the seven actions; no `review`; finalize LOCKED; all off for TEACHER/OFFICE", () => {
    const mine = CATALOGUE_PERMISSIONS.filter((p) => p.startsWith("book_lifecycle:"));
    expect(mine.map((p) => p.split(":")[1]).sort()).toEqual([...ACTIONS].sort());
    expect(mine).not.toContain("book_lifecycle:review");
    expect(catalogueAction("book_lifecycle:finalize").flags).toContain("LOCKED");
    expect(catalogueAction("book_lifecycle:ai_edit").flags).toContain("PRINCIPAL_DEFAULT");
    for (const p of mine) {
      expect(catalogueAction(p).teacher).toBe(false);
      expect(catalogueAction(p).office).toBe(false);
    }
  });

  it("who holds what at ship", () => {
    const has = (k: keyof LcFx["auth"], a: string) => canBookLc(fx.auth[k], a as never);
    for (const a of ACTIONS) expect(has("principal", a)).toBe(true);
    for (const a of ACTIONS) expect(has("office", a)).toBe(false);
    for (const a of ACTIONS) expect(has("teacher", a)).toBe(false);
    for (const a of ACTIONS) expect(has("guardian", a)).toBe(false);
    expect(has("officeManage", "manage")).toBe(true);
    expect(has("officeManage", "finalize")).toBe(false);
    expect(has("officeRelease", "release")).toBe(true);
    expect(has("officeRelease", "manage")).toBe(false);
    // A LOCKED action never reaches a non-Principal, even by per-person grant.
    expect(callerHasPermission(fx.auth.officeFinalizeGrant, "book_lifecycle:finalize" as Permission)).toBe(false);
    expect(has("officeFinalizeGrant", "finalize")).toBe(false);
  });
});

describe("service gates", () => {
  it("Office (template), teacher and guardian cannot create or import", async () => {
    for (const who of [fx.auth.office, fx.auth.teacher, fx.auth.guardian, fx.auth.officeRelease]) {
      await expect(createBook(who, { code: "C1-BAN", classLevel: 1, subject: "BAN", titleBn: "ক" })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("Office with manage: packet, scans, transcription — but never a verdict, ruling, direct-fix approve, mark final or an import past draft", async () => {
    const OM = fx.auth.officeManage;
    await expect(importBook(OM, { code: "C2-BAN", classLevel: 2, subject: "BAN", titleBn: "খ", version: "v1", state: "final", masterMd: Buffer.from(sampleMaster()) })).rejects.toBeInstanceOf(ForbiddenError);
    const { book } = await importSample(OM);
    const id = book._id.toString();
    const d = await openDecision(OM, id, { questionBn: "কোনটি?", options: ["এক", "দুই"] });
    const v = (await loadBook(id)).latestVersionId!.toString();
    await attachMasterPdf(OM, v);
    let r = await openRound(OM, id, { reviewerName: "পর্যালোচক" });
    r = await detectPageMap(OM, r._id.toString());
    r = await setPageMap(OM, r._id.toString(), r.packet!.pageMap.map((p, i) => ({ chapterKey: p.chapterKey, startPage: 3 + i * 3 })));
    r = await makePacket(OM, r._id.toString(), "whole");
    expect(r.status).toBe("packet_ready");
    const { markSentOnPaper } = await import("../modules/book-lifecycle/services/roundService");
    r = await markSentOnPaper(OM, r._id.toString(), {});
    r = await addRoundScan(OM, r._id.toString(), { name: "s.pdf", data: await samplePdf(1, []), mime: "application/pdf" });
    await addReviewerPoints(OM, r._id.toString(), { items: [{ category: "other", textBn: "একটি নতুন কথা" }] });
    await expect(recordReturn(OM, r._id.toString(), { verdict: "changes" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ruleDecisionSelf(OM, d._id.toString(), { optionKey: "ক" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(markFinal(OM, v)).rejects.toBeInstanceOf(ForbiddenError);
    const f = await item(OM, id, "direct_fix", { chapterKey: "ch-003" });
    const other = await importSample(fx.auth.principal, { code: "C3-ENG", state: "final" });
    const f2 = await item(OM, other.book._id.toString(), "direct_fix");
    const child = await childVersion(OM, other.book._id.toString(), "1টি নৌকা", "একটি নৌকা", [f2.code]);
    await expect(approveDirectFix(OM, child._id.toString())).rejects.toBeInstanceOf(ForbiddenError);
    expect(f.status).toBe("accepted");
  });
});

describe("GET /files/:id gate for book_lc_*", () => {
  const ctx = (a: LcFx["auth"][keyof LcFx["auth"]]) => ({ auth: a }) as unknown as AppContext;
  it("view reads every kind; release reads print files only; office/teacher/guardian refused", async () => {
    const master = await StoredFile.create({ kind: "book_lc_master", mime: "text/markdown", sizeBytes: 3, originalName: "m.md", driveFileId: "x", uploadedBy: fx.ids.principal });
    const print = await StoredFile.create({ kind: "book_lc_print", mime: "application/zip", sizeBytes: 3, originalName: "p.zip", driveFileId: "y", uploadedBy: fx.ids.principal });
    await expect(assertBookLcFileReadAccess(ctx(fx.auth.principal), master)).resolves.toBeUndefined();
    await expect(assertBookLcFileReadAccess(ctx(fx.auth.officeManage), master)).resolves.toBeUndefined();
    await expect(assertBookLcFileReadAccess(ctx(fx.auth.officeRelease), print)).resolves.toBeUndefined();
    for (const who of [fx.auth.office, fx.auth.teacher, fx.auth.guardian]) {
      await expect(assertBookLcFileReadAccess(ctx(who), master)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(assertBookLcFileReadAccess(ctx(who), print)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("resolver gates (static)", () => {
  const DIR = path.join(__dirname, "..", "modules", "book-lifecycle", "resolvers");
  const source = readdirSync(DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(path.join(DIR, f), "utf8"))
    .join("\n");
  const re = /builder\.(query|mutation)Field\(\s*"([^"]+)"/g;
  const hits: { kind: string; name: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) hits.push({ kind: m[1], name: m[2], start: m.index });
  const fields = hits.map((h, i) => ({ ...h, body: source.slice(h.start, i + 1 < hits.length ? hits[i + 1].start : source.length) }));

  it("finds the fields", () => {
    expect(fields.length).toBeGreaterThan(30);
  });
  it.each(fields.map((f) => [f.kind, f.name] as const))("%s %s names one book_lifecycle action and checks the book plane", (_k, name) => {
    const f = fields.find((x) => x.name === name)!;
    expect(f.body).toMatch(/authScopes:\s*\{\s*hasPermission:\s*"book_lifecycle:[a-z_]+"\s*\}/);
    expect(f.body).toContain("assertBookPlane()");
  });
  it("mutations never gate on view; the verdict / direct-fix / final / protected / self-ruling are finalize", () => {
    for (const f of fields.filter((x) => x.kind === "mutation")) expect(f.body).not.toMatch(/hasPermission:\s*"book_lifecycle:view"/);
    for (const n of ["recordBookLcReturn", "correctBookLcReturn", "approveBookLcDirectFix", "markBookLcFinal", "confirmBookLcProtectedChange", "ruleBookLcDecision"]) {
      expect(fields.find((x) => x.name === n)?.body).toMatch(/hasPermission:\s*"book_lifecycle:finalize"/);
    }
  });
});
