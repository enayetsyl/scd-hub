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
  const canStaff = !!role && roleHasPermission(role, "staff:manage");
  const canGuardianCreds = !!role && roleHasPermission(role, "guardian:link");
  const canTemplates = !!role && roleHasPermission(role, "template:manage");
  // access:manage is RESERVED-locked + Principal-only — roleHasPermission is exact here.
  const canAccess = !!role && roleHasPermission(role, "access:manage");

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

      {canManageUsers ? (
        <Card onPress={() => navigation.navigate("AssignSubjectTeacher")}>
          <Body style={{ fontWeight: "700" }}>{STR.assignSubjectTeacher}</Body>
          <Muted>ADR-017</Muted>
        </Card>
      ) : null}

      {canRoster ? (
        <Card onPress={() => navigation.navigate("Roster")}>
          <Body style={{ fontWeight: "700" }}>{STR.roster}</Body>
          <Muted>{STR.rosterCount}</Muted>
        </Card>
      ) : null}

      {canStaff ? (
        <Card onPress={() => navigation.navigate("Staff")}>
          <Body style={{ fontWeight: "700" }}>{STR.staff}</Body>
          <Muted>{STR.staffCount}</Muted>
        </Card>
      ) : null}

      {canRoster ? (
        <Card onPress={() => navigation.navigate("AssignClassTeacher")}>
          <Body style={{ fontWeight: "700" }}>{STR.assignClassTeacher}</Body>
          <Muted>D-#42</Muted>
        </Card>
      ) : null}

      {canRoster ? (
        <Card onPress={() => navigation.navigate("SectionConfig")}>
          <Body style={{ fontWeight: "700" }}>{STR.sectionConfig}</Body>
          <Muted>D-#62</Muted>
        </Card>
      ) : null}

      {canRoster ? (
        <Card onPress={() => navigation.navigate("AcademicYear")}>
          <Body style={{ fontWeight: "700" }}>{STR.ayManage}</Body>
          <Muted>{STR.ayHint}</Muted>
        </Card>
      ) : null}

      {canGuardianCreds ? (
        <Card onPress={() => navigation.navigate("GuardianCredentials")}>
          <Body style={{ fontWeight: "700" }}>{STR.guardianCredentials}</Body>
          <Muted>D-#59</Muted>
        </Card>
      ) : null}

      {canManageUsers ? (
        <Card onPress={() => navigation.navigate("StaffCredentials")}>
          <Body style={{ fontWeight: "700" }}>{STR.staffCredentials}</Body>
          <Muted>D-#60</Muted>
        </Card>
      ) : null}

      {canTemplates ? (
        <Card onPress={() => navigation.navigate("MessageTemplates")}>
          <Body style={{ fontWeight: "700" }}>{STR.mtMessageTemplates}</Body>
          <Muted>D-#128</Muted>
        </Card>
      ) : null}

      {canAccess ? (
        <Card onPress={() => navigation.navigate("AccessControlUsers")}>
          <Body style={{ fontWeight: "700" }}>{STR.acTitle}</Body>
          <Muted>D-#193</Muted>
        </Card>
      ) : null}

      {!canImport && !canManageUsers && !canRoster && !canStaff && !canGuardianCreds && !canTemplates && !canAccess ? (
        <Notice message={STR.noPermission} tone="warn" />
      ) : null}
    </Screen>
  );
}
