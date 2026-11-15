/**
 * S11 খসড়া ও তুলনা — an edit draft (docs/prd-book-lifecycle.md §8, §12). Per chapter: the validator's
 * findings, the word-level diff, গ্রহণ / বাদ; the change rows (each citing F-/I-/D-); re-keying and
 * protected-text confirmations; then bump + summary → নতুন সংস্করণ তৈরি (a DRAFT version, VR-15).
 */
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BL_ACK_UNEXPLAINED, BL_SUBMIT_DRAFT } from "../../graphql/bookLifecycleEdit";
import { BL_ACCEPT_DRAFT, BL_CONFIRM_PROTECTED, BL_CONFIRM_REKEY, BL_DECIDE_CHAPTER, BL_DRAFT, BL_DRAFT_DIFF, BL_REJECT_DRAFT, BL_SET_CHANGES } from "../../graphql/bookLifecycle";
import { Badge, Body, Button, Card, Chip, ChipRow, Field, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { friendlyError } from "../../lib/errors";
import type { BookLcStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { BL } from "./blStrings";
import { DiffView, SectionTitle, useMsg } from "./blCommon";

type Props = NativeStackScreenProps<BookLcStackParamList, "BookLcDraft">;
type Row = { chapterKey: string; where: string; beforeExcerpt: string; afterExcerpt: string; reason: string; refs: string };

export default function BookLcDraftScreen({ navigation, route }: Props): React.ReactElement {
  const { draftId } = route.params;
  const { can } = useAuth();
  const manage = can("book_lifecycle:manage");
  const finalize = can("book_lifecycle:finalize");
  const [q, refetch] = useQuery({ query: BL_DRAFT, variables: { id: draftId }, requestPolicy: "cache-and-network" });
  const [dq] = useQuery({ query: BL_DRAFT_DIFF, variables: { draftId } });
  const [, decide] = useMutation(BL_DECIDE_CHAPTER);
  const [, setChanges] = useMutation(BL_SET_CHANGES);
  const [, confirmRekey] = useMutation(BL_CONFIRM_REKEY);
  const [, confirmProtected] = useMutation(BL_CONFIRM_PROTECTED);
  const [{ fetching: accepting }, accept] = useMutation(BL_ACCEPT_DRAFT);
  const [, reject] = useMutation(BL_REJECT_DRAFT);
  const [{ fetching: submitting }, submit] = useMutation(BL_SUBMIT_DRAFT);
  const [, ackHunk] = useMutation(BL_ACK_UNEXPLAINED);
  const [msg, setMsg] = useMsg();
  const [rows, setRows] = useState<Row[]>([]);
  const [bump, setBump] = useState<"minor" | "major">("minor");
  const [summary, setSummary] = useState("");
  const d = q.data?.bookLcDraft;
  useEffect(() => {
    if (d && !rows.length && d.changes.length) setRows(d.changes.map((c) => ({ chapterKey: c.chapterKey, where: c.where, beforeExcerpt: c.beforeExcerpt, afterExcerpt: c.afterExcerpt, reason: c.reason, refs: c.refs.join(", ") })));
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const after = (res: { error?: Parameters<typeof friendlyError>[0] }): void => {
    if (res.error) setMsg({ tone: "danger", text: friendlyError(res.error) });
    else refetch({ requestPolicy: "network-only" });
  };
  const open = d && ["open", "submitted", "ready"].includes(d.status);
  const diffs = new Map((dq.data?.bookLcDraftDiff ?? []).map((c) => [c.key, c]));

  return (
    <Screen scroll>
      <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })}>
        {d ? (
          <>
            <Card>
              <Body style={{ fontWeight: "700" }}>
                {BL.draftTitle} · {d.baseLabel} · {d.source} · {d.status}
              </Body>
              {d.blocking.map((f, i) => (
                <Notice key={`b${i}`} tone="danger" message={`${f.code}: ${f.messageBn}`} />
              ))}
              {d.warnings.map((f, i) => (
                <Notice key={`w${i}`} tone="warn" message={`${f.code}: ${f.messageBn}`} />
              ))}
              {d.newChapters.length || d.missingChapters.length ? (
                <View style={{ marginTop: space(2) }}>
                  {d.newChapters.length ? <Muted>{`${BL.rekeyNew}: ${d.newChapters.join(", ")}`}</Muted> : null}
                  {d.missingChapters.length ? <Muted>{`${BL.rekeyMissing}: ${d.missingChapters.join(", ")}`}</Muted> : null}
                  {!d.rekeyConfirmed && manage && open ? <Button title={BL.confirmRekey} variant="secondary" onPress={() => void confirmRekey({ draftId }).then(after)} /> : null}
                </View>
              ) : null}
              {d.protectedChanged ? (
                <View style={{ marginTop: space(2) }}>
                  <Notice tone="warn" message={BL.protectedChanged} />
                  {!d.protectedConfirmed && finalize && open ? <Button title={BL.confirmProtected} variant="secondary" onPress={() => void confirmProtected({ draftId }).then(after)} /> : null}
                </View>
              ) : null}
            </Card>
            {msg}

            {d.chapters
              .filter((c) => c.status !== "unchanged" && c.status !== "pending")
              .map((c) => (
                <Card key={c.key} style={{ marginTop: space(3) }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
                    <Body style={{ fontWeight: "700" }}>
                      {c.key} — {c.title}
                    </Body>
                    <Badge text={c.isNew ? BL.added : c.removed ? BL.removed : BL.changed} tone="info" />
                    <Badge text={c.status} tone={c.status === "accepted" ? "ok" : c.status === "rejected" ? "danger" : "muted"} />
                    {c.mode ? <Badge text={c.mode === "ops" ? `${BL.modeOps} (${c.opsCount})` : BL.modeWhole} tone="muted" /> : null}
                  </View>
                  {c.findings.map((f, i) => (
                    <Notice key={i} tone={f.level === "blocking" ? "danger" : "warn"} message={`${f.code}: ${f.messageBn}`} />
                  ))}
                  {c.notApplied.length ? <Muted>{`${BL.notApplied}: ${c.notApplied.map((n) => `${n.code} (${n.textBn})`).join("; ")}`}</Muted> : null}
                  {c.unexplained.map((u) => (
                    <View key={u.index} style={{ marginVertical: space(1) }}>
                      <Notice tone="warn" message={`${BL.unexplainedHunk}: «${u.beforeText.slice(0, 120)}» → «${u.afterText.slice(0, 120)}»`} />
                      {u.acked ? <Badge text={`✓ ${BL.ackHunk}`} tone="ok" /> : finalize && open ? <Button title={BL.ackHunk} variant="ghost" onPress={() => void ackHunk({ draftId, chapterKey: c.key, index: u.index, runHash: u.runHash }).then(after)} /> : null}
                    </View>
                  ))}
                  {diffs.get(c.key) ? <DiffView hunks={diffs.get(c.key)!.hunks} /> : null}
                  {manage && open ? (
                    <View style={{ flexDirection: "row", gap: space(2) }}>
                      <Button title={BL.accept} onPress={() => void decide({ draftId, chapterKey: c.key, accept: true, expectedNewSha: c.newSha }).then(after)} />
                      <Button title={BL.drop} variant="ghost" onPress={() => void decide({ draftId, chapterKey: c.key, accept: false }).then(after)} />
                    </View>
                  ) : null}
                </Card>
              ))}

            {manage && open ? (
              <>
                <SectionTitle>{BL.changeRows}</SectionTitle>
                {rows.map((r, i) => (
                  <Card key={i} style={{ marginBottom: space(2) }}>
                    <ChipRow>
                      {d.chapters
                        .filter((c) => c.status !== "unchanged" && c.status !== "pending")
                        .map((c) => (
                          <Chip key={c.key} label={c.key} selected={r.chapterKey === c.key} onPress={() => setRows(rows.map((x, j) => (j === i ? { ...x, chapterKey: c.key } : x)))} />
                        ))}
                    </ChipRow>
                    {(["where", "beforeExcerpt", "afterExcerpt", "reason", "refs"] as const).map((k) => (
                      <Field
                        key={k}
                        label={{ where: BL.where, beforeExcerpt: BL.before, afterExcerpt: BL.after, reason: BL.reason, refs: BL.refs }[k]}
                        value={r[k]}
                        onChangeText={(t) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: t } : x)))}
                        autoCapitalize={k === "refs" ? "characters" : "sentences"}
                      />
                    ))}
                  </Card>
                ))}
                <View style={{ flexDirection: "row", gap: space(2) }}>
                  <Button title={BL.addRow} variant="ghost" onPress={() => setRows([...rows, { chapterKey: d.chapters.find((c) => c.status !== "unchanged")?.key ?? "", where: "", beforeExcerpt: "", afterExcerpt: "", reason: "", refs: "" }])} />
                  <Button
                    title={BL.saveRows}
                    variant="secondary"
                    onPress={() =>
                      void setChanges({ draftId, rows: rows.map((r) => ({ ...r, refs: r.refs.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) })) }).then((res) => (after(res), !res.error && setMsg({ tone: "ok", text: BL.saved })))
                    }
                  />
                </View>

                <SectionTitle>{BL.createVersion}</SectionTitle>
                <ChipRow>
                  <Chip label={BL.bumpMinor} selected={bump === "minor"} onPress={() => setBump("minor")} />
                  <Chip label={BL.bumpMajor} selected={bump === "major"} onPress={() => setBump("major")} />
                </ChipRow>
                <Field label={BL.summary} value={summary} onChangeText={setSummary} multiline autoCapitalize="sentences" />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                  <Button
                    title={BL.submit}
                    variant="secondary"
                    loading={submitting}
                    onPress={() =>
                      void submit({ draftId, summaryBn: summary || null, bump }).then((res) => {
                        if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
                        const r = res.data!.submitBookLcDraft;
                        setMsg({ tone: r.status === "ready" ? "ok" : "danger", text: `${r.status} · ${r.blocking.length} / ${r.warnings.length}` });
                        refetch({ requestPolicy: "network-only" });
                      })
                    }
                  />
                  <Button
                    title={BL.createVersion}
                    loading={accepting}
                    onPress={() =>
                      void accept({ draftId, bump, summaryBn: summary }).then((res) =>
                        res.error ? setMsg({ tone: "danger", text: friendlyError(res.error) }) : navigation.replace("BookLcVersion", { versionId: res.data!.acceptBookLcDraft.id }),
                      )
                    }
                  />
                  <Button title={BL.rejectDraft} variant="danger" onPress={() => void reject({ draftId }).then(after)} />
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
