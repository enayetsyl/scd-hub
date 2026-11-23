/**
 * AssignmentCommentService — AL-8 of the 2027 academic loop (docs/prd-academic-loop-2027.md §4.6, journey C6).
 *
 *   assignmentOfficeWeeksPage   Office / Principal: every শাখা's drafts + finalised weeks of one ISO week (paged)
 *   assignmentComments          the comments on one assignment (the Office, or the subject teacher it is about)
 *   addAssignmentComment        Office / Principal comment (`assignment:comment`); notifies the subject teacher (AS_COMMENT)
 *
 * Release switch (§3.6): with `academicLoop2027On` OFF nothing here reads or writes — the list is empty and a comment is
 * refused, so every 2026 flow stays byte-for-byte unchanged.
 */
import { Types } from "mongoose";
import { HW_SUBJECT_LABELS_BN } from "@scd/shared";
import { MasteryAssignment, type IMasteryAssignment } from "../models/MasteryAssignment";
import { MasteryAssignmentSheet } from "../models/MasteryAssignmentSheet";
import { AssignmentComment } from "../models/AssignmentComment";
import { User } from "../../foundation/models/User";
import { emit } from "../../notifications/services/NotificationService";
import { resolveSubjectTeacher } from "../../trackers/subjectTeacher";
import { isLoop2027On } from "../../assessment/services/QuestionUseService";
import { personName } from "../../../lib/personName";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { reportSilentFailure } from "../../../lib/reportError";
import { MasteryWorkError, dayOf, type Auth } from "./MasteryWorkService";
import { sectionLabel } from "./MasteryDiagnosisService";
import { NOT_ON, canReadAssignment } from "./AssignmentSuggestionService";
import { assignmentView, mayChangeDraft, type AssignmentView } from "./MasteryAssignmentService";
import { isoWeekKey } from "../evidence";

const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const subjectBn = (s: string): string => (HW_SUBJECT_LABELS_BN as Record<string, string>)[s] ?? s;
const COMMENT_MAX = 1000;

export interface OfficeWeekRow {
  assignmentId: string;
  sectionId: string;
  sectionLabelBn: string;
  subject: string;
  subjectBn: string;
  status: string;
  builtBy: string | null;
  edited: boolean;
  needsReviewCount: number;
  minutes: number | null;
  commentCount: number;
  dueDate: string;
}

/** Office / Principal (`assignment:view_all`): the week's assignments across every শাখা. The week = the ISO week of the due date. */
export async function assignmentOfficeWeeksPage(dueYmd: string, args: PageArgs): Promise<Page<OfficeWeekRow>> {
  if (!(await isLoop2027On())) return { rows: [], total: 0, page: 1, pageSize: args.pageSize ?? 50 };
  const week = isoWeekKey(dayOf(dueYmd));
  return queryPage(MasteryAssignment, { week }, { classToken: 1, sectionId: 1, subject: 1 }, args, async (docs) => {
    const ids = docs.map((d) => d._id);
    const sheets = await MasteryAssignmentSheet.find({ assignmentId: { $in: ids } }).select("assignmentId status").lean();
    const counts = await AssignmentComment.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { assignmentId: { $in: ids } } },
      { $group: { _id: "$assignmentId", n: { $sum: 1 } } },
    ]);
    const nComments = new Map(counts.map((c) => [String(c._id), c.n]));
    const labels = new Map<string, string>();
    for (const sid of new Set(docs.map((d) => String(d.sectionId)))) {
      const l = await sectionLabel(new Types.ObjectId(sid));
      labels.set(sid, [l.className, l.sectionName].filter(Boolean).join(" · "));
    }
    return docs.map((d) => ({
      assignmentId: String(d._id),
      sectionId: String(d.sectionId),
      sectionLabelBn: labels.get(String(d.sectionId)) ?? "",
      subject: d.subject,
      subjectBn: subjectBn(d.subject),
      status: d.status,
      builtBy: d.suggestion?.builtBy ?? null,
      edited: Boolean(d.suggestion?.editedAt),
      needsReviewCount: sheets.filter((s) => String(s.assignmentId) === String(d._id) && s.status === "NEEDS_REVIEW").length,
      minutes: typeof d.countedMinutes === "number" ? Math.round(d.countedMinutes) : null,
      commentCount: nComments.get(String(d._id)) ?? 0,
      dueDate: d.dueDate.toISOString().slice(0, 10),
    }));
  });
}

export interface AssignmentCommentView {
  id: string;
  authorName: string;
  textBn: string;
  createdAt: string;
}

const loadAssignment = async (assignmentId: string) => {
  if (!Types.ObjectId.isValid(assignmentId)) throw new MasteryWorkError("অ্যাসাইনমেন্ট পাওয়া যায়নি।");
  const a = await MasteryAssignment.findById(assignmentId);
  if (!a) throw new MasteryWorkError("অ্যাসাইনমেন্ট পাওয়া যায়নি।");
  return a;
};

/**
 * One assignment by id for the review screen: everyone the week screen admits (`assertWeekReader` — the class teacher, a
 * rotation-cell teacher, today's substitute, the Office / Principal) READS it; `mayEdit` / `mayFinalise` say whether the caller
 * may also change / finalise it, by the very rule the mutations apply (incl. the Office on a teacher's Wed/Thu leave day).
 */
export async function assignmentForReview(assignmentId: string, auth: Auth): Promise<AssignmentView> {
  if (!(await isLoop2027On())) throw new MasteryWorkError(NOT_ON);
  const a = await loadAssignment(assignmentId);
  await assertReader(a, auth);
  const may = await mayChangeDraft(a, auth);
  return { ...(await assignmentView(a)), mayEdit: may, mayFinalise: may };
}

const assertReader = async (a: IMasteryAssignment, auth: Auth): Promise<void> => {
  if (!(await canReadAssignment(a, auth))) {
    throw new MasteryWorkError("এই শাখার সাপ্তাহিক অ্যাসাইনমেন্ট শুধু এই সপ্তাহের বিষয়শিক্ষক, শ্রেণি শিক্ষক, বদলি শিক্ষক ও অফিস দেখতে পারেন।");
  }
};

/** The comments on one assignment — read by every reader of the assignment (same reach as `assignmentForReview`). */
export async function assignmentComments(assignmentId: string, auth: Auth): Promise<AssignmentCommentView[]> {
  if (!(await isLoop2027On())) return [];
  const a = await loadAssignment(assignmentId);
  await assertReader(a, auth);
  const rows = await AssignmentComment.find({ assignmentId: a._id }).sort({ createdAt: 1 }).lean();
  return rows.map((r) => ({ id: String(r._id), authorName: r.authorName, textBn: r.textBn, createdAt: r.createdAt.toISOString() }));
}

/** An Office / Principal comment on a draft or finalised week; the subject teacher is told (`AS_COMMENT`). */
export async function addAssignmentComment(assignmentId: string, text: string, auth: Auth): Promise<AssignmentCommentView> {
  if (!(await isLoop2027On())) throw new MasteryWorkError(NOT_ON);
  const textBn = (text ?? "").trim();
  if (!textBn) throw new MasteryWorkError("মন্তব্য লিখুন।");
  if (textBn.length > COMMENT_MAX) throw new MasteryWorkError(`মন্তব্য ${bn(COMMENT_MAX)} অক্ষরের মধ্যে দিন।`);
  if (!Types.ObjectId.isValid(auth.userId)) throw new MasteryWorkError("ব্যবহারকারী পাওয়া যায়নি।");
  const a = await loadAssignment(assignmentId);
  const author = await User.findById(auth.userId).select("name nameBn").lean();
  const authorName = author ? personName(author) : "";
  const c = await AssignmentComment.create({
    assignmentId: a._id, sectionId: a.sectionId, subject: a.subject, week: a.week,
    authorId: new Types.ObjectId(auth.userId), authorName, textBn,
  });
  const teacher = await resolveSubjectTeacher(String(a.sectionId), a.subject, a.dueDate).catch(() => null);
  if (teacher && String(teacher) !== String(auth.userId)) {
    const l = await sectionLabel(a.sectionId);
    const where = [l.className, l.sectionName].filter(Boolean).join(" · ");
    const short = textBn.length > 120 ? `${textBn.slice(0, 117)}…` : textBn;
    await emit({
      recipientUserId: String(teacher), kind: "AS_COMMENT", titleBn: "অ্যাসাইনমেন্টে মন্তব্য",
      bodyBn: `${where} · ${subjectBn(a.subject)} — ${authorName ? `${authorName}: ` : ""}${short}`,
      refs: { sectionId: String(a.sectionId), subject: a.subject, masteryAssignmentId: String(a._id) },
      // The comment and the recipient: a second comment, or a cover teacher, is never swallowed by the first.
      dedupeKey: `ASCM:${String(c._id)}:${String(teacher)}`,
    }).catch((err) => reportSilentFailure("assignmentComment.notify", err, { assignmentId }));
  }
  return { id: String(c._id), authorName, textBn, createdAt: c.createdAt.toISOString() };
}
