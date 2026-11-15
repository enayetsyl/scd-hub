/**
 * S10 এআই সংশোধন (docs/prd-book-lifecycle.md §8, §14): base = the latest version; pick items (open ones
 * with a warning), add instructions (I-n, "পর্যালোচকের দেখা দরকার" on by default), chapter scope (auto or
 * all), model, cap → আনুমানিক খরচ → শুরু করুন. Then per-chapter progress, cost, failures, খসড়া দেখুন → S11.
 * The job only fills a draft; nothing applies by itself.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useClient, useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BL_FEEDBACK } from "../../graphql/bookLifecycle";
import { BL_JOB, BL_JOB_ESTIMATE, BL_JOBS, BL_RERUN_FAILED, BL_START_JOB, BL_STOP_JOB, type BlJobEstimateT, type BlJobInputT, type BlJobT } from "../../graphql/bookLifecycleJob";
import { Badge, Body, Button, Card, Chip, ChipRow, Field, Muted, Notice, Screen } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { useAuth } from "../../auth/AuthContext";
import { friendlyError } from "../../lib/errors";
import type { BookLcStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { BL } from "./blStrings";
import { Line, SectionTitle, useMsg, ymd } from "./blCommon";

type Props = NativeStackScreenProps<BookLcStackParamList, "BookLcAiEdit">;

const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "deepseek-v4-pro", "deepseek-flash"] as const;
const RUNNING = ["queued", "running"];
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const tone = (s: string): "ok" | "danger" | "warn" | "muted" => (s === "done" || s === "unchanged" ? "ok" : s === "failed" || s === "stale_base" ? "danger" : s === "partial" || s === "stopped" ? "warn" : "muted");
const statusBn = (s: string): string => (BL as Record<string, string>)[`job_${s}`];

function JobView({ job, onStop, onDraft, onRefresh, onRerun }: { job: BlJobT; onStop: () => void; onDraft: () => void; onRefresh: () => void; onRerun: (() => void) | null }): React.ReactElement {
  const running = RUNNING.includes(job.status);
  const failed = job.chapters.some((c) => c.status === "failed");
  return (
    <Card style={{ marginBottom: space(2) }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
        <Badge text={statusBn(job.status)} tone={tone(job.status)} />
        <Muted>
          {job.model} · {BL.spent} {usd(job.spentUsd)} / {BL.cap} {usd(job.capUsd)} · {ymd(job.createdAt)}
        </Muted>
      </View>
      {job.note ? <Muted>{job.note}</Muted> : null}
      {job.chapters.map((c) => (
        <Line key={c.key} label={c.key} value={`${statusBn(c.status)} · ${usd(c.costUsd)}${c.fixes ? ` · ${BL.fixes} ${c.fixes}` : ""}${c.errorBn ? ` — ${c.errorBn}` : ""}`} />
      ))}
      {job.leftOut.length ? <Notice tone="warn" message={`${BL.leftOutNamed}: ${job.leftOut.map((x) => x.code).join(", ")}`} /> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
        {running ? <Button title={BL.stopJob} variant="ghost" onPress={onStop} /> : null}
        {running ? <Button title={BL.refresh} variant="ghost" onPress={onRefresh} /> : null}
        {!running && failed && onRerun ? <Button title={BL.rerunFailed} variant="ghost" onPress={onRerun} /> : null}
        <Button title={BL.seeDraft} variant="secondary" onPress={onDraft} />
      </View>
    </Card>
  );
}

export default function BookLcAiEditScreen({ navigation, route }: Props): React.ReactElement {
  const { bookId } = route.params;
  const { can } = useAuth();
  const aiEdit = can("book_lifecycle:ai_edit");
  const client = useClient();
  const [jobId, setJobId] = useState<string | null>(route.params.jobId ?? null);
  const [page, setPage] = useState(1);
  const [fq] = useQuery({ query: BL_FEEDBACK, variables: { bookId, status: "active", page: 1, pageSize: 200 } });
  const [jq, refetchJob] = useQuery({ query: BL_JOB, variables: { jobId: jobId ?? "" }, pause: !jobId, requestPolicy: "network-only" });
  const [lq, refetchJobs] = useQuery({ query: BL_JOBS, variables: { bookId, page, pageSize: 10 }, requestPolicy: "cache-and-network" });
  const [, start] = useMutation(BL_START_JOB);
  const [, stop] = useMutation(BL_STOP_JOB);
  const [, rerun] = useMutation(BL_RERUN_FAILED);
  const [items, setItems] = useState<string[]>([]);
  const [instr, setInstr] = useState<{ text: string; needsReview: boolean }[]>([]);
  const [newInstr, setNewInstr] = useState("");
  const [needsReview, setNeedsReview] = useState(true);
  const [allChapters, setAllChapters] = useState(false);
  const [model, setModel] = useState<string>(MODELS[0]);
  const [cap, setCap] = useState("3");
  const [estimate, setEstimate] = useState<BlJobEstimateT | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useMsg();

  const rows = fq.data?.bookLcFeedbackPage.rows ?? [];
  const openPicked = rows.filter((f) => items.includes(f.code) && f.status === "open");
  // "সব অধ্যায়" is sent as "*" (the server expands it to every chapter); none = auto.
  const input = (confirmLarge = false): BlJobInputT => ({ feedback: items, instructions: instr, scopeChapterKeys: allChapters ? ["*"] : [], model, reasoning: "low", capUsd: Number(cap) || 3, confirmLarge });
  const changed = () => setEstimate(null);

  const estimateNow = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await client.query(BL_JOB_ESTIMATE, { bookId, input: input() }, { requestPolicy: "network-only" }).toPromise();
      if (r.error) return setMsg({ tone: "danger", text: friendlyError(r.error) });
      setEstimate(r.data!.bookLcEditJobEstimate);
    } finally {
      setBusy(false);
    }
  };
  const startNow = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await start({ bookId, input: input(!!estimate?.large) });
      if (r.error) return setMsg({ tone: "danger", text: friendlyError(r.error) });
      setJobId(r.data!.startBookLcEditJob.id);
      setEstimate(null);
      setMsg({ tone: "ok", text: BL.jobStarted });
      refetchJobs({ requestPolicy: "network-only" });
    } finally {
      setBusy(false);
    }
  };

  const job = jq.data?.bookLcEditJob;
  return (
    <Screen scroll>
      {msg}
      <Muted>{BL.aiEditHint}</Muted>
      {job ? (
        <>
          <SectionTitle>{BL.thisJob}</SectionTitle>
          <JobView
            job={job}
            onStop={() => void stop({ jobId: job.id }).then((r) => (r.error ? setMsg({ tone: "danger", text: friendlyError(r.error) }) : refetchJob({ requestPolicy: "network-only" })))}
            onRefresh={() => refetchJob({ requestPolicy: "network-only" })}
            onDraft={() => navigation.navigate("BookLcDraft", { draftId: job.draftId })}
            onRerun={
              aiEdit
                ? () =>
                    void rerun({ jobId: job.id, capUsd: Number(cap) || 3 }).then((r) => {
                      if (r.error) return setMsg({ tone: "danger", text: friendlyError(r.error) });
                      setJobId(r.data!.rerunBookLcEditJobFailed.id);
                      setMsg({ tone: "ok", text: BL.jobStarted });
                      refetchJobs({ requestPolicy: "network-only" });
                    })
                : null
            }
          />
        </>
      ) : null}

      {aiEdit ? (
        <>
          <SectionTitle>{BL.newJob}</SectionTitle>
          <Body>{BL.pickItems}</Body>
          <ChipRow>
            {rows.map((f) => (
              <Chip
                key={f.id}
                label={`${f.code} ${f.textBn.slice(0, 24)}`}
                selected={items.includes(f.code)}
                onPress={() => {
                  setItems(items.includes(f.code) ? items.filter((x) => x !== f.code) : [...items, f.code]);
                  changed();
                }}
              />
            ))}
          </ChipRow>
          {openPicked.length ? <Notice tone="warn" message={`${BL.openItemsWarn}: ${openPicked.map((f) => f.code).join(", ")}`} /> : null}
          <Card style={{ marginTop: space(2) }}>
            {instr.map((i, n) => (
              <Line key={n} label={`${BL.instructionNo} ${n + 1}`} value={`${i.text.slice(0, 120)}${i.needsReview ? ` (${BL.needsReview})` : ""}`} />
            ))}
            <Field label={BL.newInstruction} value={newInstr} onChangeText={setNewInstr} multiline autoCapitalize="sentences" />
            <ChipRow>
              <Chip label={BL.needsReview} selected={needsReview} onPress={() => setNeedsReview(!needsReview)} />
            </ChipRow>
            <Button
              title={BL.addRow}
              variant="ghost"
              onPress={() => {
                if (!newInstr.trim()) return;
                setInstr([...instr, { text: newInstr.trim(), needsReview }]);
                setNewInstr("");
                changed();
              }}
            />
          </Card>
          <ChipRow>
            <Chip label={BL.scopeAuto} selected={!allChapters} onPress={() => (setAllChapters(false), changed())} />
            <Chip label={BL.scopeAll} selected={allChapters} onPress={() => (setAllChapters(true), changed())} />
          </ChipRow>
          <ChipRow>
            {MODELS.map((m) => (
              <Chip key={m} label={m} selected={model === m} onPress={() => (setModel(m), changed())} />
            ))}
          </ChipRow>
          <Field label={BL.capUsd} value={cap} onChangeText={(v) => (setCap(v), changed())} keyboardType="decimal-pad" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
            <Button title={BL.estimate} variant="secondary" loading={busy} onPress={() => void estimateNow()} />
            {estimate ? <Button title={estimate.large ? BL.startLarge : BL.startJob} loading={busy} onPress={() => void startNow()} /> : null}
          </View>
          {estimate ? (
            <Card style={{ marginTop: space(2) }}>
              <Body>
                {BL.estimateLine
                  .replace("{chapters}", String(estimate.chapters))
                  .replace("{units}", String(estimate.units))
                  .replace("{tokens}", String(estimate.inputTokens + estimate.outputTokens))
                  .replace("{usd}", usd(estimate.usd))
                  .replace("{cap}", usd(estimate.capUsd))}
              </Body>
              {estimate.large ? <Notice tone="warn" message={BL.largeWarn} /> : null}
              {estimate.leftOut.length ? <Notice tone="warn" message={`${BL.leftOutNamed}: ${estimate.leftOut.map((x) => x.code).join(", ")}`} /> : null}
            </Card>
          ) : null}
        </>
      ) : null}

      <SectionTitle>{BL.pastJobs}</SectionTitle>
      {(lq.data?.bookLcEditJobsPage.rows ?? []).map((j) => (
        <View key={j.id} style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center", marginBottom: space(1) }}>
          <Badge text={statusBn(j.status)} tone={tone(j.status)} />
          <Muted>
            {ymd(j.createdAt)} · {j.model} · {usd(j.spentUsd)}
          </Muted>
          <Button title={BL.open} variant="ghost" onPress={() => setJobId(j.id)} />
        </View>
      ))}
      <Pager page={page} pageSize={10} total={lq.data?.bookLcEditJobsPage.total ?? 0} onPage={setPage} />
    </Screen>
  );
}
