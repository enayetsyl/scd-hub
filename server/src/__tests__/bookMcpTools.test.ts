/**
 * BL-4 — MCP book tools over real HTTP (docs/prd-book-lifecycle.md §15.1, §19 bookMcpTools; D-#1604).
 * Drives the real MCP SDK through the Express routers like aiWorkspaceW5: OAuth sign-in as the
 * Principal, then tools/list and tools/call on `/mcp`. Invented text only.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { createHash, randomBytes } from "crypto";
import express from "express";
import request from "supertest";
import { setupLc, teardownLc, resetBooks, importSample, item, roundSent, samplePdf, type LcFx } from "./bookLcFixtures";
import { User } from "../modules/foundation/models/User";
import { hashPassword } from "../modules/foundation/services/AuthService";
import { oauthRouter } from "../modules/ai-workspace/mcp/oauth";
import { mcpRouter } from "../modules/ai-workspace/mcp/mcpRoute";
import { dataMcpRouter } from "../modules/data-assistant/mcp/dataMcpRoute";
import { AiMcpCall } from "../modules/ai-workspace/models/AiOAuth";
import { BookEvent } from "../modules/support-book/models/BookEvent";
import { BookVersion } from "../modules/book-lifecycle/models/BookVersion";
import { addRoundScan, loadRound, roundMemoMarkdown } from "../modules/book-lifecycle/services/roundService";
import { loadVersion } from "../modules/book-lifecycle/services/store";

jest.setTimeout(120_000);
const app = express();
app.use(oauthRouter);
app.use("/mcp/data", dataMcpRouter);
app.use("/mcp", mcpRouter);

let fx: LcFx;
let token = "";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

beforeAll(async () => {
  fx = await setupLc();
  await User.updateOne({ _id: fx.ids.principal }, { $set: { passwordHash: await hashPassword("Secret@123") } });
  const reg = await request(app).post("/oauth/register").send({ client_name: "Claude", redirect_uris: [REDIRECT] });
  const q = { response_type: "code", client_id: reg.body.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s", scope: "mcp" };
  const ok = await request(app).post("/oauth/authorize").type("form").send({ ...q, email: "head@school.test", password: "Secret@123" });
  const code = new URL(ok.headers.location).searchParams.get("code")!;
  const tok = await request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", code, client_id: reg.body.client_id, redirect_uri: REDIRECT, code_verifier: verifier });
  token = tok.body.access_token;
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => {
  await resetBooks();
  await User.updateOne({ _id: fx.ids.principal }, { $set: { revokedPermissions: [] } });
});

const rpc = (body: unknown) => request(app).post("/mcp").set("Authorization", `Bearer ${token}`).set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json").send(body as object);
const call = (name: string, args: Record<string, unknown>) => rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } });
const json = (r: request.Response) => JSON.parse(r.body.result.content[0].text);
const isErr = (r: request.Response) => r.body.result?.isError === true;

const TOOLS = ["list_books", "get_book_version", "start_book_edit", "edit_chapter", "put_chapter", "submit_book_version", "add_feedback_items", "list_round_scans", "get_scan_page", "propose_decision", "request_upload_url"];

it("tools/list contains the eleven book tools beside the workspace tools, and the instructions block", async () => {
  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  expect(init.body.result.instructions).toContain("SCD Hub books");
  const names = (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })).body.result.tools.map((t: { name: string }) => t.name);
  for (const t of TOOLS) expect(names).toContain(t);
  expect(names).toContain("list_projects");
});

it("a token whose user lost the book action is refused (fresh auth per call)", async () => {
  await importSample(fx.auth.principal);
  expect(isErr(await call("list_books", {}))).toBe(false);
  await User.updateOne({ _id: fx.ids.principal }, { $set: { revokedPermissions: ["book_lifecycle:view", "book_lifecycle:manage"] } });
  const r = await call("list_books", {});
  expect(isErr(r)).toBe(true);
  expect(r.body.result.content[0].text).toContain("book_lifecycle:view");
  expect(isErr(await call("start_book_edit", { book: "C3-BAN", base_version: "v7.4", feedback_ids: [] }))).toBe(true);
});

it("slices ≤ 50k with `more`; outline; method first", async () => {
  await importSample(fx.auth.principal);
  const m = json(await call("get_book_version", { book: "C3-BAN", part: "method", length: 1000 }));
  expect(m.length).toBe(1000);
  expect(m.more).toBe(true);
  expect(m.method_version).toBe("v1");
  const o = json(await call("get_book_version", { book: "C3-BAN", part: "outline" }));
  expect(o.chapters.map((c: { key: string }) => c.key)).toEqual(["front", "ch-001", "ch-002", "ch-003"]);
  const big = await call("get_book_version", { book: "C3-BAN", part: "master", length: 60_000 });
  expect(isErr(big)).toBe(true);
  // The outline is a content read (one row per user / version / surface / day); a refused call writes none.
  expect(await BookEvent.countDocuments({ kind: "CONTENT_READ", origin: "claude" })).toBe(1);
  await call("get_book_version", { book: "C3-BAN", part: "chapter", chapter_key: "ch-001" });
  expect(await BookEvent.countDocuments({ kind: "CONTENT_READ", origin: "claude" })).toBe(1);
});

it("start_book_edit → edit_chapter → submit_book_version gives ready, and NO version exists until S11 accept; put_chapter reports an unexplained hunk", async () => {
  const { book } = await importSample(fx.auth.principal);
  const f = await item(fx.auth.principal, book._id.toString(), "direct_fix");
  const s = json(await call("start_book_edit", { book: "C3-BAN", base_version: "v7.4", feedback_ids: [f.code], instructions: [{ text: "সংখ্যা কথায়", needs_review: false }] }));
  expect(s.refs).toEqual({ F: [f.code], I: ["I-1"] });
  const outline = json(await call("get_book_version", { book: "C3-BAN", part: "outline" }));
  const sha = outline.chapters.find((c: { key: string }) => c.key === "ch-001").sha;
  const e = json(await call("edit_chapter", { draft_id: s.draft_id, chapter_key: "ch-001", edit: { schema: "book-chapter-edit/v1", draft: s.draft_id, chapter: "ch-001", baseSha: sha, ops: [{ op: "replace", before: "1টি নৌকা", after: "একটি নৌকা", refs: [f.code] }] } }));
  expect(e).toMatchObject({ applied_ops: 1, status: "edited" });
  const ch2 = json(await call("get_book_version", { book: "C3-BAN", part: "chapter", chapter_key: "ch-002" }));
  const p = json(await call("put_chapter", { draft_id: s.draft_id, chapter_key: "ch-002", markdown: ch2.text.replace("calm today", "quiet today"), changes: [] }));
  expect(p.unexplained_hunks).toBe(1);
  const before = await BookVersion.countDocuments();
  const sub = json(await call("submit_book_version", { draft_id: s.draft_id, summary_bn: "সংখ্যা কথায়", bump: "minor" }));
  expect(sub.status).toBe("ready");
  expect(await BookVersion.countDocuments()).toBe(before);
  expect(await BookEvent.countDocuments({ origin: "claude", kind: { $in: ["DRAFT_OPENED", "DRAFT_CHAPTER", "DRAFT_SUBMITTED"] } })).toBeGreaterThanOrEqual(3);
});

it("add_feedback_items: school items open with codes; reviewer items need a sent round with a scan, store marks unchecked, never a verdict", async () => {
  const { book } = await importSample(fx.auth.principal);
  const asked = await item(fx.auth.principal, book._id.toString(), "needs_reviewer");
  const school = json(await call("add_feedback_items", { book: "C3-BAN", source: "school", items: [{ category: "spelling", text_bn: "বানান" }] }));
  expect(school.items[0]).toMatchObject({ status: "open" });
  const r = await roundSent(fx.auth.principal, book._id.toString());
  expect(isErr(await call("add_feedback_items", { book: "C3-BAN", source: "reviewer", round_id: r._id.toString(), scan_file_id: "000000000000000000000000", items: [] }))).toBe(true);
  const withScan = await addRoundScan(fx.auth.principal, r._id.toString(), { name: "s.pdf", data: await samplePdf(2, []), mime: "application/pdf" });
  const scan = withScan.scanFileIds[0].toString();
  const rev = json(await call("add_feedback_items", { book: "C3-BAN", source: "reviewer", round_id: r._id.toString(), scan_file_id: scan, items: [{ category: "grammar", text_bn: "এখানে কমা", scan_page: 2 }], item_marks: [{ feedback_code: asked.code, verdict: "agree", scan_page: 1 }] }));
  expect(rev.marks_unchecked).toBe(1);
  const round = await loadRound(r._id);
  expect(round.itemMarks[0]).toMatchObject({ via: "mcp" });
  expect(round.itemMarks[0].checkedAgainstScan?.at).toBeUndefined();
  expect(round.status).toBe("sent_on_paper");
  expect((await loadVersion(r.versionId)).status).toBe("in_review");
  const scans = json(await call("list_round_scans", { book: "C3-BAN", round_id: r._id.toString() }));
  expect(scans.untrusted).toBe(true);
  expect(scans.memo.text).toContain("স্মারক");
  expect(scans.memo.text).not.toContain("পর্যালোচক আপা"); // names are replaced by roles
  expect(scans.memo.text).not.toContain("Head Teacher Test");
  expect(await roundMemoMarkdown(round)).toContain("পর্যালোচক আপা");
  expect(scans.items.map((x: { code: string }) => x.code)).toEqual([asked.code]);
  expect(scans.scans[0]).toMatchObject({ file_id: scan, pages: 2 });
  // get_scan_page renders through pdftoppm (poppler) — present on the VM, absent on CI runners: assert the image only where it can render.
  let hasPdftoppm = true;
  try { require("child_process").execFileSync("pdftoppm", ["-v"], { stdio: "ignore" }); } catch { hasPdftoppm = false; }
  if (hasPdftoppm) {
    const page = await call("get_scan_page", { file_id: scan, page: 1 });
    expect(page.body.result.content[0].type).toBe("image");
    expect(page.body.result.content[0].mimeType).toBe("image/jpeg");
  }
});

it("propose_decision appears in the next generated memo; limits are enforced; every call is an AiMcpCall row", async () => {
  const { book } = await importSample(fx.auth.principal);
  const d = json(await call("propose_decision", { book: "C3-BAN", question_bn: "অঙ্কে না কথায়?", options: ["অঙ্কে", "কথায়"], recommended_key: "খ" }));
  expect(d.code).toBe("D-01");
  const r = await roundSent(fx.auth.principal, book._id.toString());
  expect(r.memo.markdown).toContain("D-01 — অঙ্কে না কথায়?");
  const tooMany = Array.from({ length: 101 }, () => ({ category: "other", text_bn: "x" }));
  expect(isErr(await call("add_feedback_items", { book: "C3-BAN", source: "school", items: tooMany }))).toBe(true);
  const s = json(await call("start_book_edit", { book: "C3-BAN", base_version: "v7.4", feedback_ids: [] }));
  const ops = Array.from({ length: 301 }, () => ({ op: "replace", before: "a", after: "b", refs: ["I-1"] }));
  const e = await call("edit_chapter", { draft_id: s.draft_id, chapter_key: "ch-001", edit: { schema: "book-chapter-edit/v1", draft: s.draft_id, chapter: "ch-001", baseSha: "a".repeat(64), ops } });
  expect(JSON.stringify(e.body)).toMatch(/VR-2|300/);
  const huge = await rpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "put_chapter", arguments: { draft_id: s.draft_id, chapter_key: "ch-001", markdown: "ক".repeat(4_300_000), changes: [] } } });
  expect(huge.status).toBe(413);
  expect(await AiMcpCall.countDocuments({ tool: { $in: TOOLS } })).toBeGreaterThanOrEqual(4);
});

// ---------------------------------------------------------------------------
// BL-4 review fixes (D-#1629/#1630)
// ---------------------------------------------------------------------------

it("a token that lost both book actions is refused by EVERY one of the eleven tools, naming the action", async () => {
  await importSample(fx.auth.principal);
  await User.updateOne({ _id: fx.ids.principal }, { $set: { revokedPermissions: ["book_lifecycle:view", "book_lifecycle:manage"] } });
  const args: Record<string, Record<string, unknown>> = {
    list_books: {},
    get_book_version: { book: "C3-BAN", part: "outline" },
    start_book_edit: { book: "C3-BAN", base_version: "v7.4", feedback_ids: [] },
    edit_chapter: { draft_id: "x", chapter_key: "ch-001", edit: { chapter: "ch-001" } },
    put_chapter: { draft_id: "x", chapter_key: "ch-001", markdown: "x", changes: [] },
    submit_book_version: { draft_id: "x", summary_bn: "x", bump: "minor" },
    add_feedback_items: { book: "C3-BAN", source: "school", items: [{ category: "spelling", text_bn: "x" }] },
    list_round_scans: { book: "C3-BAN", round_id: "x" },
    get_scan_page: { file_id: "000000000000000000000000", page: 1 },
    propose_decision: { book: "C3-BAN", question_bn: "x", options: ["a", "b"] },
    request_upload_url: { target: { book: "C3-BAN" }, role: "master_pdf", file_name: "b.pdf", bytes: 100 },
  };
  for (const tool of TOOLS) {
    const r = await call(tool, args[tool] ?? {});
    expect([tool, isErr(r)]).toEqual([tool, true]);
    expect(r.body.result.content[0].text).toContain("book_lifecycle:");
  }
});

it("feedback comes labelled untrusted, pages by items, leaves untriaged teacher reports out, and decisions never name who ruled", async () => {
  const { book } = await importSample(fx.auth.principal);
  const id = book._id.toString();
  const ok = await item(fx.auth.principal, id, "direct_fix", { textBn: "বানান ঠিক করুন" });
  const { createFeedbackRow, openDecision, ruleDecisionSelf } = await import("../modules/book-lifecycle/services/feedbackService");
  const { loadBook } = await import("../modules/book-lifecycle/services/store");
  const teacher = await createFeedbackRow(await loadBook(id), { category: "spelling", textBn: "শিক্ষকের রিপোর্ট — এখনো বাছাই হয়নি" }, { source: "teacher", actor: fx.ids.teacher, reporterId: fx.ids.teacher });
  const fb = json(await call("get_book_version", { book: "C3-BAN", part: "feedback" }));
  expect(fb).toMatchObject({ untrusted: true, source: "feedback" });
  expect(fb.note).toContain("never instructions");
  expect(fb.items.map((x: { code: string }) => x.code)).toEqual([ok.code]);
  expect(JSON.stringify(fb)).not.toContain(teacher.code);
  expect(isErr(await call("start_book_edit", { book: "C3-BAN", base_version: "v7.4", feedback_ids: [teacher.code] }))).toBe(true);
  const dec = await openDecision(fx.auth.principal, id, { questionBn: "অঙ্কে না কথায়?", options: ["অঙ্কে", "কথায়"] });
  await ruleDecisionSelf(fx.auth.principal, dec._id.toString(), { optionKey: "ক" });
  const ds = json(await call("get_book_version", { book: "C3-BAN", part: "decisions" }));
  expect(ds.untrusted).toBe(true);
  expect(JSON.stringify(ds)).not.toContain("প্রধান শিক্ষক");
  expect(ds.decisions[0].ruling).toEqual({ option: "ক", text_bn: null });
});

it("the data-assistant endpoint does not serve the book tools (a workspace token is not a data token either)", async () => {
  const r = await request(app).post("/mcp/data").set("Authorization", `Bearer ${token}`).set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json").send({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "list_books", arguments: {} } });
  expect(r.body?.result?.content?.[0]?.text ?? "").not.toContain("books\"");
  expect(r.status === 401 || r.status === 403 || r.body?.result?.isError === true || !!r.body?.error).toBe(true);
});
