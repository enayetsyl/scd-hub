/**
 * Mastery tracker operations — M-0 catalogue, marks, tags, policy, switch
 * (docs/prd-mastery.md §5.1, D-#775–#787).
 *
 * Every field a screen reads is selected here (the QR-10 rule: an unselected field is
 * `undefined` at runtime while TypeScript still believes in it).
 */
import { gql } from "urql";

/** LP-3 (D-#823/#825) — defined first: the trail query below interpolates it. */
export const STUDENT_LESSON_SESSION_FIELDS = `subject key chapter anchorWord sessionIndex sessionOf titleBn taughtOn absentOn unknownOn presence onLeave`;

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
        itemNos
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
  /** AS sheets (M-4): the items this student was given; null ⇒ every item. */
  itemNos: number[] | null;
  result: MasteryResultRow | null;
};

// ---------------------------------------------------------------------------
// M-3 — diagnosis views, quality report, exclusion (docs/prd-mastery.md §5.3 / §6.4)
// ---------------------------------------------------------------------------

const STATE_FIELDS = `
  loCode
  labelBn
  chapterNumber
  strand
  state
  since
  lastEvidenceAt
  evidenceCount
  assessments
  earnedPct
  recentPct
  sectionMeanPct
  reworkCount
  reasons
  nextRevisionAt
`;

export const MASTERY_SECTION_HEATMAP_QUERY = gql`
  query MasterySectionHeatmap($sectionId: String!, $subject: String!) {
    masterySectionHeatmap(sectionId: $sectionId, subject: $subject) {
      sectionId
      sectionName
      className
      subject
      triggerPct
      notYetAssessed
      students {
        studentId
        name
        rollNumber
        weakCount
      }
      outcomes {
        loCode
        labelBn
        chapterNumber
        strand
        assessments
        weak
        verdicts
        weakPct
        triggered
        sectionMeanPct
        actionId
        actionStatus
        cells {
          state
          pct
        }
      }
    }
  }
`;

export const MASTERY_STUDENT_DIAGNOSIS_QUERY = gql`
  query MasteryStudentDiagnosis($studentId: String!, $subject: String!) {
    masteryStudentDiagnosis(studentId: $studentId, subject: $subject) {
      studentId
      name
      rollNumber
      sectionId
      sectionName
      className
      classToken
      subject
      subjects
      sectionSize
      moreWeakThan
      outcomes { ${STATE_FIELDS} }
    }
  }
`;

export const MASTERY_OUTCOME_TRAIL_QUERY = gql`
  query MasteryOutcomeTrail($studentId: String!, $loCode: String!) {
    masteryOutcomeTrail(studentId: $studentId, loCode: $loCode) {
      studentId
      name
      homeTipBn
      bankGold
      bankSeen
      chapterLessons { ${STUDENT_LESSON_SESSION_FIELDS} }
      outcome { ${STATE_FIELDS} }
      history {
        state
        at
        paperId
      }
      rows {
        paperId
        source
        title
        date
        itemNo
        qid
        questionTypeCode
        earned
        available
        rubricStep
        rework
        workRework
        signal
        routed
        excluded
        excludeReason
        tags {
          code
          labelBn
        }
      }
    }
  }
`;

export const MASTERY_QUALITY_PAPERS_PAGE_QUERY = gql`
  query MasteryQualityPapersPage($sectionId: String!, $subject: String!, $page: Int, $pageSize: Int) {
    masteryQualityPapersPage(sectionId: $sectionId, subject: $subject, page: $page, pageSize: $pageSize) {
      total
      page
      pageSize
      rows {
        students
        meanPct
        flagged
        paper { ${PAPER_FIELDS} }
      }
    }
  }
`;

const EXCLUSION_FIELDS = `
  id
  scope
  paperId
  itemNo
  qid
  reason
  at
  byName
`;

export const MASTERY_PAPER_QUALITY_QUERY = gql`
  query MasteryPaperQuality($paperId: String!) {
    masteryPaperQuality(paperId: $paperId) {
      students
      rosterSize
      meanPct
      flagged
      paper { ${PAPER_FIELDS} }
      items {
        itemNo
        students
        facility
        reworkRate
        meanPct
        discrimination
        topMeanPct
        signals
        exclusion { ${EXCLUSION_FIELDS} }
      }
    }
  }
`;

export const EXCLUDE_MASTERY_ITEM = gql`
  mutation ExcludeMasteryItem($paperId: String!, $itemNo: Int!, $scope: String!, $reason: String!) {
    excludeMasteryItem(paperId: $paperId, itemNo: $itemNo, scope: $scope, reason: $reason) { ${EXCLUSION_FIELDS} }
  }
`;

export const REVOKE_MASTERY_EXCLUSION = gql`
  mutation RevokeMasteryExclusion($exclusionId: String!) {
    revokeMasteryExclusion(exclusionId: $exclusionId)
  }
`;

export type MasteryOutcomeStateRow = {
  loCode: string;
  labelBn: string;
  chapterNumber: number | null;
  strand: string | null;
  state: string;
  since: string | null;
  lastEvidenceAt: string | null;
  evidenceCount: number;
  assessments: number;
  earnedPct: number | null;
  recentPct: number | null;
  sectionMeanPct: number | null;
  reworkCount: number;
  reasons: string[];
  nextRevisionAt: string | null;
};

export type MasteryHeatmap = {
  sectionId: string;
  sectionName: string;
  className: string;
  subject: string;
  triggerPct: number;
  notYetAssessed: number;
  students: { studentId: string; name: string; rollNumber: string | null; weakCount: number }[];
  outcomes: {
    loCode: string;
    labelBn: string;
    chapterNumber: number | null;
    strand: string | null;
    assessments: number;
    weak: number;
    verdicts: number;
    weakPct: number | null;
    triggered: boolean;
    sectionMeanPct: number | null;
    actionId: string | null;
    actionStatus: string | null;
    cells: { state: string; pct: number | null }[];
  }[];
};

export type MasteryStudentDiagnosisData = {
  studentId: string;
  name: string;
  rollNumber: string | null;
  sectionId: string;
  sectionName: string;
  className: string;
  classToken: string;
  subject: string;
  subjects: string[];
  sectionSize: number;
  moreWeakThan: number;
  outcomes: MasteryOutcomeStateRow[];
};

/** LP-3 (D-#823/#825): one session plan as taught to one child, with presence from day attendance. */
export type StudentLessonSessionT = {
  subject: string;
  key: string;
  chapter: string;
  anchorWord: string;
  sessionIndex: number;
  sessionOf: number;
  titleBn: string;
  taughtOn: string[];
  absentOn: string[];
  unknownOn: string[];
  /** PRESENT | PARTIAL | ABSENT | UNKNOWN */
  presence: string;
  onLeave: boolean;
};

export type MasteryTrailData = {
  studentId: string;
  name: string;
  homeTipBn: string | null;
  bankGold: number;
  bankSeen: number;
  /** LP-3: the outcome's chapter as taught in class (empty = not marked yet). */
  chapterLessons: StudentLessonSessionT[];
  outcome: MasteryOutcomeStateRow;
  history: { state: string; at: string; paperId: string | null }[];
  rows: {
    paperId: string;
    source: string;
    title: string | null;
    date: string;
    itemNo: number | null;
    qid: string | null;
    questionTypeCode: string | null;
    earned: number;
    available: number;
    rubricStep: number | null;
    rework: boolean;
    workRework: boolean;
    signal: string;
    routed: boolean;
    excluded: boolean;
    excludeReason: string | null;
    tags: { code: string; labelBn: string }[];
  }[];
};

export type MasteryExclusionRow = {
  id: string;
  scope: string;
  paperId: string;
  itemNo: number;
  qid: string | null;
  reason: string;
  at: string;
  byName: string;
};

export type MasteryQualityPaperRow = { students: number; meanPct: number | null; flagged: number; paper: MasteryPaperRow };

export type MasteryPaperQualityData = {
  students: number;
  rosterSize: number;
  meanPct: number | null;
  flagged: number;
  paper: MasteryPaperRow;
  items: {
    itemNo: number;
    students: number;
    facility: number | null;
    reworkRate: number | null;
    meanPct: number | null;
    discrimination: number | null;
    topMeanPct: number | null;
    signals: string[];
    exclusion: MasteryExclusionRow | null;
  }[];
};

// ---------------------------------------------------------------------------
// M-4 — the weekly tailored assignment (docs/prd-mastery.md §5.4 / §6.1)
// ---------------------------------------------------------------------------

const LAYOUT_FIELDS = `
  totalMarks
  minutes
  partAOn
  partAMarks
  partALoCodes
  partBMarks
  mixWeak
  mixImproving
  mixRevision
  questionTypeCodes
`;

const AS_QUESTION_FIELDS = `
  origin
  artifactId
  qid
  textBn
  loCode
  labelBn
  chapterNumber
  questionTypeCode
  marks
  band
`;

const ASSIGNMENT_FIELDS = `
  id
  sectionId
  subject
  classToken
  dueDate
  week
  rememberLayout
  status
  paperId
  asItemId
  layout { ${LAYOUT_FIELDS} }
  partA { ${AS_QUESTION_FIELDS} }
  sheets {
    studentId
    name
    rollNumber
    status
    marks
    items {
      loCode
      labelBn
      band
    }
    warnings {
      code
      loCode
      labelBn
    }
  }
`;

const SHEET_FIELDS = `
  assignmentId
  assignmentStatus
  studentId
  name
  rollNumber
  status
  marks
  targetMarks
  items { ${AS_QUESTION_FIELDS} }
  warnings {
    code
    loCode
    labelBn
  }
  outcomeChoices {
    loCode
    labelBn
    questionTypeCodes
  }
`;

export const MASTERY_ASSIGNMENT_QUERY = gql`
  query MasteryAssignment($sectionId: String!, $subject: String!, $dueDate: String!) {
    masteryAssignment(sectionId: $sectionId, subject: $subject, dueDate: $dueDate) {
      week
      startingLayout { ${LAYOUT_FIELDS} }
      assignment { ${ASSIGNMENT_FIELDS} }
    }
  }
`;

export const MASTERY_ASSIGNMENT_SHEET_QUERY = gql`
  query MasteryAssignmentSheet($assignmentId: String!, $studentId: String!) {
    masteryAssignmentSheet(assignmentId: $assignmentId, studentId: $studentId) { ${SHEET_FIELDS} }
  }
`;

export const MASTERY_ASSIGNMENT_TRACKER_ITEMS_QUERY = gql`
  query MasteryAssignmentTrackerItems($sectionId: String!, $subject: String!) {
    masteryAssignmentTrackerItems(sectionId: $sectionId, subject: $subject) {
      asItemId
      asId
      dueDate
      description
    }
  }
`;

export const BUILD_MASTERY_ASSIGNMENT = gql`
  mutation BuildMasteryAssignment(
    $sectionId: String!
    $subject: String!
    $dueDate: String!
    $layout: MasteryAssignmentLayoutInput!
    $rememberLayout: Boolean!
    $asItemId: String
  ) {
    buildMasteryAssignment(
      sectionId: $sectionId
      subject: $subject
      dueDate: $dueDate
      layout: $layout
      rememberLayout: $rememberLayout
      asItemId: $asItemId
    ) { ${ASSIGNMENT_FIELDS} }
  }
`;

export const EDIT_MASTERY_ASSIGNMENT_SHEET = gql`
  mutation EditMasteryAssignmentSheet(
    $assignmentId: String!
    $studentId: String!
    $op: String!
    $index: Int
    $loCode: String
    $questionTypeCode: String
    $textBn: String
  ) {
    editMasteryAssignmentSheet(
      assignmentId: $assignmentId
      studentId: $studentId
      op: $op
      index: $index
      loCode: $loCode
      questionTypeCode: $questionTypeCode
      textBn: $textBn
    ) { ${SHEET_FIELDS} }
  }
`;

export const APPROVE_MASTERY_ASSIGNMENT_SHEETS = gql`
  mutation ApproveMasteryAssignmentSheets($assignmentId: String!) {
    approveMasteryAssignmentSheets(assignmentId: $assignmentId) { ${ASSIGNMENT_FIELDS} }
  }
`;

export const SEND_MASTERY_ASSIGNMENT = gql`
  mutation SendMasteryAssignment($assignmentId: String!) {
    sendMasteryAssignment(assignmentId: $assignmentId) { ${ASSIGNMENT_FIELDS} }
  }
`;

export const DELETE_MASTERY_ASSIGNMENT = gql`
  mutation DeleteMasteryAssignment($assignmentId: String!) {
    deleteMasteryAssignment(assignmentId: $assignmentId)
  }
`;

export type MasteryAssignmentLayout = {
  totalMarks: number;
  minutes: number;
  partAOn: boolean;
  partAMarks: number;
  partALoCodes: string[];
  partBMarks: number;
  mixWeak: number;
  mixImproving: number;
  mixRevision: number;
  questionTypeCodes: string[];
};

export type MasteryAssignmentQuestionRow = {
  origin: string;
  artifactId: string | null;
  qid: string | null;
  textBn: string | null;
  loCode: string;
  labelBn: string;
  chapterNumber: number | null;
  questionTypeCode: string;
  marks: number;
  band: string;
};

export type MasteryAssignmentWarningRow = { code: string; loCode: string | null; labelBn: string | null };

export type MasteryAssignmentData = {
  id: string;
  sectionId: string;
  subject: string;
  classToken: string;
  dueDate: string;
  week: string;
  rememberLayout: boolean;
  status: string;
  paperId: string | null;
  asItemId: string | null;
  layout: MasteryAssignmentLayout;
  partA: MasteryAssignmentQuestionRow[];
  sheets: {
    studentId: string;
    name: string;
    rollNumber: string | null;
    status: string;
    marks: number;
    items: { loCode: string; labelBn: string; band: string }[];
    warnings: MasteryAssignmentWarningRow[];
  }[];
};

export type MasteryAssignmentSheetData = {
  assignmentId: string;
  assignmentStatus: string;
  studentId: string;
  name: string;
  rollNumber: string | null;
  status: string;
  marks: number;
  targetMarks: number;
  items: MasteryAssignmentQuestionRow[];
  warnings: MasteryAssignmentWarningRow[];
  outcomeChoices: { loCode: string; labelBn: string; questionTypeCodes: string[] }[];
};

// ---------------------------------------------------------------------------
// M-4b — the guardian's view of the weekly assignment (mock G3, D-#783 / #810)
// ---------------------------------------------------------------------------

export const CHILD_MASTERY_ASSIGNMENTS = gql`
  query ChildMasteryAssignments($studentId: String!, $limit: Int) {
    childMasteryAssignments(studentId: $studentId, limit: $limit) {
      id
      subject
      dueDate
      minutes
      totalMarks
      partA {
        n
        textBn
        marks
      }
      partB {
        n
        textBn
        marks
      }
      result {
        earned
        available
        note
        notMarked
        rows {
          labelBn
          earned
          available
          again
        }
      }
    }
  }
`;

export type ChildMasteryQuestion = { n: number; textBn: string; marks: number };
export type ChildMasteryAssignment = {
  id: string;
  subject: string;
  dueDate: string;
  minutes: number;
  totalMarks: number;
  partA: ChildMasteryQuestion[];
  partB: ChildMasteryQuestion[];
  result: {
    earned: number;
    available: number;
    note: string | null;
    notMarked: boolean;
    rows: { labelBn: string; earned: number; available: number; again: boolean }[];
  } | null;
};

// ---------------------------------------------------------------------------
// M-5 — actions: trigger → extra class → re-test → close (docs/prd-mastery.md §5.5)
// ---------------------------------------------------------------------------

const NUMBERS = `
  weakPct
  meanPct
`;

const ACTION_FIELDS = `
  id
  sectionId
  sectionName
  className
  subject
  loCode
  labelBn
  kind
  status
  retestPaperId
  retestConfirmed
  suggestedOutcome
  outcome
  canApprove
  canWork
  lessonGap {
    taught
    weakCount
    missedNames
  }
  trigger {
    at
    weakPct
    weak
    verdicts
    assessments
  }
  plan {
    date
    slotKind
    periodNumber
    teacherName
    attendees
    retestDate
    note
  }
  students {
    studentId
    name
    rollNumber
    stateNow
    weakAtTrigger
    inPlan
    present
    recentPct
    retestPct
  }
  before { ${NUMBERS} }
  after { ${NUMBERS} }
  now { ${NUMBERS} }
  events {
    at
    kind
    byName
    note
  }
`;

export const MASTERY_ACTION_QUERY = gql`
  query MasteryAction($actionId: String!) {
    masteryAction(actionId: $actionId) { ${ACTION_FIELDS} }
  }
`;

export const MASTERY_ACTIONS_PAGE_QUERY = gql`
  query MasteryActionsPage($filter: String!, $sectionId: String, $subject: String, $page: Int, $pageSize: Int) {
    masteryActionsPage(filter: $filter, sectionId: $sectionId, subject: $subject, page: $page, pageSize: $pageSize) {
      total
      page
      pageSize
      rows {
        id
        sectionId
        sectionName
        className
        subject
        loCode
        labelBn
        kind
        status
        weakPct
        weak
        verdicts
        assessments
        planDate
        retestDate
        outcome
        createdAt
      }
    }
  }
`;

export const MASTERY_ACTION_COUNTS_QUERY = gql`
  query MasteryActionCounts {
    masteryActionCounts {
      proposed
      running
      retestThisWeek
      closed30
    }
  }
`;

export const DECIDE_MASTERY_ACTION = gql`
  mutation DecideMasteryAction(
    $actionId: String!
    $decision: String!
    $date: String
    $slotKind: String
    $periodNumber: Int
    $attendees: String
    $retestDate: String
    $note: String
  ) {
    decideMasteryAction(
      actionId: $actionId
      decision: $decision
      date: $date
      slotKind: $slotKind
      periodNumber: $periodNumber
      attendees: $attendees
      retestDate: $retestDate
      note: $note
    ) { ${ACTION_FIELDS} }
  }
`;

export const RECORD_MASTERY_EXTRA_CLASS = gql`
  mutation RecordMasteryExtraClass($actionId: String!, $attendance: [MasteryAttendanceInput!]!) {
    recordMasteryExtraClass(actionId: $actionId, attendance: $attendance) { ${ACTION_FIELDS} }
  }
`;

export const BUILD_MASTERY_RETEST = gql`
  mutation BuildMasteryRetest($actionId: String!) {
    buildMasteryRetest(actionId: $actionId) { ${ACTION_FIELDS} }
  }
`;

export const CLOSE_MASTERY_ACTION = gql`
  mutation CloseMasteryAction($actionId: String!, $outcome: String!, $note: String) {
    closeMasteryAction(actionId: $actionId, outcome: $outcome, note: $note) { ${ACTION_FIELDS} }
  }
`;

type Numbers = { weakPct: number | null; meanPct: number | null };

export type MasteryActionData = {
  id: string;
  sectionId: string;
  sectionName: string;
  className: string;
  subject: string;
  loCode: string;
  labelBn: string;
  kind: string;
  status: string;
  retestPaperId: string | null;
  retestConfirmed: boolean;
  suggestedOutcome: string | null;
  outcome: string | null;
  canApprove: boolean;
  canWork: boolean;
  /** LP-3 (D-#825): the weak students who missed a class of this outcome's chapter. */
  lessonGap: { taught: boolean; weakCount: number; missedNames: string[] };
  trigger: { at: string; weakPct: number; weak: number; verdicts: number; assessments: number };
  plan: {
    date: string | null;
    slotKind: string | null;
    periodNumber: number | null;
    teacherName: string | null;
    attendees: string;
    retestDate: string | null;
    note: string | null;
  } | null;
  students: {
    studentId: string;
    name: string;
    rollNumber: string | null;
    stateNow: string;
    weakAtTrigger: boolean;
    inPlan: boolean;
    present: boolean | null;
    recentPct: number | null;
    retestPct: number | null;
  }[];
  before: Numbers | null;
  after: Numbers | null;
  now: Numbers;
  events: { at: string; kind: string; byName: string | null; note: string | null }[];
};

export type MasteryActionRow = {
  id: string;
  sectionId: string;
  sectionName: string;
  className: string;
  subject: string;
  loCode: string;
  labelBn: string;
  kind: string;
  status: string;
  weakPct: number;
  weak: number;
  verdicts: number;
  assessments: number;
  planDate: string | null;
  retestDate: string | null;
  outcome: string | null;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// M-6 — the guardian's progress view (mocks G1 / G2 / G4, D-#783 / #812)
// ---------------------------------------------------------------------------

export const CHILD_MASTERY_PROGRESS = gql`
  query ChildMasteryProgress($studentId: String!) {
    childMasteryProgress(studentId: $studentId) {
      subject
      assignmentsSent
      counts {
        attention
        improving
        good
        unknown
      }
      attention {
        labelBn
        homeTipBn
      }
      improving {
        labelBn
      }
      schoolDid {
        date
        kind
        labelBn
        status
        present
        retestPct
      }
    }
  }
`;

export type ChildMasteryProgressRow = {
  subject: string;
  assignmentsSent: number;
  counts: { attention: number; improving: number; good: number; unknown: number };
  attention: { labelBn: string; homeTipBn: string | null }[];
  improving: { labelBn: string }[];
  schoolDid: { date: string; kind: string; labelBn: string; status: string; present: boolean | null; retestPct: number | null }[];
};
