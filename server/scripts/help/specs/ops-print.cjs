/**
 * Capture spec — printing (ops area): a teacher's print request, the Office queue sorted by
 * class (print-queue-class-order, D-#1010), and marking a job printed.
 *
 * LOCAL ONLY: it marks one fixture job printed. Data: scripts/help/fixtures/ops.ts
 * (four requests from the two example teachers, one already printed).
 */
const { PASSWORD, menu, menuShot, reveal, fill, home } = require("./ops-common.cjs");

exports.run = async (h) => {
  if (h.PROD) throw new Error("ops-print marks a job printed; run it locally (see its header)");

  // ── Teacher: the request form (not sent) ─────────────────────────────────
  const T = (await h.login("teacher@help.test", PASSWORD)).page;
  await menu(h, T, "প্রিন্ট");
  await h.shot(T, "ops-print-request", 0, [{ text: "➕ নতুন অনুরোধ" }]);
  await h.tap(T, "➕ নতুন অনুরোধ", 3000);
  await fill(h, T, { css: "input" }, "গণিত অনুশীলনী — দশমিক");
  await h.tap(T, "Classwork", 800);
  await h.tap(T, "শ্রেণি ৩", 1500);
  await h.shot(T, "ops-print-request", 1, [{ css: "input" }, { text: "Classwork" }, { text: "শ্রেণি ৩" }]);
  await h.tap(T, "বালক", 800).catch(() => {});
  await h.tap(T, "গণিত", 800);
  await h.shot(T, "ops-print-request", 2, [{ text: "ফাইল যোগ করুন" }, { text: "Black & white" }]);
  await h.tap(T, "Black & white", 600);
  await h.tap(T, "Single side", 600);
  await h.shot(T, "ops-print-request", 3, [{ text: "Choose a date" }, { text: "প্রিন্টে পাঠান" }]);
  await home(T);

  // ── Office: the queue by class, then printing ────────────────────────────
  const O = (await h.login("office@help.test", PASSWORD)).page;
  await menuShot(h, O, "print-queue-class-order", 0, [{ text: "প্রিন্ট" }]);
  await h.tap(O, "প্রিন্ট", 3500);
  await h.shot(O, "print-queue-class-order", 1, [{ text: "ছাপার অপেক্ষায়" }]);
  await h.tap(O, "↓ শ্রেণি অনুযায়ী", 2500);
  await h.shot(O, "print-queue-class-order", 2, [{ text: "↓ শ্রেণি অনুযায়ী" }, { text: "শ্রেণি ৩ বালক" }, { text: "↓ আসার ক্রমে" }]);
  await reveal(O, { text: "শ্রেণি ছাড়া" });
  await h.shot(O, "print-queue-class-order", 3, [{ text: "শ্রেণি ছাড়া" }]);
  await h.tap(O, "↓ আসার ক্রমে", 2500);

  await h.shot(O, "ops-print-process", 0, [
    { text: "ছাপার অপেক্ষায়" },
    { text: "খুলুন" },
    { text: "ছাপা হয়েছে", minY: 400 },
    { text: "বাতিল", minY: 400 },
  ]);
  await h.tap(O, { text: "ছাপা হয়েছে", minY: 400 }, 3000);
  await h.tap(O, "ছাপা হয়েছে", 3000);
  await h.shot(O, "ops-print-process", 1, [{ text: "ছাপা হয়েছে" }, { text: "ডেলিভারি হয়েছে", minY: 400 }]);
};
