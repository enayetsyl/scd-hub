/**
 * Review daily statistics (owner 22 Nov 2026, .claude/plans/review-daily-stats.md).
 *
 *   pure      day arithmetic, zero-filled rows + deltas, summary, notice text
 *   counting  first verdict only (a resubmit is ignored, a later supersede never removes it),
 *             Dhaka-midnight bucketing, per-kind via the round's docType, own vs team
 *   scope     a view_own caller can never read another reviewer or the team
 *   notice    who gets the 20:30 notice and who does not
 *
 * In-memory MongoDB, real services (holders are stubbed: they read the whole User collection).
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mockHolders = jest.fn((_perm: string) => Promise.resolve([] as string[]));
jest.mock("../modules/access-control/services/holders", () => ({
  holderIdsOf: (p: string) => mockHolders(p),
}));

import { Audit } from "../modules/platform/models/Audit";
import { User } from "../modules/foundation/models/User";
import { ReviewAssignment } from "../modules/content/models/ReviewAssignment";
import {
  addDaysToKey,
  buildDayRows,
  changeTextBn,
  dailyStatsRecipients,
  dayKeysBetween,
  reviewDayCounts,
  reviewStatsPage,
  reviewStatsSummary,
  reviewersWithStats,
  statsBodyBn,
  statsScope,
  summarize,
} from "../modules/review-program/services/ReviewStatsService";
import { ForbiddenError } from "../middleware/authz";
import { submitPlanReview } from "../modules/content/services/ReviewService";
import { submitQuestionReview, submitQuestionReviewBulk } from "../modules/questions/services/QuestionReviewService";
import { runWithAuditActor } from "../modules/platform/services/auditActor";

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all([Audit.deleteMany({}), ReviewAssignment.deleteMany({}), User.deleteMany({})]);
  mockHolders.mockResolvedValue([]);
});

const oid = () => new Types.ObjectId();

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

describe("day arithmetic and rows", () => {
  it("shifts a Dhaka day key across a month and year edge", () => {
    expect(addDaysToKey("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysToKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(dayKeysBetween("2026-11-20", "2026-11-22")).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(dayKeysBetween("2026-11-22", "2026-11-20")).toEqual([]);
  });

  it("builds newest-first rows with zero days and the change against the previous calendar day", () => {
    const rows = buildDayRows(
      [
        { dayKey: "2026-11-20", chapterPlans: 2, sessionPlans: 0, questions: 5 },
        { dayKey: "2026-11-22", chapterPlans: 1, sessionPlans: 1, questions: 0 },
      ],
      "2026-11-20",
      "2026-11-22",
    );
    expect(rows.map((r) => r.dayKey)).toEqual(["2026-11-22", "2026-11-21", "2026-11-20"]);
    // 20th: first day, compared with a zero day before it.
    expect(rows[2].counts.total).toBe(7);
    expect(rows[2].delta.total).toBe(7);
    // 21st: a zero day is still a row, and it fell by 7.
    expect(rows[1].counts.total).toBe(0);
    expect(rows[1].delta).toEqual({ chapterPlans: -2, sessionPlans: 0, questions: -5, total: -7 });
    // 22nd: up against the zero day.
    expect(rows[0].delta).toEqual({ chapterPlans: 1, sessionPlans: 1, questions: 0, total: 2 });
  });

  it("summarises today, yesterday, delta, the last 7 days and all time", () => {
    const s = summarize(
      [
        { dayKey: "2026-11-10", chapterPlans: 4, sessionPlans: 0, questions: 0 }, // outside the 7 days
        { dayKey: "2026-11-17", chapterPlans: 0, sessionPlans: 0, questions: 3 }, // first of the 7 (22-6)
        { dayKey: "2026-11-21", chapterPlans: 1, sessionPlans: 0, questions: 1 },
        { dayKey: "2026-11-22", chapterPlans: 0, sessionPlans: 2, questions: 3 },
      ],
      "2026-11-22",
    );
    expect(s.today.total).toBe(5);
    expect(s.yesterday.total).toBe(2);
    expect(s.delta.total).toBe(3);
    expect(s.last7Days.total).toBe(3 + 2 + 5);
    expect(s.allTime.total).toBe(4 + 3 + 2 + 5);
  });

  it("writes the notice in Bangla digits with the right arrow", () => {
    const today = { chapterPlans: 1, sessionPlans: 0, questions: 12, total: 13 };
    const yesterday = { chapterPlans: 0, sessionPlans: 0, questions: 10, total: 10 };
    const body = statsBodyBn(today, yesterday);
    expect(body).toBe("আজ আপনার পর্যালোচনা: অধ্যায় পরিকল্পনা ১, সেশন পরিকল্পনা ০, প্রশ্ন ১২ — মোট ১৩ (গতকাল ১০, ↑ ৩)।");
    expect(body).not.toMatch(/[0-9]/);
    expect(body).not.toContain("،");
    expect(changeTextBn(-2)).toBe("↓ ২");
    expect(changeTextBn(0)).toBe("সমান");
  });
});

// ---------------------------------------------------------------------------
// Counting (DB)
// ---------------------------------------------------------------------------

async function round(reviewerId: Types.ObjectId, docType: string, status = "submitted"): Promise<Types.ObjectId> {
  const doc = await ReviewAssignment.create({
    docType,
    subject: "MATH",
    classLevel: 3,
    anchorWord: "w",
    addressNumber: "1",
    artifactId: oid(),
    reviewerId,
    assignedBy: oid(),
    roundNumber: 1,
    status,
    ...(status === "assigned" ? {} : { verdict: "APPROVE" }),
  });
  return doc._id;
}

async function verdict(opts: {
  reviewer: Types.ObjectId;
  roundId: Types.ObjectId;
  at: string;
  resubmit?: boolean;
  kind?: string;
  targetKind?: string;
}): Promise<void> {
  await Audit.create({
    eventKind: opts.kind ?? "REVIEW_SUBMITTED",
    actorId: opts.reviewer,
    targetId: opts.roundId,
    targetKind: opts.targetKind ?? "ReviewAssignment",
    eventAt: new Date(opts.at),
    meta: { verdict: "APPROVE", resubmit: opts.resubmit === true },
  });
}

describe("counting rules", () => {
  it("counts the first verdict per kind, ignores a resubmit, and survives a supersede", async () => {
    const r1 = oid();
    const plan = await round(r1, "chapter_plan", "superseded"); // a later supersede must not remove the count
    const session = await round(r1, "session_plan");
    const q1 = await round(r1, "question");
    const q2 = await round(r1, "question");
    await verdict({ reviewer: r1, roundId: plan, at: "2026-11-21T05:00:00+06:00" });
    await verdict({ reviewer: r1, roundId: plan, at: "2026-11-21T09:00:00+06:00", resubmit: true });
    await verdict({ reviewer: r1, roundId: session, at: "2026-11-21T10:00:00+06:00" });
    await verdict({ reviewer: r1, roundId: q1, at: "2026-11-21T11:00:00+06:00" });
    await verdict({ reviewer: r1, roundId: q2, at: "2026-11-21T11:30:00+06:00" });
    // Not a plan/question review round: ignored.
    await verdict({ reviewer: r1, roundId: q1, at: "2026-11-21T12:00:00+06:00", targetKind: "Other" });
    await verdict({ reviewer: r1, roundId: q1, at: "2026-11-21T12:00:00+06:00", kind: "REVIEW_CANCELLED" });

    const counts = await reviewDayCounts({ reviewerId: r1.toString(), fromKey: "2026-11-21", toKey: "2026-11-21" });
    expect(counts).toEqual([{ dayKey: "2026-11-21", chapterPlans: 1, sessionPlans: 1, questions: 2 }]);
  });

  it("buckets at Dhaka midnight, not UTC midnight", async () => {
    const r1 = oid();
    const a = await round(r1, "question");
    const b = await round(r1, "question");
    const c = await round(r1, "question");
    // 23:59 Dhaka on the 20th (= 17:59Z) | 00:00 Dhaka on the 21st (= 18:00Z on the 20th) | 23:59 Dhaka on the 21st
    await verdict({ reviewer: r1, roundId: a, at: "2026-11-20T23:59:00+06:00" });
    await verdict({ reviewer: r1, roundId: b, at: "2026-11-21T00:00:00+06:00" });
    await verdict({ reviewer: r1, roundId: c, at: "2026-11-21T23:59:00+06:00" });
    const counts = await reviewDayCounts({ reviewerId: r1.toString(), fromKey: "2026-11-20", toKey: "2026-11-21" });
    expect(counts.map((x) => [x.dayKey, x.questions])).toEqual([
      ["2026-11-20", 1],
      ["2026-11-21", 2],
    ]);
    // The range is inclusive of the whole last Dhaka day and excludes the next.
    const only20 = await reviewDayCounts({ reviewerId: r1.toString(), fromKey: "2026-11-20", toKey: "2026-11-20" });
    expect(only20).toHaveLength(1);
    expect(only20[0].questions).toBe(1);
  });

  it("own numbers exclude other reviewers; team includes everyone", async () => {
    const r1 = oid();
    const r2 = oid();
    await verdict({ reviewer: r1, roundId: await round(r1, "question"), at: "2026-11-21T10:00:00+06:00" });
    await verdict({ reviewer: r2, roundId: await round(r2, "chapter_plan"), at: "2026-11-21T10:00:00+06:00" });
    const own = await reviewDayCounts({ reviewerId: r1.toString(), fromKey: "2026-11-21", toKey: "2026-11-21" });
    expect(own).toEqual([{ dayKey: "2026-11-21", chapterPlans: 0, sessionPlans: 0, questions: 1 }]);
    const team = await reviewDayCounts({ fromKey: "2026-11-21", toKey: "2026-11-21" });
    expect(team).toEqual([{ dayKey: "2026-11-21", chapterPlans: 1, sessionPlans: 0, questions: 1 }]);
  });

  it("the page lists zero days from the first reviewed day to today, newest first, and pages", async () => {
    const r1 = oid();
    await verdict({ reviewer: r1, roundId: await round(r1, "question"), at: "2026-11-19T10:00:00+06:00" });
    await verdict({ reviewer: r1, roundId: await round(r1, "question"), at: "2026-11-22T10:00:00+06:00" });
    const now = new Date("2026-11-22T15:00:00+06:00");
    const p = await reviewStatsPage({ reviewerId: r1.toString(), page: 1, pageSize: 3 }, now);
    expect(p.total).toBe(4);
    expect(p.rows.map((r) => r.dayKey)).toEqual(["2026-11-22", "2026-11-21", "2026-11-20"]);
    expect(p.rows[1].counts.total).toBe(0);
    expect(p.rows[0].delta.total).toBe(1);
    const p2 = await reviewStatsPage({ reviewerId: r1.toString(), page: 2, pageSize: 3 }, now);
    expect(p2.rows.map((r) => r.dayKey)).toEqual(["2026-11-19"]);
    const sum = await reviewStatsSummary(r1.toString(), now);
    expect(sum.today.total).toBe(1);
    expect(sum.allTime.total).toBe(2);
  });

  it("lists reviewers with a first verdict or an open round, by name", async () => {
    const a = await User.create({ name: "Rahim", passwordHash: "x", phone: "01700000001", role: "TEACHER", active: true });
    const b = await User.create({ name: "Karim", passwordHash: "x", phone: "01700000002", role: "TEACHER", active: true });
    const c = await User.create({ name: "Idle", passwordHash: "x", phone: "01700000003", role: "TEACHER", active: true });
    await verdict({ reviewer: a._id, roundId: await round(a._id, "question"), at: "2026-11-21T10:00:00+06:00" });
    await round(b._id, "chapter_plan", "assigned");
    const list = await reviewersWithStats();
    expect(list.map((x) => x.name).sort()).toEqual(["Karim", "Rahim"]);
    expect(list.find((x) => x.name === "Idle")).toBeUndefined();
    expect(c).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Own-only gate
// ---------------------------------------------------------------------------

describe("statsScope", () => {
  const teacher = { userId: "t1", role: "TEACHER" as const, additionalTemplates: [], grantedPermissions: [], revokedPermissions: [] };
  const office = { userId: "o1", role: "OFFICE" as const, additionalTemplates: [], grantedPermissions: [], revokedPermissions: [] };

  it("a view_own caller reads only their own id", () => {
    expect(statsScope(teacher, "t1")).toBe("t1");
  });
  it("a view_own caller asking for another reviewer or the team is forbidden", () => {
    expect(() => statsScope(teacher, "someone-else")).toThrow(ForbiddenError);
    expect(() => statsScope(teacher, null)).toThrow(ForbiddenError);
  });
  it("a view_all caller may read anyone, and null means the team", () => {
    expect(statsScope(office, "t1")).toBe("t1");
    expect(statsScope(office, null)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The 20:30 notice recipients
// ---------------------------------------------------------------------------

describe("dailyStatsRecipients", () => {
  const NOW = new Date("2026-11-22T20:30:00+06:00");

  it("includes a reviewer with a verdict today; a 0-day goes only to someone with open work", async () => {
    const worker = oid(); // reviewed today, nothing open
    const missed = oid(); // reviewed 3 days ago, open work, nothing today -> still goes (0-day)
    const finished = oid(); // reviewed 3 days ago, nothing open, nothing today -> skipped
    const idle = oid(); // no verdict in 7 days and nothing open -> skipped
    const stale = oid(); // last verdict 10 days ago, nothing open -> skipped
    await verdict({ reviewer: worker, roundId: await round(worker, "chapter_plan"), at: "2026-11-22T10:00:00+06:00" });
    await verdict({ reviewer: worker, roundId: await round(worker, "question"), at: "2026-11-21T10:00:00+06:00" });
    await verdict({ reviewer: missed, roundId: await round(missed, "question"), at: "2026-11-19T10:00:00+06:00" });
    await round(missed, "question", "assigned");
    await verdict({ reviewer: finished, roundId: await round(finished, "question"), at: "2026-11-19T10:00:00+06:00" });
    await verdict({ reviewer: stale, roundId: await round(stale, "question"), at: "2026-11-12T10:00:00+06:00" });
    mockHolders.mockResolvedValue([worker, missed, finished, idle, stale].map(String));

    const out = await dailyStatsRecipients(NOW);
    const byId = new Map(out.map((r) => [r.userId, r]));
    expect([...byId.keys()].sort()).toEqual([worker, missed].map(String).sort());
    expect(byId.get(worker.toString())?.today.chapterPlans).toBe(1);
    expect(byId.get(worker.toString())?.yesterday.questions).toBe(1);
    expect(byId.get(missed.toString())?.today.total).toBe(0);
    expect(mockHolders).toHaveBeenCalledWith("review_stats:view_own");
  });

  it("a person who is not a holder never gets one, even with work", async () => {
    const nonHolder = oid();
    await verdict({ reviewer: nonHolder, roundId: await round(nonHolder, "question"), at: "2026-11-22T10:00:00+06:00" });
    mockHolders.mockResolvedValue([]);
    expect(await dailyStatsRecipients(NOW)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The REAL writers, and "View as"
// ---------------------------------------------------------------------------

describe("driven by the real submit services", () => {
  it("counts once per round: a resubmit, a bulk submit and a plan submit", async () => {
    const r1 = oid();
    const qA = await round(r1, "question", "assigned");
    const qB = await round(r1, "question", "assigned");
    const plan = await round(r1, "chapter_plan", "assigned");
    const me = r1.toString();

    await submitQuestionReview({ assignmentId: qA.toString(), reviewerId: me, verdict: "APPROVE" });
    // Second decision on the same round = a resubmit, must not count again.
    await submitQuestionReview({ assignmentId: qA.toString(), reviewerId: me, verdict: "CHANGES_REQUESTED", reason: "changed my mind" });
    await submitQuestionReviewBulk({ assignmentIds: [qB.toString()], reviewerId: me, verdict: "APPROVE" });
    await submitPlanReview({ assignmentId: plan.toString(), reviewerId: me, verdict: "APPROVE" });
    await submitPlanReview({ assignmentId: plan.toString(), reviewerId: me, verdict: "APPROVE" }); // resubmit

    const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
    const s = await reviewStatsSummary(me);
    expect(s.todayKey).toBe(todayKey);
    expect(s.today).toEqual({ chapterPlans: 1, sessionPlans: 0, questions: 2, total: 3 });
    expect(s.allTime.total).toBe(3);
  });

  it("a View-as session credits the reviewer, not the Principal who clicked", async () => {
    const reviewer = oid();
    const principal = oid();
    const q1 = await round(reviewer, "question", "assigned");
    const q2 = await round(reviewer, "question", "assigned");
    await runWithAuditActor({ impersonatorId: principal.toString(), impersonatorRole: "PRINCIPAL", onBehalfOf: reviewer.toString() }, async () => {
      await submitQuestionReview({ assignmentId: q1.toString(), reviewerId: reviewer.toString(), verdict: "APPROVE" });
      await submitQuestionReviewBulk({ assignmentIds: [q2.toString()], reviewerId: reviewer.toString(), verdict: "APPROVE" });
    });
    // The audit rows really are attributed to the Principal (the rewrite this guards against).
    const rows = await Audit.find({ eventKind: "REVIEW_SUBMITTED" }).lean();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => String(r.actorId) === principal.toString() && String(r.onBehalfOf) === reviewer.toString())).toBe(true);

    expect((await reviewStatsSummary(reviewer.toString())).today.questions).toBe(2);
    expect((await reviewStatsSummary(principal.toString())).allTime.total).toBe(0);

    mockHolders.mockResolvedValue([reviewer.toString(), principal.toString()]);
    const out = await dailyStatsRecipients(new Date());
    expect(out.map((r) => r.userId)).toEqual([reviewer.toString()]);
    expect(out[0].today.questions).toBe(2);
  });
});
