/**
 * D-#761 — the library lists that grow over time:
 *
 *   bookTitlesPage   the catalog one page at a time (titleBn order), same filters as
 *                    bookTitles, availability computed for the page's titles only
 *   borrowerLoans    activeOnly → the books still out; limit → the newest N;
 *                    both omitted = the whole loan history, as before
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { BookTitle } from "../modules/library/models/BookTitle";
import { BookCopy } from "../modules/library/models/BookCopy";
import { BookLoan } from "../modules/library/models/BookLoan";
import { bookTitles, bookTitlesPage } from "../modules/library/services/LibraryCatalogService";
import { borrowerLoans, recentLoansPlusActive } from "../modules/library/services/LibraryCirculationService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const student = new Types.ObjectId();
const titleIds: Types.ObjectId[] = [];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  // 7 titles A..G; F is ENGLISH, G inactive. Each has 2 copies, one of them on loan.
  const names = ["A", "B", "C", "D", "E", "F", "G"];
  for (const n of names) {
    const t = await BookTitle.collection.insertOne({
      titleBn: `বই ${n}`,
      author: n === "C" ? "Rabindranath" : "x",
      language: n === "F" ? "ENGLISH" : "BANGLA",
      active: n !== "G",
    });
    titleIds.push(t.insertedId as Types.ObjectId);
    await BookCopy.collection.insertMany([
      { titleId: t.insertedId, accessionNo: `${n}-1`, status: "AVAILABLE" },
      { titleId: t.insertedId, accessionNo: `${n}-2`, status: "ON_LOAN" },
    ]);
  }

  // One student's loans: 4 returned, 2 active (one of them the OLDEST loan).
  for (let i = 0; i < 6; i++) {
    await BookLoan.collection.insertOne({
      copyId: new Types.ObjectId(),
      titleId: titleIds[i]!,
      borrowerType: "STUDENT",
      studentId: student,
      issuedAt: new Date(Date.UTC(2026, 8, 1 + i)),
      dueDate: new Date(Date.UTC(2026, 8, 8 + i)),
      renewCount: 0,
      status: i === 0 || i === 5 ? "ACTIVE" : "RETURNED",
      issuedBy: new Types.ObjectId(),
    });
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("D-#761 bookTitlesPage", () => {
  test("pages the active catalog in titleBn order with per-title availability", async () => {
    const p1 = await bookTitlesPage({}, { page: 1, pageSize: 4 });
    expect(p1.total).toBe(6); // G is inactive
    expect(p1.rows.map((r) => r.title.titleBn)).toEqual(["বই A", "বই B", "বই C", "বই D"]);
    expect(p1.rows.every((r) => r.totalCopies === 2 && r.availableCopies === 1)).toBe(true);
    const p2 = await bookTitlesPage({}, { page: 2, pageSize: 4 });
    expect(p2.rows.map((r) => r.title.titleBn)).toEqual(["বই E", "বই F"]);
  });

  test("same filters as bookTitles: search, language, includeInactive", async () => {
    expect((await bookTitlesPage({ search: "rabindra" }, {})).rows.map((r) => r.title.titleBn)).toEqual(["বই C"]);
    expect((await bookTitlesPage({ language: "ENGLISH" }, {})).total).toBe(1);
    const withInactive = await bookTitlesPage({ includeInactive: true }, { pageSize: 50 });
    expect(withInactive.total).toBe(7);
    expect(withInactive.rows.map((r) => r.title._id.toString())).toEqual(
      (await bookTitles({ includeInactive: true })).map((r) => r.title._id.toString()),
    );
  });
});

describe("D-#761 borrowerLoans bounds", () => {
  const borrower = { type: "STUDENT" as const, id: student.toString() };

  test("omitted = the whole history, newest first", async () => {
    const all = await borrowerLoans(borrower);
    expect(all).toHaveLength(6);
    expect(new Date(all[0]!.issuedAt).getUTCDate()).toBe(6);
  });

  test("activeOnly = only the books still out", async () => {
    const active = await borrowerLoans(borrower, { activeOnly: true });
    expect(active.map((l) => l.status)).toEqual(["ACTIVE", "ACTIVE"]);
  });

  test("limit = the newest N", async () => {
    const two = await borrowerLoans(borrower, { limit: 2 });
    expect(two.map((l) => new Date(l.issuedAt).getUTCDate())).toEqual([6, 5]);
  });

  test("guardian home: newest N plus the OLD loan still out, never cut off", async () => {
    const rows = await recentLoansPlusActive(borrower, 2);
    expect(rows.map((l) => new Date(l.issuedAt).getUTCDate())).toEqual([6, 5, 1]);
    expect(rows[2]!.status).toBe("ACTIVE");
  });
});
