/**
 * Review speed / rubber-stamp flag (D-#1684, .claude/plans/review-speed-flag.md).
 *
 *   pure   sittings, median, fastPct, RED / AMBER / NONE / GREEN, plan thresholds, Bangla reasons
 *   db     driven by the real submit services: a fast run flags RED; the supervisor alert text + recipients
 *   gate   management-only (no reviewer permission reaches the query)
 *
 * In-memory MongoDB, real services (holders are stubbed: they read the whole User collection).
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { roleHasPermission } from "@scd/shared";

const mockHolders = jest.fn((_perm: string) => Promise.resolve([] as string[]));
jest.mock("../modules/access-control/services/holders", () => ({
  holderIdsOf: (p: string) => mockHolders(p),
}));

import { Audit } from "../modules/platform/models/Audit";
import { User } from "../modules/foundation/models/User";
import { ReviewAssignment } from "../modules/content/models/ReviewAssignment";
import {
  QUALITY_THRESHOLDS,
  qualityAlertBodyBn,
  qualityAlertForToday,
  qualityFromEvents,
  reviewQuality,
  reviewQualityDedupeKey,
  type QualityEvent,
  type ReviewQualityRow,
} from "../modules/review-program/services/ReviewQualityService";
import { submitQuestionReview } from "../modules/questions/services/QuestionReviewService";
import { dhakaDayKey } from "../lib/dhakaDay";
import { graphql, type ExecutionResult } from "graphql";
import { builder } from "../schema";
import "../modules/review-program/resolvers/reviewQuality";

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
const T0 = Date.UTC(2026, 10, 24, 4, 0, 0);

/** n question verdicts, `gapSec` apart, starting at `start`. */
function qs(n: number, gapSec: number, o: Partial<QualityEvent> = {}, start = T0): QualityEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    reviewerId: "r1",
    kind: "question" as const,
    at: start + i * gapSec * 1000,
    verdict: "APPROVE",
    reasonGiven: false,
    ...o,
  }));
}
const plans = (n: number, gapSec: number, o: Partial<QualityEvent> = {}): QualityEvent[] =>
  qs(n, gapSec, { kind: "plan", ...o });

describe("qualityFromEvents (pure)", () => {
  it("RED when 60 questions are 1.5 s apart, with a Bangla reason", () => {
    const [r] = qualityFromEvents(qs(60, 1.5));
    expect(r.flag).toBe("RED");
    expect(r.questions.n).toBe(60);
    expect(r.questions.medianGapSec).toBe(1.5);
    expect(r.questions.fastPct).toBe(100);
    expect(r.reasonsBn).toContain("প্রশ্ন: ৬০টি, গড়ে ১.৫ সেকেন্ডে একটি");
    expect(r.reasonsBn.some((x) => x.includes("৬০টি অনুমোদন, কোনো মন্তব্য নেই"))).toBe(true);
    expect(r.reasonsBn.join("")).not.toMatch(/[0-9]/);
  });

  it("splits sittings at 30 minutes: the long break is not a gap", () => {
    const a = qs(30, 20);
    const b = qs(30, 20, {}, T0 + 3 * 60 * 60 * 1000); // 3 h later
    const [r] = qualityFromEvents([...a, ...b]);
    expect(r.questions.n).toBe(60);
    expect(r.questions.medianGapSec).toBe(20);
    expect(r.questions.fastPct).toBe(0);
    expect(r.flag).toBe("AMBER"); // silent approvals only
  });

  it("a gap just under 30 min still counts as a gap", () => {
    const ev = [...qs(25, 20), ...qs(25, 20, {}, T0 + 24 * 20 * 1000 + 29 * 60 * 1000)];
    const [r] = qualityFromEvents(ev);
    expect(r.questions.n).toBe(50);
    expect(r.questions.medianGapSec).toBe(20);
  });

  it("AMBER on 40% fast gaps (median above the red line)", () => {
    const ev: QualityEvent[] = [];
    let at = T0;
    for (let i = 0; i < 60; i++) {
      ev.push({ reviewerId: "r1", kind: "question", at, verdict: i % 2 ? "CHANGES_REQUESTED" : "APPROVE", reasonGiven: true });
      at += (i < 24 ? 2 : 20) * 1000;
    }
    const [r] = qualityFromEvents(ev);
    expect(r.flag).toBe("AMBER");
    expect(r.questions.fastPct).toBe(41);
    expect(r.questions.changesPct).toBe(50);
  });

  it("AMBER on 120 silent approvals with 0 changes, even at a slow pace", () => {
    const [r] = qualityFromEvents(qs(120, 30));
    expect(r.flag).toBe("AMBER");
    expect(r.questions.silentApprovePct).toBe(100);
    expect(r.reasonsBn).toEqual(["১২০টি অনুমোদন, কোনো মন্তব্য নেই"]);
  });

  it("GREEN when approvals carry reasons and the pace is slow", () => {
    const [r] = qualityFromEvents(qs(60, 30, { reasonGiven: true }));
    expect(r.flag).toBe("GREEN");
    expect(r.reasonsBn).toEqual([]);
  });

  it("NONE under both minimums, even when very fast", () => {
    const [r] = qualityFromEvents([...qs(49, 1), ...plans(9, 1)]);
    expect(r.flag).toBe("NONE");
  });

  it("plans use their own thresholds: 10 plans 100 s apart is RED, 130 s apart is not", () => {
    const [fast] = qualityFromEvents(plans(10, 100));
    expect(fast.flag).toBe("RED");
    expect(fast.reasonsBn[0]).toBe("পরিকল্পনা: ১০টি, গড়ে ১০০ সেকেন্ডে একটি");
    const [ok] = qualityFromEvents(plans(10, 130));
    expect(ok.flag).toBe("GREEN");
  });

  it("splits per reviewer", () => {
    const out = qualityFromEvents([...qs(60, 1.5, { reviewerId: "a" }), ...qs(60, 30, { reviewerId: "b", reasonGiven: true })]);
    expect(out.find((r) => r.reviewerId === "a")!.flag).toBe("RED");
    expect(out.find((r) => r.reviewerId === "b")!.flag).toBe("GREEN");
    expect(QUALITY_THRESHOLDS.QUESTION_FAST_SEC).toBe(8);
  });
});

describe("qualityAlertBodyBn", () => {
  const kind = { n: 0, medianGapSec: null, fastPct: 0, approvePct: 0, changesPct: 0, silentApprovePct: 0 };
  const row = (name: string, flag: ReviewQualityRow["flag"]): ReviewQualityRow => ({
    reviewerId: name,
    name,
    flag,
    reasonsBn: ["কারণ"],
    questions: kind,
    plans: kind,
  });

  it("null when nobody is AMBER or RED", () => {
    expect(qualityAlertBodyBn([row("a", "GREEN"), row("b", "NONE")])).toBeNull();
  });

  it("names up to 4, RED first, then the remainder count", () => {
    const body = qualityAlertBodyBn([row("a", "AMBER"), row("b", "RED"), row("c", "AMBER"), row("d", "AMBER"), row("e", "AMBER"), row("f", "RED")])!;
    const lines = body.split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("(লাল)");
    expect(lines[1]).toContain("(লাল)");
    expect(lines[2]).toContain("(হলুদ)");
    expect(lines[4]).toBe("+ আরও ২ জন");
  });
});

describe("management-only gate", () => {
  it("no reviewer permission reaches the query; the Principal does", () => {
    expect(roleHasPermission("TEACHER", "review_stats:view_all")).toBe(false);
    expect(roleHasPermission("TEACHER", "review_program:supervise")).toBe(false);
    expect(roleHasPermission("PRINCIPAL", "review_program:supervise")).toBe(true);
  });

  // Through the real resolver: a dropped/loosened authScopes must fail this test.
  const Q = "query { reviewQuality(days: 7) { reviewerId flag } }";
  const run = (role: "PRINCIPAL" | "TEACHER", granted: string[] = []) =>
    graphql({
      schema: builder.toSchema(),
      source: Q,
      contextValue: { auth: { role, userId: oid().toString(), grantedPermissions: granted, revokedPermissions: [] } },
    }) as Promise<ExecutionResult>;

  it("resolver: a TEACHER (reviewer) is refused", async () => {
    const r = await run("TEACHER");
    expect(r.errors?.length).toBeGreaterThan(0);
    expect(r.data?.reviewQuality ?? null).toBeNull();
  });

  it("resolver: a TEACHER with the per-person supervise grant is allowed; the PRINCIPAL is allowed", async () => {
    expect((await run("TEACHER", ["review_program:supervise"])).errors).toBeUndefined();
    const p = await run("PRINCIPAL");
    expect(p.errors).toBeUndefined();
    expect(Array.isArray(p.data?.reviewQuality)).toBe(true);
  });
});

describe("driven by the real submit service", () => {
  async function round(reviewerId: Types.ObjectId): Promise<string> {
    const doc = await ReviewAssignment.create({
      docType: "question",
      subject: "MATH",
      classLevel: 3,
      anchorWord: "w",
      addressNumber: "1",
      artifactId: oid(),
      reviewerId,
      assignedBy: oid(),
      roundNumber: 1,
      status: "assigned",
    });
    return doc._id.toString();
  }

  it("a fast run of silent approvals flags RED and alerts every supervise holder", async () => {
    const reviewer = await User.create({ name: "Reviewer One", passwordHash: "x", phone: "01700000001", role: "TEACHER", active: true });
    const rid = reviewer._id as Types.ObjectId;
    for (let i = 0; i < QUALITY_THRESHOLDS.MIN_QUESTIONS + 2; i++) {
      await submitQuestionReview({ assignmentId: await round(rid), reviewerId: rid.toString(), verdict: "APPROVE" });
    }
    const todayKey = dhakaDayKey(new Date());
    const rows = await reviewQuality({ fromKey: todayKey, toKey: todayKey });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Reviewer One");
    expect(rows[0].flag).toBe("RED");
    expect(rows[0].questions.n).toBe(52);

    expect(await reviewQuality({ fromKey: todayKey, toKey: todayKey, reviewerId: rid.toString() })).toHaveLength(1);
    expect(await reviewQuality({ fromKey: todayKey, toKey: todayKey, reviewerId: oid().toString() })).toHaveLength(0);

    mockHolders.mockResolvedValue(["sup1", "sup2"]);
    const alert = await qualityAlertForToday(new Date());
    expect(mockHolders).toHaveBeenCalledWith("review_program:supervise");
    expect(alert!.recipientIds).toEqual(["sup1", "sup2"]);
    expect(alert!.titleBn).toBe("পর্যালোচনার গতি — সতর্কতা");
    expect(alert!.bodyBn).toContain("Reviewer One (লাল)");
    expect(reviewQualityDedupeKey("sup1", todayKey)).toBe(`review-quality:sup1:${todayKey}`);
  });

  it("nobody flagged -> no alert", async () => {
    mockHolders.mockResolvedValue(["sup1"]);
    expect(await qualityAlertForToday(new Date())).toBeNull();
  });
});
