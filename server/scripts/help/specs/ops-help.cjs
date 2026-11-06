/**
 * Capture spec — using সাহায্য ও নির্দেশিকা itself (ops area), for staff (teacher@help.test)
 * and the guardian (01800000001). Read-only walk (the হ্যাঁ feedback is not pressed).
 *
 * Run it LAST: the help screens list the guides the server loaded at boot, so restart the local
 * server after the other ops specs have finished (their guides must no longer be drafts).
 */
const { PASSWORD, menuShot, home, reveal, fill, closePopups } = require("./ops-common.cjs");

async function walk(h, page, guide, screenWithHelp) {
  await menuShot(h, page, guide, 0, [{ text: "সাহায্য ও নির্দেশিকা" }]);
  await h.tap(page, "সাহায্য ও নির্দেশিকা", 3500);
  await fill(h, page, { placeholder: "কী করতে চান লিখুন…" }, "নোটিফিকেশন", 2500);
  await h.shot(page, guide, 1, [{ placeholder: "কী করতে চান লিখুন…" }, { text: "নোটিফিকেশন দেখা" }]);
  await h.tap(page, "নোটিফিকেশন দেখা", 4000);
  await reveal(page, { text: "এই পাতায় যান →" });
  await h.shot(page, guide, 2, [{ re: "^সবগুলো একবারে" }, { text: "এই পাতায় যান →" }, { text: "হ্যাঁ" }]);
  await home(page);
  await closePopups(h, page);
  if (screenWithHelp) await screenWithHelp(page);
  await h.shot(page, guide, 3, [{ text: "?" }]);
}

exports.run = async (h) => {
  const T = (await h.login("teacher@help.test", PASSWORD)).page;
  await closePopups(h, T);
  await walk(h, T, "ops-help-centre");

  const G = (await h.login("01800000001", PASSWORD)).page;
  await G.waitForTimeout(3000);
  await closePopups(h, G);
  // The guardian home has no guide of its own; আমার বার্তা does.
  await walk(h, G, "ops-help-centre-guardian", async (page) => {
    await h.openMenu(page);
    await h.tap(page, "আমার বার্তা", 3500);
  });
};
