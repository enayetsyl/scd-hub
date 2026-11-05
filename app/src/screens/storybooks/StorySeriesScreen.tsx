/**
 * StorySeriesScreen (SB-1, W2) — one series: cover, what the child learns, and its books
 * with availability (in / out until / waiting) and the child's own history.
 *
 * OFFICE (library:edit) also gets, on the same screen:
 *  - upload: pick one or more PDFs → each becomes a numbered DRAFT book (W11);
 *  - series details: names, band, tags, about, learn points, status (draft / published / hidden);
 *  - per book: publish / back to draft; a "tag several" mode for bulk tagging (W12).
 */
import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  BULK_TAG_STORY_BOOKS,
  SET_STORY_BOOK_PUBLISHED,
  STORY_AGE_BANDS_QUERY,
  STORY_SERIES_QUERY,
  STORY_TAGS_QUERY,
  UPDATE_STORY_SERIES,
  type StoryBookCardT,
  type StorySeriesCardT,
} from "../../graphql/storybooks";
import { Badge, Body, Button, Card, Chip, ChipRow, EmptyState, Field, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { pickAndUploadStorybooks } from "../../lib/files";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, isoDateLabel } from "../../lib/labels";
import type { StorybooksStackParamList } from "../../navigation/types";
import { space, typeScale, useColors } from "../../theme";
import { StoryImage } from "./StoryImage";

type Props = NativeStackScreenProps<StorybooksStackParamList, "StorySeries">;
type Msg = { tone: "ok" | "danger"; text: string } | null;

export function availabilityPill(b: StoryBookCardT): { text: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (b.totalCopies === 0) return { text: STR.stbNoCopies, tone: "muted" };
  if (b.availableCopies > 0) return { text: STR.stbIn, tone: "ok" };
  if (b.waitingCount > 0) return { text: STR.stbWaiting.replace("{n}", bnNum(b.waitingCount)), tone: "danger" };
  return { text: STR.stbOut, tone: "warn" };
}

export function availabilityLine(b: StoryBookCardT): string {
  if (b.totalCopies === 0) return STR.stbNoCopies;
  const parts = [
    b.availableCopies > 0
      ? STR.stbCopiesIn.replace("{n}", bnNum(b.availableCopies))
      : STR.stbOutUntil.replace("{date}", isoDateLabel(b.nextDueDate)),
  ];
  if (b.waitingCount > 0) parts.push(STR.stbWaitingLine.replace("{n}", bnNum(b.waitingCount)));
  return parts.join(" · ");
}

const lines = (s: string): string[] => s.split("\n").map((x) => x.trim()).filter(Boolean);

function SeriesEditor({ series, onSaved }: { series: StorySeriesCardT; onSaved: (m: Msg) => void }): React.ReactElement {
  const [{ fetching }, update] = useMutation(UPDATE_STORY_SERIES);
  const [bandsQ] = useQuery({ query: STORY_AGE_BANDS_QUERY });
  const [tagsQ] = useQuery({ query: STORY_TAGS_QUERY, variables: {} });
  const [nameBn, setNameBn] = useState(series.nameBn);
  const [nameEn, setNameEn] = useState(series.nameEn ?? "");
  const [about, setAbout] = useState(series.aboutBn ?? "");
  const [learn, setLearn] = useState(series.learnPointsBn.join("\n"));
  const [order, setOrder] = useState(String(series.sortOrder));
  const [band, setBand] = useState(series.ageBandCode);
  const [tagIds, setTagIds] = useState<string[]>(series.tagIds);

  const save = async (status?: string): Promise<void> => {
    const res = await update({
      seriesId: series.id,
      status: status ?? null,
      nameBn,
      nameEn,
      aboutBn: about,
      learnPointsBn: lines(learn),
      sortOrder: Number(order) || 0,
      ageBandCode: band,
      tagIds,
    });
    onSaved(res.error ? { tone: "danger", text: friendlyError(res.error) } : { tone: "ok", text: STR.stbSaved });
  };

  return (
    <Card style={{ marginBottom: space(3) }}>
      <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.stbEditSeries}</Body>
      <Field label={STR.stbNameBn} value={nameBn} onChangeText={setNameBn} autoCapitalize="sentences" />
      <Field label={STR.stbNameEn} value={nameEn} onChangeText={setNameEn} autoCapitalize="words" />
      <Muted>{STR.stbBand}</Muted>
      <ChipRow>
        {(bandsQ.data?.storyAgeBands ?? []).map((b) => (
          <Chip key={b.code} label={b.labelBn} selected={band === b.code} onPress={() => setBand(b.code)} />
        ))}
      </ChipRow>
      <Muted>{STR.stbTags}</Muted>
      <ChipRow>
        {(tagsQ.data?.storyTags ?? []).map((t) => (
          <Chip
            key={t.id}
            label={t.nameBn}
            selected={tagIds.includes(t.id)}
            onPress={() => setTagIds((cur) => (cur.includes(t.id) ? cur.filter((x) => x !== t.id) : [...cur, t.id]))}
          />
        ))}
      </ChipRow>
      <Field label={STR.stbAbout} value={about} onChangeText={setAbout} multiline autoCapitalize="sentences" />
      <Field label={STR.stbLearnedPoints} value={learn} onChangeText={setLearn} multiline autoCapitalize="sentences" />
      <Field label={STR.stbOrder} value={order} onChangeText={setOrder} keyboardType="number-pad" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        <Button title={STR.stbSave} loading={fetching} onPress={() => void save()} />
        {series.status !== "PUBLISHED" ? <Button title={STR.stbPublish} variant="secondary" onPress={() => void save("PUBLISHED")} /> : null}
        {series.status === "PUBLISHED" ? <Button title={STR.stbHidden} variant="ghost" onPress={() => void save("HIDDEN")} /> : null}
        {series.status === "HIDDEN" ? <Button title={STR.stbUnpublish} variant="ghost" onPress={() => void save("DRAFT")} /> : null}
      </View>
    </Card>
  );
}

function UploadCard({ seriesId, onDone }: { seriesId: string; onDone: (m: Msg) => void }): React.ReactElement {
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const upload = async (): Promise<void> => {
    setBusy(true);
    try {
      const results = await pickAndUploadStorybooks({ seriesId, previewPages: preview.trim() || undefined });
      if (!results) return;
      const ok = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.message ?? ""}`);
      onDone({ tone: failed.length ? "danger" : "ok", text: [STR.stbUploadDone.replace("{n}", bnNum(ok)), ...failed].join("\n") });
    } catch (e) {
      onDone({ tone: "danger", text: String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ marginBottom: space(3) }}>
      <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.stbUploadTitle}</Body>
      <Field label={STR.stbUploadPreview} value={preview} onChangeText={setPreview} placeholder="3, 4, 16" />
      <Button title={busy ? STR.stbUploading : STR.stbUploadPick} loading={busy} onPress={() => void upload()} />
      <Muted style={{ marginTop: space(2) }}>{STR.stbUploadHint}</Muted>
    </Card>
  );
}

function BookRow({
  book,
  childName,
  manage,
  selecting,
  selected,
  onToggle,
  onOpen,
  onChanged,
}: {
  book: StoryBookCardT;
  childName: string | null;
  manage: boolean;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onChanged: (m: Msg) => void;
}): React.ReactElement {
  const colors = useColors();
  const [{ fetching }, publish] = useMutation(SET_STORY_BOOK_PUBLISHED);
  const pill = availabilityPill(book);
  return (
    <Pressable
      onPress={selecting ? onToggle : onOpen}
      accessibilityRole="button"
      style={{ flexDirection: "row", gap: space(3), alignItems: "center", paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      {selecting ? <Text style={{ fontSize: 20, width: 24 }}>{selected ? "☑" : "☐"}</Text> : null}
      <Text style={{ ...typeScale.caption, color: colors.textSecondary, width: 24 }}>{book.seriesNo != null ? bnNum(book.seriesNo) : "–"}</Text>
      <View style={{ width: 64 }}>
        <StoryImage fileId={book.coverFileId} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }} numberOfLines={2}>
          {book.titleBn}
        </Text>
        {book.titleEn && book.titleEn !== book.titleBn ? <Muted style={{ fontSize: 12 }}>{book.titleEn}</Muted> : null}
        <Muted style={{ fontSize: 12 }}>
          {childName && book.childHasNow
            ? STR.stbChildHasNow.replace("{name}", childName)
            : childName && book.childReadCount
              ? STR.stbChildRead.replace("{name}", childName).replace("{n}", bnNum(book.childReadCount))
              : availabilityLine(book)}
        </Muted>
        {manage ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
            {book.draft ? <Badge text={STR.stbDraft} tone="warn" /> : null}
            {!book.active ? <Badge text={STR.stbRetired} tone="muted" /> : null}
            {book.tagNamesBn.map((t) => (
              <Badge key={t} text={t} tone="muted" />
            ))}
          </View>
        ) : null}
      </View>
      {manage && !selecting && book.active ? (
        <Button
          title={book.draft ? STR.stbPublish : STR.stbUnpublish}
          variant={book.draft ? "secondary" : "ghost"}
          loading={fetching}
          onPress={() =>
            void (async () => {
              const res = await publish({ titleId: book.id, published: book.draft });
              onChanged(res.error ? { tone: "danger", text: friendlyError(res.error) } : null);
            })()
          }
        />
      ) : (
        <Badge text={pill.text} tone={pill.tone} />
      )}
    </Pressable>
  );
}

function BulkTagBar({ titleIds, onDone }: { titleIds: string[]; onDone: (m: Msg) => void }): React.ReactElement {
  const [tagsQ] = useQuery({ query: STORY_TAGS_QUERY, variables: {} });
  const [tagId, setTagId] = useState<string | null>(null);
  const [{ fetching }, bulk] = useMutation(BULK_TAG_STORY_BOOKS);
  const run = async (mode: "add" | "remove"): Promise<void> => {
    if (!tagId || titleIds.length === 0) return;
    const res = await bulk({ titleIds, addTagIds: mode === "add" ? [tagId] : [], removeTagIds: mode === "remove" ? [tagId] : [] });
    onDone(res.error ? { tone: "danger", text: friendlyError(res.error) } : { tone: "ok", text: STR.stbBulkDone.replace("{n}", bnNum(res.data?.bulkTagStoryBooks ?? 0)) });
  };
  return (
    <Card style={{ marginBottom: space(3) }}>
      <Body style={{ fontWeight: "700" }}>{STR.stbBulkSelected.replace("{n}", bnNum(titleIds.length))}</Body>
      <ChipRow>
        {(tagsQ.data?.storyTags ?? []).map((t) => (
          <Chip key={t.id} label={t.nameBn} selected={tagId === t.id} onPress={() => setTagId(t.id)} />
        ))}
      </ChipRow>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <Button title={STR.stbBulkAdd} loading={fetching} onPress={() => void run("add")} />
        <Button title={STR.stbBulkRemove} variant="ghost" onPress={() => void run("remove")} />
      </View>
    </Card>
  );
}

export default function StorySeriesScreen({ route, navigation }: Props): React.ReactElement {
  const { seriesId } = route.params;
  const colors = useColors();
  const { role, can } = useAuth();
  const isGuardian = role === "GUARDIAN";
  const manage = !isGuardian && can("library:edit");
  const { selected: child } = useGuardianChild();
  const studentId = isGuardian ? child?.studentId ?? null : null;
  const childName = isGuardian && child ? child.nameBn || child.name : null;

  const [q, refetch] = useQuery({ query: STORY_SERIES_QUERY, variables: { seriesId, studentId }, pause: isGuardian && !studentId });
  const reload = (): void => refetch({ requestPolicy: "network-only" });
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, reload);
  const [msg, setMsg] = useState<Msg>(null);
  const [editing, setEditing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  const series = q.data?.storySeries.series;
  const books = useMemo(() => q.data?.storySeries.books ?? [], [q.data]);
  const changed = (m: Msg): void => {
    setMsg(m);
    reload();
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
        <QueryGate results={[q]} onRetry={reload} loaderLabel={STR.loading}>
          {series ? (
            <View style={{ gap: space(3) }}>
              <StoryImage fileId={series.coverFileId} />
              <View>
                <Text style={{ ...typeScale.pageTitle, color: colors.textPrimary }}>{series.nameBn}</Text>
                {series.nameEn ? <Muted>{series.nameEn}</Muted> : null}
                <Muted>{STR.stbSeriesMeta.replace("{n}", bnNum(series.bookCount)).replace("{band}", series.ageBandLabel)}</Muted>
                {manage ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
                    <Badge text={series.status === "PUBLISHED" ? STR.stbPublished : series.status === "HIDDEN" ? STR.stbHidden : STR.stbDraft} tone={series.status === "PUBLISHED" ? "ok" : "warn"} />
                    <Badge text={series.code} tone="muted" />
                  </View>
                ) : null}
              </View>
              {series.aboutBn ? <Body>{series.aboutBn}</Body> : null}
              {series.learnPointsBn.length > 0 ? (
                <Card>
                  <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stbLearnTitle}</Body>
                  {series.learnPointsBn.map((p, i) => (
                    <Body key={i}>• {p}</Body>
                  ))}
                </Card>
              ) : null}

              {manage ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                  <Button title={editing ? STR.stbCancel : STR.stbEdit} variant="ghost" onPress={() => setEditing((e) => !e)} />
                  <Button
                    title={selecting ? STR.stbCancel : STR.stbBulkSelect}
                    variant="ghost"
                    onPress={() => {
                      setSelecting((s) => !s);
                      setPicked([]);
                    }}
                  />
                </View>
              ) : null}
              {manage && editing ? <SeriesEditor series={series} onSaved={(m) => changed(m)} /> : null}
              {manage ? <UploadCard seriesId={seriesId} onDone={changed} /> : null}
              {manage && selecting && picked.length > 0 ? <BulkTagBar titleIds={picked} onDone={changed} /> : null}

              <Body style={{ fontWeight: "700" }}>{STR.stbSeriesBooks}</Body>
              {books.length === 0 ? (
                <EmptyState message={STR.stbEmptyGuardian} />
              ) : (
                <View>
                  {books.map((b) => (
                    <BookRow
                      key={b.id}
                      book={b}
                      childName={childName}
                      manage={manage}
                      selecting={selecting}
                      selected={picked.includes(b.id)}
                      onToggle={() => setPicked((cur) => (cur.includes(b.id) ? cur.filter((x) => x !== b.id) : [...cur, b.id]))}
                      onOpen={() => navigation.navigate("StoryBook", { titleId: b.id, title: b.titleBn })}
                      onChanged={changed}
                    />
                  ))}
                </View>
              )}
            </View>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
