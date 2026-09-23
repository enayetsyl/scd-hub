/**
 * STEP 2 — runs ON THE VM, piped to node on stdin. Read-only.
 *
 *   ssh -i <key> deploy@<vm> \
 *     'cd /opt/scdhub/prod && CORR_FROM=YYYY-MM-DD CORR_TO=YYYY-MM-DD node' \
 *     < attendance.cjs > out/att.json
 *
 * ── THE TRAP THIS SCRIPT EXISTS TO AVOID ────────────────────────────────────
 * Do NOT read `studentattendancedays` and group by `sectionId`. Attendance is
 * keyed to the ATTENDANCE UNIT (attendanceUnit.ts, D-#278, live 2026-07-13):
 *   Class 1–5      → the cross-section QURAN SubjectGroup (P1+P2 is the Quran
 *                    double, so that is where the child is at day-start)
 *   Nursery / KG   → the section's own routine
 *   before cutover → the legacy section shape
 * Grouping by section therefore finds only the pre-cutover leftovers for C1–5
 * and makes a complete dataset look ~15% captured. It happened once; it cost a
 * published conclusion that the attendance question was unanswerable.
 *
 * So this calls the app's OWN compiled roll-up — `studentAttendanceHistory`,
 * which merges both units, de-duplicates across the cutover and flags
 * leave-covered days. The numbers it returns are exactly what the attendance
 * reports show. Building group denominators from CURRENT SubjectGroupMembership
 * also undercounts, because memberships move and are not history-tracked.
 *
 * Sanity check after running: attendance should correlate about -0.95 with the
 * homework ABSENT_REDELIVER share (analyze.cjs prints it). Anything weaker
 * means the wrong unit was read.
 */
const fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');

const uri = fs.readFileSync('.env', 'utf8').split('\n')
  .map((l) => l.trim())
  .find((l) => l.startsWith('MONGODB_URI='))
  .slice('MONGODB_URI='.length).trim().replace(/^["']|["']$/g, '');

const SALT = process.env.CORR_SALT || 'scd-corr-study-v1';
const h = (v) => (v == null ? null
  : crypto.createHash('sha256').update(SALT + String(v)).digest('hex').slice(0, 10));

const FROM = process.env.CORR_FROM;
const TO = process.env.CORR_TO;
if (!FROM || !TO) throw new Error('set CORR_FROM and CORR_TO (YYYY-MM-DD)');

(async () => {
  await mongoose.connect(uri);
  const dbName = mongoose.connection.db.databaseName;
  if (dbName !== 'scdhub_prod') throw new Error('wrong db: ' + dbName);
  console.error('db =', dbName, '| window', FROM, '->', TO);

  const RS = require('./server/dist/modules/attendance/services/AttendanceReportService');
  const AU = require('./server/dist/modules/attendance/attendanceUnit');
  const { Student } = require('./server/dist/modules/foundation/models/Student');

  const students = await Student.find({}).lean();
  const units = await AU.resolveUnitsForIds(students.map((s) => s._id.toString()));

  const rows = [];
  for (const s of students) {
    const id = s._id.toString();
    const hist = await RS.studentAttendanceHistory(id, FROM, TO);
    const u = units.get(id);
    rows.push({
      s: h(id),
      unit: u ? u.unitType : null,
      marked: hist.markedDays,
      absent: hist.absentDays,
      leaveCovered: hist.days.filter((d) => d.leaveCovered).length,
      pct: hist.presentPct,
      days: hist.days.map((d) => [d.dateKey, d.absent ? 1 : 0, d.leaveCovered ? 1 : 0]),
    });
  }

  const byUnit = {};
  for (const r of rows) byUnit[r.unit] = (byUnit[r.unit] || 0) + 1;
  const mk = rows.map((r) => r.marked).sort((a, b) => a - b);
  console.error('students', rows.length, '| capture unit', JSON.stringify(byUnit));
  console.error('marked days min/median/max:', mk[0], mk[Math.floor(mk.length / 2)], mk[mk.length - 1]);
  if (byUnit.subjectgroup === undefined) {
    console.error('WARNING: no student resolved to a subjectgroup unit — check the Quran groups');
  }

  process.stdout.write(JSON.stringify({ from: FROM, to: TO, rows }));
  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
