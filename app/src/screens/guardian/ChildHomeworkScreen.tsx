/**
 * ChildHomeworkScreen (GP-2) — the selected child's homework over a date range,
 * grouped by day, FULL lifecycle per record (GP-J4/J5): stage timeline, chase
 * count, result, resubmission chain (same HW_ID adjacent, পুনঃজমা badge),
 * top-up, and the প্রশ্নপত্র / উত্তরপত্র viewers when files exist (streamed via
 * GET /files/:id — web-only viewing, mirroring the PDF path).
 */
import React, { useState } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import { useQuery } from "urql";
import { CHILD_HOMEWORK_QUERY, type GuardianHwRecordT } from "../../graphql/operations";
import { Screen, Body, Muted, Card, Badge, Button, Notice, Loader, EmptyState } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { STR, bnNum, lifecycleStateLabel, subjectLabel, hwResultLabel } from "../../lib/labels";
import { openStoredFile, FILE_VIEW_SUPPORTED, FileUploadError } from "../../lib/files";
import { useFileOpen } from "../../lib/useFileOpen";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
};

/** One stage-timeline row: label + Bangla-digit date (or dash). */
function StageRow({ label, at }: { label: string; at: string | null }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Muted>{label}</Muted>
      <Muted>{at ? bnNum(at.slice(0, 10)) : "—"}</Muted>
    </View>
  );
}

function RecordCard({
  record,
  onOpenFile,
}: {
  record: GuardianHwRecordT;
  onOpenFile: (fileId: string) => void;
}): React.ReactElement {
  const r = record;
  const { openingId, runOpen } = useFileOpen();
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexShrink: 1 }}>
          <Body style={{ fontWeight: "700" }}>{subjectLabel(r.subject)}</Body>
          <Muted>{r.hwId}</Muted>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          {r.resubOf ? <Badge text={lifecycleStateLabel("RESUBMIT")} tone="warn" /> : null}
          <Badge text={lifecycleStateLabel(r.state)} tone={r.state === "CHASE" ? "danger" : "brand"} />
        </View>
      </View>

      {/* Stage timeline (GP-J4) */}
      <View style={{ marginTop: space(2) }}>
        <StageRow label={lifecycleStateLabel("GIVEN")} at={r.givenAt} />
        <StageRow label={lifecycleStateLabel("DUE")} at={r.dueDate} />
        <StageRow label={lifecycleStateLabel("SUBMITTED")} at={r.submittedAt} />
        <StageRow label={lifecycleStateLabel("CHECKED")} at={r.checkedAt} />
        <StageRow label={lifecycleStateLabel("RETURNED")} at={r.returnedAt} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
        {r.chaseCount > 0 ? (
          <Badge text={`${lifecycleStateLabel("CHASE")} ×${bnNum(r.chaseCount)}`} tone="danger" />
        ) : null}
        {r.result ? (
          <Badge text={hwResultLabel(r.result)} tone={r.result === "CORRECT" ? "ok" : r.result === "WRONG" ? "danger" : "warn"} />
        ) : null}
        {r.topupFlag ? (
          <Badge
            text={`${STR.gpTopup}: ${bnNum(r.topupQCount)}${r.topupTimeMin ? ` · ${bnNum(r.topupTimeMin)} ${STR.gpMinutes}` : ""}`}
            tone="info"
          />
        ) : null}
      </View>

      {/* প্রশ্নপত্র / উত্তরপত্র viewers (GP-J6) — only when a file exists */}
      {FILE_VIEW_SUPPORTED && (r.questionFileId || r.answerFileId) ? (
        <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
          {r.questionFileId ? (
            <Button
              title={STR.gpQuestionFile}
              variant="secondary"
              loading={openingId === r.questionFileId}
              disabled={!!openingId}
              onPress={() => runOpen(r.questionFileId!, () => onOpenFile(r.questionFileId!))}
              style={{ flexGrow: 1 }}
            />
          ) : null}
          {r.answerFileId ? (
            <Button
              title={STR.gpAnswerFile}
              variant="secondary"
              loading={openingId === r.answerFileId}
              disabled={!!openingId}
              onPress={() => runOpen(r.answerFileId!, () => onOpenFile(r.answerFileId!))}
              style={{ flexGrow: 1 }}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

export default function ChildHomeworkScreen(): React.ReactElement {
  const { selected, fetching } = useGuardianChild();
  const [from, setFrom] = useState(daysAgo(14));
  const [to, setTo] = useState(isoDay(new Date()));
  const [fileError, setFileError] = useState<string | null>(null);

  const [hwQ, refetchHw] = useQuery({
    query: CHILD_HOMEWORK_QUERY,
    variables: { studentId: selected?.studentId ?? "", from, to },
    pause: !selected,
  });

  // UX-7: pull-to-refresh.
  const { refreshing, onRefresh } = usePullRefresh(hwQ.fetching, () =>
    refetchHw({ requestPolicy: "network-only" }),
  );

  async function onOpenFile(fileId: string): Promise<void> {
    setFileError(null);
    try {
      await openStoredFile(fileId);
    } catch (e) {
      setFileError(e instanceof FileUploadError ? e.message : STR.hwFileOpenFail);
    }
  }

  if (fetching && !selected) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!selected) {
    return (
      <Screen>
        <EmptyState message={STR.gpNoChildren} />
      </Screen>
    );
  }

  const records = hwQ.data?.childHomework ?? [];
  // Group by day (the server orders newest day first, chain-adjacent inside).
  const byDay: Array<{ day: string; rows: GuardianHwRecordT[] }> = [];
  for (const r of records) {
    const day = r.dateGiven.slice(0, 10);
    const last = byDay[byDay.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else byDay.push({ day, rows: [r] });
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <ChildSwitcher />
        <View style={{ flexDirection: "row", gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <DateField label={STR.gpFromDate} value={from} onChange={setFrom} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label={STR.gpToDate} value={to} onChange={setTo} min={from || undefined} />
          </View>
        </View>
        {fileError ? <Notice message={fileError} tone="danger" /> : null}
        {hwQ.fetching && records.length === 0 ? (
          <Loader label={STR.loading} />
        ) : byDay.length === 0 ? (
          <EmptyState message={STR.gpNoHomework} />
        ) : (
          byDay.map((g) => (
            <View key={g.day}>
              <Muted style={{ marginTop: space(3), marginBottom: space(1) }}>{bnNum(g.day)}</Muted>
              {g.rows.map((r) => (
                <RecordCard key={r.recordId} record={r} onOpenFile={onOpenFile} />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
