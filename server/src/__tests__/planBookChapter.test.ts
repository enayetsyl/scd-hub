/**
 * planBookChapter — the school's own book beside a lesson plan (.claude/plans/plan-book-tab.md, Step 1).
 * mongodb-memory-server (main DB + a second DB for the book plane), Drive in memory. Invented text only.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import mongoose, { Types } from "mongoose";
import JSZip from "jszip";
import { setupLc, teardownLc, resetBooks, samplePdf, seedSchool, item, childVersion, type LcFx, type School } from "./bookLcFixtures";
import { importBook, markFinal, uploadVersionFile } from "../modules/book-lifecycle/services/versionService";
import { createRelease, addReleaseFile, recordRelease } from "../modules/book-lifecycle/services/releaseService";
import { SchoolBook } from "../modules/book-lifecycle/models/SchoolBook";
import { loadBook, loadVersion } from "../modules/book-lifecycle/services/store";
import { BookMediaAsset } from "../modules/book-lifecycle/models/BookVersion";
import { BookEvent } from "../modules/support-book/models/BookEvent";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { BookPdf } from "../modules/book-pdf/models/BookPdf";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { planBookForCaller, chapterNumberOfTitle, matchDefaultChapter, clearPlanBookCache, planBookCacheSize } from "../modules/book-lifecycle/services/planBook";
import { assertBookLcFileReadAccess } from "../modules/book-lifecycle/routes/bookLcFiles";
import { ForbiddenError } from "../middleware/authz";
import type { AppContext, AuthPayload } from "../context";

let fx: LcFx;
let school: School;
beforeAll(async () => {
  jest.spyOn(console, "warn").mockImplementation(() => undefined); // the cut logs its warnings; expected here
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => {
  await resetBooks();
  await ContentArtifact.deleteMany({});
  clearPlanBookCache();
  school = await seedSchool();
});
const P = () => fx.auth.principal;
const ctx = (auth: AuthPayload) => ({ auth }) as AppContext;
const J = (...p: string[]) => p.join("\n\n") + "\n\n";

const MASTER = [
  "# খেলার বই — পরীক্ষামূলক",
  "",
  "ভূমিকা: এটি একটি কাল্পনিক বই।",
  "",
  J(
    "## পাঠ ১: গাছ",
    "![গাছ](media/tree.jpg)",
    '<table><tr><td><img src="media/tree.jpg" alt="গাছ"></td></tr></table>',
    "**পর্যালোচনা-নোট — শুধু পর্যালোচকের জন্য**",
    "গোপন পর্যালোচনা: ছবির মান দেখুন।",
    "**শিক্ষক-নোট — পাঠ ১**",
    "শিক্ষক ক্লাসে গাছের ছবি দেখাবেন।",
    "<!-- note: remove later -->",
    "গাছের শিকড় মাটির নিচে থাকে এবং পানি টেনে নেয়।",
    "গাছের পাতা সূর্যের আলো থেকে খাবার তৈরি করে।",
  ),
  J(
    "## পাঠ ২: ফুল",
    "**পর্যালোচনা-নোট —** দ্বিতীয় পাঠের পর্যালোচনা।",
    "**শিক্ষক-নোট —** দ্বিতীয় পাঠের শিক্ষক-নির্দেশ।",
    "ফুলের রঙ নানা রকম হয় এবং সুগন্ধ ছড়ায়।",
  ),
  J(
    "## Unit 3: River Story",
    "**পর্যালোচনা-নোট —** তৃতীয়।",
    "**শিক্ষক-নোট —** তৃতীয় শিক্ষক-নির্দেশ।",
    "The river is calm and the boats are slow today.",
  ),
].join("\n");

const para = (style: string | null, text: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;
async function studentDocx(lines: [string | null, string][]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map(([s, t]) => para(s, t)).join("")}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}
const STUDENT = () =>
  studentDocx([
    ["Heading2", "পাঠ ১: গাছ"],
    [null, "গাছের শিকড় মাটির নিচে থাকে এবং পানি টেনে নেয়।"],
    [null, "গাছের পাতা সূর্যের আলো থেকে খাবার তৈরি করে।"],
    ["Heading2", "পাঠ ২: ফুল"],
    [null, "ফুলের রঙ নানা রকম হয় এবং সুগন্ধ ছড়ায়।"],
    ["Heading2", "Unit 3: River Story"],
    [null, "The river is calm and the boats are slow today."],
  ]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const mediaZip = async () => {
  const z = new JSZip();
  z.file("media/tree.jpg", JPG);
  return z.generateAsync({ type: "nodebuffer" });
};

/** A final book (class 3 BAN): optional student docx, optional release. */
async function finalBook(opts: { code?: string; classLevel?: number; subject?: string; master?: string; docx?: Buffer | null; release?: boolean; state?: "draft" | "approved" } = {}) {
  const { book, version } = await importBook(P(), {
    code: opts.code ?? "C3-BAN",
    classLevel: opts.classLevel ?? 3,
    subject: opts.subject ?? "BAN",
    titleBn: "পরীক্ষার বই",
    version: "v3.1",
    state: opts.state ?? "approved",
    masterMd: Buffer.from(opts.master ?? MASTER),
    mediaZip: await mediaZip(),
  });
  if ((opts.state ?? "approved") === "draft") return { book, version };
  const vid = version._id.toString();
  await uploadVersionFile(P(), vid, { role: "edition", edition: "TEACHER", name: "TEACHER.pdf", data: await samplePdf(1, []), mime: "application/pdf" });
  const docx = opts.docx === undefined ? await STUDENT() : opts.docx;
  await uploadVersionFile(P(), vid, docx ? { role: "edition", edition: "STUDENT", name: "STUDENT.docx", data: docx } : { role: "edition", edition: "STUDENT", name: "STUDENT.pdf", data: await samplePdf(1, []) });
  await markFinal(P(), vid);
  if (opts.release) {
    const r = await createRelease(P(), vid, { labelBn: "প্রথম ছাপা (কাল্পনিক)" });
    await addReleaseFile(P(), r._id.toString(), { edition: "STUDENT", kind: "idml_zip", name: "s.zip", data: Buffer.from("PK\x03\x04fx"), mime: "application/zip" });
    await addReleaseFile(P(), r._id.toString(), { edition: "STUDENT", kind: "preview_pdf", name: "s.pdf", data: await samplePdf(2, []), mime: "application/pdf" });
    await recordRelease(P(), r._id.toString());
  }
  return { book: await loadBook(book._id), version: await loadVersion(version._id) };
}

async function plan(address: { anchorWord: string; number: number | string; title?: string }, over: { classLevel?: number; subject?: string } = {}) {
  const d = await ContentArtifact.create({
    docType: "chapter_plan",
    subject: over.subject ?? "BAN",
    classLevel: over.classLevel ?? 3,
    address,
    curationTag: "KEEP_AS_IS",
    reviewStatus: "gold",
    envelopeJson: {},
    current: true,
    importedBy: new Types.ObjectId(),
  });
  return d._id.toString();
}

describe("the book that is served", () => {
  it("serves the final version and says it is not printed yet", async () => {
    await finalBook();
    const r = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 1 }));
    expect(r.available).toBe(true);
    expect(r.versionLabel).toBe("v3.1");
    expect(r.released).toBe(false);
    expect(r.bookTitle).toBe("পরীক্ষার বই");
  });

  it("prefers the current print release's version", async () => {
    await finalBook({ release: true });
    const r = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 1 }));
    expect(r.released).toBe(true);
    expect(r.versionLabel).toBe("v3.1");
  });

  it("never serves a draft or the latest version: a newer child stays out", async () => {
    const { book } = await finalBook({ release: true });
    const f = await item(P(), book._id.toString(), "verbal_errata", { quote: "গাছের শিকড় মাটির নিচে থাকে" });
    const child = await childVersion(P(), book._id.toString(), "গাছের শিকড় মাটির নিচে থাকে", "গাছের মূল মাটির নিচে থাকে", [f.code]);
    expect((await loadBook(book._id)).latestVersionId?.equals(child._id)).toBe(true);
    const r = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 1 }));
    expect(r.versionLabel).toBe("v3.1");
    expect(r.childText).toMatch(/গাছের শিকড় মাটির নিচে/);
    expect(r.childText).not.toMatch(/গাছের মূল/);
  });

  it("a book with only a draft → available:false (a Bangla reason, no error)", async () => {
    await finalBook({ state: "draft" });
    const r = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 1 }));
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/চূড়ান্ত সংস্করণ/);
    expect(r.childText).toBeNull();
  });

  it("no book for the class/subject → available:false, not an error", async () => {
    await finalBook();
    const r = await planBookForCaller(ctx(P()), await plan({ anchorWord: "Unit", number: 1 }, { subject: "ENG", classLevel: 2 }));
    expect(r).toMatchObject({ available: false, reason: "এই বইটি এখনো অ্যাপে নেই", chapters: [], childText: null });
  });

  it("an archived book is not served → available:false", async () => {
    const { book } = await finalBook({ release: true });
    await SchoolBook.updateOne({ _id: book._id }, { $set: { archived: true } });
    const r = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 1 }));
    expect(r).toMatchObject({ available: false, reason: "এই বইটি এখনো অ্যাপে নেই", childText: null });
  });

  it("an unknown artifact id → available:false", async () => {
    expect((await planBookForCaller(ctx(P()), new Types.ObjectId().toString())).available).toBe(false);
    expect((await planBookForCaller(ctx(P()), "nonsense")).available).toBe(false);
  });
});

describe("the chapter", () => {
  beforeEach(async () => {
    await finalBook({ release: true });
  });

  it("matches the default chapter by the plan's number (ASCII or Bangla digits)", async () => {
    const r = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 2 }));
    expect(r.chapterKey).toBe("ch-002");
    expect(r.title).toBe("পাঠ ২: ফুল");
    const r2 = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: "২" }));
    expect(r2.chapterKey).toBe("ch-002");
    expect(r.chapters.map((c) => [c.key, c.number])).toEqual([["ch-001", 1], ["ch-002", 2], ["ch-003", 3]]);
    expect(r.chapters.some((c) => c.key === "front")).toBe(false);
  });

  it("falls back to the title text, then to no chapter (the app shows the list)", async () => {
    const byTitle = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "?", number: "x", title: "ফুল" }));
    expect(byTitle.chapterKey).toBe("ch-002");
    const none = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 9, title: "অজানা" }));
    expect(none).toMatchObject({ available: true, chapterKey: null, childText: null });
    expect(none.chapters).toHaveLength(3);
  });

  it("chapterKey overrides; one that is not in the version is ignored without an error", async () => {
    const id = await plan({ anchorWord: "পাঠ", number: 1 });
    expect((await planBookForCaller(ctx(school.routineTeacher), id, "ch-003")).chapterKey).toBe("ch-003");
    const bad = await planBookForCaller(ctx(school.routineTeacher), id, "ch-099");
    expect(bad).toMatchObject({ available: true, chapterKey: null, childText: null });
    expect(bad.reason).toMatch(/অধ্যায়/);
  });

  it("number helpers read a decomposed য় (ya + nukta) like the precomposed one", () => {
    expect(chapterNumberOfTitle("অধ্যা\u09AF\u09BC ৪: নদী")).toBe(4);
    expect(chapterNumberOfTitle("অধ্যা\u09DF ৪: নদী")).toBe(4);
  });

  it("number helpers", () => {
    expect(chapterNumberOfTitle("পাঠ ১২: নদী")).toBe(12);
    expect(chapterNumberOfTitle("Unit 3: River")).toBe(3);
    expect(chapterNumberOfTitle("৪. ছড়া")).toBe(4);
    expect(chapterNumberOfTitle("ভূমিকা")).toBeNull();
    const ch = [{ key: "a", title: "Unit 3: A", number: 3 }, { key: "b", title: "Lesson 3: B", number: 3 }];
    expect(matchDefaultChapter(ch, { anchorWord: "Lesson", number: 3 })).toBe("b");
  });
});

describe("the cut, end to end", () => {
  it("children's text first, teacher note separate, review note gone, comments stripped", async () => {
    await finalBook({ release: true });
    const r = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 1 }));
    expect(r.anchorMissing).toBe(false);
    expect(r.childText!.startsWith("## পাঠ ১: গাছ")).toBe(true);
    expect(r.childText).toMatch(/গাছের শিকড় মাটির নিচে/);
    expect(r.childText).not.toMatch(/শিক্ষক ক্লাসে|পর্যালোচনা|গোপন|<!--/);
    expect(r.teacherNote).not.toMatch(/শিক্ষক-নোট —/); // label line dropped: the app titles the fold
    expect(r.teacherNote).toMatch(/শিক্ষক ক্লাসে গাছের ছবি/);
    expect(r.teacherNote).not.toMatch(/পর্যালোচনা|গোপন|<!--|remove later/);
    expect(r.childText).not.toMatch(/bl:ch/);
  });

  it("no readable student edition → the whole chapter minus the review note, anchorMissing", async () => {
    await finalBook({ release: true, docx: null });
    const r = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 1 }));
    expect(r.anchorMissing).toBe(true);
    expect(r.teacherNote).toBeNull();
    expect(r.childText).not.toMatch(/গোপন|পর্যালোচনা-নোট/);
    expect(r.childText).toMatch(/শিক্ষক ক্লাসে গাছের ছবি/);
  });

  it("before-heading layout needs no edition", async () => {
    const before = [
      "# বই",
      "",
      "ভূমিকা।",
      "",
      J("**পর্যালোচনা-নোট — পাঠ ১**", "প্রথম পর্যালোচনা।", "**শিক্ষক-নোট — পাঠ ১**", "প্রথম শিক্ষক-নির্দেশ।"),
      J("## পাঠ ১: পাখি", "পাখি আকাশে ওড়ে।", "পাখির বাসা গাছে থাকে।", "ছোট পাখি মিষ্টি করে ডাকে।", "**পর্যালোচনা-নোট — পাঠ ২**", "দ্বিতীয় পর্যালোচনা।", "**শিক্ষক-নোট — পাঠ ২**", "দ্বিতীয় শিক্ষক-নির্দেশ।"),
      J("## পাঠ ২: মাছ", "মাছ পানিতে থাকে।"),
    ].join("\n");
    await finalBook({ master: before, docx: null, release: true });
    const r = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 2 }));
    expect(r.anchorMissing).toBe(false);
    expect(r.childText).toMatch(/^## পাঠ ২: মাছ/);
    expect(r.teacherNote).toMatch(/দ্বিতীয় শিক্ষক-নির্দেশ/);
    expect(r.childText).not.toMatch(/পর্যালোচনা/);
  });
});

describe("the cut cache", () => {
  it("is not filled when the student edition could not be read, and is when it could", async () => {
    await finalBook({ release: true, docx: Buffer.from("PK\x03\x04 not a real docx") });
    const id = await plan({ anchorWord: "পাঠ", number: 1 });
    const r = await planBookForCaller(ctx(school.routineTeacher), id);
    expect(r.anchorMissing).toBe(true);
    expect(planBookCacheSize()).toBe(0);
  });

  it("a good edition is cached; no docx edition at all is also cached (not needed)", async () => {
    await finalBook({ release: true });
    await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 1 }));
    expect(planBookCacheSize()).toBe(1);
    clearPlanBookCache();
    await resetBooks();
    await finalBook({ release: true, docx: null });
    await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 1 }));
    expect(planBookCacheSize()).toBe(1);
  });
});

describe("pictures", () => {
  it("rewrites media/… to the app file URL of that version's asset and lists it", async () => {
    const { version } = await finalBook({ release: true });
    const asset = await BookMediaAsset.findById(version.media[0].assetId);
    const r = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 1 }));
    const url = `/files/${asset!.storedFileId}`;
    expect(r.childText).toContain(`![গাছ](${url})`);
    expect(r.childText).not.toContain("media/tree.jpg");
    expect(r.childText).toContain(`<img src="${url}"`);
    expect(r.pictures).toEqual([{ path: "media/tree.jpg", url }]);
  });
});

describe("gates", () => {
  it("refused without lesson_plans:read_book (revoked), and for a guardian", async () => {
    await finalBook();
    const id = await plan({ anchorWord: "পাঠ", number: 1 });
    const revoked: AuthPayload = { ...school.routineTeacher, revokedPermissions: ["lesson_plans:read_book"] };
    await expect(planBookForCaller(ctx(revoked), id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(planBookForCaller(ctx(fx.auth.guardian), id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(planBookForCaller({ auth: null } as unknown as AppContext, id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refused when the plan itself is out of the caller's scope (same rule as artifact)", async () => {
    await finalBook();
    const id = await plan({ anchorWord: "পাঠ", number: 1 });
    await expect(planBookForCaller(ctx(school.otherTeacher), id)).rejects.toBeInstanceOf(ForbiddenError);
    // the teacher who teaches it, the Principal and Office (view_all) are in
    for (const who of [school.routineTeacher, P(), fx.auth.office]) expect((await planBookForCaller(ctx(who), id)).available).toBe(true);
  });

  it("records one content read (surface plan) per user, version and day", async () => {
    const { version } = await finalBook();
    const id = await plan({ anchorWord: "পাঠ", number: 1 });
    await planBookForCaller(ctx(school.routineTeacher), id);
    await planBookForCaller(ctx(school.routineTeacher), id, "ch-002");
    const n = await BookEvent.countDocuments({ kind: "CONTENT_READ", "refs.versionId": version._id, summary: /content read \(plan/ });
    expect(n).toBe(1);
  });
});

describe("GET /files/:id gate for book pictures", () => {
  const mediaFile = async (versionId: Types.ObjectId | string) => {
    const v = await loadVersion(versionId);
    const asset = await BookMediaAsset.findById(v.media[0].assetId);
    return (await StoredFile.findById(asset!.storedFileId))!;
  };

  it("a read_book holder opens a picture of the served version; guardian and a revoked holder do not", async () => {
    const { version } = await finalBook({ release: true });
    const file = await mediaFile(version._id);
    await expect(assertBookLcFileReadAccess(ctx(school.routineTeacher), file)).resolves.toBeUndefined();
    await expect(assertBookLcFileReadAccess(ctx(fx.auth.office), file)).resolves.toBeUndefined();
    await expect(assertBookLcFileReadAccess(ctx(fx.auth.guardian), file)).rejects.toBeInstanceOf(ForbiddenError);
    const revoked: AuthPayload = { ...school.routineTeacher, revokedPermissions: ["lesson_plans:read_book"] };
    await expect(assertBookLcFileReadAccess(ctx(revoked), file)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a picture of a book with no final/released version stays closed", async () => {
    const { version } = await finalBook({ state: "draft", code: "C4-BAN", classLevel: 4 });
    const file = await mediaFile(version._id);
    await expect(assertBookLcFileReadAccess(ctx(school.routineTeacher), file)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("nothing else widens: editions, masters and print files stay closed to a read_book holder", async () => {
    const { version } = await finalBook({ release: true });
    const v = await loadVersion(version._id);
    for (const f of v.files) {
      const sf = (await StoredFile.findById(f.storedFileId))!;
      await expect(assertBookLcFileReadAccess(ctx(school.otherTeacher), sf)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("a picture that the served version does not use stays closed (older version's asset)", async () => {
    const { book, version } = await finalBook({ release: true });
    // a stray asset of the same book that no served version lists
    const sf = await StoredFile.create({ kind: "book_lc_media", mime: "image/jpeg", sizeBytes: 4, originalName: "x.jpg", driveFileId: "drive-x", uploadedBy: new Types.ObjectId() });
    await BookMediaAsset.create({ bookId: book._id, sha256: "f".repeat(64), originalName: "x.jpg", mime: "image/jpeg", bytes: 4, storedFileId: sf._id });
    await expect(assertBookLcFileReadAccess(ctx(school.routineTeacher), sf)).rejects.toBeInstanceOf(ForbiddenError);
    expect(version.media.length).toBe(1);
  });
});

describe("the printed PDF pages (PB-2, D-#1657)", () => {
  async function pdfFor(bookCode: string, over: Partial<{ status: string; active: boolean; chapters: { key: string; title: string; fromPage: number; toPage: number }[]; pageCount: number }> = {}) {
    const pageFileIds = Array.from({ length: over.pageCount ?? 12 }, () => new Types.ObjectId());
    return BookPdf.create({
      bookCode,
      classLevel: 3,
      subject: "BAN",
      titleBn: "পরীক্ষার বই",
      versionLabel: "v2.1",
      status: over.status ?? "READY",
      active: over.active ?? true,
      pageFileIds,
      pageCount: pageFileIds.length,
      pageAspect: 1.4,
      chapters: over.chapters ?? [
        { key: "ch-001", title: "পাঠ ১: গাছ", fromPage: 3, toPage: 5 },
        { key: "ch-002", title: "পাঠ ২: ফুল", fromPage: 6, toPage: 99 },
      ],
      uploadedBy: new Types.ObjectId(),
    });
  }
  beforeEach(async () => {
    await BookPdf.deleteMany({});
  });

  it("no PDF uploaded → pdf is null and the text stays (fallback)", async () => {
    await finalBook({ release: true });
    const r = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 1 }));
    expect(r.pdf).toBeNull();
    expect(r.childText).toBeTruthy();
  });

  it("a READY PDF gives the matched chapter's page range, keyed by the same chapter keys (clamped to the book)", async () => {
    await finalBook({ release: true });
    await pdfFor("C3-BAN");
    const id = await plan({ anchorWord: "পাঠ", number: 1 });
    const r = await planBookForCaller(ctx(school.routineTeacher), id);
    expect(r.chapterKey).toBe("ch-001");
    expect(r.pdf).toMatchObject({ versionLabel: "v2.1", pageCount: 12, fromPage: 3, toPage: 5 });
    const two = await planBookForCaller(ctx(school.routineTeacher), id, "ch-002");
    expect(two.pdf).toMatchObject({ fromPage: 6, toPage: 12 });
    // a chapter with no range → pdf present, range null → the app falls back to text
    const three = await planBookForCaller(ctx(school.routineTeacher), id, "ch-003");
    expect(three.pdf).toMatchObject({ fromPage: null, toPage: null });
  });

  it("a hidden or still-processing PDF is not offered", async () => {
    await finalBook({ release: true });
    const row = await pdfFor("C3-BAN", { active: false });
    const id = await plan({ anchorWord: "পাঠ", number: 1 });
    expect((await planBookForCaller(ctx(school.routineTeacher), id)).pdf).toBeNull();
    await BookPdf.updateOne({ _id: row._id }, { $set: { active: true, status: "PROCESSING" } });
    expect((await planBookForCaller(ctx(school.routineTeacher), id)).pdf).toBeNull();
  });

  it("a book with no final version but an uploaded PDF still opens, from the PDF's chapter map", async () => {
    await finalBook({ state: "draft" });
    await pdfFor("C3-BAN");
    const r = await planBookForCaller(ctx(school.routineTeacher), await plan({ anchorWord: "পাঠ", number: 2 }));
    expect(r.available).toBe(true);
    expect(r.chapterKey).toBe("ch-002");
    expect(r.childText).toBeNull();
    expect(r.pdf).toMatchObject({ fromPage: 6, toPage: 12 });
    expect(r.chapters.map((c) => c.key)).toEqual(["ch-001", "ch-002"]);
  });
});

// keep mongoose referenced (types only above)
void mongoose;
