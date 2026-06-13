/**
 * CatalogManageScreen (LB-4, `library:manage`) — add titles, add copies by
 * accession number (duplicate rejected server-side, J-L1), withdraw/restore
 * copies (WITHDRAWN never deletes, D-#82), toggle a title active/inactive.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import { BOOK_LANGUAGES } from "@scd/shared";
import {
  BOOK_TITLES_QUERY,
  BOOK_TITLE_QUERY,
  CREATE_BOOK_TITLE,
  UPDATE_BOOK_TITLE,
  ADD_BOOK_COPY,
  SET_COPY_STATUS,
} from "../../graphql/operations";
import { Screen, Body, Muted, Card, Button, Badge, Chip, ChipRow, Field, Notice, Loader } from "../../components/ui";
import { STR, bnNum, bookLanguageLabel, copyStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function CatalogManageScreen(): React.ReactElement {
  // New-title form
  const [titleBn, setTitleBn] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [author, setAuthor] = useState("");
  const [language, setLanguage] = useState<string>("BANGLA");
  const [category, setCategory] = useState("");
  const [isbn, setIsbn] = useState("");
  const [shelf, setShelf] = useState("");
  // List + per-title editing
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newAccession, setNewAccession] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [titlesQ, refetchTitles] = useQuery({
    query: BOOK_TITLES_QUERY,
    variables: { search: search.trim() || null, language: null, includeInactive: true },
  });
  const [detailQ, refetchDetail] = useQuery({
    query: BOOK_TITLE_QUERY,
    variables: { titleId: selectedId ?? "" },
    pause: !selectedId,
  });

  const [, createTitle] = useMutation(CREATE_BOOK_TITLE);
  const [, updateTitle] = useMutation(UPDATE_BOOK_TITLE);
  const [, addCopy] = useMutation(ADD_BOOK_COPY);
  const [, setCopyStatus] = useMutation(SET_COPY_STATUS);

  const titles = titlesQ.data?.bookTitles ?? [];
  const detail = selectedId ? detailQ.data?.bookTitle ?? null : null;

  function refresh(): void {
    refetchTitles({ requestPolicy: "network-only" });
    if (selectedId) refetchDetail({ requestPolicy: "network-only" });
  }

  async function run(action: () => Promise<{ error?: unknown }>, okMsg: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await action();
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error as never));
      return false;
    }
    setOk(okMsg);
    refresh();
    return true;
  }

  async function runCreate(): Promise<void> {
    const created = await run(
      () =>
        createTitle({
          titleBn: titleBn.trim(),
          titleEn: titleEn.trim() || null,
          author: author.trim() || null,
          language,
          category: category.trim() || null,
          isbn: isbn.trim() || null,
          shelf: shelf.trim() || null,
        }),
      STR.libTitleCreated,
    );
    if (created) {
      setTitleBn("");
      setTitleEn("");
      setAuthor("");
      setCategory("");
      setIsbn("");
      setShelf("");
    }
  }

  return (
    <Screen scroll>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      {/* New title (J-L1) */}
      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.libNewTitle}</Body>
      <Field label={STR.libTitleBn} value={titleBn} onChangeText={setTitleBn} />
      <Field label={STR.libTitleEn} value={titleEn} onChangeText={setTitleEn} />
      <Field label={STR.libAuthor} value={author} onChangeText={setAuthor} />
      <ChipRow>
        {BOOK_LANGUAGES.map((lng) => (
          <Chip key={lng} label={bookLanguageLabel(lng)} selected={language === lng} onPress={() => setLanguage(lng)} />
        ))}
      </ChipRow>
      <Field label={STR.libCategory} value={category} onChangeText={setCategory} />
      <Field label={STR.libIsbn} value={isbn} onChangeText={setIsbn} />
      <Field label={STR.libShelf} value={shelf} onChangeText={setShelf} />
      <Button title={STR.libNewTitle} onPress={() => void runCreate()} loading={busy} disabled={busy || titleBn.trim() === ""} />

      {/* Catalog list */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(1) }}>{STR.libCatalogManage}</Body>
      <Field label={STR.libSearch} value={search} onChangeText={setSearch} />
      {titlesQ.fetching ? <Loader /> : null}
      {titles.map((t) => (
        <Card key={t.id} onPress={() => setSelectedId(selectedId === t.id ? null : t.id)}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
            <Body style={{ flex: 1, fontWeight: "700" }}>{t.titleBn}</Body>
            <Badge text={t.active ? STR.libTitleActive : STR.libTitleInactive} tone={t.active ? "ok" : "muted"} />
          </View>
          <Muted>
            {t.author ?? "—"} · {bookLanguageLabel(t.language)} · {bnNum(t.availableCopies)}/{bnNum(t.totalCopies)} {STR.libCopiesWord}
          </Muted>

          {selectedId === t.id ? (
            <View style={{ marginTop: space(2) }}>
              <Button
                title={STR.libToggleActive}
                variant="secondary"
                onPress={() => void run(() => updateTitle({ titleId: t.id, active: !t.active }), STR.libTitleUpdated)}
                disabled={busy}
              />

              <Body style={{ fontWeight: "700", marginTop: space(2), marginBottom: space(1) }}>{STR.libCopies}</Body>
              {(detail?.copies ?? []).map((c) => (
                <View
                  key={c.id}
                  style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2), paddingVertical: 4 }}
                >
                  <Body style={{ flex: 1 }}>{c.accessionNo}</Body>
                  <Badge text={copyStatusLabel(c.status)} tone={c.status === "AVAILABLE" ? "ok" : c.status === "WITHDRAWN" ? "muted" : "warn"} />
                  {c.status === "AVAILABLE" ? (
                    <Button
                      title={STR.libWithdraw}
                      variant="danger"
                      onPress={() => void run(() => setCopyStatus({ copyId: c.id, status: "WITHDRAWN" }), STR.libCopyUpdated)}
                      disabled={busy}
                    />
                  ) : c.status === "WITHDRAWN" || c.status === "LOST" || c.status === "DAMAGED" ? (
                    <Button
                      title={STR.libRestore}
                      variant="secondary"
                      onPress={() => void run(() => setCopyStatus({ copyId: c.id, status: "AVAILABLE" }), STR.libCopyUpdated)}
                      disabled={busy}
                    />
                  ) : null}
                </View>
              ))}

              <Field label={STR.libAccessionNo} value={newAccession} onChangeText={setNewAccession} />
              <Button
                title={STR.libAddCopy}
                onPress={() =>
                  void run(() => addCopy({ titleId: t.id, accessionNo: newAccession.trim() }), STR.libCopyAdded).then(
                    (done) => done && setNewAccession(""),
                  )
                }
                loading={busy}
                disabled={busy || newAccession.trim() === ""}
              />
            </View>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
