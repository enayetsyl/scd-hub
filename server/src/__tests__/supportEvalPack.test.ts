/**
 * CSP-2 — the evaluation pack harness (docs/prd-child-support-profile.md §16.9; D-#1566). This tests the
 * HARNESS ONLY with canned answers: a perfect answer key passes, a weak one fails. The real pass marks
 * are the owner's switch-on gate and need a real chat/model — NOT claimed here.
 */
import { buildEvalPack, evalCtx, evalEntries, scoreEvaluation } from "../modules/support-profile/eval/supportEvaluation";
import { BIAS_FIXTURES, INVENTED_REPORTS, SAFEGUARDING_EVAL } from "../modules/support-profile/eval/supportEvalFixtures";
import { loadMethod } from "../modules/support-profile/services/methodDoc";

const ctx = evalCtx();
const fixtures = new Map([...BIAS_FIXTURES, ...INVENTED_REPORTS].map((f) => [f.id, f]));
const sg = new Map(SAFEGUARDING_EVAL.map((f) => [f.id, f]));

/** An answer that matches the key ("a perfect model"), or a weak one. */
function answer(weak: boolean): string {
  const reports = evalEntries().map((e) => {
    const f = fixtures.get(e.fixtureId);
    const flags = !f || weak ? [] : f.expect.map((cat, i) => ({ id: `f${i + 1}`, category: cat, severity: f.severity ?? "ASK", field: f.field, quote: (f.quote ?? f.bn).replace("{CLASSMATE}", "এক সহপাঠী").slice(0, 300), whyBn: "উদাহরণ নেই।", askBn: "ঠিক কী দেখেছেন?", suggestionBn: "" }))
      .filter((x) => e.texts[x.field].includes(x.quote));
    const s = sg.get(e.fixtureId);
    const present = !weak && ((!!s && !s.control) || e.fixtureId === "F-39");
    return {
      report: e.code,
      check: {
        verdict: flags.some((x) => x.severity === "BLOCK") ? "NEEDS_REWRITE" : "READY",
        flags,
        toneCheck: { teacherTone: "MIXED", textReads: "MIXED" },
        strategyCandidate: { present: false, titleBn: "", starterKey: null, punitive: false },
        safeguarding: { present, signs: present ? (s?.signs.length ? s.signs : ["NEGLECT"]) : [], confidence: present ? "HIGH" : "LOW", quote: "" },
      },
      compare: null,
    };
  });
  return JSON.stringify({ schema: "support-result/v1", batch: "B-0000", nonce: ctx.nonce, methodVersion: ctx.methodVersion, complete: true, reports, children: [],
    selfCheck: { reportsDone: reports.length, childrenDone: 0, everySentenceCited: true, noNamesOrCodesInSentences: true, noNewFacts: true, safeguardingMarked: true } });
}

it("the pack holds F-01 … F-39 and the 40 invented reports with the real method, and no answer key", () => {
  const pack = buildEvalPack();
  expect(evalEntries()).toHaveLength(29 + 40 + 9 + 3);
  expect(pack.content.includes(loadMethod().text)).toBe(true);
  const data = pack.content.slice(pack.content.indexOf("## P-3 DATA"), pack.content.indexOf("## P-4 OUTPUT FORMAT"));
  expect(data.length).toBeGreaterThan(1000);
  expect(data).not.toMatch(/"expect"|"category"|"severity"|F-[0-3]\d|V-\d\d/);
});

it("a perfect answer passes every automatic mark", () => {
  const { outcome, marks, autoPassed } = scoreEvaluation(answer(false));
  expect(outcome.fileError).toBeNull();
  expect(marks).toMatchObject({ blockFound: 1, askFound: 1, cleanWronglyFlagged: 0, safeguardingFound: 1, controlsQuiet: 1, seriousSoftened: 0, namesGuessed: 0, completeAndValid: true });
  expect(autoPassed).toBe(true);
});

it("a weak answer (no flags, no signs) fails, and an incomplete answer fails", () => {
  expect(scoreEvaluation(answer(true)).autoPassed).toBe(false);
  const cut = JSON.parse(answer(false));
  cut.reports = cut.reports.slice(1);
  expect(scoreEvaluation(JSON.stringify(cut)).marks.completeAndValid).toBe(false);
});
