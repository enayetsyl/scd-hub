/**
 * Capture spec — অর্থ ও হিসাব (finance books: daily entry, snapshot, fee support, qard, reconciliation), guides fin-*.
 *
 * LOCAL ONLY, on scripts/help/fixtures/fin.ts. It records a few entries while it walks
 * (an income, an expense, a transfer, a provider, a party, a qard repayment, a
 * reconciliation). Helpers are shared with specs/fin.cjs.
 */
const { mark, field, fill, pick, setDate, back, drawer, PASSWORD } = require("./fin.cjs").helpers;

exports.run = async (h) => {
  if (h.PROD) throw new Error("the fin-books spec saves while it walks; run it locally (see its header)");
  // ── Office: finance books ─────────────────────────────────────────────────
  const O = (await h.login("office@help.test", PASSWORD)).page;
  await drawer(h, O, "অর্থ");
  const finHome = {
    "দৈনিক এন্ট্রি": ["fin-ledger-income", "fin-ledger-expense", "fin-ledger-transfer"],
    "দৈনিক স্ন্যাপশট": ["fin-ledger-snapshot"],
    "ফি ও যাকাত/সহায়তা": ["fin-fee-provider-add", "fin-fee-statement"],
    "কর্জ/IOU": ["fin-qard-party-add"],
    "হিসাব মিলানো": ["fin-recon-record", "fin-recon-history"],
  };
  for (const [button, guides] of Object.entries(finHome)) {
    for (const g of guides) await h.shot(O, g, 0, [{ text: "☰" }, { text: button }]);
  }
  for (const g of ["fin-qard-entry", "fin-qard-outstanding"]) await h.shot(O, g, 0, [{ text: "কর্জ/IOU" }]);

  await h.tap(O, "দৈনিক এন্ট্রি", 2500);
  {
    const date = await field(O, "তারিখ");
    const kind = await pick(h, O, "ধরন", "অন্যান্য আয়");
    const amount = await fill(O, "পরিমাণ", "3000");
    const mode = await pick(h, O, "মাধ্যম", "নগদ");
    await h.shot(O, "fin-ledger-income", 1, [date, kind, amount, mode], { anchor: { text: "দৈনিক অর্থ এন্ট্রি", minY: 80 } });
    const head = await pick(h, O, "আয়ের খাত", "সাদাকা");
    await fill(O, "নোট", "উদাহরণ: অভিভাবকের সাদাকা");
    await h.shot(O, "fin-ledger-income", 2, [head, { text: "জমা দিন" }]);
    await h.tap(O, "জমা দিন", 2500);
  }
  {
    const kind = await pick(h, O, "ধরন", "ব্যয়");
    const amount = await fill(O, "পরিমাণ", "1200");
    const mode = await field(O, "মাধ্যম");
    await h.shot(O, "fin-ledger-expense", 1, [kind, amount, mode], { anchor: { text: "দৈনিক অর্থ এন্ট্রি", minY: 80 } });
    const head = await pick(h, O, "ব্যয়ের খাত", "ইউটিলিটি");
    const note = await fill(O, "নোট", "উদাহরণ: অক্টোবরের বিদ্যুৎ বিল");
    await h.shot(O, "fin-ledger-expense", 2, [head, note, { text: "জমা দিন" }]);
    await h.tap(O, "জমা দিন", 2500);
  }
  {
    const kind = await pick(h, O, "ধরন", "স্থানান্তর");
    const amount = await fill(O, "পরিমাণ", "5000");
    const mode = await field(O, "মাধ্যম");
    await h.shot(O, "fin-ledger-transfer", 1, [kind, amount, mode], { anchor: { text: "দৈনিক অর্থ এন্ট্রি", minY: 80 } });
    const to = await pick(h, O, "গন্তব্য লেজার", "ব্যাংক");
    await h.shot(O, "fin-ledger-transfer", 2, [to, { text: "জমা দিন" }]);
    await h.tap(O, "জমা দিন", 2500);
  }
  await back(h, O);

  await h.tap(O, "দৈনিক স্ন্যাপশট", 2500);
  {
    const date = await setDate(O, "তারিখ", "2026-11-04");
    await h.shot(O, "fin-ledger-snapshot", 1, [date, { text: "লোড করুন" }]);
    await h.tap(O, "লোড করুন", 3000);
    const cash = await mark(O, "নগদ", { below: "লোড করুন" });
    const close = await mark(O, "সমাপনী", { below: "লোড করুন" });
    await h.shot(O, "fin-ledger-snapshot", 2, [cash, close], { anchor: { text: "দৈনিক স্ন্যাপশট", minY: 80 } });
  }
  await back(h, O);

  await h.tap(O, "ফি ও যাকাত/সহায়তা", 2500);
  {
    const list = await mark(O, "সহায়তাদাতা");
    const name = await fill(O, "নাম", "Example Sadaqah Trust");
    const bn = await fill(O, "নাম (বাংলা)", "উদাহরণ সাদাকা ট্রাস্ট");
    const contact = await fill(O, "যোগাযোগ", "01900000009");
    await h.shot(O, "fin-fee-provider-add", 1, [list, name, bn, contact, { text: "সহায়তাদাতা যোগ করুন" }], {
      anchor: { text: "সহায়তাদাতা" },
    });
    await h.tap(O, "সহায়তাদাতা যোগ করুন", 2500);
  }
  {
    const title = "সহায়তাদাতা বিবরণী";
    const who = await pick(h, O, "সহায়তাদাতা আইডি", "উদাহরণ যাকাত তহবিল", { below: title });
    await O.waitForTimeout(1500);
    const raised = await mark(O, "ধার্যকৃত", { below: title });
    await h.shot(O, "fin-fee-statement", 1, [{ text: title }, who, raised], { anchor: { text: title } });
  }
  await back(h, O);

  await h.tap(O, "কর্জ/IOU", 2500);
  {
    const name = await fill(O, "নাম", "Example Trust");
    const bn = await fill(O, "নাম (বাংলা)", "উদাহরণ ট্রাস্ট");
    const kind = await pick(h, O, "ধরন", "সংস্থা");
    const contact = await fill(O, "যোগাযোগ", "01900000008");
    await h.shot(O, "fin-qard-party-add", 1, [name, bn, kind, contact, { text: "পক্ষ যোগ করুন" }], { anchor: { text: "নাম" } });
    await h.tap(O, "পক্ষ যোগ করুন", 2500);
  }
  {
    const title = "এন্ট্রি রেকর্ড করুন";
    const who = await pick(h, O, "পক্ষ আইডি", "উদাহরণ পরিবার · ব্যক্তি", { below: title });
    const type = await pick(h, O, "ধরন", "কর্জে হাসানা", { below: title });
    const dir = await pick(h, O, "দিক", "ফেরত গৃহীত", { below: title });
    const amount = await fill(O, "পরিমাণ", "2000", { below: title });
    await h.shot(O, "fin-qard-entry", 1, [who, type, dir, amount], { anchor: { text: "পক্ষ আইডি", below: title } });
    const date = await setDate(O, "তারিখ", "2026-11-05", { below: title });
    const mode = await pick(h, O, "মাধ্যম", "নগদ", { below: title });
    await h.shot(O, "fin-qard-entry", 2, [date, mode, { text: title, last: true }], { anchor: { text: "তারিখ" } });
    await h.tap(O, { text: title, last: true }, 2500);
  }
  {
    const title = "বকেয়া";
    const head = await mark(O, title, { last: true });
    await pick(h, O, "পক্ষ আইডি", "উদাহরণ পরিবার · ব্যক্তি", { below: title });
    await O.waitForTimeout(2000);
    // The outstanding row: the last on-top "কর্জে হাসানা" (the entry form above shows it too).
    const qrow = await mark(O, "কর্জে হাসানা", { last: true });
    await h.shot(O, "fin-qard-outstanding", 1, [head, qrow], { anchor: head });
    await h.tap(O, "মেয়াদোত্তীর্ণ দেখুন", 3000);
    // The page ends here: no anchor (its -70px would push the last row off the picture).
    const late = await mark(O, "দিন বিলম্ব", { re: true });
    await O.mouse.wheel(0, 2000);
    await O.waitForTimeout(600);
    await h.shot(O, "fin-qard-outstanding", 2, [{ text: "মেয়াদোত্তীর্ণ দেখুন" }, late]);
  }
  await back(h, O);

  await h.tap(O, "হিসাব মিলানো", 2500);
  {
    const date = await setDate(O, "তারিখ", "2026-11-05");
    const bank = await fill(O, "ব্যাংক স্টেটমেন্ট ব্যালেন্স", "203800");
    const cash = await fill(O, "এক্সিমাস নগদ", "39650");
    await fill(O, "এক্সিমাস ব্যাংক", "203800");
    await fill(O, "এক্সিমাস অনলাইন", "12400");
    await h.shot(O, "fin-recon-record", 1, [date, bank, cash, { text: "জমা দিন" }]);
    await h.tap(O, "জমা দিন", 3000);
    await h.shot(O, "fin-recon-record", 2, [{ text: "ব্যাংক পার্থক্য" }]);
  }
  {
    const title = "হিসাব মিলানোর ইতিহাস";
    const from = await field(O, "শুরুর তারিখ");
    // The page ends here: scroll to the end and take the shot without an anchor.
    await O.mouse.wheel(0, 3000);
    await O.waitForTimeout(600);
    await h.shot(O, "fin-recon-history", 1, [{ text: title }, from, { text: "লোড করুন" }]);
  }
  await O.context().close();
};
