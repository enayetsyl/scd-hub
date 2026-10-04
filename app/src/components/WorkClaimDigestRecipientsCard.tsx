/**
 * WorkClaimDigestRecipientsCard (D-#710) — who ELSE gets the 10:30 guardian-claim
 * digest. Principal only (the server refuses anyone else). Every Principal and Office
 * user always receives it; this card adds teachers on top — owner ruling 2026-10-04
 * named Akter Hossen and Tazkir — and those people may then open the claim queue the
 * digest links to.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { Card, Body, Muted, Button, Select, Notice, Divider } from "./ui";
import { space } from "../theme/tokens";
import { STR } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { useToast } from "../state/ToastContext";
import {
  TEACHERS_QUERY,
  WORK_CLAIM_DIGEST_RECIPIENTS_QUERY,
  SET_WORK_CLAIM_DIGEST_RECIPIENTS,
} from "../graphql/operations";

export default function WorkClaimDigestRecipientsCard(): React.ReactElement {
  const [q, refetch] = useQuery({ query: WORK_CLAIM_DIGEST_RECIPIENTS_QUERY, variables: {} });
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY, variables: {} });
  const [saveMut, save] = useMutation(SET_WORK_CLAIM_DIGEST_RECIPIENTS);
  const [pick, setPick] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const current = q.data?.workClaimDigestRecipients ?? [];
  const currentIds = new Set(current.map((r) => r.userId));
  const options = (teachersQ.data?.teachers ?? [])
    .filter((t) => !currentIds.has(t.id))
    .map((t) => ({ label: t.name, value: t.id }));

  async function commit(userIds: string[]): Promise<void> {
    setError(null);
    const res = await save({ userIds });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    setPick(null);
    toast.show(STR.wcDigestSaved, "ok");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.wcDigestTitle}</Body>
      <Muted style={{ marginTop: space(1) }}>{STR.wcDigestAlways}</Muted>
      {error ? (
        <View style={{ marginTop: space(2) }}>
          <Notice tone="danger" message={error} />
        </View>
      ) : null}

      {current.length === 0 ? (
        <Muted style={{ marginTop: space(2) }}>{STR.wcDigestNone}</Muted>
      ) : (
        current.map((r, i) => (
          <View key={r.userId}>
            {i > 0 ? <Divider /> : null}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: space(2),
                marginTop: space(2),
              }}
            >
              <Body style={{ flexShrink: 1 }}>{r.name}</Body>
              <Button
                title={STR.wcDigestRemove}
                variant="ghost"
                disabled={saveMut.fetching}
                onPress={() => void commit(current.filter((x) => x.userId !== r.userId).map((x) => x.userId))}
              />
            </View>
          </View>
        ))
      )}

      <View style={{ marginTop: space(3), gap: space(2) }}>
        <Select
          label={STR.wcDigestAdd}
          value={pick}
          options={options}
          onChange={setPick}
          placeholder={STR.wcDigestPick}
          searchable
        />
        <Button
          title={STR.wcDigestAdd}
          disabled={!pick || saveMut.fetching}
          loading={saveMut.fetching}
          onPress={() => pick && void commit([...current.map((x) => x.userId), pick])}
        />
      </View>
    </Card>
  );
}
