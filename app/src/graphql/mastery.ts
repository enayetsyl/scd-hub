/**
 * Mastery tracker operations — M-0 catalogue, marks, tags, policy, switch
 * (docs/prd-mastery.md §5.1, D-#775–#787).
 *
 * Every field a screen reads is selected here (the QR-10 rule: an unselected field is
 * `undefined` at runtime while TypeScript still believes in it).
 */
import { gql } from "urql";

export const MASTERY_COVERAGE_QUERY = gql`
  query MasteryCoverage {
    masteryCoverage {
      classToken
      subject
      draftCount
      lockedCount
      retiredCount
      questionTypeCount
    }
  }
`;

export const MASTERY_CATALOGUE_QUERY = gql`
  query MasteryCatalogue($classToken: String!, $subject: String!, $includeRetired: Boolean) {
    masteryCatalogue(classToken: $classToken, subject: $subject, includeRetired: $includeRetired) {
      classToken
      subject
      draftCount
      lockedCount
      retiredCount
      chapters {
        number
        titleBn
        termNote
        outcomeCount
      }
      outcomes {
        code
        chapterNumber
        strand
        labelBn
        labelEn
        sourceText
        nctbCode
        assess
        questionTypeCodes
        homeTipBn
        order
        status
      }
      questionTypes {
        code
        labelBn
        marks
        answerForm
        notes
        active
        history {
          marks
          from
        }
      }
    }
  }
`;

export const IMPORT_MASTERY_CATALOGUE = gql`
  mutation ImportMasteryCatalogue($catalogueJson: String!, $apply: Boolean!) {
    importMasteryCatalogue(catalogueJson: $catalogueJson, apply: $apply) {
      ok
      applied
      classToken
      subject
      status
      errors
      diff {
        added
        changed {
          code
          fields
        }
        unchanged
        removedDrafts
        retired
        qtAdded
        qtMarksChanged {
          code
          from
          to
        }
        qtLabelChanged
        errors
      }
    }
  }
`;

export const LOCK_MASTERY_CATALOGUE = gql`
  mutation LockMasteryCatalogue($classToken: String!, $subject: String!) {
    lockMasteryCatalogue(classToken: $classToken, subject: $subject)
  }
`;

export const SAVE_MASTERY_OUTCOME = gql`
  mutation SaveMasteryOutcome($code: String!, $labelBn: String, $homeTipBn: String, $questionTypeCodes: [String!]) {
    saveMasteryOutcome(code: $code, labelBn: $labelBn, homeTipBn: $homeTipBn, questionTypeCodes: $questionTypeCodes) {
      code
      labelBn
      homeTipBn
      questionTypeCodes
    }
  }
`;

export const RETIRE_MASTERY_OUTCOME = gql`
  mutation RetireMasteryOutcome($code: String!) {
    retireMasteryOutcome(code: $code)
  }
`;

export const SAVE_MASTERY_QUESTION_TYPE = gql`
  mutation SaveMasteryQuestionType(
    $classToken: String!
    $subject: String!
    $code: String!
    $labelBn: String!
    $marks: Float
    $answerForm: String
  ) {
    saveMasteryQuestionType(
      classToken: $classToken
      subject: $subject
      code: $code
      labelBn: $labelBn
      marks: $marks
      answerForm: $answerForm
    ) {
      code
      labelBn
      marks
      answerForm
      active
      history {
        marks
        from
      }
    }
  }
`;

export const MASTERY_TAGS_QUERY = gql`
  query MasteryTags {
    masteryTags {
      code
      labelBn
      appliesTo
      effect
      routeStrand
      routeSeq
      level
      questionTypeCodes
      deductionMarks
      allScopes
      scopes {
        classToken
        subject
      }
      system
      active
      order
    }
  }
`;

export const SAVE_MASTERY_TAG = gql`
  mutation SaveMasteryTag($input: MasteryTagInput!) {
    saveMasteryTag(input: $input) {
      code
      active
    }
  }
`;

const POLICY_FIELDS = `
  weakBelowPct weakGapVsSection minQuestionsForVerdict improvingAtPct masteredAtPct
  masteredDistinctQuestions masteredSeparateWeeks revisionFirstWeeks revisionThenWeeks
  reworkIsWeak workReworkIsLight lightSignalsMakeWeak lightSignalWindowWeeks
  sectionTriggerPct sectionTriggerMinAssessments retestAfterDays rubricWeakAtOrBelow rubricGoodAt
  assignmentTotalMarks assignmentMinutes assignmentPartAOn assignmentPartAMarks assignmentPartBMarks
  assignmentMixWeak assignmentMixImproving assignmentMixRevision
`;

export const MASTERY_POLICY_QUERY = gql`
  query MasteryPolicy($classToken: String, $subject: String) {
    masteryPolicy(classToken: $classToken, subject: $subject) {
      scopeKey
      ownKeys
      resolved { ${POLICY_FIELDS} }
    }
  }
`;

export const SAVE_MASTERY_POLICY = gql`
  mutation SaveMasteryPolicy($classToken: String, $subject: String, $values: MasteryPolicyInput!) {
    saveMasteryPolicy(classToken: $classToken, subject: $subject, values: $values) {
      scopeKey
      ownKeys
      resolved { ${POLICY_FIELDS} }
    }
  }
`;

export const MASTERY_ENABLEMENTS_QUERY = gql`
  query MasteryEnablements($academicYearId: String!) {
    masteryEnablements(academicYearId: $academicYearId) {
      classToken
      subject
      enabled
      changedAt
    }
  }
`;

export const SET_MASTERY_ENABLEMENT = gql`
  mutation SetMasteryEnablement($academicYearId: String!, $classToken: String!, $subject: String!, $enabled: Boolean!) {
    setMasteryEnablement(academicYearId: $academicYearId, classToken: $classToken, subject: $subject, enabled: $enabled) {
      classToken
      subject
      enabled
    }
  }
`;

export type MasteryCoverageRow = {
  classToken: string;
  subject: string;
  draftCount: number;
  lockedCount: number;
  retiredCount: number;
  questionTypeCount: number;
};

export type MasteryOutcomeRow = {
  code: string;
  chapterNumber: number | null;
  strand: string | null;
  labelBn: string;
  labelEn: string | null;
  sourceText: string;
  nctbCode: string | null;
  assess: string;
  questionTypeCodes: string[];
  homeTipBn: string | null;
  order: number;
  status: string;
};

export type MasteryQuestionTypeRow = {
  code: string;
  labelBn: string;
  marks: number | null;
  answerForm: string | null;
  notes: string | null;
  active: boolean;
  history: { marks: number; from: string }[];
};

export type MasteryTagRow = {
  code: string;
  labelBn: string;
  appliesTo: string;
  effect: string;
  routeStrand: string | null;
  routeSeq: number | null;
  level: string | null;
  questionTypeCodes: string[];
  deductionMarks: number | null;
  allScopes: boolean;
  scopes: { classToken: string; subject: string }[];
  system: boolean;
  active: boolean;
  order: number;
};

// ---------------------------------------------------------------------------
// M-2 — work sheets, exceptions-only entry, confirmation
// ---------------------------------------------------------------------------

const PAPER_FIELDS = `
  paperId
  source
  title
  sectionId
  classToken
  subject
  date
  hwItemId
  entryState
  totalMarks
  rubricLoCodes
  items {
    itemNo
    origin
    qid
    textBn
    loCodes
    chapterNumber
    questionTypeCode
    marks
  }
`;

export const MASTERY_PAPERS_PAGE_QUERY = gql`
  query MasteryPapersPage($sectionId: String!, $subject: String!, $page: Int, $pageSize: Int) {
    masteryPapersPage(sectionId: $sectionId, subject: $subject, page: $page, pageSize: $pageSize) {
      total
      page
      pageSize
      rows { ${PAPER_FIELDS} }
    }
  }
`;

export const MASTERY_PAPER_QUERY = gql`
  query MasteryPaper($paperId: String!) {
    masteryPaper(paperId: $paperId) {
      paper { ${PAPER_FIELDS} }
      roster {
        studentId
        name
        rollNumber
        defaultStatus
        result {
          status
          workRework
          workTags
          note
          items {
            itemNo
            marks
            rework
            tags
          }
          rubric {
            loCode
            step
          }
        }
      }
    }
  }
`;

export const MASTERY_HOMEWORK_OPTIONS_QUERY = gql`
  query MasteryHomeworkOptions($sectionId: String!, $subject: String!) {
    masteryHomeworkOptions(sectionId: $sectionId, subject: $subject) {
      hwItemId
      hwId
      date
      description
    }
  }
`;

export const MASTERY_BANK_QUESTIONS_QUERY = gql`
  query MasteryBankQuestions($loCodes: [String!], $subject: String, $classLevel: Int) {
    questions(loCodes: $loCodes, subject: $subject, classLevel: $classLevel, reviewStatus: "gold", limit: 50) {
      id
      qid
      loCodes
      questionType
      marks
      payloadJson
    }
  }
`;

export const CREATE_MASTERY_PAPER = gql`
  mutation CreateMasteryPaper(
    $sectionId: String!
    $subject: String!
    $source: String!
    $date: String!
    $title: String
    $hwItemId: String
    $items: [MasteryPaperItemInput!]!
    $rubricLoCodes: [String!]
  ) {
    createMasteryPaper(
      sectionId: $sectionId
      subject: $subject
      source: $source
      date: $date
      title: $title
      hwItemId: $hwItemId
      items: $items
      rubricLoCodes: $rubricLoCodes
    ) {
      paperId
    }
  }
`;

export const DELETE_MASTERY_PAPER = gql`
  mutation DeleteMasteryPaper($paperId: String!) {
    deleteMasteryPaper(paperId: $paperId)
  }
`;

export const SAVE_MASTERY_RESULTS = gql`
  mutation SaveMasteryResults($paperId: String!, $rows: [MasteryResultInput!]!) {
    saveMasteryResults(paperId: $paperId, rows: $rows) {
      saved
      evidenceRows
    }
  }
`;

export const CONFIRM_MASTERY_PAPER = gql`
  mutation ConfirmMasteryPaper($paperId: String!) {
    confirmMasteryPaper(paperId: $paperId) {
      paperId
      students
      evidenceRows
      skipped
      behaviourNotes
    }
  }
`;

export type MasteryPaperItemRow = {
  itemNo: number;
  origin: string;
  qid: string | null;
  textBn: string | null;
  loCodes: string[];
  chapterNumber: number | null;
  questionTypeCode: string;
  marks: number;
};

export type MasteryPaperRow = {
  paperId: string;
  source: string;
  title: string | null;
  sectionId: string;
  classToken: string;
  subject: string;
  date: string;
  hwItemId: string | null;
  entryState: string;
  totalMarks: number;
  rubricLoCodes: string[];
  items: MasteryPaperItemRow[];
};

export type MasteryResultRow = {
  status: string | null;
  workRework: boolean;
  workTags: string[];
  note: string | null;
  items: { itemNo: number; marks: number | null; rework: boolean; tags: string[] }[];
  rubric: { loCode: string; step: number }[];
};

export type MasteryRosterEntry = {
  studentId: string;
  name: string;
  rollNumber: string | null;
  defaultStatus: string;
  result: MasteryResultRow | null;
};
