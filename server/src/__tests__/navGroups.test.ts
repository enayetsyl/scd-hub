/**
 * D-#1654 (owner 2026-11-19): the sidebar is grouped by the job a person is doing.
 *
 * Static reads of app/src/navigation/DrawerContent.tsx (the app workspace has no test runner —
 * see navInitialRoute.test.ts). The headline rule: NOBODY GAINS OR LOSES ACCESS. FROZEN_* is
 * every leaf of the old STAFF_NAV / GUARDIAN_NAV with the gates it had (REPORT_LEAF_ACTIONS.X is
 * written "R:X"); each must still exist with exactly those gates, in some group. Leaf keys are
 * "route:screen", so favourites and use counts survive.
 */
import { readFileSync } from "fs";
import path from "path";

const nav = require("../../../app/src/lib/navArrange") as {
  dedupeByLabel: <T extends { labelKey: unknown }>(l: T[]) => T[];
  migrateOrder: (order: string[], m: Array<{ key: string; replaces: string[]; after?: string }>) => string[];
};

const drawer = readFileSync(path.resolve(__dirname, "../../../app/src/navigation/DrawerContent.tsx"), "utf8");
const labels = readFileSync(path.resolve(__dirname, "../../../app/src/lib/labels.ts"), "utf8");
const adminHome = readFileSync(path.resolve(__dirname, "../../../app/src/screens/admin/AdminHomeScreen.tsx"), "utf8");
const appTabs = readFileSync(path.resolve(__dirname, "../../../app/src/navigation/AppTabs.tsx"), "utf8");
const hrHome = readFileSync(path.resolve(__dirname, "../../../app/src/screens/hr/HrHomeScreen.tsx"), "utf8");

interface Leaf {
  route: string;
  screen?: string;
  labelKey: string;
  perms?: string[];
  allOf?: string[];
  hidden?: boolean;
  needsLessonProgress?: boolean;
  needsSupportSwitch?: boolean;
  orViewAs?: boolean;
}
type Section = ({ type: "item" } & Leaf) | { type: "group"; titleKey: string; items: Leaf[]; hidden?: boolean };

/** Evaluate one `const NAME: NavSection[] = [ … ];` list (plain object literals) with stub perms. */
function navList(name: string): Section[] {
  const start = drawer.indexOf(`const ${name}: NavSection[] = [`);
  expect(start).toBeGreaterThan(-1);
  const body = drawer.slice(drawer.indexOf("[", start), drawer.indexOf("\n];", start) + 2);
  // eslint-disable-next-line no-new-func
  return new Function("REPORT_LEAF_ACTIONS", "REVIEW_HOME_PERMS", "return " + body)(
    new Proxy({}, { get: (_t, screen) => ["R:" + String(screen)] }),
    ["REVIEW_HOME_PERMS"],
  ) as Section[];
}
const key = (l: Leaf): string => `${l.route}:${l.screen ?? ""}`;
const groupOf = (list: Section[], titleKey: string): Leaf[] => {
  const g = list.find((s) => s.type === "group" && s.titleKey === titleKey);
  expect(g).toBeDefined();
  return (g as { items: Leaf[] }).items;
};
const flat = (list: Section[]): Array<{ leaf: Leaf; group?: string; hiddenGroup?: boolean }> =>
  list.flatMap((s) => (s.type === "group" ? s.items.map((leaf) => ({ leaf, group: s.titleKey, hiddenGroup: s.hidden })) : [{ leaf: s as Leaf }]));

const STAFF = navList("STAFF_NAV");
const GUARDIAN = navList("GUARDIAN_NAV");

// Leaf → { l: labelKey, p: perms, a: allOf, h: hidden, nl/ns/v: needs* / orViewAs flags }.
const FROZEN_STAFF: Record<string, { l: string; p?: string[]; a?: string[]; h?: number; nl?: number; ns?: number; v?: number }> = {
  "HomeTab:": {"l":"drawerItemToday"},
  "ContentTab:": {"l":"tabContent"},
  "QuestionsTab:": {"l":"tabQuestions"},
  "SetsTab:": {"l":"tabSets"},
  "ReviewTab:ReviewHub": {"l":"rhNav"},
  "ReviewTab:": {"l":"tabReview","p":["REVIEW_HOME_PERMS"]},
  "ReviewTab:ReviewSupervision": {"l":"rspNav","p":["review_program:supervise"]},
  "RoutineTab:": {"l":"tabRoutine"},
  "VocabTab:": {"l":"tabVocab"},
  "EnglishDriveTab:": {"l":"tabEnglishDrive"},
  "TeachingNotesTab:": {"l":"tabTeachingNotes"},
  "TrackersTab:": {"l":"drawerItemDailyTracker"},
  "HomeworkTab:": {"l":"tabHomework"},
  "AssignmentTab:": {"l":"tabAssignment"},
  "ClassTestTab:StudentProgress": {"l":"impNavTitle","p":["improvement_plan:view_all"]},
  "RevisionTab:": {"l":"tabRevision"},
  "ClassTestTab:": {"l":"tabClassTest"},
  "SyllabusTab:ExamRoutine": {"l":"exrNav","p":["exam_routine:view","exam_routine:manage","exam_routine:publish"]},
  "SyllabusTab:SyllabusHome": {"l":"syRead"},
  "SyllabusTab:SyllabusEntry": {"l":"syEntry","p":["exam_syllabus:edit"]},
  "SyllabusTab:SyllabusApprovals": {"l":"syApprovalsNav"},
  "SyllabusTab:SyllabusExams": {"l":"syExamManage","p":["exam_syllabus:settings"]},
  "ExamPapersTab:ExamPapersHome": {"l":"epNav","p":["exam_papers:review","exam_papers:view","exam_papers:manage"]},
  "ExamPapersTab:ReferencePapers": {"l":"epRefNav","p":["exam_papers:view_reference","exam_papers:manage_reference"]},
  "QuranExamTab:": {"l":"qxNav","p":["quran_exam:view","quran_exam:manage","quran_exam:examine"]},
  "VivaTab:": {"l":"vivaNav","p":["viva:view","viva:manage","viva:examine"]},
  "ExamsTab:": {"l":"exNavResults","p":["exam_results:view","exam_custody:view"]},
  "ScholarshipTab:ScholarshipHome": {"l":"scPapersNav","p":["scholarship_practice:view"]},
  "ScholarshipTab:ScholarshipTopics": {"l":"scTopicsNav","p":["scholarship_practice:settings"],"a":["scholarship_practice:view"]},
  "AiAssistTab:": {"l":"aasNav","p":["ai_assist:chat","ai_assist:read_all_chats"]},
  "AiWorkspaceTab:": {"l":"awNav","p":["ai_workspace:use","ai_workspace:admin"]},
  "DataAssistantTab:": {"l":"daNav","p":["data_assistant:use","data_assistant:connect","data_assistant:audit"],"v":1},
  "MasteryTab:MasteryWork": {"l":"msWork","p":["mastery:enter_results"],"a":["mastery:view"]},
  "MasteryTab:MasteryLeader": {"l":"msLeader","p":["mastery:approve"],"a":["mastery:view"]},
  "MasteryTab:MasteryHome": {"l":"msCatalogueNav","p":["mastery:view"]},
  "MasteryTab:MasteryImport": {"l":"msImport","p":["mastery:settings"]},
  "MasteryTab:MasteryReviews": {"l":"msRvNav","p":["mastery:review","mastery:settings"]},
  "MasteryTab:MasteryTags": {"l":"msTags","p":["mastery:view"]},
  "MasteryTab:MasteryPolicy": {"l":"msPolicy","p":["mastery:view"]},
  "AttendanceTab:": {"l":"tabAttendance"},
  "PrintTab:": {"l":"tabPrint"},
  "WorkBoardTab:WorkBoard": {"l":"wbMyBoard"},
  "WorkBoardTab:AssignedByMe": {"l":"wbAssignedByMe","p":["work_board:assign"]},
  "WorkBoardTab:LoadGrid": {"l":"wbLoad","p":["work_board:view_all"]},
  "WorkBoardTab:TaskTemplates": {"l":"wbTemplates"},
  "ClassNotesTab:MyClassNotes": {"l":"cnMyPeriods"},
  "ClassNotesTab:AllClassNotes": {"l":"cnAllNotesTitle"},
  "ClassNotesTab:LessonProgress": {"l":"lpNavTitle","p":["lesson_progress:view","lesson_progress:view_all"]},
  "CommentsTab:": {"l":"tabComments"},
  "ObservationTab:": {"l":"tabObservation"},
  "FreeMixingTab:": {"l":"tabFreeMixing","h":1},
  "LibraryTab:": {"l":"tabLibrary"},
  "StorybooksTab:": {"l":"stbNav"},
  "ActivityTab:": {"l":"actNav"},
  "ClassBooksTab:": {"l":"cbTitle"},
  "BookLcTab:": {"l":"blNavTitle"},
  "BookLcTeacherTab:": {"l":"blMyBooks"},
  "WinterTaskTab:": {"l":"wtNav","p":["winter_task:review","winter_task:manage"]},
  "ChatTab:": {"l":"tabChat"},
  "PopupNoticesTab:": {"l":"ppTitleNav"},
  "HomeTab:MyPopups": {"l":"ppMineTitle"},
  "HomeTab:SupportHome": {"l":"supTitle","p":["support_profile:report","support_profile:view_all","safeguarding:receive"],"ns":1},
  "FinanceTab:": {"l":"tabFinance"},
  "HrTab:": {"l":"tabHr"},
  "ReportsTab:TeacherClassLoad": {"l":"clTitle","p":["R:TeacherClassLoad"]},
  "ReportsTab:AssignmentLoadReport": {"l":"alReportTitle","p":["R:AssignmentLoadReport"]},
  "ReportsTab:ClassTestReport": {"l":"ctReportTitle","p":["R:ClassTestReport"]},
  "ReportsTab:AttendanceReport": {"l":"attReportTitle","p":["R:AttendanceReport"]},
  "ReportsTab:ClassNoteReport": {"l":"rtNoteReportTitle","p":["R:ClassNoteReport"]},
  "ReportsTab:HwDeclarePending": {"l":"rptHwDeclarePending","p":["R:HwDeclarePending"]},
  "ReportsTab:HwIssuePending": {"l":"rptHwIssuePending","p":["R:HwIssuePending"]},
  "ReportsTab:AsDeclarePending": {"l":"rptAsDeclarePending","p":["R:AsDeclarePending"]},
  "ReportsTab:AsDeliverPending": {"l":"rptAsDeliverPending","p":["R:AsDeliverPending"]},
  "ReportsTab:AsPrintPending": {"l":"rptAsPrintPending","p":["R:AsPrintPending"]},
  "ReportsTab:ReconciliationReport": {"l":"rrTitle","p":["R:ReconciliationReport"]},
  "ReportsTab:HwLifecycleReport": {"l":"hlrTitle","p":["R:HwLifecycleReport"]},
  "ReportsTab:HwWeeklyUnsubmitted": {"l":"hwwdTitle","p":["R:HwWeeklyUnsubmitted"]},
  "ReportsTab:AttendanceRanking": {"l":"arTitle","p":["R:AttendanceRanking"]},
  "ReportsTab:WorkClaimQueue": {"l":"wcQueueTitle","p":["R:WorkClaimQueue"]},
  "ReportsTab:LiveClassBoard": {"l":"lcbBoardTitle","p":["R:LiveClassBoard"]},
  "ReportsTab:LoadGrid": {"l":"wbLoad","p":["R:LoadGrid"]},
  "ReportsTab:ClassTestDashboard": {"l":"ctDashboardTitle","p":["R:ClassTestDashboard"]},
  "ReportsTab:StudentProgress": {"l":"impNavTitle","p":["R:StudentProgress"]},
  "ReportsTab:LessonProgress": {"l":"lpNavTitle","p":["R:LessonProgress"]},
  "ReportsTab:HomeworkIntegrity": {"l":"hiNavTitle","p":["R:HomeworkIntegrity"]},
  "ReportsTab:RevisionDashboard": {"l":"revDashTitle","p":["R:RevisionDashboard"]},
  "ReportsTab:QuestionReviewProgress": {"l":"qpTitle","p":["R:QuestionReviewProgress"]},
  "ReportsTab:ReviewerEffectiveness": {"l":"obsReviewerEffTitle","p":["R:ReviewerEffectiveness"]},
  "ReportsTab:TeachingNoteOpenComments": {"l":"tnOpenComments","p":["R:TeachingNoteOpenComments"]},
  "ReportsTab:FinanceDashboard": {"l":"finDashboardTitle","p":["R:FinanceDashboard"]},
  "ReportsTab:DailySnapshot": {"l":"finSnapshotTitle","p":["R:DailySnapshot"]},
  "ReportsTab:GuardianEngagement": {"l":"geTitle","p":["R:GuardianEngagement"]},
  "ReportsTab:MarksDrivers": {"l":"mdTitle","p":["R:MarksDrivers"]},
  "ReportsTab:AiUsageReport": {"l":"aurTitle","p":["R:AiUsageReport"]},
  "ReportsTab:MasteryBankCoverage": {"l":"bcTitle","p":["R:MasteryBankCoverage"]},
  "ReportsTab:StorybookReport": {"l":"stbRepTitle","p":["R:StorybookReport"]},
  "ReportsTab:ActivityReport": {"l":"actRepTitle","p":["R:ActivityReport"]},
  "ReportsTab:DailyReport": {"l":"drpTitle","p":["R:DailyReport"]},
  "SupportBookTab:BookImport": {"l":"sbImportTitle","p":["book_production:author","book_production:create"],"a":["book_production:view"],"h":1},
  "SupportBookTab:BookPolicy": {"l":"sbPolicyTitle","p":["book_production:settings"],"a":["book_production:view"],"h":1},
  "SupportBookTab:BookImageQueue": {"l":"sbQueueTitle","p":["book_production:illustrate","book_production:review","book_production:approve"],"a":["book_production:view"],"h":1},
  "SupportBookTab:BookReview": {"l":"sbReviewTitle","p":["book_production:review","book_production:approve"],"a":["book_production:view"],"h":1},
  "SupportBookTab:BookEscalationInbox": {"l":"sbInboxTitle","p":["book_production:review","book_production:approve"],"a":["book_production:view"],"h":1},
  "SupportBookTab:BookAssemble": {"l":"sbAssembleTitle","p":["book_production:assemble"],"a":["book_production:view"],"h":1},
  "AdminTab:": {"l":"tabAdmin","p":["staff_logins:view","cover:assign_proxy","teaching_assignments:assign_subject_teacher","teaching_assignments:assign_supervisor","students:view_all","students:edit","teaching_assignments:assign_class_teacher","teaching_assignments:assign_homework_checker","classes_sections:merge_split","classes_sections:settings","year_change:view","routine:settings","guardians:reset_password","guardians:link","access_control:edit","audit_log:view","audit_log:view_activity","system_health:view"]},
  "AdminTab:YearChange": {"l":"ycTitle","p":["year_change:view"]},
};
const FROZEN_GUARDIAN: typeof FROZEN_STAFF = {
  "GuardianHomeTab:": {"l":"gpToday"},
  "GuardianBooksTab:": {"l":"cbNav"},
  "GuardianStoriesTab:": {"l":"stbNav"},
  "GuardianActivityTab:": {"l":"actNav"},
  "GuardianRoutineTab:": {"l":"tabRoutine"},
  "GuardianHomeworkTab:": {"l":"tabHomework"},
  "GuardianClassNotesTab:": {"l":"drawerItemClassNotes"},
  "GuardianAssignmentsTab:": {"l":"tabAssignment"},
  "GuardianClassTestTab:": {"l":"tabClassTest"},
  "GuardianSyllabusTab:": {"l":"syTitle"},
  "GuardianSyllabusTab:ChildExamRoutine": {"l":"exrNav"},
  "GuardianHomeTab:ChildAttendance": {"l":"gpAttendance"},
  "GuardianHomeTab:ChildLeave": {"l":"gpLeave"},
  "GuardianHomeTab:ChildComments": {"l":"gpComments"},
  "GuardianHomeTab:ChildMeetingResults": {"l":"mgrTitle"},
  "GuardianHomeTab:ChildRevision": {"l":"gpRevision"},
  "GuardianHomeTab:ChildMastery": {"l":"gpMsProgress"},
  "GuardianHomeTab:MyPopups": {"l":"ppMineTitle"},
  "GuardianHomeTab:ChildMissedLessons": {"l":"gpMissedLessons","nl":1},
};

const NEW_STAFF_LEAVES = [
  "AdminTab:Import",
  "AdminTab:MessageTemplates",
  "AdminTab:AiSettings",
  "AdminTab:AiRules",
  "AdminTab:AiExchanges",
];
const GONE = ["AdminTab:YearChange"]; // lives in Admin ③ (the Admin hub card) now

function gatesOf(l: Leaf): Record<string, unknown> {
  const o: Record<string, unknown> = { l: l.labelKey };
  if (l.perms) o.p = l.perms;
  if (l.allOf) o.a = l.allOf;
  return o;
}
function expectedGates(f: { l: string; p?: string[]; a?: string[] }): Record<string, unknown> {
  const o: Record<string, unknown> = { l: f.l };
  if (f.p) o.p = f.p;
  if (f.a) o.a = f.a;
  return o;
}

describe("sidebar groups (D-#1654): staff", () => {
  test("top level: Today, then the twelve groups in the approved order", () => {
    expect(STAFF.map((s) => (s.type === "group" ? `g:${s.titleKey}` : key(s)))).toEqual([
      "HomeTab:",
      "g:navGTeaching",
      "g:navGHomework",
      "g:exGroup",
      "g:navGBooks",
      "g:navGReview",
      "g:navGAnalysis",
      "g:navGPending",
      "g:navGPeople",
      "g:navGComms",
      "g:wbTab",
      "g:navGAi",
      "g:navGOffice",
    ]);
    for (const old of ["drawerGroupAcademics", "drawerGroupTrackers", "msDrawerGroup", "drawerItemClassNotes", "tabReports", "drawerGroupBook"]) {
      expect(STAFF.some((s) => s.type === "group" && s.titleKey === old)).toBe(false);
    }
  });

  test("the smaller groups hold the approved leaves in the approved order", () => {
    const keys = (t: string): string[] => groupOf(STAFF, t).map(key);
    expect(keys("navGTeaching")).toEqual([
      "RoutineTab:", "ContentTab:", "ClassNotesTab:MyClassNotes", "ClassNotesTab:AllClassNotes", "ClassNotesTab:LessonProgress",
      "ReportsTab:LessonProgress", "AttendanceTab:", "TeachingNotesTab:", "VocabTab:", "EnglishDriveTab:",
    ]);
    expect(keys("navGHomework")).toEqual(["TrackersTab:", "HomeworkTab:", "AssignmentTab:", "RevisionTab:", "WinterTaskTab:"]);
    expect(keys("navGBooks")).toEqual([
      "ClassBooksTab:", "BookLcTeacherTab:", "LibraryTab:", "StorybooksTab:", "ActivityTab:", "BookLcTab:",
      "SupportBookTab:BookImport", "SupportBookTab:BookPolicy", "SupportBookTab:BookImageQueue", "SupportBookTab:BookReview",
      "SupportBookTab:BookEscalationInbox", "SupportBookTab:BookAssemble",
    ]);
    expect(keys("navGReview")).toEqual([
      "QuestionsTab:", "SetsTab:", "ReviewTab:ReviewHub", "ReviewTab:", "ReviewTab:ReviewSupervision", "MasteryTab:MasteryHome",
      "MasteryTab:MasteryImport", "MasteryTab:MasteryReviews", "MasteryTab:MasteryTags", "MasteryTab:MasteryPolicy", "AdminTab:Import",
    ]);
    expect(keys("navGPeople")).toEqual(["ObservationTab:", "FreeMixingTab:", "HomeTab:SupportHome"]);
    expect(keys("navGComms")).toEqual(["ChatTab:", "CommentsTab:", "PopupNoticesTab:", "HomeTab:MyPopups", "AdminTab:MessageTemplates"]);
    expect(keys("navGAi")).toEqual(["AiAssistTab:", "AiWorkspaceTab:", "AdminTab:AiSettings", "AdminTab:AiRules", "AdminTab:AiExchanges"]);
    expect(keys("navGOffice")).toEqual([
      "FinanceTab:", "ReportsTab:FinanceDashboard", "ReportsTab:DailySnapshot", "HrTab:", "PrintTab:", "AdminTab:",
    ]);
  });

  test("analysis and pending-work reports hold every Reports leaf exactly once between them", () => {
    const analysis = groupOf(STAFF, "navGAnalysis").map(key);
    expect(analysis).toEqual([
      "ClassTestTab:StudentProgress", "ReportsTab:StudentProgress", "MasteryTab:MasteryWork", "MasteryTab:MasteryLeader",
      "ReportsTab:MarksDrivers", "ReportsTab:ClassTestDashboard", "ReportsTab:AttendanceRanking", "ReportsTab:RevisionDashboard",
      "ReportsTab:MasteryBankCoverage", "ReportsTab:GuardianEngagement", "ReportsTab:DailyReport", "DataAssistantTab:",
    ]);
    const pending = groupOf(STAFF, "navGPending").map(key);
    expect(pending).toHaveLength(23);
    expect(pending.every((k) => k.startsWith("ReportsTab:"))).toBe(true);
    const oldReports = Object.keys(FROZEN_STAFF).filter((k) => k.startsWith("ReportsTab:"));
    expect(oldReports).toHaveLength(34);
    const placed = flat(STAFF).map((x) => key(x.leaf)).filter((k) => k.startsWith("ReportsTab:"));
    expect([...placed].sort()).toEqual([...oldReports].sort());
  });

  test("প্রিন্ট is in অফিস ও প্রশাসন, not in বাড়ির কাজ ও ট্র্যাকার; no year-change item", () => {
    expect(groupOf(STAFF, "navGOffice").map(key)).toContain("PrintTab:");
    expect(groupOf(STAFF, "navGHomework").map(key)).not.toContain("PrintTab:");
    expect(flat(STAFF).some((x) => key(x.leaf) === "AdminTab:YearChange")).toBe(false);
    expect(STAFF.some((s) => s.type === "item" && s.route === "AdminTab")).toBe(false);
  });

  test("leaf keys are unique", () => {
    const keys = flat(STAFF).map((x) => key(x.leaf));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("FROZEN: every old leaf is still there with exactly its gates (nobody gains or loses access)", () => {
    const now = new Map(flat(STAFF).map((x) => [key(x.leaf), x]));
    for (const [k, f] of Object.entries(FROZEN_STAFF)) {
      if (GONE.includes(k)) {
        expect(now.has(k)).toBe(false);
        continue;
      }
      const cur = now.get(k);
      expect({ k, found: !!cur }).toEqual({ k, found: true });
      const { leaf, hiddenGroup } = cur!;
      expect({ k, ...gatesOf(leaf) }).toEqual({ k, ...expectedGates(f) });
      expect({ k, hidden: !!(leaf.hidden || hiddenGroup) }).toEqual({ k, hidden: !!f.h });
      expect({ k, nl: !!leaf.needsLessonProgress, ns: !!leaf.needsSupportSwitch, v: !!leaf.orViewAs }).toEqual({
        k, nl: !!f.nl, ns: !!f.ns, v: !!f.v,
      });
    }
    // Nothing else is new except the five Admin-hub cards that became leaves (their gates equal the card's).
    const added = [...now.keys()].filter((k) => !(k in FROZEN_STAFF));
    expect([...added].sort()).toEqual([...NEW_STAFF_LEAVES].sort());
  });

  test("the five new AdminTab leaves carry the exact gate of the Admin card they replace", () => {
    const by = new Map(flat(STAFF).map((x) => [key(x.leaf), x.leaf]));
    expect(by.get("AdminTab:Import")?.perms).toEqual(["lesson_plans:import", "question_bank:import"]);
    expect(by.get("AdminTab:MessageTemplates")?.perms).toEqual(["message_templates:view"]);
    expect(by.get("AdminTab:AiSettings")?.perms).toEqual(["system_health:ai_key"]);
    expect(by.get("AdminTab:AiRules")?.perms).toEqual(["ai_assist:edit_rules", "ai_assist:read_rules"]);
    expect(by.get("AdminTab:AiExchanges")?.perms).toEqual(["ai_assist:read_ai_log"]);
  });

  test("the six support-book leaves stay off the sidebar (hidden, as their old group was)", () => {
    const sb = groupOf(STAFF, "navGBooks").filter((l) => l.route === "SupportBookTab");
    expect(sb).toHaveLength(6);
    expect(sb.every((l) => l.hidden === true)).toBe(true);
  });
});

describe("sidebar groups (D-#1654): guardian", () => {
  test("Today, then study / exams / books / my child; every old leaf kept with its gates", () => {
    expect(GUARDIAN.map((s) => (s.type === "group" ? `g:${s.titleKey}` : key(s)))).toEqual([
      "GuardianHomeTab:", "g:navGStudy", "g:exGroup", "g:navGBooks", "g:navGChild",
    ]);
    expect(groupOf(GUARDIAN, "navGStudy").map(key)).toEqual([
      "GuardianRoutineTab:", "GuardianHomeworkTab:", "GuardianClassNotesTab:", "GuardianAssignmentsTab:", "GuardianHomeTab:ChildMissedLessons",
    ]);
    expect(groupOf(GUARDIAN, "navGBooks").map(key)).toEqual(["GuardianBooksTab:", "GuardianStoriesTab:", "GuardianActivityTab:"]);
    expect(groupOf(GUARDIAN, "navGChild").map(key)).toEqual([
      "GuardianHomeTab:ChildAttendance", "GuardianHomeTab:ChildLeave", "GuardianHomeTab:ChildComments",
      "GuardianHomeTab:ChildMeetingResults", "GuardianHomeTab:ChildRevision", "GuardianHomeTab:ChildMastery", "GuardianHomeTab:MyPopups",
    ]);
    const now = new Map(flat(GUARDIAN).map((x) => [key(x.leaf), x.leaf]));
    expect(now.size).toBe(Object.keys(FROZEN_GUARDIAN).length);
    for (const [k, f] of Object.entries(FROZEN_GUARDIAN)) {
      const leaf = now.get(k);
      expect({ k, found: !!leaf }).toEqual({ k, found: true });
      expect({ k, ...gatesOf(leaf!) }).toEqual({ k, ...expectedGates(f) });
      expect({ k, nl: !!leaf!.needsLessonProgress }).toEqual({ k, nl: !!f.nl });
    }
  });
});

describe("the new names and the Admin / HR move (D-#1654)", () => {
  test("group and sub-heading labels exist in Bangla and English", () => {
    for (const [k, bn] of [
      ["navGTeaching", "পাঠদান"], ["navGHomework", "বাড়ির কাজ ও ট্র্যাকার"], ["navGBooks", "বই"], ["navGReview", "প্রশ্ন ও রিভিউ"],
      ["navGAnalysis", "বিশ্লেষণ"], ["navGPending", "বাকি কাজের রিপোর্ট"], ["navGPeople", "পর্যবেক্ষণ ও সহায়তা"], ["navGComms", "যোগাযোগ"],
      ["navGAi", "এআই"], ["navGOffice", "অফিস ও প্রশাসন"], ["navGStudy", "পড়াশোনা"], ["navGChild", "আমার সন্তান"],
      ["admGPeople", "① মানুষ ও লগইন"], ["admGClass", "② শ্রেণি, শিক্ষক ও শিক্ষার্থী"], ["admGYear", "③ শিক্ষাবর্ষ"], ["admGWatch", "④ নজরদারি"],
    ]) {
      expect(labels).toContain(`  ${k}: "${bn}",`);
      expect(labels.split(`\n  ${k}: "`).length - 1).toBe(2);
    }
  });

  test("Admin hub: the moved cards are gone, the four sub-headings are there", () => {
    for (const route of ["Import", "AiSettings", "AiRules", "AiExchanges", "MessageTemplates", "Staff"]) {
      expect(adminHome).not.toContain(`navigate("${route}")`);
    }
    for (const h of ["admGPeople", "admGClass", "admGYear", "admGWatch"]) expect(adminHome).toContain(`STR.${h}`);
    for (const route of ["UserList", "GuardianCredentials", "AccessControlUsers", "ScopeGrant", "SupervisoryGrant", "Roster", "StudentBanglaNames",
      "AssignSubjectTeacher", "AssignClassTeacher", "GroupMembers", "SectionConfig", "AcademicYear", "YearChange", "AuditLog", "PersonActivity", "SystemHealth"]) {
      expect(adminHome).toContain(`navigate("${route}")`);
    }
  });

  test("the Admin tab still opens on every action it opened on (canAdmin untouched)", () => {
    const from = appTabs.indexOf("const canAdmin = any(");
    expect(from).toBeGreaterThan(-1);
    const canAdmin = appTabs.slice(from, appTabs.indexOf(");", from));
    for (const a of ["staff_records:view", "message_templates:view", "lesson_plans:import", "question_bank:import"]) {
      expect(canAdmin).toContain(`"${a}"`);
    }
  });

  test("the plain প্রশাসন leaf shows only for an action that still has a card on the Admin hub", () => {
    const leaf = flat(STAFF).map((x) => x.leaf).find((l) => key(l) === "AdminTab:");
    expect(leaf?.perms).toBeDefined();
    const used = [...adminHome.matchAll(/\bcan\("([a-z_]+:[a-z_]+)"\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(10);
    // routine:view is the routine card's second condition (with routine:settings), not a way in on its own.
    for (const a of used.filter((u) => u !== "routine:view")) expect(leaf!.perms).toContain(a);
    // and nothing from the moved cards leaks in
    for (const a of ["staff_records:view", "lesson_plans:import", "question_bank:import", "message_templates:view", "system_health:ai_key"]) {
      expect(leaf!.perms).not.toContain(a);
    }
  });

  test("কর্মী তালিকা is a gated HR card; the HR stack registers the list and every screen it opens; the Admin route stays", () => {
    expect(hrHome).toMatch(/canStaffList = can\("staff_records:view"\)/);
    expect(hrHome).toContain('navigation.navigate("StaffList")');
    for (const s of ["StaffList", "StaffForm", "StaffHub", "StaffJoin", "IssueLetter", "ConfirmEmployment", "StaffPayEdit"]) {
      expect(appTabs).toContain(`<HrStack.Screen name="${s}"`);
      expect(appTabs).toContain(`<AdminStack.Screen name="${s === "StaffList" ? "Staff" : s}"`);
    }
  });
});

describe("dedupeByLabel (D-#1654)", () => {
  test("keeps the first of two leaves with one label, in order; different labels untouched", () => {
    const a = { labelKey: "impNavTitle", route: "ClassTestTab" };
    const b = { labelKey: "msWork", route: "MasteryTab" };
    const c = { labelKey: "impNavTitle", route: "ReportsTab" };
    expect(nav.dedupeByLabel([a, b, c])).toEqual([a, b]);
    expect(nav.dedupeByLabel([c, b])).toEqual([c, b]);
    expect(nav.dedupeByLabel([])).toEqual([]);
  });

  test("the drawer dedupes after ordering and for the open check and the arrange panel", () => {
    expect(drawer).toContain("const keepTwin = new Set(dedupeByLabel(section.items.filter(visibleLeaf)));");
    expect(drawer).toContain("dedupeByLabel(keys.map((k) => LEAF_BY_KEY.get(k))");
    expect(drawer).toContain("dedupeByLabel(s.items.filter(visibleLeaf))");
  });
});

describe("migrateOrder with the D-#1654 migrations", () => {
  /** The migration list, read from the drawer source and evaluated. */
  const M = ((): Array<{ key: string; replaces: string[]; after?: string }> => {
    const at = drawer.indexOf("const NAV_ORDER_MIGRATIONS: NavOrderMigration[] = [");
    const body = drawer.slice(drawer.indexOf("[", at), drawer.indexOf("\n];", at) + 2);
    // eslint-disable-next-line no-new-func
    return new Function("return " + body)();
  })();

  test("the drawer keeps the D-#1652 entry first, then the new groups", () => {
    expect(M[0].key).toBe("g:exGroup");
    expect(M.map((m) => m.key).slice(1)).toEqual([
      "g:navGTeaching", "g:navGHomework", "g:navGBooks", "g:navGReview", "g:navGAnalysis", "g:navGPending",
      "g:navGPeople", "g:navGComms", "g:navGAi", "g:navGOffice", "g:navGStudy", "g:navGChild",
    ]);
  });

  test("every new group has an `after` fallback", () => {
    for (const m of M) expect(m.after).toBeDefined();
  });

  test("a saved old staff order: each new group lands where its old sections were; analysis before pending", () => {
    const old = [
      "HomeTab:", "g:drawerGroupAcademics", "g:drawerGroupTrackers", "g:syDrawerGroup", "AiAssistTab:", "g:msDrawerGroup",
      "AttendanceTab:", "PrintTab:", "g:wbTab", "g:drawerItemClassNotes", "CommentsTab:", "ObservationTab:", "LibraryTab:",
      "FinanceTab:", "HrTab:", "g:tabReports", "g:drawerGroupBook", "AdminTab:", "AdminTab:YearChange",
    ];
    const next = nav.migrateOrder(old, M);
    const pos = (k: string): number => next.indexOf(k);
    // Every new group got a slot.
    for (const g of ["g:exGroup", "g:navGTeaching", "g:navGHomework", "g:navGBooks", "g:navGReview", "g:navGAnalysis", "g:navGPending",
      "g:navGPeople", "g:navGComms", "g:navGAi", "g:navGOffice"]) {
      expect(pos(g)).toBeGreaterThan(-1);
    }
    expect(pos("g:navGTeaching")).toBe(1);
    expect(pos("g:navGHomework")).toBeLessThan(pos("g:drawerGroupTrackers"));
    expect(pos("g:navGAnalysis")).toBeLessThan(pos("g:navGPending"));
    expect(pos("g:navGPending")).toBe(pos("g:tabReports") - 1);
    expect(pos("g:navGOffice")).toBeLessThan(pos("FinanceTab:"));
    expect(pos("HomeTab:")).toBe(0);
    // Nothing was dropped; the order is only added to.
    expect(old.every((k) => next.includes(k))).toBe(true);
    // A second pass changes nothing (the drawer runs it on every render).
    expect(nav.migrateOrder(next, M)).toEqual(next);
  });

  test("an empty order stays empty; an order with no anchors is left alone", () => {
    expect(nav.migrateOrder([], M)).toEqual([]);
    expect(nav.migrateOrder(["HelpTab:"], M)).toEqual(["HelpTab:"]);
  });

  test("a saved guardian order: study, books and my-child land at their old items' places", () => {
    const old = [
      "GuardianHomeTab:", "GuardianBooksTab:", "GuardianStoriesTab:", "GuardianActivityTab:", "g:drawerGroupAcademics",
      "GuardianHomeTab:ChildAttendance", "GuardianHomeTab:ChildLeave", "GuardianHomeTab:MyPopups",
    ];
    const next = nav.migrateOrder(old, M);
    expect(next.indexOf("g:navGBooks")).toBeLessThan(next.indexOf("GuardianBooksTab:"));
    expect(next.indexOf("g:navGBooks")).toBeGreaterThan(next.indexOf("GuardianHomeTab:"));
    expect(next.indexOf("g:navGStudy")).toBeLessThan(next.indexOf("g:drawerGroupAcademics"));
    expect(next.indexOf("g:navGChild")).toBeLessThan(next.indexOf("GuardianHomeTab:ChildAttendance"));
  });
});

describe("migrateOrder: an order saved BEFORE the change keeps every new group above HelpTab:", () => {
  const M = ((): Array<{ key: string; replaces: string[]; after?: string }> => {
    const at = drawer.indexOf("const NAV_ORDER_MIGRATIONS: NavOrderMigration[] = [");
    const body = drawer.slice(drawer.indexOf("[", at), drawer.indexOf("\n];", at) + 2);
    // eslint-disable-next-line no-new-func
    return new Function("return " + body)();
  })();
  const idx = (o: string[], k: string): number => o.indexOf(k);

  test("(a) a default-teacher order (no ReportsTab, no DataAssistant): all her groups come before HelpTab:", () => {
    const old = [
      "HomeTab:", "g:drawerGroupAcademics", "g:drawerItemClassNotes", "g:drawerGroupTrackers", "g:syDrawerGroup", "g:scDrawerGroup",
      "g:msDrawerGroup", "AttendanceTab:", "g:wbTab", "CommentsTab:", "ChatTab:", "PopupNoticesTab:", "g:drawerGroupBook", "HelpTab:",
    ];
    const next = nav.migrateOrder(old, M);
    const help = idx(next, "HelpTab:");
    for (const g of ["g:exGroup", "g:navGTeaching", "g:navGHomework", "g:navGBooks", "g:navGReview", "g:navGAnalysis", "g:navGPending",
      "g:navGPeople", "g:navGComms", "g:navGAi"]) {
      expect({ g, at: idx(next, g) > -1 && idx(next, g) < help }).toEqual({ g, at: true });
    }
    expect(idx(next, "g:navGAi")).toBeGreaterThan(idx(next, "g:wbTab"));
    expect(idx(next, "g:navGTeaching")).toBeGreaterThan(idx(next, "HomeTab:") - 1);
    expect(nav.migrateOrder(next, M)).toEqual(next);
  });

  test("(b) an Office-like order (no ObservationTab / AI tabs): people and AI come before HelpTab:", () => {
    const old = [
      "HomeTab:", "AttendanceTab:", "PrintTab:", "g:wbTab", "FinanceTab:", "HrTab:", "AdminTab:", "g:drawerGroupAcademics", "HelpTab:",
    ];
    const next = nav.migrateOrder(old, M);
    const help = idx(next, "HelpTab:");
    for (const g of ["g:navGPeople", "g:navGAi", "g:navGComms", "g:navGOffice", "g:navGPending", "g:navGAnalysis"]) {
      expect({ g, at: idx(next, g) > -1 && idx(next, g) < help }).toEqual({ g, at: true });
    }
  });

  test("an old Office order: অফিস ও প্রশাসন lands after কাজের বোর্ড (PrintTab: sat far above it)", () => {
    const old = ["HomeTab:", "AttendanceTab:", "PrintTab:", "g:drawerGroupAcademics", "g:wbTab", "FinanceTab:", "HrTab:", "AdminTab:", "HelpTab:"];
    const next = nav.migrateOrder(old, M);
    expect(idx(next, "g:navGOffice")).toBeGreaterThan(idx(next, "g:wbTab"));
    expect(idx(next, "g:navGOffice")).toBeLessThan(idx(next, "HelpTab:"));
  });
});
