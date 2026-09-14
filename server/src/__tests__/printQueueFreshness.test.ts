/**
 * Two app-source invariants that CI can otherwise not reach (the app workspace has no
 * test runner, so static guards live here — the navInitialRoute.test.ts pattern).
 *
 * 1. THE OFFICE PRINT QUEUE MUST NOT DEPEND ON THE SSE STREAM ALONE.
 *    Owner report, prod: a teacher filed a print job, withdrew it, and the Office
 *    printed it anyway because the withdrawn row was still on their screen. The cancel
 *    does publish its `print_queue` nudge (asserted in printRequest.test.ts), but
 *    `subscribeLiveEvents` is web-only — React Native cannot stream a fetch body — so
 *    on the Android build the queue had no refresh path beyond mount, and on web it
 *    goes quiet whenever the stream drops. The poll and the focus refetch are the two
 *    fallbacks that carry those cases; deleting either re-opens the bug silently,
 *    because the web build would still look fine in a browser.
 *
 * 2. UNDO ON A FINISHED (READ-ONLY) CARD IS OPT-IN, NEVER BLANKET.
 *    Both workspaces render a card read-only for two unrelated reasons: the D-#388
 *    not-my-subject fold (where the server would refuse the write) and the
 *    completed-work fold (where the viewer may well be the subject teacher). Only the
 *    second may offer the undo. Returning the LAST student empties a card of open rows,
 *    so it drops into the completed fold immediately — which is how a return made
 *    seconds ago lost its undo. Widening the flag to every read-only card would put an
 *    undo button on another teacher's subject, which the server then 403s.
 */
import { readFileSync } from "fs";
import path from "path";

const APP = path.resolve(__dirname, "../../../app/src");
const read = (rel: string): string => readFileSync(path.join(APP, rel), "utf8");

const PRINT_HOME = read("screens/printing/PrintHomeScreen.tsx");
const WORKSPACES: Array<[string, string]> = [
  ["homework", read("screens/homework/HomeworkWorkspaceScreen.tsx")],
  ["assignment", read("screens/assignment/AssignmentWorkspaceScreen.tsx")],
];

describe("Office print queue stays fresh without the SSE stream", () => {
  test("the queue polls on a timer while it is on screen", () => {
    // The poll must re-read over the NETWORK — a cached re-execute would hand back the
    // very row the teacher just withdrew.
    expect(PRINT_HOME).toMatch(
      /setInterval\(\s*\(\)\s*=>\s*refetchQueue\(\{\s*requestPolicy:\s*"network-only"\s*\}\)/,
    );
    // …and it must be torn down, or switching bucket/tab leaks a timer per visit.
    expect(PRINT_HOME).toMatch(/clearInterval\(id\)/);
  });

  test("the queue refetches whenever the screen regains focus", () => {
    expect(PRINT_HOME).toMatch(/useFocusEffect\(/);
    expect(PRINT_HOME).toMatch(/import \{ useFocusEffect \} from "@react-navigation\/native"/);
  });

  test("the SSE subscription is still there — the poll is a fallback, not a replacement", () => {
    expect(PRINT_HOME).toMatch(/subscribeLiveEvents\(\["print_queue"\]/);
  });
});

describe("undo on a finished card is opt-in", () => {
  for (const [name, src] of WORKSPACES) {
    test(`${name}: the completed-work fold asks for undo`, () => {
      // `shownDone` is the finished-items fold; it is the ONLY caller that may opt in.
      expect(src).toMatch(/renderCards\(shownDone,\s*\{[\s\S]*?allowUndo:\s*true/);
    });

    test(`${name}: SubjectFold's not-my-subject path does NOT`, () => {
      // SubjectFold calls `render(rows, { readOnly: true })` itself, with no allowUndo —
      // so the guard is that this screen never hands the fold a pre-set flag either.
      expect(src).not.toMatch(/<SubjectFold[\s\S]{0,400}allowUndo/);
    });

    test(`${name}: undo is limited to the subjects this login carries`, () => {
      // `taught === null` = "do not fold at all" (Principal/Office, class-teacher-only),
      // the same posture the open deck already takes for those logins.
      expect(src).toMatch(
        /allowUndo=\{!!opts\?\.allowUndo && \(taught === null \|\| taught\.has\(g\.subject\)\)\}/,
      );
    });

    test(`${name}: the row gate mirrors the server's D-#338 rule`, () => {
      // Principal/Office any day, the acting teacher only on the same Dhaka day, and
      // never on a record whose only stamp is the entry (nothing to pop).
      // A fixed window rather than an anchor on the statement's end: the repo's files
      // are CRLF, so a `;\n` terminator silently matches nothing and empties the guard.
      const at = src.indexOf("const canUndoRow =");
      expect(at).toBeGreaterThan(-1);
      const gate = src.slice(at, at + 400);
      expect(gate).toMatch(/r\.state === "RETURNED"/);
      expect(gate).toMatch(/r\.stampCount > 1/);
      expect(gate).toMatch(/canRevertPrior \|\| dhakaDayOf\(r\.lastStateAt\) === cardToday/);
    });
  }
});
