/**
 * HomeworkIntegrityScreen (GH-3, D-#1522) - "হোমওয়ার্ক যাচাই". The Office queue of children whose
 * homework + assignment percentage on one objective runs 20+ points above their class-test percentage.
 * `homework_integrity:view` reads it, `homework_integrity:record` writes the outcome and recalculates.
 * The Office investigates by hand; the app sends nothing to any guardian.
 */
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  HOMEWORK_INTEGRITY_CASE,
  HOMEWORK_INTEGRITY_CASES,
  RECOMPUTE_HOMEWORK_INTEGRITY,
  RECORD_HOMEWORK_INTEGRITY_OUTCOME,
  type IntegrityDetailT,
  type IntegrityItemT,
  type IntegrityRowT,
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

function CaseCard({ r, canRecord, onChanged }: { r: IntegrityRowT; canRecord: boolean; onChanged: () => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [{ data, fetching, error }] = useQuery({
    query: HOMEWORK_INTEGRITY_CASE,
    variables: { id: r.id },
    pause: !open,
    requestPolicy: "cache-and-network",
  });
  const [rec, record] = useMutation(RECORD_HOMEWORK_INTEGRITY_OUTCOME);
  const d = data?.homeworkIntegrityCase as IntegrityDetailT | undefined;

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
        {canRecord ? <Button title={STR.hiRecompute} variant="secondary" onPress={() => void onRecompute()} loading={rc.fetching} /> : null}
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
