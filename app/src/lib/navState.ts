/**
 * The persisted React Navigation state (web only — see App.tsx).
 *
 * The key lives here rather than in App.tsx because a second caller needs it: switching
 * the D-#467 view mode changes WHICH drawer screens exist, so a restored tree could name
 * a route that the new mode does not render. Clearing the saved tree on a mode switch
 * makes the remount land on the mode's own initial route instead.
 */
import { removeItem } from "./storage";

/** Bumped to _v2 when the navigator went from bottom-tabs to a grouped drawer (D-#258). */
export const NAV_STATE_KEY = "scd_nav_state_v2";

/** Drop the persisted tree so the next navigator mount starts from its initial route. */
export async function clearNavState(): Promise<void> {
  await removeItem(NAV_STATE_KEY);
}
