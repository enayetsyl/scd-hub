/**
 * AdminHomeScreen — admin menu, entries gated by the caller's permissions.
 * PM (docs/permission-catalogue/foundation-platform.md §f): each card checks the
 * catalogue action its screen performs, so a Principal role edit or a per-person
 * grant shows/hides exactly that card. The server re-gates every call.
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Notice } from "../../components/ui";
import { STR } from "../../lib/labels";
import { useAuth } from "../../auth/AuthContext";

type Props = NativeStackScreenProps<AdminStackParamList, "AdminHome">;

export default function AdminHomeScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const canImport = can("lesson_plans:import") || can("question_bank:import");
  const canStaffLogins = can("staff_logins:view");
  const canProxy = can("cover:assign_proxy");
  const canAssignSubject = can("teaching_assignments:assign_subject_teacher");
  const canAssignSupervisor = can("teaching_assignments:assign_supervisor");
  const canStudents = can("students:view_all");
  const canAssignClassTeacher =
    can("teaching_assignments:assign_class_teacher") || can("teaching_assignments:assign_homework_checker");
  const canSections = can("classes_sections:merge_split");
  const canYears = can("classes_sections:settings");
  // PM: the routine card opens subject-group membership (addGroupMember etc. =
  // routine:settings). The screen first lists the groups on routine:view, so the card
  // needs both (owner rule 2026-10-25: no card onto a refusal).
  const canRoutine = can("routine:settings") && can("routine:view");
  const canStaff = can("staff_records:view");
  const canGuardianCreds = can("guardians:reset_password") || can("guardians:link");
  // message_templates:* and access_control:* are LOCKED (Principal-only).
  const canTemplates = can("message_templates:view");
  const canAccess = can("access_control:edit");
  // audit:read split four ways (PM): the log, one person's activity, system health,
  // guardian app usage.
  const canAuditLog = can("audit_log:view");
  const canActivity = can("audit_log:view_activity");
  const canHealth = can("system_health:view");
  const canEngagement = can("guardian_engagement:view");
  // GC-5: the guardian-claim queue is an Office/Principal screen and rides the
  // tracker:read they already hold — no new permission (D-#554).
  // BUG-WC-3: gated on ROLE, not tracker:read — OFFICE deliberately holds no
  // tracker permission, so the old gate hid the queue from the role it is for.
  // Owner ask 2026-10-04: template-aware, matching the server's `canWatchClaims`
  // (isAdminStaff) — a teacher holding the Office template from Access control
  // (Akter, Tazkir) could already read the queue but never saw this card.
  // PM: `work_claim:view_all` without the digest designation — i.e. with its waiver
  // `admin_dashboard:view` (Principal + Office by default, template-aware like isRole was).
  const canWorkClaims = can("work_claim:view_all") && can("admin_dashboard:view");
  // AR-2: the ranking reads the two attendance registers, so it sits behind the
  // actions that own them (PM): student ranking attendance:view_all, staff ranking
  // staff_attendance:view_all — Principal + Office by default.
  const canAttendance = can("attendance:view_all") || can("staff_attendance:view_all");

  return (
    <Screen scroll>
      <H2>{STR.admin}</H2>

      {canImport ? (
        <Card onPress={() => navigation.navigate("Import")}>
          <Body style={{ fontWeight: "700" }}>{STR.importContent}</Body>
          <Muted>{STR.admSubImport}</Muted>
        </Card>
      ) : null}

      {canStaffLogins ? (
        <Card onPress={() => navigation.navigate("UserList")}>
          <Body style={{ fontWeight: "700" }}>{STR.users}</Body>
          <Muted>{STR.admSubUsers}</Muted>
        </Card>
      ) : null}

      {canProxy ? (
        <Card onPress={() => navigation.navigate("ScopeGrant")}>
          <Body style={{ fontWeight: "700" }}>{STR.scopeGrants}</Body>
          <Muted>{STR.admSubScope}</Muted>
        </Card>
      ) : null}

      {canAssignSubject ? (
        <Card onPress={() => navigation.navigate("AssignSubjectTeacher")}>
          <Body style={{ fontWeight: "700" }}>{STR.assignSubjectTeacher}</Body>
          <Muted>{STR.admSubAssignSubject}</Muted>
        </Card>
      ) : null}

      {canAssignSupervisor ? (
        <Card onPress={() => navigation.navigate("SupervisoryGrant")}>
          <Body style={{ fontWeight: "700" }}>{STR.sgManage}</Body>
          <Muted>{STR.admSubSupervisory}</Muted>
        </Card>
      ) : null}

      {canStudents ? (
        <Card onPress={() => navigation.navigate("Roster")}>
          <Body style={{ fontWeight: "700" }}>{STR.roster}</Body>
          <Muted>{STR.rosterCount}</Muted>
        </Card>
      ) : null}

      {/* Owner ask 2026-07-20: the Reconciliation + HW-lifecycle report cards moved
          to the drawer Reports group; their Admin-stack routes remain for deep links. */}
      {canAttendance ? (
        <Card onPress={() => navigation.navigate("AttendanceRanking")}>
          <Body style={{ fontWeight: "700" }}>{STR.arTitle}</Body>
          <Muted>{STR.arHint}</Muted>
        </Card>
      ) : null}

      {canWorkClaims ? (
        <Card onPress={() => navigation.navigate("WorkClaimQueue")}>
          <Body style={{ fontWeight: "700" }}>{STR.wcQueueTitle}</Body>
          <Muted>{STR.wcOfficeFooter}</Muted>
        </Card>
      ) : null}

      {canAuditLog ? (
        <Card onPress={() => navigation.navigate("AuditLog")}>
          <Body style={{ fontWeight: "700" }}>{STR.audTitle}</Body>
          <Muted>{STR.audSubtitle}</Muted>
        </Card>
      ) : null}

      {/* AL-1 (D-#645): audit_log:view_activity — the audit log read the other way round — the
          audit log is the whole school newest-first, this is ONE person over a
          window, with the tracker passes the audit log never carried. */}
      {canActivity ? (
        <Card onPress={() => navigation.navigate("PersonActivity")}>
          <Body style={{ fontWeight: "700" }}>{STR.actTitle}</Body>
          <Muted>{STR.actSubtitle}</Muted>
        </Card>
      ) : null}

      {/* SH-1 (D-#414): `system_health:view` (was audit:read) — Principal by default, and
          infrastructure headroom is a Principal decision (prune, archive, or pay). */}
      {canHealth ? (
        <Card onPress={() => navigation.navigate("SystemHealth")}>
          <Body style={{ fontWeight: "700" }}>{STR.shTitle}</Body>
          <Muted>{STR.shSubtitle}</Muted>
        </Card>
      ) : null}

      {/* GE-1/GE-3 (D-#464/#465): `guardian_engagement:view` (was audit:read) —
          the report names families and their children, so it sits at the same
          Principal-only bar as the audit log itself. */}
      {canEngagement ? (
        <Card onPress={() => navigation.navigate("GuardianEngagement")}>
          <Body style={{ fontWeight: "700" }}>{STR.geTitle}</Body>
          <Muted>{STR.geSubtitle}</Muted>
        </Card>
      ) : null}

      {/* SB-2..SB-4: the four support-book screens are NOT cards here — they live in
          their own 📕 drawer group, because the Admin tab's own gate (content:import /
          staff logins) is a role template no granted illustrator or reviewer passes. */}

      {canStaff ? (
        <Card onPress={() => navigation.navigate("Staff")}>
          <Body style={{ fontWeight: "700" }}>{STR.staff}</Body>
          <Muted>{STR.staffCount}</Muted>
        </Card>
      ) : null}

      {canAssignClassTeacher ? (
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

      {canSections ? (
        <Card onPress={() => navigation.navigate("SectionConfig")}>
          <Body style={{ fontWeight: "700" }}>{STR.sectionConfig}</Body>
          <Muted>{STR.admSubSection}</Muted>
        </Card>
      ) : null}

      {canYears ? (
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

      {![
        canImport, canStaffLogins, canProxy, canAssignSubject, canAssignSupervisor, canStudents,
        canAttendance, canWorkClaims, canAuditLog, canActivity, canHealth, canEngagement, canStaff,
        canAssignClassTeacher, canRoutine, canSections, canYears, canGuardianCreds, canTemplates, canAccess,
      ].some(Boolean) ? (
        <Notice message={STR.noPermission} tone="warn" />
      ) : null}
    </Screen>
  );
}
