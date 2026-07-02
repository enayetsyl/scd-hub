/**
 * StaffListScreen — read-only HR staff roster (Principal/Office, staff:manage).
 * Surfaces the records loaded from the real staff import (prd-hr H1): Bangla/
 * English name, ID, HR category, designation, employment type/status, bio +
 * contact, and the Principal/Office-only rows (NID / bank account / biometric id).
 * Mirrors RosterScreen; a simple category filter replaces the section picker.
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { HR_CATEGORIES } from "@scd/shared";
import { STAFF_QUERY, type StaffT } from "../../graphql/operations";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Row,
  Button,
  Field,
  Divider,
  Loader,
  EmptyState,
  ErrorBanner,
} from "../../components/ui";
import {
  STR,
  bnNum,
  genderLabel,
  hrCategoryLabel,
  employmentTypeLabel,
  employmentStatusLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

/** ISO timestamp → DD/MM/YYYY in Bangla numerals. */
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return bnNum(`${d}/${m}/${y}`);
}

function StaffCard({ s }: { s: StaffT }): React.ReactElement {
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{s.nameBn || s.name}</Body>
      {s.nameBn ? <Muted>{s.name}</Muted> : null}
      <Muted>{`${hrCategoryLabel(s.category)}${s.designation ? ` · ${s.designation}` : ""}`}</Muted>
      <Divider />
      <Row label={STR.staffId} value={s.schoolId} />
      <Row label={STR.employmentType} value={employmentTypeLabel(s.employmentType)} />
      <Row label={STR.employmentStatus} value={employmentStatusLabel(s.employmentStatus)} />
      <Row label={STR.joiningDate} value={formatDate(s.joiningDate)} />
      <Row label={STR.gender} value={genderLabel(s.gender)} />
      <Row label={STR.dob} value={formatDate(s.dob)} />
      <Row label={STR.bloodGroup} value={s.bloodGroup ?? "—"} />
      {s.maritalStatus ? <Row label={STR.maritalStatus} value={s.maritalStatus} /> : null}
      {s.qualification ? <Row label={STR.qualification} value={s.qualification} /> : null}
      <Divider />
      <Row label={STR.phone} value={s.phone ?? "—"} />
      {s.whatsapp ? <Row label={STR.whatsapp} value={s.whatsapp} /> : null}
      {s.email ? <Row label={STR.email} value={s.email} /> : null}
      {s.presentAddress ? <Row label={STR.address} value={s.presentAddress} /> : null}
      {s.fatherName ? <Row label={STR.fatherName} value={s.fatherName} /> : null}
      {s.motherName ? <Row label={STR.motherName} value={s.motherName} /> : null}
      {s.spouseName ? <Row label={STR.spouseName} value={s.spouseName} /> : null}
      {s.biometricId || s.nid || s.bankAccount ? <Divider /> : null}
      {s.biometricId ? <Row label={STR.biometricId} value={s.biometricId} /> : null}
      {s.nid ? <Row label={STR.nid} value={s.nid} /> : null}
      {s.bankAccount ? <Row label={STR.bankAccount} value={s.bankAccount} /> : null}
    </Card>
  );
}

export default function StaffListScreen(): React.ReactElement {
  const [category, setCategory] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");

  const [{ data, fetching, error }, refetch] = useQuery({
    query: STAFF_QUERY,
    variables: { category },
  });

  const staff = data?.staff ?? [];
  const q = search.trim().toLowerCase();
  const shown = q
    ? staff.filter((s) => {
        const categoryLabel = hrCategoryLabel(s.category).toLowerCase();
        return (
          (s.nameBn ?? "").toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.schoolId ?? "").toLowerCase().includes(q) ||
          (s.phone ?? "").toLowerCase().includes(q) ||
          categoryLabel.includes(q)
        );
      })
    : staff;

  return (
    <Screen scroll>
      <H2>{STR.staff}</H2>

      <Field label={undefined} value={search} onChangeText={setSearch} placeholder={STR.searchStaff} />

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginBottom: space(2) }}>
        <Button
          title={STR.allCategories}
          variant={category === null ? "primary" : "secondary"}
          onPress={() => setCategory(null)}
        />
        {HR_CATEGORIES.map((c) => (
          <Button
            key={c}
            title={hrCategoryLabel(c)}
            variant={category === c ? "primary" : "secondary"}
            onPress={() => setCategory(c)}
          />
        ))}
      </View>

      <Card>
        <Muted>{`${bnNum(staff.length)} ${STR.staffCount}`}</Muted>
      </Card>

      {error ? (
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : fetching ? (
        <Loader label={STR.loading} />
      ) : staff.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : shown.length === 0 ? (
        <EmptyState message={STR.noMatches} />
      ) : (
        shown.map((s) => <StaffCard key={s.id} s={s} />)
      )}
    </Screen>
  );
}
