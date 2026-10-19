// Split one class's combined section into বালক/বালিকা — the ops half of skills/section-split.
//
// Runs ON THE VM against prod, piped on stdin, with a PLAN prepended (never commit a plan —
// it carries staff names). See skills/section-split/SKILL.md for the plan shape and the
// order of phases. Every phase is idempotent; with no phase flag it is a read-only dry run.
//
//   cat plan.cjs skills/_tools/section_split_by_gender.cjs | \
//     ssh <vm> 'cd /opt/scdhub/prod && TZ=Asia/Dhaka [APPLY=1|STUDENTS=1|POST=1] node'
//
//   APPLY=1    routine (retire the combined rows from effectiveFrom; create Boys + Girls rows)
//              + assignment rotation (end combined entries the day before; add dated entries)
//   STUDENTS=1 activate Boys/Girls, move students by gender, rehome HW/AS records, class
//              teachers (combined cleared), chat groups, SECTIONS_SPLIT audit. Run after school
//              on the LAST combined day after 21:00 (Thursday digest) — never earlier.
//   POST=1     on/after effectiveFrom: re-sync chat groups (combined grants lapse at 00:00)
//              and list anything created on the emptied section after the move.
/* global PLAN */
if (typeof PLAN === 'undefined') { console.error('prepend a plan file that defines PLAN'); process.exit(1); }
if (new Date().getTimezoneOffset() !== -360) { console.error('TZ must be Asia/Dhaka'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const uri = fs.readFileSync('.env', 'utf8').split('\n').find(l => l.startsWith('MONGODB_URI=')).slice(12).trim();
const dist = path.resolve('server/dist');
const m = require(require.resolve('mongoose', { paths: [dist] }));
const RS = require(dist + '/modules/routine/services/RoutineSlotService');
const AS = require(dist + '/modules/trackers/services/AssignmentScheduleService');
const CT = require(dist + '/modules/foundation/services/ClassTeacherService');
const chat = require(dist + '/modules/chat/services/ChatGroupService');
const { rehomeStudentRecords } = require(dist + '/modules/trackers/services/recordRehome');
const { RoutineSlot } = require(dist + '/modules/routine/models/RoutineSlot');
const { AssignmentSchedule } = require(dist + '/modules/trackers/models/AssignmentSchedule');
const { Section } = require(dist + '/modules/foundation/models/Section');
const { Student } = require(dist + '/modules/foundation/models/Student');
const { writeAudit } = require(dist + '/modules/platform/services/AuditService');

const APPLY = process.env.APPLY === '1', STUDENTS = process.env.STUDENTS === '1', POST = process.env.POST === '1';
const [y, mo, d] = PLAN.effectiveFrom.split('-').map(Number);
const EFF = new Date(y, mo - 1, d), EFF_KEY = PLAN.effectiveFrom;
const prev = new Date(y, mo - 1, d - 1);
const LAST_KEY = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU'];

const oid = (x) => new m.Types.ObjectId(String(x));
const liveOn = (at) => ({ active: true, effectiveFrom: { $lte: at }, $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: at } }] });
const live = (q) => RoutineSlot.find({ ...q, ...liveOn(EFF) }).lean();
async function settle(label, ops) {
  let pending = ops.slice(), round = 0;
  while (pending.length) {
    round++;
    const failed = [];
    for (const op of pending) {
      try { await op.run(); } catch (e) { failed.push(op); op.err = e.message; }
    }
    console.log(`${label} round ${round}: ${pending.length - failed.length} ok, ${failed.length} deferred`);
    if (failed.length === pending.length) { failed.forEach(o => console.log('  FAILED', o.desc, '-', o.err)); return false; }
    pending = failed;
  }
  return true;
}

(async () => {
  await m.connect(uri);
  const db = m.connection.db;
  console.log('DB', db.databaseName, APPLY ? 'APPLY' : '', STUDENTS ? 'STUDENTS' : '', POST ? 'POST' : '', !APPLY && !STUDENTS && !POST ? 'DRY RUN' : '');
  if (db.databaseName !== 'scdhub_prod' && process.env.ALLOW_NON_PROD !== '1') throw new Error('not prod: ' + db.databaseName);

  // ---- resolve people ----
  const users = await db.collection('users').find({}).project({ name: 1, role: 1, active: 1 }).toArray();
  const uName = Object.fromEntries(users.map(u => [String(u._id), u.name]));
  const byName = (n) => {
    const hits = users.filter(u => u.name === n && u.active !== false);
    if (hits.length !== 1) throw new Error(`teacher "${n}" matches ${hits.length} active users`);
    return String(hits[0]._id);
  };
  const principal = users.find(u => u.role === 'PRINCIPAL' && u.active !== false);
  if (!principal) throw new Error('no active PRINCIPAL to act as');
  const actorId = String(principal._id);

  // ---- resolve class + sections ----
  const cls = await db.collection('classes').findOne({ level: PLAN.classLevel, active: { $ne: false } });
  if (!cls) throw new Error('class level not found: ' + PLAN.classLevel);
  const classId = String(cls._id);
  let secs = await Section.find({ classId: cls._id }).lean();
  const combined = PLAN.combinedCode ? secs.find(s => s.code === PLAN.combinedCode) : secs.find(s => s.code === 'ALL') || (secs.length === 1 ? secs[0] : null);
  if (!combined) throw new Error('combined section not found — set PLAN.combinedCode');
  for (const [code, nameBn] of [['Boys', 'বালক'], ['Girls', 'বালিকা']]) {
    if (secs.some(s => s.code === code)) continue;
    console.log('section', code, 'missing —', APPLY ? 'creating (inactive)' : 'would create');
    if (APPLY) await Section.create({ classId: cls._id, code, nameBn, active: false });
  }
  secs = await Section.find({ classId: cls._id }).lean();
  const COMB = String(combined._id);
  const BOYS = String(secs.find(s => s.code === 'Boys')?._id || '');
  const GIRLS = String(secs.find(s => s.code === 'Girls')?._id || '');
  for (const s of secs) console.log('section', s.code, s.nameBn, 'active', s.active, 'CT', uName[String(s.classTeacherId)] || '-');
  if (combined.nameBn !== 'সম্মিলিত' && combined.nameBn !== 'মূল') console.log('WARN combined nameBn is', combined.nameBn, '— label helpers only treat মূল/সম্মিলিত as whole-class');

  // ---- routine plan ----
  const combRows = await live({ groupType: 'section', groupId: combined._id });
  const boysLive = BOYS ? await live({ groupType: 'section', groupId: oid(BOYS) }) : [];
  const girlsLive = GIRLS ? await live({ groupType: 'section', groupId: oid(GIRLS) }) : [];
  console.log(`live on ${EFF_KEY}: combined ${combRows.length}, Boys ${boysLive.length}, Girls ${girlsLive.length}`);
  const fromGrid = (grid) => grid.map(([day, p, subject, teacher]) => ({ day, p, subject, teacherId: byName(teacher) }));
  const copyComb = () => combRows.filter(r => !r.isBreak).map(r => ({ day: r.dayOfWeek, p: r.periodNumber, subject: r.subject, teacherId: String(r.teacherId) }));
  const boysPlan = PLAN.boys === 'copy' ? copyComb() : fromGrid(PLAN.boys);
  const girlsPlan = PLAN.girls === 'copy' ? copyComb() : fromGrid(PLAN.girls);
  const own = new Set([COMB, BOYS, GIRLS]);
  const others = (await live({})).filter(r => !(r.groupType === 'section' && own.has(String(r.groupId))) && r.teacherId);
  const planned = [...boysPlan.map(x => ({ ...x, sec: 'Boys' })), ...girlsPlan.map(x => ({ ...x, sec: 'Girls' }))];
  let clashes = 0;
  for (const x of planned) {
    const hit = others.some(r => String(r.teacherId) === x.teacherId && r.dayOfWeek === x.day && r.periodNumber === x.p);
    const twin = planned.some(y2 => y2 !== x && y2.teacherId === x.teacherId && y2.day === x.day && y2.p === x.p);
    const cell = planned.some(y2 => y2 !== x && y2.sec === x.sec && y2.day === x.day && y2.p === x.p);
    if (hit || twin || cell) { clashes++; console.log('CLASH', x.sec, x.day, 'P' + x.p, x.subject, uName[x.teacherId], cell ? '(two rows in one cell)' : ''); }
  }
  const count = (pl) => pl.reduce((a, x) => ((a[x.subject] = (a[x.subject] || 0) + 1), a), {});
  console.log('clashes', clashes, '| Boys', JSON.stringify(count(boysPlan)), '| Girls', JSON.stringify(count(girlsPlan)), '| combined now', JSON.stringify(count(copyComb())));
  for (const day of DAYS) {
    const line = (pl) => pl.filter(x => x.day === day).sort((a, b) => a.p - b.p).map(x => `P${x.p} ${x.subject} ${uName[x.teacherId]}`).join(' | ');
    console.log(' ', day, 'BOYS ', line(boysPlan));
    console.log(' ', day, 'GIRLS', line(girlsPlan));
  }

  // ---- leave covers booked on the combined rows from EFF ----
  const combIds = combRows.map(r => r._id);
  const covers = await db.collection('staffcoverslots').countDocuments({ routineSlotId: { $in: combIds }, dateKey: { $gte: EFF_KEY } });
  const subs = await db.collection('routinesubstitutions').countDocuments({ slotId: { $in: combIds }, date: { $gte: EFF }, active: true });
  console.log(`leave covers on combined rows from ${EFF_KEY}: ${covers} | substitutions: ${subs}${covers || subs ? '  <-- re-run CoverService.fanOutCoverSlots per live leave after APPLY' : ''}`);

  // ---- assignment rotation ----
  const ay = cls.academicYearId;
  const sched = await AssignmentSchedule.findOne({ academicYearId: ay }).lean();
  const combEntries = (sched?.entries || []).filter(e => String(e.sectionId) === COMB && (!e.effectiveTo || e.effectiveTo >= EFF_KEY));
  const teacherFor = (pl) => {
    const map = {};
    for (const x of pl) (map[x.subject] ||= new Set()).add(x.teacherId);
    return Object.fromEntries(Object.entries(map).map(([s, set]) => [s, set.size === 1 ? [...set][0] : null]));
  };
  const boysT = teacherFor(boysPlan), girlsT = teacherFor(girlsPlan);
  const rotRetire = [], rotAdd = [];
  for (const e of combEntries) {
    const bT = PLAN.boys === 'copy' ? String(e.teacherId) : boysT[e.subject];
    const gT = girlsT[e.subject];
    console.log(`  rotation wk${e.cycleWeek} ${e.subject}: ${uName[String(e.teacherId)]} -> Boys ${uName[bT] || 'NONE'} / Girls ${uName[gT] || 'NONE'}`);
    rotRetire.push({ desc: `retire wk${e.cycleWeek} ${e.subject}`, run: () => AS.retireScheduleEntry(String(ay), String(e._id), LAST_KEY) });
    const base = { academicYearId: String(ay), cycleWeek: e.cycleWeek, classId, classLevel: e.classLevel, subject: e.subject, effectiveFrom: EFF_KEY };
    if (bT) rotAdd.push({ desc: `Boys wk${e.cycleWeek} ${e.subject}`, run: () => AS.addScheduleEntry({ ...base, sectionId: BOYS, teacherId: bT }) });
    if (gT) rotAdd.push({ desc: `Girls wk${e.cycleWeek} ${e.subject}`, run: () => AS.addScheduleEntry({ ...base, sectionId: GIRLS, teacherId: gT }) });
  }

  // ---- students + open work ----
  const studs = await Student.find({ sectionId: combined._id, active: true }).select('_id gender').lean();
  console.log('combined students by gender', JSON.stringify(studs.reduce((a, s) => ((a[s.gender] = (a[s.gender] || 0) + 1), a), {})));
  const openHw = await db.collection('homeworkitems').countDocuments({ sectionId: combined._id, status: { $ne: 'issued' } });
  const openAs = await db.collection('assignmentitems').countDocuments({ sectionId: combined._id, status: 'DRAFT' });
  const mrDraft = await db.collection('monthlyreports').countDocuments({ sectionId: combined._id, status: 'DRAFT' });
  const impl = await db.collection('improvementactions').countDocuments({ sectionId: combined._id });
  console.log(`open on combined: homework not issued ${openHw} | assignment drafts ${openAs} | monthly-report drafts ${mrDraft} | improvement actions ${impl}`);

  const doRoutine = !boysLive.length || !girlsLive.length || combRows.length;
  console.log(`PLAN routine: retire ${combRows.length}, create Boys ${boysLive.length ? 0 : boysPlan.length}, Girls ${girlsLive.length ? 0 : girlsPlan.length} | rotation: retire ${rotRetire.length}, add ${rotAdd.length}`);

  if (APPLY) {
    if (clashes) throw new Error('clashes — not applying');
    if (!BOYS || !GIRLS) throw new Error('Boys/Girls sections missing');
    if (doRoutine) {
      const mk = (secId, x) => ({ desc: `${secId === BOYS ? 'Boys' : 'Girls'} ${x.day}P${x.p} ${x.subject}`, run: () => RS.createRoutineSlot({ groupType: 'section', groupId: secId, dayOfWeek: x.day, periodNumber: x.p, subject: x.subject, track: 'general', isBreak: false, teacherId: x.teacherId, roomId: null, effectiveFrom: EFF, createdBy: actorId }) });
      const creates = [];
      if (!boysLive.length) boysPlan.forEach(x => creates.push(mk(BOYS, x)));
      if (!girlsLive.length) girlsPlan.forEach(x => creates.push(mk(GIRLS, x)));
      // Retire BEFORE create: kept teachers would otherwise clash with themselves.
      if (!(await settle('retire', combRows.map(r => ({ desc: `retire ${r.dayOfWeek}P${r.periodNumber}`, run: () => RS.deleteRoutineSlot(String(r._id), actorId, EFF) }))))) return m.disconnect();
      if (!(await settle('create', creates))) return m.disconnect();
    }
    if (!(await settle('rotation-retire', rotRetire))) return m.disconnect();
    if (!(await settle('rotation-add', rotAdd))) return m.disconnect();
  }

  if (STUDENTS) {
    if (studs.some(s => s.gender !== 'male' && s.gender !== 'female')) throw new Error('student without male/female gender');
    if ((openHw || openAs) && process.env.FORCE !== '1') throw new Error('open homework/assignment work on the combined section — issue/confirm it first (or FORCE=1)');
    await Section.updateMany({ _id: { $in: [BOYS, GIRLS].map(oid) } }, { $set: { active: true } });
    for (const [gen, to] of [['male', BOYS], ['female', GIRLS]]) {
      const ids = studs.filter(s => s.gender === gen).map(s => s._id);
      if (!ids.length) continue;
      await Student.updateMany({ _id: { $in: ids } }, { $set: { sectionId: oid(to) } });
      console.log('moved', ids.length, gen, '-> records', JSON.stringify(await rehomeStudentRecords(ids, to)));
    }
    // Legacy section-shaped attendance days (before the Quran-unit cutover, D-#278) are read through
    // the student's CURRENT section: copy each to both halves with that half's absentees. The
    // originals stay on the combined section (past-attendance amendment). Idempotent (unique
    // (sectionId, dateKey) index + $setOnInsert).
    let attCopied = 0;
    const legacy = await db.collection('studentattendancedays').find({ sectionId: combined._id }).toArray();
    for (const [gen, to] of [['male', BOYS], ['female', GIRLS]]) {
      const half = new Set(studs.filter(s => s.gender === gen).map(s => String(s._id)));
      for (const row of legacy) {
        const r = await db.collection('studentattendancedays').updateOne(
          { sectionId: oid(to), dateKey: row.dateKey },
          { $setOnInsert: { sectionId: oid(to), dateKey: row.dateKey, absentStudentIds: (row.absentStudentIds || []).filter(x => half.has(String(x))), markedBy: row.markedBy, markedAt: row.markedAt, ...(row.amendedBy ? { amendedBy: row.amendedBy, amendedAt: row.amendedAt } : {}), createdAt: new Date(), updatedAt: new Date(), __v: 0 } },
          { upsert: true },
        );
        attCopied += r.upsertedCount;
      }
    }
    console.log('legacy attendance days on combined', legacy.length, '-> rows copied to the halves', attCopied);
    if (PLAN.classTeachers?.boys) await CT.assignClassTeacher(BOYS, byName(PLAN.classTeachers.boys), actorId);
    if (PLAN.classTeachers?.girls) await CT.assignClassTeacher(GIRLS, byName(PLAN.classTeachers.girls), actorId);
    // The emptied combined section stays ACTIVE (past-attendance amendment) but has no coordinator.
    if (combined.classTeacherId) await CT.assignClassTeacher(COMB, null, actorId);
    for (const s of [BOYS, GIRLS, COMB]) await chat.syncSectionGroup(s);
    const left = await db.collection('homeworkstudentrecords').countDocuments({ sectionId: combined._id }) + await db.collection('assignmentstudentrecords').countDocuments({ sectionId: combined._id });
    console.log('records still on combined after rehome', left);
    await writeAudit({ eventKind: 'SECTIONS_SPLIT', actorId, targetId: combined._id, targetKind: 'Section', meta: { classId, movedStudents: studs.length, byGender: true, effective: EFF_KEY, attendanceDaysCopied: attCopied } });
  }

  if (POST) {
    if (new Date() < EFF) throw new Error(`POST is for ${EFF_KEY} or later`);
    for (const s of [COMB, BOYS, GIRLS]) console.log('chat sync', s, JSON.stringify(await chat.syncSectionGroup(s)));
    const moved = await db.collection('audits').findOne({ eventKind: 'SECTIONS_SPLIT', targetId: combined._id }, { sort: { _id: -1 } });
    if (moved) {
      const since = moved._id.getTimestamp();
      const late = async (c, f) => (await db.collection(c).find({ sectionId: combined._id, createdAt: { $gte: since } }).project({ [f]: 1, status: 1 }).toArray()).map(x => `${x[f]}:${x.status}`);
      console.log('created on the emptied section after the move — homework', await late('homeworkitems', 'hwId'), '| assignments', await late('assignmentitems', 'asId'), '| class tests', await late('classtests', 'testId'));
    } else console.log('no SECTIONS_SPLIT audit yet — STUDENTS has not run');
  }

  if (APPLY || STUDENTS || POST) {
    const rb = await live({ groupType: 'section', groupId: { $in: [COMB, BOYS, GIRLS].filter(Boolean).map(oid) } });
    const lbl = (id) => (id === COMB ? 'combined' : id === BOYS ? 'Boys' : 'Girls');
    const c = rb.reduce((a, r) => ((a[lbl(String(r.groupId))] = (a[lbl(String(r.groupId))] || 0) + 1), a), {});
    const n = {};
    for (const s of [COMB, BOYS, GIRLS]) n[lbl(s)] = await Student.countDocuments({ sectionId: oid(s), active: true });
    console.log(`READBACK rows live on ${EFF_KEY}`, JSON.stringify(c), '| students', JSON.stringify(n));
  }
  await m.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
