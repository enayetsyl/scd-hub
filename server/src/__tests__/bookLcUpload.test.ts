/**
 * BL-1 — upload, normalisation, chapters, markers, re-keying, parts, content-addressed chapters,
 * media, caps (docs/prd-book-lifecycle.md §6, §19 bookLcUpload). Invented text only.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import JSZip from "jszip";
import { setupLc, teardownLc, resetBooks, sampleMaster, type LcFx } from "./bookLcFixtures";
import { normaliseMarkdown, parseMaster, splitAndKey, chapterParts, FRONT_KEY } from "../modules/book-lifecycle/services/markdown";
import { importBook, uploadNewVersionDraft, setDraftChanges, decideDraftChapter, acceptDraft, confirmDraftRekey } from "../modules/book-lifecycle/services/versionService";
import { fileFeedback, triageFeedback } from "../modules/book-lifecycle/services/feedbackService";
import { BookChapterText, BookMediaAsset } from "../modules/book-lifecycle/models/BookVersion";
import { storedMaster } from "../modules/book-lifecycle/services/store";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());

const importArgs = (md: string, extra: Record<string, unknown> = {}) => ({
  code: "C3-BAN",
  classLevel: 3,
  subject: "BAN",
  titleBn: "পরীক্ষার বই",
  version: "v7.4",
  state: "draft" as const,
  masterMd: Buffer.from(md),
  ...extra,
});

describe("§6.1 normalisation", () => {
  it("removes the BOM, turns CRLF into LF and composes to NFC", () => {
    const decomposed = "কো"; // ক + ে + া (decomposed form of কো)
    const t = normaliseMarkdown(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`a\r\nb ${decomposed}\r\n`)]));
    expect(t.charCodeAt(0)).not.toBe(0xfeff);
    expect(t).not.toContain("\r");
    expect(t).toBe(`a\nb ${decomposed.normalize("NFC")}\n`);
    expect(t.includes("ো")).toBe(false);
  });
  it("refuses invalid UTF-8 in Bangla", () => {
    expect(() => normaliseMarkdown(Buffer.from([0x61, 0xff, 0xfe, 0x62]))).toThrow(/UTF-8/);
  });
});

describe("§6.2 chapters", () => {
  it("splits at the chosen level; text before the first chapter is `front`; slices reproduce the master", () => {
    const md = sampleMaster({ chapters: 3 });
    const p = parseMaster(md, 2);
    expect(p.chapters).toHaveLength(3);
    expect(p.front).toContain("খেলার বই");
    expect(p.front + p.chapters.map((c) => c.text).join("")).toBe(md);
    // level 3 splits at the exercises instead
    expect(parseMaster(md, 3).chapters).toHaveLength(3);
    expect(parseMaster(md, 3).chapters[0].title).toContain("অনুশীলনী");
  });
  it("a part heading directly before a chapter belongs to that chapter; headings in code fences are ignored", () => {
    const md = "front\n\n# অংশ এক\n\n## প্রথম\nলেখা\n```\n## not a heading\n```\n## দ্বিতীয়\nলেখা\n";
    const p = parseMaster(md, 2);
    expect(p.chapters.map((c) => c.title)).toEqual(["প্রথম", "দ্বিতীয়"]);
    expect(p.chapters[0].text.startsWith("# অংশ এক")).toBe(true);
    expect(p.front).toBe("front\n\n");
  });
  it("inserts markers ch-001… before each chapter (front has none)", () => {
    const s = splitAndKey(sampleMaster(), 2, { maxChapterNo: 0 });
    expect(s.chapters.map((c) => c.key)).toEqual(["ch-001", "ch-002", "ch-003"]);
    expect(s.master).toContain("<!-- bl:ch ch-002 -->\n## অধ্যায় 2");
    expect(s.front).not.toContain("bl:ch");
  });
  it("re-keys an unmarked upload by heading text and order, listing new and missing chapters", () => {
    const parent = [
      { key: "ch-001", title: "অধ্যায় 1: নদীর গল্প 1" },
      { key: "ch-002", title: "অধ্যায় 2: নদীর গল্প 2" },
      { key: "ch-003", title: "অধ্যায় 3: নদীর গল্প 3" },
    ];
    // chapter 2 removed, a new one added at the end, order of 1 and 3 kept
    const md = sampleMaster({ chapters: 3 }).replace(/## অধ্যায় 2: নদীর গল্প 2[\s\S]*?(?=## অধ্যায় 3)/, "") + "## নতুন অধ্যায়\nনতুন লেখা\n";
    const s = splitAndKey(md, 2, { parent, maxChapterNo: 3 });
    expect(s.rekeyed).toBe(true);
    expect(s.chapters.map((c) => c.key)).toEqual(["ch-001", "ch-003", "ch-004"]);
    expect(s.newChapters).toEqual(["নতুন অধ্যায়"]);
    expect(s.missingChapters).toEqual(["ch-002"]);
  });
  it("keeps existing markers byte for byte and refuses a stray or duplicated marker", () => {
    const md = sampleMaster({ markers: true });
    expect(splitAndKey(md, 2, { maxChapterNo: 0 }).master).toBe(md);
    expect(() => splitAndKey(md + "\n<!-- bl:ch ch-009 -->\nloose\n", 2, { maxChapterNo: 0 })).toThrow(/অধ্যায়-চিহ্ন/);
    expect(() => splitAndKey(md.replace("ch-003", "ch-002"), 2, { maxChapterNo: 0 })).toThrow(/দুবার/);
  });
  it("cuts a chapter over 60,000 characters into parts at its ### headings", () => {
    const sec = (n: number) => `### অংশ ${n}\n${"ক".repeat(25_000)}\n`;
    const text = `## বড় অধ্যায়\n${sec(1)}${sec(2)}${sec(3)}`;
    const parts = chapterParts("ch-012", text, 2);
    expect(parts.map((p) => p.key)).toEqual(["ch-012.p1", "ch-012.p2"]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts.every((p) => p.text.length <= 60_000)).toBe(true);
    expect(chapterParts("ch-001", "## ছোট\nলেখা\n")).toHaveLength(1);
  });
});

describe("import and upload", () => {
  it("imports at v7.4 with markers, content-addressed chapters shared across versions", async () => {
    const { version } = await importBook(fx.auth.principal, importArgs(sampleMaster()));
    expect(`${version.major}.${version.minor}`).toBe("7.4");
    expect(version.chapters.map((c) => c.key)).toEqual([FRONT_KEY, "ch-001", "ch-002", "ch-003"]);
    expect(version.imported?.by).toBeDefined();
    const before = await BookChapterText.countDocuments();

    // Upload v7.5 changing only chapter 2 (the server-made master, marker-preserving).
    const master = await storedMaster(version);
    const changed = master.replace("2টি নৌকা", "দুটি নৌকা");
    const draft = await uploadNewVersionDraft(fx.auth.principal, version.bookId.toString(), { masterMd: Buffer.from(changed) });
    expect(draft.chapters.filter((c) => c.status === "edited").map((c) => c.key)).toEqual(["ch-002"]);
    const f = await fileFeedback(fx.auth.principal, version.bookId.toString(), "school", { category: "spelling", textBn: "সংখ্যা কথায় লিখুন", chapterKey: "ch-002" });
    await triageFeedback(fx.auth.principal, [f._id.toString()], { kind: "route", route: "direct_fix" });
    await setDraftChanges(fx.auth.principal, draft._id.toString(), [{ chapterKey: "ch-002", beforeExcerpt: "2টি", afterExcerpt: "দুটি", reason: "বানান", refs: [f.code] }]);
    await decideDraftChapter(fx.auth.principal, draft._id.toString(), "ch-002", true);
    const v2 = await acceptDraft(fx.auth.principal, draft._id.toString(), { summaryBn: "সংখ্যা কথায়" });
    expect(`${v2.major}.${v2.minor}`).toBe("7.5");
    // Only ch-002 + the front (server regions rewritten for the new version) are new rows.
    expect(await BookChapterText.countDocuments()).toBe(before + 2);
    const shared = version.chapters.filter((c) => ["ch-001", "ch-003"].includes(c.key)).map((c) => c.textSha256);
    expect(v2.chapters.filter((c) => ["ch-001", "ch-003"].includes(c.key)).map((c) => c.textSha256)).toEqual(shared);
  });

  it("an unmarked re-upload is re-keyed and needs the person's confirmation for new/missing chapters", async () => {
    const { version } = await importBook(fx.auth.principal, importArgs(sampleMaster()));
    const unmarked = (await storedMaster(version)).replace(/<!-- bl:ch ch-\d+ -->\n/g, "") + "## একদম নতুন\nলেখা\n";
    const draft = await uploadNewVersionDraft(fx.auth.principal, version.bookId.toString(), { masterMd: Buffer.from(unmarked) });
    expect(draft.rekey?.newChapters).toEqual(["একদম নতুন"]);
    expect(draft.rekey?.confirmed).toBe(false);
    expect(draft.chapters.find((c) => c.title === "একদম নতুন")?.key).toBe("ch-004");
    expect(draft.chapters.find((c) => c.key === "ch-002")?.status).toBe("unchanged");
    await decideDraftChapter(fx.auth.principal, draft._id.toString(), "ch-004", true);
    const f = await fileFeedback(fx.auth.principal, version.bookId.toString(), "school", { category: "other", textBn: "নতুন অধ্যায় যোগ" });
    await triageFeedback(fx.auth.principal, [f._id.toString()], { kind: "route", route: "needs_reviewer" });
    await setDraftChanges(fx.auth.principal, draft._id.toString(), [{ chapterKey: "ch-004", reason: "নতুন অধ্যায়", refs: [f.code] }]);
    await expect(acceptDraft(fx.auth.principal, draft._id.toString(), { summaryBn: "নতুন" })).rejects.toThrow(/নিশ্চিত/);
    await confirmDraftRekey(fx.auth.principal, draft._id.toString());
    const v2 = await acceptDraft(fx.auth.principal, draft._id.toString(), { summaryBn: "নতুন" });
    expect(v2.chapters.map((c) => c.key)).toContain("ch-004");
  });

  it("resolves media references from a media zip (de-duplicated) and names a missing picture", async () => {
    const md = sampleMaster() + "## ছবির অধ্যায়\n![নৌকা](media/image1.png)\n";
    await expect(importBook(fx.auth.principal, importArgs(md))).rejects.toThrow(/image1\.png/);
    const zip = new JSZip();
    zip.file("media/image1.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    const { version } = await importBook(fx.auth.principal, importArgs(md, { mediaZip: await zip.generateAsync({ type: "nodebuffer" }) }));
    expect(version.media.map((m) => m.path)).toEqual(["media/image1.png"]);
    expect(await BookMediaAsset.countDocuments()).toBe(1);
  });

  it("refuses an oversize master in Bangla, and a book with no chapters", async () => {
    const huge = Buffer.alloc(5 * 1024 * 1024 + 1, 0x61);
    await expect(importBook(fx.auth.principal, importArgs("", { masterMd: huge }))).rejects.toThrow(/মেগাবাইট/);
    await expect(importBook(fx.auth.principal, importArgs("শুধু লেখা, কোনো শিরোনাম নেই\n"))).rejects.toThrow(/অধ্যায়/);
  });
});
