/**
 * CSP-2 — the bias rubric through the validator (docs/prd-child-support-profile.md §16.3, NORMATIVE;
 * D-#1552). One fixture per category F-01 … F-20 + controls F-21 … F-26, canned results, pure.
 */
import { SUPPORT_CATEGORY_RULES, flagsForRound, scanSupportTerms, severityFor, type SupportCategory } from "@scd/shared";
import { validateSupportResult, type CtxReport, type ValidationCtx } from "../modules/support-profile/services/supportResultValidator";
import { BIAS_FIXTURES, type BiasFixture } from "../modules/support-profile/eval/supportEvalFixtures";

const FILL = { situation: "ক্লাসের কাজ চলছিল", tried: "পাশে গিয়ে আস্তে বলেছি", resultNote: "কিছুটা কাজ হয়েছে" };
function ctxFor(text: string, field: string): ValidationCtx {
  const texts: Record<string, string> = { situation: FILL.situation, settingNote: "", behaviour: "সে নিজের জায়গায় ছিল", tried: FILL.tried, resultNote: FILL.resultNote, exception: "", whatWorked: "", goodThing: "" };
  texts[field] = text;
  const rep: CtxReport = { code: "R-001", childCode: "C-001", isNew: true, status: "IN_BATCH", source: "TEACHER", authorCode: "T-01", occurredOn: "2000-01-01", slot: "P1", setting: "MATH", result: "PARTLY", tone: "CONCERN", goodThingCounts: false, gotOrAvoided: [], texts };
  return { batchCode: "B-0001", nonce: "N", methodVersion: "v1", open: true, todayKey: "2000-01-02", reports: new Map([["R-001", rep]]), children: new Set(["C-001"]), strategies: new Set(), items: new Set(), rosterNames: [] };
}
function answer(flags: object[], verdict = "READY", extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema: "support-result/v1", batch: "B-0001", nonce: "N", methodVersion: "v1", complete: true,
    reports: [{ report: "R-001", check: { verdict, flags, toneCheck: { teacherTone: "CONCERN", textReads: "CONCERN" }, strategyCandidate: { present: false, titleBn: "", starterKey: null, punitive: false }, safeguarding: { present: false, signs: [], confidence: "LOW", quote: "" }, ...extra }, compare: null }],
    children: [], selfCheck: { reportsDone: 1, childrenDone: 0, everySentenceCited: true, noNamesOrCodesInSentences: true, noNewFacts: true, safeguardingMarked: true },
  });
}
const flagOf = (f: BiasFixture, cat: SupportCategory, severity = f.severity) => ({ id: "f1", category: cat, severity, field: f.field, quote: f.quote, whyBn: "উদাহরণ নেই।", askBn: "ঠিক কী দেখেছেন?", suggestionBn: "" });
const byId = (id: string) => BIAS_FIXTURES.find((f) => f.id === id)!;
const text = (f: BiasFixture) => f.bn.replace("{CLASSMATE}", "[অন্য শিশু]");

describe("one fixture per category (F-01 … F-20)", () => {
  const fixtures = BIAS_FIXTURES.filter((f) => /^F-(0\d|1\d|20)$/.test(f.id));
  it("covers all 17 categories", () => {
    expect(new Set(fixtures.flatMap((f) => f.expect))).toEqual(new Set(Object.keys(SUPPORT_CATEGORY_RULES)));
  });

  it.each(fixtures.map((f) => [f.id, f] as const))("%s keeps its category and the rubric's severity; BLOCK sends the report back", (_id, f) => {
    const cat = f.expect[0];
    const out = validateSupportResult(answer([flagOf(f, cat)]), ctxFor(text(f), f.field));
    const r = out.reports[0];
    const flag = r.flags.find((x) => x.category === cat)!;
    expect(flag).toBeDefined();
    expect(flag.severity).toBe(severityFor(cat, f.field, cat === "LABEL" && f.severity === "ASK"));
    if (flag.severity === "BLOCK") expect(r.verdict).toBe("NEEDS_REWRITE");
    else expect(r.verdict).toBe("READY"); // ASK/NOTE never force a return by themselves
  });

  it("a model cannot lower a BLOCK: a DIAGNOSIS flagged as ASK comes back BLOCK", () => {
    const f = byId("F-03");
    const out = validateSupportResult(answer([flagOf(f, "DIAGNOSIS", "ASK")]), ctxFor(f.bn, f.field));
    expect(out.reports[0].flags.find((x) => x.category === "DIAGNOSIS")?.severity).toBe("BLOCK");
  });

  it("AGE_TYPICAL is a NOTE and needs no answer", () => {
    const f = byId("F-14");
    const out = validateSupportResult(answer([flagOf(f, "AGE_TYPICAL")]), ctxFor(f.bn, f.field));
    expect(out.reports[0].flags[0].severity).toBe("NOTE");
    expect(out.reports[0].verdict).toBe("READY");
  });

  it("punitive in `tried` → ASK (+ the Principal sees it); in `whatWorked` → BLOCK", () => {
    expect(validateSupportResult(answer([flagOf(byId("F-20"), "PUNITIVE", "BLOCK")]), ctxFor(byId("F-20").bn, "tried")).reports[0].flags[0].severity).toBe("ASK");
    const w = validateSupportResult(answer([flagOf(byId("F-19"), "PUNITIVE", "ASK")]), ctxFor(byId("F-19").bn, "whatWorked")).reports[0];
    expect(w.flags[0].severity).toBe("BLOCK");
    expect(w.verdict).toBe("NEEDS_REWRITE");
  });

  it("OTHER_CHILD: if a name slipped through (masked), the server raises the BLOCK even when the result misses it", () => {
    const out = validateSupportResult(answer([]), ctxFor(text(byId("F-17")), "behaviour"));
    expect(out.reports[0].flags.map((f) => [f.category, f.severity, f.byServer])).toEqual([["OTHER_CHILD", "BLOCK", true]]);
    expect(out.reports[0].verdict).toBe("NEEDS_REWRITE");
  });

  it("the server's word lists re-run: a blocked word the result misses is added as BLOCK (F-01)", () => {
    const out = validateSupportResult(answer([]), ctxFor(byId("F-01").bn, "behaviour"));
    expect(out.reports[0].flags.some((f) => f.category === "LABEL" && f.severity === "BLOCK" && f.byServer)).toBe(true);
  });

  it("a flag whose quote is not in the text is dropped; a suggestion with a number or a name not in the text is dropped", () => {
    const f = byId("F-08");
    const bad = [{ ...flagOf(f, "NO_EVIDENCE"), quote: "এটি লেখায় নেই" }, { ...flagOf(f, "NO_EVIDENCE"), id: "f2", suggestionBn: "১২ মিনিট সে জানালার দিকে তাকিয়ে ছিল।" }, { ...flagOf(f, "NO_EVIDENCE"), id: "f3", suggestionBn: "[অন্য শিশু] বলেছে সে মনোযোগ দেয়নি।" }];
    const out = validateSupportResult(answer(bad), ctxFor(f.bn, f.field));
    expect(out.reports[0].flags.map((x) => [x.id, x.suggestionBn])).toEqual([["f2", null], ["f3", null]]);
  });

  it("all BLOCK flags + at most 3 ASK/NOTE flags are shown per round", () => {
    const flags = [
      ...Array.from({ length: 2 }, (_x, i) => ({ id: `b${i}`, severity: "BLOCK" as const })),
      ...Array.from({ length: 5 }, (_x, i) => ({ id: `a${i}`, severity: "ASK" as const })),
      { id: "n0", severity: "NOTE" as const },
    ];
    const shown = flagsForRound(flags);
    expect(shown.filter((f) => f.severity === "BLOCK")).toHaveLength(2);
    expect(shown.filter((f) => f.severity !== "BLOCK")).toHaveLength(3);
  });

  it("an extra field or a bad enum → the item is rejected and the report returns to TO_PROCESS", () => {
    const f = byId("F-08");
    const extra = validateSupportResult(answer([flagOf(f, "NO_EVIDENCE")], "READY", { score: 3 }), ctxFor(f.bn, f.field));
    expect(extra.rejected.map((r) => r.reasonCode)).toEqual(["UNKNOWN_FIELD"]);
    expect(extra.noResult).toEqual(["R-001"]);
    const badEnum = validateSupportResult(answer([{ ...flagOf(f, "NO_EVIDENCE"), category: "BIAS" }]), ctxFor(f.bn, f.field));
    expect(badEnum.rejected.map((r) => r.reasonCode)).toEqual(["BAD_VALUE"]);
    expect(badEnum.noResult).toEqual(["R-001"]);
  });

  it.each([...fixtures.filter((f) => f.fairBn).map((f) => [`${f.id} fair rewrite`, f.fairBn!, f.field] as const), ...["F-21", "F-22", "F-23", "F-24", "F-25", "F-26"].map((id) => [id, byId(id).bn, byId(id).field] as const)])(
    "%s passes the server-side guards with no deterministic flag",
    (_label, t, field) => {
      expect(scanSupportTerms({ [field]: t })).toEqual([]);
      const out = validateSupportResult(answer([]), ctxFor(t, field));
      expect(out.reports[0].flags).toEqual([]);
      expect(out.reports[0].verdict).toBe("READY");
    },
  );
});
