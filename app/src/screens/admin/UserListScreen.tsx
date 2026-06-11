/**
 * UserListScreen (S15 / J5.1) — staff users. The server exposes `me` and
 * createUser but no `users` list query, so we show the current user and a
 * create-staff form (createUser → user:manage). A full roster needs a server
 * `users` query (noted in STATUS as a follow-up).
 */
import React, { useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation } from "urql";
import { ROLES } from "@scd/shared";
import { CREATE_USER } from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Row, Chip, ChipRow, Button, Field, Notice, Divider } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";

type Props = NativeStackScreenProps<AdminStackParamList, "UserList">;

const STAFF_ROLES = ROLES.filter((r) => r !== "GUARDIAN");

export default function UserListScreen(_props: Props): React.ReactElement {
  const { user } = useAuth();
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
  }

  return (
    <Screen scroll>
      <H2>{STR.users}</H2>

      {user ? (
        <Card>
          <Row label={STR.name} value={user.name} />
          <Row label={STR.email} value={user.email} />
          <Row label={STR.role} value={user.role} />
        </Card>
      ) : null}
      <Muted>{STR.userListNotExposed}</Muted>

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
