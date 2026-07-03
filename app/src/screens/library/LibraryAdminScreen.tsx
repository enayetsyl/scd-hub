/**
 * LibraryAdminScreen (LB-4, `library:manage`) — per-borrower-type loan policy
 * editor (admin DATA with PRD working values as defaults, D-#82) + librarian
 * duty assign/revoke (append-only log, D-#81) + the duty history.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import {
  LIBRARY_POLICIES_QUERY,
  UPSERT_LIBRARY_POLICY,
  CURRENT_LIBRARIANS_QUERY,
  LIBRARIAN_HISTORY_QUERY,
  ASSIGN_LIBRARIAN,
  REVOKE_LIBRARIAN,
  type LibraryPolicyT,
} from "../../graphql/operations";
import { Screen, Body, Muted, Card, Button, Badge, Field, Notice } from "../../components/ui";
import { TeacherSelect } from "../../components/selects";
import { STR, borrowerTypeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

function PolicyCard({
  policy,
  onSaved,
  onError,
}: {
  policy: LibraryPolicyT;
  onSaved: () => void;
  onError: (msg: string) => void;
}): React.ReactElement {
  const [loanDays, setLoanDays] = useState(String(policy.loanDays));
  const [maxConcurrent, setMaxConcurrent] = useState(String(policy.maxConcurrent));
  const [maxRenewals, setMaxRenewals] = useState(String(policy.maxRenewals));
  const [holdDays, setHoldDays] = useState(String(policy.holdDays));
  const [busy, setBusy] = useState(false);
  const [, upsert] = useMutation(UPSERT_LIBRARY_POLICY);

  async function save(): Promise<void> {
    setBusy(true);
    const res = await upsert({
      borrowerType: policy.borrowerType,
      loanDays: Number(loanDays),
      maxConcurrent: Number(maxConcurrent),
      maxRenewals: Number(maxRenewals),
      holdDays: Number(holdDays),
    });
    setBusy(false);
    if (res.error) {
      onError(friendlyError(res.error));
      return;
    }
    onSaved();
  }

  const valid = [loanDays, maxConcurrent, maxRenewals, holdDays].every((v) => /^\d+$/.test(v.trim()));

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
        <Body style={{ flex: 1, fontWeight: "700" }}>{borrowerTypeLabel(policy.borrowerType)}</Body>
        {policy.isDefault ? <Badge text={STR.libPolicyDefaultBadge} tone="info" /> : null}
      </View>
      <Field label={STR.libLoanDays} value={loanDays} onChangeText={setLoanDays} keyboardType="numeric" />
      <Field label={STR.libMaxConcurrent} value={maxConcurrent} onChangeText={setMaxConcurrent} keyboardType="numeric" />
      <Field label={STR.libMaxRenewals} value={maxRenewals} onChangeText={setMaxRenewals} keyboardType="numeric" />
      <Field label={STR.libHoldDays} value={holdDays} onChangeText={setHoldDays} keyboardType="numeric" />
      <Button title={STR.save} onPress={() => void save()} loading={busy} disabled={busy || !valid} />
    </Card>
  );
}

export default function LibraryAdminScreen(): React.ReactElement {
  const { confirmAction } = useConfirm();
  const [teacherId, setTeacherId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [policiesQ, refetchPolicies] = useQuery({ query: LIBRARY_POLICIES_QUERY });
  const [currentQ, refetchCurrent] = useQuery({ query: CURRENT_LIBRARIANS_QUERY });
  const [historyQ, refetchHistory] = useQuery({ query: LIBRARIAN_HISTORY_QUERY });
  const [, assign] = useMutation(ASSIGN_LIBRARIAN);
  const [, revoke] = useMutation(REVOKE_LIBRARIAN);

  const policies = policiesQ.data?.libraryPolicies ?? [];
  const current = currentQ.data?.currentLibrarians ?? [];
  const history = historyQ.data?.librarianHistory ?? [];

  function refresh(): void {
    refetchPolicies({ requestPolicy: "network-only" });
    refetchCurrent({ requestPolicy: "network-only" });
    refetchHistory({ requestPolicy: "network-only" });
  }

  async function run(action: () => Promise<{ error?: unknown }>, okMsg: string): Promise<void> {
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await action();
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error as never));
      return;
    }
    setOk(okMsg);
    refresh();
  }

  return (
    <Screen scroll>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      {/* Loan policies (D-#82 — admin data, defaults until edited) */}
      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.libPolicies}</Body>
      {policies.map((p) => (
        <PolicyCard
          key={`${p.borrowerType}:${p.loanDays}:${p.maxConcurrent}:${p.maxRenewals}:${p.holdDays}`}
          policy={p}
          onSaved={() => {
            setOk(STR.libPolicySaved);
            setError(null);
            refresh();
          }}
          onError={(msg) => {
            setError(msg);
            setOk(null);
          }}
        />
      ))}

      {/* Librarian duty (D-#81 — append-only, teachers only) */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(1) }}>{STR.libLibrarians}</Body>
      {current.length === 0 ? <Muted>{STR.libNoLibrarians}</Muted> : null}
      {current.map((l) => (
        <Card key={l.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
            <Body style={{ flex: 1, fontWeight: "700" }}>{l.userName ?? l.userId}</Body>
            <Button
              title={STR.libRevokeLibrarian}
              variant="danger"
              onPress={async () => {
                if (!(await confirmAction({ confirmLabel: STR.libRevokeLibrarian }))) return;
                void run(() => revoke({ teacherUserId: l.userId }), STR.libLibrarianRevoked);
              }}
              disabled={busy}
            />
          </View>
        </Card>
      ))}
      <TeacherSelect label={STR.libAssignLibrarian} value={teacherId} onChange={setTeacherId} />
      <Button
        title={STR.libAssignLibrarian}
        onPress={() => void run(() => assign({ teacherUserId: teacherId.trim() }), STR.libLibrarianAssigned)}
        loading={busy}
        disabled={busy || teacherId.trim() === ""}
      />

      {/* History (ADR-008) */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(1) }}>{STR.libHistory}</Body>
      {history.length === 0 ? <Muted>{STR.libNoHistory}</Muted> : null}
      {history.map((h) => (
        <Card key={h.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
            <Body style={{ flex: 1, fontWeight: "700" }}>{h.userName ?? h.userId}</Body>
            <Badge text={h.action} tone={h.action === "assign" ? "ok" : "muted"} />
          </View>
          <Muted>{new Date(h.at).toLocaleString()}</Muted>
        </Card>
      ))}
    </Screen>
  );
}
