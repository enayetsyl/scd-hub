/**
 * Capture spec — the whole "ক্লাস টেস্ট ও পরীক্ষা" area (exam-* guides), one part after another.
 *
 * LOCAL ONLY. Data: scripts/help/fixtures/exam.ts (run it with --reset first). The parts:
 *   exam-ct  class tests            exam-cq  question papers + answer scripts
 *   exam-qs  question sets          exam-sy  syllabus + exam routine
 *   exam-sc  scholarship practice   exam-qx  Quran exam
 * The committed pictures were taken one part at a time, each from a fresh fixture
 * (`--spec exam-ct`, …); prefer that when re-shooting one part. This runner walks every part
 * in one go on one fixture.
 */
const PARTS = ["exam-ct", "exam-cq", "exam-qs", "exam-sy", "exam-sc", "exam-qx"];

exports.run = async (h) => {
  if (h.PROD) throw new Error("the exam specs save while they walk; run them locally (see their headers)");
  for (const p of PARTS) await require(`./${p}.cjs`).run(h);
};
