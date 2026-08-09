/**
 * SubjectFold (D-#306) — folds a tracker worklist per subject. Records of the
 * subjects the caller actively teaches on the section render exactly as before
 * (one list, the screen's own grouping); every OTHER subject collapses to one
 * "▸ বিষয় (n)" toggle (the D-#302 fold idiom), so a class teacher / supervisor
 * still reaches other subjects' records without them crowding the daily list.
 * `taught` = null (admins, whole-section covers, loading) renders everything
 * expanded — the pre-fold behavior, and the subject-teacher view the server
 * already narrowed stays visually unchanged.
 *
 * D-#469: the per-subject toggles now sit behind ONE "other subjects" control that
 * is CLOSED by default, so a class teacher opens the workspace on their own subject
 * alone. Owner report: Momin teaches only Islamic Studies but coordinates Class 2, so
 * four subjects' cards greeted him every morning. This is a DISPLAY default, not a
 * scope change — the whole section is still one tap away (he is the section's daily
 * coordinator, D-#42/#45) and the server still decides what may be read at all.
 * Exception: with no own-subject records the group opens itself, because a screen
 * that is empty except for a closed toggle reads as "nothing to do" when there is.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "./ui";
import { hwSubjectLabel, bnNum, STR } from "../lib/labels";
import { space } from "../theme/tokens";

export interface SubjectFoldRenderOpts {
  /** True for a FOLDED (not-my-subject) group — D-#388: oversight is read-only.
   *  The server already refuses the writes (canWrite honours only teaching/proxy
   *  grants matching section AND subject), so this hides controls that would
   *  simply 403 rather than being the gate itself. */
  readOnly?: boolean;
  /** Override for the read-only banner. The workspaces' completed-work fold reuses
   *  the same read-only card but is view-only for a different reason (the work is
   *  finished, not someone else's subject), so it supplies its own line. */
  viewOnlyNote?: string;
}

interface Props<T extends { subject: string }> {
  records: readonly T[];
  taught: Set<string> | null;
  render: (records: T[], opts?: SubjectFoldRenderOpts) => React.ReactNode;
}

export function SubjectFold<T extends { subject: string }>({
  records,
  taught,
  render,
}: Props<T>): React.ReactElement {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // null = the caller has not touched the control yet (see othersOpen below).
  const [showOthers, setShowOthers] = useState<boolean | null>(null);
  if (!taught) return <>{render([...records])}</>;

  const visible = records.filter((r) => taught.has(r.subject));
  // Folded subjects in first-seen order (records arrive newest given-date first).
  const foldOrder: string[] = [];
  const folded = new Map<string, T[]>();
  for (const r of records) {
    if (taught.has(r.subject)) continue;
    let list = folded.get(r.subject);
    if (!list) {
      list = [];
      folded.set(r.subject, list);
      foldOrder.push(r.subject);
    }
    list.push(r);
  }

  const otherCount = foldOrder.reduce((n, s) => n + (folded.get(s)?.length ?? 0), 0);
  // Nothing of the caller's own on this section ⇒ open the group rather than show a
  // screen that looks empty. `showOthers === null` means "not touched yet".
  const othersOpen = showOthers ?? visible.length === 0;

  return (
    <>
      {render(visible)}
      {otherCount > 0 ? (
        <View style={{ marginTop: space(2) }}>
          <Button
            title={`${othersOpen ? "▾" : "▸"} ${STR.wsOtherSubjects} (${bnNum(otherCount)})`}
            variant="secondary"
            onPress={() => setShowOthers(!othersOpen)}
          />
        </View>
      ) : null}
      {othersOpen
        ? foldOrder.map((subject) => {
            const rows = folded.get(subject)!;
            const isOpen = !!open[subject];
            return (
              <View key={subject} style={{ marginTop: space(2) }}>
                <Button
                  title={`${isOpen ? "▾" : "▸"} ${hwSubjectLabel(subject)} (${bnNum(rows.length)})`}
                  variant="secondary"
                  onPress={() => setOpen((m) => ({ ...m, [subject]: !m[subject] }))}
                />
                {isOpen ? <View style={{ marginTop: space(2) }}>{render(rows, { readOnly: true })}</View> : null}
              </View>
            );
          })
        : null}
    </>
  );
}
