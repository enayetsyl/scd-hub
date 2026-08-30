/**
 * ACS-4 (D-#592) — every tracker write gate NAMES the duty it performs.
 *
 * WHY THIS IS A SOURCE-SCANNING TEST AND NOT A RESOLVER TEST.
 * `canWrite` refuses a delegation on any gate that names no action (D-#486) — that
 * is deliberate and correct. The failure it produces is therefore invisible to every
 * unit test of the gate itself: the gate is right, the delegation is right, and the
 * person is still refused because the CALL SITE forgot to say what it was doing.
 * That is exactly what happened in prod on 2026-08-30 — a whole-school delegate
 * holding all seven duties tapped ফেরত দিন on a Class-3 English assignment and got
 * "এই শাখায় লেখার অনুমতি নেই।", because `redeliverAssignmentRecord` was untagged.
 *
 * So the thing worth pinning is the property no runtime test can see: that no gate
 * in these files is ANONYMOUS, and that each one names the duty a person would say
 * it performs. A new untagged mutation fails here on the day it is written, not the
 * day someone with a delegation first taps it.
 */
import fs from "node:fs";
import path from "node:path";
import { DELEGATED_ACTIONS } from "@scd/shared";

const RESOLVERS = path.join(__dirname, "..", "modules", "trackers", "resolvers");
const FILES = ["assignment.ts", "homework.ts", "homeworkFiles.ts"];

/** The text of one `assert...(` call's arguments, paren-balanced. */
function callArgs(src: string, openParenIdx: number): string {
  let depth = 0;
  for (let i = openParenIdx; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(openParenIdx + 1, i);
    }
  }
  throw new Error("unbalanced call at index " + openParenIdx);
}

interface Gate {
  file: string;
  /** The enclosing `builder.mutationField("name")`, or the helper it sits in. */
  owner: string;
  args: string;
  actions: string[];
}

function gatesIn(file: string): Gate[] {
  const src = fs.readFileSync(path.join(RESOLVERS, file), "utf8");
  const gates: Gate[] = [];
  const call = /\bassertCanWrite(?:Any)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    // Skip prose: a mention inside a comment or a description string.
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const line = src.slice(lineStart, m.index);
    if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) continue;
    const args = callArgs(src, open);
    let owner = "(module scope)";
    const before = src.slice(0, m.index);
    const mut = before.lastIndexOf('builder.mutationField("');
    const fn = before.lastIndexOf("async function assert");
    if (fn > mut) {
      owner = /async function (\w+)/.exec(src.slice(fn))?.[1] ?? "(helper)";
    } else if (mut >= 0) {
      owner = /builder\.mutationField\("([^"]+)"/.exec(src.slice(mut))?.[1] ?? "(?)";
    }
    const actions = DELEGATED_ACTIONS.filter((a) => args.includes(`"${a}"`));
    gates.push({ file, owner, args, actions });
  }
  return gates;
}

const ALL_GATES = FILES.flatMap(gatesIn);

// ---------------------------------------------------------------------------
// 1. The invariant: no anonymous gate
// ---------------------------------------------------------------------------

describe("no tracker write gate is anonymous (D-#592)", () => {
  /** A gate whose action is a PARAMETER is named by its callers, checked in §2. */
  const PASS_THROUGH = /\baction\b/;

  test("the scanner actually found the gates (guards against a silent zero-match)", () => {
    expect(ALL_GATES.length).toBeGreaterThanOrEqual(20);
    for (const f of FILES) {
      expect(ALL_GATES.some((g) => g.file === f)).toBe(true);
    }
  });

  test.each(FILES)("every assertCanWrite in %s names a delegated action", (file) => {
    const anonymous = ALL_GATES.filter(
      (g) => g.file === file && g.actions.length === 0 && !PASS_THROUGH.test(g.args),
    ).map((g) => `${g.file} → ${g.owner}`);
    expect(anonymous).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. The mapping: each gate names the duty a person would say it performs
// ---------------------------------------------------------------------------

const EXPECTED: Record<string, string[]> = {
  // --- assignment: delivering the work ---
  declareNoAssignment: ["declare_assignment"],
  removeNoAssignment: ["declare_assignment"],
  assertCanWriteOnItem: ["declare_assignment"], // updateAssignmentItem + deleteAssignmentItem
  deliverAssignment: ["declare_assignment"],
  redeliverAssignmentRecord: ["declare_assignment"], // the 2026-08-30 prod failure
  // --- assignment: collecting and checking it ---
  transitionAssignmentRecord: ["submit_assignment"], // →SUBMITTED only; other moves stay untagged
  assignmentSubmitPass: ["submit_assignment"],
  checkAssignmentRecord: ["check_assignment"],
  recordAssignmentOutcome: ["check_assignment"],
  assignmentReturnPass: ["check_assignment"],
  issueAssignmentResubmission: ["check_assignment"],
  // --- assignment: undo, which belongs to no single duty ---
  revertAssignmentRecord: ["declare_assignment", "submit_assignment", "check_assignment"],

  // --- homework: giving the work out ---
  declareHomeworkItem: ["declare_homework"],
  updateHomeworkItem: ["declare_homework"],
  deleteHomeworkItem: ["declare_homework"],
  declareNoHomework: ["declare_homework"],
  removeNoHomework: ["declare_homework"],
  issueHomeworkItem: ["declare_homework"],
  attachHomeworkQuestionFile: ["declare_homework"],
  // --- homework: collecting and checking it ---
  transitionHomeworkRecord: ["submit_homework"],
  markHomeworkRecordsDue: ["submit_homework"],
  checkHomeworkRecord: ["check_homework"],
  recordHomeworkOutcome: ["check_homework"],
  attachHomeworkAnswerFile: ["check_homework"],
  // --- homework: undo ---
  revertHomeworkRecord: ["declare_homework", "submit_homework", "check_homework"],
};

describe("each tracker gate names the duty it performs (D-#592)", () => {
  const named = ALL_GATES.filter((g) => g.actions.length > 0);

  test.each(Object.keys(EXPECTED))("%s", (owner) => {
    const gate = named.find((g) => g.owner === owner);
    expect(gate).toBeDefined();
    expect(gate!.actions.slice().sort()).toEqual(EXPECTED[owner].slice().sort());
  });

  test("the map covers every named gate — a new one must be listed here deliberately", () => {
    const unlisted = named.filter((g) => !(g.owner in EXPECTED)).map((g) => `${g.file} → ${g.owner}`);
    expect(unlisted).toEqual([]);
  });

  test("the roster passes reach their duty through the shared helper, not a bare gate", () => {
    // homeworkSubmitPass / homeworkReturnPass call assertItemWriteScope, whose own
    // assertCanWrite takes the action as a parameter — so they are absent from the
    // scan above BY DESIGN, and their tags are asserted at the call site instead.
    const src = fs.readFileSync(path.join(RESOLVERS, "homework.ts"), "utf8");
    expect(src).toContain('assertItemWriteScope(ctx, args.sectionId, args.itemId, "submit_homework")');
    expect(src).toContain('assertItemWriteScope(ctx, args.sectionId, args.itemId, "check_homework")');
  });
});
