/**
 * StoryBookScreen (SB-1, W3) — one storybook: cover, names, what the child learns, the
 * parents' tip, 3 preview pages ("ভেতরে দেখুন") and availability. The waitlist button
 * arrives with SB-3.
 *
 * OFFICE (library:edit): edit the details (Bangla / English name, number, learned points,
 * parents' tip, tags), publish / back to draft, retire / restore, replace the PDF.
 */
import React, { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SET_STORY_BOOK_PUBLISHED, STORY_BOOK_QUERY, STORY_TAGS_QUERY, UPDATE_STORY_BOOK, type StoryBookCardT } from "../../graphql/storybooks";
import { UPDATE_BOOK_TITLE } from "../../graphql/operations";
import { Badge, Body, Button, Card, Chip, ChipRow, Field, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { pickAndUploadStorybooks } from "../../lib/files";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum } from "../../lib/labels";
import type { StorybooksStackParamList } from "../../navigation/types";
import { space, typeScale, useColors } from "../../theme";
import { StoryImage } from "./StoryImage";
import { availabilityLine, availabilityPill } from "./StorySeriesScreen";

type Props = NativeStackScreenProps<StorybooksStackParamList, "StoryBook">;
type Msg = { tone: "ok" | "danger"; text: string } | null;

const lines = (s: string): string[] => s.split("\n").map((x) => x.trim()).filter(Boolean);

function BookEditor({ book, onSaved }: { book: StoryBookCardT; onSaved: (m: Msg) => void }): React.ReactElement {
  const [{ fetching }, update] = useMutation(UPDATE_STORY_BOOK);
  const [tagsQ] = useQuery({ query: STORY_TAGS_QUERY, variables: {} });
  const [titleBn, setTitleBn] = useState(book.titleBn);
  const [titleEn, setTitleEn] = useState(book.titleEn ?? "");
  const [no, setNo] = useState(book.seriesNo != null ? String(book.seriesNo) : "");
  const [learned, setLearned] = useState(book.learnedPointsBn.join("\n"));
  const [tip, setTip] = useState(book.parentTipBn ?? "");
  const [tagIds, setTagIds] = useState<string[]>(book.tagIds);

  const save = async (): Promise<void> => {
    if (!titleBn.trim()) return onSaved({ tone: "danger", text: STR.stbNeedNameBn });
    const res = await update({
      titleId: book.id,
      titleBn,
      titleEn,
      seriesNo: no.trim() ? Number(no) : null,
      learnedPointsBn: lines(learned),
      parentTipBn: tip,
      tagIds,
    });
    onSaved(res.error ? { tone: "danger", text: friendlyError(res.error) } : { tone: "ok", text: STR.stbSaved });
  };

  return (
    <Card style={{ marginBottom: space(3) }}>
      <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.stbEditBook}</Body>
      <Field label={STR.stbTitleBn} value={titleBn} onChangeText={setTitleBn} autoCapitalize="sentences" />
      <Field label={STR.stbTitleEn} value={titleEn} onChangeText={setTitleEn} autoCapitalize="words" />
      <Field label={STR.stbSeriesNo} value={no} onChangeText={setNo} keyboardType="number-pad" />
      <Field label={STR.stbLearnedPoints} value={learned} onChangeText={setLearned} multiline autoCapitalize="sentences" />
      <Field label={STR.stbParentTipField} value={tip} onChangeText={setTip} multiline autoCapitalize="sentences" />
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
      <Button title={STR.stbSave} loading={fetching} onPress={() => void save()} />
    </Card>
  );
}

export default function StoryBookScreen({ route }: Props): React.ReactElement {
  const { titleId } = route.params;
  const colors = useColors();
  const { role, can } = useAuth();
  const isGuardian = role === "GUARDIAN";
  const manage = !isGuardian && can("library:edit");
  const { selected: child } = useGuardianChild();
  const studentId = isGuardian ? child?.studentId ?? null : null;
  const childName = isGuardian && child ? child.nameBn || child.name : null;

  const [q, refetch] = useQuery({ query: STORY_BOOK_QUERY, variables: { titleId, studentId }, pause: isGuardian && !studentId });
  const reload = (): void => refetch({ requestPolicy: "network-only" });
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, reload);
  const [msg, setMsg] = useState<Msg>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [{ fetching: publishing }, publish] = useMutation(SET_STORY_BOOK_PUBLISHED);
  const [{ fetching: retiring }, setActive] = useMutation(UPDATE_BOOK_TITLE);

  const d = q.data?.storyBook;
  const book = d?.book;
  const changed = (m: Msg): void => {
    setMsg(m);
    reload();
  };

  const replace = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await pickAndUploadStorybooks({ titleId });
      if (!r) return;
      changed(r[0]?.ok ? { tone: "ok", text: STR.stbReplaced } : { tone: "danger", text: r[0]?.message ?? "" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
        <QueryGate results={[q]} onRetry={reload} loaderLabel={STR.loading}>
          {book && d ? (
            <View style={{ gap: space(3) }}>
              <StoryImage fileId={book.coverFileId} style={{ maxWidth: 560, alignSelf: "center" }} />
              <View>
                <Text style={{ ...typeScale.pageTitle, color: colors.textPrimary }}>{book.titleBn}</Text>
                {book.titleEn && book.titleEn !== book.titleBn ? <Muted>{book.titleEn}</Muted> : null}
                <Muted>
                  {d.seriesNameBn}
                  {book.seriesNo != null ? ` · ${STR.stbBookNo.replace("{n}", bnNum(book.seriesNo))}` : ""}
                </Muted>
                {book.tagNamesBn.length > 0 ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
                    {book.tagNamesBn.map((t) => (
                      <Badge key={t} text={t} tone="muted" />
                    ))}
                    {manage && book.draft ? <Badge text={STR.stbDraft} tone="warn" /> : null}
                    {manage && !book.active ? <Badge text={STR.stbRetired} tone="muted" /> : null}
                  </View>
                ) : null}
              </View>

              <Card>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                  <View style={{ flex: 1 }}>
                    <Body>{availabilityLine(book)}</Body>
                    {childName && book.childHasNow ? <Muted>{STR.stbChildHasNow.replace("{name}", childName)}</Muted> : null}
                    {childName && !book.childHasNow && book.childReadCount ? (
                      <Muted>{STR.stbChildRead.replace("{name}", childName).replace("{n}", bnNum(book.childReadCount))}</Muted>
                    ) : null}
                  </View>
                  {book.totalCopies > 0 ? <Badge text={availabilityPill(book).text} tone={availabilityPill(book).tone} /> : null}
                </View>
              </Card>

              {book.learnedPointsBn.length > 0 ? (
                <Card>
                  <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stbBookLearnTitle}</Body>
                  {book.learnedPointsBn.map((p, i) => (
                    <Body key={i}>• {p}</Body>
                  ))}
                </Card>
              ) : null}
              {book.parentTipBn ? (
                <Card>
                  <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stbParentTip}</Body>
                  <Body>{book.parentTipBn}</Body>
                </Card>
              ) : null}

              {book.previewFileIds.length > 0 ? (
                <View style={{ gap: space(2) }}>
                  <Body style={{ fontWeight: "700" }}>{STR.stbPreview}</Body>
                  {book.previewFileIds.map((id) => (
                    <StoryImage key={id} fileId={id} style={{ maxWidth: 560, alignSelf: "center" }} />
                  ))}
                </View>
              ) : null}

              {manage ? (
                <View style={{ gap: space(2) }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                    <Button title={editing ? STR.stbCancel : STR.stbEdit} variant="ghost" onPress={() => setEditing((e) => !e)} />
                    {book.active ? (
                      <Button
                        title={book.draft ? STR.stbPublish : STR.stbUnpublish}
                        variant={book.draft ? "primary" : "ghost"}
                        loading={publishing}
                        onPress={() =>
                          void (async () => {
                            const res = await publish({ titleId, published: book.draft });
                            changed(res.error ? { tone: "danger", text: friendlyError(res.error) } : null);
                          })()
                        }
                      />
                    ) : null}
                    <Button title={STR.stbReplacePdf} variant="ghost" loading={busy} onPress={() => void replace()} />
                    <Button
                      title={book.active ? STR.stbRetire : STR.stbRestore}
                      variant={book.active ? "danger" : "secondary"}
                      loading={retiring}
                      onPress={() =>
                        void (async () => {
                          const res = await setActive({ titleId, active: !book.active });
                          changed(res.error ? { tone: "danger", text: friendlyError(res.error) } : null);
                        })()
                      }
                    />
                  </View>
                  {editing ? <BookEditor book={book} onSaved={changed} /> : null}
                </View>
              ) : null}
            </View>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
