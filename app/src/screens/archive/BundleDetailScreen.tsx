/**
 * BundleDetailScreen (AR-2/AR-3, prd-script-archive §8) — one bundle: the
 * cover-sheet facts, box + location, the append-only checkout log, and the desk
 * actions. Every action is `can("roster:manage")`-offered and server-re-gated:
 * acknowledge (once), check out (borrower + purpose), check in (note +
 * optional re-box), dispose (reason; outside retention only), void (reason).
 * The cover-sheet PDF (AR-4) opens web-only.
 */
import React from "react";
import { Platform, ScrollView, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useMutation, useQuery } from "urql";
import {
  SCRIPT_BUNDLE_QUERY,
  STORAGE_BOXES_QUERY,
  ACKNOWLEDGE_SCRIPT_BUNDLE,
  CHECK_OUT_SCRIPT_BUNDLE,
  CHECK_IN_SCRIPT_BUNDLE,
  DISPOSE_SCRIPT_BUNDLE,
  VOID_SCRIPT_BUNDLE,
} from "../../graphql/archive";
import { TEACHERS_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge, Field, Select, Notice, Divider } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import {
  STR,
  bnNum,
  hwSubjectLabel,
  isoDateLabel,
  isoDateTimeLabel,
  scriptBundleStatusLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openStoredFile, openArchiveCoverPdf, FileUploadError, FILE_VIEW_SUPPORTED } from "../../lib/files";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Route = RouteProp<ClassTestStackParamList, "ArchiveBundle">;

export default function BundleDetailScreen(): React.ReactElement {
  const route = useRoute<Route>();
  const { bundleId } = route.params;
  const { can } = useAuth();
  const canManage = can("roster:manage");

  const [bundleQ, refetchBundle] = useQuery({
    query: SCRIPT_BUNDLE_QUERY,
    variables: { id: bundleId },
  });
  const [boxesQ] = useQuery({
    query: STORAGE_BOXES_QUERY,
    variables: { status: "ACTIVE" },
    pause: !canManage,
  });
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY, pause: !canManage });

  const b = bundleQ.data?.scriptBundle ?? null;
  const boxes = boxesQ.data?.storageBoxes ?? [];
  const teachers = teachersQ.data?.teachers ?? [];
  const box = boxes.find((x) => x.id === b?.boxId) ?? null;

  const [note, setNote] = React.useState<{ text: string; bad: boolean } | null>(null);
  const [toUserId, setToUserId] = React.useState<string | null>(null);
  const [purpose, setPurpose] = React.useState("");
  const [expectedReturn, setExpectedReturn] = React.useState("");
  const [returnNote, setReturnNote] = React.useState("");
  const [reboxId, setReboxId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");

  const [ackRes, ack] = useMutation(ACKNOWLEDGE_SCRIPT_BUNDLE);
  const [outRes, checkOut] = useMutation(CHECK_OUT_SCRIPT_BUNDLE);
  const [inRes, checkIn] = useMutation(CHECK_IN_SCRIPT_BUNDLE);
  const [dispRes, dispose] = useMutation(DISPOSE_SCRIPT_BUNDLE);
  const [voidRes, voidBundle] = useMutation(VOID_SCRIPT_BUNDLE);
  const busy = ackRes.fetching || outRes.fetching || inRes.fetching || dispRes.fetching || voidRes.fetching;

  function refetch(): void {
    refetchBundle({ requestPolicy: "network-only" });
  }

  async function run(p: Promise<{ error?: unknown }>): Promise<void> {
    setNote(null);
    const res = await p;
    if (res.error) {
      setNote({ text: friendlyError(res.error as Parameters<typeof friendlyError>[0]), bad: true });
      return;
    }
    setPurpose("");
    setExpectedReturn("");
    setReturnNote("");
    setReason("");
    setReboxId(null);
    refetch();
  }

  async function onOpen(action: () => Promise<void>): Promise<void> {
    setNote(null);
    try {
      await action();
    } catch (e) {
      setNote({ text: e instanceof FileUploadError ? e.message : String(e), bad: true });
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <QueryGate result={bundleQ} onRetry={refetch} loaderLabel={STR.loading}>
          {!b ? (
            <Muted>{STR.arNoResults}</Muted>
          ) : (
            <>
              <Card>
                <View
                  style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                >
                  <Body style={{ fontWeight: "700" }}>{b.sourceLabel}</Body>
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
                <Muted style={{ marginTop: space(1) }}>
                  {hwSubjectLabel(b.subject)} · {STR.ctTestNumber} {bnNum(b.testNumber)} ·{" "}
                  {STR.arExamDate} {isoDateLabel(b.examDate)}
                </Muted>
                <Muted>
                  {STR.arScriptCount}: {bnNum(b.scriptCount)}
                </Muted>
                <Muted>
                  {STR.arFiledBy}: {b.filedByName ?? "—"} · {isoDateLabel(b.filedAt)}
                  {b.acknowledgedAt ? ` · ${STR.arAcknowledge} ✓` : ""}
                </Muted>
                {box ? (
                  <Muted>
                    {STR.arBox}: {box.boxCode} · {box.locationNote}
                  </Muted>
                ) : null}
                {b.notes ? <Muted>{b.notes}</Muted> : null}
                {b.disposeReason ? (
                  <Muted>
                    {STR.arDispose}: {b.disposeReason} · {isoDateLabel(b.disposedAt)}
                  </Muted>
                ) : null}
                {b.voidReason ? (
                  <Muted>
                    {STR.arVoid}: {b.voidReason} · {isoDateLabel(b.voidedAt)}
                  </Muted>
                ) : null}
                {FILE_VIEW_SUPPORTED && Platform.OS === "web" ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                    <Button
                      title={STR.arCoverPdf}
                      variant="secondary"
                      onPress={() => void onOpen(() => openArchiveCoverPdf(b.id))}
                    />
                    {b.attachmentFileIds.map((fid, i) => (
                      <Button
                        key={fid}
                        title={`📷 ${bnNum(i + 1)}`}
                        variant="ghost"
                        onPress={() => void onOpen(() => openStoredFile(fid))}
                      />
                    ))}
                  </View>
                ) : null}
              </Card>

              <Card>
                <Body style={{ fontWeight: "700" }}>{STR.arCheckoutLog}</Body>
                {b.checkouts.length === 0 ? (
                  <Muted style={{ marginTop: space(2) }}>{STR.arNoResults}</Muted>
                ) : (
                  b.checkouts.map((c, i) => (
                    <View key={`${c.checkedOutAt}-${i}`} style={{ marginTop: space(2) }}>
                      <Body>
                        {c.toUserName ?? c.toUserId} — {c.purpose}
                      </Body>
                      <Muted>
                        {isoDateTimeLabel(c.checkedOutAt)}
                        {c.expectedReturnDateKey ? ` → ${c.expectedReturnDateKey}` : ""}
                        {c.returnedAt
                          ? ` · ${STR.arCheckIn}: ${isoDateTimeLabel(c.returnedAt)}${c.returnNote ? ` (${c.returnNote})` : ""}`
                          : ""}
                      </Muted>
                    </View>
                  ))
                )}
              </Card>

              {canManage && (b.status === "FILED" || b.status === "CHECKED_OUT") ? (
                <Card>
                  {note ? <Notice message={note.text} tone={note.bad ? "danger" : "ok"} /> : null}
                  {!b.acknowledgedAt ? (
                    <Button
                      title={STR.arAcknowledge}
                      disabled={busy}
                      onPress={() => void run(ack({ id: b.id }))}
                    />
                  ) : null}
                  {b.status === "FILED" ? (
                    <View style={{ marginTop: space(2) }}>
                      <Body style={{ fontWeight: "700" }}>{STR.arCheckOut}</Body>
                      <Select
                        label={STR.arCheckOutTo}
                        value={toUserId}
                        searchable
                        options={teachers.map((t) => ({ value: t.id, label: t.name }))}
                        onChange={setToUserId}
                        placeholder={STR.arCheckOutTo}
                      />
                      <Field label={STR.arPurpose} value={purpose} onChangeText={setPurpose} />
                      <Field
                        label={STR.arExpectedReturn}
                        value={expectedReturn}
                        onChangeText={setExpectedReturn}
                        placeholder="2026-08-15"
                      />
                      <Button
                        title={STR.arCheckOut}
                        disabled={busy || !toUserId || purpose.trim() === ""}
                        onPress={() =>
                          void run(
                            checkOut({
                              id: b.id,
                              toUserId: toUserId as string,
                              purpose: purpose.trim(),
                              expectedReturnDateKey: expectedReturn.trim() || null,
                            }),
                          )
                        }
                      />
                      <Divider />
                      <Body style={{ fontWeight: "700" }}>{STR.arDispose} / {STR.arVoid}</Body>
                      <Field label={STR.arReason} value={reason} onChangeText={setReason} />
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                        <Button
                          title={STR.arDispose}
                          variant="secondary"
                          disabled={busy || reason.trim() === ""}
                          onPress={() => void run(dispose({ id: b.id, reason: reason.trim() }))}
                        />
                        <Button
                          title={STR.arVoid}
                          variant="ghost"
                          disabled={busy || reason.trim() === ""}
                          onPress={() => void run(voidBundle({ id: b.id, reason: reason.trim() }))}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={{ marginTop: space(2) }}>
                      <Body style={{ fontWeight: "700" }}>{STR.arCheckIn}</Body>
                      <Field label={STR.arReturnNote} value={returnNote} onChangeText={setReturnNote} />
                      <Select
                        label={STR.arPickBox}
                        value={reboxId}
                        options={boxes.map((x) => ({
                          value: x.id,
                          label: `${x.boxCode}${x.label ? ` · ${x.label}` : ""}`,
                          hint: x.locationNote,
                        }))}
                        onChange={setReboxId}
                        placeholder={box ? `${box.boxCode} (${STR.arBox})` : STR.arPickBox}
                        helper={STR.arNotes}
                      />
                      <Button
                        title={STR.arCheckIn}
                        disabled={busy}
                        onPress={() =>
                          void run(
                            checkIn({
                              id: b.id,
                              note: returnNote.trim() || null,
                              boxId: reboxId,
                            }),
                          )
                        }
                      />
                    </View>
                  )}
                </Card>
              ) : null}
            </>
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
