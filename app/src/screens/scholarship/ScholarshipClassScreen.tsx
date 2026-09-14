/**
 * ScholarshipClassScreen (SC-4) — the class heat-map.
 *
 * One row per topic (or chapter), one cell per student, weakest class row first. The
 * class mean sits ON the row rather than being left for the reader to eyeball, because
 * the finding this screen exists for is a row that runs weak across everybody: that is
 * a teaching problem, not a student one (D-#663).
 *
 * An under-floor cell renders in the neutral surface tone, never a pale red — "not
 * enough data" and "failing" must not be the same colour family (D-#662). Every cell
 * also prints its number or an em dash, so nothing rests on colour alone.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { SCHOLARSHIP_CLASS_QUERY } from "../../graphql/scholarship";
import { Screen, Card, Body, Muted, Chip, ChipRow, Loader, EmptyState, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { radius, space, useColors } from "../../theme";
import type { ScholarshipStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ScholarshipStackParamList, "ScholarshipClass">;
type Nav = NativeStackNavigationProp<ScholarshipStackParamList>;

const SUBJECTS = ["ENG", "BAN", "MATH", "SCI", "BGS"] as const;
const CELL = 44;
const LABEL_W = 128;

interface Cell {
  studentId: string;
  percent: number | null;
  band: string;
}
interface Row {
  key: string;
  label: string;
  classPercent: number | null;
  band: string;
  cells: Cell[];
}

export default function ScholarshipClassScreen({ route }: Props): React.ReactElement {
  const { sectionId, classLevel, subject: initialSubject } = route.params;
  const nav = useNavigation<Nav>();
  const colors = useColors();
  const [subject, setSubject] = useState<string | null>(initialSubject ?? null);
  const [axis, setAxis] = useState<"topic" | "chapter">("topic");

  const [{ data, fetching, error }] = useQuery({
    query: SCHOLARSHIP_CLASS_QUERY,
    variables: { sectionId, classLevel, subject, axis },
  });

  const analysis = data?.scholarshipClass as
    | { students: { id: string; nameBn: string }[]; rows: Row[] }
    | undefined;

  function cellBg(band: string): string {
    if (band === "weak") return colors.errorContainer;
    if (band === "fair") return colors.warningContainer;
    if (band === "good") return colors.primaryContainer;
    return colors.surfaceAlt;
  }
  function cellFg(band: string): string {
    if (band === "weak") return colors.onErrorContainer;
    if (band === "fair") return colors.warning;
    if (band === "good") return colors.onPrimaryContainer;
    return colors.textDisabled;
  }

  const students = analysis?.students ?? [];
  const rows = analysis?.rows ?? [];
  const reteach = rows.filter((r) => r.band === "weak");

  return (
    <Screen scroll>
      <ChipRow>
        {SUBJECTS.map((s) => (
          <Chip
            key={s}
            label={hwSubjectLabel(s)}
            selected={subject === s}
            onPress={() => setSubject(subject === s ? null : s)}
          />
        ))}
      </ChipRow>
      <ChipRow>
        <Chip label={STR.scAxisTopic} selected={axis === "topic"} onPress={() => setAxis("topic")} />
        <Chip label={STR.scAxisChapter} selected={axis === "chapter"} onPress={() => setAxis("chapter")} />
      </ChipRow>

      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {fetching ? <Loader /> : null}
      {!fetching && rows.length === 0 ? <EmptyState message={STR.scNoAnalysis} /> : null}

      {rows.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            {/* Header: the student initials, one per column. */}
            <View style={{ flexDirection: "row" }}>
              <View style={{ width: LABEL_W }} />
              {students.map((s) => (
                <View
                  key={s.id}
                  style={{ width: CELL, alignItems: "center", justifyContent: "center", paddingVertical: space(1) }}
                >
                  <Muted>{s.nameBn.slice(0, 3)}</Muted>
                </View>
              ))}
            </View>

            {rows.map((r) => (
              <View key={r.key} style={{ flexDirection: "row", alignItems: "stretch" }}>
                <View style={{ width: LABEL_W, paddingRight: space(2), justifyContent: "center" }}>
                  <Muted>{axis === "chapter" ? `${STR.scChapterShort} ${bnNum(r.key)}` : r.label}</Muted>
                  <Muted>
                    {r.classPercent === null ? STR.scBandNone : `${STR.scClassAvg} ${bnNum(r.classPercent)}%`}
                  </Muted>
                </View>
                {r.cells.map((c) => (
                  <View
                    key={c.studentId}
                    style={{
                      width: CELL - 2,
                      height: CELL,
                      margin: 1,
                      borderRadius: radius.sm,
                      backgroundColor: cellBg(c.band),
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Body style={{ color: cellFg(c.band) }}>
                      {c.percent === null ? "—" : bnNum(Math.round(c.percent))}
                    </Body>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}

      {rows.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.scLegend}</Body>
          <Muted>
            {STR.scBandWeak} · {STR.scBandFair} · {STR.scBandGood} · {STR.scBandNone}
          </Muted>
        </Card>
      ) : null}

      {reteach.length > 0 ? (
        <Notice message={`${reteach.map((r) => r.label).join(" · ")} — ${STR.scReteach}`} tone="info" />
      ) : null}

      {students.map((s) => (
        <Card
          key={s.id}
          onPress={() =>
            nav.navigate("ScholarshipStudent", { sectionId, classLevel, studentId: s.id, name: s.nameBn })
          }
        >
          <Body>{s.nameBn}</Body>
        </Card>
      ))}
    </Screen>
  );
}
