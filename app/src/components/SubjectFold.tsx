/**
 * SubjectFold (D-#306) — folds a tracker worklist per subject. Records of the
 * subjects the caller actively teaches on the section render exactly as before
 * (one list, the screen's own grouping); every OTHER subject collapses to one
 * "▸ বিষয় (n)" toggle (the D-#302 fold idiom), so a class teacher / supervisor
 * still reaches other subjects' records without them crowding the daily list.
 * `taught` = null (admins, whole-section covers, loading) renders everything
 * expanded — the pre-fold behavior, and the subject-teacher view the server
 * already narrowed stays visually unchanged.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "./ui";
import { hwSubjectLabel, bnNum } from "../lib/labels";
import { space } from "../theme/tokens";

export interface SubjectFoldRenderOpts {
  /** True for a FOLDED (not-my-subject) group — D-#388: oversight is read-only.
   *  The server already refuses the writes (canWrite honours only teaching/proxy
   *  grants matching section AND subject), so this hides controls that would
   *  simply 403 rather than being the gate itself. */
  readOnly?: boolean;
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

  return (
    <>
      {render(visible)}
      {foldOrder.map((subject) => {
        const rows = folded.get(subject)!;
        const isOpen = !!open[subject];
        return (
          <View key={subject} style={{ marginBottom: space(2) }}>
            <Button
              title={`${isOpen ? "▾" : "▸"} ${hwSubjectLabel(subject)} (${bnNum(rows.length)})`}
              variant="secondary"
              onPress={() => setOpen((m) => ({ ...m, [subject]: !m[subject] }))}
            />
            {isOpen ? <View style={{ marginTop: space(2) }}>{render(rows, { readOnly: true })}</View> : null}
          </View>
        );
      })}
    </>
  );
}
