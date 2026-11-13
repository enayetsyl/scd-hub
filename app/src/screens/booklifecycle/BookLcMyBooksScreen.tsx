/**
 * S8 আমার বই (docs/prd-book-lifecycle.md §8; owner Q5): books of the class + subject I teach now — the
 * current release, শিক্ষক সংস্করণ খুলুন, the ভুল-সংশোধনী list with ঠিক করেছি per erratum, ভুল জানান,
 * and আমার পাঠানো (my reports and the Principal's answer).
 */
import React from "react";
import { RefreshControl, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BOOK_FEEDBACK_STATUS_BN, type BookFeedbackStatus } from "@scd/shared";
import { BL_ACK_ERRATUM, BL_MY_BOOKS, BL_MY_REPORTS } from "../../graphql/bookLifecycleRelease";
import { Badge, Body, Button, Card, EmptyState, Muted, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { friendlyError } from "../../lib/errors";
import { openStoredFile } from "../../lib/files";
import { usePullRefresh } from "../../lib/useRefresh";
import { classLevelLabel, subjectLabel } from "../../lib/labels";
import type { BookLcTeacherStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { BL } from "./blStrings";
import { SectionTitle, useMsg, ymd } from "./blCommon";

type Props = NativeStackScreenProps<BookLcTeacherStackParamList, "BookLcMyBooks">;

export default function BookLcMyBooksScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const viewer = can("book_lifecycle:teacher_view");
  const reporter = can("book_lifecycle:report");
  const [q, refetch] = useQuery({ query: BL_MY_BOOKS, pause: !viewer, requestPolicy: "cache-and-network" });
  const [rq, refetchR] = useQuery({ query: BL_MY_REPORTS, pause: !reporter, requestPolicy: "cache-and-network" });
  const [, ack] = useMutation(BL_ACK_ERRATUM);
  const [msg, setMsg] = useMsg();
  const pull = usePullRefresh(q.fetching, () => (refetch({ requestPolicy: "network-only" }), refetchR({ requestPolicy: "network-only" })));
  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}>
      {msg}
      {viewer ? (
        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} isEmpty={!q.data?.myBookLcBooks.length} empty={<EmptyState message={BL.noMyBooks} />}>
          {q.data?.myBookLcBooks.map((b) => (
            <Card key={b.bookId} style={{ marginBottom: space(3) }}>
              <Body style={{ fontWeight: "700" }}>
                {b.titleBn} · {b.versionLabel}
              </Body>
              <Muted>
                {classLevelLabel(b.classLevel)} · {subjectLabel(b.subject)} · {b.releaseLabelBn}
              </Muted>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                {b.teacherFileIds.map((f) => (
                  <Button key={f} title={BL.openTeacherEdition} variant="secondary" onPress={() => void openStoredFile(f)} />
                ))}
                {reporter ? <Button title={BL.reportError} variant="ghost" onPress={() => navigation.navigate("BookLcReport", { bookId: b.bookId, titleBn: b.titleBn })} /> : null}
              </View>
              {b.errata.length ? <SectionTitle>{BL.errata}</SectionTitle> : null}
              {b.errata.map((e) => (
                <View key={e.id} style={{ marginBottom: space(2) }}>
                  <Body>
                    {e.code} {e.page ? `· পৃ. ${e.page}` : ""}: «{e.wrongText}» → «{e.correctText}»
                  </Body>
                  <Muted>{e.instructionBn}</Muted>
                  {e.acked ? (
                    <Badge text={`✓ ${BL.fixedIt}`} tone="ok" />
                  ) : (
                    <Button title={BL.fixedIt} variant="secondary" onPress={() => void ack({ id: e.id }).then((r) => (r.error ? setMsg({ tone: "danger", text: friendlyError(r.error) }) : refetch({ requestPolicy: "network-only" })))} />
                  )}
                </View>
              ))}
            </Card>
          ))}
        </QueryGate>
      ) : null}
      {reporter ? (
        <>
          <SectionTitle>{BL.myReports}</SectionTitle>
          <QueryGate result={rq} onRetry={() => refetchR({ requestPolicy: "network-only" })} isEmpty={!rq.data?.myBookLcReports.length} empty={<EmptyState message="—" />}>
            {rq.data?.myBookLcReports.map((r) => (
              <Card key={`${r.bookId}-${r.code}`} style={{ marginBottom: space(2) }}>
                <View style={{ flexDirection: "row", gap: space(2), alignItems: "center" }}>
                  <Body style={{ fontWeight: "700" }}>{r.code}</Body>
                  <Badge text={BOOK_FEEDBACK_STATUS_BN[r.status as BookFeedbackStatus] ?? r.status} tone="info" />
                  <Muted>{ymd(r.createdAt)}</Muted>
                </View>
                <Muted>{r.textBn}</Muted>
                {r.rejectReasonBn ? <Muted>{`${BL.reject}: ${r.rejectReasonBn}`}</Muted> : null}
              </Card>
            ))}
          </QueryGate>
        </>
      ) : null}
    </Screen>
  );
}
