/**
 * MasteryActionsScreen (M-5, mocks L1 / L4) — two routes, one screen:
 *  - MasteryLeader (param-free, drawer): the whole school for an approver — four numbers, the
 *    proposals waiting for a decision, the running actions;
 *  - MasteryActions {sectionId, subject}: one section × subject's record (issue → action → result).
 * Lists page from day one (D-#761). Every row opens the action.
 */
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MASTERY_ACTION_COUNTS_QUERY, MASTERY_ACTIONS_PAGE_QUERY, type MasteryActionRow } from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Loader, EmptyState, Notice, H2 } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryActionLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space, useColors } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import { fill } from "./masteryStateUi";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryLeader" | "MasteryActions">;

const statusTone = (s: string) =>
  s === "PROPOSED" ? "gold" : s === "CLOSED" ? "ok" : s === "REJECTED" ? "muted" : "info";

function ActionList({
  filter,
  sectionId,
  subject,
  title,
  empty,
  onOpen,
}: {
  filter: string;
  sectionId?: string;
  subject?: string;
  title?: string;
  empty: string;
  onOpen: (id: string) => void;
}): React.ReactElement {
  const colors = useColors();
  const [page, setPage] = useState(1);
  const [{ data, fetching, error }] = useQuery({
    query: MASTERY_ACTIONS_PAGE_QUERY,
    variables: { filter, sectionId: sectionId ?? null, subject: subject ?? null, page, pageSize: 20 },
    requestPolicy: "cache-and-network",
  });
  const pg = data?.masteryActionsPage as { rows: MasteryActionRow[]; total: number; pageSize: number } | undefined;
  const rows = pg?.rows ?? [];
  const pages = pg ? Math.max(1, Math.ceil(pg.total / pg.pageSize)) : 1;
  return (
    <View style={{ gap: space(2) }}>
      {title ? <Body style={{ fontWeight: "700" }}>{title}</Body> : null}
      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {fetching && rows.length === 0 ? <Loader /> : null}
      {!fetching && !error && rows.length === 0 ? <EmptyState message={empty} /> : null}
      {rows.map((r) => (
        <Pressable
          key={r.id}
          accessibilityRole="link"
          onPress={() => onOpen(r.id)}
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space(3), gap: 4 }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
            <Body style={{ fontWeight: "700", flexShrink: 1 }}>
              {r.className} {r.sectionName} · {hwSubjectLabel(r.subject)} · {r.labelBn}
            </Body>
            <Badge text={r.outcome ? masteryActionLabel(r.outcome) : masteryActionLabel(r.status)} tone={statusTone(r.status)} />
          </View>
          <Muted>
            {fill(STR.msWeakOf, { weak: bnNum(r.weak), of: bnNum(r.verdicts), pct: bnNum(r.weakPct), n: bnNum(r.assessments) })}
            {r.status !== "PROPOSED" ? ` · ${masteryActionLabel(r.kind)}` : ""}
            {r.planDate ? ` · ${bnNum(r.planDate)}` : ""}
          </Muted>
        </Pressable>
      ))}
      {pages > 1 ? (
        <View style={{ flexDirection: "row", gap: space(2), justifyContent: "center" }}>
          <Button title="‹" variant="secondary" disabled={page <= 1} onPress={() => setPage((n) => n - 1)} />
          <Body>
            {bnNum(page)} / {bnNum(pages)}
          </Body>
          <Button title="›" variant="secondary" disabled={page >= pages} onPress={() => setPage((n) => n + 1)} />
        </View>
      ) : null}
    </View>
  );
}

export default function MasteryActionsScreen({ navigation, route }: Props): React.ReactElement {
  const params = (route.params ?? {}) as { sectionId?: string; subject?: string };
  const schoolWide = !params.sectionId;
  const [filter, setFilter] = useState<"OPEN" | "CLOSED" | "ALL">("OPEN");
  const [{ data: countData }] = useQuery({ query: MASTERY_ACTION_COUNTS_QUERY, pause: !schoolWide, requestPolicy: "cache-and-network" });
  const c = countData?.masteryActionCounts as { proposed: number; running: number; retestThisWeek: number; closed30: number } | undefined;
  const open = (id: string) => navigation.navigate("MasteryAction", { actionId: id });

  return (
    <Screen scroll wide>
      {schoolWide ? (
        <>
          <H2>{STR.msLeader}</H2>
          {c ? (
            <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
              {(
                [
                  [STR.msKpiProposed, c.proposed],
                  [STR.msKpiRunning, c.running],
                  [STR.msKpiRetest, c.retestThisWeek],
                  [STR.msKpiClosed, c.closed30],
                ] as const
              ).map(([label, n]) => (
                <Card key={label} style={{ flexGrow: 1, flexBasis: 160 }}>
                  <Muted>{label}</Muted>
                  <Body style={{ fontSize: 28, fontWeight: "700" }}>{bnNum(n)}</Body>
                </Card>
              ))}
            </View>
          ) : null}
          <ActionList filter="PROPOSED" title={STR.msPendingTitle} empty={STR.msNoPending} onOpen={open} />
          <ActionList filter="RUNNING" title={STR.msRunningTitle} empty={STR.msNoActions} onOpen={open} />
        </>
      ) : (
        <>
          <H2>
            {STR.msActions} · {hwSubjectLabel(params.subject ?? "")}
          </H2>
          <ChipRow>
            <Chip label={STR.msFilterOpen} selected={filter === "OPEN"} onPress={() => setFilter("OPEN")} />
            <Chip label={STR.msFilterClosed} selected={filter === "CLOSED"} onPress={() => setFilter("CLOSED")} />
            <Chip label={STR.msFilterAll} selected={filter === "ALL"} onPress={() => setFilter("ALL")} />
          </ChipRow>
          <ActionList key={filter} filter={filter} sectionId={params.sectionId} subject={params.subject} empty={STR.msNoActions} onOpen={open} />
        </>
      )}
    </Screen>
  );
}
