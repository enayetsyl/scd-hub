/**
 * Slice 3 tracker tests.
 *
 * J4.1 — openTracker → recordEntry (CT score) → closeTracker; event emitted
 * J4.2 — wa.me link builder returns correct URL shape
 * J4.3 — recordEntry HW complete/incomplete; event emitted
 * J4.4 — listTrackers filter by kind / setId / status
 * J4.5 — write-scope: supervisory-only grant is read-only (canWrite predicate)
 *
 * DB-free: all Mongoose models are mocked. canWrite is tested via the pure
 * function from ScopeGrantService (same pattern as questions.test.ts / J3.5).
 */

import mongoose from "mongoose";
import { roleHasPermission } from "@scd/shared";
import { canWrite } from "../modules/foundation/services/ScopeGrantService";
import type { ScopeItem } from "../modules/foundation/services/ScopeGrantService";

// ---------------------------------------------------------------------------
// Mock Mongoose models BEFORE importing services under test
// ---------------------------------------------------------------------------

const mockTrackerCreate = jest.fn();
const mockTrackerFindById = jest.fn();
const mockTrackerFind = jest.fn();
const mockTrackerFindByIdLean = jest.fn();

jest.mock("../modules/trackers/models/TrackerRecord", () => ({
  TrackerRecord: {
    create: (a: unknown) => mockTrackerCreate(a),
    findById: (id: unknown) => mockTrackerFindById(id),
    find: (q: unknown) => ({
      sort: jest.fn().mockReturnValue({ lean: () => mockTrackerFind(q) }),
    }),
  },
}));

const mockSetFindByIdLean = jest.fn();

jest.mock("../modules/assessment/models/AssessmentSet", () => ({
  AssessmentSet: {
    findById: (_id: unknown) => ({ lean: () => mockSetFindByIdLean(_id) }),
  },
}));

const mockEventCreate = jest.fn();

jest.mock("../modules/corpus/models/CorpusEvent", () => ({
  CorpusEvent: {
    create: (a: unknown) => mockEventCreate(a),
  },
}));

// Import AFTER mocks
import {
  openTracker,
  recordEntry,
  closeTracker,
  buildNonSubmitterLink,
  listTrackers,
  getTrackerSummary,
} from "../modules/trackers/services/TrackerService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTOR_ID = new mongoose.Types.ObjectId();
const SET_ID = new mongoose.Types.ObjectId();
const SECTION_ID = new mongoose.Types.ObjectId();
const CLASS_ID = new mongoose.Types.ObjectId();
const TRACKER_ID = new mongoose.Types.ObjectId();
const STUDENT_ID = new mongoose.Types.ObjectId();

function makeAssembledSetDoc(setType: string = "CT") {
  return {
    _id: SET_ID,
    setType,
    sectionId: SECTION_ID,
    classId: CLASS_ID,
    status: "assembled",
  };
}

function makeTrackerDoc(extra: Record<string, unknown> = {}) {
  const doc = {
    _id: TRACKER_ID,
    trackerKind: "classtest",
    setId: SET_ID,
    sectionId: SECTION_ID,
    classId: CLASS_ID,
    status: "open",
    entries: [] as Array<{
      pseudoStudentId: string;
      score?: number;
      submitted?: boolean;
      complete?: boolean;
    }>,
    closedAt: undefined as Date | undefined,
    save: jest.fn().mockResolvedValue(true),
    ...extra,
  };
  return doc;
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockEventCreate.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
});

// ===========================================================================
// J4.1 — openTracker → recordEntry (CT score) → closeTracker; event emitted
// ===========================================================================

describe("J4.1 — class-test tracker lifecycle (openTracker → recordEntry → closeTracker)", () => {
  test("openTracker creates an open TrackerRecord for a CT set", async () => {
    mockSetFindByIdLean.mockResolvedValue(makeAssembledSetDoc("CT"));
    mockTrackerCreate.mockResolvedValue({
      _id: TRACKER_ID,
      trackerKind: "classtest",
      status: "open",
    });

    const result = await openTracker(SET_ID.toString(), SECTION_ID.toString(), ACTOR_ID.toString());

    expect(mockTrackerCreate).toHaveBeenCalledTimes(1);
    const createArg = mockTrackerCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.trackerKind).toBe("classtest");
    expect(createArg.status).toBe("open");
    expect(createArg.sectionId).toBe(SECTION_ID.toString());
    expect(result.trackerKind).toBe("classtest");
    expect(result.status).toBe("open");
  });

  test("openTracker maps AS set → assignment tracker", async () => {
    mockSetFindByIdLean.mockResolvedValue(makeAssembledSetDoc("AS"));
    mockTrackerCreate.mockResolvedValue({
      _id: TRACKER_ID,
      trackerKind: "assignment",
      status: "open",
    });

    const result = await openTracker(SET_ID.toString(), SECTION_ID.toString(), ACTOR_ID.toString());
    const createArg = mockTrackerCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.trackerKind).toBe("assignment");
    expect(result.trackerKind).toBe("assignment");
  });

  test("openTracker throws when AssessmentSet not found", async () => {
    mockSetFindByIdLean.mockResolvedValue(null);
    await expect(
      openTracker(SET_ID.toString(), SECTION_ID.toString(), ACTOR_ID.toString()),
    ).rejects.toThrow("AssessmentSet not found");
  });

  test("recordEntry CT score upserts entry and emits tracker_recorded event", async () => {
    const trackerDoc = makeTrackerDoc();
    mockTrackerFindById.mockReturnValue(trackerDoc);

    const result = await recordEntry({
      trackerId: TRACKER_ID.toString(),
      studentId: STUDENT_ID.toString(),
      score: 18,
      actorId: ACTOR_ID.toString(),
    });

    expect(trackerDoc.entries).toHaveLength(1);
    expect(trackerDoc.entries[0].score).toBe(18);
    expect(trackerDoc.save).toHaveBeenCalled();
    expect(mockEventCreate).toHaveBeenCalledTimes(1);

    const event = mockEventCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(event.eventKind).toBe("tracker_recorded");
    expect(event.pseudoActorId).not.toBe(ACTOR_ID.toString()); // de-identified
    const meta = event.meta as Record<string, unknown>;
    expect(meta.trackerKind).toBe("classtest");
    expect(typeof meta.pseudoStudentId).toBe("string");
    expect(meta.pseudoStudentId).not.toBe(STUDENT_ID.toString()); // de-identified

    expect(result.trackerId).toBe(TRACKER_ID.toString());
    expect(result.entryCount).toBe(1);
  });

  test("recordEntry updates existing entry (upsert, not duplicate)", async () => {
    const trackerDoc = makeTrackerDoc({
      entries: [{ pseudoStudentId: "aaa", score: 10 }],
    });
    // Force same pseudoStudentId to match: we need to know what sha256(STUDENT_ID) is.
    // Instead, test with a known student id whose sha256 we can predict via node crypto.
    const crypto = await import("crypto");
    const sid = "student-123";
    const pseudo = crypto.createHash("sha256").update(sid).digest("hex");

    const docWithEntry = makeTrackerDoc({
      entries: [{ pseudoStudentId: pseudo, score: 5 }],
    });
    mockTrackerFindById.mockReturnValue(docWithEntry);

    await recordEntry({
      trackerId: TRACKER_ID.toString(),
      studentId: sid,
      score: 20,
      actorId: ACTOR_ID.toString(),
    });

    expect(docWithEntry.entries).toHaveLength(1); // not duplicated
    expect(docWithEntry.entries[0].score).toBe(20); // updated
    expect(docWithEntry.save).toHaveBeenCalled();
  });

  test("recordEntry throws when tracker not found", async () => {
    mockTrackerFindById.mockReturnValue(null);
    await expect(
      recordEntry({ trackerId: TRACKER_ID.toString(), studentId: "s1", actorId: ACTOR_ID.toString() }),
    ).rejects.toThrow("TrackerRecord not found");
  });

  test("recordEntry throws when tracker is closed", async () => {
    mockTrackerFindById.mockReturnValue(makeTrackerDoc({ status: "closed" }));
    await expect(
      recordEntry({ trackerId: TRACKER_ID.toString(), studentId: "s1", actorId: ACTOR_ID.toString() }),
    ).rejects.toThrow("Tracker is closed");
  });

  test("closeTracker seals the record and returns closedAt", async () => {
    const trackerDoc = makeTrackerDoc();
    mockTrackerFindById.mockReturnValue(trackerDoc);

    const result = await closeTracker(TRACKER_ID.toString());

    expect(trackerDoc.status).toBe("closed");
    expect(trackerDoc.closedAt).toBeInstanceOf(Date);
    expect(trackerDoc.save).toHaveBeenCalled();
    expect(result.status).toBe("closed");
    expect(result.closedAt).toBeTruthy();
  });

  test("closeTracker throws when already closed", async () => {
    mockTrackerFindById.mockReturnValue(makeTrackerDoc({ status: "closed" }));
    await expect(closeTracker(TRACKER_ID.toString())).rejects.toThrow("Tracker is already closed");
  });

  test("closeTracker throws when tracker not found", async () => {
    mockTrackerFindById.mockReturnValue(null);
    await expect(closeTracker(TRACKER_ID.toString())).rejects.toThrow("TrackerRecord not found");
  });
});

// ===========================================================================
// J4.2 — wa.me link builder
// ===========================================================================

describe("J4.2 — wa.me link builder (buildNonSubmitterLink)", () => {
  test("returns a https://wa.me/ URL", () => {
    const link = buildNonSubmitterLink("+8801711000000", "রহিম", "গণিত HW সেট-১");
    expect(link).toMatch(/^https:\/\/wa\.me\//);
  });

  test("includes the phone number in the URL", () => {
    const link = buildNonSubmitterLink("+8801711000000", "রহিম", "গণিত");
    expect(link).toContain("+8801711000000");
  });

  test("includes a ?text= query param with encoded Bangla content", () => {
    const link = buildNonSubmitterLink("8801711000000", "করিম", "বিজ্ঞান সেট-২");
    expect(link).toContain("?text=");
    const url = new URL(link);
    const text = decodeURIComponent(url.searchParams.get("text") ?? "");
    expect(text).toContain("করিম");
    expect(text).toContain("বিজ্ঞান সেট-২");
  });

  test("strips spaces from phone before inserting into URL", () => {
    const link = buildNonSubmitterLink("880 1711 000000", "X", "Y");
    expect(link).not.toContain(" ");
    expect(link).toContain("8801711000000");
  });
});

// ===========================================================================
// J4.3 — Homework tracker: complete / incomplete entry; event emitted
// ===========================================================================

describe("J4.3 — homework tracker (recordEntry complete/incomplete)", () => {
  test("recordEntry HW complete=true stores entry and emits event", async () => {
    const trackerDoc = makeTrackerDoc({ trackerKind: "homework" });
    mockTrackerFindById.mockReturnValue(trackerDoc);

    await recordEntry({
      trackerId: TRACKER_ID.toString(),
      studentId: STUDENT_ID.toString(),
      complete: true,
      actorId: ACTOR_ID.toString(),
    });

    expect(trackerDoc.entries).toHaveLength(1);
    expect(trackerDoc.entries[0].complete).toBe(true);
    expect(mockEventCreate).toHaveBeenCalledTimes(1);

    const event = mockEventCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(event.eventKind).toBe("tracker_recorded");
    const meta = event.meta as Record<string, unknown>;
    expect(meta.trackerKind).toBe("homework");
  });

  test("recordEntry HW complete=false stores incomplete entry", async () => {
    const trackerDoc = makeTrackerDoc({ trackerKind: "homework" });
    mockTrackerFindById.mockReturnValue(trackerDoc);

    await recordEntry({
      trackerId: TRACKER_ID.toString(),
      studentId: STUDENT_ID.toString(),
      complete: false,
      actorId: ACTOR_ID.toString(),
    });

    expect(trackerDoc.entries[0].complete).toBe(false);
    expect(mockEventCreate).toHaveBeenCalledTimes(1);
  });

  test("getTrackerSummary returns correct completeCount for HW tracker", async () => {
    const hwTracker = {
      _id: TRACKER_ID,
      trackerKind: "homework",
      setId: SET_ID,
      sectionId: SECTION_ID,
      classId: CLASS_ID,
      status: "open",
      entries: [
        { pseudoStudentId: "a", complete: true },
        { pseudoStudentId: "b", complete: false },
        { pseudoStudentId: "c", complete: true },
      ],
    };
    mockTrackerFindById.mockReturnValue({ lean: jest.fn().mockResolvedValue(hwTracker) });

    const summary = await getTrackerSummary(TRACKER_ID.toString());
    expect(summary.totalEntries).toBe(3);
    expect(summary.completeCount).toBe(2);
    expect(summary.averageScore).toBeNull(); // HW has no scores
  });

  test("getTrackerSummary returns correct averageScore for CT tracker", async () => {
    const ctTracker = {
      _id: TRACKER_ID,
      trackerKind: "classtest",
      setId: SET_ID,
      sectionId: SECTION_ID,
      classId: CLASS_ID,
      status: "open",
      entries: [
        { pseudoStudentId: "a", score: 20 },
        { pseudoStudentId: "b", score: 16 },
        { pseudoStudentId: "c", score: 18 },
      ],
    };
    mockTrackerFindById.mockReturnValue({ lean: jest.fn().mockResolvedValue(ctTracker) });

    const summary = await getTrackerSummary(TRACKER_ID.toString());
    expect(summary.totalEntries).toBe(3);
    expect(summary.averageScore).toBeCloseTo(18);
  });
});

// ===========================================================================
// J4.4 — listTrackers filter by kind / setId / status
// ===========================================================================

describe("J4.4 — listTrackers filter construction", () => {
  const BASE_SECTION = SECTION_ID.toString();

  test("filter by trackerKind constructs correct query", async () => {
    mockTrackerFind.mockResolvedValue([]);
    await listTrackers({ sectionId: BASE_SECTION, trackerKind: "classtest" });

    const filterArg = mockTrackerFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filterArg.sectionId).toBe(BASE_SECTION);
    expect(filterArg.trackerKind).toBe("classtest");
    expect(filterArg.status).toBeUndefined();
  });

  test("filter by status=closed constructs correct query", async () => {
    mockTrackerFind.mockResolvedValue([]);
    await listTrackers({ sectionId: BASE_SECTION, status: "closed" });

    const filterArg = mockTrackerFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filterArg.status).toBe("closed");
    expect(filterArg.trackerKind).toBeUndefined();
  });

  test("filter by setId constructs correct query", async () => {
    mockTrackerFind.mockResolvedValue([]);
    const sid = SET_ID.toString();
    await listTrackers({ sectionId: BASE_SECTION, setId: sid });

    const filterArg = mockTrackerFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filterArg.setId).toBe(sid);
  });

  test("combined filter: kind + status", async () => {
    mockTrackerFind.mockResolvedValue([]);
    await listTrackers({ sectionId: BASE_SECTION, trackerKind: "homework", status: "open" });

    const filterArg = mockTrackerFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filterArg.trackerKind).toBe("homework");
    expect(filterArg.status).toBe("open");
  });

  test("no optional filters → only sectionId in query", async () => {
    mockTrackerFind.mockResolvedValue([]);
    await listTrackers({ sectionId: BASE_SECTION });

    const filterArg = mockTrackerFind.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(filterArg)).toEqual(["sectionId"]);
  });
});

// ===========================================================================
// J4.5 — Tracker write-scope: supervisory grant is read-only
// ===========================================================================

describe("J4.5 — tracker write-scope (same rule as J3.5)", () => {
  const SECTION_A = "sectionA";
  const CLASS_A = "classA";
  const SUBJ_BAN = "subjBAN";

  function teachingScope(sectionId: string, classId: string, subjectId: string): ScopeItem {
    return { kind: "teaching", sectionId, classId, subjectId };
  }
  function supervisoryScope(extent: string): ScopeItem {
    return { kind: "supervisory", extent };
  }

  test("canWrite returns false for supervisory-only grant (J4.5)", () => {
    expect(canWrite([supervisoryScope("whole_school")], SECTION_A)).toBe(false);
  });

  test("canWrite returns false for supervisory grade_class grant (J4.5)", () => {
    expect(canWrite([supervisoryScope("grade_class")], SECTION_A)).toBe(false);
  });

  test("canWrite returns true for teaching grant on the section (J4.5)", () => {
    expect(canWrite([teachingScope(SECTION_A, CLASS_A, SUBJ_BAN)], SECTION_A)).toBe(true);
  });

  test("canWrite returns true for proxy grant on the covered section (J4.5)", () => {
    const scopes: ScopeItem[] = [{ kind: "proxy", sectionId: SECTION_A, classId: CLASS_A, grantId: "g1" }];
    expect(canWrite(scopes, SECTION_A)).toBe(true);
  });

  test("canWrite returns false for proxy grant on a DIFFERENT section (J4.5)", () => {
    const scopes: ScopeItem[] = [{ kind: "proxy", sectionId: "sectionB", classId: CLASS_A, grantId: "g1" }];
    expect(canWrite(scopes, SECTION_A)).toBe(false);
  });

  test("canWrite returns false with empty scope list", () => {
    expect(canWrite([], SECTION_A)).toBe(false);
  });

  test("RBAC: TEACHER has tracker:write permission", () => {
    expect(roleHasPermission("TEACHER", "tracker:write")).toBe(true);
  });

  test("RBAC: TEACHER has tracker:read permission", () => {
    expect(roleHasPermission("TEACHER", "tracker:read")).toBe(true);
  });

  test("RBAC: TEACHER has message:dispatch (for wa.me link, R-T2)", () => {
    expect(roleHasPermission("TEACHER", "message:dispatch")).toBe(true);
  });
});
