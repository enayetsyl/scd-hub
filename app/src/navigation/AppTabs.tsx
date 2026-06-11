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
import { Text, Pressable, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { roleHasPermission } from "@scd/shared";

import type {
  ContentStackParamList,
  QuestionsStackParamList,
  SetsStackParamList,
  TrackersStackParamList,
  HomeworkStackParamList,
  ReviewStackParamList,
  RoutineStackParamList,
  AdminStackParamList,
  TabParamList,
} from "./types";

import { useAuth } from "../auth/AuthContext";
import { useBasket } from "../state/BasketContext";
import { useLanguage } from "../state/LanguageContext";
import { STR } from "../lib/labels";
import { colors } from "../theme/tokens";

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
import SectionPickerScreen from "../screens/common/SectionPickerScreen";
import AdminHomeScreen from "../screens/admin/AdminHomeScreen";
import ImportScreen from "../screens/admin/ImportScreen";
import UserListScreen from "../screens/admin/UserListScreen";
import ScopeGrantScreen from "../screens/admin/ScopeGrantScreen";
import RosterScreen from "../screens/admin/RosterScreen";
import StaffListScreen from "../screens/admin/StaffListScreen";
import AssignClassTeacherScreen from "../screens/admin/AssignClassTeacherScreen";

export { LoginScreen };

/** Tap to switch language — the button shows the language it switches TO. */
function LangToggle(): React.ReactElement {
  const { lang, toggle } = useLanguage();
  return (
    <Pressable onPress={toggle} style={{ paddingHorizontal: 12 }} hitSlop={8} accessibilityLabel={STR.language}>
      <Text style={{ color: colors.white, fontWeight: "600" }}>{lang === "bn" ? "EN" : "বাং"}</Text>
    </Pressable>
  );
}

function LogoutButton(): React.ReactElement {
  const { logout } = useAuth();
  return (
    <Pressable onPress={() => void logout()} style={{ paddingHorizontal: 12 }} hitSlop={8}>
      <Text style={{ color: colors.white, fontWeight: "600" }}>{STR.logout}</Text>
    </Pressable>
  );
}

function HeaderRight(): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <LangToggle />
      <LogoutButton />
    </View>
  );
}

const stackOptions = {
  headerStyle: { backgroundColor: colors.brand700 },
  headerTintColor: colors.white,
  headerTitleStyle: { fontWeight: "700" as const },
  contentStyle: { backgroundColor: colors.bg },
  headerRight: () => <HeaderRight />,
} as const;

function tabIcon(emoji: string) {
  return () => <Text style={{ fontSize: 18 }}>{emoji}</Text>;
}

// --- Stacks ----------------------------------------------------------------

const ContentStack = createNativeStackNavigator<ContentStackParamList>();
function ContentNavigator(): React.ReactElement {
  return (
    <ContentStack.Navigator screenOptions={stackOptions}>
      <ContentStack.Screen name="ContentTree" component={ContentTreeScreen} options={{ title: STR.contentTreeTitle }} />
      <ContentStack.Screen name="PlanView" component={PlanViewScreen} options={{ title: STR.planTitle }} />
    </ContentStack.Navigator>
  );
}

const QuestionsStack = createNativeStackNavigator<QuestionsStackParamList>();
function QuestionsNavigator(): React.ReactElement {
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

const ReviewStack = createNativeStackNavigator<ReviewStackParamList>();
function ReviewNavigator(): React.ReactElement {
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

const AdminStack = createNativeStackNavigator<AdminStackParamList>();
function AdminNavigator(): React.ReactElement {
  return (
    <AdminStack.Navigator screenOptions={stackOptions}>
      <AdminStack.Screen name="AdminHome" component={AdminHomeScreen} options={{ title: STR.admin }} />
      <AdminStack.Screen name="Import" component={ImportScreen} options={{ title: STR.importContent }} />
      <AdminStack.Screen name="UserList" component={UserListScreen} options={{ title: STR.users }} />
      <AdminStack.Screen name="ScopeGrant" component={ScopeGrantScreen} options={{ title: STR.scopeGrants }} />
      <AdminStack.Screen name="Roster" component={RosterScreen} options={{ title: STR.roster }} />
      <AdminStack.Screen name="Staff" component={StaffListScreen} options={{ title: STR.staff }} />
      <AdminStack.Screen name="AssignClassTeacher" component={AssignClassTeacherScreen} options={{ title: STR.assignClassTeacher }} />
      <AdminStack.Screen name="SectionPicker" component={SectionPickerScreen} options={{ title: STR.pickSection }} />
    </AdminStack.Navigator>
  );
}

// --- Tabs ------------------------------------------------------------------

const Tab = createBottomTabNavigator<TabParamList>();

export function AppTabs(): React.ReactElement {
  const { role } = useAuth();
  const basket = useBasket();

  const canContent = !!role && roleHasPermission(role, "content:read");
  const canQuestions = !!role && roleHasPermission(role, "question:read");
  const canSets = !!role && roleHasPermission(role, "set:read");
  const canTrackers = !!role && roleHasPermission(role, "tracker:read");
  const canHomework = !!role && roleHasPermission(role, "tracker:read");
  const canReview =
    !!role && (roleHasPermission(role, "content:review") || roleHasPermission(role, "content:assign_review"));
  const canRoutine = !!role && roleHasPermission(role, "routine:read");
  const canAdmin = !!role && (roleHasPermission(role, "content:import") || roleHasPermission(role, "user:manage"));

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand700,
        tabBarInactiveTintColor: colors.muted,
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
      {canReview ? (
        <Tab.Screen name="ReviewTab" component={ReviewNavigator} options={{ title: STR.tabReview, tabBarIcon: tabIcon("📝") }} />
      ) : null}
      {canRoutine ? (
        <Tab.Screen name="RoutineTab" component={RoutineNavigator} options={{ title: STR.tabRoutine, tabBarIcon: tabIcon("📅") }} />
      ) : null}
      {canAdmin ? (
        <Tab.Screen name="AdminTab" component={AdminNavigator} options={{ title: STR.tabAdmin, tabBarIcon: tabIcon("⚙️") }} />
      ) : null}
    </Tab.Navigator>
  );
}
