/**
 * Capture spec — "শিখনফল তালিকা দেখা" (mastery-catalogue-view). Read-only: it only opens
 * screens, so it may run with --prod once a list exists there. The full local walk
 * (mastery.cjs) calls it at the end.
 */
async function catalogue(h, page) {
  await h.openMenu(page);
  const itemOnTop = await h.topmost(page, { text: "তালিকা" }, { scroll: true }).then(() => true, () => false);
  if (!itemOnTop) await h.tap(page, "শিখন-দক্ষতা", 1200);
  await h.shot(page, "mastery-catalogue-view", 0, [{ text: "শিখন-দক্ষতা" }, { text: "তালিকা" }], { anchor: { text: "শিখন-দক্ষতা" } });
  await h.tap(page, "তালিকা", 3000);
  await h.shot(page, "mastery-catalogue-view", 1, [{ text: "শিখনফল", minY: 120 }]);
  await h.tap(page, { text: "শিখনফল", minY: 120 }, 3500);
  await h.shot(page, "mastery-catalogue-view", 2, [{ re: "^লক করা [০-৯]+$" }, { re: "^অধ্যায় ১ · " }]);
}

/**
 * "প্রশ্ন না রুব্রিক ও প্রশ্নের ধরন ঠিক করা" (mastery-catalogue-assess, D-#1161). Starts on the
 * catalogue page `catalogue()` leaves open; opens one row's edit form and cancels — it never
 * saves, but it is a writer's screen, so it is not part of the read-only `run`.
 */
async function assess(h, page) {
  await h.topmost(page, { text: "সম্পাদনা" }, { scroll: true });
  await h.shot(page, "mastery-catalogue-assess", 0, [{ text: "সম্পাদনা" }], { anchor: { text: "সম্পাদনা" } });
  await h.tap(page, "সম্পাদনা", 1500);
  await h.topmost(page, { text: "কীভাবে যাচাই হবে" }, { scroll: true });
  await h.shot(page, "mastery-catalogue-assess", 1, [{ text: "কীভাবে যাচাই হবে" }, { re: "^প্রশ্নের ধরন — " }, { text: "সংরক্ষণ" }], {
    anchor: { text: "কীভাবে যাচাই হবে" },
  });
  await h.tap(page, "বাতিল", 800);
}

exports.catalogue = catalogue;
exports.assess = assess;
exports.run = async (h) => {
  const page = (await h.login(process.env.HELP_LOGIN ?? "principal@help.test", process.env.HELP_PASSWORD ?? "Help@123")).page;
  await catalogue(h, page);
};
