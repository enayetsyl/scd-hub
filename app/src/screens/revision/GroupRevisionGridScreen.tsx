/**
 * GroupRevisionGridScreen (J-SR1, SR-1/SR-5) — the Saturday grid for one Hifz group.
 * Per student row: a present/absent toggle, a portion editor (category, status, a
 * start and an end surah:ayah picked from the shared Quran table, a "whole juz"
 * shortcut, +/− counters for তানবীহ/ফাতহ and the four mistake types, note — D-#833..#836),
 * and a teacher comment. The paper's three rows start pre-laid; the recent-lesson row
 * is pre-filled from last Saturday's new lesson. Saves via recordRevisionEntry, or
 * editRevisionEntry when the row already has an entry. A row whose entry.deliveredAt
 * is set is locked read-only (the server re-enforces this; the lock is just UX).
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  REVISION_CATEGORIES,
  REVISION_PORTION_STATUSES,
  SURAHS,
  JUZ_COUNT,
  formatRangeBn,
  rangeAyahCount,
  rangeError,
  splitRangeByJuz,
  wholeJuzRange,
  type AyahRange,
} from "@scd/shared";
import {
  GROUP_REVISION_SATURDAY_QUERY,
  RECORD_REVISION_ENTRY,
  EDIT_REVISION_ENTRY,
  type RevisionGridRowT,
  type RevisionPortionInput,
  type RevisionPortionT,
} from "../../graphql/revision";
import { Screen, Card, Body, Muted, Button, Field, Select, Chip, Badge, Notice, Loader, EmptyState } from "../../components/ui";
import { STR, bnNum, revCategoryLabel, revStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { RevisionStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RevisionStackParamList, "GroupRevisionGrid">;

type CountKey = "tanbih" | "fath" | "harf" | "ghunnah" | "madd" | "other";

/** A portion being edited locally. Surah/ayah are Select values (strings). */
interface DraftPortion {
  category: string | null;
  status: string;
  fromSurah: string | null;
  fromAyah: string | null;
  toSurah: string | null;
  toAyah: string | null;
  tanbih: number;
  fath: number;
  harf: number;
  ghunnah: number;
  madd: number;
  other: number;
  note: string;
}

const emptyPortion = (category: string | null = null): DraftPortion => ({
  category,
  status: "COMPLETED",
  fromSurah: null,
  fromAyah: null,
  toSurah: null,
  toAyah: null,
  tanbih: 0,
  fath: 0,
  harf: 0,
  ghunnah: 0,
  madd: 0,
  other: 0,
  note: "",
});

const str = (n: number | null): string | null => (n == null ? null : String(n));

function fromServer(p: RevisionPortionT): DraftPortion {
  return {
    category: p.category,
    status: p.status,
    fromSurah: str(p.fromSurah),
    fromAyah: str(p.fromAyah),
    toSurah: str(p.toSurah),
    toAyah: str(p.toAyah),
    tanbih: p.tanbih,
    fath: p.fath,
    harf: p.mistakes.harf,
    ghunnah: p.mistakes.ghunnah,
    madd: p.mistakes.madd,
    other: p.mistakes.other,
    note: p.note ?? "",
  };
}

/** The editor's starting rows: the saved entry; else the paper's three rows with the
 *  recent lesson (SABQI) pre-filled from last Saturday's new lesson (SR-5). */
function initialDrafts(row: RevisionGridRowT): { drafts: DraftPortion[]; prefilled: boolean } {
  if (row.entry) return { drafts: row.entry.portions.map(fromServer), prefilled: false };
  const lastSabaq = (row.previous?.portions ?? []).filter((p) => p.category === "SABAQ" && p.fromSurah != null);
  const sabqi = lastSabaq.map((p) => ({
    ...emptyPortion("SABQI"),
    fromSurah: str(p.fromSurah),
    fromAyah: str(p.fromAyah),
    toSurah: str(p.toSurah),
    toAyah: str(p.toAyah),
  }));
  return {
    drafts: [emptyPortion("SABAQ"), ...(sabqi.length > 0 ? sabqi : [emptyPortion("SABQI")]), emptyPortion("MANZIL")],
    prefilled: sabqi.length > 0,
  };
}

function draftRange(d: DraftPortion): AyahRange | null {
  if (!d.fromSurah || !d.fromAyah || !d.toSurah || !d.toAyah) return null;
  return { fromSurah: Number(d.fromSurah), fromAyah: Number(d.fromAyah), toSurah: Number(d.toSurah), toAyah: Number(d.toAyah) };
}

const hasRangePart = (d: DraftPortion): boolean => !!(d.fromSurah || d.fromAyah || d.toSurah || d.toAyah);
const hasCounts = (d: DraftPortion): boolean => d.tanbih + d.fath + d.harf + d.ghunnah + d.madd + d.other > 0;

function draftToInput(d: DraftPortion): RevisionPortionInput {
  const r = draftRange(d);
  return {
    category: d.category ?? "",
    status: d.status,
    fromSurah: r?.fromSurah ?? null,
    fromAyah: r?.fromAyah ?? null,
    toSurah: r?.toSurah ?? null,
    toAyah: r?.toAyah ?? null,
    tanbih: d.tanbih,
    fath: d.fath,
    mistakes: { harf: d.harf, ghunnah: d.ghunnah, madd: d.madd, other: d.other },
    note: d.note.trim() || null,
  };
}

const SURAH_OPTIONS = SURAHS.map((s) => ({ label: `${bnNum(s.n)}. ${s.bn}`, value: String(s.n), hint: `${s.n} ${s.ar}` }));
const JUZ_OPTIONS = Array.from({ length: JUZ_COUNT }, (_, i) => ({
  label: `${STR.revJuz} ${bnNum(i + 1)}`,
  value: String(i + 1),
  hint: String(i + 1),
}));

function ayahOptions(surah: string | null): { label: string; value: string; hint: string }[] {
  const s = surah ? SURAHS[Number(surah) - 1] : undefined;
  if (!s) return [];
  return Array.from({ length: s.ayahs }, (_, i) => ({ label: bnNum(i + 1), value: String(i + 1), hint: String(i + 1) }));
}

/** A one-tap +1 / −1 counter (D-#836). */
function Counter({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(1) }}>
      <Body style={{ flex: 1 }}>{label}</Body>
      {!disabled ? <Chip label="−" onPress={() => onChange(Math.max(0, value - 1))} /> : null}
      <Body style={{ minWidth: 28, textAlign: "center", fontWeight: "700" }}>{bnNum(value)}</Body>
      {!disabled ? <Chip label="+" onPress={() => onChange(value + 1)} /> : null}
    </View>
  );
}

/** Start or end of a range: surah + ayah dropdowns. */
function SurahAyahPicker({
  label,
  surah,
  ayah,
  onChange,
}: {
  label: string;
  surah: string | null;
  ayah: string | null;
  onChange: (surah: string | null, ayah: string | null) => void;
}): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", gap: space(2) }}>
      <View style={{ flex: 2 }}>
        <Select
          label={label}
          value={surah}
          options={SURAH_OPTIONS}
          onChange={(v) => onChange(v, null)}
          placeholder={STR.revPickSurah}
          searchable
        />
      </View>
      <View style={{ flex: 1 }}>
        <Select
          label={STR.revPickAyah}
          value={ayah}
          options={ayahOptions(surah)}
          onChange={(v) => onChange(surah, v)}
          placeholder={STR.revPickAyah}
          searchable
        />
      </View>
    </View>
  );
}

function PortionEditor({
  d,
  locked,
  onPatch,
  onRemove,
}: {
  d: DraftPortion;
  locked: boolean;
  onPatch: (patch: Partial<DraftPortion>) => void;
  onRemove: () => void;
}): React.ReactElement {
  const range = draftRange(d);
  const err = range ? rangeError(range) : null;
  const counter = (key: CountKey, label: string): React.ReactElement => (
    <Counter label={label} value={d[key]} onChange={(v) => onPatch({ [key]: v } as Partial<DraftPortion>)} disabled={locked} />
  );
  return (
    <View style={{ marginTop: space(2), paddingTop: space(2), borderTopWidth: 1, borderTopColor: "#0001" }}>
      <Select
        label={STR.revCategory}
        value={d.category}
        options={(REVISION_CATEGORIES as readonly string[]).map((c) => ({ label: revCategoryLabel(c), value: c }))}
        onChange={(v) => !locked && onPatch({ category: v })}
        placeholder={STR.revPickCategory}
      />
      <Muted>{STR.revStatus}</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) }}>
        {(REVISION_PORTION_STATUSES as readonly string[]).map((s) => (
          <Chip key={s} label={revStatusLabel(s)} selected={d.status === s} onPress={() => !locked && onPatch({ status: s })} />
        ))}
      </View>
      {!locked ? (
        <>
          <SurahAyahPicker
            label={STR.revFrom}
            surah={d.fromSurah}
            ayah={d.fromAyah}
            onChange={(s, a) => onPatch({ fromSurah: s, fromAyah: a })}
          />
          <SurahAyahPicker
            label={STR.revTo}
            surah={d.toSurah}
            ayah={d.toAyah}
            onChange={(s, a) => onPatch({ toSurah: s, toAyah: a })}
          />
          <Select
            label={STR.revWholeJuz}
            value={null}
            options={JUZ_OPTIONS}
            onChange={(v) => {
              const w = wholeJuzRange(Number(v));
              onPatch({ fromSurah: str(w.fromSurah), fromAyah: str(w.fromAyah), toSurah: str(w.toSurah), toAyah: str(w.toAyah) });
            }}
            placeholder={STR.revPickJuz}
            searchable
          />
        </>
      ) : null}
      {range && !err ? (
        <Body style={{ fontWeight: "700", marginTop: space(1) }}>
          {formatRangeBn(range)} · {bnNum(rangeAyahCount(range))} {STR.revAyahs} · {STR.revJuz}{" "}
          {splitRangeByJuz(range).map((j) => bnNum(j.juz)).join(", ")}
        </Body>
      ) : null}
      {err ? <Notice message={err} tone="danger" /> : null}
      {counter("tanbih", STR.revTanbih)}
      {counter("fath", STR.revFath)}
      <Muted>{STR.revMistakes}</Muted>
      {counter("harf", STR.revHarf)}
      {counter("ghunnah", STR.revGhunnah)}
      {counter("madd", STR.revMadd)}
      {counter("other", STR.revOther)}
      <Field label={STR.revNote} value={d.note} onChangeText={(t) => onPatch({ note: t })} editable={!locked} />
      {!locked ? <Button title={STR.revRemoveJuz} variant="ghost" onPress={onRemove} /> : null}
    </View>
  );
}

function StudentRow({
  row,
  groupId,
  date,
}: {
  row: RevisionGridRowT;
  groupId: string;
  date: string;
}): React.ReactElement {
  const locked = !!row.entry?.deliveredAt;
  const initial = useMemo(() => initialDrafts(row), [row]);
  const [present, setPresent] = useState<boolean>(row.entry?.present ?? true);
  const [portions, setPortions] = useState<DraftPortion[]>(initial.drafts);
  const [comment, setComment] = useState<string>(row.entry?.teacherComment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [, record] = useMutation(RECORD_REVISION_ENTRY);
  const [, edit] = useMutation(EDIT_REVISION_ENTRY);

  function patchAt(i: number, patch: Partial<DraftPortion>): void {
    setPortions((prev) => prev.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  }

  async function onSave(): Promise<void> {
    setError(null);
    setOk(null);
    // A pre-laid row the teacher never touched is skipped; a half-filled range is refused here.
    const filled = present
      ? portions.filter((p) => p.category && (hasRangePart(p) || p.status !== "COMPLETED" || hasCounts(p)))
      : [];
    if (filled.some((p) => (hasRangePart(p) && !draftRange(p)) || (!hasRangePart(p) && p.status !== "NOT_DONE"))) {
      return setError(STR.revRangeIncomplete);
    }
    const inputs = filled.map(draftToInput);
    setBusy(true);
    const res = row.entry
      ? await edit({ entryId: row.entry.id, groupId, present, portions: inputs, teacherComment: comment.trim() || null })
      : await record({ groupId, studentId: row.studentId, date, present, portions: inputs, teacherComment: comment.trim() || null });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.revSaved);
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body style={{ fontWeight: "700", flexShrink: 1 }}>{row.studentName}</Body>
        {locked ? <Badge text={STR.revDelivered} tone="muted" /> : null}
      </View>

      {locked ? <Notice message={STR.revDelivered} tone="info" /> : null}

      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
        <Chip label={STR.revPresent} selected={present} onPress={() => !locked && setPresent(true)} />
        <Chip label={STR.revAbsent} selected={!present} onPress={() => !locked && setPresent(false)} />
      </View>

      {present ? (
        <View style={{ marginTop: space(2) }}>
          <Body style={{ fontWeight: "700" }}>{STR.revJuzRecords}</Body>
          {initial.prefilled && !locked ? <Muted>{STR.revPrefilled}</Muted> : null}
          {portions.map((p, i) => (
            <PortionEditor
              key={i}
              d={p}
              locked={locked}
              onPatch={(patch) => patchAt(i, patch)}
              onRemove={() => setPortions((prev) => prev.filter((_, k) => k !== i))}
            />
          ))}
          {!locked ? (
            <View style={{ marginTop: space(2) }}>
              <Button title={STR.revAddJuz} variant="secondary" onPress={() => setPortions((prev) => [...prev, emptyPortion()])} />
            </View>
          ) : null}
        </View>
      ) : null}

      <Field label={STR.revComment} value={comment} onChangeText={setComment} multiline editable={!locked} />

      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}
      {!locked ? (
        <View style={{ marginTop: space(2) }}>
          <Button title={STR.revSave} onPress={onSave} loading={busy} disabled={busy} />
        </View>
      ) : null}
    </Card>
  );
}

export default function GroupRevisionGridScreen({ route }: Props): React.ReactElement {
  const { groupId, date } = route.params;
  const [gridQ] = useQuery({ query: GROUP_REVISION_SATURDAY_QUERY, variables: { groupId, date } });
  const rows = useMemo(() => gridQ.data?.groupRevisionSaturday ?? [], [gridQ.data]);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700" }}>{route.params.nameBn}</Body>
          <Muted>
            {route.params.code} · {bnNum(date)}
          </Muted>
        </Card>
        {gridQ.fetching ? (
          <Loader label={STR.loading} />
        ) : gridQ.error ? (
          <Notice message={friendlyError(gridQ.error)} tone="danger" />
        ) : rows.length === 0 ? (
          <EmptyState message={STR.revNoData} />
        ) : (
          rows.map((row) => <StudentRow key={row.studentId} row={row} groupId={groupId} date={date} />)
        )}
      </ScrollView>
    </Screen>
  );
}
