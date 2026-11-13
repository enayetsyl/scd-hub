/**
 * আমার রিপোর্ট (docs/prd-child-support-profile.md §9.3): own reports at once with their status; the
 * comment prompts still to write; a report with questions or a returned report opens the form; an
 * approved report the Principal edited shows আগে → পরে. A list row carries only metadata (child, date,
 * tone, status); the text is one audited read away ("খুলে পড়ুন", via MY_REPORTS). A child the author no
 * longer teaches shows the status only. A report held for a safety question cannot be edited or
 * withdrawn until the Principal decides.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useClient, useMutation, useQuery } from "urql";
import { SUPPORT_REPORT_STATUS_LABELS_BN, type SupportReportStatus } from "@scd/shared";
import { ANSWER_SUPPORT_SEED, MY_SUPPORT_REPORTS, MY_SUPPORT_SEED_PROMPTS, SUPPORT_REPORT, WITHDRAW_SUPPORT_REPORT, type SupportReportT } from "../../graphql/supportProfile";
import type { HomeStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Loader, Notice, Badge } from "../../components/ui";
import { useToast } from "../../state/ToastContext";
import { useConfirm } from "../../state/ConfirmContext";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeStackParamList, "MySupportReports">;
const EDITABLE = ["DRAFT", "TO_PROCESS", "NEEDS_REWRITE", "RETURNED"];

export default function MySupportReportsScreen({ navigation }: Props): React.ReactElement {
  const toast = useToast();
  const { confirmAction } = useConfirm();
  const client = useClient();
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<Record<string, SupportReportT>>({});
  const [q, refetch] = useQuery<{ mySupportReportsPage: { total: number; pageSize: number; rows: SupportReportT[] } }>({ query: MY_SUPPORT_REPORTS, variables: { page, pageSize: 25 }, requestPolicy: "cache-and-network" });
  const [seeds, refetchSeeds] = useQuery<{ mySupportSeedPrompts: { commentId: string; studentId: string; expiresKey: string; studentName: string | null; offeredOn: string }[] }>({ query: MY_SUPPORT_SEED_PROMPTS, requestPolicy: "cache-and-network" });
  const [, withdraw] = useMutation(WITHDRAW_SUPPORT_REPORT);
  const [, answer] = useMutation(ANSWER_SUPPORT_SEED);
  const data = q.data?.mySupportReportsPage;

  /** The one audited read of an own report (via MY_REPORTS): the text and the Principal's edits. */
  const openReport = async (id: string) => {
    const res = await client.query<{ supportReport: SupportReportT }>(SUPPORT_REPORT, { reportId: id, via: "MY_REPORTS" }, { requestPolicy: "network-only" }).toPromise();
    if (res.error || !res.data) return toast.show(friendlyError(res.error), "danger");
    setOpened({ ...opened, [id]: res.data.supportReport });
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        {(seeds.data?.mySupportSeedPrompts ?? []).map((s) => (
          <Card key={s.commentId}>
            <Body>{STR.supPendingSeeds}</Body>
            <Muted>{`${s.studentName ?? STR.supStatusOnly} · ${s.offeredOn}`}</Muted>
            {s.studentName ? (
              <Button
                title={STR.supSeedNow}
                variant="secondary"
                onPress={async () => {
                  const r = await answer({ commentId: s.commentId, choice: "NOW" });
                  if (r.error) return toast.show(friendlyError(r.error), "danger");
                  refetchSeeds({ requestPolicy: "network-only" });
                  navigation.navigate("SupportReportForm", { studentId: s.studentId, reportId: r.data?.answerSupportSeed.draft?.id });
                }}
              />
            ) : null}
          </Card>
        ))}
        {q.fetching && !data ? <Loader /> : null}
        {q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : null}
        {data?.rows.map((r) => {
          const full = opened[r.id];
          const readable = r.studentName != null;
          const held = r.safeguardingHold === "OPEN";
          const tone = r.tone === "POSITIVE" ? STR.supToneP : r.tone === "CONCERN" ? STR.supToneC : r.tone ? STR.supToneM : "";
          return (
            <Card key={r.id}>
              <Badge text={SUPPORT_REPORT_STATUS_LABELS_BN[r.status as SupportReportStatus] ?? r.status} />
              <Body>{readable ? `${r.studentName} · ${r.occurredOn}${tone ? ` · ${tone}` : ""}` : `${STR.supStatusOnly}`}</Body>
              {readable && !full ? <Button title={STR.supOpenRead} variant="ghost" onPress={() => openReport(r.id)} /> : null}
              {full?.behaviour ? <Muted>{full.behaviour}</Muted> : null}
              {full?.principalEdited ? <Notice message={STR.supEdited} tone="info" /> : null}
              {(full?.edits ?? []).map((e) => (
                <Muted key={e.field}>{`${STR.supBefore}: ${e.before}\n${STR.supAfter}: ${e.after}`}</Muted>
              ))}
              {held ? <Muted>{STR.supHeldNoEdit}</Muted> : null}
              {readable && !held && EDITABLE.includes(r.status) ? (
                <View style={{ gap: space(2), marginTop: space(2) }}>
                  <Button title={r.status === "NEEDS_REWRITE" ? STR.supQuestions : STR.supReportTitle} variant="secondary" onPress={() => navigation.navigate("SupportReportForm", { studentId: r.studentId, reportId: r.id })} />
                  <Button
                    title={STR.supWithdraw}
                    variant="ghost"
                    onPress={async () => {
                      if (!(await confirmAction({ title: STR.supWithdraw, message: STR.supWithdrawConfirm, confirmLabel: STR.supWithdraw }))) return;
                      const x = await withdraw({ reportId: r.id });
                      if (x.error) return toast.show(friendlyError(x.error), "danger");
                      refetch({ requestPolicy: "network-only" });
                    }}
                  />
                </View>
              ) : null}
            </Card>
          );
        })}
        {data && data.total > page * data.pageSize ? <Button title="›" variant="ghost" onPress={() => setPage(page + 1)} /> : null}
        {page > 1 ? <Button title="‹" variant="ghost" onPress={() => setPage(page - 1)} /> : null}
      </ScrollView>
    </Screen>
  );
}
