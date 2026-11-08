/**
 * Example data for the exam paper bank help guides (D-#1030–#1034). LOCAL ONLY (the same guard
 * as scripts/help/fixture.ts).
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hc npx tsx scripts/help/fixtures/exam-papers.ts --reset
 *
 * The base school, plus:
 *   - two draft papers from server/assets/exam-papers/annual-2026 (৩য় শ্রেণি বাংলা, ৫ম শ্রেণি গণিত),
 *     imported by the Principal and given to teacher@help.test ("উদাহরণ শ্রেণি শিক্ষক") to review;
 *   - one OPEN edit suggestion from that reviewer on the Bangla paper (the Principal's guide
 *     accepts / rejects it).
 * The Mohammadpur papers are uploaded by the walk itself (specs/exam-papers.cjs), through the
 * screen, with the server run as scripts/help/fake-drive-server.ts so nothing reaches Google.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { seedBaseSchool } from "../fixture";
import * as EP from "../../../src/modules/exam-papers/services/ExamPaperDraftService";
import type { AppContext } from "../../../src/context";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

const DRAFTS = path.resolve(__dirname, "../../../assets/exam-papers/annual-2026");

export async function seedExamPapers() {
  const base = await seedBaseSchool();
  const principal = { auth: { userId: String(base.users.principal), role: "PRINCIPAL" } } as unknown as AppContext;
  const reviewer = { auth: { userId: String(base.users.teacher), role: "TEACHER" } } as unknown as AppContext;
  const ids: string[] = [];
  for (const f of ["L3-BAN.json", "L5-MATH.json"]) {
    const s = await EP.importExamPaperDraft(principal, JSON.parse(fs.readFileSync(path.join(DRAFTS, f), "utf8")));
    ids.push(s.id);
  }
  await EP.assignExamPaperReviewer(principal, ids, String(base.users.teacher));
  const bangla = await EP.examPaperDraft(reviewer, ids[0]);
  const first = bangla.sections[0].items[0];
  await EP.suggestExamPaperChange(reviewer, {
    paperId: ids[0],
    kind: "EDIT",
    sectionSeq: bangla.sections[0].seq,
    itemKey: first.key,
    proposedText: `${first.text} (সহজ ভাষায়)`,
    reason: "শিক্ষার্থীদের জন্য প্রশ্নটি আরেকটু সহজ করা যায়",
  });
  return { ...base, examPaperIds: ids };
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(uri);
    if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
    const ids = await seedExamPapers();
    console.log("fixture: exam-papers (2 draft papers given to teacher@help.test, 1 open suggestion)");
    console.log(JSON.stringify({ examPaperIds: ids.examPaperIds }));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
