/**
 * Capture spec — unusual-mark recheck (CT-RC, D-#1265–#1268): the teacher's ticks, the
 * submit pop-up and the whole-class tick; the approver's review, hold and approve; the
 * held-results card on Today; the % rules screen.
 *
 * LOCAL ONLY: it ticks, submits, holds, approves, releases and corrects, because those
 * screens only exist after those steps. Data: scripts/help/fixtures/ct-recheck.ts (--reset first).
 */
const L = require("./exam-lib.cjs");

const TRACKERS = "ট্র্যাকার";
const CT = "ক্লাস টেস্ট";
const TICK = "আমি খাতা দ্বিতীয়বার দেখেছি, নম্বর ঠিক আছে";
/** A test card's button, found after the card's CT id. */
const inCard = (ctId, label) => ({ css: `xpath=//*[contains(text(),'${ctId}')]/following::*[normalize-space(text())='${label}'][1]` });

async function expectText(page, re, what) {
  const body = await page.locator("body").innerText();
  if (!re.test(body)) throw new Error(`expected ${what} (${re}) on screen`);
  console.log(`ok: ${what}`);
}

async function teacher(h) {
  const T = await L.login(h, "teacher2@help.test");
  await L.go(h, T, TRACKERS, CT);
  // ৩য় বালিকা ইংরেজি টেস্ট ৪ (CT-C3-ENG-0006): নাফিসা 20/20, সাদিয়া 7/20.
  await h.tap(T, inCard("CT-C3-ENG-0006", "ফলাফল প্রকাশ"), 4000);
  await expectText(T, /বাকি: ২টি অস্বাভাবিক নম্বর/, "two marks owed before submit");
  await h.shot(T, "exam-ct-recheck-confirm", 0, [{ re: "^এ বছর এই বিষয়ে গড়" }, { text: TICK }], { anchor: { re: "^অস্বাভাবিক নম্বর ·" } });

  for (let i = 0; i < 2; i++) await h.tap(T, { css: `role=checkbox[name="${TICK}"][checked=false]` }, 2500);
  await L.fillAfter(T, "নোট (ঐচ্ছিক)", "এই অধ্যায়টি ভালো পড়েছে");
  // Typing scrolled the page; bring Submit back so the picture can hold both.
  await h.topmost(T, { text: "প্রকাশের জন্য জমা দিন" }, { scroll: true });
  await h.shot(T, "exam-ct-recheck-confirm", 1, [{ text: "নোট রাখুন" }, { text: "প্রকাশের জন্য জমা দিন" }], {
    anchor: { text: "প্রকাশের জন্য জমা দিন" },
  });
  await h.tap(T, "নোট রাখুন", 2500);
  await expectText(T, /সব অস্বাভাবিক নম্বর নিশ্চিত করা হয়েছে/, "all ticks in");

  await h.tap(T, "প্রকাশের জন্য জমা দিন", 2000);
  await h.shot(T, "exam-ct-recheck-confirm", 2, [{ text: "তারপর খাতাগুলো অফিসে জমা দিন।" }, { text: "বুঝেছি, জমা দিন" }]);
  await h.tap(T, "বুঝেছি, জমা দিন", 3500);
  await expectText(T, /অনুমোদনের অপেক্ষায়/, "submitted after the pop-up");

  // ৫ম ক ইংরেজি টেস্ট ৪ (CT-C5-ENG-0004): the whole class far above its usual level.
  await L.back(T);
  await h.tap(T, inCard("CT-C5-ENG-0004", "ফলাফল প্রকাশ"), 4000);
  await h.shot(T, "exam-ct-recheck-confirm", 3, [{ text: "পুরো শ্রেণির নম্বর অস্বাভাবিক বেশি" }, { text: "সব খাতা আবার দেখেছি, নম্বরগুলো ঠিক আছে" }], {
    anchor: { text: "পুরো শ্রেণির নম্বর অস্বাভাবিক বেশি" },
  });
  await h.tap(T, "সব খাতা আবার দেখেছি, নম্বরগুলো ঠিক আছে", 3000);
  await expectText(T, /সব অস্বাভাবিক নম্বর নিশ্চিত করা হয়েছে/, "one class tick covers every high mark");
  await T.context().close();
}

async function principal(h) {
  const P = await L.login(h, "principal@help.test");
  await L.go(h, P, TRACKERS, CT);

  // The % rules.
  await h.shot(P, "exam-ct-recheck-rules", 0, [{ text: "অস্বাভাবিক নম্বরের নিয়ম" }]);
  await h.tap(P, "অস্বাভাবিক নম্বরের নিয়ম", 3500);
  await h.shot(P, "exam-ct-recheck-rules", 1, [{ text: "গড়ের চেয়ে এত % বেশি হলে" }, { text: "অস্বাভাবিক নম্বর যাচাই চালু" }], {
    anchor: { text: "অস্বাভাবিক নম্বর যাচাই চালু" },
  });
  await h.shot(P, "exam-ct-recheck-rules", 2, [{ text: "নিয়ম সংরক্ষণ করুন" }]);
  await h.tap(P, "নিয়ম সংরক্ষণ করুন", 2500);
  const saved = await P.getByText("নিয়ম সংরক্ষণ হয়েছে", { exact: true }).count();
  if (!saved) throw new Error("rules save did not confirm");
  console.log("ok: rules saved");
  await L.back(P);

  // Approve ইংরেজি টেস্ট ৫ (submitted with নাফিসা ticked) — hold নাফিসা.
  await h.tap(P, { re: "^ড্যাশবোর্ড" }, 5000);
  await h.tap(P, { re: "^ইংরেজি · টেস্ট নং ৫" }, 4000);
  await h.tap(P, "ফলাফল প্রকাশ", 4000);
  await h.shot(P, "exam-ct-recheck-approve", 0, [{ re: "^✓ নিশ্চিত করেছেন" }, { text: "অস্বাভাবিক নম্বরগুলো আমি দেখেছি" }], {
    anchor: { re: "^অস্বাভাবিক নম্বর ·" },
  });
  await h.shot(P, "exam-ct-recheck-approve", 1, [{ text: "খাতা দেখব · এই ফল আটকে রাখুন" }]);
  await h.tap(P, "খাতা দেখব · এই ফল আটকে রাখুন", 3000);
  await h.tap(P, "অস্বাভাবিক নম্বরগুলো আমি দেখেছি", 1500);
  await h.shot(P, "exam-ct-recheck-approve", 2, [{ text: "অনুমোদন ও প্রকাশ" }]);
  await h.tap(P, "অনুমোদন ও প্রকাশ", 5000);
  await expectText(P, /আটকে আছে/, "the held row stays back after approval");

  // Today: both held results (টেস্ট ৬ from the fixture, টেস্ট ৫ just now).
  await P.reload({ waitUntil: "load" });
  await P.waitForTimeout(7000);
  await h.shot(P, "exam-ct-recheck-approve", 3, [{ text: "ঠিক আছে · প্রকাশ করুন" }, { text: "নম্বর বদলান" }], {
    anchor: { re: "আটকে রাখা ফল · খাতা দেখুন" },
  });
  await h.tap(P, "ঠিক আছে · প্রকাশ করুন", 4000);
  await expectText(P, /ফল প্রকাশ করা হয়েছে/, "release published the held result");
  await h.tap(P, "নম্বর বদলান", 1500);
  await L.fillAfter(P, /^সঠিক নম্বর/, "13");
  await h.tap(P, "সংশোধন করে প্রকাশ করুন", 4000);
  const left = await P.getByText("ঠিক আছে · প্রকাশ করুন", { exact: true }).locator("visible=true").count();
  if (left !== 0) throw new Error(`expected no held results left, found ${left}`);
  console.log("ok: correction published the last held result");
  await P.context().close();
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the ct-recheck spec saves while it walks; run it locally (see its header)");
  await teacher(h);
  await principal(h);
};
