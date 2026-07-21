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

    // --- D-#301: the 15 previously unmapped kinds ---------------------------

    // CO-3 observation kinds all carry refs.observationId → the detail screen;
    // without it, fall back to the recipient's natural list.
    case "OBSERVATION_RELEASED":
    case "OBSERVATION_RESPONSE_REMINDER":
      // Teacher-facing: respond to their own observation.
      return refs?.observationId
        ? { tab: "ObservationTab", screen: "ObservationDetail", params: { observationId: refs.observationId } }
        : { tab: "ObservationTab", screen: "MyObservations" };
    case "OBSERVATION_RESPONDED":
    case "OBSERVATION_ESCALATED":
    case "OBSERVATION_READY_TO_PUBLISH":
      // Manager-facing (Principal/Office).
      return refs?.observationId
        ? { tab: "ObservationTab", screen: "ObservationDetail", params: { observationId: refs.observationId } }
        : { tab: "ObservationTab", screen: "ObservationHome" };

    // Homework daily-confirm ladder: the confirmer reconciles; Office/Principal
    // oversee via the reconciliation report (their surface regardless of tabs).
    case "HW_PENDING_REMINDER":
      return { tab: "HomeworkTab", screen: "HomeworkReconcile", params: refs?.date ? { date: refs.date } : undefined };
    case "HW_PENDING_ESCALATION":
      return { tab: "AdminTab", screen: "ReconciliationReport" };
    // D-#314: the auto-issue notice — land the confirmer on the day's reconcile
    // view (read-only once reconciled) so they can see what the system issued.
    case "HW_AUTO_ISSUED":
      return { tab: "HomeworkTab", screen: "HomeworkReconcile", params: refs?.date ? { date: refs.date } : undefined };

    // D-#342 CT question loop: the teacher lands on their request list; the
    // office lands on the work queue.
    case "CT_QUESTION_REVIEW":
      return { tab: "ClassTestTab", screen: "MyCtQuestions" };
    case "CT_QUESTION_OFFICE":
      return { tab: "ClassTestTab", screen: "CtQuestionQueue" };

    // Guardian chase/result/delivery kinds → the child's screen; the staff
    // fallbacks are defensive (these kinds are guardian-addressed today).
    case "HW_CHASE":
      return guardian
        ? { tab: "GuardianHomeworkTab", screen: "ChildHomework" }
        : { tab: "HomeworkTab", screen: "HomeworkHome" };
    case "ASSIGNMENT_CHASE":
      return guardian
        ? { tab: "GuardianAssignmentsTab", screen: "ChildAssignments" }
        : { tab: "AssignmentTab", screen: "AssignmentHome" };
    case "FINANCE_FEE_DUE":
      return guardian
        ? { tab: "GuardianHomeTab", screen: "ChildFees" }
        : { tab: "FinanceTab", screen: "FinanceHome" };
    case "CLASS_TEST_RESULT":
      // Guardian results render on the আজ home cards (N3.3 pattern).
      return guardian
        ? { tab: "GuardianHomeTab", screen: "GuardianHome" }
        : { tab: "ClassTestTab", screen: "ClassTestHome" };
    case "VOCAB_RESULT":
      return guardian
        ? { tab: "GuardianHomeTab", screen: "GuardianHome" }
        : { tab: "VocabTab", screen: "VocabHome" };
    case "STUDENT_COMMENT":
      return guardian
        ? { tab: "GuardianHomeTab", screen: "GuardianHome" }
        : { tab: "CommentsTab", screen: "CommentsHome" };
    case "SR_ABSENT":
    case "SR_DIGEST":
      return guardian
        ? { tab: "GuardianHomeTab", screen: "GuardianHome" }
        : { tab: "RevisionTab", screen: "RevisionHome" };

    default:
      return null;
  }
}
