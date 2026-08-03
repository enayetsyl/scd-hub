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
  const { role, can } = useAuth();
  const canImport = !!role && roleHasPermission(role, "content:import");
  const canManageUsers = !!role && roleHasPermission(role, "user:manage");
  const canRoster = !!role && roleHasPermission(role, "roster:manage");
  const canRoutine = !!role && roleHasPermission(role, "routine:manage");
  const canStaff = !!role && roleHasPermission(role, "staff:manage");
  const canGuardianCreds = !!role && roleHasPermission(role, "guardian:link");
  const canTemplates = !!role && roleHasPermission(role, "template:manage");
  // access:manage is RESERVED-locked + Principal-only — roleHasPermission is exact here.
  const canAccess = !!role && roleHasPermission(role, "access:manage");
  const canAudit = !!role && roleHasPermission(role, "audit:read");
  // Anyone who works the image queue: the illustrator, and the reviewers who look at
  // what came back. `book:read` alone is not enough — that is a spectator.
  const canBookImages = can("book:illustrate") || can("book:review") || can("book:review_senior");
  const canBookReview = can("book:review") || can("book:review_senior");
  const canBookAssemble = can("book:assemble");

  return (
    <Screen scroll>
      <H2>{STR.admin}</H2>

      {canImport ? (
        <Card onPress={() => navigation.navigate("Import")}>
          <Body style={{ fontWeight: "700" }}>{STR.importContent}</Body>
          <Muted>{STR.admSubImport}</Muted>
        </Card>
      ) : null}

      {canManageUsers ? (
        <Card onPress={() => navigation.navigate("UserList")}>
          <Body style={{ fontWeight: "700" }}>{STR.users}</Body>
          <Muted>{STR.admSubUsers}</Muted>
        </Card>
      ) : null}

      {canManageUsers ? (
        <Card onPress={() => navigation.navigate("ScopeGrant")}>
          <Body style={{ fontWeight: "700" }}>{STR.scopeGrants}</Body>
          <Muted>{STR.admSubScope}</Muted>
        </Card>
      ) : null}

      {canManageUsers ? (
        <Card onPress={() => navigation.navigate("AssignSubjectTeacher")}>
          <Body style={{ fontWeight: "700" }}>{STR.assignSubjectTeacher}</Body>
          <Muted>{STR.admSubAssignSubject}</Muted>
        </Card>
      ) : null}

      {canManageUsers ? (
        <Card onPress={() => navigation.navigate("SupervisoryGrant")}>
          <Body style={{ fontWeight: "700" }}>{STR.sgManage}</Body>
          <Muted>{STR.admSubSupervisory}</Muted>
        </Card>
      ) : null}

      {canRoster ? (
        <Card onPress={() => navigation.navigate("Roster")}>
          <Body style={{ fontWeight: "700" }}>{STR.roster}</Body>
          <Muted>{STR.rosterCount}</Muted>
        </Card>
      ) : null}

      {/* Owner ask 2026-07-20: the Reconciliation + HW-lifecycle report cards moved
          to the drawer Reports group; their Admin-stack routes remain for deep links. */}
      {canAudit ? (
        <Card onPress={() => navigation.navigate("AuditLog")}>
          <Body style={{ fontWeight: "700" }}>{STR.audTitle}</Body>
          <Muted>{STR.audSubtitle}</Muted>
        </Card>
      ) : null}

      {/* SH-1 (D-#414): same gate as the audit log — `audit:read` is Principal-only, and
          infrastructure headroom is a Principal decision (prune, archive, or pay). */}
      {canAudit ? (
        <Card onPress={() => navigation.navigate("SystemHealth")}>
          <Body style={{ fontWeight: "700" }}>{STR.shTitle}</Body>
          <Muted>{STR.shSubtitle}</Muted>
        </Card>
      ) : null}

      {/* SB-2: support-book image production. Gated on the caller's EFFECTIVE
          permissions, not the role template — `book:*` sits only on the PRINCIPAL
          template and every illustrator reaches it by per-user grant (D-#405), so
          `roleHasPermission` would hide this from the people who use it most. */}
      {canBookImages ? (
        <Card onPress={() => navigation.navigate("BookImageQueue")}>
          <Body style={{ fontWeight: "700" }}>{STR.sbQueueTitle}</Body>
          <Muted>{STR.sbQueueSub}</Muted>
        </Card>
      ) : null}

      {canBookReview ? (
        <Card onPress={() => navigation.navigate("BookReview")}>
          <Body style={{ fontWeight: "700" }}>{STR.sbReviewTitle}</Body>
          <Muted>{STR.sbReviewSub}</Muted>
        </Card>
      ) : null}

      {/* The inbox is offered to ordinary reviewers too, not only seniors: a reviewer
          needs to follow the thread they raised. Only a senior gets the resolve form,
          and that is decided inside the screen. */}
      {canBookReview ? (
        <Card onPress={() => navigation.navigate("BookEscalationInbox")}>
          <Body style={{ fontWeight: "700" }}>{STR.sbInboxTitle}</Body>
          <Muted>{STR.sbInboxSub}</Muted>
        </Card>
      ) : null}

      {canBookAssemble ? (
        <Card onPress={() => navigation.navigate("BookAssemble")}>
          <Body style={{ fontWeight: "700" }}>{STR.sbAssembleTitle}</Body>
          <Muted>{STR.sbAssembleSub}</Muted>
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
          <Muted>{STR.admSubAssignClass}</Muted>
        </Card>
      ) : null}

      {canRoutine ? (
        <Card onPress={() => navigation.navigate("GroupMembers")}>
          <Body style={{ fontWeight: "700" }}>{STR.gmTitle}</Body>
          <Muted>{STR.admSubGroupMembers}</Muted>
        </Card>
      ) : null}

      {canRoster ? (
        <Card onPress={() => navigation.navigate("SectionConfig")}>
          <Body style={{ fontWeight: "700" }}>{STR.sectionConfig}</Body>
          <Muted>{STR.admSubSection}</Muted>
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
          <Muted>{STR.admSubGuardianCreds}</Muted>
        </Card>
      ) : null}

      {canManageUsers ? (
        <Card onPress={() => navigation.navigate("StaffCredentials")}>
          <Body style={{ fontWeight: "700" }}>{STR.staffCredentials}</Body>
          <Muted>{STR.admSubStaffCreds}</Muted>
        </Card>
      ) : null}

      {canTemplates ? (
        <Card onPress={() => navigation.navigate("MessageTemplates")}>
          <Body style={{ fontWeight: "700" }}>{STR.mtMessageTemplates}</Body>
          <Muted>{STR.admSubTemplates}</Muted>
        </Card>
      ) : null}

      {canAccess ? (
        <Card onPress={() => navigation.navigate("AccessControlUsers")}>
          <Body style={{ fontWeight: "700" }}>{STR.acTitle}</Body>
          <Muted>{STR.admSubAccess}</Muted>
        </Card>
      ) : null}

      {!canImport && !canManageUsers && !canRoster && !canStaff && !canGuardianCreds && !canTemplates && !canAccess && !canRoutine ? (
        <Notice message={STR.noPermission} tone="warn" />
      ) : null}
    </Screen>
  );
}
