/**
 * Guardian-engagement operations (GE-1..GE-3, D-#464/#465).
 * - RECORD_GUARDIAN_VIEW: guardian-side, fire-and-forget telemetry (guardian:read_child).
 * - GUARDIAN_ENGAGEMENT_QUERY: Principal-side report (audit:read).
 */
import { gql } from "urql";

export const RECORD_GUARDIAN_VIEW = gql<
  { recordGuardianView: boolean },
  { surface: string; studentId?: string | null; refId?: string | null }
>`
  mutation RecordGuardianView($surface: String!, $studentId: String, $refId: String) {
    recordGuardianView(surface: $surface, studentId: $studentId, refId: $refId)
  }
`;

export interface EngagementSummaryT {
  totalGuardians: number;
  loginEnabled: number;
  contactOnly: number;
  everLoggedIn: number;
  neverLoggedIn: number;
  studentsTotal: number;
  studentsReachable: number;
  studentsUnreachable: number;
  studentsNoCredentials: number;
  excludedNonDesignated: number;
  excludedButLoginEnabled: number;
  active7: number;
  active30: number;
  active90: number;
  regular: number;
  occasional: number;
  lapsed: number;
  notificationsDelivered: number;
  notificationsRead: number;
  viewsRecorded: number;
  viewsSince: string | null;
  windowDays: number;
}

export interface EngagementGuardianRowT {
  guardianId: string;
  name: string;
  phone: string | null;
  loginEnabled: boolean;
  childNames: string[];
  sectionNames: string[];
  band: string;
  lastLoginAt: string | null;
  loginCount: number;
  activeDays: number;
  notificationsDelivered: number;
  notificationsRead: number;
  viewCount: number;
  lastViewAt: string | null;
  topSurfaces: string[];
}

export interface SurfaceUsageT {
  surface: string;
  views: number;
  distinctGuardians: number;
  lastAt: string | null;
}

export interface InboxKindStatT {
  kind: string;
  delivered: number;
  read: number;
}

export interface GuardianEngagementT {
  summary: EngagementSummaryT;
  guardians: EngagementGuardianRowT[];
  surfaces: SurfaceUsageT[];
  inboxByKind: InboxKindStatT[];
  generatedAt: string;
}

export const GUARDIAN_ENGAGEMENT_QUERY = gql<
  { guardianEngagement: GuardianEngagementT },
  { days?: number | null; sectionId?: string | null; band?: string | null }
>`
  query GuardianEngagement($days: Int, $sectionId: String, $band: String) {
    guardianEngagement(days: $days, sectionId: $sectionId, band: $band) {
      summary {
        totalGuardians loginEnabled contactOnly everLoggedIn neverLoggedIn
        active7 active30 active90 regular occasional lapsed
        studentsTotal studentsReachable studentsUnreachable studentsNoCredentials
        excludedNonDesignated excludedButLoginEnabled
        notificationsDelivered notificationsRead viewsRecorded viewsSince windowDays
      }
      guardians {
        guardianId name phone loginEnabled childNames sectionNames band
        lastLoginAt loginCount activeDays notificationsDelivered notificationsRead
        viewCount lastViewAt topSurfaces
      }
      surfaces { surface views distinctGuardians lastAt }
      inboxByKind { kind delivered read }
      generatedAt
    }
  }
`;
