/**
 * PersonMistakesScreen — one staff member's ভুলের রেকর্ড (D-#940–#942): counted mistakes by
 * month, every entry, and every warning with its face-to-face meeting. A holder of
 * `staff_mistakes:meetings` books the meeting and records what was agreed here.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  RECORD_STAFF_WARNING_MEETING,
  SCHEDULE_STAFF_WARNING_MEETING,
  STAFF_MISTAKES_OF,
  STAFF_WARNINGS,
  type StaffWarningT,
} from "../../graphql/staffMistakes";
import type { HrStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Button, Chip, Field, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { StaffMistakeCard } from "../../components/StaffMistakeCard";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../state/ToastContext";
import { STR, bnNum, fullDateLabel } from "../../lib/labels";
import { dhakaWhen, parseDhakaDateTime, staffWarningStepLabel } from "../../lib/staffMistakeLabels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "PersonMistakes">;

const BN_MONTHS = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];

/** The last five month keys (YYYY-MM), oldest first, in Dhaka. */
function lastMonths(): string[] {
  const now = new Date(Date.now() + 6 * 3600 * 1000);
  const out: string[] = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

function WarningCard({ w, canMeet, onSaved }: { w: StaffWarningT; canMeet: boolean; onSaved: () => void }): React.ReactElement {
  const toast = useToast();
  const [when, setWhen] = React.useState("");
  const [place, setPlace] = React.useState(w.meetingPlace ?? "");
  const [who, setWho] = React.useState("");
  const [discussion, setDiscussion] = React.useState("");
  const [actions, setActions] = React.useState("");
  const [follow, setFollow] = React.useState("");
  const [send, setSend] = React.useState(true);
  const [mode, setMode] = React.useState<"none" | "book" | "record">("none");
  const [book, doBook] = useMutation(SCHEDULE_STAFF_WARNING_MEETING);
  const [rec, doRecord] = useMutation(RECORD_STAFF_WARNING_MEETING);

  async function saveBook(): Promise<void> {
    const at = parseDhakaDateTime(when);
    if (!at) return toast.show(STR.smpBadWhen, "danger");
    const r = await doBook({ id: w.id, at, place });
    if (r.error) return toast.show(friendlyError(r.error), "danger");
    toast.show(STR.smpSaved, "ok");
    setMode("none");
    onSaved();
  }

  async function saveRecord(): Promise<void> {
    const r = await doRecord({ id: w.id, who, discussion, actions, followUpDateKey: follow || null, sendSummary: send });
    if (r.error) return toast.show(friendlyError(r.error), "danger");
    toast.show(STR.smpSaved, "ok");
    setMode("none");
    onSaved();
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
        <Body style={{ fontWeight: "700" }}>
          {staffWarningStepLabel(w.step)} — {fullDateLabel(w.createdAt.slice(0, 10))}
        </Body>
        <Badge text={w.acknowledgedAt ? STR.smpSeen : STR.smpNotSeen} tone={w.acknowledgedAt ? "ok" : "warn"} />
      </View>
      <Muted>{STR.smpCountLine.replace("{days}", bnNum(w.windowDays)).replace("{n}", bnNum(Math.round(w.weightedCount * 10) / 10))}</Muted>
      {w.otherTimeAskedAt ? <Badge text={STR.smpOtherTime} tone="warn" /> : null}
      {w.meetingAt ? (
        <Body>{STR.smwMeetingLine.replace("{when}", dhakaWhen(w.meetingAt)).replace("{place}", w.meetingPlace ?? "")}</Body>
      ) : null}
      {w.meetingHeldAt ? (
        <View style={{ marginTop: space(2), gap: space(1) }}>
          <Body style={{ fontWeight: "700" }}>{STR.smpHeld}{w.meetingRecordedByName ? ` · ${w.meetingRecordedByName}` : ""}</Body>
          {w.meetingWho ? <Muted>{STR.smpWho}: {w.meetingWho}</Muted> : null}
          {w.meetingDiscussion ? <Body>{STR.smpDiscussion}: {w.meetingDiscussion}</Body> : null}
          {w.meetingActions ? <Body>{STR.smpActions}: {w.meetingActions}</Body> : null}
          {w.followUpDateKey ? <Muted>{STR.smpFollowUp.split(" (")[0]}: {fullDateLabel(w.followUpDateKey)}</Muted> : null}
        </View>
      ) : null}
      {canMeet && w.step !== "WARNING" && !w.meetingHeldAt && mode === "none" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(3) }}>
          <Button title={STR.smpBook} variant="secondary" onPress={() => setMode("book")} />
          <Button title={STR.smpRecord} onPress={() => setMode("record")} />
        </View>
      ) : null}
      {canMeet && w.step === "WARNING" && !w.meetingHeldAt && mode === "none" ? (
        <Button title={STR.smpRecord} variant="secondary" onPress={() => setMode("record")} style={{ marginTop: space(3) }} />
      ) : null}
      {mode === "book" ? (
        <View style={{ marginTop: space(3), gap: space(2) }}>
          <Field label={STR.smpWhen} value={when} onChangeText={setWhen} placeholder="2026-11-10 12:30" />
          <Field label={STR.smpPlace} value={place} onChangeText={setPlace} autoCapitalize="sentences" />
          <Button title={STR.smpSave} onPress={() => void saveBook()} loading={book.fetching} />
        </View>
      ) : null}
      {mode === "record" ? (
        <View style={{ marginTop: space(3), gap: space(2) }}>
          <Field label={STR.smpWho} value={who} onChangeText={setWho} autoCapitalize="sentences" />
          <Field label={STR.smpDiscussion} value={discussion} onChangeText={setDiscussion} multiline autoCapitalize="sentences" />
          <Field label={STR.smpActions} value={actions} onChangeText={setActions} multiline autoCapitalize="sentences" />
          <Field label={STR.smpFollowUp} value={follow} onChangeText={setFollow} placeholder="2026-12-06" />
          <Chip label={STR.smpSendSummary} selected={send} onPress={() => setSend(!send)} />
          <Button title={STR.smpSave} onPress={() => void saveRecord()} loading={rec.fetching} disabled={!discussion.trim()} />
        </View>
      ) : null}
    </Card>
  );
}

export default function PersonMistakesScreen({ route }: Props): React.ReactElement {
  const { staffUserId, name } = route.params;
  const { can } = useAuth();
  const canMeet = can("staff_mistakes:meetings");
  const [mq, refetchM] = useQuery({ query: STAFF_MISTAKES_OF, variables: { staffUserId }, requestPolicy: "cache-and-network" });
  const [wq, refetchW] = useQuery({ query: STAFF_WARNINGS, variables: { staffUserId }, requestPolicy: "cache-and-network" });
  const entries = mq.data?.staffMistakes ?? [];
  const warnings = wq.data?.staffWarnings ?? [];
  const months = lastMonths();
  const perMonth = months.map((m) => entries.filter((e) => e.status === "COUNTED" && e.dateKey.startsWith(m)).length);

  return (
    <Screen scroll>
      <H2>{name ? `${STR.smpTitle} — ${name}` : STR.smpTitle}</H2>
      {mq.fetching && entries.length === 0 ? (
        <Loader label={STR.loading} />
      ) : mq.error ? (
        <ErrorBanner message={friendlyError(mq.error)} onRetry={() => refetchM({ requestPolicy: "network-only" })} />
      ) : (
        <>
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.smpMonths}</Body>
            <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
              {months.map((m, i) => (
                <View key={m} style={{ flex: 1, alignItems: "center" }}>
                  <Body style={{ fontWeight: "700", fontSize: 20 }}>{bnNum(perMonth[i]!)}</Body>
                  <Muted>{BN_MONTHS[Number(m.slice(5, 7)) - 1]}</Muted>
                </View>
              ))}
            </View>
          </Card>

          <Body style={{ fontWeight: "700", marginTop: space(3) }}>{STR.smpWarnings}</Body>
          {warnings.length === 0 ? (
            <Muted>{STR.smpNoWarnings}</Muted>
          ) : (
            warnings.map((w) => (
              <WarningCard
                key={w.id}
                w={w}
                canMeet={canMeet}
                onSaved={() => refetchW({ requestPolicy: "network-only" })}
              />
            ))
          )}
          <Muted style={{ marginVertical: space(2) }}>{STR.smpConductNote}</Muted>

          <Body style={{ fontWeight: "700", marginTop: space(2) }}>{STR.smpEntries}</Body>
          {entries.length === 0 ? <EmptyState message={STR.smrEmpty} /> : entries.map((m) => <StaffMistakeCard key={m.id} m={m} />)}
        </>
      )}
    </Screen>
  );
}
