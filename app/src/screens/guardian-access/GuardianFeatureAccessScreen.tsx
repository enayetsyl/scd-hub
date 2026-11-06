/**
 * GuardianFeatureAccessScreen (D-#1011) — who among the guardians sees the storybook shelf /
 * activity sheets. Off (no one) until switched: on for every guardian, or for chosen guardians
 * found by guardian name, phone, child's name or school ID. Principal by default
 * (`library:guardian_access` / `activity_sheets:guardian_access`).
 */
import React, { useState } from "react";
import { Switch, View } from "react-native";
import { useMutation, useQuery, type CombinedError } from "urql";
import {
  GUARDIAN_FEATURE_ACCESS,
  SEARCH_GUARDIANS_FOR_FEATURE,
  SET_GUARDIAN_FEATURE_FOR_ALL,
  SET_GUARDIAN_FEATURE_FOR_GUARDIAN,
  type GuardianFeaturePickT,
} from "../../graphql/guardianFeatures";
import { Body, Button, Card, Field, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum } from "../../lib/labels";
import type { GuardianFeatureKey } from "../../lib/guardianFeatures";
import { space } from "../../theme";

type Msg = { tone: "ok" | "danger"; text: string } | null;

function PickRow({ g, on, busy, onToggle }: { g: GuardianFeaturePickT; on: boolean; busy: boolean; onToggle: () => void }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(2) }}>
      <View style={{ flex: 1 }}>
        <Body style={{ fontWeight: "600" }}>{g.name}</Body>
        <Muted>{[g.phone, g.childrenText].filter(Boolean).join(" · ")}</Muted>
      </View>
      <Button title={on ? STR.gfaTurnOff : STR.gfaTurnOn} variant={on ? "secondary" : "primary"} disabled={busy} onPress={onToggle} />
    </View>
  );
}

export function GuardianFeatureAccess({ feature }: { feature: GuardianFeatureKey }): React.ReactElement {
  const [q, refetch] = useQuery({ query: GUARDIAN_FEATURE_ACCESS, variables: { feature }, requestPolicy: "cache-and-network" });
  const [text, setText] = useState("");
  const term = text.trim();
  const [sq] = useQuery({ query: SEARCH_GUARDIANS_FOR_FEATURE, variables: { feature, q: term }, pause: term.length < 2 });
  const [allM, setAll] = useMutation(SET_GUARDIAN_FEATURE_FOR_ALL);
  const [oneM, setOne] = useMutation(SET_GUARDIAN_FEATURE_FOR_GUARDIAN);
  const [msg, setMsg] = useState<Msg>(null);
  const busy = allM.fetching || oneM.fetching;
  const access = q.data?.guardianFeatureAccess;
  const chosen = new Set((access?.guardians ?? []).map((g) => g.guardianId));

  const done = (r: { error?: CombinedError }): void => {
    setMsg(r.error ? { tone: "danger", text: friendlyError(r.error) } : { tone: "ok", text: STR.gfaSaved });
    if (!r.error) refetch({ requestPolicy: "network-only" });
  };
  const toggleAll = async (on: boolean): Promise<void> => done(await setAll({ feature, on }));
  const toggleOne = async (guardianId: string, on: boolean): Promise<void> => done(await setOne({ feature, guardianId, on }));

  return (
    <Screen>
      {msg ? <Notice message={msg.text} tone={msg.tone} /> : null}
      <Muted style={{ marginBottom: space(3) }}>{STR.gfaIntro}</Muted>
      <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })}>
        {access ? (
          <>
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                <Body style={{ flex: 1, fontWeight: "700" }}>{STR.gfaAll}</Body>
                <Switch value={access.onForAll} disabled={busy} onValueChange={(v) => void toggleAll(v)} />
              </View>
              {access.onForAll ? <Muted style={{ marginTop: space(1) }}>{STR.gfaAllOnNote}</Muted> : null}
            </Card>

            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.gfaChosen.replace("{n}", bnNum(access.guardians.length))}</Body>
              {access.guardians.length === 0 && !access.onForAll ? <Muted style={{ marginTop: space(1) }}>{STR.gfaNone}</Muted> : null}
              {access.guardians.map((g) => (
                <PickRow key={g.guardianId} g={g} on busy={busy} onToggle={() => void toggleOne(g.guardianId, false)} />
              ))}
            </Card>

            <Card>
              <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.gfaSearch}</Body>
              <Field label="" value={text} onChangeText={setText} placeholder={STR.gfaSearchPh} />
              {term.length >= 2 && sq.data && sq.data.searchGuardiansForFeature.length === 0 ? <Muted>{STR.gfaNoMatch}</Muted> : null}
              {(term.length >= 2 ? sq.data?.searchGuardiansForFeature ?? [] : []).map((g) => (
                <PickRow
                  key={g.guardianId}
                  g={g}
                  on={chosen.has(g.guardianId)}
                  busy={busy}
                  onToggle={() => void toggleOne(g.guardianId, !chosen.has(g.guardianId))}
                />
              ))}
            </Card>
          </>
        ) : null}
      </QueryGate>
    </Screen>
  );
}

export function StoryGuardianAccessScreen(): React.ReactElement {
  return <GuardianFeatureAccess feature="STORYBOOKS" />;
}

export function ActivityGuardianAccessScreen(): React.ReactElement {
  return <GuardianFeatureAccess feature="ACTIVITY_SHEETS" />;
}
