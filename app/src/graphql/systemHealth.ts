/**
 * System health (SH-1..SH-3, D-#414) — free-tier headroom for the Principal.
 *
 * Every section carries its own `error` and the query still answers, so the screen
 * renders whatever succeeded instead of failing whole when one probe is unavailable.
 */
import { gql } from "urql";

export interface DatabaseUsageT {
  name: string;
  storageBytes: number;
  dataSizeBytes: number;
  objects: number;
  isCurrent: boolean;
}

export interface CollectionUsageT {
  name: string;
  dataSizeBytes: number;
  storageSizeBytes: number;
  indexSizeBytes: number;
  docCount: number;
}

/** "ok" | "warn" | "critical" | "unknown" — the server decides the band, not the screen. */
export type HealthBandT = string;

export interface SystemHealthT {
  mongo: {
    totalStorageBytes: number;
    limitBytes: number;
    band: HealthBandT;
    databases: DatabaseUsageT[];
    topCollections: CollectionUsageT[];
    clusterWide: boolean;
    error: string | null;
  };
  host: {
    diskTotalBytes: number | null;
    diskFreeBytes: number | null;
    diskBand: HealthBandT;
    memTotalBytes: number;
    memFreeBytes: number;
    load1: number;
    cpuCount: number;
    uptimeSec: number;
    egressMonthBytes: number | null;
    egressLimitBytes: number;
    egressBand: HealthBandT;
    egressPartial: boolean;
    error: string | null;
  };
  drive: {
    usageBytes: number | null;
    usageAllServicesBytes: number | null;
    usageTrashBytes: number | null;
    limitBytes: number | null;
    band: HealthBandT;
    error: string | null;
  };
  /** SH-5: a stalled ticker silently stops every scheduled job in the app. */
  ticker: { lastTickAt: string | null; ageSeconds: number | null; band: HealthBandT };
  /** SH-4: `estimated` days are reconstructed from timestamps — counts exact, bytes derived. */
  history: {
    dateKey: string;
    dbStorageBytes: number | null;
    diskUsedBytes: number | null;
    driveUsageBytes: number | null;
    totalDocs: number;
    estimated: boolean;
  }[];
  projection: {
    bytesPerDay: number | null;
    daysToLimit: number | null;
    limitDateKey: string | null;
    points: number;
    usesEstimates: boolean;
  };
  /** SH-6: report only — nothing in the app deletes these. */
  prunable: {
    collection: string;
    olderThanDays: number;
    reason: string;
    docCount: number;
    reclaimableBytes: number;
  }[];
  /** SH-7: freshness of the school's OWN nightly backup (ADR-011) — the app watches that
   *  folder, it does not write one. Sparse older archives are the 7/4/3 rotation working;
   *  only `ageDays` says whether last night ran. */
  backup: {
    folder: string;
    found: boolean;
    count: number;
    archives: { name: string; createdAt: string; sizeBytes: number | null }[];
    newestName: string | null;
    newestAt: string | null;
    newestSizeBytes: number | null;
    ageDays: number | null;
    totalSizeBytes: number;
    band: HealthBandT;
    error: string | null;
  };
  checkedAt: string;
}

export const SYSTEM_HEALTH_QUERY = gql<{ systemHealth: SystemHealthT }, Record<string, never>>`
  query SystemHealth {
    systemHealth {
      checkedAt
      mongo {
        totalStorageBytes
        limitBytes
        band
        clusterWide
        error
        databases { name storageBytes dataSizeBytes objects isCurrent }
        topCollections { name dataSizeBytes storageSizeBytes indexSizeBytes docCount }
      }
      host {
        diskTotalBytes diskFreeBytes diskBand
        memTotalBytes memFreeBytes load1 cpuCount uptimeSec
        egressMonthBytes egressLimitBytes egressBand egressPartial
        error
      }
      drive { usageBytes usageAllServicesBytes usageTrashBytes limitBytes band error }
      ticker { lastTickAt ageSeconds band }
      history { dateKey dbStorageBytes diskUsedBytes driveUsageBytes totalDocs estimated }
      projection { bytesPerDay daysToLimit limitDateKey points usesEstimates }
      prunable { collection olderThanDays reason docCount reclaimableBytes }
      backup { folder found count archives { name createdAt sizeBytes } newestName newestAt newestSizeBytes ageDays totalSizeBytes band error }
    }
  }
`;
