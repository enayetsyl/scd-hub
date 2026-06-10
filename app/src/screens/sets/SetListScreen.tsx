/**
 * SetListScreen (S7 / J3.2) — assessment sets for the selected section, filtered
 * by status (draft/assembled, server-side) and set type (client-side; the query
 * has no type arg). Tap a set → SetDetail. A writable section must be selected.
 */
import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { SET_TYPES } from "@scd/shared";
import { ASSESSMENT_SETS_QUERY } from "../../graphql/operations";
import type { SetsStackParamList } from "../../navigation/types";
import {
  Screen,
  Body,
  Muted,
  Card,
  Chip,
  ChipRow,
  Badge,
  Loader,
  EmptyState,
  ErrorBanner,
} from "../../components/ui";
import { SectionBar } from "../../components/SectionBar";
import { STR, setTypeLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<SetsStackParamList, "SetList">;

export default function SetListScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const [status, setStatus] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);

  const [{ data, fetching, error }, refetch] = useQuery({
    query: ASSESSMENT_SETS_QUERY,
    variables: { sectionId: selection.sectionId ?? "", classId: selection.classId ?? "", status },
    pause: !hasSection,
  });

  const sets = (data?.assessmentSets ?? []).filter((s) => !type || s.setType === type);

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <SectionBar onChange={() => navigation.navigate("SectionPicker")} />
        {hasSection ? (
          <>
            <Muted>{STR.status}</Muted>
            <ChipRow>
              <Chip label={STR.all} selected={status === null} onPress={() => setStatus(null)} />
              <Chip label={STR.statusDraft} selected={status === "draft"} onPress={() => setStatus(status === "draft" ? null : "draft")} />
              <Chip label={STR.statusAssembled} selected={status === "assembled"} onPress={() => setStatus(status === "assembled" ? null : "assembled")} />
            </ChipRow>
            <Muted>{STR.setType}</Muted>
            <ChipRow>
              <Chip label={STR.all} selected={type === null} onPress={() => setType(null)} />
              {SET_TYPES.map((t) => (
                <Chip key={t} label={setTypeLabel(t)} selected={type === t} onPress={() => setType(type === t ? null : t)} />
              ))}
            </ChipRow>
          </>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : error ? (
          <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
        ) : fetching ? (
          <Loader label={STR.loading} />
        ) : sets.length === 0 ? (
          <EmptyState message={STR.empty} />
        ) : (
          sets.map((s) => (
            <Card key={s.id} onPress={() => navigation.navigate("SetDetail", { setId: s.id })}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{setTypeLabel(s.setType)}</Body>
                <Badge
                  text={s.status === "assembled" ? STR.statusAssembled : STR.statusDraft}
                  tone={s.status === "assembled" ? "ok" : "warn"}
                />
              </View>
              <Muted style={{ marginTop: 4 }}>
                {bnNum(s.basketItems.length)} {STR.questionsWord} · {bnNum(s.totalMarks ?? 0)} {STR.marks}
              </Muted>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
