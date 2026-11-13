/**
 * S6 ছাপা ও ভুল-সংশোধনী (docs/prd-book-lifecycle.md §8, §9.4, §11.2): record a print release from a
 * final version (files per edition, the Student IDML zip + preview PDF required), press statuses with
 * dates, শিক্ষকদের জানান, the class-books publish behind the per-book switch, and the errata of the
 * current release (edit, ঘোষণা, who has fixed their books).
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BOOK_EDITION_LABELS_BN, BOOK_RELEASE_FILE_KINDS, BOOK_RELEASE_STATUS_BN, type BookEdition, type BookReleaseStatus } from "@scd/shared";
import { BL_BOOK, BL_VERSIONS } from "../../graphql/bookLifecycle";
import {
  BL_ANNOUNCE_ERRATUM,
  BL_CLASSBOOKS_SWITCH,
  BL_CREATE_RELEASE,
  BL_ERRATA,
  BL_NOTIFY_RELEASE,
  BL_PUBLISH_CLASSBOOKS,
  BL_RECORD_RELEASE,
  BL_RELEASES,
  BL_RELEASE_STATUS,
  BL_UPDATE_ERRATUM,
  BL_WITHDRAW_ERRATUM,
} from "../../graphql/bookLifecycleRelease";
import { Badge, Body, Button, Card, Chip, ChipRow, EmptyState, Field, Muted, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { friendlyError } from "../../lib/errors";
import { openStoredFile } from "../../lib/files";
import { pickBookLcFile, postBookLc } from "../../lib/bookLcFiles";
import { bnNum } from "../../lib/labels";
import type { BookLcStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { BL } from "./blStrings";
import { Line, SectionTitle, dateArg, useMsg, ymd } from "./blCommon";

type Props = NativeStackScreenProps<BookLcStackParamList, "BookLcRelease">;

export default function BookLcReleaseScreen({ route }: Props): React.ReactElement {
  const { bookId } = route.params;
  const { can } = useAuth();
  const release = can("book_lifecycle:release");
  const manage = can("book_lifecycle:manage");
  const finalize = can("book_lifecycle:finalize");
  const [relPages, setRelPages] = useState(1);
  const [errPages, setErrPages] = useState(1);
  const [bq, refetchBook] = useQuery({ query: BL_BOOK, variables: { id: bookId } });
  const [vq] = useQuery({ query: BL_VERSIONS, variables: { bookId, page: 1, pageSize: 50 } });
  const [rq, refetchR] = useQuery({ query: BL_RELEASES, variables: { bookId, page: 1, pageSize: 20 * relPages }, requestPolicy: "cache-and-network" });
  const book = bq.data?.bookLcBook;
  const [eq, refetchE] = useQuery({ query: BL_ERRATA, variables: { bookId, releaseId: book?.currentReleaseId ?? null, page: 1, pageSize: 50 * errPages }, pause: !book });
  const [, createRelease] = useMutation(BL_CREATE_RELEASE);
  const [, recordRelease] = useMutation(BL_RECORD_RELEASE);
  const [, setStatus] = useMutation(BL_RELEASE_STATUS);
  const [, notify] = useMutation(BL_NOTIFY_RELEASE);
  const [, publish] = useMutation(BL_PUBLISH_CLASSBOOKS);
  const [, setSwitch] = useMutation(BL_CLASSBOOKS_SWITCH);
  const [, updateErratum] = useMutation(BL_UPDATE_ERRATUM);
  const [, announce] = useMutation(BL_ANNOUNCE_ERRATUM);
  const [, withdraw] = useMutation(BL_WITHDRAW_ERRATUM);
  const [msg, setMsg] = useMsg();
  const [label, setLabel] = useState("");
  const [press, setPress] = useState("");
  const [edition, setEdition] = useState<string>("STUDENT");
  const [kind, setKind] = useState<string>("idml_zip");
  const [date, setDate] = useState("");
  const [copies, setCopies] = useState("");
  const [edits, setEdits] = useState<Record<string, { correctText?: string; wrongText?: string; whereBn?: string; editions?: string[]; page?: string; instructionBn?: string }>>({});
  const refresh = (): void => {
    refetchBook({ requestPolicy: "network-only" });
    refetchR({ requestPolicy: "network-only" });
    refetchE({ requestPolicy: "network-only" });
  };
  const after = (res: { error?: Parameters<typeof friendlyError>[0] }, ok = BL.done): void => {
    if (res.error) setMsg({ tone: "danger", text: friendlyError(res.error) });
    else (setMsg({ tone: "ok", text: ok }), refresh());
  };
  const finalVersions = (vq.data?.bookLcVersionsPage.rows ?? []).filter((v) => v.status === "final" || v.status === "print_released");
  const upload = async (releaseId: string): Promise<void> => {
    const f = await pickBookLcFile("any");
    if (!f) return;
    try {
      await postBookLc("release-file", { releaseId, edition, kind }, { file: f });
      after({});
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };

  return (
    <Screen scroll>
      {msg}
      {release && finalVersions.length ? (
        <Card style={{ marginBottom: space(3) }}>
          <Body style={{ fontWeight: "700" }}>{BL.newRelease}</Body>
          <Field label={BL.releaseLabel} value={label} onChangeText={setLabel} autoCapitalize="sentences" />
          <Field label={BL.pressName} value={press} onChangeText={setPress} autoCapitalize="sentences" />
          <ChipRow>
            {finalVersions.map((v) => (
              <Chip key={v.id} label={`${BL.createRelease}: ${v.labelBn}`} onPress={() => void createRelease({ versionId: v.id, labelBn: label, pressNameBn: press || null }).then((r) => after(r))} />
            ))}
          </ChipRow>
        </Card>
      ) : null}

      {finalize && book ? (
        <Card style={{ marginBottom: space(3) }}>
          <Line label={BL.classBooksSwitch} value={book.publishStudentToClassBooks ? "✓" : "—"} />
          <Button title={book.publishStudentToClassBooks ? BL.switchOff : BL.switchOn} variant="ghost" onPress={() => void setSwitch({ bookId, on: !book.publishStudentToClassBooks }).then((r) => after(r))} />
        </Card>
      ) : null}

      <QueryGate result={rq} onRetry={refresh} isEmpty={!rq.data?.bookLcReleasesPage.rows.length} empty={<EmptyState message="—" />}>
        {rq.data?.bookLcReleasesPage.rows.map((r) => (
          <Card key={r.id} style={{ marginBottom: space(3) }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>
                {bnNum(r.releaseNo)}. {r.labelBn} · {r.versionLabel}
              </Body>
              <Badge text={BOOK_RELEASE_STATUS_BN[r.status as BookReleaseStatus] ?? r.status} tone="info" />
              {r.recordedAt ? null : <Badge text={BL.recordRelease} tone="warn" />}
            </View>
            {r.sentToPressAt ? <Line label={BL.sentToPress} value={`${ymd(r.sentToPressAt)}${r.pressNameBn ? ` · ${r.pressNameBn}` : ""}`} /> : null}
            {r.printedAt ? <Line label={BL.printed} value={`${ymd(r.printedAt)}${r.copies ? ` · ${bnNum(r.copies)}` : ""}`} /> : null}
            {r.distributedAt ? <Line label={BL.tellTeachers} value={ymd(r.distributedAt)} /> : null}
            <ChipRow>
              {r.files.map((f) => (
                <Chip key={`${f.edition}-${f.kind}`} label={`${BOOK_EDITION_LABELS_BN[f.edition as BookEdition] ?? f.edition} · ${(BL as Record<string, string>)[`fk_${f.kind}`] ?? f.kind}`} onPress={() => void openStoredFile(f.fileId)} />
              ))}
            </ChipRow>
            {release && r.status !== "superseded" ? (
              <View>
                <ChipRow>
                  {(["STUDENT", "TEACHER", "SCHOLARSHIP_STUDENT"] as const).map((e) => (
                    <Chip key={e} label={BOOK_EDITION_LABELS_BN[e]} selected={edition === e} onPress={() => setEdition(e)} />
                  ))}
                </ChipRow>
                <ChipRow>
                  {BOOK_RELEASE_FILE_KINDS.map((k) => (
                    <Chip key={k} label={(BL as Record<string, string>)[`fk_${k}`] ?? k} selected={kind === k} onPress={() => setKind(k)} />
                  ))}
                </ChipRow>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                  <Button title={BL.uploadReleaseFile} variant="secondary" onPress={() => void upload(r.id)} />
                  {!r.recordedAt ? <Button title={BL.recordRelease} onPress={() => void recordRelease({ id: r.id }).then((x) => after(x))} /> : null}
                </View>
                {r.recordedAt ? (
                  <View style={{ marginTop: space(2) }}>
                    <Field label={BL.dateLabel} value={date} onChangeText={setDate} placeholder="2026-12-01" />
                    {r.status === "prepared" ? <Field label={BL.pressName} value={press} onChangeText={setPress} /> : null}
                    {r.status === "sent_to_press" ? <Field label={BL.copies} value={copies} onChangeText={setCopies} keyboardType="number-pad" /> : null}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                      {r.status === "prepared" ? <Button title={BL.sentToPress} variant="secondary" onPress={() => void setStatus({ id: r.id, status: "sent_to_press", at: dateArg(date), pressNameBn: press || null }).then((x) => after(x))} /> : null}
                      {r.status === "sent_to_press" ? <Button title={BL.printed} variant="secondary" onPress={() => void setStatus({ id: r.id, status: "printed", at: dateArg(date), copies: Number(copies) || null }).then((x) => after(x))} /> : null}
                      <Button title={BL.tellTeachers} variant="ghost" onPress={() => void notify({ id: r.id }).then((x) => after(x))} />
                      {book?.publishStudentToClassBooks ? <Button title={BL.publishClassBooks} variant="ghost" onPress={() => void publish({ id: r.id }).then((x) => after(x))} /> : null}
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}
          </Card>
        ))}
      </QueryGate>

      {(rq.data?.bookLcReleasesPage.total ?? 0) > 20 * relPages ? <Button title={BL.moreReleases} variant="ghost" onPress={() => setRelPages(relPages + 1)} /> : null}

      <SectionTitle>{BL.errata}</SectionTitle>
      <QueryGate result={eq} onRetry={refresh} isEmpty={!eq.data?.bookLcErrataPage.rows.length} empty={<EmptyState message={BL.noErrata} />}>
        {eq.data?.bookLcErrataPage.rows.map((e) => (
          <Card key={e.id} style={{ marginBottom: space(2) }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>
                {e.code} {e.page ? `· পৃ. ${e.page}` : ""}
              </Body>
              <Badge text={e.status === "announced" ? BL.errAnnounced : e.status === "withdrawn" ? BL.errWithdrawn : BL.errDraft} tone={e.status === "announced" ? "info" : "muted"} />
              {e.carried ? <Badge text={BL.carried} tone="ok" /> : null}
            </View>
            <Body>
              «{e.wrongText}» → «{e.correctText || "…"}»
            </Body>
            <Muted>{e.instructionBn}</Muted>
            {e.status === "announced" ? (
              <Muted>
                {bnNum(e.ackCount)} {BL.acksOf} {bnNum(e.readerCount)}
                {e.ackNames.length ? ` — ${e.ackNames.join(", ")}` : ""}
              </Muted>
            ) : null}
            {e.status === "draft" && manage ? (
              <View>
                <Field label={BL.wrongText} value={edits[e.id]?.wrongText ?? e.wrongText} onChangeText={(t) => setEdits({ ...edits, [e.id]: { ...edits[e.id], wrongText: t } })} autoCapitalize="sentences" />
                <Field label={BL.whereLabel} value={edits[e.id]?.whereBn ?? e.whereBn} onChangeText={(t) => setEdits({ ...edits, [e.id]: { ...edits[e.id], whereBn: t } })} autoCapitalize="sentences" />
                <ChipRow>
                  {(["TEACHER", "STUDENT", "SCHOLARSHIP_STUDENT"] as const).map((ed) => {
                    const cur = edits[e.id]?.editions ?? e.editions;
                    return (
                      <Chip
                        key={ed}
                        label={BOOK_EDITION_LABELS_BN[ed]}
                        selected={cur.includes(ed)}
                        onPress={() => setEdits({ ...edits, [e.id]: { ...edits[e.id], editions: cur.includes(ed) ? cur.filter((x) => x !== ed) : [...cur, ed] } })}
                      />
                    );
                  })}
                </ChipRow>
                <Field label={BL.correctText} value={edits[e.id]?.correctText ?? e.correctText} onChangeText={(t) => setEdits({ ...edits, [e.id]: { ...edits[e.id], correctText: t } })} autoCapitalize="sentences" />
                <Field label={BL.page} value={edits[e.id]?.page ?? e.page ?? ""} onChangeText={(t) => setEdits({ ...edits, [e.id]: { ...edits[e.id], page: t } })} />
                <Field label={BL.instruction} value={edits[e.id]?.instructionBn ?? e.instructionBn} onChangeText={(t) => setEdits({ ...edits, [e.id]: { ...edits[e.id], instructionBn: t } })} autoCapitalize="sentences" />
                <View style={{ flexDirection: "row", gap: space(2) }}>
                  <Button title={BL.saveMark} variant="secondary" onPress={() => void updateErratum({ id: e.id, ...edits[e.id] }).then((x) => after(x, BL.saved))} />
                  {finalize ? <Button title={BL.announce} onPress={() => void announce({ id: e.id }).then((x) => after(x))} /> : null}
                  {finalize ? <Button title={BL.withdraw} variant="ghost" onPress={() => void withdraw({ id: e.id }).then((x) => after(x))} /> : null}
                </View>
              </View>
            ) : null}
            {e.status === "announced" && finalize ? <Button title={BL.withdraw} variant="ghost" onPress={() => void withdraw({ id: e.id }).then((x) => after(x))} /> : null}
          </Card>
        ))}
      </QueryGate>
      {(eq.data?.bookLcErrataPage.total ?? 0) > 50 * errPages ? <Button title={BL.moreErrata} variant="ghost" onPress={() => setErrPages(errPages + 1)} /> : null}
    </Screen>
  );
}
