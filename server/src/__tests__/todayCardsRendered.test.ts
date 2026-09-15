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

const ADMIN_SCREEN = path.resolve(__dirname, "../../../app/src/screens/home/AdminTodayScreen.tsx");
const adminSrc = readFileSync(ADMIN_SCREEN, "utf8");

const APPTABS = path.resolve(__dirname, "../../../app/src/navigation/AppTabs.tsx");
const tabsSrc = readFileSync(APPTABS, "utf8");

/** The component's own top-level `return (` — column 2, i.e. one indent inside the
 *  function. Nested returns inside callbacks are indented further and are not this. */
const RETURN_AT = src.search(/\n {2}return \(/);

/** Cards Today is expected to render. Add a row when a new card is added. */
const CARDS = ["WorkClaimTeacherCard", "ReturningStudentsCard", "GiftHandoverCard", "LiveClassCard"];

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

/**
 * The lesson from the D-#667 miss: being inside the render is NECESSARY but not
 * SUFFICIENT. The gift card shipped correctly placed inside TodayScreen's return —
 * and rendered for nobody, because `adminDash` in AppTabs routes PRINCIPAL and OFFICE
 * to AdminTodayScreen, and they are the only two roles holding `gift:manage`. Position
 * was right; AUDIENCE was wrong, and no test asked about audience.
 */
describe("AdminTodayScreen — the admin-only cards reach the roles that hold them", () => {
  const ADMIN_RETURN_AT = adminSrc.search(/\n {2}return \(/);

  test("AppTabs still routes PRINCIPAL and OFFICE to AdminTodayScreen (D-#316)", () => {
    // If this routing ever changes, the assertion below is measuring the wrong screen.
    expect(tabsSrc).toMatch(/adminDash\s*=\s*role === "PRINCIPAL" \|\| role === "OFFICE"/);
    expect(tabsSrc).toMatch(/component=\{adminDash \? AdminTodayScreen : TodayScreen\}/);
  });

  test("the gift card is on the ADMIN screen — the one Principal/Office actually land on", () => {
    const usage = adminSrc.indexOf("<GiftHandoverCard");
    expect(usage).toBeGreaterThan(0);
    expect(usage).toBeGreaterThan(ADMIN_RETURN_AT);
  });

  test("it is gated on gift:manage there too", () => {
    const line = adminSrc.split(/\r?\n/).find((l) => l.includes("<GiftHandoverCard")) ?? "";
    expect(line).toContain("canGift");
    expect(adminSrc).toMatch(/const canGift = can\("gift:manage"\)/);
  });

  /**
   * D-#670: the live class card answers "who is teaching what RIGHT NOW", and the two
   * roles that need it (Principal, Office) land on the admin screen — the exact shape
   * of the D-#668 miss. It is gated on `routine:manage`, the same permission the
   * `liveClassBoard` resolver requires, so the card and the server can never disagree
   * about who may see it.
   */
  test("the live class card is on the ADMIN screen, gated on routine:manage", () => {
    const usage = adminSrc.indexOf("<LiveClassCard");
    expect(usage).toBeGreaterThan(0);
    expect(usage).toBeGreaterThan(ADMIN_RETURN_AT);
    const line = adminSrc.split(/\r?\n/).find((l) => l.includes("<LiveClassCard")) ?? "";
    expect(line).toContain("canLiveBoard");
    expect(adminSrc).toMatch(/const canLiveBoard = can\("routine:manage"\)/);
  });

  test("the live class card is on the teacher screen too, on the same permission", () => {
    const line = src.split(/\r?\n/).find((l) => l.includes("<LiveClassCard")) ?? "";
    expect(line).toContain("canLiveBoard");
    expect(src).toMatch(/const canLiveBoard = can\("routine:manage"\)/);
  });

  test("it stays on the teacher screen as well — the permission, not the role, decides", () => {
    // `gift:manage` is role-granted today, but AC-1/D-#193 allows a per-USER grant, and
    // such a teacher would still be routed to TodayScreen. The card follows the
    // permission so that case is not silently unreachable.
    expect(src).toContain("<GiftHandoverCard");
  });
});
