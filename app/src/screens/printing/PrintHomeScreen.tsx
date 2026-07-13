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
import { Screen, H2, Body, Muted, Card, Chip, ChipRow, Button, Badge, Loader, EmptyState, ErrorBanner, Field } from "../../components/ui";
import { STR, bnNum, classLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openStoredFile } from "../../lib/files";
import { useFileOpen } from "../../lib/useFileOpen";
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
  // D-#294: manual copy count entry for a CLASS_PRESENT job whose use-day attendance
  // is still pending — expands inline under that row's Mark-printed action.
  const [manualFor, setManualFor] = useState<string | null>(null);
  const [manualCount, setManualCount] = useState("");

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

  // A set/plan PDF is RENDERED on demand and an upload streams through the server, so an
  // Open can take seconds. Without this the button looked dead and a double-tap opened
  // duplicate tabs (the BUG-014 pattern, applied here).
  const { openingId, runOpen } = useFileOpen();

  /** Open the job's SINGLE-document sources. Uploads get one button PER FILE (below) —
   *  opening only fileIds[0] left every other attachment unreachable (live-testing find:
   *  a teacher attached a PDF + an image and only the image could be opened). */
  async function openSource(r: PrintRequestT): Promise<void> {
    if (r.sourceType === "SET" && r.setId) return openPdf(`/pdf/set/${r.setId}`);
    // A plan is stored as markdown; `/pdf/artifact/:id` renders it through the same
    // pdfkit + NotoSansBengali pipeline the question sets use.
    if (r.sourceType === "CONTENT_ARTIFACT" && r.contentArtifactId) {
      return openPdf(`/pdf/artifact/${r.contentArtifactId}`);
    }
    if (r.sourceType === "LINK" && r.linkUrl) {
      await Linking.openURL(r.linkUrl);
      return;
    }
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
          {/* D-#294: a CLASS_PRESENT job's count resolves from the USE day's attendance. */}
          {r.copiesMode === "CLASS_PRESENT" && r.status === "REQUESTED" ? (
            r.copiesPending ? (
              <Muted style={{ fontWeight: "600" }}>
                ⚠ {STR.prCopiesPending}
                {r.copiesClassLevel !== null ? ` (${classLevelLabel(r.copiesClassLevel)})` : ""}
              </Muted>
            ) : (
              <Muted>
                {bnNum(r.effectiveCopies ?? 0)} {STR.prCopiesShort} · {STR.prCopiesFromPresent}
                {r.copiesClassLevel !== null ? ` (${classLevelLabel(r.copiesClassLevel)})` : ""}
              </Muted>
            )
          ) : (
            <Muted>
              {bnNum(r.copies)} {STR.prCopiesShort}
              {r.copiesMode === "CLASS_PRESENT" && r.copiesClassLevel !== null
                ? ` · ${STR.prCopiesFromPresent} (${classLevelLabel(r.copiesClassLevel)})`
                : ""}
            </Muted>
          )}
          <Muted>
            {r.purpose}
            {r.neededByKey ? ` · ${STR.prUseDate}: ${bnNum(r.neededByKey)}` : ""}
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

      {/* An UPLOAD job can carry up to 5 files — the Office must be able to open EVERY
          one, so each gets its own named button. */}
      {r.sourceType === "UPLOAD" ? (
        <View style={{ gap: space(1), marginTop: space(2) }}>
          {r.files.map((f) => (
            <View
              key={f.id}
              style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}
            >
              <Muted style={{ flex: 1 }}>📄 {f.name}</Muted>
              <Button
                title={STR.prOpen}
                variant="secondary"
                loading={openingId === f.id}
                disabled={!!openingId}
                onPress={() => runOpen(f.id, () => openStoredFile(f.id))}
              />
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
        {r.sourceType !== "UPLOAD" ? (
          <Button
            title={STR.prOpen}
            variant="secondary"
            loading={openingId === r.id}
            disabled={!!openingId}
            onPress={() => runOpen(r.id, () => openSource(r))}
          />
        ) : null}

        {office && r.status === "REQUESTED" ? (
          <Button
            title={STR.prMarkPrinted}
            onPress={() => {
              // D-#294: no live count yet → collect a manual count inline instead.
              if (r.copiesMode === "CLASS_PRESENT" && r.copiesPending) {
                setManualCount("");
                setManualFor(manualFor === r.id ? null : r.id);
                return;
              }
              void run(() => markPrinted({ id: r.id }), STR.prPrintedOk);
            }}
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

      {/* D-#294: manual count for a pending CLASS_PRESENT job — attendance for the
          use day isn't in yet, so the Office types the number it printed. */}
      {office && manualFor === r.id && r.status === "REQUESTED" ? (
        <View style={{ marginTop: space(2) }}>
          <Field
            label={STR.prManualCount}
            value={manualCount}
            onChangeText={setManualCount}
            keyboardType="number-pad"
          />
          <Button
            title={STR.prMarkPrinted}
            disabled={busy || !Number.isInteger(Number(manualCount)) || Number(manualCount) < 1}
            onPress={async () => {
              await run(
                () => markPrinted({ id: r.id, copies: Number(manualCount) }),
                STR.prPrintedOk,
              );
              setManualFor(null);
            }}
          />
        </View>
      ) : null}
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
