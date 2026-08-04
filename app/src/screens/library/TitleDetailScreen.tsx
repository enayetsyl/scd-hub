/**
 * TitleDetailScreen (LB-4) — one title's bibliographic record, its copies
 * (per-accession status), computed availability, staff self-reserve (LB-3),
 * and — for librarians — the FIFO reservation queue with cancel.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  BOOK_TITLE_QUERY,
  AM_I_LIBRARIAN_QUERY,
  RESERVATIONS_FOR_TITLE_QUERY,
  RESERVE_TITLE,
  CANCEL_RESERVATION,
} from "../../graphql/operations";
import type { LibraryStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Button, Badge, Row, Divider, Notice, Loader, EmptyState } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import {
  STR,
  bnNum,
  bookLanguageLabel,
  copyStatusLabel,
  borrowerTypeLabel,
  reservationStatusLabel,
  isoDateLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<LibraryStackParamList, "TitleDetail">;

const COPY_TONE: Record<string, "ok" | "warn" | "danger" | "muted" | "info"> = {
  AVAILABLE: "ok",
  ON_LOAN: "info",
  ON_HOLD: "warn",
  LOST: "danger",
  DAMAGED: "danger",
  WITHDRAWN: "muted",
};

export default function TitleDetailScreen({ route }: Props): React.ReactElement {
  const { titleId } = route.params;
  const { role, can } = useAuth();
  const { confirmAction } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const canManage = can("library:manage");
  const [librarianQ] = useQuery({ query: AM_I_LIBRARIAN_QUERY });
  const isLibrarian = canManage || (librarianQ.data?.amILibrarian ?? false);

  const [titleQ, refetchTitle] = useQuery({ query: BOOK_TITLE_QUERY, variables: { titleId } });
  const [queueQ, refetchQueue] = useQuery({
    query: RESERVATIONS_FOR_TITLE_QUERY,
    variables: { titleId },
    pause: !isLibrarian,
  });
  const [, reserve] = useMutation(RESERVE_TITLE);
  const [, cancelResv] = useMutation(CANCEL_RESERVATION);

  const detail = titleQ.data?.bookTitle ?? null;
  const queue = queueQ.data?.reservationsForTitle ?? [];

  function refresh(): void {
    refetchTitle({ requestPolicy: "network-only" });
    if (isLibrarian) refetchQueue({ requestPolicy: "network-only" });
  }

  async function reserveForSelf(): Promise<void> {
    setError(null);
    setOk(null);
    const res = await reserve({ titleId, borrowerType: null, borrowerId: null });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.libReserved);
    refresh();
  }

  async function runCancel(reservationId: string): Promise<void> {
    if (!(await confirmAction({ confirmLabel: STR.libCancelReservation }))) return;
    setError(null);
    setOk(null);
    const res = await cancelResv({ reservationId });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.libReservationCancelled);
    refresh();
  }

  if (titleQ.fetching) return <Screen><Loader /></Screen>;
  if (!detail) return <Screen><EmptyState message={STR.libNoTitles} /></Screen>;

  return (
    <Screen scroll>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
          <Body style={{ flex: 1, fontWeight: "700" }}>{detail.titleBn}</Body>
          <Badge
            text={`${STR.libAvailable} ${bnNum(detail.availableCopies)}/${bnNum(detail.totalCopies)}`}
            tone={detail.availableCopies > 0 ? "ok" : "muted"}
          />
        </View>
        {detail.titleEn ? <Muted>{detail.titleEn}</Muted> : null}
        <Divider />
        <Row label={STR.libAuthor} value={detail.author ?? "—"} />
        <Row label={STR.libLanguage} value={bookLanguageLabel(detail.language)} />
        <Row label={STR.libCategory} value={detail.category ?? "—"} />
        <Row label={STR.libShelf} value={detail.shelf ?? "—"} />
        <Row label={STR.libIsbn} value={detail.isbn ?? "—"} />
      </Card>

      <Button title={STR.libReserveSelf} variant="secondary" onPress={() => void reserveForSelf()} style={{ marginTop: space(2) }} />

      <Body style={{ fontWeight: "700", marginTop: space(3), marginBottom: space(1) }}>{STR.libCopies}</Body>
      {detail.copies.length === 0 ? <Muted>{STR.libNoTitles}</Muted> : null}
      {detail.copies.map((c) => (
        <Card key={c.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
            <Body style={{ flex: 1, fontWeight: "700" }}>{c.accessionNo}</Body>
            <Badge text={copyStatusLabel(c.status)} tone={COPY_TONE[c.status] ?? "muted"} />
          </View>
          {c.conditionNote ? <Muted>{c.conditionNote}</Muted> : null}
        </Card>
      ))}

      {isLibrarian ? (
        <>
          <Body style={{ fontWeight: "700", marginTop: space(3), marginBottom: space(1) }}>{STR.libQueue}</Body>
          {queue.length === 0 ? <Muted>{STR.libNoQueue}</Muted> : null}
          {queue.map((r, idx) => (
            <Card key={r.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                <Body style={{ flex: 1, fontWeight: "700" }}>
                  {bnNum(idx + 1)}. {r.borrowerName ?? r.borrowerId}
                </Body>
                <Badge text={reservationStatusLabel(r.status)} tone={r.status === "READY" ? "ok" : "info"} />
              </View>
              <Muted>
                {borrowerTypeLabel(r.borrowerType)}
                {r.status === "READY" && r.expiresAt
                  ? ` · ${STR.libHoldUntil}: ${isoDateLabel(r.expiresAt)}${r.heldAccessionNo ? ` · ${r.heldAccessionNo}` : ""}`
                  : ""}
              </Muted>
              <Button title={STR.libCancelReservation} variant="danger" onPress={() => void runCancel(r.id)} style={{ marginTop: space(2) }} />
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
