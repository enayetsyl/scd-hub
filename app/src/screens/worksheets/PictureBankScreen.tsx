/**
 * Picture bank (D-#746) — every picture lifted from the school's own Nursery books.
 * The Office tags a picture (word, first letter, what it may be used for), hides a
 * fragment, or keeps a picture back for the final exam. Teachers can look, not edit.
 */
import React, { useEffect, useState } from "react";
import { Image, Pressable, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  WORKSHEET_PICTURE_BOOKS,
  WORKSHEET_PICTURE_BOOK_LABELS_BN,
  WORKSHEET_PICTURE_USES,
  WORKSHEET_PICTURE_USE_LABELS_BN,
} from "@scd/shared";
import { UPDATE_WORKSHEET_PICTURE, WORKSHEET_PICTURES, type WorksheetPictureT } from "../../graphql/worksheet";
import { Screen, H2, Body, Muted, Card, Button, Chip, ChipRow, Field, Notice, Badge, Loader } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";

const PAGE = 60;
const bookLabel = (b: string): string =>
  WORKSHEET_PICTURE_BOOK_LABELS_BN[b as keyof typeof WORKSHEET_PICTURE_BOOK_LABELS_BN] ?? b;

export default function PictureBankScreen(): React.ReactElement {
  const { can } = useAuth();
  const canEdit = can("roster:manage");
  const colors = useColors();

  const [book, setBook] = useState<string | null>("BAN");
  const [untagged, setUntagged] = useState(false);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [book, untagged, includeHidden, search]);

  const [q, refetch] = useQuery({
    query: WORKSHEET_PICTURES,
    variables: { book, untagged, includeHidden, search: search.trim() || null, offset: 0, limit },
  });
  const page = q.data?.worksheetPictures ?? null;
  const rows = page?.rows ?? [];

  const [selected, setSelected] = useState<WorksheetPictureT | null>(null);
  const [word, setWord] = useState("");
  const [wordEn, setWordEn] = useState("");
  const [letter, setLetter] = useState("");
  const [pageLetter, setPageLetter] = useState("");
  const [uses, setUses] = useState<string[]>([]);
  const [reserve, setReserve] = useState(false);
  const [active, setActive] = useState(true);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [{ fetching: saving }, update] = useMutation(UPDATE_WORKSHEET_PICTURE);

  const pick = (p: WorksheetPictureT): void => {
    setSelected(p);
    setWord(p.word ?? "");
    setWordEn(p.wordEn ?? "");
    setLetter(p.letter ?? "");
    setPageLetter(p.pageLetter ?? "");
    setUses(p.uses);
    setReserve(p.reserveForFinal);
    setActive(p.active);
    setMsg(null);
  };

  const save = async (): Promise<void> => {
    if (!selected) return;
    const res = await update({ id: selected.id, word, wordEn, letter, pageLetter, uses, reserveForFinal: reserve, active });
    if (res.error || !res.data?.updateWorksheetPicture) {
      setMsg({ tone: "danger", text: friendlyError(res.error) });
      return;
    }
    setSelected(res.data.updateWorksheetPicture);
    setMsg({ tone: "ok", text: STR.wsPlanSaved });
    refetch({ requestPolicy: "network-only" });
  };

  const counts = page?.counts ?? [];

  return (
    <Screen scroll>
      <H2>{STR.wsBank}</H2>
      <Muted style={{ marginBottom: space(3) }}>{STR.wsBankFromBooks}</Muted>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginBottom: space(3) }}>
        {counts.map((c) => (
          <Badge key={c.book} text={`${bookLabel(c.book)} · ${bnNum(c.total)} (${STR.wsBankUntagged} ${bnNum(c.untagged)})`} tone="muted" />
        ))}
      </View>

      <Card>
        <ChipRow>
          <Chip label={STR.wsBankAll} selected={book === null} onPress={() => setBook(null)} />
          {WORKSHEET_PICTURE_BOOKS.map((b) => (
            <Chip key={b} label={bookLabel(b)} selected={book === b} onPress={() => setBook(b)} />
          ))}
        </ChipRow>
        <ChipRow>
          <Chip label={STR.wsBankUntagged} selected={untagged} onPress={() => setUntagged((v) => !v)} />
          <Chip label={STR.wsBankHidden} selected={includeHidden} onPress={() => setIncludeHidden((v) => !v)} />
        </ChipRow>
        <Field label={STR.wsBankSearch} value={search} onChangeText={setSearch} />
      </Card>

      {selected ? (
        <Card>
          <View style={{ flexDirection: "row", gap: space(3), flexWrap: "wrap" }}>
            <Image
              source={{ uri: selected.thumbUri }}
              style={{ width: 160, height: 160, backgroundColor: "#FFFFFF", borderRadius: 8 }}
              resizeMode="contain"
              accessibilityLabel={selected.word ?? ""}
            />
            <View style={{ flexGrow: 1, flexBasis: 220, gap: space(1) }}>
              <Muted>
                {bookLabel(selected.book)} · {STR.wsBankPage} {bnNum(selected.page)} · {bnNum(selected.useCount)} {STR.wsBankUsedTimes}
              </Muted>
              <Field label={STR.wsBankWord} value={word} onChangeText={setWord} editable={canEdit} />
              <Field label={STR.wsBankLetter} value={letter} onChangeText={setLetter} editable={canEdit} />
              <Field label={STR.wsBankPageLetter} value={pageLetter} onChangeText={setPageLetter} editable={canEdit} />
              <Field label={STR.wsBankWordEn} value={wordEn} onChangeText={setWordEn} editable={canEdit} />
            </View>
          </View>
          <Body style={{ marginTop: space(2) }}>{STR.wsBankUses}</Body>
          <ChipRow>
            {WORKSHEET_PICTURE_USES.map((u) => (
              <Chip
                key={u}
                label={WORKSHEET_PICTURE_USE_LABELS_BN[u]}
                selected={uses.includes(u)}
                onPress={() => canEdit && setUses((cur) => (cur.includes(u) ? cur.filter((x) => x !== u) : [...cur, u]))}
              />
            ))}
          </ChipRow>
          <ChipRow>
            <Chip label={STR.wsBankActive} selected={active} onPress={() => canEdit && setActive((v) => !v)} />
            <Chip label={STR.wsBankReserve} selected={reserve} onPress={() => canEdit && setReserve((v) => !v)} />
          </ChipRow>
          {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
          {canEdit ? <Button title={STR.wsBankSave} onPress={() => void save()} loading={saving} /> : null}
        </Card>
      ) : null}

      {q.error ? <Notice tone="danger" message={friendlyError(q.error)} /> : null}
      {q.fetching && !page ? <Loader /> : null}
      {page && rows.length === 0 ? <Muted>{STR.wsBankEmpty}</Muted> : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        {rows.map((p) => {
          const isSel = selected?.id === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => pick(p)}
              accessibilityRole="button"
              accessibilityLabel={p.word ?? `${STR.wsBankPage} ${p.page}`}
              style={{
                width: 132,
                padding: space(2),
                borderRadius: 10,
                borderWidth: isSel ? 2 : 1,
                borderColor: isSel ? colors.primary : colors.border,
                backgroundColor: colors.surface,
                opacity: p.active ? 1 : 0.55,
                gap: 4,
              }}
            >
              <Image source={{ uri: p.thumbUri }} style={{ width: "100%", height: 90, backgroundColor: "#FFFFFF" }} resizeMode="contain" />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                <Body numberOfLines={1} style={{ flexShrink: 1 }}>
                  {p.word ?? "—"}
                </Body>
                {/* the book page's letter first — বাঁশ sits under ঁ, not ব */}
                {p.pageLetter || p.letter ? <Badge text={(p.pageLetter || p.letter) as string} tone="brand" /> : null}
              </View>
              <Muted>
                {STR.wsBankPage} {bnNum(p.page)}
              </Muted>
              <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
                {p.pageLetter && p.letter && p.pageLetter !== p.letter ? (
                  <Badge text={`${STR.wsBankFirstShort} ${p.letter}`} tone="muted" />
                ) : null}
                {!p.active ? <Badge text={STR.wsBankHiddenBadge} tone="muted" /> : null}
                {p.reserveForFinal ? <Badge text={STR.wsBankReservedBadge} tone="gold" /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {page && rows.length < page.total ? (
        <View style={{ marginTop: space(3) }}>
          <Button title={`${STR.wsBankMore} (${bnNum(rows.length)}/${bnNum(page.total)})`} variant="secondary" onPress={() => setLimit((l) => l + PAGE)} />
        </View>
      ) : null}
    </Screen>
  );
}
