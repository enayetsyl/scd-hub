/**
 * MeetingSummaryWriteScreen (MC-3, docs/prd-meeting-comments.md §1, D-#752) — the class
 * teacher summarises one child from every subject teacher's comment: the child's numbers
 * since the last meeting, each subject teacher's Strengths + Concerns (open one at a time),
 * then the summary's two boxes → CM-5's saveMeetingComment ("Send to Principal").
 *
 * The server refuses a summary before every subject note is in (or skipped) and after the
 * Principal/Office have written the final; this screen says the second plainly.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { MEETING_BRIEF } from "../../graphql/meetingChain";
import { SAVE_MEETING_COMMENT } from "../../graphql/comments";
import { Body, Button, Card, Field, Loader, Muted, Notice, Screen } from "../../components/ui";
import { Expander, NumbersTiles, TwoBoxes, dayLabel, placeLabel } from "../../components/MeetingChainParts";
import { STR, bnNum, routineSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { HomeStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<HomeStackParamList, "MeetingSummaryWrite">;

export default function MeetingSummaryWriteScreen({ route }: Props): React.ReactElement {
  const { meetingId, studentId } = route.params;
  const [q, refetch] = useQuery({ query: MEETING_BRIEF, variables: { meetingId, studentId }, requestPolicy: "network-only" });
  const [m, save] = useMutation(SAVE_MEETING_COMMENT);
  const [strengths, setStrengths] = React.useState("");
  const [concerns, setConcerns] = React.useState("");
  const [seeded, setSeeded] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const b = q.data?.meetingBrief ?? null;

  React.useEffect(() => {
    if (b && !seeded) {
      setStrengths(b.summary?.strengths ?? "");
      setConcerns(b.summary?.concerns ?? "");
      setSeeded(true);
    }
  }, [b, seeded]);

  async function onSend(): Promise<void> {
    setErr(null);
    const res = await save({ meetingId, studentId, positiveText: strengths.trim() || null, concernText: concerns.trim() || null });
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    setSent(true);
    refetch({ requestPolicy: "network-only" });
  }

  if (!b) return <Screen>{q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : <Loader label={STR.loading} />}</Screen>;

  const notes = b.subjectNotes.filter((s) => s.written || s.skipped);
  const finalised = !!b.final;
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }} keyboardShouldPersistTaps="handled">
        <Muted>
          {placeLabel(b)} · {b.instanceLabel} · {dayLabel(b.meetingDateKey)}
        </Muted>

        <Card>
          <Muted>
            {STR.mcSinceLast}: {dayLabel(b.numbers.fromKey)} – {dayLabel(b.numbers.toKey)}
          </Muted>
          <View style={{ marginTop: space(2) }}>
            <NumbersTiles numbers={b.numbers} />
          </View>
        </Card>

        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space(2) }}>
            <Body style={{ fontWeight: "700", flex: 1 }}>{STR.mcSubjectTeachersComments}</Body>
            <Muted>
              {bnNum(notes.length)}/{bnNum(b.subjectNotes.length)}
            </Muted>
          </View>
          {b.subjectNotes.map((s) => (
            <View key={s.subject} style={{ marginTop: space(1) }}>
              <Expander
                title={`${routineSubjectLabel(s.subject)}${s.teacherName ? ` · ${s.teacherName}` : ""}`}
                subtitle={s.skipped ? `${STR.mcSkipped}${s.skipReason ? ` · ${s.skipReason}` : ""}` : !s.written ? STR.mcNotWrittenYet : null}
                open={open === s.subject}
                onToggle={() => setOpen(open === s.subject ? null : s.subject)}
              >
                {s.written ? <TwoBoxes strengths={s.strengths} concerns={s.concerns} /> : <Muted>{STR.mcNotWrittenYet}</Muted>}
              </Expander>
            </View>
          ))}
        </Card>

        {finalised ? <Notice message={STR.mcFinalLockedNote} tone="info" /> : null}
        {err ? <Notice message={err} tone="danger" /> : null}
        {sent ? <Notice message={STR.mcSummarySent} tone="ok" /> : null}

        {finalised ? (
          b.summary ? (
            <Card>
              <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.mcYourSummary}</Body>
              <TwoBoxes strengths={b.summary.strengths} concerns={b.summary.concerns} />
            </Card>
          ) : null
        ) : (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.mcYourSummary}</Body>
            <Field label={STR.mcStrengths} value={strengths} onChangeText={setStrengths} placeholder={STR.mcStrengthsPh} multiline autoCapitalize="sentences" />
            <Field label={STR.mcConcerns} value={concerns} onChangeText={setConcerns} placeholder={STR.mcConcernsPh} multiline autoCapitalize="sentences" />
            <Muted>{STR.mcStaffOnlyHint}</Muted>
            <Button title={STR.mcSendToPrincipal} onPress={() => void onSend()} loading={m.fetching} style={{ marginTop: space(2) }} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
