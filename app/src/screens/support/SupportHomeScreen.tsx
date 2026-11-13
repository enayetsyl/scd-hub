/**
 * শিক্ষার্থী সহায়তা — the entry (docs/prd-child-support-profile.md §9.3, §9.5, §7.8). Teachers: আমার
 * রিপোর্ট and the child picker (write a report on any child you teach, profile or not). Principal: the
 * switch (ships OFF), the review queue, batches, safeguarding, the approval-load card with the
 * review-date choices, and profiles by class and name (never ordered by concern; a bannered child is
 * marked for this side only). Each button checks its own action.
 */
import React, { useState } from "react";
import { ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  RECORD_APPROVAL_LOAD_CHOICE,
  SET_SUPPORT_SWITCH,
  SUPPORT_APPROVAL_LOAD,
  SUPPORT_PROFILES,
  SUPPORT_REPORTABLE_STUDENTS,
  SUPPORT_SETTING,
} from "../../graphql/supportProfile";
import type { HomeStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Field, Notice, Badge } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../state/ToastContext";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { dateKey } from "../../lib/dates";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeStackParamList, "SupportHome">;
interface Load {
  reviewDueKey: string | null;
  largest: number;
  medianDaysToDecision: number | null;
  waitingToProcess: number;
  oldestWaitingDays: number | null;
  tooHeavy: boolean;
}
const STATUS_BN: Record<string, string> = { OPEN: STR.supStatusOpen, LEFT: STR.supStatusLeft, CLOSED: STR.supStatusClosed };
const CHOICES: [string, string][] = [
  ["KEEP", STR.supLoadKeep],
  ["WIDEN_QUICK_APPROVE", STR.supLoadWiden],
  ["CLASS_TEACHER_FIRST", STR.supLoadCt],
  ["FEWER_PROMPTS", STR.supLoadFewer],
];

export default function SupportHomeScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can("support_profile:manage");
  const [pageNo, setPageNo] = useState(1);
  const [search, setSearch] = useState("");
  const [setting, refetch] = useQuery<{ supportProfileSetting: { switchedOn: boolean; approvalLoadReviewDueKey: string | null } }>({ query: SUPPORT_SETTING, pause: !manage });
  const [profiles] = useQuery<{ supportProfilesPage: { total: number; pageSize: number; rows: { id: string; studentId: string; studentName: string; status: string; published: boolean; nextReviewDueKey: string | null; safeguardingBanner: boolean }[] } }>({
    query: SUPPORT_PROFILES,
    variables: { page: pageNo, pageSize: 50 },
    pause: !can("support_profile:view_all"),
  });
  const [load] = useQuery<{ supportApprovalLoadJson: string }>({ query: SUPPORT_APPROVAL_LOAD, pause: !can("support_profile:approve"), requestPolicy: "cache-and-network" });
  const [pick] = useQuery<{ supportReportableStudents: { id: string; name: string }[] }>({
    query: SUPPORT_REPORTABLE_STUDENTS,
    variables: { search },
    pause: !can("support_profile:report") || search.trim().length < 2,
  });
  const [, setSwitch] = useMutation(SET_SUPPORT_SWITCH);
  const [, choose] = useMutation(RECORD_APPROVAL_LOAD_CHOICE);
  const on = setting.data?.supportProfileSetting.switchedOn;
  let ld: Load | null = null;
  try {
    ld = load.data?.supportApprovalLoadJson ? (JSON.parse(load.data.supportApprovalLoadJson) as Load) : null;
  } catch {
    ld = null;
  }
  const reviewDay = ld?.reviewDueKey && ld.reviewDueKey <= dateKey();
  const pg = profiles.data?.supportProfilesPage;
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        {manage && setting.data ? (
          <Card>
            {!on ? <Notice message={STR.supHomeSwitchOff} tone="info" /> : null}
            <Button
              title={on ? STR.supSwitchOff : STR.supSwitchOn}
              variant={on ? "ghost" : "primary"}
              onPress={async () => {
                const r = await setSwitch({ on: !on });
                if (r.error) return toast.show(friendlyError(r.error), "danger");
                refetch({ requestPolicy: "network-only" });
              }}
            />
          </Card>
        ) : null}
        {can("support_profile:report") ? <Button title={STR.supMyReports} onPress={() => navigation.navigate("MySupportReports")} /> : null}
        {can("support_profile:report") ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.supPickChild}</Body>
            <Field label={STR.supSearchChild} value={search} onChangeText={setSearch} />
            {(pick.data?.supportReportableStudents ?? []).map((s) => (
              <Button key={s.id} title={`${STR.supStartReport} — ${s.name}`} variant="secondary" onPress={() => navigation.navigate("SupportReportForm", { studentId: s.id })} />
            ))}
          </Card>
        ) : null}
        {can("support_profile:approve") ? <Button title={STR.supQueueTitle} variant="secondary" onPress={() => navigation.navigate("SupportQueue")} /> : null}
        {can("support_profile:process") ? <Button title={STR.supBatchTitle} variant="secondary" onPress={() => navigation.navigate("SupportBatch")} /> : null}
        {can("safeguarding:receive") ? <Button title={STR.supRefTitle} variant="danger" onPress={() => navigation.navigate("SafeguardingReferrals")} /> : null}
        {ld ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.supLoadTitle}</Body>
            <Muted>{`${STR.supWaiting}: ${bnNum(ld.waitingToProcess)}${ld.oldestWaitingDays != null ? ` · ${STR.supOldestDays} ${bnNum(ld.oldestWaitingDays)}` : ""}`}</Muted>
            <Muted>{`${STR.supProcessed}: ${bnNum(ld.largest)}${ld.medianDaysToDecision != null ? ` · ${bnNum(ld.medianDaysToDecision)}` : ""}`}</Muted>
            {ld.reviewDueKey ? <Muted>{`${STR.supLoadReviewDue}: ${ld.reviewDueKey}`}</Muted> : null}
            {ld.tooHeavy ? <Notice message={STR.supLoadHeavy} tone="warn" /> : null}
            {manage && (reviewDay || ld.tooHeavy)
              ? CHOICES.map(([k, label]) => (
                  <Button
                    key={k}
                    title={label}
                    variant="secondary"
                    onPress={async () => {
                      const r = await choose({ choice: k, nextInDays: 90 });
                      if (r.error) return toast.show(friendlyError(r.error), "danger");
                      toast.show(`${STR.supNextReview}: ${r.data?.recordSupportApprovalLoadChoice ?? ""}`, "ok");
                    }}
                  />
                ))
              : null}
          </Card>
        ) : null}
        {pg?.rows.map((p) => (
          <Card key={p.id}>
            <Body>{p.studentName}</Body>
            {p.safeguardingBanner ? <Badge text={STR.supBannerSg} /> : null}
            <Muted>{`${STATUS_BN[p.status] ?? p.status}${p.published ? "" : " · —"}${p.nextReviewDueKey ? ` · ${STR.supNextReview}: ${p.nextReviewDueKey}` : ""}${p.nextReviewDueKey && p.nextReviewDueKey <= dateKey() ? ` · ${STR.supReviewDueRow}` : ""}`}</Muted>
            <Button title={STR.supFullProfile} variant="ghost" onPress={() => navigation.navigate("SupportCard", { studentId: p.studentId, via: "QUEUE", full: true })} />
          </Card>
        ))}
        {pg && pg.total > pageNo * pg.pageSize ? <Button title={STR.supMore} variant="ghost" onPress={() => setPageNo(pageNo + 1)} /> : null}
        {pageNo > 1 ? <Button title="‹" variant="ghost" onPress={() => setPageNo(pageNo - 1)} /> : null}
      </ScrollView>
    </Screen>
  );
}
