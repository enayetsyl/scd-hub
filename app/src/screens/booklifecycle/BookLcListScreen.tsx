/**
 * S1 বই ও সংস্করণ — the book list (docs/prd-book-lifecycle.md §8). Paged (D-#761). The old lesson-JSON
 * support-book module is reached from the footer link (§17, D-#1611) by holders of a book_production
 * action other than view.
 */
import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { ROSTER_CLASS_LEVELS } from "@scd/shared";
import { BL_BOOKS } from "../../graphql/bookLifecycle";
import { Badge, Body, Button, Card, Chip, ChipRow, EmptyState, Muted, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { Pager } from "../../components/Pager";
import { useAuth } from "../../auth/AuthContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { bnNum, classLevelLabel, subjectLabel } from "../../lib/labels";
import type { BookLcStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { BL, LIST_STATUS_LABEL } from "./blStrings";

type Props = NativeStackScreenProps<BookLcStackParamList, "BookLcList">;
const STATUSES = ["drafting", "in_review", "approved", "final", "in_use"];

export default function BookLcListScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const root = useNavigation();
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [q, refetch] = useQuery({ query: BL_BOOKS, variables: { classLevel, status, page, pageSize: 30 }, requestPolicy: "cache-and-network" });
  const pull = usePullRefresh(q.fetching, () => refetch({ requestPolicy: "network-only" }));
  const manage = can("book_lifecycle:manage");
  const archive = ["create", "settings", "assign", "author", "illustrate", "review", "approve", "assemble", "override"].some((a) => can(`book_production:${a}`));
  const data = q.data?.bookLcBooksPage;
  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginBottom: space(3) }}>
        {manage ? <Button title={BL.newOrImport} onPress={() => navigation.navigate("BookLcImport")} /> : null}
        <Button title={BL.ruleSets} variant="secondary" onPress={() => navigation.navigate("BookLcRuleSets")} />
      </View>
      <ChipRow>
        <Chip label={BL.all} selected={classLevel === null} onPress={() => setClassLevel(null)} />
        {ROSTER_CLASS_LEVELS.map((l) => (
          <Chip key={l} label={classLevelLabel(l)} selected={classLevel === l} onPress={() => (setClassLevel(l), setPage(1))} />
        ))}
      </ChipRow>
      <ChipRow>
        <Chip label={BL.all} selected={status === null} onPress={() => setStatus(null)} />
        {STATUSES.map((s) => (
          <Chip key={s} label={LIST_STATUS_LABEL(s)} selected={status === s} onPress={() => (setStatus(s), setPage(1))} />
        ))}
      </ChipRow>
      <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} isEmpty={!data?.rows.length} empty={<EmptyState message={BL.noBooks} />}>
        {data?.rows.map((b) => (
          <Card key={b.id} onPress={() => navigation.navigate("BookLcBook", { bookId: b.id })} style={{ marginTop: space(3) }}>
            <Body style={{ fontWeight: "700" }}>
              {b.titleBn} · {b.code}
            </Body>
            <Muted>
              {classLevelLabel(b.classLevel)} · {subjectLabel(b.subject)} · {b.latest ? `${b.latest.labelBn} (${b.latest.statusBn})` : "—"}
            </Muted>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) }}>
              <Badge text={LIST_STATUS_LABEL(b.listStatus)} tone="info" />
              {b.openFeedback ? <Badge text={`${bnNum(b.openFeedback)} ${BL.openFeedback}`} tone="warn" /> : null}
              {b.openRoundMemoNo ? <Badge text={`${BL.openRound} ${bnNum(b.openRoundMemoNo)}`} tone="muted" /> : null}
              {b.roundOverdue ? <Badge text={BL.overdue} tone="danger" /> : null}
            </View>
          </Card>
        ))}
        {data ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
      </QueryGate>
      {archive ? (
        <View style={{ marginTop: space(6) }}>
          <Button title={BL.archiveLink} variant="ghost" onPress={() => (root as unknown as { navigate: (t: string, p?: object) => void }).navigate("SupportBookTab", { screen: "BookImport" })} />
        </View>
      ) : null}
    </Screen>
  );
}
