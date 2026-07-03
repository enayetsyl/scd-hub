/**
 * OffboardingHomeScreen — the staff exit workflow entry (prd-hr §6, H6, staff:manage).
 * Lists cases (status filter) and initiates a new one (trigger sets
 * StaffProfile.employmentStatus + seeds the default clearance checklist server-side).
 * Tap a case → its detail (clearance / access / settlement / exit / certificate).
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import { OFFBOARDING_TRIGGERS, OFFBOARDING_STATUSES } from "@scd/shared";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  OFFBOARDING_CASES_QUERY,
  INITIATE_OFFBOARDING,
  STAFF_QUERY,
} from "../../graphql/operations";
import type { HrStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Field,
  Select,
  Button,
  Chip,
  ChipRow,
  Badge,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { StaffSelect } from "../../components/selects";
import { DateField } from "../../components/DateField";
import { STR, bnNum, offboardingTriggerLabel, offboardingStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "OffboardingHome">;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function statusTone(s: string): "info" | "ok" | "muted" | "danger" {
  return s === "completed" ? "ok" : s === "cancelled" ? "muted" : s === "access_revoked" ? "danger" : "info";
}

export default function OffboardingHomeScreen({ navigation }: Props): React.ReactElement {
  const [status, setStatus] = React.useState<string | null>(null);
  const [staffId, setStaffId] = React.useState("");
  const [trigger, setTrigger] = React.useState<string | null>(null);
  const [lastDay, setLastDay] = React.useState("");
  const [noticeDate, setNoticeDate] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [casesQ, refetch] = useQuery({ query: OFFBOARDING_CASES_QUERY, variables: { status: status ?? undefined } });
  const [staffQ] = useQuery({ query: STAFF_QUERY, variables: {} });
  const [, initiate] = useMutation(INITIATE_OFFBOARDING);

  const cases = casesQ.data?.offboardingCases ?? [];
  const staffName = new Map((staffQ.data?.staff ?? []).map((s) => [s.id, s.nameBn || s.name]));

  const valid = staffId !== "" && trigger && ISO_DATE.test(lastDay) && (noticeDate === "" || ISO_DATE.test(noticeDate));

  async function runInitiate(): Promise<void> {
    if (!valid) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await initiate({
      staffProfileId: staffId,
      trigger: trigger!,
      lastWorkingDayKey: lastDay,
      noticeDateKey: noticeDate === "" ? undefined : noticeDate,
    });
    setBusy(false);
    const c = res.data?.initiateOffboarding;
    if (res.error || !c) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrOffboardingStarted);
    setStaffId("");
    setTrigger(null);
    setLastDay("");
    setNoticeDate("");
    refetch({ requestPolicy: "network-only" });
    navigation.navigate("OffboardingCase", { caseId: c.id, name: staffName.get(c.staffProfileId) ?? STR.hrStaffMember });
  }

  return (
    <Screen scroll>
      <H2>{STR.hrOffboarding}</H2>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      {/* Initiate */}
      <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.hrInitiateOffboarding}</Body>
      <Card>
        <StaffSelect label={STR.hrStaffMember} value={staffId} onChange={setStaffId} />
        <Select
          label={STR.hrTrigger}
          value={trigger}
          options={OFFBOARDING_TRIGGERS.map((tg) => ({ label: offboardingTriggerLabel(tg), value: tg }))}
          onChange={setTrigger}
          placeholder={STR.hrTrigger}
        />
        <DateField label={STR.hrLastWorkingDay} value={lastDay} onChange={setLastDay} helper={STR.hrDateHint} />
        <DateField label={STR.hrNoticeDate} value={noticeDate} onChange={setNoticeDate} helper={STR.hrDateHint} />
        <Button title={STR.hrInitiate} onPress={runInitiate} loading={busy} disabled={busy || !valid} />
      </Card>

      {/* Cases */}
      <Muted style={{ marginTop: space(4), marginBottom: space(1) }}>{STR.hrLeaveStatusFilter}</Muted>
      <ChipRow>
        {OFFBOARDING_STATUSES.map((s) => (
          <Chip key={s} label={offboardingStatusLabel(s)} selected={status === s} onPress={() => setStatus(s)} />
        ))}
        <Chip label={STR.allCategories} selected={status === null} onPress={() => setStatus(null)} />
      </ChipRow>

      {casesQ.fetching ? (
        <Loader label={STR.loading} />
      ) : casesQ.error ? (
        <ErrorBanner message={friendlyError(casesQ.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : cases.length === 0 ? (
        <EmptyState message={STR.hrNoCases} />
      ) : (
        cases.map((c) => (
          <Card key={c.id} onPress={() => navigation.navigate("OffboardingCase", { caseId: c.id, name: staffName.get(c.staffProfileId) ?? STR.hrStaffMember })}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700", flex: 1 }}>{staffName.get(c.staffProfileId) ?? STR.hrStaffMember}</Body>
              <Badge text={offboardingStatusLabel(c.status)} tone={statusTone(c.status)} />
            </View>
            <Muted>{offboardingTriggerLabel(c.trigger)} · {STR.hrLastWorkingDay}: {bnNum(c.lastWorkingDayKey)}</Muted>
          </Card>
        ))
      )}
    </Screen>
  );
}
