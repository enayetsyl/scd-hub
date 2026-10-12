/**
 * Class-test scripts (CS-1..CS-3, docs/prd-ct-scripts.md, D-#715–#719).
 *
 * Stage      — deriveStage over every stamp combination; overdue is STRICTLY after
 *              the due day (D-#715); absentees never block UPLOAD_DONE; precedence
 *              WAIVED > RETURNED > WITH_TEACHER > PUBLISHED > UPLOAD_* > DUE.
 * Clock      — 1 school day, Fri/Sat skipped (Thu → Sun).
 * Transitions— each refuses the wrong stage; receive/tag/missing/publish/hand-back/
 *              return/waive write the right stamps + one audit row; publish notifies
 *              only students with pages; a page belongs to one student.
 * File gate  — Office always; guardian only own child + both publishes; untagged
 *              files Office-only; teacher by anchor read scope.
 *
 * DB-free (the repo's convention): models, audit, emitters and the calendar are mocked
 * over a small in-memory test + result set.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// In-memory state + a tiny update applier
// ---------------------------------------------------------------------------

type Row = Record<string, unknown> & { _id: mongoose.Types.ObjectId; studentId: mongoose.Types.ObjectId };
const state: { test: Record<string, unknown> | null; results: Row[]; files: Array<{ _id: mongoose.Types.ObjectId; kind: string; mime: string }> } = {
  test: null,
  results: [],
  files: [],
};

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}
function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, p) => (o == null ? undefined : (o as Record<string, unknown>)[p]), obj);
}
function applyUpdate(doc: Record<string, unknown>, u: Record<string, Record<string, unknown>>): void {
  for (const [k, v] of Object.entries(u.$set ?? {})) setPath(doc, k, v);
  for (const [k, v] of Object.entries(u.$inc ?? {})) setPath(doc, k, ((getPath(doc, k) as number) ?? 0) + (v as number));
  for (const [k, v] of Object.entries(u.$push ?? {})) {
    const each = (v as { $each: unknown[] }).$each;
    setPath(doc, k, [...(((getPath(doc, k) as unknown[]) ?? []) as unknown[]), ...each]);
  }
  for (const [k, v] of Object.entries(u.$pull ?? {})) {
    setPath(doc, k, ((getPath(doc, k) as unknown[]) ?? []).filter((x) => String(x) !== String(v)));
  }
}

const chain = (val: () => unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val();
  return o;
};

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the module under test)
// ---------------------------------------------------------------------------

jest.mock("../modules/trackers/models/ClassTest", () => ({
  ClassTest: {
    findById: () => chain(() => (state.test ? { ...state.test } : null)),
    find: () => chain(() => (state.test ? [{ ...state.test }] : [])),
    exists: async (q: Record<string, unknown>) =>
      state.test && "scripts.dueDateKey" in q ? (getPath(state.test, "scripts.dueDateKey") ? { _id: 1 } : null) : null,
    updateOne: async (_q: unknown, u: Record<string, Record<string, unknown>>) => {
      if (state.test) applyUpdate(state.test, u);
      return { modifiedCount: 1 };
    },
    findOneAndUpdate: (_q: unknown, u: Record<string, Record<string, unknown>>) => {
      if (state.test) applyUpdate(state.test, u);
      return chain(() => (state.test ? { ...state.test } : null));
    },
  },
}));

jest.mock("../modules/trackers/models/ClassTestResult", () => ({
  ClassTestResult: {
    aggregate: async () => {
      const present = state.results.filter((r) => r.status === "PRESENT");
      if (present.length === 0) return [];
      const pagesOf = (r: Row) => ((r.scriptFileIds as unknown[]) ?? []).length;
      return [
        {
          _id: state.test!._id,
          presentCount: present.length,
          resolvedCount: present.filter((r) => pagesOf(r) > 0 || r.scriptMissing === true).length,
          pageCount: present.reduce((n, r) => n + pagesOf(r), 0),
        },
      ];
    },
    find: (q: Record<string, unknown>) =>
      chain(() =>
        state.results.filter((r) =>
          q["scriptFileIds.0"] ? ((r.scriptFileIds as unknown[]) ?? []).length > 0 && r.publishedAt : true,
        ),
      ),
    findOne: (q: Record<string, unknown>) =>
      chain(() => {
        if (q.scriptFileIds) {
          return state.results.find((r) => ((r.scriptFileIds as unknown[]) ?? []).some((f) => String(f) === String(q.scriptFileIds))) ?? null;
        }
        return state.results.find((r) => String(r.studentId) === String(q.studentId)) ?? null;
      }),
    exists: async (q: { scriptFileIds: { $in: unknown[] } }) => {
      const ids = q.scriptFileIds.$in.map(String);
      return state.results.some((r) => ((r.scriptFileIds as unknown[]) ?? []).some((f) => ids.includes(String(f)))) ? { _id: 1 } : null;
    },
    updateOne: async (q: { _id: unknown }, u: Record<string, Record<string, unknown>>) => {
      const row = state.results.find((r) => String(r._id) === String(q._id));
      if (row) applyUpdate(row, u);
      return { modifiedCount: row ? 1 : 0 };
    },
  },
}));

jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: {
    countDocuments: async (q: { _id: { $in: unknown[] }; kind: string }) =>
      state.files.filter((f) => q._id.$in.map(String).includes(String(f._id)) && f.kind === q.kind).length,
    find: () => chain(() => state.files),
  },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: () => chain(() => [{ _id: SECTION, nameBn: "খ" }]) },
}));
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: { find: () => chain(() => []) },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: () => chain(() => [{ _id: TEACHER, name: "মাহফুজ" }]) },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: () => chain(() => []) },
}));

const mockAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (...a: unknown[]) => mockAudit(...a),
}));

const mockEmit = jest.fn(async (..._a: unknown[]) => ["g1", "g2"]);
jest.mock("../modules/notifications/services/emitters", () => ({
  emitCtScriptPublished: (...a: unknown[]) => mockEmit(...a),
}));

// Sun–Thu open; Fri (5) and Sat (6) closed — the school week.
jest.mock("../modules/trackers/classTestCalendar", () => {
  const actual = jest.requireActual("../modules/trackers/classTestCalendar");
  return {
    ...actual,
    buildIsOpenDayForRange: async () => (d: Date) => d.getDay() !== 5 && d.getDay() !== 6,
  };
});

class FakeForbidden extends Error {
  constructor(msg = "Forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}
const mockGuardianOf = jest.fn();
jest.mock("../middleware/authz", () => ({
  ForbiddenError: FakeForbidden,
  assertGuardianOfStudent: (...a: unknown[]) => mockGuardianOf(...a),
}));
const mockAnchorRead = jest.fn();
jest.mock("../modules/trackers/classTestAnchor", () => ({
  assertAnchorRead: (...a: unknown[]) => mockAnchorRead(...a),
}));
jest.mock("../modules/trackers/models/ClassTestQuestionRequest", () => ({
  ClassTestQuestionRequest: { exists: async () => null },
}));

const SECTION = oid();
const TEACHER = oid();
const ACTOR = oid().toString();

import {
  deriveStage,
  schoolDaysAfterKey,
  receiveScripts,
  undoReceiveScripts,
  attachScriptPages,
  setScriptMissing,
  publishScripts,
  unpublishScripts,
  handBackScripts,
  markScriptsReturned,
  waiveScripts,
  unwaiveScripts,
  startScriptClock,
  type ScriptResolution,
} from "../modules/trackers/services/ClassTestScriptService";
import { assertClassTestScriptReadAccess } from "../modules/trackers/services/ClassTestFileService";

// A Monday in Dhaka, mid-day.
const MON = new Date("2026-10-12T06:00:00Z");
const res = (presentCount: number, resolvedCount: number): ScriptResolution => ({ presentCount, resolvedCount, pageCount: resolvedCount });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function seed(scripts: Record<string, unknown> | null = { dueDateKey: "2026-10-13", publishedVersion: 0 }): {
  a: Row;
  b: Row;
  absent: Row;
} {
  state.test = {
    _id: oid(),
    ctId: "CT-C4-MATH-0003",
    status: "PRINTED",
    subject: "MATH",
    testNumber: 3,
    examDate: new Date("2026-10-06"),
    totalMarks: 20,
    classLevel: 4,
    sectionId: SECTION,
    subjectGroupId: null,
    teacherId: TEACHER,
    requestedBy: TEACHER,
    ...(scripts ? { scripts: { ...scripts } } : {}),
  };
  const a: Row = { _id: oid(), studentId: oid(), status: "PRESENT", marks: 15, publishedAt: new Date() };
  const b: Row = { _id: oid(), studentId: oid(), status: "PRESENT", marks: 9, publishedAt: new Date() };
  const absent: Row = { _id: oid(), studentId: oid(), status: "ABSENT", publishedAt: new Date() };
  state.results = [a, b, absent];
  state.files = [];
  return { a, b, absent };
}
const scriptFile = () => {
  const f = { _id: oid(), kind: "classtest_script", mime: "image/jpeg" };
  state.files.push(f);
  return f._id.toString();
};
const scripts = () => state.test!.scripts as Record<string, unknown>;

beforeEach(() => {
  mockAudit.mockClear();
  mockEmit.mockClear();
  mockGuardianOf.mockReset();
  mockAnchorRead.mockReset();
});

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

describe("deriveStage", () => {
  const base = { dueDateKey: "2026-10-13" };

  test("not in the flow without a scripts field", () => {
    expect(deriveStage(null, res(2, 0), "2026-10-12")).toBeNull();
  });

  test("DUE through the due day itself, OVERDUE strictly after (D-#715)", () => {
    expect(deriveStage(base, res(2, 0), "2026-10-12")).toBe("DUE");
    expect(deriveStage(base, res(2, 0), "2026-10-13")).toBe("DUE");
    expect(deriveStage(base, res(2, 0), "2026-10-14")).toBe("OVERDUE");
  });

  test("received: pending → in progress → done over PRESENT students only", () => {
    const r = { ...base, receivedAt: new Date() };
    expect(deriveStage(r, res(2, 0), "2026-10-20")).toBe("UPLOAD_PENDING");
    expect(deriveStage(r, res(2, 1), "2026-10-20")).toBe("UPLOAD_IN_PROGRESS");
    expect(deriveStage(r, res(2, 2), "2026-10-20")).toBe("UPLOAD_DONE");
    // A test every student was absent for has nothing to scan.
    expect(deriveStage(r, res(0, 0), "2026-10-20")).toBe("UPLOAD_DONE");
  });

  test("published → with teacher → return overdue (strictly after) → returned", () => {
    const p = { ...base, receivedAt: new Date(), publishedAt: new Date() };
    expect(deriveStage(p, res(2, 2), "2026-10-20")).toBe("PUBLISHED");
    const h = { ...p, handedBackAt: new Date(), returnDueDateKey: "2026-10-21" };
    expect(deriveStage(h, res(2, 2), "2026-10-21")).toBe("WITH_TEACHER");
    expect(deriveStage(h, res(2, 2), "2026-10-22")).toBe("RETURN_OVERDUE");
    expect(deriveStage({ ...h, returnedAt: new Date() }, res(2, 2), "2026-10-30")).toBe("RETURNED");
  });

  test("WAIVED wins over everything", () => {
    expect(deriveStage({ ...base, receivedAt: new Date(), waivedAt: new Date() }, res(2, 1), "2026-10-30")).toBe("WAIVED");
  });
});

describe("schoolDaysAfterKey — 1 school day, Fri/Sat skipped", () => {
  test("Monday → Tuesday", async () => {
    expect(await schoolDaysAfterKey("2026-10-12")).toBe("2026-10-13");
  });
  test("Thursday → Sunday", async () => {
    expect(await schoolDaysAfterKey("2026-10-15")).toBe("2026-10-18");
  });
});

describe("startScriptClock", () => {
  test("the first results publish stamps the due day; a re-publish never moves it", async () => {
    seed(null);
    await startScriptClock(state.test!._id as mongoose.Types.ObjectId, new Date("2026-10-15T06:00:00Z"));
    expect(scripts().dueDateKey).toBe("2026-10-18");
    await startScriptClock(state.test!._id as mongoose.Types.ObjectId, new Date("2026-10-20T06:00:00Z"));
    expect(scripts().dueDateKey).toBe("2026-10-18");
  });
});

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

describe("receive", () => {
  test("stamps the receipt + count and audits; a second receive is refused", async () => {
    seed();
    const row = await receiveScripts(String(state.test!._id), 2, ACTOR, MON);
    expect(row.stage).toBe("UPLOAD_PENDING");
    expect(scripts().receivedCount).toBe(2);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "CT_SCRIPTS_RECEIVED" }));
    await expect(receiveScripts(String(state.test!._id), 2, ACTOR, MON)).rejects.toThrow("আগেই গ্রহণ");
  });

  test("refused for a test not in the flow", async () => {
    seed(null);
    await expect(receiveScripts(String(state.test!._id), 2, ACTOR, MON)).rejects.toThrow("শুরু হয়নি");
  });

  test("undo only before anything is tagged", async () => {
    const { a } = seed();
    await receiveScripts(String(state.test!._id), 2, ACTOR, MON);
    await attachScriptPages(String(state.test!._id), String(a.studentId), [scriptFile()], ACTOR, MON);
    await expect(undoReceiveScripts(String(state.test!._id), ACTOR, MON)).rejects.toThrow();
  });
});

describe("tagging", () => {
  test("refused before the paper is received", async () => {
    const { a } = seed();
    await expect(
      attachScriptPages(String(state.test!._id), String(a.studentId), [scriptFile()], ACTOR, MON),
    ).rejects.toThrow("গ্রহণ");
  });

  test("an absent student needs no script", async () => {
    const { absent } = seed();
    await receiveScripts(String(state.test!._id), 2, ACTOR, MON);
    await expect(
      attachScriptPages(String(state.test!._id), String(absent.studentId), [scriptFile()], ACTOR, MON),
    ).rejects.toThrow("অনুপস্থিত");
  });

  test("only classtest_script files, and a page belongs to ONE student", async () => {
    const { a, b } = seed();
    await receiveScripts(String(state.test!._id), 2, ACTOR, MON);
    const other = oid();
    state.files.push({ _id: other, kind: "hw_question", mime: "image/png" });
    await expect(
      attachScriptPages(String(state.test!._id), String(a.studentId), [String(other)], ACTOR, MON),
    ).rejects.toThrow("স্ক্যান");
    const page = scriptFile();
    await attachScriptPages(String(state.test!._id), String(a.studentId), [page], ACTOR, MON);
    await expect(
      attachScriptPages(String(state.test!._id), String(b.studentId), [page], ACTOR, MON),
    ).rejects.toThrow("অন্য শিক্ষার্থীর");
  });

  test("খাতা নেই is refused while the student has pages", async () => {
    const { a } = seed();
    await receiveScripts(String(state.test!._id), 2, ACTOR, MON);
    await attachScriptPages(String(state.test!._id), String(a.studentId), [scriptFile()], ACTOR, MON);
    await expect(setScriptMissing(String(state.test!._id), String(a.studentId), true, null, ACTOR, MON)).rejects.toThrow(
      "পৃষ্ঠা আছে",
    );
  });
});

describe("publish → hand back → returned", () => {
  async function toUploadDone() {
    const { a, b } = seed();
    await receiveScripts(String(state.test!._id), 1, ACTOR, MON);
    await attachScriptPages(String(state.test!._id), String(a.studentId), [scriptFile(), scriptFile()], ACTOR, MON);
    return { a, b };
  }

  test("publish is refused until every PRESENT student is resolved", async () => {
    await toUploadDone();
    await expect(publishScripts(String(state.test!._id), ACTOR, MON)).rejects.toThrow("খাতা নেই");
  });

  test("publish bumps the version and notifies only students with pages", async () => {
    const { a, b } = await toUploadDone();
    const sheet = await setScriptMissing(String(state.test!._id), String(b.studentId), true, "হারিয়ে গেছে", ACTOR, MON);
    expect(sheet.test.stage).toBe("UPLOAD_DONE");
    const out = await publishScripts(String(state.test!._id), ACTOR, MON);
    expect(out.test.stage).toBe("PUBLISHED");
    expect(scripts().publishedVersion).toBe(1);
    expect(out.notifiedGuardianCount).toBe(2);
    const ev = mockEmit.mock.calls[0][0] as { studentIds: unknown[]; version: number };
    expect(ev.studentIds.map(String)).toEqual([String(a.studentId)]);
    expect(ev.version).toBe(1);
  });

  test("hand back needs PUBLISHED; returned needs the hand back; unpublish only before hand back", async () => {
    const { b } = await toUploadDone();
    await expect(handBackScripts(String(state.test!._id), ACTOR, MON)).rejects.toThrow("প্রকাশের পরে");
    await setScriptMissing(String(state.test!._id), String(b.studentId), true, null, ACTOR, MON);
    await expect(markScriptsReturned(String(state.test!._id), ACTOR, MON)).rejects.toThrow();
    await publishScripts(String(state.test!._id), ACTOR, MON);
    const handed = await handBackScripts(String(state.test!._id), ACTOR, MON);
    expect(handed.stage).toBe("WITH_TEACHER");
    expect(handed.returnDueDateKey).toBe("2026-10-13");
    await expect(unpublishScripts(String(state.test!._id), ACTOR, MON)).rejects.toThrow();
    const done = await markScriptsReturned(String(state.test!._id), ACTOR, MON);
    expect(done.stage).toBe("RETURNED");
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "CT_SCRIPTS_RETURNED" }));
  });
});

describe("waive", () => {
  test("needs a reason, and is refused once published", async () => {
    seed();
    await expect(waiveScripts(String(state.test!._id), "  ", ACTOR, MON)).rejects.toThrow("কারণ");
    const w = await waiveScripts(String(state.test!._id), "খাতা আগেই ফেরত দেওয়া হয়েছে", ACTOR, MON);
    expect(w.stage).toBe("WAIVED");
    const back = await unwaiveScripts(String(state.test!._id), ACTOR, MON);
    expect(back.stage).toBe("DUE");

    scripts().publishedAt = new Date();
    await expect(waiveScripts(String(state.test!._id), "x", ACTOR, MON)).rejects.toThrow("প্রকাশের পরে");
  });
});

// ---------------------------------------------------------------------------
// File read gate
// ---------------------------------------------------------------------------

describe("classtest_script read gate", () => {
  const ctxOf = (role: string, perms: string[] = []) =>
    ({ auth: { role, userId: oid().toString(), grantedPermissions: perms } }) as never;

  async function taggedPage() {
    const { a } = seed();
    await receiveScripts(String(state.test!._id), 2, ACTOR, MON);
    const page = scriptFile();
    await attachScriptPages(String(state.test!._id), String(a.studentId), [page], ACTOR, MON);
    return { a, file: { _id: new mongoose.Types.ObjectId(page) } as never };
  }

  test("the Office reads any page, tagged or not", async () => {
    seed();
    const untagged = { _id: oid() } as never;
    await expect(assertClassTestScriptReadAccess(ctxOf("OFFICE"), untagged)).resolves.toBeUndefined();
  });

  test("an untagged page is denied to a teacher", async () => {
    seed();
    await expect(assertClassTestScriptReadAccess(ctxOf("TEACHER"), { _id: oid() } as never)).rejects.toThrow();
  });

  test("a guardian is refused until the scripts are published, then allowed", async () => {
    const { file } = await taggedPage();
    await expect(assertClassTestScriptReadAccess(ctxOf("GUARDIAN"), file)).rejects.toThrow("প্রকাশ");
    scripts().publishedAt = new Date();
    await expect(assertClassTestScriptReadAccess(ctxOf("GUARDIAN"), file)).resolves.toBeUndefined();
  });

  test("a guardian is refused when the RESULT was unpublished", async () => {
    const { a, file } = await taggedPage();
    scripts().publishedAt = new Date();
    a.publishedAt = null;
    await expect(assertClassTestScriptReadAccess(ctxOf("GUARDIAN"), file)).rejects.toThrow("প্রকাশ");
  });

  test("the guardian of a different child is refused by the link check", async () => {
    const { file } = await taggedPage();
    scripts().publishedAt = new Date();
    mockGuardianOf.mockRejectedValueOnce(new FakeForbidden("এই শিক্ষার্থীর তথ্য দেখার অনুমতি নেই"));
    await expect(assertClassTestScriptReadAccess(ctxOf("GUARDIAN"), file)).rejects.toThrow("অনুমতি নেই");
  });

  test("a teacher reads by the test's read scope", async () => {
    const { file } = await taggedPage();
    await expect(assertClassTestScriptReadAccess(ctxOf("TEACHER"), file)).resolves.toBeUndefined();
    expect(mockAnchorRead).toHaveBeenCalledTimes(1);
  });
});
