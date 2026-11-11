/**
 * AI round 3 (owner test 2026-11-11) — DB-free. Every comment here is invented.
 *   • a tone note picks a REAL tone other than the one picked; its text is ours (never
 *     "sentiment" or a tone that does not exist); none on a class test; one at most
 *   • "tone" on quoted words is relabelled "standard"; a whole-field rewrite is "structure"
 *   • the instructions keep the teacher's facts / requests, use উনি (not তিনি), give advice
 *     instead of advice blanks, keep English words, and do not demand a weakness at a high mark
 *   • finishCheck carries the tone pick through to the result
 */
import { CHECKER_INSTRUCTIONS, cleanIssues, finishCheck, type PreparedCheck } from "../modules/platform/services/CommentCheckService";

const text = { text: "আজ ক্লাসে মনোযোগ দিয়েছে।" };

describe("tone notes (round 3)", () => {
  test("a note picking the other real tone is kept, with our own words", () => {
    const out = cleanIssues([{ field: "text", type: "tone", quote: "", pick: "positive", suggestion: "sentiment হিসেবে 'প্রশংসা' বেছে নিন" }], text, {}, { kind: "DAILY", sentiment: "CONCERN" });
    expect(out).toHaveLength(1);
    expect(out[0].pick).toBe("POSITIVE");
    expect(out[0].suggestion).toContain("ইতিবাচক");
    expect(out[0].suggestion).not.toMatch(/sentiment|প্রশংসা/);
  });

  test("a tone that does not exist, the same tone, or no pick is dropped", () => {
    const issues = [
      { field: "text", type: "tone", quote: "", pick: "PRAISE", suggestion: "x" },
      { field: "text", type: "tone", quote: "", pick: "CONCERN", suggestion: "x" },
      { field: "text", type: "tone", quote: "", suggestion: "'সাধারণ' বেছে নিন" },
    ];
    expect(cleanIssues(issues, text, {}, { kind: "DAILY", sentiment: "CONCERN" })).toEqual([]);
  });

  test("only one tone note, and none on a class test", () => {
    const two = [
      { field: "text", type: "tone", quote: "", pick: "POSITIVE", suggestion: "" },
      { field: "text", type: "tone", quote: "", pick: "POSITIVE", suggestion: "" },
    ];
    expect(cleanIssues(two, text, {}, { kind: "DAILY", sentiment: "CONCERN" })).toHaveLength(1);
    expect(cleanIssues([{ field: "weakness", type: "tone", quote: "", pick: "POSITIVE", suggestion: "" }], { weakness: "ভালো" }, {}, { kind: "CT" })).toEqual([]);
  });
});

describe("issue labels (round 3)", () => {
  test("tone on quoted words becomes standard", () => {
    const t = { weakness: "Tense অংশে ভুল করেছে, আর [S1]-এর খাতা দেখে লেখার চেষ্টা করেছে।" };
    const out = cleanIssues([{ field: "weakness", type: "tone", quote: "Tense অংশে ভুল করেছে", suggestion: "Tense অংশে [কয়টি] ভুল হয়েছে" }], t, {}, { kind: "CT" });
    expect(out[0].type).toBe("standard");
  });

  test("a whole-field rewrite that adds words is structure", () => {
    const t = { text: "আজকে সে ক্লাশে খুব দুষ্টামি করছে" };
    const out = cleanIssues(
      [{ field: "text", type: "honorific", quote: "আজকে সে ক্লাশে খুব দুষ্টামি করছে", suggestion: "আসসালামু আলাইকুম। আজ উনি ক্লাসে খুব দুষ্টামি করেছেন। জাযাকুমুল্লাহু খাইরান।" }],
      t,
      {},
      { kind: "DAILY", sentiment: "CONCERN" },
    );
    expect(out[0].type).toBe("structure");
  });

  test("a small fix on the whole of a short field keeps its own label", () => {
    const t = { text: "পড়া পারেনাই" };
    const out = cleanIssues([{ field: "text", type: "spelling", quote: "পড়া পারেনাই", suggestion: "পড়া পারেনি" }], t, {}, { kind: "DAILY" });
    expect(out[0].type).toBe("spelling");
  });
});

describe("checker instructions (round 3)", () => {
  test.each([
    ["keeps the teacher's facts", "KEEP WHAT THE TEACHER WROTE"],
    ["no blank in place of a fact", "never \"[কী করেছেন]\""],
    ["requests stay requests", "stays a request to talk"],
    ["উনি, not তিনি", "never তিনি"],
    ["no invented setting", "who sat beside whom"],
    ["advice is proposed, not blanked", "never \"[কত মিনিট]\""],
    ["English words in Bangla letters stay", "রেজাল্ট"],
    ["tone notes pick a real tone", "\"pick\":\"CONCERN\" or \"POSITIVE\""],
    ["never say sentiment", "never mention \"sentiment\""],
    ["test size is unknown", "not told how many questions"],
    ["no weakness demanded at a high mark", "do not ask for a weakness"],
  ])("%s", (_name, phrase) => {
    expect(CHECKER_INSTRUCTIONS).toContain(phrase);
  });
});

test("finishCheck carries the tone pick to the result", () => {
  const p: PreparedCheck = {
    kind: "DAILY",
    studentId: "s1",
    fields: [{ field: "text", text: "আজ ক্লাসে মনোযোগ দিয়েছে।" }],
    deid: [{ field: "text", text: "আজ ক্লাসে মনোযোগ দিয়েছে।" }],
    map: {},
    seqs: { text: { PHONE: [], NUM: [], ID: [] } },
    policyHash: "h1",
    stablePrefix: "P",
    variablePart: "{}",
    sentiment: "CONCERN",
  };
  const r = finishCheck(p, { issues: [{ field: "text", type: "tone", quote: "", pick: "POSITIVE", suggestion: "sentiment" }], corrected: { text: "আজ ক্লাসে মনোযোগ দিয়েছে।" } }, "m");
  expect(r.issues).toHaveLength(1);
  expect(r.issues[0].pick).toBe("POSITIVE");
  expect(r.issues[0].suggestion).not.toContain("sentiment");
});
