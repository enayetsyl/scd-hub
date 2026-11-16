/**
 * Parents'-meeting results for guardians (D-#1633–#1635): the Principal's publish card and
 * the family's result screen. Hand-authored to mirror server/src/modules/comments/resolvers/
 * meetingRelease.ts. The guardian type has NO teacher-comment field — only the final
 * Principal/Office comment.
 */
import { gql } from "urql";

export interface MeetingReleaseStatusT {
  meetingId: string;
  published: boolean;
  publishedAt: string | null;
  publishedByName: string | null;
  withdrawnAt: string | null;
  notifiedAt: string | null;
  totalChildren: number;
  withFinal: number;
  withoutFinal: number;
  snapshots: number;
}

const STATUS_FIELDS = `meetingId published publishedAt publishedByName withdrawnAt notifiedAt totalChildren withFinal withoutFinal snapshots`;

export const MEETING_RELEASE_STATUS_QUERY = gql<{ meetingReleaseStatus: MeetingReleaseStatusT }, { meetingId: string }>`
  query MeetingReleaseStatus($meetingId: String!) {
    meetingReleaseStatus(meetingId: $meetingId) { ${STATUS_FIELDS} }
  }
`;

export const PUBLISH_MEETING_TO_GUARDIANS = gql<
  { publishMeetingToGuardians: { status: MeetingReleaseStatusT; computed: number; notified: boolean } },
  { meetingId: string }
>`
  mutation PublishMeetingToGuardians($meetingId: String!) {
    publishMeetingToGuardians(meetingId: $meetingId) { computed notified status { ${STATUS_FIELDS} } }
  }
`;

export const WITHDRAW_MEETING_RELEASE = gql<{ withdrawMeetingRelease: MeetingReleaseStatusT }, { meetingId: string }>`
  mutation WithdrawMeetingRelease($meetingId: String!) {
    withdrawMeetingRelease(meetingId: $meetingId) { ${STATUS_FIELDS} }
  }
`;

export interface GuardianMeetingResultT {
  meetingId: string;
  instanceLabel: string;
  meetingDateKey: string;
  publishedAt: string;
  studentId: string;
  studentName: string;
  fromKey: string;
  toKey: string;
  numbers: {
    presentDays: number;
    markedDays: number;
    absentDays: number;
    leaveDays: number;
    classTestAvgPercent: number | null;
    classTestsSat: number;
    classTestsHeld: number;
    homeworkSubmitted: number;
    homeworkReceived: number;
    assignmentSubmitted: number;
    assignmentReceived: number;
  };
  classBest: {
    withheld: boolean;
    attendancePresentDays: number | null;
    classTestAvgPct: number | null;
    homeworkPct: number | null;
    assignmentPct: number | null;
  } | null;
  final: { strengths: string; concerns: string; updatedAt: string } | null;
}

export const GUARDIAN_MEETING_RESULTS_QUERY = gql<{ guardianMeetingResults: GuardianMeetingResultT[] }, { studentId: string }>`
  query GuardianMeetingResults($studentId: String!) {
    guardianMeetingResults(studentId: $studentId) {
      meetingId instanceLabel meetingDateKey publishedAt studentId studentName fromKey toKey
      numbers {
        presentDays markedDays absentDays leaveDays classTestAvgPercent classTestsSat classTestsHeld
        homeworkSubmitted homeworkReceived assignmentSubmitted assignmentReceived
      }
      classBest { withheld attendancePresentDays classTestAvgPct homeworkPct assignmentPct }
      final { strengths concerns updatedAt }
    }
  }
`;
