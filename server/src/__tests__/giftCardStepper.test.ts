/**
 * Week stepper + due-date rendering on the gift card (D-#669, owner report on prod:
 * "forward button is not active").
 *
 * The ▶ guard was `week >= (report.weekTo ?? week)`, which reads as "stop at the
 * newest week" and is in fact ALWAYS TRUE. `assignmentGiftReport` ECHOES the requested
 * `weekTo` back in its response (it is the resolved window, not the newest week that
 * exists), so once ◀ pins a week the report's `weekTo` IS that week — and on the very
 * first load, where `weekTo` is null, `week` is DERIVED from `report.weekTo`, so the
 * two are equal there too. ▶ was therefore dead from the first render, and a desk that
 * stepped back could never come forward.
 *
 * The ceiling has to be latched from the first UNPINNED report and held. That is a
 * property of how the component is wired, invisible to `tsc` and to every unit test —
 * the same blind spot as the statement-position and wrong-screen bugs before it, so it
 * gets the same treatment: a static source guard.
 */
import { readFileSync } from "fs";
import path from "path";

const CARD = path.resolve(__dirname, "../../../app/src/components/GiftHandoverCard.tsx");
const src = readFileSync(CARD, "utf8");

/** The ▶ Button block — the forward stepper. */
const forwardBlock = src.match(/<Button\s+title="▶"[\s\S]*?\/>/);

/** Strip `//` comments: the fix's own comment NAMES `report.weekTo` to explain why it
 *  must not be used, and an assertion that cannot tell code from prose would fail on
 *  the very explanation of the bug it guards. */
const codeOnly = (s: string): string => s.replace(/^\s*\/\/.*$/gm, "");

describe("gift card — the ▶ week stepper", () => {
  test("a forward button exists", () => {
    expect(forwardBlock).not.toBeNull();
  });

  test("its disabled test does NOT compare against report.weekTo", () => {
    // The reported bug. `report.weekTo` is the echoed request, so this comparison is
    // always true and the button is permanently dead.
    expect(codeOnly(forwardBlock![0])).not.toMatch(/report\??\.weekTo/);
  });

  test("it compares against a LATCHED ceiling instead", () => {
    expect(forwardBlock![0]).toContain("latestWeek");
  });

  test("the ceiling is latched only from the UNPINNED first report", () => {
    // Re-latching on every report would track the pinned week and reintroduce the bug.
    const effect = src.match(/React\.useEffect\(\(\) => \{[\s\S]*?setLatestWeek[\s\S]*?\}, \[[^\]]*\]\);/);
    expect(effect).not.toBeNull();
    expect(effect![0]).toContain("latestWeek === null");
    expect(effect![0]).toContain("weekTo === null");
  });

  test("◀ stays bounded at week 1", () => {
    const back = src.match(/<Button\s+title="◀"[\s\S]*?\/>/);
    expect(back).not.toBeNull();
    expect(back![0]).toContain("week <= 1");
  });
});

describe("gift card — the due date is a DAY, not a timestamp", () => {
  test("dueDate is never rendered raw", () => {
    // It arrives as a full ISO timestamp; rendering it raw put
    // "2026-08-23T00:00:00.000Z" on the Office's dashboard.
    expect(src).not.toMatch(/\{weekMeta\.dueDate\}/);
    expect(src).not.toMatch(/\{weekMeta\?\.dueDate\}/);
  });

  test("it goes through the day-only helper and carries its label", () => {
    expect(src).toMatch(/dayOnly\(weekMeta\.dueDate\)/);
    expect(src).toContain("STR.agDue");
  });

  test("the helper slices to YYYY-MM-DD and has an empty fallback", () => {
    // Same slice the উপহার রিপোর্ট screen uses, so the two cannot disagree.
    const helper = src.match(/const dayOnly = [^;]+;/);
    expect(helper).not.toBeNull();
    expect(helper![0]).toContain("slice(0, 10)");
    expect(helper![0]).toContain('"—"');
  });
});
