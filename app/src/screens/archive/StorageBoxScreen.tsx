/**
 * StorageBoxScreen (AR-1/AR-3, prd-script-archive §8) — one box: edit its
 * label/location (relocation = this one edit; every bundle follows, D-#445),
 * retire it (no new filings; contents stay findable) and browse its bundles in
 * exam-date order. Edits are `can("roster:manage")`-offered, server-re-gated.
 */
import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  STORAGE_BOX_QUERY,
  UPDATE_STORAGE_BOX,
  RETIRE_STORAGE_BOX,
} from "../../graphql/archive";
import { Screen, Card, Body, Muted, Button, Badge, Field, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import {
  STR,
  bnNum,
  hwSubjectLabel,
  isoDateLabel,
  scriptBundleStatusLabel,
  storageBoxStatusLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ClassTestStackParamList>;
type Route = RouteProp<ClassTestStackParamList, "ArchiveBox">;

export default function StorageBoxScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { boxId } = route.params;
  const { can } = useAuth();
  const canManage = can("roster:manage");

  const [boxQ, refetchBox] = useQuery({ query: STORAGE_BOX_QUERY, variables: { id: boxId } });
  const box = boxQ.data?.storageBox ?? null;
  const bundles = boxQ.data?.storageBoxBundles ?? [];

  const [label, setLabel] = React.useState<string | null>(null);
  const [location, setLocation] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<{ text: string; bad: boolean } | null>(null);
  const [saveRes, saveBox] = useMutation(UPDATE_STORAGE_BOX);
  const [retireRes, retireBox] = useMutation(RETIRE_STORAGE_BOX);

  const shownLabel = label ?? box?.label ?? "";
  const shownLocation = location ?? box?.locationNote ?? "";

  async function onSave(): Promise<void> {
    setNote(null);
    const res = await saveBox({
      id: boxId,
      label: shownLabel.trim() || null,
      locationNote: shownLocation.trim() || null,
    });
    if (res.error) {
      setNote({ text: friendlyError(res.error), bad: true });
      return;
    }
    refetchBox({ requestPolicy: "network-only" });
  }

  async function onRetire(): Promise<void> {
    setNote(null);
    const res = await retireBox({ id: boxId });
    if (res.error) {
      setNote({ text: friendlyError(res.error), bad: true });
      return;
    }
    refetchBox({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <QueryGate
          result={boxQ}
          onRetry={() => refetchBox({ requestPolicy: "network-only" })}
          loaderLabel={STR.loading}
        >
          {!box ? (
            <Muted>{STR.arNoResults}</Muted>
          ) : (
            <>
              <Card>
                <View
                  style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                >
                  <Body style={{ fontWeight: "700" }}>{box.boxCode}</Body>
                  <Badge
                    text={storageBoxStatusLabel(box.status)}
                    tone={box.status === "ACTIVE" ? "ok" : "muted"}
                  />
                </View>
                <Muted style={{ marginTop: space(1) }}>
                  {bnNum(box.bundleCount)} · {bnNum(box.scriptCount)} {STR.arScriptCount}
                </Muted>
                {canManage ? (
                  <View style={{ marginTop: space(2) }}>
                    <Field
                      label={STR.arBoxLabel}
                      value={shownLabel}
                      onChangeText={setLabel}
                      placeholder={STR.arBoxLabel}
                    />
                    <Field
                      label={STR.arBoxLocation}
                      value={shownLocation}
                      onChangeText={setLocation}
                      placeholder={STR.arBoxLocation}
                    />
                    {note ? <Notice message={note.text} tone={note.bad ? "danger" : "ok"} /> : null}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                      <Button
                        title={STR.arSaveBox}
                        disabled={saveRes.fetching || shownLocation.trim() === ""}
                        onPress={() => void onSave()}
                      />
                      {box.status === "ACTIVE" ? (
                        <Button
                          title={STR.arRetireBox}
                          variant="ghost"
                          disabled={retireRes.fetching}
                          onPress={() => void onRetire()}
                        />
                      ) : null}
                    </View>
                  </View>
                ) : (
                  <Muted>{box.label ? `${box.label} · ` : ""}{box.locationNote}</Muted>
                )}
              </Card>

              <Card>
                <Body style={{ fontWeight: "700" }}>{STR.arBoxContents}</Body>
                {bundles.length === 0 ? (
                  <Muted style={{ marginTop: space(2) }}>{STR.arNoResults}</Muted>
                ) : (
                  bundles.map((b) => (
                    <Pressable
                      key={b.id}
                      onPress={() => nav.navigate("ArchiveBundle", { bundleId: b.id })}
                      style={{ marginTop: space(3) }}
                    >
                      <View
                        style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                      >
                        <View style={{ flexShrink: 1 }}>
                          <Body style={{ fontWeight: "700" }}>{b.sourceLabel}</Body>
                          <Muted>
                            {hwSubjectLabel(b.subject)} · {STR.ctTestNumber} {bnNum(b.testNumber)} ·{" "}
                            {isoDateLabel(b.examDate)} · {bnNum(b.scriptCount)}
                          </Muted>
                        </View>
                        <Badge
                          text={b.overdue ? STR.arOverdue : scriptBundleStatusLabel(b.status)}
                          tone={
                            b.overdue
                              ? "danger"
                              : b.status === "FILED"
                                ? "ok"
                                : b.status === "CHECKED_OUT"
                                  ? "warn"
                                  : "muted"
                          }
                        />
                      </View>
                    </Pressable>
                  ))
                )}
              </Card>
            </>
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
