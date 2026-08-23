/**
 * DE-3 (D-#477) — the homework half of a class-note publish.
 *
 * The contract under test: a period card declares homework through the EXISTING
 * tracker services, so nothing downstream can tell a card-declared item from a
 * Homework-screen one; ids come from the SLOT; a re-publish EDITS rather than
 * duplicating; and the periods that cannot carry section homework are refused.
 *
 * DB-free: Class + the three HomeworkService entry points are mocked, so this
 * asserts the ROUTING (which service, with which arguments), which is exactly the
 * part that could silently diverge from the Homework screen.
 */
import mongoose from "mongoose";
import {
  resolveNoteHomeworkTarget,
  resolveClassNoteHomework,
  type NoteHomeworkTarget,
} from "../modules/routine/services/ClassNoteHomeworkService";
import type { IRoutineSlot } from "../modules/routine/models/RoutineSlot";

const oid = (): mongoose.Types.ObjectId => new mongoose.Types.ObjectId();

const mockClassFindById = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { findById: () => ({ select: () => ({ lean: () => mockClassFindById() }) }) },
}));

const mockDeclare = jest.fn();
const mockUpdate = jest.fn();
const mockNil = jest.fn();
const mockFindForDay = jest.fn();
jest.mock("../modules/trackers/services/HomeworkService", () => ({
  declareHomeworkItem: (i: unknown) => mockDeclare(i),
  updateHomeworkItem: (i: unknown) => mockUpdate(i),
  declareNoHomework: (i: unknown) => mockNil(i),
  findHomeworkItemIdForDay: (...a: unknown[]) => mockFindForDay(...a),
}));

const CLASS_ID = oid();
const SECTION_ID = oid();
const YEAR_ID = oid();
const ACTOR = oid().toString();
const DATE = new Date(2026, 7, 12); // a Wednesday — a school night

function sectionSlot(over: Partial<IRoutineSlot> = {}): IRoutineSlot {
  return {
    _id: oid(),
    groupType: "section",
    groupId: SECTION_ID,
    classId: CLASS_ID,
    subject: "MATH",
    teacherId: oid(),
    ...over,
  } as unknown as IRoutineSlot;
}

const TARGET: NoteHomeworkTarget = {
  classId: CLASS_ID.toString(),
  sectionId: SECTION_ID.toString(),
  classLevel: 3,
  academicYearId: YEAR_ID.toString(),
  subject: "MATH",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockClassFindById.mockResolvedValue({ level: 3, academicYearId: YEAR_ID });
  mockFindForDay.mockResolvedValue(null);
  mockDeclare.mockResolvedValue({ itemId: "ITEM_NEW", hwId: "HW-C3-MATH-0007" });
  mockUpdate.mockResolvedValue({ itemId: "ITEM_OLD", hwId: "HW-C3-MATH-0007" });
  mockNil.mockResolvedValue({ id: "NIL_1" });
});

describe("DE-3 — resolveNoteHomeworkTarget (ids come from the slot)", () => {
  test("a section period resolves class/section/level/year off the slot + Class", async () => {
    const target = await resolveNoteHomeworkTarget(sectionSlot());
    expect(target).toEqual(TARGET);
  });

  test("a subject-group period is refused (no section to declare against)", async () => {
    await expect(
      resolveNoteHomeworkTarget(sectionSlot({ groupType: "subjectgroup", classId: undefined })),
    ).rejects.toThrow(/শাখার পিরিয়ডে/);
  });

  test("a section period with no classId is refused", async () => {
    await expect(resolveNoteHomeworkTarget(sectionSlot({ classId: undefined }))).rejects.toThrow(
      /শাখার পিরিয়ডে/,
    );
  });

  test("D-#36: a QURAN period is refused — Quran is out of the homework tracker", async () => {
    await expect(resolveNoteHomeworkTarget(sectionSlot({ subject: "QURAN" }))).rejects.toThrow(
      /কুরআন/,
    );
  });
});

describe("DE-3 — resolveClassNoteHomework (routing)", () => {
  test("DECLARE with no existing item calls declareHomeworkItem with the slot-derived ids", async () => {
    const itemId = await resolveClassNoteHomework({
      target: TARGET,
      date: DATE,
      hw: { mode: "DECLARE", topTags: ["TOP-MATH-C3-01"], description: " পাতা ১২ ", qCount: 5, timeDecl: 25 },
      actorId: ACTOR,
    });
    expect(itemId).toBe("ITEM_NEW");
    expect(mockUpdate).not.toHaveBeenCalled();
    const arg = mockDeclare.mock.calls[0][0];
    expect(arg).toMatchObject({
      academicYearId: YEAR_ID.toString(),
      classId: CLASS_ID.toString(),
      sectionId: SECTION_ID.toString(),
      classLevel: 3,
      subject: "MATH",
      topTags: ["TOP-MATH-C3-01"],
      qCount: 5,
      timeDecl: 25,
      description: "পাতা ১২", // trimmed
      actorId: ACTOR,
    });
    expect(arg.dateGiven).toBe(DATE);
  });

  test("a re-publish EDITS the day's item instead of tripping the D-#338 duplicate guard", async () => {
    mockFindForDay.mockResolvedValue("ITEM_OLD");
    const itemId = await resolveClassNoteHomework({
      target: TARGET,
      date: DATE,
      hw: { mode: "DECLARE", topTags: ["TOP-MATH-C3-02"], description: "সংশোধিত", qCount: 6 },
      actorId: ACTOR,
    });
    expect(itemId).toBe("ITEM_OLD");
    expect(mockDeclare).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "ITEM_OLD", description: "সংশোধিত", qCount: 6, actorId: ACTOR }),
    );
  });

  test("an edit sends ONLY what the note carries — no fabricated revItem (D-#528)", async () => {
    // `revItem: hw.revItem ?? false` used to be sent on every edit. The class-note form
    // never collects a revision flag, so on a declared item that silently CLEARED it, and
    // on an issued one it tripped the frozen-field guard — making an issued day’s note
    // permanently uneditable. An absent field must stay absent.
    mockFindForDay.mockResolvedValue("ITEM_OLD");
    await resolveClassNoteHomework({
      target: TARGET,
      date: DATE,
      hw: { mode: "DECLARE", topTags: ["T"], description: "d", qCount: 6 },
      actorId: ACTOR,
    });
    const sent = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect("revItem" in sent).toBe(false);
    expect("timeDecl" in sent).toBe(false);
    expect("poolRef" in sent).toBe(false);
    // What the note DOES carry still goes through untouched.
    expect(sent.description).toBe("d");
    expect(sent.qCount).toBe(6);
  });

  test("a revision flag the note DOES carry is still forwarded (D-#528)", async () => {
    mockFindForDay.mockResolvedValue("ITEM_OLD");
    await resolveClassNoteHomework({
      target: TARGET,
      date: DATE,
      hw: { mode: "DECLARE", topTags: ["T"], description: "d", qCount: 6, revItem: true },
      actorId: ACTOR,
    });
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ revItem: true }));
  });
  test("the day lookup is keyed on (class, section, subject, date)", async () => {
    await resolveClassNoteHomework({
      target: TARGET,
      date: DATE,
      hw: { mode: "DECLARE", topTags: ["T"], description: "d", qCount: 1 },
      actorId: ACTOR,
    });
    expect(mockFindForDay).toHaveBeenCalledWith(
      CLASS_ID.toString(),
      SECTION_ID.toString(),
      "MATH",
      DATE,
    );
  });

  test("NIL writes a nil declaration, links nothing, and never declares an item", async () => {
    const itemId = await resolveClassNoteHomework({
      target: TARGET,
      date: DATE,
      hw: { mode: "NIL", reason: "TEST_DAY" },
      actorId: ACTOR,
    });
    expect(itemId).toBeNull();
    expect(mockDeclare).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockNil).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: CLASS_ID.toString(),
        sectionId: SECTION_ID.toString(),
        subject: "MATH",
        date: "2026-08-12", // local-day key, not a UTC-shifted ISO instant
        reason: "TEST_DAY",
        actorId: ACTOR,
      }),
    );
  });

  test("NIL without a reason is refused", async () => {
    await expect(
      resolveClassNoteHomework({ target: TARGET, date: DATE, hw: { mode: "NIL" }, actorId: ACTOR }),
    ).rejects.toThrow(/কারণ/);
    expect(mockNil).not.toHaveBeenCalled();
  });

  test("an unknown mode is refused rather than silently ignored", async () => {
    await expect(
      resolveClassNoteHomework({ target: TARGET, date: DATE, hw: { mode: "MAYBE" }, actorId: ACTOR }),
    ).rejects.toThrow(/Unknown homework mode/);
    expect(mockDeclare).not.toHaveBeenCalled();
    expect(mockNil).not.toHaveBeenCalled();
  });

  test("a blank poolRef is not sent as an empty link", async () => {
    await resolveClassNoteHomework({
      target: TARGET,
      date: DATE,
      hw: { mode: "DECLARE", topTags: ["T"], description: "d", qCount: 1, poolRef: "   " },
      actorId: ACTOR,
    });
    expect(mockDeclare.mock.calls[0][0].poolRef).toBeUndefined();
  });

  test("no attachments → the declare call omits the field entirely", async () => {
    await resolveClassNoteHomework({
      target: TARGET,
      date: DATE,
      hw: { mode: "DECLARE", topTags: ["T"], description: "d", qCount: 1 },
      actorId: ACTOR,
    });
    expect(mockDeclare.mock.calls[0][0].attachmentIds).toBeUndefined();
  });
});
