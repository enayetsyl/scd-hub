/**
 * AccessControlEditScreen (AC-2, prd-access-control §6 + J-AC1..J-AC3) — the
 * Principal's per-user permission editor. For one staff member:
 *   • Additional-template chips (Teacher/Office) on top of the primary role.
 *   • Every live PERMISSIONS entry, grouped by module, each row showing a
 *     provenance state — from template / added / removed / locked — and an
 *     on/off toggle that adds/removes relative to the template baseline.
 *
 * The server is the gate: every tap fires one `access:manage` mutation and the
 * screen re-seeds from the returned (server-derived) effective set, so "a revoke
 * always wins" and the reserved backstop are reflected without client guessing.
 * Reserved-locked rows (non-Principal) are non-toggleable. Bangla 422s surface
 * inline. Gated `access:manage` (the AdminHome entry + the server re-check).
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  PERMISSIONS,
  RESERVED_PERMISSIONS,
  ASSIGNABLE_TEMPLATES,
  permissionsForRole,
  type Role,
} from "@scd/shared";
import {
  USER_EFFECTIVE_ACCESS_QUERY,
  SET_USER_ADDITIONAL_TEMPLATES,
  ADD_USER_GRANTED_PERMISSION,
  REMOVE_USER_GRANTED_PERMISSION,
  ADD_USER_REVOKED_PERMISSION,
  REMOVE_USER_REVOKED_PERMISSION,
  type UserAccessT,
} from "../../graphql/accessControl";
import DelegatedDutiesBlock from "./DelegatedDutiesBlock";
import type { AdminStackParamList } from "../../navigation/types";
import {
  Screen, Body, Muted, Card, Chip, ChipRow, Badge, Notice, Divider, Loader, ErrorBanner,
} from "../../components/ui";
import { STR, permissionName, permissionDesc, permissionModuleLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "AccessControlEdit">;

const RESERVED_SET = new Set<string>(RESERVED_PERMISSIONS);

type Prov = "fromTemplate" | "added" | "removed" | "locked" | "none";

/** Ordered modules (by `resource:action` prefix, first-seen order of PERMISSIONS). */
function groupPermissions(): { resource: string; perms: string[] }[] {
  const groups: { resource: string; perms: string[] }[] = [];
  for (const p of PERMISSIONS) {
    const resource = p.split(":")[0];
    let g = groups.find((x) => x.resource === resource);
    if (!g) {
      g = { resource, perms: [] };
      groups.push(g);
    }
    g.perms.push(p);
  }
  return groups;
}

const MODULE_GROUPS = groupPermissions();

export default function AccessControlEditScreen({ route }: Props): React.ReactElement {
  const { userId, name } = route.params;
  const [{ data, fetching, error }, refetch] = useQuery({
    query: USER_EFFECTIVE_ACCESS_QUERY,
    variables: { userId },
  });

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

  // The template baseline = union of permissionsForRole over [role, ...additional].
  const baseline = new Set<string>();
  for (const t of [role, ...access.additionalTemplates] as Role[]) {
    for (const p of permissionsForRole(t)) baseline.add(p);
  }

  function provenanceOf(perm: string): Prov {
    if (RESERVED_SET.has(perm) && !isPrincipal) return "locked";
    if (revoked.has(perm)) return "removed";
    if (effective.has(perm) && !baseline.has(perm)) return "added";
    if (effective.has(perm)) return "fromTemplate";
    return "none";
  }

  /** Apply one mutation, then re-seed from the server-derived result. */
  async function run(
    key: string,
    op: () => Promise<{ data?: Record<string, UserAccessT | undefined>; error?: unknown }>,
  ): Promise<void> {
    if (busy) return;
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
    if (!access) return;
    const nextList = additional.has(t)
      ? access.additionalTemplates.filter((x) => x !== t)
      : [...access.additionalTemplates, t];
    void run(`tpl:${t}`, () => setTemplates({ userId, templates: nextList }));
  }

  function togglePermission(perm: string): void {
    const isOn = effective.has(perm);
    if (isOn) {
      // Turn OFF: revoke a template perm, or remove the per-user grant.
      if (baseline.has(perm)) void run(perm, () => addRevoke({ userId, permission: perm }));
      else void run(perm, () => removeGrant({ userId, permission: perm }));
    } else {
      // Turn ON: un-revoke if it's off due to a revoke, else add a fresh grant.
      if (revoked.has(perm)) void run(perm, () => removeRevoke({ userId, permission: perm }));
      else void run(perm, () => addGrant({ userId, permission: perm }));
    }
  }

  // Assignable additional templates, minus the primary role (can't be "additional" to itself).
  const templateChoices = (ASSIGNABLE_TEMPLATES as readonly Role[]).filter((t) => t !== role);

  const provBadge: Record<Exclude<Prov, "none">, { text: string; tone: "muted" | "ok" | "warn" | "info" }> = {
    fromTemplate: { text: STR.acProvFromTemplate, tone: "info" },
    added: { text: STR.acProvAdded, tone: "ok" },
    removed: { text: STR.acProvRemoved, tone: "warn" },
    locked: { text: STR.acProvLocked, tone: "muted" },
  };

  return (
    <Screen scroll>
      <Body style={{ fontWeight: "700", fontSize: 18 }}>{name}</Body>
      <Muted style={{ marginBottom: space(2) }}>{STR.acSubtitle}</Muted>

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

      {/* Permissions grouped by module */}
      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.acPermissions}</Body>
      <Muted style={{ marginBottom: space(2) }}>{STR.acReservedNote}</Muted>

      {MODULE_GROUPS.map((g) => (
        <View key={g.resource} style={{ marginBottom: space(3) }}>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{permissionModuleLabel(g.resource)}</Body>
          {g.perms.map((perm) => {
            const prov = provenanceOf(perm);
            const isOn = effective.has(perm);
            const locked = prov === "locked";
            return (
              <Card key={perm}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{permissionName(perm)}</Body>
                    <Muted style={{ marginTop: 2 }}>{permissionDesc(perm)}</Muted>
                  </View>
                  {prov !== "none" ? (
                    <Badge text={provBadge[prov].text} tone={provBadge[prov].tone} />
                  ) : null}
                  {locked ? null : (
                    <Chip
                      label={isOn ? STR.acOn : STR.acOff}
                      selected={isOn}
                      onPress={() => togglePermission(perm)}
                    />
                  )}
                </View>
              </Card>
            );
          })}
        </View>
      ))}

      {/* The EXTENT axis (ACS-2): what this person may do BEYOND what they teach. */}
      <DelegatedDutiesBlock userId={userId} />
    </Screen>
  );
}
