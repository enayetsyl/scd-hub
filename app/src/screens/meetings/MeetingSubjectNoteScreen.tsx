/**
 * MeetingSubjectNoteScreen (MC-3, docs/prd-meeting-comments.md §1/§5, D-#752) — a subject
 * teacher writes ONE child's parents'-meeting comment: Strengths + Concerns about the child
 * as a whole (it need not be about the subject — owner, 2026-10-16). Above the form: the
 * child's numbers in this subject since the last meeting, and the teacher's own comment
 * from that meeting.
 *
 * "Save & next" walks the `queue` the Today card passed (the group's due children in
 * order). Locked once the class teacher has summarised; skipped when the Office skipped
 * the subject — both said plainly instead of a dead form.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { MEETING_SUBJECT_NOTE_CONTEXT, SAVE_MEETING_SUBJECT_NOTE } from "../../graphql/meetingChain";
import { Body, Button, Card, Field, Loader, Muted, Notice, Screen } from "../../components/ui";
import { NumbersTiles, TwoBoxes, placeLabel } from "../../components/MeetingChainParts";
import { STR, bnNum, routineSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { HomeStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<HomeStackParamList, "MeetingSubjectNote">;

export default function MeetingSubjectNoteScreen({ route, navigation }: Props): React.ReactElement {
  const { meetingId, subject } = route.params;
  const queue = route.params.queue ?? [];
  const [studentId, setStudentId] = React.useState(route.params.studentId);
  const [q, refetch] = useQuery({ query: MEETING_SUBJECT_NOTE_CONTEXT, variables: { meetingId, studentId, subject }, requestPolicy: "network-only" });
  const [m, save] = useMutation(SAVE_MEETING_SUBJECT_NOTE);
  const [strengths, setStrengths] = React.useState("");
  const [concerns, setConcerns] = React.useState("");
  const [seededFor, setSeededFor] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [showPrev, setShowPrev] = React.useState(false);
  const ctx = q.data?.meetingSubjectNoteContext ?? null;

  React.useEffect(() => {
    if (ctx && ctx.studentId === studentId && seededFor !== studentId) {
      setStrengths(ctx.strengths);
      setConcerns(ctx.concerns);
      setSeededFor(studentId);
    }
  }, [ctx, studentId, seededFor]);

  React.useEffect(() => {
    if (ctx) navigation.setOptions({ title: ctx.studentName });
  }, [ctx, navigation]);

  const pos = queue.indexOf(studentId);
  const nextId = pos >= 0 && pos + 1 < queue.length ? queue[pos + 1] : null;

  async function onSave(goNext: boolean): Promise<void> {
    setErr(null);
    setSaved(false);
    const res = await save({ meetingId, studentId, subject, strengths: strengths.trim() || null, concerns: concerns.trim() || null });
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    if (goNext && nextId) {
      setStudentId(nextId);
      setShowPrev(false);
      return;
    }
    setSaved(true);
    refetch({ requestPolicy: "network-only" });
  }

  if (!ctx || ctx.studentId !== studentId) {
    return <Screen>{q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : <Loader label={STR.loading} />}</Screen>;
  }

  const editable = ctx.mine && !ctx.locked && !ctx.skipped;
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }} keyboardShouldPersistTaps="handled">
        <Muted>
          {placeLabel(ctx)} · {routineSubjectLabel(subject)}
          {pos >= 0 ? ` · ${bnNum(pos + 1)}/${bnNum(queue.length)}` : ""}
        </Muted>

        <Card>
          <Muted>
            {STR.mcSinceLast} · {STR.mcInThisSubject}
          </Muted>
          <View style={{ marginTop: space(2) }}>
            <NumbersTiles numbers={ctx.numbers} only={["ct", "hw", "as"]} />
          </View>
          {ctx.previousLabel ? (
            <View style={{ marginTop: space(2), gap: space(2) }}>
              <Button title={showPrev ? STR.mcHide : `${STR.mcPrevNote} (${ctx.previousLabel})`} variant="ghost" onPress={() => setShowPrev(!showPrev)} />
              {showPrev ? <TwoBoxes strengths={ctx.previousStrengths ?? ""} concerns={ctx.previousConcerns ?? ""} /> : null}
            </View>
          ) : null}
        </Card>

        {ctx.locked ? <Notice message={STR.mcLockedNote} tone="info" /> : null}
        {ctx.skipped ? <Notice message={STR.mcSkippedNote} tone="info" /> : null}
        {err ? <Notice message={err} tone="danger" /> : null}
        {saved ? <Notice message={STR.mcSaved} tone="ok" /> : null}

        {editable ? (
          <Card>
            <Notice message={STR.mcWholeChildHint} tone="info" />
            <Field label={STR.mcStrengths} value={strengths} onChangeText={setStrengths} placeholder={STR.mcStrengthsPh} multiline autoCapitalize="sentences" />
            <Field label={STR.mcConcerns} value={concerns} onChangeText={setConcerns} placeholder={STR.mcConcernsPh} multiline autoCapitalize="sentences" />
            <Muted>{STR.mcStaffOnlyHint}</Muted>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
              {nextId ? <Button title={STR.mcSaveNext} onPress={() => void onSave(true)} loading={m.fetching} style={{ flexGrow: 1 }} /> : null}
              <Button title={STR.mcSave} variant={nextId ? "secondary" : "primary"} onPress={() => void onSave(false)} loading={m.fetching} style={{ flexGrow: 1 }} />
            </View>
          </Card>
        ) : ctx.written ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{ctx.studentName}</Body>
            <TwoBoxes strengths={ctx.strengths} concerns={ctx.concerns} />
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
