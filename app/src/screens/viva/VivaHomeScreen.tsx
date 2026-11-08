/**
 * VivaHomeScreen (D-#1080–#1084, mockup screens 1, 5, 8) — the মৌখিক পরীক্ষা screen.
 *
 *  - Office (viva:view / manage): every oral paper of the exam in date order, with live
 *    progress (refreshed every 15 s), its examiners, and buttons for the paper, the
 *    examiners, the marks, the results and the lock.
 *  - A teacher who examines: their own papers ("আমার মৌখিক পরীক্ষা").
 */
import React from "react";
import { RefreshControl, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MY_VIVA_PAPERS, VIVA_LOCK, VIVA_OVERVIEW, vivaNum, type VivaPaperT } from "../../graphql/viva";
import { Badge, Body, Button, Card, EmptyState, H2, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, fullDateLabel } from "../../lib/labels";
import type { VivaStackParamList } from "../../navigation/types";
import { space } from "../../theme";

type Props = NativeStackScreenProps<VivaStackParamList, "VivaHome">;

export function vivaProgressLine(p: VivaPaperT): string {
  return STR.vivaProgress
    .replace("{n}", bnNum(p.progress.children))
    .replace("{d}", bnNum(p.progress.done))
    .replace("{a}", bnNum(p.progress.absent));
}

function PaperCard({ p, navigation, office, onChanged }: { p: VivaPaperT; navigation: Props["navigation"]; office: boolean; onChanged: () => void }): React.ReactElement {
  const { can } = useAuth();
  const { confirmAction } = useConfirm();
  const [lockSt, lock] = useMutation(VIVA_LOCK);
  const [err, setErr] = React.useState<string | null>(null);
  const examiners = p.examiners.map((e) => (office ? `${e.name} (${bnNum(e.done)}/${bnNum(e.children)})` : e.name)).join(" · ");
  const toggleLock = async () => {
    const locking = !p.lockedAt;
    if (locking && !(await confirmAction({ title: STR.vivaLock, message: STR.vivaLockConfirm }))) return;
    const res = await lock({ paperId: p.id, lock: locking });
    if (res.error) return setErr(friendlyError(res.error));
    onChanged();
  };
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <View style={{ flex: 1 }}>
          <Body style={{ fontWeight: "700" }}>
            {p.classLabelBn} · {p.subjectLabelBn}
          </Body>
          <Muted>
            {fullDateLabel(p.dateKey)} · {STR.vivaFull.replace("{n}", vivaNum(p.fullMarks))}
          </Muted>
        </View>
        {p.lockedAt ? <Badge text={STR.vivaLockedBadge} tone="danger" /> : null}
      </View>
      <Muted>{vivaProgressLine(p)}</Muted>
      <Muted>{examiners || STR.vivaNoExaminer}</Muted>
      {err ? <Notice tone="danger" message={err} /> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
        <Button title={STR.vivaMarks} onPress={() => navigation.navigate("VivaSheet", { paperId: p.id })} />
        {can("viva:manage") ? <Button title={STR.vivaQuestions} variant="secondary" onPress={() => navigation.navigate("VivaPaper", { paperId: p.id })} /> : null}
        {can("viva:manage") ? <Button title={STR.vivaExaminers} variant="secondary" onPress={() => navigation.navigate("VivaExaminers", { paperId: p.id })} /> : null}
        {office ? <Button title={STR.vivaResults} variant="secondary" onPress={() => navigation.navigate("VivaResults", { paperId: p.id })} /> : null}
        {can("viva:lock") ? (
          <Button title={p.lockedAt ? STR.vivaUnlock : STR.vivaLock} variant="ghost" loading={lockSt.fetching} onPress={() => void toggleLock()} />
        ) : null}
      </View>
    </Card>
  );
}

function OfficeView({ navigation }: { navigation: Props["navigation"] }): React.ReactElement {
  const [q, reexec] = useQuery({ query: VIVA_OVERVIEW });
  const refetch = React.useCallback(() => reexec({ requestPolicy: "network-only" }), [reexec]);
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, refetch);
  React.useEffect(() => {
    const id = setInterval(refetch, 15_000);
    return () => clearInterval(id);
  }, [refetch]);
  const exams = q.data?.vivaOverview ?? [];
  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <QueryGate result={q} onRetry={refetch} isEmpty={exams.length === 0} empty={<EmptyState message={STR.vivaNone} />}>
        <View style={{ gap: space(3) }}>
          <Badge text={STR.vivaLive} tone="ok" />
          {exams.map((ex) => (
            <View key={ex.examId} style={{ gap: space(2) }}>
              <H2>{ex.examName}</H2>
              {ex.papers.map((p) => (
                <PaperCard key={p.id} p={p} navigation={navigation} office onChanged={refetch} />
              ))}
            </View>
          ))}
        </View>
      </QueryGate>
    </Screen>
  );
}

export function MyVivaList({ navigation }: { navigation: Props["navigation"] }): React.ReactElement {
  const [q, reexec] = useQuery({ query: MY_VIVA_PAPERS });
  const refetch = React.useCallback(() => reexec({ requestPolicy: "network-only" }), [reexec]);
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, refetch);
  const papers = q.data?.myVivaPapers ?? [];
  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <QueryGate result={q} onRetry={refetch} isEmpty={papers.length === 0} empty={<EmptyState message={STR.vivaNoneMine} />}>
        <View style={{ gap: space(2) }}>
          <H2>{STR.vivaMyDuties}</H2>
          {papers.map((p) => (
            <PaperCard key={p.id} p={p} navigation={navigation} office={false} onChanged={refetch} />
          ))}
        </View>
      </QueryGate>
    </Screen>
  );
}

export default function VivaHomeScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  if (can("viva:view") || can("viva:manage")) return <OfficeView navigation={navigation} />;
  return <MyVivaList navigation={navigation} />;
}
