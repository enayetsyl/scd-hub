/** Reviewer hub (H-1) permission lists, shared by the drawer and the Today card. */

/** The reviews the hub can list - holding any of them earns the hub its drawer entry. */
export const REVIEW_HUB_PERMS = [
  "plan_review:review", "question_review:review", "exam_papers:review", "mastery:review",
  "classroom_observation:review", "free_mixing_review:review", "book_production:review", "winter_task:review",
  "class_test_question:create",
];
/** Who the plan/question review screen (ReviewHome) is for - what used to gate the whole tab. */
export const REVIEW_HOME_PERMS = [
  "plan_review:assign", "plan_review:review", "plan_review:approve",
  "question_review:assign", "question_review:view_all", "question_review:review", "question_review:publish",
  "review_program:supervise",
];
