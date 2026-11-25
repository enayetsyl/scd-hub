/**
 * AdminHomeScreen — admin menu, entries gated by the caller's permissions.
 * PM (docs/permission-catalogue/foundation-platform.md §f): each card checks the
 * catalogue action its screen performs, so a Principal role edit or a per-person
 * grant shows/hides exactly that card. The server re-gates every call.
 *
 * D-#1654 (owner 2026-11-19): the cards sit under four sub-headings (people & logins, classes /
 * teachers / students, the academic year, oversight); a heading shows only when one of its cards
 * does. Import, message templates and the three AI screens moved to the sidebar (their routes stay
 * in this stack), and the staff list moved to the HR hub.
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import type { NavigationProp } from "@react-navigation/native";
import type { AdminStackParamList, TabParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Notice } from "../../components/ui";
import { space } from "../../theme/tokens";
import { STR } from "../../lib/labels";
import { useAuth } from "../../auth/AuthContext";

type Props = NativeStackScreenProps<
  AdminStackParamList,
  "AdminHome" | "AdminPeople" | "AdminClasses" | "AdminYear" | "AdminWatch"
>;

/**
 * Owner 2026-11-20: the sidebar has one row per section; each opens this screen filtered to that
 * section (AdminPeople ① / AdminClasses ② / AdminYear ③ / AdminWatch ④). AdminHome shows all four.
 */
export default function AdminHomeScreen({ navigation, route }: Props): React.ReactElement {
  const { can } = useAuth();
  const rootNav = useNavigation<NavigationProp<TabParamList>>();
  const only = route.name;
  const inSection = (name: "AdminPeople" | "AdminClasses" | "AdminYear" | "AdminWatch"): boolean =>
    only === "AdminHome" || only === name;
  const heading = only === "AdminHome";
  const canStaffLogins = can("staff_logins:view");
  const canProxy = can("cover:assign_proxy");
  const canAssignSubject = can("teaching_assignments:assign_subject_teacher");
  const canAssignSupervisor = can("teaching_assignments:assign_supervisor");
  const canStudents = can("students:view_all");
  // D-#1686 (owner 2026-11-25): ① People & logins also lists the staff and the students — a second way to the
  // same screens (staff list = HR hub's কর্মী তালিকা, same action; student list = ②'s card).
  const canStaffList = can("staff_records:view");
  const canAssignClassTeacher =
    can("teaching_assignments:assign_class_teacher") || can("teaching_assignments:assign_homework_checker");
  const canSections = can("classes_sections:merge_split");
  const canYears = can("classes_sections:settings");
  // Pause windows (D-#1655): a second way to the screen the Routine hub already opens (same action).
  const canPauses = can("routine:edit_calendar");
  // YC-5: the year-change screen is Principal-only (year_change:* is LOCKED).
  const canYearChange = can("year_change:view");
  // PM: the routine card opens subject-group membership (addGroupMember etc. =
  // routine:settings). The screen first lists the groups on routine:view, so the card
  // needs both (owner rule 2026-10-25: no card onto a refusal).
  const canRoutine = can("routine:settings") && can("routine:view");
  const canGuardianCreds = can("guardians:reset_password") || can("guardians:link");
  // access_control:* is LOCKED (Principal-only).
  const canAccess = can("access_control:edit");
  // audit:read split four ways (PM): the log, one person's activity, system health,
  // guardian app usage (the last is a report — Reports hub since D-#861).
  const canAuditLog = can("audit_log:view");
  const canActivity = can("audit_log:view_activity");
  const canHealth = can("system_health:view");
  // AI-4 (D-#1131): the Office writes children's Bangla names so the AI can hide them.
  const canBanglaNames = can("students:edit");
  // GC-5: the guardian-claim queue is an Office/Principal screen and rides the
  // tracker:read they already hold — no new permission (D-#554).
  // BUG-WC-3: gated on ROLE, not tracker:read — OFFICE deliberately holds no
  // tracker permission, so the old gate hid the queue from the role it is for.
  // Owner ask 2026-10-04: template-aware, matching the server's `canWatchClaims`
  // (isAdminStaff) — a teacher holding the Office template from Access control
  // (Akter, Tazkir) could already read the queue but never saw this card.
  // PM: `work_claim:view_all` without the digest designation — i.e. with its waiver
  // `admin_dashboard:view` (Principal + Office by default, template-aware like isRole was).
  // D-#861: Attendance ranking and Guardian reports — unresolved moved to the Reports hub
  // (one switch each); their Admin-stack routes remain for the digest's deep link.

  const showPeople =
    inSection("AdminPeople") &&
    (((canStaffList || canStudents) && only === "AdminPeople") || canStaffLogins || canGuardianCreds || canAccess || canProxy || canAssignSupervisor);
  const showClass =
    inSection("AdminClasses") &&
    (canStudents || canBanglaNames || canAssignSubject || canAssignClassTeacher || canRoutine || canSections);
  const showYear = inSection("AdminYear") && (canYears || canYearChange || canPauses);
  const showWatch = inSection("AdminWatch") && (canAuditLog || canActivity || canHealth);
  const title =
    only === "AdminPeople" ? STR.admGPeople
    : only === "AdminClasses" ? STR.admGClass
    : only === "AdminYear" ? STR.admGYear
    : only === "AdminWatch" ? STR.admGWatch
    : STR.admin;

  return (
    <Screen scroll>
      <H2>{title}</H2>

      {showPeople && heading ? <Muted style={{ marginTop: space(4), marginBottom: space(2) }}>{STR.admGPeople}</Muted> : null}
      {/* Owner 2026-11-25: the two lists sit first in ① (the full section view only — AdminHome keeps
          the student list under ② and the staff list in the HR hub, so no card shows twice there). */}
      {canStaffList && only === "AdminPeople" ? (
        <Card onPress={() => navigation.navigate("Staff")}>
          <Body style={{ fontWeight: "700" }}>{STR.staff}</Body>
          <Muted>{STR.staffCount}</Muted>
        </Card>
      ) : null}

      {canStudents && only === "AdminPeople" ? (
        <Card onPress={() => navigation.navigate("Roster")}>
          <Body style={{ fontWeight: "700" }}>{STR.roster}</Body>
          <Muted>{STR.rosterCount}</Muted>
        </Card>
      ) : null}

      {canStaffLogins && inSection("AdminPeople") ? (
        <Card onPress={() => navigation.navigate("UserList")}>
          <Body style={{ fontWeight: "700" }}>{STR.users}</Body>
          <Muted>{STR.admSubUsers}</Muted>
        </Card>
      ) : null}

      {canGuardianCreds && inSection("AdminPeople") ? (
        <Card onPress={() => navigation.navigate("GuardianCredentials")}>
          <Body style={{ fontWeight: "700" }}>{STR.guardianCredentials}</Body>
          <Muted>{STR.admSubGuardianCreds}</Muted>
        </Card>
      ) : null}

      {canAccess && inSection("AdminPeople") ? (
        <Card onPress={() => navigation.navigate("AccessControlUsers")}>
          <Body style={{ fontWeight: "700" }}>{STR.acTitle}</Body>
          <Muted>{STR.admSubAccess}</Muted>
        </Card>
      ) : null}

      {canProxy && inSection("AdminPeople") ? (
        <Card onPress={() => navigation.navigate("ScopeGrant")}>
          <Body style={{ fontWeight: "700" }}>{STR.scopeGrants}</Body>
          <Muted>{STR.admSubScope}</Muted>
        </Card>
      ) : null}

      {canAssignSupervisor && inSection("AdminPeople") ? (
        <Card onPress={() => navigation.navigate("SupervisoryGrant")}>
          <Body style={{ fontWeight: "700" }}>{STR.sgManage}</Body>
          <Muted>{STR.admSubSupervisory}</Muted>
        </Card>
      ) : null}

      {showClass && heading ? <Muted style={{ marginTop: space(4), marginBottom: space(2) }}>{STR.admGClass}</Muted> : null}
      {canStudents && inSection("AdminClasses") ? (
        <Card onPress={() => navigation.navigate("Roster")}>
          <Body style={{ fontWeight: "700" }}>{STR.roster}</Body>
          <Muted>{STR.rosterCount}</Muted>
        </Card>
      ) : null}

      {canBanglaNames && inSection("AdminClasses") ? (
        <Card onPress={() => navigation.navigate("StudentBanglaNames")}>
          <Body style={{ fontWeight: "700" }}>{STR.sbnTitle}</Body>
          <Muted>{STR.sbnSubtitle}</Muted>
        </Card>
      ) : null}

      {canAssignSubject && inSection("AdminClasses") ? (
        <Card onPress={() => navigation.navigate("AssignSubjectTeacher")}>
          <Body style={{ fontWeight: "700" }}>{STR.assignSubjectTeacher}</Body>
          <Muted>{STR.admSubAssignSubject}</Muted>
        </Card>
      ) : null}

      {canAssignClassTeacher && inSection("AdminClasses") ? (
        <Card onPress={() => navigation.navigate("AssignClassTeacher")}>
          <Body style={{ fontWeight: "700" }}>{STR.assignClassTeacher}</Body>
          <Muted>{STR.admSubAssignClass}</Muted>
        </Card>
      ) : null}

      {canRoutine && inSection("AdminClasses") ? (
        <Card onPress={() => navigation.navigate("GroupMembers")}>
          <Body style={{ fontWeight: "700" }}>{STR.gmTitle}</Body>
          <Muted>{STR.admSubGroupMembers}</Muted>
        </Card>
      ) : null}

      {canSections && inSection("AdminClasses") ? (
        <Card onPress={() => navigation.navigate("SectionConfig")}>
          <Body style={{ fontWeight: "700" }}>{STR.sectionConfig}</Body>
          <Muted>{STR.admSubSection}</Muted>
        </Card>
      ) : null}

      {showYear && heading ? <Muted style={{ marginTop: space(4), marginBottom: space(2) }}>{STR.admGYear}</Muted> : null}
      {canYears && inSection("AdminYear") ? (
        <Card onPress={() => navigation.navigate("AcademicYear")}>
          <Body style={{ fontWeight: "700" }}>{STR.ayManage}</Body>
          <Muted>{STR.ayHint}</Muted>
        </Card>
      ) : null}

      {canYearChange && inSection("AdminYear") ? (
        <Card onPress={() => navigation.navigate("YearChange")}>
          <Body style={{ fontWeight: "700" }}>{STR.ycTitle}</Body>
          <Muted>{STR.admSubYearChange}</Muted>
        </Card>
      ) : null}

      {canPauses && inSection("AdminYear") ? (
        <Card onPress={() => rootNav.navigate("RoutineTab", { screen: "AcademicPauses", initial: false })}>
          <Body style={{ fontWeight: "700" }}>{STR.apTitle}</Body>
          <Muted>{STR.admSubPause}</Muted>
        </Card>
      ) : null}

      {showWatch && heading ? <Muted style={{ marginTop: space(4), marginBottom: space(2) }}>{STR.admGWatch}</Muted> : null}
      {canAuditLog && inSection("AdminWatch") ? (
        <Card onPress={() => navigation.navigate("AuditLog")}>
          <Body style={{ fontWeight: "700" }}>{STR.audTitle}</Body>
          <Muted>{STR.audSubtitle}</Muted>
        </Card>
      ) : null}

      {canActivity && inSection("AdminWatch") ? (
        <Card onPress={() => navigation.navigate("PersonActivity")}>
          <Body style={{ fontWeight: "700" }}>{STR.actTitle}</Body>
          <Muted>{STR.actSubtitle}</Muted>
        </Card>
      ) : null}

      {canHealth && inSection("AdminWatch") ? (
        <Card onPress={() => navigation.navigate("SystemHealth")}>
          <Body style={{ fontWeight: "700" }}>{STR.shTitle}</Body>
          <Muted>{STR.shSubtitle}</Muted>
        </Card>
      ) : null}

      {![
        canStaffList, canStaffLogins, canProxy, canAssignSubject, canAssignSupervisor, canStudents,
        canAuditLog, canActivity, canHealth, canBanglaNames,
        canAssignClassTeacher, canRoutine, canSections, canYears, canYearChange, canGuardianCreds, canAccess, canPauses,
      ].some(Boolean) ? (
        <Notice message={STR.noPermission} tone="warn" />
      ) : null}
    </Screen>
  );
}
