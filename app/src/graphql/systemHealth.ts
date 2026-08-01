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
    usageInDriveBytes: number | null;
    limitBytes: number | null;
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
      drive { usageBytes usageInDriveBytes limitBytes band error }
    }
  }
`;
