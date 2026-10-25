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

/** The Reports hub, leaf by leaf (screen name → the actions that open it). One switch per
 *  report (D-#846), each showing that report for the whole school; Principal + Office hold all
 *  of them by default, and the Principal can hand any one of them to one person. A holder of the
 *  feature's own whole-school read keeps the leaf too. */
export const REPORT_LEAF_ACTIONS: Record<string, string[]> = {
  TeacherClassLoad: ["reports:class_load", "routine:view_all"],
  AssignmentLoadReport: ["reports:assignment_load"],
  ClassTestReport: ["reports:class_test", "class_test:view_all"],
  AttendanceReport: ["reports:attendance", "attendance:view_all"],
  ClassNoteReport: ["reports:class_note", "class_note:view_all"],
  HwDeclarePending: ["reports:hw_declare_pending"],
  HwIssuePending: ["reports:hw_issue_pending"],
  AsDeclarePending: ["reports:as_declare_pending"],
  AsDeliverPending: ["reports:as_deliver_pending"],
  AsPrintPending: ["reports:as_print_pending"],
  ReconciliationReport: ["reports:reconciliation"],
  HwLifecycleReport: ["reports:hw_lifecycle"],
  HwWeeklyUnsubmitted: ["reports:hw_weekly_unsubmitted"],
};

/** Any of these opens the Reports tab. */
export const REPORT_ACTIONS: string[] = [...new Set(Object.values(REPORT_LEAF_ACTIONS).flat())];
