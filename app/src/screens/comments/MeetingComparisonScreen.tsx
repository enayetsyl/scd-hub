/**
 * MeetingComparisonScreen (CM-6 / CM-5, tracker:read || roster:manage to read;
 * tracker:write + class-teacher to save) — one student's meeting comment in context.
 *
 * Editable `current` positive/concern fields → saveMeetingComment (CLASS-TEACHER-ONLY;
 * a non-class-teacher server deny surfaces inline in Bangla). Below: the `prior`
 * meeting comments chronologically + the `rollupSincePrevious` daily-comment counts
 * by COMMENT_TYPE (commentTypeLabel). Refetches on focus.
 */
import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { MEETING_COMPARISON_QUERY, SAVE_MEETING_COMMENT } from "../../graphql/comments";
import { Screen, Card, Body, Muted, Button, Field, Notice, Loader, Divider } from "../../components/ui";
import { STR, commentTypeLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<CommentsStackParamList, "MeetingComparison">;
type Nav = NativeStackNavigationProp<CommentsStackParamList>;

export default function MeetingComparisonScreen({ route }: Props): React.ReactElement {
  const { meetingId, studentId, studentName } = route.params;
  const nav = useNavigation<Nav>();

  const [compQ, refetch] = useQuery({ query: MEETING_COMPARISON_QUERY, variables: { meetingId, studentId } });
  const comp = compQ.data?.meetingComparison ?? null;

  const [, save] = useMutation(SAVE_MEETING_COMMENT);

  const [positiveText, setPositiveText] = useState("");
  const [concernText, setConcernText] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed the editable fields from the current note once it resolves.
  useEffect(() => {
    if (comp && !seeded) {
      setPositiveText(comp.current?.positiveText ?? "");
      setConcernText(comp.current?.concernText ?? "");
      setSeeded(true);
    }
  }, [comp, seeded]);

  useEffect(() => {
    const unsub = nav.addListener("focus", () => refetch({ requestPolicy: "network-only" }));
    return unsub;
  }, [nav, refetch]);

  async function onSave(): Promise<void> {
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await save({
      meetingId,
      studentId,
      positiveText: positiveText.trim() || null,
      concernText: concernText.trim() || null,
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.cmMeetingCommentSaved);
    refetch({ requestPolicy: "network-only" });
  }

  if (compQ.fetching && !comp) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700" }}>{studentName}</Body>
          {comp ? (
            <Muted>
              {comp.instanceLabel} · {new Date(comp.meetingDate).toLocaleDateString()}
            </Muted>
          ) : null}
        </Card>

        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {/* Editable current note (class-teacher-only — server enforces) */}
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.cmCurrentMeeting}</Body>
          <Field
            label={STR.cmPositiveText}
            value={positiveText}
            onChangeText={setPositiveText}
            placeholder={STR.cmPositivePlaceholder}
            multiline
          />
          <Field
            label={STR.cmConcernText}
            value={concernText}
            onChangeText={setConcernText}
            placeholder={STR.cmConcernPlaceholder}
            multiline
          />
          <Button title={STR.cmSaveMeetingComment} onPress={onSave} loading={busy} disabled={busy} />
        </Card>

        {/* Rollup of daily comments since the previous meeting */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.cmRollupSincePrev}</Body>
          {comp && comp.rollupSincePrevious.length > 0 ? (
            comp.rollupSincePrevious.map((r) => (
              <View
                key={r.type}
                style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(2) }}
              >
                <Muted>{commentTypeLabel(r.type)}</Muted>
                <Body>{bnNum(r.count)}</Body>
              </View>
            ))
          ) : (
            <Muted style={{ marginTop: space(2) }}>{STR.cmNoRollup}</Muted>
          )}
        </Card>

        {/* Prior meeting comments, chronological */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.cmPriorMeetings}</Body>
          {comp && comp.prior.length > 0 ? (
            comp.prior.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <Divider /> : <View style={{ height: space(2) }} />}
                <Muted>
                  {p.instanceLabel} · {new Date(p.meetingDate).toLocaleDateString()}
                </Muted>
                {p.positiveText ? (
                  <Body style={{ marginTop: space(1) }}>
                    {STR.cmPositiveText}: {p.positiveText}
                  </Body>
                ) : null}
                {p.concernText ? (
                  <Body style={{ marginTop: space(1) }}>
                    {STR.cmConcernText}: {p.concernText}
                  </Body>
                ) : null}
              </View>
            ))
          ) : (
            <Muted style={{ marginTop: space(2) }}>{STR.cmNoPrior}</Muted>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
