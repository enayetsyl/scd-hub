/**
 * HandBackBadges (D-#685) — the one place that tells a family a piece of homework
 * came BACK to the child rather than being new work.
 *
 * Two different journeys land here and a parent needs to tell them apart:
 *   resubOf      — the teacher checked it, marked it wrong, and sent the script
 *                  home to be done again.
 *   redelivered  — the child was absent when it was handed out and received it
 *                  on a later day.
 *
 * It exists as a component because D-#682 put these badges on the homework
 * DETAIL card only, and the three surfaces a parent actually opens first — the
 * Today screen's "করতে হবে" card, the day-grouped list under it, and the
 * "এখনো বাকি" card — went on showing a bare "বাড়ির কাজ আনেনি" against work the
 * school had handed back that week. That read as an accusation about new work.
 * One component, used by all four, is what stops a fifth surface drifting again.
 */
import React from "react";
import { View } from "react-native";
import { Badge } from "./ui";
import { space } from "../theme/tokens";
import { STR } from "../lib/labels";

/**
 * True when the card should show ONLY that the work came back, and suppress the
 * lifecycle status and chase count entirely (owner ruling 2026-09-16, D-#687).
 *
 * The reason is that on a handed-back record the status is not a statement about
 * the child. `HW-C-1-ENG-0018` was chased at 17:30 by `sweepHomeworkAutoChase`
 * with no `by` on the stamp — a system sweep that fires precisely when nobody ran
 * the submission pass — and the card rendered that as "বাড়ির কাজ আনেনি", a
 * teacher's accusation, against a script the school had handed back three days
 * earlier. The honest thing to tell a family about a returned script is that it
 * was returned; the chase ladder behind it is the school's business, not a
 * verdict on the child.
 */
export function handBackOnly(handedBack: boolean, redelivered: boolean): boolean {
  return handedBack || redelivered;
}

export interface HandBackBadgesProps {
  /** True when this record re-issues an earlier attempt (the teacher's hand-back).
   *  A boolean, not the parent id: the assignment tracker carries the same fact as
   *  `isResubmission`, and a shared component must not force one shape on both. */
  handedBack: boolean;
  /** Absent at issue, handed out on a later day. */
  redelivered: boolean;
  /** Extra top margin when the badges sit on their own line under a title row. */
  spaced?: boolean;
}

export function HandBackBadges({
  handedBack,
  redelivered,
  spaced,
}: HandBackBadgesProps): React.ReactElement | null {
  if (!handedBack && !redelivered) return null;
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: space(2),
        marginTop: spaced ? space(1) : 0,
      }}
    >
      {handedBack ? <Badge text={STR.gpHandedBack} tone="warn" /> : null}
      {redelivered ? <Badge text={STR.gpRedelivered} tone="info" /> : null}
    </View>
  );
}
