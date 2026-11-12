/**
 * Custom drawer content (D-#258) — the EximusEdu-familiar grouped sidebar.
 *
 * Replaces React Navigation's default flat drawer-item list with collapsible
 * module GROUPS (Academics, Trackers, Reports) plus flat standalone items
 * (Attendance, Library, Finance, HR, …). It renders ONLY the routes the role actually holds:
 * the Drawer.Navigator registers a Drawer.Screen for a module only when its
 * permission gate passes (unchanged from the old bottom-tab gating), so
 * `state.routeNames` already reflects the role — we filter the config against it
 * and drop any group left empty. Staff + guardian route sets are mutually
 * exclusive, so one concatenated config serves both.
 *
 * Styling reuses the existing theme tokens (palette kept — D-#258); the active
 * route is tinted with `primaryContainer`.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { DrawerContentScrollView, type DrawerContentComponentProps } from "@react-navigation/drawer";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery } from "urql";
import type { Role } from "@scd/shared";

import { STR } from "../lib/labels";
import { bnNum } from "../lib/labels";
import { PRINT_QUEUE_COUNTS } from "../graphql/printing";
import { CT_QUESTION_COUNTS, CLASS_TEST_OVERDUE_COUNTS } from "../graphql/classTest";
import { STAFF_LEAVE_PENDING_COUNT, COMMENT_REVIEW_COUNT, OBSERVATION_COUNTS } from "../graphql/operations";
import { MY_SYLLABUS_APPROVAL_COUNT } from "../graphql/examSyllabus";
import { MY_WORK_BOARD_COUNTS } from "../graphql/workBoard";
import { subscribeLiveEvents } from "../lib/liveEvents";
import { useAuth } from "../auth/AuthContext";
import { useBasket } from "../state/BasketContext";
import { fonts, radius, space, typeScale, useColors } from "../theme";
import type { TabParamList } from "./types";
import { REPORT_LEAF_ACTIONS } from "../lib/navGates";
import { MY_NAV_PREFERENCE, RECORD_NAV_USE, RESET_NAV_PREFERENCE, SAVE_NAV_PREFERENCE } from "../graphql/navPreference";
import {
  DEFAULT_NAV_PREFS,
  moveKey,
  orderByKeys,
  orderByUse,
  togglePinned,
  type NavMode,
  type NavPrefs,
} from "../lib/navArrange";
import { friendlyError } from "../lib/errors";
import { Button } from "../components/ui";

type RouteName = keyof TabParamList;
type LabelKey = keyof typeof STR;

/**
 * `screen` (optional) deep-links to a screen INSIDE the route's stack (with
 * `initial: false`, so back returns to the stack's home — the D-#311 lesson).
 * Used by the Reports group, whose leaves all live in the one ReportsTab stack.
 */
/**
 * `perms` (optional) is an ANY-OF gate on the caller's EFFECTIVE permissions. The
 * route-level gate in AppTabs decides whether a tab exists at all; inside a tab
 * whose leaves are handed out per user (support-book production — D-#405), it is
 * too coarse: an assembler must not be shown the reviewer's queue. Leaves without
 * `perms` stay purely route-gated, as every leaf was before.
 */
/**
 * `hidden` (optional, owner ask 2026-10-04) takes an entry off the sidebar for
 * everyone WITHOUT unregistering its route — notification deep links and in-app
 * links into it keep working. Delete the flag to bring the entry back.
 */
/** `perms` is ANY-of; `allOf` adds actions that must ALL be held too — the target
 *  screen's first read when it differs from the action that names the leaf
 *  (owner rule 2026-10-25: no leaf onto a refusal). */
type NavLeaf = {
  route: RouteName;
  labelKey: LabelKey;
  icon: string;
  screen?: string;
  perms?: string[];
  allOf?: string[];
  hidden?: boolean;
};
type NavSection =
  | ({ type: "item" } & NavLeaf)
  | { type: "group"; titleKey: LabelKey; icon: string; items: NavLeaf[]; hidden?: boolean };

/**
 * Module grouping. Names lean on EximusEdu vocabulary for familiarity; the leaf
 * labels reuse the existing `tab*` STR keys (so no double-translation), except
 * the generic Trackers tab which is shown as "Daily Tracker" to disambiguate it
 * from the "Trackers" group header.
 */
const STAFF_NAV: NavSection[] = [
  { type: "item", route: "HomeTab", labelKey: "drawerItemToday", icon: "🏠" },
  {
    type: "group",
    titleKey: "drawerGroupAcademics",
    icon: "📖",
    items: [
      { route: "ContentTab", labelKey: "tabContent", icon: "📚" },
      { route: "QuestionsTab", labelKey: "tabQuestions", icon: "❓" },
      { route: "SetsTab", labelKey: "tabSets", icon: "🗂️" },
      { route: "ReviewTab", labelKey: "tabReview", icon: "📝" },
      { route: "RoutineTab", labelKey: "tabRoutine", icon: "📅" },
      { route: "VocabTab", labelKey: "tabVocab", icon: "🔤" },
      // English Drive (D-#344) — entry point per owner decision #9.
      { route: "EnglishDriveTab", labelKey: "tabEnglishDrive", icon: "🅰️" },
      // Notes & guides (TN-1) — the (class × subject) teacher note library.
      { route: "TeachingNotesTab", labelKey: "tabTeachingNotes", icon: "📓" },
    ],
  },
  {
    type: "group",
    titleKey: "drawerGroupTrackers",
    icon: "✅",
    items: [
      { route: "TrackersTab", labelKey: "drawerItemDailyTracker", icon: "✅" },
      { route: "HomeworkTab", labelKey: "tabHomework", icon: "📒" },
      { route: "AssignmentTab", labelKey: "tabAssignment", icon: "📋" },
      { route: "ClassTestTab", labelKey: "tabClassTest", icon: "🧪" },
      // SP-1 (D-#734) — Office / Principal only; lives in the Class Test stack.
      { route: "ClassTestTab", labelKey: "impNavTitle", icon: "📈", screen: "StudentProgress", perms: ["improvement_plan:view_all"] },
      { route: "RevisionTab", labelKey: "tabRevision", icon: "🕌" },
    ],
  },
  // Exam syllabus (SY-4..SY-6). Three leaves in one stack — the Reports shape.
  // `সিলেবাস দেখুন` is every staff role; the other two carry their own perms, so
  // a plain teacher sees only the read leaf.
  {
    type: "group",
    titleKey: "syDrawerGroup",
    icon: "📋",
    items: [
      { route: "SyllabusTab", labelKey: "syRead", icon: "📋", screen: "SyllabusHome" },
      // D-#883: the exam routine (general + Quran exam days), beside the syllabus.
      { route: "SyllabusTab", labelKey: "exrNav", icon: "🗓️", screen: "ExamRoutine", perms: ["exam_routine:view", "exam_routine:manage", "exam_routine:publish"] },
      { route: "SyllabusTab", labelKey: "syExamManage", icon: "🗓️", screen: "SyllabusExams", perms: ["exam_syllabus:settings"] },
      { route: "SyllabusTab", labelKey: "syEntry", icon: "✍️", screen: "SyllabusEntry", perms: ["exam_syllabus:edit"] },
      { route: "SyllabusTab", labelKey: "syApprovals", icon: "✅", screen: "SyllabusApprovals" },
      // Exams EX-1..EX-9 (D-#375–#382): marks, recheck, custody chain, report cards — one stack.
      { route: "ExamsTab", labelKey: "tabExams", icon: "📝", perms: ["exam_results:view", "exam_custody:view"] },
      // D-#1031: draft papers — every staff member may be a reviewer (their list is just their own).
      { route: "ExamPapersTab", labelKey: "epNav", icon: "📝", screen: "ExamPapersHome", perms: ["exam_papers:review", "exam_papers:view", "exam_papers:manage"] },
      // D-#1030: Mohammadpur's past papers (Office by default).
      { route: "ExamPapersTab", labelKey: "epRefNav", icon: "📂", screen: "ReferencePapers", perms: ["exam_papers:view_reference", "exam_papers:manage_reference"] },
    ],
  },
  {
    type: "group",
    titleKey: "scDrawerGroup",
    icon: "🎓",
    items: [
      { route: "ScholarshipTab", labelKey: "scPapers", icon: "🎓", screen: "ScholarshipHome", perms: ["scholarship_practice:view"] },
      {
        route: "ScholarshipTab",
        labelKey: "scTopics",
        icon: "🏷️",
        screen: "ScholarshipTopics",
        perms: ["scholarship_practice:settings"],
        allOf: ["scholarship_practice:view"],
      },
    ],
  },
  // Quran oral exam (D-#873): the Office's plan/monitor and the examiner's own duties share one tab.
  { type: "item", route: "QuranExamTab", labelKey: "qxNav", icon: "🕋", perms: ["quran_exam:view", "quran_exam:manage", "quran_exam:examine"] },
  // Nursery & KG oral exam (D-#1080): papers, examiners, live marks — one tab for Office and examiners.
  { type: "item", route: "VivaTab", labelKey: "vivaNav", icon: "🗣️", perms: ["viva:view", "viva:manage", "viva:examine"] },
  // AI-6 (D-#1096): the AI teacher assistant — own conversations; the Principal reads all.
  { type: "item", route: "AiAssistTab", labelKey: "aasNav", icon: "🤖", perms: ["ai_assist:chat", "ai_assist:read_all_chats"] },
  // AI Workspace (docs/prd-ai-workspace.md, D-#1208): projects + files + instructions; the Principal at launch.
  { type: "item", route: "AiWorkspaceTab", labelKey: "awNav", icon: "🧠", perms: ["ai_workspace:use", "ai_workspace:admin"] },
  // Mastery tracker (M-0, docs/prd-mastery.md): catalogue + marks, import, tags, policy & switch.
  {
    type: "group",
    titleKey: "msDrawerGroup",
    icon: "🎯",
    items: [
      {
        route: "MasteryTab",
        labelKey: "msWork",
        icon: "✍️",
        screen: "MasteryWork",
        perms: ["mastery:enter_results"],
        allOf: ["mastery:view"],
      },
      {
        route: "MasteryTab",
        labelKey: "msLeader",
        icon: "🧭",
        screen: "MasteryLeader",
        perms: ["mastery:approve"],
        allOf: ["mastery:view"],
      },
      { route: "MasteryTab", labelKey: "msCatalogueHome", icon: "📚", screen: "MasteryHome", perms: ["mastery:view"] },
      { route: "MasteryTab", labelKey: "msImport", icon: "📥", screen: "MasteryImport", perms: ["mastery:settings"] },
      // OT-2: the objective-list review — the assigned reviewer (per-person grant) and the Principal.
      { route: "MasteryTab", labelKey: "msRvNav", icon: "📝", screen: "MasteryReviews", perms: ["mastery:review", "mastery:settings"] },
      { route: "MasteryTab", labelKey: "msTags", icon: "🏷️", screen: "MasteryTags", perms: ["mastery:view"] },
      { route: "MasteryTab", labelKey: "msPolicy", icon: "⚙️", screen: "MasteryPolicy", perms: ["mastery:view"] },
    ],
  },
  { type: "item", route: "AttendanceTab", labelKey: "tabAttendance", icon: "🙋" },
  { type: "item", route: "PrintTab", labelKey: "tabPrint", icon: "🖨️" },
  // Work board (WB-1..WB-3, D-#701). My board is every staff login; the other three
  // leaves are the assigner's (tasks:assign), gated per leaf like Syllabus.
  {
    type: "group",
    titleKey: "wbTab",
    icon: "🗂️",
    items: [
      { route: "WorkBoardTab", labelKey: "wbMyBoard", icon: "✅", screen: "WorkBoard" },
      { route: "WorkBoardTab", labelKey: "wbAssignedByMe", icon: "📤", screen: "AssignedByMe", perms: ["work_board:assign"] },
      { route: "WorkBoardTab", labelKey: "wbLoad", icon: "📊", screen: "LoadGrid", perms: ["work_board:view_all"] },
      { route: "WorkBoardTab", labelKey: "wbTemplates", icon: "🔁", screen: "TaskTemplates" },
    ],
  },
  // Class Notes became a GROUP (owner ask 2026-08-17): the teacher's own periods,
  // and the filtered archive of every note they may see. Both leaves live in the
  // one ClassNotesTab stack — the Reports-group deep-link shape.
  {
    type: "group",
    titleKey: "drawerItemClassNotes",
    icon: "📓",
    items: [
      { route: "ClassNotesTab", labelKey: "cnMyPeriods", icon: "📓", screen: "MyClassNotes" },
      { route: "ClassNotesTab", labelKey: "cnAllNotesTitle", icon: "🗃️", screen: "AllClassNotes" },
      // LP-2 (D-#824/#826): lesson-plan progress — the Office overview, or a teacher's own শাখা.
      { route: "ClassNotesTab", labelKey: "lpNavTitle", icon: "📘", screen: "LessonProgress", perms: ["lesson_progress:view", "lesson_progress:view_all"] },
    ],
  },
  { type: "item", route: "CommentsTab", labelKey: "tabComments", icon: "🗣️" },
  { type: "item", route: "ObservationTab", labelKey: "tabObservation", icon: "👁️" },
  { type: "item", route: "FreeMixingTab", labelKey: "tabFreeMixing", icon: "🎥", hidden: true },
  { type: "item", route: "LibraryTab", labelKey: "tabLibrary", icon: "📖" },
  // SB-1 (D-#980): the storybook series catalogue (library:view; Office manages it).
  { type: "item", route: "StorybooksTab", labelKey: "stbNav", icon: "🧸" },
  // AS-1 (D-#988): activity sheets (activity_sheets:view; Office manages banks and the corner).
  { type: "item", route: "ActivityTab", labelKey: "actNav", icon: "🧩" },
  // D-#870: class books (staff read every class's; the Office uploads).
  { type: "item", route: "ClassBooksTab", labelKey: "cbTitle", icon: "📚" },
  { type: "item", route: "ChatTab", labelKey: "tabChat", icon: "💬" },
  // Pop-up notices (D-#852): the sender's list for Office / Principal; আমার বার্তা for every
  // staff login (the pop-ups they received, to read again).
  { type: "item", route: "PopupNoticesTab", labelKey: "ppTitleNav", icon: "📣" },
  { type: "item", route: "HomeTab", screen: "MyPopups", labelKey: "ppMineTitle", icon: "📬" },
  { type: "item", route: "FinanceTab", labelKey: "tabFinance", icon: "💰" },
  { type: "item", route: "HrTab", labelKey: "tabHr", icon: "🧑‍💼" },
  {
    type: "group",
    titleKey: "tabReports",
    icon: "📊",
    items: [
      { route: "ReportsTab", labelKey: "clTitle", icon: "🧑‍🏫", screen: "TeacherClassLoad", perms: REPORT_LEAF_ACTIONS.TeacherClassLoad },
      { route: "ReportsTab", labelKey: "alReportTitle", icon: "📋", screen: "AssignmentLoadReport", perms: REPORT_LEAF_ACTIONS.AssignmentLoadReport },
      // D-#340: the class-test oversight report.
      { route: "ReportsTab", labelKey: "ctReportTitle", icon: "🧪", screen: "ClassTestReport", perms: REPORT_LEAF_ACTIONS.ClassTestReport },
      { route: "ReportsTab", labelKey: "attReportTitle", icon: "🙋", screen: "AttendanceReport", perms: REPORT_LEAF_ACTIONS.AttendanceReport },
      { route: "ReportsTab", labelKey: "rtNoteReportTitle", icon: "📓", screen: "ClassNoteReport", perms: REPORT_LEAF_ACTIONS.ClassNoteReport },
      { route: "ReportsTab", labelKey: "rptHwDeclarePending", icon: "📕", screen: "HwDeclarePending", perms: REPORT_LEAF_ACTIONS.HwDeclarePending },
      { route: "ReportsTab", labelKey: "rptHwIssuePending", icon: "📒", screen: "HwIssuePending", perms: REPORT_LEAF_ACTIONS.HwIssuePending },
      { route: "ReportsTab", labelKey: "rptAsDeclarePending", icon: "📋", screen: "AsDeclarePending", perms: REPORT_LEAF_ACTIONS.AsDeclarePending },
      { route: "ReportsTab", labelKey: "rptAsDeliverPending", icon: "📦", screen: "AsDeliverPending", perms: REPORT_LEAF_ACTIONS.AsDeliverPending },
      { route: "ReportsTab", labelKey: "rptAsPrintPending", icon: "🖨️", screen: "AsPrintPending", perms: REPORT_LEAF_ACTIONS.AsPrintPending },
      // Owner ask 2026-07-20: moved here from the Admin hub.
      { route: "ReportsTab", labelKey: "rrTitle", icon: "🔄", screen: "ReconciliationReport", perms: REPORT_LEAF_ACTIONS.ReconciliationReport },
      { route: "ReportsTab", labelKey: "hlrTitle", icon: "📘", screen: "HwLifecycleReport", perms: REPORT_LEAF_ACTIONS.HwLifecycleReport },
      // D-#453: the weekly unsubmitted-homework report (guardian-digest staff twin).
      { route: "ReportsTab", labelKey: "hwwdTitle", icon: "📅", screen: "HwWeeklyUnsubmitted", perms: REPORT_LEAF_ACTIONS.HwWeeklyUnsubmitted },
      // D-#861: the reports that sat elsewhere (Admin hub, module homes), one switch each.
      { route: "ReportsTab", labelKey: "arTitle", icon: "🏅", screen: "AttendanceRanking", perms: REPORT_LEAF_ACTIONS.AttendanceRanking },
      { route: "ReportsTab", labelKey: "wcQueueTitle", icon: "🏠", screen: "WorkClaimQueue", perms: REPORT_LEAF_ACTIONS.WorkClaimQueue },
      { route: "ReportsTab", labelKey: "lcbBoardTitle", icon: "🟢", screen: "LiveClassBoard", perms: REPORT_LEAF_ACTIONS.LiveClassBoard },
      { route: "ReportsTab", labelKey: "wbLoad", icon: "⚖️", screen: "LoadGrid", perms: REPORT_LEAF_ACTIONS.LoadGrid },
      { route: "ReportsTab", labelKey: "ctDashboardTitle", icon: "🧮", screen: "ClassTestDashboard", perms: REPORT_LEAF_ACTIONS.ClassTestDashboard },
      { route: "ReportsTab", labelKey: "impNavTitle", icon: "📈", screen: "StudentProgress", perms: REPORT_LEAF_ACTIONS.StudentProgress },
      { route: "ReportsTab", labelKey: "lpNavTitle", icon: "📗", screen: "LessonProgress", perms: REPORT_LEAF_ACTIONS.LessonProgress },
      // GH-3 (D-#1522): children whose homework runs 20+ points above their class tests (Office only).
      { route: "ReportsTab", labelKey: "hiNavTitle", icon: "🔎", screen: "HomeworkIntegrity", perms: REPORT_LEAF_ACTIONS.HomeworkIntegrity },
      { route: "ReportsTab", labelKey: "revDashTitle", icon: "🕌", screen: "RevisionDashboard", perms: REPORT_LEAF_ACTIONS.RevisionDashboard },
      { route: "ReportsTab", labelKey: "qpTitle", icon: "🔍", screen: "QuestionReviewProgress", perms: REPORT_LEAF_ACTIONS.QuestionReviewProgress },
      { route: "ReportsTab", labelKey: "obsReviewerEffTitle", icon: "👁️", screen: "ReviewerEffectiveness", perms: REPORT_LEAF_ACTIONS.ReviewerEffectiveness },
      { route: "ReportsTab", labelKey: "tnOpenComments", icon: "💬", screen: "TeachingNoteOpenComments", perms: REPORT_LEAF_ACTIONS.TeachingNoteOpenComments },
      { route: "ReportsTab", labelKey: "finDashboardTitle", icon: "💰", screen: "FinanceDashboard", perms: REPORT_LEAF_ACTIONS.FinanceDashboard },
      { route: "ReportsTab", labelKey: "finSnapshotTitle", icon: "🧾", screen: "DailySnapshot", perms: REPORT_LEAF_ACTIONS.DailySnapshot },
      { route: "ReportsTab", labelKey: "geTitle", icon: "👪", screen: "GuardianEngagement", perms: REPORT_LEAF_ACTIONS.GuardianEngagement },
      { route: "ReportsTab", labelKey: "mdTitle", icon: "🎯", screen: "MarksDrivers", perms: REPORT_LEAF_ACTIONS.MarksDrivers },
      { route: "ReportsTab", labelKey: "aurTitle", icon: "🤖", screen: "AiUsageReport", perms: REPORT_LEAF_ACTIONS.AiUsageReport },
      { route: "ReportsTab", labelKey: "bcTitle", icon: "🧩", screen: "MasteryBankCoverage", perms: REPORT_LEAF_ACTIONS.MasteryBankCoverage },
      { route: "ReportsTab", labelKey: "stbRepTitle", icon: "🧸", screen: "StorybookReport", perms: REPORT_LEAF_ACTIONS.StorybookReport },
      { route: "ReportsTab", labelKey: "actRepTitle", icon: "🧩", screen: "ActivityReport", perms: REPORT_LEAF_ACTIONS.ActivityReport },
      { route: "ReportsTab", labelKey: "drpTitle", icon: "🗓️", screen: "DailyReport", perms: REPORT_LEAF_ACTIONS.DailyReport },
    ],
  },
  /**
   * Support-book production (SB-2..SB-4). One stack, four deep-linked leaves —
   * the Reports shape. Each leaf carries its own `perms`, because the five
   * production roles are per-user grants (D-#405): an illustrator sees only the
   * image queue, an assembler only the build workspace, and the whole group
   * disappears for everyone else.
   */
  {
    type: "group",
    titleKey: "drawerGroupBook",
    icon: "📕",
    hidden: true,
    items: [
      {
        route: "SupportBookTab",
        labelKey: "sbImportTitle",
        icon: "📥",
        screen: "BookImport",
        // Step one of the module: the author brings book.json/patch.json in, and
        // book:manage creates the title. Everything below is downstream of this.
        perms: ["book_production:author", "book_production:create"],
        allOf: ["book_production:view"],
      },
      {
        route: "SupportBookTab",
        labelKey: "sbPolicyTitle",
        icon: "📜",
        screen: "BookPolicy",
        // The validator runs against these; a missing one silently weakens every
        // check that depends on it, so whoever loads books needs to see the gaps.
        perms: ["book_production:settings"],
        allOf: ["book_production:view"],
      },
      {
        route: "SupportBookTab",
        labelKey: "sbQueueTitle",
        icon: "🖼️",
        screen: "BookImageQueue",
        // The reviewers see the queue too — they look at what came back. `book:read`
        // alone is not enough; that is a spectator.
        perms: ["book_production:illustrate", "book_production:review", "book_production:approve"],
        allOf: ["book_production:view"],
      },
      {
        route: "SupportBookTab",
        labelKey: "sbReviewTitle",
        icon: "🔎",
        screen: "BookReview",
        perms: ["book_production:review", "book_production:approve"],
        allOf: ["book_production:view"],
      },
      {
        route: "SupportBookTab",
        labelKey: "sbInboxTitle",
        icon: "📨",
        screen: "BookEscalationInbox",
        // Offered to ordinary reviewers too, not only seniors: a reviewer needs to
        // follow the thread they raised. Only a senior gets the resolve form, and
        // that is decided inside the screen.
        perms: ["book_production:review", "book_production:approve"],
        allOf: ["book_production:view"],
      },
      {
        route: "SupportBookTab",
        labelKey: "sbAssembleTitle",
        icon: "🏗️",
        screen: "BookAssemble",
        perms: ["book_production:assemble"],
        allOf: ["book_production:view"],
      },
    ],
  },
  { type: "item", route: "AdminTab", labelKey: "tabAdmin", icon: "⚙️" },
];

const GUARDIAN_NAV: NavSection[] = [
  { type: "item", route: "GuardianHomeTab", labelKey: "gpToday", icon: "🏠" },
  // D-#870 (owner ask): the classroom books, right under Today so families find them.
  { type: "item", route: "GuardianBooksTab", labelKey: "cbNav", icon: "📚" },
  // SB-1 (D-#980): the school's storybooks for the child's age band.
  { type: "item", route: "GuardianStoriesTab", labelKey: "stbNav", icon: "🧸" },
  // AS-3 (D-#988): activity sheets for the child's class — choose one, see how it went.
  { type: "item", route: "GuardianActivityTab", labelKey: "actNav", icon: "🧩" },
  {
    type: "group",
    titleKey: "drawerGroupAcademics",
    icon: "📖",
    items: [
      { route: "GuardianRoutineTab", labelKey: "tabRoutine", icon: "📅" },
      { route: "GuardianHomeworkTab", labelKey: "tabHomework", icon: "📒" },
      { route: "GuardianClassNotesTab", labelKey: "drawerItemClassNotes", icon: "📓" },
      { route: "GuardianAssignmentsTab", labelKey: "tabAssignment", icon: "📋" },
      { route: "GuardianClassTestTab", labelKey: "tabClassTest", icon: "🧪" },
      { route: "GuardianSyllabusTab", labelKey: "syTitle", icon: "📋" },
      { route: "GuardianSyllabusTab", labelKey: "exrNav", icon: "🗓️", screen: "ChildExamRoutine" },
    ],
  },
  // D-#769 (owner ask): sections that used to be reachable only by scrolling Today —
  // two shortcut cards at its bottom and two history cards above them — get a sidebar
  // entry each. All four live in the Today stack, so they deep-link by screen.
  { type: "item", route: "GuardianHomeTab", screen: "ChildAttendance", labelKey: "gpAttendance", icon: "🙋" },
  { type: "item", route: "GuardianHomeTab", screen: "ChildLeave", labelKey: "gpLeave", icon: "📝" },
  { type: "item", route: "GuardianHomeTab", screen: "ChildComments", labelKey: "gpComments", icon: "💬" },
  { type: "item", route: "GuardianHomeTab", screen: "ChildRevision", labelKey: "gpRevision", icon: "📖" },
  { type: "item", route: "GuardianHomeTab", screen: "ChildMastery", labelKey: "gpMsProgress", icon: "🎯" },
  // D-#855: every pop-up the school sent this family, to read again.
  { type: "item", route: "GuardianHomeTab", screen: "MyPopups", labelKey: "ppMineTitle", icon: "📬" },
];

// prd-help-centre (D-#968): one entry for every login, last in the default order.
const HELP_NAV: NavSection[] = [{ type: "item", route: "HelpTab", labelKey: "hcNav", icon: "❓" }];

const NAV: NavSection[] = [...STAFF_NAV, ...GUARDIAN_NAV, ...HELP_NAV];

/** "route:screen" of every deep-linked leaf. A plain leaf of the same route (ক্লাস টেস্ট)
 *  must not light up too while one of these screens is open (শিক্ষার্থীর অগ্রগতি, SP-1). */
const DEEP_LINKED = new Set(
  NAV.flatMap((s) => (s.type === "group" ? s.items : [s])).filter((l) => l.screen).map((l) => `${l.route}:${l.screen}`),
);

/** D-#920: the keys a person's saved arrangement uses (see NavPreference on the server). */
const leafKey = (l: NavLeaf): string => `${l.route}:${l.screen ?? ""}`;
const sectionKey = (s: NavSection): string => (s.type === "group" ? `g:${String(s.titleKey)}` : leafKey(s));
const LEAF_BY_KEY = new Map(NAV.flatMap((s) => (s.type === "group" ? s.items : [s])).map((l) => [leafKey(l), l]));

export default function DrawerContent(props: DrawerContentComponentProps): React.ReactElement {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const basket = useBasket();
  const { role, can } = useAuth();
  const present = React.useMemo(() => new Set(props.state.routeNames), [props.state.routeNames]);
  /** Route-gate + the optional per-leaf effective-permission gate (see NavLeaf). */
  const visibleLeaf = React.useCallback(
    (leaf: NavLeaf): boolean =>
      !leaf.hidden &&
      present.has(leaf.route) &&
      (!leaf.perms || leaf.perms.some(can)) &&
      (leaf.allOf ?? []).every(can),
    [present, can],
  );
  const focusedTab = props.state.routes[props.state.index];
  const activeRoute = focusedTab?.name as RouteName | undefined;
  // The focused screen INSIDE the active tab's stack (undefined until the stack
  // has navigated) — lets a deep-link leaf highlight only its own report.
  const nestedState = focusedTab?.state;
  const activeNested = nestedState?.routes?.[nestedState.index ?? nestedState.routes.length - 1]?.name;

  // D-#760 (owner 2026-10-17): groups start CLOSED — the list had grown long enough that
  // every group open buried the items below it. The group holding the current screen's
  // tab starts open, so its highlighted item stays visible. A tap collapses/expands, and
  // a tapped group keeps the choice for the session.
  // D-#900 (owner 2026-11-02): a guardian's groups start OPEN — their list is short, so
  // nothing gets buried. Staff keep D-#760.
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const groupsStartOpen = role === "GUARDIAN";

  // D-#920 (owner 2026-11-04): each person arranges their own sidebar — by hand, or "most
  // used on top" — and pins favourites (আমার পছন্দ). Saved on the server against the login,
  // so it follows them to every device. Only the ORDER is theirs: what shows is still the
  // gates above. Use counts are read once per mount, so auto mode never reshuffles the
  // list under a finger mid-session.
  const [navPrefQ] = useQuery({ query: MY_NAV_PREFERENCE, pause: !role, requestPolicy: "cache-and-network" });
  const [, saveNavPref] = useMutation(SAVE_NAV_PREFERENCE);
  const [, resetNavPref] = useMutation(RESET_NAV_PREFERENCE);
  const [, recordNavUse] = useMutation(RECORD_NAV_USE);
  const prefs: NavPrefs = React.useMemo(() => {
    const p = navPrefQ.data?.myNavPreference;
    if (!p) return DEFAULT_NAV_PREFS;
    return {
      mode: p.mode === "auto" ? "auto" : "manual",
      order: p.order,
      pinned: p.pinned,
      usage: Object.fromEntries(p.usage.map((u) => [u.key, u.count])),
    };
  }, [navPrefQ.data]);
  const visibleSections = React.useMemo(
    () => NAV.filter((s) => (s.type === "item" ? visibleLeaf(s) : !s.hidden && s.items.some(visibleLeaf))),
    [visibleLeaf],
  );
  const useOfLeaf = (l: NavLeaf): number => prefs.usage[leafKey(l)] ?? 0;
  const useOfSection = (s: NavSection): number =>
    s.type === "item" ? useOfLeaf(s) : s.items.reduce((n, l) => n + useOfLeaf(l), 0);
  const arrangeSections = (mode: NavMode, order: string[]): NavSection[] =>
    mode === "auto" ? orderByUse(visibleSections, useOfSection) : orderByKeys(visibleSections, sectionKey, order);
  const pinnedLeaves = (keys: string[]): NavLeaf[] =>
    keys.map((k) => LEAF_BY_KEY.get(k)).filter((l): l is NavLeaf => !!l && visibleLeaf(l));
  const sections = arrangeSections(prefs.mode, prefs.order);
  const favourites = pinnedLeaves(prefs.pinned);

  // The arrange panel edits a draft; nothing changes until সংরক্ষণ করুন.
  const [draft, setDraft] = React.useState<{ mode: NavMode; order: string[]; pinned: string[] } | null>(null);
  const [navBusy, setNavBusy] = React.useState(false);
  const [navError, setNavError] = React.useState<string | null>(null);
  const startArrange = (): void => {
    // Starting from what is on screen, so switching auto → manual keeps today's order.
    setDraft({ mode: prefs.mode, order: sections.map(sectionKey), pinned: favourites.map(leafKey) });
    setNavError(null);
  };
  const finishArrange = async (kind: "save" | "reset"): Promise<void> => {
    if (!draft) return;
    setNavBusy(true);
    const r =
      kind === "save"
        ? await saveNavPref({ mode: draft.mode, order: draft.order, pinned: draft.pinned })
        : await resetNavPref({});
    setNavBusy(false);
    if (r.error) {
      setNavError(friendlyError(r.error));
      return;
    }
    setDraft(null);
  };

  // D-#294: the print operator's queue counters — red = awaiting printing, yellow =
  // awaiting delivery. `additionalTypenames: ["PrintRequest"]` makes urql's document
  // cache invalidate (and refetch) this query the INSTANT any print mutation on this
  // device completes — create / mark printed / mark delivered / cancel — even though
  // the counts payload itself carries no PrintRequest object. The 60s poll remains
  // only for jobs arriving from OTHER devices; teachers (no roster:manage) never ask.
  const isPrintOperator = can("printing:view_all");
  const countsContext = React.useMemo(() => ({ additionalTypenames: ["PrintRequest"] }), []);
  const [countsQ, refetchCounts] = useQuery({
    query: PRINT_QUEUE_COUNTS,
    pause: !isPrintOperator,
    requestPolicy: "cache-and-network",
    context: countsContext,
  });
  React.useEffect(() => {
    if (!isPrintOperator) return;
    const id = setInterval(() => refetchCounts({ requestPolicy: "network-only" }), 60_000);
    return () => clearInterval(id);
  }, [isPrintOperator, refetchCounts]);
  // D-#295: cross-device push — the SSE stream nudges the instant ANY device
  // creates/advances a print job (web; native keeps the poll above).
  React.useEffect(() => {
    if (!isPrintOperator) return;
    return subscribeLiveEvents(["print_queue"], () =>
      refetchCounts({ requestPolicy: "network-only" }),
    );
  }, [isPrintOperator, refetchCounts]);
  const printCounts = countsQ.data?.printQueueCounts;

  // Owner 2026-07-25: Class Test drawer badges mirroring Print — red = question
  // requests the office still owes a paper on (REQUESTED/CHANGES_REQUESTED),
  // yellow = papers in the teacher's review (IN_REVIEW). Office/Principal see the
  // whole pipeline; a teacher sees their own (server-scoped). Same cache-nudge on
  // any CT-question mutation via the shared typename.
  const canClassTestBadge = can("class_test_question:create") || can("class_test_question:prepare");
  const ctCountsContext = React.useMemo(() => ({ additionalTypenames: ["CtQuestionRequest"] }), []);
  const [ctCountsQ, refetchCtCounts] = useQuery({
    query: CT_QUESTION_COUNTS,
    pause: !canClassTestBadge,
    requestPolicy: "cache-and-network",
    context: ctCountsContext,
  });
  React.useEffect(() => {
    if (!canClassTestBadge) return;
    const id = setInterval(() => refetchCtCounts({ requestPolicy: "network-only" }), 60_000);
    return () => clearInterval(id);
  }, [canClassTestBadge, refetchCtCounts]);
  const ctCounts = ctCountsQ.data?.ctQuestionCounts;

  // D-#603: a THIRD Class-Test badge — class-test reports past their deadline and
  // not yet published. Server-scoped: Office/Principal see the school, a teacher
  // sees only their own. Blue, because red and yellow already mean "question paper
  // owed" and "paper in review" on this same row, and the delay is a different
  // pipeline entirely. The field is unrefusable (returns 0), so it is safe to poll
  // from every role — but it is still paused for guardians and read with `?.`.
  const canCtOverdueBadge = can("class_test:view") || can("class_test:view_all");
  const ctOverdueContext = React.useMemo(() => ({ additionalTypenames: ["ClassTestResult"] }), []);
  const [ctOverdueQ, refetchCtOverdue] = useQuery({
    query: CLASS_TEST_OVERDUE_COUNTS,
    pause: !canCtOverdueBadge,
    requestPolicy: "cache-and-network",
    context: ctOverdueContext,
  });
  React.useEffect(() => {
    if (!canCtOverdueBadge) return;
    const id = setInterval(() => refetchCtOverdue({ requestPolicy: "network-only" }), 60_000);
    return () => clearInterval(id);
  }, [canCtOverdueBadge, refetchCtOverdue]);
  // D-#633: a TEACHER's badge counts only the delay that is still hers —
  // `awaitingSubmit` — not `overdue`, which keeps counting an exam she has already
  // submitted for as long as the office has not published it. Office/Principal own
  // the whole pile, so their badge stays on `overdue`.
  const ctOverdueCounts = ctOverdueQ.data?.classTestOverdueCounts;
  const ctOverdue = (can("class_test:view_all") ? ctOverdueCounts?.overdue : ctOverdueCounts?.awaitingSubmit) ?? 0;

  // Owner 2026-07-26: Staff drawer badge — leave applications awaiting approval
  // (Principal/Office, leave:manage). Refreshes on any StaffLeaveApplication mutation.
  const canLeaveBadge = can("leave:approve");
  const leaveCountContext = React.useMemo(() => ({ additionalTypenames: ["StaffLeaveApplication"] }), []);
  const [leaveCountQ, refetchLeaveCount] = useQuery({
    query: STAFF_LEAVE_PENDING_COUNT,
    pause: !canLeaveBadge,
    requestPolicy: "cache-and-network",
    context: leaveCountContext,
  });
  React.useEffect(() => {
    if (!canLeaveBadge) return;
    const id = setInterval(() => refetchLeaveCount({ requestPolicy: "network-only" }), 60_000);
    return () => clearInterval(id);
  }, [canLeaveBadge, refetchLeaveCount]);
  const leavePending = leaveCountQ.data?.staffLeavePendingCount ?? 0;

  // Work board badge (WB-1, D-#701): red = overdue cards, amber = open today.
  const canWorkBoardBadge = !!role && role !== "GUARDIAN";
  const [wbCountsQ, refetchWbCounts] = useQuery({
    query: MY_WORK_BOARD_COUNTS,
    pause: !canWorkBoardBadge,
    requestPolicy: "cache-and-network",
  });
  React.useEffect(() => {
    if (!canWorkBoardBadge) return;
    const id = setInterval(() => refetchWbCounts({ requestPolicy: "network-only" }), 120_000);
    return () => clearInterval(id);
  }, [canWorkBoardBadge, refetchWbCounts]);
  const wbCounts = wbCountsQ.data?.myWorkBoardCounts;

  // Exam syllabus (SY-5): how many syllabuses await THIS caller's subject-teacher
  // sign-off. The field is `authenticated: true` and returns 0 for every role, so
  // unlike the observation probe that white-screened the app in 791e5fe it CANNOT
  // be refused — and it is still read with `?.` and paused for guardians, because
  // the rule is the shape, not the individual field.
  const canSyllabusBadge = !!role && role !== "GUARDIAN";
  const syllabusCountContext = React.useMemo(
    () => ({ additionalTypenames: ["ExamSyllabus"] }),
    [],
  );
  const [syllabusCountQ, refetchSyllabusCount] = useQuery({
    query: MY_SYLLABUS_APPROVAL_COUNT,
    pause: !canSyllabusBadge,
    requestPolicy: "cache-and-network",
    context: syllabusCountContext,
  });
  React.useEffect(() => {
    if (!canSyllabusBadge) return;
    const id = setInterval(() => refetchSyllabusCount({ requestPolicy: "network-only" }), 60_000);
    return () => clearInterval(id);
  }, [canSyllabusBadge, refetchSyllabusCount]);
  const syllabusPending = syllabusCountQ.data?.mySyllabusApprovalCount ?? 0;

  // Owner 2026-07-26: Comments drawer badge — undelivered comments awaiting
  // Principal/Office review (roster:manage), mirroring Print. Refreshes on any
  // StudentComment mutation (record / edit / deliver).
  const canCommentBadge = can("student_comments:review");
  const commentCountContext = React.useMemo(() => ({ additionalTypenames: ["StudentComment"] }), []);
  const [commentCountQ, refetchCommentCount] = useQuery({
    query: COMMENT_REVIEW_COUNT,
    pause: !canCommentBadge,
    requestPolicy: "cache-and-network",
    context: commentCountContext,
  });
  React.useEffect(() => {
    if (!canCommentBadge) return;
    const id = setInterval(() => refetchCommentCount({ requestPolicy: "network-only" }), 60_000);
    return () => clearInterval(id);
  }, [canCommentBadge, refetchCommentCount]);
  const commentPending = commentCountQ.data?.commentReviewCount ?? 0;

  // Owner 2026-07-26: Observation drawer badge — red = observations assigned to me
  // awaiting my review (observation:review); yellow = reviewed awaiting publish
  // (observation:upload). Any observation participant (observation:read) asks; each
  // count is server-scoped and 0 without the matching permission. Refreshes on any
  // ClassroomObservation mutation.
  const canObservationBadge = can("classroom_observation:view");
  const obsCountContext = React.useMemo(() => ({ additionalTypenames: ["ClassroomObservation"] }), []);
  const [obsCountQ, refetchObsCount] = useQuery({
    query: OBSERVATION_COUNTS,
    pause: !canObservationBadge,
    requestPolicy: "cache-and-network",
    context: obsCountContext,
  });
  React.useEffect(() => {
    if (!canObservationBadge) return;
    const id = setInterval(() => refetchObsCount({ requestPolicy: "network-only" }), 60_000);
    return () => clearInterval(id);
  }, [canObservationBadge, refetchObsCount]);
  const obsCounts = obsCountQ.data?.observationCounts;

  const badgeFor = (route: RouteName): number | undefined =>
    route === "QuestionsTab" && basket.count > 0 ? basket.count : undefined;

  /** Extra tinted badges (D-#294): [count, background] pairs, rendered when > 0. */
  const tintedBadgesFor = (
    route: RouteName,
    /** The deep-linked screen, when the route hosts several leaves (Syllabus, Reports). */
    screen?: string,
  ): Array<{ count: number; bg: string }> => {
    if (route === "SyllabusTab" && screen === "SyllabusApprovals" && syllabusPending > 0) {
      return [{ count: syllabusPending, bg: colors.warning }];
    }
    if (route === "PrintTab" && isPrintOperator && printCounts) {
      const out: Array<{ count: number; bg: string }> = [];
      if (printCounts.requested > 0) out.push({ count: printCounts.requested, bg: colors.error });
      if (printCounts.printed > 0) out.push({ count: printCounts.printed, bg: colors.warning });
      return out;
    }
    // `!screen`: Student progress (D-#734) deep-links into this stack and must not
    // wear Class Test's question/overdue counters.
    if (route === "ClassTestTab" && !screen && (canClassTestBadge || canCtOverdueBadge)) {
      const out: Array<{ count: number; bg: string }> = [];
      if (canClassTestBadge && ctCounts) {
        if (ctCounts.pending > 0) out.push({ count: ctCounts.pending, bg: colors.error });
        if (ctCounts.inReview > 0) out.push({ count: ctCounts.inReview, bg: colors.warning });
      }
      // D-#603 — overdue reports (blue), last so the question-pipeline badges keep
      // the positions the office already reads them in.
      if (canCtOverdueBadge && ctOverdue > 0) out.push({ count: ctOverdue, bg: colors.info });
      return out;
    }
    if (route === "HrTab" && canLeaveBadge && leavePending > 0) {
      return [{ count: leavePending, bg: colors.error }];
    }
    if (route === "WorkBoardTab" && screen === "WorkBoard" && wbCounts) {
      const out: Array<{ count: number; bg: string }> = [];
      if (wbCounts.overdue > 0) out.push({ count: wbCounts.overdue, bg: colors.error });
      if (wbCounts.openToday > 0) out.push({ count: wbCounts.openToday, bg: colors.warning });
      return out;
    }
    if (route === "CommentsTab" && canCommentBadge && commentPending > 0) {
      return [{ count: commentPending, bg: colors.error }];
    }
    if (route === "ObservationTab" && canObservationBadge && obsCounts) {
      const out: Array<{ count: number; bg: string }> = [];
      if (obsCounts.toReview > 0) out.push({ count: obsCounts.toReview, bg: colors.error });
      if (obsCounts.toPublish > 0) out.push({ count: obsCounts.toPublish, bg: colors.warning });
      return out;
    }
    return [];
  };

  const go = (leaf: NavLeaf): void => {
    // navigate bubbles to the drawer and (in slide-over mode) closes it.
    // Deep-link leaves keep the stack's back button via `initial: false` (D-#311).
    // The route name is dynamic, so it can't satisfy the per-literal tuple
    // overloads of the drawer helpers' navigate — hence the unknown-cast.
    const navigate = props.navigation.navigate as unknown as (name: string, params?: object) => void;
    // D-#920: one tap counted for "most used on top" — fire and forget, never blocks the nav.
    void recordNavUse({ key: leafKey(leaf) });
    if (leaf.screen) navigate(leaf.route, { screen: leaf.screen, initial: false });
    else navigate(leaf.route);
  };

  const Leaf = ({ leaf, indent }: { leaf: NavLeaf; indent?: boolean }): React.ReactElement | null => {
    if (!visibleLeaf(leaf)) return null;
    const active =
      leaf.route === activeRoute &&
      (leaf.screen ? leaf.screen === activeNested : !DEEP_LINKED.has(`${leaf.route}:${activeNested ?? ""}`));
    const badge = badgeFor(leaf.route);
    const tinted = tintedBadgesFor(leaf.route, leaf.screen);
    return (
      <Pressable
        onPress={() => go(leaf)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space(3),
          minHeight: 48,
          paddingVertical: space(2),
          paddingHorizontal: space(4),
          paddingLeft: indent ? space(7) : space(4),
          backgroundColor: active ? colors.primaryContainer : "transparent",
          borderRadius: radius.md,
          marginHorizontal: space(2),
          marginBottom: space(1),
        }}
      >
        <Text style={{ fontSize: 18 }}>{leaf.icon}</Text>
        <Text
          style={{
            ...typeScale.button,
            color: active ? colors.onPrimaryContainer : colors.textPrimary,
            flex: 1,
          }}
          numberOfLines={1}
        >
          {STR[leaf.labelKey]}
        </Text>
        {badge !== undefined ? (
          <View
            style={{
              backgroundColor: colors.primary,
              borderRadius: radius.pill,
              minWidth: 20,
              height: 20,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 6,
            }}
          >
            <Text style={{ color: colors.onPrimary, ...typeScale.caption, fontFamily: fonts.bold }}>
              {bnNum(badge)}
            </Text>
          </View>
        ) : null}
        {/* D-#294: the print operator's red (to print) + yellow (to deliver) counters. */}
        {tinted.map((b, i) => (
          <View
            key={i}
            style={{
              backgroundColor: b.bg,
              borderRadius: radius.pill,
              minWidth: 20,
              height: 20,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 6,
              marginLeft: i > 0 || badge !== undefined ? 4 : 0,
            }}
          >
            <Text style={{ color: colors.onPrimary, ...typeScale.caption, fontFamily: fonts.bold }}>
              {bnNum(b.count)}
            </Text>
          </View>
        ))}
      </Pressable>
    );
  };

  const renderSection = (section: NavSection): React.ReactElement | null => {
    if (section.type === "item") {
      // Route ALONE is not unique: the guardian's Today and its four deep-linked
      // sections (D-#769) share GuardianHomeTab, and duplicate keys made React clone rows.
      return <Leaf key={`${section.route}:${section.screen ?? ""}`} leaf={section} />;
    }
    if (section.hidden) return null;
    // D-#920: in auto mode a group's own items are most-used first too.
    const items = prefs.mode === "auto" ? orderByUse(section.items, useOfLeaf) : section.items;
    const visible = items.filter(visibleLeaf);
    if (visible.length === 0) return null;
    // By title, not position: the person's own order moves groups around (D-#920).
    const key = sectionKey(section);
    const isCollapsed = collapsed[key] ?? (!groupsStartOpen && !visible.some((it) => it.route === activeRoute));
    return (
      <View key={key} style={{ marginTop: space(1) }}>
        <Pressable
          onPress={() => setCollapsed((c) => ({ ...c, [key]: !isCollapsed }))}
          accessibilityRole="button"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space(3),
            minHeight: 44,
            paddingVertical: space(2),
            paddingHorizontal: space(4),
          }}
        >
          <Text style={{ fontSize: 18 }}>{section.icon}</Text>
          <Text style={{ ...typeScale.bodyStrong, color: colors.textSecondary, flex: 1 }} numberOfLines={1}>
            {STR[section.titleKey]}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{isCollapsed ? "▸" : "▾"}</Text>
        </Pressable>
        {isCollapsed ? null : visible.map((it) => <Leaf key={`${it.route}:${it.screen ?? ""}`} leaf={it} indent />)}
      </View>
    );
  };

  // D-#636: `paddingTop: 0` killed the safe-area inset DrawerContentScrollView
  // applies by default, so on a phone the "SCD Hub" title rendered UNDER the status
  // bar — the clock and the battery icon sat on top of the words (owner screenshot,
  // Android, 2026-09-03). The zero was there to close a gap the inset leaves on web,
  // where `insets.top` is 0 anyway, so paying the real inset fixes the phone without
  // reopening that gap.
  return (
    <DrawerContentScrollView {...props} contentContainerStyle={{ paddingTop: insets.top }}>
      <View
        style={{
          paddingVertical: space(4),
          paddingHorizontal: space(4),
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          marginBottom: space(2),
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          <Text style={{ ...typeScale.sectionTitle, color: colors.primary, flex: 1 }}>{STR.appName}</Text>
          {/* D-#920: opens the person's own arrange panel. */}
          {role && !draft ? (
            <Pressable
              onPress={startArrange}
              accessibilityRole="button"
              hitSlop={8}
              style={{
                paddingVertical: space(1),
                paddingHorizontal: space(3),
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ ...typeScale.caption, color: colors.textPrimary }}>{STR.navArrange}</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={{ ...typeScale.caption, color: colors.textSecondary }} numberOfLines={2}>
          {STR.appSub}
        </Text>
      </View>
      {draft ? (
        <ArrangePanel
          draft={draft}
          setDraft={setDraft}
          sections={arrangeSections(draft.mode, draft.order)}
          favourites={pinnedLeaves(draft.pinned)}
          visibleLeaf={visibleLeaf}
          busy={navBusy}
          error={navError}
          onSave={() => void finishArrange("save")}
          onReset={() => void finishArrange("reset")}
          onCancel={() => setDraft(null)}
        />
      ) : (
        <>
          {favourites.length > 0 ? (
            <View style={{ marginTop: space(1) }}>
              <Text
                style={{
                  ...typeScale.bodyStrong,
                  color: colors.textSecondary,
                  paddingHorizontal: space(4),
                  paddingVertical: space(2),
                }}
              >
                ★ {STR.navFavourites}
              </Text>
              {favourites.map((l) => (
                <Leaf key={`fav:${leafKey(l)}`} leaf={l} />
              ))}
            </View>
          ) : null}
          {sections.map(renderSection)}
        </>
      )}
    </DrawerContentScrollView>
  );
}

type ArrangeDraft = { mode: NavMode; order: string[]; pinned: string[] };

/**
 * The arrange panel (D-#920): mode, favourites (↑ ↓ ★) and the section order (↑ ↓, manual
 * only). Arrows rather than drag — drag is unreliable on web and on older phones.
 */
function ArrangePanel({
  draft,
  setDraft,
  sections,
  favourites,
  visibleLeaf,
  busy,
  error,
  onSave,
  onReset,
  onCancel,
}: {
  draft: ArrangeDraft;
  setDraft: (d: ArrangeDraft) => void;
  sections: NavSection[];
  favourites: NavLeaf[];
  visibleLeaf: (l: NavLeaf) => boolean;
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onReset: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const colors = useColors();
  const manual = draft.mode === "manual";
  const favKeys = favourites.map(leafKey);

  const IconBtn = ({
    glyph,
    label,
    onPress,
    disabled,
    tint,
  }: {
    glyph: string;
    label: string;
    onPress: () => void;
    disabled?: boolean;
    tint?: string;
  }): React.ReactElement => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={{
        minWidth: 36,
        minHeight: 36,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.md,
        opacity: disabled ? 0.25 : 1,
      }}
    >
      <Text style={{ fontSize: 18, color: tint ?? colors.textPrimary }}>{glyph}</Text>
    </Pressable>
  );
  const Star = ({ leaf }: { leaf: NavLeaf }): React.ReactElement => {
    const on = draft.pinned.includes(leafKey(leaf));
    return (
      <IconBtn
        glyph={on ? "★" : "☆"}
        label={on ? STR.navUnpin : STR.navPin}
        tint={on ? colors.warning : undefined}
        onPress={() => setDraft({ ...draft, pinned: togglePinned(draft.pinned, leafKey(leaf)) })}
      />
    );
  };
  const Row = ({
    icon,
    title,
    indent,
    strong,
    children,
  }: {
    icon: string;
    title: string;
    indent?: boolean;
    strong?: boolean;
    children?: React.ReactNode;
  }): React.ReactElement => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space(2),
        minHeight: 40,
        paddingLeft: indent ? space(6) : 0,
      }}
    >
      <Text style={{ fontSize: 16 }}>{icon}</Text>
      <Text
        style={{ ...(strong ? typeScale.bodyStrong : typeScale.button), color: colors.textPrimary, flex: 1 }}
        numberOfLines={1}
      >
        {title}
      </Text>
      {children}
    </View>
  );
  const Heading = ({ text }: { text: string }): React.ReactElement => (
    <Text style={{ ...typeScale.bodyStrong, color: colors.textSecondary, marginTop: space(4), marginBottom: space(1) }}>
      {text}
    </Text>
  );
  const Chip = ({ mode, label }: { mode: NavMode; label: string }): React.ReactElement => {
    const on = draft.mode === mode;
    return (
      <Pressable
        onPress={() => setDraft({ ...draft, mode })}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        style={{
          flex: 1,
          paddingVertical: space(2),
          paddingHorizontal: space(2),
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: on ? colors.primary : colors.border,
          backgroundColor: on ? colors.primaryContainer : "transparent",
          alignItems: "center",
        }}
      >
        <Text
          style={{ ...typeScale.caption, color: on ? colors.onPrimaryContainer : colors.textPrimary, textAlign: "center" }}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={{ paddingHorizontal: space(4), paddingBottom: space(6) }}>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <Chip mode="manual" label={STR.navModeManual} />
        <Chip mode="auto" label={STR.navModeAuto} />
      </View>
      <Text style={{ ...typeScale.caption, color: colors.textSecondary, marginTop: space(2) }}>
        {manual ? STR.navManualHint : STR.navAutoHint}
      </Text>

      <Heading text={`★ ${STR.navFavourites}`} />
      {favourites.length === 0 ? (
        <Text style={{ ...typeScale.caption, color: colors.textSecondary }}>{STR.navNoFavourites}</Text>
      ) : (
        favourites.map((l, i) => (
          <Row key={`fav:${leafKey(l)}`} icon={l.icon} title={STR[l.labelKey]}>
            <IconBtn
              glyph="↑"
              label={STR.navMoveUp}
              disabled={i === 0}
              onPress={() => setDraft({ ...draft, pinned: moveKey(favKeys, i, -1) })}
            />
            <IconBtn
              glyph="↓"
              label={STR.navMoveDown}
              disabled={i === favourites.length - 1}
              onPress={() => setDraft({ ...draft, pinned: moveKey(favKeys, i, 1) })}
            />
            <Star leaf={l} />
          </Row>
        ))
      )}

      <Heading text={STR.navSections} />
      {sections.map((s, i) => {
        const arrows = manual ? (
          <>
            <IconBtn
              glyph="↑"
              label={STR.navMoveUp}
              disabled={i === 0}
              onPress={() => setDraft({ ...draft, order: moveKey(sections.map(sectionKey), i, -1) })}
            />
            <IconBtn
              glyph="↓"
              label={STR.navMoveDown}
              disabled={i === sections.length - 1}
              onPress={() => setDraft({ ...draft, order: moveKey(sections.map(sectionKey), i, 1) })}
            />
          </>
        ) : null;
        if (s.type === "item") {
          return (
            <Row key={sectionKey(s)} icon={s.icon} title={STR[s.labelKey]}>
              {arrows}
              <Star leaf={s} />
            </Row>
          );
        }
        return (
          <View key={sectionKey(s)}>
            <Row icon={s.icon} title={STR[s.titleKey]} strong>
              {arrows}
            </Row>
            {s.items.filter(visibleLeaf).map((l) => (
              <Row key={leafKey(l)} icon={l.icon} title={STR[l.labelKey]} indent>
                <Star leaf={l} />
              </Row>
            ))}
          </View>
        );
      })}

      {error ? <Text style={{ ...typeScale.caption, color: colors.error, marginTop: space(3) }}>{error}</Text> : null}
      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(4) }}>
        <View style={{ flex: 1 }}>
          <Button title={STR.navSave} onPress={onSave} loading={busy} disabled={busy} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title={STR.navCancel} variant="secondary" onPress={onCancel} disabled={busy} />
        </View>
      </View>
      <View style={{ marginTop: space(2) }}>
        <Button title={STR.navReset} variant="ghost" onPress={onReset} disabled={busy} />
      </View>
    </View>
  );
}
