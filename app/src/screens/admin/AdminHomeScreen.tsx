/**
 * AdminHomeScreen — admin menu, entries gated by the caller's permissions.
 * Import → content:import (Principal/Office); Users + ScopeGrants → user:manage
 * (Principal). PRD §8 RBAC rules.
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { roleHasPermission } from "@scd/shared";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Notice } from "../../components/ui";
import { STR } from "../../lib/labels";
import { useAuth } from "../../auth/AuthContext";

type Props = NativeStackScreenProps<AdminStackParamList, "AdminHome">;

export default function AdminHomeScreen({ navigation }: Props): React.ReactElement {
  const { role } = useAuth();
  const canImport = !!role && roleHasPermission(role, "content:import");
  const canManageUsers = !!role && roleHasPermission(role, "user:manage");
  const canRoster = !!role && roleHasPermission(role, "roster:manage");

  return (
    <Screen scroll>
      <H2>{STR.admin}</H2>

      {canImport ? (
        <Card onPress={() => navigation.navigate("Import")}>
          <Body style={{ fontWeight: "700" }}>{STR.importContent}</Body>
          <Muted>J1.1</Muted>
        </Card>
      ) : null}

      {canManageUsers ? (
        <Card onPress={() => navigation.navigate("UserList")}>
          <Body style={{ fontWeight: "700" }}>{STR.users}</Body>
          <Muted>J5.1</Muted>
        </Card>
      ) : null}

      {canManageUsers ? (
        <Card onPress={() => navigation.navigate("ScopeGrant")}>
          <Body style={{ fontWeight: "700" }}>{STR.scopeGrants}</Body>
          <Muted>J5.4 / J5.7</Muted>
        </Card>
      ) : null}

      {canRoster ? (
        <Card onPress={() => navigation.navigate("Roster")}>
          <Body style={{ fontWeight: "700" }}>{STR.roster}</Body>
          <Muted>{STR.rosterCount}</Muted>
        </Card>
      ) : null}

      {!canImport && !canManageUsers && !canRoster ? <Notice message={STR.noPermission} tone="warn" /> : null}
    </Screen>
  );
}
