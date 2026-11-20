/**
 * BookPdfAdminScreen (PB-1, D-#1657; nov-ops F4) — Office / Principal (class_books:manage) upload a
 * school book's printed PDF and set each chapter's page range. A re-upload keeps the ranges; the
 * chapter list can be filled from the book's own chapter keys (the same keys the plan Book tab
 * uses). Pages render on the server — a PROCESSING book is polled until it settles.
 */
import React from "react";
import { RefreshControl, Text, View } from "react-native";
import { useClient, useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  BOOK_CHAPTER_KEYS,
  BOOK_PDF_ADMIN_SHELF,
  DELETE_BOOK_PDF,
  SET_BOOK_PDF_CHAPTERS,
  UPDATE_BOOK_PDF,
  type BookPdfAdminRowT,
} from "../../graphql/bookPdf";
import { Badge, Button, Card, EmptyState, Field, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useConfirm } from "../../state/ConfirmContext";
import { FileUploadError, pickAndUploadBookPdf } from "../../lib/files";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { STR, bnNum, classLevelLabel, subjectLabel } from "../../lib/labels";
import type { ClassBooksStackParamList } from "../../navigation/types";
import { space, typeScale, useColors } from "../../theme";

type Props = NativeStackScreenProps<ClassBooksStackParamList, "BookPdfAdmin">;
type Msg = { tone: "ok" | "danger"; text: string };
interface Row {
  key: string;
  title: string;
  from: string;
  to: string;
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const toAscii = (s: string): string => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d))).replace(/[^0-9]/g, "");

function BookCard({ row, onChanged }: { row: BookPdfAdminRowT; onChanged: (m?: Msg) => void }): React.ReactElement {
  const colors = useColors();
  const client = useClient();
  const { confirmAction } = useConfirm();
  const pdf = row.pdf;
  const [version, setVersion] = React.useState(pdf?.versionLabel ?? "");
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const toRows = (): Row[] => (pdf?.chapters ?? []).map((c) => ({ key: c.key, title: c.title, from: String(c.fromPage), to: String(c.toPage) }));
  const [rows, setRows] = React.useState<Row[]>(toRows);
  const [{ fetching: saving }, setChapters] = useMutation(SET_BOOK_PDF_CHAPTERS);
  const [, update] = useMutation(UPDATE_BOOK_PDF);
  const [, del] = useMutation(DELETE_BOOK_PDF);
  const [localMsg, setLocalMsg] = React.useState<Msg | null>(null);
  // The chapters saved on the server change after a save: show them.
  const sig = JSON.stringify(pdf?.chapters ?? []);
  React.useEffect(() => {
    setRows(toRows());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const upload = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await pickAndUploadBookPdf({ bookCode: row.bookCode, versionLabel: version });
      if (!res) return;
      onChanged({ tone: "ok", text: STR.bpdUploaded });
    } catch (e) {
      onChanged({ tone: "danger", text: e instanceof FileUploadError ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const fillFromBook = async (): Promise<void> => {
    const r = await client.query(BOOK_CHAPTER_KEYS, { bookCode: row.bookCode }, { requestPolicy: "network-only" }).toPromise();
    if (r.error) return setLocalMsg({ tone: "danger", text: friendlyError(r.error) });
    const have = new Set(rows.map((x) => x.key));
    const add = (r.data?.bookChapterKeys ?? []).filter((c) => !have.has(c.key)).map((c) => ({ key: c.key, title: c.title, from: "", to: "" }));
    setRows([...rows, ...add]);
  };

  const patch = (i: number, p: Partial<Row>): void => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const saveChapters = async (): Promise<void> => {
    const chapters = rows
      .filter((r) => r.key.trim() && (r.from || r.to))
      .map((r) => ({ key: r.key.trim(), title: r.title.trim(), fromPage: Number(toAscii(r.from)), toPage: Number(toAscii(r.to)) }));
    if (chapters.some((c) => !c.fromPage || !c.toPage || c.toPage < c.fromPage)) return setLocalMsg({ tone: "danger", text: STR.bpdBadRange });
    const res = await setChapters({ bookCode: row.bookCode, chapters });
    if (res.error) return setLocalMsg({ tone: "danger", text: friendlyError(res.error) });
    setLocalMsg({ tone: "ok", text: STR.bpdSaved });
    onChanged();
  };

  const ready = pdf?.status === "READY";
  return (
    <Card style={{ marginBottom: space(3) }}>
      <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{row.titleBn}</Text>
      <Muted>
        {row.bookCode} · {classLevelLabel(row.classLevel)} · {subjectLabel(row.subject)}
        {pdf?.pageCount ? ` · ${STR.bpdPageCount.replace("{n}", bnNum(pdf.pageCount))}` : ""}
      </Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) }}>
        {!pdf ? <Badge text={STR.bpdNoPdf} tone="muted" /> : null}
        {pdf?.status === "PROCESSING" ? <Badge text={STR.bpdProcessing} tone="info" /> : null}
        {pdf?.status === "FAILED" ? <Badge text={STR.cbFailed} tone="danger" /> : null}
        {pdf?.replacing ? <Badge text={STR.bpdReplacing} tone="info" /> : null}
        {pdf && !pdf.active ? <Badge text={STR.bpdHidden} tone="warn" /> : null}
      </View>
      {pdf?.error ? <Muted style={{ color: colors.error }}>{pdf.error}</Muted> : null}
      {pdf?.sourceName ? <Muted>{pdf.sourceName}</Muted> : null}

      <View style={{ marginTop: space(2) }}>
        <Field label={STR.bpdVersion} value={version} onChangeText={setVersion} autoCapitalize="none" />
        <Button title={pdf ? STR.bpdReplace : STR.bpdUpload} loading={busy} disabled={pdf?.status === "PROCESSING" || !!pdf?.replacing} onPress={() => void upload()} />
      </View>

      {pdf ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
          {ready ? <Button title={`${open ? "▾" : "▸"} ${STR.bpdChaptersTitle}`} variant="ghost" onPress={() => setOpen(!open)} /> : null}
          <Button
            title={pdf.active ? STR.bpdHide : STR.bpdShow}
            variant="ghost"
            onPress={() =>
              void update({ bookCode: row.bookCode, active: !pdf.active }).then((r) => onChanged(r.error ? { tone: "danger", text: friendlyError(r.error) } : undefined))
            }
          />
          <Button
            title={STR.bpdDelete}
            variant="ghost"
            onPress={() =>
              void (async () => {
                const ok = await confirmAction({ title: STR.bpdDelete, message: STR.bpdDeleteAsk, confirmLabel: STR.bpdDelete });
                if (!ok) return;
                const r = await del({ bookCode: row.bookCode });
                onChanged(r.error ? { tone: "danger", text: friendlyError(r.error) } : undefined);
              })()
            }
          />
        </View>
      ) : null}

      {open && ready ? (
        <View style={{ marginTop: space(3) }}>
          {localMsg ? <Notice tone={localMsg.tone} message={localMsg.text} /> : null}
          {rows.map((r, i) => (
            <View key={`${r.key}-${i}`} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space(2), marginTop: space(2) }}>
              <Field label={STR.bpdKey} value={r.key} onChangeText={(t) => patch(i, { key: t })} />
              <Field label={STR.bpdTitle} value={r.title} onChangeText={(t) => patch(i, { title: t })} autoCapitalize="sentences" />
              <View style={{ flexDirection: "row", gap: space(2) }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Field label={STR.bpdFrom} value={r.from} onChangeText={(t) => patch(i, { from: toAscii(t) })} keyboardType="number-pad" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Field label={STR.bpdTo} value={r.to} onChangeText={(t) => patch(i, { to: toAscii(t) })} keyboardType="number-pad" />
                </View>
              </View>
              <Button title={STR.bpdRemoveChapter} variant="ghost" onPress={() => setRows(rows.filter((_x, j) => j !== i))} />
            </View>
          ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(3) }}>
            <Button title={STR.bpdFillFromBook} variant="secondary" onPress={() => void fillFromBook()} />
            <Button title={STR.bpdAddChapter} variant="ghost" onPress={() => setRows([...rows, { key: "", title: "", from: "", to: "" }])} />
          </View>
          <View style={{ marginTop: space(3) }}>
            <Button title={STR.bpdSaveChapters} loading={saving} onPress={() => void saveChapters()} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

export default function BookPdfAdminScreen(_props: Props): React.ReactElement {
  const [q, refetch] = useQuery({ query: BOOK_PDF_ADMIN_SHELF, requestPolicy: "cache-and-network" });
  const pull = usePullRefresh(q.fetching, () => refetch({ requestPolicy: "network-only" }));
  const [msg, setMsg] = React.useState<Msg | null>(null);
  const rows = q.data?.bookPdfAdminShelf ?? [];
  const busy = rows.some((r) => r.pdf?.status === "PROCESSING" || r.pdf?.replacing);
  React.useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => refetch({ requestPolicy: "network-only" }), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}>
      <Notice tone="info" message={STR.bpdAdminHint} />
      {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
      <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} isEmpty={rows.length === 0} empty={<EmptyState message={STR.bpdEmpty} />}>
        {rows.map((r) => (
          <BookCard
            key={r.bookCode}
            row={r}
            onChanged={(m) => {
              setMsg(m ?? null);
              refetch({ requestPolicy: "network-only" });
            }}
          />
        ))}
      </QueryGate>
    </Screen>
  );
}
