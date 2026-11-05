/**
 * Follow-ups after a sheet is checked (AS-4 fills these in: the guardian's "checked" alert and
 * the level-up hint). Kept apart so the corner service stays free of notification wiring.
 */
import type { IActivityIssue } from "../models/ActivityIssue";

export async function afterReturn(_issue: IActivityIssue): Promise<void> {
  // AS-4.
}
