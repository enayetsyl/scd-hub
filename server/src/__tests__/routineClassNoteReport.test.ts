/**
 * R5 class-note submission report test.
 *
 * Verifies the date roll-up groups slots by the effective teacher (cover wins),
 * splits posted vs pending subjects, and carries the teacher contact fields.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockSlotFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: {
    find: () => ({ sort: () => ({ lean: () => mockSlotFind() }) }),
  },
}));

const mockSubFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSubstitution", () => ({
  RoutineSubstitution: {
    find: () => ({ lean: () => mockSubFind() }),
  },
}));

const mockNoteFind = jest.fn();
jest.mock("../modules/routine/models/ClassNote", () => ({
  ClassNote: {
    find: () => ({ select: () => ({ lean: () => mockNoteFind() }) }),
  },
}));

const mockSectionFind = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: {
    find: () => ({ select: () => ({ lean: () => mockSectionFind() }) }),
  },
}));

const mockClassFind = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: {
    find: () => ({ select: () => ({ lean: () => mockClassFind() }) }),
  },
}));

const mockSubjectGroupFind = jest.fn();
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: {
    find: () => ({ select: () => ({ lean: () => mockSubjectGroupFind() }) }),
  },
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    find: () => ({ select: () => ({ lean: () => mockUserFind() }) }),
  },
}));

import { classNoteSubmissionReport } from "../modules/routine/services/RoutineTriggerService";

const DATE = new Date(2026, 6, 1, 9, 0, 0);

beforeEach(() => {
  jest.clearAllMocks();
  mockSlotFind.mockResolvedValue([]);
  mockSubFind.mockResolvedValue([]);
  mockNoteFind.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue([]);
  mockClassFind.mockResolvedValue([]);
  mockSubjectGroupFind.mockResolvedValue([]);
  mockUserFind.mockResolvedValue([]);
});

describe("classNoteSubmissionReport", () => {
  test("groups by effective teacher and splits posted vs pending subjects", async () => {
    const classId = oid();
    const sectionId = oid();
    const teacherId = oid();
    const coverTeacherId = oid();
    const otherTeacherId = oid();
    const slot1 = oid();
    const slot2 = oid();
    const slot3 = oid();

    mockSlotFind.mockResolvedValue([
      {
        _id: slot1,
        groupType: "section",
        groupId: sectionId,
        classId,
        dayOfWeek: "WED",
        periodNumber: 1,
        subject: "BAN",
        track: "general",
        isBreak: false,
        teacherId,
        active: true,
        effectiveFrom: new Date("2026-01-01"),
      },
      {
        _id: slot2,
        groupType: "section",
        groupId: sectionId,
        classId,
        dayOfWeek: "WED",
        periodNumber: 2,
        subject: "ENG",
        track: "general",
        isBreak: false,
        teacherId,
        active: true,
        effectiveFrom: new Date("2026-01-01"),
      },
      {
        _id: slot3,
        groupType: "section",
        groupId: sectionId,
        classId,
        dayOfWeek: "WED",
        periodNumber: 3,
        subject: "MATH",
        track: "general",
        isBreak: false,
        teacherId: otherTeacherId,
        active: true,
        effectiveFrom: new Date("2026-01-01"),
      },
    ]);
    mockSubFind.mockResolvedValue([{ slotId: slot1, coverTeacherId }]);
    mockNoteFind.mockResolvedValue([{ slotId: slot1 }]);
    mockSectionFind.mockResolvedValue([{ _id: sectionId, classId, code: "A", nameBn: "A" }]);
    mockClassFind.mockResolvedValue([{ _id: classId, level: 4, nameBn: "Class 4" }]);
    mockSubjectGroupFind.mockResolvedValue([]);
    mockUserFind.mockResolvedValue([
      { _id: teacherId, name: "Main Teacher", phone: "+880111" },
      { _id: coverTeacherId, name: "Cover Teacher", phone: "+880222" },
      { _id: otherTeacherId, name: "Other Teacher", phone: null },
    ]);

    const rows = await classNoteSubmissionReport(DATE);

    expect(rows.map((r) => r.teacherName)).toEqual(["Cover Teacher", "Main Teacher", "Other Teacher"]);
    expect(rows[0]).toMatchObject({
      groupType: "section",
      classNameBn: "Class 4",
      sectionNameBn: "A",
      teacherPhone: "+880222",
      publishedSubjects: ["BAN"],
      pendingSubjects: [],
      publishedCount: 1,
      pendingCount: 0,
    });
    expect(rows[1]).toMatchObject({
      teacherName: "Main Teacher",
      publishedSubjects: [],
      pendingSubjects: ["ENG"],
      publishedCount: 0,
      pendingCount: 1,
    });
    expect(rows[2]).toMatchObject({
      teacherName: "Other Teacher",
      pendingSubjects: ["MATH"],
    });
  });
});
