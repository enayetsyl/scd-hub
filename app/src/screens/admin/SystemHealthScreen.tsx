/**
 * SystemHealthScreen (SH-1..SH-3, D-#414) — "are we still inside the free tiers?"
 *
 * The Principal is the person who decides to prune, archive, or start paying, and until
 * now nothing in the app told them a ceiling was approaching: the first symptom of a full
 * Atlas cluster is writes failing. Three cards, each a used/limit bar with a band.
 *
 * Every section renders whatever it has. A section that failed shows its own reason and
 * the others still display — a health screen that blanks out when one probe dies hides
 * exactly the numbers that were fine.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import {
  SYSTEM_HEALTH_QUERY,
  type CollectionUsageT,
  type DatabaseUsageT,
  type SystemHealthT,
} from "../../graphql/systemHealth";
import { TrendSparkline } from "../../components/TrendSparkline";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Loader, ErrorBanner, Notice } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space, radius } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "SystemHealth">;

/** Bytes in the unit a person reads at a glance — MB below a gigabyte, GB above. */
function bytesLabel(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1024 ** 3) return `${bnNum((n / 1024 ** 3).toFixed(2))} GB`;
  if (n >= 1024 ** 2) return `${bnNum((n / 1024 ** 2).toFixed(1))} MB`;
  return `${bnNum((n / 1024).toFixed(0))} KB`;
}

function pct(used: number, limit: number | null): number | null {
  if (!limit || limit <= 0) return null;
  return Math.min(100, (used / limit) * 100);
}

const bandLabel = (band: string): string =>
  band === "critical" ? STR.shBandCritical
  : band === "warn" ? STR.shBandWarn
  : band === "ok" ? STR.shBandOk
  : STR.shBandUnknown;

const bandTone = (band: string): "danger" | "warn" | "ok" | "muted" =>
  band === "critical" ? "danger" : band === "warn" ? "warn" : band === "ok" ? "ok" : "muted";

/** The used/limit bar. Width is a percentage string so it tracks the card, and the fill
 *  colour comes from the SERVER's band — one place decides what "too full" means. */
function UsageBar({ ratio, band }: { ratio: number | null; band: string }): React.ReactElement {
  const colors = useColors();
  const fill =
    band === "critical" ? colors.error : band === "warn" ? colors.warning : colors.primary;
  return (
    <View
      style={{
        height: 10,
        borderRadius: radius.sm,
        backgroundColor: colors.surfaceAlt,
        overflow: "hidden",
        marginTop: space(2),
      }}
    >
      <View
        style={{
          height: "100%",
          // A measurable-but-not-yet-visible sliver still reads as "something is there".
          width: `${ratio === null ? 0 : Math.max(ratio, 1)}%`,
          backgroundColor: fill,
        }}
      />
    </View>
  );
}

/**
 * The projection in one sentence. Says "not enough days" or "not growing" rather than
 * dressing a meaningless fit as a date — a confident wrong forecast is worse here than
 * an admission, because it is the line the Principal would actually plan against.
 */
function projectionLine(p: SystemHealthT["projection"]): string {
  if (p.points < 3) return STR.shProjectionThin;
  if (p.bytesPerDay === null || p.bytesPerDay <= 0) return STR.shProjectionFlat;
  const perDay = `${STR.shProjectionPerDay}: ${bytesLabel(p.bytesPerDay)}`;
  if (p.daysToLimit === null || !p.limitDateKey) return perDay;
  return `${STR.shProjection} ${STR.shProjectionFull} ${p.limitDateKey} · ${perDay}`;
}

function SectionHeader({ title, band }: { title: string; band: string }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) }}>
      <Body style={{ fontWeight: "700", flexShrink: 1 }}>{title}</Body>
      <Badge text={bandLabel(band)} tone={bandTone(band)} />
    </View>
  );
}

export default function SystemHealthScreen(_props: Props): React.ReactElement {
  const [q, refetch] = useQuery({ query: SYSTEM_HEALTH_QUERY, requestPolicy: "cache-and-network" });
  const h = q.data?.systemHealth;

  if (q.fetching && !h) return <Screen><Loader label={STR.loading} /></Screen>;
  if (q.error && !h) {
    return (
      <Screen>
        <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      </Screen>
    );
  }
  if (!h) return <Screen><Muted>{STR.shUnavailable}</Muted></Screen>;

  const dbPct = pct(h.mongo.totalStorageBytes, h.mongo.limitBytes);
  const diskUsed =
    h.host.diskTotalBytes !== null && h.host.diskFreeBytes !== null
      ? h.host.diskTotalBytes - h.host.diskFreeBytes
      : null;
  const diskPct = diskUsed === null ? null : pct(diskUsed, h.host.diskTotalBytes);
  const memUsed = h.host.memTotalBytes - h.host.memFreeBytes;
  const egressPct =
    h.host.egressMonthBytes === null ? null : pct(h.host.egressMonthBytes, h.host.egressLimitBytes);
  const drivePct =
    h.drive.usageBytes === null ? null : pct(h.drive.usageBytes, h.drive.limitBytes);

  return (
    <Screen scroll>
      <H2>{STR.shTitle}</H2>
      <Muted>{STR.shSubtitle}</Muted>

      {/* ---------------- Database: the ceiling that actually binds ---------------- */}
      <Card>
        <SectionHeader title={STR.shDatabase} band={h.mongo.band} />
        <Body style={{ marginTop: space(1) }}>
          {bytesLabel(h.mongo.totalStorageBytes)} {STR.shUsedOf} {bytesLabel(h.mongo.limitBytes)}
          {dbPct !== null ? ` · ${bnNum(dbPct.toFixed(1))}%` : ""}
        </Body>
        <UsageBar ratio={dbPct} band={h.mongo.band} />
        {/* The cap is cluster-wide, so a total that silently omitted the test copies
            would read as far more headroom than the school actually has. */}
        {!h.mongo.clusterWide ? <Notice message={STR.shNotClusterWide} tone="warn" /> : null}
        {h.mongo.error ? <Muted style={{ marginTop: space(1) }}>{h.mongo.error}</Muted> : null}

        {/* SH-4 — the trend. A percentage answers "how full"; only the direction answers
            "how long have we got", which is the question that drives a decision. */}
        {h.history.length > 0 ? (
          <View style={{ marginTop: space(3) }}>
            <Muted>{STR.shTrend}</Muted>
            <TrendSparkline
              points={h.history.map((p) => ({
                dateKey: p.dateKey,
                value: p.dbStorageBytes,
                estimated: p.estimated,
              }))}
              limit={h.mongo.limitBytes}
              accessibilityLabel={`${STR.shTrend}: ${bytesLabel(h.history[0]?.dbStorageBytes)} → ${bytesLabel(
                h.history[h.history.length - 1]?.dbStorageBytes,
              )}`}
            />
            {h.history.some((p) => p.estimated) ? <Muted>{STR.shTrendEstimated}</Muted> : null}
            <Muted style={{ marginTop: space(1) }}>{projectionLine(h.projection)}</Muted>
          </View>
        ) : null}

        {h.mongo.databases.length > 0 ? (
          <View style={{ marginTop: space(3) }}>
            <Muted>{STR.shDatabases}</Muted>
            {h.mongo.databases.map((d: DatabaseUsageT) => (
              <View
                key={d.name}
                style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), marginTop: space(1) }}
              >
                <Muted style={{ flexShrink: 1 }}>
                  {d.name}
                  {d.isCurrent ? ` · ${STR.shCurrentDb}` : ""}
                </Muted>
                <Muted>{bytesLabel(d.storageBytes)}</Muted>
              </View>
            ))}
          </View>
        ) : null}

        {h.mongo.topCollections.length > 0 ? (
          <View style={{ marginTop: space(3) }}>
            <Muted>{STR.shTopCollections}</Muted>
            {h.mongo.topCollections.map((c: CollectionUsageT) => (
              <View
                key={c.name}
                style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), marginTop: space(1) }}
              >
                <Muted style={{ flexShrink: 1 }}>{c.name}</Muted>
                <Muted>
                  {bytesLabel(c.storageSizeBytes)} · {bnNum(c.docCount)} {STR.shDocs}
                </Muted>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      {/* ---------------- The VM ---------------- */}
      <Card>
        <SectionHeader title={STR.shServer} band={h.host.diskBand} />
        <Body style={{ marginTop: space(1) }}>
          {STR.shDisk}: {bytesLabel(diskUsed)} {STR.shUsedOf} {bytesLabel(h.host.diskTotalBytes)}
          {diskPct !== null ? ` · ${bnNum(diskPct.toFixed(1))}%` : ""}
        </Body>
        <UsageBar ratio={diskPct} band={h.host.diskBand} />
        <Muted style={{ marginTop: space(2) }}>
          {STR.shMemory}: {bytesLabel(memUsed)} / {bytesLabel(h.host.memTotalBytes)}
          {" · "}
          {STR.shLoad}: {bnNum(h.host.load1.toFixed(2))} ({bnNum(h.host.cpuCount)} CPU)
          {" · "}
          {STR.shUptime}: {bnNum((h.host.uptimeSec / 3600).toFixed(1))} {STR.shHours}
        </Muted>

        <View style={{ marginTop: space(3) }}>
          <Body>
            {STR.shEgress}: {h.host.egressMonthBytes === null ? "—" : bytesLabel(h.host.egressMonthBytes)}
            {egressPct !== null ? ` · ${bnNum(egressPct.toFixed(2))}%` : ""}
          </Body>
          {h.host.egressMonthBytes === null ? (
            // One reading cannot be a delta, so the first day after deploy has nothing
            // to show — say why rather than render a bare dash.
            <Muted>{STR.shEgressPending}</Muted>
          ) : (
            <UsageBar ratio={egressPct} band={h.host.egressBand} />
          )}
          {h.host.egressPartial ? <Muted>{STR.shEgressPartial}</Muted> : null}
        </View>
        {h.host.error ? <Muted style={{ marginTop: space(1) }}>{h.host.error}</Muted> : null}
      </Card>

      {/* ---------------- Drive ---------------- */}
      <Card>
        <SectionHeader title={STR.shDrive} band={h.drive.band} />
        <Body style={{ marginTop: space(1) }}>
          {bytesLabel(h.drive.usageBytes)} {STR.shUsedOf} {bytesLabel(h.drive.limitBytes)}
          {drivePct !== null ? ` · ${bnNum(drivePct.toFixed(1))}%` : ""}
        </Body>
        <UsageBar ratio={drivePct} band={h.drive.band} />
        <Muted style={{ marginTop: space(2) }}>{STR.shDriveNote}</Muted>
        {h.drive.error ? <Muted style={{ marginTop: space(1) }}>{h.drive.error}</Muted> : null}
      </Card>

      {/* ---------------- SH-5: the scheduler's pulse ---------------- */}
      <Card>
        <SectionHeader title={STR.shTicker} band={h.ticker.band} />
        <Body style={{ marginTop: space(1) }}>
          {h.ticker.ageSeconds === null
            ? STR.shTickerNever
            : `${STR.shTickerLast}: ${bnNum(h.ticker.ageSeconds)}${STR.shSecondsAgo}`}
        </Body>
        {/* Named in words, not just a red chip: a stalled ticker means no reminders and
            no automatic homework work, and that consequence is not obvious from "60s". */}
        {h.ticker.band === "critical" || h.ticker.band === "warn" ? (
          <Notice message={STR.shTickerStalled} tone={h.ticker.band === "critical" ? "danger" : "warn"} />
        ) : null}
      </Card>

      {/* ---------------- SH-7: the restore point ---------------- */}
      <Card>
        <SectionHeader
          title={STR.shBackup}
          band={
            !h.backup.enabled || h.backup.ageDays === null
              ? "critical"
              : h.backup.ageDays > 14
                ? "warn"
                : "ok"
          }
        />
        {!h.backup.enabled ? (
          // The honest headline: Atlas M0 has no automated backups, so "off" is not a
          // preference, it is the absence of any way back.
          <Notice message={STR.shBackupOff} tone="danger" />
        ) : h.backup.ageDays === null ? (
          <Notice message={STR.shBackupNever} tone="danger" />
        ) : (
          <Body style={{ marginTop: space(1) }}>
            {STR.shBackupLast}: {bnNum(h.backup.ageDays)} {STR.shBackupDaysAgo}
            {h.backup.lastSizeBytes ? ` · ${bytesLabel(h.backup.lastSizeBytes)}` : ""}
          </Body>
        )}
        {h.backup.lastOk === false && h.backup.lastError ? (
          <Muted style={{ marginTop: space(1) }}>
            {STR.shBackupFailed}: {h.backup.lastError}
          </Muted>
        ) : null}
      </Card>

      {/* ---------------- SH-6: the lever, quantified ---------------- */}
      {h.prunable.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.shPrunable}</Body>
          {h.prunable.map((p) => (
            <View
              key={p.collection}
              style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), marginTop: space(1) }}
            >
              <Muted style={{ flexShrink: 1 }}>
                {p.collection} · {bnNum(p.olderThanDays)} {STR.shOlderThan}
              </Muted>
              <Muted>
                {bnNum(p.docCount)} · {bytesLabel(p.reclaimableBytes)}
              </Muted>
            </View>
          ))}
          <Muted style={{ marginTop: space(2) }}>{STR.shPrunableNote}</Muted>
        </Card>
      ) : null}

      <Muted>
        {STR.shCheckedAt}: {h.checkedAt.slice(0, 16).replace("T", " ")}
      </Muted>
    </Screen>
  );
}
