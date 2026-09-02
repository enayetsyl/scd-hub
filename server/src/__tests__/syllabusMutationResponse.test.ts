/**
 * A syllabus mutation returns the row it just wrote — not a re-read through the
 * published-only gate.
 *
 * PROD INCIDENT, 2026-09-02. A teacher pressed অনুমোদন and got a red banner. The
 * approval had in fact COMMITTED — status moved to PRINCIPAL_REVIEW and the
 * audit row was written — but the resolver then returned:
 *
 *   return (await syllabusDetail(ctx, examId, classId, subject))!;
 *
 * and `syllabusDetail` refuses a non-admin caller on any row without
 * `publishedAt`:
 *
 *   if (!admin && !row.publishedAt) throw ForbiddenError("এই সিলেবাস এখনও প্রকাশ করা হয়নি")
 *
 * A teacher approving a syllabus is BY DEFINITION acting on an unpublished one —
 * approval is the step before publication — so this threw every single time. The
 * write succeeded, the response failed, and the teacher saw an error.
 *
 * The prod audit log records the consequence precisely: one teacher approved the
 * same row twice 2ms apart, another sent one back three times in twelve seconds.
 * People pressing the button again because the app said it had not worked. The
 * second press then hit a DIFFERENT refusal — send-back on a row now at
 * PRINCIPAL_REVIEW asserts `exam:manage` — which is the
 * "সিলেবাস ব্যবস্থাপনার অনুমতি নেই" the owner was shown.
 *
 * The mutations now respond from the doc the service already returned and
 * already authorised. Static reads: the bug was a well-typed call to the wrong
 * function, which no type or unit test on the service could ever have caught.
 */
import { readFileSync } from "fs";
import path from "path";

const read = (rel: string): string =>
  readFileSync(path.resolve(__dirname, rel), "utf8").split("\r\n").join("\n");

const RESOLVER = read("../modules/exams/resolvers/examSyllabus.ts");
const READ_SERVICE = read("../modules/exams/services/ExamSyllabusReadService.ts");
const SCREEN = read("../../../app/src/screens/syllabus/SyllabusApprovalsScreen.tsx");

/** Everything inside `builder.mutationFields`. */
const MUTATIONS = RESOLVER.slice(RESOLVER.indexOf("builder.mutationFields"));
/** Everything before it — the queries. */
const QUERIES = RESOLVER.slice(0, RESOLVER.indexOf("builder.mutationFields"));

describe("mutation responses", () => {
  test("NO mutation answers through syllabusDetail", () => {
    // The whole bug in one assertion. `syllabusDetail` asks "may this caller
    // read a published row?"; a mutation has already answered "may this caller
    // change THIS row?", and for a teacher the first question is always no.
    expect(MUTATIONS).not.toMatch(/syllabusDetail\(/);
  });

  test("every mutation answers from the doc it just wrote", () => {
    const writes = MUTATIONS.match(/syllabusAfterWrite\(ctx, doc\)/g) ?? [];
    // save · submit · reassign · approve · sendBack · publish
    expect(writes.length).toBe(6);
  });

  test("the QUERY still keeps the published-only gate", () => {
    // The gate is correct where it lives; it was only ever wrong on the way OUT
    // of a write. Removing it from the read would expose unpublished syllabuses
    // to guardians.
    expect(QUERIES).toMatch(/syllabusDetail\(/);
    expect(READ_SERVICE).toMatch(
      /export async function syllabusDetail[\s\S]*?if \(!admin && !row\.publishedAt\)/,
    );
  });
});

describe("syllabusAfterWrite", () => {
  const FN = READ_SERVICE.match(
    /export async function syllabusAfterWrite[\s\S]*?\n\}/,
  )?.[0];

  test("exists and is exported", () => {
    expect(FN).toBeDefined();
  });

  test("does NOT re-read the row from the database", () => {
    // Re-reading is what created the second, unauthorised question. The doc was
    // handed over by the service that just saved it.
    expect(FN).not.toMatch(/ExamSyllabus\.findOne|ExamSyllabus\.findById/);
  });

  test("does NOT consult publishedAt", () => {
    expect(FN).not.toMatch(/publishedAt/);
  });

  test("still refuses an unauthenticated caller", () => {
    // Not a hole: the actor is known and already authorised, but a missing
    // ctx.auth means something upstream is wrong.
    expect(FN).toMatch(/if \(!ctx\.auth\) throw new ForbiddenError/);
  });

  test("still resolves isMine and the class name per caller", () => {
    // The response feeds the same card the teacher is looking at; dropping
    // these would blank the heading that D-#609 just fixed.
    expect(FN).toMatch(/myPairKeys\(ctx\)/);
    expect(FN).toMatch(/nameBn/);
    expect(FN).toMatch(/toShape\(doc, isMine, cls\?\.nameBn \?\? ""\)/);
  });
});

describe("a failed call must not leave a stale card", () => {
  test("the lists are refetched on the ERROR path too", () => {
    const run = SCREEN.match(/async function run\([\s\S]*?\n  \}/)?.[0];
    expect(run).toBeDefined();
    // Only refetching on success is what let one phantom error strand a card
    // the teacher could no longer act on — every further press then hit a
    // refusal naming a stage they could not see.
    expect(run).toMatch(/if \(res\.error\)[\s\S]*?onStale\(\);[\s\S]*?return;/);
  });

  test("the stale refetch does NOT close the open card", () => {
    // Distinct from `reload`, which clears openCell: the error has to stay
    // readable, and the card disappears only if the row really did move on.
    const fn = SCREEN.match(/const refetchAll = \(\): void => \{[\s\S]*?\n  \};/)?.[0];
    expect(fn).toBeDefined();
    expect(fn).not.toMatch(/setOpenCell/);
    expect(fn).toMatch(/refetchMine/);
    expect(fn).toMatch(/refetchBoard/);
  });

  test("both card sites are wired to it", () => {
    expect(SCREEN.match(/onStale=\{refetchAll\}/g)?.length).toBe(2);
  });
});
