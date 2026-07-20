/**
 * VideoReviewService — the simple class-video self-review loop (owner ask
 * 2026-07-20): office logs a YouTube link + session context and assigns a
 * teacher; the teacher answers ঠিক আছে (OK) or সমস্যা আছে (NOT_OK + mandatory
 * comment); Principal/Office watch the pending counts and the verdicts.
 *
 * All writes audited. Errors are Bangla (they surface in the app as-is).
 */
import { Types } from "mongoose";
import {
  VideoReviewAssignment,
  type IVideoReviewAssignment,
} from "../models/VideoReviewAssignment";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";

export interface VideoReviewShape {
  id: string;
  youtubeUrl: string;
  classDate: string;
  timeLabel: string;
  classLabel: string;
  room: string;
  teacherId: string;
  /** Joined for the office overview; null on the teacher's own list. */
  teacherName: string | null;
  status: string;
  comment: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface VideoReviewTeacherSummary {
  teacherId: string;
  teacherName: string | null;
  pending: number;
  ok: number;
  notOk: number;
}

const YOUTUBE_URL =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|live\/|embed\/)|youtu\.be\/)\S+$/i;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function shape(doc: IVideoReviewAssignment, teacherName: string | null = null): VideoReviewShape {
  return {
    id: doc._id.toString(),
    youtubeUrl: doc.youtubeUrl,
    classDate: doc.classDate,
    timeLabel: doc.timeLabel,
    classLabel: doc.classLabel,
    room: doc.room,
    teacherId: doc.teacherId.toString(),
    teacherName,
    status: doc.status,
    comment: doc.comment ?? null,
    reviewedAt: doc.reviewedAt ? new Date(doc.reviewedAt).toISOString() : null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : "",
  };
}

export interface CreateVideoReviewInput {
  youtubeUrl: string;
  classDate: string;
  timeLabel: string;
  classLabel: string;
  room: string;
  teacherId: string;
  actorId: string;
  actorRole?: string;
}

export async function createVideoReview(input: CreateVideoReviewInput): Promise<VideoReviewShape> {
  const url = input.youtubeUrl.trim();
  if (!YOUTUBE_URL.test(url)) {
    throw new Error("সঠিক ইউটিউব লিংক দিন (youtube.com বা youtu.be)");
  }
  if (!DATE_KEY.test(input.classDate)) {
    throw new Error("তারিখ YYYY-MM-DD আকারে দিন");
  }
  for (const [field, label] of [
    [input.timeLabel, "সময়"],
    [input.classLabel, "শ্রেণি"],
    [input.room, "রুম"],
  ] as const) {
    if (!field || field.trim() === "") throw new Error(`${label} লিখুন`);
  }
  const teacher = (await User.findById(input.teacherId).lean()) as {
    _id: Types.ObjectId;
    role?: string;
    active?: boolean;
    name?: string;
  } | null;
  if (!teacher || teacher.role !== "TEACHER" || teacher.active === false) {
    throw new Error("নির্ধারিত শিক্ষক পাওয়া যায়নি");
  }

  const doc = await VideoReviewAssignment.create({
    youtubeUrl: url,
    classDate: input.classDate,
    timeLabel: input.timeLabel.trim(),
    classLabel: input.classLabel.trim(),
    room: input.room.trim(),
    teacherId: teacher._id,
    status: "PENDING",
    assignedBy: input.actorId,
  });

  await writeAudit({
    eventKind: "VIDEO_REVIEW_ASSIGNED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: doc._id,
    targetKind: "VideoReviewAssignment",
    meta: { teacherId: input.teacherId, classDate: input.classDate, youtubeUrl: url },
  });

  return shape(doc, teacher.name ?? null);
}

/** The teacher's own list — PENDING first, then newest class date. */
export async function myVideoReviews(teacherId: string): Promise<VideoReviewShape[]> {
  const rows = (await VideoReviewAssignment.find({
    teacherId,
    active: { $ne: false },
  }).lean()) as unknown as IVideoReviewAssignment[];
  return rows
    .sort(
      (a, b) =>
        (a.status === "PENDING" ? 0 : 1) - (b.status === "PENDING" ? 0 : 1) ||
        b.classDate.localeCompare(a.classDate),
    )
    .map((r) => shape(r));
}

export interface ReviewVideoInput {
  id: string;
  ok: boolean;
  comment?: string | null;
  actorId: string;
  actorRole?: string;
}

export async function reviewVideo(input: ReviewVideoInput): Promise<VideoReviewShape> {
  const doc = await VideoReviewAssignment.findById(input.id);
  if (!doc || doc.active === false) throw new Error("ভিডিও রিভিউটি পাওয়া যায়নি");
  if (doc.teacherId.toString() !== input.actorId) {
    throw new Error("শুধু নির্ধারিত শিক্ষকই এই ভিডিওটি রিভিউ করতে পারেন");
  }
  if (doc.status !== "PENDING") throw new Error("এই ভিডিওটির রিভিউ আগেই সম্পন্ন হয়েছে");
  const comment = (input.comment ?? "").trim();
  if (!input.ok && comment === "") {
    throw new Error("সমস্যা থাকলে মন্তব্য লিখুন");
  }

  doc.status = input.ok ? "OK" : "NOT_OK";
  doc.comment = input.ok ? null : comment;
  doc.reviewedAt = new Date();
  await doc.save();

  await writeAudit({
    eventKind: "VIDEO_REVIEW_REVIEWED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: doc._id,
    targetKind: "VideoReviewAssignment",
    meta: { status: doc.status, comment: doc.comment ?? undefined },
  });

  return shape(doc);
}

export interface VideoReviewOverview {
  rows: VideoReviewShape[];
  summary: VideoReviewTeacherSummary[];
}

/** The office board: every active row (teacher name joined) + per-teacher counts. */
export async function videoReviewOverview(): Promise<VideoReviewOverview> {
  const rows = (await VideoReviewAssignment.find({
    active: { $ne: false },
  }).lean()) as unknown as IVideoReviewAssignment[];

  const teacherIds = [...new Set(rows.map((r) => r.teacherId.toString()))];
  const teachers = (await User.find({ _id: { $in: teacherIds } })
    .select("name")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name?: string }>;
  const nameById = new Map(teachers.map((t) => [t._id.toString(), t.name ?? null]));

  const byTeacher = new Map<string, VideoReviewTeacherSummary>();
  for (const r of rows) {
    const tid = r.teacherId.toString();
    const s = byTeacher.get(tid) ?? {
      teacherId: tid,
      teacherName: nameById.get(tid) ?? null,
      pending: 0,
      ok: 0,
      notOk: 0,
    };
    if (r.status === "PENDING") s.pending += 1;
    else if (r.status === "OK") s.ok += 1;
    else s.notOk += 1;
    byTeacher.set(tid, s);
  }

  return {
    rows: rows
      .sort(
        (a, b) =>
          (a.status === "PENDING" ? 0 : 1) - (b.status === "PENDING" ? 0 : 1) ||
          b.classDate.localeCompare(a.classDate),
      )
      .map((r) => shape(r, nameById.get(r.teacherId.toString()) ?? null)),
    // Most pending first — the teachers the office should nudge.
    summary: [...byTeacher.values()].sort((a, b) => b.pending - a.pending),
  };
}
