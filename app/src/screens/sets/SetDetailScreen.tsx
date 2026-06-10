/**
 * SetDetailScreen (S8 / J3.4) — set metadata, question list (qid + marks) and
 * server-side PDF export (assembled sets only). A draft set offers a shortcut to
 * AssembleSet to finalise it.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { ASSESSMENT_SET_QUERY } from "../../graphql/operations";
import type { SetsStackParamList } from "../../navigation/types";
import {
  Screen,
  H1,
  Body,
  Muted,
  Card,
  Row,
  Badge,
  Button,
  Loader,
  ErrorBanner,
  Notice,
  Divider,
} from "../../components/ui";
import { STR, setTypeLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<SetsStackParamList, "SetDetail">;

export default function SetDetailScreen({ route, navigation }: Props): React.ReactElement {
  const { setId } = route.params;
  const [{ data, fetching, error }, refetch] = useQuery({
    query: ASSESSMENT_SET_QUERY,
    variables: { id: setId },
  });
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const s = data?.assessmentSet;

  async function onExport(): Promise<void> {
    setPdfBusy(true);
    setPdfError(null);
    try {
      await openPdf(`/pdf/set/${setId}`);
    } catch {
      setPdfError(STR.pdfError);
    } finally {
      setPdfBusy(false);
    }
  }

  if (fetching) return <Loader label={STR.loading} />;
  if (error) {
    return (
      <Screen>
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
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

  const assembled = s.status === "assembled";

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <H1>{setTypeLabel(s.setType)}</H1>
        <Badge text={assembled ? STR.statusAssembled : STR.statusDraft} tone={assembled ? "ok" : "warn"} />
      </View>

      <Card>
        <Row label={STR.setType} value={setTypeLabel(s.setType)} />
        <Row label={STR.status} value={assembled ? STR.statusAssembled : STR.statusDraft} />
        <Row label={STR.totalMarks} value={bnNum(s.totalMarks ?? 0)} />
        {s.durationMinutes != null ? <Row label={STR.durationMinutes} value={bnNum(s.durationMinutes)} /> : null}
        {s.dueDate ? <Row label={STR.dueDate} value={s.dueDate.slice(0, 10)} /> : null}
      </Card>

      {assembled ? (
        PDF_SUPPORTED ? (
          <Button title={pdfBusy ? STR.preparingPdf : STR.exportPdf} onPress={onExport} loading={pdfBusy} variant="secondary" />
        ) : (
          <Notice message={STR.pdfWebOnly} tone="warn" />
        )
      ) : (
        <Button
          title={STR.assemble}
          onPress={() => navigation.navigate("AssembleSet", { setId: s.id, setType: s.setType })}
        />
      )}
      {pdfError ? <Notice message={pdfError} tone="danger" /> : null}

      <Divider />
      <Muted>
        {STR.questionsWord} ({bnNum(s.basketItems.length)})
      </Muted>
      {s.basketItems.map((item, i) => (
        <Card key={item.artifactId}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ flex: 1 }}>
              {bnNum(i + 1)}. {item.qid}
            </Body>
            <Muted>
              {bnNum(item.marks)} {STR.marks}
            </Muted>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
