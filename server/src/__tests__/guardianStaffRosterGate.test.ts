/**
 * findings F-1 / F-2 — two staff pickers were `authenticated` only, and a guardian login
 * passes `authenticated`:
 *   - `studentsInSection` returned any section's students with DOB, phone, address,
 *     blood group and their guardians' phones;
 *   - `teachers` returned every teacher's email and phone.
 * Both now refuse a GUARDIAN caller before touching the database. Staff are unchanged.
 * Executes the real GraphQL fields against the built schema; the models are mocked. DB-free.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();

const mockStudentFind = jest.fn();
const mockUserFind = jest.fn();
const chain = (docs: unknown[]) => ({ sort: () => ({ lean: async () => docs }) });

jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (q: unknown) => mockStudentFind(q) },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => mockUserFind(q) },
}));

import { builder } from "../schema";
import "../modules/foundation/resolvers/students";
import "../modules/foundation/resolvers/users";

const schema = builder.toSchema();

const run = (source: string, role: string | null): Promise<ExecutionResult> =>
  graphql({
    schema,
    source,
    contextValue: { auth: role ? { role, userId: oid().toString() } : null },
  }) as Promise<ExecutionResult>;

const SECTION = oid().toString();
const STUDENTS = `query { studentsInSection(sectionId: "${SECTION}") { id name dob phone address bloodGroup } }`;
const TEACHERS = `query { teachers { id name email phone } }`;

const student = {
  _id: oid(),
  schoolId: "0101",
  name: "Child",
  dob: new Date("2017-01-01"),
  phone: "+8801700000000",
  address: "Sylhet",
  bloodGroup: "B+",
  active: true,
};
const teacher = {
  _id: oid(),
  email: "t@example.com",
  phone: "+8801700000009",
  role: "TEACHER",
  name: "Teacher",
  active: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentFind.mockImplementation(() => chain([student]));
  mockUserFind.mockImplementation(() => chain([teacher]));
});

describe("studentsInSection (F-1)", () => {
  test("a guardian login is refused and the roster is never read", async () => {
    const res = await run(STUDENTS, "GUARDIAN");
    expect(res.errors?.[0]?.message).toMatch(/forbidden/i);
    expect(res.data?.studentsInSection ?? null).toBeNull();
    expect(mockStudentFind).not.toHaveBeenCalled();
  });

  test("no login is refused", async () => {
    const res = await run(STUDENTS, null);
    expect(res.errors?.length).toBeGreaterThan(0);
    expect(mockStudentFind).not.toHaveBeenCalled();
  });

  test.each(["TEACHER", "OFFICE", "PRINCIPAL"])("%s still gets the roster", async (role) => {
    const res = await run(STUDENTS, role);
    expect(res.errors).toBeUndefined();
    expect(res.data?.studentsInSection).toEqual([
      expect.objectContaining({ name: "Child", phone: "+8801700000000", bloodGroup: "B+" }),
    ]);
    expect(mockStudentFind).toHaveBeenCalledWith({ sectionId: SECTION, active: true });
  });
});

describe("teachers (F-2)", () => {
  test("a guardian login is refused and no staff contact is read", async () => {
    const res = await run(TEACHERS, "GUARDIAN");
    expect(res.errors?.[0]?.message).toMatch(/forbidden/i);
    expect(res.data?.teachers ?? null).toBeNull();
    expect(mockUserFind).not.toHaveBeenCalled();
  });

  test.each(["TEACHER", "OFFICE", "PRINCIPAL"])("%s still gets the teacher picker", async (role) => {
    const res = await run(TEACHERS, role);
    expect(res.errors).toBeUndefined();
    expect(res.data?.teachers).toEqual([expect.objectContaining({ name: "Teacher", phone: "+8801700000009" })]);
  });
});
