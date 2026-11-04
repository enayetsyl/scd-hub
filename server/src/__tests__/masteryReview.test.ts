/**
 * Objective tree OT-2 — review and lock in the app (docs/prd-objective-tree.md §7, §10 items 3–6).
 *
 * Fixture: the real C1_MATH.tree.json imported through the OT-1 import (DRAFT / PROPOSED rows, one
 * OPEN round), with two unmapped exercises added to the round's coverage for the gate tests.
 *
 * Assign      — Principal assigns; the reviewer is notified (dedupe key carries the recipient);
 *               someone without mastery:review cannot be assigned; a non-Principal cannot assign.
 * Decisions   — ACCEPT, BULK_ACCEPT (one event per row), EDIT, SPLIT (children .N, parent untagged;
 *               one child refused [SINGLE_CHILD]), MERGE (exercises move; merge back re-tags the
 *               parent; prereqs follow the survivor), MOVE (domain in place / re-code under a new
 *               parent), REJECT (reason required; the last-but-one child refused), ADD (book ref or
 *               reason).
 * Comments    — COMMENT / REPLY / RESOLVE / REOPEN; Principal + reviewers told, never the writer.
 * Unmapped    — map to a row (the row cites it) / not assessed this year / reopen.
 * Gate        — lock refused with an open comment or an unresolved exercise; clean ⇒ locks rows +
 *               domains + round; afterwards writes refused, retire works.
 * Permission  — §10.5: teacher cannot open the queue; an unassigned grant-holder cannot write; the
 *               Principal's writes are logged under the Principal.
 * Review log  — §10.6: every write = exactly one event (BULK_ACCEPT one per row); the export lists
 *               them in order with before/after.
 *
 * In-memory MongoDB, real services.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { graphql, type ExecutionResult } from "graphql";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { MasteryDomain } from "../modules/mastery/models/MasteryDomain";
import { MasteryCatalogueReview } from "../modules/mastery/models/MasteryCatalogueReview";
import { MasteryReviewEvent } from "../modules/mastery/models/MasteryReviewEvent";
import { User } from "../modules/foundation/models/User";
import { Notification } from "../modules/notifications/models/Notification";
import { importCatalogue, retireOutcome } from "../modules/mastery/services/MasteryCatalogueService";
import {
  assignReviewers,
  exportReview,
  getReviewQueue,
  listReviewRounds,
  lockReview,
  reopenReview,
  resolveUnmapped,
  reviewComment,
  reviewDecide,
  submitReview,
  type ReviewCaller,
  type ReviewDecisionInput,
} from "../modules/mastery/services/MasteryReviewWriteService";
import { builder } from "../schema";
import "../modules/mastery/resolvers/masteryCatalogue";
import "../modules/mastery/resolvers/masteryReview";

jest.setTimeout(180_000);

const DOCS = path.resolve(__dirname, "../../../docs/mastery/objective-tree");
const TREE_TEXT = fs.readFileSync(path.join(DOCS, "C1_MATH.tree.json"), "utf8");
const DOMAINS_TEXT = fs.readFileSync(path.join(DOCS, "domains/MATH.json"), "utf8");

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

afterEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
});

interface Who {
  id: string;
  caller: ReviewCaller;
  auth: { role: string; userId: string; grantedPermissions: string[] };
}

let n = 0;
async function makeUser(role: string, name: string, grantedPermissions: string[] = []): Promise<Who> {
  n += 1;
  const u = await User.create({ email: `u${n}@ot2.test`, passwordHash: "x", role, name, active: true, grantedPermissions });
  const id = String(u._id);
  return {
    id,
    caller: { userId: id, role, canSettings: role === "PRINCIPAL" },
    auth: { role, userId: id, grantedPermissions },
  };
}

let principal: Who;
let mahzabin: Who;
let other: Who;
let teacher: Who;
let reviewId: string;

const UNMAPPED = [
  { ref: "7/হাতে রাখি/9", text: "বাড়তি অনুশীলনী", reason: "test: not in any row" },
  { ref: "12/খেলা/—", text: "খেলা", reason: "test: activity" },
];

async function setup(opts: { assign?: boolean } = {}): Promise<void> {
  principal = await makeUser("PRINCIPAL", "অধ্যক্ষ");
  mahzabin = await makeUser("OFFICE", "মাহজাবিন", ["mastery:review"]);
  other = await makeUser("OFFICE", "অন্য পর্যালোচক", ["mastery:review"]);
  teacher = await makeUser("TEACHER", "শিক্ষক");
  const rep = await importCatalogue(TREE_TEXT, true, principal.caller, DOMAINS_TEXT);
  if (!rep.applied) throw new Error(rep.errors.join("; "));
  const round = await MasteryCatalogueReview.findOne({ classToken: "C1", subject: "MATH" }).lean();
  reviewId = String(round!._id);
  await MasteryCatalogueReview.updateOne(
    { _id: round!._id },
    { $push: { "coverage.unmapped": { $each: UNMAPPED } }, $inc: { "coverage.exercisesTotal": UNMAPPED.length } },
  );
  if (opts.assign !== false) await assignReviewers(reviewId, [mahzabin.id], principal.caller);
}

const row = (code: string) => MasteryOutcome.findOne({ code }).lean();
const events = () => MasteryReviewEvent.countDocuments({ reviewId: new Types.ObjectId(reviewId) });
const decide = (input: ReviewDecisionInput, who: Who = mahzabin) => reviewDecide(reviewId, input, who.caller);
/** Exactly `k` events added by `fn` (§10 item 6). */
async function oneEvent<T>(fn: () => Promise<T>, k = 1): Promise<T> {
  const before = await events();
  const out = await fn();
  expect((await events()) - before).toBe(k);
  return out;
}

// ---------------------------------------------------------------------------

describe("assign (বরাদ্দ)", () => {
  it("the Principal assigns; the reviewer is told once, the key carries the recipient", async () => {
    await setup({ assign: false });
    await assignReviewers(reviewId, [mahzabin.id, other.id], principal.caller);
    const r = await MasteryCatalogueReview.findById(reviewId).lean();
    expect(r!.reviewerIds.map(String).sort()).toEqual([mahzabin.id, other.id].sort());
    expect(String(r!.assignedBy)).toBe(principal.id);
    const notes = await Notification.find({ kind: "REVIEW_ASSIGNED" }).lean();
    expect(notes).toHaveLength(2);
    for (const nn of notes) {
      expect(nn.dedupeKey).toContain(String(nn.recipientUserId));
      expect(nn.refs?.masteryReviewId).toBe(reviewId);
    }
    // Re-saving the same list tells nobody new.
    await assignReviewers(reviewId, [mahzabin.id, other.id], principal.caller);
    expect(await Notification.countDocuments({ kind: "REVIEW_ASSIGNED" })).toBe(2);
  });

  it("someone without mastery:review cannot be assigned; a non-Principal cannot assign", async () => {
    await setup({ assign: false });
    await expect(assignReviewers(reviewId, [teacher.id], principal.caller)).rejects.toThrow(/অনুমতি নেই/);
    await expect(assignReviewers(reviewId, [mahzabin.id], mahzabin.caller)).rejects.toThrow(/অধ্যক্ষ/);
  });
});

describe("decisions — one event per write (§10 item 6)", () => {
  it("ACCEPT: PROPOSED → ACCEPTED, one event; a second accept is refused", async () => {
    await setup();
    await oneEvent(() => decide({ action: "ACCEPT", code: "LO-C1-MATH-02-01" }));
    expect((await row("LO-C1-MATH-02-01"))!.reviewState).toBe("ACCEPTED");
    await expect(decide({ action: "ACCEPT", code: "LO-C1-MATH-02-01" })).rejects.toThrow(/আগেই গৃহীত/);
  });

  it("BULK_ACCEPT on an objective writes one BULK_ACCEPT event per PROPOSED row", async () => {
    await setup();
    await decide({ action: "ACCEPT", code: "LO-C1-MATH-07-01.2" });
    // 07-01 + its five children, one already accepted ⇒ five rows, five events.
    await oneEvent(() => decide({ action: "BULK_ACCEPT", code: "LO-C1-MATH-07-01" }), 5);
    const bulk = await MasteryReviewEvent.find({ reviewId: new Types.ObjectId(reviewId), action: "BULK_ACCEPT" }).lean();
    expect(bulk.map((e) => e.code).sort()).toEqual(
      ["LO-C1-MATH-07-01", "LO-C1-MATH-07-01.1", "LO-C1-MATH-07-01.3", "LO-C1-MATH-07-01.4", "LO-C1-MATH-07-01.5"].sort(),
    );
    const states = (await MasteryOutcome.find({ code: /^LO-C1-MATH-07-01/ }).lean()).map((o) => o.reviewState);
    expect(new Set(states)).toEqual(new Set(["ACCEPTED"]));
  });

  it("EDIT: label + question types → EDITED; unknown QT, a home tip on a SUB, an empty label are refused", async () => {
    await setup();
    await oneEvent(() => decide({ action: "EDIT", code: "LO-C1-MATH-02-01", labelBn: "গুনে লেখা (১–১০)", questionTypeCodes: ["QT-MCQ", "QT-FILL"] }));
    const r = await row("LO-C1-MATH-02-01");
    expect(r!.labelBn).toBe("গুনে লেখা (১–১০)");
    expect(r!.questionTypeCodes).toEqual(["QT-MCQ", "QT-FILL"]);
    expect(r!.reviewState).toBe("EDITED");
    const ev = await MasteryReviewEvent.findOne({ action: "EDIT" }).lean();
    expect((ev!.before as any).labelBn).not.toBe((ev!.after as any).labelBn);
    await expect(decide({ action: "EDIT", code: "LO-C1-MATH-02-01", questionTypeCodes: ["QT-NOPE"] })).rejects.toThrow(/QT-NOPE/);
    await expect(decide({ action: "EDIT", code: "LO-C1-MATH-07-03.1", homeTipBn: "x" })).rejects.toThrow(/D-#925/);
    await expect(decide({ action: "EDIT", code: "LO-C1-MATH-02-01", labelBn: "  " })).rejects.toThrow(/খালি/);
  });

  it("EDIT a prerequisite that does not resolve is refused with the rule named", async () => {
    await setup();
    await expect(decide({ action: "EDIT", code: "LO-C1-MATH-02-01", prereqCodes: ["LO-C1-MATH-99-01"] })).rejects.toThrow(/\[PREREQ_RESOLVES\]/);
  });
});

describe("split / merge (§10 item 3)", () => {
  it("split into two: parent untagged, .1/.2 tagged ADDED; one child refused; merge back re-tags the parent", async () => {
    await setup();
    const P = "LO-C1-MATH-12-04";
    const ex = (await row(P))!.bookRef as any;
    const [a, ...rest] = ex.exercises as string[];
    await expect(decide({ action: "SPLIT", code: P, children: [{ labelBn: "এক", exercises: [a] }] })).rejects.toThrow(/\[SINGLE_CHILD\]/);
    await oneEvent(() =>
      decide({ action: "SPLIT", code: P, children: [{ labelBn: "প্রথম ধাপ", exercises: [a] }, { labelBn: "দ্বিতীয় ধাপ", exercises: rest }] }),
    );
    const parent = await row(P);
    expect(parent!.tagged).toBe(false);
    const c1 = await row(`${P}.1`);
    const c2 = await row(`${P}.2`);
    expect([c1!.tagged, c2!.tagged, c1!.level, c1!.parentCode, c1!.reviewState]).toEqual([true, true, "SUB", P, "ADDED"]);
    expect((c2!.bookRef as any).exercises).toEqual(rest);
    // A child cannot be rejected alone (the parent would keep exactly one child).
    await expect(decide({ action: "REJECT", code: `${P}.1`, reason: "x" })).rejects.toThrow(/\[SINGLE_CHILD\]/);
    // Merging the two siblings is the same refusal; merging back into the parent folds both.
    await expect(decide({ action: "MERGE", code: `${P}.2`, intoCode: `${P}.1` })).rejects.toThrow(/\[SINGLE_CHILD\]/);
    await oneEvent(() => decide({ action: "MERGE", code: `${P}.2`, intoCode: P }));
    const back = await row(P);
    expect(back!.tagged).toBe(true);
    expect(new Set((back!.bookRef as any).exercises)).toEqual(new Set(ex.exercises));
    expect((await row(`${P}.1`))!.mergedInto).toBe(P);
    expect((await row(`${P}.2`))!.mergedInto).toBe(P);
    // A second split numbers past the merged-away codes (codes are never reused).
    await decide({ action: "SPLIT", code: P, children: [{ labelBn: "ক", exercises: [a] }, { labelBn: "খ", exercises: rest }] });
    expect(await row(`${P}.3`)).not.toBeNull();
    expect(await row(`${P}.4`)).not.toBeNull();
  });

  it("merge two leaves: exercises move to the survivor; prerequisites follow it", async () => {
    await setup();
    const before = (await row("LO-C1-MATH-02-01"))!.bookRef as any;
    const gone = (await row("LO-C1-MATH-01-01"))!.bookRef as any;
    await oneEvent(() => decide({ action: "MERGE", code: "LO-C1-MATH-01-01", intoCode: "LO-C1-MATH-02-01" }));
    const s = await row("LO-C1-MATH-02-01");
    expect((s!.bookRef as any).exercises).toEqual([...before.exercises, ...gone.exercises.filter((x: string) => !before.exercises.includes(x))]);
    expect(s!.reviewState).toBe("EDITED");
    const m = await row("LO-C1-MATH-01-01");
    expect([m!.mergedInto, m!.reviewState]).toEqual(["LO-C1-MATH-02-01", "REJECTED"]);
    // 01-02 named 01-01 as its earlier step — it now names the survivor.
    expect((await row("LO-C1-MATH-01-02"))!.prereqCodes).toContain("LO-C1-MATH-02-01");
    expect((await row("LO-C1-MATH-01-02"))!.prereqCodes).not.toContain("LO-C1-MATH-01-01");
    // An untagged parent is not a merge target.
    await expect(decide({ action: "MERGE", code: "LO-C1-MATH-02-02", intoCode: "LO-C1-MATH-07-01" })).rejects.toThrow(/দলবদ্ধ/);
  });
});

describe("move / reject / add", () => {
  it("MOVE to another domain carries the children; MOVE under a split objective re-codes the row .N", async () => {
    await setup();
    await oneEvent(() => decide({ action: "MOVE", code: "LO-C1-MATH-07-03", toDomainCode: "DOM-MATH-NUM" }));
    expect((await row("LO-C1-MATH-07-03"))!.domainCode).toBe("DOM-MATH-NUM");
    expect((await row("LO-C1-MATH-07-03.1"))!.domainCode).toBe("DOM-MATH-NUM");
    await expect(decide({ action: "MOVE", code: "LO-C1-MATH-07-03.1", toDomainCode: "DOM-MATH-ADD" })).rejects.toThrow(/\[SUB_PARENT\]/);

    await oneEvent(() => decide({ action: "MOVE", code: "LO-C1-MATH-04-02", toParentCode: "LO-C1-MATH-04-01" }));
    const moved = await row("LO-C1-MATH-04-01.3");
    expect([moved!.level, moved!.parentCode, moved!.reviewState, moved!.labelBn]).toEqual([
      "SUB",
      "LO-C1-MATH-04-01",
      "ADDED",
      (await row("LO-C1-MATH-04-02"))!.labelBn,
    ]);
    expect((await row("LO-C1-MATH-04-02"))!.mergedInto).toBe("LO-C1-MATH-04-01.3");
  });

  it("REJECT needs a reason; prerequisites naming the rejected row are dropped; rejecting a parent takes its children", async () => {
    await setup();
    await expect(decide({ action: "REJECT", code: "LO-C1-MATH-01-01", reason: " " })).rejects.toThrow(/কারণ/);
    await oneEvent(() => decide({ action: "REJECT", code: "LO-C1-MATH-01-01", reason: "দ্বিতীয় শ্রেণির বিষয়" }));
    expect((await row("LO-C1-MATH-01-01"))!.rejectReason).toBe("দ্বিতীয় শ্রেণির বিষয়");
    expect((await row("LO-C1-MATH-01-02"))!.prereqCodes).not.toContain("LO-C1-MATH-01-01");
    await oneEvent(() => decide({ action: "REJECT", code: "LO-C1-MATH-07-03", reason: "বাদ" }));
    expect((await row("LO-C1-MATH-07-03.2"))!.reviewState).toBe("REJECTED");
    // Accepting the parent back restores the children its rejection took.
    await oneEvent(() => decide({ action: "ACCEPT", code: "LO-C1-MATH-07-03" }));
    expect((await row("LO-C1-MATH-07-03.1"))!.reviewState).toBe("ACCEPTED");
  });

  it("ADD needs a book ref or a reason; a reason-only row cites the chapter's unnumbered marker", async () => {
    await setup();
    await expect(decide({ action: "ADD", level: "SUB", parentCode: "LO-C1-MATH-07-01", labelBn: "নতুন", questionTypeCodes: ["QT-SOLVE"] })).rejects.toThrow(
      /কারণ/,
    );
    await oneEvent(() =>
      decide({ action: "ADD", level: "SUB", parentCode: "LO-C1-MATH-07-01", labelBn: "মুখে মুখে যোগ", questionTypeCodes: ["QT-ORAL"], reason: "শ্রেণিকক্ষে চর্চা হয়" }),
    );
    const a = await row("LO-C1-MATH-07-01.6");
    expect([a!.reviewState, a!.addReason, (a!.bookRef as any).exercises]).toEqual(["ADDED", "শ্রেণিকক্ষে চর্চা হয়", ["7/—"]]);
    await oneEvent(() =>
      decide({ action: "ADD", level: "OBJECTIVE", chapterNumber: 7, domainCode: "DOM-MATH-ADD", labelBn: "তিনটি সংখ্যা যোগ", questionTypeCodes: ["QT-SOLVE"], exercises: ["7/যোগ/9"] }),
    );
    expect((await row("LO-C1-MATH-07-05"))!.tagged).toBe(true);
  });
});

describe("comments", () => {
  it("COMMENT tells the Principal and the other reviewers (never the writer); REPLY / RESOLVE / REOPEN", async () => {
    await setup();
    await assignReviewers(reviewId, [mahzabin.id, other.id], principal.caller);
    await Notification.deleteMany({});
    await oneEvent(() => reviewComment(reviewId, { action: "COMMENT", code: "LO-C1-MATH-07-02", text: "২ অঙ্ক + ১ অঙ্ক আলাদা?" }, mahzabin.caller));
    const to = (await Notification.find({}).lean()).map((x) => String(x.recipientUserId)).sort();
    expect(to).toEqual([principal.id, other.id].sort());
    for (const x of await Notification.find({}).lean()) expect(x.dedupeKey).toContain(String(x.recipientUserId));
    const c = await MasteryReviewEvent.findOne({ action: "COMMENT" }).lean();
    const pid = String(c!._id);
    await oneEvent(() => reviewComment(reviewId, { action: "REPLY", parentEventId: pid, text: "হ্যাঁ, আলাদা থাক" }, principal.caller));
    let q = await getReviewQueue(reviewId, mahzabin.caller);
    expect(q.openComments).toBe(1);
    expect(q.rows.find((x) => x.code === "LO-C1-MATH-07-02")!.openComments).toBe(1);
    await oneEvent(() => reviewComment(reviewId, { action: "RESOLVE", parentEventId: pid }, mahzabin.caller));
    await expect(reviewComment(reviewId, { action: "RESOLVE", parentEventId: pid }, mahzabin.caller)).rejects.toThrow(/মীমাংসিত/);
    q = await getReviewQueue(reviewId, mahzabin.caller);
    expect(q.openComments).toBe(0);
    expect(q.threads[0].replies.map((r) => r.action)).toEqual(["REPLY", "RESOLVE"]);
    await oneEvent(() => reviewComment(reviewId, { action: "REOPEN", parentEventId: pid }, principal.caller));
    expect((await getReviewQueue(reviewId, mahzabin.caller)).openComments).toBe(1);
  });
});

describe("unmapped exercises", () => {
  it("map to a tagged row (the row cites it), or not assessed with a reason; reopen undoes the mapping", async () => {
    await setup();
    const [u1, u2] = UNMAPPED;
    await expect(resolveUnmapped(reviewId, { ref: u1.ref, mapToCode: "LO-C1-MATH-07-03" }, mahzabin.caller)).rejects.toThrow(/দলবদ্ধ/);
    await oneEvent(() => resolveUnmapped(reviewId, { ref: u1.ref, mapToCode: "LO-C1-MATH-07-03.2" }, mahzabin.caller));
    expect((await row("LO-C1-MATH-07-03.2"))!.bookRef as any).toMatchObject({ exercises: expect.arrayContaining([u1.ref]) });
    await expect(resolveUnmapped(reviewId, { ref: u2.ref }, mahzabin.caller)).rejects.toThrow(/কারণ/);
    await oneEvent(() => resolveUnmapped(reviewId, { ref: u2.ref, notAssessedReason: "খেলা, লিখিত নয়" }, mahzabin.caller));
    let q = await getReviewQueue(reviewId, mahzabin.caller);
    expect(q.unresolvedUnmapped).toBe(0);
    expect(q.unmapped.find((u) => u.ref === u1.ref)!.resolvedCode).toBe("LO-C1-MATH-07-03.2");
    await oneEvent(() => resolveUnmapped(reviewId, { ref: u1.ref, reopen: true }, mahzabin.caller));
    expect(((await row("LO-C1-MATH-07-03.2"))!.bookRef as any).exercises).not.toContain(u1.ref);
    q = await getReviewQueue(reviewId, mahzabin.caller);
    expect(q.unresolvedUnmapped).toBe(1);
  });
});

describe("submit → lock gate (§10 item 4)", () => {
  it("refused while a comment is open or an exercise is unresolved; succeeds once cleared; then writes are refused and retire works", async () => {
    await setup();
    await decide({ action: "REJECT", code: "LO-C1-MATH-02-02", reason: "পুনরাবৃত্তি" });
    await reviewComment(reviewId, { action: "COMMENT", text: "সাধারণ মন্তব্য" }, mahzabin.caller);
    await expect(lockReview(reviewId, principal.caller)).rejects.toThrow(/জমা দেননি/);
    await submitReview(reviewId, mahzabin.caller);
    await expect(decide({ action: "ACCEPT", code: "LO-C1-MATH-02-01" })).rejects.toThrow(/জমা হয়ে গেছে/);
    await expect(lockReview(reviewId, mahzabin.caller)).rejects.toThrow(/অধ্যক্ষ/);
    await expect(lockReview(reviewId, principal.caller)).rejects.toThrow(/মন্তব্য এখনো খোলা[\s\S]*অনুশীলনী এখনো মেলানো বাকি/);
    expect((await getReviewQueue(reviewId, principal.caller)).canLock).toBe(false);

    // Comments may still be answered on a submitted round; the exercises need the round reopened.
    const c = await MasteryReviewEvent.findOne({ action: "COMMENT" }).lean();
    await reviewComment(reviewId, { action: "RESOLVE", parentEventId: String(c!._id) }, principal.caller);
    await expect(lockReview(reviewId, principal.caller)).rejects.toThrow(/অনুশীলনী/);
    await reopenReview(reviewId, "অনুশীলনী বাকি", principal.caller);
    for (const u of UNMAPPED) await resolveUnmapped(reviewId, { ref: u.ref, notAssessedReason: "এ বছর নয়" }, mahzabin.caller);
    await submitReview(reviewId, mahzabin.caller);
    const q = await getReviewQueue(reviewId, principal.caller);
    expect([q.canLock, q.openComments, q.unresolvedUnmapped, q.violations]).toEqual([true, 0, 0, []]);
    expect(q.decisions.rejected).toBe(1);

    const res = await lockReview(reviewId, principal.caller);
    expect(res.locked).toBe(72);
    expect((await MasteryCatalogueReview.findById(reviewId).lean())!.state).toBe("LOCKED");
    expect(await MasteryOutcome.countDocuments({ classToken: "C1", subject: "MATH", status: "LOCKED" })).toBe(72);
    expect((await row("LO-C1-MATH-02-02"))!.status).toBe("DRAFT"); // rejected rows never lock
    expect(await MasteryDomain.countDocuments({ subject: "MATH", status: "DRAFT" })).toBe(0);

    // After lock: no review write; a locked row retires (kept), never deleted.
    await expect(decide({ action: "EDIT", code: "LO-C1-MATH-02-01", labelBn: "নতুন নাম" })).rejects.toThrow(/চূড়ান্ত/);
    await expect(reviewComment(reviewId, { action: "COMMENT", text: "x" }, principal.caller)).rejects.toThrow(/চূড়ান্ত/);
    expect(await retireOutcome("LO-C1-MATH-02-01", principal.caller)).toBe("RETIRED");
    expect((await row("LO-C1-MATH-02-01"))!.status).toBe("RETIRED");
    const locked = await getReviewQueue(reviewId, principal.caller);
    expect([locked.canWrite, locked.canLock, locked.decisions.rejected]).toEqual([false, false, 1]);
  });
});

describe("permission + assignment (§10 item 5)", () => {
  const schema = builder.toSchema();
  const run = (source: string, auth: Who["auth"] | null): Promise<ExecutionResult> =>
    graphql({ schema, source, contextValue: { auth } }) as Promise<ExecutionResult>;
  const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

  it("a teacher cannot open the queue; the grant-holder can; only mastery:settings assigns and locks", async () => {
    await setup();
    const QUEUE = `query { masteryReviewQueue(reviewId: "${reviewId}") { round rows { code } canWrite } }`;
    const ROUNDS = `query { masteryReviewRounds { id assignedToMe seen total } }`;
    const LOCK = `mutation { lockMasteryReview(reviewId: "${reviewId}") { state } }`;
    const ASSIGN = `mutation { assignMasteryReviewers(reviewId: "${reviewId}", reviewerIds: ["${other.id}"]) { state } }`;
    expect(denied(await run(QUEUE, teacher.auth))).toBe(true);
    expect(denied(await run(ROUNDS, teacher.auth))).toBe(true);
    const m = await run(QUEUE, mahzabin.auth);
    expect(m.errors).toBeUndefined();
    expect((m.data as any).masteryReviewQueue.canWrite).toBe(true);
    const o = await run(QUEUE, other.auth);
    expect((o.data as any).masteryReviewQueue.canWrite).toBe(false); // granted, not assigned
    expect(denied(await run(LOCK, mahzabin.auth))).toBe(true);
    expect(denied(await run(ASSIGN, mahzabin.auth))).toBe(true);
    expect(denied(await run(ASSIGN, principal.auth))).toBe(false);
    const list = await listReviewRounds(other.caller);
    expect(list[0].assignedToMe).toBe(true);
  });

  it("a grant-holder not assigned to C3 Math cannot write there; the Principal's writes are logged under the Principal", async () => {
    await setup();
    const c3 = await MasteryCatalogueReview.create({ classToken: "C3", subject: "MATH", round: 1, state: "OPEN", reviewerIds: [new Types.ObjectId(other.id)] });
    await expect(reviewComment(String(c3._id), { action: "COMMENT", text: "x" }, mahzabin.caller)).rejects.toThrow(/বরাদ্দ করা হয়নি/);
    await expect(reviewDecide(String(c3._id), { action: "ACCEPT", code: "LO-C3-MATH-01-01" }, mahzabin.caller)).rejects.toThrow(/বরাদ্দ করা হয়নি/);
    // Through GraphQL too.
    const r = await run(`mutation { submitMasteryReview(reviewId: "${String(c3._id)}") { state } }`, mahzabin.auth);
    expect(r.errors?.[0]?.message).toMatch(/বরাদ্দ করা হয়নি/);
    // The Principal, never assigned, acts on C1 — the event carries the Principal's id.
    await decide({ action: "ACCEPT", code: "LO-C1-MATH-02-01" }, principal);
    const ev = await MasteryReviewEvent.findOne({ action: "ACCEPT" }).lean();
    expect(String(ev!.by)).toBe(principal.id);
  });
});

describe("decisions export (§10 item 6)", () => {
  it("returns every event in order with before/after", async () => {
    await setup();
    await decide({ action: "ACCEPT", code: "LO-C1-MATH-02-01" });
    await decide({ action: "EDIT", code: "LO-C1-MATH-02-02", labelBn: "নতুন লেবেল" });
    await decide({ action: "BULK_ACCEPT", code: "LO-C1-MATH-07-03" });
    await reviewComment(reviewId, { action: "COMMENT", code: "LO-C1-MATH-07-02", text: "?" }, mahzabin.caller);
    const out = JSON.parse(await exportReview("C1", "MATH", 1));
    expect(out.format).toBe("scd-objective-review-export/1");
    expect(out.events.map((e: any) => e.action)).toEqual(["IMPORT", "ACCEPT", "EDIT", "BULK_ACCEPT", "BULK_ACCEPT", "BULK_ACCEPT", "COMMENT"]);
    expect(out.events.map((e: any) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const at = out.events.map((e: any) => Date.parse(e.at));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const edit = out.events[2];
    expect([edit.before.labelBn !== edit.after.labelBn, edit.after.labelBn, edit.by]).toEqual([true, "নতুন লেবেল", "মাহজাবিন"]);
    expect(out.decisions).toMatchObject({ accepted: 4, edited: 1 });
    expect(await events()).toBe(out.events.length);
  });
});
