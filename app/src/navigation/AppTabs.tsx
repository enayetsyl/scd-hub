/**
 * Authenticated navigation — one native-stack per bottom tab; tabs render only
 * where the role holds the gating permission (PRD §8 RBAC rules):
 *   Content   content:read     (Principal, Teacher)
 *   Questions question:read     (Principal, Teacher)
 *   Sets      set:read          (Principal, Teacher)
 *   Trackers  tracker:read      (Principal, Teacher)
 *   Admin     content:import | user:manage  (Principal, Office)
 */
import React from "react";
import { Text, Pressable, View, Platform } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { roleHasPermission } from "@scd/shared";

import type {
  ContentStackParamList,
  QuestionsStackParamList,
  SetsStackParamList,
  TrackersStackParamList,
  HomeworkStackParamList,
  AssignmentStackParamList,
  ReviewStackParamList,
  RoutineStackParamList,
  AttendanceStackParamList,
  LibraryStackParamList,
  ChatStackParamList,
  VocabStackParamList,
  ClassTestStackParamList,
  CommentsStackParamList,
  ObservationStackParamList,
  RevisionStackParamList,
  FinanceStackParamList,
  HrStackParamList,
  AdminStackParamList,
  GuardianHomeStackParamList,
  GuardianHomeworkStackParamList,
  GuardianRoutineStackParamList,
  GuardianAssignmentsStackParamList,
  TabParamList,
} from "./types";

import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../auth/AuthContext";
import { useBasket } from "../state/BasketContext";
import { useLanguage } from "../state/LanguageContext";
import { useNotifications } from "../state/NotificationContext";
import { STR, bnNum } from "../lib/labels";
import { fonts, typeScale, useColors } from "../theme";

import LoginScreen from "../screens/auth/LoginScreen";
import ContentTreeScreen from "../screens/content/ContentTreeScreen";
import PlanViewScreen from "../screens/content/PlanViewScreen";
import QuestionBankScreen from "../screens/questions/QuestionBankScreen";
import QuestionPreviewScreen from "../screens/questions/QuestionPreviewScreen";
import BasketScreen from "../screens/questions/BasketScreen";
import SetListScreen from "../screens/sets/SetListScreen";
import SetDetailScreen from "../screens/sets/SetDetailScreen";
import AssembleSetScreen from "../screens/sets/AssembleSetScreen";
import TrackerListScreen from "../screens/trackers/TrackerListScreen";
import OpenTrackerScreen from "../screens/trackers/OpenTrackerScreen";
import TrackerEntryScreen from "../screens/trackers/TrackerEntryScreen";
import TrackerSummaryScreen from "../screens/trackers/TrackerSummaryScreen";
import WaLinkScreen from "../screens/trackers/WaLinkScreen";
import HomeworkHomeScreen from "../screens/homework/HomeworkHomeScreen";
import DeclareHomeworkScreen from "../screens/homework/DeclareHomeworkScreen";
import HomeworkReconcileScreen from "../screens/homework/HomeworkReconcileScreen";
import CheckingQueueScreen from "../screens/homework/CheckingQueueScreen";
import HomeworkRollupsScreen from "../screens/homework/HomeworkRollupsScreen";
import AssignmentHomeScreen from "../screens/assignment/AssignmentHomeScreen";
import AssignmentScheduleScreen from "../screens/assignment/AssignmentScheduleScreen";
import DeliverAssignmentScreen from "../screens/assignment/DeliverAssignmentScreen";
import CollectAssignmentScreen from "../screens/assignment/CollectAssignmentScreen";
import AssignmentCheckingScreen from "../screens/assignment/AssignmentCheckingScreen";
import AssignmentChaseScreen from "../screens/assignment/AssignmentChaseScreen";
import AssignmentRollupsScreen from "../screens/assignment/AssignmentRollupsScreen";
import ChildAssignmentsScreen from "../screens/guardian/ChildAssignmentsScreen";
import ReviewHomeScreen from "../screens/review/ReviewHomeScreen";
import ReviewSubmitScreen from "../screens/review/ReviewSubmitScreen";
import ReviewThreadScreen from "../screens/review/ReviewThreadScreen";
import RoutineHomeScreen from "../screens/routine/RoutineHomeScreen";
import MyRoutineScreen from "../screens/routine/MyRoutineScreen";
import GroupRoutineScreen from "../screens/routine/GroupRoutineScreen";
import RoutineEditorScreen from "../screens/routine/RoutineEditorScreen";
import CoverManageScreen from "../screens/routine/CoverManageScreen";
import DailyNoteScreen from "../screens/routine/DailyNoteScreen";
import BellScheduleScreen from "../screens/routine/BellScheduleScreen";
import AttendanceHomeScreen from "../screens/attendance/AttendanceHomeScreen";
import MarkAttendanceScreen from "../screens/attendance/MarkAttendanceScreen";
import TeacherAttendanceImportScreen from "../screens/attendance/TeacherAttendanceImportScreen";
import AttendanceReportScreen from "../screens/attendance/AttendanceReportScreen";
import AssignMarkerScreen from "../screens/attendance/AssignMarkerScreen";
import LibraryHomeScreen from "../screens/library/LibraryHomeScreen";
import TitleDetailScreen from "../screens/library/TitleDetailScreen";
import LibraryDeskScreen from "../screens/library/LibraryDeskScreen";
import CatalogManageScreen from "../screens/library/CatalogManageScreen";
import LibraryAdminScreen from "../screens/library/LibraryAdminScreen";
import ChatHomeScreen from "../screens/chat/ChatHomeScreen";
import ChatThreadScreen from "../screens/chat/ChatThreadScreen";
import NewChatScreen from "../screens/chat/NewChatScreen";
import GroupManageScreen from "../screens/chat/GroupManageScreen";
import ChatOversightScreen from "../screens/chat/ChatOversightScreen";
import ChatOversightThreadScreen from "../screens/chat/ChatOversightThreadScreen";
import GuardianNoticeScreen from "../screens/chat/GuardianNoticeScreen";
import VocabHomeScreen from "../screens/vocab/VocabHomeScreen";
import VocabWordBankScreen from "../screens/vocab/VocabWordBankScreen";
import VocabTestsScreen from "../screens/vocab/VocabTestsScreen";
import BuildVocabTestScreen from "../screens/vocab/BuildVocabTestScreen";
import VocabMarkGridScreen from "../screens/vocab/VocabMarkGridScreen";
import VocabReportScreen from "../screens/vocab/VocabReportScreen";
import VocabStudentReportScreen from "../screens/vocab/VocabStudentReportScreen";
import VocabClassReportScreen from "../screens/vocab/VocabClassReportScreen";
import VocabMessagesScreen from "../screens/vocab/VocabMessagesScreen";
import VocabAssignmentScreen from "../screens/vocab/VocabAssignmentScreen";
import ClassTestHomeScreen from "../screens/classtest/ClassTestHomeScreen";
import RequestClassTestScreen from "../screens/classtest/RequestClassTestScreen";
import ClassTestPrintQueueScreen from "../screens/classtest/ClassTestPrintQueueScreen";
import ClassTestResultsScreen from "../screens/classtest/ClassTestResultsScreen";
import ClassTestPublishScreen from "../screens/classtest/ClassTestPublishScreen";
import ClassTestDashboardScreen from "../screens/classtest/ClassTestDashboardScreen";
import ClassTestReportsScreen from "../screens/classtest/ClassTestReportsScreen";
import ClassTestClassSubjectScreen from "../screens/classtest/ClassTestClassSubjectScreen";
import ClassTestStudentProfileScreen from "../screens/classtest/ClassTestStudentProfileScreen";
import CommentsHomeScreen from "../screens/comments/CommentsHomeScreen";
import SectionCommentsScreen from "../screens/comments/SectionCommentsScreen";
import CommentEntryScreen from "../screens/comments/CommentEntryScreen";
import MeetingsListScreen from "../screens/comments/MeetingsListScreen";
import MeetingAdminScreen from "../screens/comments/MeetingAdminScreen";
import MeetingComparisonScreen from "../screens/comments/MeetingComparisonScreen";
import ObservationHomeScreen from "../screens/observation/ObservationHomeScreen";
import UploadObservationScreen from "../screens/observation/UploadObservationScreen";
import ObservationReviewQueueScreen from "../screens/observation/ObservationReviewQueueScreen";
import ReviewObservationScreen from "../screens/observation/ReviewObservationScreen";
import ObservationDetailScreen from "../screens/observation/ObservationDetailScreen";
import ObservationTrendScreen from "../screens/observation/ObservationTrendScreen";
import ObservationDueListScreen from "../screens/observation/ObservationDueListScreen";
import ReviewerEffectivenessScreen from "../screens/observation/ReviewerEffectivenessScreen";
import ObservationConfigScreen from "../screens/observation/ObservationConfigScreen";
import RevisionHomeScreen from "../screens/revision/RevisionHomeScreen";
import GroupRevisionGridScreen from "../screens/revision/GroupRevisionGridScreen";
import StudentRevisionHistoryScreen from "../screens/revision/StudentRevisionHistoryScreen";
import DeliverRevisionScreen from "../screens/revision/DeliverRevisionScreen";
import RevisionDashboardScreen from "../screens/revision/RevisionDashboardScreen";
import FinanceHomeScreen from "../screens/finance/FinanceHomeScreen";
import DailyEntryScreen from "../screens/finance/DailyEntryScreen";
import DailySnapshotScreen from "../screens/finance/DailySnapshotScreen";
import FeesZakatScreen from "../screens/finance/FeesZakatScreen";
import QardIouScreen from "../screens/finance/QardIouScreen";
import ReconciliationScreen from "../screens/finance/ReconciliationScreen";
import BudgetScreen from "../screens/finance/BudgetScreen";
import FinanceDashboardScreen from "../screens/finance/FinanceDashboardScreen";
import HrHomeScreen from "../screens/hr/HrHomeScreen";
import MyLeaveScreen from "../screens/hr/MyLeaveScreen";
import MyRecordScreen from "../screens/hr/MyRecordScreen";
import LeaveCoverScreen from "../screens/hr/LeaveCoverScreen";
import LeaveAdminScreen from "../screens/hr/LeaveAdminScreen";
import PayrollHomeScreen from "../screens/hr/PayrollHomeScreen";
import PreparePayrollScreen from "../screens/hr/PreparePayrollScreen";
import PayrollRunDetailScreen from "../screens/hr/PayrollRunDetailScreen";
import PaymentExportScreen from "../screens/hr/PaymentExportScreen";
import StaffPayScreen from "../screens/hr/StaffPayScreen";
import AdvancesScreen from "../screens/hr/AdvancesScreen";
import PerformanceHomeScreen from "../screens/hr/PerformanceHomeScreen";
import StaffPerformanceScreen from "../screens/hr/StaffPerformanceScreen";
import StaffObservationsScreen from "../screens/hr/StaffObservationsScreen";
import StaffAppraisalsScreen from "../screens/hr/StaffAppraisalsScreen";
import StaffConductScreen from "../screens/hr/StaffConductScreen";
import StaffCpdScreen from "../screens/hr/StaffCpdScreen";
import GrievanceInboxScreen from "../screens/hr/GrievanceInboxScreen";
import OffboardingHomeScreen from "../screens/hr/OffboardingHomeScreen";
import OffboardingCaseScreen from "../screens/hr/OffboardingCaseScreen";
import SectionPickerScreen from "../screens/common/SectionPickerScreen";
import AdminHomeScreen from "../screens/admin/AdminHomeScreen";
import ImportScreen from "../screens/admin/ImportScreen";
import UserListScreen from "../screens/admin/UserListScreen";
import ScopeGrantScreen from "../screens/admin/ScopeGrantScreen";
import RosterScreen from "../screens/admin/RosterScreen";
import StaffListScreen from "../screens/admin/StaffListScreen";
import AssignClassTeacherScreen from "../screens/admin/AssignClassTeacherScreen";
import SectionConfigScreen from "../screens/admin/SectionConfigScreen";
import GuardianCredentialsScreen from "../screens/admin/GuardianCredentialsScreen";
import StaffCredentialsScreen from "../screens/admin/StaffCredentialsScreen";
import MessageTemplatesScreen from "../screens/admin/MessageTemplatesScreen";
import MessageTemplateEditScreen from "../screens/admin/MessageTemplateEditScreen";
import AccessControlUsersScreen from "../screens/admin/AccessControlUsersScreen";
import AccessControlEditScreen from "../screens/admin/AccessControlEditScreen";
import GuardianHomeScreen from "../screens/guardian/GuardianHomeScreen";
import ChildClassNotesScreen from "../screens/guardian/ChildClassNotesScreen";
import ChildHomeworkScreen from "../screens/guardian/ChildHomeworkScreen";
import ChildRoutineScreen from "../screens/guardian/ChildRoutineScreen";
import { GuardianChildProvider } from "../state/GuardianChildContext";

export { LoginScreen };

/** Tap to switch language — the button shows the language it switches TO. */
function LangToggle(): React.ReactElement {
  const { lang, toggle } = useLanguage();
  const colors = useColors();
  return (
    <Pressable onPress={toggle} style={{ paddingHorizontal: 12 }} hitSlop={12} accessibilityLabel={STR.language}>
      <Text style={{ ...typeScale.button, color: colors.onPrimary }}>{lang === "bn" ? "EN" : "বাং"}</Text>
    </Pressable>
  );
}

/** The 🔔 + unread badge (N3.1) — rendered in every stack header (staff and
 *  guardian alike); opens the root-level NotificationCenter. The count comes
 *  from the shared NotificationContext poll. */
function HeaderBell(): React.ReactElement {
  const navigation = useNavigation();
  const colors = useColors();
  const { unreadCount } = useNotifications();
  return (
    <Pressable
      // The route lives on the ROOT stack — navigate bubbles up from any tab.
      onPress={() => (navigation as unknown as { navigate: (name: string) => void }).navigate("NotificationCenter")}
      style={{ paddingHorizontal: 8 }}
      hitSlop={12}
      accessibilityLabel={STR.notifications}
    >
      <View>
        <Text style={{ fontSize: 18 }}>🔔</Text>
        {unreadCount > 0 ? (
          <View
            style={{
              position: "absolute",
              top: -4,
              right: -10,
              backgroundColor: colors.error,
              borderRadius: 9,
              minWidth: 18,
              height: 18,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 3,
            }}
          >
            <Text style={{ color: colors.onPrimary, fontSize: 11, fontWeight: "700" }}>
              {unreadCount > 99 ? bnNum("99+") : bnNum(unreadCount)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function LogoutButton(): React.ReactElement {
  const { logout } = useAuth();
  const colors = useColors();
  return (
    <Pressable onPress={() => void logout()} style={{ paddingHorizontal: 12 }} hitSlop={12} accessibilityLabel={STR.logout}>
      <Text style={{ ...typeScale.button, color: colors.onPrimary }}>{STR.logout}</Text>
    </Pressable>
  );
}

/** The logged-in user's name, shown left of the language/logout actions. The name
 *  is truncated to fit; on web a native `title` tooltip shows the full name on hover. */
function HeaderName(): React.ReactElement | null {
  const { user } = useAuth();
  const colors = useColors();
  const ref = React.useRef<Text>(null);
  const name = user?.name ?? "";
  React.useEffect(() => {
    if (Platform.OS === "web" && name && ref.current) {
      (ref.current as unknown as { setAttribute?: (k: string, v: string) => void }).setAttribute?.("title", name);
    }
  }, [name]);
  if (!name) return null;
  return (
    <Text
      ref={ref}
      style={{ ...typeScale.button, color: colors.onPrimary, maxWidth: 150, marginRight: 4 }}
      numberOfLines={1}
      ellipsizeMode="tail"
      accessibilityLabel={name}
    >
      👤 {name}
    </Text>
  );
}

function HeaderRight(): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <HeaderName />
      <HeaderBell />
      <LangToggle />
      <LogoutButton />
    </View>
  );
}

/** Stack header/content styling from the active token set (light + dark). */
function useStackOptions() {
  const colors = useColors();
  return {
    headerStyle: { backgroundColor: colors.primary },
    headerTintColor: colors.onPrimary,
    headerTitleStyle: { fontFamily: fonts.bold },
    contentStyle: { backgroundColor: colors.bg },
    headerRight: () => <HeaderRight />,
  } as const;
}

function tabIcon(emoji: string) {
  return () => <Text style={{ fontSize: 18 }}>{emoji}</Text>;
}

// --- Stacks ----------------------------------------------------------------

const ContentStack = createNativeStackNavigator<ContentStackParamList>();
function ContentNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <ContentStack.Navigator screenOptions={stackOptions}>
      <ContentStack.Screen name="ContentTree" component={ContentTreeScreen} options={{ title: STR.contentTreeTitle }} />
      <ContentStack.Screen name="PlanView" component={PlanViewScreen} options={{ title: STR.planTitle }} />
    </ContentStack.Navigator>
  );
}

const QuestionsStack = createNativeStackNavigator<QuestionsStackParamList>();
function QuestionsNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <QuestionsStack.Navigator screenOptions={stackOptions}>
      <QuestionsStack.Screen name="QuestionBank" component={QuestionBankScreen} options={{ title: STR.questionBank }} />
      <QuestionsStack.Screen name="QuestionPreview" component={QuestionPreviewScreen} options={{ title: STR.preview }} />
      <QuestionsStack.Screen name="Basket" component={BasketScreen} options={{ title: STR.basket }} />
    </QuestionsStack.Navigator>
  );
}

const SetsStack = createNativeStackNavigator<SetsStackParamList>();
function SetsNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <SetsStack.Navigator screenOptions={stackOptions}>
      <SetsStack.Screen name="SetList" component={SetListScreen} options={{ title: STR.setList }} />
      <SetsStack.Screen name="SetDetail" component={SetDetailScreen} options={{ title: STR.setDetail }} />
      <SetsStack.Screen name="AssembleSet" component={AssembleSetScreen} options={{ title: STR.assemble }} />
      <SetsStack.Screen name="SectionPicker" component={SectionPickerScreen} options={{ title: STR.pickSection }} />
    </SetsStack.Navigator>
  );
}

const TrackersStack = createNativeStackNavigator<TrackersStackParamList>();
function TrackersNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <TrackersStack.Navigator screenOptions={stackOptions}>
      <TrackersStack.Screen name="TrackerList" component={TrackerListScreen} options={{ title: STR.trackerList }} />
      <TrackersStack.Screen name="OpenTracker" component={OpenTrackerScreen} options={{ title: STR.openTracker }} />
      <TrackersStack.Screen name="TrackerEntry" component={TrackerEntryScreen} options={{ title: STR.trackerEntry }} />
      <TrackersStack.Screen name="TrackerSummary" component={TrackerSummaryScreen} options={{ title: STR.trackerSummary }} />
      <TrackersStack.Screen name="WaLink" component={WaLinkScreen} options={{ title: STR.sendReminder }} />
      <TrackersStack.Screen name="SectionPicker" component={SectionPickerScreen} options={{ title: STR.pickSection }} />
    </TrackersStack.Navigator>
  );
}

const HomeworkStack = createNativeStackNavigator<HomeworkStackParamList>();
function HomeworkNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <HomeworkStack.Navigator screenOptions={stackOptions}>
      <HomeworkStack.Screen name="HomeworkHome" component={HomeworkHomeScreen} options={{ title: STR.tabHomework }} />
      <HomeworkStack.Screen name="DeclareHomework" component={DeclareHomeworkScreen} options={{ title: STR.hwDeclareTitle }} />
      <HomeworkStack.Screen name="HomeworkReconcile" component={HomeworkReconcileScreen} options={{ title: STR.hwReconcileTitle }} />
      <HomeworkStack.Screen name="CheckingQueue" component={CheckingQueueScreen} options={{ title: STR.hwCheckingTitle }} />
      <HomeworkStack.Screen name="HomeworkRollups" component={HomeworkRollupsScreen} options={{ title: STR.hwRollupsTitle }} />
      <HomeworkStack.Screen name="SectionPicker" component={SectionPickerScreen} options={{ title: STR.pickSection }} />
    </HomeworkStack.Navigator>
  );
}

const AssignmentStack = createNativeStackNavigator<AssignmentStackParamList>();
function AssignmentNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <AssignmentStack.Navigator screenOptions={stackOptions}>
      <AssignmentStack.Screen name="AssignmentHome" component={AssignmentHomeScreen} options={{ title: STR.tabAssignment }} />
      <AssignmentStack.Screen name="AssignmentSchedule" component={AssignmentScheduleScreen} options={{ title: STR.asScheduleTitle }} />
      <AssignmentStack.Screen name="DeliverAssignment" component={DeliverAssignmentScreen} options={{ title: STR.asDeliverTitle }} />
      <AssignmentStack.Screen name="CollectAssignment" component={CollectAssignmentScreen} options={{ title: STR.asCollectTitle }} />
      <AssignmentStack.Screen name="AssignmentChecking" component={AssignmentCheckingScreen} options={{ title: STR.asCheckTitle }} />
      <AssignmentStack.Screen name="AssignmentChase" component={AssignmentChaseScreen} options={{ title: STR.asChaseTitle }} />
      <AssignmentStack.Screen name="AssignmentRollups" component={AssignmentRollupsScreen} options={{ title: STR.asRollupsTitle }} />
    </AssignmentStack.Navigator>
  );
}

const ReviewStack = createNativeStackNavigator<ReviewStackParamList>();
function ReviewNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <ReviewStack.Navigator screenOptions={stackOptions}>
      <ReviewStack.Screen name="ReviewHome" component={ReviewHomeScreen} options={{ title: STR.tabReview }} />
      <ReviewStack.Screen name="ReviewSubmit" component={ReviewSubmitScreen} options={{ title: STR.submitReview }} />
      <ReviewStack.Screen name="ReviewThread" component={ReviewThreadScreen} options={{ title: STR.reviewThread }} />
    </ReviewStack.Navigator>
  );
}

const RoutineStack = createNativeStackNavigator<RoutineStackParamList>();
function RoutineNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <RoutineStack.Navigator screenOptions={stackOptions}>
      <RoutineStack.Screen name="RoutineHome" component={RoutineHomeScreen} options={{ title: STR.routineTitle }} />
      <RoutineStack.Screen name="MyRoutine" component={MyRoutineScreen} options={{ title: STR.myRoutineTitle }} />
      <RoutineStack.Screen name="GroupRoutine" component={GroupRoutineScreen} options={{ title: STR.groupRoutineTitle }} />
      <RoutineStack.Screen name="RoutineEditor" component={RoutineEditorScreen} options={{ title: STR.editRoutineTitle }} />
      <RoutineStack.Screen name="CoverManage" component={CoverManageScreen} options={{ title: STR.coverManageTitle }} />
      <RoutineStack.Screen name="DailyNote" component={DailyNoteScreen} options={{ title: STR.dailyNoteTitle }} />
      <RoutineStack.Screen name="BellSchedule" component={BellScheduleScreen} options={{ title: STR.bellScheduleTitle }} />
      <RoutineStack.Screen name="SectionPicker" component={SectionPickerScreen} options={{ title: STR.pickSection }} />
    </RoutineStack.Navigator>
  );
}

const AttendanceStack = createNativeStackNavigator<AttendanceStackParamList>();
function AttendanceNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <AttendanceStack.Navigator screenOptions={stackOptions}>
      <AttendanceStack.Screen name="AttendanceHome" component={AttendanceHomeScreen} options={{ title: STR.tabAttendance }} />
      <AttendanceStack.Screen name="MarkAttendance" component={MarkAttendanceScreen} options={{ title: STR.attMarkTitle }} />
      <AttendanceStack.Screen name="TeacherAttendanceImport" component={TeacherAttendanceImportScreen} options={{ title: STR.attUploadTitle }} />
      <AttendanceStack.Screen name="AttendanceReport" component={AttendanceReportScreen} options={{ title: STR.attReportTitle }} />
      <AttendanceStack.Screen name="AssignMarker" component={AssignMarkerScreen} options={{ title: STR.attAssignMarkerTitle }} />
      <AttendanceStack.Screen name="SectionPicker" component={SectionPickerScreen} options={{ title: STR.pickSection }} />
    </AttendanceStack.Navigator>
  );
}

const LibraryStack = createNativeStackNavigator<LibraryStackParamList>();
function LibraryNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <LibraryStack.Navigator screenOptions={stackOptions}>
      <LibraryStack.Screen name="LibraryHome" component={LibraryHomeScreen} options={{ title: STR.tabLibrary }} />
      <LibraryStack.Screen name="TitleDetail" component={TitleDetailScreen} options={{ title: STR.libTitleDetail }} />
      <LibraryStack.Screen name="LibraryDesk" component={LibraryDeskScreen} options={{ title: STR.libDesk }} />
      <LibraryStack.Screen name="CatalogManage" component={CatalogManageScreen} options={{ title: STR.libCatalogManage }} />
      <LibraryStack.Screen name="LibraryAdmin" component={LibraryAdminScreen} options={{ title: STR.libAdmin }} />
    </LibraryStack.Navigator>
  );
}

const ChatStack = createNativeStackNavigator<ChatStackParamList>();
function ChatNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <ChatStack.Navigator screenOptions={stackOptions}>
      <ChatStack.Screen name="ChatHome" component={ChatHomeScreen} options={{ title: STR.chatTitle }} />
      <ChatStack.Screen
        name="ChatThread"
        component={ChatThreadScreen}
        options={({ route }) => ({ title: route.params.title || STR.chatThreadTitle })}
      />
      <ChatStack.Screen name="NewChat" component={NewChatScreen} options={{ title: STR.chatNewTitle }} />
      <ChatStack.Screen name="GroupManage" component={GroupManageScreen} options={{ title: STR.chatGroupManageTitle }} />
      <ChatStack.Screen name="ChatOversight" component={ChatOversightScreen} options={{ title: STR.chatOversightTitle }} />
      <ChatStack.Screen
        name="ChatOversightThread"
        component={ChatOversightThreadScreen}
        options={({ route }) => ({ title: route.params.title || STR.chatOversightThreadTitle })}
      />
      <ChatStack.Screen name="GuardianNotice" component={GuardianNoticeScreen} options={{ title: STR.chatNoticeTitle }} />
    </ChatStack.Navigator>
  );
}

const VocabStack = createNativeStackNavigator<VocabStackParamList>();
function VocabNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <VocabStack.Navigator screenOptions={stackOptions}>
      <VocabStack.Screen name="VocabHome" component={VocabHomeScreen} options={{ title: STR.vbHomeTitle }} />
      <VocabStack.Screen name="VocabWordBank" component={VocabWordBankScreen} options={{ title: STR.vbWordBankTitle }} />
      <VocabStack.Screen name="VocabTests" component={VocabTestsScreen} options={{ title: STR.vbTests }} />
      <VocabStack.Screen name="BuildVocabTest" component={BuildVocabTestScreen} options={{ title: STR.vbNewTest }} />
      <VocabStack.Screen
        name="VocabMarkGrid"
        component={VocabMarkGridScreen}
        options={({ route }) => ({ title: route.params.title || STR.vbMarkTitle })}
      />
      <VocabStack.Screen
        name="VocabReport"
        component={VocabReportScreen}
        options={({ route }) => ({ title: route.params.title || STR.vbReportTitle })}
      />
      <VocabStack.Screen
        name="VocabStudentReport"
        component={VocabStudentReportScreen}
        options={({ route }) => ({ title: route.params.studentName || STR.vbStudentReportTitle })}
      />
      <VocabStack.Screen name="VocabClassReport" component={VocabClassReportScreen} options={{ title: STR.vbClassReportTitle }} />
      <VocabStack.Screen
        name="VocabMessages"
        component={VocabMessagesScreen}
        options={({ route }) => ({ title: route.params.title || STR.vbMessages })}
      />
      <VocabStack.Screen name="VocabAssignment" component={VocabAssignmentScreen} options={{ title: STR.vbAssignTitle }} />
    </VocabStack.Navigator>
  );
}

const ClassTestStack = createNativeStackNavigator<ClassTestStackParamList>();
function ClassTestNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <ClassTestStack.Navigator screenOptions={stackOptions}>
      <ClassTestStack.Screen name="ClassTestHome" component={ClassTestHomeScreen} options={{ title: STR.ctHomeTitle }} />
      <ClassTestStack.Screen name="RequestClassTest" component={RequestClassTestScreen} options={{ title: STR.ctNewRequest }} />
      <ClassTestStack.Screen name="ClassTestPrintQueue" component={ClassTestPrintQueueScreen} options={{ title: STR.ctPrintQueueTitle }} />
      <ClassTestStack.Screen
        name="ClassTestResults"
        component={ClassTestResultsScreen}
        options={({ route }) => ({ title: route.params.title || STR.ctResultsTitle })}
      />
      <ClassTestStack.Screen
        name="ClassTestPublish"
        component={ClassTestPublishScreen}
        options={({ route }) => ({ title: route.params.title || STR.ctPublishTitle })}
      />
      <ClassTestStack.Screen name="ClassTestDashboard" component={ClassTestDashboardScreen} options={{ title: STR.ctDashboardTitle }} />
      <ClassTestStack.Screen name="ClassTestReports" component={ClassTestReportsScreen} options={{ title: STR.ctReportsTitle }} />
      <ClassTestStack.Screen
        name="ClassTestClassSubject"
        component={ClassTestClassSubjectScreen}
        options={({ route }) => ({ title: route.params.title || STR.ctClassSubjectTitle })}
      />
      <ClassTestStack.Screen
        name="ClassTestStudentProfile"
        component={ClassTestStudentProfileScreen}
        options={({ route }) => ({ title: route.params.studentName || STR.ctStudentProfileTitle })}
      />
    </ClassTestStack.Navigator>
  );
}

const CommentsStack = createNativeStackNavigator<CommentsStackParamList>();
function CommentsNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <CommentsStack.Navigator screenOptions={stackOptions}>
      <CommentsStack.Screen name="CommentsHome" component={CommentsHomeScreen} options={{ title: STR.cmHomeTitle }} />
      <CommentsStack.Screen name="SectionComments" component={SectionCommentsScreen} options={{ title: STR.cmDailyComments }} />
      <CommentsStack.Screen
        name="CommentEntry"
        component={CommentEntryScreen}
        options={({ route }) => ({ title: route.params.studentName || STR.cmEntryTitle })}
      />
      <CommentsStack.Screen name="MeetingsList" component={MeetingsListScreen} options={{ title: STR.cmMeetingsTitle }} />
      <CommentsStack.Screen
        name="MeetingAdmin"
        component={MeetingAdminScreen}
        options={({ route }) => ({ title: route.params.instanceLabel || STR.cmMeetingAdminTitle })}
      />
      <CommentsStack.Screen
        name="MeetingComparison"
        component={MeetingComparisonScreen}
        options={({ route }) => ({ title: route.params.studentName || STR.cmComparisonTitle })}
      />
    </CommentsStack.Navigator>
  );
}

const ObservationStack = createNativeStackNavigator<ObservationStackParamList>();
function ObservationNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <ObservationStack.Navigator screenOptions={stackOptions}>
      <ObservationStack.Screen name="ObservationHome" component={ObservationHomeScreen} options={{ title: STR.obsHomeTitle }} />
      <ObservationStack.Screen name="UploadObservation" component={UploadObservationScreen} options={{ title: STR.obsUploadTitle }} />
      <ObservationStack.Screen name="ObservationReviewQueue" component={ObservationReviewQueueScreen} options={{ title: STR.obsQueueTitle }} />
      <ObservationStack.Screen
        name="ReviewObservation"
        component={ReviewObservationScreen}
        options={({ route }) => ({ title: route.params.title || STR.obsReviewTitle })}
      />
      <ObservationStack.Screen
        name="ObservationDetail"
        component={ObservationDetailScreen}
        options={({ route }) => ({ title: route.params.title || STR.obsDetailTitle })}
      />
      <ObservationStack.Screen name="ObservationTrend" component={ObservationTrendScreen} options={{ title: STR.obsTrendTitle }} />
      <ObservationStack.Screen name="ObservationDueList" component={ObservationDueListScreen} options={{ title: STR.obsDueListTitle }} />
      <ObservationStack.Screen name="ReviewerEffectiveness" component={ReviewerEffectivenessScreen} options={{ title: STR.obsReviewerEffTitle }} />
      <ObservationStack.Screen name="ObservationConfig" component={ObservationConfigScreen} options={{ title: STR.obsEscalationTitle }} />
    </ObservationStack.Navigator>
  );
}

const RevisionStack = createNativeStackNavigator<RevisionStackParamList>();
function RevisionNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <RevisionStack.Navigator screenOptions={stackOptions}>
      <RevisionStack.Screen name="RevisionHome" component={RevisionHomeScreen} options={{ title: STR.revHomeTitle }} />
      <RevisionStack.Screen
        name="GroupRevisionGrid"
        component={GroupRevisionGridScreen}
        options={({ route }) => ({ title: route.params.nameBn || STR.revGridTitle })}
      />
      <RevisionStack.Screen
        name="StudentRevisionHistory"
        component={StudentRevisionHistoryScreen}
        options={({ route }) => ({ title: route.params.studentName || STR.revHistoryTitle })}
      />
      <RevisionStack.Screen
        name="DeliverRevision"
        component={DeliverRevisionScreen}
        options={({ route }) => ({ title: route.params.nameBn || STR.revDeliverTitle })}
      />
      <RevisionStack.Screen name="RevisionDashboard" component={RevisionDashboardScreen} options={{ title: STR.revDashTitle }} />
    </RevisionStack.Navigator>
  );
}

const FinanceStack = createNativeStackNavigator<FinanceStackParamList>();
function FinanceNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <FinanceStack.Navigator screenOptions={stackOptions}>
      <FinanceStack.Screen name="FinanceHome" component={FinanceHomeScreen} options={{ title: STR.finHomeTitle }} />
      <FinanceStack.Screen name="DailyEntry" component={DailyEntryScreen} options={{ title: STR.finDailyEntryTitle }} />
      <FinanceStack.Screen name="DailySnapshot" component={DailySnapshotScreen} options={{ title: STR.finSnapshotTitle }} />
      <FinanceStack.Screen name="FeesZakat" component={FeesZakatScreen} options={{ title: STR.finFeesZakatTitle }} />
      <FinanceStack.Screen name="QardIou" component={QardIouScreen} options={{ title: STR.finQardIouTitle }} />
      <FinanceStack.Screen name="Reconciliation" component={ReconciliationScreen} options={{ title: STR.finReconTitle }} />
      <FinanceStack.Screen name="Budget" component={BudgetScreen} options={{ title: STR.finBudgetTitle }} />
      <FinanceStack.Screen name="FinanceDashboard" component={FinanceDashboardScreen} options={{ title: STR.finDashboardTitle }} />
    </FinanceStack.Navigator>
  );
}

const HrStack = createNativeStackNavigator<HrStackParamList>();
function HrNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <HrStack.Navigator screenOptions={stackOptions}>
      <HrStack.Screen name="HrHome" component={HrHomeScreen} options={{ title: STR.tabHr }} />
      <HrStack.Screen name="MyLeave" component={MyLeaveScreen} options={{ title: STR.hrMyLeave }} />
      <HrStack.Screen name="MyRecord" component={MyRecordScreen} options={{ title: STR.hrMyRecord }} />
      <HrStack.Screen
        name="LeaveCover"
        component={LeaveCoverScreen}
        options={({ route }) => ({ title: route.params.title || STR.hrCoverTitle })}
      />
      <HrStack.Screen name="LeaveAdmin" component={LeaveAdminScreen} options={{ title: STR.hrLeaveAdmin }} />
      <HrStack.Screen name="PayrollHome" component={PayrollHomeScreen} options={{ title: STR.hrPayroll }} />
      <HrStack.Screen name="PreparePayroll" component={PreparePayrollScreen} options={{ title: STR.hrPrepareRun }} />
      <HrStack.Screen
        name="PayrollRunDetail"
        component={PayrollRunDetailScreen}
        options={({ route }) => ({ title: route.params.monthKey || STR.hrPayrollRuns })}
      />
      <HrStack.Screen name="PaymentExport" component={PaymentExportScreen} options={{ title: STR.hrPaymentExport }} />
      <HrStack.Screen name="StaffPay" component={StaffPayScreen} options={{ title: STR.hrStaffPay }} />
      <HrStack.Screen name="Advances" component={AdvancesScreen} options={{ title: STR.hrAdvances }} />
      <HrStack.Screen name="PerformanceHome" component={PerformanceHomeScreen} options={{ title: STR.hrPerformance }} />
      <HrStack.Screen
        name="StaffPerformance"
        component={StaffPerformanceScreen}
        options={({ route }) => ({ title: route.params.name || STR.hrStaffPerformance })}
      />
      <HrStack.Screen name="StaffObservations" component={StaffObservationsScreen} options={{ title: STR.hrObservations }} />
      <HrStack.Screen name="StaffAppraisals" component={StaffAppraisalsScreen} options={{ title: STR.hrAppraisals }} />
      <HrStack.Screen name="StaffConduct" component={StaffConductScreen} options={{ title: STR.hrConduct }} />
      <HrStack.Screen name="StaffCpd" component={StaffCpdScreen} options={{ title: STR.hrCpd }} />
      <HrStack.Screen name="GrievanceInbox" component={GrievanceInboxScreen} options={{ title: STR.hrGrievances }} />
      <HrStack.Screen name="OffboardingHome" component={OffboardingHomeScreen} options={{ title: STR.hrOffboarding }} />
      <HrStack.Screen
        name="OffboardingCase"
        component={OffboardingCaseScreen}
        options={({ route }) => ({ title: route.params.name || STR.hrOffboarding })}
      />
    </HrStack.Navigator>
  );
}

const AdminStack = createNativeStackNavigator<AdminStackParamList>();
function AdminNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <AdminStack.Navigator screenOptions={stackOptions}>
      <AdminStack.Screen name="AdminHome" component={AdminHomeScreen} options={{ title: STR.admin }} />
      <AdminStack.Screen name="Import" component={ImportScreen} options={{ title: STR.importContent }} />
      <AdminStack.Screen name="UserList" component={UserListScreen} options={{ title: STR.users }} />
      <AdminStack.Screen name="ScopeGrant" component={ScopeGrantScreen} options={{ title: STR.scopeGrants }} />
      <AdminStack.Screen name="Roster" component={RosterScreen} options={{ title: STR.roster }} />
      <AdminStack.Screen name="Staff" component={StaffListScreen} options={{ title: STR.staff }} />
      <AdminStack.Screen name="AssignClassTeacher" component={AssignClassTeacherScreen} options={{ title: STR.assignClassTeacher }} />
      <AdminStack.Screen name="SectionConfig" component={SectionConfigScreen} options={{ title: STR.sectionConfig }} />
      <AdminStack.Screen name="GuardianCredentials" component={GuardianCredentialsScreen} options={{ title: STR.guardianCredentials }} />
      <AdminStack.Screen name="StaffCredentials" component={StaffCredentialsScreen} options={{ title: STR.staffCredentials }} />
      <AdminStack.Screen name="MessageTemplates" component={MessageTemplatesScreen} options={{ title: STR.mtTitle }} />
      <AdminStack.Screen
        name="MessageTemplateEdit"
        component={MessageTemplateEditScreen}
        options={({ route }) => ({ title: route.params.labelBn || STR.mtTitle })}
      />
      <AdminStack.Screen name="AccessControlUsers" component={AccessControlUsersScreen} options={{ title: STR.acTitle }} />
      <AdminStack.Screen
        name="AccessControlEdit"
        component={AccessControlEditScreen}
        options={({ route }) => ({ title: route.params.name || STR.acTitle })}
      />
      <AdminStack.Screen name="SectionPicker" component={SectionPickerScreen} options={{ title: STR.pickSection }} />
    </AdminStack.Navigator>
  );
}

// --- Guardian portal stacks (GP-2, D-#68) ------------------------------------
// Three single-screen stacks; the shared GuardianChildProvider above the tab
// navigator keeps the child switcher's selection scoped across all of them.

const GuardianHomeStack = createNativeStackNavigator<GuardianHomeStackParamList>();
function GuardianHomeNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <GuardianHomeStack.Navigator screenOptions={stackOptions}>
      <GuardianHomeStack.Screen name="GuardianHome" component={GuardianHomeScreen} options={{ title: STR.gpToday }} />
      <GuardianHomeStack.Screen name="ChildClassNotes" component={ChildClassNotesScreen} options={{ title: STR.gpClassNotesHistory }} />
    </GuardianHomeStack.Navigator>
  );
}

const GuardianHomeworkStack = createNativeStackNavigator<GuardianHomeworkStackParamList>();
function GuardianHomeworkNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <GuardianHomeworkStack.Navigator screenOptions={stackOptions}>
      <GuardianHomeworkStack.Screen name="ChildHomework" component={ChildHomeworkScreen} options={{ title: STR.tabHomework }} />
    </GuardianHomeworkStack.Navigator>
  );
}

const GuardianRoutineStack = createNativeStackNavigator<GuardianRoutineStackParamList>();
function GuardianRoutineNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <GuardianRoutineStack.Navigator screenOptions={stackOptions}>
      <GuardianRoutineStack.Screen name="ChildRoutine" component={ChildRoutineScreen} options={{ title: STR.gpWeeklyRoutine }} />
    </GuardianRoutineStack.Navigator>
  );
}

const GuardianAssignmentsStack = createNativeStackNavigator<GuardianAssignmentsStackParamList>();
function GuardianAssignmentsNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <GuardianAssignmentsStack.Navigator screenOptions={stackOptions}>
      <GuardianAssignmentsStack.Screen name="ChildAssignments" component={ChildAssignmentsScreen} options={{ title: STR.tabAssignment }} />
    </GuardianAssignmentsStack.Navigator>
  );
}

// --- Tabs ------------------------------------------------------------------

const Tab = createBottomTabNavigator<TabParamList>();

export function AppTabs(): React.ReactElement {
  const { role } = useAuth();
  const basket = useBasket();
  const colors = useColors();

  const canContent = !!role && roleHasPermission(role, "content:read");
  const canQuestions = !!role && roleHasPermission(role, "question:read");
  const canSets = !!role && roleHasPermission(role, "set:read");
  const canTrackers = !!role && roleHasPermission(role, "tracker:read");
  const canHomework = !!role && roleHasPermission(role, "tracker:read");
  // Assignment tab: teachers/Principal via tracker:read; OFFICE via roster:manage
  // (Office owns the schedule + the D-#88 follow-up; it holds no tracker:* — D-#94).
  const canAssignment =
    !!role && (roleHasPermission(role, "tracker:read") || roleHasPermission(role, "roster:manage"));
  const canReview =
    !!role && (roleHasPermission(role, "content:review") || roleHasPermission(role, "content:assign_review"));
  const canRoutine = !!role && roleHasPermission(role, "routine:read");
  const canAttendance =
    !!role && (roleHasPermission(role, "attendance:mark") || roleHasPermission(role, "attendance:manage"));
  const canLibrary = !!role && roleHasPermission(role, "library:read");
  // Chat (M-5): Principal/Teacher/Office hold chat:read; GUARDIAN never does.
  const canChat = !!role && roleHasPermission(role, "chat:read");
  // Vocab (VC-5): Principal/Teacher via tracker:read (reports/build/mark); Office via
  // roster:manage (the weekly tester assignment + message:dispatch generation). Every
  // action is re-gated server-side. GUARDIAN never sees this staff tab.
  const canVocab = !!role && (roleHasPermission(role, "tracker:read") || roleHasPermission(role, "roster:manage"));
  // Class Test (CT-5): Principal/Teacher via tracker:read (request/results/publish/
  // reports); Office via roster:manage (print queue + dashboard + overdue-chase).
  // Every action is re-gated server-side. GUARDIAN never sees this staff tab.
  const canClassTest = !!role && (roleHasPermission(role, "tracker:read") || roleHasPermission(role, "roster:manage"));
  // Comments + Parents-Meeting (CM-6): Principal/Teacher via tracker:read (daily
  // comments + comparison reads); Office via roster:manage (the parents'-meeting
  // admin). Every action is re-gated server-side. GUARDIAN never sees this staff tab.
  const canComments = !!role && (roleHasPermission(role, "tracker:read") || roleHasPermission(role, "roster:manage"));
  // Classroom Observation (CO app surfaces): any holder of an observation:* perm —
  // Principal/Office (upload/read/manage) and the senior-teacher observer (review/read).
  // GUARDIAN holds none. Every action is re-gated + row-scoped server-side.
  const canObservation =
    !!role &&
    (roleHasPermission(role, "observation:read") ||
      roleHasPermission(role, "observation:upload") ||
      roleHasPermission(role, "observation:review") ||
      roleHasPermission(role, "observation:manage"));
  // Saturday Qur'an-Hifz Revision (SR app surfaces): Hifz teachers via tracker:read
  // (record/edit/deliver/history); Principal/Office via roster:manage (dashboards +
  // completeness chase). Every action is re-gated + row-scoped server-side. GUARDIAN
  // holds neither — the guardian read is a card on the guardian Home tab, not here.
  const canRevision =
    !!role && (roleHasPermission(role, "tracker:read") || roleHasPermission(role, "roster:manage"));
  // Finance (FIN-6B): finance:manage is Principal+Office only (AC-1 may grant it to
  // the accountant alone). GUARDIAN never holds it, so the tab is hidden for guardians.
  // Every action is re-gated + row-scoped server-side.
  const canFinance = !!role && roleHasPermission(role, "finance:manage");
  // HR/staff tab: every logged-in staff member (Principal/Teacher/Office) — leave
  // + self-service is universal; GUARDIAN never sees it. Admin entries inside are
  // permission-gated per slice and re-checked server-side.
  const canHr = !!role && role !== "GUARDIAN";
  const canAdmin = !!role && (roleHasPermission(role, "content:import") || roleHasPermission(role, "user:manage"));
  // GP-2 (D-#68): the GUARDIAN role holds ONLY guardian:read_child, so every
  // staff gate above is false for guardians — the guardian tab set is all they see.
  const canGuardian = !!role && roleHasPermission(role, "guardian:read_child");

  return (
    <GuardianChildProvider enabled={role === "GUARDIAN"}>
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts.medium },
      }}
    >
      {canContent ? (
        <Tab.Screen name="ContentTab" component={ContentNavigator} options={{ title: STR.tabContent, tabBarIcon: tabIcon("📚") }} />
      ) : null}
      {canQuestions ? (
        <Tab.Screen
          name="QuestionsTab"
          component={QuestionsNavigator}
          options={{ title: STR.tabQuestions, tabBarIcon: tabIcon("❓"), tabBarBadge: basket.count > 0 ? basket.count : undefined }}
        />
      ) : null}
      {canSets ? (
        <Tab.Screen name="SetsTab" component={SetsNavigator} options={{ title: STR.tabSets, tabBarIcon: tabIcon("🗂️") }} />
      ) : null}
      {canTrackers ? (
        <Tab.Screen name="TrackersTab" component={TrackersNavigator} options={{ title: STR.tabTrackers, tabBarIcon: tabIcon("✅") }} />
      ) : null}
      {canHomework ? (
        <Tab.Screen name="HomeworkTab" component={HomeworkNavigator} options={{ title: STR.tabHomework, tabBarIcon: tabIcon("📒") }} />
      ) : null}
      {canAssignment ? (
        <Tab.Screen name="AssignmentTab" component={AssignmentNavigator} options={{ title: STR.tabAssignment, tabBarIcon: tabIcon("📋") }} />
      ) : null}
      {canReview ? (
        <Tab.Screen name="ReviewTab" component={ReviewNavigator} options={{ title: STR.tabReview, tabBarIcon: tabIcon("📝") }} />
      ) : null}
      {canRoutine ? (
        <Tab.Screen name="RoutineTab" component={RoutineNavigator} options={{ title: STR.tabRoutine, tabBarIcon: tabIcon("📅") }} />
      ) : null}
      {canAttendance ? (
        <Tab.Screen name="AttendanceTab" component={AttendanceNavigator} options={{ title: STR.tabAttendance, tabBarIcon: tabIcon("🙋") }} />
      ) : null}
      {canLibrary ? (
        <Tab.Screen name="LibraryTab" component={LibraryNavigator} options={{ title: STR.tabLibrary, tabBarIcon: tabIcon("📖") }} />
      ) : null}
      {canChat ? (
        <Tab.Screen name="ChatTab" component={ChatNavigator} options={{ title: STR.tabChat, tabBarIcon: tabIcon("💬") }} />
      ) : null}
      {canVocab ? (
        <Tab.Screen name="VocabTab" component={VocabNavigator} options={{ title: STR.tabVocab, tabBarIcon: tabIcon("🔤") }} />
      ) : null}
      {canClassTest ? (
        <Tab.Screen name="ClassTestTab" component={ClassTestNavigator} options={{ title: STR.tabClassTest, tabBarIcon: tabIcon("🧪") }} />
      ) : null}
      {canComments ? (
        <Tab.Screen name="CommentsTab" component={CommentsNavigator} options={{ title: STR.tabComments, tabBarIcon: tabIcon("🗣️") }} />
      ) : null}
      {canObservation ? (
        <Tab.Screen name="ObservationTab" component={ObservationNavigator} options={{ title: STR.tabObservation, tabBarIcon: tabIcon("👁️") }} />
      ) : null}
      {canRevision ? (
        <Tab.Screen name="RevisionTab" component={RevisionNavigator} options={{ title: STR.tabRevision, tabBarIcon: tabIcon("🕌") }} />
      ) : null}
      {canFinance ? (
        <Tab.Screen name="FinanceTab" component={FinanceNavigator} options={{ title: STR.tabFinance, tabBarIcon: tabIcon("💰") }} />
      ) : null}
      {canHr ? (
        <Tab.Screen name="HrTab" component={HrNavigator} options={{ title: STR.tabHr, tabBarIcon: tabIcon("🧑‍💼") }} />
      ) : null}
      {canAdmin ? (
        <Tab.Screen name="AdminTab" component={AdminNavigator} options={{ title: STR.tabAdmin, tabBarIcon: tabIcon("⚙️") }} />
      ) : null}
      {canGuardian ? (
        <Tab.Screen name="GuardianHomeTab" component={GuardianHomeNavigator} options={{ title: STR.gpToday, tabBarIcon: tabIcon("🏠") }} />
      ) : null}
      {canGuardian ? (
        <Tab.Screen name="GuardianHomeworkTab" component={GuardianHomeworkNavigator} options={{ title: STR.tabHomework, tabBarIcon: tabIcon("📒") }} />
      ) : null}
      {canGuardian ? (
        <Tab.Screen name="GuardianRoutineTab" component={GuardianRoutineNavigator} options={{ title: STR.tabRoutine, tabBarIcon: tabIcon("📅") }} />
      ) : null}
      {canGuardian ? (
        <Tab.Screen name="GuardianAssignmentsTab" component={GuardianAssignmentsNavigator} options={{ title: STR.tabAssignment, tabBarIcon: tabIcon("📋") }} />
      ) : null}
    </Tab.Navigator>
    </GuardianChildProvider>
  );
}
