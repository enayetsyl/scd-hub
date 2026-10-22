/**
 * MasteryWorkHomeScreen (M-2, mock T1/T3 entry) — pick a শাখা and subject, see its work
 * sheets (newest first, paged — D-#761), open one to enter marks, or start a new one.
 *
 * Param-free: the drawer leaf reaches it with no params. The server refuses a section ×
 * subject the routine does not give the caller (unless they hold mastery:edit_all), so the
 * list is the caller's own classes from useAccessibleClasses.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MASTERY_SUBJECTS } from "@scd/shared";
import { MASTERY_PAPERS_PAGE_QUERY, type MasteryPaperRow } from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Loader, EmptyState, Notice } from "../../components/ui";
import { useAccessibleClasses } from "../../components/ClassSectionDashboard";
import { STR, bnNum, classLevelLabel, hwSubjectLabel, masterySourceLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryWork">;

const sourceLabel = masterySourceLabel;

export default function MasteryWorkHomeScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const canCreate = can("mastery:create");
  const { myClasses, fetching: classesFetching } = useAccessibleClasses({ viewAll: "mastery:edit_all" });
  const sections = useMemo(
    () =>
      myClasses.flatMap((c) =>
        c.sections.map((s) => ({ id: s.id, level: c.cls.level, label: `${classLevelLabel(c.cls.level)} · ${s.nameBn}` })),
      ),
    [myClasses],
  );
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [subject, setSubject] = useState<string>("MATH");
  const [page, setPage] = useState(1);
  const active = sectionId ?? sections[0]?.id ?? null;
  const activeLevel = sections.find((s) => s.id === active)?.level ?? null;

  const [{ data, fetching, error }] = useQuery({
    query: MASTERY_PAPERS_PAGE_QUERY,
    variables: { sectionId: active ?? "", subject, page, pageSize: 20 },
    pause: !active,
    requestPolicy: "cache-and-network",
  });
  const pg = data?.masteryPapersPage as { rows: MasteryPaperRow[]; total: number; page: number; pageSize: number } | undefined;
  const rows = pg?.rows ?? [];
  const pages = pg ? Math.max(1, Math.ceil(pg.total / pg.pageSize)) : 1;

  if (classesFetching) {
    return (
      <Screen>
        <Loader />
      </Screen>
    );
  }
  if (sections.length === 0) {
    return (
      <Screen>
        <EmptyState message={STR.msNoReach} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Muted>{STR.msPickSection}</Muted>
      <ChipRow>
        {sections.map((s) => (
          <Chip key={s.id} label={s.label} selected={s.id === active} onPress={() => { setSectionId(s.id); setPage(1); }} />
        ))}
      </ChipRow>
      <ChipRow>
        {MASTERY_SUBJECTS.map((s) => (
          <Chip key={s} label={hwSubjectLabel(s)} selected={s === subject} onPress={() => { setSubject(s); setPage(1); }} />
        ))}
      </ChipRow>

      {active ? (
        <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
          <Button title={STR.msHeatmap} variant="secondary" onPress={() => navigation.navigate("MasteryHeatmap", { sectionId: active, subject })} />
          <Button title={STR.msQuality} variant="secondary" onPress={() => navigation.navigate("MasteryQuality", { sectionId: active, subject })} />
          <Button title={STR.msAssignment} variant="secondary" onPress={() => navigation.navigate("MasteryAssignment", { sectionId: active, subject })} />
        </View>
      ) : null}

      {canCreate && active && activeLevel !== null ? (
        <Button
          title={STR.msNewSheet}
          onPress={() => navigation.navigate("MasteryNewPaper", { sectionId: active, subject, classLevel: activeLevel })}
        />
      ) : null}

      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {fetching && rows.length === 0 ? <Loader /> : null}
      {!fetching && !error && rows.length === 0 ? <EmptyState message={STR.msNoSheets} /> : null}

      {rows.map((p) => (
        <Card key={p.paperId}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
            <Body style={{ fontWeight: "700", flexShrink: 1 }}>
              {sourceLabel(p.source)} · {p.date}
              {p.title ? ` · ${p.title}` : ""}
            </Body>
            <Badge text={p.entryState === "CONFIRMED" ? STR.msConfirmed : STR.msOpen} tone={p.entryState === "CONFIRMED" ? "ok" : "gold"} />
          </View>
          <Muted>
            {p.paperId} · {p.source === "RUBRIC" ? `${STR.msRubricLos}: ${bnNum(p.rubricLoCodes.length)}` : `${STR.msItems}: ${bnNum(p.items.length)} · ${bnNum(p.totalMarks)}`}
          </Muted>
          <Button title={STR.msEntry} variant="secondary" onPress={() => navigation.navigate("MasteryEntry", { paperId: p.paperId })} />
        </Card>
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
    </Screen>
  );
}
