/**
 * BL-3 — the editing method is one source (docs/prd-book-lifecycle.md §13, §19 bookMethodParity; D-#1602).
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { readFileSync } from "fs";
import * as path from "path";
import JSZip from "jszip";
import { setupLc, teardownLc, resetBooks, importSample, item, type LcFx } from "./bookLcFixtures";
import { apiMethodParts, methodSections, methodText, METHOD_VERSION } from "../modules/book-lifecycle/services/method";
import { downloadBundle } from "../modules/book-lifecycle/services/bundle";
import { openEditDraft } from "../modules/book-lifecycle/services/draftService";
import { sha256 } from "../modules/book-lifecycle/services/markdown";

const FILE = path.resolve(__dirname, "../../assets/book-lifecycle/edit_method_v1.md");
let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());

it("the method file carries M-0 … M-8 section markers with their users", () => {
  const ids = methodSections().map((s) => s.id);
  expect(ids).toEqual(["M-0", "M-1", "M-2", "M-3", "M-4", "M-5", "M-6", "M-7", "M-8"]);
  for (const s of methodSections()) expect(s.usedBy.length).toBeGreaterThan(0);
  expect(methodSections().find((s) => s.id === "M-7")?.usedBy).toEqual(["mcp", "bundle"]);
});

it("the Path A prompt parts are byte slices of the file", () => {
  const raw = readFileSync(FILE, "utf8");
  const { common, outputContract } = apiMethodParts();
  for (const s of methodSections()) expect(raw.slice(s.start, s.end)).toBe(s.text);
  expect(raw.includes(outputContract)).toBe(true);
  for (const s of methodSections().filter((x) => x.usedBy.includes("api") && x.id !== "M-6")) expect(common.includes(s.text)).toBe(true);
  expect(methodText().hash).toBe(sha256(raw));
});

it("the bundle embeds the same bytes; drafts are stamped with the method version and hash", async () => {
  const { book } = await importSample(fx.auth.principal);
  const f = await item(fx.auth.principal, book._id.toString(), "direct_fix");
  const d = await openEditDraft(fx.auth.principal, book._id.toString(), { source: "mcp", feedback: [f.code] });
  expect(d.methodVersion).toBe(METHOD_VERSION);
  expect(d.methodHash).toBe(sha256(readFileSync(FILE, "utf8")));
  const b = await downloadBundle(fx.auth.principal, book._id.toString(), { feedback: [f.code] });
  const zip = await JSZip.loadAsync(b.zip);
  expect(await zip.file("METHOD.md")!.async("string")).toBe(readFileSync(FILE, "utf8"));
});

it("the method holds no book text or names (invented examples only) and stays under ~6,000 tokens", () => {
  const raw = readFileSync(FILE, "utf8");
  expect(raw.length).toBeLessThan(24_000);
  expect(raw).toMatch(/invented/i);
});
