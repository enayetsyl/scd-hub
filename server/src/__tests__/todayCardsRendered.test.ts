/**
 * Today-screen cards are actually RENDERED, not merely present (AG-3, 2026-09-14).
 *
 * Caught the hard way while building the gift card: a JSX element written in
 * STATEMENT position — inside the component body, above the `return (` — is perfectly
 * legal TypeScript. It is an expression statement whose value is discarded. `tsc`
 * passes, the bundler passes, every unit test passes, and the card never appears on
 * screen. There is no type error to catch because there is no type error.
 *
 * The only reliable signal is POSITION: a card must appear after the component's top
 * level `return (`. This guard reads the source and asserts exactly that for each card
 * Today is expected to show, so a future edit that lands one above the return — the
 * easy mistake when patching against a stale copy of this file — fails loudly.
 *
 * Static source read, deliberately: the app workspace has no test runner (see
 * `navInitialRoute.test.ts` / `observationDraftInvariants.test.ts`).
 */
import { readFileSync } from "fs";
import path from "path";

const SCREEN = path.resolve(__dirname, "../../../app/src/screens/home/TodayScreen.tsx");
const src = readFileSync(SCREEN, "utf8");

/** The component's own top-level `return (` — column 2, i.e. one indent inside the
 *  function. Nested returns inside callbacks are indented further and are not this. */
const RETURN_AT = src.search(/\n {2}return \(/);

/** Cards Today is expected to render. Add a row when a new card is added. */
const CARDS = ["WorkClaimTeacherCard", "ReturningStudentsCard", "GiftHandoverCard"];

describe("TodayScreen — every card is inside the render", () => {
  test("the component has a top-level return", () => {
    expect(RETURN_AT).toBeGreaterThan(0);
  });

  test.each(CARDS)("<%s /> is used AFTER the return, not in statement position", (card) => {
    // The import sits at the top of the file and must not be mistaken for a usage,
    // so match the JSX form specifically.
    const usage = src.indexOf(`<${card}`);
    expect(usage).toBeGreaterThan(0);
    expect(usage).toBeGreaterThan(RETURN_AT);
  });

  test("the gift card is gated on gift:manage, not on a tracker permission", () => {
    // The Office holds no tracker permission (D-#554); gating this card on one would
    // hide it from the very desk it was built for.
    const line = src.split(/\r?\n/).find((l) => l.includes("<GiftHandoverCard")) ?? "";
    expect(line).toContain("canGift");
    expect(src).toMatch(/const canGift = can\("gift:manage"\)/);
  });
});
