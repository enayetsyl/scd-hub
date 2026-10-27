/**
 * ClassBooksScreen (D-#870) — the বই tab: classroom books read page by page, view only.
 *
 *  - GUARDIAN: the selected child's class books (myClassBooks, filtered to the child's
 *    class level). A family with two children switches with the child chooser.
 *  - STAFF (class_books:view): every class's books, filterable by class.
 *  - OFFICE (class_books:manage): also uploads a PDF (rendered to page images on the
 *    server, the PDF itself is not kept), renames, re-orders, hides/shows and deletes.
 *    A PROCESSING book polls until its pages are ready.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ROSTER_CLASS_LEVELS } from "@scd/shared";
import {
  CLASS_BOOKS_QUERY,
  CLASS_BOOK_PAGE_QUERY,
  DELETE_CLASS_BOOK,
  MY_CLASS_BOOKS_QUERY,
  UPDATE_CLASS_BOOK,
  type ClassBookT,
} from "../../graphql/classBooks";
import { Badge, Body, Button, Card, Chip, ChipRow, EmptyState, Field, Loader, Muted, Notice, Screen, Select } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { useRecordView } from "../../lib/useRecordView";
import { usePullRefresh } from "../../lib/useRefresh";
import { FileUploadError, pickAndUploadClassBook } from "../../lib/files";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, classLevelLabel } from "../../lib/labels";
import type { ClassBooksStackParamList } from "../../navigation/types";
import { radius, space, typeScale, useColors } from "../../theme";

type Props = NativeStackScreenProps<ClassBooksStackParamList, "ClassBooks">;

/** Page 1 as a small cover; nothing until the book is READY. */
function Cover({ book }: { book: ClassBookT }): React.ReactElement {
  const colors = useColors();
  const [q] = useQuery({
    query: CLASS_BOOK_PAGE_QUERY,
    variables: { bookId: book.id, page: 1 },
    pause: book.status !== "READY",
  });
  const uri = q.data?.classBookPage?.dataUri;
  const w = 72;
  return (
    <View
      style={{
        width: w,
        height: Math.round(w * (book.pageAspect || 1.36)),
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: "#FFFFFF",
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
      ) : (
        <Text style={{ fontSize: 26 }}>📘</Text>
      )}
      {/* Blocks the browser's "save image" on the cover too. */}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
    </View>
  );
}

function BookRow({
  book,
  manage,
  onOpen,
  onChanged,
}: {
  book: ClassBookT;
  manage: boolean;
  onOpen: () => void;
  onChanged: (msg?: { tone: "ok" | "danger"; text: string }) => void;
}): React.ReactElement {
  const colors = useColors();
  const { confirmAction } = useConfirm();
  const [{ fetching: saving }, update] = useMutation(UPDATE_CLASS_BOOK);
  const [{ fetching: deleting }, del] = useMutation(DELETE_CLASS_BOOK);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(book.title);
  const [order, setOrder] = useState(String(book.sortOrder));
  const ready = book.status === "READY";

  const save = async (vars: { title?: string; sortOrder?: number; active?: boolean }): Promise<void> => {
    const res = await update({ id: book.id, ...vars });
    if (res.error) return onChanged({ tone: "danger", text: friendlyError(res.error) });
    setRenaming(false);
    onChanged();
  };

  return (
    <Card onPress={ready ? onOpen : undefined} style={{ marginBottom: space(3) }}>
      <View style={{ flexDirection: "row", gap: space(3), alignItems: "center" }}>
        <Cover book={book} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{book.title}</Text>
          <Muted>
            {classLevelLabel(book.classLevel)}
            {ready ? ` · ${STR.cbPages.replace("{n}", bnNum(book.pageCount))}` : ""}
          </Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) }}>
            {book.status === "PROCESSING" ? <Badge text={STR.cbProcessing} tone="info" /> : null}
            {book.status === "FAILED" ? <Badge text={STR.cbFailed} tone="danger" /> : null}
            {manage && !book.active ? <Badge text={STR.cbHidden} tone="warn" /> : null}
          </View>
          {book.status === "FAILED" && book.error ? <Muted style={{ color: colors.error }}>{book.error}</Muted> : null}
        </View>
        {ready ? <Button title={STR.cbOpen} variant="secondary" onPress={onOpen} /> : null}
      </View>

      {manage ? (
        renaming ? (
          <View style={{ marginTop: space(3) }}>
            <Field label={STR.cbUploadName} value={name} onChangeText={setName} autoCapitalize="sentences" />
            <Field label={STR.cbUploadOrder} value={order} onChangeText={setOrder} keyboardType="number-pad" />
            <View style={{ flexDirection: "row", gap: space(2) }}>
              <Button
                title={STR.cbSave}
                loading={saving}
                onPress={() => void save({ title: name, sortOrder: Number(order) || 0 })}
              />
              <Button title={STR.cbCancel} variant="ghost" onPress={() => setRenaming(false)} />
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(3) }}>
            <Button title={STR.cbRename} variant="ghost" onPress={() => setRenaming(true)} />
            {ready ? (
              <Button
                title={book.active ? STR.cbHide : STR.cbShow}
                variant="ghost"
                loading={saving}
                onPress={() => void save({ active: !book.active })}
              />
            ) : null}
            <Button
              title={STR.cbDelete}
              variant="danger"
              loading={deleting}
              onPress={() =>
                void (async () => {
                  const ok = await confirmAction({ title: STR.cbDeleteTitle, message: STR.cbDeleteBody, confirmLabel: STR.cbDelete });
                  if (!ok) return;
                  const res = await del({ id: book.id });
                  if (res.error) return onChanged({ tone: "danger", text: friendlyError(res.error) });
                  onChanged();
                })()
              }
            />
          </View>
        )
      ) : null}
    </Card>
  );
}

/** The Office's upload card. */
function UploadCard({ onUploaded }: { onUploaded: (msg: { tone: "ok" | "danger"; text: string }) => void }): React.ReactElement {
  const [level, setLevel] = useState<string>("-1");
  const [title, setTitle] = useState("");
  const [order, setOrder] = useState("0");
  const [busy, setBusy] = useState(false);
  const options = ROSTER_CLASS_LEVELS.map((l) => ({ value: String(l), label: classLevelLabel(l) }));
  const upload = async (): Promise<void> => {
    if (!title.trim()) return onUploaded({ tone: "danger", text: STR.cbNeedName });
    setBusy(true);
    try {
      const res = await pickAndUploadClassBook({ classLevel: Number(level), title: title.trim(), sortOrder: Number(order) || 0 });
      if (!res) return;
      setTitle("");
      onUploaded({ tone: "ok", text: STR.cbUploaded });
    } catch (e) {
      onUploaded({ tone: "danger", text: e instanceof FileUploadError ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ marginBottom: space(4) }}>
      <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.cbUploadTitle}</Body>
      <Select label={STR.cbUploadClass} value={level} options={options} onChange={setLevel} />
      <Field label={STR.cbUploadName} value={title} onChangeText={setTitle} placeholder={STR.cbUploadNamePh} autoCapitalize="sentences" />
      <Field label={STR.cbUploadOrder} value={order} onChangeText={setOrder} keyboardType="number-pad" />
      <Button title={busy ? STR.cbUploading : STR.cbUploadPick} loading={busy} onPress={() => void upload()} />
      <Muted style={{ marginTop: space(2) }}>{STR.cbUploadHint}</Muted>
    </Card>
  );
}

export default function ClassBooksScreen({ navigation }: Props): React.ReactElement {
  const { role, can } = useAuth();
  const isGuardian = role === "GUARDIAN";
  const manage = !isGuardian && can("class_books:manage");
  const { selected } = useGuardianChild();
  useRecordView("BOOKS", isGuardian ? selected?.studentId : null);

  const [staffQ, refetchStaff] = useQuery({ query: CLASS_BOOKS_QUERY, variables: {}, pause: isGuardian });
  const [mineQ, refetchMine] = useQuery({ query: MY_CLASS_BOOKS_QUERY, pause: !isGuardian });
  const refetch = (): void => {
    const opts = { requestPolicy: "network-only" as const };
    if (isGuardian) refetchMine(opts);
    else refetchStaff(opts);
  };
  const { refreshing, onRefresh } = usePullRefresh(isGuardian ? mineQ.fetching : staffQ.fetching, refetch);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [filter, setFilter] = useState<number | "all">("all");

  const all = useMemo(
    () => (isGuardian ? mineQ.data?.myClassBooks : staffQ.data?.classBooks) ?? [],
    [isGuardian, mineQ.data, staffQ.data],
  );
  const books = useMemo(() => {
    if (isGuardian) return selected ? all.filter((b) => b.classLevel === selected.classLevel) : [];
    return filter === "all" ? all : all.filter((b) => b.classLevel === filter);
  }, [all, isGuardian, selected, filter]);
  const levels = useMemo(() => [...new Set(all.map((b) => b.classLevel))].sort((a, b) => a - b), [all]);

  // A book that is still being rendered: look again every 5 s until it settles.
  const processing = all.some((b) => b.status === "PROCESSING");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(refetch, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processing]);

  const open = (b: ClassBookT): void =>
    navigation.navigate("ClassBookReader", { bookId: b.id, title: b.title, pageCount: b.pageCount, pageAspect: b.pageAspect });

  return (
    <Screen padded={false}>
      {isGuardian ? (
        <View style={{ padding: space(4), paddingBottom: 0 }}>
          <ChildSwitcher />
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Notice tone="info" message={isGuardian ? STR.cbGuardianHint : STR.cbStaffHint} />
        {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
        {manage ? (
          <UploadCard
            onUploaded={(m) => {
              setMsg(m);
              if (m.tone === "ok") refetch();
            }}
          />
        ) : null}
        {!isGuardian && levels.length > 1 ? (
          <ChipRow>
            <Chip label={STR.all} selected={filter === "all"} onPress={() => setFilter("all")} />
            {levels.map((l) => (
              <Chip key={l} label={classLevelLabel(l)} selected={filter === l} onPress={() => setFilter(l)} />
            ))}
          </ChipRow>
        ) : null}
        {!isGuardian && processing ? (
          <Pressable onPress={refetch} style={{ alignSelf: "flex-start", marginBottom: space(2) }}>
            <Muted>↻ {STR.cbRefresh}</Muted>
          </Pressable>
        ) : null}
        {isGuardian && !selected ? (
          <Loader label={STR.loading} />
        ) : (
          <QueryGate results={[isGuardian ? mineQ : staffQ]} onRetry={refetch} loaderLabel={STR.loading}>
            {books.length === 0 ? (
              <EmptyState
                message={
                  isGuardian && selected
                    ? STR.cbEmptyGuardian.replace("{class}", classLevelLabel(selected.classLevel))
                    : STR.cbEmpty
                }
              />
            ) : (
              <View style={{ marginTop: space(3) }}>
                {books.map((b) => (
                  <BookRow
                    key={b.id}
                    book={b}
                    manage={manage}
                    onOpen={() => open(b)}
                    onChanged={(m) => {
                      if (m) setMsg(m);
                      refetch();
                    }}
                  />
                ))}
              </View>
            )}
          </QueryGate>
        )}
      </ScrollView>
    </Screen>
  );
}
