/**
 * UserListScreen (S15 / J5.1) — staff users. Lists every staff account via the
 * `users` query (user:manage / Principal — Slice-4 follow-up; no more
 * "current user only") plus the create-staff form (createUser → user:manage).
 */
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { ROLES, roleHasPermission } from "@scd/shared";
import type { Role } from "@scd/shared";
import { CREATE_USER, USERS_QUERY } from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Row, Chip, ChipRow, Button, Field, Notice, Divider, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";

type Props = NativeStackScreenProps<AdminStackParamList, "UserList">;

const STAFF_ROLES = ROLES.filter((r) => r !== "GUARDIAN");

export default function UserListScreen(_props: Props): React.ReactElement {
  const { user } = useAuth();
  const canManage = !!user && roleHasPermission(user.role as Role, "user:manage");
  const [{ data, fetching, error: usersError }, refetchUsers] = useQuery({
    query: USERS_QUERY,
    pause: !canManage,
  });
  const users = data?.users ?? [];

  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const shown = q
    ? users.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          (u.email ?? "").toLowerCase().includes(q) ||
          (u.phone ?? "").toLowerCase().includes(q),
      )
    : users;

  // Refresh on focus: logins provisioned on another screen (StaffCredentials)
  // won't appear otherwise — urql's document cache isn't invalidated by
  // provisionStaffLogin (it returns a ProvisionedCredential, not a User).
  useFocusEffect(
    useCallback(() => {
      if (canManage) refetchUsers({ requestPolicy: "network-only" });
    }, [canManage, refetchUsers]),
  );

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, createUser] = useMutation(CREATE_USER);

  async function onCreate(): Promise<void> {
    if (!name.trim() || !email.trim() || !password || !role || busy) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    const res = await createUser({ email: email.trim(), password, role, name: name.trim() });
    setBusy(false);
    if (res.error || !res.data?.createUser) {
      setError(friendlyError(res.error));
      return;
    }
    setMsg(STR.userCreated);
    setName("");
    setEmail("");
    setPassword("");
    setRole(null);
    refetchUsers({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <H2>{STR.users}</H2>

      {canManage ? (
        <>
          {usersError ? <ErrorBanner message={friendlyError(usersError)} onRetry={() => refetchUsers({ requestPolicy: "network-only" })} /> : null}
          {fetching ? (
            <Loader label={STR.loading} />
          ) : users.length === 0 ? (
            <EmptyState message={STR.noUsers} />
          ) : (
            <>
              <Field label={undefined} value={search} onChangeText={setSearch} placeholder={STR.searchUsers} />
              {shown.length === 0 ? (
                <EmptyState message={STR.noMatches} />
              ) : (
                shown.map((u) => (
                  <Card key={u.id}>
                    <Body style={{ fontWeight: "700" }}>
                      {u.name}
                      {u.active ? "" : ` — ${STR.inactive}`}
                    </Body>
                    <Row label={STR.role} value={u.role} />
                    <Row label={STR.emailOrPhone} value={u.email ?? u.phone ?? "—"} />
                  </Card>
                ))
              )}
            </>
          )}
        </>
      ) : user ? (
        <Card>
          <Row label={STR.name} value={user.name} />
          <Row label={STR.emailOrPhone} value={user.email ?? user.phone ?? "—"} />
          <Row label={STR.role} value={user.role} />
        </Card>
      ) : null}

      <Divider />
      <H2>{STR.createUser}</H2>

      <Muted>{STR.role}</Muted>
      <ChipRow>
        {STAFF_ROLES.map((r) => (
          <Chip key={r} label={r} selected={role === r} onPress={() => setRole(role === r ? null : r)} />
        ))}
      </ChipRow>

      <Field label={STR.name} value={name} onChangeText={setName} autoCapitalize="words" />
      <Field label={STR.email} value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label={STR.password} value={password} onChangeText={setPassword} secureTextEntry />

      {error ? <Notice message={error} tone="danger" /> : null}
      {msg ? <Notice message={msg} tone="ok" /> : null}

      <Button
        title={busy ? STR.saving : STR.createUser}
        onPress={onCreate}
        loading={busy}
        disabled={!name.trim() || !email.trim() || !password || !role}
      />
    </Screen>
  );
}
