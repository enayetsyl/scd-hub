/**
 * PrintHomeScreen (PQ-4, D-#281) — role-aware landing for the ONE print queue.
 *
 *   Office / Principal (roster:manage): three tabs matching the three buckets they
 *     track — Yet to print → Printing done → Delivered — with the actions that
 *     advance a job between them.
 *   TEACHER (tracker:write): their own requests with status, plus "New request".
 *     They may withdraw a job while it is still REQUESTED.
 *
 * A row opens its source the right way: an assembled set renders via `/pdf/set/:id`,
 * an upload streams through `GET /files/:id`, a link opens externally, a plan opens
 * in the plan viewer.
 */
import React, { useState } from "react";
import { Linking, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { roleHasPermission, PRINT_COLOUR_LABELS_EN, PRINT_SIDES_LABELS_EN } from "@scd/shared";
import type { Role } from "@scd/shared";
import {
  PRINT_QUEUE_QUERY,
  MY_PRINT_REQUESTS_QUERY,
  MARK_PRINT_REQUEST_PRINTED,
  MARK_PRINT_REQUEST_DELIVERED,
  CANCEL_PRINT_REQUEST,
  type PrintRequestT,
} from "../../graphql/printing";
import type { PrintStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Chip, ChipRow, Button, Badge, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openStoredFile } from "../../lib/files";
import { openPdf } from "../../lib/pdf";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../state/ToastContext";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<PrintStackParamList, "PrintHome">;

/** The Office's three buckets, in the order a job moves through them. */
const BUCKETS = ["REQUESTED", "PRINTED", "DELIVERED"] as const;

const bucketLabel = (s: string): string =>
  s === "REQUESTED" ? STR.prsRequested : s === "PRINTED" ? STR.prsPrinted : STR.prsDelivered;

const statusTone = (s: string): "ok" | "warn" | "muted" =>
  s === "DELIVERED" ? "ok" : s === "PRINTED" ? "warn" : "muted";

export default function PrintHomeScreen({ navigation }: Props): React.ReactElement {
  const { role } = useAuth();
  const toast = useToast();
  const { confirmAction } = useConfirm();
  const isOffice = !!role && roleHasPermission(role as Role, "roster:manage");
  const canRequest = !!role && roleHasPermission(role as Role, "tracker:write");

  const [bucket, setBucket] = useState<string>("REQUESTED");
  const [busy, setBusy] = useState(false);

  // cache-and-network: advancing a job moves it BETWEEN buckets, so the destination
  // tab's cached list is stale the moment we act. Without this, "Mark printed" left the
  // Printing-done tab empty until a manual refresh (live-testing find).
  const [queueQ, refetchQueue] = useQuery({
    query: PRINT_QUEUE_QUERY,
    variables: { status: bucket },
    pause: !isOffice,
    requestPolicy: "cache-and-network",
  });
  const [mineQ, refetchMine] = useQuery({
    query: MY_PRINT_REQUESTS_QUERY,
    variables: {},
    pause: !canRequest,
    requestPolicy: "cache-and-network",
  });

  const [, markPrinted] = useMutation(MARK_PRINT_REQUEST_PRINTED);
  const [, markDelivered] = useMutation(MARK_PRINT_REQUEST_DELIVERED);
  const [, cancelRequest] = useMutation(CANCEL_PRINT_REQUEST);

  const refresh = (): void => {
    if (isOffice) refetchQueue({ requestPolicy: "network-only" });
    if (canRequest) refetchMine({ requestPolicy: "network-only" });
  };

  /** Open the job's document the way its source demands. */
  async function openSource(r: PrintRequestT): Promise<void> {
    if (r.sourceType === "SET" && r.setId) return openPdf(`/pdf/set/${r.setId}`);
    if (r.sourceType === "UPLOAD" && r.fileIds.length > 0) return openStoredFile(r.fileIds[0]);
    if (r.sourceType === "LINK" && r.linkUrl) {
      await Linking.openURL(r.linkUrl);
      return;
    }
    // A plan renders from markdown, not through the PDF route — send them to the viewer.
    toast.show(STR.prOpenPlanHint, "info");
  }

  async function run(fn: () => Promise<{ error?: unknown }>, okMsg: string): Promise<void> {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.error) {
      toast.show(friendlyError(res.error as Parameters<typeof friendlyError>[0]), "danger");
      return;
    }
    toast.show(okMsg, "ok");
    refresh();
  }

  const Row = ({ r, office }: { r: PrintRequestT; office: boolean }): React.ReactElement => (
    <Card key={r.id}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
        <View style={{ flex: 1 }}>
          <Body style={{ fontWeight: "700" }}>{r.title}</Body>
          <Muted>
            {r.purpose} · {bnNum(r.copies)} {STR.prCopiesShort}
            {r.neededByKey ? ` · ${STR.prNeededBy}: ${bnNum(r.neededByKey)}` : ""}
          </Muted>
          {/* The Office cannot start a job without knowing how to print it. */}
          <Muted>
            {r.colour === "COLOR" ? PRINT_COLOUR_LABELS_EN.COLOR : PRINT_COLOUR_LABELS_EN.BW}
            {" · "}
            {r.sides === "DOUBLE" ? PRINT_SIDES_LABELS_EN.DOUBLE : PRINT_SIDES_LABELS_EN.SINGLE}
          </Muted>
          {office && r.requesterName ? (
            <Muted>
              {STR.prRequester}: {r.requesterName}
            </Muted>
          ) : null}
          {r.notes ? <Muted>{r.notes}</Muted> : null}
        </View>
        <Badge text={bucketLabel(r.status)} tone={statusTone(r.status)} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
        <Button title={STR.prOpen} variant="secondary" onPress={() => openSource(r)} />

        {office && r.status === "REQUESTED" ? (
          <Button
            title={STR.prMarkPrinted}
            onPress={() => run(() => markPrinted({ id: r.id }), STR.prPrintedOk)}
            disabled={busy}
          />
        ) : null}
        {office && r.status === "PRINTED" ? (
          <Button
            title={STR.prMarkDelivered}
            onPress={() => run(() => markDelivered({ id: r.id }), STR.prDeliveredOk)}
            disabled={busy}
          />
        ) : null}
        {/* A PRINTED job cannot be cancelled — the paper already exists. */}
        {r.status === "REQUESTED" ? (
          <Button
            title={STR.prCancel}
            variant="danger"
            disabled={busy}
            onPress={async () => {
              if (!(await confirmAction({ confirmLabel: STR.prCancel }))) return;
              await run(() => cancelRequest({ id: r.id }), STR.prCancelledOk);
            }}
          />
        ) : null}
      </View>
    </Card>
  );

  const queue = queueQ.data?.printQueue ?? [];
  const mine = mineQ.data?.myPrintRequests ?? [];

  return (
    <Screen scroll>
      {canRequest ? (
        <Button title={`➕ ${STR.prNew}`} onPress={() => navigation.navigate("NewPrintRequest")} />
      ) : null}

      {isOffice ? (
        <>
          <H2>{STR.prQueueTitle}</H2>
          <ChipRow>
            {BUCKETS.map((b) => (
              <Chip key={b} label={bucketLabel(b)} selected={bucket === b} onPress={() => setBucket(b)} />
            ))}
          </ChipRow>
          {queueQ.error ? (
            <ErrorBanner message={friendlyError(queueQ.error)} onRetry={() => refetchQueue({ requestPolicy: "network-only" })} />
          ) : queueQ.fetching && queue.length === 0 ? (
            <Loader label={STR.loading} />
          ) : queue.length === 0 ? (
            <EmptyState message={STR.prNoJobs} />
          ) : (
            queue.map((r) => <Row key={r.id} r={r} office />)
          )}
        </>
      ) : null}

      {canRequest ? (
        <>
          <View style={{ marginTop: space(4) }}>
            <H2>{STR.prMyRequests}</H2>
          </View>
          {mineQ.error ? (
            <ErrorBanner message={friendlyError(mineQ.error)} onRetry={() => refetchMine({ requestPolicy: "network-only" })} />
          ) : mineQ.fetching && mine.length === 0 ? (
            <Loader label={STR.loading} />
          ) : mine.length === 0 ? (
            <EmptyState message={STR.prNoJobs} />
          ) : (
            mine.map((r) => <Row key={r.id} r={r} office={false} />)
          )}
        </>
      ) : null}

      {!isOffice && !canRequest ? <EmptyState message={STR.empty} /> : null}
      <View style={{ height: space(4) }} />
    </Screen>
  );
}
