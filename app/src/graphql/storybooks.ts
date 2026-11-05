/**
 * Storybook shelf (SB-1, D-#980/#981/#986, docs/prd-storybook-reading.md) — the series
 * catalogue guardians browse and Office manages. The PDF upload is REST
 * (lib/files.ts pickAndUploadStorybooks); everything else is here.
 */
import { gql } from "urql";

export interface StorySeriesCardT {
  id: string;
  code: string;
  nameBn: string;
  nameEn: string | null;
  ageBandCode: string;
  ageBandLabel: string;
  tagIds: string[];
  tagNamesBn: string[];
  aboutBn: string | null;
  learnPointsBn: string[];
  coverFileId: string | null;
  sortOrder: number;
  /** DRAFT | PUBLISHED | HIDDEN */
  status: string;
  bookCount: number;
  availableBooks: number;
  draftBooks: number;
  copyCount: number;
}

export interface StoryBookCardT {
  id: string;
  titleBn: string;
  titleEn: string | null;
  seriesId: string | null;
  seriesNo: number | null;
  tagIds: string[];
  tagNamesBn: string[];
  learnedPointsBn: string[];
  parentTipBn: string | null;
  coverFileId: string | null;
  previewFileIds: string[];
  draft: boolean;
  active: boolean;
  totalCopies: number;
  availableCopies: number;
  nextDueDate: string | null;
  waitingCount: number;
  childReadCount: number | null;
  childHasNow: boolean;
}

export interface StoryTagT {
  id: string;
  nameBn: string;
  nameEn: string | null;
  active: boolean;
}

export interface StoryAgeBandT {
  code: string;
  labelBn: string;
  ageMin: number;
  ageMax: number;
  classLevels: number[];
  sortOrder: number;
  active: boolean;
  isDefault: boolean;
}

const SERIES_FIELDS = `id code nameBn nameEn ageBandCode ageBandLabel tagIds tagNamesBn aboutBn learnPointsBn coverFileId sortOrder status bookCount availableBooks draftBooks copyCount`;
const BOOK_FIELDS = `id titleBn titleEn seriesId seriesNo tagIds tagNamesBn learnedPointsBn parentTipBn coverFileId previewFileIds draft active totalCopies availableCopies nextDueDate waitingCount childReadCount childHasNow`;
const TAG_FIELDS = `id nameBn nameEn active`;
const BAND_FIELDS = `code labelBn ageMin ageMax classLevels sortOrder active isDefault`;

export const STORY_SHELF_QUERY = gql<{ storyShelf: StorySeriesCardT[] }, { studentId?: string | null }>`
  query StoryShelf($studentId: String) {
    storyShelf(studentId: $studentId) { ${SERIES_FIELDS} }
  }
`;

export const STORY_SERIES_QUERY = gql<
  { storySeries: { series: StorySeriesCardT; books: StoryBookCardT[] } },
  { seriesId: string; studentId?: string | null }
>`
  query StorySeries($seriesId: String!, $studentId: String) {
    storySeries(seriesId: $seriesId, studentId: $studentId) {
      series { ${SERIES_FIELDS} }
      books { ${BOOK_FIELDS} }
    }
  }
`;

export const STORY_BOOK_QUERY = gql<
  { storyBook: { book: StoryBookCardT; seriesNameBn: string; seriesCode: string } },
  { titleId: string; studentId?: string | null }
>`
  query StoryBook($titleId: String!, $studentId: String) {
    storyBook(titleId: $titleId, studentId: $studentId) {
      book { ${BOOK_FIELDS} }
      seriesNameBn
      seriesCode
    }
  }
`;

export const STORYBOOK_IMAGE_QUERY = gql<{ storybookImage: string }, { fileId: string }>`
  query StorybookImage($fileId: String!) {
    storybookImage(fileId: $fileId)
  }
`;

export const STORY_TAGS_QUERY = gql<{ storyTags: StoryTagT[] }, { includeInactive?: boolean | null }>`
  query StoryTags($includeInactive: Boolean) {
    storyTags(includeInactive: $includeInactive) { ${TAG_FIELDS} }
  }
`;

export const STORY_AGE_BANDS_QUERY = gql<{ storyAgeBands: StoryAgeBandT[] }>`
  query StoryAgeBands {
    storyAgeBands { ${BAND_FIELDS} }
  }
`;

export const SAVE_STORY_AGE_BAND = gql<
  { saveStoryAgeBand: StoryAgeBandT },
  { code: string; labelBn: string; ageMin: number; ageMax: number; classLevels: number[]; active?: boolean | null }
>`
  mutation SaveStoryAgeBand($code: String!, $labelBn: String!, $ageMin: Int!, $ageMax: Int!, $classLevels: [Int!]!, $active: Boolean) {
    saveStoryAgeBand(code: $code, labelBn: $labelBn, ageMin: $ageMin, ageMax: $ageMax, classLevels: $classLevels, active: $active) { ${BAND_FIELDS} }
  }
`;

export const CREATE_STORY_TAG = gql<{ createStoryTag: StoryTagT }, { nameBn: string; nameEn?: string | null }>`
  mutation CreateStoryTag($nameBn: String!, $nameEn: String) {
    createStoryTag(nameBn: $nameBn, nameEn: $nameEn) { ${TAG_FIELDS} }
  }
`;

export const UPDATE_STORY_TAG = gql<
  { updateStoryTag: StoryTagT },
  { tagId: string; nameBn?: string | null; nameEn?: string | null; active?: boolean | null }
>`
  mutation UpdateStoryTag($tagId: String!, $nameBn: String, $nameEn: String, $active: Boolean) {
    updateStoryTag(tagId: $tagId, nameBn: $nameBn, nameEn: $nameEn, active: $active) { ${TAG_FIELDS} }
  }
`;

export const MERGE_STORY_TAGS = gql<{ mergeStoryTags: StoryTagT }, { fromTagId: string; intoTagId: string }>`
  mutation MergeStoryTags($fromTagId: String!, $intoTagId: String!) {
    mergeStoryTags(fromTagId: $fromTagId, intoTagId: $intoTagId) { ${TAG_FIELDS} }
  }
`;

export const BULK_TAG_STORY_BOOKS = gql<
  { bulkTagStoryBooks: number },
  { titleIds: string[]; addTagIds?: string[] | null; removeTagIds?: string[] | null }
>`
  mutation BulkTagStoryBooks($titleIds: [String!]!, $addTagIds: [String!], $removeTagIds: [String!]) {
    bulkTagStoryBooks(titleIds: $titleIds, addTagIds: $addTagIds, removeTagIds: $removeTagIds)
  }
`;

export interface SeriesInputT {
  nameBn?: string | null;
  nameEn?: string | null;
  ageBandCode?: string | null;
  tagIds?: string[] | null;
  aboutBn?: string | null;
  learnPointsBn?: string[] | null;
  sortOrder?: number | null;
}

export const CREATE_STORY_SERIES = gql<
  { createStorySeries: StorySeriesCardT },
  SeriesInputT & { code: string; nameBn: string; ageBandCode: string }
>`
  mutation CreateStorySeries($code: String!, $nameBn: String!, $nameEn: String, $ageBandCode: String!, $tagIds: [String!], $aboutBn: String, $learnPointsBn: [String!], $sortOrder: Int) {
    createStorySeries(code: $code, nameBn: $nameBn, nameEn: $nameEn, ageBandCode: $ageBandCode, tagIds: $tagIds, aboutBn: $aboutBn, learnPointsBn: $learnPointsBn, sortOrder: $sortOrder) { ${SERIES_FIELDS} }
  }
`;

export const UPDATE_STORY_SERIES = gql<
  { updateStorySeries: StorySeriesCardT },
  SeriesInputT & { seriesId: string; status?: string | null }
>`
  mutation UpdateStorySeries($seriesId: String!, $status: String, $nameBn: String, $nameEn: String, $ageBandCode: String, $tagIds: [String!], $aboutBn: String, $learnPointsBn: [String!], $sortOrder: Int) {
    updateStorySeries(seriesId: $seriesId, status: $status, nameBn: $nameBn, nameEn: $nameEn, ageBandCode: $ageBandCode, tagIds: $tagIds, aboutBn: $aboutBn, learnPointsBn: $learnPointsBn, sortOrder: $sortOrder) { ${SERIES_FIELDS} }
  }
`;

export const UPDATE_STORY_BOOK = gql<
  { updateStoryBook: StoryBookCardT },
  {
    titleId: string;
    titleBn?: string | null;
    titleEn?: string | null;
    seriesNo?: number | null;
    tagIds?: string[] | null;
    learnedPointsBn?: string[] | null;
    parentTipBn?: string | null;
  }
>`
  mutation UpdateStoryBook($titleId: String!, $titleBn: String, $titleEn: String, $seriesNo: Int, $tagIds: [String!], $learnedPointsBn: [String!], $parentTipBn: String) {
    updateStoryBook(titleId: $titleId, titleBn: $titleBn, titleEn: $titleEn, seriesNo: $seriesNo, tagIds: $tagIds, learnedPointsBn: $learnedPointsBn, parentTipBn: $parentTipBn) { ${BOOK_FIELDS} }
  }
`;

export const SET_STORY_BOOK_PUBLISHED = gql<{ setStoryBookPublished: StoryBookCardT }, { titleId: string; published: boolean }>`
  mutation SetStoryBookPublished($titleId: String!, $published: Boolean!) {
    setStoryBookPublished(titleId: $titleId, published: $published) { ${BOOK_FIELDS} }
  }
`;
