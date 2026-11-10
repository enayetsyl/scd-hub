/**
 * ActivityBatchScreen (AS-3, A8) — Office's morning print of guardian requests.
 *
 * Lists the waiting requests (class → section → child). "সব ছাপুন" makes one PDF: a list page
 * before each section, then each child's sheet stamped with their English name, class, date
 * and the copy QR. The class teacher then hands them out (শিট বিতরণ).
 */
import React, { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { ACTIVITY_REQUESTS_QUERY, PRINT_ACTIVITY_BATCH } from "../../graphql/activitySheets";
import { Button, Card, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { friendlyError } from "../../lib/errors";
import { PDF_SUPPORTED, openPdf } from "../../lib/pdf";
import { STR, bnNum, classLevelLabel } from "../../lib/labels";
import { space, typeScale, useColors } from "../../theme";

type Msg = { tone: "ok" | "danger"; text: string } | null;

export default function ActivityBatchScreen(): React.ReactElement {
  const colors = useColors();
  const [q, refetch] = useQuery({ query: ACTIVITY_REQUESTS_QUERY, requestPolicy: "cache-and-network" });
  const [{ fetching }, print] = useMutation(PRINT_ACTIVITY_BATCH);
  const [msg, setMsg] = useState<Msg>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const rows = q.data?.activityRequests ?? [];
  const reload = (): void => refetch({ requestPolicy: "network-only" });
  const open = (runId: string): void => {
    if (!PDF_SUPPORTED) return;
    void openPdf(`/files/activity-print?runId=${encodeURIComponent(runId)}`).catch((e) => setMsg({ tone: "danger", text: String((e as Error).message ?? e) }));
  };
  const run = async (): Promise<void> => {
    const res = await print({ issueIds: null });
    if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
    const r = res.data!.printActivityBatch;
    setMsg({ tone: "ok", text: STR.actBatchMade.replace("{n}", bnNum(r.sheets)) });
    setLastRun(r.runId);
    reload();
    open(r.runId);
  };
  let lastGroup = "";
  return (
    <Screen scroll>
      {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
      {rows.length > 0 ? <Button title={STR.actBatchPrint.replace("{n}", bnNum(rows.length))} loading={fetching} onPress={() => void run()} style={{ marginBottom: space(3) }} /> : null}
      {lastRun && PDF_SUPPORTED ? <Button title={STR.actPrintOpen} variant="ghost" onPress={() => open(lastRun)} style={{ marginBottom: space(3) }} /> : null}
      <QueryGate results={[q]} onRetry={reload} loaderLabel={STR.loading}>
        {rows.length === 0 ? <Muted>{STR.actBatchEmpty}</Muted> : null}
        <Card>
          {rows.map((r) => {
            const group = `${r.classLevel === null ? "" : classLevelLabel(r.classLevel)}${r.sectionNameBn ? ` · ${r.sectionNameBn}` : ""}`;
            const head = group !== lastGroup;
            lastGroup = group;
            return (
              <View key={r.issue.id}>
                {head ? <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary, marginTop: space(2) }}>{group}</Text> : null}
                <Muted>
                  {r.studentName} — {r.bankNameBn} · {r.itemId}
                </Muted>
              </View>
            );
          })}
        </Card>
      </QueryGate>
    </Screen>
  );
}
