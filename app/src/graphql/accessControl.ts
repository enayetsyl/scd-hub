/**
 * Typed GraphQL operations for the per-user Access Control editor (AC-2 app
 * surfaces over the merged AC-1 resolvers). Hand-authored to mirror the server
 * resolvers (server/src/modules/access-control/resolvers/accessControl.ts)
 * exactly — no server change. Kept in its own module to avoid bloating the
 * 4.7k-line operations.ts (the classTest.ts precedent).
 *
 * Every op is `access:manage`-gated server-side (RESERVED-locked, Principal-only);
 * the screen presents what the server re-enforces.
 */
import { gql } from "urql";

/** The DERIVED per-user access shape the seam resolves (server `UserAccess`). */
export interface UserAccessT {
  userId: string;
  role: string;
  additionalTemplates: string[];
  grantedPermissions: string[];
  revokedPermissions: string[];
  effectivePermissions: string[];
}

const USER_ACCESS_FIELDS = `userId role additionalTemplates grantedPermissions revokedPermissions effectivePermissions`;

// ---------------------------------------------------------------------------
// Read — for the AC-2 editor screen
// ---------------------------------------------------------------------------

export const USER_EFFECTIVE_ACCESS_QUERY = gql<
  { userEffectiveAccess: UserAccessT },
  { userId: string }
>`
  query UserEffectiveAccess($userId: String!) {
    userEffectiveAccess(userId: $userId) { ${USER_ACCESS_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// Mutations (access:manage — Principal only; each returns the fresh access)
// ---------------------------------------------------------------------------

export const SET_USER_ADDITIONAL_TEMPLATES = gql<
  { setUserAdditionalTemplates: UserAccessT },
  { userId: string; templates: string[] }
>`
  mutation SetUserAdditionalTemplates($userId: String!, $templates: [String!]!) {
    setUserAdditionalTemplates(userId: $userId, templates: $templates) { ${USER_ACCESS_FIELDS} }
  }
`;

export const ADD_USER_GRANTED_PERMISSION = gql<
  { addUserGrantedPermission: UserAccessT },
  { userId: string; permission: string }
>`
  mutation AddUserGrantedPermission($userId: String!, $permission: String!) {
    addUserGrantedPermission(userId: $userId, permission: $permission) { ${USER_ACCESS_FIELDS} }
  }
`;

export const REMOVE_USER_GRANTED_PERMISSION = gql<
  { removeUserGrantedPermission: UserAccessT },
  { userId: string; permission: string }
>`
  mutation RemoveUserGrantedPermission($userId: String!, $permission: String!) {
    removeUserGrantedPermission(userId: $userId, permission: $permission) { ${USER_ACCESS_FIELDS} }
  }
`;

export const ADD_USER_REVOKED_PERMISSION = gql<
  { addUserRevokedPermission: UserAccessT },
  { userId: string; permission: string }
>`
  mutation AddUserRevokedPermission($userId: String!, $permission: String!) {
    addUserRevokedPermission(userId: $userId, permission: $permission) { ${USER_ACCESS_FIELDS} }
  }
`;

export const REMOVE_USER_REVOKED_PERMISSION = gql<
  { removeUserRevokedPermission: UserAccessT },
  { userId: string; permission: string }
>`
  mutation RemoveUserRevokedPermission($userId: String!, $permission: String!) {
    removeUserRevokedPermission(userId: $userId, permission: $permission) { ${USER_ACCESS_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// Delegated duties (ACS-2) — the EXTENT axis. Same `access:manage` gate as the
// permission ops above; these mint/revoke `delegation` ScopeGrants (D-#484/#487).
// ---------------------------------------------------------------------------

/** One delegation grant as the editor renders it (a subset of server `ScopeGrant`). */
export interface DelegationGrantT {
  id: string;
  teacherId: string | null;
  extent: string | null;
  classId: string | null;
  subjectId: string | null;
  explicitSet: { classId: string; subjectId: string }[] | null;
  actions: string[] | null;
  expiresAt: string | null;
}

const DELEGATION_FIELDS = `id teacherId extent classId subjectId explicitSet { classId subjectId } actions expiresAt`;

export const DELEGATION_GRANTS_QUERY = gql<
  { delegationGrants: DelegationGrantT[] },
  { teacherId?: string | null }
>`
  query DelegationGrants($teacherId: String) {
    delegationGrants(teacherId: $teacherId) { ${DELEGATION_FIELDS} }
  }
`;

export const GRANT_DELEGATION = gql<
  { grantDelegation: { grantId: string } },
  {
    teacherId: string;
    extent: string;
    actions: string[];
    subjectId?: string | null;
    classId?: string | null;
    explicitSet?: { classId: string; subjectId: string }[] | null;
    expiresAt?: string | null;
  }
>`
  mutation GrantDelegation(
    $teacherId: String!
    $extent: String!
    $actions: [String!]!
    $subjectId: String
    $classId: String
    $explicitSet: [SupervisoryPairInput!]
    $expiresAt: String
  ) {
    grantDelegation(
      teacherId: $teacherId
      extent: $extent
      actions: $actions
      subjectId: $subjectId
      classId: $classId
      explicitSet: $explicitSet
      expiresAt: $expiresAt
    ) { grantId }
  }
`;

export const REVOKE_DELEGATION = gql<{ revokeDelegation: boolean }, { grantId: string }>`
  mutation RevokeDelegation($grantId: String!) {
    revokeDelegation(grantId: $grantId)
  }
`;
