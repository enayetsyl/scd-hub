/**
 * Owner-run evaluation pack (docs/prd-child-support-profile.md §12 CSP-2, §16.9) — NOT a CI test.
 *
 *   npx tsx server/scripts/support-eval-pack.ts [--out <file.md>] [--score <result.json>]
 *
 * Writes the evaluation pack (F-01 … F-39 + 40 invented reports + the real method file) to a file the
 * Principal gives to the chat he will use, exactly like a real batch. With --score it prints the marks
 * of a saved answer against the server-held key (the app's "মূল্যায়ন প্যাক" screen stores the
 * SupportProducerEval row; this script only prints). Needs no database and no network.
 */
import fs from "node:fs";
import { buildEvalPack, PASS_MARKS, scoreEvaluation } from "../src/modules/support-profile/eval/supportEvaluation";

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
};

const score = arg("--score");
if (score) {
  const { outcome, marks, autoPassed } = scoreEvaluation(fs.readFileSync(score, "utf8"));
  if (outcome.fileError) {
    console.log(`file refused: ${outcome.fileError}`);
    process.exit(2);
  }
  console.log(JSON.stringify({ marks: { ...marks, suggestionsToRead: undefined }, passMarks: PASS_MARKS, rejected: outcome.rejected.length }, null, 2));
  console.log("\nSuggestions to read (owner): none may add a fact the teacher did not write.");
  for (const s of marks.suggestionsToRead) console.log(`- ${s.fixture} ${s.report}: ${s.suggestionBn}`);
  console.log(`\nAUTOMATIC MARKS: ${autoPassed ? "PASS" : "FAIL"} (passing also needs the owner's reading of the suggestions)`);
  process.exit(autoPassed ? 0 : 1);
}
const pack = buildEvalPack();
const out = arg("--out") ?? pack.fileName;
fs.writeFileSync(out, pack.content, "utf8");
console.log(`wrote ${out} (${Buffer.byteLength(pack.content, "utf8")} bytes, sha256 ${pack.sha256})`);
