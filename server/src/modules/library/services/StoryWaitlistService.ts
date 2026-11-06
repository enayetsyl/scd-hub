/**
 * Storybook waitlist (SB-3, D-#982/#990, docs/prd-storybook-reading.md).
 *
 * A guardian joins / leaves the queue for a book of their child's band from the app; the desk
 * adds a child who asks in person (same call, librarian-gated). Underneath it is the library's
 * own FIFO BookReservation queue — return promotes the first child, the hold runs 2 working
 * days (StoryHoldService) and lapses to the next child (expireLapsedHolds).
 *
 * Rules: only while no copy is in (a book on the shelf is simply borrowed), not for a book the
 * child already has, and at most STORY_WAIT_CAP waits per child (D-#990 default).
 */
import { assertGuardianFeature } from "../../guardian-access/services/GuardianFeatureService";
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { BookReservation, type IBookReservation } from "../models/BookReservation";
import { BookTitle, type IBookTitle } from "../models/BookTitle";
import { StorySeries } from "../models/StorySeries";
import { LibraryError } from "../errors";
import { cancelReservation, reserveTitle } from "./LibraryReservationService";
import { assertIsLibrarian } from "./LibrarianService";
import { resolveShelfViewer, storyBookDetail } from "./StorybookService";

export const STORY_WAIT_CAP = 2;

export const STORY_WAIT_ERRORS_BN = {
  inNow: "বইটি এখন অফিসে আছে — অফিস থেকে নিয়ে নিন",
  hasIt: "বইটি এখন এই শিক্ষার্থীর কাছেই আছে",
  cap: `একসাথে সর্বোচ্চ ${STORY_WAIT_CAP}টি বইয়ের অপেক্ষায় থাকা যায় — আগে একটি থেকে নাম তুলে নিন`,
  notWaiting: "এই বইয়ের অপেক্ষার তালিকায় নাম নেই",
  pickStudent: "শিক্ষার্থী বাছাই করুন",
} as const;

/** Guardians pass the link check; staff must be at the desk (library:lend + duty). */
async function viewerFor(ctx: AppContext, studentId: string) {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!studentId) throw new LibraryError(STORY_WAIT_ERRORS_BN.pickStudent);
  await assertGuardianFeature(ctx, "STORYBOOKS");
  if (ctx.auth.role !== "GUARDIAN") {
    if (!callerHasPermission(ctx.auth, "library:lend")) throw new ForbiddenError("অনুমতি নেই");
    await assertIsLibrarian(ctx, "library:lend");
  }
  return resolveShelfViewer(ctx, studentId);
}

/** The child's active (QUEUED / READY) waits on storybooks. */
async function storyWaitsOf(studentId: string): Promise<IBookReservation[]> {
  const rows = (await BookReservation.find({ studentId, status: { $in: ["QUEUED", "READY"] } }).lean()) as unknown as IBookReservation[];
  if (rows.length === 0) return [];
  const storyTitles = await BookTitle.find({ _id: { $in: rows.map((r) => r.titleId) }, seriesId: { $exists: true } }).select("_id").lean();
  const ok = new Set(storyTitles.map((t) => t._id.toString()));
  return rows.filter((r) => ok.has(r.titleId.toString()));
}

export async function joinStoryWaitlist(ctx: AppContext, studentId: string, titleId: string): Promise<IBookReservation> {
  const viewer = await viewerFor(ctx, studentId);
  const { card } = await storyBookDetail(viewer, titleId);
  if (card.childHasNow) throw new LibraryError(STORY_WAIT_ERRORS_BN.hasIt);
  if (card.availableCopies > 0) throw new LibraryError(STORY_WAIT_ERRORS_BN.inNow);
  if ((await storyWaitsOf(studentId)).length >= STORY_WAIT_CAP) throw new LibraryError(STORY_WAIT_ERRORS_BN.cap);
  return reserveTitle(titleId, { type: "STUDENT", id: studentId }, ctx.auth!.userId);
}

export async function leaveStoryWaitlist(ctx: AppContext, studentId: string, titleId: string): Promise<IBookReservation> {
  await viewerFor(ctx, studentId);
  if (!Types.ObjectId.isValid(titleId)) throw new LibraryError(STORY_WAIT_ERRORS_BN.notWaiting);
  const r = await BookReservation.findOne({ titleId, studentId, status: { $in: ["QUEUED", "READY"] } }).lean();
  if (!r) throw new LibraryError(STORY_WAIT_ERRORS_BN.notWaiting);
  return cancelReservation(r._id.toString());
}

export interface ChildWait {
  reservation: IBookReservation;
  title: IBookTitle;
  seriesNameBn: string | null;
  /** 0 = held at the office now; else the place in the queue. */
  position: number;
}

/** 1-based place of a QUEUED reservation (older QUEUED rows on the title come first); 0 when READY. */
export async function queuePosition(r: Pick<IBookReservation, "_id" | "titleId" | "status" | "createdAt">): Promise<number> {
  if (r.status === "READY") return 0;
  const ahead = await BookReservation.countDocuments({
    titleId: r.titleId,
    status: "QUEUED",
    $or: [{ createdAt: { $lt: r.createdAt } }, { createdAt: r.createdAt, _id: { $lt: r._id } }],
  });
  return ahead + 1;
}

/** The child's storybook waits, held ones first (W4 "অপেক্ষায়"). */
export async function childStoryWaits(ctx: AppContext, studentId: string): Promise<ChildWait[]> {
  await resolveShelfViewer(ctx, studentId);
  const waits = await storyWaitsOf(studentId);
  if (waits.length === 0) return [];
  const titles = (await BookTitle.find({ _id: { $in: waits.map((w) => w.titleId) } }).lean()) as unknown as IBookTitle[];
  const series = await StorySeries.find({ _id: { $in: titles.map((t) => t.seriesId).filter(Boolean) } }).select("nameBn").lean();
  const tById = new Map(titles.map((t) => [t._id.toString(), t]));
  const sById = new Map(series.map((s) => [s._id.toString(), s.nameBn as string]));
  const out: ChildWait[] = [];
  for (const w of waits) {
    const t = tById.get(w.titleId.toString());
    if (!t) continue;
    out.push({ reservation: w, title: t, seriesNameBn: t.seriesId ? sById.get(t.seriesId.toString()) ?? null : null, position: await queuePosition(w) });
  }
  return out.sort((a, b) => a.position - b.position);
}
