import type { StudentProfilePanelKey } from "../../../navigation/types";
import { STR } from "../../../lib/labels";

/** The profile's tabs, in display order (owner ask 2026-09-30). */
export type ProfileTabKey =
  | "dashboard"
  | "profile"
  | "attendance"
  | "classTest"
  | "homework"
  | "assignment"
  | "complain";

export const PROFILE_TABS: ProfileTabKey[] = [
  "dashboard",
  "profile",
  "attendance",
  "classTest",
  "homework",
  "assignment",
  "complain",
];

export function tabLabel(k: ProfileTabKey): string {
  switch (k) {
    case "dashboard":
      return STR.spTabDashboard;
    case "profile":
      return STR.spTabProfile;
    case "attendance":
      return STR.spPanelAttendance;
    case "classTest":
      return STR.spPanelClassTest;
    case "homework":
      return STR.spPanelHomework;
    case "assignment":
      return STR.spPanelAssignment;
    case "complain":
      return STR.spTabComplain;
  }
}

/** Entry points still pass the old accordion's panel key; "comments" is now the Complaints tab. */
export function tabForPanel(p: StudentProfilePanelKey | undefined): ProfileTabKey {
  if (!p) return "dashboard";
  return p === "comments" ? "complain" : p;
}
