/**
 * ListenStudentScreen (SR-6, D-#1172) — the listener in front of one student. উপস্থিত /
 * অনুপস্থিত at the top; when present, one section per part of the level's target
 * (নতুন মুখস্ত / সর্বসাম্প্রতিক পাঠ / পুরনো রিভিশন): its অবস্থা, +/− for ফাতহ and তানবিহ,
 * +/− for the four pronunciation mistakes (হরফ / গুন্নাহ / মাদ / অন্যান্য) and a comment.
 * The range is the target's — the listener only marks. Saves through the SR-1
 * record/edit path (the server lets the assigned listener write). Nothing reaches the
 * family until a lead / the Office / the Principal releases it.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { REVISION_PORTION_STATUSES } from "@scd/shared";
import {
  EDIT_REVISION_ENTRY,
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

function Marking({ row, date, onDone }: { row: RevisionListeningRowT; date: string; onDone: () => void }): React.ReactElement {
  const locked = !!row.entry?.deliveredAt;
  const initial = useMemo(() => initialSections(row), [row]);
  const [present, setPresent] = useState<boolean>(row.entry?.present ?? true);
  const [sections, setSections] = useState<Section[]>(initial);
  const [comment, setComment] = useState(row.entry?.teacherComment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, record] = useMutation(RECORD_REVISION_ENTRY);
  const [, edit] = useMutation(EDIT_REVISION_ENTRY);

  const patch = (i: number, p: Partial<Section>) => setSections((prev) => prev.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const counter = (i: number, key: CountKey, label: string) => (
    <Counter label={label} value={sections[i][key]} onChange={(v) => patch(i, { [key]: v } as Partial<Section>)} disabled={locked} />
  );

  async function onSave(): Promise<void> {
    setError(null);
    if (present && sections.length === 0) return setError(STR.revListenNoTarget);
    const portions = present ? sections.map(toInput) : [];
    const teacherComment = comment.trim() || null;
    setBusy(true);
    const res = row.entry
      ? await edit({ entryId: row.entry.id, groupId: row.groupId, present, portions, teacherComment })
      : await record({ groupId: row.groupId, studentId: row.studentId, date, present, portions, teacherComment });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    onDone();
  }

  return (
    <>
      <Card>
        <Body style={{ fontWeight: "700" }}>{row.studentName}</Body>
        <Muted>
          {hifzLevelLabel(row.level)} · {row.groupNameBn} · {bnNum(date)}
        </Muted>
        {locked ? <Notice message={STR.revListenLocked} tone="info" /> : null}
        <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
          <Chip label={STR.revPresent} selected={present} onPress={() => !locked && setPresent(true)} />
          <Chip label={STR.revAbsent} selected={!present} onPress={() => !locked && setPresent(false)} />
        </View>
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
          </Card>
        ))
      )}

      <Card>
        <Field label={STR.revComment} value={comment} onChangeText={setComment} multiline editable={!locked} />
        {error ? <Notice message={error} tone="danger" /> : null}
        {!locked ? (
          <View style={{ marginTop: space(2) }}>
            <Button title={STR.revListenSave} onPress={onSave} loading={busy} disabled={busy} />
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
          <Marking key={`${row.studentId}-${row.entry?.updatedAt ?? "new"}`} row={row} date={date} onDone={() => navigation.goBack()} />
        )}
      </ScrollView>
    </Screen>
  );
}
