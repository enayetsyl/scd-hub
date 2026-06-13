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
