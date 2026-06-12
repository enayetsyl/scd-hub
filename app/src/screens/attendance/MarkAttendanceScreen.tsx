/**
 * MarkAttendanceScreen (AT2.3, D-#63) — ABSENT-ONLY capture: the marker taps the
 * absent students; everyone else counts present. One record per section per day;
 * re-submitting the same day overwrites it (editable until end of day, O2).
 * The server enforces the CT-2 marker gate + the FULL-day calendar.
 */
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { ROSTER_QUERY, SECTION_ATTENDANCE, MARK_SECTION_ATTENDANCE } from "../../graphql/operations";
import type { AttendanceStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Chip, ChipRow, Button, Notice, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AttendanceStackParamList, "MarkAttendance">;

export default function MarkAttendanceScreen({ route }: Props): React.ReactElement {
  const { sectionId, title, dateKey } = route.params;
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [rosterQ] = useQuery({ query: ROSTER_QUERY, variables: { sectionId } });
  const [dayQ, refetchDay] = useQuery({
    query: SECTION_ATTENDANCE,
    variables: { sectionId, dateKey },
    requestPolicy: "network-only",
  });
  const [, mark] = useMutation(MARK_SECTION_ATTENDANCE);

  const students = rosterQ.data?.studentsInSection ?? [];
  const existing = dayQ.data?.sectionAttendance ?? null;

  // Prefill from the already-marked day (same-day edit, O2).
  useEffect(() => {
    if (existing) setAbsent(new Set(existing.absentStudentIds));
  }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(studentId: string): void {
    setOk(null);
    setAbsent((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  async function onSubmit(): Promise<void> {
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await mark({ sectionId, dateKey, absentStudentIds: [...absent] });
    setBusy(false);
    if (res.error || !res.data?.markSectionAttendance) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.attSubmitted);
    refetchDay({ requestPolicy: "network-only" });
  }

  const presentCount = students.length - absent.size;

  return (
    <Screen scroll>
      <H2>{title}</H2>
      <Muted>{dateKey} · {STR.attTapAbsent}</Muted>

      {rosterQ.error ? (
        <ErrorBanner message={friendlyError(rosterQ.error)} />
      ) : rosterQ.fetching ? (
        <Loader label={STR.loading} />
      ) : students.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        <>
          <Card style={{ marginTop: space(3) }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Body>
                {STR.attPresentWord}: <Body style={{ fontWeight: "700" }}>{bnNum(presentCount)}</Body>
              </Body>
              <Body>
                {STR.attAbsentWord}: <Body style={{ fontWeight: "700" }}>{bnNum(absent.size)}</Body>
              </Body>
            </View>
            {existing ? <Muted style={{ marginTop: space(1) }}>✓ {STR.attMarked}</Muted> : null}
          </Card>

          <Card>
            <ChipRow>
              {students.map((s) => (
                <Chip
                  key={s.id}
                  label={`${s.nameBn || s.name}${absent.has(s.id) ? " ✗" : ""}`}
                  selected={!absent.has(s.id)}
                  onPress={() => toggle(s.id)}
                />
              ))}
            </ChipRow>
          </Card>

          {ok ? <Notice message={ok} tone="ok" /> : null}
          {error ? <Notice message={error} tone="danger" /> : null}
          <Button title={STR.attSubmit} onPress={onSubmit} loading={busy} />
          <View style={{ height: space(4) }} />
        </>
      )}
    </Screen>
  );
}
