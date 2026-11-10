/**
 * Draft label helpers (AI Workspace W-3).
 */
import { STR } from "../../lib/labels";
import type { AiDraftKindT } from "../../graphql/aiWorkspaceDrafts";

export const DRAFT_KINDS: AiDraftKindT[] = ["free", "lesson_plan", "question_bank", "book_chapter", "storybook", "paper"];

export const kindLabel = (k: string): string =>
  ({
    free: STR.awKindFree,
    lesson_plan: STR.awKindLessonPlan,
    question_bank: STR.awKindQuestionBank,
    book_chapter: STR.awKindBookChapter,
    storybook: STR.awKindStorybook,
    paper: STR.awKindPaper,
  })[k] ?? k;

export const sourceLabel = (s: string): string =>
  ({ manual: STR.awSourceManual, chat: STR.awSourceChat, revise: STR.awSourceRevise, job: STR.awSourceJob })[s] ?? s;

/** Kinds whose body is JSON text. */
export const isJsonKind = (k: string): boolean => k === "question_bank" || k === "book_chapter";
