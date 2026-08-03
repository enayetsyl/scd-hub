/**
 * BookAssembleScreen (SB-4, D-#406/#417) — the assembler's page.
 *
 * THE GATE IS SHOWN BEFORE THE BUTTON, not after pressing it. Every reason is listed at
 * once — being told about the next blocker only after fixing the last one is the worst
 * version of a gate, and the server returns them all for exactly that reason.
 *
 * FORCE IS PRINCIPAL-ONLY AND DELIBERATELY UGLY. Overriding the gate decides what
 * reaches print, so it is a role property rather than a grant AC-1 can hand out, it is
 * recorded on the job and in the timeline, and here it is a switch you have to find
 * rather than the obvious next tap after a refusal.
 *
 * `book.json` export sits on this screen too (D-#406): the app must never become the
 * only way to build a book. If this whole system is unavailable, someone with the JSON
 * and the vendored renderer can still produce the PDFs.
 *
 * Old renders are never pruned — the pooled Drive quota makes that a non-problem, and a
 * previous edition is sometimes exactly what you need to compare against.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useQuery, useMutation, useClient } from "urql";
import { BUILD_SCOPES } from "@scd/shared";
import {
  SUPPORT_BOOKS, SUPPORT_BOOK_ASSEMBLY_GATE, SUPPORT_BOOK_BUILD_JOBS,
  QUEUE_SUPPORT_BOOK_BUILD, SUPPORT_BOOK_EXPORT_JSON,
  type SupportBookT, type SupportBookGateT, type SupportBookBuildJobT,
} from "../../graphql/supportBook";
import { Screen, Body, Muted, Card, Select, Badge, Button, Chip, ChipRow, Field, EmptyState, Divider } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, isoDateTimeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openStoredFile, FileUploadError } from "../../lib/files";
import { useAuth } from "../../auth/AuthContext";
import { space, useColors } from "../../theme";

/** "3, 5, 7" → [3,5,7]. Garbage in a lesson-number box is dropped rather than sent —
 *  a NaN would become a silently wrong build scope. */
function parseLessonNos(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function jobTone(state: string): "ok" | "danger" | "info" | "muted" {
  if (state === "SUCCEEDED") return "ok";
  if (state === "FAILED") return "danger";
  if (state === "RUNNING" || state === "QUEUED") return "info";
  return "muted";
}

function JobCard({ job }: { job: SupportBookBuildJobT }): React.ReactElement {
  const colors = useColors();
  const [showLog, setShowLog] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onOpen(fileId: string): Promise<void> {
    setErr(null);
    try {
      await openStoredFile(fileId);
    } catch (e) {
      setErr(e instanceof FileUploadError ? e.message : String(e));
    }
  }

  return (
    <Card style={{ marginBottom: space(3) }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
        <Badge text={job.state} tone={jobTone(job.state)} />
        <Body style={{ marginLeft: space(2), fontWeight: "700" }}>{job.scope}</Body>
        {job.lessonNos.length > 0 ? (
          <Muted style={{ marginLeft: space(2) }}>
            {job.lessonNos.map((n) => bnNum(n)).join(", ")}
          </Muted>
        ) : null}
      </View>
      <Muted style={{ marginTop: 2 }}>{isoDateTimeLabel(job.queuedAt)}</Muted>
      {job.finishedAt ? <Muted>{isoDateTimeLabel(job.finishedAt)}</Muted> : null}

      {job.failureReason ? (
        <Body style={{ marginTop: space(2), color: colors.error }}>{job.failureReason}</Body>
      ) : null}

      {job.outputFileIds.length > 0 ? (
        <>
          <Divider />
          <Muted>{`${STR.sbEditions}: ${job.profiles.join(", ")}`}</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
            {job.outputFileIds.map((fid, i) => (
              <Button
                key={fid}
                title={`${STR.sbDownload} · ${job.profiles[i] ?? bnNum(i + 1)}`}
                variant="secondary"
                onPress={() => { void onOpen(fid); }}
                style={{ marginRight: space(2), marginTop: 4 }}
              />
            ))}
          </View>
        </>
      ) : null}

      {job.log ? (
        <>
          <Button
            title={STR.sbJobLog}
            variant="ghost"
            onPress={() => setShowLog((v) => !v)}
            style={{ alignSelf: "flex-start", marginTop: space(2) }}
          />
          {showLog ? (
            // Monospace-ish and scrollable on its own: a render log is long, and a log
            // that stretches the card is a log nobody reads.
            <ScrollView style={{ maxHeight: 220, marginTop: 4 }} nestedScrollEnabled>
              <Muted style={{ fontSize: 11 }}>{job.log}</Muted>
            </ScrollView>
          ) : null}
        </>
      ) : null}

      {err ? <Muted style={{ marginTop: space(2), color: colors.error }}>{err}</Muted> : null}
    </Card>
  );
}

export default function BookAssembleScreen(): React.ReactElement {
  const colors = useColors();
  const client = useClient();
  const { role } = useAuth();
  // The server refuses a non-Principal force regardless; not rendering the switch just
  // means nobody else has to wonder why it does nothing.
  const mayForce = role === "PRINCIPAL";

  const [booksQ, refetchBooks] = useQuery<{ supportBooks: SupportBookT[] }>({ query: SUPPORT_BOOKS });
  const books = booksQ.data?.supportBooks ?? [];
  const [pickedBook, setPickedBook] = useState<string | null>(null);
  const bookId = pickedBook ?? books[0]?.bookId ?? "";

  const [scope, setScope] = useState<string>("FULL");
  const [lessonRaw, setLessonRaw] = useState("");
  const [force, setForce] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  const lessonNos = parseLessonNos(lessonRaw);
  // FULL means the whole book; sending lesson numbers alongside it would be a
  // contradiction the server would have to guess about.
  const scopedLessons = scope === "FULL" ? [] : lessonNos;

  const [gateQ, refetchGate] = useQuery<{ supportBookAssemblyGate: SupportBookGateT }>({
    query: SUPPORT_BOOK_ASSEMBLY_GATE,
    variables: { bookId, lessonNos: scopedLessons },
    pause: !bookId,
  });
  const [jobsQ, refetchJobs] = useQuery<{ supportBookBuildJobs: SupportBookBuildJobT[] }>({
    query: SUPPORT_BOOK_BUILD_JOBS,
    variables: { bookId, limit: 25 },
    pause: !bookId,
  });

  const [queueRes, queueBuild] = useMutation(QUEUE_SUPPORT_BOOK_BUILD);

  const gate = gateQ.data?.supportBookAssemblyGate ?? null;
  const jobs = jobsQ.data?.supportBookBuildJobs ?? [];

  async function onQueue(): Promise<void> {
    setNote(null);
    const res = await queueBuild({ bookId, scope, lessonNos: scopedLessons, force });
    if (res.error) {
      setNote({ text: friendlyError(res.error), bad: true });
      return;
    }
    setNote({ text: STR.sbQueued, bad: false });
    setForce(false);
    refetchJobs({ requestPolicy: "network-only" });
    refetchGate({ requestPolicy: "network-only" });
  }

  async function onExport(): Promise<void> {
    setNote(null);
    const res = await client
      .query(SUPPORT_BOOK_EXPORT_JSON, { bookId, lessonNos: scopedLessons }, { requestPolicy: "network-only" })
      .toPromise();
    if (res.error) {
      setNote({ text: friendlyError(res.error), bad: true });
      return;
    }
    const json = (res.data as { supportBookExportJson?: string } | undefined)?.supportBookExportJson;
    if (!json) return;
    await Clipboard.setStringAsync(json);
    setNote({ text: STR.sbExportCopied, bad: false });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.sbAssembleTitle}</Body>
          <Muted>{STR.sbAssembleSub}</Muted>

          <Select
            label={STR.sbBook}
            value={bookId || null}
            options={books.map((b) => ({ label: `${b.titleBn} (${b.bookId})`, value: b.bookId }))}
            onChange={(v) => setPickedBook(v)}
            placeholder={STR.sbBook}
          />

          <Select
            label={STR.sbScope}
            value={scope}
            options={BUILD_SCOPES.map((s) => ({ label: s, value: s }))}
            onChange={(v) => setScope(v)}
          />

          {scope !== "FULL" ? (
            <Field
              label={STR.sbLessonNos}
              value={lessonRaw}
              onChangeText={setLessonRaw}
              keyboardType="numbers-and-punctuation"
              helper={lessonNos.length ? lessonNos.map((n) => bnNum(n)).join(", ") : undefined}
            />
          ) : null}
        </Card>

        <View style={{ height: space(3) }} />

        <QueryGate
          results={[booksQ, gateQ, jobsQ]}
          onRetry={() => {
            refetchBooks({ requestPolicy: "network-only" });
            refetchGate({ requestPolicy: "network-only" });
            refetchJobs({ requestPolicy: "network-only" });
          }}
          loaderLabel={STR.loading}
        >
          <Card>
            {gate ? (
              <>
                <Body style={{ fontWeight: "700", color: gate.ok ? colors.primary : colors.error }}>
                  {gate.ok ? STR.sbGateOk : STR.sbGateBlocked}
                </Body>
                {!gate.ok ? (
                  <>
                    <Muted style={{ marginTop: 4 }}>{STR.sbGateReasons}</Muted>
                    {gate.reasons.map((r, i) => (
                      <Body key={`${i}-${r}`} style={{ marginTop: 2, fontSize: 13 }}>{`• ${r}`}</Body>
                    ))}
                  </>
                ) : null}
              </>
            ) : (
              <Muted>{STR.empty}</Muted>
            )}

            <Divider />

            <Button
              title={STR.sbQueueBuild}
              onPress={() => { void onQueue(); }}
              loading={queueRes.fetching}
              disabled={!bookId || queueRes.fetching || (!gate?.ok && !force)}
              style={{ alignSelf: "flex-start" }}
            />

            {/* Only offered once the gate has actually refused — there is nothing to
                override when it passes, and showing it anyway invites the habit. */}
            {mayForce && gate && !gate.ok ? (
              <ChipRow>
                <Chip label={STR.sbForce} selected={force} onPress={() => setForce((v) => !v)} />
              </ChipRow>
            ) : null}

            <Button
              title={STR.sbExportJson}
              variant="ghost"
              onPress={() => { void onExport(); }}
              style={{ alignSelf: "flex-start", marginTop: space(2) }}
            />

            {note ? (
              <Muted style={{ marginTop: space(2), color: note.bad ? colors.error : colors.primary }}>
                {note.text}
              </Muted>
            ) : null}
          </Card>

          <View style={{ height: space(3) }} />

          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.sbJobs}</Body>
          {jobs.length === 0 ? (
            <EmptyState message={STR.sbNoJobs} />
          ) : (
            jobs.map((j) => <JobCard key={j.jobId} job={j} />)
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
