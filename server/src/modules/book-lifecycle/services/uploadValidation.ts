/**
 * The whole-upload path (source: upload — BL-1's `uploadNewVersionDraft`) runs the SAME text rules as
 * the edit pipeline once BL-3 exists: VR-7 (every change run explained by a row that really names
 * it) and VR-12 (sacred text) per changed chapter, judged against the BASE text. Used at accept time
 * and by the direct-fix approve.
 */
import { Types } from "mongoose";
import type { DraftFinding } from "../models/BookEditDraft";
import { BookFeedback, BookInstruction, BookDecision } from "../models/BookFeedback";
import type { BookChange } from "../models/BookVersion";
import { loadBook } from "./store";
import { activeRuleSetsFor } from "./feedbackService";
import { validateChapter, type ChangeRow, type ValidationContext } from "./validator";

export interface UploadChapter {
  key: string;
  base: string;
  next: string;
}

export async function validateUploadedChapters(
  bookId: Types.ObjectId,
  chapters: UploadChapter[],
  changes: Pick<BookChange, "chapterKey" | "beforeExcerpt" | "afterExcerpt" | "refs">[],
  mediaPaths: Set<string>,
  /** A finalize holder confirmed the protected-text change: those regions are not judged again here. */
  protectedConfirmed = false,
): Promise<{ blocking: DraftFinding[]; unexplained: { key: string; count: number }[] }> {
  const book = await loadBook(bookId);
  const refs = [...new Set(changes.flatMap((c) => c.refs))];
  const [items, instructions, decisions, ruleSets] = await Promise.all([
    BookFeedback.find({ bookId, code: { $in: refs.filter((r) => r.startsWith("F-")) } }),
    BookInstruction.find({ bookId, code: { $in: refs.filter((r) => r.startsWith("I-")) } }),
    BookDecision.find({ bookId, status: "ruled" }),
    activeRuleSetsFor(book),
  ]);
  const ctx: ValidationContext = { draft: { scopeChapterKeys: [], chapters: [] }, items, instructions, decisions, ruleSets, mediaPaths, headingLevel: book.chapterHeadingLevel };
  const blocking: DraftFinding[] = [];
  const unexplained: { key: string; count: number }[] = [];
  const strip = (t: string) => {
    const s = t.replace(/(<!-- bl:server start[^>]*?-->)[\s\S]*?(<!-- bl:server end -->)/g, "$1$2");
    return protectedConfirmed ? s.replace(/(<!-- bl:protect start[^>]*?-->)[\s\S]*?(<!-- bl:protect end -->)/g, "$1$2") : s;
  };
  for (const c0 of chapters) {
    // The server owns its regions (the version line): they never count as an edit.
    const c = { ...c0, base: strip(c0.base), next: strip(c0.next) };
    if (c.base === c.next) continue;
    const rows: ChangeRow[] = changes.filter((x) => x.chapterKey === c.key).map((x) => ({ chapterKey: x.chapterKey, beforeExcerpt: x.beforeExcerpt ?? "", afterExcerpt: x.afterExcerpt ?? "", refs: x.refs }));
    const r = validateChapter(ctx, { key: c.key, base: c.base, next: c.next, mode: "whole", changes: rows });
    // VR-1 (base), VR-5 (an open pipeline draft's scope / front rule) and VR-9 (protected text: the upload has its own
    // finalize confirmation) are handled elsewhere for a whole upload.
    blocking.push(...r.findings.filter((f) => f.level === "blocking" && f.code !== "VR-1" && f.code !== "VR-5" && f.code !== "VR-9"));
    if (r.unexplained.length) unexplained.push({ key: c.key, count: r.unexplained.length });
  }
  return { blocking, unexplained };
}
