/**
 * Typed GraphQL operations for the Classroom Observation tracker (CO app surfaces
 * over the CO-1..CO-7 server resolvers — server/src/modules/classroom-observation/*).
 * Hand-authored to mirror the resolvers exactly; no server change. Kept in its own
 * module to avoid bloating the 4.7k-line operations.ts.
 *
 * CO-6/CO-7 ops use the EXACT shapes from the build contract — those resolvers ride
 * separate open PRs and may not be in this branch's server tree, but GraphQL ops are
 * plain strings and the app build does not validate against the live schema.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

// ---------------------------------------------------------------------------
// Core observation (CO-1) + Quran payload (CO-5) + footage link (CO-2)
// ---------------------------------------------------------------------------

export interface ObsDomainScoreT {
  domain: string;
  level: number;
  note: string;
}
export interface ObsGateScoreT {
  gate: string;
  result: string;
  breachNote: string | null;
}
export interface ObsQuranRatingT {
  criterion: string;
  score: number;
  note: string | null;
}
export interface ObsQuranComplianceT {
  item: string;
  yesNo: boolean;
}
export interface ObsQuranPayloadT {
  ratings: ObsQuranRatingT[];
  compliance: ObsQuranComplianceT[];
  strengths: string;
  improvements: string;
  suggestions: string;
}
export interface ClassroomObservationT {
  id: string;
  form: string;
  routineSlotId: string | null;
  sectionId: string | null;
  subjectGroupId: string | null;
  subject: string;
  teacherId: string;
  classDate: string;
  periodNumber: number | null;
  observerId: string | null;
  state: string;
  createdBy: string;
  assignedAt: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  /** CO-12 (D-#369): a recorded decision NOT to publish. null = no hold. */
  withheldAt: string | null;
  withheldBy: string | null;
  withheldReason: string | null;
  /** CO-15 (D-#428): cancel stamp — a planned review that will not happen. */
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelledReason: string | null;
  domains: ObsDomainScoreT[];
  gates: ObsGateScoreT[];
  oneStrength: string | null;
  growthFocus: string | null;
  prevObservationId: string | null;
  priorFocusProgress: string | null;
  /** CO-10 (D-#363): how the prior focus moved, in the observer's own words. */
  priorFocusNote: string | null;
  quran: ObsQuranPayloadT | null;
  recordingId: string | null;
  hasFairnessRating: boolean;
  fairnessRating: number | null;
  usefulnessRating: number | null;
  teacherResponse: string | null;
  supersededById: string | null;
  createdAt: string;
  updatedAt: string;
}

const QURAN_PAYLOAD_FIELDS = `quran { ratings { criterion score note } compliance { item yesNo } strengths improvements suggestions }`;
const OBSERVATION_FIELDS = `id form routineSlotId sectionId subjectGroupId subject teacherId classDate periodNumber observerId state createdBy assignedAt reviewedAt publishedAt publishedBy withheldAt withheldBy withheldReason cancelledAt cancelledBy cancelledReason domains { domain level note } gates { gate result breachNote } oneStrength growthFocus prevObservationId priorFocusProgress priorFocusNote ${QURAN_PAYLOAD_FIELDS} recordingId hasFairnessRating fairnessRating usefulnessRating teacherResponse supersededById createdAt updatedAt`;

export const CLASSROOM_OBSERVATION_QUERY = gql<
  { classroomObservation: ClassroomObservationT | null },
  { id: string }
>`
  query ClassroomObservation($id: String!) {
    classroomObservation(id: $id) { ${OBSERVATION_FIELDS} }
  }
`;

export const TEACHER_CLASSROOM_OBSERVATIONS_QUERY = gql<
  { teacherClassroomObservations: ClassroomObservationT[] },
  { teacherId: string }
>`
  query TeacherClassroomObservations($teacherId: String!) {
    teacherClassroomObservations(teacherId: $teacherId) { ${OBSERVATION_FIELDS} }
  }
`;

export const MY_OBSERVATION_REVIEW_QUEUE_QUERY = gql<
  { myObservationReviewQueue: ClassroomObservationT[] },
  NoVars
>`
  query MyObservationReviewQueue { myObservationReviewQueue { ${OBSERVATION_FIELDS} } }
`;

export interface ObservationFilterVars {
  teacherId?: string | null;
  observerId?: string | null;
  state?: string | null;
  form?: string | null;
  subject?: string | null;
  /** CO-11 (D-#363): the class/section anchor. */
  sectionId?: string | null;
  /** D-#324: CO-8 publish gate — true=published, false=unpublished, null=either. */
  published?: boolean | null;
  /** D-#369: CO-12 withhold flag — true=withheld, false=no hold, null=either. The real
   *  publish queue is published:false + withheld:false. */
  withheld?: boolean | null;
  /** D-#428: CO-15 cancel flag — true=cancelled, false=live, null=either. The oversight
   *  screen's default view sends false so called-off plans do not clutter it. */
  cancelled?: boolean | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  search?: string | null;
  limit?: number | null;
  offset?: number | null;
}
/** The observer's own history takes the SAME filters minus `observerId` — the server
 *  forces that to the caller (CO-11), so the app never sends it. */
export type MyReviewFilterVars = Omit<ObservationFilterVars, "observerId">;

export interface ClassroomObservationPageT {
  items: ClassroomObservationT[];
  total: number;
  hasMore: boolean;
}

export const ALL_CLASSROOM_OBSERVATIONS_QUERY = gql<
  { allClassroomObservations: ClassroomObservationPageT },
  ObservationFilterVars
>`
  query AllClassroomObservations(
    $teacherId: String, $observerId: String, $state: String, $form: String,
    $subject: String, $sectionId: String, $published: Boolean, $withheld: Boolean, $cancelled: Boolean,
    $dateFrom: String, $dateTo: String, $search: String, $limit: Int, $offset: Int
  ) {
    allClassroomObservations(
      teacherId: $teacherId, observerId: $observerId, state: $state, form: $form,
      subject: $subject, sectionId: $sectionId, published: $published, withheld: $withheld, cancelled: $cancelled,
      dateFrom: $dateFrom, dateTo: $dateTo, search: $search, limit: $limit, offset: $offset
    ) {
      items { ${OBSERVATION_FIELDS} }
      total
      hasMore
    }
  }
`;

/** CO-11 (D-#363) — the signed-in observer's OWN review history (every row they were
 *  assigned, not just the open ones). No `observerId` variable by design. */
export const MY_OBSERVATION_REVIEWS_QUERY = gql<
  { myObservationReviews: ClassroomObservationPageT },
  MyReviewFilterVars
>`
  query MyObservationReviews(
    $teacherId: String, $state: String, $form: String, $subject: String, $sectionId: String,
    $published: Boolean, $withheld: Boolean, $cancelled: Boolean, $dateFrom: String, $dateTo: String, $search: String,
    $limit: Int, $offset: Int
  ) {
    myObservationReviews(
      teacherId: $teacherId, state: $state, form: $form, subject: $subject, sectionId: $sectionId,
      published: $published, withheld: $withheld, cancelled: $cancelled, dateFrom: $dateFrom, dateTo: $dateTo, search: $search,
      limit: $limit, offset: $offset
    ) {
      items { ${OBSERVATION_FIELDS} }
      total
      hasMore
    }
  }
`;

/** CO-10 (D-#363) — the narrow prior-focus slice the review form carries forward.
 *  Deliberately carries no scores, no teacher response and no observer identity. */
export interface ObservationPriorFocusContextT {
  observationId: string;
  classDate: string;
  subject: string;
  form: string;
  growthFocus: string | null;
  oneStrength: string | null;
  priorFocusProgress: string | null;
  sameSubject: boolean;
  isReReview: boolean;
}

export const OBSERVATION_PRIOR_FOCUS_CONTEXT_QUERY = gql<
  { observationPriorFocusContext: ObservationPriorFocusContextT | null },
  { observationId: string }
>`
  query ObservationPriorFocusContext($observationId: String!) {
    observationPriorFocusContext(observationId: $observationId) {
      observationId classDate subject form growthFocus oneStrength priorFocusProgress
      sameSubject isReReview
    }
  }
`;

export const UPLOAD_CLASSROOM_OBSERVATION = gql<
  { uploadClassroomObservation: ClassroomObservationT },
  {
    form: string;
    subject: string;
    teacherId: string;
    classDate: string;
    sectionId?: string | null;
    subjectGroupId?: string | null;
    routineSlotId?: string | null;
    periodNumber?: number | null;
    recordingId?: string | null;
    observerId?: string | null;
  }
>`
  mutation UploadClassroomObservation(
    $form: String!, $subject: String!, $teacherId: String!, $classDate: String!,
    $sectionId: String, $subjectGroupId: String, $routineSlotId: String,
    $periodNumber: Int, $recordingId: String, $observerId: String
  ) {
    uploadClassroomObservation(
      form: $form, subject: $subject, teacherId: $teacherId, classDate: $classDate,
      sectionId: $sectionId, subjectGroupId: $subjectGroupId, routineSlotId: $routineSlotId,
      periodNumber: $periodNumber, recordingId: $recordingId, observerId: $observerId
    ) { ${OBSERVATION_FIELDS} }
  }
`;

export const ASSIGN_CLASSROOM_OBSERVER = gql<
  { assignClassroomObserver: ClassroomObservationT },
  { observationId: string; observerId: string }
>`
  mutation AssignClassroomObserver($observationId: String!, $observerId: String!) {
    assignClassroomObserver(observationId: $observationId, observerId: $observerId) { ${OBSERVATION_FIELDS} }
  }
`;

export interface Ref11DomainInput {
  domain: string;
  level: number;
  note: string;
}
export interface Ref11GateInput {
  gate: string;
  result: string;
  breachNote?: string | null;
}
export interface QuranReviewInput {
  ratings: { criterion: string; score: number; note?: string | null }[];
  compliance: { item: string; yesNo: boolean }[];
  strengths: string;
  improvements: string;
  suggestions: string;
}

export const REVIEW_CLASSROOM_OBSERVATION = gql<
  { reviewClassroomObservation: ClassroomObservationT },
  {
    observationId: string;
    domains?: Ref11DomainInput[] | null;
    gates?: Ref11GateInput[] | null;
    oneStrength?: string | null;
    growthFocus?: string | null;
    priorFocusProgress?: string | null;
    priorFocusNote?: string | null;
    quran?: QuranReviewInput | null;
  }
>`
  mutation ReviewClassroomObservation(
    $observationId: String!, $domains: [Ref11DomainInput!], $gates: [Ref11GateInput!],
    $oneStrength: String, $growthFocus: String, $priorFocusProgress: String,
    $priorFocusNote: String, $quran: QuranReviewInput
  ) {
    reviewClassroomObservation(
      observationId: $observationId, domains: $domains, gates: $gates,
      oneStrength: $oneStrength, growthFocus: $growthFocus, priorFocusProgress: $priorFocusProgress,
      priorFocusNote: $priorFocusNote, quran: $quran
    ) { ${OBSERVATION_FIELDS} }
  }
`;

export const PUBLISH_CLASSROOM_OBSERVATION = gql<
  { publishClassroomObservation: ClassroomObservationT },
  { observationId: string }
>`
  mutation PublishClassroomObservation($observationId: String!) {
    publishClassroomObservation(observationId: $observationId) { ${OBSERVATION_FIELDS} }
  }
`;

/** CO-12 (D-#369) — record a decision NOT to publish this review. The reason is required. */
export const WITHHOLD_CLASSROOM_OBSERVATION = gql<
  { withholdClassroomObservation: ClassroomObservationT },
  { observationId: string; reason: string }
>`
  mutation WithholdClassroomObservation($observationId: String!, $reason: String!) {
    withholdClassroomObservation(observationId: $observationId, reason: $reason) { ${OBSERVATION_FIELDS} }
  }
`;

/** CO-12 (D-#369) — lift the hold; the row returns to the awaiting-publish queue. */
export const RELEASE_CLASSROOM_OBSERVATION_HOLD = gql<
  { releaseClassroomObservationHold: ClassroomObservationT },
  { observationId: string }
>`
  mutation ReleaseClassroomObservationHold($observationId: String!) {
    releaseClassroomObservationHold(observationId: $observationId) { ${OBSERVATION_FIELDS} }
  }
`;

/** CO-15 (D-#428) — call off a planned (UPLOADED/ASSIGNED) review. Reason required.
 *  A REVIEWED row is refused by the server: use WITHHOLD_CLASSROOM_OBSERVATION. */
export const CANCEL_CLASSROOM_OBSERVATION = gql<
  { cancelClassroomObservation: ClassroomObservationT },
  { observationId: string; reason: string }
>`
  mutation CancelClassroomObservation($observationId: String!, $reason: String!) {
    cancelClassroomObservation(observationId: $observationId, reason: $reason) { ${OBSERVATION_FIELDS} }
  }
`;

/** CO-15 (D-#428) — undo a cancel; the row returns to the same state + observer. */
export const RESTORE_CANCELLED_CLASSROOM_OBSERVATION = gql<
  { restoreCancelledClassroomObservation: ClassroomObservationT },
  { observationId: string }
>`
  mutation RestoreCancelledClassroomObservation($observationId: String!) {
    restoreCancelledClassroomObservation(observationId: $observationId) { ${OBSERVATION_FIELDS} }
  }
`;

export const RE_REQUEST_CLASSROOM_OBSERVATION = gql<
  { reRequestClassroomObservation: ClassroomObservationT },
  { priorObservationId: string; observerId: string }
>`
  mutation ReRequestClassroomObservation($priorObservationId: String!, $observerId: String!) {
    reRequestClassroomObservation(priorObservationId: $priorObservationId, observerId: $observerId) { ${OBSERVATION_FIELDS} }
  }
`;

export const REQUEST_CO_REVIEW_OBSERVATION = gql<
  { requestCoReviewObservation: ClassroomObservationT },
  { sourceObservationId: string; observerId: string }
>`
  mutation RequestCoReviewObservation($sourceObservationId: String!, $observerId: String!) {
    requestCoReviewObservation(sourceObservationId: $sourceObservationId, observerId: $observerId) { ${OBSERVATION_FIELDS} }
  }
`;

export const OBSERVATIONS_FOR_RECORDING_QUERY = gql<
  { classroomObservationsForRecording: ClassroomObservationT[] },
  { recordingId: string }
>`
  query ClassroomObservationsForRecording($recordingId: String!) {
    classroomObservationsForRecording(recordingId: $recordingId) { ${OBSERVATION_FIELDS} }
  }
`;

export const RESPOND_TO_CLASSROOM_OBSERVATION = gql<
  { respondToClassroomObservation: ClassroomObservationT },
  { observationId: string; responseText: string }
>`
  mutation RespondToClassroomObservation($observationId: String!, $responseText: String!) {
    respondToClassroomObservation(observationId: $observationId, responseText: $responseText) { ${OBSERVATION_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// Session footage (CO-2)
// ---------------------------------------------------------------------------

export interface SessionRecordingT {
  id: string;
  observationId: string | null;
  routineSlotId: string | null;
  sectionId: string | null;
  subjectGroupId: string | null;
  subject: string;
  teacherId: string;
  classDate: string;
  periodNumber: number | null;
  youtubeVideoId: string;
  privacyStatus: string;
  uploadedBy: string;
  createdAt: string;
}

const RECORDING_FIELDS = `id observationId routineSlotId sectionId subjectGroupId subject teacherId classDate periodNumber youtubeVideoId privacyStatus uploadedBy createdAt`;

export const OBSERVATION_RECORDING_QUERY = gql<
  { observationRecording: SessionRecordingT | null },
  { observationId: string }
>`
  query ObservationRecording($observationId: String!) {
    observationRecording(observationId: $observationId) { ${RECORDING_FIELDS} }
  }
`;

export const RECORD_SESSION_FOOTAGE = gql<
  { recordSessionFootage: SessionRecordingT },
  { observationId: string; youtubeVideoId: string }
>`
  mutation RecordSessionFootage($observationId: String!, $youtubeVideoId: String!) {
    recordSessionFootage(observationId: $observationId, youtubeVideoId: $youtubeVideoId) { ${RECORDING_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// Escalation cadence config (CO-3)
// ---------------------------------------------------------------------------

export interface ObservationEscalationConfigT {
  reminderDays1: number;
  reminderDays2: number;
  principalFlagDays: number;
  isDefault: boolean;
}

const ESCALATION_FIELDS = `reminderDays1 reminderDays2 principalFlagDays isDefault`;

export const OBSERVATION_ESCALATION_CONFIG_QUERY = gql<
  { observationEscalationConfig: ObservationEscalationConfigT },
  NoVars
>`
  query ObservationEscalationConfig { observationEscalationConfig { ${ESCALATION_FIELDS} } }
`;

export const SET_OBSERVATION_ESCALATION_CONFIG = gql<
  { setObservationEscalationConfig: ObservationEscalationConfigT },
  { reminderDays1: number; reminderDays2: number; principalFlagDays: number }
>`
  mutation SetObservationEscalationConfig($reminderDays1: Int!, $reminderDays2: Int!, $principalFlagDays: Int!) {
    setObservationEscalationConfig(
      reminderDays1: $reminderDays1, reminderDays2: $reminderDays2, principalFlagDays: $principalFlagDays
    ) { ${ESCALATION_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// Per-domain trend + school weakest-domain signal (CO-4)
// ---------------------------------------------------------------------------

export interface ObsDomainTrendPointT {
  classDate: string;
  level: number;
  observationId: string;
}
export interface ObsDomainTrendRowT {
  domain: string;
  series: ObsDomainTrendPointT[];
  latestLevel: number | null;
  previousLevel: number | null;
  trend: string;
}
export interface TeacherObservationTrendT {
  teacherId: string;
  observationCount: number;
  firstClassDate: string | null;
  lastClassDate: string | null;
  domains: ObsDomainTrendRowT[];
}

export const TEACHER_OBSERVATION_TREND_QUERY = gql<
  { teacherObservationTrend: TeacherObservationTrendT },
  { teacherId: string }
>`
  query TeacherObservationTrend($teacherId: String!) {
    teacherObservationTrend(teacherId: $teacherId) {
      teacherId observationCount firstClassDate lastClassDate
      domains { domain latestLevel previousLevel trend series { classDate level observationId } }
    }
  }
`;

export interface ObsDomainSignalT {
  domain: string;
  meanLevel: number | null;
  sampleCount: number;
}
export interface SchoolObservationPatternsT {
  observationCount: number;
  domains: ObsDomainSignalT[];
  weakestDomains: string[];
}

export const SCHOOL_OBSERVATION_PATTERNS_QUERY = gql<
  { schoolObservationPatterns: SchoolObservationPatternsT },
  NoVars
>`
  query SchoolObservationPatterns {
    schoolObservationPatterns {
      observationCount weakestDomains
      domains { domain meanLevel sampleCount }
    }
  }
`;

// ---------------------------------------------------------------------------
// Review scheduler / due-list (CO-6) — EXACT build-contract shapes
// ---------------------------------------------------------------------------

export interface ObservationScheduleConfigT {
  baseIntervalDays: number;
  strongMultiplier: number;
  needsSupportMultiplier: number;
  minIntervalDays: number;
  isDefault: boolean;
}
export interface ObservationDueItemT {
  teacherId: string;
  tier: string;
  lastReviewedAt: string | null;
  lastObservationId: string | null;
  intervalDays: number;
  dueDate: string;
  overdueDays: number;
  neverReviewed: boolean;
}
export interface ObservationDueListT {
  now: string;
  config: ObservationScheduleConfigT;
  candidateCount: number;
  items: ObservationDueItemT[];
}

const SCHEDULE_CONFIG_FIELDS = `baseIntervalDays strongMultiplier needsSupportMultiplier minIntervalDays isDefault`;

export const OBSERVATION_DUE_LIST_QUERY = gql<{ observationDueList: ObservationDueListT }, NoVars>`
  query ObservationDueList {
    observationDueList {
      now candidateCount
      config { ${SCHEDULE_CONFIG_FIELDS} }
      items { teacherId tier lastReviewedAt lastObservationId intervalDays dueDate overdueDays neverReviewed }
    }
  }
`;

export const OBSERVATION_SCHEDULE_CONFIG_QUERY = gql<
  { observationScheduleConfig: ObservationScheduleConfigT },
  NoVars
>`
  query ObservationScheduleConfig { observationScheduleConfig { ${SCHEDULE_CONFIG_FIELDS} } }
`;

export const SET_OBSERVATION_SCHEDULE_CONFIG = gql<
  { setObservationScheduleConfig: ObservationScheduleConfigT },
  { baseIntervalDays: number; strongMultiplier: number; needsSupportMultiplier: number; minIntervalDays: number }
>`
  mutation SetObservationScheduleConfig(
    $baseIntervalDays: Int!, $strongMultiplier: Float!, $needsSupportMultiplier: Float!, $minIntervalDays: Int!
  ) {
    setObservationScheduleConfig(
      baseIntervalDays: $baseIntervalDays, strongMultiplier: $strongMultiplier,
      needsSupportMultiplier: $needsSupportMultiplier, minIntervalDays: $minIntervalDays
    ) { ${SCHEDULE_CONFIG_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// Reviewer effectiveness (CO-7) — EXACT build-contract shapes
// ---------------------------------------------------------------------------

export interface ReviewerEffectivenessRowT {
  observerId: string;
  observerName: string;
  reviewsCompleted: number;
  avgTurnaroundDays: number | null;
  backlog: number;
  calibrationAgreement: number | null;
  calibrationPairs: number;
  impactAvgDomainsImproved: number | null;
  impactReReviews: number;
  avgFairness: number | null;
  avgUsefulness: number | null;
  ratingsReceived: number;
}
export interface ReviewerEffectivenessT {
  now: string;
  observers: ReviewerEffectivenessRowT[];
}

export const REVIEWER_EFFECTIVENESS_QUERY = gql<
  { reviewerEffectiveness: ReviewerEffectivenessT },
  NoVars
>`
  query ReviewerEffectiveness {
    reviewerEffectiveness {
      now
      observers {
        observerId observerName reviewsCompleted avgTurnaroundDays backlog
        calibrationAgreement calibrationPairs impactAvgDomainsImproved impactReReviews
        avgFairness avgUsefulness ratingsReceived
      }
    }
  }
`;

export interface RateObservationReviewT {
  observationId: string;
  observerId: string;
  fairnessRating: number;
  usefulnessRating: number | null;
  fairnessRatedAt: string;
}

export const RATE_OBSERVATION_REVIEW = gql<
  { rateObservationReview: RateObservationReviewT },
  { observationId: string; fairnessRating: number; usefulnessRating?: number | null }
>`
  mutation RateObservationReview($observationId: String!, $fairnessRating: Int!, $usefulnessRating: Int) {
    rateObservationReview(observationId: $observationId, fairnessRating: $fairnessRating, usefulnessRating: $usefulnessRating) {
      observationId observerId fairnessRating usefulnessRating fairnessRatedAt
    }
  }
`;

// ---------------------------------------------------------------------------
// CO-14 — review rota from a written instruction (D-#426)
// ---------------------------------------------------------------------------

export interface RotaEchoT {
  intensive: Array<{ teacherName: string; everyNDays: number; rotateClasses: boolean }>;
  excluded: Array<{ teacherName: string; reason: string | null }>;
  caps: Array<{ teacherName: string; max: number; window: string | null }>;
  classLevels: number[];
  perDay: number;
}

export interface RotaDraftRowT {
  date: string;
  candidateId: string;
  reason: string | null;
  dayOfWeek: string;
  teacherId: string;
  teacherName: string;
  groupLabel: string;
  classLevel: number | null;
  subject: string;
  periodNumber: number;
  startHHMM: string;
  endHHMM: string;
}

export interface RotaDraftT {
  periodFrom: string;
  periodTo: string;
  instruction: string;
  constraintEcho: RotaEchoT;
  rows: RotaDraftRowT[];
  model: string;
  promptVersion: string;
}

export interface StoredRotaRowT extends Omit<RotaDraftRowT, "dayOfWeek" | "classLevel"> {
  slotChanged: boolean;
}

export interface StoredRotaT {
  id: string;
  periodFrom: string;
  periodTo: string;
  instruction: string;
  constraintEcho: RotaEchoT;
  rows: StoredRotaRowT[];
  model: string;
  promptVersion: string;
  createdAt: string;
}

const ROTA_ECHO_FIELDS = `constraintEcho {
  intensive { teacherName everyNDays rotateClasses }
  excluded { teacherName reason }
  caps { teacherName max window }
  classLevels perDay
}`;

/** CO-14 — instruction in, validated rota out. Writes nothing; the server refuses with
 *  named violations rather than returning an unvalidated table. */
export const GENERATE_OBSERVATION_ROTA = gql<
  { generateObservationRota: RotaDraftT },
  { periodFrom: string; periodTo: string; instruction: string }
>`
  mutation GenerateObservationRota($periodFrom: String!, $periodTo: String!, $instruction: String!) {
    generateObservationRota(periodFrom: $periodFrom, periodTo: $periodTo, instruction: $instruction) {
      periodFrom periodTo instruction model promptVersion
      ${ROTA_ECHO_FIELDS}
      rows {
        date candidateId reason dayOfWeek teacherId teacherName
        groupLabel classLevel subject periodNumber startHHMM endHHMM
      }
    }
  }
`;

/** CO-14 — store the accepted rota with its instruction. Creates NO assignments. */
export const SAVE_OBSERVATION_ROTA = gql<
  { saveObservationRota: StoredRotaT },
  { periodFrom: string; periodTo: string; instruction: string }
>`
  mutation SaveObservationRota($periodFrom: String!, $periodTo: String!, $instruction: String!) {
    saveObservationRota(periodFrom: $periodFrom, periodTo: $periodTo, instruction: $instruction) {
      id periodFrom periodTo instruction model promptVersion createdAt
      ${ROTA_ECHO_FIELDS}
      rows {
        date candidateId reason teacherId teacherName
        groupLabel subject periodNumber startHHMM endHHMM slotChanged
      }
    }
  }
`;

export const OBSERVATION_ROTAS_QUERY = gql<{ observationRotas: StoredRotaT[] }, { limit?: number }>`
  query ObservationRotas($limit: Int) {
    observationRotas(limit: $limit) {
      id periodFrom periodTo instruction model promptVersion createdAt
      ${ROTA_ECHO_FIELDS}
      rows {
        date candidateId reason teacherId teacherName
        groupLabel subject periodNumber startHHMM endHHMM slotChanged
      }
    }
  }
`;
