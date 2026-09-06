/**
 * Person-activity operations (AL-1, D-#645) — Principal-only read (audit:read)
 * over one named person's complete recorded activity: audit events plus the
 * homework/assignment tracker passes the audit log never carried.
 *
 * The row LABELS come from the server, not from a map in `labels.ts`: they are
 * typed exhaustively against the `AuditEventKind` union over there, so a new
 * event kind cannot ship without a Bangla name. An app-side mirror would have
 * no such guarantee.
 */
import { gql } from "urql";

export interface ActivityPersonT {
  id: string;
  name: string;
  role: string;
  kind: string; // "STAFF" | "GUARDIAN"
  active: boolean;
}

export interface ActivityRowT {
  id: string;
  source: string; // "AUDIT" | "HOMEWORK" | "ASSIGNMENT"
  at: string;
  firstAt: string | null;
  day: string;
  kind: string;
  labelBn: string;
  labelEn: string;
  group: string;
  count: number;
  targetKind: string | null;
  targetId: string | null;
  targetLabel: string | null;
  /** AL-2: where the work was, resolved from the item. */
  subject: string | null;
  classLevel: number | null;
  sectionName: string | null;
  itemDate: string | null;
  metaJson: string | null;
  viaViewAs: boolean;
}

export interface ActivityStudentT {
  id: string;
  name: string;
  rollNumber: string | null;
  at: string;
}

export interface ActivityRowDetailT {
  rowId: string;
  source: string;
  itemCode: string | null;
  subject: string | null;
  classLevel: number | null;
  sectionName: string | null;
  itemDate: string | null;
  dueDate: string | null;
  description: string | null;
  targetLabel: string | null;
  targetKind: string | null;
  metaJson: string | null;
  students: ActivityStudentT[];
  studentsTruncated: boolean;
}

export interface ActivityDayT {
  day: string;
  audit: number;
  homework: number;
  assignment: number;
  total: number;
}

export interface ActivityGroupT {
  value: string;
  labelBn: string;
  labelEn: string;
}

export const ACTIVITY_PEOPLE_QUERY = gql<
  { activityPeople: ActivityPersonT[] },
  { search?: string | null; limit?: number | null }
>`
  query ActivityPeople($search: String, $limit: Int) {
    activityPeople(search: $search, limit: $limit) {
      id name role kind active
    }
  }
`;

export const ACTIVITY_PERSON_QUERY = gql<
  { activityPerson: ActivityPersonT | null },
  { personId: string }
>`
  query ActivityPerson($personId: String!) {
    activityPerson(personId: $personId) {
      id name role kind active
    }
  }
`;

export const ACTIVITY_GROUPS_QUERY = gql<{ activityGroups: ActivityGroupT[] }, Record<string, never>>`
  query ActivityGroups {
    activityGroups {
      value labelBn labelEn
    }
  }
`;

export const PERSON_ACTIVITY_QUERY = gql<
  { personActivity: { rows: ActivityRowT[]; truncated: boolean } },
  {
    personId: string;
    from: string;
    to: string;
    group?: string | null;
    source?: string | null;
    limit?: number | null;
  }
>`
  query PersonActivity(
    $personId: String!
    $from: String!
    $to: String!
    $group: String
    $source: String
    $limit: Int
  ) {
    personActivity(
      personId: $personId
      from: $from
      to: $to
      group: $group
      source: $source
      limit: $limit
    ) {
      truncated
      rows {
        id source at firstAt day kind labelBn labelEn group count
        targetKind targetId targetLabel subject classLevel sectionName itemDate
        metaJson viaViewAs
      }
    }
  }
`;

export const PERSON_ACTIVITY_DAYS_QUERY = gql<
  { personActivityDays: ActivityDayT[] },
  { personId: string; from: string; to: string }
>`
  query PersonActivityDays($personId: String!, $from: String!, $to: String!) {
    personActivityDays(personId: $personId, from: $from, to: $to) {
      day audit homework assignment total
    }
  }
`;

export const ACTIVITY_ROW_DETAIL_QUERY = gql<
  { activityRowDetail: ActivityRowDetailT | null },
  { personId: string; rowId: string }
>`
  query ActivityRowDetail($personId: String!, $rowId: String!) {
    activityRowDetail(personId: $personId, rowId: $rowId) {
      rowId source itemCode subject classLevel sectionName itemDate dueDate
      description targetLabel targetKind metaJson studentsTruncated
      students { id name rollNumber at }
    }
  }
`;
