/**
 * ArchiveHomeScreen (AR-1/AR-3, prd-script-archive §8) — the archive hub:
 * search by ctId, the box register (+ create), pending office
 * acknowledgements, open checkouts (overdue badged) and the derived
 * disposable list. Views under the tab's own gate; actions re-gated by
 * `can("roster:manage")` client-side and by the server always.
 */
import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  STORAGE_BOXES_QUERY,
  SCRIPT_BUNDLES_QUERY,
  PENDING_ACKS_QUERY,
  OPEN_CHECKOUTS_QUERY,
  DISPOSABLE_BUNDLES_QUERY,
  CREATE_STORAGE_BOX,
  type ScriptBundleT,
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

function BundleRow({ b, onPress }: { b: ScriptBundleT; onPress: () => void }): React.ReactElement {
  return (
    <Pressable onPress={onPress} style={{ marginTop: space(3) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
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
  );
}

export default function ArchiveHomeScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { can } = useAuth();
  const canManage = can("roster:manage");

  const [search, setSearch] = React.useState("");
  const doSearch = search.trim().length >= 3;

  const [boxesQ, refetchBoxes] = useQuery({ query: STORAGE_BOXES_QUERY, variables: {} });
  const [searchQ, refetchSearch] = useQuery({
    query: SCRIPT_BUNDLES_QUERY,
    variables: { labelQuery: search.trim() },
    pause: !doSearch,
  });
  const [acksQ, refetchAcks] = useQuery({ query: PENDING_ACKS_QUERY });
  const [outQ, refetchOut] = useQuery({ query: OPEN_CHECKOUTS_QUERY });
  const [dispQ, refetchDisp] = useQuery({ query: DISPOSABLE_BUNDLES_QUERY, pause: !canManage });

  const [newLabel, setNewLabel] = React.useState("");
  const [newLocation, setNewLocation] = React.useState("");
  const [note, setNote] = React.useState<{ text: string; bad: boolean } | null>(null);
  const [createRes, createBox] = useMutation(CREATE_STORAGE_BOX);

  async function onCreateBox(): Promise<void> {
    setNote(null);
    const res = await createBox({
      label: newLabel.trim() || null,
      locationNote: newLocation.trim(),
    });
    if (res.error) {
      setNote({ text: friendlyError(res.error), bad: true });
      return;
    }
    setNewLabel("");
    setNewLocation("");
    refetchBoxes({ requestPolicy: "network-only" });
  }

  const boxes = boxesQ.data?.storageBoxes ?? [];
  const found = searchQ.data?.scriptBundles ?? [];
  const acks = acksQ.data?.pendingScriptAcks ?? [];
  const out = outQ.data?.openScriptCheckouts ?? [];
  const disposable = dispQ.data?.disposableScriptBundles ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.arHomeTitle}</Body>
          <Field value={search} onChangeText={setSearch} placeholder={STR.arSearchPlaceholder} />
          {doSearch ? (
            <QueryGate
              result={searchQ}
              onRetry={() => refetchSearch({ requestPolicy: "network-only" })}
              loaderLabel={STR.loading}
            >
              {found.length === 0 ? (
                <Muted style={{ marginTop: space(2) }}>{STR.arNoResults}</Muted>
              ) : (
                found.map((b) => (
                  <BundleRow
                    key={b.id}
                    b={b}
                    onPress={() => nav.navigate("ArchiveBundle", { bundleId: b.id })}
                  />
                ))
              )}
            </QueryGate>
          ) : null}
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.arBoxes}</Body>
          <QueryGate
            result={boxesQ}
            onRetry={() => refetchBoxes({ requestPolicy: "network-only" })}
            loaderLabel={STR.loading}
          >
            {boxes.length === 0 ? (
              <Muted style={{ marginTop: space(2) }}>{STR.arNoBoxes}</Muted>
            ) : (
              boxes.map((box) => (
                <Pressable
                  key={box.id}
                  onPress={() => nav.navigate("ArchiveBox", { boxId: box.id })}
                  style={{ marginTop: space(3) }}
                >
                  <View
                    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <View style={{ flexShrink: 1 }}>
                      <Body style={{ fontWeight: "700" }}>
                        {box.boxCode}
                        {box.label ? ` · ${box.label}` : ""}
                      </Body>
                      <Muted>
                        {box.locationNote} · {bnNum(box.bundleCount)} / {bnNum(box.scriptCount)}
                      </Muted>
                    </View>
                    <Badge
                      text={storageBoxStatusLabel(box.status)}
                      tone={box.status === "ACTIVE" ? "ok" : "muted"}
                    />
                  </View>
                </Pressable>
              ))
            )}
          </QueryGate>
          {canManage ? (
            <View style={{ marginTop: space(3) }}>
              <Body style={{ fontWeight: "700" }}>{STR.arNewBox}</Body>
              <Field value={newLabel} onChangeText={setNewLabel} placeholder={STR.arBoxLabel} />
              <Field value={newLocation} onChangeText={setNewLocation} placeholder={STR.arBoxLocation} />
              {note ? <Notice message={note.text} tone={note.bad ? "danger" : "ok"} /> : null}
              <Button
                title={STR.arCreateBox}
                disabled={createRes.fetching || newLocation.trim() === ""}
                onPress={() => void onCreateBox()}
              />
            </View>
          ) : null}
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.arPendingAcks}</Body>
          <QueryGate
            result={acksQ}
            onRetry={() => refetchAcks({ requestPolicy: "network-only" })}
            loaderLabel={STR.loading}
          >
            {acks.length === 0 ? (
              <Muted style={{ marginTop: space(2) }}>{STR.arNoResults}</Muted>
            ) : (
              acks.map((b) => (
                <BundleRow
                  key={b.id}
                  b={b}
                  onPress={() => nav.navigate("ArchiveBundle", { bundleId: b.id })}
                />
              ))
            )}
          </QueryGate>
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.arOpenCheckouts}</Body>
          <QueryGate
            result={outQ}
            onRetry={() => refetchOut({ requestPolicy: "network-only" })}
            loaderLabel={STR.loading}
          >
            {out.length === 0 ? (
              <Muted style={{ marginTop: space(2) }}>{STR.arNoResults}</Muted>
            ) : (
              out.map((b) => (
                <BundleRow
                  key={b.id}
                  b={b}
                  onPress={() => nav.navigate("ArchiveBundle", { bundleId: b.id })}
                />
              ))
            )}
          </QueryGate>
        </Card>

        {canManage ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.arDisposable}</Body>
            <QueryGate
              result={dispQ}
              onRetry={() => refetchDisp({ requestPolicy: "network-only" })}
              loaderLabel={STR.loading}
            >
              {disposable.length === 0 ? (
                <Muted style={{ marginTop: space(2) }}>{STR.arNoResults}</Muted>
              ) : (
                disposable.map((b) => (
                  <BundleRow
                    key={b.id}
                    b={b}
                    onPress={() => nav.navigate("ArchiveBundle", { bundleId: b.id })}
                  />
                ))
              )}
            </QueryGate>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
