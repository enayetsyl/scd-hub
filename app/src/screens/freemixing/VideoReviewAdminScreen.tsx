/**
 * VideoReviewAdminScreen (owner ask 2026-07-20) — Principal/Office surface:
 * log a class-session YouTube link with its day/time/class/room, assign a
 * teacher, and watch the board — per-teacher pending/ok/not-ok counts plus
 * every row's verdict (a NOT_OK shows the teacher's comment). Server gates:
 * createVideoReview = observation:upload; the board = observation:manage.
 */
import React, { useState } from "react";
import { Linking, ScrollView, View, RefreshControl } from "react-native";
import { useQuery, useMutation } from "urql";
import {
  CREATE_VIDEO_REVIEW,
  VIDEO_REVIEW_OVERVIEW,
} from "../../graphql/videoReview";
import { TEACHERS_QUERY } from "../../graphql/operations";
import { Screen, H2, Body, Muted, Card, Badge, Button, Field, Select, Notice, Loader, EmptyState, Divider } from "../../components/ui";
import { STR, bnNum, dhakaDateKey } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";

const todayKey = (): string => dhakaDateKey();

function statusBadge(status: string): { text: string; tone: "warn" | "ok" | "danger" } {
  if (status === "PENDING") return { text: STR.vrStatusPending, tone: "warn" };
  if (status === "OK") return { text: STR.vrStatusOk, tone: "ok" };
  return { text: STR.vrStatusNotOk, tone: "danger" };
}

export default function VideoReviewAdminScreen(): React.ReactElement {
  const [{ data, fetching }, refetch] = useQuery({ query: VIDEO_REVIEW_OVERVIEW });
  const [{ data: teachersData }] = useQuery({ query: TEACHERS_QUERY });
  const [, create] = useMutation(CREATE_VIDEO_REVIEW);

  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [classDate, setClassDate] = useState(todayKey());
  const [timeLabel, setTimeLabel] = useState("");
  const [classLabel, setClassLabel] = useState("");
  const [room, setRoom] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const overview = data?.videoReviewOverview;
  const rows = (overview?.rows ?? []).filter((r) => statusFilter === "" || r.status === statusFilter);
  const teacherOptions = (teachersData?.teachers ?? []).map((t) => ({
    label: t.name,
    value: t.id,
    hint: t.phone ?? undefined,
  }));

  const { refreshing, onRefresh } = usePullRefresh(fetching, () =>
    refetch({ requestPolicy: "network-only" }),
  );

  const canSubmit =
    youtubeUrl.trim() !== "" && classDate.trim() !== "" && timeLabel.trim() !== "" &&
    classLabel.trim() !== "" && room.trim() !== "" && teacherId !== "";

  async function onAssign(): Promise<void> {
    if (busy || !canSubmit) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await create({
      youtubeUrl: youtubeUrl.trim(),
      classDate: classDate.trim(),
      timeLabel: timeLabel.trim(),
      classLabel: classLabel.trim(),
      room: room.trim(),
      teacherId,
    });
    setBusy(false);
    if (res.error || !res.data?.createVideoReview) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.vrAssigned);
    setYoutubeUrl("");
    setTimeLabel("");
    setClassLabel("");
    setRoom("");
    setTeacherId("");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <H2>{STR.vrTitle}</H2>
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        <Card>
          <Field label={STR.vrYoutubeUrl} value={youtubeUrl} onChangeText={setYoutubeUrl} autoCapitalize="none" />
          <Field label={STR.vrDate} value={classDate} onChangeText={setClassDate} />
          <Field label={STR.vrTime} value={timeLabel} onChangeText={setTimeLabel} />
          <Field label={STR.vrClass} value={classLabel} onChangeText={setClassLabel} />
          <Field label={STR.vrRoom} value={room} onChangeText={setRoom} />
          <Select
            label={STR.vrTeacher}
            value={teacherId === "" ? null : teacherId}
            options={teacherOptions}
            onChange={setTeacherId}
            placeholder={STR.vrTeacher}
            searchable
          />
          <Button
            title={STR.vrAssign}
            onPress={() => void onAssign()}
            loading={busy}
            disabled={busy || !canSubmit}
            style={{ marginTop: space(2) }}
          />
        </Card>

        <Divider />

        {/* Per-teacher counts — who still has videos waiting. */}
        <H2>{STR.vrSummaryTitle}</H2>
        {(overview?.summary ?? []).map((s) => (
          <Card key={s.teacherId}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700", flexShrink: 1 }}>{s.teacherName ?? s.teacherId}</Body>
              <View style={{ flexDirection: "row", gap: space(2) }}>
                {s.pending > 0 ? <Badge text={`${STR.vrStatusPending} ${bnNum(s.pending)}`} tone="warn" /> : null}
                {s.ok > 0 ? <Badge text={`${STR.vrStatusOk} ${bnNum(s.ok)}`} tone="ok" /> : null}
                {s.notOk > 0 ? <Badge text={`${STR.vrStatusNotOk} ${bnNum(s.notOk)}`} tone="danger" /> : null}
              </View>
            </View>
          </Card>
        ))}

        <Divider />

        <Select
          label={STR.filters}
          value={statusFilter === "" ? null : statusFilter}
          options={[
            { label: STR.all, value: "" },
            { label: STR.vrStatusPending, value: "PENDING" },
            { label: STR.vrStatusOk, value: "OK" },
            { label: STR.vrStatusNotOk, value: "NOT_OK" },
          ]}
          onChange={setStatusFilter}
          placeholder={STR.all}
        />

        {fetching && rows.length === 0 ? (
          <Loader label={STR.loading} />
        ) : rows.length === 0 ? (
          <EmptyState message={STR.vrNoVideos} />
        ) : (
          rows.map((r) => {
            const badge = statusBadge(r.status);
            return (
              <Card key={r.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "700", flexShrink: 1 }}>{r.teacherName ?? "—"}</Body>
                  <Badge text={badge.text} tone={badge.tone} />
                </View>
                <Muted style={{ marginTop: 2 }}>
                  {bnNum(r.classDate)} · {r.classLabel} · {STR.vrTime}: {r.timeLabel} · {STR.vrRoom}: {r.room}
                </Muted>
                {r.comment ? <Body style={{ marginTop: space(1) }}>💬 {r.comment}</Body> : null}
                <Button
                  title={`▶ ${STR.vrOpenVideo}`}
                  variant="ghost"
                  onPress={() => Linking.openURL(r.youtubeUrl)}
                  style={{ marginTop: space(1) }}
                />
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}
