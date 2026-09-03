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
import { addDaysKey } from "./dates";

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

    // CT-8 submit/approve loop, both halves on the exam itself rather than on a list
    // the recipient then has to search. Each falls back to its old list screen when
    // the row carries no exam id.
    //   SUBMITTED → the approver (Principal/Office) lands on the exam's RESULTS
    //   screen (D-#637, owner 2026-09-03). It used to open the publish screen, which
    //   offers অনুমোদন / ফেরত with the marks themselves nowhere in sight — the
    //   approver's first act is to READ what the teacher entered, and the results
    //   screen carries "প্রকাশ করুন" straight through to publish once they have.
    //   PUBLISHED → the exam's teacher lands on the read-only results view: the
    //   notice tells them the marks reached guardians, and this is the screen that
    //   shows what was released. NOT the publish screen — nothing is left for them
    //   to do there once it is out.
    case "CT_RESULT_SUBMITTED":
      return refs?.classTestId
        ? {
            tab: "ClassTestTab",
            screen: "ClassTestResults",
            params: { testId: refs.classTestId, title: refs.ctId ?? "" },
          }
        : { tab: "ClassTestTab", screen: "ClassTestDashboard" };
    case "CT_RESULT_PUBLISHED":
      return refs?.classTestId
        ? {
            tab: "ClassTestTab",
            screen: "ClassTestResultsView",
            params: { testId: refs.classTestId, title: refs.ctId ?? "" },
          }
        : { tab: "ClassTestTab", screen: "ClassTestHome" };

    // Guardian chase/result/delivery kinds → the child's screen; the staff
    // fallbacks are defensive (these kinds are guardian-addressed today).
    case "HW_CHASE":
      return guardian
        ? { tab: "GuardianHomeworkTab", screen: "ChildHomework" }
        : { tab: "HomeworkTab", screen: "HomeworkHome" };
    // D-#452: the weekly digest lands the guardian on the child's homework list
    // preset to the digest's week (refs.date = the week's Sunday); staff land on
    // the weekly unsubmitted report.
    case "HW_WEEKLY_DIGEST":
      return guardian
        ? {
            tab: "GuardianHomeworkTab",
            screen: "ChildHomework",
            params: refs?.date
              ? {
                  studentId: refs.studentId ?? undefined,
                  from: refs.date,
                  to: addDaysKey(refs.date, 4), // Sun → Thu
                }
              : refs?.studentId
                ? { studentId: refs.studentId }
                : undefined,
          }
        : { tab: "ReportsTab", screen: "HwWeeklyUnsubmitted" };
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
    case "CLASS_TEST_OVERDUE_DIGEST":
      // D-#603: the digest carries only counts, so the row MUST land on the
      // dashboard that lists which exams they are. Office/Principal only — a
      // guardian can never receive this kind.
      return { tab: "ClassTestTab", screen: "ClassTestDashboard" };
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

    // --- WC-6: the guardian work-claim loop -------------------------------
    // Every one of these was a dead-end tap: the kinds shipped with GC-1..GC-5
    // and RL-2 and none reached this switch, so a teacher told "a parent says the
    // work is done" tapped it and went nowhere — the one row where acting fast is
    // the whole point of the feature.

    // Teacher-addressed: the filing, the Office nudge and the WC-7 handover all
    // use this kind. আজ carries the claim card, which is where they act.
    case "WORK_CLAIM_FILED":
      return { tab: "HomeTab", screen: "Today" };
    // The 11:30 / 13:00 digest — Office and Principal both land on the queue the
    // rung is counting (and which OFFICE reaches without any tracker permission).
    case "WORK_CLAIM_ESCALATED":
      return { tab: "AdminTab", screen: "WorkClaimQueue" };
    // Guardian-addressed: the answer to what they filed. The tracker decides the
    // list — without it a homework answer would open the assignment tab.
    case "WORK_CLAIM_RESOLVED":
      if (!guardian) return { tab: "AdminTab", screen: "WorkClaimQueue" };
      return refs?.workClaimTracker === "ASSIGNMENT"
        ? { tab: "GuardianAssignmentsTab", screen: "ChildAssignments" }
        : { tab: "GuardianHomeworkTab", screen: "ChildHomework" };
    // RL-2: the student is back. আজ carries the returning-students card, which
    // names the student and the work to ask for.
    case "STUDENT_RETURNED":
      return { tab: "HomeTab", screen: "Today" };

    case "STAFF_LEAVE_SUBMITTED":
      // The notification exists to get someone to DECIDE. Without this case it fell to
      // `default: null`, so the row was a dead end — the Principal read "X applied for
      // leave", tapped it, went nowhere, and then walked to ছুটি ব্যবস্থাপনা by hand
      // (D-#582). That screen opens on the আবেদিত filter, which is this application.
      return { tab: "HrTab", screen: "LeaveAdmin" };

    default:
      return null;
  }
}
