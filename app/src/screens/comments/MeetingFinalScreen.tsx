/**
 * MeetingFinalScreen (MC-4, docs/prd-meeting-comments.md §1, D-#752; roster:manage) — the
 * Principal's / Office's final word for one child, with the whole chain under it:
 *
 *   1 · Final comment — "Use it as it is" (copies the class teacher's summary), "Edit it"
 *       (a copy, edited) or "Write a separate comment"; Change later at any time.
 *   2 · Class teacher's summary — kept exactly as written.
 *   3 · Subject teachers — each teacher's Strengths + Concerns, opened on tap.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { MEETING_BRIEF, SAVE_MEETING_FINAL_COMMENT } from "../../graphql/meetingChain";
import { Badge, Body, Button, Card, Field, Loader, Muted, Notice, Screen } from "../../components/ui";
import { Expander, TwoBoxes, dayLabel, finalSourceLabel, placeLabel } from "../../components/MeetingChainParts";
import { STR, routineSubjectLabel, isoDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<CommentsStackParamList, "MeetingFinal">;
type Mode = "view" | "EDITED" | "OWN";

export default function MeetingFinalScreen({ route, navigation }: Props): React.ReactElement {
  const { meetingId, studentId } = route.params;
  const c = useColors();
  const [q, refetch] = useQuery({ query: MEETING_BRIEF, variables: { meetingId, studentId }, requestPolicy: "network-only" });
  const [m, save] = useMutation(SAVE_MEETING_FINAL_COMMENT);
  const [mode, setMode] = React.useState<Mode>("view");
  const [strengths, setStrengths] = React.useState("");
  const [concerns, setConcerns] = React.useState("");
  const [subjOpen, setSubjOpen] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const b = q.data?.meetingBrief ?? null;

  if (!b) return <Screen>{q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : <Loader label={STR.loading} />}</Screen>;

  function start(next: Mode): void {
    setErr(null);
    if (next === "EDITED") {
      setStrengths(b!.summary?.strengths ?? "");
      setConcerns(b!.summary?.concerns ?? "");
    } else if (next === "OWN") {
      setStrengths("");
      setConcerns("");
    }
    setMode(next);
  }

  async function submit(source: "AS_IS" | "EDITED" | "OWN"): Promise<void> {
    setErr(null);
    const res = await save({ meetingId, studentId, source, strengths: source === "AS_IS" ? null : strengths.trim() || null, concerns: source === "AS_IS" ? null : concerns.trim() || null });
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    setMode("view");
    refetch({ requestPolicy: "network-only" });
  }

  const written = b.subjectNotes.filter((s) => s.written);
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
          <View style={{ flexShrink: 1 }}>
            <Body style={{ fontWeight: "700", fontSize: 20 }}>{b.studentName}</Body>
            <Muted>
              {placeLabel(b)}
              {b.classTeacherName ? ` · ${STR.mcClassTeacher} ${b.classTeacherName}` : ""} · {dayLabel(b.meetingDateKey)}
            </Muted>
          </View>
          <Button title={STR.mcOpenBrief} variant="secondary" onPress={() => navigation.navigate("MeetingBrief", { meetingId, studentIds: [studentId], studentId })} />
        </View>

        {err ? <Notice message={err} tone="danger" /> : null}

        <Card style={{ borderWidth: 2, borderColor: c.gold }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
            <Body style={{ fontWeight: "700" }}>{STR.mcLayer1}</Body>
            <Badge text={b.final ? finalSourceLabel(b.final.source) : STR.mcNotWrittenYet} tone="gold" />
          </View>
          {!b.summary ? (
            <Notice message={STR.mcNoSummaryYet} tone="warn" />
          ) : mode === "view" && b.final ? (
            <View style={{ gap: space(2), marginTop: space(2) }}>
              <TwoBoxes strengths={b.final.strengths} concerns={b.final.concerns} big />
              <Muted>
                {b.final.authorName ?? "—"} · {isoDateLabel(b.final.updatedAt)}
              </Muted>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                <Button title={STR.mcEditIt} variant="secondary" onPress={() => { setStrengths(b.final!.strengths); setConcerns(b.final!.concerns); setMode(b.final!.source === "OWN" ? "OWN" : "EDITED"); }} />
                <Button title={STR.mcUseAsIs} variant="ghost" onPress={() => void submit("AS_IS")} loading={m.fetching} />
                <Button title={STR.mcWriteOwn} variant="ghost" onPress={() => start("OWN")} />
              </View>
            </View>
          ) : mode === "view" ? (
            <View style={{ gap: space(2), marginTop: space(2) }}>
              <Muted>{STR.mcFinalHint}</Muted>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                <Button title={STR.mcUseAsIs} onPress={() => void submit("AS_IS")} loading={m.fetching} />
                <Button title={STR.mcEditIt} variant="secondary" onPress={() => start("EDITED")} />
                <Button title={STR.mcWriteOwn} variant="ghost" onPress={() => start("OWN")} />
              </View>
            </View>
          ) : (
            <View style={{ gap: space(2), marginTop: space(2) }}>
              <Muted>{mode === "EDITED" ? STR.mcEditHint : STR.mcOwnHint}</Muted>
              <Field label={STR.mcStrengths} value={strengths} onChangeText={setStrengths} placeholder={STR.mcStrengthsPh} multiline autoCapitalize="sentences" />
              <Field label={STR.mcConcerns} value={concerns} onChangeText={setConcerns} placeholder={STR.mcConcernsPh} multiline autoCapitalize="sentences" />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                <Button title={STR.mcSaveFinal} onPress={() => void submit(mode)} loading={m.fetching} />
                <Button title={STR.mcCancel} variant="ghost" onPress={() => setMode("view")} />
              </View>
            </View>
          )}
        </Card>

        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
            <Body style={{ fontWeight: "700" }}>{STR.mcLayer2}</Body>
            {b.summary ? (
              <Muted>
                {b.summary.authorName ?? "—"} · {isoDateLabel(b.summary.updatedAt)}
              </Muted>
            ) : null}
          </View>
          {b.summary ? <View style={{ marginTop: space(2) }}><TwoBoxes strengths={b.summary.strengths} concerns={b.summary.concerns} /></View> : <Muted>{STR.mcNotWrittenYet}</Muted>}
        </Card>

        <Card>
          <Expander title={`${STR.mcLayer3} (${written.length})`} open={subjOpen} onToggle={() => setSubjOpen(!subjOpen)}>
            <View style={{ gap: space(3) }}>
              {b.subjectNotes.map((s) => (
                <View key={s.subject} style={{ borderTopWidth: 1, borderTopColor: c.surfaceAlt, paddingTop: space(2), gap: space(1) }}>
                  <Body style={{ fontWeight: "700" }}>
                    {routineSubjectLabel(s.subject)}
                    {s.teacherName ? <Muted> · {s.teacherName}</Muted> : null}
                  </Body>
                  {s.written ? <TwoBoxes strengths={s.strengths} concerns={s.concerns} /> : <Muted>{s.skipped ? `${STR.mcSkipped}${s.skipReason ? ` · ${s.skipReason}` : ""}` : STR.mcNotWrittenYet}</Muted>}
                </View>
              ))}
            </View>
          </Expander>
        </Card>
      </ScrollView>
    </Screen>
  );
}
