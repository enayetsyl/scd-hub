/**
 * Capture spec — batch 1, শিখনফল (prd-help-centre §7, D-#971).
 *
 * LOCAL ONLY: it imports the C1 Math tree, assigns, reviews, comments, submits and locks,
 * because the review screens only exist after those steps. On prod, the same screens need
 * the real pilot round. Re-shoot them by hand once it exists, or write a read-only spec.
 *
 * Logins come from scripts/help/fixture.ts (example data; password Help@123).
 */
const fs = require("node:fs");
const path = require("node:path");

const PASSWORD = "Help@123";

async function openMastery(h, page, item) {
  await h.openMenu(page);
  const itemOnTop = await h.topmost(page, { text: item }, { scroll: true }).then(() => true, () => false);
  if (!itemOnTop) await h.tap(page, "শিখন-দক্ষতা", 1200);
}

async function menuShot(h, page, guide, item) {
  await openMastery(h, page, item);
  await h.shot(page, guide, 0, [{ text: "শিখন-দক্ষতা" }, { text: item }], { anchor: { text: "শিখন-দক্ষতা" } });
  await h.tap(page, item, 3000);
}

async function openRound(h, page, guide, rowIndex) {
  if (guide) await h.shot(page, guide, rowIndex, [{ re: "গণিত · রাউন্ড" }]);
  await h.tap(page, { re: "গণিত · রাউন্ড" }, 3500);
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the mastery spec saves while it walks; run it locally (see its header)");
  const tree = fs.readFileSync(path.join(h.repoRoot, "docs/mastery/objective-tree/C1_MATH.tree.json"), "utf8");
  const domains = fs.readFileSync(path.join(h.repoRoot, "docs/mastery/objective-tree/domains/MATH.json"), "utf8");

  // ── Principal: import, assign ────────────────────────────────────────────
  const P = (await h.login("principal@help.test", PASSWORD)).page;

  await menuShot(h, P, "mastery-import", "তালিকা ইমপোর্ট");
  const areas = P.locator("textarea").locator("visible=true");
  await areas.nth(0).fill(tree);
  await areas.nth(1).fill(domains);
  await P.waitForTimeout(800);
  await areas.nth(0).evaluate((e) => e.scrollIntoView({ block: "start" }));
  await h.shot(P, "mastery-import", 1, [{ css: "textarea" }, { css: "textarea", last: true }, { text: "আগে দেখুন" }], {
    anchor: { css: "textarea" },
  });
  await h.tap(P, "আগে দেখুন", 5000);
  await h.shot(P, "mastery-import", 2, [{ text: "স্তর অনুযায়ী" }, { text: "প্রয়োগ করুন" }], { anchor: { text: "আগে দেখুন" } });
  await h.tap(P, "প্রয়োগ করুন", 6000);

  await menuShot(h, P, "mastery-review-assign", "তালিকা পর্যালোচনা");
  await openRound(h, P, "mastery-review-assign", 1);
  await h.shot(P, "mastery-review-assign", 2, [{ text: "উদাহরণ শিক্ষক" }, { text: "বরাদ্দ সংরক্ষণ" }]);
  await h.tap(P, "উদাহরণ শিক্ষক", 1200);
  await h.tap(P, "বরাদ্দ সংরক্ষণ", 3000);

  // ── Reviewer: accept, open a row, comment, submit ────────────────────────
  const R = (await h.login("reviewer@help.test", PASSWORD)).page;
  await menuShot(h, R, "mastery-review-accept", "তালিকা পর্যালোচনা");
  await openRound(h, R, "mastery-review-accept", 1);
  await h.shot(
    R,
    "mastery-review-accept",
    2,
    [{ re: "দেখা হয়েছে" }, { text: "শুধু বাকিগুলো" }, { text: "গ্রহণ" }, { text: "বাদ" }],
    { anchor: { re: "দেখা হয়েছে" } },
  );
  await h.tap(R, "গ্রহণ", 3000);

  await h.shot(R, "mastery-review-edit", 0, [{ re: "খাড়ায় হাতে রেখে যোগ" }]);
  await h.tap(R, { re: "খাড়ায় হাতে রেখে যোগ" }, 3000);
  await h.shot(R, "mastery-review-edit", 1, [{ text: "বইয়ে" }, { text: "সম্পাদনা" }, { text: "অন্যটির সাথে মেলান" }], {
    anchor: { text: "বইয়ে" },
  });

  const box = await h.topmost(R, { placeholder: "মন্তব্য লিখুন" }, { scroll: true });
  await box.fill("এই অনুশীলনীটি অধ্যায় ৭-এ আছে কি না একবার দেখে নিন।");
  await h.shot(R, "mastery-review-comment", 0, [{ placeholder: "মন্তব্য লিখুন" }, { text: "পাঠান" }]);
  await h.tap(R, "পাঠান", 3000);
  await h.shot(R, "mastery-review-comment", 1, [{ text: "মীমাংসা হয়েছে" }]);
  await h.tap(R, "মীমাংসা হয়েছে", 3000);

  // Add a step from the objective's own page (D-#1016). Not saved: the later pictures count the rows.
  await openMastery(h, R, "তালিকা পর্যালোচনা");
  await h.tap(R, "তালিকা পর্যালোচনা", 3000);
  await openRound(h, R, null);
  await h.tap(R, "১০০ পর্যন্ত সংখ্যা কথায় লেখা", 3000);
  await h.shot(R, "mastery-review-add-sub", 0, [{ text: "এখানে নতুন উপ-শিখনফল যোগ করুন" }], { anchor: { re: "টি উপ-শিখনফল$" } });
  await h.tap(R, "এখানে নতুন উপ-শিখনফল যোগ করুন", 1500);
  const inputUnder = (label) => R.getByText(label, { exact: typeof label === "string" }).locator("visible=true").first().locator("xpath=ancestor::div[.//input or .//textarea][1]").locator("input, textarea").first();
  await inputUnder("লেবেল").fill("৪১ থেকে ৬০ কথায় লেখা");
  await inputUnder(/^অনুশীলনী \(/).fill("3/কথায় লিখি: ৪১ থেকে ৬০/1");
  await h.topmost(R, { text: "এখানে নতুন উপ-শিখনফল যোগ করুন" }, { scroll: true });
  // D-#1160: no question-type choice in the review — the form is label + exercises + reason.
  await h.shot(R, "mastery-review-add-sub", 1, [{ text: "লেবেল" }, { re: "^অনুশীলনী \\(" }], {
    anchor: { text: "এখানে নতুন উপ-শিখনফল যোগ করুন" },
  });

  // Undo a split from the objective's own page (D-#1260). Not saved either: only the confirm is shown.
  await openMastery(h, R, "তালিকা পর্যালোচনা");
  await h.tap(R, "তালিকা পর্যালোচনা", 3000);
  await openRound(h, R, null);
  await h.tap(R, "১০০ পর্যন্ত সংখ্যা কথায় লেখা", 3000);
  await h.topmost(R, { text: "ভাগ ফিরিয়ে নিন" }, { scroll: true });
  await h.tap(R, "ভাগ ফিরিয়ে নিন", 1200);
  await h.shot(R, "mastery-review-undo-split", 0, [{ text: "ভাগ ফিরিয়ে নিন" }, { text: "হ্যাঁ, ভাগ ফিরিয়ে নিন" }], {
    anchor: { text: "ভাগ ফিরিয়ে নিন" },
  });

  await openMastery(h, R, "তালিকা পর্যালোচনা");
  await h.tap(R, "তালিকা পর্যালোচনা", 3000);
  await openRound(h, R, null);
  await h.shot(R, "mastery-review-submit", 0, [{ text: "পর্যালোচনা জমা দিন" }]);
  await h.tap(R, "পর্যালোচনা জমা দিন", 2500);
  await h.tap(R, "পর্যালোচনা জমা দিন", 4000);
  await h.shot(R, "mastery-review-submit", 1, [{ text: "পর্যালোচনা শেষ" }]);

  // ── Principal: lock, export, then the finished catalogue ─────────────────
  await P.reload({ waitUntil: "load" });
  await P.waitForTimeout(6000);
  await openMastery(h, P, "তালিকা পর্যালোচনা");
  await h.tap(P, "তালিকা পর্যালোচনা", 3000);
  await openRound(h, P, null);
  await h.shot(P, "mastery-review-lock", 0, [{ text: "চূড়ান্ত করার পাতা" }]);
  await h.tap(P, "চূড়ান্ত করার পাতা", 3000);
  await h.shot(P, "mastery-review-lock", 1, [{ text: "সিদ্ধান্ত" }, { text: "চূড়ান্ত করুন", minY: 120 }], { anchor: { text: "সিদ্ধান্ত" } });
  await h.tap(P, { text: "চূড়ান্ত করুন", minY: 120 }, 5000);
  await h.shot(P, "mastery-review-lock", 2, [{ text: "সিদ্ধান্তের ফাইল (Claude-এর জন্য)" }]);

  await require("./mastery-catalogue.cjs").catalogue(h, P);
  // D-#1161: Question/Rubric + question types are set on the catalogue, after the review. Not saved.
  await require("./mastery-catalogue.cjs").assess(h, P);
};
