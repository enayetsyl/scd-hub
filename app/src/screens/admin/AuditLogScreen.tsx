/**
 * AuditLogScreen (owner ask 2026-07-20) — the Principal's in-app window onto the
 * append-only audit log (ADR-008). Newest first; server-side role/kind filters;
 * client-side text search over the loaded rows; "load more" pages older rows by
 * the eventAt cursor. Read-only by construction — the API exposes no mutation.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View, RefreshControl, Pressable } from "react-native";
import { useClient, useQuery } from "urql";
import { ROLES } from "@scd/shared";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AdminStackParamList } from "../../navigation/types";
import { AUDIT_LOG_QUERY, type AuditRowT } from "../../graphql/audit";
import { Screen, H2, Body, Muted, Card, Badge, Button, Field, Select, Loader, EmptyState, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { DateField } from "../../components/DateField";
import { STR, bnNum, isoDateTimeLabel, getActiveLang, dhakaDateKey } from "../../lib/labels";
import { space } from "../../theme/tokens";

const PAGE = 50;

type Props = NativeStackScreenProps<AdminStackParamList, "AuditLog">;

function roleTone(role: string | null): "brand" | "info" | "warn" | "muted" {
  if (role === "PRINCIPAL") return "brand";
  if (role === "TEACHER") return "info";
  if (role === "OFFICE") return "warn";
  return "muted";
}

/** Compact meta rendering: {"a":1,"b":"x"} → a: 1 · b: x */
function metaSummary(metaJson: string | null): string {
  if (!metaJson) return "";
  try {
    const m = JSON.parse(metaJson) as Record<string, unknown>;
    return Object.entries(m)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" · ");
  } catch {
    return metaJson;
  }
}

export default function AuditLogScreen({ navigation }: Props): React.ReactElement {
  const [roleFilter, setRoleFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [search, setSearch] = useState("");
  // The window is server-side (AL-1, D-#645); "" on both ends means "no window",
  // which is the behaviour this screen has always had.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const lang = getActiveLang();
  // Older pages accumulate here; the newest page always comes from the live query
  // (so pull-to-refresh naturally resets the window).
  const [olderRows, setOlderRows] = useState<AuditRowT[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const [q, refetch] = useQuery({
    query: AUDIT_LOG_QUERY,
    variables: {
      limit: PAGE,
      eventKind: kindFilter === "" ? null : kindFilter,
      actorRole: roleFilter === "" ? null : roleFilter,
      from: from === "" ? null : from,
      to: to === "" ? null : to,
    },
  });

  const liveRows = q.data?.auditLog ?? [];
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: AuditRowT[] = [];
    for (const r of [...liveRows, ...olderRows]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    const needle = search.trim().toLowerCase();
    if (needle === "") return out;
    return out.filter((r) =>
      [
        r.eventKind,
        r.labelBn,
        r.labelEn,
        r.actorName ?? "",
        r.actorRole ?? "",
        r.targetKind ?? "",
        r.metaJson ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [liveRows, olderRows, search]);

  // Kind options from what's on screen — enough to narrow without a 60-entry list.
  const kindOptions = useMemo(() => {
    // Name each kind the way the rows now do, keeping the raw code as the search
    // hint so a reader who knows the code can still type it (AL-1, D-#645).
    const byKind = new Map<string, string>();
    for (const r of [...liveRows, ...olderRows]) {
      byKind.set(r.eventKind, lang === "en" ? r.labelEn : r.labelBn);
    }
    if (kindFilter && !byKind.has(kindFilter)) byKind.set(kindFilter, kindFilter);
    const opts = [...byKind.entries()]
      .map(([value, label]) => ({ label, value, hint: value }))
      .sort((a, b) => a.label.localeCompare(b.label, "bn"));
    return [{ label: STR.all, value: "", hint: "" }, ...opts];
  }, [liveRows, olderRows, kindFilter, lang]);

  const oldest = rows.length > 0 ? rows[rows.length - 1].eventAt : null;

  // urql's useQuery re-runs on variable change; load-more is a direct client
  // query so the visible list keeps both the live page and the older pages.
  const client = useClient();
  async function onLoadMore(): Promise<void> {
    if (!oldest || loadingMore) return;
    setLoadingMore(true);
    const r = await client
      .query(AUDIT_LOG_QUERY, {
        before: oldest,
        limit: PAGE,
        eventKind: kindFilter === "" ? null : kindFilter,
        actorRole: roleFilter === "" ? null : roleFilter,
        from: from === "" ? null : from,
        to: to === "" ? null : to,
      })
      .toPromise();
    setLoadingMore(false);
    const page = r.data?.auditLog ?? [];
    if (page.length > 0) setOlderRows((prev) => [...prev, ...page]);
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={
          <RefreshControl
            refreshing={q.fetching}
            onRefresh={() => {
              setOlderRows([]);
              refetch({ requestPolicy: "network-only" });
            }}
          />
        }
      >
        <H2>{STR.audTitle}</H2>
        <Notice message={STR.audHint} tone="info" />

        <Select
          label={STR.audFilterRole}
          value={roleFilter === "" ? null : roleFilter}
          options={[{ label: STR.all, value: "" }, ...ROLES.map((r) => ({ label: r, value: r }))]}
          onChange={(v) => {
            setOlderRows([]);
            setRoleFilter(v);
          }}
          placeholder={STR.all}
        />
        <Select
          label={STR.audFilterKind}
          value={kindFilter === "" ? null : kindFilter}
          options={kindOptions}
          onChange={(v) => {
            setOlderRows([]);
            setKindFilter(v);
          }}
          placeholder={STR.all}
          searchable
        />
        <View style={{ flexDirection: "row", gap: space(3) }}>
          <View style={{ flex: 1 }}>
            <DateField
              label={STR.actFrom}
              value={from}
              onChange={(v) => {
                setOlderRows([]);
                setFrom(v);
                // An open-ended window would page back to the beginning of time;
                // closing it at today is what the reader means by "since".
                if (to === "") setTo(dhakaDateKey());
              }}
              max={to === "" ? undefined : to}
            />
          </View>
          <View style={{ flex: 1 }}>
            <DateField
              label={STR.actTo}
              value={to}
              onChange={(v) => {
                setOlderRows([]);
                setTo(v);
              }}
              min={from === "" ? undefined : from}
            />
          </View>
        </View>
        <Field label={STR.audSearch} value={search} onChangeText={setSearch} />

        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {rows.length === 0 ? (
            <EmptyState message={STR.audNoRows} />
          ) : (
            <>
              {rows.map((r) => (
                <Card key={r.id}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Badge text={lang === "en" ? r.labelEn : r.labelBn} tone="muted" />
                    <Muted>{isoDateTimeLabel(r.eventAt)}</Muted>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(1) }}>
                    {/* AL-1: the name opens that person's own timeline. A system
                        row has no actor, so there is nothing to open. */}
                    {r.actorId ? (
                      <Pressable
                        onPress={() =>
                          navigation.navigate("PersonActivity", {
                            personId: r.actorId as string,
                          })
                        }
                        hitSlop={8}
                        accessibilityLabel={STR.actOpenTimeline}
                        style={{ flexShrink: 1 }}
                      >
                        <Body style={{ fontWeight: "700", textDecorationLine: "underline" }}>
                          {r.actorName ?? r.actorId}
                        </Body>
                      </Pressable>
                    ) : (
                      <Body style={{ fontWeight: "700", flexShrink: 1 }}>{STR.audSystem}</Body>
                    )}
                    {r.actorRole ? <Badge text={r.actorRole} tone={roleTone(r.actorRole)} /> : null}
                    {/* A row written inside a View-as session names the Principal above,
                        and the account they acted through here (D-#638). */}
                    {r.onBehalfOfId ? (
                      <Muted>
                        {STR.audOnBehalfOf} {r.onBehalfOfName ?? r.onBehalfOfId}
                      </Muted>
                    ) : null}
                    {r.targetKind ? <Muted>→ {r.targetKind}</Muted> : null}
                  </View>
                  {r.metaJson ? <Muted style={{ marginTop: 2 }}>{metaSummary(r.metaJson)}</Muted> : null}
                </Card>
              ))}
              <View style={{ marginTop: space(2) }}>
                {loadingMore ? (
                  <Loader label={STR.loading} />
                ) : (
                  <Button title={`${STR.audLoadMore} (${bnNum(rows.length)})`} variant="secondary" onPress={() => void onLoadMore()} />
                )}
              </View>
            </>
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
