/**
 * CSP-4 — evidence standards E-01 … E-16 (docs/prd-child-support-profile.md §16.4, NORMATIVE;
 * D-#1562, D-#1563). Pure: `evidenceLevel()` and the read-time helpers in shared.
 */
import { evidenceLevel, isCardFresh, isDormant, type EvidenceReport } from "@scd/shared";

const T = "2026-11-13";
let n = 0;
const rep = (author: string, day: string, over: Partial<EvidenceReport> = {}): EvidenceReport => ({
  id: `r${++n}`, authorId: author, occurredOn: day, slot: "P2", setting: "MATH", source: "TEACHER", result: "WORKED", ...over,
});
const lvl = (evidence: EvidenceReport[], over: Partial<Parameters<typeof evidenceLevel>[0]> = {}) => evidenceLevel({ side: "POSITIVE", evidence, todayKey: T, ...over });

describe("evidenceLevel (§16.4)", () => {
  it("E-01 one report → SINGLE", () => expect(lvl([rep("a", "2026-11-01")]).level).toBe("SINGLE"));
  it("E-02 two teachers, two days → ESTABLISHED", () => expect(lvl([rep("a", "2026-11-01"), rep("b", "2026-11-03")]).level).toBe("ESTABLISHED"));
  it("E-03 two teachers, the same day and period → one observation → SINGLE", () => {
    const s = lvl([rep("a", "2026-11-01"), rep("b", "2026-11-01")]);
    expect([s.level, s.obsCount, s.teachersCount]).toEqual(["SINGLE", 1, 2]);
  });
  it("E-04 one teacher, two days → EMERGING", () => expect(lvl([rep("a", "2026-11-01"), rep("a", "2026-11-05")]).level).toBe("EMERGING"));
  it("E-05 one teacher, 3 days over 14+ days → ESTABLISHED", () => expect(lvl([rep("a", "2026-10-20"), rep("a", "2026-10-27"), rep("a", "2026-11-03")]).level).toBe("ESTABLISHED"));
  it("E-06 one teacher, 3 days within 6 days → EMERGING", () => expect(lvl([rep("a", "2026-11-01"), rep("a", "2026-11-03"), rep("a", "2026-11-06")]).level).toBe("EMERGING"));
  it("E-07 three teachers, 4 observations, 2 settings → STRONG", () =>
    expect(lvl([rep("a", "2026-11-01"), rep("b", "2026-11-02"), rep("c", "2026-11-03", { setting: "QURAN" }), rep("a", "2026-11-04")]).level).toBe("STRONG"));
  it("E-08 three teachers, 4 observations, 1 setting → ESTABLISHED", () =>
    expect(lvl([rep("a", "2026-11-01"), rep("b", "2026-11-02"), rep("c", "2026-11-03"), rep("a", "2026-11-04")]).level).toBe("ESTABLISHED"));
  it("E-09 support 2 of 4 → not ESTABLISHED, worded mixed", () => {
    const s = lvl([rep("a", "2026-11-01"), rep("b", "2026-11-02")], { counter: [rep("c", "2026-11-03"), rep("d", "2026-11-04")] });
    expect([s.level, s.mixed]).toEqual(["EMERGING", true]);
  });
  it("E-10 a strategy with only PARTLY results → not ESTABLISHED (needs one WORKED)", () => {
    const tries = [rep("a", "2026-11-01", { result: "PARTLY" }), rep("b", "2026-11-02", { result: "PARTLY" })];
    expect(lvl(tries, { isStrategy: true }).level).toBe("EMERGING");
    expect(lvl([...tries, rep("c", "2026-11-03", { result: "WORKED" })], { isStrategy: true }).level).toBe("ESTABLISHED");
  });
  it("E-11 guardian information + one teacher report → SINGLE (guardian adds no observation or teacher); alone, only positive SINGLE; never concern", () => {
    const g = rep("g", "2026-11-02", { source: "GUARDIAN_INFO", result: null });
    const s = lvl([rep("a", "2026-11-01"), g]);
    expect([s.level, s.obsCount, s.teachersCount, s.hasGuardianInfo]).toEqual(["SINGLE", 1, 1, true]);
    expect(lvl([g]).level).toBe("SINGLE");
    expect(lvl([g], { side: "CONCERN" }).level).toBeNull();
  });
  it("E-12 a concern report 13 months old counts 0", () => expect(lvl([rep("a", "2025-10-01")], { side: "CONCERN" }).level).toBeNull());
  it("E-13 a positive report 13 months old counts; 25 months old counts 0", () => {
    expect(lvl([rep("a", "2025-10-01")]).level).toBe("SINGLE");
    expect(lvl([rep("a", "2024-10-01")]).level).toBeNull();
  });
  it("UNCLEAR results count for neither side", () => expect(lvl([rep("a", "2026-11-01", { result: "UNCLEAR" })]).level).toBeNull());
  it("E-14 a concern item, last observation 130 days ago → off the card, still in the profile", () => {
    expect(isCardFresh("CONCERN", "2026-07-06", T)).toBe(false);
    expect(isCardFresh("CONCERN", "2026-07-20", T)).toBe(true);
    expect(lvl([rep("a", "2026-07-06")], { side: "CONCERN" }).level).toBe("SINGLE"); // still inside 12 months
  });
  it("E-15 after a cut-over, a concern item with last-year evidence only → dormant; one new observation → restored", () => {
    expect(isDormant("CONCERN", "2025-12-20", "2026-01-03")).toBe(true);
    expect(isDormant("CONCERN", "2026-01-10", "2026-01-03")).toBe(false);
    expect(isDormant("POSITIVE", "2025-12-20", "2026-01-03")).toBe(false);
  });
  it("E-16 the last three tries DID_NOT_WORK from two teachers → the strategy has 'failed' (retire prompt)", () => {
    const tries = [rep("a", "2026-10-01"), rep("a", "2026-11-01", { result: "DID_NOT_WORK" }), rep("b", "2026-11-05", { result: "DID_NOT_WORK" }), rep("a", "2026-11-08", { result: "DID_NOT_WORK" })];
    const s = lvl(tries, { isStrategy: true });
    // 1 of 4 supporting (≤ 1/3) with ≥ 3 tries from ≥ 2 teachers → "যা কাজ করেনি"; never on the card
    expect([s.failed, s.mixed]).toEqual([true, true]);
    // 2 of 3 supporting is not failed
    expect(lvl([rep("a", "2026-10-01"), rep("b", "2026-10-02"), rep("a", "2026-11-01", { result: "DID_NOT_WORK" })], { isStrategy: true }).failed).toBe(false);
  });
});
