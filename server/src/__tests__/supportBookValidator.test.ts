/**
 * Support-book validator (SB-1, D-#408/#427).
 *
 * PART A is the port-fidelity proof. `SB-Governance/validator_letter_audit.py` ships
 * its own seeded-error test — the eight cases README §6 requires before any chapter
 * merges through the validator. The reference implementation passes 8/8; this runs
 * the SAME eight cases through the TypeScript port and asserts the same verdicts. If
 * the port ever drifts from the Python, these fail.
 *
 * The inventory here is a SMALL INLINE FIXTURE carrying the real taught-sets for only
 * the পাঠ the eight cases touch, lifted verbatim from `letter_inventory_C1-BAN.json`.
 * The real 43 KB file is programme DATA and belongs in `PolicyDoc`, not in the repo
 * (D-#403) — a fixture keeps the test self-contained without importing governance.
 *
 * PART B covers the checks ported from the CLI, plus the C9 regression: a first cut
 * matched "strip" anywhere and flagged a *striped tiger*, a *strip of tablets* and a
 * *strip of grass* in the real book. All three must stay clean.
 */
import { auditText, auditBlock, type LetterInventory } from "../modules/support-book/services/validator/letterAudit";
import { validateBook } from "../modules/support-book/services/validator/index";

const V = "অ আ ই ঈ উ ঊ ঋ এ ঐ ও ঔ".split(" ");
const C1 = "ক খ গ ঘ ঙ চ ছ জ ঝ ঞ ট ঠ ড ঢ ণ ত থ দ ধ ন".split(" ");
const C2 = "প ফ ব ভ ম".split(" ");
const C3 = "য র ল".split(" ");
const C4 = "শ ষ স হ ড় ঢ় য় ৎ ং ঃ ঁ".split(" ");

/** Verbatim slices of letter_inventory_C1-BAN.json for the seeded cases. */
const INV: LetterInventory = {
  book_id: "C1-BAN",
  lessons: {
    "5": { cumulative_borno: [], cumulative_kar: [], conjunct_whitelist: { glyphs: [] } },
    "10": { cumulative_borno: ["অ", "আ"], cumulative_kar: [], conjunct_whitelist: { glyphs: [] } },
    "15": { cumulative_borno: [...V], cumulative_kar: [], conjunct_whitelist: { glyphs: [] } },
    "24": { cumulative_borno: [...V, ...C1], cumulative_kar: ["া", "ি", "ী"], conjunct_whitelist: { glyphs: [] } },
    "26": { cumulative_borno: [...V, ...C1, ...C2], cumulative_kar: ["া", "ি", "ী"], conjunct_whitelist: { glyphs: [] } },
    "30": { cumulative_borno: [...V, ...C1, ...C2, ...C3], cumulative_kar: ["া", "ি", "ী", "ু", "ূ", "ৃ", "ে", "ৈ"], conjunct_whitelist: { glyphs: [] } },
    // needs_review with glyphs: null — B-1's default is NONE, never "unknown, allow".
    "45": { cumulative_borno: [...V, ...C1, ...C2, ...C3, ...C4], cumulative_kar: ["া", "ি", "ী", "ু", "ূ", "ৃ", "ে", "ৈ", "ো", "ৌ"], conjunct_whitelist: { glyphs: null, needs_review: true } },
  },
};

describe("A. letter audit — the Python reference's own 8 seeded cases (D-#427)", () => {
  // Clean cases: must produce NO violations.
  it("clean: পাঠ 10 knows only অ/আ", () => {
    expect(auditText("আ অ আ", 10, INV)).toEqual([]);
  });

  it("clean: পাঠ 26 — বাবা মা (all letters + আ-কার taught by then)", () => {
    expect(auditText("বাবা মা", 26, INV)).toEqual([]);
  });

  it("clean: an oral block is EXEMPT even with untaught letters", () => {
    // শুনি-ও-বলি is teacher-read, never decoded by the child (README §4.2).
    expect(auditBlock({ oral: true, source: "school", text_bn: "ক্ষমা করো" }, 10, INV)).toEqual([]);
  });

  it("clean: an NCTB-source block is EXEMPT — auditing it would red-fail the textbook", () => {
    expect(auditBlock({ source: "nctb", text_bn: "যেকোনো কিছু" }, 5, INV)).toEqual([]);
  });

  // Seeded errors: must be CAUGHT.
  it("seeded: বর্ণ used before it is taught (ক at পাঠ 15; ক arrives at 19)", () => {
    const v = auditText("ক আ", 15, INV);
    expect(v.map((x) => x.type)).toContain("borno_not_taught");
    expect(v.find((x) => x.type === "borno_not_taught")?.unit).toBe("ক");
  });

  it("seeded: কারচিহ্ন used before it is taught (এ-কার at পাঠ 24; arrives at 29)", () => {
    const v = auditText("কে", 24, INV);
    expect(v.map((x) => x.type)).toContain("kar_not_taught");
    expect(v.find((x) => x.type === "kar_not_taught")?.unit).toBe("ে");
  });

  it("seeded: a conjunct where the whitelist is empty (ভক্ত at পাঠ 30)", () => {
    const v = auditText("ভক্ত", 30, INV);
    expect(v.map((x) => x.type)).toContain("conjunct_not_whitelisted");
  });

  it("seeded: glyphs:null + needs_review defaults to NONE, so a conjunct still fails (পাঠ 45)", () => {
    // The load-bearing one. Three পাঠ carry null because the TG flags যুক্তবর্ণ
    // outcomes without enumerating glyphs, and D-009/D-011 forbid inventing them.
    // "Unknown" must fail loudly, not permit anything.
    const v = auditText("ক্ত", 45, INV);
    expect(v.map((x) => x.type)).toContain("conjunct_not_whitelisted");
  });

  it("throws rather than silently passing when the inventory has no row for a পাঠ", () => {
    expect(() => auditText("আ", 99, INV)).toThrow(/no পাঠ 99/);
  });

  describe("nukta letters — the deliberate divergence from the Python (D-#428)", () => {
    // ড় ঢ় য় are single letters in the inventory but circulate DECOMPOSED as
    // base + nukta in real text, and Unicode's composition-exclusion list means NFC
    // never recomposes them. The reference audit flags the bare ় — 29 of 37 hits on
    // the real C1-BAN book. The port accepts a nukta only where its letter is taught.
    const NUKTA_INV: LetterInventory = {
      lessons: {
        // The real file stores these DECOMPOSED, which is why the fix cannot be
        // guarded on "did NFD change anything".
        "44": { cumulative_borno: [...V, ...C1, ...C2, ...C3, "য়".normalize("NFD")], cumulative_kar: ["া", "ে"], conjunct_whitelist: { glyphs: [] } },
        // Same পাঠ without য় taught — the same text must still fail.
        "20": { cumulative_borno: [...V, ...C1], cumulative_kar: ["া", "ে"], conjunct_whitelist: { glyphs: [] } },
      },
    };

    it("accepts a decomposed য় where the letter IS taught", () => {
      expect(auditText("যায়", 44, NUKTA_INV)).toEqual([]);
    });

    it("still FAILS a nukta whose letter is NOT taught — the fix is not a blanket allow", () => {
      const v = auditText("যায়", 20, NUKTA_INV);
      expect(v.length).toBeGreaterThan(0);
    });
  });
});

describe("B. book-level checks ported from the CLI", () => {
  const baseBook = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    schema_version: "1.3",
    book_id: "T1-BAN",
    class: 3,
    subject: "BAN",
    mode: "R",
    lessons: [
      {
        lesson_no: 1,
        action: "retain",
        nctb_pages: [1],
        bw_treatment: "native_safe",
        competency_codes: ["১.১"],
        outcome_codes: ["১.১.১"],
        blocks: [],
        image_slots: [],
      },
    ],
    ...over,
  });

  it("passes a minimal well-formed book", () => {
    const r = validateBook({ book: baseBook(), classLevel: 3, subject: "BAN" });
    expect(r.redCount).toBe(0);
    expect(r.passed).toBe(true);
  });

  it("C8: the script guard red-fails Arabic script (D-011 — transliterate or use Bangla)", () => {
    const book = baseBook();
    (book.lessons as Record<string, unknown>[])[0].blocks = [{ id: "b1", text_bn: "সাল্লাল্লাহু ﷺ" }];
    const r = validateBook({ book, classLevel: 3, subject: "BAN" });
    expect(r.findings.some((f) => f.check === "C8_SCRIPT_GUARD" && f.severity === "RED")).toBe(true);
  });

  it("C2: a Mode-C book may not carry action=replace", () => {
    const book = baseBook({ mode: "C" });
    (book.lessons as Record<string, unknown>[])[0].action = "replace";
    const r = validateBook({ book, classLevel: 3, subject: "BAN" });
    expect(r.findings.some((f) => f.check === "C2_INVENTORY_FLAGS" && /Mode-C/.test(f.message))).toBe(true);
  });

  it("C2: lessons out of NCTB order red-fail", () => {
    const book = baseBook();
    const l = (book.lessons as Record<string, unknown>[])[0];
    book.lessons = [{ ...l, lesson_no: 5 }, { ...l, lesson_no: 2 }];
    const r = validateBook({ book, classLevel: 3, subject: "BAN" });
    expect(r.findings.some((f) => f.check === "C2_INVENTORY_FLAGS" && /ascending/.test(f.message))).toBe(true);
  });

  it("C6: a tracing/vector slot must keep an empty prompt (never AI-generated)", () => {
    const book = baseBook();
    (book.lessons as Record<string, unknown>[])[0].image_slots = [
      { id: "s1", action: "vector_asset", prompt: "draw the letter ka" },
    ];
    const r = validateBook({ book, classLevel: 3, subject: "BAN" });
    expect(r.findings.some((f) => f.check === "C6_SLOT_BOOLEANS" && /empty prompt/.test(f.message))).toBe(true);
  });

  it("C11: an invalid bw_treatment red-fails", () => {
    const book = baseBook();
    (book.lessons as Record<string, unknown>[])[0].bw_treatment = "whatever";
    const r = validateBook({ book, classLevel: 3, subject: "BAN" });
    expect(r.findings.some((f) => f.check === "C11_BW_COMPLETE" && f.severity === "RED")).toBe(true);
  });

  it("C4 does not run outside Class 1–2 বাংলা, and says so rather than reporting a pass", () => {
    const r = validateBook({ book: baseBook(), classLevel: 3, subject: "BAN" });
    expect(r.skipped.some((s) => s.check === "C4_LETTER_AUDIT")).toBe(true);
  });

  it("C4: a C1 বাংলা book with NO inventory red-fails instead of merging unaudited", () => {
    const book = baseBook({ class: 1 });
    const r = validateBook({ book, classLevel: 1, subject: "BAN", letterInventory: null });
    expect(r.findings.some((f) => f.check === "C4_LETTER_AUDIT" && /inventory missing/.test(f.message))).toBe(true);
    expect(r.passed).toBe(false);
  });
});

describe("C. C9 stripe language — qualified matching (real-book regression)", () => {
  const withPrompt = (prompt: string): Record<string, unknown> => ({
    schema_version: "1.3", book_id: "T1-BAN", class: 3, subject: "BAN", mode: "R",
    lessons: [{
      lesson_no: 1, action: "retain", nctb_pages: [1], bw_treatment: "native_safe",
      competency_codes: ["১.১"], outcome_codes: ["১.১.১"], blocks: [],
      image_slots: [{ id: "s1", contains_living_being: false, filename: "x.png", status: "approved", prompt }],
    }],
  });
  const c9 = (prompt: string): boolean =>
    validateBook({ book: withPrompt(prompt), classLevel: 3, subject: "BAN" })
      .findings.some((f) => f.check === "C9_NO_STRIPE_LANGUAGE");

  // These three are verbatim shapes from the real C1-BAN book that a bare
  // "strip" substring match flagged. Legitimate art direction must stay clean.
  it("does NOT flag a striped tiger", () => {
    expect(c9("a large striped tiger emerging from bushes into the field")).toBe(false);
  });
  it("does NOT flag a strip of tablets", () => {
    expect(c9("a medicine bottle and a strip of tablets, arranged together")).toBe(false);
  });
  it("does NOT flag a strip of grass", () => {
    expect(c9("a bare leafless tree and a strip of grass, on a light sky background")).toBe(false);
  });

  // The real thing must still be caught.
  it("flags an instruction to draw a white stripe", () => {
    expect(c9("boy standing, with a white stripe down the middle")).toBe(true);
  });
  it("flags a white vertical bar", () => {
    expect(c9("scene with a white vertical bar over the figure")).toBe(true);
  });
  it("flags Bangla stripe language", () => {
    expect(c9("ছবির মাঝখানে সাদা ফিতা থাকবে")).toBe(true);
  });
});
