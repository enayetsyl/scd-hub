/**
 * LibraryHomeScreen (LB-4, D-#81–#84) — role-aware landing: catalog
 * search/browse for every `library:read` holder + own loans/reservations;
 * desk + manage entries appear only for librarians (`amILibrarian`) /
 * `library:manage`. Bangla labels from shared vocab; accession numbers stay
 * in Latin digits (D-#61 / glossary).
 */
import React, { useState } from "react";
import { Linking, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { roleHasPermission, BOOK_LANGUAGES } from "@scd/shared";
import {
  AM_I_LIBRARIAN_QUERY,
  BOOK_TITLES_QUERY,
  MY_LOANS_QUERY,
  MY_RESERVATIONS_QUERY,
  CANCEL_RESERVATION,
  LIBRARY_CHASE_LIST_QUERY,
} from "../../graphql/operations";
import type { LibraryStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Button, Badge, Chip, ChipRow, Field, Notice, EmptyState, Loader } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, bookLanguageLabel, reservationStatusLabel, borrowerTypeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<LibraryStackParamList, "LibraryHome">;

export default function LibraryHomeScreen({ navigation }: Props): React.ReactElement {
  const { role } = useAuth();
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const canManage = !!role && roleHasPermission(role, "library:manage");
  const [librarianQ] = useQuery({ query: AM_I_LIBRARIAN_QUERY });
  const isLibrarian = canManage || (librarianQ.data?.amILibrarian ?? false);

  const [titlesQ] = useQuery({
    query: BOOK_TITLES_QUERY,
    variables: { search: search.trim() || null, language },
  });
  const [loansQ, refetchLoans] = useQuery({ query: MY_LOANS_QUERY });
  const [resvQ, refetchResv] = useQuery({ query: MY_RESERVATIONS_QUERY });
  const [chaseQ] = useQuery({ query: LIBRARY_CHASE_LIST_QUERY, pause: !isLibrarian });
  const [, cancelResv] = useMutation(CANCEL_RESERVATION);

  const myLoans = (loansQ.data?.myLoans ?? []).filter((l) => l.status === "ACTIVE");
  const myResv = (resvQ.data?.myReservations ?? []).filter((r) => r.status === "QUEUED" || r.status === "READY");
  const titles = titlesQ.data?.bookTitles ?? [];

  async function runCancel(reservationId: string): Promise<void> {
    setError(null);
    setOk(null);
    const res = await cancelResv({ reservationId });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.libReservationCancelled);
    refetchResv({ requestPolicy: "network-only" });
    refetchLoans({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      {/* Desk + manage entries (librarian / library:manage only) */}
      {isLibrarian || canManage ? (
        <View style={{ gap: space(2), marginBottom: space(3) }}>
          {isLibrarian ? <Button title={STR.libDesk} onPress={() => navigation.navigate("LibraryDesk")} /> : null}
          {canManage ? (
            <Button title={STR.libCatalogManage} variant="secondary" onPress={() => navigation.navigate("CatalogManage")} />
          ) : null}
          {canManage ? (
            <Button title={STR.libAdmin} variant="secondary" onPress={() => navigation.navigate("LibraryAdmin")} />
          ) : null}
        </View>
      ) : null}

      {/* My loans (staff own-row) */}
      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.libMyLoans}</Body>
      {myLoans.length === 0 ? <Muted style={{ marginBottom: space(2) }}>{STR.libNoLoans}</Muted> : null}
      {myLoans.map((loan) => (
        <Card key={loan.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
            <Body style={{ flex: 1, fontWeight: "700" }}>{loan.titleBn ?? loan.accessionNo ?? "—"}</Body>
            {loan.overdue ? <Badge text={STR.libOverdue} tone="danger" /> : null}
          </View>
          <Muted>
            {loan.accessionNo ?? "—"} · {STR.libDue}: {new Date(loan.dueDate).toLocaleDateString()}
          </Muted>
        </Card>
      ))}

      {/* My reservations */}
      <Body style={{ fontWeight: "700", marginTop: space(3), marginBottom: space(1) }}>{STR.libMyReservations}</Body>
      {myResv.length === 0 ? <Muted style={{ marginBottom: space(2) }}>{STR.libNoReservations}</Muted> : null}
      {myResv.map((r) => (
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
          <Button title={STR.libCancelReservation} variant="danger" onPress={() => void runCancel(r.id)} style={{ marginTop: space(2) }} />
        </Card>
      ))}

      {/* Overdue chase list (LB-5, J-L8 — librarians only; ADR-003 manual wa.me) */}
      {isLibrarian ? (
        <>
          <Body style={{ fontWeight: "700", marginTop: space(3), marginBottom: space(1) }}>{STR.libChaseList}</Body>
          {(chaseQ.data?.libraryChaseList ?? []).length === 0 ? (
            <Muted style={{ marginBottom: space(2) }}>{STR.libNoChase}</Muted>
          ) : null}
          {(chaseQ.data?.libraryChaseList ?? []).map((row) => (
            <Card key={row.loanId}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                <Body style={{ flex: 1, fontWeight: "700" }}>{row.borrowerName ?? row.borrowerId}</Body>
                <Badge text={`${bnNum(row.daysOverdue)} ${STR.libDaysOverdue}`} tone="danger" />
              </View>
              <Muted>
                {borrowerTypeLabel(row.borrowerType)} · {row.titleBn ?? "—"} ({row.accessionNo ?? "—"}) · {STR.libDue}:{" "}
                {new Date(row.dueDate).toLocaleDateString()}
              </Muted>
              {row.waLink ? (
                <Button
                  title={STR.libSendWhatsApp}
                  variant="secondary"
                  onPress={() => void Linking.openURL(row.waLink!)}
                  style={{ marginTop: space(2) }}
                />
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      {/* Catalog browse */}
      <Body style={{ fontWeight: "700", marginTop: space(3), marginBottom: space(1) }}>{STR.tabLibrary}</Body>
      <Field label={STR.libSearch} value={search} onChangeText={setSearch} />
      <ChipRow>
        <Chip label={STR.libAllLanguages} selected={language === null} onPress={() => setLanguage(null)} />
        {BOOK_LANGUAGES.map((lng) => (
          <Chip key={lng} label={bookLanguageLabel(lng)} selected={language === lng} onPress={() => setLanguage(lng)} />
        ))}
      </ChipRow>

      {titlesQ.fetching ? <Loader /> : null}
      {!titlesQ.fetching && titles.length === 0 ? <EmptyState message={STR.libNoTitles} /> : null}
      {titles.map((t) => (
        <Card key={t.id} onPress={() => navigation.navigate("TitleDetail", { titleId: t.id })}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
            <Body style={{ flex: 1, fontWeight: "700" }}>{t.titleBn}</Body>
            <Badge
              text={`${STR.libAvailable} ${bnNum(t.availableCopies)}/${bnNum(t.totalCopies)}`}
              tone={t.availableCopies > 0 ? "ok" : "muted"}
            />
          </View>
          <Muted>
            {t.author ?? "—"} · {bookLanguageLabel(t.language)}
            {t.category ? ` · ${t.category}` : ""}
          </Muted>
        </Card>
      ))}
    </Screen>
  );
}
