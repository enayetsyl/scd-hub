/** React Navigation param lists. One native-stack per tab; tabs gated by role. */
import type { NavigatorScreenParams } from "@react-navigation/native";

export type ContentStackParamList = {
  ContentTree: undefined;
  PlanView: { artifactId: string };
};

export type QuestionsStackParamList = {
  QuestionBank: undefined;
  QuestionPreview: { id: string };
  Basket: undefined;
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
  ReviewSubmit: { assignmentId: string; artifactId: string };
  ReviewThread: { artifactId: string };
};

export type HomeworkStackParamList = {
  HomeworkHome: undefined;
  DeclareHomework: undefined;
  HomeworkReconcile: undefined;
  CheckingQueue: undefined;
  HomeworkRollups: undefined;
  SectionPicker: undefined;
};

export type AssignmentStackParamList = {
  AssignmentHome: undefined;
  AssignmentSchedule: undefined;
  DeliverAssignment: {
    academicYearId: string;
    entryId: string;
    weekNumber: number;
    sectionId: string;
    classId: string;
    classLevel: number;
    subject: string;
    deliveryDate: string;
    dueDate: string;
  };
  CollectAssignment: { itemId: string; sectionId: string; classId: string; asId: string };
  AssignmentChecking: { itemId: string; sectionId: string; classId: string; asId: string };
  AssignmentChase: undefined;
  AssignmentRollups: { academicYearId: string };
};

export type RoutineStackParamList = {
  RoutineHome: undefined;
  MyRoutine: undefined;
  GroupRoutine: { groupType: string; groupId: string; title: string };
  RoutineEditor: { groupType: string; groupId: string; title: string };
  CoverManage: { groupType: string; groupId: string; title: string };
  DailyNote: { groupType: string; groupId: string; title: string };
  BellSchedule: undefined;
  SectionPicker: undefined;
};

export type AttendanceStackParamList = {
  AttendanceHome: undefined;
  MarkAttendance: { sectionId: string; title: string; dateKey: string };
  TeacherAttendanceImport: undefined;
  AttendanceReport: undefined;
  AssignMarker: undefined;
  SectionPicker: undefined;
};

/** Guardian portal (GP-2) — the Home tab carries a class-notes history sub-screen. */
export type GuardianHomeStackParamList = {
  GuardianHome: undefined;
  ChildClassNotes: undefined;
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
};

export type AdminStackParamList = {
  AdminHome: undefined;
  Import: undefined;
  UserList: undefined;
  ScopeGrant: undefined;
  Roster: undefined;
  Staff: undefined;
  AssignClassTeacher: undefined;
  SectionConfig: undefined;
  GuardianCredentials: undefined;
  StaffCredentials: undefined;
  SectionPicker: undefined;
};

export type TabParamList = {
  ContentTab: NavigatorScreenParams<ContentStackParamList>;
  QuestionsTab: NavigatorScreenParams<QuestionsStackParamList>;
  SetsTab: NavigatorScreenParams<SetsStackParamList>;
  TrackersTab: NavigatorScreenParams<TrackersStackParamList>;
  HomeworkTab: NavigatorScreenParams<HomeworkStackParamList>;
  AssignmentTab: NavigatorScreenParams<AssignmentStackParamList>;
  ReviewTab: NavigatorScreenParams<ReviewStackParamList>;
  RoutineTab: NavigatorScreenParams<RoutineStackParamList>;
  AttendanceTab: NavigatorScreenParams<AttendanceStackParamList>;
  LibraryTab: NavigatorScreenParams<LibraryStackParamList>;
  ChatTab: NavigatorScreenParams<ChatStackParamList>;
  HrTab: NavigatorScreenParams<HrStackParamList>;
  AdminTab: NavigatorScreenParams<AdminStackParamList>;
  GuardianHomeTab: NavigatorScreenParams<GuardianHomeStackParamList>;
  GuardianHomeworkTab: NavigatorScreenParams<GuardianHomeworkStackParamList>;
  GuardianRoutineTab: NavigatorScreenParams<GuardianRoutineStackParamList>;
  GuardianAssignmentsTab: NavigatorScreenParams<GuardianAssignmentsStackParamList>;
};
