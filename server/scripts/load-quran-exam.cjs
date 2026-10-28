/**
 * Load a Quran oral exam plan (QX-1, docs/prd-quran-exam.md, D-#875) into the database
 * through the app's own compiled services (server/dist), never raw writes.
 *
 * The plan is a JSON file made outside the repo (it names students, so it never lives in
 * this public repo): { examName, makeUpDateKey, papers: [...], sittings: [{ student, group,
 * level, dateKey, start, end, examiner, paras, portionLabel }] }. Students are matched by
 * exact name INSIDE their Quran group (SubjectGroup.code); examiners by exact User.name.
 * Anything missing or ambiguous stops the run.
 *
 * Read-only by default (prints what it would do). APPLY=1 writes. Re-running is safe:
 * sittings already there are skipped, papers are upserted (refused once marked).
 *
 *   cd /opt/scdhub/<env> && PLAN_FILE=/path/plan.json [APPLY=1] [ACTOR_ID=<userId>] node server/scripts/load-quran-exam.cjs
 *   or pipe it with the plan inlined:  (printf 'globalThis.PLAN = '; cat plan.json; printf ';\n'; cat load-quran-exam.cjs) | node
 *
 * Run from the repo/deploy root (it reads ./.env and ./server/dist).
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const serverRequire = (m) => require(require.resolve(m, { paths: [path.join(ROOT, "server"), ROOT] }));
const mongoose = serverRequire("mongoose");

function readUri() {
  // Local rehearsal only (an in-memory DB); a deploy run always reads ./.env.
  if (process.env.LOAD_MONGODB_URI) return process.env.LOAD_MONGODB_URI;
  const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const line = env.split("\n").find((l) => l.startsWith("MONGODB_URI="));
  if (!line) throw new Error("MONGODB_URI not in .env");
  return line.slice("MONGODB_URI=".length).trim();
}

(async () => {
  const plan = globalThis.PLAN ?? JSON.parse(fs.readFileSync(process.env.PLAN_FILE, "utf8"));
  const APPLY = process.env.APPLY === "1";
  await mongoose.connect(readUri());
  const db = mongoose.connection.db;
  console.log(`DB ${db.databaseName} · ${APPLY ? "APPLY" : "dry run"} · ${plan.sittings.length} sittings, ${plan.papers.length} papers`);

  const dist = (p) => require(path.join(ROOT, "server", "dist", p));
  const { Exam } = dist("modules/exams/models/Exam.js");
  const { User } = dist("modules/foundation/models/User.js");
  const { Student } = dist("modules/foundation/models/Student.js");
  const { SubjectGroup } = dist("modules/routine/models/SubjectGroup.js");
  const { SubjectGroupMembership } = dist("modules/routine/models/SubjectGroupMembership.js");
  const svc = dist("modules/quran-exam/services/QuranExamService.js");

  const exams = await Exam.find({ name: plan.examName }).lean();
  if (exams.length !== 1) throw new Error(`exam "${plan.examName}": ${exams.length} found`);
  const examId = String(exams[0]._id);

  const actorId = process.env.ACTOR_ID
    ?? String((await User.findOne({ role: "PRINCIPAL", active: true }, { _id: 1 }).lean())?._id ?? "");
  if (!actorId) throw new Error("no ACTOR_ID and no active Principal");

  const problems = [];
  const groups = new Map();
  for (const code of [...new Set(plan.sittings.map((s) => s.group))]) {
    const g = await SubjectGroup.findOne({ code, active: true }).lean();
    if (!g) { problems.push(`group ${code} not found`); continue; }
    const mem = await SubjectGroupMembership.find({ groupId: g._id }, { studentId: 1 }).lean();
    const students = await Student.find({ _id: { $in: mem.map((m) => m.studentId) }, active: { $ne: false } }, { name: 1 }).lean();
    groups.set(code, { group: g, students });
  }
  const examinerIds = new Map();
  for (const name of [...new Set(plan.sittings.map((s) => s.examiner))]) {
    const users = await User.find({ name, active: true }, { _id: 1 }).lean();
    if (users.length !== 1) problems.push(`examiner "${name}": ${users.length} active users`);
    else examinerIds.set(name, String(users[0]._id));
  }

  const input = [];
  for (const s of plan.sittings) {
    const g = groups.get(s.group);
    if (!g) continue;
    const hits = g.students.filter((x) => x.name.trim() === s.student.trim());
    if (hits.length !== 1) { problems.push(`${s.student} in ${s.group}: ${hits.length} matches`); continue; }
    if (g.group.level !== s.level) problems.push(`${s.group} level is "${g.group.level}", plan says "${s.level}"`);
    input.push({
      studentId: String(hits[0]._id), groupId: String(g.group._id), level: s.level, dateKey: s.dateKey,
      start: s.start, end: s.end, examinerId: examinerIds.get(s.examiner), paras: s.paras ?? [], portionLabel: s.portionLabel,
    });
  }

  const byDay = {};
  for (const s of plan.sittings) byDay[s.dateKey] = (byDay[s.dateKey] ?? 0) + 1;
  console.log("sittings per day:", JSON.stringify(byDay));
  console.log("examiners:", [...examinerIds.keys()].join(", "));
  const missingFromPlan = [];
  for (const [code, g] of groups) {
    const planned = new Set(plan.sittings.filter((s) => s.group === code).map((s) => s.student.trim()));
    for (const st of g.students) if (!planned.has(st.name.trim())) missingFromPlan.push(`${st.name} (${code})`);
  }
  if (missingFromPlan.length) console.log(`WARNING — in a group but not in the plan (${missingFromPlan.length}):`, missingFromPlan.join("; "));
  if (problems.length) {
    console.log(`STOP — ${problems.length} problem(s):\n  ` + problems.join("\n  "));
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`resolved ${input.length}/${plan.sittings.length} sittings; actor ${actorId}`);

  if (APPLY) {
    const r = await svc.loadQuranExamSittings(actorId, examId, input, plan.makeUpDateKey ?? null);
    console.log(`sittings: created ${r.created}, skipped ${r.skipped}`);
    const ctx = { auth: { userId: actorId, role: "PRINCIPAL" } };
    for (const p of plan.papers) {
      const saved = await svc.saveQuranExamPaper(ctx, examId, p);
      console.log(`paper ${saved.level}: ${saved.scheme} /${saved.fullMarks}`);
    }
    const [overview] = (await svc.quranExamOverviews()).filter((o) => o.examId === examId);
    console.log("read-back:", JSON.stringify(overview.days), overview.status);
  }
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error("ERR", e.message);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
