/**
 * H-2 — the daily reviewer backlog reminder (ReviewBacklogService).
 *
 *   message   title "আজ পর্যালোচনা বাকি: N" + the top 3 kinds + the nearest due date; a passed date reads
 *             "সময় পেরিয়েছে"; nothing left (or only the school-wide winter queue) → no message
 *   reviewer  one send per person with work left, recipient in the dedupe key, hub opened on tap
 *   dedupe    a second run the same day creates nothing new (the emit seam's key does the work)
 *   scope     the Principal / guardians are never read as reviewers
 *   overdue   the supervisor line goes only to holders of review_program:supervise, only when someone
 *             has an item past its due date
 *
 * DB-free: the hub, the user list, the emit seam and the holders lookup are mocked.
 */
const mockHub = jest.fn();
const mockEmit = jest.fn();
const mockUserFind = jest.fn();
const mockHolders = jest.fn();

jest.mock("../modules/review-program/services/ReviewHubService", () => ({
  reviewHubForUser: (a: unknown) => mockHub(a),
}));
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (i: unknown) => mockEmit(i),
}));
jest.mock("../modules/access-control/services/holders", () => ({
  holderIdsOf: (p: string) => mockHolders(p),
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    find: (q: unknown) => ({
      select: () => ({ sort: () => ({ lean: () => mockUserFind(q) }) }),
    }),
  },
}));

import {
  backlogMessage,
  dispatchReviewBacklog,
  dueDayBn,
  overdueCount,
  overdueLine,
  reviewBacklogKeys,
} from "../modules/review-program/services/ReviewBacklogService";
import type { ReviewHubRow } from "../modules/review-program/services/ReviewHubService";

const TODAY = "2026-11-18";

function row(kind: ReviewHubRow["kind"], left: number, dueKey: string | null = null, key = `${kind}:${left}:${dueKey}`): ReviewHubRow {
  return { key, kind, titleBn: key, left, total: left, dueKey, tab: "ReviewTab", screen: "ReviewHome", paramsJson: null };
}

describe("backlogMessage", () => {
  it("builds the title, the top 3 kinds by count and the nearest due date", () => {
    const m = backlogMessage(
      [row("PLAN", 7, "2026-11-25"), row("PLAN", 5, "2026-11-20"), row("QUESTION", 450), row("EXAM_PAPER", 2), row("TASK", 1)],
      TODAY,
    );
    expect(m?.titleBn).toBe("আজ পর্যালোচনা বাকি: ৪৬৫");
    expect(m?.bodyBn).toBe("প্রশ্ন ৪৫০ · প্ল্যান ১২ · প্রশ্নপত্র ২ — সবচেয়ে কাছের শেষ তারিখ ২০ নভেম্বর");
  });

  it("says সময় পেরিয়েছে when the nearest date has passed", () => {
    const m = backlogMessage([row("PLAN", 3, "2026-11-10")], TODAY);
    expect(m?.bodyBn).toBe("প্ল্যান ৩ — সময় পেরিয়েছে");
  });

  it("has no date tail when no row carries a due date", () => {
    expect(backlogMessage([row("VIDEO", 2)], TODAY)?.bodyBn).toBe("ভিডিও ২");
  });

  it("returns null at zero, and ignores the school-wide winter queue", () => {
    expect(backlogMessage([], TODAY)).toBeNull();
    expect(backlogMessage([row("WINTER", 9)], TODAY)).toBeNull();
  });
});

describe("overdue helpers", () => {
  it("counts only items due before today", () => {
    expect(overdueCount([row("PLAN", 3, "2026-11-17"), row("PLAN", 2, TODAY), row("QUESTION", 9, null), row("WINTER", 4, "2026-01-01")], TODAY)).toBe(3);
  });
  it("formats the supervisor line, worst first", () => {
    expect(overdueLine([{ name: "জেরিন", overdue: 1 }, { name: "কাওসার", overdue: 3 }])).toBe("পর্যালোচনায় সময় পেরিয়েছে: কাওসার (৩), জেরিন (১)");
  });
  it("formats a day in Bangla", () => {
    expect(dueDayBn("2026-11-05")).toBe("৫ নভেম্বর");
  });
});

describe("dispatchReviewBacklog", () => {
  const user = (id: string, name: string, role = "TEACHER") => ({ _id: { toString: () => id }, name, role });
  const seen = new Set<string>();

  beforeEach(() => {
    jest.clearAllMocks();
    seen.clear();
    // The real emit() is a no-op for a key it has stored before — mirror that.
    mockEmit.mockImplementation(async (i: { dedupeKey: string }) => {
      const created = !seen.has(i.dedupeKey);
      seen.add(i.dedupeKey);
      return { created, dedupeKey: i.dedupeKey };
    });
    mockHolders.mockResolvedValue([]);
  });

  it("sends one notification per person with work left, none at zero, and opens the hub", async () => {
    mockUserFind.mockResolvedValue([user("u1", "কাওসার"), user("u2", "জেরিন")]);
    mockHub.mockImplementation(async (a: { userId: string }) =>
      a.userId === "u1" ? { rows: [row("PLAN", 3, "2026-11-25")], totalLeft: 3 } : { rows: [], totalLeft: 0 },
    );
    const res = await dispatchReviewBacklog(TODAY);
    expect(res).toEqual({ reviewersNotified: 1, supervisorsNotified: 0 });
    expect(mockEmit).toHaveBeenCalledTimes(1);
    const sent = mockEmit.mock.calls[0][0];
    expect(sent).toMatchObject({
      recipientUserId: "u1",
      kind: "REVIEW_ASSIGNED",
      titleBn: "আজ পর্যালোচনা বাকি: ৩",
      dedupeKey: `review-backlog:u1:${TODAY}`,
      refs: { screenTarget: "ReviewTab/ReviewHub" },
    });
  });

  it("is one send per person per day: a second run creates nothing", async () => {
    mockUserFind.mockResolvedValue([user("u1", "কাওসার")]);
    mockHub.mockResolvedValue({ rows: [row("QUESTION", 5)], totalLeft: 5 });
    expect((await dispatchReviewBacklog(TODAY)).reviewersNotified).toBe(1);
    expect((await dispatchReviewBacklog(TODAY)).reviewersNotified).toBe(0);
    // ...but the next day is a new key.
    expect((await dispatchReviewBacklog("2026-11-19")).reviewersNotified).toBe(1);
  });

  it("puts the recipient in the key (two people, same day, two rows)", () => {
    expect(reviewBacklogKeys.reviewer("a", TODAY)).not.toBe(reviewBacklogKeys.reviewer("b", TODAY));
    expect(reviewBacklogKeys.supervisor("a", TODAY)).toBe(`review-overdue:a:${TODAY}`);
  });

  it("never reads guardians or the Principal as reviewers", async () => {
    mockUserFind.mockResolvedValue([]);
    await dispatchReviewBacklog(TODAY);
    expect(mockUserFind.mock.calls[0][0]).toMatchObject({ active: true, role: { $nin: ["GUARDIAN", "PRINCIPAL"] } });
    expect(mockHub).not.toHaveBeenCalled();
  });

  it("sends the overdue line only to supervise holders, and only when someone is overdue", async () => {
    mockUserFind.mockResolvedValue([user("u1", "কাওসার"), user("u2", "জেরিন")]);
    mockHolders.mockResolvedValue(["sup1", "sup2"]);
    mockHub.mockImplementation(async (a: { userId: string }) =>
      a.userId === "u1"
        ? { rows: [row("PLAN", 3, "2026-11-10")], totalLeft: 3 }
        : { rows: [row("QUESTION", 1, "2026-11-12"), row("PLAN", 4, "2026-12-01")], totalLeft: 5 },
    );
    const res = await dispatchReviewBacklog(TODAY);
    expect(res).toEqual({ reviewersNotified: 2, supervisorsNotified: 2 });
    expect(mockHolders).toHaveBeenCalledWith("review_program:supervise");
    const sup = mockEmit.mock.calls.map((c) => c[0]).filter((i) => i.dedupeKey.startsWith("review-overdue:"));
    expect(sup.map((i) => i.recipientUserId)).toEqual(["sup1", "sup2"]);
    expect(sup[0].bodyBn).toBe("পর্যালোচনায় সময় পেরিয়েছে: কাওসার (৩), জেরিন (১)");
    expect(sup[0].refs.screenTarget).toBe("ReviewTab/ReviewSupervision");
    expect(sup[0].dedupeKey).toBe(`review-overdue:sup1:${TODAY}`);
  });

  it("sends no supervisor line when nobody is overdue", async () => {
    mockUserFind.mockResolvedValue([user("u1", "কাওসার")]);
    mockHolders.mockResolvedValue(["sup1"]);
    mockHub.mockResolvedValue({ rows: [row("PLAN", 3, "2026-12-01")], totalLeft: 3 });
    const res = await dispatchReviewBacklog(TODAY);
    expect(res).toEqual({ reviewersNotified: 1, supervisorsNotified: 0 });
    expect(mockHolders).not.toHaveBeenCalled();
  });

  it("one person's failing hub does not stop the others", async () => {
    mockUserFind.mockResolvedValue([user("u1", "ক"), user("u2", "খ")]);
    mockHub.mockImplementation(async (a: { userId: string }) => {
      if (a.userId === "u1") throw new Error("boom");
      return { rows: [row("PLAN", 1)], totalLeft: 1 };
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await dispatchReviewBacklog(TODAY)).reviewersNotified).toBe(1);
    warn.mockRestore();
  });
});
