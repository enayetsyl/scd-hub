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

export type RoutineStackParamList = {
  RoutineHome: undefined;
  MyRoutine: undefined;
  GroupRoutine: { groupType: string; groupId: string; title: string };
  RoutineEditor: { groupType: string; groupId: string; title: string };
  CoverManage: { groupType: string; groupId: string; title: string };
  SectionPicker: undefined;
};

export type AdminStackParamList = {
  AdminHome: undefined;
  Import: undefined;
  UserList: undefined;
  ScopeGrant: undefined;
  Roster: undefined;
  Staff: undefined;
  AssignClassTeacher: undefined;
  SectionPicker: undefined;
};

export type TabParamList = {
  ContentTab: NavigatorScreenParams<ContentStackParamList>;
  QuestionsTab: NavigatorScreenParams<QuestionsStackParamList>;
  SetsTab: NavigatorScreenParams<SetsStackParamList>;
  TrackersTab: NavigatorScreenParams<TrackersStackParamList>;
  HomeworkTab: NavigatorScreenParams<HomeworkStackParamList>;
  ReviewTab: NavigatorScreenParams<ReviewStackParamList>;
  RoutineTab: NavigatorScreenParams<RoutineStackParamList>;
  AdminTab: NavigatorScreenParams<AdminStackParamList>;
};
