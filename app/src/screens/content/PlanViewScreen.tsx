/**
 * PlanViewScreen (S3 / J1.7–J1.8) — display the artifact's rendered_markdown
 * exactly as imported (ADR-006: never re-rendered from JSON) + server-side PDF
 * export. Shows the curationTag chip and reviewStatus badge.
 */
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { roleHasPermission, PLAN_DOC_TYPES } from "@scd/shared";
import { ARTIFACT_QUERY, ASSIGN_PLAN_REVIEW, APPROVE_PLAN, TEACHERS_QUERY } from "../../graphql/operations";
import type { ContentStackParamList } from "../../navigation/types";
import { useAuth } from "../../auth/AuthContext";
import {
  Screen,
  H1,
  H2,
  Muted,
  Card,
  Badge,
  Button,
  Select,
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
  docTypeLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { space } from "../../theme/tokens";
import Markdown from "../../components/Markdown";

type Props = NativeStackScreenProps<ContentStackParamList, "PlanView">;

export default function PlanViewScreen({ route, navigation }: Props): React.ReactElement {
  const { artifactId } = route.params;
  const [{ data, fetching, error }, refetch] = useQuery({
    query: ARTIFACT_QUERY,
    variables: { id: artifactId },
  });
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const { role } = useAuth();
  const canAssign = !!role && roleHasPermission(role, "content:assign_review");
  const canApprove = !!role && roleHasPermission(role, "content:promote_gold");
  const [, assignReview] = useMutation(ASSIGN_PLAN_REVIEW);
  const [, approvePlan] = useMutation(APPROVE_PLAN);
  const [{ data: teacherData }] = useQuery({ query: TEACHERS_QUERY, pause: !canAssign });
  const teacherOptions = (teacherData?.teachers ?? []).map((t) => ({
    label: t.name,
    value: t.id,
    hint: t.phone ?? undefined,
  }));
  const [reviewerId, setReviewerId] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [reviewMsg, setReviewMsg] = useState<{ text: string; tone: "ok" | "danger" } | null>(null);

  const a = data?.artifact;

  // The PlanView route has a static "Session plan" title; override it per artifact
  // so a chapter plan reads "Chapter plan" (the two doc types are otherwise identical here).
  useEffect(() => {
    if (a?.docType) navigation.setOptions({ title: docTypeLabel(a.docType) });
  }, [a?.docType, navigation]);

  async function onAssign(): Promise<void> {
    if (assignBusy || reviewerId.trim() === "") return;
    setReviewMsg(null);
    setAssignBusy(true);
    const res = await assignReview({ artifactId, reviewerId: reviewerId.trim() });
    setAssignBusy(false);
    if (res.error) {
      setReviewMsg({ text: friendlyError(res.error), tone: "danger" });
      return;
    }
    setReviewerId("");
    setReviewMsg({ text: STR.reviewerAssigned, tone: "ok" });
  }

  async function onApprove(): Promise<void> {
    if (approveBusy) return;
    setReviewMsg(null);
    setApproveBusy(true);
    const res = await approvePlan({ artifactId });
    setApproveBusy(false);
    if (res.error) {
      setReviewMsg({ text: friendlyError(res.error), tone: "danger" });
      return;
    }
    setReviewMsg({ text: STR.planApproved, tone: "ok" });
    refetch({ requestPolicy: "network-only" });
  }

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
      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2), flexWrap: "wrap" }}>
        <Badge text={docTypeLabel(a.docType)} tone="info" />
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
        <Markdown source={a.renderedMarkdown} />
      ) : (
        <Notice message={STR.noMarkdown} tone="warn" />
      )}

      {(canAssign || canApprove) && (PLAN_DOC_TYPES as readonly string[]).includes(a.docType) ? (
        <>
          <Divider />
          <Card>
            <H2>{STR.reviewActions}</H2>
            {reviewMsg ? <Notice message={reviewMsg.text} tone={reviewMsg.tone} /> : null}
            {canApprove ? (
              <Button
                title={approveBusy ? STR.approving : STR.approveSignOff}
                onPress={onApprove}
                loading={approveBusy}
                disabled={a.reviewStatus !== "reviewed"}
                style={{ marginTop: space(2) }}
              />
            ) : null}
            {canApprove && a.reviewStatus !== "reviewed" ? (
              <Muted style={{ marginTop: 4 }}>{STR.approveNeedsReviewed}</Muted>
            ) : null}
            {canAssign ? (
              <View style={{ marginTop: space(3) }}>
                <Select
                  label={STR.reviewer}
                  value={reviewerId === "" ? null : reviewerId}
                  options={teacherOptions}
                  onChange={setReviewerId}
                  placeholder={STR.selectTeacher}
                  emptyText={STR.noTeachers}
                  searchable
                />
                <Button
                  title={assignBusy ? STR.assigning : STR.assignForReview}
                  onPress={onAssign}
                  loading={assignBusy}
                  disabled={reviewerId.trim() === ""}
                  variant="secondary"
                  style={{ marginTop: space(2) }}
                />
              </View>
            ) : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
