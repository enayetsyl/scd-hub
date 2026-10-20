/**
 * AccessControlRolesPanel (PM, docs/prd-permission-matrix.md §7, J-PM1/J-PM4/J-PM8) — the
 * Roles view of Access control: pick Teacher or Office, then switch each catalogue action
 * on or off for everyone in that role. The Principal always holds everything and is not
 * listed; Guardian is a separate plane and is not listed.
 *
 * Each tap fires one `setRoleTemplatePermission` (server gate: access_control:edit,
 * LOCKED/SELF refused in Bangla) and re-seeds from the returned role. "Changed" marks an
 * action that differs from the code default; "Reset to default" clears every edit.
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import { CATALOGUE_ROLE_DEFAULTS, type CataloguePermission, type EditableRole } from "@scd/shared";
import {
  ROLE_TEMPLATES_QUERY,
  SET_ROLE_TEMPLATE_PERMISSION,
  RESET_ROLE_TEMPLATE,
  type RoleTemplateT,
} from "../../graphql/accessControl";
import PermissionMatrix from "../../components/PermissionMatrix";
import { Body, Muted, Chip, ChipRow, Notice, Button, Loader, ErrorBanner } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function AccessControlRolesPanel(): React.ReactElement {
  const [{ data, fetching, error }, refetch] = useQuery({ query: ROLE_TEMPLATES_QUERY, requestPolicy: "cache-and-network" });
  const [, setPerm] = useMutation(SET_ROLE_TEMPLATE_PERMISSION);
  const [, reset] = useMutation(RESET_ROLE_TEMPLATE);

  const [role, setRole] = React.useState<EditableRole>("TEACHER");
  const [templates, setTemplates] = React.useState<Record<string, RoleTemplateT>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (data?.roleTemplates) setTemplates(Object.fromEntries(data.roleTemplates.map((t) => [t.role, t])));
  }, [data]);

  if (fetching && !templates[role]) return <Loader label={STR.acTitle} />;
  if (error && !templates[role])
    return <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />;
  const tpl = templates[role];
  if (!tpl) return <Notice message={STR.acNoStaff} tone="warn" />;

  const on = new Set(tpl.permissions);
  const changed = new Set([...tpl.granted, ...tpl.revoked]);
  const defaults = new Set<string>(CATALOGUE_ROLE_DEFAULTS[role]);

  async function toggle(perm: CataloguePermission, enabled: boolean): Promise<void> {
    setBusy(perm);
    setOk(null);
    setErr(null);
    const res = await setPerm({ role, permission: perm, enabled });
    setBusy(null);
    const next = res.data?.setRoleTemplatePermission;
    if (res.error || !next) {
      setErr(friendlyError(res.error));
      return;
    }
    setTemplates((t) => ({ ...t, [next.role]: next }));
    setOk(STR.acSaved);
  }

  async function doReset(): Promise<void> {
    setBusy("reset");
    setOk(null);
    setErr(null);
    const res = await reset({ role });
    setBusy(null);
    const next = res.data?.resetRoleTemplate;
    if (res.error || !next) {
      setErr(friendlyError(res.error));
      return;
    }
    setTemplates((t) => ({ ...t, [next.role]: next }));
    setOk(STR.acRoleResetDone);
  }

  return (
    <View>
      <Muted style={{ marginBottom: space(2) }}>{STR.acRolesIntro}</Muted>
      <ChipRow>
        <Chip label={STR.acRoleTeacher} selected={role === "TEACHER"} onPress={() => setRole("TEACHER")} />
        <Chip label={STR.acRoleOffice} selected={role === "OFFICE"} onPress={() => setRole("OFFICE")} />
      </ChipRow>
      <Body style={{ marginTop: space(2) }}>{STR.acRoleAffects.replace("{n}", String(tpl.userCount))}</Body>
      {changed.size > 0 ? (
        <Button
          title={`${STR.acRoleReset} (${changed.size})`}
          variant="secondary"
          loading={busy === "reset"}
          onPress={() => void doReset()}
          style={{ marginTop: space(2), alignSelf: "flex-start" }}
        />
      ) : null}
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {err ? <Notice message={err} tone="danger" /> : null}

      <PermissionMatrix
        isOn={(p) => on.has(p)}
        busy={busy}
        badge={(p) =>
          changed.has(p)
            ? { text: `${STR.acBadgeChanged} (${defaults.has(p) ? STR.acOn : STR.acOff} →)`, tone: "warn" }
            : null
        }
        onToggle={toggle}
      />
    </View>
  );
}
