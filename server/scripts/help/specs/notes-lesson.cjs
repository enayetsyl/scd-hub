/**
 * notes spec, part 1 — the Principal turns the class note's lesson-plan question on (it is OFF
 * by default, D-#952) and reads the whole-school lesson-plan progress. Runs first: the teacher
 * part needs the question switched on.
 */
exports.switchOn = async (h, x) => {
  const { context, page } = await x.loginAt(h, "principal@help.test");
  await x.drawerShot(h, page, "notes-lesson-switch", 0, "ক্লাস নোট", "পাঠ পরিকল্পনার অগ্রগতি");
  await x.peek(page, "lp-principal");
  await h.shot(page, "notes-lesson-switch", 1, [{ text: "ক্লাস নোটে পাঠ পরিকল্পনার প্রশ্ন" }, { text: "চালু করুন" }]);
  await h.tap(page, "চালু করুন", 3000);
  await h.shot(page, "notes-lesson-switch", 2, [{ text: "এখন চালু আছে" }]);

  // The whole-school overview (Office/Principal), then one শাখা's sessions.
  await x.drawerShot(h, page, "notes-lesson-overview", 0, "ক্লাস নোট", "পাঠ পরিকল্পনার অগ্রগতি");
  await x.scrollTo(h, page, { text: "পুরো স্কুল" });
  await x.peek(page, "lp-overview");
  await h.shot(
    page,
    "notes-lesson-overview",
    1,
    [{ text: "পুরো স্কুল" }, { re: "সেশন পিছিয়ে$" }, { re: "^সেশন বাছাই ছাড়া নোট" }, { text: "৩য় শ্রেণি · বালিকা — গণিত" }],
    { anchor: { text: "পুরো স্কুল" } },
  );
  await h.tap(page, "৩য় শ্রেণি · বালিকা — গণিত", 3500);
  await x.peek(page, "lp-girls");
  await h.shot(page, "notes-lesson-overview", 2, [{ text: "শেষ", minY: 200 }]);
  await context.close();
};
