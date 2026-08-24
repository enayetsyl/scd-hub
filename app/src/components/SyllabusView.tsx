/**
 * SyllabusView (SY-6) — the ONE renderer for a syllabus body.
 *
 * Used by the teacher read screen, the guardian screen and the teacher sign-off
 * screen. Three renderers is how a sheet handed to a parent quietly stops
 * matching what the teacher sees, so there is exactly one.
 *
 * Written/oral totals are DERIVED from the rows here as well as on the server
 * (D-#85) — the server value is what ships in the payload, and this component
 * only reads it.
 */
import React from "react";
import { View } from "react-native";
import { Card, Body, Muted, Badge, ChipRow, Chip } from "./ui";
import Markdown from "./Markdown";
import type { SyllabusT } from "../graphql/examSyllabus";
import {
  STR,
  bnNum,
  syllabusItemTypeLabel,
  examComponentLabel,
  routineSubjectLabel,
} from "../lib/labels";
import { useColors } from "../theme";
import { space, typeScale } from "../theme/tokens";

/** The mark-distribution table. Kept narrow enough for 360dp: four columns. */
export function MarkDistribution({ marks }: { marks: SyllabusT["marks"] }): React.ReactElement | null {
  const colors = useColors();
  if (!marks.length) return null;

  const total = marks.reduce((a, r) => a + r.total, 0);

  const cell = { paddingVertical: space(2), paddingHorizontal: space(1) } as const;
  const num = {
    ...typeScale.body,
    color: colors.textPrimary,
    textAlign: "right" as const,
    minWidth: 40,
  };

  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          paddingBottom: space(1),
        }}
      >
        <Muted style={{ flex: 1 }}>{STR.syRowLabel}</Muted>
        <Muted style={{ minWidth: 40, textAlign: "right" }}>{STR.syCount}</Muted>
        <Muted style={{ minWidth: 40, textAlign: "right" }}>{STR.syMarksEach}</Muted>
        <Muted style={{ minWidth: 44, textAlign: "right" }}>{STR.syRowTotal}</Muted>
      </View>

      {marks.map((r) => (
        <View
          key={r.seq}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            ...cell,
          }}
        >
          <View style={{ flex: 1, paddingRight: space(2) }}>
            <Body>
              {bnNum(r.seq)}. {r.label}
            </Body>
            {/* A component row says so — it is not a question item, and its number
                comes from the exam paper rather than from count x marks, so the badge
                stays. The itemType line that used to sit here did NOT stay: it
                repeated "ছোট প্রশ্ন" under most of fifteen rows, which is noise on the
                sheet a parent reads. The types are already listed once, as chips,
                under প্রশ্নের ধরন. */}
            {r.component ? <Badge tone="gold" text={examComponentLabel(r.component)} /> : null}
          </View>
          <Body style={num}>{r.count == null ? "—" : bnNum(r.count)}</Body>
          <Body style={num}>{r.marksEach == null ? "—" : bnNum(r.marksEach)}</Body>
          <Body style={{ ...num, minWidth: 44 }}>{bnNum(r.total)}</Body>
        </View>
      ))}

      <View
        style={{
          flexDirection: "row",
          borderTopWidth: 2,
          borderTopColor: colors.textPrimary,
          paddingTop: space(2),
        }}
      >
        <Body style={{ flex: 1, fontWeight: "700" }}>{STR.syTotal}</Body>
        <Body style={{ ...num, minWidth: 44, fontWeight: "700" }}>{bnNum(total)}</Body>
      </View>
    </View>
  );
}

/** Written / oral, derived — the sheet's "লিখিত-৯০ মৌখিক-১০" header line (§5.4). */
export function WrittenOralLine({ row }: { row: SyllabusT }): React.ReactElement | null {
  if (row.oralMarks <= 0) return null;
  return (
    <Muted>
      {STR.syWritten} {bnNum(row.writtenMarks)} · {STR.syOral} {bnNum(row.oralMarks)}
    </Muted>
  );
}

/**
 * The full body of one subject's syllabus: prose, mark distribution, question
 * types. `classNote` is the per-CLASS footer and is rendered by the CALLER once
 * at the top of the class — never here, which would repeat it on every subject.
 */
export default function SyllabusView({ row }: { row: SyllabusT }): React.ReactElement {
  return (
    <View style={{ gap: space(3) }}>
      <Card>
        <Body style={{ fontWeight: "700" }}>{routineSubjectLabel(row.subject)}</Body>
        <WrittenOralLine row={row} />
        {row.bodyMd ? <Markdown source={row.bodyMd} /> : <Muted>{DASH_BODY}</Muted>}
      </Card>

      {row.marks.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.syMarks}</Body>
          <MarkDistribution marks={row.marks} />
        </Card>
      ) : null}

      {row.questionTypes.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.syQuestionTypes}</Body>
          <ChipRow>
            {row.questionTypes.map((qt) => (
              <Chip key={qt} label={syllabusItemTypeLabel(qt)} onPress={() => {}} />
            ))}
          </ChipRow>
        </Card>
      ) : null}
    </View>
  );
}

const DASH_BODY = "—";
