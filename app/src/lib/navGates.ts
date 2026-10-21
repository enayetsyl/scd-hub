/**
 * Navigation gates for the permission matrix (PM, D-#790–#801) — shared by AppTabs (which
 * tabs mount) and DrawerContent (which sidebar leaves show), so a tab and its leaves can
 * never disagree. A tab opens on ANY action of the screens inside it; every action is
 * re-gated server-side, so hiding a tab is a courtesy, not the gate.
 */
import { FEATURE_CATALOGUE, type FeatureKey } from "@scd/shared";

/** Every `feature:action` of one catalogue feature. */
export function featureActions(feature: FeatureKey): string[] {
  return Object.keys(FEATURE_CATALOGUE[feature].actions).map((a) => `${feature}:${a}`);
}

/** The Reports hub, leaf by leaf (screen name → the actions that open it). Each leaf is a
 *  school-wide oversight read; by default Principal + Office hold all of them, exactly the
 *  people the hub's old role gate admitted. */
export const REPORT_LEAF_ACTIONS: Record<string, string[]> = {
  TeacherClassLoad: ["routine:view_all"],
  AssignmentLoadReport: ["assignment:view_reports"],
  ClassTestReport: ["class_test:view_all"],
  AttendanceReport: ["attendance:view_all"],
  ClassNoteReport: ["class_note:view_all"],
  HwDeclarePending: ["homework:view_reports"],
  HwIssuePending: ["homework:view_reports"],
  AsDeclarePending: ["assignment:view_reports"],
  AsDeliverPending: ["assignment:view_reports"],
  AsPrintPending: ["assignment:view_reports"],
  ReconciliationReport: ["homework:view_reports", "assignment:view_reports"],
  HwLifecycleReport: ["homework:view_reports"],
  HwWeeklyUnsubmitted: ["homework:remind"],
};

/** Any of these opens the Reports tab. */
export const REPORT_ACTIONS: string[] = [...new Set(Object.values(REPORT_LEAF_ACTIONS).flat())];
