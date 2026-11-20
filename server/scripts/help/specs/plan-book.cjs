/**
 * Capture spec — পরিকল্পনার পাশে বই পড়া (content-plan-book-tab): the "📄 পরিকল্পনা | 📖 বই" tabs on
 * a lesson plan (D-#1653). Data: scripts/help/fixtures/plan-book.ts (run it with --reset first; the API
 * must run with fake-drive-server.ts on the same HELP_FAKE_DRIVE folder so the book picture loads).
 * Reads only (opening the book records a content read). teacher@help.test teaches বিজ্ঞান in ৩য় বালক.
 */
const L = require("./content-lib.cjs");

exports.run = async (h) => {
  const T = await L.login(h, "teacher@help.test");
  const G = "content-plan-book-tab";

  // Row 1: the menu. Row 2: the plan list.
  await L.menuShot(h, T, G, 0, "একাডেমিক", "পাঠ পরিকল্পনা");
  await h.shot(T, G, 1, [{ text: "সেশন ১" }]);
  await h.tap(T, "সেশন ১", 4500);

  // Row 3: the plan, with the tabs above it.
  await h.shot(T, G, 2, [{ text: "📖 বই" }]);
  await h.tap(T, "📖 বই", 4500);

  // Row 4: another chapter, the teacher note, back to the plan (chapter 2 is short: all three fit).
  await h.tap(T, "অধ্যায় ১: উদ্ভিদ পরিচিতি", 1200);
  await h.tap(T, { text: "অধ্যায় ২: পানি ও বায়ু", last: true }, 3500);
  await h.shot(T, G, 3, [{ text: "অধ্যায় বেছে নিন" }, { re: "শিক্ষক-নোট ও উত্তর$" }, { text: "📄 পরিকল্পনা" }]);
  await T.context().close();
};
