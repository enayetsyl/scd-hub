/**
 * AccessControlEditScreen (AC-2, prd-access-control §6 + J-AC1..J-AC3; PM grid, D-#800) —
 * the Principal's per-person editor. For one staff member:
 *   • Additional-template chips (Teacher/Office) on top of the primary role.
 *   • The feature × action grid (PermissionMatrix, the same one the Roles view uses), each
 *     row showing where it comes from — from role / added / removed / locked — and a
 *     switch that adds or removes relative to the role baseline.
 *   • The delegated duties block (the EXTENT axis, ACS-2).
 *
 * The role baseline is the CURRENT role template (the Principal's role edits applied),
 * read from `roleTemplates`; the Principal template holds every action. The server is
 * the gate: every tap fires one `access:manage` mutation and the screen re-seeds from
 * the returned (server-derived) effective set, so "a revoke always wins" and the
 * reserved backstop are reflected without client guessing.
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  ASSIGNABLE_TEMPLATES,
  CATALOGUE_ROLE_DEFAULTS,
  RESERVED_PERMISSIONS,
  type CataloguePermission,
  type Role,
} from "@scd/shared";
import {
  USER_EFFECTIVE_ACCESS_QUERY,
  ROLE_TEMPLATES_QUERY,
  SET_USER_ADDITIONAL_TEMPLATES,
  ADD_USER_GRANTED_PERMISSION,
  REMOVE_USER_GRANTED_PERMISSION,
  ADD_USER_REVOKED_PERMISSION,
  REMOVE_USER_REVOKED_PERMISSION,
  type UserAccessT,
} from "../../graphql/accessControl";
import PermissionMatrix, { type MatrixBadge } from "../../components/PermissionMatrix";
import DelegatedDutiesBlock from "./DelegatedDutiesBlock";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Chip, ChipRow, Notice, Divider, Loader, ErrorBanner } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "AccessControlEdit">;

const RESERVED_SET = new Set<string>(RESERVED_PERMISSIONS);

export default function AccessControlEditScreen({ route }: Props): React.ReactElement {
  const { userId, name } = route.params;
  const [{ data, fetching, error }, refetch] = useQuery({
    query: USER_EFFECTIVE_ACCESS_QUERY,
    variables: { userId },
  });
  const [{ data: tplData }] = useQuery({ query: ROLE_TEMPLATES_QUERY, requestPolicy: "cache-and-network" });

  const [, setTemplates] = useMutation(SET_USER_ADDITIONAL_TEMPLATES);
  const [, addGrant] = useMutation(ADD_USER_GRANTED_PERMISSION);
  const [, removeGrant] = useMutation(REMOVE_USER_GRANTED_PERMISSION);
  const [, addRevoke] = useMutation(ADD_USER_REVOKED_PERMISSION);
  const [, removeRevoke] = useMutation(REMOVE_USER_REVOKED_PERMISSION);

  // The latest server-derived access (seeded from the query, re-seeded per mutation).
  const [access, setAccess] = React.useState<UserAccessT | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null); // the in-flight perm/template key
  const [ok, setOk] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (data?.userEffectiveAccess) setAccess(data.userEffectiveAccess);
  }, [data]);

  if (fetching && !access) return <Loader label={STR.acTitle} />;
  if (error && !access)
    return (
      <Screen padded>
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      </Screen>
    );
  if (!access) return <Screen padded><Notice message={STR.acNoStaff} tone="warn" /></Screen>;

  const role = access.role as Role;
  const isPrincipal = role === "PRINCIPAL";
  const additional = new Set(access.additionalTemplates);
  const effective = new Set(access.effectivePermissions);
  const granted = new Set(access.grantedPermissions);
  const revoked = new Set(access.revokedPermissions);

  // The role baseline: each template's CURRENT catalogue set (role edits applied).
  const roleSets = new Map<string, string[]>((tplData?.roleTemplates ?? []).map((t) => [t.role, t.permissions]));
  const baseline = new Set<string>();
  for (const t of [role, ...access.additionalTemplates] as Role[]) {
    const list = t === "PRINCIPAL" ? CATALOGUE_ROLE_DEFAULTS.PRINCIPAL : roleSets.get(t) ?? CATALOGUE_ROLE_DEFAULTS[t];
    for (const p of list) baseline.add(p);
  }

  function badgeOf(perm: CataloguePermission): MatrixBadge | null {
    if (RESERVED_SET.has(perm) && !isPrincipal) return { text: STR.acProvLocked, tone: "muted" };
    if (revoked.has(perm) && baseline.has(perm)) return { text: STR.acProvRemoved, tone: "warn" };
    if (effective.has(perm) && !baseline.has(perm)) return { text: STR.acProvAdded, tone: "ok" };
    if (!effective.has(perm) && baseline.has(perm)) return { text: STR.acProvRemoved, tone: "warn" };
    if (effective.has(perm)) return { text: STR.acFromRole, tone: "info" };
    return null;
  }

  /** Apply one mutation, then re-seed from the server-derived result. */
  async function run(
    key: string,
    op: () => Promise<{ data?: Record<string, UserAccessT | undefined>; error?: unknown }>,
  ): Promise<void> {
    setBusy(key);
    setOk(null);
    setErr(null);
    const res = await op();
    setBusy(null);
    const next = res.data ? Object.values(res.data)[0] : undefined;
    if (res.error || !next) {
      setErr(friendlyError(res.error as Parameters<typeof friendlyError>[0]));
      return;
    }
    setAccess(next);
    setOk(STR.acSaved);
  }

  function toggleTemplate(t: Role): void {
    if (!access || busy) return;
    const nextList = additional.has(t)
      ? access.additionalTemplates.filter((x) => x !== t)
      : [...access.additionalTemplates, t];
    void run(`tpl:${t}`, () => setTemplates({ userId, templates: nextList }));
  }

  async function togglePermission(perm: CataloguePermission, next: boolean): Promise<void> {
    if (next) {
      // Turn ON: lift this person's revoke if there is one, else add a personal grant.
      if (revoked.has(perm)) await run(perm, () => removeRevoke({ userId, permission: perm }));
      else await run(perm, () => addGrant({ userId, permission: perm }));
    } else {
      // Turn OFF: drop a personal grant if that is where it comes from, else revoke it
      // (it comes from the role, or from an older broad grant that expands to it).
      if (granted.has(perm)) await run(perm, () => removeGrant({ userId, permission: perm }));
      else await run(perm, () => addRevoke({ userId, permission: perm }));
    }
  }

  // Assignable additional templates, minus the primary role (can't be "additional" to itself).
  const templateChoices = (ASSIGNABLE_TEMPLATES as readonly Role[]).filter((t) => t !== role);

  return (
    <Screen scroll>
      <Body style={{ fontWeight: "700", fontSize: 18 }}>{name}</Body>
      <Muted style={{ marginBottom: space(2) }}>{STR.acPeopleIntro}</Muted>

      {ok ? <Notice message={ok} tone="ok" /> : null}
      {err ? <Notice message={err} tone="danger" /> : null}

      {/* Templates */}
      <Body style={{ fontWeight: "700", marginTop: space(2) }}>{STR.acPrimaryRole}</Body>
      <ChipRow>
        <Chip label={role} selected onPress={() => undefined} />
      </ChipRow>

      <Body style={{ fontWeight: "700", marginTop: space(2) }}>{STR.acAdditionalTemplates}</Body>
      <Muted style={{ marginBottom: space(1) }}>{STR.acAdditionalHint}</Muted>
      <ChipRow>
        {templateChoices.map((t) => (
          <Chip key={t} label={t} selected={additional.has(t)} onPress={() => toggleTemplate(t)} />
        ))}
      </ChipRow>

      <Divider />

      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.acPermissions}</Body>
      <Muted style={{ marginBottom: space(1) }}>{STR.acReservedNote}</Muted>
      <PermissionMatrix
        isOn={(p) => effective.has(p)}
        badge={badgeOf}
        busy={busy}
        onToggle={togglePermission}
      />

      {/* The EXTENT axis (ACS-2): what this person may do BEYOND what they teach. */}
      <DelegatedDutiesBlock userId={userId} />
    </Screen>
  );
}
