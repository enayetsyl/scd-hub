/**
 * GuardianEngagementScreen (GE-1/GE-3, D-#464/#465) — the Principal's read on whether
 * families actually use the portal.
 *
 * Three tabs because the three signals fail independently and must not be averaged into
 * one number: পরিবার (who logs in), পর্দা (what they open), বিজ্ঞপ্তি (what was sent vs
 * opened). Families are listed LEAST-ENGAGED FIRST — the screen's job is to produce a
 * chase list, so the rows needing action are at the top.
 *
 * Two honesty rules the screen enforces, because a zero here is ambiguous and the wrong
 * reading costs real decisions:
 *   - no view data yet → say so explicitly, never render an empty chart as disengagement;
 *   - contact-only guardians → shown as their own count, never folded into "never
 *     logged in", which is an onboarding problem with a different fix.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import { useQuery } from "urql";
import {
  GUARDIAN_ENGAGEMENT_BANDS,
  GUARDIAN_ENGAGEMENT_BAND_LABELS_BN,
  GUARDIAN_VIEW_SURFACE_LABELS_BN,
} from "@scd/shared";
import type { GuardianEngagementBand, GuardianViewSurface } from "@scd/shared";
import {
  GUARDIAN_ENGAGEMENT_QUERY,
  type EngagementGuardianRowT,
  type EngagementSummaryT,
} from "../../graphql/engagement";
import {
  Screen, H2, Body, Muted, Card, Badge, Field, Select, EmptyState, Notice, Chip, ChipRow, Divider,
} from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, isoDateTimeLabel, notificationKindLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";

type Tab = "FAMILIES" | "SCREENS" | "INBOX";

function bandTone(band: string): "brand" | "info" | "warn" | "muted" {
  if (band === "REGULAR") return "brand";
  if (band === "OCCASIONAL") return "info";
  if (band === "LAPSED") return "warn";
  return "muted"; // NEVER
}

function bandLabel(band: string): string {
  return GUARDIAN_ENGAGEMENT_BAND_LABELS_BN[band as GuardianEngagementBand] ?? band;
}

function surfaceLabel(surface: string): string {
  return GUARDIAN_VIEW_SURFACE_LABELS_BN[surface as GuardianViewSurface] ?? surface;
}

/** One figure. Kept flat and text-only — this screen is read on a phone in a corridor. */
function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={{ minWidth: 140, flexGrow: 1, paddingVertical: space(1) }}>
      <Body style={{ fontWeight: "700", fontSize: 20 }}>{value}</Body>
      <Muted>{label}</Muted>
    </View>
  );
}

function SummaryCard({ s }: { s: EngagementSummaryT }): React.ReactElement {
  const readPct = s.notificationsDelivered > 0
    ? Math.round((s.notificationsRead / s.notificationsDelivered) * 100)
    : 0;
  return (
    <Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3) }}>
        <Stat label={STR.geTotalGuardians} value={bnNum(s.totalGuardians)} />
        <Stat label={STR.geLoginEnabled} value={bnNum(s.loginEnabled)} />
        <Stat label={STR.geEverLoggedIn} value={bnNum(s.everLoggedIn)} />
        <Stat label={STR.geNeverLoggedIn} value={bnNum(s.neverLoggedIn)} />
        <Stat label={STR.geActive7} value={bnNum(s.active7)} />
        <Stat label={STR.geActive30} value={bnNum(s.active30)} />
        <Stat label={STR.geRegular} value={bnNum(s.regular)} />
        <Stat label={STR.geLapsed} value={bnNum(s.lapsed)} />
        <Stat label={STR.geContactOnly} value={bnNum(s.contactOnly)} />
        <Stat label={`${STR.geRead} / ${STR.geDelivered}`} value={`${bnNum(readPct)}%`} />
      </View>
      {s.contactOnly > 0 ? <Muted style={{ marginTop: space(2) }}>{STR.geContactOnlyNote}</Muted> : null}
    </Card>
  );
}

function GuardianCard({ r }: { r: EngagementGuardianRowT }): React.ReactElement {
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
        <Body style={{ fontWeight: "700", flexShrink: 1 }}>{r.name}</Body>
        <Badge text={bandLabel(r.band)} tone={bandTone(r.band)} />
      </View>
      {r.childNames.length > 0 ? (
        <Muted>
          {r.childNames.join(", ")}
          {r.sectionNames.length > 0 ? ` · ${r.sectionNames.join(", ")}` : ""}
        </Muted>
      ) : null}
      {!r.loginEnabled ? <Muted>{STR.geContactOnly}</Muted> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3), marginTop: space(1) }}>
        <Muted>
          {STR.geLastLogin}: {r.lastLoginAt ? isoDateTimeLabel(r.lastLoginAt) : STR.geNever}
        </Muted>
        <Muted>
          {STR.geActiveDays}: {bnNum(r.activeDays)}
        </Muted>
        <Muted>
          {STR.geViews}: {bnNum(r.viewCount)}
        </Muted>
        <Muted>
          {STR.geRead}: {bnNum(r.notificationsRead)}/{bnNum(r.notificationsDelivered)}
        </Muted>
      </View>
      {r.topSurfaces.length > 0 ? (
        <Muted style={{ marginTop: 2 }}>{r.topSurfaces.map(surfaceLabel).join(" · ")}</Muted>
      ) : null}
      {r.phone ? <Muted style={{ marginTop: 2 }}>{bnNum(r.phone)}</Muted> : null}
    </Card>
  );
}

export default function GuardianEngagementScreen(): React.ReactElement {
  const [tab, setTab] = useState<Tab>("FAMILIES");
  const [days, setDays] = useState("90");
  const [band, setBand] = useState("");
  const [section, setSection] = useState("");
  const [search, setSearch] = useState("");

  const [q, refetch] = useQuery({
    query: GUARDIAN_ENGAGEMENT_QUERY,
    variables: { days: Number(days), band: band === "" ? null : band },
  });

  const report = q.data?.guardianEngagement;
  const allRows = report?.guardians ?? [];

  // Section options come from the rows themselves — the report already carries every
  // section name in play, so the filter needs no second round-trip to the roster.
  const sectionOptions = useMemo(() => {
    const names = [...new Set(allRows.flatMap((r) => r.sectionNames))].sort();
    return [{ label: STR.all, value: "" }, ...names.map((n) => ({ label: n, value: n }))];
  }, [allRows]);

  const rows = useMemo(() => {
    let out = allRows;
    if (section !== "") out = out.filter((r) => r.sectionNames.includes(section));
    const needle = search.trim().toLowerCase();
    if (needle !== "") {
      out = out.filter((r) =>
        [r.name, r.phone ?? "", ...r.childNames, ...r.sectionNames]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    }
    return out;
  }, [allRows, section, search]);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={
          <RefreshControl refreshing={q.fetching} onRefresh={() => refetch({ requestPolicy: "network-only" })} />
        }
      >
        <H2>{STR.geTitle}</H2>
        <Notice message={STR.geHint} tone="info" />

        <Select
          label={STR.geWindow}
          value={days}
          options={[
            { label: STR.geDays30, value: "30" },
            { label: STR.geDays90, value: "90" },
            { label: STR.geDays365, value: "365" },
          ]}
          onChange={setDays}
        />

        <ChipRow>
          <Chip label={STR.geTabFamilies} selected={tab === "FAMILIES"} onPress={() => setTab("FAMILIES")} />
          <Chip label={STR.geTabScreens} selected={tab === "SCREENS"} onPress={() => setTab("SCREENS")} />
          <Chip label={STR.geTabInbox} selected={tab === "INBOX"} onPress={() => setTab("INBOX")} />
        </ChipRow>

        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {!report ? (
            <EmptyState message={STR.geNoRows} />
          ) : (
            <>
              <SummaryCard s={report.summary} />

              {tab === "FAMILIES" ? (
                <>
                  <Select
                    label={STR.geFilterBand}
                    value={band === "" ? null : band}
                    options={[
                      { label: STR.all, value: "" },
                      ...GUARDIAN_ENGAGEMENT_BANDS.map((b) => ({ label: bandLabel(b), value: b })),
                    ]}
                    onChange={setBand}
                    placeholder={STR.all}
                  />
                  <Select
                    label={STR.geFilterSection}
                    value={section === "" ? null : section}
                    options={sectionOptions}
                    onChange={setSection}
                    placeholder={STR.all}
                  />
                  <Field label={STR.geSearch} value={search} onChangeText={setSearch} />
                  {rows.length === 0 ? (
                    <EmptyState message={STR.geNoRows} />
                  ) : (
                    rows.map((r) => <GuardianCard key={r.guardianId} r={r} />)
                  )}
                </>
              ) : null}

              {tab === "SCREENS" ? (
                <>
                  {/* A zero here means "not measured yet", NOT "nobody looked" — the two
                      lead to opposite decisions, so the screen never lets them blur. */}
                  {report.summary.viewsSince === null ? (
                    <Notice message={STR.geNoViewData} tone="warn" />
                  ) : (
                    <Muted style={{ marginBottom: space(2) }}>
                      {STR.geHint} ({isoDateTimeLabel(report.summary.viewsSince)})
                    </Muted>
                  )}
                  {report.surfaces.map((s) => (
                    <Card key={s.surface}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Body style={{ fontWeight: "700" }}>{surfaceLabel(s.surface)}</Body>
                        <Body style={{ fontWeight: "700" }}>{bnNum(s.views)}</Body>
                      </View>
                      <Muted>
                        {STR.geDistinctGuardians}: {bnNum(s.distinctGuardians)}
                        {s.lastAt ? ` · ${STR.geLastSeen}: ${isoDateTimeLabel(s.lastAt)}` : ""}
                      </Muted>
                    </Card>
                  ))}
                </>
              ) : null}

              {tab === "INBOX" ? (
                <>
                  <Notice message={STR.geReadCaveat} tone="info" />
                  {report.inboxByKind.length === 0 ? (
                    <EmptyState message={STR.geNoRows} />
                  ) : (
                    report.inboxByKind.map((k) => (
                      <Card key={k.kind}>
                        <Body style={{ fontWeight: "700" }}>{notificationKindLabel(k.kind)}</Body>
                        <Divider />
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3) }}>
                          <Muted>
                            {STR.geDelivered}: {bnNum(k.delivered)}
                          </Muted>
                          <Muted>
                            {STR.geRead}: {bnNum(k.read)}
                          </Muted>
                          <Muted>
                            {STR.geUnread}: {bnNum(k.delivered - k.read)}
                          </Muted>
                        </View>
                      </Card>
                    ))
                  )}
                </>
              ) : null}
            </>
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
