/**
 * MR-4 — the AI comment seam (docs/prd-monthly-report.md §7.4, D-#399).
 *
 * Two guards carry this slice, and both are tested against the behaviour a real
 * failure would show:
 *   - the prompt is DE-IDENTIFIED, enforced by a whitelist plus an assertion, so a
 *     field added to the snapshot later cannot leak by default;
 *   - the model may NOT author a number — a draft that invents one is rejected and
 *     regenerated, and two failures fall back to the template rather than blocking.
 */
import {
  allowedNumbers,
  asciiDigits,
  assertDeidentified,
  buildPrompt,
  commentFactsOf,
  commentRules,
  correctivePrompt,
  generateGuardianComment,
  MonthlyCommentError,
  looksLikeProse,
  monthLabelBn,
  splitSubjects,
  promptHashOf,
  validateNumerals,
  type CommentFacts,
  type CommentProvider,
} from "../modules/reports/services/MonthlyCommentService";
import type { MonthlySnapshot } from "../modules/reports/services/MonthlyReportService";
import { DEFAULT_MONTHLY_REPORT_CONFIG } from "../modules/reports/services/MonthlyReportConfigService";

jest.mock("../modules/templates/services/MessageTemplateService", () => ({
  renderTemplate: jest.fn(async (_key: string, p: Record<string, unknown>) =>
    `${p.month} মাসে উপস্থিতি ছিল ${p.attendanceRate}% এবং বাড়ির কাজ জমার হার ${p.homeworkRate}%।`),
}));

const snapshot = (over: Partial<{ name: string; extra: unknown }> = {}): MonthlySnapshot =>
  ({
    metrics: {
      periodKey: "2026-07",
      attendance: { present: 18, schoolDays: 22, rate: 82, absentUncovered: 2, absentStreakMax: 3 },
      homework: {
        submitted: 27, expectedWhilePresent: 32, submissionRate: 84, qualityRate: 63,
        checked: 27, correct: 17, partial: 3, wrong: 7,
        coverage: { settled: 35, total: 38, pct: 92 },
        bySubject: [
          { subject: "MATH", submitted: 10, expectedWhilePresent: 10, checked: 8, correct: 6, partial: 0, wrong: 2, qualityRate: 75 },
          { subject: "BANGLA", submitted: 9, expectedWhilePresent: 11, checked: 9, correct: 6, partial: 0, wrong: 3, qualityRate: 67 },
          // The PARTIAL showcase: half the checked English work was partial credit, not
          // wrong outright — a bare "৫০%" cannot say that, which is the bug this fixture
          // exists to catch (see the "partial credit is not wrong" test below).
          { subject: "ENGLISH", submitted: 8, expectedWhilePresent: 11, checked: 8, correct: 4, partial: 2, wrong: 2, qualityRate: 50 },
        ],
      },
      assignment: {
        submitted: 4, expectedWhilePresent: 5, submissionRate: 80, coverage: { pct: 67 },
        checked: 4, correct: 3, partial: 0, wrong: 1,
        bySubject: [
          { subject: "MATH", submitted: 2, expectedWhilePresent: 2, checked: 2, correct: 2, partial: 0, wrong: 0, qualityRate: 100 },
          { subject: "BANGLA", submitted: 1, expectedWhilePresent: 1, checked: 1, correct: 1, partial: 0, wrong: 0, qualityRate: 100 },
          // The genuine-failure counterpart: no partial credit here at all — a flat
          // wrong, which the model should still be able to state plainly.
          { subject: "ENGLISH", submitted: 1, expectedWhilePresent: 2, checked: 1, correct: 0, partial: 0, wrong: 1, qualityRate: 0 },
        ],
      },
      classTest: { attended: 12, testsHeld: 14, rate: 79, coverage: { pct: 86 } },
      hifz: { present: 3, sessions: 4 },
      concerns: { concern: 3 },
      ...(over.extra ? { leaked: over.extra } : {}),
    },
    cohort: { attendanceRate: { avg: 88, best: 96 } },
    trends: {
      attendance: { state: "DOWN" },
      homeworkSubmission: { state: "STEADY" },
      assignmentSubmission: { state: "STEADY" },
      classTest: { state: "UP" },
      concerns: { state: "DOWN" },
    },
    flags: [{ flag: "ABSENT_STREAK", value: 3, threshold: 3 }],
    config: DEFAULT_MONTHLY_REPORT_CONFIG,
  }) as unknown as MonthlySnapshot;

const facts = (): CommentFacts => commentFactsOf(snapshot(), 4);

describe("MR-4 D-#399 — the prompt carries no identity", () => {
  test("the facts are a WHITELIST: a field added to the snapshot later cannot leak", () => {
    const f = commentFactsOf(snapshot({ extra: { studentName: "মারুফ হাসান", phone: "01712345678" } }), 4);
    const json = JSON.stringify(f);
    expect(json).not.toContain("মারুফ");
    expect(json).not.toContain("01712345678");
    expect(json).not.toContain("leaked");
  });

  test("no name, id or phone survives into the prompt, but the numbers do", () => {
    const prompt = buildPrompt(facts());
    expect(prompt).not.toMatch(/\d{6,}/); // no phone/id-shaped run of digits
    expect(prompt).toContain("82");
    expect(prompt).toContain("MATH");
  });

  test("the assertion REFUSES a facts object carrying a human string", () => {
    const bad = { ...facts(), strongestSubjects: ["মারুফ হাসান"] };
    expect(() => assertDeidentified(bad)).toThrow(MonthlyCommentError);
  });

  test("subject codes, enum states and the period key are allowed through", () => {
    expect(() => assertDeidentified(facts())).not.toThrow();
  });

  test("the prompt hash is stable for the same facts and moves when they change", () => {
    const a = promptHashOf(buildPrompt(facts()));
    expect(promptHashOf(buildPrompt(facts()))).toBe(a);
    expect(promptHashOf(buildPrompt({ ...facts(), periodKey: "2026-06" }))).not.toBe(a);
  });
});

describe("MR-4 D-#399 — the model may not author a number", () => {
  test("restating the given numbers passes, in either script", () => {
    expect(validateNumerals("উপস্থিতি ৮২%, জমা ২৭টি।", facts()).ok).toBe(true);
    expect(validateNumerals("Attendance 82%, submitted 27.", facts()).ok).toBe(true);
  });

  test("an INVENTED number is caught and named", () => {
    const v = validateNumerals("আপনার সন্তান ১৫টি বাড়ির কাজ জমা দেয়নি।", facts());
    expect(v.ok).toBe(false);
    expect(v.invented).toContain("15");
  });

  test("a rounded percentage is fair game", () => {
    const f = { ...facts(), attendance: { ...facts().attendance, ratePct: 82.4 } };
    expect(validateNumerals("উপস্থিতি ৮২%", f).ok).toBe(true);
  });

  test("prose with no numbers at all is fine", () => {
    expect(validateNumerals("আপনার সন্তান নিয়মিত হলে আরও ভালো করবে।", facts()).ok).toBe(true);
  });

  test("Bangla numerals normalise to ASCII before the check", () => {
    expect(asciiDigits("৮২% ও ২৭টি")).toBe("82% ও 27টি");
  });

  test("every number in the facts is admitted, including nested ones", () => {
    const allowed = allowedNumbers(facts());
    expect(allowed.has("18")).toBe(true); // present days
    expect(allowed.has("22")).toBe(true); // school days
    expect(allowed.has("96")).toBe(true); // the class BEST, from the cohort
    expect(allowed.has("88")).toBe(false); // the average is no longer surfaced at all
    expect(allowed.has("999")).toBe(false);
  });
});

describe("MR-4 D-#399 — it never blocks", () => {
  const ok: CommentProvider = { model: "gemini-test", generate: async () => "সম্মানিত অভিভাবক, এ মাসে আপনার সন্তানের উপস্থিতি ছিল ৮২%। নিয়মিত উপস্থিতি নিশ্চিত করুন।" };

  test("a clean draft is returned with its model and prompt version stamped", async () => {
    const c = await generateGuardianComment(facts(), ok);
    expect(c).toMatchObject({ fallback: false, model: "gemini-test", fallbackReason: null });
    expect(c.promptHash).toHaveLength(16);
  });

  test("a hallucinated draft is RETRIED, and a good second attempt is accepted", async () => {
    let call = 0;
    const flaky: CommentProvider = {
      model: "gemini-test",
      generate: async () => (++call === 1 ? "১৫টি জমা পড়েনি।" : "সম্মানিত অভিভাবক, এ মাসে উপস্থিতি ছিল ৮২% — নিয়মিত পাঠানোর অনুরোধ করছি।"),
    };
    const c = await generateGuardianComment(facts(), flaky);
    expect(call).toBe(2);
    expect(c.fallback).toBe(false);
  });

  test("two hallucinations fall back to the template, and say why", async () => {
    const bad: CommentProvider = { model: "gemini-test", generate: async () => "১৫টি জমা পড়েনি।" };
    const c = await generateGuardianComment(facts(), bad);
    expect(c.fallback).toBe(true);
    expect(c.model).toBe("template");
    expect(c.fallbackReason).toMatch(/invented numbers/);
    expect(c.text).toContain("82");
  });

  test("an API failure falls back rather than throwing — a month is still reportable", async () => {
    const dead: CommentProvider = {
      model: "gemini-test",
      generate: async () => {
        throw new Error("Gemini returned 503");
      },
    };
    const c = await generateGuardianComment(facts(), dead);
    expect(c.fallback).toBe(true);
    expect(c.fallbackReason).toBe("Gemini returned 503");
  });

  test("no provider configured is a fallback, not an error — the key can arrive later", async () => {
    const c = await generateGuardianComment(facts(), null);
    expect(c).toMatchObject({ fallback: true, fallbackReason: "No AI provider configured" });
  });

  test("a leaking facts object never reaches the provider AT ALL", async () => {
    const spy = jest.fn(async () => "সম্মানিত অভিভাবক, সবকিছু ঠিক আছে বলে মনে হচ্ছে এই মাসে।");
    const provider: CommentProvider = { model: "gemini-test", generate: spy };
    await expect(
      generateGuardianComment({ ...facts(), flags: ["মারুফ হাসান"] }, provider),
    ).rejects.toThrow(MonthlyCommentError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("MR-4 — a truncated or debris draft never becomes a comment", () => {
  test("real prod debris is rejected: the tail of the model's own reasoning", () => {
    // What the console actually showed on the first live run.
    const v = looksLikeProse("4, `expected`: 8, `ratePct`: 50");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/JSON fragments|too short/);
  });

  test("a sentence cut off mid-flow is rejected", () => {
    const v = looksLikeProse("সম্মানিত অভিভাবক, এই মাসের অগ্রগতি প্রতিবেদনে দেখা যাচ্ছে আপনার");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/mid-sentence/);
  });

  test("a finished Bangla paragraph passes", () => {
    const v = looksLikeProse(
      "সম্মানিত অভিভাবক, এ মাসে মোট ২২ কর্মদিবসের মধ্যে আপনার সন্তান ১৫ দিন উপস্থিত ছিল। নিয়মিত উপস্থিতি নিশ্চিত করুন।",
    );
    expect(v).toEqual({ ok: true, reason: null });
  });

  test("the numeral guard alone would have PASSED the debris — hence the shape check", () => {
    const f = facts();
    // 4, 8 and 50 are all genuine figures, so the numeral guard sees nothing wrong.
    expect(validateNumerals("4, `expected`: 8, `ratePct`: 50", { ...f, homework: { ...f.homework, submittedOf: 4, expected: 8, ratePct: 50 } }).ok).toBe(true);
  });

  test("a cut-off draft falls back rather than being stored", async () => {
    const truncating: CommentProvider = {
      model: "gemini-test",
      generate: async () => "সম্মানিত অভিভাবক, এই মাসের অগ্রগতি প্রতিবেদনে দেখা যাচ্ছে আপনার",
    };
    const c = await generateGuardianComment(facts(), truncating);
    expect(c.fallback).toBe(true);
    expect(c.fallbackReason).toMatch(/mid-sentence/);
  });
});

describe("MR-4 — a rejection has to be correctable", () => {
  test("counting what it was given is NOT invention: 3 subjects is 3", () => {
    // The live failure: the guard rejected "3" while three subject codes were supplied.
    const f = facts();
    expect(f.strongestSubjects.length + f.weakestSubjects.length).toBeGreaterThan(0);
    expect(allowedNumbers(f).has(String(f.weakestSubjects.length))).toBe(true);
  });

  test("the retry NAMES the offending numbers instead of repeating itself", () => {
    const p = correctivePrompt("BASE", ["3", "15"], null);
    expect(p).toContain("BASE");
    expect(p).toContain("3, 15");
  });

  test("a shape rejection asks for a finished paragraph", () => {
    expect(correctivePrompt("BASE", [], "the draft ends mid-sentence")).toMatch(/দাঁড়ি/);
  });

  test("the SECOND attempt gets a corrected prompt, not the same one", async () => {
    const asks: string[] = [];
    const provider: CommentProvider = {
      model: "gemini-test",
      generate: async (prompt: string) => {
        asks.push(prompt);
        return asks.length === 1
          ? "আপনার সন্তান ১৫টি কাজ জমা দেয়নি বলে মনে হচ্ছে এই মাসে।"
          : "সম্মানিত অভিভাবক, এ মাসে উপস্থিতি ছিল ৮২% — নিয়মিত পাঠানোর অনুরোধ করছি।";
      },
    };
    const c = await generateGuardianComment(facts(), provider);
    expect(asks).toHaveLength(2);
    expect(asks[0]).not.toContain("গ্রহণ করা হয়নি");
    expect(asks[1]).toContain("গ্রহণ করা হয়নি");
    expect(asks[1]).toContain("15");
    expect(c.fallback).toBe(false);
  });

  test("three refusals still fall back — the report is never blocked", async () => {
    const stubborn: CommentProvider = {
      model: "gemini-test",
      generate: async () => "আপনার সন্তান ১৫টি কাজ জমা দেয়নি বলে মনে হচ্ছে এই মাসে।",
    };
    const c = await generateGuardianComment(facts(), stubborn);
    expect(c.fallback).toBe(true);
    expect(c.fallbackReason).toMatch(/invented numbers/);
  });
});

describe("MR-4 — a subject is never both a strength and a weakness", () => {
  test("THE LIVE BUG: three subjects no longer overlap", () => {
    // BAN=100, MATH=66.7, ENG=0 produced strongest [BAN, MATH] and weakest [ENG, MATH]
    // — the model was told MATH was both, and wrote exactly that to a family.
    const s = splitSubjects(["BAN", "MATH", "ENG"]);
    expect(s.strongest).toEqual(["BAN"]);
    expect(s.weakest).toEqual(["ENG"]);
    expect(s.strongest.filter((x) => s.weakest.includes(x))).toEqual([]);
  });

  test("four or more subjects name two of each, still disjoint", () => {
    const s = splitSubjects(["A", "B", "C", "D", "E"]);
    expect(s.strongest).toEqual(["A", "B"]);
    expect(s.weakest).toEqual(["E", "D"]);
    expect(s.strongest.filter((x) => s.weakest.includes(x))).toEqual([]);
  });

  test("two subjects: one each", () => {
    expect(splitSubjects(["A", "B"])).toEqual({ strongest: ["A"], weakest: ["B"] });
  });

  test("one subject is a strength with no weakness invented beside it", () => {
    expect(splitSubjects(["A"])).toEqual({ strongest: ["A"], weakest: [] });
  });

  test("no subjects at all is empty, not a crash", () => {
    expect(splitSubjects([])).toEqual({ strongest: [], weakest: [] });
  });

  test("the facts built from a real three-subject month are disjoint", () => {
    const f = facts();
    expect(f.strongestSubjects.filter((x) => f.weakestSubjects.includes(x))).toEqual([]);
  });
});

describe("MR-4 — the report names its month", () => {
  test("the period key becomes a Bangla month", () => {
    expect(monthLabelBn("2026-07")).toBe("জুলাই ২০২৬");
    expect(monthLabelBn("2026-01")).toBe("জানুয়ারি ২০২৬");
    expect(monthLabelBn("2025-12")).toBe("ডিসেম্বর ২০২৫");
  });

  test("the prompt asks for the month by name and forbids 'last month'", () => {
    const p = buildPrompt(facts());
    expect(p).toContain("জুলাই ২০২৬");
    expect(p).toContain("বিগত মাস");
  });

  test("the month name stays OUT of the facts — they are codes only", () => {
    const f = facts();
    expect(JSON.stringify(f)).not.toContain("জুলাই");
    expect(() => assertDeidentified(f)).not.toThrow();
  });
});

describe("MR-4 mr4-2/mr4-3 (2026-08-05) — full per-area coverage + the quality breakdown", () => {
  test("the uncovered-absence count reaches the model — previously only the flag NAME did", () => {
    const f = facts();
    expect(f.attendance.absentUncovered).toBe(2);
    expect(allowedNumbers(f).has("2")).toBe(true);
  });

  test("per-subject submitted/expected/quality reach the model for BOTH trackers", () => {
    const f = facts();
    expect(f.homework.bySubject).toEqual([
      { subject: "MATH", submittedOf: 10, expected: 10, checked: 8, correct: 6, partial: 0, wrong: 2, qualityPct: 75 },
      { subject: "BANGLA", submittedOf: 9, expected: 11, checked: 9, correct: 6, partial: 0, wrong: 3, qualityPct: 67 },
      { subject: "ENGLISH", submittedOf: 8, expected: 11, checked: 8, correct: 4, partial: 2, wrong: 2, qualityPct: 50 },
    ]);
    expect(f.assignment.bySubject).toEqual([
      { subject: "MATH", submittedOf: 2, expected: 2, checked: 2, correct: 2, partial: 0, wrong: 0, qualityPct: 100 },
      { subject: "BANGLA", submittedOf: 1, expected: 1, checked: 1, correct: 1, partial: 0, wrong: 0, qualityPct: 100 },
      { subject: "ENGLISH", submittedOf: 1, expected: 2, checked: 1, correct: 0, partial: 0, wrong: 1, qualityPct: 0 },
    ]);
  });

  test("partial credit is NOT reported as wrong — the bug a live draft actually hit", () => {
    // qualityPct alone is correct/(correct+partial+wrong): English homework's ৫০% here
    // came from 4 correct + 2 PARTIAL + 2 wrong, not 4 correct + 4 wrong. A comment that
    // only sees the blended % cannot tell those apart; the facts must carry the split.
    const f = facts();
    const eng = f.homework.bySubject.find((s) => s.subject === "ENGLISH");
    expect(eng).toMatchObject({ checked: 8, correct: 4, partial: 2, wrong: 2 });
    expect(allowedNumbers(f).has("2")).toBe(true); // the partial count itself is citable
  });

  test("a subject nothing has been checked in yet still appears — unfiltered, unlike the ranking", () => {
    // The strength/weakness ranking drops a null-quality subject (nothing checked); the
    // full per-subject listing must NOT, or a family never hears their child submitted.
    const s = snapshot();
    (s.metrics as unknown as { homework: { bySubject: unknown[] } }).homework.bySubject.push({
      subject: "SCIENCE", submitted: 5, expectedWhilePresent: 5, qualityRate: null,
    });
    const f = commentFactsOf(s, 4);
    expect(f.homework.bySubject).toContainEqual({ subject: "SCIENCE", submittedOf: 5, expected: 5, qualityPct: null });
    expect(f.strongestSubjects).not.toContain("SCIENCE");
    expect(f.weakestSubjects).not.toContain("SCIENCE");
  });

  test("the rules ask for every area to be touched, not a sentence cap", () => {
    const rules = commentRules("2026-07");
    expect(rules).toContain("উপস্থিতি");
    expect(rules).toContain("বাড়ির কাজ");
    expect(rules).toContain("অ্যাসাইনমেন্ট");
    expect(rules).toContain("ক্লাস টেস্ট");
    expect(rules).not.toContain("২–৪ বাক্য");
  });

  test("the rules say 'অভিযোগ', not 'উদ্বেগ' — owner wording, 2026-08-05", () => {
    const rules = commentRules("2026-07");
    expect(rules).toContain("অভিযোগ");
    expect(rules).toMatch(/'উদ্বেগ'|"উদ্বেগ"/); // named ONLY as the word to avoid
    expect(rules).not.toMatch(/লিখবে[^।]*উদ্বেগ/); // never instructed to WRITE it
  });

  test("hifz is NOT in the facts at all — closed-list belt-and-suspenders", () => {
    // rule 2 names five areas; hifz was never one of them, yet a live draft mentioned
    // it anyway because the field was sitting right there in the JSON. Removing the
    // field is the hard guarantee — an instruction alone is not.
    const f = facts();
    expect(JSON.stringify(f)).not.toContain("hifz");
    expect((f as unknown as Record<string, unknown>).hifz).toBeUndefined();
  });

  test("the rules close the area list and forbid mixed-script numerals", () => {
    const rules = commentRules("2026-07");
    expect(rules).toMatch(/এই পাঁচটি ছাড়া/); // closes the list explicitly
    expect(rules).toContain("এর মধ্যে"); // the X-এর মধ্যে Y phrasing rule
    expect(rules).toContain("বাংলা অঙ্কে"); // Bengali numerals only
    expect(rules).toMatch(/correct.*partial.*wrong|partial.*(সম্পূর্ণ ভুল)/); // the quality-breakdown rule
    expect(rules).toMatch(/পূর্ণ সংখ্যায় রাউন্ড/); // percentages must be rounded
  });

  test("classBestPct replaces classAvgPct — the section's HIGHEST rate, not its mean", () => {
    const f = facts();
    expect(f.attendance).not.toHaveProperty("classAvgPct");
    expect(f.attendance.classBestPct).toBe(96); // fixture: avg 88, best 96
    expect(allowedNumbers(f).has("96")).toBe(true);
  });

  test("classBestPct is null, not the withheld avg, when the section is too small to hide who's best", () => {
    // D-#396: cohortOf() sets best:null (bestWithheld) below minSectionSizeForClassBest —
    // the rules must never ask the model to cite a number that isn't there.
    const s = {
      ...snapshot(),
      cohort: { attendanceRate: { avg: 88, best: null } },
    } as unknown as MonthlySnapshot;
    const f = commentFactsOf(s, 4);
    expect(f.attendance.classBestPct).toBeNull();
  });

  test("the rules ask for the class BEST, and tell the model to skip it when null", () => {
    const rules = commentRules("2026-07");
    expect(rules).toContain("classBestPct");
    expect(rules).not.toContain("classAvgPct");
    expect(rules).toMatch(/classBestPct.*null|null.*classBestPct/);
  });

  test("the rules pin the uncovered-absence wording — not the vague 'কভার তথ্য নেই' a live draft used", () => {
    const rules = commentRules("2026-07");
    // The fixed phrasing is the one to WRITE; the vague one is named only as what to avoid.
    expect(rules).toContain("ছুটির দরখাস্ত জমা দেওয়া হয়নি");
    expect(rules).toMatch(/কভার তথ্য নেই.{0,80}লিখবে না/);
  });

  test("the rules skip the leave-application sentence entirely at 100% attendance", () => {
    // Found live: "২১-এর মধ্যে ২১ দিন উপস্থিত (১০০%); ছুটির দরখাস্ত জমা না দেওয়া কোনো
    // অনুপস্থিতি নেই" states a true but VACUOUS fact — there were no absences AT ALL,
    // so a sentence about which ones lacked a leave form has nothing to refer to.
    // Contrast: SOME absences, all covered, is genuinely reassuring, not vacuous —
    // the rule only skips the sentence at 100%, not whenever absentUncovered is 0.
    const rules = commentRules("2026-07");
    expect(rules).toMatch(/১০০%.{0,80}কিছু লিখবে না/);
    expect(rules).toContain("আশ্বস্তকর"); // still says WHY partial coverage is worth stating
  });

  test("a decimal percentage in the DRAFT breaks the guard — found live, why rule 11 rounds", () => {
    // validateNumerals splits digit runs on '.', so "৯২.৬%" is checked as TWO separate
    // tokens ("92" and "6") and the bare "6" was never individually whitelisted — only
    // the rounded/truncated forms of 92.6 were. This bit a real draft during
    // verification, not a hypothetical: the fix is the rule (round, matching how
    // pct() already renders everywhere else in this app), not a guard change.
    const f = facts();
    expect(validateNumerals("বাড়ির কাজে ৯২.৬% জমা হয়েছে।", f).ok).toBe(false);
    expect(validateNumerals("বাড়ির কাজে ৮৪% জমা হয়েছে।", f).ok).toBe(true); // rounded homework.ratePct
  });

  test("a full per-area summary, built only from these facts, passes both guards", () => {
    // Not hand-waved: every numeral below is checked against the SAME facts object a
    // real draft would be validated against, using the real guard functions. Follows
    // ALL the new rules: Bengali digits only, "X-এর মধ্যে Y" throughout, the English
    // partial/wrong split named rather than blended into one alarming %, no hifz.
    const f = facts();
    const comment = [
      "জুলাই ২০২৬-এ আপনার সন্তান ২২ দিনের মধ্যে ১৮ দিন উপস্থিত ছিল (৮২%), শ্রেণির সর্বোচ্চ ৯৬%-এর নিচে,",
      "এবং ২ দিন ছুটি ছাড়া অনুপস্থিত ছিল। বাড়ির কাজে ৩২টির মধ্যে ২৭টি জমা হয়েছে; গণিতে ১০-এর মধ্যে ১০টি ও",
      "বাংলায় ১১-এর মধ্যে ৯টি ভালো মানের হলেও, ইংরেজিতে ৮টি যাচাই হওয়া কাজের মধ্যে ৪টি সম্পূর্ণ সঠিক ও ২টি",
      "আংশিক সঠিক হয়েছে, বাকি ২টি ভুল। অ্যাসাইনমেন্টে ৫-এর মধ্যে ৪টি জমা হয়েছে; বাংলা ও গণিত পুরোপুরি সঠিক",
      "হলেও ইংরেজির ১টি অ্যাসাইনমেন্ট যাচাইয়ে ভুল হয়েছে। ক্লাস টেস্টে ১৪-এর মধ্যে ১২টিতে অংশ নিয়েছে (৭৯%)।",
      "এই মাসে ৩টি অভিযোগ লেখা হয়েছে। বাড়িতে ইংরেজি পাঠগুলো নিয়মিত অনুশীলন করালে উপকার হতে পারে।",
    ].join(" ");
    expect(comment).not.toMatch(/[0-9]/); // no Latin digits anywhere
    expect(looksLikeProse(comment)).toEqual({ ok: true, reason: null });
    expect(validateNumerals(comment, f)).toEqual({ ok: true, invented: [] });
  });
});
