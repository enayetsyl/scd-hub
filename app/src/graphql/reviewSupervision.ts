/**
 * Review supervision (RS-4, .claude/plans/review-supervision.md) - the Principal's (and, by a
 * per-person grant, the deputy's) daily view of the teacher review program.
 *
 * Reads need `review_program:supervise`; every write needs `review_program:manage` (server-gated).
 */
import { gql } from "urql";

export interface ReviewBatchT {
  batch: number;
  name: string;
  targetDate: string | null;
  startAt: string | null;
}

export interface ReviewProgramT {
  id: string;
  name: string;
  batches: ReviewBatchT[];
  createdAt: string;
}

export interface ReviewTotalsT {
  tasks: number;
  tasksDone: number;
  plansTotal: number;
  plansDone: number;
  questionsTotal: number;
  questionsDone: number;
  changes: number;
  minutesTotal: number;
  minutesDone: number;
  minutesRemaining: number;
}

/** ON_TRACK | BEHIND | FAR_BEHIND | NO_DATA */
export type ReviewStatusT = string;

export interface ReviewerRowT {
  reviewerId: string;
  reviewerName: string | null;
  tasks: number;
  tasksDone: number;
  plansTotal: number;
  plansDone: number;
  questionsTotal: number;
  questionsDone: number;
  changes: number;
  minutesTotal: number;
  minutesDone: number;
  minutesRemaining: number;
  doneToday: number;
  doneThisWeek: number;
  pacePerDay: number | null;
  daysLeft: number | null;
  projectedFinishKey: string | null;
  status: ReviewStatusT;
  requiredPacePerDay: number | null;
  weeklyPeriods: number | null;
}

export interface ReviewBatchProjectionT {
  doneToday: number;
  doneThisWeek: number;
  pacePerDay: number | null;
  daysLeft: number | null;
  projectedFinishKey: string | null;
  status: ReviewStatusT;
  requiredPacePerDay: number | null;
}

export interface ReviewOverviewT {
  batch: number;
  targetDate: string | null;
  totals: ReviewTotalsT;
  reviewers: ReviewerRowT[];
  batchProjection: ReviewBatchProjectionT;
}

export interface ReviewTaskProgressT {
  plansTotal: number;
  plansDone: number;
  questionsTotal: number;
  questionsDone: number;
  changes: number;
  doneByOthers: number;
  minutesTotal: number;
  minutesDone: number;
  minutesRemaining: number;
}

export interface ReviewTaskHistoryT {
  at: string;
  by: string;
  action: string;
  fromReviewer: string | null;
  toReviewer: string | null;
  note: string | null;
}

export interface ReviewTaskT {
  id: string;
  programId: string;
  batch: number;
  reviewerId: string;
  reviewerName: string | null;
  subject: string;
  classLevel: number;
  anchorWord: string;
  chapter: string;
  dueKey: string | null;
  status: string;
  assignedAt: string;
  history: ReviewTaskHistoryT[];
  progress: ReviewTaskProgressT;
}

export interface ReviewPointT {
  dateKey: string;
  reviewerId: string | null;
  reviewerName: string | null;
  plansDone: number;
  chapterPlansDone: number;
  questionsDone: number;
  doneCount: number;
  cumulativeDone: number;
  remaining: number;
  doneWeightMin: number;
  cumulativeDoneWeightMin: number;
  remainingWeightMin: number;
  changes: number;
  estimated: boolean;
}

const PROGRAM_FIELDS = `id name createdAt batches { batch name targetDate startAt }`;

const TASK_FIELDS = `
  id programId batch reviewerId reviewerName subject classLevel anchorWord chapter dueKey status assignedAt
  history { at by action fromReviewer toReviewer note }
  progress { plansTotal plansDone questionsTotal questionsDone changes doneByOthers minutesTotal minutesDone minutesRemaining }
`;

const ROW_FIELDS = `
  reviewerId reviewerName tasks tasksDone plansTotal plansDone questionsTotal questionsDone changes
  minutesTotal minutesDone minutesRemaining doneToday doneThisWeek pacePerDay daysLeft projectedFinishKey
  status requiredPacePerDay weeklyPeriods
`;

export const REVIEW_PROGRAMS_QUERY = gql<{ reviewPrograms: ReviewProgramT[] }, Record<string, never>>`
  query ReviewPrograms {
    reviewPrograms { ${PROGRAM_FIELDS} }
  }
`;

export const REVIEW_OVERVIEW_QUERY = gql<
  { reviewProgramOverview: ReviewOverviewT },
  { programId: string; batch: number }
>`
  query ReviewProgramOverview($programId: String!, $batch: Int!) {
    reviewProgramOverview(programId: $programId, batch: $batch) {
      batch targetDate
      totals { tasks tasksDone plansTotal plansDone questionsTotal questionsDone changes minutesTotal minutesDone minutesRemaining }
      reviewers { ${ROW_FIELDS} }
      batchProjection { doneToday doneThisWeek pacePerDay daysLeft projectedFinishKey status requiredPacePerDay }
    }
  }
`;

export const REVIEW_TASKS_QUERY = gql<
  { reviewTasks: ReviewTaskT[] },
  { programId: string; batch: number; reviewerId?: string | null }
>`
  query ReviewTasks($programId: String!, $batch: Int!, $reviewerId: String) {
    reviewTasks(programId: $programId, batch: $batch, reviewerId: $reviewerId) { ${TASK_FIELDS} }
  }
`;

export const REVIEW_SERIES_QUERY = gql<
  { reviewProgressSeries: ReviewPointT[] },
  { programId: string; batch: number; reviewerId?: string | null; perReviewer?: boolean | null }
>`
  query ReviewProgressSeries($programId: String!, $batch: Int!, $reviewerId: String, $perReviewer: Boolean) {
    reviewProgressSeries(programId: $programId, batch: $batch, reviewerId: $reviewerId, perReviewer: $perReviewer) {
      dateKey reviewerId reviewerName plansDone chapterPlansDone questionsDone doneCount cumulativeDone remaining
      doneWeightMin cumulativeDoneWeightMin remainingWeightMin changes estimated
    }
  }
`;

export const CREATE_REVIEW_PROGRAM = gql<
  { createReviewProgram: ReviewProgramT },
  { name: string; batches: Array<{ batch: number; name?: string | null; targetDate?: string | null; startAt?: string | null }> }
>`
  mutation CreateReviewProgram($name: String!, $batches: [ReviewBatchInput!]) {
    createReviewProgram(name: $name, batches: $batches) { ${PROGRAM_FIELDS} }
  }
`;

export const UPDATE_REVIEW_BATCH = gql<
  { updateReviewBatch: ReviewProgramT },
  { programId: string; batch: number; name?: string | null; targetDate?: string | null; startAt?: string | null }
>`
  mutation UpdateReviewBatch($programId: String!, $batch: Int!, $name: String, $targetDate: String, $startAt: String) {
    updateReviewBatch(programId: $programId, batch: $batch, name: $name, targetDate: $targetDate, startAt: $startAt) { ${PROGRAM_FIELDS} }
  }
`;

export const ADOPT_REVIEW_ROUNDS = gql<
  { adoptOpenReviewRounds: { created: number; alreadyTasks: number; creditedLeftovers: number } },
  { programId: string; batch: number }
>`
  mutation AdoptOpenReviewRounds($programId: String!, $batch: Int!) {
    adoptOpenReviewRounds(programId: $programId, batch: $batch) { created alreadyTasks creditedLeftovers }
  }
`;

export const BACKFILL_REVIEW_SNAPSHOTS = gql<
  { backfillReviewSnapshots: number },
  { programId: string; batch: number }
>`
  mutation BackfillReviewSnapshots($programId: String!, $batch: Int!) {
    backfillReviewSnapshots(programId: $programId, batch: $batch)
  }
`;

export const MOVE_REVIEW_TASK = gql<
  { moveReviewTask: ReviewTaskT },
  { taskId: string; toReviewerId: string; note?: string | null }
>`
  mutation MoveReviewTask($taskId: String!, $toReviewerId: String!, $note: String) {
    moveReviewTask(taskId: $taskId, toReviewerId: $toReviewerId, note: $note) { ${TASK_FIELDS} }
  }
`;

export const CANCEL_REVIEW_TASK = gql<
  { cancelReviewTask: { cancelledPlans: number; cancelledQuestions: number } },
  { taskId: string; note?: string | null }
>`
  mutation CancelReviewTask($taskId: String!, $note: String) {
    cancelReviewTask(taskId: $taskId, note: $note) { cancelledPlans cancelledQuestions }
  }
`;

export const ADD_REVIEW_TASK = gql<
  { addReviewTask: { assignedPlans: number; assignedQuestions: number; skippedPlans: number } },
  {
    programId: string;
    batch: number;
    reviewerId: string;
    subject: string;
    classLevel: number;
    anchorWord: string;
    chapter: string;
  }
>`
  mutation AddReviewTask(
    $programId: String!, $batch: Int!, $reviewerId: String!, $subject: String!,
    $classLevel: Int!, $anchorWord: String!, $chapter: String!
  ) {
    addReviewTask(
      programId: $programId, batch: $batch, reviewerId: $reviewerId, subject: $subject,
      classLevel: $classLevel, anchorWord: $anchorWord, chapter: $chapter
    ) { assignedPlans assignedQuestions skippedPlans }
  }
`;

export const SET_REVIEW_TASK_DUE = gql<
  { setReviewTaskDue: ReviewTaskT },
  { taskId: string; dueKey?: string | null }
>`
  mutation SetReviewTaskDue($taskId: String!, $dueKey: String) {
    setReviewTaskDue(taskId: $taskId, dueKey: $dueKey) { ${TASK_FIELDS} }
  }
`;

export interface ReviewChangeRoundT {
  assignmentId: string;
  artifactId: string;
  reviewerId: string;
  reviewerName: string | null;
  submittedAt: string;
  dateKey: string;
  docType: string;
  isQuestion: boolean;
  subject: string;
  classLevel: number;
  anchorWord: string;
  chapter: string;
  sessionIndex: number | null;
  qid: string | null;
  verdict: string;
  feedback: string | null;
}

export const REVIEW_CHANGES_QUERY = gql<
  { reviewChangeRounds: ReviewChangeRoundT[] },
  { programId: string; batch: number; reviewerId?: string | null; fromKey?: string | null; toKey?: string | null }
>`
  query ReviewChangeRounds($programId: String!, $batch: Int!, $reviewerId: String, $fromKey: String, $toKey: String) {
    reviewChangeRounds(programId: $programId, batch: $batch, reviewerId: $reviewerId, fromKey: $fromKey, toKey: $toKey) {
      assignmentId artifactId reviewerId reviewerName submittedAt dateKey docType isQuestion subject classLevel
      anchorWord chapter sessionIndex qid verdict feedback
    }
  }
`;
