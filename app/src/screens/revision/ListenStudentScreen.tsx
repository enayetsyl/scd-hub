/**
 * ListenStudentScreen (SR-6, D-#1172) — the listener in front of one student. উপস্থিত /
 * অনুপস্থিত at the top; when present, one section per part of the level's target
 * (নতুন মুখস্ত / সর্বসাম্প্রতিক পাঠ / পুরনো রিভিশন): its অবস্থা, +/− for ফাতহ and তানবিহ,
 * +/− for the four pronunciation mistakes (হরফ / গুন্নাহ / মাদ / অন্যান্য) and a comment.
 * The range is the target's — the listener only marks. Saves through the SR-1
 * record/edit path (the server lets the assigned listener write). Nothing reaches the
 * family until a lead / the Office / the Principal releases it.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { REVISION_PORTION_STATUSES } from "@scd/shared";
import { useAuth } from "../../auth/AuthContext";
import { getItem, setItem, removeItem } from "../../lib/storage";
import {
  MY_REVISION_LISTENING_QUERY,
  RECORD_REVISION_ENTRY,
  type RevisionListeningRowT,
  type RevisionPortionInput,
} from "../../graphql/revision";
import { Screen, Card, Body, Muted, Button, Field, Chip, Notice, Loader, EmptyState } from "../../components/ui";
import { Counter } from "../../components/RevisionInputs";
import { STR, bnNum, hifzLevelLabel, revCategoryLabel, revStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { RevisionStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RevisionStackParamList, "ListenStudent">;

type CountKey = "fath" | "tanbih" | "harf" | "ghunnah" | "madd" | "other";

interface Section {
  category: string;
  rangeBn: string | null;
  fromSurah: number | null;
  fromAyah: number | null;
  toSurah: number | null;
  toAyah: number | null;
  status: string;
  fath: number;
  tanbih: number;
  harf: number;
  ghunnah: number;
  madd: number;
  other: number;
  note: string;
}

/** The saved entry's portions; else one fresh section per target part. */
function initialSections(row: RevisionListeningRowT): Section[] {
  if (row.entry && row.entry.portions.length > 0) {
    return row.entry.portions.map((p) => ({
      category: p.category,
      rangeBn: p.rangeBn,
      fromSurah: p.fromSurah,
      fromAyah: p.fromAyah,
      toSurah: p.toSurah,
      toAyah: p.toAyah,
      status: p.status,
      fath: p.fath,
      tanbih: p.tanbih,
      harf: p.mistakes.harf,
      ghunnah: p.mistakes.ghunnah,
      madd: p.mistakes.madd,
      other: p.mistakes.other,
      note: p.note ?? "",
    }));
  }
  return (row.target?.portions ?? []).map((t) => ({
    category: t.category,
    rangeBn: t.rangeBn,
    fromSurah: t.fromSurah,
    fromAyah: t.fromAyah,
    toSurah: t.toSurah,
    toAyah: t.toAyah,
    status: "COMPLETED",
    fath: 0,
    tanbih: 0,
    harf: 0,
    ghunnah: 0,
    madd: 0,
    other: 0,
    note: "",
  }));
}

function toInput(s: Section): RevisionPortionInput {
  return {
    category: s.category,
    status: s.status,
    fromSurah: s.fromSurah,
    fromAyah: s.fromAyah,
    toSurah: s.toSurah,
    toAyah: s.toAyah,
    fath: s.fath,
    tanbih: s.tanbih,
    mistakes: { harf: s.harf, ghunnah: s.ghunnah, madd: s.madd, other: s.other },
    note: s.note.trim() || null,
  };
}

/** What is kept on the phone and sent to the server on every change (D-#1180). */
interface MarkSnapshot {
  present: boolean;
  sections: Section[];
  comment: string;
}

type SaveState = "idle" | "saving" | "saved" | "failed";

/** Wait after a tap before sending — several quick taps go out as one save. */
const SAVE_DELAY_MS = 500;
/** Retry a failed save (no internet) this often while marks are unsent. */
const RETRY_MS = 5000;

function Marking({ row, date, onDone }: { row: RevisionListeningRowT; date: string; onDone: () => void }): React.ReactElement {
  const { user } = useAuth();
  const locked = !!row.entry?.deliveredAt;
  const initial = useMemo(() => initialSections(row), [row]);
  const [present, setPresent] = useState<boolean>(row.entry?.present ?? true);
  const [sections, setSections] = useState<Section[]>(initial);
  const [comment, setComment] = useState(row.entry?.teacherComment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [restored, setRestored] = useState(false);
  const [, record] = useMutation(RECORD_REVISION_ENTRY);

  // ---- the phone copy + the server save (D-#1180) --------------------------------
  // Every change bumps `version`, is written to the phone at once, and is sent to the
  // server after a short pause. The phone copy is removed only when the server holds that
  // same version, so a reload, a closed app or a dead connection never loses a tap.
  const draftKey = user ? `draft:v1:rev-listen:${user.id}:${row.studentId}:${date}` : null;
  const latest = useRef<MarkSnapshot>({ present, sections, comment });
  latest.current = { present, sections, comment };
  const version = useRef(0);
  const savedVersion = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = React.useCallback(
    async (finish: boolean): Promise<boolean> => {
      // One save at a time; a change made meanwhile goes out right after.
      while (inFlight.current) await inFlight.current;
      const v = version.current;
      const snap = latest.current;
      if (!finish && v === savedVersion.current) return true;
      setSaveState("saving");
      const run = (async () => {
        const res = await record({
          groupId: row.groupId,
          studentId: row.studentId,
          date,
          present: snap.present,
          portions: snap.present ? snap.sections.map(toInput) : [],
          teacherComment: snap.comment.trim() || null,
          inProgress: !finish,
        });
        if (res.error) {
          setSaveState("failed");
          if (finish) setError(STR.revListenFinishFailed);
          return false;
        }
        savedVersion.current = Math.max(savedVersion.current, v);
        if (savedVersion.current === version.current && draftKey) void removeItem(draftKey).catch(() => undefined);
        setSaveState("saved");
        return true;
      })();
      inFlight.current = run;
      try {
        return await run;
      } finally {
        inFlight.current = null;
      }
    },
    [record, row.groupId, row.studentId, date, draftKey],
  );

  /** A tap happened: keep it on the phone now, send it shortly. */
  const changed = React.useCallback(() => {
    if (locked) return;
    version.current += 1;
    if (draftKey) {
      // The state update has not landed yet — write on the next tick, from the ref.
      setTimeout(() => void setItem(draftKey, JSON.stringify(latest.current)).catch(() => undefined), 0);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void send(false), SAVE_DELAY_MS);
  }, [locked, draftKey, send]);

  // Retry while something is unsent and the last try failed (no internet).
  useEffect(() => {
    if (saveState !== "failed") return;
    const t = setInterval(() => {
      if (version.current > savedVersion.current) void send(false);
    }, RETRY_MS);
    return () => clearInterval(t);
  }, [saveState, send]);

  // On open: a copy left on the phone (never reached the server) wins over the server's.
  const triedRestore = useRef(false);
  useEffect(() => {
    if (!draftKey || locked || triedRestore.current) return;
    triedRestore.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await getItem(draftKey);
        if (!raw || cancelled) return;
        const d = JSON.parse(raw) as MarkSnapshot;
        setPresent(d.present);
        setSections(d.sections);
        setComment(d.comment);
        setRestored(true);
        latest.current = d;
        version.current += 1;
        void send(false);
      } catch {
        /* a broken copy is ignored */
      }
    })();
    return () => {
      // Unmounted before the read finished (React's dev double-mount): let the next mount try.
      cancelled = true;
      triedRestore.current = false;
    };
  }, [draftKey, locked, send]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const patch = (i: number, p: Partial<Section>) => {
    setSections((prev) => prev.map((s, k) => (k === i ? { ...s, ...p } : s)));
    changed();
  };
  const counter = (i: number, key: CountKey, label: string) => (
    <Counter label={label} value={sections[i][key]} onChange={(v) => patch(i, { [key]: v } as Partial<Section>)} disabled={locked} />
  );

  async function onFinish(): Promise<void> {
    setError(null);
    if (present && sections.length === 0) return setError(STR.revListenNoTarget);
    if (timer.current) clearTimeout(timer.current);
    setBusy(true);
    const ok = await send(true);
    setBusy(false);
    if (!ok) return;
    if (draftKey) await removeItem(draftKey).catch(() => undefined);
    onDone();
  }

  const saveLine =
    saveState === "saving" ? STR.revAutoSaving : saveState === "saved" ? STR.revAutoSaved : saveState === "failed" ? STR.revAutoFailed : null;

  return (
    <>
      <Card>
        <Body style={{ fontWeight: "700" }}>{row.studentName}</Body>
        <Muted>
          {hifzLevelLabel(row.level)} · {row.groupNameBn} · {bnNum(date)}
        </Muted>
        {locked ? <Notice message={STR.revListenLocked} tone="info" /> : null}
        {restored ? <Notice message={STR.revAutoRestored} tone="info" /> : null}
        <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
          <Chip
            label={STR.revPresent}
            selected={present}
            onPress={() => {
              if (locked) return;
              setPresent(true);
              changed();
            }}
          />
          <Chip
            label={STR.revAbsent}
            selected={!present}
            onPress={() => {
              if (locked) return;
              setPresent(false);
              changed();
            }}
          />
        </View>
        {saveLine && !locked ? (
          <Muted style={{ marginTop: space(2), color: saveState === "failed" ? "#B3261E" : undefined }}>{saveLine}</Muted>
        ) : null}
      </Card>

      {!present ? (
        <Card>
          <Body>{STR.revListenAbsentDone}</Body>
        </Card>
      ) : sections.length === 0 ? (
        <Notice message={STR.revListenNoTarget} tone="warn" />
      ) : (
        sections.map((s, i) => (
          <Card key={`${s.category}-${i}`}>
            <Body style={{ fontWeight: "700" }}>{revCategoryLabel(s.category)}</Body>
            <Muted>
              {STR.revListenGroupTarget}: {s.rangeBn ?? "—"}
            </Muted>
            <Muted style={{ marginTop: space(2) }}>{STR.revStatus}</Muted>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) }}>
              {(REVISION_PORTION_STATUSES as readonly string[]).map((st) => (
                <Chip key={st} label={revStatusLabel(st)} selected={s.status === st} onPress={() => !locked && patch(i, { status: st })} />
              ))}
            </View>
            {counter(i, "fath", STR.revFath)}
            {counter(i, "tanbih", STR.revTanbih)}
            <Muted style={{ marginTop: space(2) }}>{STR.revPronunciation}</Muted>
            {counter(i, "harf", STR.revHarf)}
            {counter(i, "ghunnah", STR.revGhunnah)}
            {counter(i, "madd", STR.revMadd)}
            {counter(i, "other", STR.revOther)}
            <Field label={STR.revSectionComment} value={s.note} onChangeText={(t) => patch(i, { note: t })} multiline editable={!locked} />
            {saveLine && !locked ? (
              <Muted style={{ marginTop: space(1), color: saveState === "failed" ? "#B3261E" : undefined }}>{saveLine}</Muted>
            ) : null}
          </Card>
        ))
      )}

      <Card>
        <Field
          label={STR.revComment}
          value={comment}
          onChangeText={(t) => {
            setComment(t);
            changed();
          }}
          multiline
          editable={!locked}
        />
        {error ? <Notice message={error} tone="danger" /> : null}
        {!locked ? (
          <View style={{ marginTop: space(2) }}>
            <Button title={STR.revListenSave} onPress={onFinish} loading={busy} disabled={busy} />
            <Muted style={{ marginTop: space(1), textAlign: "center" }}>{STR.revListenBeforeRelease}</Muted>
          </View>
        ) : null}
      </Card>
    </>
  );
}

export default function ListenStudentScreen({ route, navigation }: Props): React.ReactElement {
  const { studentId, date } = route.params;
  const [q] = useQuery({ query: MY_REVISION_LISTENING_QUERY, variables: { date }, requestPolicy: "cache-and-network" });
  const row = q.data?.myRevisionListening.find((r) => r.studentId === studentId) ?? null;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {q.fetching && !q.data ? (
          <Loader label={STR.loading} />
        ) : q.error ? (
          <Notice message={friendlyError(q.error)} tone="danger" />
        ) : !row ? (
          <EmptyState message={STR.revListenNone} />
        ) : (
          // Keyed by student only: every autosave refetches the list, and a remount would
          // throw away taps made while the save was on its way (D-#1180).
          <Marking key={`${row.studentId}-${date}`} row={row} date={date} onDone={() => navigation.goBack()} />
        )}
      </ScrollView>
    </Screen>
  );
}
