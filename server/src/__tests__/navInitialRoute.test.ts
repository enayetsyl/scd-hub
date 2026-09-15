/**
 * Navigation invariant: a screen that REQUIRES route params must never be a stack's
 * FIRST `<Stack.Screen>`.
 *
 * React Navigation treats the first registered screen as the stack's initial route
 * (absent `initialRouteName`), so such a screen mounts with `params === undefined`.
 * A screen that destructures its params then throws on mount and the error boundary
 * takes down the whole tab.
 *
 * This is not hypothetical: SP-3 registered `StudentProfile` as the first screen of
 * five stacks (Homework, Assignment, Attendance, ClassTest, Admin) and every one of
 * those tabs died with "Something went wrong" — in production. Types could not catch
 * it (the param type says `studentId: string`; it is the ROUTER that supplies
 * undefined at runtime), and the app workspace has no test runner, so the check
 * lives here where CI already runs.
 *
 * A static read of the source, deliberately: it asserts the ORDER as written, which
 * is the thing that was wrong. `StudentProfileScreen` also guards defensively now,
 * so a regression degrades to an empty state rather than a crash — this test keeps
 * the ordering honest as well.
 */
import { readFileSync } from "fs";
import path from "path";

/** Screens whose route params are required — they can never be an initial route, and no
 *  drawer leaf may deep-link to one (see the second invariant below).
 *
 *  `ScholarshipTopics` was here and is deliberately NOT any more: the drawer leaf had to
 *  reach it, so D-#668 made its param optional instead of removing the leaf. */
const PARAM_REQUIRING_SCREENS = [
  "StudentProfile",
  // Scholarship practice (SC-1..SC-4): every screen but ScholarshipHome and
  // ScholarshipTopics destructures required params on mount, so any of them landing
  // first would take the tab down.
  "ScholarshipDeclare",
  "ScholarshipMarks",
  "ScholarshipStudent",
  "ScholarshipClass",
];

const APP_TABS = path.resolve(__dirname, "../../../app/src/navigation/AppTabs.tsx");
const DRAWER_CONTENT = path.resolve(__dirname, "../../../app/src/navigation/DrawerContent.tsx");

interface NavigatorBlock {
  stack: string;
  screensInOrder: string[];
}

/**
 * Parse each `<XStack.Navigator>…</XStack.Navigator>` block and its screen order.
 *
 * Full-text, NOT line-by-line: several screens are formatted across multiple lines
 * (a long `options={{…}}` wraps), and a line-based reader silently saw those
 * navigators as empty — which would have made this whole file a no-op. The
 * "parser found something" test below exists because that is exactly what happened
 * on the first attempt.
 */
function parseNavigators(source: string): NavigatorBlock[] {
  const blocks: NavigatorBlock[] = [];
  // Backreference \1 pairs each opening tag with its OWN closing tag; lazy body so
  // consecutive navigators do not collapse into one block.
  const navRe = /<(\w+Stack)\.Navigator\b[\s\S]*?<\/\1\.Navigator>/g;
  for (const nav of source.matchAll(navRe)) {
    const stack = nav[1];
    const screensInOrder: string[] = [];
    const screenRe = new RegExp(`<${stack}\\.Screen\\b[\\s\\S]*?name="([^"]+)"`, "g");
    for (const screen of nav[0].matchAll(screenRe)) screensInOrder.push(screen[1]);
    blocks.push({ stack, screensInOrder });
  }
  return blocks;
}

const source = readFileSync(APP_TABS, "utf8");
const navigators = parseNavigators(source);

describe("AppTabs navigator registration", () => {
  test("the parser actually found the navigators (guards against a silent pass)", () => {
    // A regex-based check that matches nothing would pass every assertion below
    // while verifying nothing at all.
    expect(navigators.length).toBeGreaterThan(10);
    for (const nav of navigators) {
      expect(nav.screensInOrder.length).toBeGreaterThan(0);
    }
  });

  test("StudentProfile is registered in the five stacks that drill into a child", () => {
    const withProfile = navigators
      .filter((n) => n.screensInOrder.includes("StudentProfile"))
      .map((n) => n.stack)
      .sort();
    expect(withProfile).toEqual(
      ["AdminStack", "AssignmentStack", "AttendanceStack", "ClassTestStack", "HomeworkStack"].sort(),
    );
  });

  test("no param-requiring screen is any stack's FIRST screen (= its initial route)", () => {
    const offenders = navigators
      .filter((n) => PARAM_REQUIRING_SCREENS.includes(n.screensInOrder[0]))
      .map((n) => `${n.stack} starts with ${n.screensInOrder[0]}`);
    expect(offenders).toEqual([]);
  });
});

/**
 * The SECOND way a screen mounts without params — and the one that actually shipped.
 *
 * `DrawerContent` deep-links a leaf with `navigate(leaf.route, { screen: leaf.screen,
 * initial: false })` and passes **no `params`**, so the target mounts with
 * `route.params === undefined` exactly as an initial route does. SC-0's `টপিক তালিকা`
 * leaf pointed at `ScholarshipTopics`, which destructured `{ classLevel }` — the drawer
 * entry crashed to the error boundary in production while the same screen reached from
 * the papers list (which passes `classLevel`) worked perfectly (D-#668).
 *
 * The initial-route test could not see it: `ScholarshipTopics` is registered sixth in its
 * stack, so it was never an initial route and the existing tripwire stayed green.
 */
const drawerSource = readFileSync(DRAWER_CONTENT, "utf8");
const drawerLeafScreens = [...drawerSource.matchAll(/\bscreen:\s*"([^"]+)"/g)].map((m) => m[1]);

describe("DrawerContent deep-linked leaves", () => {
  test("the parser actually found the leaves (guards against a silent pass)", () => {
    expect(drawerLeafScreens.length).toBeGreaterThan(10);
  });

  test("no drawer leaf deep-links to a screen that requires route params", () => {
    const offenders = drawerLeafScreens.filter((s) => PARAM_REQUIRING_SCREENS.includes(s));
    expect(offenders).toEqual([]);
  });
});
