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
import { Text, Pressable, View, Modal, ActivityIndicator, useWindowDimensions } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { HeaderBackButton } from "@react-navigation/elements";

import type {
  HomeStackParamList,
  ClassNotesStackParamList,
  PrintStackParamList,
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
  FreeMixingStackParamList,
  EnglishDriveStackParamList,
  TeachingNotesStackParamList,
  RevisionStackParamList,
  FinanceStackParamList,
  HrStackParamList,
  ReportsStackParamList,
  SupportBookStackParamList,
  AdminStackParamList,
  GuardianHomeStackParamList,
  GuardianHomeworkStackParamList,
  GuardianRoutineStackParamList,
  GuardianAssignmentsStackParamList,
  TabParamList,
} from "./types";

import { useNavigation, DrawerActions } from "@react-navigation/native";
import { useQuery } from "urql";
import { useAuth } from "../auth/AuthContext";
import { MY_VIDEO_REVIEWS } from "../graphql/videoReview";
import { ENGLISH_DRIVE_MY_CLASS_LEVELS } from "../graphql/englishDrive";
import { TEACHING_NOTE_MY_SCOPE } from "../graphql/teachingNotes";
import { useLanguage } from "../state/LanguageContext";
import { useSidebar, DRAWER_PERMANENT_MIN_WIDTH } from "../state/SidebarContext";
import { useNotifications } from "../state/NotificationContext";
import { STR, bnNum, roleViewLabel } from "../lib/labels";
import { appVersionLabel } from "../lib/appUpdate";
import { fonts, radius, space, typeScale, useColors } from "../theme";

import LoginScreen from "../screens/auth/LoginScreen";
import TodayScreen from "../screens/home/TodayScreen";
import AdminTodayScreen from "../screens/home/AdminTodayScreen";
import MyClassNotesScreen from "../screens/classnotes/MyClassNotesScreen";
import AllClassNotesScreen from "../screens/classnotes/AllClassNotesScreen";
import PrintHomeScreen from "../screens/printing/PrintHomeScreen";
import NewPrintRequestScreen from "../screens/printing/NewPrintRequestScreen";
import PrintHistoryScreen from "../screens/printing/PrintHistoryScreen";
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
// RP-2 (D-#355): the roster-pass workspace replaces Records + Checking. The two
// retired routes are repointed here for one release, then deleted (PR 3).
import HomeworkWorkspaceScreen from "../screens/homework/HomeworkWorkspaceScreen";
import HomeworkRollupsScreen from "../screens/homework/HomeworkRollupsScreen";
import AssignmentHomeScreen from "../screens/assignment/AssignmentHomeScreen";
import AssignmentScheduleScreen from "../screens/assignment/AssignmentScheduleScreen";
import DeliverAssignmentScreen from "../screens/assignment/DeliverAssignmentScreen";
// RP-4 (D-#356): the roster-pass workspace replaces Collect + Checking. The two
// retired routes are repointed to a redirect for one release, then deleted (PR 3).
import AssignmentWorkspaceScreen from "../screens/assignment/AssignmentWorkspaceScreen";
import AssignmentReconcileScreen from "../screens/assignment/AssignmentReconcileScreen";
import AssignmentChaseScreen from "../screens/assignment/AssignmentChaseScreen";
import AssignmentRollupsScreen from "../screens/assignment/AssignmentRollupsScreen";
import AssignmentGiftScreen from "../screens/assignment/AssignmentGiftScreen";
import ChildAssignmentsScreen from "../screens/guardian/ChildAssignmentsScreen";
import ReviewHomeScreen from "../screens/review/ReviewHomeScreen";
import ReviewSubmitScreen from "../screens/review/ReviewSubmitScreen";
import ReviewThreadScreen from "../screens/review/ReviewThreadScreen";
import AssignReviewsScreen from "../screens/review/AssignReviewsScreen";
import QuestionReviewQueueScreen from "../screens/review/QuestionReviewQueueScreen";
import AssignQuestionsScreen from "../screens/review/AssignQuestionsScreen";
import PublishQuestionsScreen from "../screens/review/PublishQuestionsScreen";
import QuestionReviewThreadScreen from "../screens/review/QuestionReviewThreadScreen";
import RoutineHomeScreen from "../screens/routine/RoutineHomeScreen";
import MyRoutineScreen from "../screens/routine/MyRoutineScreen";
import RoutineMasterScreen from "../screens/routine/RoutineMasterScreen";
import GroupRoutineScreen from "../screens/routine/GroupRoutineScreen";
import RoutineEditorScreen from "../screens/routine/RoutineEditorScreen";
import CoverManageScreen from "../screens/routine/CoverManageScreen";
import DailyNoteScreen from "../screens/routine/DailyNoteScreen";
import ClassNoteReportScreen from "../screens/routine/ClassNoteReportScreen";
import ClassNotesAdminScreen from "../screens/routine/ClassNotesAdminScreen";
import BellScheduleScreen from "../screens/routine/BellScheduleScreen";
import HolidaysScreen from "../screens/routine/HolidaysScreen";
import AttendanceHomeScreen from "../screens/attendance/AttendanceHomeScreen";
import MarkAttendanceScreen from "../screens/attendance/MarkAttendanceScreen";
import AttendanceAdminScreen from "../screens/attendance/AttendanceAdminScreen";
import TeacherAttendanceImportScreen from "../screens/attendance/TeacherAttendanceImportScreen";
import AttendanceReportScreen from "../screens/attendance/AttendanceReportScreen";
import SectionAttendanceScreen from "../screens/attendance/SectionAttendanceScreen";
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
import ArchiveHomeScreen from "../screens/archive/ArchiveHomeScreen";
import FileBundleScreen from "../screens/archive/FileBundleScreen";
import BundleDetailScreen from "../screens/archive/BundleDetailScreen";
import StorageBoxScreen from "../screens/archive/StorageBoxScreen";
import MyCtQuestionsScreen from "../screens/classtest/MyCtQuestionsScreen";
import CtQuestionRequestScreen from "../screens/classtest/CtQuestionRequestScreen";
import CtQuestionQueueScreen from "../screens/classtest/CtQuestionQueueScreen";
import ClassTestResultsScreen from "../screens/classtest/ClassTestResultsScreen";
import ClassTestResultsViewScreen from "../screens/classtest/ClassTestResultsViewScreen";
import ClassTestPublishScreen from "../screens/classtest/ClassTestPublishScreen";
import ClassTestDashboardScreen from "../screens/classtest/ClassTestDashboardScreen";
import ClassTestReportsScreen from "../screens/classtest/ClassTestReportsScreen";
import ClassTestClassSubjectScreen from "../screens/classtest/ClassTestClassSubjectScreen";
import ClassTestStudentProfileScreen from "../screens/classtest/ClassTestStudentProfileScreen";
import CommentsHomeScreen from "../screens/comments/CommentsHomeScreen";
import SectionCommentsScreen from "../screens/comments/SectionCommentsScreen";
import CommentReviewScreen from "../screens/comments/CommentReviewScreen";
import CommentEntryScreen from "../screens/comments/CommentEntryScreen";
import MeetingsListScreen from "../screens/comments/MeetingsListScreen";
import MeetingAdminScreen from "../screens/comments/MeetingAdminScreen";
import MeetingComparisonScreen from "../screens/comments/MeetingComparisonScreen";
import ObservationHomeScreen from "../screens/observation/ObservationHomeScreen";
import MyObservationsScreen from "../screens/observation/MyObservationsScreen";
import AllObservationsScreen from "../screens/observation/AllObservationsScreen";
import UploadObservationScreen from "../screens/observation/UploadObservationScreen";
import FreeMixingHomeScreen from "../screens/freemixing/FreeMixingHomeScreen";
import EnglishDriveHomeScreen from "../screens/englishdrive/EnglishDriveHomeScreen";
import EnglishDriveDocScreen from "../screens/englishdrive/EnglishDriveDocScreen";
import EnglishDriveUploadScreen from "../screens/englishdrive/EnglishDriveUploadScreen";
import TeachingNotesHomeScreen from "../screens/teachingnotes/TeachingNotesHomeScreen";
import TeachingNoteDocScreen from "../screens/teachingnotes/TeachingNoteDocScreen";
import TeachingNoteUploadScreen from "../screens/teachingnotes/TeachingNoteUploadScreen";
import TeachingNoteOpenCommentsScreen from "../screens/teachingnotes/TeachingNoteOpenCommentsScreen";
import ObservationReviewQueueScreen from "../screens/observation/ObservationReviewQueueScreen";
import MyReviewHistoryScreen from "../screens/observation/MyReviewHistoryScreen";
import ObservationRotaScreen from "../screens/observation/ObservationRotaScreen";
import ReviewObservationScreen from "../screens/observation/ReviewObservationScreen";
import ObservationDetailScreen from "../screens/observation/ObservationDetailScreen";
import CompareObservationsScreen from "../screens/observation/CompareObservationsScreen";
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
import NeedsCoverInboxScreen from "../screens/hr/NeedsCoverInboxScreen";
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
import SupervisoryGrantScreen from "../screens/admin/SupervisoryGrantScreen";
import RosterScreen from "../screens/admin/RosterScreen";
import StudentProfileScreen from "../screens/student/StudentProfileScreen";
import BookImportScreen from "../screens/supportbook/BookImportScreen";
import BookPolicyScreen from "../screens/supportbook/BookPolicyScreen";
import BookImageQueueScreen from "../screens/supportbook/BookImageQueueScreen";
import BookReviewScreen from "../screens/supportbook/BookReviewScreen";
import BookEscalationInboxScreen from "../screens/supportbook/BookEscalationInboxScreen";
import BookAssembleScreen from "../screens/supportbook/BookAssembleScreen";
import StaffListScreen from "../screens/admin/StaffListScreen";
import StaffFormScreen from "../screens/admin/StaffFormScreen";
import AssignClassTeacherScreen from "../screens/admin/AssignClassTeacherScreen";
import AssignSubjectTeacherScreen from "../screens/admin/AssignSubjectTeacherScreen";
import GroupMembersScreen from "../screens/admin/GroupMembersScreen";
import AcademicYearScreen from "../screens/admin/AcademicYearScreen";
import SectionConfigScreen from "../screens/admin/SectionConfigScreen";
import GuardianCredentialsScreen from "../screens/admin/GuardianCredentialsScreen";
import StaffCredentialsScreen from "../screens/admin/StaffCredentialsScreen";
import MessageTemplatesScreen from "../screens/admin/MessageTemplatesScreen";
import MessageTemplateEditScreen from "../screens/admin/MessageTemplateEditScreen";
import AccessControlUsersScreen from "../screens/admin/AccessControlUsersScreen";
import AccessControlEditScreen from "../screens/admin/AccessControlEditScreen";
import ReconciliationReportScreen from "../screens/admin/ReconciliationReportScreen";
import AttendanceRankingScreen from "../screens/admin/AttendanceRankingScreen";
import HwLifecycleReportScreen from "../screens/admin/HwLifecycleReportScreen";
import AuditLogScreen from "../screens/admin/AuditLogScreen";
import GuardianEngagementScreen from "../screens/admin/GuardianEngagementScreen";
import SystemHealthScreen from "../screens/admin/SystemHealthScreen";
import ReportsHomeScreen from "../screens/reports/ReportsHomeScreen";
import PendingReportScreen from "../screens/reports/PendingReportScreen";
import TeacherClassLoadScreen from "../screens/reports/TeacherClassLoadScreen";
import TeacherClassLoadDetailScreen from "../screens/reports/TeacherClassLoadDetailScreen";
import AssignmentLoadReportScreen from "../screens/reports/AssignmentLoadReportScreen";
import ClassTestReportScreen from "../screens/reports/ClassTestReportScreen";
import MonthlyReportConsoleScreen from "../screens/reports/MonthlyReportConsoleScreen";
import MonthlyReportDetailScreen from "../screens/reports/MonthlyReportDetailScreen";
import MonthlyPendingWorkScreen from "../screens/reports/MonthlyPendingWorkScreen";
import HwWeeklyUnsubmittedScreen from "../screens/reports/HwWeeklyUnsubmittedScreen";
import GuardianHomeScreen from "../screens/guardian/GuardianHomeScreen";
import ChildClassNotesScreen from "../screens/guardian/ChildClassNotesScreen";
import ChildAttendanceScreen from "../screens/guardian/ChildAttendanceScreen";
import ChildFeesScreen from "../screens/guardian/ChildFeesScreen";
import ChildLeaveScreen from "../screens/guardian/ChildLeaveScreen";
import ChildHomeworkScreen from "../screens/guardian/ChildHomeworkScreen";
import ChildRoutineScreen from "../screens/guardian/ChildRoutineScreen";
import { GuardianChildProvider } from "../state/GuardianChildContext";
import DrawerContent from "./DrawerContent";

export { LoginScreen };

/** ☰ hamburger — always shown. On wide/web it collapses/expands the permanent
 *  sidebar (the body reflows into the freed space); on phone it opens the
 *  slide-over overlay. */
function DrawerHamburger({ tintColor }: { tintColor?: string }): React.ReactElement {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const { toggle } = useSidebar();
  const wide = width >= DRAWER_PERMANENT_MIN_WIDTH;
  return (
    <Pressable
      onPress={() => (wide ? toggle() : navigation.dispatch(DrawerActions.openDrawer()))}
      style={{ paddingHorizontal: 12 }}
      hitSlop={12}
      accessibilityLabel={STR.openMenu}
    >
      <Text style={{ fontSize: 22, color: tintColor ?? "#fff" }}>☰</Text>
    </Pressable>
  );
}

/** Shared header-left: the native back button on pushed screens, the ☰ hamburger
 *  on a stack's root (nothing to go back to). Set once in useStackOptions so every
 *  stack gets the drawer toggle without a per-screen edit. */
function HeaderLeft({ canGoBack, tintColor }: { canGoBack?: boolean; tintColor?: string }): React.ReactElement {
  const navigation = useNavigation();
  // On a pushed screen show BOTH back and the ☰ — the hamburger still toggles the
  // permanent sidebar (web) / opens the drawer (phone), which is useful everywhere,
  // not only on a stack's root.
  if (canGoBack) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <HeaderBackButton tintColor={tintColor} labelVisible={false} onPress={() => navigation.goBack()} />
        <DrawerHamburger tintColor={tintColor} />
      </View>
    );
  }
  return <DrawerHamburger tintColor={tintColor} />;
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
              // -8, not -10: the Pressable's 8px padding then absorbs the badge, so a
              // two-digit count cannot bleed past the bell into 👤 or the title.
              right: -8,
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

/**
 * 👤 account menu (EximusEdu-style top-right dropdown) — consolidates the user's
 * name, the language toggle, "Report a problem" (MON-3), and Logout into one
 * popover, so the header reads like the system everyone knows. The 🔔 bell stays
 * separate (HeaderBell). Built with a transparent Modal — no menu dependency, and
 * it overlays the native header on every platform. Palette is unchanged (D-#258).
 */
function AvatarMenu(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const { user, logout, templates, viewMode, setViewMode } = useAuth();
  const { lang, toggle } = useLanguage();
  const navigation = useNavigation();
  const colors = useColors();
  const name = user?.name ?? "";
  const close = () => setOpen(false);

  const MenuRow = ({
    icon,
    label,
    onPress,
    danger,
  }: {
    icon: string;
    label: string;
    onPress: () => void;
    danger?: boolean;
  }): React.ReactElement => (
    <Pressable
      onPress={() => {
        close();
        onPress();
      }}
      accessibilityRole="button"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
        minHeight: 48,
        paddingVertical: space(2),
        paddingHorizontal: space(4),
      }}
    >
      <Text style={{ fontSize: 18 }}>{icon}</Text>
      <Text style={{ ...typeScale.button, color: danger ? colors.error : colors.textPrimary }}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{ paddingHorizontal: space(2) }}
        hitSlop={12}
        accessibilityLabel={STR.accountMenu}
      >
        <Text style={{ fontSize: 20 }}>👤</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={{ flex: 1 }} onPress={close}>
          <View
            style={{
              position: "absolute",
              top: 56,
              right: space(2),
              minWidth: 220,
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              paddingVertical: space(1),
              elevation: 6,
            }}
          >
            {name ? (
              <View
                style={{
                  paddingVertical: space(2),
                  paddingHorizontal: space(4),
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }} numberOfLines={1}>
                  {name}
                </Text>
              </View>
            ) : null}
            {/* Row shows the language it switches TO (matches the old toggle's intent). */}
            {/* D-#467 view switcher — only for a login that actually wears two hats
                (e.g. a teacher who also runs the office desk). Purely presentational:
                it narrows which tabs are OFFERED, never what the server allows. */}
            {templates.length > 1 ? (
              <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: space(1) }}>
                <Text
                  style={{
                    ...typeScale.caption,
                    color: colors.textSecondary,
                    paddingHorizontal: space(4),
                    paddingTop: space(2),
                  }}
                >
                  {STR.viewModeLabel}
                </Text>
                <MenuRow
                  icon={viewMode === null ? "✅" : "▫️"}
                  label={STR.viewModeAll}
                  onPress={() => setViewMode(null)}
                />
                {templates.map((t) => (
                  <MenuRow
                    key={t}
                    icon={viewMode === t ? "✅" : "▫️"}
                    label={roleViewLabel(t)}
                    onPress={() => setViewMode(t)}
                  />
                ))}
              </View>
            ) : null}
            <MenuRow icon="🌐" label={lang === "bn" ? "English" : "বাংলা"} onPress={toggle} />
            <MenuRow
              icon="🐞"
              label={STR.reportProblem}
              onPress={() => (navigation as unknown as { navigate: (n: string) => void }).navigate("ReportProblem")}
            />
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space(1) }} />
            <MenuRow icon="🚪" label={STR.logout} onPress={() => void logout()} danger />
            {/* Support aid for the self-hosted APK flow: "which version are you on?" */}
            <View style={{ paddingVertical: space(1), paddingHorizontal: space(4) }}>
              <Text style={{ ...typeScale.caption, color: colors.textSecondary }}>
                {STR.appVersion}: {appVersionLabel()}
              </Text>
            </View>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function HeaderRight(): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <HeaderBell />
      <AvatarMenu />
    </View>
  );
}

/**
 * Header chrome widths (px) reserved on each side of the title.
 *
 * `@react-navigation/elements` caps the title container at
 * `layout.width - ((leftButton ? 72 : 16) + (rightButton ? 72 : 16) + insets)` — a
 * HARD-CODED 72 per side. This app's header is wider than that on BOTH sides: back +
 * ☰ on the left (HeaderLeft), and 🔔 (whose unread badge is absolutely positioned
 * past its own box) + 👤 on the right. Emoji also lay out wider than their nominal
 * font size. So a long Bangla title — e.g. "মাসিক রিপোর্টের বাকি কাজ" — was allowed
 * to grow under the bell instead of ellipsising before it (owner report 2026-08-03).
 *
 * native-stack v6 does not forward `headerTitleContainerStyle`, so the container cap
 * cannot be corrected from options; HeaderTitle below bounds the TEXT instead, which
 * it can do because a child may be narrower than its container.
 */
const HEADER_LEFT_RESERVED = 92;
// 104, not 96: at 96 the measured ellipsis landed EXACTLY on the bell's left edge
// (title.right === bell.x at a 390px viewport) — correct, but reading as if the two
// touch. The extra 8px is the gap.
const HEADER_RIGHT_RESERVED = 104;
/** Never collapse the title to nothing on a very narrow viewport. */
const HEADER_TITLE_MIN = 72;

/**
 * The stack header title: ellipsised inside the space the chrome actually leaves.
 *
 * `maxFontSizeMultiplier` because the reserve above is a WIDTH: on a phone set to a
 * large system font the title grew ~30% wider and ate the whole budget, so titles that
 * fit on a default device ellipsised after three words on the owner's. Chrome caps its
 * scaling (body text does not) — the title stays legible AND stays inside its lane.
 */
function HeaderTitle({ children, tintColor }: { children?: string; tintColor?: string }): React.ReactElement {
  const { width } = useWindowDimensions();
  return (
    <Text
      numberOfLines={1}
      ellipsizeMode="tail"
      maxFontSizeMultiplier={1.2}
      style={{
        color: tintColor,
        fontFamily: fonts.bold,
        fontSize: 18,
        maxWidth: Math.max(HEADER_TITLE_MIN, width - HEADER_LEFT_RESERVED - HEADER_RIGHT_RESERVED),
      }}
    >
      {children}
    </Text>
  );
}

/** Stack header/content styling from the active token set (light + dark). The
 *  shared headerLeft gives every stack root the ☰ drawer toggle and every pushed
 *  screen the native back button (see HeaderLeft) — one place, no per-screen edit. */
function useStackOptions() {
  const colors = useColors();
  return {
    headerStyle: { backgroundColor: colors.primary },
    headerTintColor: colors.onPrimary,
    headerTitleStyle: { fontFamily: fonts.bold },
    contentStyle: { backgroundColor: colors.bg },
    // D-#470: native-stack draws its OWN back arrow on Android IN ADDITION to a custom
    // headerLeft, so a pushed screen showed "← ← ☰" (owner screenshot, 2026-08-09).
    // Web never rendered the native one, which is why it hid until the OTA carried the
    // current header to Android. HeaderLeft already draws the back arrow it wants.
    headerBackVisible: false,
    headerLeft: (props: { canGoBack?: boolean; tintColor?: string }) => (
      <HeaderLeft canGoBack={props.canGoBack} tintColor={props.tintColor} />
    ),
    headerTitle: (props: { children?: string; tintColor?: string }) => (
      <HeaderTitle tintColor={props.tintColor ?? colors.onPrimary}>{props.children}</HeaderTitle>
    ),
    headerRight: () => <HeaderRight />,
  } as const;
}

// --- Stacks ----------------------------------------------------------------

// Staff landing dashboard (UX-4, D-#265) — registered FIRST in the drawer so a
// staff login opens on Today; guardians keep their own Home (gpToday) unchanged.
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
function HomeNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  // D-#316: Principal/Office land on the card dashboard; teachers keep TodayScreen.
  const { role } = useAuth();
  const adminDash = role === "PRINCIPAL" || role === "OFFICE";
  return (
    <HomeStack.Navigator screenOptions={stackOptions}>
      <HomeStack.Screen
        name="Today"
        component={adminDash ? AdminTodayScreen : TodayScreen}
        options={{ title: STR.drawerItemToday }}
      />
    </HomeStack.Navigator>
  );
}

// Teacher-first Class Notes (UX-8, D-#266): the routine answers class/subject —
// the caller's own periods only. DailyNote (Routine tab) stays the admin/cover path.
const ClassNotesStack = createNativeStackNavigator<ClassNotesStackParamList>();
function ClassNotesNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <ClassNotesStack.Navigator screenOptions={stackOptions}>
      <ClassNotesStack.Screen name="MyClassNotes" component={MyClassNotesScreen} options={{ title: STR.drawerItemClassNotes }} />
      <ClassNotesStack.Screen name="AllClassNotes" component={AllClassNotesScreen} options={{ title: STR.cnAllNotesTitle }} />
    </ClassNotesStack.Navigator>
  );
}

/** Print queue (PQ-3/PQ-4, D-#281) — teachers file requests (tracker:write), the
 *  Office works the queue (roster:manage). One tab, role-aware inside. */
const PrintStack = createNativeStackNavigator<PrintStackParamList>();
function PrintNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <PrintStack.Navigator screenOptions={stackOptions}>
      <PrintStack.Screen name="PrintHome" component={PrintHomeScreen} options={{ title: STR.prQueueTitle }} />
      <PrintStack.Screen name="NewPrintRequest" component={NewPrintRequestScreen} options={{ title: STR.prNew }} />
      <PrintStack.Screen name="PrintHistory" component={PrintHistoryScreen} options={{ title: STR.prHistory }} />
    </PrintStack.Navigator>
  );
}

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
      <QuestionsStack.Screen name="SectionPicker" component={SectionPickerScreen} options={{ title: STR.pickSection }} />
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
      <HomeworkStack.Screen name="HomeworkWorkspace" component={HomeworkWorkspaceScreen} options={{ title: STR.hwWorkspaceTitle }} />
      <HomeworkStack.Screen name="HomeworkRollups" component={HomeworkRollupsScreen} options={{ title: STR.hwRollupsTitle }} />
      <HomeworkStack.Screen name="SectionPicker" component={SectionPickerScreen} options={{ title: STR.pickSection }} />
      <HomeworkStack.Screen name="StudentProfile" component={StudentProfileScreen} options={{ title: STR.spTitle }} />
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
      <AssignmentStack.Screen name="AssignmentWorkspace" component={AssignmentWorkspaceScreen} options={{ title: STR.asWorkspaceTitle }} />
      <AssignmentStack.Screen name="AssignmentReconcile" component={AssignmentReconcileScreen} options={{ title: STR.asReconcileTitle }} />
      <AssignmentStack.Screen name="AssignmentChase" component={AssignmentChaseScreen} options={{ title: STR.asChaseTitle }} />
      <AssignmentStack.Screen name="AssignmentRollups" component={AssignmentRollupsScreen} options={{ title: STR.asRollupsTitle }} />
      <AssignmentStack.Screen name="AssignmentGift" component={AssignmentGiftScreen} options={{ title: STR.agTitle }} />
      <AssignmentStack.Screen name="StudentProfile" component={StudentProfileScreen} options={{ title: STR.spTitle }} />
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
      <ReviewStack.Screen name="AssignReviews" component={AssignReviewsScreen} options={{ title: STR.rvAssignTitle }} />
      {/* Question review & publish (QR-4, D-#508). All after ReviewHome — the first screen
          registered becomes the stack's initial route, and a param-taking screen there
          crashes the whole tab. */}
      <ReviewStack.Screen
        name="QuestionReviewQueue"
        component={QuestionReviewQueueScreen}
        options={{ title: STR.qrQueueTitle }}
      />
      <ReviewStack.Screen
        name="AssignQuestions"
        component={AssignQuestionsScreen}
        options={{ title: STR.qrAssignTitle }}
      />
      <ReviewStack.Screen
        name="PublishQuestions"
        component={PublishQuestionsScreen}
        options={{ title: STR.qrPublishTitle }}
      />
      <ReviewStack.Screen
        name="QuestionReviewThread"
        component={QuestionReviewThreadScreen}
        options={{ title: STR.reviewThread }}
      />
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
      <RoutineStack.Screen name="TeacherClassLoadDetail" component={TeacherClassLoadDetailScreen} options={{ title: STR.clMyLoad }} />
      <RoutineStack.Screen name="RoutineMaster" component={RoutineMasterScreen} options={{ title: STR.rtMasterTitle }} />
      <RoutineStack.Screen name="GroupRoutine" component={GroupRoutineScreen} options={{ title: STR.groupRoutineTitle }} />
      <RoutineStack.Screen name="RoutineEditor" component={RoutineEditorScreen} options={{ title: STR.editRoutineTitle }} />
      <RoutineStack.Screen name="CoverManage" component={CoverManageScreen} options={{ title: STR.coverManageTitle }} />
      <RoutineStack.Screen name="DailyNote" component={DailyNoteScreen} options={{ title: STR.dailyNoteTitle }} />
      <RoutineStack.Screen name="ClassNoteReport" component={ClassNoteReportScreen} options={{ title: STR.rtNoteReportTitle }} />
      <RoutineStack.Screen name="ClassNotesAdmin" component={ClassNotesAdminScreen} options={{ title: STR.cnClassNotesAdmin }} />
      <RoutineStack.Screen name="BellSchedule" component={BellScheduleScreen} options={{ title: STR.bellScheduleTitle }} />
      <RoutineStack.Screen name="Holidays" component={HolidaysScreen} options={{ title: STR.hxTitle }} />
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
      <AttendanceStack.Screen name="AttendanceAdmin" component={AttendanceAdminScreen} options={{ title: STR.attAdminTitle }} />
      <AttendanceStack.Screen name="TeacherAttendanceImport" component={TeacherAttendanceImportScreen} options={{ title: STR.attUploadTitle }} />
      <AttendanceStack.Screen name="AttendanceReport" component={AttendanceReportScreen} options={{ title: STR.attReportTitle }} />
      <AttendanceStack.Screen name="SectionAttendance" component={SectionAttendanceScreen} options={{ title: STR.attMySectionsToday }} />
      <AttendanceStack.Screen name="AssignMarker" component={AssignMarkerScreen} options={{ title: STR.attAssignMarkerTitle }} />
      <AttendanceStack.Screen name="SectionPicker" component={SectionPickerScreen} options={{ title: STR.pickSection }} />
      <AttendanceStack.Screen name="StudentProfile" component={StudentProfileScreen} options={{ title: STR.spTitle }} />
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
      <ClassTestStack.Screen name="MyCtQuestions" component={MyCtQuestionsScreen} options={{ title: STR.cqMyTitle }} />
      <ClassTestStack.Screen name="CtQuestionRequest" component={CtQuestionRequestScreen} options={{ title: STR.cqFormTitle }} />
      <ClassTestStack.Screen name="CtQuestionQueue" component={CtQuestionQueueScreen} options={{ title: STR.cqQueueTitle }} />
      <ClassTestStack.Screen
        name="ClassTestResults"
        component={ClassTestResultsScreen}
        options={({ route }) => ({ title: route.params.title || STR.ctResultsTitle })}
      />
      <ClassTestStack.Screen
        name="ClassTestResultsView"
        component={ClassTestResultsViewScreen}
        options={({ route }) => ({ title: route.params.title || STR.ctViewResults })}
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
      <ClassTestStack.Screen name="StudentProfile" component={StudentProfileScreen} options={{ title: STR.spTitle }} />
      {/* Answer-script archive (AR-1..AR-4, D-#443–#447) — this stack because its
          audience is exactly this tab's gate (tracker:* teachers + roster:manage). */}
      <ClassTestStack.Screen name="ArchiveHome" component={ArchiveHomeScreen} options={{ title: STR.arHomeTitle }} />
      <ClassTestStack.Screen name="ArchiveFileBundle" component={FileBundleScreen} options={{ title: STR.arFileTitle }} />
      <ClassTestStack.Screen name="ArchiveBundle" component={BundleDetailScreen} options={{ title: STR.arBundleTitle }} />
      <ClassTestStack.Screen name="ArchiveBox" component={StorageBoxScreen} options={{ title: STR.arBoxTitle }} />
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
      <CommentsStack.Screen name="CommentReview" component={CommentReviewScreen} options={{ title: STR.cmReview }} />
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
      <ObservationStack.Screen name="MyObservations" component={MyObservationsScreen} options={{ title: STR.obsMyObservationsTitle }} />
      <ObservationStack.Screen name="AllObservations" component={AllObservationsScreen} options={{ title: STR.obsAllObservationsTitle }} />
      <ObservationStack.Screen name="UploadObservation" component={UploadObservationScreen} options={{ title: STR.obsUploadTitle }} />
      <ObservationStack.Screen name="ObservationReviewQueue" component={ObservationReviewQueueScreen} options={{ title: STR.obsQueueTitle }} />
      <ObservationStack.Screen name="MyReviewHistory" component={MyReviewHistoryScreen} options={{ title: STR.obsMyReviewsTitle }} />
      <ObservationStack.Screen name="ObservationRota" component={ObservationRotaScreen} options={{ title: STR.obsRotaTitle }} />
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
      <ObservationStack.Screen
        name="CompareObservations"
        component={CompareObservationsScreen}
        options={({ route }) => ({ title: route.params.title || STR.obsCompareTitle })}
      />
      <ObservationStack.Screen name="ObservationTrend" component={ObservationTrendScreen} options={{ title: STR.obsTrendTitle }} />
      <ObservationStack.Screen name="ObservationDueList" component={ObservationDueListScreen} options={{ title: STR.obsDueListTitle }} />
      <ObservationStack.Screen name="ReviewerEffectiveness" component={ReviewerEffectivenessScreen} options={{ title: STR.obsReviewerEffTitle }} />
      <ObservationStack.Screen name="ObservationConfig" component={ObservationConfigScreen} options={{ title: STR.obsEscalationTitle }} />
    </ObservationStack.Navigator>
  );
}

const FreeMixingStack = createNativeStackNavigator<FreeMixingStackParamList>();
function FreeMixingNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <FreeMixingStack.Navigator screenOptions={stackOptions}>
      <FreeMixingStack.Screen name="FreeMixingHome" component={FreeMixingHomeScreen} options={{ title: STR.vrTitle }} />
    </FreeMixingStack.Navigator>
  );
}

const EnglishDriveStack = createNativeStackNavigator<EnglishDriveStackParamList>();
function EnglishDriveNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <EnglishDriveStack.Navigator screenOptions={stackOptions}>
      <EnglishDriveStack.Screen
        name="EnglishDriveHome"
        component={EnglishDriveHomeScreen}
        options={{ title: STR.edTitle }}
      />
      <EnglishDriveStack.Screen
        name="EnglishDriveDoc"
        component={EnglishDriveDocScreen}
        options={({ route }) => ({ title: route.params.title || STR.edTitle })}
      />
      <EnglishDriveStack.Screen
        name="EnglishDriveUpload"
        component={EnglishDriveUploadScreen}
        options={{ title: STR.edUploadTitle }}
      />
    </EnglishDriveStack.Navigator>
  );
}

const TeachingNotesStack = createNativeStackNavigator<TeachingNotesStackParamList>();
function TeachingNotesNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    // TeachingNotesHome stays FIRST: the first registered screen is the stack's
    // initial route, and a param-requiring screen there crashes the tab at runtime.
    <TeachingNotesStack.Navigator screenOptions={stackOptions}>
      <TeachingNotesStack.Screen
        name="TeachingNotesHome"
        component={TeachingNotesHomeScreen}
        options={{ title: STR.tnTitle }}
      />
      <TeachingNotesStack.Screen
        name="TeachingNoteDoc"
        component={TeachingNoteDocScreen}
        options={({ route }) => ({ title: route.params.title || STR.tnTitle })}
      />
      <TeachingNotesStack.Screen
        name="TeachingNoteUpload"
        component={TeachingNoteUploadScreen}
        options={{ title: STR.tnUploadTitle }}
      />
      <TeachingNotesStack.Screen
        name="TeachingNoteOpenComments"
        component={TeachingNoteOpenCommentsScreen}
        options={{ title: STR.tnOpenComments }}
      />
    </TeachingNotesStack.Navigator>
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
      <HrStack.Screen name="NeedsCoverInbox" component={NeedsCoverInboxScreen} options={{ title: STR.hrNeedsCoverTitle }} />
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

// D-#309: the Principal/Office Reports hub — launcher + the four pending-work
// reports (each a filtered slice of the reconciliationReport read).
const ReportsStack = createNativeStackNavigator<ReportsStackParamList>();
function ReportsNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <ReportsStack.Navigator screenOptions={stackOptions}>
      <ReportsStack.Screen name="ReportsHome" component={ReportsHomeScreen} options={{ title: STR.tabReports }} />
      <ReportsStack.Screen name="HwDeclarePending" component={PendingReportScreen} options={{ title: STR.rptHwDeclarePending }} />
      <ReportsStack.Screen name="HwIssuePending" component={PendingReportScreen} options={{ title: STR.rptHwIssuePending }} />
      <ReportsStack.Screen name="AsDeclarePending" component={PendingReportScreen} options={{ title: STR.rptAsDeclarePending }} />
      <ReportsStack.Screen name="AsDeliverPending" component={PendingReportScreen} options={{ title: STR.rptAsDeliverPending }} />
      <ReportsStack.Screen name="AsPrintPending" component={PendingReportScreen} options={{ title: STR.rptAsPrintPending }} />
      {/* D-#311: in-stack mounts of the attendance/class-note reports so the hub's
          back button returns HERE (a cross-tab jump popped to the host tab's home). */}
      <ReportsStack.Screen name="AttendanceReport" component={AttendanceReportScreen} options={{ title: STR.attReportTitle }} />
      <ReportsStack.Screen name="ClassNoteReport" component={ClassNoteReportScreen} options={{ title: STR.rtNoteReportTitle }} />
      <ReportsStack.Screen name="DailyNote" component={DailyNoteScreen} options={{ title: STR.dailyNoteTitle }} />
      <ReportsStack.Screen name="TeacherClassLoad" component={TeacherClassLoadScreen} options={{ title: STR.clTitle }} />
      <ReportsStack.Screen name="TeacherClassLoadDetail" component={TeacherClassLoadDetailScreen} options={{ title: STR.clTitle }} />
      <ReportsStack.Screen name="ReconciliationReport" component={ReconciliationReportScreen} options={{ title: STR.rrTitle }} />
      <ReportsStack.Screen name="HwLifecycleReport" component={HwLifecycleReportScreen} options={{ title: STR.hlrTitle }} />
      <ReportsStack.Screen name="AssignmentLoadReport" component={AssignmentLoadReportScreen} options={{ title: STR.alReportTitle }} />
      {/* D-#340: the class-test oversight report. */}
      <ReportsStack.Screen name="ClassTestReport" component={ClassTestReportScreen} options={{ title: STR.ctReportTitle }} />
      {/* MR-5b. Registered AFTER the param-free screens on purpose: a screen whose
          params are required must never sit in the stack's initial slot. */}
      <ReportsStack.Screen name="MonthlyReportConsole" component={MonthlyReportConsoleScreen} options={{ title: STR.mrConsoleTitle }} />
      <ReportsStack.Screen name="MonthlyReportDetail" component={MonthlyReportDetailScreen} options={{ title: STR.mrConsoleTitle }} />
      <ReportsStack.Screen name="MonthlyPendingWork" component={MonthlyPendingWorkScreen} options={{ title: STR.mpTitle }} />
      {/* D-#453: the weekly unsubmitted-homework report (guardian-digest staff twin). */}
      <ReportsStack.Screen name="HwWeeklyUnsubmitted" component={HwWeeklyUnsubmittedScreen} options={{ title: STR.hwwdTitle }} />
    </ReportsStack.Navigator>
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
      <AdminStack.Screen name="SupervisoryGrant" component={SupervisoryGrantScreen} options={{ title: STR.sgManage }} />
      <AdminStack.Screen name="Roster" component={RosterScreen} options={{ title: STR.roster }} />
      <AdminStack.Screen name="Staff" component={StaffListScreen} options={{ title: STR.staff }} />
      <AdminStack.Screen name="StaffForm" component={StaffFormScreen} options={{ title: STR.staffNew }} />
      <AdminStack.Screen name="AssignClassTeacher" component={AssignClassTeacherScreen} options={{ title: STR.assignClassTeacher }} />
      <AdminStack.Screen name="AssignSubjectTeacher" component={AssignSubjectTeacherScreen} options={{ title: STR.assignSubjectTeacher }} />
      <AdminStack.Screen name="GroupMembers" component={GroupMembersScreen} options={{ title: STR.gmTitle }} />
      <AdminStack.Screen name="AcademicYear" component={AcademicYearScreen} options={{ title: STR.ayManage }} />
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
      <AdminStack.Screen name="AuditLog" component={AuditLogScreen} options={{ title: STR.audTitle }} />
      <AdminStack.Screen
        name="GuardianEngagement"
        component={GuardianEngagementScreen}
        options={{ title: STR.geTitle }}
      />
      <AdminStack.Screen name="SystemHealth" component={SystemHealthScreen} options={{ title: STR.shTitle }} />
      <AdminStack.Screen name="ReconciliationReport" component={ReconciliationReportScreen} options={{ title: STR.rrTitle }} />
      <AdminStack.Screen name="HwLifecycleReport" component={HwLifecycleReportScreen} options={{ title: STR.hlrTitle }} />
      <AdminStack.Screen name="AttendanceRanking" component={AttendanceRankingScreen} options={{ title: STR.arTitle }} />
      <AdminStack.Screen name="SectionPicker" component={SectionPickerScreen} options={{ title: STR.pickSection }} />
      <AdminStack.Screen name="StudentProfile" component={StudentProfileScreen} options={{ title: STR.spTitle }} />
    </AdminStack.Navigator>
  );
}

// --- Support-book production (SB-2..SB-4) ------------------------------------
// Its own stack + drawer group. These four screens used to be cards in the Admin
// hub, which put them behind the Admin tab's ROLE-TEMPLATE gate (content:import /
// user:manage) — a gate no granted illustrator or reviewer passes, so the screens
// were unreachable for them. All four are param-free, so the initial slot is safe.
const SupportBookStack = createNativeStackNavigator<SupportBookStackParamList>();
function SupportBookNavigator(): React.ReactElement {
  const stackOptions = useStackOptions();
  return (
    <SupportBookStack.Navigator screenOptions={stackOptions}>
      {/* SB-1 first: a book has to EXIST before any other screen here means anything.
          Param-free, so its position in the initial slot is safe. */}
      <SupportBookStack.Screen name="BookImport" component={BookImportScreen} options={{ title: STR.sbImportTitle }} />
      <SupportBookStack.Screen name="BookPolicy" component={BookPolicyScreen} options={{ title: STR.sbPolicyTitle }} />
      <SupportBookStack.Screen name="BookImageQueue" component={BookImageQueueScreen} options={{ title: STR.sbQueueTitle }} />
      <SupportBookStack.Screen name="BookReview" component={BookReviewScreen} options={{ title: STR.sbReviewTitle }} />
      <SupportBookStack.Screen name="BookEscalationInbox" component={BookEscalationInboxScreen} options={{ title: STR.sbInboxTitle }} />
      <SupportBookStack.Screen name="BookAssemble" component={BookAssembleScreen} options={{ title: STR.sbAssembleTitle }} />
    </SupportBookStack.Navigator>
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
        <GuardianHomeStack.Screen name="ChildAttendance" component={ChildAttendanceScreen} options={{ title: STR.gpAttendance }} />
        <GuardianHomeStack.Screen name="ChildFees" component={ChildFeesScreen} options={{ title: STR.gpFees }} />
        <GuardianHomeStack.Screen name="ChildLeave" component={ChildLeaveScreen} options={{ title: STR.gpLeave }} />
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

// --- Drawer (D-#258) -------------------------------------------------------

const Drawer = createDrawerNavigator<TabParamList>();

export function AppTabs(): React.ReactElement {
  // `isRole` rather than `role ===` for the gates below (D-#467): with a view mode on it
  // answers for the chosen hat, and with none it answers for EVERY template the login
  // holds — so a teacher who also runs the office desk gets the office-only tabs in the
  // "everything" view instead of only what their primary role template carries.
  const { role, isRole, can, logout } = useAuth();
  const colors = useColors();
  // Free Mixing Observation tab (D-#341, owner ruling): a TEACHER sees it ONLY
  // when at least one video is assigned to them; Principal/Office always.
  const [freeMixQ] = useQuery({
    query: MY_VIDEO_REVIEWS,
    pause: !isRole("TEACHER"),
  });
  // English Drive tab (D-#344): P/O always; a TEACHER only when the server says
  // they have an English involvement in at least one class (PRD §5).
  const [engDriveQ] = useQuery({
    query: ENGLISH_DRIVE_MY_CLASS_LEVELS,
    pause: !isRole("TEACHER"),
  });
  // Notes & guides tab (TN-1): P/O always; a TEACHER only when the server says
  // they hold at least one (class × subject) pair — the same probe the picker uses.
  const [teachingNotesQ] = useQuery({
    query: TEACHING_NOTE_MY_SCOPE,
    pause: !isRole("TEACHER"),
  });
  // Permanent left sidebar on laptop/desktop web; slide-over (☰) on phone/narrow.
  const { width } = useWindowDimensions();
  const wide = width >= DRAWER_PERMANENT_MIN_WIDTH;
  // Web-only collapse (shared with the content Screen via SidebarProvider): the ☰
  // flips `collapsed`; the drawer width goes 300↔0 and the body reflows to fill.
  const { collapsed } = useSidebar();

  const canContent = can("content:read");
  const canQuestions = can("question:read");
  const canSets = can("set:read");
  const canTrackers = can("tracker:read");
  const canHomework = can("tracker:read");
  // Assignment tab: teachers/Principal via tracker:read; OFFICE via roster:manage
  // (Office owns the schedule + the D-#88 follow-up; it holds no tracker:* — D-#94).
  const canAssignment =
    !!role && (can("tracker:read") || can("roster:manage"));
  const canReview =
    !!role && (can("content:review") || can("content:assign_review"));
  const canRoutine = can("routine:read");
  const canAttendance =
    !!role && (can("attendance:mark") || can("attendance:manage"));
  const canLibrary = can("library:read");
  // PQ-4: teachers file print requests (tracker:write); Office/Principal work the
  // queue (roster:manage). Same gates as the class-test print flow — no new permission.
  const canPrint =
    !!role && (can("tracker:write") || can("roster:manage"));
  // Chat (M-5): Principal/Teacher/Office hold chat:read; GUARDIAN never does.
  const canChat = can("chat:read");
  // Vocab (VC-5): Principal/Teacher via tracker:read (reports/build/mark); Office via
  // roster:manage (the weekly tester assignment + message:dispatch generation). Every
  // action is re-gated server-side. GUARDIAN never sees this staff tab.
  const canVocab = !!role && (can("tracker:read") || can("roster:manage"));
  // Class Test (CT-5): Principal/Teacher via tracker:read (request/results/publish/
  // reports); Office via roster:manage (print queue + dashboard + overdue-chase).
  // Every action is re-gated server-side. GUARDIAN never sees this staff tab.
  const canClassTest = !!role && (can("tracker:read") || can("roster:manage"));
  // Comments + Parents-Meeting (CM-6): Principal/Teacher via tracker:read (daily
  // comments + comparison reads); Office via roster:manage (the parents'-meeting
  // admin). Every action is re-gated server-side. GUARDIAN never sees this staff tab.
  const canComments = !!role && (can("tracker:read") || can("roster:manage"));
  // Classroom Observation (CO app surfaces): any holder of an observation:* perm —
  // Principal/Office (upload/read/manage) and the senior-teacher observer (review/read).
  // GUARDIAN holds none. Every action is re-gated + row-scoped server-side.
  const canObservation =
    !!role &&
    (can("observation:read") ||
      can("observation:upload") ||
      can("observation:review") ||
      can("observation:manage"));
  // Free Mixing Observation: Principal/Office (assign+board) always; a teacher
  // only once something is actually assigned to them (owner ruling 2026-07-20).
  const canFreeMixing =
    (can("observation:upload")) ||
    (isRole("TEACHER") && (freeMixQ.data?.myVideoReviews.length ?? 0) > 0);
  // English Drive (D-#344): upload = roster:manage (P/O); a teacher sees the tab
  // only when the server-resolved English class set is non-empty. GUARDIAN never.
  const canEnglishDrive =
    (can("roster:manage")) ||
    (isRole("TEACHER") && (engDriveQ.data?.englishDriveMyClassLevels.length ?? 0) > 0);
  // Notes & guides (TN-1): upload = roster:manage (P/O); a teacher sees the tab
  // only when their (class × subject) pair set is non-empty. GUARDIAN never.
  const canTeachingNotes =
    can("roster:manage") ||
    (isRole("TEACHER") && (teachingNotesQ.data?.teachingNoteMyScope.length ?? 0) > 0);
  // Saturday Qur'an-Hifz Revision (SR app surfaces): Hifz teachers via tracker:read
  // (record/edit/deliver/history); Principal/Office via roster:manage (dashboards +
  // completeness chase). Every action is re-gated + row-scoped server-side. GUARDIAN
  // holds neither — the guardian read is a card on the guardian Home tab, not here.
  const canRevision =
    !!role && (can("tracker:read") || can("roster:manage"));
  // Finance (FIN-6B): finance:manage is Principal+Office only (AC-1 may grant it to
  // the accountant alone). GUARDIAN never holds it, so the tab is hidden for guardians.
  // Every action is re-gated + row-scoped server-side.
  const canFinance = can("finance:manage");
  // HR/staff tab: every logged-in staff member (Principal/Teacher/Office) — leave
  // + self-service is universal; GUARDIAN never sees it. Admin entries inside are
  // permission-gated per slice and re-checked server-side.
  const canHr = !!role && role !== "GUARDIAN";
  // Today dashboard (UX-4): every staff login lands here; each card inside degrades
  // to empty/zero server-side when the caller lacks the underlying permission.
  const canHome = !!role && role !== "GUARDIAN";
  const canAdmin = !!role && (can("content:import") || can("user:manage"));
  // Support-book production: gated on the caller's EFFECTIVE permissions, never the
  // role template — `book:*` sits only on the PRINCIPAL template and every
  // illustrator/reviewer/assembler reaches it by AC-1 grant (D-#405), so
  // `roleHasPermission` would hide the tab from everyone who actually works the
  // pipeline. Each leaf inside re-checks its own grant (DrawerContent `perms`), and
  // every resolver re-gates server-side — hiding a tab is a courtesy, not the gate.
  const canSupportBook =
    can("book:illustrate") || can("book:review") || can("book:review_senior") ||
    can("book:assemble") || can("book:author") || can("book:manage");
  // D-#309: the Reports hub — school-wide oversight reads, Principal/Office by
  // ROLE (the reconciliationReport resolver's own gate; OFFICE holds no tracker:read).
  // D-#467: template-aware, so an OFFICE template added to a teacher actually delivers
  // this tab — a bare `role ===` compared only the primary role and silently hid it.
  const canReports = isRole("PRINCIPAL") || isRole("OFFICE");
  // GP-2 (D-#68): the GUARDIAN role holds ONLY guardian:read_child, so every
  // staff gate above is false for guardians — the guardian tab set is all they see.
  const canGuardian = can("guardian:read_child");

  // Defensive (D-#369): a role-less / unrecognised authed session makes EVERY tab
  // gate false, which would mount an empty Drawer.Navigator and hard-crash the app
  // ("Couldn't find any screens for the navigator" — confirmed via GlitchTip
  // 2026-07-28, a guardian whose me.role came back null). Never render an empty
  // drawer: fall back to a recover-by-re-login screen instead of crashing.
  const hasAnyTab =
    canHome || canContent || canQuestions || canSets || canTrackers || canHomework ||
    canAssignment || canReview || canRoutine || canAttendance || canPrint || canLibrary ||
    canChat || canVocab || canClassTest || canComments || canObservation || canFreeMixing ||
    canEnglishDrive || canTeachingNotes || canRevision || canFinance || canHr || canReports ||
    canSupportBook || canAdmin || canGuardian;
  if (!hasAnyTab) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space(6), backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: space(4) }} />
        <Text style={{ ...typeScale.sectionTitle, color: colors.textPrimary, textAlign: "center", marginBottom: space(3) }}>
          {STR.sessionRecoverTitle}
        </Text>
        <Text style={{ ...typeScale.body, color: colors.textSecondary, textAlign: "center", marginBottom: space(5) }}>
          {STR.sessionRecoverBody}
        </Text>
        <Pressable
          onPress={() => void logout()}
          accessibilityRole="button"
          style={{ backgroundColor: colors.primary, paddingVertical: space(3), paddingHorizontal: space(6), borderRadius: radius.md }}
        >
          <Text style={{ ...typeScale.button, color: colors.onPrimary }}>{STR.sessionRecoverAction}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <GuardianChildProvider enabled={role === "GUARDIAN"}>
      <Drawer.Navigator
        // The grouped/collapsible sidebar; route names are unchanged so notification
        // deep-links + cross-screen navigation keep working (see DrawerContent).
        drawerContent={(props) => <DrawerContent {...props} />}
        screenOptions={{
          headerShown: false,
          // Permanent push-sidebar on web (the ☰ collapses it to width 0 so the body
          // reflows to full width); slide-over overlay on phone.
          drawerType: wide ? "permanent" : "front",
          drawerStyle: {
            backgroundColor: colors.surface,
            width: wide ? (collapsed ? 0 : 300) : 300,
            borderRightColor: colors.border,
            borderRightWidth: wide && !collapsed ? 1 : 0,
            overflow: "hidden",
          },
          overlayColor: "rgba(0,0,0,0.4)",
          swipeEdgeWidth: 60,
        }}
      >
        {/* Registered FIRST → the drawer's initial route: staff land on Today (UX-4). */}
        {canHome ? <Drawer.Screen name="HomeTab" component={HomeNavigator} /> : null}
        {canContent ? <Drawer.Screen name="ContentTab" component={ContentNavigator} /> : null}
        {canQuestions ? <Drawer.Screen name="QuestionsTab" component={QuestionsNavigator} /> : null}
        {canSets ? <Drawer.Screen name="SetsTab" component={SetsNavigator} /> : null}
        {canTrackers ? <Drawer.Screen name="TrackersTab" component={TrackersNavigator} /> : null}
        {canHomework ? <Drawer.Screen name="HomeworkTab" component={HomeworkNavigator} /> : null}
        {canAssignment ? <Drawer.Screen name="AssignmentTab" component={AssignmentNavigator} /> : null}
        {canReview ? <Drawer.Screen name="ReviewTab" component={ReviewNavigator} /> : null}
        {canRoutine ? <Drawer.Screen name="RoutineTab" component={RoutineNavigator} /> : null}
        {canAttendance ? <Drawer.Screen name="AttendanceTab" component={AttendanceNavigator} /> : null}
        {/* UX-8: same gate as the DailyNote path (routine:read). */}
        {canRoutine ? <Drawer.Screen name="ClassNotesTab" component={ClassNotesNavigator} /> : null}
        {canPrint ? <Drawer.Screen name="PrintTab" component={PrintNavigator} /> : null}
        {canLibrary ? <Drawer.Screen name="LibraryTab" component={LibraryNavigator} /> : null}
        {canChat ? <Drawer.Screen name="ChatTab" component={ChatNavigator} /> : null}
        {canVocab ? <Drawer.Screen name="VocabTab" component={VocabNavigator} /> : null}
        {canClassTest ? <Drawer.Screen name="ClassTestTab" component={ClassTestNavigator} /> : null}
        {canComments ? <Drawer.Screen name="CommentsTab" component={CommentsNavigator} /> : null}
        {canObservation ? <Drawer.Screen name="ObservationTab" component={ObservationNavigator} /> : null}
        {/* Free Mixing Observation (D-#341) — P/O always; a teacher only when assigned. */}
        {canFreeMixing ? <Drawer.Screen name="FreeMixingTab" component={FreeMixingNavigator} /> : null}
        {/* English Drive (D-#344) — P/O always; a teacher only with an ENG class. */}
        {canEnglishDrive ? <Drawer.Screen name="EnglishDriveTab" component={EnglishDriveNavigator} /> : null}
        {canTeachingNotes ? <Drawer.Screen name="TeachingNotesTab" component={TeachingNotesNavigator} /> : null}
        {canRevision ? <Drawer.Screen name="RevisionTab" component={RevisionNavigator} /> : null}
        {canFinance ? <Drawer.Screen name="FinanceTab" component={FinanceNavigator} /> : null}
        {canHr ? <Drawer.Screen name="HrTab" component={HrNavigator} /> : null}
        {canReports ? <Drawer.Screen name="ReportsTab" component={ReportsNavigator} /> : null}
        {/* SB-2..SB-4 — effective-permission gate, see canSupportBook above. */}
        {canSupportBook ? <Drawer.Screen name="SupportBookTab" component={SupportBookNavigator} /> : null}
        {canAdmin ? <Drawer.Screen name="AdminTab" component={AdminNavigator} /> : null}
        {canGuardian ? <Drawer.Screen name="GuardianHomeTab" component={GuardianHomeNavigator} /> : null}
        {canGuardian ? <Drawer.Screen name="GuardianHomeworkTab" component={GuardianHomeworkNavigator} /> : null}
        {canGuardian ? <Drawer.Screen name="GuardianRoutineTab" component={GuardianRoutineNavigator} /> : null}
        {canGuardian ? (
          <Drawer.Screen name="GuardianAssignmentsTab" component={GuardianAssignmentsNavigator} />
        ) : null}
      </Drawer.Navigator>
    </GuardianChildProvider>
  );
}
