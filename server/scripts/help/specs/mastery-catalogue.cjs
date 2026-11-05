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

exports.catalogue = catalogue;
exports.run = async (h) => {
  const page = (await h.login(process.env.HELP_LOGIN ?? "principal@help.test", process.env.HELP_PASSWORD ?? "Help@123")).page;
  await catalogue(h, page);
};
