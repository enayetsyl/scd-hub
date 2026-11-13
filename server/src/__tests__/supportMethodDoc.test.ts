/** CSP-2 — the method document (docs/prd-child-support-profile.md §6.2, NORMATIVE; D-#1584). */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { SAFEGUARDING_SIGNS, SUPPORT_CATEGORIES, SUPPORT_LEVELS, SUPPORT_AGREEMENT_STATUSES, SUPPORT_AUTHOR_SKEW, SUPPORT_CONFIDENCE, SUPPORT_FUNCTIONS,
  SUPPORT_NEEDS, SUPPORT_REPORT_SOURCES, SUPPORT_REPORT_STATUSES, SUPPORT_RESULTS, SUPPORT_SEVERITIES, SUPPORT_SKILLS, SUPPORT_STARTER_KEYS, SUPPORT_STRATEGY_KINDS,
  SUPPORT_TEXT_READS, SUPPORT_TONES, SUPPORT_VERDICTS } from "@scd/shared";
import { currentMethodVersion, loadMethod, methodVersions, METHOD_DIR } from "../modules/support-profile/services/methodDoc";
import { validateSupportResult, type CtxReport } from "../modules/support-profile/services/supportResultValidator";
import { ROSTER } from "./supportFixtures";

const m = loadMethod("v1");

/** A method version is a promise: its text never changes once a chat has been evaluated against it.
 *  Editing the file changes the hash and fails here — the fix is a NEW method_vN.md, not a new pin. */
const PINNED_METHOD_HASH: Record<string, string> = {
  v1: "a07bbd6571ba661828548e8f19c479b892d0eeb9e327682faad3994fe07f5f99",
};

describe("method_v1.md", () => {
  it("the loader finds it, its version and its SHA-256", () => {
    expect(currentMethodVersion()).toBe("v1");
    expect(m.fileName).toBe("method_v1.md");
    expect(m.sha256).toBe(createHash("sha256").update(fs.readFileSync(`${METHOD_DIR}/method_v1.md`, "utf8"), "utf8").digest("hex"));
  });

  it("every method version in the repo has its hash pinned, and the pin matches the file", () => {
    expect(methodVersions()).toEqual(Object.keys(PINNED_METHOD_HASH));
    for (const v of methodVersions()) expect([v, loadMethod(v).sha256]).toEqual([v, PINNED_METHOD_HASH[v]]);
  });

  it("each section marker M-0 … M-13 is present exactly once, in order", () => {
    expect(m.sections.map((s) => s.id)).toEqual(Array.from({ length: 14 }, (_x, i) => `M-${i}`));
    expect(m.sections.map((s) => s.text).join("")).toBe(m.text); // the sections cover the file byte for byte
  });

  it("holds no name from the fixture roster, no calendar date and no id (MD-5)", () => {
    const names = [ROSTER.child.name, ROSTER.child.nameBn, ROSTER.classmate.name, ROSTER.classmate.nameBn, ROSTER.otherChild.nameBn, ROSTER.guardian.name, ...Object.values(ROSTER.staff)];
    for (const n of names) expect(m.text).not.toContain(n);
    expect(m.text).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    expect(m.text).not.toMatch(/\b[0-9a-f]{24}\b/);
  });

  it("every category, level and sign in shared is named in the method, and the method names no code shared lacks", () => {
    for (const v of [...SUPPORT_CATEGORIES, ...SUPPORT_LEVELS, ...SAFEGUARDING_SIGNS]) expect([v, m.text.includes(`\`${v}\``)]).toEqual([v, true]);
    const known = new Set<string>([
      ...SUPPORT_CATEGORIES, ...SUPPORT_LEVELS, ...SAFEGUARDING_SIGNS, ...SUPPORT_SEVERITIES, ...SUPPORT_VERDICTS, ...SUPPORT_TONES, ...SUPPORT_TEXT_READS,
      ...SUPPORT_CONFIDENCE, ...SUPPORT_AGREEMENT_STATUSES, ...SUPPORT_AUTHOR_SKEW, ...SUPPORT_REPORT_SOURCES, ...SUPPORT_REPORT_STATUSES, ...SUPPORT_RESULTS,
      ...SUPPORT_STRATEGY_KINDS, ...SUPPORT_NEEDS, ...SUPPORT_FUNCTIONS, ...SUPPORT_SKILLS, ...SUPPORT_STARTER_KEYS,
    ]);
    const named = [...m.text.matchAll(/`([A-Z][A-Z_]{2,})`/g)].map((x) => x[1]);
    expect(named.filter((n) => !known.has(n))).toEqual([]);
  });

  it("the worked example printed in M-12 passes the import validator", () => {
    const example = /```json\n([\s\S]*?)```/.exec(m.sections.find((s) => s.id === "M-12")!.text)![1];
    const rep = (code: string, behaviour: string, status: CtxReport["status"] = "IN_BATCH"): CtxReport => ({
      code, childCode: "C-001", isNew: true, status, source: "TEACHER", authorCode: "T-01", occurredOn: "2000-01-01", slot: "P2", setting: "MATH",
      result: "WORKED", tone: "POSITIVE", goodThingCounts: true, gotOrAvoided: [],
      texts: { situation: "দলে অঙ্কের কাজ চলছিল", settingNote: "", behaviour, tried: "এক লাইনে বুঝিয়ে দিয়েছি", resultNote: "", exception: "", whatWorked: "", goodThing: "" },
    });
    const out = validateSupportResult(example, {
      batchCode: "B-0001", nonce: "EXAMPLE-NONCE", methodVersion: "v1", open: true, todayKey: "2000-01-02",
      reports: new Map([["R-001", rep("R-001", "সে পাশের জনকে দুটি অঙ্ক দেখিয়ে দিয়েছে")], ["R-002", rep("R-002", "সে খুব দুষ্টু")]]),
      children: new Set(["C-001"]), strategies: new Set(), items: new Set(), rosterNames: [],
    });
    expect(out.fileError).toBeNull();
    expect(out.rejected).toEqual([]);
    expect(out.reports.map((r) => [r.code, r.verdict])).toEqual([["R-001", "READY"], ["R-002", "NEEDS_REWRITE"]]);
    expect(out.children[0].draft?.items).toHaveLength(1);
  });
});
