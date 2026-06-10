/**
 * PlanViewScreen (S3 / J1.7–J1.8) — display the artifact's rendered_markdown
 * exactly as imported (ADR-006: never re-rendered from JSON) + server-side PDF
 * export. Shows the curationTag chip and reviewStatus badge.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { ARTIFACT_QUERY } from "../../graphql/operations";
import type { ContentStackParamList } from "../../navigation/types";
import {
  Screen,
  H1,
  Body,
  Muted,
  Badge,
  Button,
  Loader,
  ErrorBanner,
  Notice,
  Divider,
} from "../../components/ui";
import {
  STR,
  subjectLabel,
  classLevelLabel,
  curationTagLabel,
  reviewStatusLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ContentStackParamList, "PlanView">;

export default function PlanViewScreen({ route }: Props): React.ReactElement {
  const { artifactId } = route.params;
  const [{ data, fetching, error }, refetch] = useQuery({
    query: ARTIFACT_QUERY,
    variables: { id: artifactId },
  });
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const a = data?.artifact;

  async function onExport(): Promise<void> {
    setPdfBusy(true);
    setPdfError(null);
    try {
      await openPdf(`/pdf/artifact/${artifactId}`);
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
  if (!a) {
    return (
      <Screen>
        <Notice message={STR.empty} tone="warn" />
      </Screen>
    );
  }

  const title = a.address.title || `${a.address.anchorWord} ${a.address.number}`;

  return (
    <Screen scroll>
      <H1>{title}</H1>
      <Muted>
        {subjectLabel(a.subject)} · {classLevelLabel(a.classLevel)}
      </Muted>
      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
        <Badge text={curationTagLabel(a.curationTag)} tone="muted" />
        <Badge
          text={reviewStatusLabel(a.reviewStatus)}
          tone={a.reviewStatus === "gold" ? "ok" : a.reviewStatus === "reviewed" ? "brand" : "muted"}
        />
      </View>

      {PDF_SUPPORTED ? (
        <Button
          title={pdfBusy ? STR.preparingPdf : STR.exportPdf}
          onPress={onExport}
          loading={pdfBusy}
          variant="secondary"
          style={{ marginTop: space(3) }}
        />
      ) : (
        <View style={{ marginTop: space(3) }}>
          <Notice message={STR.pdfWebOnly} tone="warn" />
        </View>
      )}
      {pdfError ? <Notice message={pdfError} tone="danger" /> : null}

      <Divider />

      {a.renderedMarkdown ? (
        <Body>{a.renderedMarkdown}</Body>
      ) : (
        <Notice message={STR.noMarkdown} tone="warn" />
      )}
    </Screen>
  );
}
