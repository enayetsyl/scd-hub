/**
 * আমার রিপোর্ট (docs/prd-child-support-profile.md §9.3): own reports at once with their status; the
 * comment prompts still to write; a report with questions or a returned report opens the form; an
 * approved report the Principal edited shows আগে → পরে. A child the author no longer teaches shows the
 * status only.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { SUPPORT_REPORT_STATUS_LABELS_BN, type SupportReportStatus } from "@scd/shared";
import { ANSWER_SUPPORT_SEED, MY_SUPPORT_REPORTS, MY_SUPPORT_SEED_PROMPTS, WITHDRAW_SUPPORT_REPORT, type SupportReportT } from "../../graphql/supportProfile";
import type { HomeStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Loader, Notice, Badge } from "../../components/ui";
import { useToast } from "../../state/ToastContext";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeStackParamList, "MySupportReports">;
const EDITABLE = ["DRAFT", "TO_PROCESS", "NEEDS_REWRITE", "RETURNED"];

export default function MySupportReportsScreen({ navigation }: Props): React.ReactElement {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [q, refetch] = useQuery<{ mySupportReportsPage: { total: number; pageSize: number; rows: SupportReportT[] } }>({ query: MY_SUPPORT_REPORTS, variables: { page, pageSize: 25 }, requestPolicy: "cache-and-network" });
  const [seeds, refetchSeeds] = useQuery<{ mySupportSeedPrompts: { commentId: string; studentId: string; expiresKey: string }[] }>({ query: MY_SUPPORT_SEED_PROMPTS, requestPolicy: "cache-and-network" });
  const [, withdraw] = useMutation(WITHDRAW_SUPPORT_REPORT);
  const [, answer] = useMutation(ANSWER_SUPPORT_SEED);
  const data = q.data?.mySupportReportsPage;
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        {(seeds.data?.mySupportSeedPrompts ?? []).map((s) => (
          <Card key={s.commentId}>
            <Body>{STR.supPendingSeeds}</Body>
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
          </Card>
        ))}
        {q.fetching && !data ? <Loader /> : null}
        {q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : null}
        {data?.rows.map((r) => (
          <Card key={r.id}>
            <Badge text={SUPPORT_REPORT_STATUS_LABELS_BN[r.status as SupportReportStatus] ?? r.status} />
            <Body>{r.textVisible ? `${r.studentName ?? ""} · ${r.occurredOn}` : `${r.occurredOn} — ${STR.supStatusOnly}`}</Body>
            {r.textVisible && r.behaviour ? <Muted>{r.behaviour}</Muted> : null}
            {r.principalEdited ? <Notice message={STR.supEdited} tone="info" /> : null}
            {r.edits.map((e) => (
              <Muted key={e.field}>{`${STR.supBefore}: ${e.before}\n${STR.supAfter}: ${e.after}`}</Muted>
            ))}
            {r.textVisible && EDITABLE.includes(r.status) ? (
              <View style={{ gap: space(2), marginTop: space(2) }}>
                <Button title={r.status === "NEEDS_REWRITE" ? STR.supQuestions : STR.supReportTitle} variant="secondary" onPress={() => navigation.navigate("SupportReportForm", { studentId: r.studentId, reportId: r.id })} />
                <Button
                  title={STR.supWithdraw}
                  variant="ghost"
                  onPress={async () => {
                    const x = await withdraw({ reportId: r.id });
                    if (x.error) return toast.show(friendlyError(x.error), "danger");
                    refetch({ requestPolicy: "network-only" });
                  }}
                />
              </View>
            ) : null}
          </Card>
        ))}
        {data && data.total > page * data.pageSize ? <Button title="›" variant="ghost" onPress={() => setPage(page + 1)} /> : null}
        {page > 1 ? <Button title="‹" variant="ghost" onPress={() => setPage(page - 1)} /> : null}
      </ScrollView>
    </Screen>
  );
}
