/**
 * AssembleSetScreen (S6 tail / J3.2–J3.3) — per-type metadata then finalise.
 * CT → durationMinutes (+ derived totalMarks); HW/AS → due date. assembleSet
 * enforces write-scope server-side; on success we replace into SetDetail.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { ASSESSMENT_SET_QUERY, ASSEMBLE_SET } from "../../graphql/operations";
import type { SetsStackParamList } from "../../navigation/types";
import {
  Screen,
  H1,
  Body,
  Muted,
  Card,
  Row,
  Button,
  Field,
  Loader,
  ErrorBanner,
  Notice,
  Divider,
} from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, setTypeLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<SetsStackParamList, "AssembleSet">;

export default function AssembleSetScreen({ route, navigation }: Props): React.ReactElement {
  const { setId, setType } = route.params;
  const isCt = setType === "CT";
  const [{ data, fetching, error }, refetchSet] = useQuery({ query: ASSESSMENT_SET_QUERY, variables: { id: setId } });
  const [duration, setDuration] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [, assembleSet] = useMutation(ASSEMBLE_SET);

  const s = data?.assessmentSet;

  async function onAssemble(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFormError(null);

    let vars: { setId: string; durationMinutes?: number | null; dueDate?: string | null };
    if (isCt) {
      vars = { setId, durationMinutes: duration.trim() ? Number(duration) : null };
    } else {
      let dueIso: string | null = null;
      if (dueDate.trim()) {
        const d = new Date(dueDate.trim());
        if (Number.isNaN(d.getTime())) {
          setFormError(STR.invalidDate);
          setBusy(false);
          return;
        }
        dueIso = d.toISOString();
      }
      vars = { setId, dueDate: dueIso };
    }

    const res = await assembleSet(vars);
    if (res.error || !res.data?.assembleSet) {
      setFormError(friendlyError(res.error));
      setBusy(false);
      return;
    }
    setBusy(false);
    navigation.replace("SetDetail", { setId });
  }

  if (fetching) return <Loader label={STR.loading} />;
  if (error) {
    return (
      <Screen>
        <ErrorBanner
          message={friendlyError(error)}
          onRetry={() => refetchSet({ requestPolicy: "network-only" })}
        />
      </Screen>
    );
  }
  if (!s) {
    return (
      <Screen>
        <Notice message={STR.empty} tone="warn" />
      </Screen>
    );
  }

  const total = s.totalMarks ?? s.basketItems.reduce((a, b) => a + b.marks, 0);

  return (
    <Screen scroll>
      <H1>
        {STR.assemble}: {s.name || setTypeLabel(setType)}
      </H1>

      <Card>
        <Row label={STR.questionsWord} value={bnNum(s.basketItems.length)} />
        <Row label={STR.totalMarks} value={bnNum(total)} />
      </Card>

      {isCt ? (
        <Field label="DURATION_MINUTES" value={duration} onChangeText={setDuration} keyboardType="numeric" placeholder="60" />
      ) : (
        <DateField label="DUE_DATE" value={dueDate} onChange={setDueDate} />
      )}

      {formError ? <Notice message={formError} tone="danger" /> : null}

      <Button
        title={busy ? STR.assembling : STR.assemble}
        onPress={onAssemble}
        loading={busy}
        disabled={s.basketItems.length === 0}
      />
      {s.basketItems.length === 0 ? <Muted style={{ marginTop: space(2) }}>{STR.basketEmpty}</Muted> : null}

      <Divider />
      {s.basketItems.map((item, i) => (
        <View
          key={item.artifactId}
          style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: space(1) }}
        >
          <Body>
            {bnNum(i + 1)}. {item.qid}
          </Body>
          <Muted>
            {bnNum(item.marks)} {STR.marks}
          </Muted>
        </View>
      ))}
    </Screen>
  );
}
