/**
 * Notification deep-links (N3.2) — kind + refs (+ the viewer's role) → the tab
 * stack screen the row is about. Used by the NotificationCenter row tap; a push
 * tap (N4.2) opens the NotificationCenter first (one hop — the row carries the
 * same link), which keeps the tap handler role-agnostic.
 *
 * Unknown kinds (a future server adds one before the app updates) return null —
 * the row still renders and marks read, it just doesn't navigate.
 */
import type { Role } from "@scd/shared";
import type { NotificationRefsT } from "../graphql/operations";

export interface NotificationTarget {
  /** A TabParamList key — the root navigate goes App → tab → screen. */
  tab: string;
  screen: string;
  params?: Record<string, unknown>;
}

export function notificationTarget(
  kind: string,
  refs: Partial<NotificationRefsT> | null | undefined,
  role: Role | null,
): NotificationTarget | null {
  const guardian = role === "GUARDIAN";
  switch (kind) {
    case "BELL_REMINDER":
      return { tab: "RoutineTab", screen: "BellSchedule" };
    case "ATTENDANCE_REMINDER":
      return { tab: "AttendanceTab", screen: "AttendanceHome" };
    case "CLASS_NOTE_PROMPT":
    case "COVER_ASSIGNED":
      // MyRoutine carries the teacher's day + the notes-to-publish prompt.
      return { tab: "RoutineTab", screen: "MyRoutine" };
    case "CLASS_NOTE_ESCALATION":
      return { tab: "RoutineTab", screen: "RoutineHome" };
    case "CLASS_NOTE_PUBLISHED":
      // Guardians read class notes on the আজ home (N3.3).
      return guardian
        ? { tab: "GuardianHomeTab", screen: "GuardianHome" }
        : { tab: "RoutineTab", screen: "RoutineHome" };
    case "HW_PARENT_COMMS":
      return { tab: "HomeworkTab", screen: "HomeworkHome" };
    case "REVIEW_ASSIGNED":
      return refs?.reviewAssignmentId && refs?.artifactId
        ? {
            tab: "ReviewTab",
            screen: "ReviewSubmit",
            params: { assignmentId: refs.reviewAssignmentId, artifactId: refs.artifactId },
          }
        : { tab: "ReviewTab", screen: "ReviewHome" };
    case "LIBRARY_DUE_SOON":
    case "LIBRARY_OVERDUE":
      // Guardians have no Library tab — their child-loans card lives on আজ.
      return guardian
        ? { tab: "GuardianHomeTab", screen: "GuardianHome" }
        : { tab: "LibraryTab", screen: "LibraryHome" };
    // D-#296: a filed/finished print job lands the operator/teacher on the queue.
    case "PRINT_REQUESTED":
    case "PRINT_DELIVERED":
      return { tab: "PrintTab", screen: "PrintHome" };
    default:
      return null;
  }
}
