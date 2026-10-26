/**
 * D-#772 — the RECORD OWNER rule on every item-keyed surface after a gender split.
 *
 * Class 3 splits on Sun 2026-10-25. Work delivered on Thu 22 Oct on the combined
 * section (সম্মিলিত, ALL) keeps item.sectionId = ALL and the combined-section teacher
 * (X); `rehomeStudentRecords` moves its records to বালক (teacher B) and বালিকা
 * (teacher G). The combined section's routine rows END on 24 Oct.
 *
 * Owner rule: a record on its item's section belongs to the item's teacher (as before);
 * a rehomed record belongs to the routine subject teacher of the RECORD's section,
 * evaluated on max(item date, now). So: a rehomed বালিকা record is counted for G and
 * NOT for X; a same-section record (X's own item on another class) behaves exactly as
 * before.
 *
 * Runs against an in-memory MongoDB: the surfaces join items, records and the routine.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../modules/trackers/models/HomeworkStudentRecord";
import { AssignmentItem } from "../modules/trackers/models/AssignmentItem";
import { AssignmentStudentRecord } from "../modules/trackers/models/AssignmentStudentRecord";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { Section } from "../modules/foundation/models/Section";
import { Class } from "../modules/foundation/models/Class";
import { User } from "../modules/foundation/models/User";
import {
  passOnItemOrRecordSection,
  recordOwnerKey,
  resolveRecordOwners,
} from "../modules/trackers/recordOwner";
import { myAssignmentLifecycle } from "../modules/trackers/services/AssignmentLifecycleService";
import {
  homeworkClassOverview,
  homeworkSectionOverview,
  homeworkSummary,
} from "../modules/trackers/services/HomeworkSummaryService";
import {
  homeworkLifecyclePending,
  homeworkLifecycleReport,
} from "../modules/trackers/services/HomeworkLifecycleReportService";
import { homeworkCheckCardsForMonth } from "../modules/workboard/services/WorkBoardService";
import { monthlyPendingWork, monthlyTeacherChase } from "../modules/reports/services/MonthlyPendingWorkService";
import { updateAssignmentItem } from "../modules/trackers/services/AssignmentService";
import { listStudentRecords } from "../modules/trackers/services/HomeworkService";
import { graphql, type ExecutionResult } from "graphql";
import { Subject } from "../modules/foundation/models/Subject";
import { ScopeGrant } from "../modules/foundation/models/ScopeGrant";
import { builder } from "../schema";
import "../modules/trackers/resolvers/assignment";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;

const id = () => new Types.ObjectId();
const YEAR = id();
const C3 = id();
const C2 = id();
const ALL = id();
const BOYS = id();
const GIRLS = id();
const S2 = id(); // another class's single section — the same-section control
const X = id(); // the combined-section MATH teacher (and C2's)
const B = id(); // বালক MATH teacher from the split
const G = id(); // বালিকা MATH teacher from the split
const U = id(); // unrelated teacher

const day = (d: number) => new Date(Date.UTC(2026, 9, d)); // 2026-10-<d>
const GIVEN_ON = day(22); // Thu — delivered on সম্মিলিত
const NOW = new Date(2026, 9, 27, 10, 0, 0); // Tue 27 Oct, after the split
const FROM = "2026-10-15";
const TO = "2026-10-31";

const AS_ALL = id();
const AS_S2 = id();
const HW_ALL = id();
const HW_S2 = id();

let seq = 0;
const stamps = (state: string) =>
  state === "GIVEN"
    ? [{ state: "GIVEN", at: day(22) }]
    : [
        { state: "GIVEN", at: day(22) },
        { state, at: day(23) },
      ];

async function asRecord(asItemId: Types.ObjectId, sectionId: Types.ObjectId, classId: Types.ObjectId, state: string) {
  await AssignmentStudentRecord.collection.insertOne({
    asItemId,
    asId: "AS-X",
    studentId: id(),
    sectionId,
    classId,
    state,
    stateDates: stamps(state),
    dueDate: day(25),
    chaseCount: 0,
    issuedBy: X,
  });
}

async function hwRecord(hwItemId: Types.ObjectId, sectionId: Types.ObjectId, classId: Types.ObjectId, state: string) {
  await HomeworkStudentRecord.collection.insertOne({
    hwItemId,
    hwId: `HW-R${++seq}`,
    studentId: id(),
    sectionId,
    classId,
    state,
    stateDates: stamps(state),
    dueDate: day(25),
    chaseCount: 0,
    topupFlag: false,
    topupQids: [],
    issuedBy: X,
  });
}

function slot(groupId: Types.ObjectId, teacherId: Types.ObjectId, dayOfWeek: string, from: Date, to?: Date) {
  return {
    groupType: "section",
    groupId,
    dayOfWeek,
    periodNumber: 2,
    subject: "MATH",
    track: "general",
    teacherId,
    isBreak: false,
    active: true,
    effectiveFrom: from,
    ...(to ? { effectiveTo: to } : {}),
    createdBy: X,
  };
}

function asItem(_id: Types.ObjectId, sectionId: Types.ObjectId, classId: Types.ObjectId, classLevel: number, n: number) {
  return {
    _id,
    asId: `AS-C${classLevel}-MATH-000${n}`,
    academicYearId: YEAR,
    scheduleEntryId: id(),
    weekNumber: 10 + n,
    cycleWeek: 1,
    classId,
    classLevel,
    sectionId,
    subject: "MATH",
    teacherId: X,
    deliveryDate: GIVEN_ON,
    dueDate: day(25),
    description: "অনুশীলনী ৫",
    estMinutes: 20,
    status: "ISSUED",
    deliveredBy: X,
    deliveredAt: GIVEN_ON,
  };
}

function hwItem(_id: Types.ObjectId, sectionId: Types.ObjectId, classId: Types.ObjectId, classLevel: number) {
  return {
    _id,
    hwId: `HW-C${classLevel}-MATH-${_id.toString().slice(-4)}`,
    academicYearId: YEAR,
    classId,
    classLevel,
    sectionId,
    subject: "MATH",
    dateGiven: GIVEN_ON,
    timeDecl: 20,
    topTags: ["TOP-MATH-C3-01"],
    status: "issued",
    declaredBy: X,
  };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  // Build every unique index BEFORE inserting fixtures (memory-server flake rule).
  await Promise.all(
    [HomeworkItem, HomeworkStudentRecord, AssignmentItem, AssignmentStudentRecord, RoutineSlot, Section, Class, User].map(
      (m) => (m as unknown as { init: () => Promise<unknown> }).init(),
    ),
  );

  await Class.collection.insertMany([
    { _id: C3, level: 3, academicYearId: YEAR, nameBn: "শ্রেণি ৩" },
    { _id: C2, level: 2, academicYearId: YEAR, nameBn: "শ্রেণি ২" },
  ]);
  await Section.collection.insertMany([
    { _id: ALL, classId: C3, code: "ALL", nameBn: "সম্মিলিত", active: true },
    { _id: BOYS, classId: C3, code: "BOYS", nameBn: "বালক", active: true },
    { _id: GIRLS, classId: C3, code: "GIRLS", nameBn: "বালিকা", active: true },
    { _id: S2, classId: C2, code: "MAIN", nameBn: "মূল", active: true },
  ]);
  await User.collection.insertMany([
    { _id: X, name: "Teacher X", role: "TEACHER", active: true, phone: "01700000001" },
    { _id: B, name: "Teacher B", role: "TEACHER", active: true, phone: "01700000002" },
    { _id: G, name: "Teacher G", role: "TEACHER", active: true, phone: "01700000003" },
    { _id: U, name: "Teacher U", role: "TEACHER", active: true, phone: "01700000004" },
  ]);
  await RoutineSlot.collection.insertMany([
    // The combined section's MATH ENDS the day before the split.
    slot(ALL, X, "THU", new Date(2026, 0, 1), new Date(2026, 9, 24, 23, 59, 59)),
    slot(BOYS, B, "TUE", new Date(2026, 9, 25)),
    slot(BOYS, B, "THU", new Date(2026, 9, 25)),
    slot(GIRLS, G, "TUE", new Date(2026, 9, 25)),
    slot(GIRLS, G, "THU", new Date(2026, 9, 25)),
    slot(S2, X, "THU", new Date(2026, 0, 1)),
  ]);

  // Assignments: one pre-split item on সম্মিলিত (records moved to the halves) + X's
  // own same-section control on C2. No totalMarks on the pre-split item.
  await AssignmentItem.collection.insertMany([asItem(AS_ALL, ALL, C3, 3, 1), asItem(AS_S2, S2, C2, 2, 2)]);
  for (const st of ["SUBMITTED", "SUBMITTED"]) await asRecord(AS_ALL, BOYS, C3, st);
  for (const st of ["SUBMITTED", "SUBMITTED", "GIVEN"]) await asRecord(AS_ALL, GIRLS, C3, st);
  for (const st of ["SUBMITTED", "SUBMITTED"]) await asRecord(AS_S2, S2, C2, st);

  // Homework: the same shape.
  await HomeworkItem.collection.insertMany([hwItem(HW_ALL, ALL, C3, 3), hwItem(HW_S2, S2, C2, 2)]);
  for (let i = 0; i < 2; i++) await hwRecord(HW_ALL, BOYS, C3, "SUBMITTED");
  for (let i = 0; i < 3; i++) await hwRecord(HW_ALL, GIRLS, C3, "SUBMITTED");
  for (let i = 0; i < 2; i++) await hwRecord(HW_S2, S2, C2, "SUBMITTED");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

// ---------------------------------------------------------------------------
// The helper
// ---------------------------------------------------------------------------

describe("resolveRecordOwners (the one rule)", () => {
  const q = (recordSectionId: Types.ObjectId) => ({
    itemId: AS_ALL.toString(),
    itemSectionId: ALL.toString(),
    recordSectionId: recordSectionId.toString(),
    subject: "MATH",
    itemDate: GIVEN_ON,
    itemOwnerId: X.toString(),
  });

  test("same-section → the item's owner; rehomed → the record section's routine teacher", async () => {
    const owners = await resolveRecordOwners([q(ALL), q(GIRLS), q(BOYS)], NOW);
    expect(owners.get(recordOwnerKey(AS_ALL.toString(), ALL.toString()))).toBe(X.toString());
    expect(owners.get(recordOwnerKey(AS_ALL.toString(), GIRLS.toString()))).toBe(G.toString());
    expect(owners.get(recordOwnerKey(AS_ALL.toString(), BOYS.toString()))).toBe(B.toString());
  });

  test("a rehomed record whose section's routine names nobody falls back to the item's owner", async () => {
    const nowhere = id();
    const owners = await resolveRecordOwners([q(nowhere)], NOW);
    expect(owners.get(recordOwnerKey(AS_ALL.toString(), nowhere.toString()))).toBe(X.toString());
  });

  test("passOnItemOrRecordSection: the item section first, then a section holding the records", async () => {
    const allowed = new Set([GIRLS.toString()]);
    const check = async (s: string) => {
      if (!allowed.has(s)) throw new Error("denied");
    };
    await expect(passOnItemOrRecordSection(ALL.toString(), async () => [BOYS, GIRLS], check)).resolves.toBe(
      GIRLS.toString(),
    );
    await expect(passOnItemOrRecordSection(ALL.toString(), async () => [BOYS], check)).rejects.toThrow("denied");
    // A loader failure keeps the item section's refusal (fail closed).
    await expect(
      passOnItemOrRecordSection(ALL.toString(), async () => Promise.reject(new Error("db")), check),
    ).rejects.toThrow("denied");
  });
});

// ---------------------------------------------------------------------------
// 1. myAssignmentLifecycle (Today card)
// ---------------------------------------------------------------------------

describe("myAssignmentLifecycle — per record owner", () => {
  test("the বালিকা teacher counts the rehomed বালিকা copies, with বালিকা as the tap target", async () => {
    const g = await myAssignmentLifecycle(G.toString(), FROM, TO, NOW);
    expect(g.given).toBe(3);
    expect(g.pendingChecking).toBe(2);
    expect(g.pendingSubmission).toBe(1);
    expect(g.deliveredItems).toBe(1);
    expect(g.sections).toEqual([
      expect.objectContaining({ sectionId: GIRLS.toString(), classId: C3.toString(), pendingChecking: 2, pendingSubmission: 1 }),
    ]);
    const b = await myAssignmentLifecycle(B.toString(), FROM, TO, NOW);
    expect(b.given).toBe(2);
    expect(b.sections.map((s) => s.sectionId)).toEqual([BOYS.toString()]);
  });

  test("the item's own teacher no longer counts the halves; the same-section item is unchanged", async () => {
    const x = await myAssignmentLifecycle(X.toString(), FROM, TO, NOW);
    expect(x.given).toBe(2); // only the C2 control item
    expect(x.deliveredItems).toBe(1);
    expect(x.pendingChecking).toBe(2);
    expect(x.sections.map((s) => s.sectionId)).toEqual([S2.toString()]);
    const u = await myAssignmentLifecycle(U.toString(), FROM, TO, NOW);
    expect(u.given).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Homework dashboard badges + roll-up + lifecycle report
// ---------------------------------------------------------------------------

describe("homework summary / overview — records filtered by owner", () => {
  test("class + section overview: G sees the 3 বালিকা copies, X sees none of the halves", async () => {
    const [g] = await homeworkClassOverview([C3.toString()], NOW.getTime(), { teacherId: G.toString() });
    expect(g.pendingChecking).toBe(3);
    const [x] = await homeworkClassOverview([C3.toString()], NOW.getTime(), { teacherId: X.toString() });
    expect(x.pendingChecking).toBe(0);
    const [all] = await homeworkClassOverview([C3.toString()], NOW.getTime());
    expect(all.pendingChecking).toBe(5); // unscoped is unchanged

    const bySection = await homeworkSectionOverview(
      [
        { classId: C3.toString(), sectionId: GIRLS.toString() },
        { classId: C3.toString(), sectionId: BOYS.toString() },
      ],
      NOW.getTime(),
      { teacherId: G.toString() },
    );
    expect(bySection.find((r) => r.sectionId === GIRLS.toString())!.pendingChecking).toBe(3);
    expect(bySection.find((r) => r.sectionId === BOYS.toString())!.pendingChecking).toBe(0);
  });

  test("same-section control: X still owns the C2 item's copies", async () => {
    const [x] = await homeworkClassOverview([C2.toString()], NOW.getTime(), { teacherId: X.toString() });
    expect(x.pendingChecking).toBe(2);
  });

  test("homeworkSummary narrows records AND topic touches to the owner", async () => {
    const g = await homeworkSummary(C3.toString(), { teacherId: G.toString() });
    expect(g.pendingChecking).toBe(3);
    expect(g.topicTouches).toEqual([{ topTag: "TOP-MATH-C3-01", count: 1 }]);
    const x = await homeworkSummary(C3.toString(), { teacherId: X.toString() });
    expect(x.pendingChecking).toBe(0);
    expect(x.topicTouches).toEqual([]);
  });

  test("lifecycle report: per-teacher rows per record owner; backlog by RECORD section", async () => {
    const r = await homeworkLifecycleReport(FROM, TO, { now: NOW });
    const row = (t: Types.ObjectId) => r.teachers.find((x) => x.teacherId === t.toString());
    expect(row(G)!.given).toBe(3);
    expect(row(B)!.given).toBe(2);
    expect(row(X)!.given).toBe(2); // the C2 control only…
    expect(row(X)!.declaredItems).toBe(2); // …though X still declared both items
    const backlog = (s: Types.ObjectId) => r.backlog.find((b) => b.sectionId === s.toString());
    expect(backlog(GIRLS)).toEqual(expect.objectContaining({ count: 3, teacherName: "Teacher G", sectionNameBn: "বালিকা" }));
    expect(backlog(BOYS)).toEqual(expect.objectContaining({ count: 2, teacherName: "Teacher B" }));
    expect(backlog(S2)).toEqual(expect.objectContaining({ count: 2, teacherName: "Teacher X" }));
    expect(backlog(ALL)).toBeUndefined();
  });

  test("lifecycle drill: G's CHECK list is the বালিকা copies; X's is the C2 item only", async () => {
    const g = await homeworkLifecyclePending(FROM, TO, G.toString(), "CHECK", { now: NOW });
    expect(g).toHaveLength(3);
    expect(new Set(g.map((r) => r.sectionId))).toEqual(new Set([GIRLS.toString()]));
    expect(g[0].hwItemId).toBe(HW_ALL.toString());
    const x = await homeworkLifecyclePending(FROM, TO, X.toString(), "CHECK", { now: NOW });
    expect(x).toHaveLength(2);
    expect(new Set(x.map((r) => r.sectionId))).toEqual(new Set([S2.toString()]));
  });
});

// ---------------------------------------------------------------------------
// 3. Work board "homework to check"
// ---------------------------------------------------------------------------

describe("work board HOMEWORK_CHECK — one card per (item, record section)", () => {
  test("G gets a বালিকা card for the pre-split item; X gets only the C2 card", async () => {
    const g = await homeworkCheckCardsForMonth([G.toString()], "2026-10", NOW);
    expect(g).toHaveLength(1);
    expect(g[0].userId).toBe(G.toString());
    expect(g[0].titleBn).toContain("বালিকা");
    expect(g[0].titleBn).not.toContain("সম্মিলিত");
    expect(g[0].detailBn).toContain("৩টি");
    expect(g[0].sourceId).toBe(HW_ALL.toString());

    const x = await homeworkCheckCardsForMonth([X.toString()], "2026-10", NOW);
    expect(x).toHaveLength(1);
    expect(x[0].sourceId).toBe(HW_S2.toString());
    expect(x[0].key).toBe(`HOMEWORK_CHECK:${HW_S2.toString()}:${X.toString()}`); // same-section key unchanged
  });

  test("a board for every teacher has distinct keys for the two halves", async () => {
    const cards = await homeworkCheckCardsForMonth([X, B, G, U].map(String), "2026-10", NOW);
    expect(cards).toHaveLength(3);
    expect(new Set(cards.map((c) => c.key)).size).toBe(3);
    expect(cards.find((c) => c.userId === B.toString())!.titleBn).toContain("বালক");
  });
});

// ---------------------------------------------------------------------------
// 4. Monthly pending work + the Office's chase message
// ---------------------------------------------------------------------------

describe("monthly pending work — split by record section", () => {
  test("a pre-split item is two rows, each its half's teacher, labelled with that half", async () => {
    // Pinned before the 25 Oct due date: the "awaiting" count read the real clock and flipped to
    // "not submitted" once the calendar passed it (failed from 2026-10-26).
    const pw = await monthlyPendingWork("2026-10", day(23));
    const hw = pw.rows.filter((r) => r.kind === "HOMEWORK" && r.ref.startsWith("HW-C3"));
    expect(hw.map((r) => [r.sectionId, r.teacherId, r.toCheck]).sort()).toEqual(
      [
        [BOYS.toString(), B.toString(), 2],
        [GIRLS.toString(), G.toString(), 3],
      ].sort(),
    );
    expect(hw.find((r) => r.sectionId === GIRLS.toString())!.sectionLabel).toBe("শ্রেণি ৩ / বালিকা");
    const as = pw.rows.filter((r) => r.kind === "ASSIGNMENT" && r.ref.startsWith("AS-C3"));
    expect(as.find((r) => r.sectionId === GIRLS.toString())).toEqual(
      expect.objectContaining({ teacherId: G.toString(), toCheck: 2, awaiting: 1 }),
    );
    expect(pw.rows.some((r) => r.sectionId === ALL.toString())).toBe(false);
    // same-section control
    expect(pw.rows.find((r) => r.kind === "HOMEWORK" && r.sectionId === S2.toString())!.teacherId).toBe(X.toString());
  });

  test("the chase message goes to the half's teacher, not the item's", async () => {
    const chase = await monthlyTeacherChase("2026-10");
    const g = chase.find((c) => c.teacherId === G.toString())!;
    expect(g.toCheck).toBe(5); // 3 homework + 2 assignment copies
    const x = chase.find((c) => c.teacherId === X.toString())!;
    expect(x.toCheck).toBe(4); // the C2 control only (2 + 2)
  });
});

// ---------------------------------------------------------------------------
// 5. Item-level edit: a half may supply the missing totalMarks, nothing else
// ---------------------------------------------------------------------------

describe("updateAssignmentItem — the RECORD_HALF scope", () => {
  test("a half's teacher may not rewrite the item text", async () => {
    await expect(
      updateAssignmentItem({ itemId: AS_ALL.toString(), description: "অন্য কিছু", actorId: G.toString() }),
    ).rejects.toThrow("পূর্ণমান");
  });

  test("an unrelated teacher is refused outright", async () => {
    await expect(
      updateAssignmentItem({ itemId: AS_ALL.toString(), totalMarks: 10, actorId: U.toString() }),
    ).rejects.toThrow("আপনার বিষয়/সপ্তাহের নয়");
  });

  test("a half's teacher sets the missing totalMarks; once set, a half cannot change it", async () => {
    const r = await updateAssignmentItem({ itemId: AS_ALL.toString(), totalMarks: 10, actorId: G.toString() });
    expect(r.totalMarks).toBe(10);
    await expect(
      updateAssignmentItem({ itemId: AS_ALL.toString(), totalMarks: 20, actorId: B.toString() }),
    ).rejects.toThrow("আগেই");
  });

  test("the item's own teacher keeps the full edit", async () => {
    const r = await updateAssignmentItem({ itemId: AS_ALL.toString(), totalMarks: 15, actorId: X.toString() });
    expect(r.totalMarks).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// 7. homeworkStudentRecords — the authorised section's records only
// ---------------------------------------------------------------------------

describe("listStudentRecords — section-filtered", () => {
  test("a pre-split item lists only the asked section's records", async () => {
    expect(await listStudentRecords(HW_ALL.toString(), GIRLS.toString())).toHaveLength(3);
    expect(await listStudentRecords(HW_ALL.toString(), BOYS.toString())).toHaveLength(2);
    expect(await listStudentRecords(HW_ALL.toString(), ALL.toString())).toHaveLength(0);
    expect(await listStudentRecords(HW_ALL.toString())).toHaveLength(5); // unfiltered caller unchanged
  });
});

// ---------------------------------------------------------------------------
// 5. The resolver gate (assertCanWriteOnItem): the সম্মিলিত grants lapsed at the split,
//    so the item's own section refuses everyone but the Principal — a half's subject
//    teacher must pass via the section holding the item's records.
// ---------------------------------------------------------------------------

describe("updateAssignmentItem resolver gate — a half's teacher passes via the record section", () => {
  const AS_SEP = id();
  const MATH = id();
  let schema: ReturnType<typeof builder.toSchema>;
  const run = (userId: Types.ObjectId, source: string): Promise<ExecutionResult> =>
    graphql({ schema, source, contextValue: { auth: { role: "TEACHER", userId: userId.toString(), permissions: ["tracker:write"] } } }) as Promise<ExecutionResult>;
  const setMarks = (marks: number) =>
    `mutation { updateAssignmentItem(itemId: "${AS_SEP.toString()}", totalMarks: ${marks}) { itemId totalMarks } }`;

  beforeAll(async () => {
    schema = builder.toSchema();
    await Promise.all([Subject.init(), ScopeGrant.init()]);
    await Subject.collection.insertOne({ _id: MATH, code: "MATH", nameBn: "গণিত" });
    await ScopeGrant.collection.insertMany([
      // X's combined-section grant lapsed at the split; G teaches বালিকা MATH.
      { teacherId: X, kind: "teaching", classId: C3, sectionId: ALL, subjectId: MATH, active: true, expiresAt: new Date(2026, 9, 24, 23, 59), createdBy: X },
      { teacherId: G, kind: "teaching", classId: C3, sectionId: GIRLS, subjectId: MATH, active: true, createdBy: X },
    ]);
    // A September pre-split item (outside the other suites' windows) with বালিকা records.
    await AssignmentItem.collection.insertOne({ ...asItem(AS_SEP, ALL, C3, 3, 9), deliveryDate: day(1), weekNumber: 40 });
    await asRecord(AS_SEP, GIRLS, C3, "SUBMITTED");
  });

  test("G (বালিকা MATH) sets the missing totalMarks on the সম্মিলিত item", async () => {
    const r = await run(G, setMarks(10));
    expect(r.errors).toBeUndefined();
    expect((r.data as { updateAssignmentItem: { totalMarks: number } }).updateAssignmentItem.totalMarks).toBe(10);
  });

  test("a teacher with no grant on any section holding the records is refused", async () => {
    const r = await run(U, setMarks(12));
    expect(r.errors?.length).toBeGreaterThan(0);
  });

  test("G still cannot rewrite the item text through the resolver", async () => {
    const r = await run(G, `mutation { updateAssignmentItem(itemId: "${AS_SEP.toString()}", description: "x") { itemId } }`);
    expect(r.errors?.[0]?.message).toContain("পূর্ণমান");
  });
});
