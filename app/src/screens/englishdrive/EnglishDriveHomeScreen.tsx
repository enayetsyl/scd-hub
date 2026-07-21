/**
 * EnglishDriveHomeScreen (D-#344, ED-1) — the class-scoped English Drive
 * library: class picker (a teacher sees only their English classes, P/O all
 * five), blocks as collapsible groups (one open at a time — the checking-queue
 * accordion look), kind-labelled rows tapping into the doc screen. The upload
 * entry lives here, gated to Principal/Office (roster:manage).
 */
import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "urql";
import { roleHasPermission } from "@scd/shared";
import {
  ENGLISH_DRIVE_DOCS,
  ENGLISH_DRIVE_MY_CLASS_LEVELS,
  type EnglishDriveDocT,
} from "../../graphql/englishDrive";
import type { EnglishDriveStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Select, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { englishDriveKindLabel } from "../../lib/englishDrive";
import { STR, bnNum, classLevelLabel } from "../../lib/labels";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<EnglishDriveStackParamList, "EnglishDriveHome">;

export default function EnglishDriveHomeScreen({ navigation }: Props): React.ReactElement {
  const { role } = useAuth();
  const canUpload = !!role && roleHasPermission(role, "roster:manage");

  const [levelsQ, refetchLevels] = useQuery({ query: ENGLISH_DRIVE_MY_CLASS_LEVELS });
  const levels = useMemo(
    () => levelsQ.data?.englishDriveMyClassLevels ?? [],
    [levelsQ.data?.englishDriveMyClassLevels],
  );

  const [classLevel, setClassLevel] = useState<number | null>(null);
  // Auto-select the caller's first class once the levels arrive.
  React.useEffect(() => {
    if (classLevel === null && levels.length > 0) setClassLevel(levels[0]);
  }, [levels, classLevel]);

  const [docsQ, refetchDocs] = useQuery({
    query: ENGLISH_DRIVE_DOCS,
    variables: { classLevel },
    pause: classLevel === null,
  });
  const docs = docsQ.data?.englishDriveDocs ?? [];

  // Blocks as collapsible groups — exactly one open (the first by default).
  // Block-less docs (assignments, D-#346) get their own group, listed last (-1 key).
  const blocks = useMemo(() => {
    const byBlock = new Map<number, EnglishDriveDocT[]>();
    for (const d of docs) {
      const key = d.blockNumber ?? -1;
      const list = byBlock.get(key) ?? [];
      list.push(d);
      byBlock.set(key, list);
    }
    const pos = (k: number): number => (k === -1 ? Number.POSITIVE_INFINITY : k);
    return [...byBlock.entries()].sort((a, b) => pos(a[0]) - pos(b[0]));
  }, [docs]);
  const [openBlock, setOpenBlock] = useState<number | null>(null);
  const effectiveOpen = openBlock ?? (blocks.length > 0 ? blocks[0][0] : null);

  const retry = (): void => {
    refetchLevels({ requestPolicy: "network-only" });
    refetchDocs({ requestPolicy: "network-only" });
  };
  const { refreshing, onRefresh } = usePullRefresh(levelsQ.fetching || docsQ.fetching, retry);

  // A fresh upload should show up when the user comes back from the upload screen.
  useFocusEffect(
    React.useCallback(() => {
      if (classLevel !== null) refetchDocs({ requestPolicy: "network-only" });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [classLevel]),
  );

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {canUpload ? (
          <View style={{ marginBottom: space(2) }}>
            <Button
              title={`⬆ ${STR.edUploadTitle}`}
              variant="secondary"
              onPress={() => navigation.navigate("EnglishDriveUpload")}
            />
          </View>
        ) : null}

        <QueryGate
          results={classLevel === null ? [levelsQ] : [levelsQ, docsQ]}
          onRetry={retry}
          isEmpty={!levelsQ.fetching && levels.length === 0}
          empty={<EmptyState message={STR.edNoAccess} />}
          loaderLabel={STR.loading}
        >
          {levels.length > 1 ? (
            <Select
              label={STR.class}
              value={classLevel === null ? null : String(classLevel)}
              options={levels.map((l) => ({ label: classLevelLabel(l), value: String(l) }))}
              onChange={(v) => {
                setClassLevel(Number(v));
                setOpenBlock(null);
              }}
            />
          ) : levels.length === 1 ? (
            <Muted style={{ marginBottom: space(2) }}>{classLevelLabel(levels[0])}</Muted>
          ) : null}

          {docs.length === 0 && !docsQ.fetching ? (
            <EmptyState message={STR.edNoDocs} />
          ) : (
            blocks.map(([blockNumber, rows]) => {
              const isOpen = effectiveOpen === blockNumber;
              return (
                <Card key={blockNumber}>
                  <Pressable
                    onPress={() => setOpenBlock(isOpen ? -1 : blockNumber)}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                  >
                    <Body style={{ fontWeight: "700" }}>
                      {isOpen ? "▾" : "▸"}{" "}
                      {blockNumber === -1 ? STR.edNoBlock : `${STR.edBlock} ${bnNum(blockNumber)}`}
                    </Body>
                    <Muted>({bnNum(rows.length)})</Muted>
                  </Pressable>
                  {isOpen
                    ? (() => {
                        // Number the rows only when a block holds several of one
                        // kind (HW ১…HW ৪) — single docs keep the plain label.
                        const kindTotals = new Map<string, number>();
                        for (const r of rows) {
                          kindTotals.set(r.kind, (kindTotals.get(r.kind) ?? 0) + 1);
                        }
                        return rows.map((r) => (
                          <Pressable
                            key={r.id}
                            onPress={() =>
                              navigation.navigate("EnglishDriveDoc", { docId: r.id, title: r.title })
                            }
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                              paddingVertical: space(2),
                            }}
                          >
                            <View style={{ flex: 1, marginRight: space(2) }}>
                              <Body style={{ fontWeight: "600" }}>
                                {englishDriveKindLabel(r.kind)}
                                {(kindTotals.get(r.kind) ?? 1) > 1 ? ` ${bnNum(r.seq)}` : ""}
                              </Body>
                              <Muted>{r.title}</Muted>
                            </View>
                            <Badge text={`v${bnNum(r.version)}`} tone="muted" />
                          </Pressable>
                        ));
                      })()
                    : null}
                </Card>
              );
            })
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
