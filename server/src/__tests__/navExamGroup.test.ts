/**
 * D-#1652 (owner 2026-11-19): every exam screen sits in ONE sidebar group, "পরীক্ষা".
 *
 * A static read of `app/src/navigation/DrawerContent.tsx` (the app workspace has no test
 * runner — see navInitialRoute.test.ts), plus the pure `migrateOrder` helper that puts the
 * new group into a person's saved order (D-#920) where the old exam sections were.
 */
import { readFileSync } from "fs";
import path from "path";

const { migrateOrder } = require("../../../app/src/lib/navArrange") as {
  migrateOrder: (order: string[], migrations: Array<{ key: string; replaces: string[]; after?: string }>) => string[];
};

const drawer = readFileSync(path.resolve(__dirname, "../../../app/src/navigation/DrawerContent.tsx"), "utf8");
const labels = readFileSync(path.resolve(__dirname, "../../../app/src/lib/labels.ts"), "utf8");

/** The source of one `const NAME: NavSection[] = [ … ];` list. */
function navList(name: string): string {
  const start = drawer.indexOf(`const ${name}: NavSection[] = [`);
  expect(start).toBeGreaterThan(-1);
  return drawer.slice(start, drawer.indexOf("\n];", start));
}

/** The items text of the group whose titleKey is `titleKey` inside `list` (first match). */
function groupBody(list: string, titleKey: string): string {
  const at = list.indexOf(`titleKey: "${titleKey}"`);
  expect(at).toBeGreaterThan(-1);
  const items = list.indexOf("items: [", at);
  return list.slice(items, list.indexOf("\n    ],", items));
}

const STAFF = navList("STAFF_NAV");
const GUARDIAN = navList("GUARDIAN_NAV");

describe("পরীক্ষা sidebar group (D-#1652)", () => {
  test("staff: one exam group, the old exam groups and items are gone", () => {
    expect(STAFF.split('titleKey: "exGroup"').length - 1).toBe(1);
    expect(STAFF).not.toContain('titleKey: "syDrawerGroup"');
    expect(STAFF).not.toContain('titleKey: "scDrawerGroup"');
    expect(STAFF).not.toMatch(/type: "item", route: "QuranExamTab"/);
    expect(STAFF).not.toMatch(/type: "item", route: "VivaTab"/);
  });

  test("staff: every exam leaf is in the group, once, in the approved order, with its gate", () => {
    const body = groupBody(STAFF, "exGroup");
    const leaves = [
      'route: "ClassTestTab", labelKey: "tabClassTest"',
      'screen: "ExamRoutine", perms: ["exam_routine:view", "exam_routine:manage", "exam_routine:publish"]',
      'screen: "ExamDutyRoster", perms: ["exam_routine:manage"]',
      'screen: "MyExamDuty", perms: ["exam_routine:view"]',
      'labelKey: "syRead", icon: "📋", screen: "SyllabusHome" }',
      'screen: "SyllabusEntry", perms: ["exam_syllabus:edit"]',
      'labelKey: "syApprovalsNav", icon: "✅", screen: "SyllabusApprovals" }',
      'screen: "SyllabusExams", perms: ["exam_syllabus:settings"]',
      'screen: "ExamPapersHome", perms: ["exam_papers:review", "exam_papers:view", "exam_papers:manage"]',
      'screen: "ReferencePapers", perms: ["exam_papers:view_reference", "exam_papers:manage_reference"]',
      'route: "QuranExamTab", labelKey: "qxNav", icon: "🕋", perms: ["quran_exam:view", "quran_exam:manage", "quran_exam:examine"]',
      'route: "VivaTab", labelKey: "vivaNav", icon: "🗣️", perms: ["viva:view", "viva:manage", "viva:examine"]',
      'route: "ExamsTab", labelKey: "exNavResults", icon: "🧾", perms: ["exam_results:view", "exam_custody:view"]',
      'screen: "ScholarshipHome", perms: ["scholarship_practice:view"]',
      'screen: "ScholarshipTopics",\n        perms: ["scholarship_practice:settings"],\n        allOf: ["scholarship_practice:view"]',
    ];
    const at = leaves.map((l) => body.indexOf(l));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Nowhere else in the staff list.
    for (const route of ["SyllabusTab", "ExamPapersTab", "QuranExamTab", "VivaTab", "ExamsTab", "ScholarshipTab"]) {
      expect(STAFF.split(`route: "${route}"`).length).toBe(body.split(`route: "${route}"`).length);
    }
    expect(STAFF.split('route: "ClassTestTab", labelKey: "tabClassTest"').length - 1).toBe(1);
  });

  test("staff: বাড়ির কাজ ও ট্র্যাকার keeps its other items; student progress is in বিশ্লেষণ (D-#1654)", () => {
    const trackers = groupBody(STAFF, "navGHomework");
    expect(trackers).not.toContain('labelKey: "tabClassTest"');
    for (const route of ["TrackersTab", "HomeworkTab", "AssignmentTab", "RevisionTab"]) expect(trackers).toContain(`route: "${route}"`);
    expect(groupBody(STAFF, "navGAnalysis")).toContain('screen: "StudentProgress"');
  });

  test("guardian: class tests, syllabus and routine leave the study group for the exam group", () => {
    const exam = groupBody(GUARDIAN, "exGroup");
    const academics = groupBody(GUARDIAN, "navGStudy");
    for (const route of ["GuardianClassTestTab", "GuardianSyllabusTab"]) {
      expect(exam).toContain(`route: "${route}"`);
      expect(academics).not.toContain(`route: "${route}"`);
    }
    expect(exam).toContain('screen: "ChildExamRoutine"');
    expect(GUARDIAN.indexOf('titleKey: "navGStudy"')).toBeLessThan(GUARDIAN.indexOf('titleKey: "exGroup"'));
  });

  test("the new names exist in Bangla and English", () => {
    for (const [key, bn] of [
      ["exGroup", "পরীক্ষা"],
      ["syApprovalsNav", "সিলেবাস অনুমোদন"],
      ["exNavResults", "নম্বর ও ফলাফল"],
      ["scPapersNav", "বৃত্তি অনুশীলন"],
      ["scTopicsNav", "বৃত্তি টপিক তালিকা"],
    ]) {
      expect(labels).toContain(`  ${key}: "${bn}",`);
      expect(labels.split(`\n  ${key}: "`).length - 1).toBe(2);
    }
  });
});

describe("migrateOrder — the new group in a saved order (D-#920)", () => {
  test("the drawer applies it to the saved order, with the old exam sections as anchors", () => {
    expect(drawer).toContain("order: migrateOrder(p.order, NAV_ORDER_MIGRATIONS),");
    const m = drawer.slice(drawer.indexOf("const NAV_ORDER_MIGRATIONS"), drawer.indexOf("];", drawer.indexOf("const NAV_ORDER_MIGRATIONS")));
    expect(m).toContain('key: "g:exGroup"');
    expect(m).toContain('replaces: ["g:syDrawerGroup", "g:scDrawerGroup", "QuranExamTab:", "VivaTab:"]');
    expect(m).toContain('after: "g:drawerGroupAcademics"');
  });

  const M = [
    { key: "g:exGroup", replaces: ["g:syDrawerGroup", "g:scDrawerGroup", "QuranExamTab:", "VivaTab:"], after: "g:drawerGroupAcademics" },
  ];

  test("takes the place of the highest old exam section", () => {
    const order = ["HomeTab:", "VivaTab:", "g:drawerGroupAcademics", "g:syDrawerGroup", "QuranExamTab:", "AttendanceTab:"];
    expect(migrateOrder(order, M)).toEqual([
      "HomeTab:", "g:exGroup", "VivaTab:", "g:drawerGroupAcademics", "g:syDrawerGroup", "QuranExamTab:", "AttendanceTab:",
    ]);
  });

  test("a guardian's order: right after একাডেমিক", () => {
    const order = ["GuardianHomeTab:", "g:drawerGroupAcademics", "GuardianHomeTab:ChildAttendance"];
    expect(migrateOrder(order, M)).toEqual(["GuardianHomeTab:", "g:drawerGroupAcademics", "g:exGroup", "GuardianHomeTab:ChildAttendance"]);
  });

  test("leaves an empty order, an order that already has it, and an order with no anchor alone", () => {
    expect(migrateOrder([], M)).toEqual([]);
    const placed = ["g:exGroup", "HomeTab:", "g:syDrawerGroup"];
    expect(migrateOrder(placed, M)).toBe(placed);
    expect(migrateOrder(["HomeTab:", "ChatTab:"], M)).toEqual(["HomeTab:", "ChatTab:"]);
  });
});
