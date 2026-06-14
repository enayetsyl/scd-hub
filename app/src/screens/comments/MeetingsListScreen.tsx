/**
 * MeetingsListScreen (CM-6 / CM-3, roster:manage) — list parents' meetings + a
 * create form (instanceLabel, meetingDate, slotMinutes, dayStartMinutes). Tapping a
 * meeting opens MeetingAdmin (generate slots / dispatch / attendance). createParentMeeting
 * rides roster:manage — the Bangla deny surfaces inline. Refetches on focus.
 */
import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { PARENT_MEETINGS_QUERY, CREATE_PARENT_MEETING } from "../../graphql/comments";
import { Screen, Card, Body, Muted, Button, Badge, Field, Loader, Notice } from "../../components/ui";
import { STR, meetingStatusLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<CommentsStackParamList>;

export default function MeetingsListScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const [meetingsQ, refetch] = useQuery({ query: PARENT_MEETINGS_QUERY, variables: {} });
  const meetings = meetingsQ.data?.parentMeetings ?? [];

  const [, create] = useMutation(CREATE_PARENT_MEETING);

  const [instanceLabel, setInstanceLabel] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [slotMinutes, setSlotMinutes] = useState("");
  const [dayStartMinutes, setDayStartMinutes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = nav.addListener("focus", () => refetch({ requestPolicy: "network-only" }));
    return unsub;
  }, [nav, refetch]);

  async function onCreate(): Promise<void> {
    setError(null);
    setOk(null);
    const slot = Number(slotMinutes);
    const start = Number(dayStartMinutes);
    if (!instanceLabel.trim() || !meetingDate.trim() || !Number.isFinite(slot) || slot < 1 || !Number.isFinite(start)) {
      return setError(STR.errGeneric);
    }
    setBusy(true);
    const res = await create({
      instanceLabel: instanceLabel.trim(),
      meetingDate: meetingDate.trim(),
      slotMinutes: slot,
      dayStartMinutes: start,
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    if (res.data) {
      setOk(STR.cmMeetingCreated);
      setInstanceLabel("");
      setMeetingDate("");
      setSlotMinutes("");
      setDayStartMinutes("");
      refetch({ requestPolicy: "network-only" });
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.cmNewMeeting}</Body>
          <Field label={STR.cmInstanceLabel} value={instanceLabel} onChangeText={setInstanceLabel} />
          <Field label={STR.cmMeetingDate} value={meetingDate} onChangeText={setMeetingDate} placeholder="YYYY-MM-DD" />
          <Field label={STR.cmSlotMinutes} value={slotMinutes} onChangeText={setSlotMinutes} keyboardType="number-pad" />
          <Field
            label={STR.cmDayStartMinutes}
            value={dayStartMinutes}
            onChangeText={setDayStartMinutes}
            keyboardType="number-pad"
            helper={STR.cmDayStartHint}
          />
          <Button title={STR.cmCreateMeeting} onPress={onCreate} loading={busy} disabled={busy} />
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.cmMeetingsTitle}</Body>
          {meetingsQ.fetching ? (
            <Loader label={STR.loading} />
          ) : meetings.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.cmNoMeetings}</Muted>
          ) : (
            meetings.map((m) => (
              <Card
                key={m.id}
                onPress={() => nav.navigate("MeetingAdmin", { meetingId: m.id, instanceLabel: m.instanceLabel })}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{m.instanceLabel}</Body>
                    <Muted>
                      {new Date(m.meetingDate).toLocaleDateString()} · {bnNum(m.slotMinutes)} {STR.cmSlotMinutes}
                    </Muted>
                  </View>
                  <Badge
                    text={meetingStatusLabel(m.status)}
                    tone={m.status === "scheduled" ? "ok" : m.status === "closed" ? "muted" : "brand"}
                  />
                </View>
              </Card>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
