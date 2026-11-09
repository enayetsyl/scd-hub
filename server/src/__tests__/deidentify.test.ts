/**
 * AI-4 de-identification (D-#1094) — pure, no database. The PRD's test list: Bangla and
 * English names, ব/ভ and ী/ি spelling variants, phone formats, and a name inside a longer
 * word that must NOT be replaced; plus the round trip and the fail-closed gate.
 * Every name here is invented.
 */
import { assertDeidentified, deidentify, DeidentifyError, reidentify, remainingNames, skeleton, type DeidScope } from "../modules/platform/ai/deidentify";
import { guessBanglaName } from "../modules/platform/ai/banglaGuess";

const scope: DeidScope = {
  people: [
    { kind: "S", id: "s-own", names: ["Tahsin Ahmed", "তাহসিন আহমেদ"], own: true },
    { kind: "S", id: "s-2", names: ["Nabiha Rahman", "নাবিহা রহমান"] },
    { kind: "S", id: "s-3", names: ["Ali Hasan"] },
    { kind: "G", id: "g-1", names: ["Farzana Begum"] },
    { kind: "T", id: "t-1", names: ["Rafiqul Islam"] },
  ],
};

describe("names become tokens", () => {
  test("the child the comment is about is [S]; others are numbered; the same person keeps one token", () => {
    const r = deidentify("আজ তাহসিন নাবিহার সাথে কথা বলেছেন। তাহসিন পরে ঠিক হয়েছেন। Nabiha was upset.", scope);
    expect(r.text).toBe("আজ [S] [S1]র সাথে কথা বলেছেন। [S] পরে ঠিক হয়েছেন। [S1] was upset.");
    expect(r.map["[S]"]).toBe("তাহসিন");
    expect(r.map["[S1]"]).toBe("নাবিহা");
  });

  test("a full name is replaced whole, not part by part", () => {
    expect(deidentify("Tahsin Ahmed did well; Farzana Begum was informed.", scope).text).toBe("[S] did well; [G1] was informed.");
  });

  test("Bangla spelling variants still match (ি/ী, ব/ভ)", () => {
    expect(deidentify("তাহসীন আজ এসেছেন।", scope).text).toBe("[S] আজ এসেছেন।");
    const vScope: DeidScope = { people: [{ kind: "S", id: "x", names: ["সাবিহা"], own: true }] };
    expect(deidentify("সাভিহার খাতা", vScope).text).toBe("[S]র খাতা");
  });

  test("Bangla case endings stay; English is case-insensitive", () => {
    expect(deidentify("তাহসিনকে বলা হয়েছে। TAHSIN agreed.", scope).text).toBe("[S]কে বলা হয়েছে। [S] agreed.");
  });

  test("a name INSIDE a longer word is left alone", () => {
    const r = deidentify("Alif Laila and the alignment; Tahsinul is someone else.", scope);
    expect(r.text).toBe("Alif Laila and the alignment; Tahsinul is someone else.");
  });

  test("a common word that is also a name part is not replaced alone (Islam, Ahmed, রহমান)", () => {
    expect(deidentify("ইসলাম শিক্ষা বই আনেননি। Islamic studies. রহমান শব্দের অর্থ।", scope).text).toBe(
      "ইসলাম শিক্ষা বই আনেননি। Islamic studies. রহমান শব্দের অর্থ।",
    );
    expect(deidentify("Rafiqul Islam spoke to the class.", scope).text).toBe("[T1] spoke to the class.");
  });
});

describe("numbers and ids", () => {
  test.each([
    ["ফোন 01712345678 এ", "ফোন [PHONE] এ"],
    ["call +8801712-345678 now", "call [PHONE] now"],
    ["নম্বর ০১৮১২৩৪৫৬৭৮", "নম্বর [PHONE]"],
    ["রোল নং ১২ এর", "রোল [NUM] এর"],
    ["ID: 0059", "ID [NUM]"],
    ["HW-C3-BAN-0007 দেওয়া হয়নি", "[ID] দেওয়া হয়নি"],
    ["marks 15 out of 20", "marks 15 out of 20"],
  ])("%s → %s", (input, out) => {
    expect(deidentify(input, scope).text).toBe(out);
  });
});

describe("round trip and the fail-closed gate", () => {
  test("reidentify restores the people; phones and ids stay hidden", () => {
    const r = deidentify("তাহসিন (01712345678) নাবিহাকে সাহায্য করেছেন।", scope);
    const back = reidentify(`${r.text} [S]র উন্নতি হয়েছে।`, r.map);
    expect(back).toBe("তাহসিন ([PHONE]) নাবিহাকে সাহায্য করেছেন। তাহসিনর উন্নতি হয়েছে।");
    expect(reidentify("[S9] and [G4]", r.map)).toBe("[S9] and [G4]");
  });

  test("after deidentify nothing remains; raw text fails the gate", () => {
    const raw = "Tahsin Ahmed এবং তাহসিন";
    expect(remainingNames(raw, scope)).toBeGreaterThan(0);
    expect(() => assertDeidentified(raw, scope)).toThrow(DeidentifyError);
    const r = deidentify(raw, scope);
    expect(() => assertDeidentified(r.text, scope)).not.toThrow();
  });

  test("the own child's FIRST name alone also fails the gate", () => {
    expect(() => assertDeidentified("আজ তাহসিন এসেছেন", scope)).toThrow(DeidentifyError);
  });
});

describe("no Bangla name typed: guess + loose match (D-#1151)", () => {
  // Only English names on file — the Bangla spellings are guessed, as DeidScopeService does.
  const en = (id: string, name: string, own = false) => ({ kind: "S" as const, id, names: [name, guessBanglaName(name)], own });
  const guessScope: DeidScope = { people: [en("o", "Rafi Ahmed", true), en("c", "Ayesha Siddika"), { kind: "T", id: "t", names: ["Rafiqul Islam", guessBanglaName("Rafiqul Islam")] }] };

  test("guessBanglaName: known parts from the list, the rest sound by sound", () => {
    expect(guessBanglaName("Md. Tahsin Karim")).toBe("মোঃ তাহসিন করিম");
    expect(guessBanglaName("Ayesha Siddika")).toBe("আয়েশা সিদ্দিকা");
    expect(guessBanglaName("Labib")).toBe("লাবিব");
    expect(guessBanglaName("Ridwan")).toBe("রিদওয়ান");
    expect(guessBanglaName("তাহসিন")).toBe("তাহসিন");
    expect(guessBanglaName("")).toBe("");
  });

  test("skeleton ignores vowel length, a/o, aspiration, hasant, doubled letters and য়", () => {
    expect(skeleton("রাফী")).toBe(skeleton("রাফি"));
    expect(skeleton("তন্ময়")).toBe(skeleton("তোনমোয়"));
    expect(skeleton("সাব্বির")).toBe(skeleton("সাবির"));
    expect(skeleton("রাফি")).not.toBe(skeleton("রফিক"));
  });

  test("the own child's name hides in any common spelling, with endings", () => {
    const r = deidentify("রাফী আজ ভালো পড়েছে। রাফিকে আরও লিখতে হবে, রাফির খাতা পরিষ্কার।", guessScope);
    expect(r.text).toBe("[S] আজ ভালো পড়েছে। [S]কে আরও লিখতে হবে, [S]র খাতা পরিষ্কার।");
    expect(reidentify(r.text, r.map)).toContain("রাফী আজ");
    expect(() => assertDeidentified(r.text, guessScope)).not.toThrow();
  });

  test("a classmate / staff name hides when the guess spells it the usual way", () => {
    expect(deidentify("আয়েশা আর রাফি একসাথে পড়েছে", guessScope).text).toBe("[S1] আর [S] একসাথে পড়েছে");
  });

  test("ordinary words are left alone", () => {
    const t = "আজ ক্লাসে মনোযোগ কম ছিল, বাড়ির কাজ করেনি।";
    expect(deidentify(t, guessScope).text).toBe(t);
  });

  test("a long name hides one letter off (o/u, ী/ি), but only for the own child", () => {
    const s2: DeidScope = { people: [en("o", "Mubtasim Faruk", true), en("c", "Nafis Rahman")] };
    expect(guessBanglaName("Mubtasim")).toBe("মুবতাসিম");
    expect(deidentify("মোবতাসীম আজ ভালো লিখেছে", s2).text).toBe("[S] আজ ভালো লিখেছে");
  });

  test("everyday words are not names: কাদের (Kader) stays", () => {
    const s3: DeidScope = { people: [en("o", "Labib Bin Kader", true)] };
    expect(deidentify("কাদের খাতা জমা হয়নি?", s3).text).toBe("কাদের খাতা জমা হয়নি?");
  });

  test("the gate also catches a loose spelling of the own child's name", () => {
    expect(() => assertDeidentified("রাফী আজ এসেছে", guessScope)).toThrow(DeidentifyError);
  });
});
