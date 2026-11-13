/**
 * WinterBookletScreen (D-#1620) — one winter booklet, page by page.
 *
 *  - Everyone with winter_task:review | manage sees the pages as text blocks, in print order.
 *    Tap a block to suggest a new text (saved as a suggestion, shows before / after); a second
 *    tap on the same block edits the person's own open suggestion. A page note is a comment
 *    with no block. The reviewer edits or deletes her OWN open suggestions only.
 *  - winter_task:manage (the Principal) also sees everyone's suggestions on the page and accepts
 *    or rejects them, can view the accepted text in place, marks the booklet approved and copies
 *    the accepted text for the rebuild.
 */
import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";
import { CombinedError, useClient, useMutation, useQuery } from "urql";
import * as Clipboard from "expo-clipboard";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  DECIDE_WINTER_CHANGE,
  DELETE_WINTER_CHANGE,
  EDIT_WINTER_CHANGE,
  EXPORT_WINTER_BOOKLET_QUERY,
  SET_WINTER_BOOKLET_STATUS,
  SUGGEST_WINTER_CHANGE,
  WINTER_BOOKLET_QUERY,
  WINTER_CHANGES_QUERY,
  type WinterBlockT,
  type WinterChangeT,
  type WinterPageT,
} from "../../graphql/winterTask";
import { Badge, Body, Button, Card, Chip, ChipRow, Field, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { friendlyError } from "../../lib/errors";
import { plainWinterText } from "../../lib/winterText";
import { STR, bnNum } from "../../lib/labels";
import { winterStatusLabel } from "./WinterBookletsScreen";
import type { WinterTaskStackParamList } from "../../navigation/types";
import { radius, space, typeScale, useColors } from "../../theme";

type Props = NativeStackScreenProps<WinterTaskStackParamList, "WinterBooklet">;
type Msg = { tone: "ok" | "danger"; text: string };

function pageTitle(p: WinterPageT): string {
  if (p.kind === "COVER") return STR.wtCover;
  if (p.kind === "TICKSHEET") return STR.wtTick;
  return `${STR.wtDay.replace("{n}", bnNum(p.n - 1))}${p.subject ? ` · ${p.subject}` : ""}`;
}

const changeTone = (s: string): "warn" | "ok" | "muted" => (s === "OPEN" ? "warn" : s === "ACCEPTED" ? "ok" : "muted");
const changeLabel = (s: string): string => (s === "OPEN" ? STR.wtChOpen : s === "ACCEPTED" ? STR.wtChAccepted : STR.wtChRejected);
const shown = (s: string): string => (s.trim() === "" ? STR.wtRemoved : plainWinterText(s));

/** The editor under a tapped block: before / after, an optional comment, save or remove. */
function BlockEditor({
  block,
  mine,
  busy,
  onSave,
  onClose,
}: {
  block: WinterBlockT;
  mine: WinterChangeT | undefined;
  busy: boolean;
  onSave: (after: string, note: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const colors = useColors();
  const [after, setAfter] = useState(mine ? mine.after : block.textBn);
  const [note, setNote] = useState(mine?.note ?? "");
  return (
    <View style={{ marginTop: space(2), padding: space(3), borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
      <Muted>{STR.wtBefore}</Muted>
      <Body style={{ marginBottom: space(2) }}>{plainWinterText(block.textBn)}</Body>
      <Field label={STR.wtAfter} value={after} onChangeText={setAfter} multiline autoCapitalize="sentences" />
      <Field label={STR.wtNoteLabel} value={note} onChangeText={setNote} multiline autoCapitalize="sentences" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        <Button title={STR.wtSuggestSave} loading={busy} onPress={() => onSave(after, note)} />
        <Button title={STR.wtRemoveText} variant="ghost" disabled={busy} onPress={() => onSave("", note)} />
        <Button title={STR.wtCancel} variant="ghost" onPress={onClose} />
      </View>
    </View>
  );
}

export default function WinterBookletScreen({ route }: Props): React.ReactElement {
  const { bookletId } = route.params;
  const colors = useColors();
  const { can } = useAuth();
  const manage = can("winter_task:manage");
  const { confirmAction } = useConfirm();
  const client = useClient();

  const [bq, refetchBook] = useQuery({ query: WINTER_BOOKLET_QUERY, variables: { id: bookletId }, requestPolicy: "cache-and-network" });
  const [cq, refetchChanges] = useQuery({ query: WINTER_CHANGES_QUERY, variables: { bookletId }, requestPolicy: "cache-and-network" });
  const reload = (): void => {
    refetchBook({ requestPolicy: "network-only" });
    refetchChanges({ requestPolicy: "network-only" });
  };
  const { refreshing, onRefresh } = usePullRefresh(bq.fetching || cq.fetching, reload);
  const [, suggest] = useMutation(SUGGEST_WINTER_CHANGE);
  const [, edit] = useMutation(EDIT_WINTER_CHANGE);
  const [, del] = useMutation(DELETE_WINTER_CHANGE);
  const [, decide] = useMutation(DECIDE_WINTER_CHANGE);
  const [, setStatus] = useMutation(SET_WINTER_BOOKLET_STATUS);

  const [pageN, setPageN] = useState(1);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [showAccepted, setShowAccepted] = useState(true);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteEditId, setNoteEditId] = useState<string | null>(null);

  const book = bq.data?.winterBooklet;
  const pages = useMemo<WinterPageT[]>(() => {
    try {
      return book ? (JSON.parse(book.pagesJson) as WinterPageT[]) : [];
    } catch {
      return [];
    }
  }, [book]);
  const changes = cq.data?.winterChanges ?? [];
  const page = pages.find((p) => p.n === pageN) ?? pages[0];
  const pageIdx = page ? pages.indexOf(page) : -1;
  const locked = book?.status === "APPROVED";
  const pageChanges = changes.filter((c) => c.pageN === (page?.n ?? 0));
  const openByPage = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of changes) if (c.status === "OPEN") m.set(c.pageN, (m.get(c.pageN) ?? 0) + 1);
    return m;
  }, [changes]);

  /** Run a mutation with the busy flag and an error / ok message. */
  const run = async (fn: () => Promise<{ error?: CombinedError | undefined }>, ok?: string): Promise<boolean> => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fn();
      if (res.error) {
        setMsg({ tone: "danger", text: friendlyError(res.error) });
        return false;
      }
      if (ok) setMsg({ tone: "ok", text: ok });
      reload();
      return true;
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveBlock = async (block: WinterBlockT, after: string, note: string): Promise<void> => {
    const ok = await run(
      () => suggest({ bookletId, pageN: page.n, blockId: block.id, after, note: note || null }),
      STR.wtSavedMsg,
    );
    if (ok) setEditing(null);
  };

  const savePageNote = async (): Promise<void> => {
    const ok = await run(
      () => (noteEditId ? edit({ id: noteEditId, note: noteText }) : suggest({ bookletId, pageN: page.n, note: noteText })),
      STR.wtSavedMsg,
    );
    if (ok) {
      setNoteText("");
      setNoteEditId(null);
    }
  };

  const removeChange = async (c: WinterChangeT): Promise<void> => {
    const yes = await confirmAction({ title: STR.wtDeleteTitle, message: STR.wtDeleteBody, confirmLabel: STR.wtDelete });
    if (!yes) return;
    await run(() => del({ id: c.id }));
  };

  const exportAccepted = async (): Promise<void> => {
    await run(async () => {
      const r = await client.query(EXPORT_WINTER_BOOKLET_QUERY, { id: bookletId }, { requestPolicy: "network-only" }).toPromise();
      if (r.error || !r.data) return { error: r.error ?? new CombinedError({ networkError: new Error(STR.wtEmpty) }) };
      const json = r.data.exportWinterBooklet;
      setExportJson(null);
      try {
        await Clipboard.setStringAsync(json);
      } catch {
        // No clipboard here: show the text to select and copy by hand.
        setExportJson(json);
        throw new Error(STR.wtCopyFailed);
      }
      return {};
    }, STR.wtExported);
  };

  /** Go to a page (by its real number), leaving any half-written edit behind. */
  const gotoPage = (n: number): void => {
    setPageN(n);
    setEditing(null);
    setNoteEditId(null);
    setNoteText("");
  };

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <QueryGate results={[bq, cq]} onRetry={reload} loaderLabel={STR.wtLoadingBook}>
        {book && page ? (
          <View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginBottom: space(2) }}>
              <Text style={{ ...typeScale.sectionTitle, color: colors.textPrimary }}>{book.classLabelBn}</Text>
              <Badge text={winterStatusLabel(book.status)} tone={book.status === "APPROVED" ? "ok" : "info"} />
            </View>
            {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
            {locked ? <Notice tone="warn" message={STR.wtApprovedLocked} /> : null}
            {exportJson ? <Field label={STR.wtExportBox} value={exportJson} onChangeText={() => undefined} editable={false} multiline /> : null}

            {manage ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginBottom: space(3) }}>
                <Button
                  title={book.status === "APPROVED" ? STR.wtMarkReview : STR.wtMarkApproved}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void run(() => setStatus({ id: bookletId, status: book.status === "APPROVED" ? "IN_REVIEW" : "APPROVED" }))}
                />
                <Button title={STR.wtExport} variant="secondary" disabled={busy} onPress={() => void exportAccepted()} />
                <Button
                  title={showAccepted ? STR.wtShowOriginal : STR.wtShowAccepted}
                  variant="ghost"
                  onPress={() => setShowAccepted((v) => !v)}
                />
              </View>
            ) : null}

            <Muted style={{ marginBottom: space(1) }}>{STR.wtPickPage}</Muted>
            <ChipRow>
              {pages.map((p) => {
                const open = openByPage.get(p.n) ?? 0;
                return (
                  <Chip
                    key={p.n}
                    label={open > 0 ? `${bnNum(p.n)} •` : bnNum(p.n)}
                    selected={p.n === page.n}
                    onPress={() => gotoPage(p.n)}
                  />
                );
              })}
            </ChipRow>

            <Card style={{ marginTop: space(3) }}>
              <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{pageTitle(page)}</Text>
              <Muted style={{ marginBottom: space(3) }}>
                {STR.wtPageOf.replace("{p}", bnNum(page.n)).replace("{n}", bnNum(pages.length))}
                {page.dateKey ? ` · ${page.dateKey}` : ""}
                {" · "}
                {STR.wtTapToEdit}
              </Muted>
              {page.blocks.map((b) => {
                const isLine = b.kind === "line";
                const blockChanges = pageChanges.filter((c) => c.blockId === b.id && c.status === "OPEN");
                const mine = blockChanges.find((c) => c.mine);
                const text = showAccepted && b.acceptedBn !== undefined ? b.acceptedBn : b.textBn;
                return (
                  <View key={b.id} style={{ marginBottom: space(3) }}>
                    {b.labelBn ? <Muted>{b.labelBn}</Muted> : null}
                    <Pressable
                      disabled={isLine || locked}
                      onPress={() => setEditing(editing === b.id ? null : b.id)}
                      style={{
                        paddingVertical: space(1),
                        paddingHorizontal: space(2),
                        borderRadius: radius.sm,
                        borderWidth: 1,
                        borderColor: editing === b.id ? colors.primary : blockChanges.length ? colors.warning : "transparent",
                        borderStyle: isLine ? "dashed" : "solid",
                      }}
                    >
                      <Text
                        style={{
                          ...(b.kind === "heading" ? typeScale.bodyStrong : typeScale.body),
                          color: isLine ? colors.textDisabled : colors.textPrimary,
                        }}
                      >
                        {isLine ? STR.wtLineHint : shown(text)}
                      </Text>
                      {showAccepted && b.acceptedBn !== undefined ? <Muted>{STR.wtAcceptedText}</Muted> : null}
                    </Pressable>
                    {editing === b.id ? (
                      <BlockEditor
                        key={`${b.id}:${mine?.id ?? "new"}:${mine?.editedAt ?? ""}:${b.acceptedBn ?? ""}`}
                        block={{ ...b, textBn: b.acceptedBn ?? b.textBn }}
                        mine={mine}
                        busy={busy}
                        onSave={(after, note) => void saveBlock(b, after, note)}
                        onClose={() => setEditing(null)}
                      />
                    ) : null}
                  </View>
                );
              })}
            </Card>

            <Text style={{ ...typeScale.sectionTitle, color: colors.textPrimary, marginTop: space(4), marginBottom: space(2) }}>
              {STR.wtChangesHere}
            </Text>
            {pageChanges.length === 0 ? <Muted>{STR.wtNoChangesHere}</Muted> : null}
            {pageChanges.map((c) => {
              const block = page.blocks.find((b) => b.id === c.blockId);
              return (
                <Card key={c.id} style={{ marginBottom: space(3) }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginBottom: space(1) }}>
                    <Badge text={changeLabel(c.status)} tone={changeTone(c.status)} />
                    {c.stale ? <Badge text={STR.wtStale} tone="danger" /> : null}
                    {manage ? <Badge text={STR.wtByName.replace("{name}", c.byName)} tone="muted" /> : null}
                  </View>
                  {block?.labelBn ? <Muted>{block.labelBn}</Muted> : null}
                  {c.blockId ? (
                    <View>
                      <Muted>{STR.wtBefore}</Muted>
                      <Body style={{ marginBottom: space(1) }}>{shown(c.before)}</Body>
                      <Muted>{STR.wtAfter}</Muted>
                      <Body style={{ fontWeight: "700" }}>{shown(c.after)}</Body>
                    </View>
                  ) : null}
                  {c.note ? (
                    <Body style={{ marginTop: space(1) }}>
                      {STR.wtNoteIs}: {c.note}
                    </Body>
                  ) : null}
                  {c.status === "OPEN" ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                      {manage ? (
                        <>
                          <Button title={STR.wtAccept} disabled={busy || c.stale || locked} onPress={() => void run(() => decide({ id: c.id, accept: true, seenVersion: c.editedAt ?? "" }))} />
                          <Button title={STR.wtReject} variant="danger" disabled={busy || locked} onPress={() => void run(() => decide({ id: c.id, accept: false, seenVersion: c.editedAt ?? "" }))} />
                        </>
                      ) : null}
                      {c.mine ? (
                        <>
                          {!c.stale ? (
                            <Button
                              title={STR.wtEdit}
                              variant="secondary"
                              disabled={busy || locked}
                              onPress={() => {
                                if (c.blockId) setEditing(c.blockId);
                                else {
                                  setNoteEditId(c.id);
                                  setNoteText(c.note ?? "");
                                }
                              }}
                            />
                          ) : null}
                          <Button title={STR.wtDelete} variant="ghost" disabled={busy || locked} onPress={() => void removeChange(c)} />
                        </>
                      ) : null}
                    </View>
                  ) : null}
                </Card>
              );
            })}

            {locked ? null : (
            <Card style={{ marginTop: space(2) }}>
              <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.wtPageNote}</Body>
              <Field value={noteText} onChangeText={setNoteText} placeholder={STR.wtPageNotePh} multiline autoCapitalize="sentences" />
              <View style={{ flexDirection: "row", gap: space(2) }}>
                <Button title={noteEditId ? STR.wtSaveChange : STR.wtPageNoteAdd} loading={busy} disabled={!noteText.trim()} onPress={() => void savePageNote()} />
                {noteEditId ? (
                  <Button
                    title={STR.wtCancel}
                    variant="ghost"
                    onPress={() => {
                      setNoteEditId(null);
                      setNoteText("");
                    }}
                  />
                ) : null}
              </View>
            </Card>
            )}

            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(4) }}>
              <Button
                title={STR.wtPrev}
                variant="secondary"
                disabled={pageIdx <= 0}
                onPress={() => gotoPage(pages[pageIdx - 1].n)}
              />
              <Button
                title={STR.wtNext}
                variant="secondary"
                disabled={pageIdx >= pages.length - 1}
                onPress={() => gotoPage(pages[pageIdx + 1].n)}
              />
            </View>
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
