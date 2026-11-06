/**
 * Capture spec — the Nursery/KG worksheet generator, its picture bank and plan, and class books
 * (content area).
 *
 * LOCAL ONLY. Data: scripts/help/fixtures/content.ts (নার্সারি, a published বাংলা মানবন্টন, 12
 * example pictures, four example class books whose pages are local example pictures).
 *   teacher  makes a ক্লাস টেস্ট (preview only: sending needs Google Drive, which a local run has
 *            not got) and reads a class book;
 *   office   opens the picture bank and the plan, manages class books;
 *   guardian reads their child's class book.
 * Class-book pages live in Drive on the real server; here the page query is answered with the
 * example pages drawn by fixtures/content-pictures.cjs.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const L = require("./content-lib.cjs");

const LETTERS = ["অ", "আ", "ই", "ঈ", "উ", "ক", "খ", "গ", "ঘ", "চ", "ছ", "জ"];

/** Answer ClassBookPage with the example pages (the local server has no Drive to read them from). */
async function servePages(page) {
  const dir = path.join(os.tmpdir(), "help-content-pictures");
  const pages = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).pages.map(
    (f) => `data:image/jpeg;base64,${fs.readFileSync(f).toString("base64")}`,
  );
  await page.context().route("**/graphql", async (route) => {
    const req = route.request();
    let body = {};
    try { body = JSON.parse(req.postData() || "{}"); } catch { /* not JSON */ }
    if (req.method() !== "POST" || body.operationName !== "ClassBookPage") return route.continue();
    const n = Math.max(1, Math.min(pages.length, Number(body.variables?.page) || 1));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { data: { classBookPage: { __typename: "ClassBookPage", bookId: body.variables.bookId, page: n, pageCount: pages.length, dataUri: pages[n - 1] } } },
    });
  });
}

async function openPrint(h, page) {
  await L.openItem(h, page, null, null);
  await h.tap(page, "প্রিন্ট", 3500);
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the content-worksheets spec is for the local example school (see its header)");
  L.soft(h);

  // ── teacher: make a class test, read a class book ────────────────────────
  const T = await L.login(h, "teacher@help.test");
  await openPrint(h, T);
  await h.shot(T, "content-ws-make", 0, [{ re: "অ্যাসাইনমেন্ট / প্রশ্ন তৈরি করুন$" }]);
  await h.tap(T, { re: "অ্যাসাইনমেন্ট / প্রশ্ন তৈরি করুন$" }, 4000);
  await h.tap(T, { text: "বাংলা", minY: 80 }, 1500);
  await h.tap(T, "ক্লাস টেস্ট", 2000);
  await h.shot(T, "content-ws-make", 1, [{ text: "শ্রেণি", exact: true, minY: 80 }, { text: "বিষয়", exact: true, minY: 80 }, { text: "কী তৈরি করবেন" }]);
  // Every letter starts ticked: clear both groups, then tick the ones the example bank has pictures for.
  await h.tap(T, { text: "কোনোটিই না" }, 800);
  await h.tap(T, { text: "কোনোটিই না", last: true }, 800);
  for (const l of LETTERS) await h.tap(T, { css: `[role="checkbox"][aria-label="${l}"]` }, 300);
  await T.waitForTimeout(2500);
  await L.scrollTo(h, T, { text: "যে বর্ণগুলো পড়ানো হয়েছে — টিক দিন" }, 60);
  await h.shot(T, "content-ws-make", 2, [{ css: '[role="checkbox"][aria-label="ক"]' }, { text: "প্রশ্নের সারি" }]);
  await L.scrollTo(h, T, { re: "^প্রিভিউ · সংস্করণ" }, 60);
  await h.shot(T, "content-ws-make", 3, [{ re: "^প্রিভিউ · সংস্করণ" }], { anchor: { re: "^প্রিভিউ · সংস্করণ" } });
  await L.scrollTo(h, T, { re: "নতুন সংস্করণ$" }, 60);
  await h.shot(T, "content-ws-print", 0, [{ re: "নতুন সংস্করণ$" }, { text: "PDF — প্রশ্নপত্র" }, { text: "উত্তরপত্র দেখুন" }, { re: "প্রিন্টে পাঠান$" }]);
  await h.tap(T, { re: "প্রিন্টে পাঠান$" }, 2000);
  await L.scrollTo(h, T, { re: "^কোন শ্রেণি / শাখার জন্য" }, 60);
  await h.shot(T, "content-ws-print", 1, [{ re: "^কোন শ্রেণি / শাখার জন্য" }, { re: "^কপি সংখ্যা" }, { text: "প্রিন্টে পাঠান", last: true }]);

  await L.home(T);
  await servePages(T);
  await L.openItem(h, T, null, null);
  await h.shot(T, "content-cb-read", 0, [{ text: "শ্রেণির বই" }]);
  await h.tap(T, "শ্রেণির বই", 4000);
  await h.tap(T, { text: "নার্সারি", minY: 80 }, 2500);
  await h.shot(T, "content-cb-read", 1, [{ text: "নার্সারি", minY: 80 }, { text: "পড়ুন" }]);
  await h.tap(T, "পড়ুন", 4000);
  await h.shot(T, "content-cb-read", 2, [{ text: "পরের ›" }, { placeholder: "পৃষ্ঠা নং" }, { re: "বড়$" }]);
  await T.context().close();

  // ── office: picture bank, plan, class books ──────────────────────────────
  const O = await L.login(h, "office@help.test");
  await openPrint(h, O);
  await h.shot(O, "content-ws-bank", 0, [{ re: "ছবির ভাণ্ডার$" }]);
  await h.shot(O, "content-ws-plan", 0, [{ re: "প্রশ্ন-পরিকল্পনা$" }]);
  await h.tap(O, { re: "ছবির ভাণ্ডার$" }, 4000);
  await h.shot(O, "content-ws-bank", 1, [{ text: "শব্দ বা বর্ণ দিয়ে খুঁজুন" }, { text: "আম", exact: true }]);
  await h.tap(O, { text: "আম", exact: true }, 2500);
  await L.scrollTo(h, O, { text: "শব্দ", exact: true }, 60);
  await h.shot(O, "content-ws-bank", 2, [
    { text: "শব্দ", exact: true },
    { text: "প্রথম বর্ণ", exact: true },
    { text: "শুধু বার্ষিক পরীক্ষার জন্য রাখুন" },
    { text: "সংরক্ষণ", exact: true },
  ], { anchor: { text: "শব্দ", exact: true } });
  await L.back(O);
  await h.tap(O, { re: "প্রশ্ন-পরিকল্পনা$" }, 4000);
  await h.shot(O, "content-ws-plan", 1, [{ text: "শ্রেণি", exact: true, minY: 80 }, { text: "প্রশ্নের ধরন" }]);
  await L.scrollTo(h, O, { text: "ক্লাস টেস্ট প্রিসেট" }, 60);
  await h.shot(O, "content-ws-plan", 2, [{ text: "ক্লাস টেস্ট প্রিসেট" }, { text: "পরিকল্পনা সংরক্ষণ" }]);

  await L.home(O);
  await servePages(O);
  await L.openItem(h, O, null, null);
  await h.tap(O, "শ্রেণির বই", 4000);
  await L.fill(h, O, { placeholder: "যেমন: বাংলা" }, "উদাহরণ গণিত");
  await h.shot(O, "content-cb-upload", 0, [
    { text: "নতুন বই যোগ করুন" },
    { placeholder: "যেমন: বাংলা" },
    { text: "ক্রম (ছোট সংখ্যা আগে দেখাবে)" },
    { text: "PDF বাছাই করে আপলোড করুন" },
  ]);
  await h.shot(O, "content-cb-upload", 1, [{ re: "হালনাগাদ$" }]);
  await L.scrollTo(h, O, { text: "উদাহরণ বর্ণমালা" }, 60);
  await h.shot(O, "content-cb-manage", 0, [{ text: "নাম বদলান" }, { text: "লুকান" }, { text: "মুছুন" }]);
  await O.context().close();

  // ── guardian: the child's class books ────────────────────────────────────
  const G = await L.login(h, "01800000001");
  await servePages(G);
  await L.openItem(h, G, null, null);
  await h.shot(G, "content-cb-guardian", 0, [{ text: "বই", exact: true }]);
  await h.tap(G, { text: "বই", exact: true }, 4000);
  await h.shot(G, "content-cb-guardian", 1, [{ text: "পড়ুন" }]);
  await h.tap(G, "পড়ুন", 4000);
  await h.tap(G, "পরের ›", 2500);
  await h.shot(G, "content-cb-guardian", 2, [{ text: "পরের ›" }, { text: "‹ আগের" }]);
};
