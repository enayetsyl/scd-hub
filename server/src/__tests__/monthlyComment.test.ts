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
  correctivePrompt,
  generateGuardianComment,
  MonthlyCommentError,
  looksLikeProse,
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
        coverage: { settled: 35, total: 38, pct: 92 },
        bySubject: [
          { subject: "MATH", qualityRate: 75 },
          { subject: "BANGLA", qualityRate: 67 },
          { subject: "ENGLISH", qualityRate: 50 },
        ],
      },
      assignment: { submitted: 4, expectedWhilePresent: 5, submissionRate: 80, coverage: { pct: 67 } },
      classTest: { attended: 12, testsHeld: 14, rate: 79, coverage: { pct: 86 } },
      hifz: { present: 3, sessions: 4 },
      concerns: { concern: 3 },
      ...(over.extra ? { leaked: over.extra } : {}),
    },
    cohort: { attendanceRate: { avg: 88 } },
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
    expect(allowed.has("88")).toBe(true); // the class average, from the cohort
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
