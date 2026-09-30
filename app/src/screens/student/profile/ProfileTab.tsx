/**
 * The profile's left-hand identity card (initials avatar — students carry no photo —
 * name, ID, session, class, section, roll) and the Profile tab's full detail list
 * with tap-to-call guardians.
 */
import React from "react";
import { Linking, Pressable, Text, View } from "react-native";
import type { ProfileHeaderT } from "../../../graphql/studentProfile";
import { Badge, Body, Card, Muted, Row } from "../../../components/ui";
import { STR, bnNum, classLevelLabel, genderLabel, relationLabel } from "../../../lib/labels";
import { radius, space, useColors } from "../../../theme";
import { SectionTitle } from "./parts";

function initialsOf(name: string): string {
  const parts = name.replace(/^(md\.?|mohammad|muhammad)\s+/i, "").trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** ISO timestamp → DD/MM/YYYY in the active numerals. */
function formatDob(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return bnNum(`${d}/${m}/${y}`);
}

export function IdentityCard({
  header,
  fallbackName,
  narrowed,
  footer,
}: {
  header: ProfileHeaderT | null;
  fallbackName?: string;
  narrowed: boolean;
  footer?: React.ReactNode;
}): React.ReactElement {
  const colors = useColors();
  const name = header?.nameBn || header?.name || fallbackName || "";
  const rows: [string, string][] = header
    ? [
        [STR.studentId, header.schoolId],
        [STR.spSession, header.academicYear?.label ?? "—"],
        [STR.rosterColClass, classLevelLabel(header.classLevel)],
        [STR.spSection, header.sectionNameBn ?? "—"],
        ...(header.rollNumber ? ([[STR.spRoll, bnNum(header.rollNumber)]] as [string, string][]) : []),
      ]
    : [];
  return (
    <View style={{ gap: space(3) }}>
      <View style={{ backgroundColor: colors.primary, borderRadius: radius.md, padding: space(4), gap: space(3) }}>
        <View style={{ alignItems: "center", gap: space(2) }}>
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              backgroundColor: colors.onPrimary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: colors.primary, fontSize: 34, fontWeight: "800" }}>
              {initialsOf(header?.name || fallbackName || "?")}
            </Text>
          </View>
          <Text style={{ color: colors.onPrimary, fontSize: 18, fontWeight: "800", textAlign: "center" }}>{name}</Text>
          {header?.nameBn ? (
            <Text style={{ color: colors.onPrimary, opacity: 0.85, textAlign: "center" }}>{header.name}</Text>
          ) : null}
          {narrowed ? <Badge text={STR.spMySubjectsOnly} tone="muted" /> : null}
        </View>
        {rows.map(([label, value]) => (
          <View key={label} style={{ gap: space(2) }}>
            <View style={{ height: 1, backgroundColor: colors.onPrimary, opacity: 0.25 }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
              <Text style={{ color: colors.onPrimary, fontWeight: "700" }}>{label}</Text>
              <Text style={{ color: colors.onPrimary, flexShrink: 1, textAlign: "right" }}>{value}</Text>
            </View>
          </View>
        ))}
      </View>
      {footer}
    </View>
  );
}

export function ProfileTab({ header }: { header: ProfileHeaderT }): React.ReactElement {
  const colors = useColors();
  return (
    <View style={{ gap: space(3) }}>
      <Card>
        <Row label={STR.spNameEn} value={header.name} />
        {header.nameBn ? <Row label={STR.spNameBn} value={header.nameBn} /> : null}
        <Row label={STR.studentId} value={header.schoolId} />
        <Row label={STR.gender} value={genderLabel(header.gender)} />
        <Row label={STR.dob} value={formatDob(header.dob)} />
        <Row label={STR.bloodGroup} value={header.bloodGroup ?? "—"} />
        <Row label={STR.phone} value={header.phone ?? "—"} />
        {header.address ? <Row label={STR.address} value={header.address} /> : null}
      </Card>
      <Card>
        <Row label={STR.spSession} value={header.academicYear?.label ?? "—"} />
        <Row label={STR.rosterColClass} value={classLevelLabel(header.classLevel)} />
        <Row label={STR.spSection} value={header.sectionNameBn ?? "—"} />
        <Row label={STR.spRoll} value={header.rollNumber ? bnNum(header.rollNumber) : "—"} />
        <Row label={STR.spClassTeacher} value={header.classTeacherName ?? "—"} />
      </Card>
      <Card style={{ gap: space(1) }}>
        <SectionTitle title={STR.guardians} />
        {header.guardians.length === 0 ? <Muted>{STR.noGuardians}</Muted> : null}
        {header.guardians.map((g) => (
          <Pressable
            key={g.guardianId}
            disabled={!g.phone}
            onPress={() => g.phone && Linking.openURL(`tel:${g.phone}`)}
            style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: space(2), gap: 2 }}
          >
            <Body style={{ fontWeight: "600" }}>
              {g.name}
              <Muted>
                {" "}
                · {relationLabel(g.relation)}
                {g.primary ? ` · ${STR.spPrimaryGuardian}` : ""}
              </Muted>
            </Body>
            {g.phone ? <Body style={{ color: colors.info }}>📞 {g.phone}</Body> : null}
          </Pressable>
        ))}
      </Card>
    </View>
  );
}
