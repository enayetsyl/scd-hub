/**
 * STEP 1 — runs ON THE VM, piped to node on stdin. Read-only.
 *
 *   ssh -i <key> deploy@<vm> 'cd /opt/scdhub/prod && node' < export.cjs > out/data.json
 *
 * Emits ONE pseudonymised JSON object on stdout; progress on stderr. Student ids
 * are salted hashes — no name, phone, address or guardian field ever leaves the
 * VM. That is not only an ADR-005 courtesy: a read that returns real names is
 * refused by the permission classifier as [PII Data Handling], so the export
 * fails halfway. Keep it hashed.
 *
 * The SALT is fixed so this export and attendance.cjs produce the SAME hash for
 * the same student and the two files can be joined. Change it and they stop
 * joining.
 */
const fs = require('fs');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const uri = fs.readFileSync('.env', 'utf8').split('\n')
  .map((l) => l.trim())
  .find((l) => l.startsWith('MONGODB_URI='))
  .slice('MONGODB_URI='.length).trim().replace(/^["']|["']$/g, '');

const SALT = process.env.CORR_SALT || 'scd-corr-study-v1';
const h = (v) => (v == null ? null
  : crypto.createHash('sha256').update(SALT + String(v)).digest('hex').slice(0, 10));
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d || null));

(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  if (db.databaseName !== 'scdhub_prod') throw new Error('wrong db: ' + db.databaseName);
  const C = (n) => db.collection(n);

  const classes = await C('classes').find({}).toArray();
  const lvlOf = new Map(classes.map((c) => [String(c._id), c.level]));

  const students = (await C('students').find({}).toArray()).map((s) => ({
    s: h(s._id),
    lvl: lvlOf.get(String(s.classId)) ?? null,
    sec: h(s.sectionId),
    g: s.gender || null,
    active: !!s.active,
  }));

  const tests = (await C('classtests').find({}).toArray()).map((t) => ({
    t: h(t._id),
    subj: t.subject,
    date: day(t.examDate),
    total: t.totalMarks,
    pass: t.passMark,
    status: t.status,
    lvl: t.classLevel ?? null,
    sec: h(t.sectionId),
    grp: h(t.subjectGroupId),
  }));

  const tres = (await C('classtestresults').find({}).toArray()).map((r) => ({
    t: h(r.testId),
    s: h(r.studentId),
    st: r.status,
    m: typeof r.marks === 'number' ? r.marks : null,
  }));

  const hwi = (await C('homeworkitems').find({}).toArray()).map((i) => ({
    i: h(i._id),
    subj: i.subject,
    lvl: i.classLevel ?? lvlOf.get(String(i.classId)) ?? null,
    sec: h(i.sectionId),
    given: day(i.dateGiven),
    status: i.status,
  }));

  const hwr = (await C('homeworkstudentrecords').find({}).toArray()).map((r) => ({
    i: h(r.hwItemId), s: h(r.studentId), st: r.state, r: r.result || null,
    due: day(r.dueDate), ch: r.chaseCount || 0, re: r.resubOf ? 1 : 0,
    c: day(r.createdAt), u: day(r.updatedAt),
  }));

  const asi = (await C('assignmentitems').find({}).toArray()).map((i) => ({
    i: h(i._id), subj: i.subject, lvl: i.classLevel ?? null, sec: h(i.sectionId),
    del: day(i.deliveryDate), due: day(i.dueDate), status: i.status,
    total: typeof i.totalMarks === 'number' ? i.totalMarks : null,
  }));

  const asr = (await C('assignmentstudentrecords').find({}).toArray()).map((r) => ({
    i: h(r.asItemId), s: h(r.studentId), st: r.state, r: r.result || null,
    m: typeof r.marks === 'number' ? r.marks : null, due: day(r.dueDate),
    ch: r.chaseCount || 0, re: r.resubOf ? 1 : 0, c: day(r.createdAt), u: day(r.updatedAt),
  }));

  const out = { students, tests, tres, hwi, hwr, asi, asr };
  for (const [k, v] of Object.entries(out)) console.error(k, v.length);
  process.stdout.write(JSON.stringify(out));
  await client.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
