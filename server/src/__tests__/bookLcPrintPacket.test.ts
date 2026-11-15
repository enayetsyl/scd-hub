/**
 * BL-1 — the print packet (docs/prd-book-lifecycle.md §10.4, §19 bookLcPrintPacket).
 *
 * Fixture: an invented 12-page master PDF made here with pdfkit, chapters starting on known pages
 * (3, 6, 9), each page printing its own number "p. N". The page map is found with `pdftotext`; if
 * poppler is absent on the runner that part SKIPS with a named reason and the map is set by hand.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { execFileSync } from "child_process";
import { PDFDocument } from "pdf-lib";
import { setupLc, teardownLc, resetBooks, importSample, item, childVersion, roundSent, approveOnPaper, attachMasterPdf, type LcFx } from "./bookLcFixtures";
import { openRound, detectPageMap, setPageMap, makePacket, markSentOnPaper, updateRound } from "../modules/book-lifecycle/services/roundService";
import { pdfPageTexts } from "../modules/book-lifecycle/services/packet";
import { loadLcFile } from "../modules/book-lifecycle/services/files";
import { loadVersion } from "../modules/book-lifecycle/services/store";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { Notification } from "../modules/notifications/models/Notification";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());

const P = () => fx.auth.principal;
let HAS_POPPLER = true;
try {
  execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
} catch {
  HAS_POPPLER = false;
}
const itPoppler = HAS_POPPLER ? it : it.skip;
if (!HAS_POPPLER) console.warn("bookLcPrintPacket: SKIPPING the pdftotext page-map case — poppler-utils (pdftotext) is not installed on this runner");

/** A book whose v7.4 came back approved on paper, then a v7.5 changing only chapter 2. */
async function changedChildRound() {
  const { book } = await importSample(P(), { latinTitles: true });
  const r1 = await roundSent(P(), book._id.toString());
  await approveOnPaper(P(), r1._id.toString());
  const f = await item(P(), book._id.toString(), "direct_fix", { chapterKey: "ch-002" });
  const v2 = await childVersion(P(), book._id.toString(), "2টি নৌকা", "দুটি নৌকা", [f.code]);
  await attachMasterPdf(P(), v2._id.toString(), 12, [
    { title: "Chapter 1 River Story", page: 3 },
    { title: "Chapter 2 River Story", page: 6 },
    { title: "Chapter 3 River Story", page: 9 },
  ]);
  const r2 = await openRound(P(), book._id.toString(), { reviewerName: "পর্যালোচক আপা (কাল্পনিক)" });
  return { book, v2, r2, r1 };
}

describe("page map", () => {
  itPoppler("finds each chapter's start page with pdftotext; unconfirmed until a person confirms", async () => {
    const { r2 } = await changedChildRound();
    const r = await detectPageMap(P(), r2._id.toString());
    expect(r.packet?.pageMapSource).toBe("pdftotext");
    expect(r.packet?.pageCount).toBe(12);
    expect(r.packet?.pageMap.map((p) => [p.chapterKey, p.startPage, p.confirmed])).toEqual([
      ["ch-001", 3, false],
      ["ch-002", 6, false],
      ["ch-003", 9, false],
    ]);
    await expect(makePacket(P(), r2._id.toString(), "changed")).rejects.toThrow(/নিশ্চিত/);
  });

  it("can be set by hand (and refuses an out-of-range or out-of-order page)", async () => {
    const { r2 } = await changedChildRound();
    await detectPageMap(P(), r2._id.toString());
    // Without poppler no start page is known yet, so the later chapters are set first: the order check can only compare pages that are set.
    await setPageMap(P(), r2._id.toString(), [
      { chapterKey: "ch-002", startPage: 6 },
      { chapterKey: "ch-003", startPage: 9 },
    ]);
    await expect(setPageMap(P(), r2._id.toString(), [{ chapterKey: "ch-001", startPage: 13 }])).rejects.toThrow(/পৃষ্ঠা/);
    await expect(setPageMap(P(), r2._id.toString(), [{ chapterKey: "ch-001", startPage: 7 }])).rejects.toThrow(/ক্রমে/);
    const r = await setPageMap(P(), r2._id.toString(), [
      { chapterKey: "ch-001", startPage: 3 },
      { chapterKey: "ch-002", startPage: 6 },
      { chapterKey: "ch-003", startPage: 9 },
    ]);
    expect(r.packet?.pageMap.every((p) => p.confirmed)).toBe(true);
  });
});

describe("the packet", () => {
  async function confirmed() {
    const ctx = await changedChildRound();
    await detectPageMap(P(), ctx.r2._id.toString());
    await setPageMap(P(), ctx.r2._id.toString(), [
      { chapterKey: "ch-001", startPage: 3 },
      { chapterKey: "ch-002", startPage: 6 },
      { chapterKey: "ch-003", startPage: 9 },
    ]);
    return ctx;
  }

  it("scope 'whole' = the source PDF as is (same page count, same file)", async () => {
    const { r2, v2 } = await confirmed();
    const r = await makePacket(P(), r2._id.toString(), "whole");
    const src = (await loadVersion(v2._id)).files.find((f) => f.role === "master_pdf")!;
    expect(r.packet?.bookPdfFileId?.equals(src.storedFileId)).toBe(true);
    const { data } = await loadLcFile(r.packet!.bookPdfFileId!);
    expect((await PDFDocument.load(data)).getPageCount()).toBe(12);
  });

  it("scope 'changed' = exactly the changed chapter's pages, original numbers kept, divider first", async () => {
    const { r2 } = await confirmed();
    const r = await makePacket(P(), r2._id.toString(), "changed");
    expect(r.status).toBe("packet_ready");
    const { data, file } = await loadLcFile(r.packet!.bookPdfFileId!);
    expect(file.kind).toBe("book_lc_packet");
    expect((await PDFDocument.load(data)).getPageCount()).toBe(1 + 3); // divider + pages 6–8
    if (HAS_POPPLER) {
      const pages = await pdfPageTexts(data);
      expect(pages[0].replace(/\s+/g, "")).toContain("6-8");
      expect(pages[0].replace(/\s+/g, "")).toContain("2RiverStory");
      expect(pages.slice(1).map((t) => /p\. (\d+)/.exec(t)?.[1])).toEqual(["6", "7", "8"]);
    }
  });

  it("memo PDF: header/footer with code, version, memo number, page x/y; a closing verdict page", async () => {
    const { r2 } = await confirmed();
    const r = await makePacket(P(), r2._id.toString(), "changed");
    const { data, file } = await loadLcFile(r.packet!.memoPdfFileId!);
    expect(file.kind).toBe("book_lc_packet");
    const n = (await PDFDocument.load(data)).getPageCount();
    expect(n).toBeGreaterThanOrEqual(2);
    if (HAS_POPPLER) {
      const pages = await pdfPageTexts(data);
      pages.forEach((t, i) => {
        expect(t).toContain(`C3-BAN · v7.5 · Memo ${r.memoNo}`);
        expect(t).toContain(`Page ${i + 1}/${n}`);
      });
    }
    // The frozen Markdown memo carries the same closing box.
    expect(r.memo.frozen).toBe(true);
    expect(r.memo.markdown).toContain("☐ অনুমোদিত ☐ পরিবর্তন দরকার");
    expect(r.memo.markdown).toContain("পৃ. ৬–৮");
  });

  it("packet_ready → sent_on_paper with the date; version in_review; frozen; no notification", async () => {
    const before = await Notification.countDocuments();
    const { r2, v2 } = await confirmed();
    await makePacket(P(), r2._id.toString(), "changed");
    const sent = await markSentOnPaper(P(), r2._id.toString(), { sentAt: new Date("2026-11-11T05:00:00Z") });
    expect(sent.status).toBe("sent_on_paper");
    expect(sent.sentOnPaperAt?.toISOString()).toBe("2026-11-11T05:00:00.000Z");
    expect((await loadVersion(v2._id)).status).toBe("in_review");
    await expect(updateRound(P(), r2._id.toString(), { extraNotesBn: "বদল" })).rejects.toThrow();
    await expect(makePacket(P(), r2._id.toString(), "whole")).rejects.toThrow();
    expect(await Notification.countDocuments({ kind: { $regex: /^BOOK_/ } })).toBe(0);
    expect(await Notification.countDocuments()).toBe(before);
    expect(await StoredFile.countDocuments({ kind: "book_lc_packet" })).toBeGreaterThanOrEqual(2);
  });

  it("refuses the packet when the version's PDF is stale (carried from the parent)", async () => {
    const { book } = await importSample(P(), { latinTitles: true });
    const r1 = await roundSent(P(), book._id.toString());
    await approveOnPaper(P(), r1._id.toString());
    const f = await item(P(), book._id.toString(), "direct_fix");
    await childVersion(P(), book._id.toString(), "1টি নৌকা", "একটি নৌকা", [f.code]);
    const r = await openRound(P(), book._id.toString(), { reviewerName: "পর্যালোচক" });
    await expect(detectPageMap(P(), r._id.toString())).rejects.toThrow(/PDF নেই/);
  });
});
