/**
 * S3 সংস্করণ — the version page (docs/prd-book-lifecycle.md §8): status + stamps + actions (approve
 * without review, mark final), files with "পুরোনো" stale flags + uploads, the change list, the reader
 * (chapter list → rendered chapter) and তুলনা (word-level diff against any other version).
 */
import React, { useState } from "react";
import { Platform, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BOOK_EDITION_LABELS_BN, type BookEdition } from "@scd/shared";
import { BL_BOOK, BL_CHAPTER, BL_DIFF, BL_DIRECT_FIX, BL_MARK_FINAL, BL_VERSION, BL_VERSIONS } from "../../graphql/bookLifecycle";
import { Badge, Body, Button, Card, Chip, ChipRow, Muted, Screen, Select } from "../../components/ui";
import Markdown from "../../components/Markdown";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { friendlyError } from "../../lib/errors";
import { openStoredFile } from "../../lib/files";
import { downloadBookLcMaster, pickBookLcFile, postBookLc } from "../../lib/bookLcFiles";
import type { BookLcStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { BL } from "./blStrings";
import { DiffView, Line, SectionTitle, useMsg, ymd } from "./blCommon";

type Props = NativeStackScreenProps<BookLcStackParamList, "BookLcVersion">;

const ROLE_BN: Record<string, string> = { master_md: "মাস্টার .md", master_docx: "মাস্টার DOCX", master_pdf: "মাস্টার PDF", edition: "সংস্করণ-ফাইল" };

export default function BookLcVersionScreen({ route }: Props): React.ReactElement {
  const { versionId } = route.params;
  const { can } = useAuth();
  const { confirmAction } = useConfirm();
  const manage = can("book_lifecycle:manage");
  const finalize = can("book_lifecycle:finalize");
  const [q, refetch] = useQuery({ query: BL_VERSION, variables: { id: versionId }, requestPolicy: "cache-and-network" });
  const v = q.data?.bookLcVersion;
  const [bq] = useQuery({ query: BL_BOOK, variables: { id: v?.bookId ?? "" }, pause: !v });
  const [others] = useQuery({ query: BL_VERSIONS, variables: { bookId: v?.bookId ?? "", page: 1, pageSize: 50 }, pause: !v });
  const [readKey, setReadKey] = useState<string | null>(null);
  const [cq, refetchC] = useQuery({ query: BL_CHAPTER, variables: { versionId, key: readKey ?? "" }, pause: !readKey });
  const [cmpWith, setCmpWith] = useState<string | null>(null);
  const [dq, refetchDiff] = useQuery({ query: BL_DIFF, variables: { fromVersionId: cmpWith ?? "", toVersionId: versionId }, pause: !cmpWith });
  const [{ fetching: approving }, approve] = useMutation(BL_DIRECT_FIX);
  const [{ fetching: finalizing }, final] = useMutation(BL_MARK_FINAL);
  const [msg, setMsg] = useMsg();
  const [edition, setEdition] = useState<string>("TEACHER");
  const [busy, setBusy] = useState(false);
  const book = bq.data?.bookLcBook;

  const upload = async (role: "master_pdf" | "master_docx" | "edition"): Promise<void> => {
    const f = await pickBookLcFile(role === "master_pdf" ? "pdf" : role === "master_docx" ? "docx" : "any");
    if (!f) return;
    setBusy(true);
    try {
      await postBookLc("version-file", { versionId, role, edition: role === "edition" ? edition : null }, { file: f });
      refetch({ requestPolicy: "network-only" });
      setMsg({ tone: "ok", text: BL.done });
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const basisBn = (b: string | null) => (b === "round" ? BL.basisRound : b === "inherited" ? BL.basisInherited : b === "imported" ? BL.basisImported : BL.basisNone);

  return (
    <Screen scroll>
      <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })}>
        {v ? (
          <>
            <Card>
              <Body style={{ fontWeight: "700" }}>
                {v.labelBn} — {v.statusBn}
              </Body>
              <Muted>{v.changeSummaryBn || "—"}</Muted>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                {v.reviewSkippedAt ? <Badge text={BL.stampSkipped} tone="warn" /> : null}
                {v.selfReviewed ? <Badge text={BL.stampSelf} tone="muted" /> : null}
                {v.importedAt ? <Badge text={BL.stampImported} tone="muted" /> : null}
                {v.recordedFromPaperName ? <Badge text={`${BL.stampPaper} — ${v.recordedFromPaperName}, ${ymd(v.recordedFromPaperAt)}`} tone="info" /> : null}
              </View>
              <Line label={BL.basis} value={basisBn(v.approvalBasis)} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                {finalize && v.status === "draft" ? (
                  <Button
                    title={BL.approveDirect}
                    variant="secondary"
                    loading={approving}
                    onPress={() =>
                      void (async () => {
                        if (!(await confirmAction({ title: BL.approveDirect, message: BL.confirmDirect, confirmLabel: BL.approveDirect }))) return;
                        const r = await approve({ versionId });
                        setMsg(r.error ? { tone: "danger", text: friendlyError(r.error) } : { tone: "ok", text: BL.done });
                        refetch({ requestPolicy: "network-only" });
                      })()
                    }
                  />
                ) : null}
                {finalize && v.status === "approved" ? (
                  <Button
                    title={BL.markFinal}
                    loading={finalizing}
                    onPress={() =>
                      void (async () => {
                        if (!(await confirmAction({ title: BL.markFinal, message: BL.confirmFinal, confirmLabel: BL.markFinal }))) return;
                        const r = await final({ versionId });
                        setMsg(r.error ? { tone: "danger", text: friendlyError(r.error) } : { tone: "ok", text: BL.done });
                        refetch({ requestPolicy: "network-only" });
                      })()
                    }
                  />
                ) : null}
                <Button
                  title={BL.downloadMd}
                  variant="ghost"
                  onPress={() => (Platform.OS === "web" ? void downloadBookLcMaster(versionId, `${book?.code ?? "book"}_${v.label}.md`).catch((e) => setMsg({ tone: "danger", text: String(e) })) : setMsg({ tone: "info", text: BL.webOnly }))}
                />
              </View>
            </Card>
            {msg}

            <SectionTitle>{BL.files}</SectionTitle>
            {v.files.map((f, i) => (
              <Card key={i} style={{ marginBottom: space(2) }} onPress={() => void openStoredFile(f.fileId)}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
                  <Body>
                    {ROLE_BN[f.role] ?? f.role}
                    {f.edition ? ` — ${BOOK_EDITION_LABELS_BN[f.edition as BookEdition] ?? f.edition}` : ""} ({f.format})
                  </Body>
                  {f.stale ? <Badge text={BL.stale} tone="warn" /> : null}
                  <Muted>{ymd(f.at)}</Muted>
                </View>
              </Card>
            ))}
            {manage && v.status !== "final" && v.status !== "print_released" ? (
              <Card>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                  <Button title={BL.uploadMasterPdf} variant="secondary" loading={busy} onPress={() => void upload("master_pdf")} />
                  <Button title={BL.uploadMasterDocx} variant="ghost" loading={busy} onPress={() => void upload("master_docx")} />
                </View>
                <Select label={BL.uploadEdition} value={edition} options={(book?.editions ?? ["TEACHER", "STUDENT"]).map((e) => ({ value: e, label: BOOK_EDITION_LABELS_BN[e as BookEdition] ?? e }))} onChange={setEdition} />
                <Button title={BL.uploadEdition} variant="secondary" loading={busy} onPress={() => void upload("edition")} />
              </Card>
            ) : null}

            <SectionTitle>{BL.changes}</SectionTitle>
            {v.changes.length ? (
              v.changes.map((c, i) => (
                <Card key={i} style={{ marginBottom: space(2) }}>
                  <Muted>
                    {c.chapterKey} · {c.where || "—"} {c.page ? `· পৃ. ${c.page}` : ""} · {c.refs.join(", ")} · {c.route}
                    {c.sacred ? " · কুরআন/হাদিস/দোয়া" : ""}
                  </Muted>
                  <Body>
                    «{c.beforeExcerpt}» → «{c.afterExcerpt}»
                  </Body>
                  {c.reason ? <Muted>{c.reason}</Muted> : null}
                </Card>
              ))
            ) : (
              <Muted>{BL.noChanges}</Muted>
            )}

            <SectionTitle>{BL.chapters}</SectionTitle>
            <ChipRow>
              {v.chapters.map((c) => (
                <Chip key={c.key} label={c.key === "front" ? "শুরু" : c.key} selected={readKey === c.key} onPress={() => setReadKey(readKey === c.key ? null : c.key)} />
              ))}
            </ChipRow>
            {readKey ? (
              <Card style={{ marginTop: space(2) }}>
                <QueryGate result={cq} onRetry={() => refetchC({ requestPolicy: "network-only" })}>{cq.data ? <Markdown source={cq.data.bookLcChapter.text.replace(/<!--[\s\S]*?-->/g, "")} /> : null}</QueryGate>
              </Card>
            ) : null}

            <SectionTitle>{BL.compare}</SectionTitle>
            <Select
              label={BL.compareWith}
              value={cmpWith}
              options={(others.data?.bookLcVersionsPage.rows ?? []).filter((o) => o.id !== versionId).map((o) => ({ value: o.id, label: `${o.labelBn} (${o.statusBn})` }))}
              onChange={setCmpWith}
            />
            {cmpWith ? (
              <QueryGate result={dq} onRetry={() => refetchDiff({ requestPolicy: "network-only" })}>
                {dq.data?.bookLcDiff
                  .filter((c) => c.status !== "same")
                  .map((c) => (
                    <Card key={c.key} style={{ marginTop: space(2) }}>
                      <Body style={{ fontWeight: "700" }}>
                        {c.key} — {c.title} · {c.status === "added" ? BL.added : c.status === "removed" ? BL.removed : BL.changed}
                      </Body>
                      <DiffView hunks={c.hunks} />
                    </Card>
                  ))}
              </QueryGate>
            ) : null}
          </>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
