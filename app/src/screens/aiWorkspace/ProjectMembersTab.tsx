/**
 * The Members tab (AI Workspace W-1, D-#1208): owner / editor / viewer. Only an owner changes
 * the list; members are chosen from the staff who hold `ai_workspace:use` (granted from the
 * permission matrix — the Principal only at launch).
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { AI_WORKSPACE_MEMBER_CANDIDATES, SET_AI_PROJECT_MEMBERS, type AiProjectMemberT, type AiProjectRoleT, type AiProjectT } from "../../graphql/aiWorkspace";
import { Card, Body, Muted, Button, Notice, Select, Chip, ChipRow } from "../../components/ui";
import { useToast } from "../../state/ToastContext";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { roleLabel } from "./aiWorkspaceUi";

const ROLES: AiProjectRoleT[] = ["owner", "editor", "viewer"];

export function ProjectMembersTab({ project, onChanged }: { project: AiProjectT; onChanged: () => void }): React.ReactElement {
  const toast = useToast();
  const isOwner = project.myRole === "owner";
  const [cq] = useQuery({ query: AI_WORKSPACE_MEMBER_CANDIDATES, pause: !isOwner });
  const [, save] = useMutation(SET_AI_PROJECT_MEMBERS);
  const [members, setMembers] = React.useState<AiProjectMemberT[]>(project.members);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setMembers(project.members), [project.members]);

  const candidates = (cq.data?.aiWorkspaceMemberCandidates ?? []).filter((c) => !members.some((m) => m.userId === c.userId));
  const dirty = JSON.stringify(members) !== JSON.stringify(project.members);

  async function onSave(): Promise<void> {
    setBusy(true);
    setError(null);
    const res = await save({ id: project.id, members: members.map((m) => ({ userId: m.userId, role: m.role })) });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error as never));
    toast.show(STR.awSaved, "ok");
    onChanged();
  }

  return (
    <Card>
      <Muted>{STR.awMembersHelp}</Muted>
      {members.map((m) => (
        <View key={m.userId} style={{ marginTop: space(1) }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(1), flexWrap: "wrap" }}>
            <Body style={{ fontWeight: "700", flexShrink: 1 }}>{m.name}</Body>
            {!isOwner ? <Muted>{roleLabel(m.role)}</Muted> : null}
          </View>
          {isOwner ? (
            <ChipRow>
              {ROLES.map((r) => (
                <Chip key={r} label={roleLabel(r)} selected={m.role === r} onPress={() => setMembers(members.map((x) => (x.userId === m.userId ? { ...x, role: r } : x)))} />
              ))}
              <Chip label={STR.awRemove} selected={false} onPress={() => setMembers(members.filter((x) => x.userId !== m.userId))} />
            </ChipRow>
          ) : null}
        </View>
      ))}
      {isOwner && candidates.length > 0 ? (
        <Select
          label={STR.awAddMember}
          value={null}
          searchable
          options={candidates.map((c) => ({ label: c.name, value: c.userId }))}
          onChange={(userId) => {
            const c = candidates.find((x) => x.userId === userId);
            if (c) setMembers([...members, { userId: c.userId, name: c.name, role: "viewer" }]);
          }}
        />
      ) : null}
      {error ? <Notice tone="danger" message={error} /> : null}
      {isOwner ? (
        <View style={{ marginTop: space(2) }}>
          <Button title={STR.awMembersSave} onPress={() => void onSave()} loading={busy} disabled={!dirty} />
        </View>
      ) : null}
    </Card>
  );
}
