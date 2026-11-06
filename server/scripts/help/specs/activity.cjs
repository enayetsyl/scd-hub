/**
 * Capture spec — activity sheets (অ্যাক্টিভিটি শিট, D-#988–#991) and their guardian switch (D-#1011).
 *
 * LOCAL ONLY: it switches the feature on, a guardian asks for a sheet, Office prints it, the
 * class teacher hands it out, the desk takes it back, Office fills the corner trays and hands
 * a tray sheet to a child, because those screens only exist after those steps.
 *
 * The same stack as specs/storybook.cjs (its header), plus the school's own activity banks:
 *   SCD_IMPORT_EMAIL=office@help.test SCD_IMPORT_PASSWORD=Help@123 \
 *     node scripts/import-activity-banks.mjs --api http://localhost:4330 --only SD,CO,DD,WS --publish
 *   node scripts/help/capture.cjs --spec activity --base http://localhost:8330
 * Run it on a database where no sheet has been printed yet: the walk expects the guardian's
 * sheet to be copy AS-000001 and the first tray copy AS-000002.
 */
const PASSWORD = "Help@123";

async function fill(h, page, label, value) {
  const l = await h.topmost(page, { text: label }, { scroll: true });
  await l.locator("xpath=following::*[self::input or self::textarea][1]").fill(value);
  await page.waitForTimeout(400);
}

async function reveal(h, page, target) {
  await h.topmost(page, target, { scroll: true });
  await page.waitForTimeout(400);
}

async function back(h, page) {
  await h.tap(page, { css: '[aria-label="Go back"]' }, 2000);
}

/** The activity home (banks for staff, the choose page for a guardian), from anywhere. */
async function openActivity(h, page, homeMark) {
  await h.openMenu(page);
  await h.tap(page, "অ্যাক্টিভিটি শিট", 3500);
  for (let i = 0; i < 6; i++) {
    if (await h.topmost(page, homeMark, { scroll: false }).then(() => true, () => false)) return;
    const backBtn = await h.topmost(page, { css: '[aria-label="Go back"]' }, { scroll: false }).catch(() => null);
    if (backBtn) {
      await backBtn.click();
      await page.waitForTimeout(2000);
      continue;
    }
    // A screen with no ← (after a print): start the app again; the walk clears the saved place on load.
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(6000);
    await closePopups(h, page);
    await h.openMenu(page);
    await h.tap(page, "অ্যাক্টিভিটি শিট", 3500);
  }
  throw new Error("could not get back to the activity home");
}
const STAFF_HOME = { text: "শিট ডেস্ক", minY: 60 }; // minY skips the header title of the desk itself
const TEACHER_HOME = { text: "শিট বিতরণ", minY: 60 };
const GUARDIAN_HOME = { text: "সন্তানের শিট", minY: 60 };

/**
 * Tap a print button and close the PDF tab it opens. A big print takes a while to build;
 * a tab that opens later would leave the app page in the background, where screenshots hang.
 */
async function printAndClosePdf(h, page, target) {
  const popup = page.waitForEvent("popup", { timeout: 120000 });
  await h.tap(page, target, 500);
  await (await popup).close().catch(() => undefined);
  await page.bringToFront();
  await page.waitForTimeout(2000);
}

/** Sign in; a slow first sign-in is retried once (the app is still on the sign-in page). */
async function loginAs(h, user) {
  for (let i = 0; i < 2; i++) {
    const { page } = await h.login(user, PASSWORD);
    for (let k = 0; k < 10; k++) {
      if (await h.topmost(page, { text: "☰" }, { scroll: false }).then(() => true, () => false)) return page;
      await page.waitForTimeout(2000);
    }
    await page.context().close();
  }
  throw new Error("could not sign in as " + user);
}

async function closePopups(h, page) {
  for (let i = 0; i < 6; i++) {
    let btn = null;
    for (const text of ["বন্ধ করুন", "✕", "ঠিক আছে"]) btn = btn || (await h.topmost(page, { text }, { scroll: false }).catch(() => null));
    if (!btn) return;
    await page.waitForTimeout(2500);
    await btn.click().catch(() => undefined);
    await page.waitForTimeout(1500);
  }
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the activity spec saves while it walks; run it locally (see its header)");
  if (process.env.HELP_FROM === "report") return report(h, await loginAs(h, "office@help.test"));
  if (process.env.HELP_FROM === "corner") return rest(h, await loginAs(h, "office@help.test"));

  // ── Principal: switch activity sheets on for every guardian ─────────────
  const P = await loginAs(h, "principal@help.test");
  await openActivity(h, P, STAFF_HOME);
  await h.shot(P, "activity-guardian-access", 0, [{ text: "অভিভাবকদের জন্য চালু / বন্ধ" }]);
  await h.tap(P, "অভিভাবকদের জন্য চালু / বন্ধ", 3000);
  await h.shot(P, "activity-guardian-access", 1, [{ css: '[role="switch"]' }, { placeholder: "অভিভাবকের নাম, ফোন, শিক্ষার্থীর নাম বা আইডি" }]);
  await h.tap(P, { css: '[role="switch"]' }, 3000);
  await h.shot(P, "activity-guardian-access", 2, [{ re: "^এখন সব অভিভাবক দেখতে পাচ্ছেন" }]);

  // ── Guardian: ask for a sheet ────────────────────────────────────────────
  const G = await loginAs(h, "01800000002");
  await closePopups(h, G);
  await openActivity(h, G, GUARDIAN_HOME);
  await h.shot(G, "child-activity-choose", 0, [{ re: "^এই সপ্তাহে চাওয়া" }, { text: "হাতের কাজ" }, { text: "সহজ — এটি চাই" }]);
  await h.tap(G, "সহজ — এটি চাই", 3000);
  await reveal(h, G, { re: "^চাওয়া হয়েছে:" });
  await h.shot(G, "child-activity-choose", 1, [{ re: "^চাওয়া হয়েছে:" }, { text: "সন্তানের শিট" }]);

  // ── Office: the morning print ────────────────────────────────────────────
  const O = await loginAs(h, "office@help.test");
  await openActivity(h, O, STAFF_HOME);
  await h.shot(O, "activity-morning-print", 0, [{ re: "^সকালের ছাপা \\(" }]);
  await h.tap(O, { re: "^সকালের ছাপা \\(" }, 3000);
  await h.shot(O, "activity-morning-print", 1, [{ re: "আয়েশা সিদ্দিকা" }, { re: "^সব ছাপুন" }]);
  await printAndClosePdf(h, O, { re: "^সব ছাপুন" });

  // ── Class teacher: hand it out ───────────────────────────────────────────
  const T = await loginAs(h, "teacher2@help.test");
  await openActivity(h, T, TEACHER_HOME);
  await h.shot(T, "activity-hand-out", 0, [{ text: "শিট বিতরণ" }]);
  await h.tap(T, "শিট বিতরণ", 3000);
  await h.tap(T, "☐", 1200);
  await h.shot(T, "activity-hand-out", 1, [{ text: "☑" }, { re: "^বাছাই করা ১টি দেওয়া হলো" }]);
  await h.tap(T, { re: "^বাছাই করা ১টি দেওয়া হলো" }, 3000);

  // ── Office desk: take it back ────────────────────────────────────────────
  await openActivity(h, O, STAFF_HOME);
  await h.shot(O, "activity-desk-check", 0, [{ text: "শিট ডেস্ক" }]);
  await h.tap(O, "শিট ডেস্ক", 3000);
  await fill(h, O, "শিটের কোড", "1");
  await h.shot(O, "activity-desk-check", 1, [{ text: "শিটের কোড" }, { text: "খুঁজুন" }]);
  await h.tap(O, "খুঁজুন", 3000);
  await h.tap(O, "সব ঠিক", 800);
  await h.shot(O, "activity-desk-check", 2, [
    { re: "এর কাছে$" },
    { text: "সব ঠিক" },
    { re: "^ফেরতের বাক্স থেকে" },
    { text: "ফেরত নিন" },
  ]);
  await h.tap(O, "ফেরত নিন", 3000);
  await h.shot(O, "activity-desk-check", 3, [{ re: "স্টিকার দিন$" }]);

  // ── Guardian: the child's sheets and the answer ─────────────────────────
  await G.reload({ waitUntil: "load" });
  await G.waitForTimeout(6000);
  await closePopups(h, G);
  await openActivity(h, G, GUARDIAN_HOME);
  await h.shot(G, "child-activity-sheets", 0, [{ text: "সন্তানের শিট" }]);
  await h.tap(G, "সন্তানের শিট", 3000);
  await h.shot(G, "child-activity-sheets", 1, [{ text: "সব ঠিক" }, { re: "স্টিকার পেয়েছে$" }, { text: "উত্তর দেখুন" }]);

  await rest(h, O);
};

/** Corner trays, a tray pick-up, the bank form and the report (HELP_FROM=corner re-runs only this). */
async function rest(h, O) {
  // ── Office: fill the corner trays, then a child takes a tray sheet ───────
  await openActivity(h, O, STAFF_HOME);
  await h.shot(O, "activity-corner-restock", 0, [{ text: "কর্নারের ট্রে" }]);
  await h.tap(O, "কর্নারের ট্রে", 3000);
  await h.shot(O, "activity-corner-restock", 1, [
    { text: "প্রতি স্তরে শিট" },
    { text: "প্রতিটির কপি" },
    { text: "কম" },
    { text: "কম থাকা সব ট্রে ভরুন (ছাপুন)" },
  ]);
  await printAndClosePdf(h, O, { text: "কম থাকা সব ট্রে ভরুন (ছাপুন)" });

  await openActivity(h, O, STAFF_HOME);
  await h.tap(O, "শিট ডেস্ক", 3000);
  await fill(h, O, "শিটের কোড", "2");
  await h.shot(O, "activity-desk-pickup", 0, [{ text: "শিটের কোড" }, { text: "খুঁজুন" }]);
  await h.tap(O, "খুঁজুন", 3000);
  await fill(h, O, "স্কুল আইডি, নাম বা রোল", "হামজা");
  await h.tap(O, { text: "খুঁজুন", last: true }, 2500);
  await h.tap(O, "হামজা রহমান", 1500);
  await h.shot(O, "activity-desk-pickup", 1, [{ text: "স্কুল আইডি, নাম বা রোল" }, { text: "হামজা রহমান" }, { text: "হামজা রহমান-কে দিন" }]);
  await h.tap(O, "হামজা রহমান-কে দিন", 3000);

  // ── Office: a new bank (the form only; nothing is uploaded) ──────────────
  await openActivity(h, O, STAFF_HOME);
  await h.shot(O, "activity-add-bank", 0, [{ text: "নতুন ব্যাংক যোগ করুন" }]);
  await h.tap(O, "নতুন ব্যাংক যোগ করুন", 2000);
  await fill(h, O, "নাম (বাংলা)", "রেখা টানো");
  await h.shot(
    O,
    "activity-add-bank",
    1,
    [{ text: "সূচি (CSV)" }, { text: "শিটের PDF (ঐচ্ছিক)" }, { text: "নাম (বাংলা)" }, { text: "দক্ষতা" }, { text: "তুলুন" }],
    { anchor: { text: "সূচি (CSV)" } },
  );

  await report(h, O);
}

/** The report (HELP_FROM=report re-runs only this). */
async function report(h, O) {
  // The bank form's anchor scrolled the page; bring the header (☰) back first.
  await h.topmost(O, { text: "☰" }, { scroll: true }).catch(() => undefined);
  await O.evaluate(() => window.scrollTo(0, 0));
  await O.waitForTimeout(500);
  await h.openMenu(O);
  await h.tap(O, "রিপোর্ট", 1500);
  await h.shot(O, "activity-report", 0, [{ text: "অ্যাক্টিভিটি শিট রিপোর্ট" }]);
  await h.tap(O, "অ্যাক্টিভিটি শিট রিপোর্ট", 3500);
  await h.shot(O, "activity-report", 1, [{ text: "দক্ষতা", minY: 60 }, { text: "ব্যাংক", minY: 60 }, { text: "শিক্ষার্থী", minY: 60 }]);
}
