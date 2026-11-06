/**
 * Follow-ups after a sheet is checked (AS-4): the family's "checked" notification (with the
 * level-up hint when earned). Kept apart so the corner service stays free of notification wiring.
 */
import type { IActivityIssue } from "../models/ActivityIssue";
import { alertChecked } from "./ActivityFollowUpService";

export async function afterReturn(issue: IActivityIssue): Promise<void> {
  await alertChecked(issue);
}
