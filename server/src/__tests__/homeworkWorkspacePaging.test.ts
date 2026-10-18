/**
 * D-#761 — the homework workspace no longer carries every RETURNED record the section
 * ever had. `listWorkspaceRecords` (homeworkOpenRecords + skipFinishedItems) keeps the
 * deck: items with open work, or returned TODAY, with all their rows (earlier returns
 * included, D-#648). Finished items — every record returned, none today — page through
 * `homeworkDoneItemsPage`, newest given-date first, and `homeworkDoneItemSubjects`
 * counts them per subject for the chips.
 *
 * Runs against an in-memory MongoDB (the deck/done split is distinct + updatedAt logic
 * that a find-chain mock cannot exercise).
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../modules/trackers/models/HomeworkStudentRecord";
import { Student } from "../modules/foundation/models/Student";
import {
  listOpenRecords,
  listWorkspaceRecords,
  homeworkDoneItemsPage,
  homeworkDoneItemSubjects,
} from "../modules/trackers/services/HomeworkService";
import { LIFECYCLE_STATES } from "@scd/shared";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;

const section = new Types.ObjectId();
const otherSection = new Types.ObjectId();
const classId = new Types.ObjectId();
const stuA = new Types.ObjectId();
const stuB = new Types.ObjectId();
const NOW = new Date("2026-10-18T06:00:00Z"); // 12:00 Dhaka
const DAY_START = new Date("2026-10-18T00:00:00+06:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

async function item(subject: string, dateGiven: Date): Promise<Types.ObjectId> {
  const doc = await HomeworkItem.collection.insertOne({
    subject,
    dateGiven,
    classId,
    sectionId: section,
    topTags: [],
  });
  return doc.insertedId as Types.ObjectId;
}

/** A record whose last stamp is `state` at `at`; updatedAt follows the last write. */
async function rec(hwItemId: Types.ObjectId, studentId: Types.ObjectId, state: string, at: Date, sec = section) {
  await HomeworkStudentRecord.collection.insertOne({
    hwItemId,
    hwId: "HW-X",
    studentId,
    sectionId: sec,
    classId,
    state,
    stateDates: [
      { state: "GIVEN", at: daysAgo(30) },
      ...(state === "GIVEN" ? [] : [{ state, at }]),
    ],
    chaseCount: 0,
    topupFlag: false,
    topupQids: [],
    issuedBy: new Types.ObjectId(),
    createdAt: daysAgo(30),
    updatedAt: at,
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Student.collection.insertMany([
    { _id: stuA, name: "Aisha" },
    { _id: stuB, name: "Bilal" },
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

let openItem: Types.ObjectId;
let todayItem: Types.ObjectId;
const doneItems: Types.ObjectId[] = [];

beforeAll(async () => {
  // Open work: one student submitted, one returned last week (the D-#648 earlier return).
  openItem = await item("ENG", daysAgo(8));
  await rec(openItem, stuA, "SUBMITTED", daysAgo(7));
  await rec(openItem, stuB, "RETURNED", daysAgo(6));
  // Every student returned, the last one TODAY — still on the deck (same-day undo).
  todayItem = await item("MATH", daysAgo(3));
  await rec(todayItem, stuA, "RETURNED", daysAgo(2));
  await rec(todayItem, stuB, "RETURNED", new Date(DAY_START.getTime() + 3_600_000));
  // Finished history: 5 items, all returned before today, newest given-date last.
  for (let i = 0; i < 5; i++) {
    const id = await item(i % 2 === 0 ? "ENG" : "BAN", daysAgo(40 - i));
    doneItems.push(id);
    await rec(id, stuA, "RETURNED", daysAgo(35 - i));
    await rec(id, stuB, "RETURNED", daysAgo(35 - i));
  }
  // A finished item touched today for a reason other than a return keeps its old stamp:
  // it is still finished, not resurrected onto the deck.
  const touched = await item("ENG", daysAgo(50));
  doneItems.push(touched);
  await rec(touched, stuA, "RETURNED", daysAgo(45));
  await HomeworkStudentRecord.collection.updateOne(
    { hwItemId: touched },
    { $set: { updatedAt: new Date(DAY_START.getTime() + 60_000) } },
  );
  // Another section's records never leak in.
  const foreign = await item("ENG", daysAgo(1));
  await rec(foreign, stuA, "SUBMITTED", daysAgo(1), otherSection);
});

describe("D-#761 — homework workspace deck vs finished fold", () => {
  test("the deck keeps open items + today's returns, with their earlier returns; no finished history", async () => {
    const rows = await listWorkspaceRecords(section.toString(), [...LIFECYCLE_STATES], DAY_START);
    const items = new Set(rows.map((r) => r.hwItemId));
    expect(items).toEqual(new Set([openItem.toString(), todayItem.toString()]));
    // The open item's earlier return still rides along (D-#648 names behind the count).
    expect(rows.filter((r) => r.hwItemId === openItem.toString()).map((r) => r.state).sort()).toEqual([
      "RETURNED",
      "SUBMITTED",
    ]);
    expect(rows.filter((r) => r.hwItemId === todayItem.toString())).toHaveLength(2);
  });

  test("omitting skipFinishedItems keeps today's behaviour: every record in the states", async () => {
    const rows = await listOpenRecords(section.toString(), [...LIFECYCLE_STATES]);
    expect(rows).toHaveLength(2 + 2 + 10 + 1);
  });

  test("finished items page newest given-date first; total counts every finished card", async () => {
    const p1 = await homeworkDoneItemsPage(section.toString(), DAY_START, {}, { page: 1, pageSize: 4 });
    expect(p1.total).toBe(6);
    expect(p1.rows).toHaveLength(4);
    // doneItems[4] has the newest given-date (40-4 days ago); the touched one is oldest.
    expect(p1.rows.map((r) => r.hwItemId)).toEqual([4, 3, 2, 1].map((i) => doneItems[i]!.toString()));
    expect(p1.rows[0]!.records.map((r) => r.studentName).sort()).toEqual(["Aisha", "Bilal"]);
    const p2 = await homeworkDoneItemsPage(section.toString(), DAY_START, {}, { page: 2, pageSize: 4 });
    expect(p2.rows.map((r) => r.hwItemId)).toEqual([doneItems[0]!.toString(), doneItems[5]!.toString()]);
  });

  test("subject chip + caller scope narrow the fold; a chip outside the scope matches nothing", async () => {
    const ban = await homeworkDoneItemsPage(section.toString(), DAY_START, { subject: "BAN" }, {});
    expect(ban.total).toBe(2);
    expect(ban.rows.every((r) => r.records.every((x) => x.subject === "BAN"))).toBe(true);
    const scoped = await homeworkDoneItemsPage(section.toString(), DAY_START, { subjects: new Set(["ENG"]) }, {});
    expect(scoped.total).toBe(4);
    const outside = await homeworkDoneItemsPage(
      section.toString(),
      DAY_START,
      { subjects: new Set(["ENG"]), subject: "BAN" },
      {},
    );
    expect(outside.total).toBe(0);
  });

  test("per-subject finished counts (the chips) respect the caller's scope", async () => {
    expect(await homeworkDoneItemSubjects(section.toString(), DAY_START)).toEqual([
      { subject: "BAN", count: 2 },
      { subject: "ENG", count: 4 },
    ]);
    expect(await homeworkDoneItemSubjects(section.toString(), DAY_START, new Set(["BAN"]))).toEqual([
      { subject: "BAN", count: 2 },
    ]);
  });

  test("the next Dhaka day, today's returned item leaves the deck for the fold", async () => {
    const tomorrow = new Date(DAY_START.getTime() + 86_400_000);
    const rows = await listWorkspaceRecords(section.toString(), [...LIFECYCLE_STATES], tomorrow);
    expect(new Set(rows.map((r) => r.hwItemId))).toEqual(new Set([openItem.toString()]));
    const p = await homeworkDoneItemsPage(section.toString(), tomorrow, {}, {});
    expect(p.total).toBe(7);
  });
});
