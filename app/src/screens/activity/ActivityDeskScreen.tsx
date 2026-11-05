/**
 * ActivityDeskScreen (AS-2, A10 + A11) — the sheet desk on the office phone or PC.
 *
 * One box takes the copy code (the QR in the sheet's corner: phone camera, a USB scanner
 * typing it + Enter, or typed: AS-000231 / 231). Then, by where the copy is:
 *  - in the tray → a child is taking it: type the school ID (103 = 0103) / a name / roll,
 *    check the name, give it (activity_sheets:issue). A repeat is flagged, never blocked.
 *    In busy time a child may have taken it without a scan — then this is a return: choose
 *    the child and the result.
 *  - with a child → it is coming back: সব ঠিক / কিছু ভুল / অসম্পূর্ণ, from the return box or
 *    not → take it back (activity_sheets:check — the office and class teachers). The desk
 *    says whether to hand a sticker over now.
 */
import React, { useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useClient, useMutation, useQuery } from "urql";
import { ACTIVITY_RESULTS } from "@scd/shared";
import {
  ACTIVITY_CANCEL_TAKE,
  ACTIVITY_COPY_LOST,
  ACTIVITY_DESK_COPY_QUERY,
  ACTIVITY_RETURN,
  ACTIVITY_STUDENTS_QUERY,
  ACTIVITY_TAKE,
  type ActivityDeskCopyT,
  type ActivityStudentT,
} from "../../graphql/activitySheets";
import { Badge, Body, Button, Card, Field, Muted, Notice, Screen } from "../../components/ui";
import { QrScanner, canScanQr } from "../../components/QrScanner";
import { useAuth } from "../../auth/AuthContext";
import { friendlyError } from "../../lib/errors";
import { STR, activityLevelLabel, activityResultLabel, bnNum } from "../../lib/labels";
import { space, typeScale, useColors } from "../../theme";

type Msg = { tone: "ok" | "danger" | "info"; text: string } | null;

function StudentRow({ s, picked, onPick, max }: { s: ActivityStudentT; picked: boolean; onPick: () => void; max?: number }): React.ReactElement {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPick}
      accessibilityRole="button"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space(2),
        padding: space(2),
        borderRadius: 8,
        borderWidth: picked ? 2 : 1,
        borderColor: picked ? colors.primary : colors.border,
        marginBottom: space(2),
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{s.name}</Text>
        <Muted style={{ fontSize: 12 }}>
          {s.classLabelBn}
          {s.sectionNameBn ? ` · ${s.sectionNameBn}` : ""}
          {s.rollNumber ? ` · রোল ${bnNum(s.rollNumber)}` : ""} · আইডি {s.schoolId}
        </Muted>
      </View>
      <Badge text={STR.actDeskOpen.replace("{n}", bnNum(s.openSheets))} tone={max != null && s.openSheets >= max ? "warn" : "ok"} />
    </Pressable>
  );
}

function PickChild({ picked, setPicked }: { picked: ActivityStudentT | null; setPicked: (s: ActivityStudentT) => void }): React.ReactElement {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [hitsQ] = useQuery({ query: ACTIVITY_STUDENTS_QUERY, variables: { search: term }, pause: !term, requestPolicy: "network-only" });
  const hits = term ? hitsQ.data?.activityStudents ?? [] : [];
  return (
    <View>
      <Field label={STR.actDeskWho} value={search} onChangeText={setSearch} onSubmitEditing={() => setTerm(search.trim())} returnKeyType="search" />
      <Button title={STR.actDeskFind} variant="secondary" onPress={() => setTerm(search.trim())} style={{ marginBottom: space(2) }} />
      {term && !hitsQ.fetching && hits.length === 0 ? <Muted>{STR.actDeskNoMatch}</Muted> : null}
      {hits.map((s) => (
        <StudentRow key={s.id} s={s} picked={picked?.id === s.id} onPick={() => setPicked(s)} />
      ))}
    </View>
  );
}

function ResultPick({ value, onChange }: { value: string; onChange: (v: string) => void }): React.ReactElement {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", gap: space(2), marginBottom: space(2) }}>
      {ACTIVITY_RESULTS.map((r) => (
        <Pressable
          key={r}
          onPress={() => onChange(r)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === r }}
          style={{ flex: 1, padding: space(2), borderRadius: 8, alignItems: "center", borderWidth: value === r ? 2 : 1, borderColor: value === r ? colors.primary : colors.border }}
        >
          <Text style={{ ...typeScale.bodyStrong, color: value === r ? colors.primary : colors.textPrimary }}>{activityResultLabel(r)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ReturnPanel({ copy, unscanned, onDone }: { copy: ActivityDeskCopyT; unscanned: boolean; onDone: (m: Msg) => void }): React.ReactElement {
  const [result, setResult] = useState<string>("ALL_CORRECT");
  const [viaBox, setViaBox] = useState(false);
  const [child, setChild] = useState<ActivityStudentT | null>(null);
  const [{ fetching }, ret] = useMutation(ACTIVITY_RETURN);
  const who = copy.holder ?? child;
  const back = async (): Promise<void> => {
    const res = await ret({ code: copy.code, result, viaBox, studentId: unscanned ? child?.id ?? null : null });
    if (res.error) return onDone({ tone: "danger", text: friendlyError(res.error) });
    const r = res.data!.activityReturn;
    onDone({
      tone: "ok",
      text: r.stickerGiven ? STR.actDeskBackSticker.replace("{name}", who?.name ?? "") : r.stickerOwed ? STR.actDeskBackOwed : STR.actDeskBack,
    });
  };
  return (
    <View>
      {unscanned ? (
        <>
          <Notice tone="info" message={STR.actDeskUnscanned} />
          <PickChild picked={child} setPicked={setChild} />
        </>
      ) : (
        <Body style={{ marginBottom: space(2) }}>{STR.actDeskWith.replace("{name}", copy.holder?.name ?? "—").replace("{cls}", copy.holder?.classLabelBn ?? "")}</Body>
      )}
      <Muted>{STR.actDeskHowDone}</Muted>
      <ResultPick value={result} onChange={setResult} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginBottom: space(3) }}>
        <Switch value={viaBox} onValueChange={setViaBox} />
        <Muted style={{ flex: 1 }}>{STR.actDeskViaBox}</Muted>
      </View>
      <Button title={STR.actDeskTakeBack} loading={fetching} disabled={unscanned && !child} onPress={() => void back()} />
    </View>
  );
}

function TakePanel({ copy, onDone }: { copy: ActivityDeskCopyT; onDone: (m: Msg) => void }): React.ReactElement {
  const [child, setChild] = useState<ActivityStudentT | null>(null);
  const [{ fetching }, take] = useMutation(ACTIVITY_TAKE);
  const give = async (): Promise<void> => {
    if (!child) return;
    const res = await take({ code: copy.code, studentId: child.id });
    if (res.error) return onDone({ tone: "danger", text: friendlyError(res.error) });
    const text = STR.actDeskGiven.replace("{item}", copy.itemId).replace("{name}", child.name);
    onDone({ tone: "ok", text: res.data!.activityTake.repeat ? `${text} · ${STR.actDeskRepeat}` : text });
  };
  return (
    <View>
      <Muted style={{ marginBottom: space(2) }}>{STR.actDeskInTray}</Muted>
      <PickChild picked={child} setPicked={setChild} />
      {child ? <Button title={STR.actDeskGive.replace("{name}", child.name)} loading={fetching} onPress={() => void give()} /> : null}
    </View>
  );
}

export default function ActivityDeskScreen(): React.ReactElement {
  const client = useClient();
  const { can } = useAuth();
  const canIssue = can("activity_sheets:issue");
  const canCheck = can("activity_sheets:check");
  const canManage = can("activity_sheets:manage");
  const [code, setCode] = useState("");
  const [copy, setCopy] = useState<ActivityDeskCopyT | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [mode, setMode] = useState<"take" | "unscanned">("take");
  const [, cancel] = useMutation(ACTIVITY_CANCEL_TAKE);
  const [, lost] = useMutation(ACTIVITY_COPY_LOST);

  const find = async (raw = code): Promise<void> => {
    if (!raw.trim()) return;
    setBusy(true);
    const res = await client.query(ACTIVITY_DESK_COPY_QUERY, { code: raw }, { requestPolicy: "network-only" }).toPromise();
    setBusy(false);
    if (res.error) {
      setCopy(null);
      setMsg({ tone: "danger", text: friendlyError(res.error) });
      return;
    }
    setMsg(null);
    setMode("take");
    setCopy(res.data?.activityDeskCopy ?? null);
  };

  const finish = (m: Msg): void => {
    setMsg(m);
    if (m?.tone !== "danger") {
      setCopy(null);
      setCode("");
    }
  };

  const out = copy && copy.status === "TAKEN";
  const inTray = copy && copy.status === "IN_TRAY";

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4), gap: space(3) }} keyboardShouldPersistTaps="handled">
        <Notice tone="info" message={STR.actDeskHint} />
        {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
        <Card>
          <Field label={STR.actDeskCode} value={code} onChangeText={setCode} placeholder="AS-000231" autoCapitalize="characters" onSubmitEditing={() => void find()} returnKeyType="search" />
          <Button title={STR.actDeskFind} loading={busy} onPress={() => void find()} />
          {canScanQr && !scanning ? <Button title={STR.qrScan} variant="secondary" onPress={() => setScanning(true)} style={{ marginTop: space(2) }} /> : null}
          {scanning ? (
            <View style={{ marginTop: space(2) }}>
              <QrScanner
                onCode={(scanned) => {
                  setScanning(false);
                  setCode(scanned);
                  void find(scanned);
                }}
                onClose={() => setScanning(false)}
              />
            </View>
          ) : null}
        </Card>
        {copy ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>
              {copy.bankNameBn} · {activityLevelLabel(copy.level)}
            </Body>
            <Muted style={{ marginBottom: space(3) }}>
              {copy.itemId} · {copy.code}
              {copy.details ? ` · ${copy.details}` : ""}
            </Muted>
            {copy.status === "RETURNED" ? <Notice tone="info" message={STR.actDeskReturned} /> : null}
            {copy.status === "LOST" ? <Notice tone="danger" message={STR.actDeskIsLost} /> : null}
            {out && canCheck ? <ReturnPanel copy={copy} unscanned={false} onDone={finish} /> : null}
            {inTray ? (
              <View>
                {canCheck && copy.kind === "STOCK" ? (
                  <View style={{ flexDirection: "row", gap: space(2), marginBottom: space(3) }}>
                    {canIssue ? <Button title={STR.actDeskInTray} variant={mode === "take" ? "secondary" : "ghost"} onPress={() => setMode("take")} /> : null}
                    <Button title={STR.actDeskUnscanned} variant={mode === "unscanned" ? "secondary" : "ghost"} onPress={() => setMode("unscanned")} />
                  </View>
                ) : null}
                {mode === "take" && canIssue ? <TakePanel copy={copy} onDone={finish} /> : null}
                {mode === "take" && !canIssue ? <Muted>{STR.actDeskTakeOnlyOffice}</Muted> : null}
                {mode === "unscanned" && canCheck ? <ReturnPanel copy={copy} unscanned onDone={finish} /> : null}
              </View>
            ) : null}
            {out && copy.issue?.path === "TRAY" && canIssue ? (
              <Button
                title={STR.actDeskCancel}
                variant="ghost"
                onPress={() => void cancel({ code: copy.code }).then((r) => finish(r.error ? { tone: "danger", text: friendlyError(r.error) } : { tone: "ok", text: STR.actDeskCancelled }))}
                style={{ marginTop: space(2) }}
              />
            ) : null}
            {canManage && (out || inTray) ? (
              <Button
                title={STR.actDeskLost}
                variant="ghost"
                onPress={() => void lost({ code: copy.code }).then((r) => finish(r.error ? { tone: "danger", text: friendlyError(r.error) } : { tone: "ok", text: STR.actDeskLostDone }))}
              />
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
