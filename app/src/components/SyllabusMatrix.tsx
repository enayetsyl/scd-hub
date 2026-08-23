/**
 * SyllabusMatrix (SY-5) — the Principal's class × subject board.
 *
 * The Principal's question is never "is this one subject good?" — it is "can we
 * hand the sheet out on Sunday?" So the primary object is coverage, and a cell
 * opens the detail.
 *
 * With three actors a cell has to say WHICH DESK it is sitting on, so there are
 * five states. Each carries a Bangla glyph as well as a colour — §0 of
 * `docs/ui-guidelines.md`: meaning is never carried by colour alone.
 *
 * The grid scrolls horizontally in its OWN container. A class row is eight
 * subjects wide and the screen is designed at 360dp, so the alternative is either
 * unreadable cells or a page that scrolls sideways as a whole.
 */
import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Body, Muted } from "./ui";
import type { SyllabusT } from "../graphql/examSyllabus";
import { STR, routineSubjectLabel } from "../lib/labels";
import { useColors } from "../theme";
import { space, typeScale } from "../theme/tokens";

/** One cell's state. `blocked` is DERIVED, not stored: a row whose rows do not
 *  reach 100 cannot be published however far along the chain it is. */
export type CellState = "published" | "principal" | "teacher" | "draft" | "blocked" | "none";

export function cellStateFor(row: SyllabusT | undefined): CellState {
  if (!row || row.pending) return "none";
  if (row.marks.length > 0 && row.totalMarks !== 100) return "blocked";
  switch (row.status) {
    case "PUBLISHED":
      return "published";
    case "PRINCIPAL_REVIEW":
      return "principal";
    case "TEACHER_REVIEW":
      return "teacher";
    default:
      return "draft";
  }
}

const GLYPH: Record<CellState, string> = {
  published: "✓",
  principal: "প্র",
  teacher: "শি",
  draft: "·",
  blocked: "✕",
  none: "—",
};

function useCellColors(): Record<CellState, { bg: string; fg: string }> {
  const c = useColors();
  return {
    published: { bg: c.primaryContainer, fg: c.onPrimaryContainer },
    principal: { bg: c.goldContainer, fg: c.onGoldContainer },
    teacher: { bg: c.infoContainer, fg: c.info },
    draft: { bg: c.surfaceAlt, fg: c.textDisabled },
    blocked: { bg: c.warningContainer, fg: c.warning },
    none: { bg: "transparent", fg: c.textDisabled },
  };
}

export interface MatrixRow {
  classId: string;
  classLabel: string;
  subjects: SyllabusT[];
}

export default function SyllabusMatrix({
  rows,
  subjectOrder,
  onPressCell,
}: {
  rows: MatrixRow[];
  /** Subject codes, in the sheet's own order — never alphabetical. */
  subjectOrder: string[];
  onPressCell: (classId: string, subject: string, row: SyllabusT | undefined) => void;
}): React.ReactElement {
  const colors = useColors();
  const cell = useCellColors();

  const CLASS_W = 84;
  const CELL_W = 46;

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          {/* header */}
          <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ width: CLASS_W, paddingVertical: space(2) }}>
              <Muted>{STR.syPickClass}</Muted>
            </View>
            {subjectOrder.map((s) => (
              <View key={s} style={{ width: CELL_W, alignItems: "center", paddingVertical: space(2) }}>
                <Muted>{routineSubjectLabel(s).slice(0, 4)}</Muted>
              </View>
            ))}
          </View>

          {rows.map((r) => (
            <View
              key={r.classId}
              style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}
            >
              <View style={{ width: CLASS_W, justifyContent: "center", paddingVertical: space(2) }}>
                <Body>{r.classLabel}</Body>
              </View>
              {subjectOrder.map((code) => {
                const row = r.subjects.find((x) => x.subject === code);
                const state = cellStateFor(row);
                const tone = cell[state];
                return (
                  <Pressable
                    key={code}
                    disabled={state === "none"}
                    onPress={() => onPressCell(r.classId, code, row)}
                    accessibilityLabel={`${r.classLabel} ${routineSubjectLabel(code)}`}
                    style={{
                      width: CELL_W,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingVertical: space(2),
                    }}
                  >
                    <View
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 6,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: tone.bg,
                      }}
                    >
                      <Body style={{ ...typeScale.caption, color: tone.fg, fontWeight: "700" }}>
                        {GLYPH[state]}
                      </Body>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Legend — every state named, because a glyph alone is not a label. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3), marginTop: space(2) }}>
        {(
          [
            ["published", STR.syStatPublished],
            ["principal", STR.syStatPrincipal],
            ["teacher", STR.syStatTeacher],
            ["draft", STR.syStatDraft],
            ["blocked", STR.syBlockedSum],
          ] as Array<[CellState, string]>
        ).map(([st, label]) => (
          <View key={st} style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: cell[st].bg,
              }}
            >
              <Body style={{ ...typeScale.caption, color: cell[st].fg, fontWeight: "700" }}>
                {GLYPH[st]}
              </Body>
            </View>
            <Muted>{label}</Muted>
          </View>
        ))}
      </View>
    </View>
  );
}
