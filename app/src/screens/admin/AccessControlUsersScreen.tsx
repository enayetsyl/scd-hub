/**
 * AccessControlUsersScreen (AC-2, prd-access-control §6) — the Principal picks a
 * staff member to edit per-user permissions. Lists every staff account via the
 * existing `users` query (GUARDIAN excluded — the guardian plane is walled off,
 * J-AC4); tap a row → AccessControlEdit. Gated `access:manage` (server re-checks).
 *
 * PM (D-#800): a By role / By person switch on top. "By role" is the Roles view — every
 * feature × action for the Teacher or Office template (AccessControlRolesPanel).
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { USERS_QUERY } from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Row, Chip, ChipRow, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import AccessControlRolesPanel from "./AccessControlRolesPanel";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "AccessControlUsers">;

export default function AccessControlUsersScreen({ navigation }: Props): React.ReactElement {
  const [{ data, fetching, error }, refetch] = useQuery({ query: USERS_QUERY });
  const [view, setView] = React.useState<"roles" | "people">("roles");

  React.useEffect(() => {
    const unsub = navigation.addListener("focus", () => refetch({ requestPolicy: "network-only" }));
    return unsub;
  }, [navigation, refetch]);

  const tabs = (
    <ChipRow>
      <Chip label={STR.acTabRoles} selected={view === "roles"} onPress={() => setView("roles")} />
      <Chip label={STR.acTabPeople} selected={view === "people"} onPress={() => setView("people")} />
    </ChipRow>
  );
  if (view === "roles")
    return (
      <Screen scroll>
        {tabs}
        <AccessControlRolesPanel />
      </Screen>
    );

  if (fetching && !data) return <Loader label={STR.acTitle} />;
  if (error)
    return (
      <Screen padded>
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      </Screen>
    );

  // The per-user model governs the staff User only (J-AC4) — never a Guardian login.
  const staff = (data?.users ?? []).filter((u) => u.role !== "GUARDIAN");
  if (staff.length === 0) return <Screen padded><EmptyState message={STR.acNoStaff} /></Screen>;

  return (
    <Screen scroll>
      {tabs}
      <Muted style={{ marginBottom: space(3) }}>{STR.acSubtitle}</Muted>
      {staff.map((u) => (
        <Card
          key={u.id}
          onPress={() => navigation.navigate("AccessControlEdit", { userId: u.id, name: u.name, role: u.role })}
        >
          <Body style={{ fontWeight: "700" }}>
            {u.name}
            {u.active ? "" : ` — ${STR.inactive}`}
          </Body>
          <Row label={STR.role} value={u.role} />
          <Row label={STR.emailOrPhone} value={u.email ?? u.phone ?? "—"} />
        </Card>
      ))}
    </Screen>
  );
}
