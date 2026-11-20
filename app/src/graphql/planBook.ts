/** planBookChapter — the school's book chapter beside a lesson plan (docs: .claude/plans/plan-book-tab.md). */
import { gql } from "urql";

export interface PlanBookChapterT {
  available: boolean;
  reason: string | null;
  bookTitle: string | null;
  versionLabel: string | null;
  released: boolean;
  chapters: { key: string; title: string; number: number | null }[];
  chapterKey: string | null;
  title: string | null;
  childText: string | null;
  teacherNote: string | null;
  anchorMissing: boolean;
  pictures: { path: string; url: string }[];
}

export const PLAN_BOOK_CHAPTER = gql<{ planBookChapter: PlanBookChapterT }, { artifactId: string; chapterKey?: string | null }>`
  query PlanBookChapter($artifactId: String!, $chapterKey: String) {
    planBookChapter(artifactId: $artifactId, chapterKey: $chapterKey) {
      available
      reason
      bookTitle
      versionLabel
      released
      chapters {
        key
        title
        number
      }
      chapterKey
      title
      childText
      teacherNote
      anchorMissing
      pictures {
        path
        url
      }
    }
  }
`;
