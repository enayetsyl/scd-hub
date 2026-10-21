/**
 * categoriesFor (work board) — the StaffProfile category per staff login, joined by
 * the staffMatch rule (D-#788): normalised phone first, then the email when the phone
 * finds no one. One match per key; an ambiguous phone stays unresolved.
 *
 * DB-free: only StaffProfile is read, and it is mocked.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockStaffFind = jest.fn();
jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: {
    find: (q: unknown) => ({ select: () => ({ lean: () => mockStaffFind(q) }) }),
  },
}));

import { categoriesFor, type BoardUser } from "../modules/workboard/services/WorkBoardService";

const user = (over: Partial<BoardUser>): BoardUser => ({ _id: oid(), name: "x", role: "TEACHER", ...over });

beforeEach(() => jest.clearAllMocks());

describe("categoriesFor", () => {
  test("matches by normalised phone (unchanged)", async () => {
    const u = user({ phone: "01700000000" });
    mockStaffFind.mockResolvedValue([{ phone: "01700000000", category: "teacher" }]);
    expect((await categoriesFor([u])).get(u._id.toString())).toBe("teacher");
  });

  test("an email-only login is matched by email, case-insensitively", async () => {
    const u = user({ email: "k.tanha1994@gmail.com" });
    mockStaffFind.mockResolvedValue([
      { phone: "01999999999", category: "office" },
      { email: " K.Tanha1994@gmail.com ", category: "teacher" },
    ]);
    expect((await categoriesFor([u])).get(u._id.toString())).toBe("teacher");
  });

  test("the email is tried when the phone finds no one", async () => {
    const u = user({ phone: "+8801700000000", email: "t@x.com" });
    mockStaffFind.mockResolvedValue([{ phone: "01999999999", email: "t@x.com", category: "teacher" }]);
    expect((await categoriesFor([u])).get(u._id.toString())).toBe("teacher");
  });

  test("an ambiguous phone stays unresolved and does not fall through to the email", async () => {
    const u = user({ phone: "01700000000", email: "t@x.com" });
    mockStaffFind.mockResolvedValue([
      { phone: "01700000000", category: "teacher" },
      { phone: "01700000000", category: "office", email: "t@x.com" },
    ]);
    expect((await categoriesFor([u])).has(u._id.toString())).toBe(false);
  });

  test("a shared email names no one", async () => {
    const u = user({ email: "t@x.com" });
    mockStaffFind.mockResolvedValue([
      { email: "t@x.com", category: "teacher" },
      { email: "T@X.com", category: "office" },
    ]);
    expect((await categoriesFor([u])).has(u._id.toString())).toBe(false);
  });

  test("no keyed users → no read at all", async () => {
    expect((await categoriesFor([user({})])).size).toBe(0);
    expect(mockStaffFind).not.toHaveBeenCalled();
  });
});
