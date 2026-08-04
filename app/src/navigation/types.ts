/** React Navigation param lists. One native-stack per tab; tabs gated by role. */
import type { NavigatorScreenParams } from "@react-navigation/native";

/** D-#336: a declared/issued item carried into DeclareHomework's edit mode —
 *  everything the form prefills from (all serializable; no refetch needed). */
export type HwEditItemParam = {
  itemId: string;
  hwId: string;
  subject: string;
  status: string;
  description: string | null;
  topTags: string[];
  timeDecl: number;
  qCount: number;
  poolRef: string | null;
  revItem: boolean;
  attachmentIds: string[];
};

/** Staff landing dashboard (UX-4, D-#265) — registered FIRST so staff land here. */
export type HomeStackParamList = {
  Today: undefined;
};

/** Which panel the Student Profile opens on (SP-3, prd-student-profile §8.1). */
export type StudentProfilePanelKey = "attendance" | "homework" | "assignment" | "classTest" | "comments";

/**
 * Student Profile route params. The screen is registered in EVERY stack that can
 * drill into a child (roster, attendance, homework, assignment, class test), so the
 * params live here once and each ParamList references this type — a second copy would
 * be a second contract.
 */
export type StudentProfileParams = {
  studentId: string;
  /** Shown until the header read lands; the profile re-labels itself from the server. */
  studentName?: string;
  /** Which panel to open (defaults to attendance) — lets an entry point land the
   *  teacher on the plane they were already looking at. */
  initialPanel?: StudentProfilePanelKey;
};

/** Teacher-first Class Notes entry (UX-8, D-#266) — own periods, zero selection. */
export type ClassNotesStackParamList = {
  MyClassNotes: undefined;
};

export type ContentStackParamList = {
  ContentTree: undefined;
  PlanView: { artifactId: string };
};

export type QuestionsStackParamList = {
  /** addToSetId present → "add to this draft set" mode (rows call addQuestionToSet
   *  instead of the basket); absent → normal browse-into-basket. */
  QuestionBank: { addToSetId?: string } | undefined;
  QuestionPreview: { id: string };
  Basket: undefined;
  SectionPicker: undefined;
};

export type SetsStackParamList = {
  SetList: undefined;
  SetDetail: { setId: string };
  AssembleSet: { setId: string; setType: string };
  SectionPicker: undefined;
};

export type TrackersStackParamList = {
  TrackerList: undefined;
  OpenTracker: undefined;
  TrackerEntry: { trackerId: string };
  TrackerSummary: { trackerId: string };
  WaLink: { studentName: string; setTitle: string };
  SectionPicker: undefined;
};

export type ReviewStackParamList = {
  ReviewHome: undefined;
  ReviewSubmit: {
    assignmentId: string;
    artifactId: string;
    /** Prefill when re-opening an already-decided round (R4 resubmit). */
    initialVerdict?: string | null;
    initialFeedback?: string | null;
    roundStatus?: string;
  };
  ReviewThread: { artifactId: string };
  AssignReviews: undefined;
};

export type HomeworkStackParamList = {
  StudentProfile: StudentProfileParams;
  HomeworkHome: undefined;
  /** `date` carries Homework home's calendar pick downstream (UX-5 R-Context). */
  DeclareHomework: { date?: string; editItem?: HwEditItemParam } | undefined;
  HomeworkReconcile: { date?: string } | undefined;
  /** RP-2 (D-#355): the roster-pass workspace replacing Records + Checking. */
  HomeworkWorkspace: undefined;
  HomeworkRollups: undefined;
  SectionPicker: undefined;
};

export type AssignmentStackParamList = {
  StudentProfile: StudentProfileParams;
  AssignmentHome: undefined;
  AssignmentSchedule: undefined;
  /** `weekNumber` is the CONTINUOUS term-anchored index (the server key). `month` +
   *  `weekOfMonth` carry the human label the Assignments home shows ("July · Week 4")
   *  so a detail screen never prints a different week number for the same week — both
   *  are optional so an entry point without the expected-week payload still renders. */
  DeliverAssignment: {
    academicYearId: string;
    entryId: string;
    weekNumber: number;
    month?: number;
    weekOfMonth?: number;
    sectionId: string;
    classId: string;
    classLevel: number;
    subject: string;
    deliveryDate: string;
    dueDate: string;
  };
  /** RP-4 (D-#356): the section's roster-pass workspace (all open items, week×subject). */
  /** Params are OPTIONAL (D-#385): arriving from a week-grid cell pins that
   *  section; arriving from the nav falls back to the shared section selection
   *  and shows the class chips, like the homework workspace. */
  AssignmentWorkspace: { sectionId: string; classId: string } | undefined;
  AssignmentReconcile: {
    academicYearId: string;
    sectionId: string;
    classId: string;
    weekNumber: number;
    month?: number;
    weekOfMonth?: number;
  };
  AssignmentChase: undefined;
  AssignmentRollups: { academicYearId: string };
};

export type RoutineStackParamList = {
  RoutineHome: undefined;
  MyRoutine: undefined;
  RoutineMaster: undefined;
  GroupRoutine: { groupType: string; groupId: string; title: string };
  RoutineEditor: { groupType: string; groupId: string; title: string };
  CoverManage: { groupType: string; groupId: string; title: string };
  DailyNote: { groupType: string; groupId: string; title: string; date?: string };
  ClassNoteReport: { date?: string } | undefined;
  ClassNotesAdmin: undefined;
  BellSchedule: undefined;
  /** D-#50 holiday exceptions — the admin face the mutation never had. */
  Holidays: undefined;
  SectionPicker: undefined;
  /** D-#327: a teacher's own class-load detail (shared screen, self-scoped). */
  TeacherClassLoadDetail: { teacherId: string; teacherName?: string; month?: string };
};

/** Print queue (PQ-3/PQ-4, D-#281) — role-aware: teachers see their own requests,
 *  the Office works the queue. */
export type PrintStackParamList = {
  PrintHome: undefined;
  NewPrintRequest: { setId?: string; contentArtifactId?: string; title?: string } | undefined;
  /** D-#362 — already-printed documents, one row each, with a reprint action. */
  PrintHistory: undefined;
};

export type AttendanceStackParamList = {
  StudentProfile: StudentProfileParams;
  AttendanceHome: undefined;
  /** An attendance UNIT (D-#278): a Quran group (Class 1–5) or a Nursery/KG section.
   *  `amend` (D-#292): Principal/Office write path — any unit, today or a past day. */
  MarkAttendance: { unitType: string; unitId: string; title: string; dateKey: string; amend?: boolean };
  /** D-#292: Principal/Office mark/amend any class for any (past) day. */
  AttendanceAdmin: undefined;
  TeacherAttendanceImport: undefined;
  AttendanceReport: undefined;
  /** D-#318: the teacher's own sections' attendance detail (counts + absentees). */
  SectionAttendance: undefined;
  AssignMarker: undefined;
  SectionPicker: undefined;
};

/** Guardian portal (GP-2) — the Home tab carries a class-notes history sub-screen. */
export type GuardianHomeStackParamList = {
  GuardianHome: undefined;
  ChildClassNotes: undefined;
  ChildAttendance: undefined;
  ChildFees: undefined;
  ChildLeave: undefined;
};
export type GuardianHomeworkStackParamList = {
  ChildHomework: undefined;
};
export type GuardianRoutineStackParamList = {
  ChildRoutine: undefined;
};
export type GuardianAssignmentsStackParamList = {
  ChildAssignments: undefined;
};

/** Library (LB-4, D-#81–#84). */
export type LibraryStackParamList = {
  LibraryHome: undefined;
  TitleDetail: { titleId: string };
  LibraryDesk: undefined;
  CatalogManage: undefined;
  LibraryAdmin: undefined;
};

/** Messaging (M-5; M-6/M-7 app pass, prd-messaging §5/§6). */
export type ChatStackParamList = {
  ChatHome: undefined;
  ChatThread: { conversationId: string; title: string };
  NewChat: undefined;
  GroupManage: { conversationId?: string };
  // M-6 app pass: Principal oversight browser + read-only thread; notice composer.
  ChatOversight: undefined;
  ChatOversightThread: { conversationId: string; title: string };
  GuardianNotice: undefined;
};

/** HR / staff module (PR-1: leave + self-service; later PRs add payroll /
 *  performance / offboarding screens to this same stack). */
export type HrStackParamList = {
  HrHome: undefined;
  MyLeave: undefined;
  MyRecord: undefined;
  LeaveCover: { leaveApplicationId: string; title: string; manage: boolean };
  LeaveAdmin: undefined;
  /** Cross-leave needs-cover inbox (PXG-2, D-#268). */
  NeedsCoverInbox: undefined;
  // PR-2: payroll
  PayrollHome: undefined;
  PreparePayroll: undefined;
  PayrollRunDetail: { runId: string; monthKey: string; status: string };
  PaymentExport: { runId: string; monthKey: string };
  StaffPay: undefined;
  Advances: undefined;
  // PR-3: performance / conduct / development
  PerformanceHome: undefined;
  StaffPerformance: { staffProfileId: string; name: string };
  StaffObservations: { staffProfileId: string; name: string };
  StaffAppraisals: { staffProfileId: string; name: string };
  StaffConduct: { staffProfileId: string; name: string };
  StaffCpd: { staffProfileId: string; name: string };
  GrievanceInbox: undefined;
  // PR-4: offboarding
  OffboardingHome: undefined;
  OffboardingCase: { caseId: string; name: string };
};

/** Vocabulary tracker (VC-5) — staff stack (tracker:read tab). */
export type VocabStackParamList = {
  VocabHome: undefined;
  VocabWordBank: undefined;
  VocabTests: undefined;
  BuildVocabTest: undefined;
  VocabMarkGrid: { testId: string; title: string };
  VocabReport: { testId: string; title: string };
  VocabStudentReport: { studentId: string; studentName: string; program?: string };
  VocabClassReport: undefined;
  VocabMessages: { testId: string; title: string };
  VocabAssignment: undefined;
};

/** Class Test tracker (CT-5) — staff stack (tracker:read || roster:manage tab). */
export type ClassTestStackParamList = {
  StudentProfile: StudentProfileParams;
  ClassTestHome: undefined;
  RequestClassTest: undefined;
  /** Owner ask 2026-07-20: office-produced question papers — teacher list/form + office queue. */
  MyCtQuestions: undefined;
  CtQuestionRequest: undefined;
  CtQuestionQueue: undefined;
  ClassTestResults: { testId: string; title: string };
  ClassTestResultsView: { testId: string; title: string };
  ClassTestPublish: { testId: string; title: string };
  ClassTestDashboard: undefined;
  ClassTestReports: undefined;
  ClassTestClassSubject: { sectionId: string; classId: string; subject: string; title: string };
  ClassTestStudentProfile: { studentId: string; studentName: string };
  /** Answer-script archive (AR-1..AR-4, D-#443–#447) — physical storage of
   *  class-test scripts. Lives in this stack because its audience is exactly
   *  this tab's (teachers tracker:*, Office roster:manage). */
  ArchiveHome: undefined;
  ArchiveFileBundle: { testId?: string; ctId?: string };
  ArchiveBundle: { bundleId: string };
  ArchiveBox: { boxId: string };
};

/** Student Comments + Parents-Meeting (CM-6) — staff stack
 *  (tracker:read || roster:manage tab). */
export type CommentsStackParamList = {
  CommentsHome: undefined;
  SectionComments: undefined;
  CommentReview: undefined;
  CommentEntry: { sectionId: string; studentId: string; studentName: string; commentId?: string };
  MeetingsList: undefined;
  MeetingAdmin: { meetingId: string; instanceLabel: string };
  MeetingComparison: { meetingId: string; studentId: string; studentName: string };
};

/** Classroom Observation (CO app surfaces over CO-1..CO-7) — staff stack
 *  (observation:read || observation:upload || observation:manage tab). */
export type ObservationStackParamList = {
  ObservationHome: undefined;
  UploadObservation: undefined;
  MyObservations: undefined;
  AllObservations: { state?: string; published?: boolean; withheld?: boolean } | undefined;
  ObservationReviewQueue: undefined;
  /** CO-11 (D-#363) — the observer's own completed reviews. */
  MyReviewHistory: undefined;
  /** CO-14 (D-#426) — build a review rota from a written instruction. */
  ObservationRota: undefined;
  ReviewObservation: { observationId: string; form: string; title: string };
  ObservationDetail: { observationId: string; title?: string };
  CompareObservations: { recordingId: string; title?: string };
  ObservationTrend: undefined;
  ObservationDueList: undefined;
  ReviewerEffectiveness: undefined;
  ObservationConfig: undefined;
};

/** Free Mixing Observation (D-#341) — its own staff tab (owner ruling: separate
 *  from the Classroom Observation hub). One role-routed entry screen. */
export type FreeMixingStackParamList = {
  FreeMixingHome: undefined;
};

/** English Drive (D-#344) — the md-import + class-scoped teacher library:
 *  library home (upload entry inside, P/O only), doc viewer + PDF, upload UI. */
export type EnglishDriveStackParamList = {
  EnglishDriveHome: undefined;
  EnglishDriveDoc: { docId: string; title?: string };
  EnglishDriveUpload: undefined;
};

/** Saturday Qur'an-Hifz Revision (SR app surfaces over SR-1..SR-4) — staff stack
 *  (tracker:read || roster:manage tab; GUARDIAN excluded). */
export type RevisionStackParamList = {
  RevisionHome: undefined;
  GroupRevisionGrid: { groupId: string; code: string; nameBn: string; date: string };
  StudentRevisionHistory: { studentId: string; studentName: string };
  DeliverRevision: { groupId: string; code: string; nameBn: string; date: string };
  RevisionDashboard: { groupId?: string; code?: string; nameBn?: string; date: string };
};

/** Finance / Accounting (FIN-6B app surfaces over FIN-1..FIN-6A) — staff stack
 *  (finance:manage = Principal/Office only). */
export type FinanceStackParamList = {
  FinanceHome: undefined;
  DailyEntry: undefined;
  DailySnapshot: undefined;
  FeesZakat: undefined;
  QardIou: undefined;
  Reconciliation: undefined;
  Budget: undefined;
  FinanceDashboard: undefined;
};

export type AdminStackParamList = {
  StudentProfile: StudentProfileParams;
  AdminHome: undefined;
  Import: undefined;
  UserList: undefined;
  ScopeGrant: undefined;
  SupervisoryGrant: undefined;
  Roster: undefined;
  Staff: undefined;
  AssignClassTeacher: undefined;
  AssignSubjectTeacher: undefined;
  GroupMembers: undefined;
  AcademicYear: undefined;
  SectionConfig: undefined;
  GuardianCredentials: undefined;
  StaffCredentials: undefined;
  MessageTemplates: undefined;
  MessageTemplateEdit: { key: string; labelBn: string };
  // Access Control (AC-2): per-user permission editor (access:manage / Principal).
  AccessControlUsers: undefined;
  AccessControlEdit: { userId: string; name: string; role: string };
  // Owner ask 2026-07-20: the Principal's audit-log viewer (audit:read).
  AuditLog: undefined;
  SystemHealth: undefined;
  // D-#290: who didn't submit reconciliation (Principal/Office).
  ReconciliationReport: undefined;
  // D-#300: per subject × class homework lifecycle report (Principal/Office).
  HwLifecycleReport: undefined;
  SectionPicker: undefined;
};

// Support-book production (SB-2..SB-4). Its OWN stack, not four cards in the Admin
// hub: the Admin tab is registered on the role TEMPLATE (content:import / user:manage),
// which a granted illustrator or reviewer does not hold — mounting them there made
// the screens unreachable for exactly the people they were built for (D-#405 hands
// `book:*` out per user; the `myPermissions` / `can()` gate is the fix). Every screen
// here is param-free, so the stack's initial route is safe whichever one is first.
export type SupportBookStackParamList = {
  BookImport: undefined;
  BookPolicy: undefined;
  BookImageQueue: undefined;
  BookReview: undefined;
  BookEscalationInbox: undefined;
  BookAssemble: undefined;
};

// D-#309: the Principal/Office Reports hub — a launcher plus the four
// pending-work reports (each a filtered slice of the reconciliation read).
// The attendance/class-note report screens are ALSO registered here (D-#311)
// so the hub opens them IN-STACK and back returns to the hub, not to the
// host tab's home. Param shapes mirror their home stacks exactly.
export type ReportsStackParamList = {
  ReportsHome: undefined;
  HwDeclarePending: undefined;
  HwIssuePending: undefined;
  AsDeclarePending: undefined;
  AsDeliverPending: undefined;
  AttendanceReport: undefined;
  ClassNoteReport: { date?: string } | undefined;
  /** ClassNoteReport's drill-down target — must exist wherever it is mounted. */
  DailyNote: { groupType: string; groupId: string; title: string; date?: string };
  /** D-#327: teacher class-load oversight + its per-teacher drill-down. */
  TeacherClassLoad: undefined;
  TeacherClassLoadDetail: { teacherId: string; teacherName?: string; month?: string };
  /** D-#329: assignment load (planned vs given, by subject & teacher). */
  AssignmentLoadReport: undefined;
  /** Owner ask 2026-07-20: the two admin-hub reports join the Reports hub
   *  (ALSO registered on the Admin stack — deep links target that copy). */
  ReconciliationReport: undefined;
  HwLifecycleReport: undefined;
  /** D-#340: the Principal/Office class-test report (range + filters + state chips). */
  ClassTestReport: undefined;
  /** MR-5b: the monthly-report release console + one child's revision.
   *  BOTH take params, so neither may be registered FIRST in this stack — a
   *  param-requiring screen in the initial slot crashes the tab on mount. */
  MonthlyReportConsole: { sectionId?: string; periodKey?: string } | undefined;
  MonthlyReportDetail: { reportId: string; studentName?: string };
  /** What still has to be finished before a month's reports are complete. */
  MonthlyPendingWork: { periodKey?: string } | undefined;
};

export type TabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  ContentTab: NavigatorScreenParams<ContentStackParamList>;
  QuestionsTab: NavigatorScreenParams<QuestionsStackParamList>;
  SetsTab: NavigatorScreenParams<SetsStackParamList>;
  TrackersTab: NavigatorScreenParams<TrackersStackParamList>;
  HomeworkTab: NavigatorScreenParams<HomeworkStackParamList>;
  AssignmentTab: NavigatorScreenParams<AssignmentStackParamList>;
  ReviewTab: NavigatorScreenParams<ReviewStackParamList>;
  RoutineTab: NavigatorScreenParams<RoutineStackParamList>;
  AttendanceTab: NavigatorScreenParams<AttendanceStackParamList>;
  /** PQ-4 (D-#281) — the one print queue. */
  PrintTab: NavigatorScreenParams<PrintStackParamList>;
  ClassNotesTab: NavigatorScreenParams<ClassNotesStackParamList>;
  LibraryTab: NavigatorScreenParams<LibraryStackParamList>;
  ChatTab: NavigatorScreenParams<ChatStackParamList>;
  VocabTab: NavigatorScreenParams<VocabStackParamList>;
  ClassTestTab: NavigatorScreenParams<ClassTestStackParamList>;
  CommentsTab: NavigatorScreenParams<CommentsStackParamList>;
  ObservationTab: NavigatorScreenParams<ObservationStackParamList>;
  FreeMixingTab: NavigatorScreenParams<FreeMixingStackParamList>;
  EnglishDriveTab: NavigatorScreenParams<EnglishDriveStackParamList>;
  RevisionTab: NavigatorScreenParams<RevisionStackParamList>;
  FinanceTab: NavigatorScreenParams<FinanceStackParamList>;
  HrTab: NavigatorScreenParams<HrStackParamList>;
  ReportsTab: NavigatorScreenParams<ReportsStackParamList>;
  SupportBookTab: NavigatorScreenParams<SupportBookStackParamList>;
  AdminTab: NavigatorScreenParams<AdminStackParamList>;
  GuardianHomeTab: NavigatorScreenParams<GuardianHomeStackParamList>;
  GuardianHomeworkTab: NavigatorScreenParams<GuardianHomeworkStackParamList>;
  GuardianRoutineTab: NavigatorScreenParams<GuardianRoutineStackParamList>;
  GuardianAssignmentsTab: NavigatorScreenParams<GuardianAssignmentsStackParamList>;
};
