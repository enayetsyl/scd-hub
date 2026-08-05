/**
 * D-#452 — the weekly guardian homework digest: window arithmetic, the
 * last-open-day rule, the data split (unsubmitted vs heads-up), the Bangla
 * builders + the self-capping body (no channel-side truncation exists), and
 * the dispatcher's render-once posture.
 *
 * DB-free: models + calendar + due-date + templates + emitter are mocked; the
 * service logic and the pure builders run for real.
 */
import mongoose from "mongoose";
import {
  NOTIFICATION_KINDS,
  MESSAGE_TEMPLATE_KEYS,
  MESSAGE_TEMPLATE_REGISTRY,
} from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();
const leanChain = <T,>(v: T) => ({ select: () => ({ lean: () => Promise.resolve(v) }) });

const mockItemFind = jest.fn();
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { find: (q: unknown) => mockItemFind(q) },
}));
const mockRecFind = jest.fn();
jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { find: (q: unknown) => mockRecFind(q) },
}));
const mockStudentFind = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (q: unknown) => mockStudentFind(q) },
}));
const mockSectionFind = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (q: unknown) => mockSectionFind(q) },
}));
const mockGuardianFind = jest.fn();
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: { find: (q: unknown) => mockGuardianFind(q) },
}));
const mockLinkFind = jest.fn();
jest.mock("../modules/foundation/models/GuardianLink", () => ({
  GuardianLink: { find: (q: unknown) => mockLinkFind(q) },
}));
const mockResolveDayType = jest.fn();
jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: (d: Date) => mockResolveDayType(d),
}));
// Routine-aware due date — its walk is covered by homeworkDueDate.test.ts.
jest.mock("../modules/trackers/homeworkDueDate", () => {
  const { nextSchoolDay } = jest.requireActual("../modules/trackers/calendar");
  return {
    resolveHomeworkDueDate: (_s: unknown, _subj: unknown, after: Date) =>
      Promise.resolve(nextSchoolDay(after)),
  };
});
const mockRenderTemplate = jest.fn();
jest.mock("../modules/templates/services/MessageTemplateService", () => ({
  renderTemplate: (key: string, params?: Record<string, unknown>) => mockRenderTemplate(key, params),
}));
const mockEmitDigest = jest.fn();
jest.mock("../modules/notifications/services/emitters", () => ({
  emitHomeworkWeeklyDigest: (ev: unknown) => mockEmitDigest(ev),
}));

// Import AFTER mocks
import {
  digestWindowOf,
  isHomeworkWeeklyDigestDay,
  homeworkWeeklyDigestData,
  buildUnsubmittedSummary,
  buildHeadsUpSummary,
  clampDigestBody,
  dispatchHomeworkWeeklyDigest,
  HW_DIGEST_MAX_LINES,
  HW_DIGEST_BODY_MAX_CHARS,
  type HwWeeklyItemLine,
} from "../modules/trackers/services/HomeworkWeeklyDigestService";

// 2026-08-06 is a THURSDAY (2026-08-02 = Sunday), local dates throughout.
const THURSDAY = new Date(2026, 7, 6, 17, 0);
const CLASS_A = oid();
const SECTION_A = oid();

function item(over: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    hwId: "HW-C1-MATH-0001",
    subject: "MATH",
    dateGiven: new Date(2026, 7, 5), // Wednesday
    description: "পৃষ্ঠা ১২-১৪",
    qCount: 3,
    timeDecl: 20,
    sectionId: SECTION_A,
    classId: CLASS_A,
    classLevel: 1,
    status: "issued",
    ...over,
  };
}

/** Wire the model mocks over fixed doc sets, applying the queries' own filters. */
function stubData(opts: {
  items?: ReturnType<typeof item>[];
  records?: Array<Record<string, unknown>>;
  classStudents?: Array<Record<string, unknown>>;
  students?: Array<Record<string, unknown>>;
  sections?: Array<Record<string, unknown>>;
}) {
  mockItemFind.mockImplementation((q: { dateGiven?: { $gte: Date; $lte: Date } }) =>
    leanChain(
      (opts.items ?? []).filter(
        (i) =>
          !q.dateGiven ||
          ((i.dateGiven as Date) >= q.dateGiven.$gte && (i.dateGiven as Date) <= q.dateGiven.$lte),
      ),
    ),
  );
  mockRecFind.mockImplementation((q: { hwItemId?: { $in: unknown[] }; state?: { $in: string[] } }) =>
    leanChain(
      (opts.records ?? []).filter(
        (r) =>
          (!q.hwItemId || q.hwItemId.$in.some((id) => String(id) === String(r.hwItemId))) &&
          (!q.state || q.state.$in.includes(r.state as string)),
      ),
    ),
  );
  mockStudentFind.mockImplementation((q: { classId?: unknown; _id?: unknown }) =>
    leanChain(q.classId ? (opts.classStudents ?? []) : (opts.students ?? [])),
  );
  mockSectionFind.mockImplementation(() => leanChain(opts.sections ?? []));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveDayType.mockResolvedValue("FULL");
  // Render the registry's real bnDefault with flat {token} interpolation.
  mockRenderTemplate.mockImplementation(async (key: string, params?: Record<string, unknown>) => {
    const def = MESSAGE_TEMPLATE_REGISTRY[key as keyof typeof MESSAGE_TEMPLATE_REGISTRY];
    let out = def ? def.bnDefault : `TPL:${key}`;
    for (const [k, v] of Object.entries(params ?? {})) out = out.split(`{${k}}`).join(String(v));
    return out;
  });
  mockEmitDigest.mockResolvedValue(["g1"]);
  stubData({});
});

describe("D-#452 vocab", () => {
  test("HW_WEEKLY_DIGEST is a registered kind; the homework.weeklyDigest.* MT keys exist", () => {
    expect(NOTIFICATION_KINDS).toContain("HW_WEEKLY_DIGEST");
    for (const k of ["homework.weeklyDigest.title", "homework.weeklyDigest.body", "homework.weeklyDigest.wa"]) {
      expect(MESSAGE_TEMPLATE_KEYS).toContain(k);
      expect(MESSAGE_TEMPLATE_REGISTRY[k as keyof typeof MESSAGE_TEMPLATE_REGISTRY]).toBeTruthy();
    }
  });
});

describe("digestWindowOf", () => {
  test("Thursday → weekStart Sunday, unsub Sun..Wed, heads-up Thursday", () => {
    const w = digestWindowOf(THURSDAY);
    expect(w.weekStartKey).toBe("2026-08-02");
    expect(w.unsubFromKey).toBe("2026-08-02");
    expect(w.unsubToKey).toBe("2026-08-05");
    expect(w.headsUpKey).toBe("2026-08-06");
  });

  test("a rolled-back Wednesday digest keeps the same weekStart, heads-up = Wednesday", () => {
    const w = digestWindowOf(new Date(2026, 7, 5, 17, 0));
    expect(w.weekStartKey).toBe("2026-08-02");
    expect(w.unsubToKey).toBe("2026-08-04");
    expect(w.headsUpKey).toBe("2026-08-05");
  });
});

describe("isHomeworkWeeklyDigestDay — the last-open-day rule", () => {
  test("a plain Thursday is a digest day (no later school day exists)", async () => {
    await expect(isHomeworkWeeklyDigestDay(THURSDAY)).resolves.toBe(true);
    expect(mockResolveDayType).not.toHaveBeenCalled(); // Friday ends the walk immediately
  });

  test("Wednesday with an open Thursday is NOT a digest day", async () => {
    mockResolveDayType.mockResolvedValue("FULL");
    await expect(isHomeworkWeeklyDigestDay(new Date(2026, 7, 5, 17, 0))).resolves.toBe(false);
  });

  test("Wednesday IS the digest day when Thursday is a holiday (roll-back)", async () => {
    mockResolveDayType.mockResolvedValue("HOLIDAY");
    await expect(isHomeworkWeeklyDigestDay(new Date(2026, 7, 5, 17, 0))).resolves.toBe(true);
  });

  test("Saturday is never a digest day (QURAN_ONLY passes the scheduler gate)", async () => {
    await expect(isHomeworkWeeklyDigestDay(new Date(2026, 7, 8, 17, 0))).resolves.toBe(false);
  });

  test("Sunday with the rest of the week open is not a digest day", async () => {
    mockResolveDayType.mockResolvedValue("FULL");
    await expect(isHomeworkWeeklyDigestDay(new Date(2026, 7, 2, 17, 0))).resolves.toBe(false);
  });
});

describe("homeworkWeeklyDigestData — the window split + state filter", () => {
  const STUDENT = oid();

  test("a Wednesday DUE record is unsubmitted; Thursday's item is heads-up, never unsubmitted", async () => {
    const wedItem = item(); // Wed 05
    const thuItem = item({ _id: oid(), hwId: "HW-C1-ENG-0002", subject: "ENG", dateGiven: new Date(2026, 7, 6), status: "declared" });
    stubData({
      items: [wedItem, thuItem],
      records: [
        { hwItemId: wedItem._id, studentId: STUDENT, sectionId: SECTION_A, classId: CLASS_A, state: "DUE", chaseCount: 0, dueDate: new Date(2026, 7, 6) },
      ],
      classStudents: [{ _id: STUDENT, classId: CLASS_A, sectionId: SECTION_A }],
      students: [{ _id: STUDENT, name: "Amina", nameBn: "আমিনা", rollNumber: "07", phone: "017" }],
      sections: [{ _id: SECTION_A, nameBn: "প্রথম শ্রেণি" }],
    });
    const out = await homeworkWeeklyDigestData(digestWindowOf(THURSDAY));
    expect(out).toHaveLength(1);
    expect(out[0].unsubmitted).toHaveLength(1);
    expect(out[0].unsubmitted[0].dateKey).toBe("2026-08-05");
    // Thursday's DECLARED (unissued) item still reaches the heads-up (Layer A).
    expect(out[0].headsUp).toHaveLength(1);
    expect(out[0].headsUp[0].subject).toBe("ENG");
    expect(out[0].nameBn).toBe("আমিনা");
    expect(out[0].sectionNameBn).toBe("প্রথম শ্রেণি");
  });

  test("SUBMITTED/CHECKED/ABSENT_REDELIVER records never appear (OWED_BY_STUDENT basis)", async () => {
    const wedItem = item();
    stubData({
      items: [wedItem],
      records: [
        { hwItemId: wedItem._id, studentId: STUDENT, sectionId: SECTION_A, classId: CLASS_A, state: "SUBMITTED", chaseCount: 0 },
        { hwItemId: wedItem._id, studentId: oid(), sectionId: SECTION_A, classId: CLASS_A, state: "ABSENT_REDELIVER", chaseCount: 0 },
        { hwItemId: wedItem._id, studentId: oid(), sectionId: SECTION_A, classId: CLASS_A, state: "CHECKED", chaseCount: 1 },
      ],
    });
    const out = await homeworkWeeklyDigestData(digestWindowOf(THURSDAY));
    expect(out).toHaveLength(0);
  });

  test("unsubmitted lines sort subject-first, then dateKey", async () => {
    const m1 = item({ _id: oid(), subject: "MATH", dateGiven: new Date(2026, 7, 4) });
    const m2 = item({ _id: oid(), subject: "MATH", dateGiven: new Date(2026, 7, 2) });
    const b1 = item({ _id: oid(), subject: "BAN", dateGiven: new Date(2026, 7, 5) });
    const rec = (it: ReturnType<typeof item>) => ({
      hwItemId: it._id, studentId: STUDENT, sectionId: SECTION_A, classId: CLASS_A, state: "CHASE", chaseCount: 1,
    });
    stubData({
      items: [m1, m2, b1],
      records: [rec(m1), rec(m2), rec(b1)],
      students: [{ _id: STUDENT, name: "A" }],
      sections: [{ _id: SECTION_A, nameBn: "x" }],
    });
    const out = await homeworkWeeklyDigestData(digestWindowOf(THURSDAY));
    expect(out[0].unsubmitted.map((l) => `${l.subject}:${l.dateKey}`)).toEqual([
      "BAN:2026-08-05",
      "MATH:2026-08-02",
      "MATH:2026-08-04",
    ]);
  });
});

describe("builders + the self-capping body", () => {
  const line = (over: Partial<HwWeeklyItemLine> = {}): HwWeeklyItemLine => ({
    hwItemId: "i", hwId: "HW-C1-MATH-0001", subject: "MATH", subjectLabelBn: "গণিত",
    dateKey: "2026-08-05", description: "পৃষ্ঠা ১২", state: "CHASE", stateLabelBn: "তাগাদা",
    chaseCount: 1, dueDateKey: "2026-08-06", ...over,
  });

  test("empty unsubmitted → the all-clear line; chase count rendered when > 0", () => {
    expect(buildUnsubmittedSummary([])).toMatch(/সব বাড়ির কাজ জমা হয়েছে/);
    expect(buildUnsubmittedSummary([line()])).toMatch(/গণিত — 2026-08-05: পৃষ্ঠা ১২ \(তাগাদা ×1\)/);
    expect(buildUnsubmittedSummary([line({ chaseCount: 0 })])).not.toMatch(/তাগাদা/);
  });

  test("line cap: beyond the max, lines truncate with a + আরও tail", () => {
    const lines = Array.from({ length: HW_DIGEST_MAX_LINES + 4 }, (_, i) => line({ dateKey: `2026-08-${String(i + 1).padStart(2, "0")}` }));
    const s = buildUnsubmittedSummary(lines);
    expect(s.split("\n")).toHaveLength(1 + HW_DIGEST_MAX_LINES + 1); // header + capped + tail
    expect(s).toMatch(/\+ আরও 4টি/);
  });

  test("heads-up: empty → empty string; lines carry the derived due day", () => {
    expect(buildHeadsUpSummary([])).toBe("");
    const s = buildHeadsUpSummary([
      { hwItemId: "i", hwId: "h", subject: "ENG", subjectLabelBn: "ইংরেজি", description: "রিডিং", qCount: 2, timeDecl: 15, dueDateKey: "2026-08-09" },
    ]);
    expect(s).toMatch(/আজ দেওয়া বাড়ির কাজ:/);
    expect(s).toMatch(/ইংরেজি: রিডিং \(জমা 2026-08-09\)/);
  });

  test("clampDigestBody: over-long bodies cut at a line boundary with the see-app tail", () => {
    const body = Array.from({ length: 200 }, (_, i) => `লাইন ${i}`).join("\n");
    const clamped = clampDigestBody(body);
    expect(clamped.length).toBeLessThanOrEqual(HW_DIGEST_BODY_MAX_CHARS);
    expect(clamped).toMatch(/বিস্তারিত অ্যাপে দেখুন/);
    expect(clamped).not.toMatch(/লাইন 199/);
    const short = "ছোট বার্তা";
    expect(clampDigestBody(short)).toBe(short);
  });
});

describe("dispatchHomeworkWeeklyDigest", () => {
  const STUDENT = oid();

  test("renders the title ONCE, emits per student, sums notified guardians", async () => {
    const wedItem = item();
    stubData({
      items: [wedItem],
      records: [
        { hwItemId: wedItem._id, studentId: STUDENT, sectionId: SECTION_A, classId: CLASS_A, state: "CHASE", chaseCount: 1 },
        { hwItemId: wedItem._id, studentId: oid(), sectionId: SECTION_A, classId: CLASS_A, state: "DUE", chaseCount: 0 },
      ],
      students: [{ _id: STUDENT, name: "A", nameBn: "আমিনা" }],
      sections: [{ _id: SECTION_A, nameBn: "x" }],
    });
    mockEmitDigest.mockResolvedValue(["g1", "g2"]);
    const res = await dispatchHomeworkWeeklyDigest(THURSDAY);
    expect(res.students).toBe(2);
    expect(res.notified).toBe(4);
    const titleCalls = mockRenderTemplate.mock.calls.filter((c) => c[0] === "homework.weeklyDigest.title");
    expect(titleCalls).toHaveLength(1); // the MT N+1 guard
    const ev = mockEmitDigest.mock.calls[0][0];
    expect(ev.weekStartKey).toBe("2026-08-02");
    expect(ev.messageBn).toMatch(/আমিনা|এই সপ্তাহের/);
    expect(ev.messageBn).toMatch(/জমা হয়নি:/);
  });

  test("no homework in the window → nothing rendered, nothing emitted", async () => {
    stubData({});
    const res = await dispatchHomeworkWeeklyDigest(THURSDAY);
    expect(res).toEqual({ students: 0, notified: 0 });
    expect(mockRenderTemplate).not.toHaveBeenCalled();
    expect(mockEmitDigest).not.toHaveBeenCalled();
  });
});
