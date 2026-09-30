/**
 * Student directory (the whole-school student table) — buildDirectoryRows joins
 * students to class, section, Quran/Arabic group and guardian phones.
 *
 * DB-free: the builder is pure; RBAC posture reads the shared vocab directly.
 */
import mongoose from "mongoose";
import { roleHasPermission } from "@scd/shared";
import { buildDirectoryRows, type DirectoryInput } from "../modules/foundation/services/StudentDirectoryService";

const oid = () => new mongoose.Types.ObjectId();

function fixture(): DirectoryInput & { ids: Record<string, mongoose.Types.ObjectId> } {
  const ids = {
    nursery: oid(),
    c1: oid(),
    secN: oid(),
    secBoys: oid(),
    secGirls: oid(),
    qaida: oid(),
    book1: oid(),
    oldGroup: oid(),
    a: oid(),
    b: oid(),
    c: oid(),
    d: oid(),
    mum: oid(),
    dad: oid(),
    nophone: oid(),
  };
  return {
    ids,
    students: [
      { _id: ids.a, schoolId: "0102", name: "Girl C1", classId: ids.c1, sectionId: ids.secGirls },
      { _id: ids.b, schoolId: "0100", name: "Boy C1", nameBn: "ছেলে", classId: ids.c1, sectionId: ids.secBoys },
      { _id: ids.c, schoolId: "0090", name: "Nursery kid", classId: ids.nursery, sectionId: ids.secN },
      { _id: ids.d, schoolId: "0099", name: "Boy C1 earlier", classId: ids.c1, sectionId: ids.secBoys },
    ],
    classes: [
      { _id: ids.nursery, level: -1, nameBn: "নার্সারি" },
      { _id: ids.c1, level: 1, nameBn: "প্রথম" },
    ],
    sections: [
      { _id: ids.secN, code: "MAIN", nameBn: "মূল" },
      { _id: ids.secBoys, code: "BOYS", nameBn: "বালক" },
      { _id: ids.secGirls, code: "GIRLS", nameBn: "বালিকা" },
    ],
    groups: [
      { _id: ids.qaida, track: "quran", code: "Q-QAIDA-B", level: "Qaida", gender: "boys", nameBn: "কায়দা (বালক)" },
      { _id: ids.book1, track: "arabic", code: "A-B1-B", level: "Book 1", gender: "boys", nameBn: "বুক ১ (বালক)" },
    ],
    memberships: [
      { groupId: ids.qaida, studentId: ids.b, track: "quran" },
      { groupId: ids.book1, studentId: ids.b, track: "arabic" },
      // A membership whose group is inactive (not in `groups`) is not shown.
      { groupId: ids.oldGroup, studentId: ids.a, track: "quran" },
    ],
    links: [
      { guardianId: ids.dad, studentId: ids.b, relation: "father" },
      { guardianId: ids.mum, studentId: ids.b, relation: "mother" },
      { guardianId: ids.nophone, studentId: ids.c, relation: "guardian" },
    ],
    guardians: [
      { _id: ids.dad, name: "Dad", phone: "+8801700000001" },
      { _id: ids.mum, name: "Mum", phone: " +8801700000001 " }, // same family phone
      { _id: ids.nophone, name: "No phone" },
    ],
  };
}

describe("buildDirectoryRows", () => {
  test("orders rows by class level, then section code, then numeric school ID", () => {
    const rows = buildDirectoryRows(fixture());
    expect(rows.map((r) => r.schoolId)).toEqual(["0090", "0099", "0100", "0102"]);
  });

  test("carries class + section labels and the Quran/Arabic group per track", () => {
    const f = fixture();
    const boy = buildDirectoryRows(f).find((r) => r.schoolId === "0100")!;
    expect(boy).toMatchObject({
      name: "Boy C1",
      nameBn: "ছেলে",
      classLevel: 1,
      classNameBn: "প্রথম",
      sectionCode: "BOYS",
      sectionNameBn: "বালক",
    });
    expect(boy.quranGroup).toEqual({
      id: f.ids.qaida.toString(),
      code: "Q-QAIDA-B",
      level: "Qaida",
      gender: "boys",
      nameBn: "কায়দা (বালক)",
    });
    expect(boy.arabicGroup?.level).toBe("Book 1");
  });

  test("a student with no placement, or only an inactive group, gets null groups", () => {
    const rows = buildDirectoryRows(fixture());
    const girl = rows.find((r) => r.schoolId === "0102")!;
    expect(girl.quranGroup).toBeNull();
    expect(girl.arabicGroup).toBeNull();
    expect(girl.nameBn).toBeNull();
  });

  test("guardian phones are de-duplicated and phoneless guardians dropped", () => {
    const rows = buildDirectoryRows(fixture());
    const boy = rows.find((r) => r.schoolId === "0100")!;
    expect(boy.guardians).toEqual([{ relation: "father", name: "Dad", phone: "+8801700000001" }]);
    const nursery = rows.find((r) => r.schoolId === "0090")!;
    expect(nursery.guardians).toEqual([]);
  });
});

describe("studentDirectory RBAC posture", () => {
  test("gated by roster:manage — Office + Principal, not teachers or guardians", () => {
    expect(roleHasPermission("PRINCIPAL", "roster:manage")).toBe(true);
    expect(roleHasPermission("OFFICE", "roster:manage")).toBe(true);
    expect(roleHasPermission("TEACHER", "roster:manage")).toBe(false);
    expect(roleHasPermission("GUARDIAN", "roster:manage")).toBe(false);
  });
});
