/**
 * HomeworkIntegrityScreen (GH-3, D-#1522; AL-12, D-#1676) - "হোমওয়ার্ক যাচাই". The queue of children whose
 * homework + assignment percentage on one objective runs above their class-test percentage by the set gap.
 * Row-scoped by the server: the Office + Principal (`homework_integrity:view_all`) see every case, a class teacher or the
 * subject teacher only their own (`:view`); `:record` writes the outcome (and the term tag follows it); any investigator
 * adds notes; the Principal alone (`:settings`) sets the gap and the "repeated" count. The app sends no case to a guardian.
 */
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  ADD_HOMEWORK_INTEGRITY_NOTE,
  HOMEWORK_INTEGRITY_CASE,
  HOMEWORK_INTEGRITY_CASES,
  HOMEWORK_INTEGRITY_SETTINGS,
  RECOMPUTE_HOMEWORK_INTEGRITY,
  RECORD_HOMEWORK_INTEGRITY_OUTCOME,
  SAVE_HOMEWORK_INTEGRITY_SETTINGS,
  type IntegrityDetailT,
  type IntegrityItemT,
  type IntegrityRowT,
  type IntegritySettingsT,
} from "../../graphql/homeworkIntegrity";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Field, Loader, EmptyState, ErrorBanner, Notice } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePagedRows } from "../../lib/paging";
import { space } from "../../theme/tokens";

const OUTCOMES = [
  { value: "GUARDIAN_DID", label: () => STR.hiOutcomeGuardian },
  { value: "CHILD_DID", label: () => STR.hiOutcomeChild },
  { value: "UNCLEAR", label: () => STR.hiOutcomeUnclear },
] as const;

const outcomeLabel = (v: string | null): string => OUTCOMES.find((o) => o.value === v)?.label() ?? "";
const pct = (n: number): string => `${bnNum(Math.round(n * 10) / 10)}%`;
const dayOf = (iso: string): string => iso.slice(0, 10);

function ItemLine({ i }: { i: IntegrityItemT }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
      <Muted style={{ flexShrink: 1 }}>
        {dayOf(i.date)} · {i.qid ?? (i.itemNo != null ? `#${bnNum(i.itemNo)}` : "-")} · {bnNum(i.earned)}/{bnNum(i.available)}
      </Muted>
      {i.hintStep > 0 ? <Badge text={STR.hiHints.replace("{n}", bnNum(i.hintStep))} tone="gold" /> : null}
    </View>
  );
}

/** The Principal's two policy keys (`homework_integrity:settings`): the gap in points and the "repeated" count. */
function SettingsCard(): React.ReactElement | null {
  const [{ data }, refetch] = useQuery({ query: HOMEWORK_INTEGRITY_SETTINGS, requestPolicy: "cache-and-network" });
  const [sv, save] = useMutation(SAVE_HOMEWORK_INTEGRITY_SETTINGS);
  const cur = data?.homeworkIntegritySettings as IntegritySettingsT | undefined;
  const [gap, setGap] = useState<string | null>(null);
  const [rec, setRec] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: "danger" | "info" } | null>(null);
  if (!cur) return null;
  const gapText = gap ?? String(cur.gapPoints);
  const recText = rec ?? String(cur.recurringCases);

  async function onSave(): Promise<void> {
    const g = Number(gapText.replace(",", "."));
    const n = Number(recText);
    if (!Number.isFinite(g) || g <= 0 || g > 100 || !Number.isInteger(n) || n < 2) {
      setMsg({ text: STR.hiSettingsBad, tone: "danger" });
      return;
    }
    const res = await save({ gapPoints: g, recurringCases: n });
    if (res.error) {
      setMsg({ text: friendlyError(res.error), tone: "danger" });
      return;
    }
    setGap(null);
    setRec(null);
    setMsg({ text: STR.hiSettingsSaved, tone: "info" });
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.hiSettingsTitle}</Body>
      <Field label={STR.hiSettingsGap} value={gapText} onChangeText={setGap} keyboardType="decimal-pad" />
      <Field label={STR.hiSettingsRecurring} value={recText} onChangeText={setRec} keyboardType="number-pad" />
      {msg ? <Notice message={msg.text} tone={msg.tone} /> : null}
      <Button title={STR.hiSettingsSave} onPress={() => void onSave()} loading={sv.fetching} />
    </Card>
  );
}

function CaseCard({ r, canRecord, onChanged }: { r: IntegrityRowT; canRecord: boolean; onChanged: () => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteMsg, setNoteMsg] = useState<string | null>(null);
  const [addedDetail, setAddedDetail] = useState<IntegrityDetailT | null>(null);
  const [adding, addNote] = useMutation(ADD_HOMEWORK_INTEGRITY_NOTE);
  const [{ data, fetching, error }] = useQuery({
    query: HOMEWORK_INTEGRITY_CASE,
    variables: { id: r.id },
    pause: !open,
    requestPolicy: "cache-and-network",
  });
  const [rec, record] = useMutation(RECORD_HOMEWORK_INTEGRITY_OUTCOME);
  const d = addedDetail ?? (data?.homeworkIntegrityCase as IntegrityDetailT | undefined);

  async function onAddNote(): Promise<void> {
    if (!noteText.trim()) {
      setNoteMsg(STR.hiNoteEmpty);
      return;
    }
    setNoteMsg(null);
    const res = await addNote({ id: r.id, text: noteText.trim() });
    if (res.error) {
      setNoteMsg(friendlyError(res.error));
      return;
    }
    setNoteText("");
    setAddedDetail((res.data?.addHomeworkIntegrityNote as IntegrityDetailT | undefined) ?? null);
  }

  async function onRecord(): Promise<void> {
    if (!outcome) {
      setMsg(STR.hiPickOutcome);
      return;
    }
    setMsg(null);
    const res = await record({ id: r.id, outcome, note: note.trim() || null });
    if (res.error) {
      setMsg(friendlyError(res.error));
      return;
    }
    setOpen(false);
    onChanged();
  }

  return (
    <Card>
      <Pressable accessibilityRole="button" onPress={() => setOpen((o) => !o)}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
          <Body style={{ fontWeight: "700", flexShrink: 1 }}>
            {r.studentName}
            {r.studentSchoolId ? ` (${r.studentSchoolId})` : ""}
          </Body>
          <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
            {r.recurring ? <Badge text={STR.hiRecurring} tone="danger" /> : null}
            {r.tagActive ? <Badge text={STR.hiOutsideHelpMark} tone="gold" /> : null}
            <Badge text={`${STR.hiGap} ${bnNum(Math.round(r.gap))} ${STR.hiPoints}`} tone={r.status === "OPEN" ? "gold" : "muted"} />
          </View>
        </View>
        <Muted style={{ marginTop: 2 }}>
          {r.classNameBn} · {r.sectionNameBn} — {hwSubjectLabel(r.subject)}
        </Muted>
        <Body style={{ marginTop: 2 }}>{r.loLabelBn}</Body>
        <Muted style={{ marginTop: 2 }}>
          {STR.hiHw}: {pct(r.hwPct)} · {STR.hiCt}: {pct(r.ctPct)}
        </Muted>
        {r.status === "CLOSED" ? (
          <Muted style={{ marginTop: 2 }}>
            {outcomeLabel(r.outcome)}
            {r.closedAt ? ` · ${STR.hiRecordedOn.replace("{d}", dayOf(r.closedAt))}` : ""}
            {r.note ? ` · ${r.note}` : ""}
            {r.tagActive && r.tagUntil ? ` · ${STR.hiTagUntil.replace("{d}", dayOf(r.tagUntil))}` : ""}
          </Muted>
        ) : null}
      </Pressable>

      {open ? (
        <View style={{ marginTop: space(2), gap: space(1) }}>
          {error ? <ErrorBanner message={friendlyError(error)} /> : fetching && !d ? <Loader label={STR.loading} /> : null}
          {d ? (
            <>
              <Body style={{ fontWeight: "700" }}>{STR.hiHwItems}</Body>
              {d.hwItems.map((i, k) => (
                <ItemLine key={`h${k}`} i={i} />
              ))}
              <Body style={{ fontWeight: "700", marginTop: space(1) }}>{STR.hiCtItems}</Body>
              {d.ctItems.map((i, k) => (
                <ItemLine key={`c${k}`} i={i} />
              ))}
              {(d.investigatorNames ?? []).length > 0 ? (
                <Muted style={{ marginTop: space(1) }}>
                  {STR.hiInvestigators}: {(d.investigatorNames ?? []).join(", ")}
                </Muted>
              ) : null}
              <Body style={{ fontWeight: "700", marginTop: space(1) }}>{STR.hiNotes}</Body>
              {(d.notes ?? []).length === 0 ? <Muted>{STR.hiNoNotes}</Muted> : null}
              {(d.notes ?? []).map((n, k) => (
                <Muted key={`n${k}`}>
                  {dayOf(n.at)} · {n.byName}: {n.text}
                </Muted>
              ))}
              <Field label={STR.hiNoteLabel} value={noteText} onChangeText={setNoteText} multiline />
              {noteMsg ? <Notice message={noteMsg} tone="danger" /> : null}
              <Button title={STR.hiAddNote} variant="secondary" onPress={() => void onAddNote()} loading={adding.fetching} />
              {d.history.length > 1 ? (
                <>
                  <Body style={{ fontWeight: "700", marginTop: space(1) }}>{STR.hiHistory}</Body>
                  {d.history.map((h, k) => (
                    <Muted key={`y${k}`}>
                      {dayOf(h.at)} · {STR.hiHw} {pct(h.hwPct)} · {STR.hiCt} {pct(h.ctPct)}
                    </Muted>
                  ))}
                </>
              ) : null}
            </>
          ) : null}
          {canRecord && r.status === "OPEN" ? (
            <View style={{ gap: space(2), marginTop: space(2) }}>
              <Body style={{ fontWeight: "700" }}>{STR.hiOutcome}</Body>
              <ChipRow>
                {OUTCOMES.map((o) => (
                  <Chip key={o.value} label={o.label()} selected={outcome === o.value} onPress={() => setOutcome(o.value)} />
                ))}
              </ChipRow>
              <Field label={STR.hiNote} value={note} onChangeText={setNote} multiline />
              {msg ? <Notice message={msg} tone="danger" /> : null}
              <Button title={STR.hiRecord} onPress={() => void onRecord()} loading={rec.fetching} />
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

export default function HomeworkIntegrityScreen(): React.ReactElement {
  const { can } = useAuth();
  const canRecord = can("homework_integrity:record");
  const canRecompute = can("homework_integrity:view_all");
  const canSettings = can("homework_integrity:settings");
  const [status, setStatus] = useState<"OPEN" | "CLOSED">("OPEN");
  const [token, setToken] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [q, refetch] = useQuery({ query: HOMEWORK_INTEGRITY_CASES, variables: { status }, requestPolicy: "cache-and-network" });
  const [rc, recompute] = useMutation(RECOMPUTE_HOMEWORK_INTEGRITY);
  const reload = useCallback(() => refetch({ requestPolicy: "network-only" }), [refetch]);

  const raw: IntegrityRowT[] = q.data?.homeworkIntegrityCases ?? [];
  const classes = useMemo(() => [...new Map(raw.map((r) => [r.classToken, r.classNameBn])).entries()], [raw]);
  const sections = useMemo(
    () => [...new Map(raw.filter((r) => !token || r.classToken === token).map((r) => [r.sectionId, `${r.classNameBn} · ${r.sectionNameBn}`])).entries()],
    [raw, token],
  );
  const subjects = useMemo(() => [...new Set(raw.map((r) => r.subject))].sort(), [raw]);
  const rows = raw.filter(
    (r) => r.status === status && (!token || r.classToken === token) && (!sectionId || r.sectionId === sectionId) && (!subject || r.subject === subject),
  );
  const { shown, pager } = usePagedRows(rows, { resetKey: `${status}|${token}|${sectionId}|${subject}` });

  async function onRecompute(): Promise<void> {
    setNotice(null);
    const res = await recompute({});
    if (res.error) {
      setNotice(friendlyError(res.error));
      return;
    }
    const s = res.data?.recomputeHomeworkIntegrity;
    setNotice(STR.hiRecomputed.replace("{n}", bnNum((s?.opened ?? 0) + (s?.reopened ?? 0))).replace("{u}", bnNum(s?.updated ?? 0)));
    reload();
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(2) }}>
        <Muted>{STR.hiIntro}</Muted>
        <ChipRow>
          <Chip label={STR.hiOpen} selected={status === "OPEN"} onPress={() => setStatus("OPEN")} />
          <Chip label={STR.hiClosed} selected={status === "CLOSED"} onPress={() => setStatus("CLOSED")} />
        </ChipRow>
        {classes.length > 1 ? (
          <ChipRow>
            <Chip label={STR.lpAllClasses} selected={token == null} onPress={() => { setToken(null); setSectionId(null); }} />
            {classes.map(([t, name]) => (
              <Chip key={t} label={name} selected={token === t} onPress={() => { setToken(t); setSectionId(null); }} />
            ))}
          </ChipRow>
        ) : null}
        {sections.length > 1 ? (
          <ChipRow>
            {sections.map(([id, name]) => (
              <Chip key={id} label={name} selected={sectionId === id} onPress={() => setSectionId(sectionId === id ? null : id)} />
            ))}
          </ChipRow>
        ) : null}
        {subjects.length > 1 ? (
          <ChipRow>
            <Chip label={STR.lpAllSubjects} selected={subject == null} onPress={() => setSubject(null)} />
            {subjects.map((s) => (
              <Chip key={s} label={hwSubjectLabel(s)} selected={subject === s} onPress={() => setSubject(s)} />
            ))}
          </ChipRow>
        ) : null}
        {canSettings ? <SettingsCard /> : null}
        {canRecompute ? <Button title={STR.hiRecompute} variant="secondary" onPress={() => void onRecompute()} loading={rc.fetching} /> : null}
        {notice ? <Notice message={notice} tone="info" /> : null}

        {q.error ? (
          <ErrorBanner message={friendlyError(q.error)} onRetry={reload} />
        ) : q.fetching && raw.length === 0 ? (
          <Loader label={STR.loading} />
        ) : rows.length === 0 ? (
          <EmptyState message={STR.hiEmpty} />
        ) : (
          <>
            {shown.map((r) => (
              <CaseCard key={r.id} r={r} canRecord={canRecord} onChanged={reload} />
            ))}
            <Pager {...pager} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
