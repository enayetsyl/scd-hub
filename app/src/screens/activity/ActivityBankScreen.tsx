/**
 * ActivityBankScreen (AS-1, A7) — one bank: levels with the classes each suits, sample pages,
 * the sheet list. Office (activity_sheets:manage) also: publish / back to draft / retire,
 * rename + skill area, edit level → classes, add sheets (a PDF of new pages → the next ids),
 * replace one sheet's page, retire / restore a sheet, add or change the bank's PDFs.
 */
import React, { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ACTIVITY_LEVELS, ACTIVITY_SKILL_AREAS, ROSTER_CLASS_LEVELS } from "@scd/shared";
import {
  ACTIVITY_BANK_QUERY,
  SET_ACTIVITY_SHEET_ACTIVE,
  UPDATE_ACTIVITY_BANK,
  type ActivityBankLevelT,
  type ActivityBankT,
  type ActivitySheetT,
} from "../../graphql/activitySheets";
import { Badge, Body, Button, Card, Chip, ChipRow, Field, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { friendlyError } from "../../lib/errors";
import { pickActivityFile, uploadActivityForm, type PickedAsset } from "../../lib/files";
import { STR, activityLevelLabel, activitySkillLabel, bnNum, classLevelLabel } from "../../lib/labels";
import type { ActivityStackParamList } from "../../navigation/types";
import { space, typeScale, useColors } from "../../theme";
import { ActivityImage } from "./ActivityImage";
import { bankStatusBadge, sheetTotal } from "./ActivityBanksScreen";

type Props = NativeStackScreenProps<ActivityStackParamList, "ActivityBank">;
type Msg = { tone: "ok" | "danger"; text: string } | null;

const SHEETS_PAGE = 30;

function LevelCard({ bank, level, manage, onDone }: { bank: ActivityBankT; level: ActivityBankLevelT; manage: boolean; onDone: (m: Msg) => void }): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<number[]>(level.classLevels);
  const [{ fetching }, update] = useMutation(UPDATE_ACTIVITY_BANK);
  const save = async (): Promise<void> => {
    const r = await update({ bankId: bank.id, [`classes${level.level}`]: picked });
    if (r.error) return onDone({ tone: "danger", text: friendlyError(r.error) });
    setEditing(false);
    onDone({ tone: "ok", text: STR.actSaved });
  };
  return (
    <Card style={{ marginBottom: space(3) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
        <Text style={{ ...typeScale.bodyStrong, flex: 1 }}>
          {activityLevelLabel(level.level)} · {STR.actSheetsCount.replace("{n}", bnNum(level.sheetCount))}
        </Text>
        {manage ? <Button title={editing ? STR.actCancel : STR.actEdit} variant="ghost" onPress={() => setEditing((e) => !e)} /> : null}
      </View>
      <Muted style={{ marginBottom: space(2) }}>
        {STR.actLevelClasses}: {level.classLevels.map((c) => classLevelLabel(c)).join(", ") || "—"}
        {level.classText ? ` (${level.classText})` : ""}
      </Muted>
      {editing ? (
        <View>
          <ChipRow>
            {ROSTER_CLASS_LEVELS.map((c) => (
              <Chip key={c} label={classLevelLabel(c)} selected={picked.includes(c)} onPress={() => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))} />
            ))}
          </ChipRow>
          <Button title={STR.actSaveClasses} loading={fetching} onPress={() => void save()} />
        </View>
      ) : null}
      {level.sampleFileIds.length > 0 ? (
        <View style={{ flexDirection: "row", gap: space(2) }}>
          {level.sampleFileIds.map((f) => (
            <View key={f} style={{ flex: 1, maxWidth: 220 }}>
              <ActivityImage fileId={f} />
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function BankEdit({ bank, onDone }: { bank: ActivityBankT; onDone: (m: Msg) => void }): React.ReactElement {
  const [nameBn, setNameBn] = useState(bank.nameBn);
  const [nameEn, setNameEn] = useState(bank.nameEn ?? "");
  const [skill, setSkill] = useState(bank.skillArea);
  const [{ fetching }, update] = useMutation(UPDATE_ACTIVITY_BANK);
  return (
    <Card style={{ marginBottom: space(3) }}>
      <Field label={STR.actNameBn} value={nameBn} onChangeText={setNameBn} autoCapitalize="sentences" />
      <Field label={STR.actNameEn} value={nameEn} onChangeText={setNameEn} autoCapitalize="words" />
      <Muted>{STR.actSkill}</Muted>
      <ChipRow>
        {ACTIVITY_SKILL_AREAS.map((s) => (
          <Chip key={s} label={activitySkillLabel(s)} selected={skill === s} onPress={() => setSkill(s)} />
        ))}
      </ChipRow>
      <Button
        title={STR.actSave}
        loading={fetching}
        onPress={() =>
          void update({ bankId: bank.id, nameBn, nameEn, skillArea: skill }).then((r) =>
            onDone(r.error ? { tone: "danger", text: friendlyError(r.error) } : { tone: "ok", text: STR.actSaved }),
          )
        }
      />
    </Card>
  );
}

function AddSheets({ bank, onDone }: { bank: ActivityBankT; onDone: (m: Msg) => void }): React.ReactElement {
  const [pdf, setPdf] = useState<PickedAsset | null>(null);
  const [level, setLevel] = useState<string>("E");
  const [perPage, setPerPage] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (): Promise<void> => {
    if (!pdf) return;
    setBusy(true);
    try {
      const r = await uploadActivityForm<{ added: number; itemIds: string[] }>("activity-sheets", { bankId: bank.id, levels: perPage.trim() || level }, { file: pdf });
      onDone({ tone: "ok", text: STR.actAdded.replace("{n}", bnNum(r.added)).replace("{ids}", r.itemIds.join(", ")) });
      setPdf(null);
      setPerPage("");
    } catch (e) {
      onDone({ tone: "danger", text: String((e as Error).message ?? e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ marginBottom: space(3) }}>
      <Button title={STR.actPickSheets} variant="secondary" onPress={() => void pickActivityFile("pdf").then((a) => a && setPdf(a))} />
      {pdf ? <Muted style={{ fontSize: 12, marginTop: space(1) }}>{STR.actPicked.replace("{name}", pdf.name)}</Muted> : null}
      <Muted style={{ marginTop: space(2) }}>{STR.actAddLevel}</Muted>
      <ChipRow>
        {ACTIVITY_LEVELS.map((l) => (
          <Chip key={l} label={activityLevelLabel(l)} selected={level === l && !perPage.trim()} onPress={() => setLevel(l)} />
        ))}
      </ChipRow>
      <Field label={STR.actAddPerPage} value={perPage} onChangeText={(t) => setPerPage(t.toUpperCase())} autoCapitalize="characters" />
      {busy ? <Muted style={{ marginBottom: space(2) }}>{STR.actUploading}</Muted> : null}
      <Button title={STR.actUpload} loading={busy} disabled={!pdf} onPress={() => void send()} />
    </Card>
  );
}

function AttachPdfs({ bank, onDone }: { bank: ActivityBankT; onDone: (m: Msg) => void }): React.ReactElement {
  const [sheets, setSheets] = useState<PickedAsset | null>(null);
  const [answers, setAnswers] = useState<PickedAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (): Promise<void> => {
    setBusy(true);
    try {
      await uploadActivityForm("activity-bank", { bankId: bank.id }, { sheets, answers });
      onDone({ tone: "ok", text: STR.actSaved });
      setSheets(null);
      setAnswers(null);
    } catch (e) {
      onDone({ tone: "danger", text: String((e as Error).message ?? e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ marginBottom: space(3) }}>
      {bank.withoutPages > 0 ? (
        <View style={{ marginBottom: space(2) }}>
          <Button title={STR.actPickSheets} variant="secondary" onPress={() => void pickActivityFile("pdf").then((a) => a && setSheets(a))} />
          {sheets ? <Muted style={{ fontSize: 12, marginTop: space(1) }}>{STR.actPicked.replace("{name}", sheets.name)}</Muted> : null}
        </View>
      ) : null}
      <Button title={STR.actPickAnswers} variant="secondary" onPress={() => void pickActivityFile("pdf").then((a) => a && setAnswers(a))} />
      {answers ? <Muted style={{ fontSize: 12, marginTop: space(1) }}>{STR.actPicked.replace("{name}", answers.name)}</Muted> : null}
      {busy ? <Muted style={{ marginVertical: space(2) }}>{STR.actUploading}</Muted> : null}
      <Button title={STR.actUpload} loading={busy} disabled={!sheets && !answers} onPress={() => void send()} style={{ marginTop: space(2) }} />
    </Card>
  );
}

function SheetRow({ sheet, manage, onDone }: { sheet: ActivitySheetT; manage: boolean; onDone: (m: Msg) => void }): React.ReactElement {
  const colors = useColors();
  const [{ fetching }, setActive] = useMutation(SET_ACTIVITY_SHEET_ACTIVE);
  const [busy, setBusy] = useState(false);
  const replace = async (): Promise<void> => {
    const a = await pickActivityFile("pdf");
    if (!a) return;
    setBusy(true);
    try {
      await uploadActivityForm("activity-sheets", { sheetId: sheet.id }, { file: a });
      onDone({ tone: "ok", text: STR.actSaved });
    } catch (e) {
      onDone({ tone: "danger", text: String((e as Error).message ?? e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
      <View style={{ flex: 1, minWidth: 160 }}>
        <Text style={{ ...typeScale.bodyStrong, color: sheet.active ? colors.textPrimary : colors.textSecondary }}>{sheet.itemId}</Text>
        {sheet.details ? <Muted style={{ fontSize: 12 }}>{sheet.details}</Muted> : null}
      </View>
      {!sheet.hasPage ? <Badge text={STR.actNoPage} tone="danger" /> : null}
      {!sheet.active ? <Badge text={STR.actRetired} tone="muted" /> : null}
      {manage ? <Button title={STR.actReplace} variant="ghost" loading={busy} onPress={() => void replace()} /> : null}
      {manage ? (
        <Button
          title={sheet.active ? STR.actRetire : STR.actRestore}
          variant="ghost"
          loading={fetching}
          onPress={() =>
            void setActive({ sheetId: sheet.id, active: !sheet.active }).then((r) =>
              onDone(r.error ? { tone: "danger", text: friendlyError(r.error) } : { tone: "ok", text: STR.actSaved }),
            )
          }
        />
      ) : null}
    </View>
  );
}

export default function ActivityBankScreen({ route }: Props): React.ReactElement {
  const { bankId } = route.params;
  const { can } = useAuth();
  const manage = can("activity_sheets:manage");
  const [q, refetch] = useQuery({ query: ACTIVITY_BANK_QUERY, variables: { bankId } });
  const [{ fetching: saving }, update] = useMutation(UPDATE_ACTIVITY_BANK);
  const [panel, setPanel] = useState<"none" | "edit" | "add" | "attach">("none");
  const [levelFilter, setLevelFilter] = useState<string>("E");
  const [showRetired, setShowRetired] = useState(false);
  const [limit, setLimit] = useState(SHEETS_PAGE);
  const [msg, setMsg] = useState<Msg>(null);
  const reload = (): void => refetch({ requestPolicy: "network-only" });
  const done = (m: Msg): void => {
    setMsg(m);
    if (m?.tone === "ok") reload();
  };
  const bank = q.data?.activityBank.bank;
  const sheets = (q.data?.activityBank.sheets ?? []).filter((s) => s.level === levelFilter && (showRetired || s.active));

  const setStatus = (status: string): void => {
    if (!bank) return;
    void update({ bankId: bank.id, status }).then((r) => done(r.error ? { tone: "danger", text: friendlyError(r.error) } : { tone: "ok", text: STR.actSaved }));
  };

  return (
    <Screen>
      {msg ? <Notice message={msg.text} tone={msg.tone} /> : null}
      <QueryGate results={[q]} onRetry={reload} loaderLabel={STR.loading}>
        {bank ? (
          <View>
            <Card style={{ marginBottom: space(3) }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
                <Text style={{ ...typeScale.pageTitle, flex: 1 }}>{bank.nameBn}</Text>
                {bankStatusBadge(bank.status)}
              </View>
              <Body>
                {bank.code}
                {bank.bankNo ? ` · #${bnNum(bank.bankNo)}` : ""}
                {bank.nameEn ? ` · ${bank.nameEn}` : ""} · {activitySkillLabel(bank.skillArea)}
              </Body>
              <Muted>
                {STR.actSheetsCount.replace("{n}", bnNum(sheetTotal(bank)))} ·{" "}
                {bank.hasAnswerPdf ? STR.actAnswersOf.replace("{a}", bnNum(bank.answers)).replace("{n}", bnNum(sheetTotal(bank))) : STR.actNoAnswers}
              </Muted>
              {bank.withoutPages > 0 ? <Notice message={STR.actNoPages.replace("{n}", bnNum(bank.withoutPages))} tone="warn" /> : null}
              {manage ? (
                <ChipRow>
                  {bank.status !== "PUBLISHED" ? <Chip label={STR.actPublish} onPress={() => setStatus("PUBLISHED")} /> : <Chip label={STR.actUnpublish} onPress={() => setStatus("DRAFT")} />}
                  {bank.status !== "RETIRED" ? <Chip label={STR.actRetireBank} onPress={() => setStatus("RETIRED")} /> : null}
                  <Chip label={STR.actEdit} selected={panel === "edit"} onPress={() => setPanel(panel === "edit" ? "none" : "edit")} />
                  <Chip label={STR.actAddSheets} selected={panel === "add"} onPress={() => setPanel(panel === "add" ? "none" : "add")} />
                  <Chip label={STR.actAttach} selected={panel === "attach"} onPress={() => setPanel(panel === "attach" ? "none" : "attach")} />
                </ChipRow>
              ) : null}
              {saving ? <Muted>{STR.loading}</Muted> : null}
            </Card>
            {panel === "edit" ? <BankEdit bank={bank} onDone={done} /> : null}
            {panel === "add" ? <AddSheets bank={bank} onDone={done} /> : null}
            {panel === "attach" ? <AttachPdfs bank={bank} onDone={done} /> : null}
            {bank.levels.map((l) => (
              <LevelCard key={`${l.level}-${l.classLevels.join()}`} bank={bank} level={l} manage={manage} onDone={done} />
            ))}
            <Text style={{ ...typeScale.bodyStrong, marginBottom: space(2) }}>{STR.actSheets}</Text>
            <ChipRow>
              {ACTIVITY_LEVELS.map((l) => (
                <Chip
                  key={l}
                  label={activityLevelLabel(l)}
                  selected={levelFilter === l}
                  onPress={() => {
                    setLevelFilter(l);
                    setLimit(SHEETS_PAGE);
                  }}
                />
              ))}
              {manage ? <Chip label={STR.actShowRetired} selected={showRetired} onPress={() => setShowRetired((v) => !v)} /> : null}
            </ChipRow>
            {sheets.slice(0, limit).map((s) => (
              <SheetRow key={s.id} sheet={s} manage={manage} onDone={done} />
            ))}
            {sheets.length > limit ? (
              <Button title={STR.actShowMore.replace("{n}", bnNum(sheets.length - limit))} variant="ghost" onPress={() => setLimit((n) => n + SHEETS_PAGE)} />
            ) : null}
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
