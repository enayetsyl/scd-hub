/**
 * AcademicYearScreen (design-A) — Principal/Office set the school's ACTIVE academic
 * year once a year; every operational screen then defaults to it (no per-screen year
 * picker). Add a new year and switch the current one. Gated roster:manage.
 */
import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  ACADEMIC_YEARS_QUERY,
  CREATE_ACADEMIC_YEAR,
  SET_CURRENT_ACADEMIC_YEAR,
} from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Card,
  Badge,
  Button,
  Field,
  Chip,
  ChipRow,
  Notice,
  Divider,
  Loader,
  EmptyState,
  ErrorBanner,
} from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "AcademicYear">;

export default function AcademicYearScreen(_props: Props): React.ReactElement {
  const [{ data, fetching, error }, refetch] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const [, create] = useMutation(CREATE_ACADEMIC_YEAR);
  const [, setCurrent] = useMutation(SET_CURRENT_ACADEMIC_YEAR);

  const [label, setLabel] = useState("");
  const [makeCurrent, setMakeCurrent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

  const years = data?.academicYears ?? [];

  async function onAdd(): Promise<void> {
    if (!label.trim() || busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await create({ label: label.trim(), makeCurrent });
    setBusy(false);
    if (res.error || !res.data?.createAcademicYear) {
      setErr(friendlyError(res.error));
      return;
    }
    setMsg(STR.ayCreated);
    setLabel("");
    setMakeCurrent(false);
    refetch({ requestPolicy: "network-only" });
  }

  async function onSetCurrent(id: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await setCurrent({ academicYearId: id });
    setBusy(false);
    if (res.error || !res.data?.setCurrentAcademicYear) {
      setErr(friendlyError(res.error));
      return;
    }
    setMsg(STR.aySetDone);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <H2>{STR.ayManage}</H2>
      <Notice message={STR.ayHint} tone="info" />

      {err ? <Notice message={err} tone="danger" /> : null}
      {msg ? <Notice message={msg} tone="ok" /> : null}

      {error ? (
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : null}
      {fetching ? (
        <Loader label={STR.loading} />
      ) : years.length === 0 ? (
        <EmptyState message={STR.ayNone} />
      ) : (
        years.map((y) => (
          <Card key={y.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
              <Body style={{ fontWeight: "700", flex: 1 }}>{y.label}</Body>
              {y.current ? (
                <Badge text={STR.ayCurrentBadge} tone="ok" />
              ) : (
                <Button title={STR.aySetCurrent} variant="secondary" onPress={() => onSetCurrent(y.id)} disabled={busy} />
              )}
            </View>
          </Card>
        ))
      )}

      <Divider />
      <H2>{STR.ayAdd}</H2>
      <Field label={STR.ayLabelField} value={label} onChangeText={setLabel} />
      <ChipRow>
        <Chip label={STR.ayMakeCurrent} selected={makeCurrent} onPress={() => setMakeCurrent((v) => !v)} />
      </ChipRow>
      <Button title={STR.ayAdd} onPress={onAdd} loading={busy} disabled={!label.trim() || busy} style={{ marginTop: space(2) }} />
    </Screen>
  );
}
