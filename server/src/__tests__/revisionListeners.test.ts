/**
 * SR-6 — weekly target per Hifz level, standing listeners, the listener's list, release
 * (docs/prd-sr6-listeners.md, D-#1170–#1174), on an in-memory MongoDB.
 *   • a target is per LEVEL: both Hifz 1 groups (boys + girls) read the same one; last
 *     week's comes back as `previous` for prefill; a non-Saturday / bad range is refused
 *   • a student has one standing listener; re-assigning moves them, null takes them away;
 *     only someone who may record results can be a listener; every change is audited
 *   • myListening = only the caller's students, each with the level's target and entry
 *   • releaseBoard counts recorded / waiting per listener; releaseSaturday sends only the
 *     recorded, unsent Hifz entries of that Saturday (delivery itself is SR-2, stubbed here)
 * Every name here is invented.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mockDeliver = jest.fn(async (entryId: string) => ({ entryId }));
jest.mock("../modules/saturday-revision/services/RevisionDeliveryService", () => ({
  deliverEntry: (id: string) => mockDeliver(id),
}));

import { Student } from "../modules/foundation/models/Student";
import { User } from "../modules/foundation/models/User";
import { SubjectGroup } from "../modules/routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../modules/routine/models/SubjectGroupMembership";
import { RevisionEntry } from "../modules/saturday-revision/models/RevisionEntry";
import { RevisionTarget } from "../modules/saturday-revision/models/RevisionTarget";
import { Audit } from "../modules/platform/models/Audit";
import {
  revisionTargets,
  setRevisionTarget,
  listenerBoard,
  setRevisionListener,
  isAssignedListener,
  myListening,
  releaseBoard,
  releaseSaturday,
} from "../modules/saturday-revision/services/RevisionListenerService";
import { RevisionError, recordEntry } from "../modules/saturday-revision/services/RevisionService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

// Saturdays (QURAN_ONLY by the D-#50 calendar) and a Sunday.
const SAT = new Date("2026-11-14");
const LAST_SAT = new Date("2026-11-07");
const SUNDAY = new Date("2026-11-15");

let teacherA = "";
let teacherB = "";
let guardianish = "";
let boy1 = "";
let boy2 = "";
let girl1 = "";
let h3 = "";
let h1Boys = "";

beforeAll(async () => {
  const user = (name: string, role: string, phone: string) =>
    User.create({ name, role, passwordHash: "x", active: true, phone });
  teacherA = (await user("Rahim Uddin", "TEACHER", "01700000101"))._id.toString();
  teacherB = (await user("Karim Mia", "TEACHER", "01700000102"))._id.toString();
  // A teacher with the recording switch taken away cannot be a listener.
  const revoked = await User.create({
    name: "Salam Khan",
    role: "TEACHER",
    passwordHash: "x",
    active: true,
    phone: "01700000103",
    revokedPermissions: ["saturday_revision:enter_results"],
  });
  guardianish = revoked._id.toString();

  const group = (code: string, level: string, gender: string) =>
    SubjectGroup.create({ track: "quran", level, gender, code, nameBn: `${level} ${gender}`, active: true });
  const g3 = await group("QH3M", "Hifz 3", "mixed");
  const g1b = await group("QH1B", "Hifz 1", "boys");
  const g1g = await group("QH1G", "Hifz 1", "girls");
  await group("QQ1B", "Qaida", "boys"); // not Hifz — never in the flow
  h3 = g3._id.toString();
  h1Boys = g1b._id.toString();

  const student = async (schoolId: string, name: string, groupId: Types.ObjectId) => {
    const s = await Student.create({ schoolId, name, classId: new Types.ObjectId(), sectionId: new Types.ObjectId(), active: true });
    await SubjectGroupMembership.create({ groupId, studentId: s._id, track: "quran" });
    return s._id.toString();
  };
  boy1 = await student("9001", "Abdullah Noor", g3._id);
  boy2 = await student("9002", "Umar Faruk", g1b._id);
  girl1 = await student("9003", "Maryam Akter", g1g._id);
});

const range = (category: string, fromSurah: number, fromAyah: number, toSurah: number, toAyah: number) => ({
  category,
  fromSurah,
  fromAyah,
  toSurah,
  toAyah,
});

test("a target is per level: both Hifz 1 groups share it, last week's comes back for prefill", async () => {
  await setRevisionTarget({ level: "Hifz 1", date: LAST_SAT, portions: [range("SABAQ", 67, 1, 67, 15)], actorId: teacherA });
  const saved = await setRevisionTarget({
    level: "Hifz 1",
    date: SAT,
    portions: [range("MANZIL", 78, 1, 114, 6), range("SABAQ", 67, 16, 67, 30)],
    actorId: teacherA,
  });
  expect(saved.portions.map((p) => p.category)).toEqual(["SABAQ", "MANZIL"]); // category order, not input order
  expect(saved.setByName).toBe("Rahim Uddin");

  const rows = await revisionTargets(SAT);
  expect(rows.map((r) => r.level)).toEqual(["Hifz 1", "Hifz 3"]); // Qaida is not a Hifz level
  const h1 = rows.find((r) => r.level === "Hifz 1")!;
  expect(h1.groupNames).toHaveLength(2);
  expect(h1.studentCount).toBe(2);
  expect(h1.target?.portions).toHaveLength(2);
  expect(h1.previous?.portions[0]).toMatchObject({ category: "SABAQ", fromSurah: 67, toAyah: 15 });
  expect(rows.find((r) => r.level === "Hifz 3")!.target).toBeNull();

  // Re-declaring replaces, never duplicates.
  await setRevisionTarget({ level: "Hifz 1", date: SAT, portions: [range("SABAQ", 67, 16, 67, 30)], actorId: teacherB });
  expect(await RevisionTarget.countDocuments({ level: "Hifz 1", date: SAT })).toBe(1);
  expect(await Audit.countDocuments({ eventKind: "SR_TARGET_SET" })).toBe(3);
});

test("a target is refused off a Saturday, for an unknown level, a bad range or a repeated part", async () => {
  const ok = [range("SABAQ", 2, 1, 2, 10)];
  await expect(setRevisionTarget({ level: "Hifz 3", date: SUNDAY, portions: ok, actorId: teacherA })).rejects.toThrow(RevisionError);
  await expect(setRevisionTarget({ level: "Qaida", date: SAT, portions: ok, actorId: teacherA })).rejects.toThrow("Unknown Hifz level");
  await expect(
    setRevisionTarget({ level: "Hifz 3", date: SAT, portions: [range("SABAQ", 2, 10, 2, 1)], actorId: teacherA }),
  ).rejects.toThrow("Invalid range");
  await expect(
    setRevisionTarget({ level: "Hifz 3", date: SAT, portions: [...ok, ...ok], actorId: teacherA }),
  ).rejects.toThrow(RevisionError);
  await expect(setRevisionTarget({ level: "Hifz 3", date: SAT, portions: [], actorId: teacherA })).rejects.toThrow(RevisionError);
});

test("a student has one standing listener: assign, move, take away — audited; only recorders can listen", async () => {
  await setRevisionListener({ studentId: boy1, listenerUserId: teacherA, actorId: teacherB });
  await setRevisionListener({ studentId: boy2, listenerUserId: teacherA, actorId: teacherB });
  await setRevisionListener({ studentId: girl1, listenerUserId: teacherA, actorId: teacherB });
  // Move one to B; take one away.
  await setRevisionListener({ studentId: boy2, listenerUserId: teacherB, actorId: teacherB });
  await setRevisionListener({ studentId: girl1, listenerUserId: null, actorId: teacherB });

  const board = await listenerBoard();
  const of = (id: string) => board.students.find((s) => s.studentId === id)?.listenerUserId;
  expect(of(boy1)).toBe(teacherA);
  expect(of(boy2)).toBe(teacherB);
  expect(of(girl1)).toBeNull();
  expect(board.listeners.map((l) => l.userId)).toEqual(expect.arrayContaining([teacherA, teacherB]));
  expect(board.listeners.map((l) => l.userId)).not.toContain(guardianish);

  expect(await isAssignedListener(teacherA, boy1)).toBe(true);
  expect(await isAssignedListener(teacherA, boy2)).toBe(false);

  await expect(setRevisionListener({ studentId: girl1, listenerUserId: guardianish, actorId: teacherB })).rejects.toThrow(RevisionError);
  const audits = await Audit.find({ eventKind: "SR_LISTENER_SET", targetId: new Types.ObjectId(boy2) }).sort({ _id: 1 }).lean();
  expect(audits.map((a) => (a.meta as { to: string }).to)).toEqual([teacherA, teacherB]);
});

test("myListening: only my students, each with the level's target and entry so far", async () => {
  await RevisionEntry.create({
    groupId: new Types.ObjectId(h3),
    studentId: new Types.ObjectId(boy1),
    date: SAT,
    present: true,
    portions: [{ category: "SABAQ", status: "COMPLETED", fromSurah: 2, fromAyah: 1, toSurah: 2, toAyah: 10, tanbih: 1, fath: 2, mistakes: { harf: 0, ghunnah: 1, madd: 0, other: 0 }, note: "ভালো" }],
    teacherUserId: new Types.ObjectId(teacherA),
  });
  const mineA = await myListening(teacherA, SAT);
  expect(mineA.map((r) => r.studentId)).toEqual([boy1]);
  expect(mineA[0].entry?.portions[0].note).toBe("ভালো");
  expect(mineA[0].target).toBeNull(); // Hifz 3 has no target this week

  const mineB = await myListening(teacherB, SAT);
  expect(mineB.map((r) => r.studentId)).toEqual([boy2]);
  expect(mineB[0].entry).toBeNull();
  expect(mineB[0].target?.portions[0].category).toBe("SABAQ"); // Hifz 1's target
  expect(mineB[0].groupId).toBe(h1Boys);
});

test("release board + release: sends only recorded, unsent Hifz entries of that Saturday", async () => {
  const board = await releaseBoard(SAT);
  expect(board.ready.map((r) => r.entry.studentId)).toEqual([boy1]);
  expect(board.ready[0].recordedByName).toBe("Rahim Uddin");
  expect(board.pending.map((p) => p.studentId).sort()).toEqual([boy2, girl1].sort());
  expect(board.pending.find((p) => p.studentId === girl1)?.listenerName).toBeNull();
  const a = board.listeners.find((l) => l.userId === teacherA)!;
  expect([a.assigned, a.recorded]).toEqual([1, 1]);
  const b = board.listeners.find((l) => l.userId === teacherB)!;
  expect([b.assigned, b.recorded]).toEqual([1, 0]);

  // An already-sent entry on the same Saturday and one on another Saturday are left alone.
  await RevisionEntry.create({
    groupId: new Types.ObjectId(h1Boys),
    studentId: new Types.ObjectId(boy2),
    date: LAST_SAT,
    present: false,
    portions: [],
    teacherUserId: new Types.ObjectId(teacherB),
  });

  mockDeliver.mockClear();
  const out = await releaseSaturday(SAT, teacherB);
  expect(out).toHaveLength(1);
  expect(mockDeliver).toHaveBeenCalledTimes(1);
  const sent = (await RevisionEntry.findOne({ studentId: new Types.ObjectId(boy1), date: SAT }).lean())!;
  expect(mockDeliver).toHaveBeenCalledWith(sent._id.toString());
  expect(await Audit.countDocuments({ eventKind: "SR_SATURDAY_RELEASED" })).toBe(1);
});

test("autosave (D-#1180): a half-marked entry is saved but waits, is never released, and audits only on finish", async () => {
  const m = (await SubjectGroupMembership.findOne({ studentId: new Types.ObjectId(girl1) }).lean())!;
  const audits = () => Audit.countDocuments({ eventKind: "SR_REVISION_RECORDED", targetKind: "RevisionEntry" });
  const before = await audits();
  const portion = { category: "SABAQ", status: "PARTIAL", fromSurah: 67, fromAyah: 16, toSurah: 67, toAyah: 30, fath: 1 };
  // Two taps, saved mid-marking.
  await recordEntry({ groupId: m.groupId.toString(), studentId: girl1, date: SAT, present: true, portions: [portion], actorId: teacherA, inProgress: true });
  const mid = await recordEntry({ groupId: m.groupId.toString(), studentId: girl1, date: SAT, present: true, portions: [{ ...portion, fath: 2 }], actorId: teacherA, inProgress: true });
  expect(mid.inProgress).toBe(true);
  expect(mid.portions[0].fath).toBe(2);
  expect(await audits()).toBe(before); // no audit row per tap

  const board = await releaseBoard(SAT);
  expect(board.ready.map((r) => r.entry.studentId)).not.toContain(girl1);
  expect(board.pending.find((p) => p.studentId === girl1)?.inProgress).toBe(true);
  mockDeliver.mockClear();
  await releaseSaturday(SAT, teacherB);
  expect(mockDeliver).not.toHaveBeenCalledWith(mid.id);

  // The listener taps শেষ: finished, audited once, now ready.
  const done = await recordEntry({ groupId: m.groupId.toString(), studentId: girl1, date: SAT, present: true, portions: [{ ...portion, fath: 2 }], actorId: teacherA, inProgress: false });
  expect(done.inProgress).toBe(false);
  expect(await audits()).toBe(before + 1);
  const after = await releaseBoard(SAT);
  expect(after.ready.map((r) => r.entry.studentId)).toContain(girl1);
  expect(after.pending.map((p) => p.studentId)).not.toContain(girl1);
});
