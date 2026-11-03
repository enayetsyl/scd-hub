/**
 * Is the task behind a task-tied pop-up finished for this person (D-#913)? Read on every
 * app open while such a notice is live, so each check is the person's own work list — the
 * same read as their Today card — and never a sweep over the school.
 */
import { mySummaryWork } from "../../comments/services/MeetingChainService";
import type { PopupDoneWhen } from "../models/PopupNotice";

export async function isTaskDone(doneWhen: PopupDoneWhen, userId: string, now: Date): Promise<boolean> {
  switch (doneWhen) {
    case "MEETING_SUMMARIES": {
      const work = await mySummaryWork(userId, now);
      return work.every((m) => m.sections.every((s) => s.ready === 0 && s.waiting === 0));
    }
    default:
      return false;
  }
}
