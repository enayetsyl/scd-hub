/**
 * রিপোর্ট পড়ে যাচাই — the Principal reads ONE report (docs/prd-child-support-profile.md §6.5, §9.4, §10).
 * The queue lists metadata only; this screen is the audited read (via QUEUE). Only here: the text, the
 * CSP-3 panels (compare, check questions, evidence preview, school records) and the decision —
 * approve / return with a reason / not used, or the YES/NO answer to an open safety question.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { SUPPORT_REPORT_STATUS_LABELS_BN, SUPPORT_SECTION_LABELS_BN, type SupportReportStatus, type SupportSection } from "@scd/shared";
import { DECIDE_SUPPORT_REPORT, RESOLVE_SUPPORT_HOLD, SUPPORT_REPORT, type SupportReportT, type SupportQuestionT } from "../../graphql/supportProfile";
import type { HomeStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Field, Loader, Notice, Badge } from "../../components/ui";
import { useToast } from "../../state/ToastContext";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeStackParamList, "SupportReview">;
type Full = SupportReportT & {
  quickApprovable: boolean;
  compareJson: string | null;
  openFlags: SupportQuestionT[];
  disagreements: string[];
  dontRememberCount: number;
  sectionHints: string[];
  evidencePreviewJson: string | null;
  recordsJson: string | null;
};
interface Compare {
  agreement?: { claim: string; status: string; noteBn: string }[];
  authorSkew?: { status: string; noteBn: string };
  principalSummaryBn?: string;
}
interface Preview {
  section: string;
  textBn: string;
  levelNow: string;
  levelIfApproved: string;
}

function parse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export default function SupportReviewScreen({ route, navigation }: Props): React.ReactElement {
  const { reportId } = route.params;
  const toast = useToast();
  const [q, refetch] = useQuery<{ supportReport: Full }>({ query: SUPPORT_REPORT, variables: { reportId, via: "QUEUE" }, requestPolicy: "network-only" });
  const [reason, setReason] = useState("");
  const [, decide] = useMutation(DECIDE_SUPPORT_REPORT);
  const [, resolveHold] = useMutation(RESOLVE_SUPPORT_HOLD);
  const r = q.data?.supportReport;
  const act = async (fn: () => Promise<{ error?: Parameters<typeof friendlyError>[0] }>, back = true) => {
    const x = await fn();
    if (x.error) return toast.show(friendlyError(x.error), "danger");
    if (back) navigation.goBack();
    else refetch({ requestPolicy: "network-only" });
  };
  const cmp = parse<Compare>(r?.compareJson ?? null);
  const preview = parse<Preview[]>(r?.evidencePreviewJson ?? null) ?? [];
  const records = parse<Record<string, unknown>>(r?.recordsJson ?? null);
  const line = (label: string, v: string | null | undefined) => (v ? <Body key={label}>{`${label}: ${v}`}</Body> : null);
  const held = r?.safeguardingHold === "OPEN";
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        {q.fetching && !r ? <Loader /> : null}
        {q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : null}
        {r ? (
          <>
            <Card>
              <Badge text={SUPPORT_REPORT_STATUS_LABELS_BN[r.status as SupportReportStatus] ?? r.status} />
              {held ? <Badge text={STR.supHeld} /> : null}
              <Body style={{ fontWeight: "700" }}>{`${r.studentName ?? ""} · ${r.occurredOn} · ${r.authorName ?? ""}`}</Body>
              {line(STR.supFieldSituation, r.situation)}
              {line(STR.supFieldSettingNote, r.settingNote)}
              {line(STR.supFieldBehaviour, r.behaviour)}
              {line(STR.supFieldTried, r.tried)}
              {line(STR.supFieldResultNote, r.resultNote)}
              {line(STR.supFieldException, r.exception)}
              {line(STR.supFieldWhatWorked, r.whatWorked)}
              {line(STR.supFieldGood, r.goodThingNone ? (r.goodThingReasonBn ?? "—") : r.goodThingText)}
            </Card>
            {r.status === "TO_PROCESS" ? <Muted>{STR.supNoAiCheck}</Muted> : null}
            {cmp ? (
              <Card>
                <Body style={{ fontWeight: "700" }}>{STR.supCompareTitle}</Body>
                {cmp.principalSummaryBn ? <Body>{cmp.principalSummaryBn}</Body> : null}
                {(cmp.agreement ?? []).map((a, i) => (
                  <Muted key={i}>{`${a.claim} — ${a.noteBn}`}</Muted>
                ))}
                {cmp.authorSkew && cmp.authorSkew.status !== "NONE" ? <Muted>{cmp.authorSkew.noteBn}</Muted> : null}
              </Card>
            ) : null}
            {r.openFlags.length ? (
              <Card>
                <Body style={{ fontWeight: "700" }}>{STR.supFlagsTitle}</Body>
                {r.openFlags.map((f) => (
                  <Muted key={f.flagId}>{`“${f.quote}” — ${f.askBn}`}</Muted>
                ))}
                {r.disagreements.map((d, i) => (
                  <Muted key={i}>{`${STR.supDisagree}: ${d}`}</Muted>
                ))}
              </Card>
            ) : null}
            {preview.length ? (
              <Card>
                <Body style={{ fontWeight: "700" }}>{STR.supEvidenceTitle}</Body>
                {preview.map((p, i) => (
                  <Muted key={i}>{`${SUPPORT_SECTION_LABELS_BN[p.section as SupportSection] ?? p.section}: ${p.textBn} (${p.levelNow} → ${p.levelIfApproved})`}</Muted>
                ))}
              </Card>
            ) : null}
            {records ? (
              <Card>
                <Body style={{ fontWeight: "700" }}>{STR.supRecordsTitle}</Body>
                {Object.entries(records)
                  .filter(([, v]) => typeof v === "number" || typeof v === "string")
                  .map(([k, v]) => (
                    <Muted key={k}>{`${k}: ${String(v)}`}</Muted>
                  ))}
              </Card>
            ) : null}
            {held ? (
              <Card>
                <Body style={{ fontWeight: "700" }}>{STR.supSgQuestion}</Body>
                <View style={{ gap: space(2), marginTop: space(2) }}>
                  <Button title={STR.supSgHoldYes} variant="danger" onPress={() => act(() => resolveHold({ reportId: r.id, answer: "YES" }), false)} />
                  <Button title={STR.supSgHoldNo} variant="secondary" onPress={() => act(() => resolveHold({ reportId: r.id, answer: "NO" }), false)} />
                </View>
              </Card>
            ) : r.status === "TO_PROCESS" || r.status === "PROCESSED" ? (
              <Card>
                <View style={{ gap: space(2) }}>
                  <Button title={STR.supApprove} onPress={() => act(() => decide({ reportId: r.id, decision: "APPROVED" }))} />
                  <Field label={STR.supReason} value={reason} onChangeText={setReason} />
                  <Button title={STR.supReturn} variant="secondary" onPress={() => act(() => decide({ reportId: r.id, decision: "RETURNED", reasonBn: reason }))} />
                  <Button title={STR.supNotUsed} variant="ghost" onPress={() => act(() => decide({ reportId: r.id, decision: "NOT_USED", reasonBn: reason }))} />
                </View>
              </Card>
            ) : null}
            <Button title={STR.supFullProfile} variant="ghost" onPress={() => navigation.navigate("SupportCard", { studentId: r.studentId, via: "QUEUE", full: true })} />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
