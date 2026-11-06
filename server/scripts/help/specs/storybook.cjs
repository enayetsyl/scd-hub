/**
 * Capture spec — the storybook shelf (গল্পের বই, D-#980–#986) and its guardian switch (D-#1011).
 *
 * LOCAL ONLY: it switches the shelf on for a family, adds a series and a book, makes copies,
 * lends and takes back books, because those screens only exist after those steps.
 *
 * One run (from server/, PowerShell; ports from the README, pick free ones):
 *   node scripts/help/mem.cjs 27930
 *   $env:MONGODB_URI='mongodb://127.0.0.1:27930/hc'; npx tsx scripts/help/fixtures/storybook.ts --reset
 *   $env:PORT='4330'; $env:TZ='Asia/Dhaka'; npx tsx scripts/help/fake-drive-server.ts
 *   # the school's own books (Office login from the fixture; PDFs on the machine that holds them):
 *   SCD_IMPORT_EMAIL=office@help.test SCD_IMPORT_PASSWORD=Help@123 \
 *     node scripts/import-storybooks.mjs --api http://localhost:4330 --only TRE,FRU --publish
 *   node scripts/help/serve-web.cjs --dir C:/w/hc-web --port 8330 --api 4330
 *   node scripts/help/capture.cjs --spec storybook --base http://localhost:8330
 * HELP_STORY_PDF = the PDF the add-books guide uploads (default: book 5 of the Tree series).
 */
const PASSWORD = "Help@123";
const PDF =
  process.env.HELP_STORY_PDF || "C:/Users/HP/Downloads/Tree_Adventures/05_Palmyra_Run_Home_Storm_is_Coming.pdf";

/** Type into the input that follows a field's label (the app's Field shows the label above it). */
async function fill(h, page, label, value) {
  const l = await h.topmost(page, { text: label }, { scroll: true });
  await l.locator("xpath=following::*[self::input or self::textarea][1]").fill(value);
  await page.waitForTimeout(400);
}

/** Scroll a shot's anchor into view first (an anchor is only found when it is on screen). */
async function reveal(h, page, target) {
  await h.topmost(page, target, { scroll: true });
  await page.waitForTimeout(400);
}

/** Tap a button only if it is on screen (the desk sometimes clears itself after a save). */
async function tapIf(h, page, text) {
  const el = await h.topmost(page, { text }, { scroll: true }).catch(() => null);
  if (el) {
    await el.click();
    await page.waitForTimeout(1500);
  }
}

/** A guardian sees "borrowed a book" / "got a sticker" pop-ups on opening the app; each close waits a moment. */
async function closePopups(h, page) {
  for (let i = 0; i < 6; i++) {
    let btn = null;
    for (const text of ["বন্ধ করুন", "✕", "ঠিক আছে"]) {
      btn = btn || (await h.topmost(page, { text }, { scroll: false }).catch(() => null));
    }
    if (!btn) return;
    await page.waitForTimeout(2500);
    await btn.click().catch(() => undefined);
    await page.waitForTimeout(1500);
  }
}

/** The header ← (the browser history does not follow the app's stacks). */
async function back(h, page) {
  await h.tap(page, { css: "[aria-label=\"Go back\"]" }, 2000);
}

/** The drawer keeps a tab's stack, so step back until the shelf itself is on top. */
async function openShelf(h, page) {
  await h.openMenu(page);
  await h.tap(page, "গল্পের বই", 3500);
  for (let i = 0; i < 6; i++) {
    const onShelf = await h.topmost(page, { text: "এখন পাওয়া যাবে" }, { scroll: false }).then(() => true, () => false);
    if (onShelf) return;
    await back(h, page);
  }
}

/** The desk: type a copy code and look it up. */
async function findCode(h, page, code) {
  await fill(h, page, "বইয়ের কোড (স্ক্যান বা লিখুন)", code);
  await h.tap(page, "খুঁজুন", 2500);
}

/** Lend the copy on screen to the first child the search finds. */
async function lendTo(h, page, who, name) {
  await fill(h, page, "কাকে দেবেন? আইডি, নাম বা রোল", who);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  await h.tap(page, name, 1500);
}

/** Principal + Office: switch, series, book, copies, desk. Returns the Office page. */
async function staff(h) {
  // ── Principal: switch the shelf on for one family ───────────────────────
  const P = (await h.login("principal@help.test", PASSWORD)).page;
  await openShelf(h, P);
  await h.shot(P, "storybook-guardian-access", 0, [{ text: "অভিভাবকদের জন্য চালু / বন্ধ" }]);
  await h.tap(P, "অভিভাবকদের জন্য চালু / বন্ধ", 3000);
  const search = await h.topmost(P, { placeholder: "অভিভাবকের নাম, ফোন, শিক্ষার্থীর নাম বা আইডি" }, { scroll: true });
  await search.fill("আয়েশা");
  await P.waitForTimeout(2500);
  await h.shot(P, "storybook-guardian-access", 1, [
    { placeholder: "অভিভাবকের নাম, ফোন, শিক্ষার্থীর নাম বা আইডি" },
    { text: "চালু করুন" },
  ]);
  await h.tap(P, "চালু করুন", 3000);
  await h.shot(P, "storybook-guardian-access", 2, [{ re: "^যাঁদের জন্য চালু" }, { text: "সব অভিভাবকের জন্য চালু" }]);

  // ── Office: a new series ─────────────────────────────────────────────────
  const O = (await h.login("office@help.test", PASSWORD)).page;
  await openShelf(h, O);
  await h.shot(O, "storybook-new-series", 0, [{ text: "সিরিজ, ট্যাগ ও বয়স" }]);
  await h.tap(O, "সিরিজ, ট্যাগ ও বয়স", 3000);
  await h.shot(O, "storybook-new-series", 1, [{ text: "+ নতুন সিরিজ" }]);
  await h.tap(O, "+ নতুন সিরিজ", 1500);
  await fill(h, O, "কোড (২–৪টি ইংরেজি বড় হাতের অক্ষর, যেমন TRE)", "VEH");
  await fill(h, O, "নাম (বাংলা)", "যানবাহনের গল্প");
  await fill(h, O, "নাম (ইংরেজি)", "Vehicle Stories");
  await h.tap(O, "৩–৬ বছর", 800);
  await h.shot(
    O,
    "storybook-new-series",
    2,
    [
      { text: "কোড (২–৪টি ইংরেজি বড় হাতের অক্ষর, যেমন TRE)" },
      { text: "নাম (বাংলা)" },
      { text: "৩–৬ বছর" },
      { text: "যোগ করুন" },
    ],
    { anchor: { text: "বাতিল" } },
  );
  await h.tap(O, "যোগ করুন", 3000);

  // ── Office: add a book to a series, name it, publish it ─────────────────
  await openShelf(h, O);
  await h.tap(O, "গাছের গল্প", 3500);
  await h.shot(
    O,
    "storybook-add-books",
    0,
    [{ text: "নতুন বই যোগ করুন" }, { text: "প্রিভিউ পৃষ্ঠা (খালি রাখলে ৩, ৪ ও শেষ পাতা)" }, { text: "PDF বাছুন (একাধিক চলবে)" }],
    { anchor: { text: "নতুন বই যোগ করুন" } },
  );
  const [chooser] = await Promise.all([O.waitForEvent("filechooser", { timeout: 15000 }), h.tap(O, "PDF বাছুন (একাধিক চলবে)", 300)]);
  await chooser.setFiles(PDF);
  await O.waitForTimeout(15000);
  await h.tap(O, { text: "খসড়া", last: true }, 3500);
  await h.tap(O, "সম্পাদনা", 1500);
  await fill(h, O, "নাম (বাংলা)", "ঝড়ের দিনে তালগাছ");
  await fill(h, O, "শিশু যা শিখবে (প্রতি লাইনে একটি)", "ঝড় এলে দেরি না করে ঘরে ফেরা\nবিপদে আল্লাহকে স্মরণ করা");
  await h.shot(O, "storybook-add-books", 1, [{ text: "নাম (বাংলা)" }, { text: "শিশু যা শিখবে (প্রতি লাইনে একটি)" }], {
    anchor: { text: "বইয়ের তথ্য" },
  });
  // No anchor: the first target is scrolled to the middle, which brings সংরক্ষণ on screen too.
  await h.shot(O, "storybook-add-books", 2, [{ text: "ট্যাগ", exact: true, last: true }, { text: "সংরক্ষণ", last: true }]);
  await h.tap(O, "সংরক্ষণ", 3000);
  await h.shot(O, "storybook-add-books", 3, [{ text: "প্রকাশ করুন" }]);
  await h.tap(O, "প্রকাশ করুন", 3000);

  // ── Office: copies and stickers ──────────────────────────────────────────
  await openShelf(h, O);
  await h.tap(O, "গাছের গল্প", 3500);
  await reveal(h, O, { text: "কপি ও স্টিকার" });
  await h.shot(O, "storybook-copies-stickers", 0, [{ text: "প্রতিটি বইয়ের কপি" }, { text: "কপি তৈরি করুন" }, { text: "স্টিকার PDF (প্রিন্ট)" }], {
    anchor: { text: "কপি ও স্টিকার" },
  });
  await h.tap(O, "কপি তৈরি করুন", 4000);
  await h.shot(O, "storybook-copies-stickers", 1, [{ re: "টি নতুন কপির কোড তৈরি হয়েছে" }]);

  // ── Office: lend at the desk ─────────────────────────────────────────────
  await openShelf(h, O);
  await h.shot(O, "storybook-desk-lend", 0, [{ text: "গল্পের বই ডেস্ক" }]);
  await h.tap(O, "গল্পের বই ডেস্ক", 3000);
  await fill(h, O, "বইয়ের কোড (স্ক্যান বা লিখুন)", "TRE-01-1");
  await h.shot(O, "storybook-desk-lend", 1, [{ text: "বইয়ের কোড (স্ক্যান বা লিখুন)" }, { text: "খুঁজুন" }]);
  await h.tap(O, "খুঁজুন", 2500);
  await lendTo(h, O, "আয়েশা", "আয়েশা সিদ্দিকা");
  await reveal(h, O, { text: "কাকে দেবেন? আইডি, নাম বা রোল" });
  await h.shot(O, "storybook-desk-lend", 2, [{ text: "কাকে দেবেন? আইডি, নাম বা রোল" }, { text: "আয়েশা সিদ্দিকা" }, { text: "আয়েশা সিদ্দিকা-কে দিন" }], {
    anchor: { text: "কাকে দেবেন? আইডি, নাম বা রোল" },
  });
  await h.tap(O, "আয়েশা সিদ্দিকা-কে দিন", 3000);

  // Two more loans with no pictures: book 3 goes to another child (so the family can join
  // its waitlist), and the desk is ready for the take-back guide.
  await tapIf(h, O, "আরেকটি বই");
  await findCode(h, O, "TRE-03-1");
  await lendTo(h, O, "হামজা", "হামজা রহমান");
  await h.tap(O, "হামজা রহমান-কে দিন", 3000);

  // ── Office: take a book back ─────────────────────────────────────────────
  await tapIf(h, O, "আরেকটি বই");
  await findCode(h, O, "TRE-01-1");
  await h.shot(O, "storybook-desk-return", 0, [{ re: "^এখন আয়েশা সিদ্দিকা" }, { text: "পুরো বই পড়েছে?" }, { text: "হ্যাঁ · স্টিকার ★" }, { text: "ফেরত নিন" }]);
  await h.tap(O, "হ্যাঁ · স্টিকার ★", 800);
  await h.tap(O, "ফেরত নিন", 3000);
  await h.shot(O, "storybook-desk-return", 1, [{ re: "স্টিকার দিন ★" }]);
  await tapIf(h, O, "আরেকটি বই");
  await findCode(h, O, "TRE-02-1");
  await lendTo(h, O, "আয়েশা", "আয়েশা সিদ্দিকা");
  await h.tap(O, "আয়েশা সিদ্দিকা-কে দিন", 3000);

  return O;
}

/** The family side and the report (HELP_FROM=family re-runs only this part on a walked database). */
async function family(h, O) {
  // ── Guardian: the shelf, a book, the waitlist, my child's books ─────────
  const G = (await h.login("01800000002", PASSWORD)).page;
  await closePopups(h, G);
  await openShelf(h, G);
  await h.shot(G, "child-storybook-shelf", 0, [{ re: "বয়সের \\(৩–৬ বছর\\) বই দেখানো হচ্ছে" }, { text: "এখন পাওয়া যাবে" }, { text: "গাছের গল্প" }]);
  await h.tap(G, "গাছের গল্প", 3500);
  await h.tap(G, "রাতের আম-চোর", 3500);
  await h.shot(G, "child-storybook-shelf", 1, [{ re: "^আছে$|কপি আছে" }, { text: "ভেতরে দেখুন" }]);
  await back(h, G);
  await h.tap(G, "সাগরের নারকেল", 3500);
  await h.shot(G, "child-storybook-shelf", 2, [{ re: "^সব কপি বাইরে" }, { text: "অপেক্ষার তালিকায় যোগ দিন" }]);
  await h.tap(G, "অপেক্ষার তালিকায় যোগ দিন", 3000);
  await h.shot(G, "child-storybook-shelf", 3, [{ re: "^অপেক্ষায় ১ নম্বরে" }]);

  await openShelf(h, G);
  await h.shot(G, "child-storybook-books", 0, [{ text: "আমার সন্তানের বই" }]);
  await h.tap(G, "আমার সন্তানের বই", 3500);
  await h.shot(G, "child-storybook-books", 1, [{ text: "পড়া বই" }, { re: "স্টিকার পেয়েছে" }, { text: "হাতে আছে" }]);

  // ── Office: the report ───────────────────────────────────────────────────
  await h.openMenu(O);
  await h.tap(O, "রিপোর্ট", 1500);
  await h.shot(O, "storybook-report", 0, [{ text: "গল্পের বই রিপোর্ট" }]);
  await h.tap(O, "গল্পের বই রিপোর্ট", 3500);
  await h.shot(O, "storybook-report", 1, [{ text: "সিরিজ", minY: 60 }, { text: "বই", minY: 60 }, { text: "পাঠক" }, { text: "৩০ দিন" }]);
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the storybook spec saves while it walks; run it locally (see its header)");
  const O = process.env.HELP_FROM === "family" ? (await h.login("office@help.test", PASSWORD)).page : await staff(h);
  await family(h, O);
};
