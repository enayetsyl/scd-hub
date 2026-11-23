/**
 * ChildWeekCard (AL-10, docs/prd-academic-loop-2027.md §5 D5, R13, R31) - the guardian home's "এই সপ্তাহ" card: this
 * school week's confirmed marks per subject with the level word ("৮/১০ - ভালো"), the topics that are improving or need a
 * little attention, and what to practise at home. The same content as the weekly message (GWSUM). Plain, kind words only:
 * never an answer, a rank, another child or a শাখা average. Own query; renders nothing when nothing is confirmed this
 * week or the school has not switched the 2027 loop on (the server answers null).
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { CHILD_WEEK_SUMMARY, type ChildWeekSubjectRow } from "../graphql/mastery";
import { Body, Button, Card, Muted } from "./ui";
import { STR, bnNum, getActiveLang, hwSubjectLabel } from "../lib/labels";
import { guardianMarksLine } from "../lib/marksDisplay";
import { space } from "../theme/tokens";

/** A titled bullet list; nothing for an empty one. */
function Lines({ title, items }: { title: string; items: string[] }): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <View style={{ gap: 2 }}>
      <Body style={{ fontWeight: "600" }}>{title}</Body>
      {items.map((t, i) => (
        <Body key={`${i}-${t}`}>• {t}</Body>
      ))}
    </View>
  );
}

export function ChildWeekCard({ studentId, onOpenProgress }: { studentId: string; onOpenProgress?: () => void }): React.ReactElement | null {
  const [{ data, error }] = useQuery({ query: CHILD_WEEK_SUMMARY, variables: { studentId }, pause: !studentId, requestPolicy: "cache-and-network" });
  const subjects = (data?.childWeekSummary?.subjects ?? []) as ChildWeekSubjectRow[];
  if (error || subjects.length === 0) return null;
  const lang = getActiveLang();
  const withSubject = (rows: ChildWeekSubjectRow[], pick: (r: ChildWeekSubjectRow) => string[]) =>
    rows.flatMap((r) => pick(r).map((t) => `${hwSubjectLabel(r.subject)}: ${t}`));
  return (
    <Card>
      <Body style={{ fontWeight: "700", fontSize: 17 }}>{STR.gwTitle}</Body>
      <Muted>{STR.gwSub}</Muted>
      <View style={{ gap: 2 }}>
        {subjects.map((r) => (
          <Body key={r.subject}>
            {hwSubjectLabel(r.subject)} — {guardianMarksLine(r.earned, r.available, bnNum, lang) ?? ""}
          </Body>
        ))}
      </View>
      <Lines title={STR.gwImproving} items={withSubject(subjects, (r) => r.improvingBn)} />
      <Lines title={STR.gwAttention} items={withSubject(subjects, (r) => r.attentionBn)} />
      <Lines title={STR.gwClassMissed} items={withSubject(subjects, (r) => r.classMissedBn)} />
      <Lines title={STR.gwPractise} items={withSubject(subjects, (r) => r.practiseBn)} />
      {onOpenProgress ? <Button title={STR.gwMore} variant="secondary" onPress={onOpenProgress} /> : null}
    </Card>
  );
}
