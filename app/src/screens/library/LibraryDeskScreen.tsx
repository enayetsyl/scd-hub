/**
 * LibraryDeskScreen (LB-4) — the circulation desk (librarian gate, J-L3):
 * pick a borrower (student/staff/guardian search), issue by accession number
 * (an ON_HOLD copy fulfills that borrower's READY hold), return / renew /
 * mark-lost their loans, reserve a title on their behalf, cancel reservations.
 * NO money anywhere (D-#27).
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import { BORROWER_TYPES } from "@scd/shared";
import {
  LIBRARY_BORROWER_SEARCH,
  BORROWER_LOANS_QUERY,
  BORROWER_RESERVATIONS_QUERY,
  BOOK_TITLES_QUERY,
  ISSUE_BOOK,
  RETURN_BOOK,
  RENEW_LOAN,
  MARK_BOOK_LOST,
  RESERVE_TITLE,
  CANCEL_RESERVATION,
  type LibraryBorrowerHitT,
} from "../../graphql/operations";
import { Screen, Body, Muted, Card, Button, Badge, Chip, ChipRow, Field, Notice, Loader } from "../../components/ui";
import {
  STR,
  bnNum,
  borrowerTypeLabel,
  loanStatusLabel,
  reservationStatusLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

export default function LibraryDeskScreen(): React.ReactElement {
  const { confirmAction } = useConfirm();
  const [borrowerType, setBorrowerType] = useState<string>("STUDENT");
  const [search, setSearch] = useState("");
  const [borrower, setBorrower] = useState<LibraryBorrowerHitT | null>(null);
  const [accessionNo, setAccessionNo] = useState("");
  const [lostNoteFor, setLostNoteFor] = useState<string | null>(null);
  const [lostNote, setLostNote] = useState("");
  const [titleSearch, setTitleSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [hitsQ] = useQuery({
    query: LIBRARY_BORROWER_SEARCH,
    variables: { borrowerType, search: search.trim() },
    pause: search.trim().length < 2 || borrower !== null,
  });
  const [loansQ, refetchLoans] = useQuery({
    query: BORROWER_LOANS_QUERY,
    variables: { borrowerType, borrowerId: borrower?.id ?? "" },
    pause: !borrower,
  });
  const [resvQ, refetchResv] = useQuery({
    query: BORROWER_RESERVATIONS_QUERY,
    variables: { borrowerType, borrowerId: borrower?.id ?? "" },
    pause: !borrower,
  });
  const [titlesQ] = useQuery({
    query: BOOK_TITLES_QUERY,
    variables: { search: titleSearch.trim() || null, language: null },
    pause: !borrower || titleSearch.trim().length < 2,
  });

  const [, issue] = useMutation(ISSUE_BOOK);
  const [, doReturn] = useMutation(RETURN_BOOK);
  const [, renew] = useMutation(RENEW_LOAN);
  const [, markLost] = useMutation(MARK_BOOK_LOST);
  const [, reserve] = useMutation(RESERVE_TITLE);
  const [, cancelResv] = useMutation(CANCEL_RESERVATION);

  const loans = (loansQ.data?.borrowerLoans ?? []).filter((l) => l.status === "ACTIVE");
  const reservations = (resvQ.data?.borrowerReservations ?? []).filter(
    (r) => r.status === "QUEUED" || r.status === "READY",
  );
  const titleHits = titlesQ.data?.bookTitles ?? [];

  function refresh(): void {
    refetchLoans({ requestPolicy: "network-only" });
    refetchResv({ requestPolicy: "network-only" });
  }

  async function run(action: () => Promise<{ error?: unknown }>, okMsg: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await action();
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error as never));
      return false;
    }
    setOk(okMsg);
    refresh();
    return true;
  }

  function pickType(t: string): void {
    setBorrowerType(t);
    setBorrower(null);
    setSearch("");
  }

  return (
    <Screen scroll>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      {/* Borrower picker */}
      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.libBorrowerType}</Body>
      <ChipRow>
        {BORROWER_TYPES.map((t) => (
          <Chip key={t} label={borrowerTypeLabel(t)} selected={borrowerType === t} onPress={() => pickType(t)} />
        ))}
      </ChipRow>

      {borrower ? (
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
            <Body style={{ flex: 1, fontWeight: "700" }}>{borrower.name}</Body>
            <Badge text={borrowerTypeLabel(borrowerType)} tone="brand" />
          </View>
          {borrower.detail ? <Muted>{borrower.detail}</Muted> : null}
          <Button title={STR.clear} variant="ghost" onPress={() => setBorrower(null)} style={{ marginTop: space(1) }} />
        </Card>
      ) : (
        <>
          <Field label={STR.libBorrowerSearch} value={search} onChangeText={setSearch} />
          {hitsQ.fetching ? <Loader /> : null}
          {(hitsQ.data?.libraryBorrowerSearch ?? []).map((h) => (
            <Card key={h.id} onPress={() => setBorrower(h)}>
              <Body style={{ fontWeight: "700" }}>{h.name}</Body>
              {h.detail ? <Muted>{h.detail}</Muted> : null}
            </Card>
          ))}
        </>
      )}

      {borrower ? (
        <>
          {/* Issue (J-L2; an ON_HOLD copy fulfills this borrower's READY hold) */}
          <Body style={{ fontWeight: "700", marginTop: space(3), marginBottom: space(1) }}>{STR.libIssue}</Body>
          <Field label={STR.libAccessionNo} value={accessionNo} onChangeText={setAccessionNo} />
          <Button
            title={STR.libIssue}
            onPress={() =>
              void run(
                () => issue({ accessionNo: accessionNo.trim(), borrowerType, borrowerId: borrower.id }),
                STR.libIssued,
              ).then((done) => done && setAccessionNo(""))
            }
            loading={busy}
            disabled={busy || accessionNo.trim() === ""}
          />

          {/* Active loans (J-L4/J-L5/J-L7) */}
          <Body style={{ fontWeight: "700", marginTop: space(3), marginBottom: space(1) }}>{STR.libBorrowerLoans}</Body>
          {loans.length === 0 ? <Muted>{STR.libNoLoans}</Muted> : null}
          {loans.map((loan) => (
            <Card key={loan.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                <Body style={{ flex: 1, fontWeight: "700" }}>{loan.titleBn ?? "—"}</Body>
                {loan.overdue ? <Badge text={STR.libOverdue} tone="danger" /> : <Badge text={loanStatusLabel(loan.status)} tone="ok" />}
              </View>
              <Muted>
                {loan.accessionNo ?? "—"} · {STR.libDue}: {new Date(loan.dueDate).toLocaleDateString()} ·{" "}
                {STR.libRenewCount}: {bnNum(loan.renewCount)}
              </Muted>
              <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2), flexWrap: "wrap" }}>
                <Button title={STR.libReturn} onPress={() => void run(() => doReturn({ loanId: loan.id }), STR.libReturned)} disabled={busy} />
                <Button title={STR.libRenew} variant="secondary" onPress={() => void run(() => renew({ loanId: loan.id }), STR.libRenewed)} disabled={busy} />
                <Button
                  title={STR.libMarkLost}
                  variant="danger"
                  onPress={() => {
                    setLostNoteFor(lostNoteFor === loan.id ? null : loan.id);
                    setLostNote("");
                  }}
                  disabled={busy}
                />
              </View>
              {lostNoteFor === loan.id ? (
                <View style={{ marginTop: space(2) }}>
                  <Field label={STR.libLostNote} value={lostNote} onChangeText={setLostNote} multiline />
                  <Button
                    title={STR.libMarkLost}
                    variant="danger"
                    onPress={async () => {
                      if (!(await confirmAction({ confirmLabel: STR.libMarkLost }))) return;
                      const done = await run(() => markLost({ loanId: loan.id, note: lostNote.trim() }), STR.libMarkedLost);
                      if (done) setLostNoteFor(null);
                    }}
                    disabled={busy || lostNote.trim() === ""}
                  />
                </View>
              ) : null}
            </Card>
          ))}

          {/* Reservations on behalf (LB-3 desk path) */}
          <Body style={{ fontWeight: "700", marginTop: space(3), marginBottom: space(1) }}>{STR.libBorrowerReservations}</Body>
          {reservations.length === 0 ? <Muted>{STR.libNoReservations}</Muted> : null}
          {reservations.map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                <Body style={{ flex: 1, fontWeight: "700" }}>{r.titleBn ?? "—"}</Body>
                <Badge text={reservationStatusLabel(r.status)} tone={r.status === "READY" ? "ok" : "info"} />
              </View>
              {r.status === "READY" && r.expiresAt ? (
                <Muted>
                  {STR.libHoldUntil}: {new Date(r.expiresAt).toLocaleDateString()}
                  {r.heldAccessionNo ? ` · ${r.heldAccessionNo}` : ""}
                </Muted>
              ) : null}
              <Button
                title={STR.libCancelReservation}
                variant="danger"
                onPress={async () => {
                  if (!(await confirmAction({ confirmLabel: STR.libCancelReservation }))) return;
                  void run(() => cancelResv({ reservationId: r.id }), STR.libReservationCancelled);
                }}
                disabled={busy}
                style={{ marginTop: space(2) }}
              />
            </Card>
          ))}

          <Field label={STR.libSearch} value={titleSearch} onChangeText={setTitleSearch} />
          {titlesQ.fetching ? <Loader /> : null}
          {titleHits.map((t) => (
            <Card key={t.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                <Body style={{ flex: 1 }}>{t.titleBn}</Body>
                <Badge text={`${STR.libAvailable} ${bnNum(t.availableCopies)}/${bnNum(t.totalCopies)}`} tone={t.availableCopies > 0 ? "ok" : "muted"} />
              </View>
              <Button
                title={STR.libReserveForBorrower}
                variant="secondary"
                onPress={() => void run(() => reserve({ titleId: t.id, borrowerType, borrowerId: borrower.id }), STR.libReserved)}
                disabled={busy}
                style={{ marginTop: space(2) }}
              />
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
